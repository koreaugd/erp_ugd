// src/pages/branch/helpers/fullTimeSalaryWorkbook.ts
// 관리자 '정직원 급여' 엑셀을 본사 표준 양식(2026.06 대학로고래 급여내역 파일)과 동일한 모양으로 만든다.
//
// 원본 양식의 구성(openpyxl로 실측):
//   1행  제목 "지점명_YYMM" (A1:C1 병합, 맑은고딕 15 굵게, 행 전체 위/아래 thin)
//   2~3행 2줄 헤더 — 회색(D9D9D9) 채움 + 검정 thin 격자 + 맑은고딕 11 굵게 + 가운데.
//         연장근무만 I2:K2 그룹(아래 근무시간/시급/계), 나머지는 세로 병합(rowSpan 2).
//         '실수령액(송금액)' 헤더만 노랑(FFFF00) — 본사가 채우는 칸이라 눈에 띄게.
//   4행~ 데이터 — 전 칸 thin 격자 + 가운데, 금액은 회계 서식(#,##0), 연장근무 3칸 회색,
//         계 = I×J 수식, 총금액 = SUM(이달급여, 계:상여금) 수식,
//         실수령액 칸은 노랑(F0EA00) + 빨강 12pt 굵게(빈칸, 본사 기입), 기타내용은 빨간 글씨 + 초광폭.
//
// XLSX는 monthlyCloseWorkbook과 같은 규칙으로 '동적 import한 xlsx-js-style 모듈'을 인자로 받는다
// (일반 xlsx 모듈은 셀 스타일을 버린다 — 반드시 xlsx-js-style로 write까지 해야 서식이 살아남는다).

const num = (v: unknown) => Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0;
const hoursNum = (v: unknown) => Number(String(v ?? "").replace(/[^0-9.]/g, "")) || 0;

// 대학로고래 파일에서 실측한 서식 상수들
const THIN = { style: "thin", color: { rgb: "000000" } };
const BORDER_ALL = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const FONT = "맑은 고딕";
const ACC_FMT = '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)'; // 회계(천단위, 음수 괄호)
const HOURS_FMT = "0.0_);[Red]\\(0.0\\)"; // 연장 근무시간(소수 1자리)
const PAYOUT_FMT = "#,##0;[Red]\\-#,##0"; // 실수령액(음수 빨강)

const headerStyle = (fillRgb = "D9D9D9") => ({
  fill: { patternType: "solid", fgColor: { rgb: fillRgb } },
  font: { name: FONT, sz: 11, bold: true },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
  border: BORDER_ALL,
});

const bodyStyle = (extra: Record<string, unknown> = {}) => ({
  font: { name: FONT, sz: 11 },
  alignment: { horizontal: "center", vertical: "center" },
  border: BORDER_ALL,
  ...extra,
});

const GRAY_FILL = { patternType: "solid", fgColor: { rgb: "D9D9D9" } };

/** "2026-07" → "26년 7월" (원본 파일의 시트 이름 규칙) */
export function fullTimeSalarySheetName(month: string): string {
  const [y, m] = month.split("-");
  return `${String(y).slice(2)}년 ${Number(m)}월`;
}

/**
 * 정직원 급여 시트를 본사 표준 양식으로 조립한다.
 * @param XLSX 동적 import한 xlsx-js-style 모듈
 * @param salary monthly_fulltime_salary:<지점>:<월> 저장 배열
 */
export function buildFullTimeSalarySheet(XLSX: any, branchName: string, month: string, salary: any[]): any {
  const [y, m] = month.split("-");
  const title = `${branchName}_${String(y).slice(2)}${m}`;

  // 1~3행(제목 + 2줄 헤더). 병합될 자리는 빈 문자열로 채워 격자 스타일이 들어갈 셀을 만들어 둔다.
  const aoa: unknown[][] = [
    [title, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["성명", "직급", "주민등록번호", "입사일", "근로계약", "입금계좌", "전월급여", "이달 급여", "연장근무", "", "", "택시비 및 기타지출", "상여금", "총 금액", "실수령액(송금액)", "현재 근무지", "기타내용(퇴사일 및 퇴직금등)"],
    ["", "", "", "", "", "", "", "", "근무시간(직원은 연장시간)", "시급", "계", "", "", "", "", "", ""],
  ];

  salary.forEach((r: any) => {
    // 입금계좌 = "은행명 + 계좌 숫자만"(하이픈·문자 제거 — 사용자 지정 규칙).
    // 옛 저장분은 '입금계좌' 한 칸에 은행명이 섞여 있을 수 있다 — 은행 칸이 비었으면 문자 부분을 은행명으로 살려 낸다.
    const rawAcc = String(r.accountNumber ?? "").trim();
    const digits = rawAcc.replace(/\D/g, "");
    const bank = String(r.bank ?? "").trim() || rawAcc.replace(/[0-9\-./() ]/g, "").trim();
    const accountCell = [bank, digits].filter(Boolean).join(" ");
    const otHours = hoursNum(r.overtimeHours);
    const otRate = num(r.overtimeRate);
    aoa.push([
      r.name || "", r.rank || "", r.residentNumber || "", r.entryDate || "",
      r.contractType || "4대보험", accountCell,
      num(r.prevSalary) || "", num(r.thisSalary) || "",
      otHours || "", otRate || "", "", // 계(K)는 아래에서 수식/레거시 값으로 채운다
      num(r.taxiEtc) || "", num(r.bonusTip) || "",
      "", // 총금액(N)도 수식으로
      "", // 실수령액(O)은 본사 기입 — 빈칸
      r.remitBranch || branchName, r.memo || "",
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // 병합: 제목 + 2줄 헤더(연장근무만 가로, 나머지 세로)
  const merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }, { s: { r: 1, c: 8 }, e: { r: 1, c: 10 } }];
  [0, 1, 2, 3, 4, 5, 6, 7, 11, 12, 13, 14, 15, 16].forEach((c) => merges.push({ s: { r: 1, c }, e: { r: 2, c } }));
  ws["!merges"] = merges;

  // 열너비/행높이 — 원본 파일 실측값
  ws["!cols"] = [16.4, 7, 17.9, 12.1, 8.6, 25.9, 12.7, 13.1, 11.6, 11, 12.6, 14, 13.5, 12.6, 15.1, 12.9, 64.3].map((wch) => ({ wch }));
  ws["!rows"] = aoa.map((_, i) => ({ hpt: i === 0 ? 24 : i === 1 ? 36 : i === 2 ? 52 : 31 }));

  const addr = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
  const ensure = (r: number, c: number) => {
    const a = addr(r, c);
    if (!ws[a]) ws[a] = { t: "s", v: "" };
    return ws[a];
  };

  // 제목행: A1만 글자, 행 전체에 위/아래 선
  for (let c = 0; c < 17; c++) {
    ensure(0, c).s = c === 0
      ? { font: { name: FONT, sz: 15, bold: true }, alignment: { horizontal: "left", vertical: "center" }, border: { top: THIN, bottom: THIN, left: THIN } }
      : { border: { top: THIN, bottom: THIN, ...(c === 16 ? { right: THIN } : {}) } };
  }

  // 헤더 2줄: 회색 격자(실수령액 헤더만 노랑)
  for (let r = 1; r <= 2; r++) {
    for (let c = 0; c < 17; c++) {
      ensure(r, c).s = headerStyle(c === 14 ? "FFFF00" : "D9D9D9");
    }
  }

  // 데이터 행 서식 + 수식
  for (let i = 0; i < salary.length; i++) {
    const r = 3 + i; // 0-기준 행 index (엑셀 4행부터)
    const rowNo = r + 1; // 수식용 1-기준 행 번호
    const row: any = salary[i];
    const otHours = hoursNum(row.overtimeHours);
    const otRate = num(row.overtimeRate);
    const legacyOt = num(row.overtimePay);

    for (let c = 0; c < 17; c++) ensure(r, c).s = bodyStyle();
    // 금액 칸 회계 서식
    [6, 7, 11, 12, 13].forEach((c) => { ensure(r, c).s = bodyStyle({ numFmt: ACC_FMT }); });
    // 연장근무 3칸: 회색 + (근무시간은 소수 서식)
    ensure(r, 8).s = bodyStyle({ fill: GRAY_FILL, numFmt: HOURS_FMT });
    ensure(r, 9).s = bodyStyle({ fill: GRAY_FILL, numFmt: ACC_FMT });
    ensure(r, 10).s = bodyStyle({ fill: GRAY_FILL, numFmt: ACC_FMT });

    // 계(K): 시간·시급이 둘 다 있으면 원본 양식 그대로 수식(=I×J).
    // 레거시(옛 '추가근무' 금액만 있는 행)는 수식이 0을 만들어 금액이 사라지므로 값으로 직접 넣는다(화면 계산 규칙과 동일).
    const kCell = ensure(r, 10);
    if (otHours > 0 && otRate > 0) { kCell.t = "n"; kCell.f = `I${rowNo}*J${rowNo}`; delete kCell.v; }
    else if (legacyOt > 0) { kCell.t = "n"; kCell.v = legacyOt; }

    // 총금액(N): 원본 양식 그대로 =SUM(이달급여, 계:상여금)
    const nCell = ensure(r, 13);
    nCell.t = "n"; nCell.f = `SUM(H${rowNo},K${rowNo}:M${rowNo})`; delete nCell.v;

    // 실수령액(O): 본사 기입 칸 — 노랑 + 빨강 12pt 굵게
    ensure(r, 14).s = bodyStyle({
      fill: { patternType: "solid", fgColor: { rgb: "F0EA00" } },
      font: { name: FONT, sz: 12, bold: true, color: { rgb: "FF0000" } },
      numFmt: PAYOUT_FMT,
    });

    // 기타내용(Q): 빨간 글씨 + 줄바꿈 허용(원본도 빨강)
    ensure(r, 16).s = bodyStyle({
      font: { name: FONT, sz: 11, color: { rgb: "FF0000" } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
    });
  }

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 2 + salary.length, c: 16 } });
  return ws;
}
