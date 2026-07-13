// src/hooks/useAppUpdateWatcher.ts
// 새로 배포된 버전을 감지해서, 안전할 때 화면을 갈아끼운다.
//
// 왜 필요한가
//   버전 검사는 원래 로그인·지점선택 때만 돌았다. 그런데 매장은 로그아웃하지 않고 노트북을
//   덮었다가 다음 날 밤에 다시 여는 식으로 쓴다. 로그인을 안 하니 검사가 한 번도 돌지 않고,
//   며칠 전에 배포한 버전을 계속 쓰게 된다 — 고쳐 놓은 버그가 계속 터진다는 뜻이다.
//
// 언제 확인하나
//   1) 화면이 다시 보일 때(절전에서 깨어남, 탭 복귀) — 노트북을 덮었다 여는 그 상황을 정확히 잡는다.
//   2) 창에 포커스가 돌아올 때
//   3) 10분마다 (화면을 켜둔 채로도 배포가 될 수 있다)
//
// 언제 갈아끼우나
//   **입력 중에는 절대 안 한다.** 마감을 절반 쓰다가 화면이 날아가면 안 된다.
//   글자를 치는 칸에 커서가 있거나, 최근 30초 안에 뭔가를 입력했다면 미룬다.
//   조용해지면 그때 갈아끼운다. (작성 중이던 값은 localStorage에 남으므로 새로고침 후에도 이어진다)
import { useEffect, useRef, useState } from "react";
import { applyAppVersion, fetchNewAppVersion } from "../utils/appVersion";

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10분마다
const QUIET_AFTER_TYPING_MS = 30 * 1000; // 마지막 입력 후 이만큼 조용해야 갈아끼운다

const isTypingNow = () => {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
};

export function useAppUpdateWatcher() {
  /** 발견했지만 아직 못 갈아끼운 새 버전. 입력이 멈추면 이걸로 갈아탄다. */
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  const lastTypedAt = useRef(0);

  // 마지막으로 뭔가를 입력한 시각. 이걸로 "지금 작업 중인가"를 판단한다.
  useEffect(() => {
    const mark = () => { lastTypedAt.current = Date.now(); };
    window.addEventListener("keydown", mark);
    window.addEventListener("pointerdown", mark);
    return () => {
      window.removeEventListener("keydown", mark);
      window.removeEventListener("pointerdown", mark);
    };
  }, []);

  // 새 버전 확인
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      const version = await fetchNewAppVersion();
      if (!cancelled && version) setPendingVersion(version);
    };

    void check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  // 조용해지면 갈아끼운다. 입력 중이면 계속 미룬다.
  useEffect(() => {
    if (!pendingVersion) return;
    const timer = window.setInterval(() => {
      if (isTypingNow()) return;
      if (Date.now() - lastTypedAt.current < QUIET_AFTER_TYPING_MS) return;
      applyAppVersion(pendingVersion);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [pendingVersion]);
}
