// src/pages/branch/helpers/fullTimeSalaryMerge.ts
// 정직원 급여대장의 '행 만들기' 규칙을 한곳에 모은 파일.
//   (1) 저장된 행 + 직원현황(로스터)을 합치기 — 지점이 맞춰 놓은 **순서를 그대로 지킨다**
//   (2) 전월 급여대장에서 고정 정보(주민번호·입사일·은행·계좌 등)를 이어받기
//
// 화면(JSX)에서 떼어 둔 이유: 이 두 가지는 값이 조용히 사라지거나 한 사람이 두 줄로 나오는 사고가
// 잦았던 자리다. 규칙을 글로 못 박아 두고 여기서만 고친다.
//
// 공통 불변식 (하나라도 깨면 급여가 잘못 나간다):
//   [1] 저장된 행은 절대 버리지 않는다 — 직원현황에 없는 사람도 그대로 남긴다.
//   [2] **이번 달에 값이 있는 칸은 어떤 경우에도 덮어쓰지 않는다.** 이어받기는 빈칸 채우기뿐이다.
//   [3] 이어받기는 '사람'을 데려오지 않는다 — 지난달에만 있던 퇴사자가 이번 달에 되살아나면 안 된다.
//   [4] **직원현황 1명이 이 병합 때문에 두 행으로 늘어나지 않는다.** 행 id 도 절대 겹치지 않는다
//       (겹치면 한 칸만 고쳐도 두 행이 같이 바뀐다).
//       [4]가 보장하지 **않는** 것: 저장본에 이미 같은 employeeId 가 두 행으로 들어 있는 경우.
//       그 두 행은 여기서 합치지 않고 그대로 둔다(변경 전 코드와 같은 동작 — 행 수·지급 합계 동일).
//       급여 행을 자동으로 합치면 서로 다른 금액이 적힌 두 행 중 하나가 조용히 사라진다.
//       중복은 지점이 화면에서 보고 지우는 것이 맞다. — Codex 4R 논의 2026-09-20
//   [5] **동명이인이면 이름만으로 엮지 않는다.** 직원 id 가 없는 행(수기 추가·옛 저장분)은 이름으로
//       짝을 찾는데, 같은 이름이 둘이면 한 사람의 계좌·주민등록번호가 다른 사람에게 복사된다.
//       이름이 양쪽에서 **딱 한 명일 때만** 엮고, 아니면 이어받기를 건너뛴다(지점이 직접 적는다).
//       — Codex 지독한리뷰 지적 2026-09-20. 옛 코드는 '전월급여' 한 칸만 가져와 위험이 작았지만,
//         계좌·주민번호까지 이어받게 되면서 잘못 엮이는 비용이 훨씬 커졌다.

export interface FullTimeSalaryRow {
  id: string;
  employeeId?: string;
  name: string;
  rank: string;
  residentNumber: string;
  entryDate: string;
  contractType: string;
  bank: string;           // 은행명(국민은행 등)
  accountNumber: string;  // 계좌번호(숫자만 저장)
  prevSalary: string;
  thisSalary: string;
  taxiEtc: string;
  bonusTip: string;
  overtimePay: string;   // 옛 '추가근무' 금액(레거시). 신규는 시간×시급으로 계산하며 이 필드에 저장하지 않는다.
  overtimeHours: string; // 연장 근무시간(소수 허용)
  overtimeRate: string;  // 연장 시급(원)
  remitBranch: string;
  memo: string;
  isManual?: boolean;
}

/** 화면이 controlled input 으로 쓰는 글자 칸들. 옛 저장분에 없는 필드는 ""로 채워 둔다. */
const TEXT_FIELDS = [
  "name", "rank", "residentNumber", "entryDate", "contractType", "bank", "accountNumber",
  "prevSalary", "thisSalary", "taxiEtc", "bonusTip", "overtimePay", "overtimeHours",
  "overtimeRate", "remitBranch", "memo",
] as const;

/**
 * 전월에서 그대로 이어받는 '고정 정보' 칸 (사용자 지시 2026-09-20).
 * 매달 바뀌는 값 — 이달 급여·연장근무 시간·택시비 및 기타지출·상여금·기타내용(퇴사일·퇴직금 메모) — 은
 * 절대 넣지 않는다. 한 번 잘못 이어받으면 지급액이 그대로 틀어진다.
 *
 * 연장근무 '시급'은 사람마다 고정이라 포함한다. 시간은 이어받지 않으므로 이어받은 직후의 '계'는
 * 0이다(계는 시간·시급이 **둘 다** 있을 때만 계산된다) — 유령 금액이 생기지 않는다.
 */
export const CARRY_OVER_FIELDS = [
  "rank", "residentNumber", "entryDate", "contractType", "bank", "accountNumber", "overtimeRate",
] as const;

const text = (v: unknown) => String(v ?? "").trim();

/** 이름별 등장 횟수. 2 이상이면 동명이인이라 이름만으로는 사람을 가릴 수 없다(불변식 [5]). */
const countByName = (list: Array<{ name?: unknown }>): Map<string, number> => {
  const counts = new Map<string, number>();
  list.forEach((item) => {
    const name = text(item?.name);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return counts;
};

/** 옛 저장분에 없던 칸을 ""로 채워 controlled input 을 보장한다. 값은 바꾸지 않는다. */
const normalizeRow = (r: any): FullTimeSalaryRow => {
  const next: any = { ...r };
  TEXT_FIELDS.forEach((f) => {
    if (typeof next[f] !== "string") next[f] = next[f] === undefined || next[f] === null ? "" : String(next[f]);
  });
  return next as FullTimeSalaryRow;
};

/**
 * 레거시 '입금계좌' 한 칸에 은행명+계좌가 함께 적힌 값("국민 123-456")을 은행/계좌 두 칸으로 분리한다.
 * 은행 칸에 이미 값이 있으면 건드리지 않는다.
 * 분리하지 않고 두면, 계좌번호 칸을 한 글자만 수정해도 입력 필터(숫자·하이픈만)가 은행명을 지워 영구 소실된다.
 */
export const splitLegacyAccount = (r: FullTimeSalaryRow): FullTimeSalaryRow => {
  const acc = String(r.accountNumber || "");
  if (r.bank || !/[^\d\- ]/.test(acc)) return r; // 은행이 이미 있거나, 계좌에 문자가 없으면 그대로
  const bank = acc.replace(/[0-9\-./() ]/g, "").trim();
  const number = acc.replace(/[^0-9-]/g, "");
  return bank ? { ...r, bank, accountNumber: number } : r;
};

/** 직원현황(로스터) 1명 → 빈 급여 행. 로스터에는 은행·계좌가 아예 없어 두 칸은 항상 빈칸으로 시작한다. */
export const rosterToRow = (emp: any): FullTimeSalaryRow => ({
  id: `ft_${emp.id || emp.name}`,
  employeeId: emp.id || undefined,
  name: emp.name || "",
  rank: emp.rank || emp.customRank || "",
  residentNumber: emp.residentNumber || "",
  entryDate: emp.entryDate || emp.hireDate || "",
  contractType: emp.contractType || "4대보험",
  bank: emp.bank || "",
  accountNumber: "",
  prevSalary: "",
  thisSalary: "",
  taxiEtc: "",
  bonusTip: "",
  overtimePay: "",
  overtimeHours: "",
  overtimeRate: "",
  remitBranch: "",
  memo: "",
});

/** 행 id 가 겹치면 한 칸만 고쳐도 두 행이 같이 바뀐다 — 화면에 내보내기 전에 반드시 서로 다르게 만든다. */
const withUniqueIds = (rows: FullTimeSalaryRow[]): FullTimeSalaryRow[] => {
  const seen = new Set<string>();
  return rows.map((r, i) => {
    let id = r.id || `ft_row_${i}`;
    if (seen.has(id)) {
      let n = 2;
      while (seen.has(`${id}__${n}`)) n += 1;
      id = `${id}__${n}`;
    }
    seen.add(id);
    return id === r.id ? r : { ...r, id };
  });
};

/**
 * 저장된 급여 행 + 직원현황을 합친다.
 *
 * **순서 = 저장된 배열 순서** (2026-09-20 변경). 예전에는 직원현황 순서로 매번 다시 줄을 세워
 * 지점이 맞춰 놓은 순서를 덮어썼다. 관리자 급여 엑셀은 이 배열을 순서 그대로 받아 적으므로
 * (fullTimeSalaryWorkbook), 여기서 순서를 지켜야 다운로드도 지점 순서대로 나온다.
 *
 * 직원현황에만 있는 신규 입사자는 **맨 아래**에 붙인다 — 맞춰 둔 순서 사이에 끼어들지 않게.
 */
export function mergeRows(roster: any[], saved: FullTimeSalaryRow[]): FullTimeSalaryRow[] {
  const savedRows = (Array.isArray(saved) ? saved : []).filter((r) => r && typeof r === "object");
  // 직원현황에 같은 직원 id 가 두 번 들어 있으면 앞의 것만 쓴다. 같은 id = 같은 사람이므로 접어도
  // 사람이 사라지지 않는다. 접지 않으면 아래 '신규 인원 붙이기'에서 한 사람이 두 행이 되고,
  // 그 두 행이 합계·급여 엑셀에 이중으로 나간다(id 조회용 맵은 이미 앞의 것만 쓰고 있어 앞뒤가 어긋났다).
  // 이름 중복은 여기서 접지 않는다 — 동명이인은 서로 **다른 사람**이라 접으면 한 명이 실제로 사라진다.
  // — Codex 6R 지적 2026-09-20
  const seenRosterIds = new Set<string>();
  const rosterList = (Array.isArray(roster) ? roster : []).filter((emp) => {
    if (!emp) return false;
    const id = text(emp.id);
    if (!id) return true;
    if (seenRosterIds.has(id)) return false;
    seenRosterIds.add(id);
    return true;
  });

  // 로스터를 id·이름으로 찾을 수 있게 **미리 접어 둔다**. 같은 키가 둘이면 앞의 것만 쓴다 —
  // 뒤엣것으로 덮으면 저장된 행이 엉뚱한 동명이인의 기본값을 받는다.
  const rosterByEmp = new Map<string, any>();
  const rosterByName = new Map<string, any>();
  rosterList.forEach((emp) => {
    const id = text(emp.id);
    const name = text(emp.name);
    if (id && !rosterByEmp.has(id)) rosterByEmp.set(id, emp);
    if (name && !rosterByName.has(name)) rosterByName.set(name, emp);
  });

  // 한 로스터 직원은 한 행만 가져간다(불변식 [4]).
  // **직원 id 짝짓기를 전부 먼저** 끝내고 이름 짝짓기는 그다음이다. 순서를 섞으면, 이름만 있는 행이
  // 앞자리에 있다는 이유로 id 가 정확히 일치하는 행의 짝을 가로채 엉뚱한 사람끼리 엮인다.
  const claimed = new Set<any>();
  const pairedEmp = new Map<number, any>();
  savedRows.forEach((raw, i) => {
    const id = text(raw.employeeId);
    if (!id) return;
    const found = rosterByEmp.get(id);
    if (!found || claimed.has(found)) return;
    claimed.add(found);
    pairedEmp.set(i, found);
  });
  // 이름 짝짓기는 **직원현황에 그 이름이 딱 한 명일 때만** 허용한다(불변식 [5], Codex 2R 지적).
  //   - 직원현황에 같은 이름이 둘이면 어느 사람인지 가릴 방법이 없다. 그런데도 앞사람에게 붙이면
  //     저장된 급여·계좌가 **엉뚱한 사람의 employeeId 를 영구히 달게 되고**, 그 잘못된 짝이
  //     다음 달 이어받기(employeeId 매칭)까지 그대로 따라간다. 추측하느니 붙이지 않는다.
  //     (이 경우 두 사람 모두 빈 행으로 아래에 붙어 지점 눈에 띈다 — 조용히 틀리는 것보다 낫다.)
  //   - 반대로 **저장본** 쪽에 같은 이름이 둘인 건 막지 않는다. 직원현황에 그 이름이 한 명뿐이라면
  //     두 행 모두 같은 사람을 가리키는 중복 행이므로, 앞 행에 붙여도 '다른 사람'에게 붙는 게 아니다.
  //   - 저장 행에 **직원 id 가 적혀 있는데 직원현황에서 못 찾은** 경우에도 이름으로 붙이지 않는다.
  //     그 id 는 '이 행은 그 사람 것'이라는 기록이다. 못 찾았다는 건 그 사람이 명부에서 빠졌다는 뜻이고,
  //     같은 이름의 **다른 사람**이 새로 들어왔을 수 있다(퇴사 → 동명 신규입사). 이름이 같다는 이유로
  //     붙이면 퇴사자의 급여·계좌 행이 신입의 주민번호·id 를 뒤집어쓴다. — Codex 5R 지적 2026-09-20
  const rosterNameCounts = countByName(rosterList);
  savedRows.forEach((raw, i) => {
    if (pairedEmp.has(i)) return;
    if (text(raw?.employeeId)) return; // id 가 적힌 행은 id 로만 엮는다
    const name = text(raw?.name);
    if (!name || (rosterNameCounts.get(name) ?? 0) !== 1) return;
    const found = rosterByName.get(name);
    if (!found || claimed.has(found)) return;
    claimed.add(found);
    pairedEmp.set(i, found);
  });

  const merged = savedRows.map((raw, i) => {
    const prior = normalizeRow(raw);
    const found = pairedEmp.get(i);
    // 짝이 없으면 로스터와 엮지 않는다 — 엮으면 두 행의 id 가 같아진다.
    if (!found) return splitLegacyAccount(prior);
    const base = rosterToRow(found);
    // 저장값(지점이 직접 고친 값)이 우선, 비어 있으면 로스터 기본값으로 채운다.
    return splitLegacyAccount({
      ...base,
      name: prior.name || base.name,
      rank: prior.rank || base.rank,
      residentNumber: prior.residentNumber || base.residentNumber,
      entryDate: prior.entryDate || base.entryDate,
      contractType: prior.contractType || base.contractType,
      // 은행·계좌는 다른 칸과 달리 `|| base.x` 를 붙이지 않는다 — 직원현황에는 두 칸이 **아예 없어서**
      // base 값이 항상 빈 문자열이기 때문이다(RosterEmployee 에 bank/accountNumber 필드 없음).
      // 붙여 봐야 결과가 같고, 오히려 splitLegacyAccount 가 '은행 칸이 비었을 때만' 레거시 계좌를
      // 쪼개는 전제를 흐린다. 두 칸을 채우는 건 아래 전월 이어받기 몫이다.
      // (Codex 3R 이 "로스터 은행명이 유실된다"고 지적했으나 로스터에 그 칸이 없어 오탐 — 2026-09-20)
      bank: prior.bank,
      accountNumber: prior.accountNumber,
      prevSalary: prior.prevSalary,
      thisSalary: prior.thisSalary,
      taxiEtc: prior.taxiEtc,
      bonusTip: prior.bonusTip,
      overtimePay: prior.overtimePay,
      overtimeHours: prior.overtimeHours,
      overtimeRate: prior.overtimeRate,
      remitBranch: prior.remitBranch,
      memo: prior.memo,
    });
  });

  rosterList.forEach((emp) => {
    if (!claimed.has(emp)) merged.push(rosterToRow(emp));
  });

  return withUniqueIds(merged);
}

/**
 * 이 달을 처음 여는 것 **같은가**(1차 거름). 지난달 순서를 깔아 주는 건(seedOrder) 처음 여는 달뿐인데,
 * 한 번이라도 저장된 적 있는 달에 잘못 깔면 지점이 ▲▼로 맞춰 놓은 순서를 덮어쓴다.
 *
 * '행이 0개'로 판정하면 안 된다 — 아래 셋은 전부 행 0개지만 처음 여는 달이 아니다:
 *   · 지점이 행을 전부 지워 빈 배열([])이 저장된 달
 *   · 이 노트북에 미저장 편집(pending)이 남아 있는 달
 *   · 서버를 못 읽어 빈손으로 돌아온 경우
 *
 * 그리고 이 함수만으로는 **부족하다**. gasClient.getSharedData 는 서버 읽기에 실패해도 예외를 던지지 않고
 * 캐시로 넘어가며, 문서가 없으면 null 을 준다 — '못 읽음'과 '없음'이 같은 값으로 온다.
 * 그래서 이 함수가 true 를 준 뒤에도, 호출부는 **캐시 폴백 없는 서버 읽기**(getSharedDataFromServer)로
 * '정말 없다'를 확인한 다음에만 순서를 깔아야 한다. 확인에 실패하면 깔지 않는다.
 * — Codex 7R·8R 지적 2026-09-20
 *
 * @param remoteIsArray 서버에서 배열을 받았는가. 빈 배열이어도 '문서가 있다'는 뜻이라 true.
 *   읽기에 실패했거나 null 이면 false.
 */
export function mayBeFirstOpenOfMonth({
  hasPendingLocal,
  hasLocalEntry,
  remoteIsArray,
}: {
  hasPendingLocal: boolean;
  hasLocalEntry: boolean;
  remoteIsArray: boolean;
}): boolean {
  return !hasPendingLocal && !hasLocalEntry && !remoteIsArray;
}

/**
 * 전월 급여대장을 읽어올 필요가 있는가. 이어받을 빈칸이 하나도 없으면 조회를 건너뛴다(불필요한 서버 호출 방지).
 */
export function needsPreviousMonth(rows: FullTimeSalaryRow[], seedOrder: boolean): boolean {
  if (seedOrder) return true;
  return rows.some((r) => !text(r.prevSalary) || CARRY_OVER_FIELDS.some((f) => !text((r as any)[f])));
}

/**
 * 전월 급여대장에서 고정 정보를 이어받는다. **빈칸만 채운다** — 불변식 [2].
 * 이번 달 명단에 있는 사람만 채운다 — 지난달에만 있던 퇴사자는 데려오지 않는다(불변식 [3]).
 *
 * @param seedOrder 이번 달을 처음 여는 경우에만 true. 지난달 순서를 그대로 깔아 준다.
 *   한 번이라도 저장된 적 있는 달에는 절대 켜지 않는다 — 켜면 지점이 ▲▼로 맞춰 놓은 순서를 덮어쓴다.
 */
export function applyPreviousMonthCarryover(
  rows: FullTimeSalaryRow[],
  prevRows: unknown,
  { seedOrder }: { seedOrder: boolean }
): FullTimeSalaryRow[] {
  const prev = (Array.isArray(prevRows) ? prevRows : []).filter((r: any) => r && typeof r === "object") as FullTimeSalaryRow[];
  if (prev.length === 0) return rows;

  // 지난달 행을 id·이름으로 접어 둔다(앞의 것이 임자 — 로스터 접기와 같은 규칙).
  const byEmp = new Map<string, number>();
  const byName = new Map<string, number>();
  prev.forEach((r, i) => {
    const id = text(r.employeeId);
    const name = text(r.name);
    if (id && !byEmp.has(id)) byEmp.set(id, i);
    if (name && !byName.has(name)) byName.set(name, i);
  });
  // 동명이인 방어(불변식 [5]) — 이름으로 엮는 건 **이번 달에도 지난달에도 그 이름이 딱 한 명일 때만**.
  // 둘 이상이면 누가 누군지 가릴 방법이 없으므로 이어받기를 포기한다(지점이 직접 적는다).
  // 계좌·주민등록번호가 엉뚱한 사람에게 복사되는 것보다 빈칸으로 두는 편이 낫다.
  const curNames = countByName(rows);
  const prevNames = countByName(prev);

  // 지난달 한 행은 이번 달 한 행에만 쓰인다 — 중복 행이 같은 계좌를 물려받아 이중지급으로 번지지 않게.
  const usedPrev = new Set<number>();
  const takePrev = (at: number | undefined): number => {
    if (at === undefined || at < 0 || usedPrev.has(at)) return -1;
    usedPrev.add(at);
    return at;
  };
  const matchById = (row: FullTimeSalaryRow): number => {
    const id = text(row.employeeId);
    return id ? takePrev(byEmp.get(id)) : -1;
  };
  const matchByName = (row: FullTimeSalaryRow): number => {
    const name = text(row.name);
    if (!name) return -1;
    if ((curNames.get(name) ?? 0) !== 1 || (prevNames.get(name) ?? 0) !== 1) return -1; // 동명이인
    const at = byName.get(name);
    if (at === undefined) return -1;
    // 이번 달 행에 직원 id 가 있는데 id 로 못 찾았다면, 지난달 그 이름의 행이 **다른 id 를 달고 있을 때**
    // 이름만으로 붙이지 않는다. 서로 다른 id = 서로 다른 사람이라는 신호이고(퇴사 → 동명 신규입사,
    // 재입사로 id 재발급 등), 그 상태에서 붙이면 남의 주민번호·계좌가 넘어온다. — Codex 5R 지적 2026-09-20
    //
    // 반대로 지난달 행에 id 가 아예 없으면 충돌 신호가 아니다. 지난달엔 수기 행이었다가 이번 달 명부에
    // 등록된 흔한 경우라 이어받기를 살려 둔다(이름이 양쪽에서 유일하다는 조건은 이미 통과했다).
    if (text(row.employeeId) && text(prev[at]?.employeeId)) return -1;
    return takePrev(at);
  };

  // 로스터 병합과 같은 이유로 **id 짝짓기를 먼저 전부** 끝낸다(이름 행이 id 행의 짝을 가로채지 않게).
  const at: number[] = new Array(rows.length).fill(-1);
  rows.forEach((row, i) => { at[i] = matchById(row); });
  rows.forEach((row, i) => { if (at[i] < 0) at[i] = matchByName(row); });
  const paired = rows.map((row, i) => ({ row, at: at[i] }));

  let next = paired.map(({ row, at }) => {
    if (at < 0) return row;
    const p: any = prev[at];
    const patch: any = {};
    CARRY_OVER_FIELDS.forEach((f) => {
      if (text((row as any)[f])) return;      // 이번 달에 값이 있으면 건드리지 않는다
      if (text(p[f])) patch[f] = String(p[f]);
    });
    // 전월급여 = 지난달의 '이달 급여'. (기존 동작 유지)
    if (!text(row.prevSalary) && text(p.thisSalary)) patch.prevSalary = String(p.thisSalary);
    return Object.keys(patch).length ? { ...row, ...patch } : row;
  });

  if (seedOrder) {
    // 지난달 순서 그대로. 지난달에 없던 사람(신규 입사자)은 서로의 순서를 지킨 채 맨 아래로 모인다.
    next = paired
      .map(({ at }, i) => ({ row: next[i], i, at: at < 0 ? Number.MAX_SAFE_INTEGER : at }))
      .sort((a, b) => (a.at - b.at) || (a.i - b.i))
      .map((x) => x.row);
  }

  return next;
}

/** ▲▼ 한 칸 이동. 범위를 벗어나면 원본을 그대로 돌려준다(호출한 쪽에서 저장을 건너뛸 수 있게 같은 참조). */
export function moveRow(rows: FullTimeSalaryRow[], index: number, delta: -1 | 1): FullTimeSalaryRow[] {
  const to = index + delta;
  if (index < 0 || index >= rows.length || to < 0 || to >= rows.length) return rows;
  const next = rows.slice();
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
