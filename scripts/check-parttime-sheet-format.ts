/**
 * 관리자 월말마감 엑셀 — 파트타이머급여 시트가 본사 '일용직 급여자료 서식'과 같은 모양인지 검증.
 * (읽기 전용, 서버 접속 없음)
 *
 *   npx tsx scripts/check-parttime-sheet-format.ts
 *   PART_TIME_SHEET_OUT=<폴더> npx tsx scripts/check-parttime-sheet-format.ts   # 눈으로 볼 파일도 저장
 *
 * 왜 이 검증이 있나 (2026-11-05)
 *   본사가 보낸 '유지디(주)_일용직 급여자료_서식.xlsx'는 출근날짜를 한 칸에 "3,5,12"로 적지 않고
 *   1일~31일 31칸(K~AO열)으로 펼쳐 일한 날에 1을 적는다. 머리글이 2줄(출근날짜 / 1일~31일)이고
 *   나머지 머리글은 위아래로 병합돼 있다. 그 뒤 칸(실수령액·송금지점·기타내용)은 AP~AR열로 밀린다.
 *   출근일 개수는 화면과 같은 규칙(최대 7개)을 그대로 지킨다 — 사용자 지시.
 *
 * 픽스처는 전부 **합성 데이터**다. 이 저장소는 공개돼 있어 실제 주민등록번호·계좌번호를 넣으면 안 된다.
 */
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx-js-style";
import {
  assembleMonthlyCloseWorkbook,
  attendanceDayCells,
  buildMonthlyCloseSheetSpecs,
  PART_TIME_DAY_COLUMNS,
  type MonthlyCloseData
} from "../src/pages/branch/helpers/monthlyCloseWorkbook";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log(`  OK   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}\n         기대: ${e}\n         실제: ${a}`);
}

const BRANCH = "테스트지점";
const MONTH = "2026-10";
const DAY0 = 10; // 1일 칸의 인덱스(0부터). 성명~급여 10칸 다음.

/** 일일마감 기록 한 건. 화면·엑셀이 읽는 그대로 memo 뒤에 METADATA 로 근무자를 싣는다. */
const settle = (day: string, staffRows: any[]) => ({
  settleDate: `${MONTH}-${day}`,
  memo: `메모\n---\nMETADATA:${JSON.stringify({ staffRows })}`
});

const data: MonthlyCloseData = {
  branchName: BRANCH,
  month: MONTH,
  purchases: [],
  roster: [
    { id: "emp-1", name: "홍길동", division: "파트타이머" },
    { id: "emp-2", name: "김민지", division: "파트타이머" },
    { id: "emp-3", name: "박철수", division: "파트타이머" }
  ],
  salaries: [
    { employeeId: "emp-1", name: "홍길동", hourlyRate: "15000", accountNumber: "1111", memo: "" },
    // 출근일을 직접 적은 사람 — 날짜로 못 읽는 "10~14"가 섞여 있다.
    { employeeId: "emp-2", name: "김민지", hourlyRate: "15000", accumulatedHours: "8", hoursOverridden: true, attendanceDates: "2,10~14,31", attendanceOverridden: true, accountNumber: "2222", memo: "비고" },
    { employeeId: "emp-3", name: "박철수", hourlyRate: "15000", accountNumber: "3333", memo: "" }
  ],
  exclusions: [],
  profiles: {},
  history: [
    settle("03", [{ name: "홍길동", division: "파트타이머", workHours: 5 }]),
    settle("05", [{ name: "홍길동", division: "파트타이머", workHours: 5 }]),
    settle("12", [{ name: "홍길동", division: "파트타이머", workHours: 5.5 }]),
    // 박철수는 1일~10일 열흘 — 화면 규칙대로 7일까지만 찍혀야 한다.
    ...Array.from({ length: 10 }, (_, i) => settle(String(i + 1).padStart(2, "0"), [{ name: "박철수", division: "파트타이머", workHours: 4 }]))
  ],
  manualWork: []
};

const sheet = buildMonthlyCloseSheetSpecs(data).find((s) => s.name === "파트타이머급여")!;
const rowOf = (name: string) => sheet.rows.find((r) => String(r[0]) === name)!;
const onDays = (row: (string | number)[]) => row.slice(DAY0, DAY0 + PART_TIME_DAY_COLUMNS).map((v, i) => (v === 1 ? i + 1 : null)).filter(Boolean);

console.log("\n[1] 칸 구성 — 서식과 같은 머리글 2줄");
check("머리글 칸 수 = 10 + 31 + 3", sheet.headers.length, DAY0 + PART_TIME_DAY_COLUMNS + 3);
check("앞 10칸", sheet.headers.slice(0, DAY0), ["성명(입사일)", "주민등록번호", "입사일", "근로계약", "은행", "입금계좌", "시급", "누적시간", "팁/기타", "급여"]);
check("출근날짜 머리글은 1일 칸 위에만", [sheet.headers[DAY0], sheet.headers[DAY0 + 1], sheet.headers[DAY0 + PART_TIME_DAY_COLUMNS - 1]], ["출근날짜", "", ""]);
check("뒤 3칸", sheet.headers.slice(DAY0 + PART_TIME_DAY_COLUMNS), ["실수령액(송금액)", "실제 송금지점", "기타내용(퇴사일 및 퇴직금등)"]);
check("둘째 줄 1일~31일", [sheet.subHeaders?.[DAY0], sheet.subHeaders?.[DAY0 + 30], sheet.subHeaders?.length], ["1일", "31일", sheet.headers.length]);
check("둘째 줄 나머지는 빈칸(위와 병합)", sheet.subHeaders?.filter((h, i) => (i < DAY0 || i >= DAY0 + PART_TIME_DAY_COLUMNS) && h !== ""), []);
check("열 너비 개수 = 칸 수", sheet.widths.length, sheet.headers.length);
check("숫자 서식 칸 = 시급·시간·팁·급여·실수령액", sheet.numericColumns, [6, 7, 8, 9, DAY0 + PART_TIME_DAY_COLUMNS]);

console.log("\n[2] 출근일 → 날짜별 칸에 1");
check("행 길이 = 칸 수", sheet.rows.map((r) => r.length), [sheet.headers.length, sheet.headers.length, sheet.headers.length]);
check("홍길동 3·5·12일", onDays(rowOf("홍길동")), [3, 5, 12]);
check("홍길동 누적시간·급여는 그대로", [rowOf("홍길동")[7], rowOf("홍길동")[9]], [15.5, 232500]);
check("박철수 열흘 중 7일까지만(화면과 같은 한도)", onDays(rowOf("박철수")), [1, 2, 3, 4, 5, 6, 7]);
check("김민지 직접 적은 출근일 2·31일", onDays(rowOf("김민지")), [2, 31]);
check("김민지 못 읽은 조각은 기타내용에 남긴다", rowOf("김민지")[DAY0 + PART_TIME_DAY_COLUMNS + 2], "비고 / 출근일 확인: 10~14");
check("홍길동 기타내용은 그대로 빈칸", rowOf("홍길동")[DAY0 + PART_TIME_DAY_COLUMNS + 2], "");
check("실수령액은 비워 둔다", sheet.rows.map((r) => r[DAY0 + PART_TIME_DAY_COLUMNS]), ["", "", ""]);
check("송금지점 = 지점명", sheet.rows.map((r) => r[DAY0 + PART_TIME_DAY_COLUMNS + 1]), [BRANCH, BRANCH, BRANCH]);

console.log("\n[3] attendanceDayCells 단독");
check("빈 문자열 → 전부 빈칸", attendanceDayCells("").cells.every((c) => c === ""), true);
check("0·32·공백은 무시하고 돌려준다", attendanceDayCells("0, 32 ,,7").unparsed, ["0", "32"]);
check("앞의 0이 붙은 '05'도 5일로", attendanceDayCells("05").cells[4], 1);

console.log("\n[4] 실제 워크북 — 서식과 같은 위치·병합·서식");
const wb = assembleMonthlyCloseWorkbook(XLSX, data);
const ws = wb.Sheets["파트타이머급여"];
const cell = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })];
check("A1 지점명 / D1 월 / E1 '월'", [ws["A1"]?.v, ws["D1"]?.v, ws["E1"]?.v], [BRANCH, 10, "월"]);
check("A2 성명 / K2 출근날짜 / AP2 실수령액 / AR2 기타내용", [ws["A2"]?.v, ws["K2"]?.v, ws["AP2"]?.v, ws["AR2"]?.v], ["성명(입사일)", "출근날짜", "실수령액(송금액)", "기타내용(퇴사일 및 퇴직금등)"]);
check("K3 1일 / AO3 31일", [ws["K3"]?.v, ws["AO3"]?.v], ["1일", "31일"]);
const merges = (ws["!merges"] || []).map((m: any) => XLSX.utils.encode_range(m)).sort();
check("병합 14개 = 서식과 동일", merges, ["A2:A3", "AP2:AP3", "AQ2:AQ3", "AR2:AR3", "B2:B3", "C2:C3", "D2:D3", "E2:E3", "F2:F3", "G2:G3", "H2:H3", "I2:I3", "J2:J3", "K2:AO2"].sort());
check("머리글 2줄 모두 노란 배경", [ws["A2"]?.s?.fill?.fgColor?.rgb, ws["A3"]?.s?.fill?.fgColor?.rgb, ws["L2"]?.s?.fill?.fgColor?.rgb, ws["AO3"]?.s?.fill?.fgColor?.rgb], ["F1C232", "F1C232", "F1C232", "F1C232"]);
check("사람은 4행부터", cell(3, 0)?.v, sheet.rows[0][0]);
const hong = 3 + sheet.rows.findIndex((r) => r[0] === "홍길동");
check("홍길동 3일 칸(M열) = 1, 가운데 정렬", [cell(hong, DAY0 + 2)?.v, cell(hong, DAY0 + 2)?.s?.alignment?.horizontal], [1, "center"]);
// 안 간 날도 칸은 있다(값 "" + 테두리) — 서식처럼 표 격자가 끊기지 않게. 숫자 서식은 걸지 않는다.
check("홍길동 4일 칸(N열)은 빈 값 + 테두리, 숫자 서식 없음", [cell(hong, DAY0 + 3)?.v, cell(hong, DAY0 + 3)?.s?.border?.top?.style, cell(hong, DAY0 + 3)?.z], ["", "thin", undefined]);
check("B열 주민번호 텍스트 서식 / J열 급여 #,##0", [cell(hong, 1)?.z, cell(hong, 9)?.z], ["@", "#,##0"]);
check("기타내용 칸은 줄바꿈 허용", cell(hong, DAY0 + PART_TIME_DAY_COLUMNS + 2)?.s?.alignment?.wrapText, true);
check("행 높이: 제목 24 / 머리글 20·20 / 사람 17", (ws["!rows"] || []).slice(0, 4).map((r: any) => r.hpt), [24, 20, 20, 17]);
check("다른 시트 이름 그대로", wb.SheetNames, ["매입매출", "파트타이머급여", "현금지출", "카드지출", "현금관리"]);

const outDir = process.env.PART_TIME_SHEET_OUT;
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  XLSX.writeFile(wb, path.join(outDir, "parttime_sheet_sample.xlsx"));
  console.log(`\n확인용 파일 저장: ${path.join(outDir, "parttime_sheet_sample.xlsx")}`);
}

console.log(failures === 0 ? "\n모두 통과" : `\n실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
