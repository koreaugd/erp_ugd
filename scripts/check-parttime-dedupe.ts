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
import { readFileSync } from "node:fs";
import {
  absorbLegacyPartTimeRows,
  adoptFreshAutoValues,
  dedupePartTimeRowsById,
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


// ─────────────────────────────────────────────────────────────
console.log("\n[5] 같은 행이 두 번 들어와도 한 줄로만 남는다");
// ─────────────────────────────────────────────────────────────
{
  // 실제 사고(대물섬 종로점 2026-09-02): 화면이 명단을 만들 때
  //   [근무기록으로 다시 만든 행] + [화면에 있던 행 중 살려 둘 행]
  // 을 이어 붙이는데, 근무기록에서 온 legacy 행은 **양쪽에 같은 id 로** 들어 있다.
  // 명부에 등록된 사람은 아래 흡수가 한 줄로 접어 주지만, 명부에 없는 사람은 접을 곳이 없어
  // 두 줄이 그대로 남았다(이준오·김재린 …). 이어 붙이는 자리가 여러 곳이라 여기 한 곳에서 막는다.
  const rebuilt = [
    row({ employeeId: "emp-1", name: "엄희민", hourlyRate: "15000", accumulatedHours: "81" }),
    // 방금 집계한 행 — 이번 달 근무 7시간이 반영돼 있다.
    row({ employeeId: `legacy-${BRANCH}-이준오`, name: "이준오", hourlyRate: "12000", accumulatedHours: "7", calculatedSalary: "84000" })
  ];
  const kept = [
    // 화면에 있던 옛 행 — 대장을 마지막으로 연 시점의 0시간에서 굳어 있다. 이 행이 남으면 급여가 사라진다.
    row({ employeeId: `legacy-${BRANCH}-이준오`, name: "이준오", hourlyRate: "12000", accumulatedHours: "0", calculatedSalary: "0" })
  ];
  const out = absorbLegacyPartTimeRows([...rebuilt, ...kept], { branchName: BRANCH, rosterNames: ["엄희민"], excludedIds: [] });
  check("명부에 없는 사람도 한 줄만 남는다", out.map((r) => r.employeeId), ["emp-1", `legacy-${BRANCH}-이준오`]);
  check("남는 것은 앞의 행 — 방금 집계한 값이다", [out[1].accumulatedHours, out[1].calculatedSalary], ["7", "84000"]);
}
{
  // 명부 행이 두 번 들어오면 "명부엔 한 명인데 급여 행이 둘"로 읽혀 흡수가 통째로 멈춘다.
  // 같은 id 는 같은 행이다 — 먼저 한 줄로 접은 뒤에 판정해야 흡수가 살아 있다.
  const rows = [
    row({ employeeId: "emp-1", name: "홍길동", accumulatedHours: "20" }),
    row({ employeeId: "emp-1", name: "홍길동", accumulatedHours: "20" }),
    row({ employeeId: `legacy-${BRANCH}-홍길동`, name: "홍길동", bank: "가나은행", accountNumber: "1111", hourlyRate: "15000" })
  ];
  const out = absorbLegacyPartTimeRows(rows, { branchName: BRANCH, rosterNames: ["홍길동"], excludedIds: [] });
  check("같은 id 가 겹쳐도 흡수는 그대로 된다", out.map((r) => r.employeeId), ["emp-1"]);
  check("겹친 채로도 legacy 계좌·시급이 옮겨진다", [out[0].bank, out[0].accountNumber, out[0].calculatedSalary], ["가나은행", "1111", "300000"]);
}
{
  // id 가 다르면 이름이 같아도 다른 행이다 — 동명이인·수기 행을 함부로 지우면 그 사람 급여가 사라진다.
  // (이름이 겹치는 것은 마감 게이트 duplicateNamePartTimeRows 가 사람에게 알려 정리하게 한다.)
  const rows = [
    row({ employeeId: `legacy-${BRANCH}-홍길동`, name: "홍길동", hourlyRate: "15000", accumulatedHours: "10" }),
    row({ employeeId: "manual-abc", name: "홍길동", hourlyRate: "16000", accumulatedHours: "5" })
  ];
  const out = absorbLegacyPartTimeRows(rows, { branchName: BRANCH, rosterNames: [], excludedIds: [] });
  check("id 가 다르면 이름이 같아도 지우지 않는다", out.map((r) => r.employeeId), [`legacy-${BRANCH}-홍길동`, "manual-abc"]);
}
{
  // id 가 비어 있는 행은 옛 저장본에 있을 수 있다. 그것끼리 한 줄로 접으면 남의 급여가 통째로 사라진다.
  // "같은 id" 로 묶을 수 있는 것은 id 가 실제로 적힌 행뿐이다.
  const rows = [
    row({ employeeId: "", name: "홍길동", hourlyRate: "15000", accumulatedHours: "10" }),
    row({ employeeId: "", name: "김철수", hourlyRate: "15000", accumulatedHours: "5" })
  ];
  const out = absorbLegacyPartTimeRows(rows, { branchName: BRANCH, rosterNames: [], excludedIds: [] });
  check("id 가 빈 행은 서로 다른 행으로 둔다", out.map((r) => r.name), ["홍길동", "김철수"]);
}

// ─────────────────────────────────────────────────────────────
console.log("\n[6] 맵을 만들기 전에 접는다 (뒤의 옛 행이 이기지 않게)");
// ─────────────────────────────────────────────────────────────
{
  // 저장 병합(mergePendingLocalRows)·복원 병합(mergeKeepingManualRows)은 행 배열로 Map 을 만든다.
  // 같은 id 가 두 번 들어 있으면 **JavaScript Map 은 뒤의 것을 남긴다.** 사본은
  // [방금 집계한 행, 화면에 있던 옛 행] 순서라, 접지 않고 맵을 만들면 옛 행이 이겨 그 사람 급여가
  // 옛 값으로 굳은 채 서버로 올라간다(Codex 지독한리뷰 2026-09-02).
  const id = `legacy-${BRANCH}-이준오`;
  const fresh = row({ employeeId: id, name: "이준오", hourlyRate: "12000", accumulatedHours: "7", calculatedSalary: "84000" });
  const stale = row({ employeeId: id, name: "이준오", hourlyRate: "12000", accumulatedHours: "0", calculatedSalary: "0" });

  const naive = new Map([fresh, stale].map((r) => [r.employeeId, r]));
  check("접지 않고 맵을 만들면 옛 행이 이긴다 (그래서 접어야 한다)", naive.get(id)!.accumulatedHours, "0");

  const safe = new Map(dedupePartTimeRowsById([fresh, stale]).map((r) => [r.employeeId, r]));
  check("접고 만든 맵에는 방금 집계한 행이 남는다", [safe.get(id)!.accumulatedHours, safe.get(id)!.calculatedSalary], ["7", "84000"]);
}
{
  // 위 규칙이 화면 코드에 **실제로 배선돼 있는지** 소스에서 확인한다.
  // (두 병합 함수는 화면 모듈 안에 있어 여기서 직접 부를 수 없다.)
  //
  // 규칙: 행 배열로 Map 을 만드는 자리에서 그 배열 변수는 **접기를 거쳐 만들어진 변수여야 한다.**
  // 문자열 몇 개를 찾는 식으로는 `new Map<string, Row>(current.map(...))` 같은 형태를 놓친다 —
  // 실제로 첫 판이 그렇게 짜여 아무것도 못 보는 검사였다(Codex 2R 지적 2026-09-02).
  const scanRowMapSites = (src: string): { examined: number; unsafe: string[] } => {
    const sites: string[] = [];
    let examined = 0;
    const mapStart = /new Map\s*(?:<[^>]*>)?\s*\(/g;
    let hit: RegExpExecArray | null;
    while ((hit = mapStart.exec(src)) !== null) {
      // 맵을 만드는 표현의 앞머리만 본다. 여러 줄에 걸쳐 있어도 이 길이면 `.map(... employeeId ...)` 까지 들어온다.
      const head = src.slice(hit.index, hit.index + 300);
      // 행 배열로 만드는 맵만 대상 — 키가 employeeId 인 맵이다(다른 용도의 맵은 접을 이유가 없다).
      if (!head.includes(".map(") || !head.includes("employeeId")) continue;
      examined++; // 이 자리를 실제로 봤다는 기록 — 하나도 못 보고 통과하는 검사를 막는다.
      // 맵에 **무엇을 넣는지**만 본다. "어딘가에 접기 호출이 보이면 통과"로 두면
      // `new Map((flag ? dedupePartTimeRowsById(rows) : rows).map(...))` 가 그대로 빠져나간다(Codex 5R 2026-09-02).
      const operand = head.replace(/^new Map\s*(?:<[^>]*>)?\s*\(\s*/, "");
      if (/^dedupePartTimeRowsById\s*(?:<[^>]*>)?\s*\(/.test(operand)) continue; // 그 자리에서 곧바로 접었다
      // `x.map(` 과 `(x as Row[]).map(` 양쪽에서 변수 이름을 꺼낸다.
      const name = operand.match(/^\(?\s*([A-Za-z_$][\w$]*)/)?.[1] ?? "(식)";
      // 그 변수가 **언제나** 접기 결과인가. 선언이 곧바로 `= dedupePartTimeRowsById(` 이어야 하고,
      // 그 뒤에 다른 값으로 다시 대입되지 않아야 한다. "선언문 어딘가에 접기가 있으면 통과"로 두면
      // `cond ? dedupePartTimeRowsById(x) : x` 같은 형태가 그대로 빠져나간다(Codex 4R 2026-09-02).
      const declaredByDedupe =
        name !== "(식)" &&
        // 정규식은 String.raw 로 쓴다 — 그냥 템플릿 리터럴에 넣으면 \b 가 **백스페이스 문자**가 되어
        // 탐지기가 조용히 죽는다(같은 실수를 이미 한 번 했다). 아래 자기검증이 그것을 잡아 준다.
        new RegExp(String.raw`\b(?:const|let)\s+` + name + String.raw`\s*(?::[^=;]*)?=\s*dedupePartTimeRowsById\s*(?:<[^>]*>)?\s*\(`).test(src);
      // 다시 대입되면 그 뒤로는 접힌 값이라는 보장이 없다. 대입은 선언 한 번뿐이어야 한다.
      const assignments = (src.match(new RegExp(String.raw`\b` + name + String.raw`\s*=(?!=)`, "g")) || []).length;
      const madeByDedupe = declaredByDedupe && assignments === 1;
      if (!madeByDedupe) sites.push(name);
    }
    return { examined, unsafe: sites };
  };

  // **탐지기 자기검증** — 통과하는데 아무것도 안 보는 검사는 없는 것보다 나쁘다.
  // 위반 사례를 일부러 넣어, 탐지기가 그것을 실제로 잡는지 먼저 확인한다.
  const unsafeTyped = `
    const current = props.rows;
    const currentById = new Map<string, PartTimeSalaryRow>(current.map((row) => [row.employeeId, row]));
  `;
  // 괄호·타입단언·줄바꿈이 섞인 형태. 첫 판 탐지기가 이것을 놓쳐 실제 결함이 살아남았다(Codex 3R 2026-09-02).
  const unsafeCast = `
    const baselineById = new Map<string, PartTimeSalaryRow>(
      (pendingSalaries as PartTimeSalaryRow[]).map((row) => [row.employeeId, row])
    );
  `;
  const safeVar = `
    const currentRows = dedupePartTimeRowsById(props.rows);
    const currentById = new Map<string, PartTimeSalaryRow>(currentRows.map((row) => [row.employeeId, row]));
  `;
  const safeInline = `
    const byId = new Map<string, PartTimeSalaryRow>(dedupePartTimeRowsById(current).map((row) => [row.employeeId, row]));
  `;
  check("탐지기가 접지 않은 맵 생성을 잡아낸다", scanRowMapSites(unsafeTyped).unsafe, ["current"]);
  check("탐지기가 괄호·타입단언·여러 줄 형태도 잡아낸다", scanRowMapSites(unsafeCast).unsafe, ["pendingSalaries"]);
  // 조건부로만 접힌 변수는 접힌 것이 아니다 — false 쪽이 곧 last-wins 경로다(Codex 4R 2026-09-02).
  const unsafeTernary = `
    const rows = shouldDedupe ? dedupePartTimeRowsById(pendingSalaries) : pendingSalaries;
    const byId = new Map<string, PartTimeSalaryRow>(rows.map((row) => [row.employeeId, row]));
  `;
  // 접은 뒤에 다시 원본을 대입하면 그때부터 접힌 값이 아니다.
  const unsafeReassign = `
    let rows = dedupePartTimeRowsById(pendingSalaries);
    rows = pendingSalaries;
    const byId = new Map<string, PartTimeSalaryRow>(rows.map((row) => [row.employeeId, row]));
  `;
  // 접기를 거치지 않은 별칭.
  const unsafeAlias = `
    const rows = pendingSalaries;
    const byId = new Map<string, PartTimeSalaryRow>(rows.map((row) => [row.employeeId, row]));
  `;
  // 그 자리에서 조건부로만 접는 형태도 마찬가지다 — false 쪽이 곧 last-wins 경로다.
  const unsafeInlineTernary = `
    const byId = new Map<string, PartTimeSalaryRow>((flag ? dedupePartTimeRowsById(rows) : rows).map((row) => [row.employeeId, row]));
  `;
  check("탐지기가 그 자리에서 조건부로 접는 형태를 잡아낸다", scanRowMapSites(unsafeInlineTernary).unsafe, ["flag"]);
  check("탐지기가 조건부로만 접힌 변수를 잡아낸다", scanRowMapSites(unsafeTernary).unsafe, ["rows"]);
  check("탐지기가 접은 뒤 다시 대입된 변수를 잡아낸다", scanRowMapSites(unsafeReassign).unsafe, ["rows"]);
  check("탐지기가 접지 않은 별칭을 잡아낸다", scanRowMapSites(unsafeAlias).unsafe, ["rows"]);
  check("탐지기가 접어서 만든 변수는 통과시킨다", scanRowMapSites(safeVar).unsafe, []);
  check("탐지기가 그 자리에서 접은 형태도 통과시킨다", scanRowMapSites(safeInline).unsafe, []);

  const source = readFileSync(new URL("../src/pages/branch/tabs/MonthlyPartTimeSalarySubTab.tsx", import.meta.url), "utf-8");
  check("탐지기가 화면 소스를 실제로 읽었다", source.includes("mergePendingLocalRows"), true);
  const scanned = scanRowMapSites(source);
  // 아무 자리도 못 보고 통과하는 검사를 막는다 — 화면 코드에는 행으로 만드는 맵이 여러 개 있다.
  check("탐지기가 화면 소스의 행-맵 자리를 실제로 셌다", scanned.examined >= 6, true);
  check("행 배열로 맵을 만드는 자리는 모두 접기를 거친다", scanned.unsafe, []);
}

console.log(failures === 0 ? "\n전부 통과" : `\n실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
