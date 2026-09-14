const currentAppVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "local";

// "이 버전으로 갈아타기를 시도했다"는 표시. 값은 "<버전>|<시각ms>".
//
// [2026-09-14] 예전엔 버전만 적고 **영원히** 다시 시도하지 않았다. 그런데 갈아타기는 실패할 수 있다 —
//   · 주류재고·통합보고서 탭이 미저장 상태면 브라우저가 "나가시겠습니까?" 창을 띄우고, 매장이 [취소]를 누르면
//     새로고침은 안 됐는데 표시만 남는다.
//   · 배포 직후 GitHub Pages 가 아직 옛 index.html 을 내주면, 새로고침해도 옛 버전이 그대로 뜬다.
// 매장은 탭을 며칠씩 안 닫으니 sessionStorage 표시가 그대로 살아, 그 탭은 옛 버전에 갇혔다
// (로그인 때 검사도 같은 표시를 보고 건너뛰었다). 그래서 표시에 시각을 넣고 10분 뒤에는 다시 시도한다.
// 무한 새로고침 방어는 그대로다 — 10분에 한 번 이상은 절대 시도하지 않는다.
const UPDATE_TRIED_KEY = "ugd_app_update_detected";
const UPDATE_RETRY_COOLDOWN_MS = 10 * 60 * 1000;

/** 이 버전으로 최근(쿨다운 안)에 갈아타기를 시도했는가. 순수 함수 — scripts 에서 시험한다. */
export function recentlyTriedVersion(marker: string | null, version: string, now: number, cooldownMs = UPDATE_RETRY_COOLDOWN_MS): boolean {
  if (!marker) return false;
  const sep = marker.lastIndexOf("|");
  const triedVersion = sep >= 0 ? marker.slice(0, sep) : marker;
  if (triedVersion !== version) return false;
  const triedAt = sep >= 0 ? Number(marker.slice(sep + 1)) : NaN;
  // 옛 형식(시각 없음)은 이 코드가 배포되기 전에 적힌 것 — 잠금을 풀어 준다.
  if (!Number.isFinite(triedAt)) return false;
  return now - triedAt < cooldownMs;
}

function readTriedMarker(): string | null {
  try { return sessionStorage.getItem(UPDATE_TRIED_KEY); } catch { return null; }
}

function markVersionTried(version: string) {
  try { sessionStorage.setItem(UPDATE_TRIED_KEY, `${version}|${Date.now()}`); } catch { /* 저장 못 해도 새로고침은 진행 */ }
}

function getVersionFileUrl() {
  const assetScript = Array.from(document.scripts)
    .map((script) => script.src)
    .find((src) => src.includes("/assets/"));

  if (assetScript) {
    return assetScript.replace(/\/assets\/[^/]+$/, "/app-version.json");
  }

  return `${(import.meta as any).env?.BASE_URL || "./"}app-version.json`;
}

/**
 * 새로 배포된 버전이 있는지 "확인만" 한다. 새로고침하지 않는다.
 *
 * ensureLatestAppVersion()은 로그인·지점선택 때만 불린다. 그런데 매장은 로그아웃하지 않고
 * 노트북을 덮었다가 다음 날 다시 여는 식으로 쓴다 — 그러면 로그인을 안 하니 버전 검사가
 * 한 번도 돌지 않아, 며칠 전 배포한 버전을 계속 쓰게 된다(고친 버그가 계속 터진다).
 * 그래서 화면이 다시 살아날 때마다 이 함수로 조용히 확인한다.
 *
 * @returns 새 버전 문자열. 최신이거나 확인 실패면 null.
 */
export async function fetchNewAppVersion(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if ((import.meta as any).env?.DEV) return null;

  try {
    const versionUrl = new URL(getVersionFileUrl(), window.location.href);
    versionUrl.searchParams.set("checkedAt", String(Date.now()));
    const response = await fetch(versionUrl.toString(), { cache: "no-store" });
    if (!response.ok) return null;

    const latest = await response.json();
    const latestVersion = String(latest?.version || "").trim();
    if (!latestVersion || latestVersion === currentAppVersion) return null;

    // 이 버전으로 방금(10분 안에) 갈아타 봤다면 지금은 다시 시도하지 않는다.
    //
    // 브라우저가 캐시된 옛 빌드를 그대로 내주면, 새로고침해도 실행 중인 버전은 그대로다.
    // 그 상태에서 곧바로 또 시도하면 새로고침이 무한 반복된다 — 화면이 계속 깜빡이며 아무것도 못 한다.
    // 그래서 쿨다운을 둔다. 다만 영원히 건너뛰지는 않는다(주소의 appVersion 값도 더는 보지 않는다 —
    // 갈아타기가 실패한 탭은 주소만 새 버전이고 실행은 옛 버전이라, 그걸 근거로 건너뛰면 영영 갇힌다).
    // (ensureLatestAppVersion도 같은 규칙이다)
    if (recentlyTriedVersion(readTriedMarker(), latestVersion, Date.now())) return null;

    return latestVersion;
  } catch (error) {
    console.warn("앱 최신 버전 확인에 실패했습니다.", error);
    return null;
  }
}

/** 마지막 키·클릭 뒤 이만큼은 조용해야 갈아탄다. */
export const QUIET_AFTER_INPUT_MS = 30 * 1000;
/** 입력칸에 커서가 있어도 이만큼 조용하면 '작업 중'이 아니다. */
export const FOCUS_PARK_MS = 5 * 60 * 1000;

/**
 * 지금 갈아타면 안 되는가(작업 중인가). 순수 함수 — useAppUpdateWatcher 가 5초마다 부른다.
 *
 * [2026-09-14 완화] 예전엔 "입력칸에 커서가 있으면" 무조건 미뤘다. 그런데 지점 화면은 칸 대부분이 입력칸이고
 * 커서는 마지막으로 만진 칸에 그대로 남는다 — 그래서 커서만 둔 채 몇 시간을 써도 새 버전이 적용되지 않았다.
 * 이제는 "입력칸에 커서 + 최근 5분 안에 조작"일 때만 작업 중으로 본다. 5분 넘게 아무 키·클릭이 없으면
 * 커서가 어디 있든 갈아탄다(작성 중이던 값은 localStorage 임시저장에 남는다).
 */
export function shouldDeferAppSwap(focusInInput: boolean, idleForMs: number): boolean {
  if (idleForMs < QUIET_AFTER_INPUT_MS) return true;
  if (focusInInput && idleForMs < FOCUS_PARK_MS) return true;
  return false;
}

/** 새 버전으로 갈아탄다. 지금 화면을 버리고 다시 받는다. */
export function applyAppVersion(version: string) {
  markVersionTried(version);
  const reloadUrl = new URL(window.location.href);
  reloadUrl.searchParams.set("appVersion", version);
  window.location.replace(reloadUrl.toString());
}

export async function ensureLatestAppVersion() {
  if (typeof window === "undefined") return true;
  if ((import.meta as any).env?.DEV) return true;

  // **이 확인은 화면 진입을 막고 기다린다**(로그인·지점선택 직후). 그래서 응답이 늦으면
  // 그만큼 화면이 안 열린다. 지하 매장처럼 신호가 약한 곳에서는 이 요청 하나가 수십 초를
  // 잡아먹을 수 있었다 — 타임아웃이 없어 브라우저가 포기할 때까지 기다렸다.
  // 확인에 실패하면 어차피 "그냥 진행"이므로, 짧게 끊고 들여보내는 편이 낫다.
  // (버전이 정말 바뀌었다면 AppSessionGuard 가 뒤에서 다시 확인해 갈아끼운다.)
  const timeout = new AbortController();
  const timeoutTimer = window.setTimeout(() => timeout.abort(), 2500);
  try {
    const versionUrl = new URL(getVersionFileUrl(), window.location.href);
    versionUrl.searchParams.set("checkedAt", String(Date.now()));
    const response = await fetch(versionUrl.toString(), { cache: "no-store", signal: timeout.signal });
    if (!response.ok) return true;

    const latest = await response.json();
    const latestVersion = String(latest?.version || "").trim();
    if (!latestVersion || latestVersion === currentAppVersion) return true;

    // 10분 안에 이미 시도했으면 그냥 들여보낸다(무한 새로고침 방어). 그 뒤에는 다시 시도한다 — 위 주석 참고.
    if (recentlyTriedVersion(readTriedMarker(), latestVersion, Date.now())) return true;

    markVersionTried(latestVersion);
    const reloadUrl = new URL(window.location.href);
    reloadUrl.searchParams.set("appVersion", latestVersion);
    window.location.replace(reloadUrl.toString());
    return false;
  } catch (error) {
    console.warn("앱 최신 버전 확인에 실패했습니다.", error);
    return true;
  } finally {
    window.clearTimeout(timeoutTimer);
  }
}
