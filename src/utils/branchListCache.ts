/**
 * 지점 목록 세션 캐시 — **키와 읽기·쓰기·비우기를 여기 한 곳에서만 정한다.**
 *
 * 예전에는 키 문자열 "erp_branch_list_cache" 가 화면 세 곳에 흩어져 있어서, 순서 규칙을 바꾸며
 * 한 곳만 새 키로 올렸더니 로그아웃은 옛 키를 지우고 다른 탭은 옛 키를 읽는 어긋남이 생겼다.
 * (Codex 2R 지적, 2026-08-31) 새로 쓰는 곳도 반드시 이 모듈을 거칠 것.
 *
 * 판 번호(v2)는 **목록 순서·형태 규칙을 바꿀 때마다 올린다.** 캐시는 화면을 먼저 그리는 용도라,
 * 옛 순서가 담긴 캐시를 그대로 쓰면 배포 후에도 한동안 옛 순서가 보인다.
 */
export const BRANCH_LIST_CACHE_KEY = "erp_branch_list_cache_v2";

/** 판을 올리며 버린 옛 키들. 비울 때 같이 지워 기기에 찌꺼기가 남지 않게 한다. */
const LEGACY_BRANCH_LIST_CACHE_KEYS = ["erp_branch_list_cache"];

/** 저장 형태가 예전엔 배열, 지금은 {branches, savedAt} 이라 둘 다 받아 준다. */
function readKey(key: string): any[] {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed?.branches;
    return Array.isArray(list) ? list : [];
  } catch {
    // 깨진 캐시 하나 때문에 화면이 멈추면 안 된다 — 캐시가 없는 것으로 본다.
    return [];
  }
}

/**
 * **순서가 중요한 자리**(목록을 먼저 그려 두는 용도)에서 쓴다. 지금 판만 읽는다 —
 * 옛 판에는 옛 순서가 담겨 있어서, 읽으면 배포 후에도 한동안 옛 순서가 보인다.
 * 비어 있으면 잠깐 로딩만 보이고 곧 실제 목록이 채워지므로 손해가 없다.
 */
export function readBranchListCache(): any[] {
  return readKey(BRANCH_LIST_CACHE_KEY);
}

/**
 * **조회가 실패했을 때의 비상 폴백**에서 쓴다. 옛 판 캐시까지 훑는다.
 *
 * 판 번호를 올리면서 이걸 빼먹으면, 이미 열려 있던 세션(옛 키만 있는 기기)에서 조회가 실패할 때
 * 폴백이 빈 목록이 돼 선택지가 통째로 사라진다 — 순서가 조금 옛것인 편이 아무것도 없는 것보다 낫다.
 * 그러니 **순서가 중요하지 않은 자리에서만** 쓸 것.
 */
export function readBranchListCacheIncludingLegacy(): any[] {
  for (const key of [BRANCH_LIST_CACHE_KEY, ...LEGACY_BRANCH_LIST_CACHE_KEYS]) {
    const list = readKey(key);
    if (list.length > 0) return list;
  }
  return [];
}

export function writeBranchListCache(branches: any[]): void {
  try {
    sessionStorage.setItem(BRANCH_LIST_CACHE_KEY, JSON.stringify({ branches, savedAt: Date.now() }));
  } catch {
    // 저장 공간이 꽉 찬 기기에서도 목록 자체는 보여야 하므로 조용히 넘어간다.
  }
}

export function clearBranchListCache(): void {
  try {
    sessionStorage.removeItem(BRANCH_LIST_CACHE_KEY);
    LEGACY_BRANCH_LIST_CACHE_KEYS.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // 로그아웃이 캐시 정리 실패로 막히면 안 된다.
  }
}
