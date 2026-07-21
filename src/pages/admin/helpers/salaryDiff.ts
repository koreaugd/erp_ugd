// src/pages/admin/helpers/salaryDiff.ts
// 정직원 급여 '전월 대비 변동' 계산. Firestore 를 모르는 순수 함수라 단위 검증이 가능하다
// (scripts/lib/close-guard.mjs 와 같은 방침).
//
// 비교 기준은 '지난달 문서의 실제 이달급여(thisSalary)'를 우선한다. 각 행의 prevSalary 칸은 지점이 손으로
// 적는 참고값이라 기준으로 삼지 않고, 실제값과 어긋나면 prevMismatch 로 표시해 관리자가 알아채게 한다
// (지점이 전월급여를 잘못 적었다는 신호이므로 숨기면 안 된다).
//
// 다만 지난달 문서가 아예 없을 수 있다 — 급여대장 기능은 2026-07 부터 쓰기 시작했고, 그 이전 달은
// 문서가 존재하지 않는다. 그때 비교를 포기하면 첫 달 화면이 통째로 비어 아무 쓸모가 없다.
// 그래서 지난달 문서가 없을 때만 prevSalary 칸을 대체 기준으로 쓰고, 어느 쪽을 썼는지 prevSource 로 밝힌다.
// (근거를 숨긴 채 숫자만 보여주면 관리자가 그 값을 확정액으로 오해한다.)

export type SalaryRow = {
  employeeId?: string;
  name?: string;
  rank?: string;
  entryDate?: string;
  prevSalary?: string;
  thisSalary?: string;
  taxiEtc?: string;
  bonusTip?: string;
  overtimePay?: string;
  overtimeHours?: string;
  overtimeRate?: string;
  memo?: string;
};

/** raise/cut = 양 달에 다 있고 기본급이 다름 · new = 이번 달 입사 · left = 전월에만 있음
 *  noPrevRecord = 전월 기록이 없는데 이번 달 입사자도 아님(≒ 지난달 급여대장 미작성) */
export type ChangeKind = "raise" | "cut" | "new" | "left" | "noPrevRecord";

/** 전월 금액을 어디서 얻었는지. document=지난달 확정액(믿을 수 있음) · declared=지점이 급여대장에 적은 전월급여 칸 */
export type PrevSource = "document" | "declared" | "none";

export type SalaryChange = {
  branchName: string;
  name: string;
  rank: string;
  kind: ChangeKind;
  /** 비교에 쓴 전월 금액. 근거는 prevSource 를 볼 것. 없으면 null */
  prevSalary: number | null;
  prevSource: PrevSource;
  /** 이번 달 이달급여. 퇴사(추정)면 null */
  currSalary: number | null;
  /** currSalary - prevSalary. 한쪽이 null 이면 null */
  delta: number | null;
  /** 참고: 수당까지 더한 총액(연장·택시비·상여 포함) */
  prevTotal: number | null;
  currTotal: number | null;
  entryDate: string;
  memo: string;
  /** 이번 달 행의 '전월급여' 칸에 지점이 적어둔 값 */
  declaredPrev: number | null;
  /** 위 값이 지난달 실제 확정액과 다름 → 지점 입력 오류 신호 */
  prevMismatch: boolean;
  /** 같은 이름이 한 지점에 둘 이상이라 짝짓기가 불확실 */
  ambiguous: boolean;
};

const money = (v: unknown): number => Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0;

/** 급여대장 화면 rowOvertimePay 와 같은 규칙 — 시간·시급이 둘 다 있을 때만 시간×시급. */
const overtimePayOf = (r: SalaryRow): number => {
  const h = Number(String(r.overtimeHours ?? "").replace(/[^0-9.]/g, "")) || 0;
  const rate = money(r.overtimeRate);
  return h > 0 && rate > 0 ? Math.round(h * rate) : money(r.overtimePay);
};

/** 급여대장 화면 rowTotal 과 같은 규칙. */
export const rowTotalOf = (r: SalaryRow): number =>
  money(r.thisSalary) + money(r.taxiEtc) + money(r.bonusTip) + overtimePayOf(r);

const nameOf = (r: SalaryRow) => String(r.name ?? "").trim();

/**
 * 한 지점의 두 달치 급여 행을 비교해 '변동'만 돌려준다.
 *
 * 짝짓기는 employeeId 우선, 없으면 이름. 같은 이름이 한 지점에 둘 이상이면 누구와 짝지어야 할지
 * 알 수 없으므로 짝짓되 ambiguous=true 로 표시한다(조용히 합치면 남의 급여 변동으로 보인다).
 *
 * @param month 비교 대상 달 "YYYY-MM" — 이번 달 입사자를 'new' 로 가르는 기준
 */
export function diffSalaryMonths(
  branchName: string,
  prevRows: SalaryRow[] | null | undefined,
  currRows: SalaryRow[] | null | undefined,
  month: string
): SalaryChange[] {
  const prev = (Array.isArray(prevRows) ? prevRows : []).filter((r) => nameOf(r));
  const curr = (Array.isArray(currRows) ? currRows : []).filter((r) => nameOf(r));

  const countByName = (rows: SalaryRow[]) => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(nameOf(r), (m.get(nameOf(r)) || 0) + 1));
    return m;
  };
  const prevNameCount = countByName(prev);
  const currNameCount = countByName(curr);

  // ── 짝짓기는 반드시 1:1 이어야 한다 ──
  // 지난달 행을 '소비'하지 않고 이름으로 찾기만 하면, 한 지점에 동명이인이 있을 때 이번 달 두 행이
  // 같은 지난달 행 하나와 비교되고(두 번째 사람에게 엉뚱한 증감이 찍힌다), 짝을 못 찾은 지난달 행은
  // 재직 중인데도 '퇴사(추정)'로 보고된다. 그래서 employeeId → 이름 순으로 한 번씩만 소비한다.
  // employeeId 도 '대기열'로 둔다. 같은 id 가 두 행에 붙어 있을 수 있기 때문이다(저장 데이터 오염·행 복제).
  // 그때 id 를 확실한 짝으로 믿으면, 엉뚱한 사람과 급여를 비교하고 진짜 짝은 '퇴사(추정)'로 새어 나간다.
  const prevByIdQueue = new Map<string, SalaryRow[]>();
  prev.forEach((r) => {
    if (!r.employeeId) return;
    if (!prevByIdQueue.has(r.employeeId)) prevByIdQueue.set(r.employeeId, []);
    prevByIdQueue.get(r.employeeId)!.push(r);
  });
  const prevIdCount = new Map<string, number>(Array.from(prevByIdQueue, ([k, v]) => [k, v.length]));
  const currIdCount = new Map<string, number>();
  curr.forEach((r) => { if (r.employeeId) currIdCount.set(r.employeeId, (currIdCount.get(r.employeeId) || 0) + 1); });

  const matchedPrev = new Set<SalaryRow>();
  const matchOf = new Map<SalaryRow, SalaryRow>();      // 이번달 행 → 짝지은 지난달 행
  const matchedById = new Set<SalaryRow>();             // 그중 employeeId 가 양쪽에서 유일해 '확실'한 것
  const idDuplicated = new Set<SalaryRow>();            // id 가 중복이라 짝을 단정할 수 없는 행

  // 1차: employeeId 로 짝짓는다(확실한 짝을 이름 매칭보다 먼저 확보해야 뺏기지 않는다).
  for (const row of curr) {
    if (!row.employeeId) continue;
    const q = prevByIdQueue.get(row.employeeId);
    if (!q || q.length === 0) continue;
    // id 가 중복일 땐 이름이 같은 후보를 먼저 고른다 — 순서만 믿으면 다른 사람과 짝지어진다.
    const byName = q.findIndex((p) => nameOf(p) === nameOf(row));
    const p = q.splice(byName === -1 ? 0 : byName, 1)[0];
    matchedPrev.add(p);
    matchOf.set(row, p);
    const unique = (prevIdCount.get(row.employeeId) || 0) === 1 && (currIdCount.get(row.employeeId) || 0) === 1;
    if (unique) matchedById.add(row); else idDuplicated.add(row);
  }
  // 2차: 남은 지난달 행을 이름별 대기열에 넣고 앞에서부터 하나씩 꺼내 쓴다(같은 행을 두 번 쓰지 않는다).
  const queueByName = new Map<string, SalaryRow[]>();
  for (const p of prev) {
    if (matchedPrev.has(p)) continue;
    const k = nameOf(p);
    if (!queueByName.has(k)) queueByName.set(k, []);
    queueByName.get(k)!.push(p);
  }
  for (const row of curr) {
    if (matchOf.has(row)) continue;
    const q = queueByName.get(nameOf(row));
    if (q && q.length) { const p = q.shift()!; matchedPrev.add(p); matchOf.set(row, p); }
  }

  const changes: SalaryChange[] = [];

  for (const row of curr) {
    const name = nameOf(row);
    const before = matchOf.get(row);
    const byId = matchedById.has(row) ? before : undefined;

    const currSalary = money(row.thisSalary);
    const declaredPrev = row.prevSalary != null && String(row.prevSalary) !== "" ? money(row.prevSalary) : null;
    // 불확실한 짝: (a) 같은 employeeId 가 여러 행에 붙어 있거나, (b) 이름으로만 짝지었는데 그 이름이 중복.
    // id 가 양쪽에서 유일할 때만 '확실'로 본다.
    const ambiguous = !!before && (idDuplicated.has(row) ||
      (!byId && ((prevNameCount.get(name) || 0) > 1 || (currNameCount.get(name) || 0) > 1)));

    if (!before) {
      // 이번 달 입사자는 '신규'가 가장 정확한 설명이다 — 전월급여 칸에 뭐가 적혀 있든 신규로 본다.
      // (지난달 급여대장을 안 쓴 지점의 전 직원이 신규로 둔갑하는 것은 아래 noPrevRecord 가 막는다)
      if (String(row.entryDate ?? "").slice(0, 7) === month) {
        changes.push({
          branchName, name, rank: String(row.rank ?? ""), kind: "new",
          prevSalary: null, prevSource: "none", currSalary, delta: null,
          prevTotal: null, currTotal: rowTotalOf(row),
          entryDate: String(row.entryDate ?? ""), memo: String(row.memo ?? ""),
          declaredPrev, prevMismatch: false, ambiguous: false,
        });
        continue;
      }
      // 지난달 문서가 없을 때만 지점이 적은 전월급여 칸을 대체 기준으로 쓴다(근거는 declared 로 밝힌다).
      if (declaredPrev != null && declaredPrev > 0 && declaredPrev !== currSalary) {
        changes.push({
          branchName, name, rank: String(row.rank ?? ""),
          kind: currSalary > declaredPrev ? "raise" : "cut",
          prevSalary: declaredPrev, prevSource: "declared",
          currSalary, delta: currSalary - declaredPrev,
          prevTotal: null, currTotal: rowTotalOf(row),
          entryDate: String(row.entryDate ?? ""), memo: String(row.memo ?? ""),
          declaredPrev, prevMismatch: false, ambiguous: false,
        });
        continue;
      }
      // 전월급여 칸도 비었거나 이번 달과 같으면 비교할 근거가 없다 → 지난달 기록 없음으로 묶는다.
      if (declaredPrev != null && declaredPrev === currSalary) continue; // 지점 기준으로도 변동 없음
      changes.push({
        branchName, name, rank: String(row.rank ?? ""), kind: "noPrevRecord",
        prevSalary: null, prevSource: "none", currSalary, delta: null,
        prevTotal: null, currTotal: rowTotalOf(row),
        entryDate: String(row.entryDate ?? ""), memo: String(row.memo ?? ""),
        declaredPrev, prevMismatch: false, ambiguous: false,
      });
      continue;
    }

    const prevSalary = money(before.thisSalary);
    if (prevSalary === currSalary) continue; // 변동 없음 — 목록에 넣지 않는다

    changes.push({
      branchName, name, rank: String(row.rank ?? "") || String(before.rank ?? ""),
      kind: currSalary > prevSalary ? "raise" : "cut",
      prevSalary, prevSource: "document", currSalary, delta: currSalary - prevSalary,
      prevTotal: rowTotalOf(before), currTotal: rowTotalOf(row),
      entryDate: String(row.entryDate ?? ""), memo: String(row.memo ?? ""),
      declaredPrev,
      // 지점이 적은 전월급여가 실제와 다른가. 안 적었으면(null) 따지지 않는다.
      prevMismatch: declaredPrev != null && declaredPrev !== prevSalary,
      ambiguous,
    });
  }

  // 전월에 있었는데 이번 달 명단에 없는 사람 = 퇴사(추정). 지점이 행을 지웠을 수도 있어 '추정'이다.
  for (const before of prev) {
    if (matchedPrev.has(before)) continue;
    const prevSalary = money(before.thisSalary);
    if (prevSalary === 0 && rowTotalOf(before) === 0) continue; // 지난달에도 빈 행이었으면 변동이 아니다
    const leftName = nameOf(before);
    changes.push({
      branchName, name: leftName, rank: String(before.rank ?? ""),
      kind: "left",
      prevSalary, prevSource: "document", currSalary: null, delta: null,
      prevTotal: rowTotalOf(before), currTotal: null,
      entryDate: String(before.entryDate ?? ""), memo: String(before.memo ?? ""),
      declaredPrev: null, prevMismatch: false,
      // 동명이인·중복 employeeId 가 섞였으면 짝짓기 순서에 따라 '남은 쪽'이 정해진 것이라,
      // 정말 이 사람이 퇴사한 게 맞는지 알 수 없다. 퇴사 오보는 파장이 크므로 반드시 경고를 남긴다.
      ambiguous: (prevNameCount.get(leftName) || 0) > 1 || (currNameCount.get(leftName) || 0) > 1
        || (!!before.employeeId && (prevIdCount.get(before.employeeId) || 0) > 1),
    });
  }

  return changes;
}

/** 표시 순서: 인상·인하를 차액 큰 순으로 먼저, 그다음 신규 → 지난달 기록 없음 → 퇴사. */
const KIND_ORDER: Record<ChangeKind, number> = { raise: 0, cut: 0, new: 1, noPrevRecord: 2, left: 3 };

export function sortChanges(changes: SalaryChange[]): SalaryChange[] {
  return [...changes].sort((a, b) => {
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (a.delta != null && b.delta != null && a.delta !== b.delta) return Math.abs(b.delta) - Math.abs(a.delta);
    const byBranch = a.branchName.localeCompare(b.branchName, "ko");
    return byBranch !== 0 ? byBranch : a.name.localeCompare(b.name, "ko");
  });
}

export function summarize(changes: SalaryChange[]) {
  const count = (k: ChangeKind) => changes.filter((c) => c.kind === k).length;
  return {
    raise: count("raise"),
    cut: count("cut"),
    new: count("new"),
    noPrevRecord: count("noPrevRecord"),
    left: count("left"),
    raiseAmount: changes.filter((c) => c.kind === "raise").reduce((a, c) => a + (c.delta || 0), 0),
    cutAmount: changes.filter((c) => c.kind === "cut").reduce((a, c) => a + (c.delta || 0), 0),
    mismatch: changes.filter((c) => c.prevMismatch).length,
  };
}
