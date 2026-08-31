// src/pages/admin/helpers/pnlDetailImage.ts
// 지점 손익계산서를 05 에이전트의 `_detail.png` 와 같은 모양으로 그려 PNG Blob 을 돌려준다.
//
// [왜 캔버스에 직접 그리나]
//   05 원본은 `05. AGENT_대시보드 생성/skills/html-renderer/scripts/templates/branch_detail.html` 을
//   폭 360px 로 띄워 `device_scale_factor=3` 으로 캡처한 1080px PNG 다(export_png.py L111).
//   화면의 표를 그대로 캡처하면 05 모양이 아니라 **관리자 화면 모양**이 나온다(막대·11px 타이포·관리자 색).
//   그래서 05 의 CSS 수치를 좌표로 옮겨 직접 그린다. 캔버스는 문서에 로드된 웹폰트를 쓸 수 있으므로
//   앱이 자체 호스팅하는 Noto Sans KR(src/fonts.css)이 그대로 잡혀 **글꼴까지 원본과 같아진다**.
//   덕분에 캡처 라이브러리를 새로 들이지 않는다(번들도 안 커지고, Tailwind v4 oklch 파싱 문제도 없다).
//
// [좌표의 출처] 아래 상수는 CSS 를 읽고 추정한 값이 아니라
//   `output/2026-06/1. 지점별 손익계산서/2026-06_남산광어_detail.png`(1080×2892)를 픽셀 스캔해
//   얻은 경계값을 3으로 나눈 것이다. 고칠 일이 생기면 같은 방법으로 다시 재서 맞춘다.
//
// [05 와 다른 점 — 의도된 것]
//   · 05 맨 아래 객단가/영수건수 칸의 AI 코멘트 2줄은 넣지 않는다(ERP 에 그 문장이 없다).
//     그만큼 카드가 짧아진다(99px → 61px).
//   · 지출 라벨 치환(헴프리스 임대료→렌트비 등)은 하지 않는다. 05 의 그 규칙은 render_branch.py
//     원본이 유실돼(.pyc 만 남음) 정확히 재현할 수 없다. 화면 표와 같은 기본 라벨을 쓴다.
import { PRIME_TARGET, foodRateOf, laborRateOf, type PnlDbRow } from "./pnlDb";
import { BRAND } from "../../../demo";

export interface PnlDetailImageInput {
  /** 지점명 — 헤더 아랫줄과 파일명에 쓴다 */
  branch: string;
  /** "YYYY-MM" — 헤더 오른쪽 알약 */
  month: string;
  current: PnlDbRow;
  /** 전월 행. 없으면 전월대비 칸을 전부 비운다(05 와 같은 처리) */
  previous: PnlDbRow | null;
}

// ── 05 원본 값 ────────────────────────────────────────────

const SCALE = 3;          // export_png.py: 폭 400px 이하 → device_scale_factor 3.0
const PAGE_W = 360;       // branch_detail.html body width
const CONTENT_L = 10;     // 본문 좌우 패딩
const CONTENT_R = PAGE_W - CONTENT_L;
const CONTENT_W = CONTENT_R - CONTENT_L; // 340

const C = {
  bg: "#F5F0EB",
  navy: "#1B2A4A",
  amber: "#E8A838",
  muted: "#8C96A8",
  muted2: "#6B7589",
  line: "#DDD8D2",
  rowLine: "#E8E4DF",
  groupBg: "#EDEAE5",
  subBg: "#E8E0D5",
  subLine: "#C0B8AE",
  warnBg: "rgba(220,53,69,0.04)",
  red: "#DC3545",
  green: "#2E8B57",
  gray: "#999999",
  redSoft: "rgba(220,53,69,0.08)",
  greenSoft: "rgba(46,139,87,0.08)",
  graySoft: "rgba(153,153,153,0.08)",
  food: "#2D4A7A",
  white: "#FFFFFF",
} as const;

// Noto Sans KR 세로 지표(ascender 1160 / descender 288, unitsPerEm 1000).
// CSS `line-height: normal` 이 1.448em 이 되고 베이스라인은 줄 상자 위에서 1.16em 지점이다.
// 이 두 값으로 05 의 padding 지정만 보고도 각 칸의 베이스라인을 정확히 재현할 수 있다.
const LINE = 1.448;
const ASC = 1.16;

/** 표 컬럼 기준선 — 남산광어 기준 PNG 의 글자 끝 x 를 실측한 값 */
const COL = {
  headX: 14,        // thead '항목' 왼쪽
  nameX: 24,        // 일반 행 이름(들여쓰기)
  strongX: 16,      // group-hd · sub-row · profit-row 이름
  amountR: 222.5,   // 금액 우측 정렬
  pctR: 275.5,      // 비율 우측 정렬
  badgeR: 345.5,    // 전월대비 뱃지 오른쪽 끝
  deltaR: 346,      // 이익금 행 전월대비(뱃지 없이 글자만) 오른쪽 끝
} as const;

/** 행 높이(배경 칠하는 부분)와 그 아래 구분선 두께 */
const ROW = {
  group: { h: 21, pad: 3, size: 10, line: 1, lineColor: C.line },
  normal: { h: 32, pad: 6, size: 14, line: 1, lineColor: C.rowLine },
  sub: { h: 37, pad: 8, size: 15, line: 2, lineColor: C.subLine },
  profit: { h: 39, pad: 9, size: 15, line: 0, lineColor: C.rowLine },
} as const;

const THEAD = { top: 95, pad: 5, size: 11, line: 2 };
const TABLE_TOP = THEAD.top + THEAD.pad * 2 + THEAD.size * LINE + THEAD.line; // ≈123

const BADGE = { h: 19, padX: 4, size: 10, radius: 3, offset: 14.7 };
const PRIME_CARD_H = 100;
const STAT_CARD_H = 61;   // 05 는 99 — AI 코멘트 2줄을 뺀 높이
const GAP = 10;           // 카드 사이 세로 간격(flex gap)
// 12px 글자의 줄 상자. 계산상 12×1.448=17.4 지만 브라우저가 정수로 잡아 기준 PNG 는 17 이다
// (헤더 끝 71 + 17 + margin 7 = thead 상단 95, 두 번째 제목 822 + 17 + 6 = 통계 카드 845 — 둘 다 실측).
const SEC_TITLE_H = 17;
const BOTTOM_PAD = 20;

// ── 표 데이터 ─────────────────────────────────────────────

type RowKind = "group" | "normal" | "sub" | "profit";
type Tone = "good" | "bad" | "flat";

interface Delta { text: string; tone: Tone }

export interface StmtRow {
  kind: RowKind;
  label: string;
  amount: number;
  /** 총매출 대비 비율 — **퍼센트 단위**(0~100). group 행은 null */
  sharePct: number | null;
  /** null 이면 칸을 비운다 */
  delta: Delta | null;
  /** 전월대비 +25% 초과 지출 행 — 배경을 연빨강으로 */
  warn: boolean;
  /** false 면 뱃지 없이 글자만(이익금 행) */
  badge: boolean;
}

/** 브랜드 = 지점명의 첫 공백 앞부분. "대물섬 종로점" → "대물섬" (05 산출물 16개 지점 헤더 실측) */
export function brandOf(branch: string): string {
  const i = branch.indexOf(" ");
  return i > 0 ? branch.slice(0, i) : branch;
}

// 업로드 엑셀에 이상한 값이 섞여도 이미지에 'Infinity'·'NaN' 이 찍히지 않게 막는다.
// (pnlDb 의 `Number(v) || 0` 은 NaN 은 0 으로 눕히지만 Infinity 는 참값이라 그대로 통과한다.)
const won = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString("ko-KR") : "—");
/** 05 는 비율을 **소수 첫째 자리로 반올림해서 저장**하고, 증감(%p)은 그 반올림된 값끼리 뺀다. */
const r1 = (v: number) => Number(v.toFixed(1));
/** 퍼센트 단위(0~100) 값 → 표시 문자열 */
const pctText = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(1)}%`);
/** 0~1 비율 → 05 가 저장하는 퍼센트 값 */
const asPct = (v: number | null): number | null => (v === null ? null : r1(v * 100));

/**
 * 전월 대비 금액 증감률(%) — 05 처럼 **소수 첫째 자리로 반올림한 값**을 돌려준다.
 * 전월 값이 0 이하면 증감률이 수학적으로 무의미하므로(부호가 뒤집혀 반대로 읽힌다) null 이다.
 *
 * [반올림을 먼저 하는 이유] 05 는 반올림한 증감률을 저장해 두고 그 값으로 임계값을 따진다.
 * 사카바단단 2026-06 임대료가 실제로 +0.5315% 인데 05 는 "0.0%"(변화 없음)로 찍는다 —
 * 0.5315 → 0.5 로 반올림한 뒤 `> 0.5` 를 따지므로 걸리지 않기 때문이다.
 * 반올림 전 값으로 비교하면 같은 칸이 "+0.5%"가 되어 원본과 어긋난다.
 */
function momPct(cur: number, prev: number | null | undefined): number | null {
  if (prev === null || prev === undefined || prev <= 0 || !Number.isFinite(cur)) return null;
  return r1(((cur - prev) / prev) * 100);
}

/**
 * 반올림한 두 비율의 차 — **십분위 정수로** 돌려준다.
 *
 * [왜 정수로 세나] 두 값 다 소수 첫째 자리라 차이도 0.1 단위여야 하는데, 부동소수점에서는
 * `83.2 − 83.1 = 0.10000000000000853`, `88.6 − 88.5 = 0.09999999999999432` 처럼 양쪽으로 흩어진다.
 * 그대로 `> 0.1` 을 따지면 **같은 +0.1%p 인데 어떤 달은 배지가 붙고 어떤 달은 "0.0%p"** 가 된다.
 * 십분위 정수로 바꿔 비교하면 그 흔들림이 사라진다(05 가 뜻한 "±0.1%p 는 변화 없음"과 같은 판정).
 */
function pointDiffTenths(curP: number | null, prevP: number | null): number | null {
  if (curP === null || prevP === null || !Number.isFinite(curP) || !Number.isFinite(prevP)) return null;
  return Math.round((r1(curP) - r1(prevP)) * 10);
}

/** 금액 증감률 칸. `up` 은 "값이 오르는 게 좋은 항목인가"(매출 true / 지출 false). 임계값 ±0.5% 는 05 그대로. */
function momCell(pct: number | null, up: boolean): Delta | null {
  if (pct === null) return null;
  if (pct > 0.5) return { text: `+${pct.toFixed(1)}%`, tone: up ? "good" : "bad" };
  if (pct < -0.5) return { text: `${pct.toFixed(1)}%`, tone: up ? "bad" : "good" };
  return { text: "0.0%", tone: "flat" };
}

/**
 * 비율 증감(%p) 칸 — 총지출 전용. 인자는 퍼센트 단위(0~100).
 * **반올림한 값끼리 뺀다.** 05 가 그렇게 하기 때문이다(남산광어 2026-06: 88.5 − 83.1 = 5.4.
 * 반올림 전 값으로 빼면 5.47 → 5.5 가 되어 원본과 어긋난다). 임계값 ±0.1%p 도 05 그대로.
 */
function momPointCell(curP: number | null, prevP: number | null, up: boolean): Delta | null {
  const tenths = pointDiffTenths(curP, prevP);
  if (tenths === null) return null;
  const d = tenths / 10;
  if (tenths > 1) return { text: `+${d.toFixed(1)}%p`, tone: up ? "good" : "bad" };
  if (tenths < -1) return { text: `${d.toFixed(1)}%p`, tone: up ? "bad" : "good" };
  return { text: "0.0%p", tone: "flat" };
}

/** 05 의 지출 9행 — 금액이 0이어도 행을 지우지 않는다(금샤빠 광고비 0원도 05 PNG 에 남아 있다). */
const EXPENSES: Array<{ key: keyof PnlDbRow; label: string }> = [
  { key: "임대료", label: "임대료" },
  { key: "식재료", label: "식재료" },
  { key: "주류원가", label: "주류원가" },
  { key: "인건비", label: "인건비" },
  { key: "공과금", label: "공과금" },
  { key: "기타비용", label: "기타비용" },
  { key: "광고비", label: "광고비" },
  { key: "세금예비", label: "세금예비" },
  { key: "수수료", label: "수수료" },
];

/**
 * 특별지출 행 라벨 — `특별지출비고` 를 05 규칙으로 해석한다.
 *   "특별지출+=택시비(1,189,100원), 특별지출+=초기투자상각금액(…)"  → "택시비+초기투자상각금액"
 *   "렌트비(차량), 인건비(숙소)"                                    → "렌트비(차량)+인건비(숙소)"
 *   빈 값                                                          → "특별지출"
 * `키=값` 형태의 라벨 치환 지시(본사 행의 "공과금=배당인센합계" 등)는 여기서 쓰지 않는다 — 그 규칙은
 * 지점 라벨까지 바꾸는데 원본 구현이 유실돼 정확히 재현할 수 없다(모듈 머리주석 참고).
 */
export function specialExpenseLabel(note: string | undefined): string {
  const raw = (note || "").trim();
  if (!raw) return "특별지출";
  if (raw.includes("특별지출+=")) {
    const names = raw
      .split("특별지출+=")
      .slice(1)
      .map((part) => part.split("(")[0].trim())
      .filter(Boolean);
    if (names.length > 0) return names.join("+");
  }
  // `키=값` 지시만 들어 있는 비고(본사 행)는 라벨로 쓸 이름이 없다 — 기본 라벨로 둔다.
  if (raw.includes("=")) return "특별지출";
  // 쉼표 뒤 공백은 있을 수도 없을 수도 있다("렌트비(차량),인건비(숙소)") — 둘 다 받는다.
  const parts = raw.split(/\s*,\s*/).filter(Boolean);
  return parts.length > 0 ? parts.join("+") : "특별지출";
}

/**
 * 표에 그릴 행 목록 — 이미지의 데이터 모델이다.
 * 그리기와 떼어 두었으므로 05 산출물(`_intermediate/html/*_detail.html`)의 셀과 곧바로 대조할 수 있다.
 * 실제로 이 함수를 전 지점·4개월치 05 산출물과 맞춰 보고 반올림 규칙 3가지를 잡아냈다.
 */
export function buildStatementRows(current: PnlDbRow, previous: PnlDbRow | null): StmtRow[] {
  const total = current.총매출;
  const share = (v: number): number | null => (total > 0 ? (v / total) * 100 : null);
  const plain = (kind: RowKind, label: string, amount: number, delta: Delta | null, warn = false): StmtRow =>
    ({ kind, label, amount, sharePct: share(amount), delta, warn, badge: true });

  // 05 는 '기타'를 DB 의 배달/기타매출 컬럼이 아니라 **잔차(총매출 − 메뉴 − 주류)** 로 잡는다.
  // 04 db 에는 둘이 어긋나는 행이 있다(마음죽 2026-06: 배달/기타 0원인데 총매출 28,398,000).
  // 잔차를 써야 매출 3행이 총매출과 맞아떨어져 표가 스스로 모순되지 않는다.
  const other = current.총매출 - current.메뉴매출 - current.주류매출;
  // 비율도 잔차로 잡는다 — 05 는 **반올림된** 메뉴·주류 비율을 100 에서 뺀다.
  //   남산광어 2026-06: 500,000/192,910,301 = 0.259% 라 직접 계산하면 0.3% 지만
  //   05 원본은 100 − 73.0 − 26.8 = 0.2% 를 찍는다(61건 산출물 전수 대조로 확인).
  const menuPct = share(current.메뉴매출);
  const liquorPct = share(current.주류매출);
  const otherPct = menuPct === null || liquorPct === null ? null : 100 - r1(menuPct) - r1(liquorPct);

  const rows: StmtRow[] = [
    { kind: "group", label: "매출", amount: 0, sharePct: null, delta: null, warn: false, badge: true },
    // 개별 매출 3행의 전월대비 칸은 05 도 비워 둔다.
    plain("normal", "메뉴", current.메뉴매출, null),
    plain("normal", "주류", current.주류매출, null),
    { kind: "normal", label: "기타", amount: other, sharePct: otherPct, delta: null, warn: false, badge: true },
    {
      kind: "sub", label: "총매출", amount: total, sharePct: total > 0 ? 100 : null,
      delta: momCell(momPct(total, previous?.총매출), true), warn: false, badge: true,
    },
    { kind: "group", label: "지출", amount: 0, sharePct: null, delta: null, warn: false, badge: true },
  ];

  for (const { key, label } of EXPENSES) {
    const cur = current[key] as number;
    const pct = momPct(cur, previous ? (previous[key] as number) : null);
    // 경고행도 같은 반올림값으로 따진다 — 05 는 뱃지와 경고에 같은 `item.mom_change` 를 쓴다.
    rows.push(plain("normal", label, cur, momCell(pct, false), pct !== null && pct > 25));
  }

  if (current.특별지출 !== 0) {
    const cur = current.특별지출;
    const pct = momPct(cur, previous ? previous.특별지출 : null);
    rows.push(plain("normal", specialExpenseLabel(current.특별지출비고), cur, momCell(pct, false), pct !== null && pct > 25));
  }

  const prevShare = (v: number): number | null =>
    previous && previous.총매출 > 0 ? (v / previous.총매출) * 100 : null;

  rows.push({
    kind: "sub", label: "총지출", amount: current.총지출, sharePct: share(current.총지출),
    delta: momPointCell(share(current.총지출), previous ? prevShare(previous.총지출) : null, false),
    warn: false, badge: true,
  });

  // 이익금 행의 전월대비는 이익률 증감(%p)이고, 05 는 여기만 뱃지 없이 글자로 찍는다.
  // 총지출과 같은 규칙(반올림 후 뺄셈)이라 두 행의 %p 가 항상 서로 거울처럼 맞는다.
  const curProfitPct = share(current.이익금);
  const profitTenths = pointDiffTenths(curProfitPct, previous ? prevShare(previous.이익금) : null);
  const profitDelta: Delta | null =
    profitTenths === null
      ? null
      : { text: `${profitTenths > 0 ? "+" : ""}${(profitTenths / 10).toFixed(1)}%p`, tone: "flat" as Tone };
  rows.push({
    kind: "profit", label: "이익금", amount: current.이익금, sharePct: curProfitPct,
    delta: profitDelta, warn: false, badge: false,
  });

  return rows;
}

/** 표 아래 끝 y 와 전체 이미지 높이 */
function planLayout(rows: StmtRow[]): { tableBottom: number; height: number } {
  let y = TABLE_TOP;
  for (const r of rows) {
    const spec = ROW[r.kind];
    y += spec.h + spec.line;
  }
  const tableBottom = y;
  // 표 → 여백 → 선 → 여백 → PRIME 카드 → 여백 → 선 → 여백 → 제목 → 여백 → 통계 카드 → 아래 여백
  let h = tableBottom;
  h += GAP + 1 + GAP + PRIME_CARD_H;
  h += GAP + 1 + GAP + SEC_TITLE_H + 6 + STAT_CARD_H;
  h += BOTTOM_PAD;
  return { tableBottom, height: h };
}

// ── 그리기 도우미 ─────────────────────────────────────────

const font = (weight: number, size: number) => `${weight} ${size}px "Noto Sans KR", sans-serif`;

/** 칸 안에서 세로 가운데 정렬된 텍스트의 베이스라인 — 05 의 `vertical-align: middle` 재현 */
function baselineIn(rowTop: number, rowH: number, size: number, padTop: number, padBottom = padTop): number {
  const contentH = padTop + size * LINE + padBottom;
  return rowTop + (rowH - contentH) / 2 + padTop + size * ASC;
}

function fillRect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function roundRect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number, r: number) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  baseline: number,
  opts: { color: string; weight: number; size: number; align?: CanvasTextAlign; spacing?: string }
) {
  ctx.fillStyle = opts.color;
  ctx.font = font(opts.weight, opts.size);
  ctx.textAlign = opts.align || "left";
  // letterSpacing 은 최신 크롬/엣지만 지원한다. 없으면 조용히 무시돼 자간만 0이 된다.
  ctx.letterSpacing = opts.spacing || "0px";
  ctx.fillText(s, x, baseline);
  ctx.letterSpacing = "0px";
}

/** 텍스트 폭(현재 자간 설정과 무관하게 재려면 font 를 먼저 세팅한다) */
function widthOf(ctx: CanvasRenderingContext2D, s: string, weight: number, size: number): number {
  ctx.font = font(weight, size);
  ctx.letterSpacing = "0px";
  return ctx.measureText(s).width;
}

const toneColor = (t: Tone) => (t === "good" ? C.green : t === "bad" ? C.red : C.gray);
const toneSoft = (t: Tone) => (t === "good" ? C.greenSoft : t === "bad" ? C.redSoft : C.graySoft);

/** 전월대비 뱃지 — 오른쪽 끝(COL.badgeR)에 맞춰 왼쪽으로 자란다 */
function drawBadge(ctx: CanvasRenderingContext2D, d: Delta, pctBaseline: number) {
  const w = widthOf(ctx, d.text, 700, BADGE.size) + BADGE.padX * 2;
  const top = pctBaseline - BADGE.offset;
  roundRect(ctx, toneSoft(d.tone), COL.badgeR - w, top, w, BADGE.h, BADGE.radius);
  text(ctx, d.text, COL.badgeR - BADGE.padX, top + 2 + BADGE.size * ASC, {
    color: toneColor(d.tone), weight: 700, size: BADGE.size, align: "right",
  });
}

// ── 각 구역 ───────────────────────────────────────────────

function drawHeader(ctx: CanvasRenderingContext2D, input: PnlDetailImageInput) {
  // 윗줄: 회사명(네이비) · 브랜드(회색) — 베이스라인 29 (실측 잉크 20.7~29)
  // 회사명은 BRAND.short 를 쓴다 — 시연용 빌드에서 실제 회사명이 저장 이미지에 찍히면 안 된다(2026-08-24).
  const label = ` · ${brandOf(input.branch)}`;
  const corpW = widthOf(ctx, BRAND.short, 700, 11);
  text(ctx, BRAND.short, 16, 28.8, { color: C.navy, weight: 700, size: 11 });
  text(ctx, label, 16 + corpW, 28.8, { color: C.muted, weight: 700, size: 11 });

  // 아랫줄: 지점명 — 베이스라인 56 (실측 잉크 41~57.7)
  text(ctx, input.branch, 16, 55.8, { color: C.navy, weight: 900, size: 18 });

  // 연월 알약 — 오른쪽 끝 344, y 16~36.7 (실측)
  const pillW = widthOf(ctx, input.month, 600, 10) + 20;
  roundRect(ctx, C.navy, 344 - pillW, 16, pillW, 20.7, 10.35);
  text(ctx, input.month, 344 - 10, 16 + 3 + 10 * ASC, {
    color: C.white, weight: 600, size: 10, align: "right",
  });
}

/** `▍제목` — 앰버 바 3×12 + 700 12px 글자 */
function drawSectionTitle(ctx: CanvasRenderingContext2D, label: string, top: number) {
  const barTop = top + (SEC_TITLE_H - 12) / 2;
  roundRect(ctx, C.amber, CONTENT_L, barTop, 3, 12, 2);
  text(ctx, label, CONTENT_L + 9, baselineIn(top, SEC_TITLE_H, 12, 0), {
    color: C.navy, weight: 700, size: 12,
  });
}

function drawStatement(ctx: CanvasRenderingContext2D, rows: StmtRow[]) {
  // thead
  const headBaseline = THEAD.top + THEAD.pad + THEAD.size * ASC;
  const head = { color: C.muted, weight: 600, size: THEAD.size } as const;
  text(ctx, "항목", COL.headX, headBaseline, head);
  text(ctx, "금액", COL.amountR, headBaseline, { ...head, align: "right" });
  text(ctx, "비율", COL.pctR, headBaseline, { ...head, align: "right" });
  text(ctx, "전월대비", COL.deltaR, headBaseline, { ...head, align: "right" });
  fillRect(ctx, C.line, CONTENT_L, TABLE_TOP - THEAD.line, CONTENT_W, THEAD.line);

  let y = TABLE_TOP;
  for (const row of rows) {
    const spec = ROW[row.kind];
    const h = spec.h;

    if (row.kind === "group") {
      fillRect(ctx, C.groupBg, CONTENT_L, y, CONTENT_W, h);
      text(ctx, row.label, COL.strongX, baselineIn(y, h, spec.size, spec.pad), {
        color: C.muted, weight: 700, size: spec.size, spacing: "0.6px",
      });
    } else if (row.kind === "profit") {
      // 이익금 행만 좌우 모서리가 둥글다(05 의 border-radius 6px).
      roundRect(ctx, C.navy, CONTENT_L, y, CONTENT_W, h, 6);
      const base = baselineIn(y, h, spec.size, spec.pad);
      const amber = { color: C.amber, weight: 900, size: spec.size } as const;
      text(ctx, row.label, COL.strongX, base, amber);
      text(ctx, won(row.amount), COL.amountR, base, { ...amber, align: "right" });
      text(ctx, pctText(row.sharePct), COL.pctR, base, { ...amber, align: "right" });
      if (row.delta) text(ctx, row.delta.text, COL.deltaR, base, { ...amber, align: "right" });
    } else {
      const strong = row.kind === "sub";
      if (strong) fillRect(ctx, C.subBg, CONTENT_L, y, CONTENT_W, h);
      else if (row.warn) fillRect(ctx, C.warnBg, CONTENT_L, y, CONTENT_W, h);

      const base = baselineIn(y, h, spec.size, spec.pad);
      const nameStyle = { color: C.navy, weight: strong ? 700 : 500, size: spec.size } as const;
      text(ctx, row.label, strong ? COL.strongX : COL.nameX, base, nameStyle);
      text(ctx, won(row.amount), COL.amountR, base, { ...nameStyle, align: "right" });

      // 비율·전월대비는 12px 로 따로 가운데 정렬된다(05 의 row-pct / row-delta).
      const pctBase = baselineIn(y, h, 12, spec.pad);
      text(ctx, pctText(row.sharePct), COL.pctR, pctBase, {
        color: strong ? C.muted2 : C.muted, weight: 400, size: 12, align: "right",
      });
      if (row.delta && row.badge) drawBadge(ctx, row.delta, pctBase);
    }

    if (spec.line > 0) fillRect(ctx, spec.lineColor, CONTENT_L, y + h, CONTENT_W, spec.line);
    y += h + spec.line;
  }
}

function drawPrimeCard(ctx: CanvasRenderingContext2D, top: number, row: PnlDbRow) {
  roundRect(ctx, C.white, CONTENT_L, top, CONTENT_W, PRIME_CARD_H, 10);
  // 05 는 식재료율·인건비율을 소수 첫째 자리로 반올림해 저장하고, **원가율은 그 둘의 합**이다
  // (61건 산출물 전수 대조로 확인). 반올림 전 값을 더하면 합이 1 자리에서 어긋나는 달이 생긴다.
  const foodPct = asPct(foodRateOf(row));
  const laborPct = asPct(laborRateOf(row));
  const primePct = foodPct === null || laborPct === null ? null : r1(foodPct + laborPct);
  const innerL = CONTENT_L + 12;

  text(ctx, "PRIME COST", innerL, top + 9 + 10 * ASC, { color: C.muted, weight: 700, size: 10 });

  // 값 줄 — 20px 굵은 수치 + 그 옆 10px 설명
  const valueTop = top + 9 + 10 * LINE + 2;
  const valueBase = valueTop + 20 * ASC;
  const valueText = pctText(primePct);
  text(ctx, valueText, innerL, valueBase, { color: C.navy, weight: 900, size: 20 });
  let x = innerL + widthOf(ctx, valueText, 900, 20) + 6;
  const put = (s: string, weight: number, color: string) => {
    text(ctx, s, x, valueBase, { color, weight, size: 10 });
    x += widthOf(ctx, s, weight, 10);
  };
  put("식재료 ", 400, C.muted);
  put(pctText(foodPct), 700, C.navy);
  put(" + 인건비 ", 400, C.muted);
  put(pctText(laborPct), 700, C.navy);

  // 게이지 — 트랙 22~337.7(폭 315.7), 높이 15, y = top+60 (실측 761 − 701)
  const trackX = innerL;
  const trackW = CONTENT_R - 12 - trackX;
  const barTop = top + 60;
  const barH = 15;
  roundRect(ctx, C.rowLine, trackX, barTop, trackW, barH, barH / 2);

  if (primePct !== null && primePct > 0 && foodPct !== null) {
    const fillW = (Math.min(100, primePct) / 100) * trackW;
    const foodW = (foodPct / primePct) * fillW;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(trackX, barTop, fillW, barH, barH / 2);
    ctx.clip();
    fillRect(ctx, C.food, trackX, barTop, foodW, barH);
    fillRect(ctx, C.amber, trackX + foodW, barTop, fillW - foodW, barH);
    ctx.restore();
    // 구간 폭이 글자보다 좁으면 생략한다 — 넘치면 옆 구간을 침범해 읽을 수 없다.
    const seg = (label: string, segX: number, segW: number) => {
      if (segW < widthOf(ctx, label, 700, 9) + 6) return;
      text(ctx, label, segX + segW / 2, barTop + (barH - 9 * LINE) / 2 + 9 * ASC, {
        color: C.white, weight: 700, size: 9, align: "center",
      });
    };
    seg(pctText(foodPct), trackX, foodW);
    seg(pctText(laborPct), trackX + foodW, fillW - foodW);
  }

  // 목표선 — 게이지 위아래로 3px 씩 튀어나오고, 위에 라벨
  const targetX = trackX + PRIME_TARGET * trackW;
  fillRect(ctx, C.red, targetX - 1, barTop - 3, 2, barH + 6);
  text(ctx, `목표 ${Math.round(PRIME_TARGET * 100)}%`, targetX, barTop - 5, {
    color: C.red, weight: 700, size: 9, align: "center",
  });

  // 범례
  const legendY = barTop + barH + 7;
  let lx = trackX;
  const legend = (color: string, label: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lx + 3, legendY, 3, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, label, lx + 9, legendY + 9 * 0.36, { color: C.muted2, weight: 400, size: 9 });
    lx += 9 + widthOf(ctx, label, 400, 9) + 8;
  };
  legend(C.food, `식재료율 ${pctText(foodPct)}`);
  legend(C.amber, `인건비율 ${pctText(laborPct)}`);
  legend(C.red, `목표 ${Math.round(PRIME_TARGET * 100)}%`);
}

function drawStatCards(ctx: CanvasRenderingContext2D, top: number, current: PnlDbRow, previous: PnlDbRow | null) {
  roundRect(ctx, C.white, CONTENT_L, top, CONTENT_W, STAT_CARD_H, 10);
  const midX = CONTENT_L + CONTENT_W / 2;
  fillRect(ctx, C.rowLine, midX, top, 1, STAT_CARD_H);

  const cell = (left: number, right: number, label: string, value: number, unit: string, prev: number | null) => {
    const innerL = left + 10;
    const innerR = right - 10;
    text(ctx, label, innerL, top + 9 + 10 * ASC, { color: C.muted, weight: 500, size: 10 });

    // 전월비 뱃지 — 오르면 좋은 값이라 상승이 초록이다(05 의 badge-up / badge-dn).
    if (prev !== null && prev > 0 && value > 0) {
      const r = ((value - prev) / prev) * 100;
      const tone: Tone = r > 0 ? "good" : r < 0 ? "bad" : "flat";
      const s = r > 0 ? `▲+${r.toFixed(1)}%` : r < 0 ? `▼${r.toFixed(1)}%` : "0.0%";
      const w = widthOf(ctx, s, 700, 9) + 8;
      const bTop = top + 9;
      roundRect(ctx, toneSoft(tone), innerR - w, bTop, w, 15, 4);
      text(ctx, s, innerR - 4, bTop + 3 + 9 * ASC, { color: toneColor(tone), weight: 700, size: 9, align: "right" });
    }

    const valueBase = top + 9 + 10 * LINE + 4 + 17 * ASC;
    if (value > 0) {
      const s = won(value);
      text(ctx, s, innerL, valueBase, { color: C.navy, weight: 900, size: 17 });
      text(ctx, unit, innerL + widthOf(ctx, s, 900, 17) + 2, valueBase, { color: C.navy, weight: 500, size: 10 });
    } else {
      text(ctx, "—", innerL, valueBase, { color: C.navy, weight: 900, size: 17 });
    }
  };

  cell(CONTENT_L, midX, "객단가", current.객단가, "원", previous?.객단가 ?? null);
  cell(midX + 1, CONTENT_R, "영수건수", current.영수건수, "건", previous?.영수건수 ?? null);
}

// ── 진입점 ───────────────────────────────────────────────

/**
 * 캔버스에 쓸 글꼴을 확실히 불러온다.
 *
 * [왜 `document.fonts.ready` 만으로는 안 되나] `ready` 는 **이미 요청된** 글꼴이 다 도착했을 때
 * 풀린다. 캔버스는 문서 레이아웃에 없으므로, 그 무게(weight)가 화면 어디에도 안 쓰였다면 애초에
 * 요청조차 되지 않아 `ready` 가 즉시 풀리고 대체 글꼴로 그려진다. 그래서 `load()` 로 직접 요청한다.
 *
 * 두 번째 인자(표본 글자)가 중요하다 — fonts.css 는 한글·라틴·기호를 unicode-range 로 나눠 두었고,
 * `load()` 는 **그 글자를 담당하는 조각만** 받는다. 한글·숫자·%·▲▼ 를 모두 넣어야 조각이 다 온다.
 * 무게 600(thead·연월 알약)은 파일이 없어 브라우저가 700 으로 맞춰 그린다 — 05 원본도 같다.
 */
async function ensureFonts(): Promise<void> {
  const fonts = document.fonts;
  if (!fonts) return;
  const sample = "가나다라마0123456789,.%p+-▲▼·&원건";
  try {
    await Promise.all([400, 500, 700, 900].map((w) => fonts.load(`${w} 16px "Noto Sans KR"`, sample)));
    // `ready` 도 반드시 같은 try 안에 둔다 — 밖에 두면 여기서 거부될 때 그리기 자체가 죽어
    // "글꼴을 못 받아도 계속 그린다"는 위 약속이 깨진다(Codex 지적 2026-08-10).
    await fonts.ready;
  } catch {
    // 글꼴을 못 받아도 그리기는 계속한다(대체 글꼴로 나올 뿐, 빈손으로 돌려주는 것보다 낫다).
  }
}

/**
 * 05 `_detail.png` 형태의 손익계산서 PNG 를 그려 Blob 으로 돌려준다.
 * 브라우저에서만 동작한다(캔버스·document.fonts 를 쓴다).
 */
export async function renderPnlDetailPng(input: PnlDetailImageInput): Promise<Blob> {
  await ensureFonts();

  const rows = buildStatementRows(input.current, input.previous);
  const { tableBottom, height } = planLayout(rows);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(PAGE_W * SCALE);
  canvas.height = Math.round(height * SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 만들지 못했습니다 (캔버스를 열 수 없습니다)");
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";
  fillRect(ctx, C.bg, 0, 0, PAGE_W, height);

  drawHeader(ctx, input);
  drawSectionTitle(ctx, "손익계산서", 71);
  drawStatement(ctx, rows);

  let y = tableBottom + GAP;
  fillRect(ctx, C.line, CONTENT_L, y, CONTENT_W, 1);
  y += 1 + GAP;
  drawPrimeCard(ctx, y, input.current);
  y += PRIME_CARD_H + GAP;
  fillRect(ctx, C.line, CONTENT_L, y, CONTENT_W, 1);
  y += 1 + GAP;
  drawSectionTitle(ctx, "객단가 & 영수건수", y);
  y += SEC_TITLE_H + 6;
  drawStatCards(ctx, y, input.current, input.previous);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("이미지를 만들지 못했습니다 (PNG 변환 실패)"))),
      "image/png"
    );
  });
}

/** 저장 파일명 — `2026-07_남산광어_손익계산서.png` */
export function pnlDetailFileName(branch: string, month: string): string {
  return `${month}_${branch.replace(/\s+/g, "_")}_손익계산서.png`;
}
