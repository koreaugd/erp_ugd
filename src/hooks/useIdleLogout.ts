// src/hooks/useIdleLogout.ts
// 아무 조작이 없으면 자동 로그아웃한다.
//
// 왜 필요한가
//   매장 노트북이 24시간 로그인 상태로 켜져 있다. 누구나 열어서 매출·급여를 볼 수 있고,
//   급여대장에는 주민등록번호가 들어 있다.
//
// "로그인 후 N시간"이 아니라 "마지막 조작 후 N분"이어야 한다.
//   시간 기준으로 자르면 마감을 쓰는 도중에도 튕겨나간다. 유휴 기준이면 작업 중에는 계속
//   조작하니 안 튕기고, 노트북을 덮어두고 방치했을 때만 로그아웃된다.
//
// setTimeout이 아니라 "마지막 조작 시각"을 비교한다.
//   노트북을 덮으면 브라우저가 타이머를 멈추거나 늦춘다. 타이머로 재면 절전에서 깨어났을 때
//   시간이 안 흐른 것으로 계산되어 로그아웃이 안 된다. 시각을 비교하면 잠든 시간도 그대로 센다.
//
// 작성 중이던 마감은 날아가지 않는다 — 로그아웃은 sessionStorage만 지우고,
// 일일마감 임시저장은 localStorage(erp_daily_draft_*)에 있어 다시 로그인하면 이어서 쓸 수 있다.
import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
const CHECK_EVERY_MS = 30 * 1000;

export function useIdleLogout(logout: () => void, idleMs = 60 * 60 * 1000) {
  const lastActiveAt = useRef(Date.now());
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  useEffect(() => {
    const mark = () => { lastActiveAt.current = Date.now(); };
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, mark, { passive: true }));

    // 화면이 다시 보일 때도 한 번 판정한다. 노트북을 덮어둔 사이 유휴 시간이 넘었다면 바로 로그아웃.
    const check = () => {
      if (Date.now() - lastActiveAt.current >= idleMs) logoutRef.current();
    };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };

    const timer = window.setInterval(check, CHECK_EVERY_MS);
    window.addEventListener("visibilitychange", onVisible);

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, mark));
      window.clearInterval(timer);
      window.removeEventListener("visibilitychange", onVisible);
    };
  }, [idleMs]);
}
