/**
 * 정직원 급여대장 — 행 병합·전월 이어받기·순서·자동저장 규칙 검증. (읽기 전용, 서버 접속 없음)
 *
 *   npx tsx scripts/check-fulltime-salary.ts
 *
 * 왜 이 검증이 있나 (2026-09-20 개편 + Codex 지독한리뷰 15라운드)
 *   이 화면은 주민등록번호·계좌번호·급여를 한 표에 담는다. 아래 여섯 가지는 전부 "화면은 멀쩡해 보이는데
 *   돈이나 개인정보가 엉뚱한 사람에게 가는" 종류라, 눈으로는 잡히지 않아 규칙으로 못 박아 둔다.
 *
 *     1) 동명이인을 이름만으로 엮어 **한 사람의 계좌·주민등록번호가 다른 사람에게 복사**되던 경로
 *     2) 퇴사 → 같은 이름 신규입사 시, 옛 급여 행이 **신입의 직원번호·주민등록번호를 뒤집어쓰던** 경로
 *     3) 직원현황에 같은 직원 id 가 중복 등록되면 급여 행이 **두 줄**이 되던 문제
 *     4) 서버 읽기 실패를 '이 달을 처음 여는 것'으로 오인해 **지점이 맞춘 순서를 덮어쓰던** 문제
 *     5) 자동저장이 요청을 각각 독립으로 쏴서, 느린 옛 요청이 나중에 도착하면 **서버에 옛 배열이 최종본**으로
 *        남던 문제 (▲▼ 연타가 정확히 이 패턴이다)
 *     6) 그 직렬화가 달 경계를 넘어, 옛 달 요청이 끝나면서 **새 달 급여를 옛 달 문서에 저장**할 수 있던 문제
 *
 *   5·6 은 화면 컴포넌트 안의 ref 로 동작해 순수 함수로 꺼낼 수 없다. 그래서 (a) 알고리즘을 같은 구조로
 *   시뮬레이션해 성질을 확인하고, (b) **실제 소스에 그 방어가 아직 붙어 있는지** 따로 훑는다.
 *   시뮬레이션만 두면 소스에서 방어가 사라져도 검사는 통과한다 — 통과하는데 아무것도 안 보는 검사는
 *   없는 것보다 나쁘다.
 *
 * 픽스처는 전부 **합성 데이터**다. 이 저장소는 공개돼 있어 실제 주민등록번호·계좌번호를 넣으면 안 된다.
 */
import { readFileSync } from "node:fs";
import {
  CARRY_OVER_FIELDS,
  applyPreviousMonthCarryover,
  mayBeFirstOpenOfMonth,
  mergeRows,
  moveRow,
  needsPreviousMonth,
  type FullTimeSalaryRow,
} from "../src/pages/branch/helpers/fullTimeSalaryMerge";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log(`  OK   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}\n         기대: ${e}\n         실제: ${a}`);
}
const section = (title: string) => console.log(`\n${title}`);

/** 직원현황(로스터) 한 명. */
const emp = (id: string, name: string, more: Record<string, unknown> = {}) =>
  ({ id, name, division: "정직원", ...more });

/** 급여대장 행 한 줄. 필요한 칸만 채우고 나머지는 빈 문자열. */
const row = (over: Partial<FullTimeSalaryRow> & { name?: string }): FullTimeSalaryRow => ({
  id: over.id ?? `ft_${over.employeeId ?? over.name}`,
  name: "", rank: "", residentNumber: "", entryDate: "", contractType: "", bank: "",
  accountNumber: "", prevSalary: "", thisSalary: "", taxiEtc: "", bonusTip: "",
  overtimePay: "", overtimeHours: "", overtimeRate: "", remitBranch: "", memo: "",
  ...over,
} as FullTimeSalaryRow);

const names = (rows: FullTimeSalaryRow[]) => rows.map((r) => r.name);

// ─────────────────────────────────────────────────────────────────────────────
section("[1] 행 병합 — 지점이 맞춘 순서를 지킨다");
{
  const roster = [emp("e1", "김가"), emp("e2", "이나"), emp("e3", "박다")];
  const saved = [row({ employeeId: "e3", name: "박다" }), row({ employeeId: "e1", name: "김가" }), row({ employeeId: "e2", name: "이나" })];
  check("저장된 순서를 그대로 유지한다", names(mergeRows(roster, saved)), ["박다", "김가", "이나"]);

  const newcomer = [emp("e9", "신입"), emp("e1", "김가"), emp("e2", "이나")]; // 직원현황엔 신입이 맨 위
  const twoSaved = [row({ employeeId: "e1", name: "김가" }), row({ employeeId: "e2", name: "이나" })];
  check("직원현황에만 있는 신규 입사자는 맨 아래", names(mergeRows(newcomer, twoSaved)), ["김가", "이나", "신입"]);
}

section("[2] 행 병합 — 저장된 행은 절대 버리지 않는다");
{
  const out = mergeRows([emp("e1", "김가")], [
    row({ id: "ft_manual_1", name: "퇴사예정", isManual: true, thisSalary: "1000000" }),
    row({ employeeId: "e1", name: "김가" }),
  ]);
  check("직원현황에 없는 사람도 남는다", names(out), ["퇴사예정", "김가"]);
  check("그 행의 급여가 보존된다", out[0].thisSalary, "1000000");
}

section("[3] 행 병합 — 행 id 는 절대 겹치지 않는다");
{
  // 같은 사람을 가리키는 저장 행 두 개(하나는 id, 하나는 이름으로 매칭된다)
  const dup = mergeRows([emp("e1", "김가")], [row({ employeeId: "e1", name: "김가" }), row({ id: "ft_dup", name: "김가", thisSalary: "500" })]);
  check("한 직원이 두 줄이어도 id 는 다르다", new Set(dup.map((r) => r.id)).size, dup.length);
  check("둘째 행의 급여도 보존된다", dup[1].thisSalary, "500");

  const sameId = mergeRows([], [row({ id: "same", name: "가" }), row({ id: "same", name: "나" })]);
  check("저장본에 중복 id 가 있어도 갈라 놓는다", new Set(sameId.map((r) => r.id)).size, 2);
}

section("[4] 행 병합 — 직원현황에 같은 직원 id 가 두 번이면 한 줄만");
{
  const out = mergeRows([emp("e1", "김가"), emp("e1", "김가"), emp("e2", "이나")], []);
  check("중복 id 는 접어서 두 사람만 나온다", names(out).sort(), ["김가", "이나"]);
  check("행 id 중복 없음", new Set(out.map((r) => r.id)).size, out.length);

  // 동명이인(id 가 다름)은 서로 **다른 사람**이라 접으면 한 명이 실제로 사라진다.
  const twins = mergeRows([emp("e1", "김가", { residentNumber: "900101-0000001" }), emp("e2", "김가", { residentNumber: "950202-0000002" })], []);
  check("동명이인은 접지 않는다(두 사람 다 나온다)", twins.length, 2);
  check("각자 다른 주민등록번호를 유지한다", twins[0].residentNumber !== twins[1].residentNumber, true);
}

section("[5] 행 병합 — 동명이인이면 이름만으로 신분을 씌우지 않는다");
{
  // 직원현황에 '김가'가 둘, 저장 행에는 직원번호가 없다 → 누구인지 가릴 수 없다.
  const roster = [emp("e1", "김가", { residentNumber: "900101-0000001" }), emp("e2", "김가", { residentNumber: "950202-0000002" })];
  const out = mergeRows(roster, [row({ id: "ft_legacy", name: "김가", thisSalary: "3000000", accountNumber: "111-222" })]);
  const legacy = out.find((r) => r.id === "ft_legacy")!;
  check("옛 행이 남의 직원번호를 뒤집어쓰지 않는다", legacy.employeeId ?? null, null);
  check("옛 행이 남의 주민등록번호를 받지 않는다", legacy.residentNumber, "");
  check("옛 행의 급여·계좌는 보존된다", [legacy.thisSalary, legacy.accountNumber], ["3000000", "111-222"]);
  check("두 직원 모두 행으로 나와 지점 눈에 띈다", out.length, 3);

  // 직원번호가 맞으면 동명이인이어도 정확히 엮인다.
  const byId = mergeRows(roster, [row({ employeeId: "e2", name: "김가", thisSalary: "3000000" })]);
  check("직원번호가 맞으면 그 사람의 주민등록번호를 받는다", byId[0].residentNumber, "950202-0000002");

  // 반대로 저장본 쪽 이름 중복은 막지 않는다 — 직원현황에 한 명뿐이면 같은 사람의 중복 행이다.
  const savedDup = mergeRows([emp("e1", "김가", { residentNumber: "900101-0000001" })], [row({ id: "s1", name: "김가", thisSalary: "3000000" }), row({ id: "s2", name: "김가" })]);
  check("저장본 쪽 이름 중복은 행을 늘리지 않는다", savedDup.length, 2);
  check("앞 행이 직원현황 정보를 받는다", savedDup[0].residentNumber, "900101-0000001");
}

section("[6] 행 병합 — 퇴사 후 같은 이름 신규입사");
{
  const roster = [emp("B", "홍길동", { residentNumber: "000101-0000003" })];   // 새로 들어온 홍길동
  const saved = [row({ employeeId: "A", name: "홍길동", thisSalary: "3000000", accountNumber: "111-222", residentNumber: "800101-0000004" })];
  const out = mergeRows(roster, saved);
  const old = out.find((r) => r.thisSalary === "3000000")!;
  check("퇴사자 행의 직원번호가 신입 것으로 바뀌지 않는다", old.employeeId, "A");
  check("퇴사자 주민등록번호가 신입 것으로 바뀌지 않는다", old.residentNumber, "800101-0000004");
  check("신입은 별도 빈 행으로 나온다", out.length, 2);
}

section("[7] 행 병합 — 직원번호 짝짓기가 이름 짝짓기보다 먼저다");
{
  // 이름만 있는 행이 앞자리에 있어도, 직원번호가 정확히 맞는 뒷 행이 임자여야 한다.
  const out = mergeRows([emp("e1", "김가", { residentNumber: "800101-0000004" })], [
    row({ id: "ft_noid", name: "김가", thisSalary: "100" }),
    row({ employeeId: "e1", name: "김가", thisSalary: "200" }),
  ]);
  check("직원번호 행이 직원현황 정보를 받는다", out.find((r) => r.thisSalary === "200")!.residentNumber, "800101-0000004");
  check("이름뿐인 행은 받지 않는다", out.find((r) => r.thisSalary === "100")!.residentNumber, "");
  check("행 수는 그대로", out.length, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
section("[8] 전월 이어받기 — 빈칸만 채우고 기존 값은 절대 안 덮는다");
{
  const cur = [row({ employeeId: "e1", name: "김가", residentNumber: "900101-0000001" })];
  const prev = [row({
    employeeId: "e1", name: "김가",
    bank: "국민은행", accountNumber: "111-222", residentNumber: "800101-0000004",
    entryDate: "2020-03-02", rank: "과장", contractType: "3.3%", overtimeRate: "12000",
    thisSalary: "3000000", taxiEtc: "50000", bonusTip: "100000", memo: "퇴사 예정", overtimeHours: "10",
  })];
  const [out] = applyPreviousMonthCarryover(cur, prev, { seedOrder: false });
  check("은행·계좌를 이어받는다", [out.bank, out.accountNumber], ["국민은행", "111-222"]);
  check("입사일·직급·근로계약·연장시급을 이어받는다", [out.entryDate, out.rank, out.contractType, out.overtimeRate], ["2020-03-02", "과장", "3.3%", "12000"]);
  check("이미 있던 주민등록번호는 덮지 않는다", out.residentNumber, "900101-0000001");
  check("전월급여 = 지난달 이달급여", out.prevSalary, "3000000");
  check("금액·기타내용은 이어받지 않는다", [out.thisSalary, out.taxiEtc, out.bonusTip, out.memo, out.overtimeHours], ["", "", "", "", ""]);
  check("이어받는 칸 목록은 7개다", CARRY_OVER_FIELDS.length, 7);
}

section("[9] 전월 이어받기 — 사람은 데려오지 않는다");
{
  const out = applyPreviousMonthCarryover(
    [row({ employeeId: "e1", name: "김가" })],
    [row({ employeeId: "e1", name: "김가" }), row({ employeeId: "e7", name: "퇴사자", thisSalary: "9999" })],
    { seedOrder: true }
  );
  check("지난달에만 있던 퇴사자는 되살아나지 않는다", names(out), ["김가"]);
}

section("[10] 전월 이어받기 — 동명이인이면 포기한다");
{
  // 이번 달에 '김가'가 둘(둘 다 직원번호 없는 수기 행), 지난달엔 한 명.
  const out = applyPreviousMonthCarryover(
    [row({ id: "m_a", name: "김가" }), row({ id: "m_b", name: "김가" })],
    [row({ id: "p1", name: "김가", bank: "국민은행", accountNumber: "111-222", residentNumber: "800101-0000004", thisSalary: "3000000" })],
    { seedOrder: false }
  );
  check("어느 행에도 계좌를 복사하지 않는다", out.map((r) => r.accountNumber), ["", ""]);
  check("주민등록번호·전월급여도 복사하지 않는다", out.map((r) => r.residentNumber + r.prevSalary), ["", ""]);

  // 지난달 쪽에 같은 이름이 둘이어도 마찬가지다.
  const [one] = applyPreviousMonthCarryover(
    [row({ id: "m_a", name: "김가" })],
    [row({ id: "p1", name: "김가", bank: "국민은행" }), row({ id: "p2", name: "김가", bank: "신한은행" })],
    { seedOrder: false }
  );
  check("지난달 쪽 동명이인도 포기한다", one.bank, "");

  // 직원번호가 있으면 동명이인이어도 정확히 엮인다.
  const byId = applyPreviousMonthCarryover(
    [row({ employeeId: "e1", name: "김가" }), row({ employeeId: "e2", name: "김가" })],
    [row({ employeeId: "e2", name: "김가", accountNumber: "222" }), row({ employeeId: "e1", name: "김가", accountNumber: "111" })],
    { seedOrder: false }
  );
  check("직원번호로는 각자 제 계좌를 받는다", byId.map((r) => r.accountNumber), ["111", "222"]);
}

section("[11] 전월 이어받기 — 지난달 한 행은 이번 달 한 행에만 쓰인다");
{
  // 저장본이 망가져 같은 직원번호가 두 행에 있는 경우
  const out = applyPreviousMonthCarryover(
    [row({ id: "a", employeeId: "e1", name: "김가" }), row({ id: "b", employeeId: "e1", name: "김가" })],
    [row({ employeeId: "e1", name: "김가", accountNumber: "111-222", thisSalary: "3000000" })],
    { seedOrder: false }
  );
  check("계좌를 물려받은 행은 하나뿐", out.filter((r) => r.accountNumber === "111-222").length, 1);
  check("전월급여를 물려받은 행도 하나뿐", out.filter((r) => r.prevSalary === "3000000").length, 1);
}

section("[12] 전월 이어받기 — 직원번호가 어긋나면 엮지 않는다");
{
  // 퇴사(A) 후 같은 이름의 신입(B). 이름이 같다고 A 의 계좌를 B 에게 주면 안 된다.
  const [out] = applyPreviousMonthCarryover(
    [row({ employeeId: "B", name: "홍길동" })],
    [row({ employeeId: "A", name: "홍길동", bank: "국민은행", accountNumber: "111-222", residentNumber: "800101-0000004", thisSalary: "3000000" })],
    { seedOrder: false }
  );
  check("남의 계좌·주민등록번호·전월급여가 넘어오지 않는다", [out.accountNumber, out.residentNumber, out.prevSalary], ["", "", ""]);

  // 정상 경로는 살아 있어야 한다 — 지난달엔 수기 행(직원번호 없음), 이번 달 명부 등록(직원번호 있음).
  const [ok] = applyPreviousMonthCarryover(
    [row({ employeeId: "e1", name: "최라" })],
    [row({ id: "ft_manual_1", name: "최라", bank: "신한은행", accountNumber: "555", thisSalary: "2500000" })],
    { seedOrder: false }
  );
  check("지난달 수기 행 → 이번 달 명부 등록은 이어받는다", [ok.bank, ok.accountNumber, ok.prevSalary], ["신한은행", "555", "2500000"]);

  // 이름이 빈 행끼리는 엮이지 않는다.
  const [blank] = applyPreviousMonthCarryover([row({ id: "b1", name: "" })], [row({ id: "p1", name: "", bank: "국민은행" })], { seedOrder: false });
  check("이름이 빈 행은 아무것도 물려받지 않는다", blank.bank, "");
}

// ─────────────────────────────────────────────────────────────────────────────
section("[13] 순서 이어받기 — 처음 여는 달에만 지난달 순서를 깐다");
{
  const cur = [row({ employeeId: "e1", name: "김가" }), row({ employeeId: "e2", name: "이나" }), row({ employeeId: "e3", name: "박다" })];
  const prev = [row({ employeeId: "e3", name: "박다" }), row({ employeeId: "e1", name: "김가" }), row({ employeeId: "e2", name: "이나" })];
  check("처음 여는 달이면 지난달 순서로 깔린다", names(applyPreviousMonthCarryover(cur, prev, { seedOrder: true })), ["박다", "김가", "이나"]);
  check("아니면 순서를 건드리지 않는다", names(applyPreviousMonthCarryover(cur, prev, { seedOrder: false })), ["김가", "이나", "박다"]);

  // 지난달에 없던 사람은 서로의 순서를 지킨 채 맨 아래로 모인다.
  const withNew = [row({ employeeId: "n1", name: "신입A" }), row({ employeeId: "e2", name: "이나" }), row({ employeeId: "n2", name: "신입B" }), row({ employeeId: "e1", name: "김가" })];
  const prev2 = [row({ employeeId: "e1", name: "김가" }), row({ employeeId: "e2", name: "이나" })];
  check("신규 입사자는 맨 아래로", names(applyPreviousMonthCarryover(withNew, prev2, { seedOrder: true })), ["김가", "이나", "신입A", "신입B"]);
}

section("[14] '이 달을 처음 여는가' 판정 — 행 0개로 판정하면 안 된다");
{
  const f = (hasPendingLocal: boolean, hasLocalEntry: boolean, remoteIsArray: boolean) =>
    mayBeFirstOpenOfMonth({ hasPendingLocal, hasLocalEntry, remoteIsArray });
  check("서버에도 이 노트북에도 아무것도 없다 → 처음", f(false, false, false), true);
  check("서버에 문서가 있다(빈 배열이어도) → 처음 아님", f(false, false, true), false);
  check("이 노트북에 기록이 있다 → 처음 아님", f(false, true, false), false);
  check("미저장 편집이 남아 있다 → 처음 아님", f(true, true, false), false);
  check("서버 읽기 실패 + 이 노트북 캐시 있음 → 처음 아님", f(false, true, false), false);
  // 1차 거름을 통과해도 호출부가 캐시 폴백 없는 서버 읽기로 '정말 없음'을 확인한 뒤에만 순서를 깐다.
  check("1차 거름만으로는 확정하지 않는다(아래 [18] 소스 검사와 짝)", f(false, false, false), true);
}

section("[15] 전월 조회가 필요한가");
{
  const full = [row({
    name: "김가", rank: "과장", residentNumber: "900101-0000001", entryDate: "2020-01-01",
    contractType: "4대보험", bank: "국민", accountNumber: "111", overtimeRate: "12000", prevSalary: "300",
  })];
  check("이어받을 빈칸이 없으면 서버를 안 부른다", needsPreviousMonth(full, false), false);
  check("처음 여는 달이면 순서 때문에 부른다", needsPreviousMonth(full, true), true);
  check("은행이 비면 부른다", needsPreviousMonth([{ ...full[0], bank: "" }], false), true);
}

section("[16] 순서 한 칸 이동");
{
  const rows = [row({ name: "가" }), row({ name: "나" }), row({ name: "다" })];
  check("아래로", names(moveRow(rows, 0, 1)), ["나", "가", "다"]);
  check("위로", names(moveRow(rows, 2, -1)), ["가", "다", "나"]);
  check("맨 위에서 ▲ 는 같은 배열(저장하지 않는다)", moveRow(rows, 0, -1) === rows, true);
  check("맨 아래에서 ▼ 도 같은 배열", moveRow(rows, 2, 1) === rows, true);
  check("원본을 바꾸지 않는다", names(rows), ["가", "나", "다"]);
}

section("[17] 통합 — 9월 순서를 맞추면 10월이 그대로 이어받는다");
{
  const roster = [emp("e1", "김가"), emp("e2", "이나"), emp("e3", "박다")];
  let sep = mergeRows(roster, []);
  check("9월 처음 = 직원현황 순서", names(sep), ["김가", "이나", "박다"]);
  sep = moveRow(sep, 2, -1);
  sep = moveRow(sep, 1, -1);
  check("지점이 박다를 맨 위로 올렸다", names(sep), ["박다", "김가", "이나"]);
  sep = sep.map((r) => ({ ...r, bank: "국민은행", accountNumber: "1234567", thisSalary: "3000000" }));

  const reopened = applyPreviousMonthCarryover(mergeRows(roster, sep), [], { seedOrder: false });
  check("9월을 다시 열어도 순서가 유지된다", names(reopened), ["박다", "김가", "이나"]);

  const oct = applyPreviousMonthCarryover(mergeRows(roster, []), sep, { seedOrder: true });
  check("10월 순서 = 9월 순서", names(oct), ["박다", "김가", "이나"]);
  check("10월이 은행·계좌를 이어받는다", oct.every((r) => r.bank === "국민은행" && r.accountNumber === "1234567"), true);
  check("10월 이달급여는 비어 있다", oct.map((r) => r.thisSalary), ["", "", ""]);
  check("10월 전월급여 = 9월 이달급여", oct.map((r) => r.prevSalary), ["3000000", "3000000", "3000000"]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 자동저장 방어는 화면 컴포넌트의 ref 로 동작해 순수 함수로 꺼낼 수 없다.
// (a) 알고리즘을 같은 구조로 돌려 성질을 확인하고, (b) 소스에 방어가 남아 있는지 훑는다.
section("[18] 자동저장 — 느린 옛 요청이 최신 배열을 덮지 않는다(알고리즘)");
{
  type Saver = { docs: Record<string, string>; save: (key: string, v: string) => Promise<void> };
  const makeServer = (lat: Record<string, number>): Saver => {
    const docs: Record<string, string> = {};
    return { docs, save: (key, v) => new Promise((res) => setTimeout(() => { docs[key] = v; res(); }, lat[v] ?? 5)) };
  };
  // 구현과 같은 구조: 대기열에 '마지막 값 하나' + 그 값이 속한 달(key), 보내는 중이면 기다렸다 이어보낸다.
  const runner = (sv: Saver, guardByKey: boolean) => {
    let sending = false;
    let queued: { v: string; key: string } | null = null;
    const makePump = (sharedKey: string) => {
      const pump = (): void => {
        if (sending) return;
        const job = queued; if (!job) return;
        if (guardByKey && job.key !== sharedKey) return;
        queued = null; sending = true;
        void sv.save(guardByKey ? job.key : sharedKey, job.v)
          .finally(() => { sending = false; if (queued) pump(); });
      };
      return pump;
    };
    return {
      persist: (v: string, key: string) => { queued = { v, key }; },
      makePump,
      idle: async () => { for (let i = 0; i < 80 && (sending || queued); i++) await new Promise((r) => setTimeout(r, 10)); },
    };
  };

  await (async () => {
    const K = "salary:2026-09";
    // 직렬화가 없으면 느린 옛 요청이 나중에 도착해 옛 값이 남는다(재현).
    const bad = makeServer({ 순서A: 200, "순서B(최신)": 5 });
    await Promise.all([bad.save(K, "순서A"), bad.save(K, "순서B(최신)")]);
    check("직렬화가 없으면 옛 값이 서버에 남는다(재현)", bad.docs[K], "순서A");

    const good = makeServer({ 순서A: 200, "순서B(최신)": 5 });
    const g = runner(good, true); const pump = g.makePump(K);
    g.persist("순서A", K); pump();
    await new Promise((r) => setTimeout(r, 20));
    g.persist("순서B(최신)", K);
    await g.idle();
    check("직렬화하면 최신 값이 남는다", good.docs[K], "순서B(최신)");
  })();
}

section("[19] 자동저장 — 달 경계를 넘어 오염되지 않는다(알고리즘)");
{
  const A = "salary:2026-08", B = "salary:2026-09";
  const makeServer = (lat: Record<string, number>) => {
    const docs: Record<string, string> = {};
    return { docs, save: (key: string, v: string) => new Promise<void>((res) => setTimeout(() => { docs[key] = v; res(); }, lat[v] ?? 5)) };
  };
  const run = async (guardByKey: boolean) => {
    const sv = makeServer({ "8월값": 200, "9월값": 5 });
    let sending = false;
    let queued: { v: string; key: string } | null = null;
    const makePump = (sharedKey: string) => {
      const pump = (): void => {
        if (sending) return;
        const job = queued; if (!job) return;
        if (guardByKey && job.key !== sharedKey) return;
        queued = null; sending = true;
        void sv.save(guardByKey ? job.key : sharedKey, job.v).finally(() => { sending = false; if (queued) pump(); });
      };
      return pump;
    };
    const pumpA = makePump(A);              // 8월 화면의 클로저
    queued = { v: "8월값", key: A }; pumpA(); // 8월 저장 시작(느림)
    await new Promise((r) => setTimeout(r, 20));
    queued = { v: "9월값", key: B };          // 달을 바꾸고 9월 편집(같은 ref 를 공유)
    for (let i = 0; i < 80 && (sending || queued); i++) await new Promise((r) => setTimeout(r, 10));
    return sv.docs;
  };
  await (async () => {
    check("키 확인이 없으면 9월 값이 8월 문서에 들어간다(재현)", (await run(false))[A], "9월값");
    check("키를 확인하면 8월 문서에는 8월 값만 남는다", (await run(true))[A], "8월값");
  })();
}

// ─────────────────────────────────────────────────────────────────────────────
section("[20] 소스 검사 — 위 방어가 화면 코드에 실제로 붙어 있는가");
{
  const tabSrc = readFileSync(new URL("../src/pages/branch/tabs/MonthlyFullTimeSalarySubTab.tsx", import.meta.url), "utf-8");
  // 자기검증: 아무것도 못 읽고 통과하는 검사를 막는다.
  check("급여대장 화면 소스를 실제로 읽었다", tabSrc.includes("applyPreviousMonthCarryover"), true);

  check("저장을 한 번에 하나씩만 보낸다(sendingRef)", /sendingRef\.current\s*\)\s*return/.test(tabSrc), true);
  check("대기 작업에 달(key)을 묶는다", /queuedRef\.current\s*=\s*\{[^}]*key:\s*sharedKey/.test(tabSrc), true);
  check("자기 달의 값만 보낸다(키 확인)", /job\.key\s*!==\s*sharedKey/.test(tabSrc), true);
  check("저장은 대기 작업의 키로 보낸다", tabSrc.includes("saveSharedData(job.key"), true);
  check("pending 표시도 그 작업의 달 것을 지운다", tabSrc.includes("removeItem(job.pendingKey)"), true);
  check("떠날 때의 저장도 날아가던 요청 뒤에 보낸다", /inFlightRef\.current;?[\s\S]{0,200}then\(send,\s*send\)/.test(tabSrc), true);

  // 전월 자료는 캐시 폴백 없는 서버 읽기여야 한다 — 옛 캐시의 계좌·주민등록번호가 이번 달에 채워지면 안 된다.
  const prevRead = tabSrc.match(/const prevRows = await gasClient\.(\w+)</);
  check("전월 급여대장은 서버에서만 읽는다", prevRead?.[1], "getSharedDataFromServer");
  // '처음 여는 달' 확정도 캐시 폴백 없는 읽기로 한다.
  check("처음 여는 달 확정도 서버 읽기로 한다", /mayBeFirstOpenOfMonth\([\s\S]{0,400}getSharedDataFromServer/.test(tabSrc), true);

  // 순서 이동은 마감 확정 시 잠겨야 한다.
  check("순서 이동이 마감 확정에서 막힌다", /moveRowBy[\s\S]{0,120}if \(isLocked\) return;/.test(tabSrc), true);

  // 급여 엑셀은 저장 배열 순서를 그대로 쓴다 — 여기에 정렬이 생기면 지점 순서가 깨진다.
  const wbSrc = readFileSync(new URL("../src/pages/branch/helpers/fullTimeSalaryWorkbook.ts", import.meta.url), "utf-8");
  check("급여 엑셀 조립기 소스를 실제로 읽었다", wbSrc.includes("buildFullTimeSalarySheet"), true);
  check("급여 엑셀은 행을 다시 정렬하지 않는다", /\.sort\(|\.reverse\(/.test(wbSrc), false);

  // 보안 게이트: 로딩 스피너가 게이트 바깥으로 나가면 월을 바꿀 때마다 비밀번호를 다시 묻는다.
  const settleSrc = readFileSync(new URL("../src/pages/branch/tabs/MonthlySettleTab.tsx", import.meta.url), "utf-8");
  check("월말마감 탭 소스를 실제로 읽었다", settleSrc.includes("SalaryAccessGate"), true);
  const gateBlocks = settleSrc.match(/<SalaryAccessGate[\s\S]*?<\/SalaryAccessGate>/g) ?? [];
  check("급여대장 게이트가 두 곳(정직원·파트타이머)이다", gateBlocks.length, 2);
  check("스피너는 게이트 안쪽에 있다(월 변경 시 재잠금 방지)", gateBlocks.every((b) => b.includes("LoadingSpinner")), true);
}

console.log(failures === 0 ? "\n전부 통과" : `\n실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
