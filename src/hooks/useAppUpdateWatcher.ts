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
//   최근 30초 안에 뭔가를 눌렀거나, 입력칸에 커서가 있으면서 최근 5분 안에 조작했다면 미룬다.
//   조용해지면 그때 갈아끼운다. (작성 중이던 값은 localStorage에 남으므로 새로고침 후에도 이어진다)
//   [2026-09-14] 예전엔 입력칸에 커서만 있어도 무한정 미뤘다 — 지점 화면은 커서가 늘 어느 칸엔가 남아 있어
//   새 버전이 몇 시간씩 적용되지 않았다. 판정은 appVersion.ts 의 shouldDeferAppSwap 한 곳에 있다.
import { useEffect, useRef, useState } from "react";
import { applyAppVersion, fetchNewAppVersion, shouldDeferAppSwap } from "../utils/appVersion";

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10분마다

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

  // 조용해지면 갈아끼운다. 작업 중이면 미룬다(판정 규칙은 shouldDeferAppSwap).
  useEffect(() => {
    if (!pendingVersion) return;
    const timer = window.setInterval(() => {
      if (shouldDeferAppSwap(isTypingNow(), Date.now() - lastTypedAt.current)) return;
      applyAppVersion(pendingVersion);
      // 한 번 시도했으면 대기 버전을 비운다. 새로고침이 취소될 수 있기 때문이다 —
      // 미저장 탭(주류재고·통합보고서)의 "나가시겠습니까?" 창에서 [취소]를 누르면 이 화면이 그대로 남는데,
      // 대기 버전을 들고 있으면 5초 뒤 또 시도해 창을 반복해서 띄운다(Codex 지적 2026-09-14).
      // 비워 두면 다음 확인(10분 간격·탭 복귀)이 fetchNewAppVersion 의 쿨다운을 거쳐 다시 예약한다.
      setPendingVersion(null);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [pendingVersion]);
}
