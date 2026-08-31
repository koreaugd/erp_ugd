/**
 * 파트타이머 급여대장 — 같은 사람이 두 줄이 되는 것을 막는 규칙 검증. (읽기 전용, 서버 접속 없음)
 *
 *   npx tsx scripts/check-parttime-dedupe.ts
 *
 * 왜 이 검증이 있나 (2026-08-31 실제 사고)
 *   근무기록에 먼저 나타난 사람은 `legacy-<지점>-<이름>` 행으로 급여대장에 오른다. 그 사람이 나중에
 *   직원명부에 등록되면 명부 id 로 새 행이 만들어지는데, **옛 legacy 행은 아무도 지우지 않았다.**
 *   저장 병합이 "서버엔 있고 화면엔 없는 행"을 다른 기기가 추가한 행으로 보고 되살려서, 칸 하나만
 *   고쳐도 유령 행이 화면에 튀어나왔다. 마감 엑셀에는 같은 사람이 두 줄로 나가 **급여가 두 번** 잡혔다
 *   (사카바단단 2026-08: 4,949,500원이어야 할 표가 6,828,000원).
 *
 * 픽스처는 전부 **합성 데이터**다. 이 저장소는 공개돼 있어 실제 주민등록번호·계좌번호를 넣으면 안 된다.
 */
import {
  absorbLegacyPartTimeRows,
  adoptFreshAutoValues,
  resolveExtraPartTimeWork,
  type PartTimeAbsorbableRow
} from "../src/pages/branch/helpers/partTimeSalaryRules";
import { buildMonthlyCloseSheetSpecs, duplicateNamePartTimeRows, type MonthlyCloseData } from "../src/pages/branch/helpers/monthlyCloseWorkbook";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log(`  OK   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}\n         기대: ${e}\n         실제: ${a}`);
}

const BRANCH = "테스트지점";

/** 급여대장 행 한 줄. 필요한 칸만 채우고 나머지는 기본값. */
const row = (over: Partial<PartTimeAbsorbableRow> & { employeeId: string; name: string }): PartTimeAbsorbableRow => ({
  rosterName: over.name,
  residentNumber: "",
  entryDate: "",
  contractStatus: "미작성",
  bank: "",
  accountNumber: "",
  hourlyRate: "",
  accumulatedHours: "0",
  tipsEtcAmount: "0",
  calculatedSalary: "0",
  attendanceDates: "",
  actualPaidAmount: "",
  payoutBranch: BRANCH,
  memo: "",
  ...over
});

// ─────────────────────────────────────────────────────────────
console.log("\n[1] 고아 legacy 행 흡수 (화면·저장본)");
// ─────────────────────────────────────────────────────────────
{
  // 근무기록에만 있던 사람이 나중에 명부에 등록된 상태. legacy 행에는 사람이 적어 둔 계좌가 들어 있다.
  const rows = [
    row({ employeeId: `legacy-${BRANCH}-홍길동`, name: "홍길동", bank: "가나은행", accountNumber: "1111", accumulatedHours: "10" }),
    row({ employeeId: "emp-1", name: "홍길동", hourlyRate: "15000", accumulatedHours: "20" })
  ];
  const out = absorbLegacyPartTimeRows(rows, { branchName: BRANCH, rosterNames: ["홍길동"], excludedIds: [] });
  check("legacy 행이 사라지고 한 줄만 남는다", out.map((r) => r.employeeId), ["emp-1"]);
  check("legacy 행에 적혀 있던 계좌가 명부 행으로 옮겨진다", [out[0].bank, out[0].accountNumber], ["가나은행", "1111"]);
  check("명부 행이 이미 가진 값은 legacy 값으로 덮이지 않는다", out[0].hourlyRate, "15000");
  check("누적시간은 명부 행 값 그대로 — 흡수가 자동값을 건드리지 않는다", out[0].accumulatedHours, "20");
}
{
  // 흡수로 시급·팁이 채워지면 **급여도 그 값으로 다시 계산돼야 한다.**
  // 계산을 빼먹으면 시급은 들어왔는데 급여가 0원인 행이 그대로 확정·이체로 나간다.
  const rows = [
    row({ employeeId: `legacy-${BRANCH}-홍길동`, name: "홍길동", hourlyRate: "15000", tipsEtcAmount: "5000" }),
    row({ employeeId: "emp-1", name: "홍길동", accumulatedHours: "20", calculatedSalary: "0", actualPaidAmount: "0" })
  ];
  const out = absorbLegacyPartTimeRows(rows, { branchName: BRANCH, rosterNames: ["홍길동"], excludedIds: [] });
  check("흡수로 들어온 시급으로 급여를 다시 계산한다", [out[0].hourlyRate, out[0].calculatedSalary], ["15000", "300000"]);
  check("실수령액도 그 급여를 따라간다", out[0].actualPaidAmount, "300000");
  // 팁 0 은 '안 적음'인지 '없다고 적음'인지 구분할 수 없다. 덮으면 없는 팁이 급여에 붙어 더 나간다.
  check("팁 0 은 legacy 값으로 덮지 않는다", out[0].tipsEtcAmount, "0");
}
{
  // 사람이 직접 적은 근무시간·출근일은 집계로 다시 만들 수 없다. 흡수하며 버리면 그대로 사라진다.
  const rows = [
    row({ employeeId: `legacy-${BRANCH}-홍길동`, name: "홍길동", accumulatedHours: "12", hoursOverridden: true, attendanceDates: "3,4", attendanceOverridden: true, hourlyRate: "15000" }),
    row({ employeeId: "emp-1", name: "홍길동", accumulatedHours: "5" })
  ];
  const out = absorbLegacyPartTimeRows(rows, { branchName: BRANCH, rosterNames: ["홍길동"], excludedIds: [] });
  check("직접 적은 근무시간은 흡수 때 함께 옮긴다", [out[0].accumulatedHours, out[0].hoursOverridden], ["12", true]);
  check("직접 적은 출근일도 함께 옮긴다", [out[0].attendanceDates, out[0].attendanceOverridden], ["3,4", true]);
  check("옮겨 온 시간으로 급여가 다시 계산된다", out[0].calculatedSalary, "180000");
}
{
  // 명부 행이 이미 직접 적은 값을 갖고 있으면 그쪽이 이긴다(나중에 적은 값이 더 맞다).
  const rows = [
    row({ employeeId: `legacy-${BRANCH}-홍길동`, name: "홍길동", accumulatedHours: "12", hoursOverridden: true }),
    row({ employeeId: "emp-1", name: "홍길동", accumulatedHours: "7", hoursOverridden: true, hourlyRate: "15000" })
  ];
  const out = absorbLegacyPartTimeRows(rows, { branchName: BRANCH, rosterNames: ["홍길동"], excludedIds: [] });
  check("명부 행이 직접 적은 값을 가졌으면 그대로 둔다", out[0].accumulatedHours, "7");
}
{
  // 실수령액이 비어 있으면 비운 채로 둔다 — 본사가 채우는 칸이다(syncPartTimeActualPaid 규칙).
  const rows = [
    row({ employeeId: `legacy-${BRANCH}-홍길동`, name: "홍길동", hourlyRate: "15000" }),
    row({ employeeId: "emp-1", name: "홍길동", accumulatedHours: "10" })
  ];
  const out = absorbLegacyPartTimeRows(rows, { branchName: BRANCH, rosterNames: ["홍길동"], excludedIds: [] });
  check("빈 실수령액은 흡수 뒤에도 비워 둔다", [out[0].calculatedSalary, out[0].actualPaidAmount], ["150000", ""]);
}
{
  // 대물섬 한남점 사례: 지점이 명부 행을 X(제외)로 지우고 legacy 행으로 급여를 주고 있다.
  // 여기서 흡수하면 그 사람 급여가 통째로 사라진다 — 절대 흡수하지 않는다.
  const rows = [
    row({ employeeId: `legacy-${BRANCH}-홍길동`, name: "홍길동", bank: "가나은행", accountNumber: "1111", accumulatedHours: "10" })
  ];
  const out = absorbLegacyPartTimeRows(rows, { branchName: BRANCH, rosterNames: ["홍길동"], excludedIds: ["emp-1"] });
  check("명부 행이 제외 상태면 legacy 행을 그대로 둔다", out.map((r) => r.employeeId), [`legacy-${BRANCH}-홍길동`]);
}
{
  // 명부에 같은 이름이 둘이면 legacy 행이 **누구 것인지 알 수 없다.**
  // 아무 쪽에나 붙이면 그 사람 계좌로 남의 급여가 나간다 — 모르면 손대지 않는다.
  const rows = [
    row({ employeeId: `legacy-${BRANCH}-김민지`, name: "김민지", bank: "가나은행", accountNumber: "1111" }),
    row({ employeeId: "emp-1", name: "김민지", accountNumber: "2222" }),
    row({ employeeId: "emp-2", name: "김민지", accountNumber: "3333" })
  ];
  const out = absorbLegacyPartTimeRows(rows, { branchName: BRANCH, rosterNames: ["김민지", "김민지"], excludedIds: [] });
  check("동명이인이면 흡수하지 않는다", out.map((r) => r.employeeId), [`legacy-${BRANCH}-김민지`, "emp-1", "emp-2"]);
  check("남의 계좌가 섞이지 않는다", [out[1].accountNumber, out[2].accountNumber], ["2222", "3333"]);
}
{
  // 동명이인 중 한쪽이 제외(X)돼 있어도 마찬가지다. 남은 한 명만 후보가 된다고 해서
  // legacy 행이 그 사람 것이라는 뜻은 아니다 — 제외된 쪽 것일 수도 있다.
  const rows = [
    row({ employeeId: `legacy-${BRANCH}-김민지`, name: "김민지", accountNumber: "1111" }),
    row({ employeeId: "emp-2", name: "김민지", accountNumber: "3333" })
  ];
  const out = absorbLegacyPartTimeRows(rows, {
    branchName: BRANCH,
    rosterNames: ["김민지", "김민지"], // 명부에는 두 명이 있고 그중 emp-1 이 제외돼 목록에 없다
    excludedIds: ["emp-1"]
  });
  check("한쪽이 제외된 동명이인도 흡수하지 않는다", out.map((r) => r.employeeId), [`legacy-${BRANCH}-김민지`, "emp-2"]);
  check("제외된 동명이인 건도 계좌가 섞이지 않는다", out[1].accountNumber, "3333");
}
{
  // 아직 명부에 없는 사람 — legacy 행이 그 사람의 유일한 급여 행이다.
  const rows = [row({ employeeId: `legacy-${BRANCH}-임꺽정`, name: "임꺽정", accumulatedHours: "5" })];
  const out = absorbLegacyPartTimeRows(rows, { branchName: BRANCH, rosterNames: ["홍길동"], excludedIds: [] });
  check("이름이 명부에 없으면 legacy 행을 그대로 둔다", out.map((r) => r.employeeId), [`legacy-${BRANCH}-임꺽정`]);
}
{
  // 카츠스위스 사례: 근무기록의 '임꺽정' 행에 사람이 다른 이름(홍길동)을 적어 쓰고 있다.
  // 표시 이름으로 판정하면 명부의 홍길동에게 흡수돼 임꺽정 근무분이 통째로 사라진다.
  // legacy 행의 정체는 **id 에 박힌 이름**이다.
  const rows = [
    row({ employeeId: `legacy-${BRANCH}-임꺽정`, name: "홍길동", accumulatedHours: "109.5" }),
    row({ employeeId: "emp-1", name: "홍길동" })
  ];
  const out = absorbLegacyPartTimeRows(rows, { branchName: BRANCH, rosterNames: ["홍길동"], excludedIds: [] });
  check("이름을 고쳐 쓴 legacy 행은 흡수하지 않는다(id 기준 판정)", out.map((r) => r.employeeId), [`legacy-${BRANCH}-임꺽정`, "emp-1"]);
}
{
  const rows = [
    row({ employeeId: `legacy-${BRANCH}-홍길동`, name: "홍길동", memo: "8월 퇴사" }),
    row({ employeeId: "manual-abc", name: "홍길동", hourlyRate: "16000" })
  ];
  const out = absorbLegacyPartTimeRows(rows, { branchName: BRANCH, rosterNames: ["홍길동"], excludedIds: [] });
  check("명부 행이 없으면(수기 행만) legacy 행을 지우지 않는다", out.map((r) => r.employeeId).sort(), ["legacy-테스트지점-홍길동", "manual-abc"]);
}

// ─────────────────────────────────────────────────────────────
console.log("\n[2] 명부 밖 행에 남의 근무기록을 붙이지 않는다 (마감 엑셀)");
// ─────────────────────────────────────────────────────────────
{
  const telemetry = { 홍길동: { hours: 48.5, dates: ["3", "4"] }, 임꺽정: { hours: 109.5, dates: ["5"] } };
  check(
    "수기 행에는 근무기록을 붙이지 않는다 — 이름이 같다고 남의 시간으로 급여를 만들면 안 된다",
    resolveExtraPartTimeWork("manual-abc", BRANCH, telemetry),
    { hours: 0, dates: [] }
  );
  check(
    "legacy 행은 id 에 박힌 이름으로 근무기록을 찾는다",
    resolveExtraPartTimeWork(`legacy-${BRANCH}-임꺽정`, BRANCH, telemetry),
    { hours: 109.5, dates: ["5"] }
  );
  check(
    "다른 지점의 legacy id 는 이 지점 근무기록에 붙지 않는다",
    resolveExtraPartTimeWork("legacy-다른지점-임꺽정", BRANCH, telemetry),
    { hours: 0, dates: [] }
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[3] 마감 엑셀에 같은 이름이 두 줄로 나가면 잡아낸다");
// ─────────────────────────────────────────────────────────────
const closeData = (salaries: any[], roster: any[]): MonthlyCloseData => ({
  branchName: BRANCH,
  month: "2026-08",
  purchases: [],
  roster,
  salaries,
  exclusions: [],
  profiles: {},
  history: [],
  manualWork: []
});
{
  // 흡수가 고치지 못하는 중복 — 직원명부에 같은 이름이 두 번 등록된 경우.
  // (흡수는 legacy 행만 다룬다. 명부 행끼리 겹치면 사람이 정리해야 하므로 게이트가 막아야 한다.)
  const data = closeData(
    [
      { employeeId: "emp-1", name: "홍길동", hourlyRate: "15000", accumulatedHours: "10", hoursOverridden: true },
      { employeeId: "emp-2", name: "홍길동", hourlyRate: "15000", accumulatedHours: "10", hoursOverridden: true }
    ],
    [
      { id: "emp-1", name: "홍길동", division: "파트타이머" },
      { id: "emp-2", name: "홍길동", division: "파트타이머" }
    ]
  );
  const dups = duplicateNamePartTimeRows(data);
  check("같은 이름 두 줄을 찾아낸다", dups.map((d) => d.name), ["홍길동"]);
  check("둘 다 급여가 있으면 이중지급으로 본다", dups.map((d) => d.payingRows), [2]);
  check("중복으로 더 나가는 금액을 알려 준다", dups.map((d) => d.duplicatedAmount), [150000]);
}
{
  // 흡수가 실제로 이중지급을 없앤다 — 사카바단단 2026-08 이 이 모양이었다.
  const data = closeData(
    [
      { employeeId: "emp-1", name: "홍길동", hourlyRate: "15000", accumulatedHours: "10", hoursOverridden: true, bank: "가나은행", accountNumber: "1111" },
      { employeeId: `legacy-${BRANCH}-홍길동`, name: "홍길동", hourlyRate: "15000", accumulatedHours: "10", hoursOverridden: true }
    ],
    [{ id: "emp-1", name: "홍길동", division: "파트타이머" }]
  );
  check("흡수된 뒤에는 중복이 없다", duplicateNamePartTimeRows(data), []);
  const sheet = buildMonthlyCloseSheetSpecs(data).find((s) => s.name === "파트타이머급여")!;
  check("엑셀에도 한 줄만 나간다", sheet.rows.map((r) => [r[0], r[9]]), [["홍길동", 150000]]);
  check("명부 행의 계좌는 그대로 살아 있다", sheet.rows[0][5], "1111");
}
{
  // 동명이인 — 계좌가 서로 다르면 다른 사람이라는 증거다. 막으면 정당한 마감이 통째로 멈춘다.
  const data = closeData(
    [
      { employeeId: "emp-1", name: "김민지", accountNumber: "1111", hourlyRate: "15000", accumulatedHours: "10", hoursOverridden: true },
      { employeeId: "emp-2", name: "김민지", accountNumber: "2222", hourlyRate: "15000", accumulatedHours: "10", hoursOverridden: true }
    ],
    [
      { id: "emp-1", name: "김민지", division: "파트타이머" },
      { id: "emp-2", name: "김민지", division: "파트타이머" }
    ]
  );
  const dups = duplicateNamePartTimeRows(data);
  check("계좌가 서로 다르면 동명이인으로 본다", dups.map((d) => d.provenDistinct), [true]);
}
{
  // 계좌까지 같으면 같은 사람에게 두 번 나간다 — 확실한 이중지급.
  const data = closeData(
    [
      { employeeId: "emp-1", name: "김민지", accountNumber: "1111", hourlyRate: "15000", accumulatedHours: "10", hoursOverridden: true },
      { employeeId: "emp-2", name: "김민지", accountNumber: "1111", hourlyRate: "15000", accumulatedHours: "10", hoursOverridden: true }
    ],
    [
      { id: "emp-1", name: "김민지", division: "파트타이머" },
      { id: "emp-2", name: "김민지", division: "파트타이머" }
    ]
  );
  check("계좌가 같으면 이중지급으로 본다", duplicateNamePartTimeRows(data).map((d) => d.provenDistinct), [false]);
}
{
  // 한쪽 계좌가 비어 있으면 다른 사람이라고 증명할 수 없다 — 막는 쪽이 안전하다.
  const data = closeData(
    [
      { employeeId: "emp-1", name: "김민지", accountNumber: "1111", hourlyRate: "15000", accumulatedHours: "10", hoursOverridden: true },
      { employeeId: "emp-2", name: "김민지", hourlyRate: "15000", accumulatedHours: "10", hoursOverridden: true }
    ],
    [
      { id: "emp-1", name: "김민지", division: "파트타이머" },
      { id: "emp-2", name: "김민지", division: "파트타이머" }
    ]
  );
  check("계좌를 모르면 동명이인이라고 단정하지 않는다", duplicateNamePartTimeRows(data).map((d) => d.provenDistinct), [false]);
}
{
  // 한쪽이 0원이면 돈이 두 번 나가지는 않는다 — 차단이 아니라 알림 대상.
  const data = closeData(
    [
      { employeeId: "emp-1", name: "홍길동", hourlyRate: "15000", accumulatedHours: "10", hoursOverridden: true },
      { employeeId: "manual-abc", name: "홍길동", hourlyRate: "16000", accumulatedHours: "0", hoursOverridden: true }
    ],
    [{ id: "emp-1", name: "홍길동", division: "파트타이머" }]
  );
  const dups = duplicateNamePartTimeRows(data);
  check("0원 행이 낀 중복도 찾아내되", dups.map((d) => d.name), ["홍길동"]);
  check("급여가 나가는 줄은 하나뿐이라고 알려 준다", dups.map((d) => d.payingRows), [1]);
}
{
  const data = closeData(
    [{ employeeId: "emp-1", name: "홍길동", hourlyRate: "15000", accumulatedHours: "10", hoursOverridden: true }],
    [{ id: "emp-1", name: "홍길동", division: "파트타이머" }]
  );
  check("중복이 없으면 빈 목록", duplicateNamePartTimeRows(data), []);
}
{
  // 수기 행 이름이 명부 인원과 같아도, 엑셀이 그 사람 근무기록을 끌어와 급여를 만들면 안 된다.
  const data: MonthlyCloseData = {
    ...closeData(
      [
        { employeeId: "emp-1", name: "홍길동", hourlyRate: "15000" },
        { employeeId: "manual-abc", name: "홍길동", hourlyRate: "16000" }
      ],
      [{ id: "emp-1", name: "홍길동", division: "파트타이머" }]
    ),
    manualWork: [{ staffName: "홍길동", settleDate: "2026-08-03", workHours: 10 }]
  };
  const sheet = buildMonthlyCloseSheetSpecs(data).find((s) => s.name === "파트타이머급여")!;
  const rows = sheet.rows.filter((r) => String(r[0]) === "홍길동");
  check("명부 행은 근무기록대로 계산된다", [rows[0][7], rows[0][9]], [10, 150000]);
  check("수기 행은 0시간·0원 — 남의 근무기록이 붙지 않는다", [rows[1][7], rows[1][9]], [0, 0]);
}

// ─────────────────────────────────────────────────────────────
console.log("\n[4] 서버의 낡은 자동값이 화면 집계를 덮지 않는다");
// ─────────────────────────────────────────────────────────────
{
  // 서버 사본은 20일에 저장돼 0시간으로 굳어 있고, 화면은 방금 48.5시간으로 집계했다.
  // 사람이 직접 정한 값이 아니면 자동값은 언제나 지금 집계를 따른다.
  const local = row({ employeeId: "emp-1", name: "홍길동", hourlyRate: "15000", accumulatedHours: "48.5", autoAccumulatedHours: "48.5", attendanceDates: "3,4", calculatedSalary: "727500" });
  const server = row({ employeeId: "emp-1", name: "홍길동", hourlyRate: "15000", accumulatedHours: "0", attendanceDates: "", calculatedSalary: "0" });
  const out = adoptFreshAutoValues(server, local);
  check("누적시간은 화면 집계를 쓴다", out.accumulatedHours, "48.5");
  check("출근일도 화면 집계를 쓴다", out.attendanceDates, "3,4");
  check("급여도 그 시간으로 다시 계산된다", out.calculatedSalary, "727500");
}
{
  const local = row({ employeeId: "emp-1", name: "홍길동", hourlyRate: "15000", accumulatedHours: "48.5", autoAccumulatedHours: "48.5" });
  const server = row({ employeeId: "emp-1", name: "홍길동", hourlyRate: "15000", accumulatedHours: "0", hoursOverridden: true });
  const out = adoptFreshAutoValues(server, local);
  check("사람이 직접 0시간이라고 적었으면 그 값을 지킨다", [out.accumulatedHours, out.hoursOverridden], ["0", true]);
}
{
  // 집계를 한 적이 없는 행(autoAccumulatedHours 가 없음)은 근거가 없다. 그 값으로 서버를 깎으면
  // 다른 기기가 올려 둔 근무시간이 줄어든다 — 근거가 없으면 서버 값을 그대로 둔다.
  const local = row({ employeeId: "emp-1", name: "홍길동", hourlyRate: "15000", accumulatedHours: "5" });
  delete (local as any).autoAccumulatedHours;
  const server = row({ employeeId: "emp-1", name: "홍길동", hourlyRate: "15000", accumulatedHours: "10", autoAccumulatedHours: "10", calculatedSalary: "150000" });
  const out = adoptFreshAutoValues(server, local);
  check("집계 근거가 없는 화면 값으로는 서버 시간을 깎지 않는다", out.accumulatedHours, "10");
}

console.log(failures === 0 ? "\n전부 통과" : `\n실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
