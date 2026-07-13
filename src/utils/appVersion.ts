const currentAppVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "local";

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

    // 이 버전으로 이미 한 번 갈아타 봤다면 다시 시도하지 않는다.
    //
    // 브라우저가 캐시된 옛 빌드를 그대로 내주면, 새로고침해도 실행 중인 버전은 그대로다.
    // 그 상태에서 또 "새 버전이 있다"고 판단하면 새로고침이 무한 반복된다 — 화면이 계속 깜빡이며
    // 아무것도 못 하게 된다. 한 번 시도한 버전은 기억해 두고 건너뛴다.
    // (ensureLatestAppVersion도 같은 이유로 같은 방어를 하고 있다)
    const alreadyTried = sessionStorage.getItem("ugd_app_update_detected") === latestVersion;
    const urlVersion = new URL(window.location.href).searchParams.get("appVersion");
    if (alreadyTried || urlVersion === latestVersion) return null;

    return latestVersion;
  } catch (error) {
    console.warn("앱 최신 버전 확인에 실패했습니다.", error);
    return null;
  }
}

/** 새 버전으로 갈아탄다. 지금 화면을 버리고 다시 받는다. */
export function applyAppVersion(version: string) {
  sessionStorage.setItem("ugd_app_update_detected", version);
  const reloadUrl = new URL(window.location.href);
  reloadUrl.searchParams.set("appVersion", version);
  window.location.replace(reloadUrl.toString());
}

export async function ensureLatestAppVersion() {
  if (typeof window === "undefined") return true;
  if ((import.meta as any).env?.DEV) return true;

  try {
    const versionUrl = new URL(getVersionFileUrl(), window.location.href);
    versionUrl.searchParams.set("checkedAt", String(Date.now()));
    const response = await fetch(versionUrl.toString(), { cache: "no-store" });
    if (!response.ok) return true;

    const latest = await response.json();
    const latestVersion = String(latest?.version || "").trim();
    if (!latestVersion || latestVersion === currentAppVersion) return true;

    const alreadyReloadedForVersion = sessionStorage.getItem("ugd_app_update_detected") === latestVersion;
    const urlVersion = new URL(window.location.href).searchParams.get("appVersion");
    if (alreadyReloadedForVersion || urlVersion === latestVersion) return true;

    sessionStorage.setItem("ugd_app_update_detected", latestVersion);
    const reloadUrl = new URL(window.location.href);
    reloadUrl.searchParams.set("appVersion", latestVersion);
    window.location.replace(reloadUrl.toString());
    return false;
  } catch (error) {
    console.warn("앱 최신 버전 확인에 실패했습니다.", error);
    return true;
  }
}
