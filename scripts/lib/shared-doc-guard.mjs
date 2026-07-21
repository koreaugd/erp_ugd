/**
 * shared_data 문서 조건부 쓰기 판단 — "계획을 세울 때 읽은 그 문서가 맞는가".
 *
 * 왜 필요한가:
 *   시드 스크립트는 (1) 전 지점 문서를 읽어 계획을 세우고 (2) 사람이 dry-run 을 검토한 뒤 (3) 쓴다.
 *   (1)과 (3) 사이에 지점이 화면에서 저장하면, 그냥 setDoc 하는 순간 그 편집이 조용히 사라진다.
 *   더 나쁜 건 백업이다 — 백업의 previous 는 '편집 전' 값이라, 되돌려도 지점의 편집은 복구되지 않는다.
 *   그래서 트랜잭션 안에서 이 함수로 한 번 더 대조하고, 다르면 그 문서만 건너뛴다.
 *
 * updatedAt 만 보지 않고 값까지 대조하는 이유:
 *   updatedAt 이 없는 옛 문서가 남아 있다. 그런 문서는 updatedAt 대조가 무력(null === null)해서,
 *   값 대조가 없으면 그 사이 바뀐 내용을 그대로 덮어쓴다.
 *
 * Firestore 를 모르는 순수 함수라 단위 검증이 가능하다(close-guard.mjs 와 같은 방침).
 */
import { deepEqual } from "./deep-equal.mjs";

/**
 * @param planned  계획 시점의 스냅샷 { previousExists, previousUpdatedAt, previous }
 * @param current  쓰기 직전(트랜잭션 안)의 스냅샷 { exists, updatedAt, value }
 * @returns true 면 그대로다 → 써도 된다. false 면 그 사이 누가 저장했다 → 건너뛴다.
 */
export function isUnchangedSincePlan(planned, current) {
  if (Boolean(current.exists) !== Boolean(planned.previousExists)) return false;
  if ((current.updatedAt ?? null) !== (planned.previousUpdatedAt ?? null)) return false;
  return deepEqual(current.value ?? null, planned.previous ?? null);
}
