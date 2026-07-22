// src/pages/admin/helpers/salesRollup.ts
// 관리자 대시보드 '전지점 매출 종합'의 계산부. 조회는 하지 않는다(컴포넌트 담당) — 여기는 순수 함수만.
//
// 대시보드에 있던 '전일' 성격 내용(미제출·현금차이·기타메모·마감 이상치)은 전일 정산현황 탭으로 옮겼고,
// 그 자리를 매출 종합이 대신한다(2026-07-22 합의).
//
// 왜 분리했나: 기간 경계(주/월/연, 직전 동기)와 매출값 결정 규칙은 눈으로 검산하기 어렵고,
// 틀리면 "전 지점 매출이 조용히 잘못 나오는" 사고가 된다. 순수 함수로 떼어 단위 검증이 가능하게 뒀다.
//
// [데이터 한계] ERP 일일마감에는 하루 총액만 있다(현금·카드·이체·배달·총매출). 시간대별 매출·주문 건수·
// 객단가는 저장되지 않으므로 그런 지표는 만들 수 없다. 그래서 '어제/오늘'처럼 하루짜리 기간은
// 선그래프가 점 하나가 되어, 차트만 최근 14일 추이로 대체한다(chartCurrent/chartCompare).

/** 일일마감 1건에서 매출 계산에 필요한 필드만. (gasClient.MasterDaily 의 부분집합) */
export interface SalesDailyRecord {
  settleDate: string;
  cashSales?: number;
  cardSales?: number;
  transferSales?: number;
  deliverySales?: number;
  totalSales?: number;
  submittedAt?: string;
  modifiedAt?: string;
}

export interface DateRange {
  /** YYYY-MM-DD (포함) */
  start: string;
  /** YYYY-MM-DD (포함) */
  end: string;
}

export type PeriodKey = "yesterday" | "today" | "thisWeek" | "thisMonth" | "lastMonth" | "thisYear";

export const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string }> = [
  { key: "yesterday", label: "어제" },
  { key: "today", label: "오늘" },
  { key: "thisWeek", label: "이번 주" },
  { key: "thisMonth", label: "이번 달" },
  { key: "lastMonth", label: "저번 달" },
  { key: "thisYear", label: "올해" },
];

export interface PeriodPlan {
  key: PeriodKey;
  label: string;
  /** 카드·표가 쓰는 집계 구간 */
  current: DateRange;
  /** 직전 동기 구간 */
  compare: DateRange;
  /** "지난주 화요일 대비" 처럼 무엇과 비교하는지 */
  compareLabel: string;
  /** 그래프 x축 단위 */
  granularity: "day" | "month";
  /** 그래프가 그리는 구간(하루짜리 기간은 최근 14일로 대체) */
  chartCurrent: DateRange;
  chartCompare: DateRange;
  /** 그래프가 집계 구간과 다를 때 사용자에게 알릴 문구. 같으면 "" */
  chartNote: string;
  /** 아직 집계할 마감이 없는 기간(예: 매월 1일의 '이번 달', 월요일의 '이번 주') */
  empty: boolean;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");
const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

/** Date → YYYY-MM-DD (로컬 기준. toISOString 은 UTC로 밀려 하루가 어긋난다) */
export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** YYYY-MM-DD → Date (로컬 자정) */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** 해당 연·월의 말일(1~31) */
export function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

/** 그 주의 월요일. (getDay(): 일=0 이라 월요일 기준으로 옮긴다) */
export function startOfWeek(date: Date): Date {
  const day = date.getDay();
  const backToMonday = day === 0 ? 6 : day - 1;
  return addDays(date, -backToMonday);
}

/** 두 날짜(포함) 사이의 일수 */
export function daySpan(range: DateRange): number {
  const start = parseDateKey(range.start);
  const end = parseDateKey(range.end);
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

/** 구간이 걸쳐 있는 YYYY-MM 목록 — 어느 달을 서버에서 읽어야 하는지 정한다 */
export function monthsInRange(range: DateRange): string[] {
  const months: string[] = [];
  const end = parseDateKey(range.end);
  let cursor = new Date(parseDateKey(range.start).getFullYear(), parseDateKey(range.start).getMonth(), 1);
  while (cursor <= end) {
    months.push(`${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}`);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return months;
}

/** 하루짜리 기간의 그래프 대체 구간 길이 */
const RECENT_TREND_DAYS = 14;

/**
 * 기간 버튼 → 집계 구간·비교 구간·그래프 구간.
 *
 * 기준점은 '어제'다 — 오늘은 아직 마감 전이라 넣으면 매출이 낮게 보인다('오늘' 버튼만 예외).
 * 하루짜리 기간(어제/오늘)의 직전 동기는 '지난주 같은 요일'이다. 요일마다 매출 편차가 커서
 * 그저께와 비교하면 요일 차이를 매출 변화로 착각한다.
 */
export function buildPeriodPlan(key: PeriodKey, today: Date): PeriodPlan {
  const todayKey = toDateKey(today);
  const yesterday = addDays(today, -1);
  const label = PERIOD_OPTIONS.find((option) => option.key === key)?.label || key;

  /** 하루짜리 기간 공통 처리 — 그래프는 그 날로 끝나는 최근 14일로 대체한다 */
  const singleDay = (anchor: Date): PeriodPlan => {
    const anchorKey = toDateKey(anchor);
    const lastWeek = toDateKey(addDays(anchor, -7));
    const chartStart = addDays(anchor, -(RECENT_TREND_DAYS - 1));
    return {
      key, label,
      current: { start: anchorKey, end: anchorKey },
      compare: { start: lastWeek, end: lastWeek },
      compareLabel: `지난주 ${WEEKDAY_LABEL[anchor.getDay()]}요일 대비`,
      granularity: "day",
      chartCurrent: { start: toDateKey(chartStart), end: anchorKey },
      chartCompare: { start: toDateKey(addDays(chartStart, -RECENT_TREND_DAYS)), end: toDateKey(addDays(anchor, -RECENT_TREND_DAYS)) },
      chartNote: `하루치는 선그래프로 그릴 수 없어 최근 ${RECENT_TREND_DAYS}일 추이로 보여줍니다.`,
      empty: false,
    };
  };

  if (key === "yesterday") return singleDay(yesterday);
  if (key === "today") return singleDay(today);

  if (key === "thisWeek") {
    const monday = startOfWeek(today);
    // 이번 주는 '어제'까지만 집계한다. 오늘이 월요일이면 아직 마감이 없다.
    const end = yesterday < monday ? monday : yesterday;
    const empty = yesterday < monday;
    const current = { start: toDateKey(monday), end: toDateKey(end) };
    const compare = { start: toDateKey(addDays(monday, -7)), end: toDateKey(addDays(end, -7)) };
    return {
      key, label, current, compare,
      compareLabel: "지난주 같은 기간 대비",
      granularity: "day",
      chartCurrent: current, chartCompare: compare, chartNote: "",
      empty,
    };
  }

  if (key === "thisMonth") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const empty = yesterday < first; // 오늘이 1일이면 이번 달 마감이 아직 없다
    const end = empty ? first : yesterday;
    const current = { start: toDateKey(first), end: toDateKey(end) };
    // 지난달 같은 기간 — 지난달 말일을 넘지 않게 자른다(3/31 → 2/28).
    const prevYear = first.getMonth() === 0 ? first.getFullYear() - 1 : first.getFullYear();
    const prevMonth = first.getMonth() === 0 ? 12 : first.getMonth();
    const prevCutoff = Math.min(end.getDate(), daysInMonth(prevYear, prevMonth));
    const prevKey = `${prevYear}-${pad2(prevMonth)}`;
    return {
      key, label, current,
      compare: { start: `${prevKey}-01`, end: `${prevKey}-${pad2(prevCutoff)}` },
      compareLabel: "지난달 같은 기간 대비",
      granularity: "day",
      chartCurrent: current,
      chartCompare: { start: `${prevKey}-01`, end: `${prevKey}-${pad2(prevCutoff)}` },
      chartNote: "", empty,
    };
  }

  if (key === "lastMonth") {
    // 이미 끝난 달이라 통째로 본다. 비교 대상도 그 전달 전체 — 둘 다 완결된 달이라 이게 공정하다.
    const year = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
    const month = today.getMonth() === 0 ? 12 : today.getMonth();
    const monthKey = `${year}-${pad2(month)}`;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevKey = `${prevYear}-${pad2(prevMonth)}`;
    const current = { start: `${monthKey}-01`, end: `${monthKey}-${pad2(daysInMonth(year, month))}` };
    const compare = { start: `${prevKey}-01`, end: `${prevKey}-${pad2(daysInMonth(prevYear, prevMonth))}` };
    return {
      key, label, current, compare,
      compareLabel: "그 전달 대비",
      granularity: "day",
      chartCurrent: current, chartCompare: compare, chartNote: "", empty: false,
    };
  }

  // thisYear — 1월 1일부터 어제까지. 그래프는 월별.
  const jan1 = new Date(today.getFullYear(), 0, 1);
  const empty = yesterday < jan1; // 1월 1일
  const end = empty ? jan1 : yesterday;
  const current = { start: toDateKey(jan1), end: toDateKey(end) };
  const lastYearEnd = new Date(end.getFullYear() - 1, end.getMonth(), Math.min(end.getDate(), daysInMonth(end.getFullYear() - 1, end.getMonth() + 1)));
  const compare = { start: `${today.getFullYear() - 1}-01-01`, end: toDateKey(lastYearEnd) };
  return {
    key, label: label + ` (${todayKey.slice(0, 4)}년)`, current, compare,
    compareLabel: "작년 같은 기간 대비",
    granularity: "month",
    chartCurrent: current, chartCompare: compare, chartNote: "", empty,
  };
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * 한 건의 매출액을 정한다.
 *
 * 지점이 입력한 `totalSales`를 우선한다. 다만 그 값이 비었거나 0 이하이면 결제수단 합(현금+카드+이체+배달)으로
 * 대신한다 — 과거 기록 중 totalSales 가 저장되지 않은 건이 있어, 그대로 두면 그 지점 매출이 통째로
 * 0원으로 빠진다. (진짜 0원인 날은 결제수단 합도 0이라 결과가 같다.)
 */
export function salesOf(record: SalesDailyRecord): number {
  const total = num(record.totalSales);
  if (total > 0) return total;
  return num(record.cashSales) + num(record.cardSales) + num(record.transferSales) + num(record.deliverySales);
}

/** 배달 매출만 — 배달 비중 카드를 쓸 때 사용 */
export function deliveryOf(record: SalesDailyRecord): number {
  return num(record.deliverySales);
}

/**
 * 같은 날짜 기록이 여러 건이면 최신 1건만 남긴다.
 * 정상 데이터는 지점·날짜당 1건이지만, 중복이 섞이면 그 지점 매출이 부풀어 순위가 뒤집힌다.
 * 최신 판정은 modifiedAt → submittedAt 순, 둘 다 없으면 나중에 나온 것을 남긴다.
 */
export function dedupeByDate(records: SalesDailyRecord[]): SalesDailyRecord[] {
  const byDate = new Map<string, SalesDailyRecord>();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const date = String(record?.settleDate || "");
    if (!date) return;
    const previous = byDate.get(date);
    if (!previous) {
      byDate.set(date, record);
      return;
    }
    const stampOf = (item: SalesDailyRecord) => String(item.modifiedAt || item.submittedAt || "");
    if (stampOf(record) >= stampOf(previous)) byDate.set(date, record);
  });
  return Array.from(byDate.values());
}

export interface RangeSummary {
  total: number;
  delivery: number;
  /** 실제 마감을 올린 날 수 — 일평균의 분모이자 데이터 완전성 신호 */
  closedDays: number;
}

/** 기간 안의 매출 합계·배달 합계·마감일 수 */
export function summarizeRange(records: SalesDailyRecord[], range: DateRange): RangeSummary {
  const inRange = dedupeByDate(records).filter((record) => {
    const date = String(record?.settleDate || "");
    return date >= range.start && date <= range.end;
  });
  return {
    total: inRange.reduce((sum, record) => sum + salesOf(record), 0),
    delivery: inRange.reduce((sum, record) => sum + deliveryOf(record), 0),
    closedDays: inRange.length,
  };
}

/** 날짜별 합계 — 선그래프용. 기록이 없는 날도 0으로 채워 선이 끊기지 않게 한다. */
export function seriesByDay(recordsByBranch: Array<SalesDailyRecord[]>, range: DateRange): Array<{ x: string; y: number }> {
  const totals = new Map<string, number>();
  recordsByBranch.forEach((records) => {
    dedupeByDate(records).forEach((record) => {
      const date = String(record?.settleDate || "");
      if (date < range.start || date > range.end) return;
      totals.set(date, (totals.get(date) || 0) + salesOf(record));
    });
  });
  const points: Array<{ x: string; y: number }> = [];
  const end = parseDateKey(range.end);
  for (let cursor = parseDateKey(range.start); cursor <= end; cursor = addDays(cursor, 1)) {
    const key = toDateKey(cursor);
    points.push({ x: key, y: totals.get(key) || 0 });
  }
  return points;
}

/** 월별 합계 — '올해'처럼 긴 기간의 선그래프용 */
export function seriesByMonth(recordsByBranch: Array<SalesDailyRecord[]>, range: DateRange): Array<{ x: string; y: number }> {
  const totals = new Map<string, number>();
  recordsByBranch.forEach((records) => {
    dedupeByDate(records).forEach((record) => {
      const date = String(record?.settleDate || "");
      if (date < range.start || date > range.end) return;
      const month = date.slice(0, 7);
      totals.set(month, (totals.get(month) || 0) + salesOf(record));
    });
  });
  return monthsInRange(range).map((month) => ({ x: month, y: totals.get(month) || 0 }));
}

export interface BranchSalesRow {
  branchName: string;
  brand: string;
  current: number;
  previous: number;
  closedDays: number;
  dailyAverage: number;
  deltaRatio: number | null;
  /** 서버 조회 실패 — 0원으로 표시하면 안 되는 지점 */
  error: boolean;
}

export interface SalesTotals {
  current: number;
  previous: number;
  delivery: number;
  deliveryShare: number | null;
  currentDailyAverage: number;
  previousDailyAverage: number;
  deltaRatio: number | null;
  dailyAverageDeltaRatio: number | null;
  /** 기간 안에서 실제로 마감이 올라온 (지점×날짜) 수 */
  closedDays: number;
  /** 기간 안에서 기대되는 (지점×날짜) 수 */
  expectedDays: number;
  /** 조회에 실패해 합계에서 빠진 지점 수 — 0이 아니면 합계는 '실제보다 작은 값'이다 */
  errorBranches: number;
}

/** 전월 대비 증감률. 이전 값이 0이면 비율을 낼 수 없어 null */
export function deltaRatioOf(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / previous;
}

/** 지점 1곳의 집계. history 가 null 이면 조회 실패로 본다(0원으로 채우지 않는다). */
export function buildBranchRow(
  branchName: string,
  brand: string,
  currentRecords: SalesDailyRecord[] | null,
  previousRecords: SalesDailyRecord[] | null,
  plan: PeriodPlan
): BranchSalesRow {
  if (currentRecords === null || previousRecords === null) {
    return { branchName, brand, current: 0, previous: 0, closedDays: 0, dailyAverage: 0, deltaRatio: null, error: true };
  }
  const cur = summarizeRange(currentRecords, plan.current);
  const prev = summarizeRange(previousRecords, plan.compare);
  return {
    branchName, brand,
    current: cur.total,
    previous: prev.total,
    closedDays: cur.closedDays,
    dailyAverage: cur.closedDays > 0 ? Math.round(cur.total / cur.closedDays) : 0,
    deltaRatio: deltaRatioOf(cur.total, prev.total),
    error: false,
  };
}

/** 매출 많은 순. 조회 실패 지점은 순위를 매길 수 없으므로 항상 맨 아래로 내린다. */
export function sortBranchRows(rows: BranchSalesRow[]): BranchSalesRow[] {
  return [...rows].sort((a, b) => {
    if (a.error !== b.error) return a.error ? 1 : -1;
    if (b.current !== a.current) return b.current - a.current;
    return a.branchName.localeCompare(b.branchName, "ko");
  });
}

/**
 * 합계. 조회 실패 지점은 더하지 않고 따로 센다.
 * [중요] errorBranches > 0 이면 current/previous 는 '실제보다 작은 값'이다.
 * 화면은 반드시 그 사실을 함께 표시해야 한다 — 숫자만 보여주면 매출이 줄어든 것으로 오해한다.
 */
export function totalsOf(
  rows: BranchSalesRow[],
  deliveryTotal: number,
  plan: PeriodPlan
): SalesTotals {
  const usable = rows.filter((row) => !row.error);
  const current = usable.reduce((sum, row) => sum + row.current, 0);
  const previous = usable.reduce((sum, row) => sum + row.previous, 0);
  const closedDays = usable.reduce((sum, row) => sum + row.closedDays, 0);
  const expectedDays = plan.empty ? 0 : usable.length * daySpan(plan.current);
  const compareSpan = daySpan(plan.compare);
  const currentSpan = daySpan(plan.current);
  return {
    current,
    previous,
    delivery: deliveryTotal,
    deliveryShare: current > 0 ? deliveryTotal / current : null,
    currentDailyAverage: currentSpan > 0 ? Math.round(current / currentSpan) : 0,
    previousDailyAverage: compareSpan > 0 ? Math.round(previous / compareSpan) : 0,
    deltaRatio: deltaRatioOf(current, previous),
    dailyAverageDeltaRatio: deltaRatioOf(
      currentSpan > 0 ? current / currentSpan : 0,
      compareSpan > 0 ? previous / compareSpan : 0
    ),
    closedDays,
    expectedDays,
    errorBranches: rows.length - usable.length,
  };
}

/** 0.081 → "+8.1%" / null → "—" */
export function formatDelta(ratio: number | null): string {
  if (ratio === null) return "—";
  const percent = ratio * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

/** 증감 방향 — 색/기호를 고르는 데 쓴다 */
export function deltaDirection(ratio: number | null): "up" | "down" | "flat" {
  if (ratio === null || ratio === 0) return "flat";
  return ratio > 0 ? "up" : "down";
}

/** 구간 라벨 — "2026-07-01 ~ 2026-07-21", 하루면 "2026-07-21(화)" */
export function formatRangeLabel(range: DateRange): string {
  if (range.start === range.end) {
    const date = parseDateKey(range.start);
    return `${range.start}(${WEEKDAY_LABEL[date.getDay()]})`;
  }
  return `${range.start} ~ ${range.end}`;
}

/** 그래프 x축 눈금 라벨 — 일별은 "7/21", 월별은 "7월" */
export function formatAxisLabel(x: string, granularity: "day" | "month"): string {
  if (granularity === "month") return `${Number(x.slice(5, 7))}월`;
  return `${Number(x.slice(5, 7))}/${Number(x.slice(8, 10))}`;
}
