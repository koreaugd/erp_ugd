// src/pages/admin/helpers/recentDays.ts
// 관리자 표의 '최근 3일' 알약과 '최근 1일(어제·오늘)' 행 강조가 쓰는 날짜 기준 — 한 곳에서 정한다(2026-10-12).
// 택시 timeText("YYYY-MM-DD HH:mm:ss")는 KST 시각 문자열이라, 비교 기준 날짜도 KST 로 뽑는다 —
// 노트북 시간대가 달라도 같은 행이 같은 표시를 받는다. 미래 날짜(원천 시계 오류)는 '최근'이 아니다.
import { useEffect, useState } from "react";

const DAY_MS = 24 * 60 * 60 * 1000;

/** epoch ms → KST 날짜 "YYYY-MM-DD" */
export const kstDate = (ms: number): string => new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** 지금 시각 — 1분마다 갱신해 화면을 자정 넘겨 열어 둬도 기준이 따라간다. */
export function useNowMinute(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return nowMs;
}

export interface RecentWindow {
  today: string;
  /** 최근 3일(오늘 포함)의 첫날 */
  since3: string;
  /** 최근 1일(어제·오늘)의 첫날 */
  since1: string;
}

export const recentWindow = (nowMs: number): RecentWindow => ({
  today: kstDate(nowMs),
  since3: kstDate(nowMs - 2 * DAY_MS),
  since1: kstDate(nowMs - DAY_MS),
});

/** timeText 의 날짜가 [since, today] 안인가 */
export const isDateWithin = (timeText: string, since: string, today: string): boolean => {
  const date = String(timeText || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= since && date <= today;
};
