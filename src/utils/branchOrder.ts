/**
 * 지점 목록 표시순서 — **여기 한 곳에서만 정한다.**
 *
 * 지점 목록을 읽는 경로가 두 갈래(로그인 목록 getFirebaseLoginBranches / 앱 전체 firebaseGetBranchList)라
 * 각자 정렬하면 화면마다 순서가 달라진다. 두 경로 모두 이 비교 함수만 쓴다.
 *
 * 규칙: public_branches 문서의 `sortOrder`(숫자) 오름차순 → 없으면 뒤로 → 같으면 기존처럼 지점 번호 순.
 *   · 맨 위에 두고 싶은 지점에만 sortOrder 를 넣는다(예: 신규 오픈 지점 = 0).
 *   · sortOrder 가 없는 지점은 지금까지의 번호 순서를 그대로 유지한다.
 *   · 순서를 바꿀 때 지점 번호(branchId)는 건드리지 않는다 — 번호는 로그인 계정
 *     branch-NN@ugd-erp.example 과 짝이라, 번호를 옮기면 로그인/PIN 게이트가 깨진다.
 */

/** sortOrder 가 없는 지점이 뒤로 가도록 하는 기본값. 실제 값(0·1·2…)보다 항상 커야 한다. */
const NO_SORT_ORDER = Number.MAX_SAFE_INTEGER;

export interface BranchOrderFields {
  branchId?: string | number;
  sortOrder?: number | string | null;
}

const orderValue = (branch: BranchOrderFields | null | undefined): number => {
  // 빈 문자열·null 을 Number() 가 0 으로 바꿔 "맨 앞"으로 올려 버리는 일이 없도록 값이 있을 때만 읽는다.
  const raw = branch?.sortOrder;
  if (raw === null || raw === undefined || raw === "") return NO_SORT_ORDER;
  const value = Number(raw);
  return Number.isFinite(value) ? value : NO_SORT_ORDER;
};

export function compareBranchOrder(a: BranchOrderFields | null | undefined, b: BranchOrderFields | null | undefined): number {
  const diff = orderValue(a) - orderValue(b);
  if (diff !== 0) return diff;
  return String(a?.branchId ?? "").localeCompare(String(b?.branchId ?? ""));
}

/**
 * 지점명 → 순위(0,1,2…) 표. 다른 경로로 받은 목록(예: 구글시트에서 온 관리자 지점목록)을
 * 지점 목록과 **똑같은 순서**로 맞출 때 쓴다.
 *
 * sortOrder 값이 아니라 **정렬이 끝난 목록의 자리 번호**를 담는다 — 표시순서가 같은 지점끼리의
 * 두 번째 기준(지점 번호)까지 그대로 따라가야 두 목록의 순서가 어긋나지 않기 때문이다.
 * 인자는 반드시 compareBranchOrder 로 정렬된 목록이어야 한다.
 */
export function buildBranchRankMap(sortedBranches: Array<{ branchName?: string }>): Map<string, number> {
  const map = new Map<string, number>();
  sortedBranches.forEach((branch, index) => {
    const name = String(branch?.branchName || "").trim();
    if (name && !map.has(name)) map.set(name, index);
  });
  return map;
}

export { NO_SORT_ORDER };
