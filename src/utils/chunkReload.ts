// src/utils/chunkReload.ts
// 화면 파일을 못 받으면 자동으로 새로고침한다.
//
// 왜 필요한가
//   이 앱은 화면마다 파일이 따로 있고, 그 화면을 누를 때 그때그때 받아온다.
//   파일 이름에는 고유 번호가 붙는다(BranchConfirmPage-a1b2c3.js).
//   배포하면 옛 파일이 서버에서 지워지고 새 이름의 파일만 남는다.
//
//   그래서 어제 열어둔 화면을 그대로 쓰고 있으면, 아직 안 열어본 탭을 누르는 순간
//   "어제 이름"으로 파일을 달라고 요청한다 — 서버에는 없다. 화면이 안 그려지고 흰 화면이 뜬다.
//   매장은 "ERP가 먹통이 됐다"고 생각한다.
//
//   파일을 못 받았다는 건 곧 "내가 옛 버전"이라는 뜻이니, 새로고침해서 최신 파일 목록을
//   받아오면 된다. 고장이 자동 갱신으로 바뀐다.
//
// 다만 이유가 하나 더 있다 — 인터넷이 끊긴 경우다.
//   두 경우의 오류 메시지가 똑같아서 메시지만으로는 구분할 수 없다.
//     · 옛 버전이면  → 새로고침하면 해결된다.
//     · 인터넷이면   → 새로고침해봐야 브라우저 오류 화면으로 떨어지고, 보던 화면마저 잃는다.
//
//   navigator.onLine 은 믿을 수 없다. 와이파이는 붙어 있는데 인터넷만 안 되는 경우
//   (공유기 문제, DNS 장애) 여전히 true 다. 그래서 추측하지 않고 서버에 실제로 물어본다.
//   작은 파일 하나를 받아보고, 되면 옛 버전이니 새로고침한다. 안 되면 인터넷 문제이니 손을 뗀다.
//   (그 경우 화면은 ChunkErrorBoundary 가 받아서 무엇을 해야 할지 알려준다)

const RELOAD_AT_KEY = "ugd_chunk_reload_at";
const RELOAD_COOLDOWN_MS = 60 * 1000;
const PROBE_TIMEOUT_MS = 5 * 1000;
/** 임시저장(입력이 멈춘 뒤 400ms)이 끝날 시간을 준 다음 새로고침한다. */
const RELOAD_DELAY_MS = 600;

/** 파일을 못 받아서 생긴 오류인가. 다른 실패(문법 오류 등)와 구분한다. */
export function isMissingChunkError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "");
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /ChunkLoadError/i.test(message)
  );
}

/** 서버에 실제로 닿는가. 작은 파일 하나를 받아본다. */
async function serverIsReachable(): Promise<boolean> {
  try {
    const base = (import.meta as any).env?.BASE_URL || "./";
    const url = new URL(`${base}app-version.json`, window.location.href);
    url.searchParams.set("ping", String(Date.now()));

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const response = await fetch(url.toString(), { cache: "no-store", signal: controller.signal });
    window.clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 최신 파일 목록을 다시 받아온다.
 * @returns 새로고침을 예약했으면 true. 하지 않기로 했으면 false(호출한 쪽이 안내 화면을 띄운다).
 */
export async function reloadForMissingChunk(reason: string): Promise<boolean> {
  const lastAt = Number(sessionStorage.getItem(RELOAD_AT_KEY) || 0);
  if (Date.now() - lastAt < RELOAD_COOLDOWN_MS) {
    // 새로고침했는데도 또 실패했다. 계속 새로고침하면 화면이 깜빡이기만 하고 아무것도 못 한다.
    console.error("화면 파일을 다시 받지 못했습니다. 새로고침을 멈춥니다.", reason);
    return false;
  }

  // 서버에 닿는지 먼저 확인한다. 안 닿으면 인터넷 문제이지 옛 버전 문제가 아니다 —
  // 그때 새로고침하면 보던 화면만 잃는다.
  if (!(await serverIsReachable())) {
    console.warn("서버에 닿지 않아 화면 파일을 받지 못했습니다. 새로고침하지 않습니다.", reason);
    return false;
  }

  sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
  window.setTimeout(() => {
    // 주소에 값을 하나 붙여 새로고침한다 — 그냥 reload()하면 브라우저가 저장해둔 옛 목록을
    // 그대로 다시 쓸 수 있어, 똑같이 없는 파일을 또 요청하게 된다.
    const url = new URL(window.location.href);
    url.searchParams.set("chunkReload", String(Date.now()));
    window.location.replace(url.toString());
  }, RELOAD_DELAY_MS);
  return true;
}

/**
 * React 화면 밖으로 새는 경우를 위한 그물.
 *
 * 화면을 그리다 나는 오류는 ChunkErrorBoundary 가 잡는다(그쪽이 안내 화면까지 그린다).
 * 여기서는 그 바깥으로 흘러나온 것만 받는다. 같은 오류가 양쪽으로 오더라도 위의 쿨다운이
 * 두 번째를 막으므로 새로고침이 두 번 걸리지는 않는다.
 *
 * vite:preloadError 는 일부러 가로채지 않는다 — preventDefault 로 막으면 Vite 가 오류를 다시
 * 던지지 않아, 새로고침을 안 하기로 한 경우(인터넷 문제) 화면이 아무 말 없이 멈춘다.
 * 그냥 흘려보내면 오류가 경계까지 올라가 안내 화면이 뜬다.
 */
export function installChunkReloadGuard() {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    const err = (event as ErrorEvent).error || (event as ErrorEvent).message;
    if (isMissingChunkError(err)) void reloadForMissingChunk("window.error");
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (isMissingChunkError((event as PromiseRejectionEvent).reason)) {
      void reloadForMissingChunk("unhandledrejection");
    }
  });
}
