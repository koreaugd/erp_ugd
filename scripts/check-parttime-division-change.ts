/**
 * 파트타이머 급여대장 — 달 중간에 구분이 바뀐 사람(파트타이머 → 정직원)과 0.5시간 표기 검증.
 * (읽기 전용, 서버 접속 없음)
 *
 *   npx tsx scripts/check-parttime-division-change.ts
 *
 * 왜 이 검증이 있나 (2026-10-03 실제 사고, 대물섬 강남점 2026-09)
 *   9월 중순까지 파트타이머로 일하다 9/28 정직원이 된 사람이 있었다. 직원명부의 구분이 '정직원'으로
 *   바뀌자 마감 엑셀은 그 사람을 '명부 밖 행'으로 보고 근무시간을 0으로 냈다 — 지점 화면에는
 *   2,505,000원이 보이는데 내려받은 파일에는 0원·출근일 빈칸이었다.
 *   또 누적시간 칸에 정수 서식(#,##0)이 걸려 있어 167.5시간이 168로 보였다(값·급여는 정확).
 *
 * 픽스처는 전부 **합성 데이터**다. 이 저장소는 공개돼 있어 실제 주민등록번호·계좌번호를 넣으면 안 된다.
 */
import XLSX from "xlsx-js-style";
import XLSXCore from "xlsx"; // 표시 문자열 확인용 서식기(SSF)
import { partTimeRosterForMonth } from "../src/pages/branch/helpers/partTimeSalaryRules";
import { assembleMonthlyCloseWorkbook, buildMonthlyCloseSheetSpecs, type MonthlyCloseData } from "../src/pages/branch/helpers/monthlyCloseWorkbook";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log(`  OK   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}\n         기대: ${e}\n         실제: ${a}`);
}

const BRANCH = "테스트지점";
const MONTH = "2026-09";

/** 일일마감 기록 한 건. 화면·엑셀이 읽는 그대로 memo 뒤에 METADATA 로 근무자를 싣는다. */
const settle = (day: string, staffRows: any[]) => ({
  settleDate: `${MONTH}-${day}`,
  memo: `메모\n---\nMETADATA:${JSON.stringify({ staffRows })}`
});

const closeData = (over: Partial<MonthlyCloseData>): MonthlyCloseData => ({
  branchName: BRANCH,
  month: MONTH,
  purchases: [],
  roster: [],
  salaries: [],
  exclusions: [],
  profiles: {},
  history: [],
  manualWork: [],
  ...over
});

const partTimeSheet = (data: MonthlyCloseData) =>
  buildMonthlyCloseSheetSpecs(data).find((s) => s.name === "파트타이머급여")!;

// ─────────────────────────────────────────────────────────────
console.log("\n[1] 명부 행으로 볼 사람 고르기 (partTimeRosterForMonth)");
// ─────────────────────────────────────────────────────────────
{
  const roster = [
    { id: "emp-1", name: "홍길동", division: "정직원" },   // 이달 중 정직원이 됨 — 이달 급여 행이 있다
    { id: "emp-2", name: "김민지", division: "파트타이머" },
    { id: "emp-3", name: "이영희", division: "정직원" }    // 원래 정직원 — 파트 급여 행 없음
  ];
  const picked = partTimeRosterForMonth(roster, { salaryEmployeeIds: ["emp-1", "manual-1", "legacy-테스트지점-박철수"] });
  check("파트타이머 + 이달 급여 행이 있는 사람만, 명부 순서대로", picked.map((e) => e.id), ["emp-1", "emp-2"]);
  check("근거가 없으면 정직원은 들어오지 않는다", partTimeRosterForMonth(roster, {}).map((e) => e.id), ["emp-2"]);
  check(
    "급여 행이 없어도 이달 파트타이머로 일했으면 들어온다",
    partTimeRosterForMonth(roster, { partTimeWorkerNames: ["홍길동"] }).map((e) => e.id),
    ["emp-1", "emp-2"]
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[2] 달 중간에 정직원이 된 사람 — 파트 근무분은 엑셀에 그대로 나간다");
// ─────────────────────────────────────────────────────────────
{
  const data = closeData({
    roster: [{ id: "emp-1", name: "홍길동", division: "정직원" }],
    salaries: [{ employeeId: "emp-1", name: "홍길동", hourlyRate: "15000", accumulatedHours: "0", accountNumber: "1111" }],
    history: [
      settle("10", [{ name: "홍길동", division: "파트타이머", workHours: 10.5 }]),
      settle("14", [{ name: "홍길동", division: "파트타이머", workHours: 9 }]),
      // 정직원이 된 뒤의 근무는 파트 급여가 아니다 — 세지 않는다.
      settle("28", [{ name: "홍길동", division: "정직원", workHours: 10 }])
    ]
  });
  const rows = partTimeSheet(data).rows.filter((r) => String(r[0]) === "홍길동");
  check("한 줄만 나간다(legacy 중복 없음)", rows.length, 1);
  check("[누적시간, 급여, 출근일] = 파트 근무분", [rows[0]?.[7], rows[0]?.[9], rows[0]?.[10]], [19.5, 292500, "10,14"]);
}
{
  // 직접 적은 시간은 예전처럼 그대로 지킨다.
  const data = closeData({
    roster: [{ id: "emp-1", name: "홍길동", division: "정직원" }],
    salaries: [{ employeeId: "emp-1", name: "홍길동", hourlyRate: "15000", accumulatedHours: "20", hoursOverridden: true }],
    history: [settle("10", [{ name: "홍길동", division: "파트타이머", workHours: 10 }])]
  });
  const rows = partTimeSheet(data).rows;
  check("직접 적은 시간은 그대로", [rows[0]?.[7], rows[0]?.[9]], [20, 300000]);
}
{
  // 원래 정직원이고 파트 급여 행도 없으면 파트타이머 급여표에 나오지 않는다.
  const data = closeData({
    roster: [{ id: "emp-3", name: "이영희", division: "정직원" }],
    history: [settle("10", [{ name: "이영희", division: "정직원", workHours: 10 }])]
  });
  check("정직원은 파트 급여표에 없다", partTimeSheet(data).rows.length, 0);
}
{
  // 급여 행이 아직 없는 경우 — 근무기록만 보고 legacy(이름 기반 임시 id) 행을 따로 만들면 안 된다.
  // 명부 id 로 한 줄만 나가야 다음 달에도 같은 사람으로 이어진다.
  const data = closeData({
    roster: [{ id: "emp-1", name: "홍길동", division: "정직원" }],
    history: [settle("10", [{ name: "홍길동", division: "파트타이머", workHours: 8 }])]
  });
  const rows = partTimeSheet(data).rows;
  check("급여 행 없이도 한 줄, 8시간", rows.map((r) => [r[0], r[7]]), [["홍길동", 8]]);
}
{
  // 옛 legacy 급여 행이 남아 있으면 명부 행에 흡수돼 한 줄이 된다(두 번 지급 방지).
  const data = closeData({
    roster: [{ id: "emp-1", name: "홍길동", division: "정직원" }],
    salaries: [{ employeeId: `legacy-${BRANCH}-홍길동`, name: "홍길동", hourlyRate: "15000", accountNumber: "1111" }],
    history: [settle("10", [{ name: "홍길동", division: "파트타이머", workHours: 8 }])]
  });
  const rows = partTimeSheet(data).rows;
  check("legacy 행은 흡수돼 한 줄, 계좌·급여 유지", rows.map((r) => [r[0], r[5], r[7], r[9]]), [["홍길동", "1111", 8, 120000]]);
}
{
  // 같은 구멍이 원래 파트타이머에게도 있었다 — 명부 등록 뒤 대장을 안 열어 서버엔 legacy 행뿐인 경우.
  const data = closeData({
    roster: [{ id: "emp-1", name: "홍길동", division: "파트타이머" }],
    salaries: [{ employeeId: `legacy-${BRANCH}-홍길동`, name: "홍길동", hourlyRate: "15000", accountNumber: "1111" }],
    history: [settle("10", [{ name: "홍길동", division: "파트타이머", workHours: 8 }])]
  });
  const rows = partTimeSheet(data).rows;
  check("파트타이머도 legacy 행만 있으면 흡수돼 한 줄", rows.map((r) => [r[0], r[5], r[7], r[9]]), [["홍길동", "1111", 8, 120000]]);
}
{
  // 명부에 같은 이름이 둘이면 흡수하지 않는다(누구 것인지 모른다) — 빈 행을 세워도 그 규칙은 그대로.
  const data = closeData({
    roster: [
      { id: "emp-1", name: "홍길동", division: "파트타이머" },
      { id: "emp-2", name: "홍길동", division: "파트타이머" }
    ],
    salaries: [{ employeeId: `legacy-${BRANCH}-홍길동`, name: "홍길동", hourlyRate: "15000", accountNumber: "1111" }],
    history: []
  });
  const ids = partTimeSheet(data).rows.map((r) => r[5]);
  check("동명이인이면 legacy 행이 그대로 남는다", ids.includes("1111"), true);
}
{
  // Codex 2026-10-03: 정직원과 파트타이머가 같은 이름이면 정직원을 끌어오지 않는다.
  // 끌어오면 파트타이머의 근무시간이 정직원 줄에도 붙어 같은 시간이 두 번 지급된다.
  const roster = [
    { id: "emp-1", name: "홍길동", division: "정직원" },
    { id: "emp-2", name: "홍길동", division: "파트타이머" }
  ];
  check(
    "같은 이름이 둘이면 정직원은 근거가 있어도 끌어오지 않는다",
    partTimeRosterForMonth(roster, { salaryEmployeeIds: ["emp-1"], partTimeWorkerNames: ["홍길동"] }).map((e) => e.id),
    ["emp-2"]
  );
  const data = closeData({
    roster,
    salaries: [{ employeeId: "emp-2", name: "홍길동", hourlyRate: "15000", accountNumber: "2222" }],
    history: [settle("10", [{ name: "홍길동", division: "파트타이머", workHours: 8 }])]
  });
  const paying = partTimeSheet(data).rows.filter((r) => Number(r[9]) > 0);
  check("근무시간은 파트타이머 한 줄에만 붙는다", paying.map((r) => [r[5], r[7], r[9]]), [["2222", 8, 120000]]);
}
{
  // 제외(X)한 명부 인원의 legacy 행 — 지점 화면도 그 행을 보여 주므로(대물섬 한남점 2026-08 의도된 사용) 엑셀도 그대로 낸다.
  // 이번 수정(빈 명부 행 세우기)이 이 동작을 바꾸지 않았는지 못박는다.
  const data = closeData({
    roster: [{ id: "emp-1", name: "홍길동", division: "파트타이머" }],
    exclusions: ["emp-1"],
    salaries: [{ employeeId: `legacy-${BRANCH}-홍길동`, name: "홍길동", hourlyRate: "15000", accountNumber: "1111" }],
    history: [settle("10", [{ name: "홍길동", division: "파트타이머", workHours: 8 }])]
  });
  const rows = partTimeSheet(data).rows;
  check("제외된 명부 행은 안 나가고 legacy 행 한 줄만 나간다", rows.map((r) => [r[5], r[7], r[9]]), [["1111", 8, 120000]]);
}

// ─────────────────────────────────────────────────────────────
console.log("\n[3] 0.5시간은 엑셀에서도 0.5로 보인다");
// ─────────────────────────────────────────────────────────────
{
  const data = closeData({
    roster: [
      { id: "emp-1", name: "홍길동", division: "파트타이머" },
      { id: "emp-2", name: "김민지", division: "파트타이머" }
    ],
    salaries: [
      { employeeId: "emp-1", name: "홍길동", hourlyRate: "15000" },
      { employeeId: "emp-2", name: "김민지", hourlyRate: "15000" }
    ],
    history: [
      settle("10", [
        { name: "홍길동", division: "파트타이머", workHours: 167.5 },
        { name: "김민지", division: "파트타이머", workHours: 12 }
      ])
    ]
  });
  const wb = assembleMonthlyCloseWorkbook(XLSX, data);
  const ws = wb.Sheets["파트타이머급여"];
  // 제목행(0)·헤더(1) 다음부터 사람. 누적시간은 H열(7).
  const hours1 = ws[XLSX.utils.encode_cell({ r: 2, c: 7 })];
  const hours2 = ws[XLSX.utils.encode_cell({ r: 3, c: 7 })];
  const salary1 = ws[XLSX.utils.encode_cell({ r: 2, c: 9 })];
  check("셀 값은 167.5", hours1?.v, 167.5);
  check("167.5 표시 = 167.5", XLSXCore.SSF.format(hours1?.z, hours1?.v), "167.5");
  check("정수 시간은 그대로 12", XLSXCore.SSF.format(hours2?.z, hours2?.v), "12");
  check("급여는 천 단위 쉼표", XLSXCore.SSF.format(salary1?.z, salary1?.v), "2,512,500");
}

console.log(failures === 0 ? "\n모두 통과" : `\n실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
