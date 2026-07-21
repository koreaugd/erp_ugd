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

  const prevById = new Map<string, SalaryRow>();
  const prevByName = new Map<string, SalaryRow>();
  prev.forEach((r) => {
    if (r.employeeId) prevById.set(r.employeeId, r);
    if (!prevByName.has(nameOf(r))) prevByName.set(nameOf(r), r);
  });

  const changes: SalaryChange[] = [];
  const matchedPrev = new Set<SalaryRow>();

  for (const row of curr) {
    const name = nameOf(row);
    const byId = row.employeeId ? prevById.get(row.employeeId) : undefined;
    const before = byId || prevByName.get(name);
    if (before) matchedPrev.add(before);

    const currSalary = money(row.thisSalary);
    const declaredPrev = row.prevSalary != null && String(row.prevSalary) !== "" ? money(row.prevSalary) : null;
    // 이름만으로 짝지었고 그 이름이 어느 한쪽에서든 중복이면 불확실하다(id 로 짝지었으면 확실).
    const ambiguous = !byId && !!before && ((prevNameCount.get(name) || 0) > 1 || (currNameCount.get(name) || 0) > 1);

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
    changes.push({
      branchName, name: nameOf(before), rank: String(before.rank ?? ""),
      kind: "left",
      prevSalary, prevSource: "document", currSalary: null, delta: null,
      prevTotal: rowTotalOf(before), currTotal: null,
      entryDate: String(before.entryDate ?? ""), memo: String(before.memo ?? ""),
      declaredPrev: null, prevMismatch: false, ambiguous: false,
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
