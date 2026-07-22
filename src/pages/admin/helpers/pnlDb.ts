// src/pages/admin/helpers/pnlDb.ts
// 관리자 > 분석 > 월간 손익 분석의 계산부 — 데이터 원천은 04 에이전트의 db파일.xlsx(손익DB)다.
// (Firestore shared_data `analysis_pnl_db` 에 적재: scripts/seed-analysis-pnl.mjs 초기 적재,
//  이후 매월 갱신은 화면의 'db파일 업로드' 버튼이 같은 형식으로 저장한다.)
//
// 지표 산식은 로컬 05 대시보드의 parse_db.py 를 그대로 따른다(행번호는 그 파일 기준):
//   이익률   = 이익금 ÷ 총매출              (L262-263)
//   식재료율 = 식재료 ÷ **메뉴매출**         (L264-265 — 분모가 총매출이 아니다)
//   인건비율 = 인건비 ÷ 총매출              (L266)
//   Prime    = 식재료율 + 인건비율           (L267)
//   생산성   = 이익금 ÷ 인건비              (L561)
//   회전율   = 영수건수 ÷ 테이블수 ÷ 영업일수 (L562-563, 영업일수 = 달력일수 − 월휴무일수 L101-104)
//   경보     = 식재료율>35% · 인건비율>35% · 이익률<5% (check_alerts 하드코딩 L322-330)
//   전사 평균·합산은 **본사 행 제외** (L378-380) — 본사 행의 총매출은 전지점 합산이라 섞으면 이중계상된다.
//
// 본사 행(2026-05~)의 특수 의미(04 collector _parse_bonsa_sheet): 총매출=전지점 합산, 공과금=배당/인센 합계.
// 그래서 본사 행은 순위·평균에 넣지 않고 별도 요약(배당/인센·이익잉여금)으로만 보여준다.

/** 손익DB 1행 — 원본 한글 컬럼명을 그대로 유지한다(업로드 파일과 1:1 대응이 눈으로 확인되도록). */
export interface PnlDbRow {
  month: string; // "YYYY-MM"
  지점: string;
  메뉴매출: number; 주류매출: number; "배달/기타매출": number; 총매출: number;
  임대료: number; 식재료: number; 주류원가: number; 인건비: number;
  공과금: number; 기타비용: number; 광고비: number; 세금예비: number; 수수료: number;
  특별지출: number; 특별지출비고: string;
  총지출: number; 이익금: number;
  영수건수: number; 객단가: number;
}

export interface BranchOps { tables: number; restDays: number; }

export interface PnlDbPayload {
  rows: PnlDbRow[];
  branchOps: Record<string, BranchOps>;
  uploadedAt?: string;
  uploadedBy?: string;
}

export const HQ_NAME = "본사";

const num = (v: unknown): number => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);

/** 업로드/Firestore 값 → 정규화 행 목록. 형태가 아예 어긋나면 null(빈 배열과 구분). */
export function normalizePayload(value: unknown): PnlDbPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rows = (value as any).rows;
  if (!Array.isArray(rows)) return null;
  const ops = (value as any).branchOps;
  return {
    rows: rows
      .filter((r: any) => r && r.지점 && r.month)
      .map((r: any) => ({
        month: String(r.month), 지점: String(r.지점).trim(),
        메뉴매출: num(r.메뉴매출), 주류매출: num(r.주류매출), "배달/기타매출": num(r["배달/기타매출"]),
        총매출: num(r.총매출),
        임대료: num(r.임대료), 식재료: num(r.식재료), 주류원가: num(r.주류원가), 인건비: num(r.인건비),
        공과금: num(r.공과금), 기타비용: num(r.기타비용), 광고비: num(r.광고비),
        세금예비: num(r.세금예비), 수수료: num(r.수수료), 특별지출: num(r.특별지출),
        특별지출비고: String(r.특별지출비고 || ""),
        총지출: num(r.총지출), 이익금: num(r.이익금),
        영수건수: num(r.영수건수), 객단가: num(r.객단가),
      })),
    branchOps: ops && typeof ops === "object" && !Array.isArray(ops) ? ops : {},
    uploadedAt: (value as any).uploadedAt,
    uploadedBy: (value as any).uploadedBy,
  };
}

/** 엑셀 손익DB 시트 → 행 목록. 화면 업로드 버튼과 시드 스크립트가 같은 컬럼 계약을 쓴다. */
export const REQUIRED_DB_COLUMNS = ["년도", "월", "지점", "메뉴매출", "주류매출", "배달/기타매출", "총매출", "임대료", "식재료", "주류원가", "인건비", "공과금", "기타비용", "광고비", "세금예비", "수수료", "특별지출", "특별지출비고", "총지출", "이익금", "영수건수", "객단가"] as const;

export function rowsFromSheetJson(raw: any[]): { rows: PnlDbRow[]; missingColumns: string[] } {
  const first = raw[0] || {};
  const missingColumns = REQUIRED_DB_COLUMNS.filter((c) => !(c in first));
  if (missingColumns.length) return { rows: [], missingColumns: [...missingColumns] };
  const rows: PnlDbRow[] = raw
    .filter((r: any) => r && r["지점"] && r["년도"] && r["월"])
    .map((r: any) => ({
      month: `${r["년도"]}-${String(r["월"]).padStart(2, "0")}`,
      지점: String(r["지점"]).trim(),
      메뉴매출: num(r["메뉴매출"]), 주류매출: num(r["주류매출"]), "배달/기타매출": num(r["배달/기타매출"]),
      총매출: num(r["총매출"]),
      임대료: num(r["임대료"]), 식재료: num(r["식재료"]), 주류원가: num(r["주류원가"]), 인건비: num(r["인건비"]),
      공과금: num(r["공과금"]), 기타비용: num(r["기타비용"]), 광고비: num(r["광고비"]),
      세금예비: num(r["세금예비"]), 수수료: num(r["수수료"]), 특별지출: num(r["특별지출"]),
      특별지출비고: String(r["특별지출비고"] || ""),
      총지출: num(r["총지출"]), 이익금: num(r["이익금"]),
      영수건수: num(r["영수건수"]), 객단가: num(r["객단가"]),
    }));
  return { rows, missingColumns: [] };
}

// ── 조회 유틸 ────────────────────────────────────────────

export function availableMonths(rows: PnlDbRow[]): string[] {
  return [...new Set(rows.map((r) => r.month))].sort();
}

export function rowOf(rows: PnlDbRow[], branch: string, month: string): PnlDbRow | null {
  return rows.find((r) => r.지점 === branch && r.month === month) || null;
}

/** 그 달의 지점 행(본사 제외) */
export function branchRowsOf(rows: PnlDbRow[], month: string): PnlDbRow[] {
  return rows.filter((r) => r.month === month && r.지점 !== HQ_NAME);
}

export function hqRowOf(rows: PnlDbRow[], month: string): PnlDbRow | null {
  return rows.find((r) => r.month === month && r.지점 === HQ_NAME) || null;
}

export function prevMonthOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, (m || 1) - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** month 를 포함해 과거로 n 개월(오래된 것부터). 데이터 유무와 무관한 달력 목록. */
export function monthsBack(month: string, n: number): string[] {
  const list: string[] = [];
  let cursor = month;
  for (let i = 0; i < n; i++) { list.unshift(cursor); cursor = prevMonthOf(cursor); }
  return list;
}

// ── 지표 (parse_db.py 그대로) ─────────────────────────────

const rate = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;

export const profitRateOf = (r: PnlDbRow): number | null => rate(r.이익금, r.총매출);
export const foodRateOf = (r: PnlDbRow): number | null => rate(r.식재료, r.메뉴매출);
export const laborRateOf = (r: PnlDbRow): number | null => rate(r.인건비, r.총매출);
export const primeOf = (r: PnlDbRow): number | null => {
  const f = foodRateOf(r), l = laborRateOf(r);
  return f !== null && l !== null ? f + l : null;
};
/** 생산성 = 이익금 ÷ 인건비 (1.0 = 100%) */
export const productivityOf = (r: PnlDbRow): number | null => rate(r.이익금, r.인건비);

/** 해당 월 일수(YYYY-MM) */
export function daysOfMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** 테이블 회전율(회/일) = 영수건수 ÷ 테이블수 ÷ 영업일수. 테이블수를 모르면 null. */
export function turnoverOf(r: PnlDbRow, ops: Record<string, BranchOps>): number | null {
  const op = ops[r.지점];
  if (!op || !op.tables) return null;
  const opDays = daysOfMonth(r.month) - (op.restDays || 0);
  if (opDays <= 0 || r.영수건수 <= 0) return null;
  return r.영수건수 / op.tables / opDays;
}

// ── 경보 임계 (check_alerts 하드코딩 값) ────────────────────
// 경보 '카드'는 사용자 지시로 화면에서 뺐고(2026-07-22), 임계값은 순위표의 붉은 값 표시가 계속 쓴다.

export const ALERT_FOOD_RATE = 0.35;
export const ALERT_LABOR_RATE = 0.35;
export const ALERT_PROFIT_RATE = 0.05; // 이익률 5% 미만
export const PRIME_TARGET = 0.60;      // branch_detail 게이지 목표선

// ── 전사 합산(본사 제외) ──────────────────────────────────

export interface HqTotals {
  branches: number;
  총매출: number; 이익금: number; 인건비: number; 식재료: number; 메뉴매출: number; 영수건수: number;
  이익률: number | null;      // Σ이익 ÷ Σ매출 (가중)
  식재료율: number | null;    // Σ식재료 ÷ Σ메뉴매출
  인건비율: number | null;    // Σ인건비 ÷ Σ매출
  생산성: number | null;      // Σ이익 ÷ Σ인건비
  객단가: number | null;      // Σ매출 ÷ Σ영수건수
}

export function hqTotalsOf(branchRows: PnlDbRow[]): HqTotals {
  const sum = (pick: (r: PnlDbRow) => number) => branchRows.reduce((acc, r) => acc + pick(r), 0);
  const 총매출 = sum((r) => r.총매출), 이익금 = sum((r) => r.이익금);
  const 인건비 = sum((r) => r.인건비), 식재료 = sum((r) => r.식재료);
  const 메뉴매출 = sum((r) => r.메뉴매출), 영수건수 = sum((r) => r.영수건수);
  return {
    branches: branchRows.length,
    총매출, 이익금, 인건비, 식재료, 메뉴매출, 영수건수,
    이익률: rate(이익금, 총매출),
    식재료율: rate(식재료, 메뉴매출),
    인건비율: rate(인건비, 총매출),
    생산성: rate(이익금, 인건비),
    객단가: 영수건수 > 0 ? Math.round(총매출 / 영수건수) : null,
  };
}

// ── 손익계산서 표(지점 상세) ───────────────────────────────

export interface PnlStatementLine {
  label: string;
  amount: number;
  /** 총매출 대비 비율. 매출부 행과 지출부 행 모두 분모는 총매출(05 detail 표와 동일). */
  share: number | null;
  /** 전월 대비 증감률(금액 기준). 전월 값이 0이거나 없으면 null */
  momRatio: number | null;
  kind: "sales" | "salesTotal" | "expense" | "expenseTotal" | "profit";
  note?: string;
}

const EXPENSE_KEYS: Array<{ key: keyof PnlDbRow; label: string }> = [
  { key: "임대료", label: "임대료" },
  { key: "식재료", label: "식재료" },
  { key: "주류원가", label: "주류원가" },
  { key: "인건비", label: "인건비" },
  { key: "공과금", label: "공과금" },
  { key: "기타비용", label: "기타비용" },
  { key: "광고비", label: "광고비" },
  { key: "세금예비", label: "세금예비" },
  { key: "수수료", label: "수수료" },
  { key: "특별지출", label: "특별지출" },
];

export function buildStatement(current: PnlDbRow, previous: PnlDbRow | null): PnlStatementLine[] {
  // 전월 값이 0 이하(미기록·환급 등)면 증감률이 수학적으로 무의미하다(부호가 뒤집혀 반대로 읽힘) — null 로 둔다.
  const mom = (cur: number, prev: number | undefined | null): number | null =>
    previous && typeof prev === "number" && prev > 0 ? (cur - prev) / prev : null;
  const share = (v: number) => rate(v, current.총매출);
  const lines: PnlStatementLine[] = [
    { label: "메뉴매출", amount: current.메뉴매출, share: share(current.메뉴매출), momRatio: mom(current.메뉴매출, previous?.메뉴매출), kind: "sales" },
    { label: "주류매출", amount: current.주류매출, share: share(current.주류매출), momRatio: mom(current.주류매출, previous?.주류매출), kind: "sales" },
    { label: "배달/기타매출", amount: current["배달/기타매출"], share: share(current["배달/기타매출"]), momRatio: mom(current["배달/기타매출"], previous?.["배달/기타매출"]), kind: "sales" },
    { label: "총매출", amount: current.총매출, share: share(current.총매출), momRatio: mom(current.총매출, previous?.총매출), kind: "salesTotal" },
  ];
  EXPENSE_KEYS.forEach(({ key, label }) => {
    const cur = current[key] as number;
    lines.push({
      label, amount: cur, share: share(cur),
      momRatio: mom(cur, previous?.[key] as number | undefined),
      kind: "expense",
      note: key === "특별지출" && current.특별지출비고 ? current.특별지출비고 : undefined,
    });
  });
  lines.push({ label: "총지출", amount: current.총지출, share: share(current.총지출), momRatio: mom(current.총지출, previous?.총지출), kind: "expenseTotal" });
  lines.push({ label: "이익금", amount: current.이익금, share: share(current.이익금), momRatio: mom(current.이익금, previous?.이익금), kind: "profit" });
  return lines;
}

// ── 손익 요약표 (05 산출물 "손익요약표_증감률.xlsx" 재현) ──────
// 구조: 지점 × [매출/인건비/재료비/기타/이익] 각 (금액·매출대비%·전월비) + 이익비중,
// 하단 소계 → 본사지출 → 합계 → 배당/인센 → 이익잉여금.
//   재료비 = 식재료 + 주류원가 (엑셀 수치 대조로 확인: 금샤빠 17,979,334 = 4,847,574 + 13,131,760)
//   기타   = 총지출 − 인건비 − 재료비
//   합계   = 소계 이익 − 본사지출 · 이익잉여금 = 합계 − 배당/인센(본사 행 공과금)
// 전월비 특수 라벨은 엑셀과 동일: 신규(전월 없음) / 적자전환 / 흑자전환 / 적자축소 / 적자확대.

export type SummaryTone = "good" | "bad" | "flat";
export interface SummaryCol { amount: number; share: number | null; mom: string; tone: SummaryTone; }
export interface SummaryBranchRow { 지점: string; cols: SummaryCol[]; profitShare: number | null; }
/** 하단 정산부 한 줄. amount 는 표시용 부호까지 반영(지출·배당은 음수) — 엑셀과 동일. */
export interface SummaryHqLine { label: string; amount: number; mom: string; tone: SummaryTone; strong: boolean; shareLabel: string; }

export interface PnlSummaryTable {
  columns: string[];
  branches: SummaryBranchRow[];
  subtotal: SummaryBranchRow;
  /** 본사 행이 없는 달은 null — 하단 정산부(본사지출~이익잉여금)를 그리지 않는다 */
  hq: SummaryHqLine[] | null;
}

export const SUMMARY_COLUMNS = ["매출", "인건비", "재료비", "기타", "이익"] as const;

/** 요약표 5개 항목 값 */
export function summaryPartsOf(r: PnlDbRow): number[] {
  const 재료비 = r.식재료 + r.주류원가;
  return [r.총매출, r.인건비, 재료비, r.총지출 - r.인건비 - 재료비, r.이익금];
}

/** 증감률 1자리 표기 + tone. 반올림 후 0.0%가 되는 값은 부호·색 없이 평평하게 —
 *  "-0.0% 인데 빨강" 처럼 표기와 색이 어긋나는 것을 막는다(Codex P2). */
const pctCell = (ratio: number, improvedWhenUp: boolean): { mom: string; tone: SummaryTone } => {
  const rounded = Math.round(ratio * 1000) / 10; // % 기준 소수 1자리
  if (rounded === 0) return { mom: "0.0%", tone: "flat" };
  const improved = improvedWhenUp ? rounded > 0 : rounded < 0;
  return { mom: `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`, tone: improved ? "good" : "bad" };
};

/**
 * 전월비 셀. isProfit 항목은 부호 전환 라벨을 쓰고, 비용 항목은 증가=악화(bad)로 색을 뒤집는다.
 * costLike: 인건비·재료비·기타(증가가 나쁨). 매출·이익은 증가가 좋음.
 */
export function summaryMomOf(cur: number, prev: number | null, kind: "revenue" | "cost" | "profit"): { mom: string; tone: SummaryTone } {
  if (prev === null) return { mom: "신규", tone: "flat" };
  if (kind === "profit") {
    if (prev > 0 && cur >= 0) return pctCell((cur - prev) / prev, true);
    if (prev >= 0 && cur < 0) return { mom: "적자전환", tone: "bad" };
    if (prev < 0 && cur >= 0) return { mom: "흑자전환", tone: "good" };
    if (prev < 0 && cur < 0) return Math.abs(cur) < Math.abs(prev) ? { mom: "적자축소", tone: "good" } : { mom: "적자확대", tone: "bad" };
    return { mom: "—", tone: "flat" }; // prev === 0
  }
  if (prev <= 0) return { mom: "—", tone: "flat" };
  return pctCell((cur - prev) / prev, kind === "revenue");
}

export function buildPnlSummary(
  curRows: PnlDbRow[],
  prevRows: PnlDbRow[],
  hqCur: PnlDbRow | null,
  hqPrev: PnlDbRow | null
): PnlSummaryTable {
  const prevBy = new Map(prevRows.map((r) => [r.지점, r]));
  const kinds: Array<"revenue" | "cost" | "profit"> = ["revenue", "cost", "cost", "cost", "profit"];

  const makeRow = (지점: string, parts: number[], prevParts: number[] | null): SummaryBranchRow => ({
    지점,
    cols: parts.map((amount, i) => ({
      amount,
      share: parts[0] > 0 ? amount / parts[0] : null,
      ...summaryMomOf(amount, prevParts ? prevParts[i] : null, kinds[i]),
    })),
    profitShare: null,
  });

  // 매출 큰 순 — 엑셀은 통합보고서 시트 순서지만 웹에서는 규모 순이 읽기 쉽다.
  const branches = [...curRows]
    .sort((a, b) => b.총매출 - a.총매출)
    .map((r) => {
      const prev = prevBy.get(r.지점) || null;
      return makeRow(r.지점, summaryPartsOf(r), prev ? summaryPartsOf(prev) : null);
    });

  const sumParts = (rows: PnlDbRow[]): number[] =>
    rows.reduce((acc, r) => summaryPartsOf(r).map((v, i) => acc[i] + v), [0, 0, 0, 0, 0]);
  const curSum = sumParts(curRows);
  const subtotal = makeRow("소계", curSum, prevRows.length > 0 ? sumParts(prevRows) : null);

  // 이익비중 = 지점 이익 ÷ 소계 이익 (소계 이익이 0 이하이면 비중이 무의미하므로 전부 null —
  // 소계 행의 100% 도 하드코딩하지 않고 여기서만 정한다: Codex P1 "적자 달에도 100%로 보임" 방지)
  const subtotalProfit = curSum[4];
  if (subtotalProfit > 0) {
    branches.forEach((row) => { row.profitShare = row.cols[4].amount / subtotalProfit; });
    subtotal.profitShare = 1;
  }

  // [본사 행 의미 — 2026-06 엑셀 실측으로 확정]
  //   본사행 공과금 = 배당/인센 · 본사행 총지출 = 본사지출 + 배당/인센 (84,573,159 = 47,707,755 + 36,865,404)
  //   본사행 이익금 = 본사 자체 손익(음수) — 이익잉여금이 **아니다**.
  //   이익잉여금 = 소계이익 − 본사행 총지출 = 합계 − 배당/인센 (87,658,299 대조 일치)
  let hq: PnlSummaryTable["hq"] = null;
  if (hqCur) {
    const 배당인센 = hqCur.공과금;
    const 본사지출 = hqCur.총지출 - 배당인센;
    const 합계 = subtotalProfit - 본사지출;
    const 이익잉여금 = 합계 - 배당인센;
    const prevSubtotalProfit = prevRows.length > 0 ? sumParts(prevRows)[4] : null;
    const prev본사지출 = hqPrev ? hqPrev.총지출 - hqPrev.공과금 : null;
    const prev합계 = prev본사지출 !== null && prevSubtotalProfit !== null ? prevSubtotalProfit - prev본사지출 : null;
    const prev잉여금 = prev합계 !== null && hqPrev ? prev합계 - hqPrev.공과금 : null;
    // tone 을 mom 과 함께 보존한다 — 문자열만 넘기면 화면 폴백이 "지출 증가(+)"를 초록으로 오분류한다(Codex P1).
    hq = [
      { label: "본사지출", amount: -본사지출, ...summaryMomOf(본사지출, prev본사지출, "cost"), strong: false, shareLabel: "" },
      { label: "합계 (소계−본사지출)", amount: 합계, ...summaryMomOf(합계, prev합계, "profit"), strong: false, shareLabel: "" },
      { label: "배당/인센", amount: -배당인센, ...summaryMomOf(배당인센, hqPrev ? hqPrev.공과금 : null, "cost"), strong: false, shareLabel: "" },
      { label: "이익잉여금", amount: 이익잉여금, ...summaryMomOf(이익잉여금, prev잉여금, "profit"), strong: true, shareLabel: 이익잉여금 > 0 ? "100%" : "" },
    ];
  }

  return { columns: [...SUMMARY_COLUMNS], branches, subtotal, hq };
}

// ── 본사 종합 (05 산출물 "본사 대시보드/손익계산서" 재현) ──────
//
// [본사 행의 특수 규칙 — 2026-06 db·PNG 실측으로 확정]
//   · db 의 `총매출`은 그 달 **전지점 총매출 합계**(1,509,432,571)다. 본사 자체 매출이 아니다.
//   · db 의 `이익금`은 −총지출(음수)로만 적혀 있어 그대로 쓰면 안 된다.
//   · 05 렌더러는 **표시용 총매출을 '전지점 이익금 합계'(=요약표 소계 이익)로 치환**하고
//     이익금 = 그 값 − 총지출 로 다시 계산한다(172,231,458 − 84,573,159 = 87,658,299).
//   · **이익률만 분모가 전사 총매출**이다(87,658,299 ÷ 1,509,432,571 = 5.8%). parse_db L262-263.
//   · 지출 항목은 이름이 다르게 매핑된다 — db `특별지출비고`가 그 매핑을 그대로 적어 둔다:
//     "공과금=배당인센합계, 식재료=본사차량, 주류원가=카드, 기타비용=기타(기타), 특별지출+=초기투자상각금액"
//   · 전월대비는 항목마다 기준이 다르다: 매출·개별 지출 = **금액 증감률(%)**,
//     총지출·이익금 = **비율 증감(%p)**. PNG 실측(총지출 +13.6%p, 이익금 −3.8%p).

const HQ_EXPENSE_LABELS: Array<{ key: keyof PnlDbRow; label: string }> = [
  { key: "임대료", label: "임대료" },
  { key: "식재료", label: "본사차량" },
  { key: "주류원가", label: "카드" },
  { key: "인건비", label: "인건비" },
  { key: "공과금", label: "배당인센합계" },
  { key: "기타비용", label: "기타(기타)" },
  { key: "광고비", label: "광고비" },
  { key: "세금예비", label: "세금예비" },
  { key: "수수료", label: "수수료" },
  { key: "특별지출", label: "초기투자상각금액" },
];

export interface HqStatementLine {
  label: string;
  amount: number;
  /** 표시용 총매출 대비 비율. 이익금 행만 전사 총매출 대비(=이익률) */
  share: number | null;
  /** 전월대비 표시 문자열("" = 비교 불가) */
  mom: string;
  tone: SummaryTone;
  kind: "sales" | "salesTotal" | "expense" | "expenseTotal" | "profit";
}

export interface HqOverview {
  /** 표시용 총매출 = 전지점 이익금 합계 */
  총매출: number;
  prev총매출: number | null;
  총지출: number;
  이익금: number;
  prev이익금: number | null;
  /** 이익금 ÷ 전사 총매출 */
  이익률: number | null;
  prev이익률: number | null;
  lines: HqStatementLine[];
}

/** 그 달 본사 표시값 한 묶음. 본사 행이 없으면 null. */
export function hqFiguresOf(rows: PnlDbRow[], month: string): { display매출: number; 총지출: number; 이익금: number; 이익률: number | null; row: PnlDbRow } | null {
  const row = hqRowOf(rows, month);
  if (!row) return null;
  const display매출 = branchRowsOf(rows, month).reduce((sum, r) => sum + r.이익금, 0);
  const 이익금 = display매출 - row.총지출;
  return { display매출, 총지출: row.총지출, 이익금, 이익률: rate(이익금, row.총매출), row };
}

/** 0.414 → "+41.4%" (금액 증감) */
const momPct = (cur: number, prev: number | null, costLike: boolean): { mom: string; tone: SummaryTone } => {
  if (prev === null || prev <= 0) return { mom: "", tone: "flat" };
  return pctCell((cur - prev) / prev, !costLike);
};
/** 비율 차이 → "+13.6%p" */
const momPoint = (cur: number | null, prev: number | null, goodWhenUp: boolean): { mom: string; tone: SummaryTone } => {
  if (cur === null || prev === null) return { mom: "", tone: "flat" };
  const diff = Math.round((cur - prev) * 1000) / 10;
  if (diff === 0) return { mom: "0.0%p", tone: "flat" };
  return { mom: `${diff > 0 ? "+" : ""}${diff.toFixed(1)}%p`, tone: (diff > 0) === goodWhenUp ? "good" : "bad" };
};

export function buildHqOverview(rows: PnlDbRow[], month: string): HqOverview | null {
  const cur = hqFiguresOf(rows, month);
  if (!cur) return null;
  const prev = hqFiguresOf(rows, prevMonthOf(month));
  const share = (v: number) => rate(v, cur.display매출);
  const prevShare = (v: number) => (prev ? rate(v, prev.display매출) : null);

  const lines: HqStatementLine[] = [
    { label: "메뉴", amount: cur.row.메뉴매출, share: share(cur.row.메뉴매출), ...momPct(cur.row.메뉴매출, prev ? prev.row.메뉴매출 : null, false), kind: "sales" },
    { label: "주류", amount: cur.row.주류매출, share: share(cur.row.주류매출), ...momPct(cur.row.주류매출, prev ? prev.row.주류매출 : null, false), kind: "sales" },
    // [중복 아님] 본사는 메뉴·주류 매출이 0이라 표시용 총매출 전액이 '기타'로 잡힌다 —
    // 05 산출물 PNG도 기타 172,231,458 / 총매출 172,231,458 로 같은 값을 찍는다(2026-06 실측 대조).
    { label: "기타", amount: cur.display매출, share: share(cur.display매출), ...momPct(cur.display매출, prev ? prev.display매출 : null, false), kind: "sales" },
    { label: "총매출", amount: cur.display매출, share: share(cur.display매출), ...momPct(cur.display매출, prev ? prev.display매출 : null, false), kind: "salesTotal" },
  ];
  HQ_EXPENSE_LABELS.forEach(({ key, label }) => {
    const amount = cur.row[key] as number;
    lines.push({ label, amount, share: share(amount), ...momPct(amount, prev ? (prev.row[key] as number) : null, true), kind: "expense" });
  });
  lines.push({
    label: "총지출", amount: cur.총지출, share: share(cur.총지출),
    ...momPoint(share(cur.총지출), prev ? prevShare(prev.총지출) : null, false), kind: "expenseTotal",
  });
  lines.push({
    label: "이익금", amount: cur.이익금, share: cur.이익률,
    ...momPoint(cur.이익률, prev ? prev.이익률 : null, true), kind: "profit",
  });

  return {
    총매출: cur.display매출,
    prev총매출: prev ? prev.display매출 : null,
    총지출: cur.총지출,
    이익금: cur.이익금,
    prev이익금: prev ? prev.이익금 : null,
    이익률: cur.이익률,
    prev이익률: prev ? prev.이익률 : null,
    lines,
  };
}

// ── 표시 ────────────────────────────────────────────────

export function formatRate(value: number | null, digits = 1): string {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

/** %p 차이 */
export function ratePointDelta(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return "—";
  const diff = (current - previous) * 100;
  return `${diff > 0 ? "+" : ""}${diff.toFixed(1)}%p`;
}
