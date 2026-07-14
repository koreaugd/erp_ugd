// src/pages/branch/helpers/monthlyCloseWorkbook.ts
// 관리자 '월말마감 엑셀' 다중시트 생성 헬퍼.
// 개편(커밋 1b22d0e "월말마감정산 개편") 전 지점화면 handleDownloadExcel의
// 5개 시트(매입매출·파트타이머급여·현금지출·카드지출·현금관리) 구성을 관리자용으로 이식한 것.
// - 데이터 출처만 지점 localStorage → 서버 조회 결과(호출부에서 주입)로 교체.
// - 시트명/제목행/헤더 순서/열폭/스타일(노란 헤더·테두리)은 기존과 100% 동일하게 유지.
//
// 구조: 행 계산(buildMonthlyCloseSheetSpecs)은 XLSX 비의존 순수 함수라 단독 검증이 쉽고,
//       실제 워크북 조립(assembleMonthlyCloseWorkbook)만 동적 import한 xlsx-js-style 모듈을 받는다.

import { isSampleEmployee } from "./staffHelpers";

export interface MonthlyCloseData {
  branchName: string;
  month: string;                 // "YYYY-MM"
  purchases: any[];              // monthly_purchases:{branch}:{month}
  roster: any[];                 // getBranchOwnRoster(branch)
  salaries: any[];               // part_time_salaries:{branch}:{month}
  exclusions: string[];          // part_time_salary_exclusions:{branch}:{month}
  profiles: Record<string, any>; // part_time_profiles:{branch}
  history: any[];                // getBranchHistory(branch, month) — 해당 월 일일마감 기록
}

export interface SheetSpec {
  name: string;
  headers: string[];
  rows: (string | number)[][];
  widths: number[];
  numericColumns: number[];
  textColumns: number[];
  includeTitle: boolean;
}

const num = (v: unknown) => Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0;

const isBlank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";

/**
 * 매입매출 대장 '이체 필요금액' 칸의 값.
 * '이체 필요?' 해제(=이미 결제완료) 업체는 0으로 표기해 HQ 중복이체를 방지한다.
 * (transferNeeded는 옛 데이터엔 없으므로 undefined면 기본 true=이체 필요로 간주)
 */
export function purchaseTransferExportValue(r: any): number {
  return r?.transferNeeded === false ? 0 : num(r?.transferAmount);
}

/**
 * 매입매출 대장 '이달사용금액' 칸의 값. 공란("")이면 export에 빈 칸으로 나간다.
 * - 선입금 업체: 발주액 합계(monthlyUsageAmount).
 * - 이체 필요 후불업체: 이체필요금액=사용액이라 중복 방지로 공란.
 * - 결제완료 후불업체: 이미 결제한 업체의 실제 사용액.
 *   사용액이 비어 있으면 이체금액으로 폴백한다 — UI가 두 필드를 미러링하므로 통상 같은 값이고,
 *   비어 있는 건 구버전/외부 유입 데이터뿐이라 금액이 0으로 증발하지 않게 보존한다.
 *   (사용자가 명시적으로 "0"을 넣은 경우는 공란이 아니므로 그대로 0.)
 */
export function purchaseUsageExportValue(r: any): number | "" {
  if (r?.isPrepaid) return num(r?.monthlyUsageAmount);
  if (r?.transferNeeded !== false) return "";
  return isBlank(r?.monthlyUsageAmount) ? num(r?.transferAmount) : num(r?.monthlyUsageAmount);
}

/**
 * 매입매출 행이 실제 export(매입매출 대장)에 0 초과 금액으로 나가는지 판정.
 * 확정 게이트(hasMeaningful)와 관리자 다운로드 게이트가 동일 기준을 쓰도록 공유하며,
 * export 값 자체를 재사용해 '확정인데 워크북은 0/0' 불일치가 구조적으로 생기지 않게 한다.
 * (선입금 충전액은 export 컬럼이 없으므로 판정에서 제외.)
 */
export function purchaseRowHasExportableAmount(r: any): boolean {
  if (String(r?.vendorName || "").trim() === "") return false;
  const usage = purchaseUsageExportValue(r);
  return purchaseTransferExportValue(r) + (usage === "" ? 0 : usage) > 0;
}

/**
 * 5개 시트(매입매출·파트타이머급여·현금지출·카드지출·현금관리)의 헤더/행/열폭 스펙을 계산.
 * XLSX에 의존하지 않는 순수 함수 — 동일 입력이면 동일 출력.
 */
/** 급여 행에 적힌 사람 이름. 어느 칸에 적혔든 찾아 준다. */
const partTimeSalaryName = (row: any) => String(row?.name || row?.staffName || row?.employeeName || "").trim();

/**
 * 이름을 몰라 워크북에서 빠질 파트타이머 급여 행.
 *
 * 이름이 비면 예전에는 내부 id를 이름 대신 썼다. 그러면 급여대장에 수기로 행만 만들고 성명을 적지 않은 채
 * 마감했을 때 은행 이체 리스트에 "manual-1768…"이 수취인으로 찍힌다. 그래서 지금은 그런 행을 빼고 만든다.
 *
 * 그런데 조용히 빼면 실제로 일한 사람의 급여가 누락된 채 '정상 파일'처럼 보인다. 그래서 관리자 화면은
 * 내려받기 전에 이 함수로 먼저 확인하고, 한 건이라도 있으면 다운로드를 멈춘다.
 *
 * 판단 기준을 여기 한 곳에 둔 이유: 관문과 빌더가 각자 판단하면 언제든 어긋난다.
 * 한쪽은 막는데 다른 쪽은 내보내거나(무의미한 차단), 한쪽은 통과시키는데 다른 쪽이 빼 버린다(조용한 누락).
 *
 * 직원명부에 있는 사람은 여기서 세지 않는다 — 그 이름은 명부에서 오므로 급여 행이 비어 있어도 정상 출력된다.
 */
export function unnamedPartTimeSalaryRows({
  salaries,
  roster,
  exclusions
}: {
  salaries: any[] | null | undefined;
  roster: any[] | null | undefined;
  exclusions: string[] | null | undefined;
}): any[] {
  const rosterPartTimerIds = new Set(
    (Array.isArray(roster) ? roster : [])
      .filter((emp: any) => emp?.division === "파트타이머" && !isSampleEmployee(emp))
      .map((emp: any) => emp.id)
  );
  const excluded = new Set(Array.isArray(exclusions) ? exclusions : []);

  return (Array.isArray(salaries) ? salaries : []).filter(
    (row: any) =>
      row?.employeeId &&
      !excluded.has(row.employeeId) &&
      !rosterPartTimerIds.has(row.employeeId) &&
      !partTimeSalaryName(row)
  );
}

export function buildMonthlyCloseSheetSpecs(data: MonthlyCloseData): SheetSpec[] {
  const { branchName, month } = data;
  const purchases = Array.isArray(data.purchases) ? data.purchases : [];
  const roster = Array.isArray(data.roster) ? data.roster : [];
  const salaries = Array.isArray(data.salaries) ? data.salaries : [];
  const exclusions = Array.isArray(data.exclusions) ? data.exclusions : [];
  const profiles = data.profiles && typeof data.profiles === "object" ? data.profiles : {};
  const history = Array.isArray(data.history) ? data.history : [];
  const inMonth = (settleDate: unknown) => String(settleDate || "").startsWith(month);

  // ─────────────────────────────────────────────
  // 1. 매입매출 대장
  // ─────────────────────────────────────────────
  const purchaseHeaders = ["매출항목", "업체명", "이체 필요금액", "은행", "계좌번호", "기타내용", "이달사용금액", "오류"];
  const purchaseRows: (string | number)[][] = purchases.map((r: any) => [
    r.category,
    r.vendorName,
    purchaseTransferExportValue(r),
    r.bank,
    r.accountNumber,
    r.memo,
    purchaseUsageExportValue(r),
    "",
  ]);

  // ─────────────────────────────────────────────
  // 2. 파트타이머 급여대장
  // ─────────────────────────────────────────────
  const rosterPartTimers: any[] = roster.filter((emp: any) => emp.division === "파트타이머" && !isSampleEmployee(emp));

  // 일일마감 메타데이터에서 파트타이머 누적 근무시간/출근일 텔레메트리 집계
  const ptTelemetry: { [name: string]: { hours: number; dates: string[] } } = {};
  history.forEach((m: any) => {
    if (!inMonth(m.settleDate)) return;
    const parts = String(m.memo || "").split("\n---\nMETADATA:");
    if (!parts[1]) return;
    try {
      const meta = JSON.parse(parts[1].trim());
      if (meta && meta.staffRows) {
        meta.staffRows.forEach((s: any) => {
          if (s.division === "파트타이머" && Number(s.workHours || 0) > 0) {
            if (!ptTelemetry[s.name]) ptTelemetry[s.name] = { hours: 0, dates: [] };
            ptTelemetry[s.name].hours += Number(s.workHours || 0);
            const dateParts = String(m.settleDate).split("-");
            const daySuffix = dateParts[2] ? `${Number(dateParts[2])}` : String(m.settleDate);
            if (!ptTelemetry[s.name].dates.includes(daySuffix)) ptTelemetry[s.name].dates.push(daySuffix);
          }
        });
      }
    } catch {}
  });

  const savedSalaryMap: { [empId: string]: any } = {};
  salaries.forEach((item: any) => {
    if (item && item.employeeId) savedSalaryMap[item.employeeId] = item;
  });

  const excludedSetForExcel = new Set(exclusions);
  const getStoredProfile = (empId: string): any => profiles[empId] || {};

  // 로스터에 없지만 급여/텔레메트리에만 존재하는 파트타이머도 누락 없이 포함
  const knownPartTimerIds = new Set(rosterPartTimers.map((pt) => pt.id));
  Object.values(savedSalaryMap).forEach((salary: any) => {
    if (!salary?.employeeId || knownPartTimerIds.has(salary.employeeId)) return;

    // 이름을 모르면 내보내지 않는다. 이유는 partTimeSalaryName 위의 설명 참고.
    const name = partTimeSalaryName(salary);
    if (!name) return;

    rosterPartTimers.push({ id: salary.employeeId, name, division: "파트타이머" });
    knownPartTimerIds.add(salary.employeeId);
  });
  Object.keys(ptTelemetry).forEach((name) => {
    if (!rosterPartTimers.some((pt) => pt.name === name)) {
      rosterPartTimers.push({ id: `legacy-${branchName}-${name}`, name, division: "파트타이머" });
    }
  });

  const partTimeHeaders = ["성명(입사일)", "주민등록번호", "입사일", "근로계약", "은행", "입금계좌", "시급", "누적시간", "팁/기타", "급여", "출근날짜", "실수령액(송금액)", "실제 송금지점", "기타내용(퇴사일 및 퇴직금등)"];
  const partTimeRows: (string | number)[][] = rosterPartTimers
    .filter((pt) => !excludedSetForExcel.has(pt.id))
    .map((pt) => {
      const tel = ptTelemetry[pt.name] || { hours: 0, dates: [] };
      const saved = savedSalaryMap[pt.id] || {};
      const profile = getStoredProfile(pt.id);

      const hourlyRate = saved.hourlyRate || profile.hourlyRate || "15000";
      const accumulatedHours = saved.accumulatedHours !== undefined ? saved.accumulatedHours : String(tel.hours);
      const tipsEtcAmount = saved.tipsEtcAmount || "0";
      const calcSalary = saved.calculatedSalary !== undefined && saved.calculatedSalary !== ""
        ? saved.calculatedSalary
        : String((Number(hourlyRate) * Number(accumulatedHours)) + (Number(tipsEtcAmount) || 0));
      const calcActualPaid = saved.actualPaidAmount || "";
      const attendanceDates = saved.attendanceDates !== undefined
        ? saved.attendanceDates
        : tel.dates.slice().sort((a, b) => Number(a) - Number(b)).slice(0, 7).join(",");

      return [
        pt.name,
        saved.residentNumber || profile.residentNumber || "",
        saved.entryDate || profile.entryDate || "",
        saved.contractStatus || profile.contractStatus || "미작성",
        saved.bank || profile.bank || "",
        saved.accountNumber || profile.accountNumber || "",
        Number(hourlyRate) || 0,
        Number(accumulatedHours) || 0,
        Number(tipsEtcAmount) || 0,
        Number(calcSalary) || 0,
        attendanceDates,
        calcActualPaid ? (Number(calcActualPaid) || "") : "",
        saved.payoutBranch || branchName,
        saved.memo || "",
      ];
    });

  // ─────────────────────────────────────────────
  // 3. 현금지출 일람 (일일마감 메타데이터의 cashExpenses)
  // ─────────────────────────────────────────────
  const cashList: any[] = [];
  history.forEach((m: any) => {
    if (!inMonth(m.settleDate)) return;
    const parts = String(m.memo || "").split("\n---\nMETADATA:");
    if (!parts[1]) return;
    try {
      const meta = JSON.parse(parts[1].trim());
      if (meta && meta.cashExpenses) {
        meta.cashExpenses.forEach((exp: any) => {
          const itemAmount = Number(exp.amount) || 0;
          if (itemAmount > 0) {
            cashList.push({
              마감일자: m.settleDate,
              금액: itemAmount,
              거래처: exp.usage || "공란",
              분류: exp.classification || "미분류",
              세부: exp.detail || "",
              작성자: m.submittedBy || m.submitted_by || m.writer || "미상",
              입력시각: m.submittedAt ? m.submittedAt : "",
            });
          }
        });
      }
    } catch {}
  });
  cashList.sort((a, b) => String(a.마감일자).localeCompare(String(b.마감일자)));

  // ─────────────────────────────────────────────
  // 4. 현금관리 집계
  // ─────────────────────────────────────────────
  const cashMgmt: any[] = [];
  history.forEach((m: any) => {
    if (!inMonth(m.settleDate)) return;
    const parts = String(m.memo || "").split("\n---\nMETADATA:");
    let metaParsed: any = {};
    if (parts[1]) {
      try { metaParsed = JSON.parse(parts[1].trim()); } catch {}
    }
    const prevVal = Number(metaParsed.prevDayCash) || 0;
    const salesVal = Number(m.cashSales) || 0;
    const expensesVal = metaParsed.cashExpenses
      ? metaParsed.cashExpenses.reduce((sum: number, x: any) => sum + (Number(x.amount) || 0), 0)
      : 0;
    const theoryVal = prevVal + salesVal - expensesVal;
    const vaultVal = Number(metaParsed.cashBalance) || 0;
    cashMgmt.push({
      마감일자: m.settleDate,
      전일현금: prevVal,
      현금매출: salesVal,
      현금지출: expensesVal,
      이론잔액: theoryVal,
      실사현금: vaultVal,
      차이: vaultVal - theoryVal,
      계좌이체: Number(m.transferSales) || 0,
      사유: metaParsed.cashDiffReason || "",
      작성자: m.submittedBy || m.submitted_by || m.writer || "매니저",
      입력시각: m.submittedAt || "",
    });
  });
  cashMgmt.sort((a, b) => String(a.마감일자).localeCompare(String(b.마감일자)));

  // ─────────────────────────────────────────────
  // 5. 카드지출 일람 (일일마감 메타데이터의 cardExpenses)
  // ─────────────────────────────────────────────
  const cardList: any[] = [];
  history.forEach((m: any) => {
    if (!inMonth(m.settleDate)) return;
    const parts = String(m.memo || "").split("\n---\nMETADATA:");
    if (!parts[1]) return;
    try {
      const meta = JSON.parse(parts[1].trim());
      if (meta && meta.cardExpenses) {
        meta.cardExpenses.forEach((exp: any) => {
          const itemAmount = Number(exp.amount) || 0;
          if (itemAmount > 0) {
            cardList.push({
              마감일자: m.settleDate,
              금액: itemAmount,
              사용처: exp.usage || "공란",
              분류: exp.classification || "미분류",
              세부: exp.detail || "",
              작성자: m.submittedBy || m.submitted_by || m.writer || "매니저",
              입력시각: m.submittedAt || "",
            });
          }
        });
      }
    } catch {}
  });
  cardList.sort((a, b) => String(a.마감일자).localeCompare(String(b.마감일자)));

  // ─────────────────────────────────────────────
  // 날짜 포맷터 (기존 서식 동일)
  // ─────────────────────────────────────────────
  const formatDate = (value: string) => {
    const match = String(value || "").match(/(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}. ${Number(match[2])}. ${Number(match[3])}` : "";
  };
  const formatCardDate = (value: string) => {
    const match = String(value || "").match(/\d{4}-(\d{2})-(\d{2})/);
    return match ? `${Number(match[1])} . ${Number(match[2])}` : "";
  };
  const formatInputDate = (value: string, fallback: string) => {
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime())
      ? `${parsed.getFullYear()}. ${parsed.getMonth() + 1}. ${parsed.getDate()}`
      : formatDate(fallback);
  };

  const expenseHeaders = ["마감일자", "결제수단", "금액", "사용처(거래처)", "항목", "지출내용(세부)", "비고", "작성자", "입력시각", "마감키"];

  const cashRows: (string | number)[][] = cashList.map((row) => {
    const date = String(row.마감일자 || "");
    const writer = String(row.작성자 || "");
    return [formatDate(date), "현금", row.금액, row.거래처, row.분류, row.세부, "", writer, formatInputDate(row.입력시각, date), `${date}|${writer}`];
  });

  const cashManagementHeaders = ["마감일자", "전일현금", "현금매출", "현금지출", "현금잔액", "실사현금", "차이", "계좌이체", "비고", "작성자", "입력시각"];
  const mgmtRows: (string | number)[][] = cashMgmt.map((row) => {
    const date = String(row.마감일자 || "");
    const writer = String(row.작성자 || "");
    return [formatDate(date), row.전일현금, row.현금매출, row.현금지출, row.이론잔액, row.실사현금, row.차이, row.계좌이체, row.사유, writer, formatInputDate(row.입력시각, date)];
  });

  const cardRows: (string | number)[][] = cardList.map((row) => {
    const date = String(row.마감일자 || "");
    const writer = String(row.작성자 || "");
    return [formatCardDate(date), "카드", row.금액, row.사용처, row.분류, row.세부, "", writer, formatInputDate(row.입력시각, date), `${date}|${writer}`];
  });

  return [
    {
      name: "매입매출",
      headers: purchaseHeaders,
      rows: purchaseRows,
      widths: [17.17, 14, 12.17, 13.33, 40.83, 60.17, 14.83, 10.33],
      numericColumns: [2, 6],
      textColumns: [4],
      includeTitle: true,
    },
    {
      name: "파트타이머급여",
      headers: partTimeHeaders,
      rows: partTimeRows,
      widths: [11.57, 15.86, 9.2, 8.21, 5.14, 19.64, 10.71, 7.2, 9.29, 9.29, 24.14, 10.21, 10.21, 41.43],
      numericColumns: [6, 7, 8, 9, 11],
      textColumns: [1, 5],
      includeTitle: true,
    },
    {
      name: "현금지출",
      headers: expenseHeaders,
      rows: cashRows,
      widths: [11.3, 6.8, 16.4, 11.3, 24.8, 11.9, 6.8, 10.2, 11, 28.8],
      numericColumns: [2],
      textColumns: [],
      includeTitle: false,
    },
    {
      name: "카드지출",
      headers: expenseHeaders,
      rows: cardRows,
      widths: [11.3, 6.8, 16.4, 18.8, 24.8, 13.3, 6.8, 6.8, 9.9, 23.5],
      numericColumns: [2],
      textColumns: [],
      includeTitle: false,
    },
    {
      name: "현금관리",
      headers: cashManagementHeaders,
      rows: mgmtRows,
      widths: [10.08, 10.08, 10.08, 10.08, 10.08, 10.08, 10.08, 10.08, 23.23, 10.08, 10.08],
      numericColumns: [1, 2, 3, 4, 5, 6, 7],
      textColumns: [],
      includeTitle: false,
    },
  ];
}

/**
 * SheetSpec 하나를 스타일이 적용된 워크시트로 변환. (기존 makeSheet 로직과 동일)
 * XLSX는 동적 import한 xlsx-js-style 모듈을 그대로 받는다.
 */
function makeStyledSheet(XLSX: any, branchName: string, monthNumber: number, spec: SheetSpec) {
  const { headers, rows, widths, numericColumns, textColumns, includeTitle } = spec;

  const headerStyle = {
    font: { bold: true, sz: 10, color: { rgb: "1F2937" } },
    fill: { patternType: "solid", fgColor: { rgb: "F1C232" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: false },
    border: { top: { style: "thin", color: { rgb: "B08A00" } }, bottom: { style: "thin", color: { rgb: "B08A00" } }, left: { style: "thin", color: { rgb: "B08A00" } }, right: { style: "thin", color: { rgb: "B08A00" } } },
  };
  const titleStyle = { font: { bold: true, sz: 10, color: { rgb: "17365D" } }, alignment: { vertical: "center" } };
  const bodyBorder = { top: { style: "thin", color: { rgb: "D9E2F3" } }, bottom: { style: "thin", color: { rgb: "D9E2F3" } }, left: { style: "thin", color: { rgb: "D9E2F3" } }, right: { style: "thin", color: { rgb: "D9E2F3" } } };

  const source: any[][] = includeTitle
    ? [[branchName, "", "", monthNumber, "월"], headers, ...rows]
    : [headers, ...rows];
  const sheet = XLSX.utils.aoa_to_sheet(source);
  const headerRow = includeTitle ? 1 : 0;
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  sheet["!rows"] = source.map((_, index) => ({ hpt: includeTitle && index === 0 ? 24 : index === headerRow ? 20 : 17 }));
  for (let col = 0; col < headers.length; col++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c: col })];
    if (cell) cell.s = headerStyle;
  }
  if (includeTitle) {
    [0, 3, 4].forEach((col) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: col })];
      if (cell) cell.s = titleStyle;
    });
  }
  for (let row = headerRow + 1; row < source.length; row++) {
    for (let col = 0; col < headers.length; col++) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address];
      if (!cell) continue;
      cell.s = { font: { sz: 10 }, border: bodyBorder, alignment: { vertical: "center", wrapText: col === headers.length - 1 } };
      if (numericColumns.includes(col)) cell.z = "#,##0";
      if (textColumns.includes(col)) cell.z = "@";
    }
  }
  return sheet;
}

/**
 * 5개 시트가 담긴 워크북을 조립해 반환. (파일 저장은 호출부에서 XLSX.writeFile로 수행)
 * @param XLSX 동적 import한 xlsx-js-style 모듈
 */
export function assembleMonthlyCloseWorkbook(XLSXModule: any, data: MonthlyCloseData) {
  // 동적 import 상호운용: 번들러/런타임에 따라 utils가 최상위 또는 default에 위치할 수 있어 정규화한다.
  const XLSX = XLSXModule && XLSXModule.utils ? XLSXModule : (XLSXModule && XLSXModule.default) ? XLSXModule.default : XLSXModule;
  const specs = buildMonthlyCloseSheetSpecs(data);
  const monthNumber = Number(String(data.month).split("-")[1]) || 0;
  const wb = XLSX.utils.book_new();
  for (const spec of specs) {
    const ws = makeStyledSheet(XLSX, data.branchName, monthNumber, spec);
    XLSX.utils.book_append_sheet(wb, ws, spec.name);
  }
  return wb;
}
