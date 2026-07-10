/**
 * 값 동등성 비교. JSON.stringify 비교를 대체한다.
 *
 * 왜 필요한가:
 *   JSON.stringify 는 객체 키 순서에 민감하다. Firestore 가 돌려주는 map 필드의 키 순서는
 *   우리가 써 넣은 순서와 다르고(실측 확인), 그 순서가 앞으로도 같으리라는 보장이 코드 어디에도 없다.
 *   의미상 같은 값을 "달라졌다"고 오판하면 마이그레이션은 멀쩡한 문서를 건너뛰고,
 *   되돌리기는 복구해야 할 문서를 복구하지 못한다.
 *
 * 배열 순서는 의미가 있으므로(거래처 행 순서) 순서를 따진다. 객체 키 순서만 무시한다.
 */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
}
