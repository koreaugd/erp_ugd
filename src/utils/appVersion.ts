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

export async function ensureLatestAppVersion() {
  if (typeof window === "undefined") return true;

  try {
    const versionUrl = new URL(getVersionFileUrl(), window.location.href);
    versionUrl.searchParams.set("checkedAt", String(Date.now()));
    const response = await fetch(versionUrl.toString(), { cache: "no-store" });
    if (!response.ok) return true;

    const latest = await response.json();
    const latestVersion = String(latest?.version || "").trim();
    if (!latestVersion || latestVersion === currentAppVersion) return true;

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
