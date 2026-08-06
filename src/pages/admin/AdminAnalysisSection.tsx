// src/pages/admin/AdminAnalysisSection.tsx
// 관리자 > 분석 — 데이터 원천은 04 에이전트의 db파일.xlsx(손익DB). 세 하위탭으로 나눈다(2026-07-22 사용자 지시):
//   · 손익 종합(summary)      = 로컬 05 hq_dashboard: 전사 KPI + 경보 배지 + 지점별 손익 순위표(막대·배지) + 본사 정산
//   · 손익 차트(charts)       = 로컬 05 hq_charts  : 전사 추이 2종 + 지점 포지셔닝 산점도 3종
//   · 지점 손익계산서(branch) = 로컬 05 branch(_detail): KPI + PRIME 게이지 + 손익계산서 표 + 지점 추이
//
// 표는 텍스트만 나열하지 않는다 — 매출·생산성엔 인라인 막대, PRIME·MOM 은 상태 배지, 손익계산서는
// 매출부/지출부 밴드로 시각화한다(05 PNG 와 같은 문법, 색은 관리자 토큰만).
//
// 매월 갱신: 'db파일 업로드'(브라우저 파싱 → shared_data/analysis_pnl_db). 초기 적재는 scripts/seed-analysis-pnl.mjs.
// 산식 출처는 helpers/pnlDb.ts 머리주석(parse_db.py 그대로). 전사 합산·순위는 본사 행 제외(이중계상 방지).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { gasClient } from "../../api/gasClient";
import LoadingSpinner from "../../components/LoadingSpinner";
import { formatNumber } from "../../utils/formatNumber";
// 휴업 지점은 관리자 화면에서 감춘다 — 목록·이유는 helpers/closedBranches.ts
import { isClosedBranch } from "./helpers/closedBranches";
import { SalesLineChart, formatCompactWon } from "./SalesLineChart";
import { PnlScatterChart } from "./PnlScatterChart";
import { PnlComboChart, PnlHBarChart } from "./PnlBarCharts";
import {
  ALERT_FOOD_RATE, ALERT_LABOR_RATE, ALERT_PROFIT_RATE, PRIME_TARGET, HQ_NAME,
  availableMonths, branchRowsOf, buildStatement, foodRateOf, formatRate,
  hqRowOf, hqTotalsOf, laborRateOf, monthsBack, normalizePayload, prevMonthOf, primeOf, productivityOf,
  profitRateOf, ratePointDelta, rowOf, rowsFromSheetJson, turnoverOf, buildPnlSummary,
  buildHqOverview, hqFiguresOf,
  type PnlDbPayload, type PnlDbRow, type SummaryCol, type SummaryTone, type HqStatementLine,
} from "./helpers/pnlDb";

export type AnalysisView = "summary" | "charts" | "branch";

const DATA_KEY = "analysis_pnl_db";
const TREND_MONTHS = 6; // 05 대시보드 추이와 동일

// ── 작은 시각 요소들 ──────────────────────────────────────

/** 금액·건수 증감(오르면 좋음=초록). 관리자 스코프 색 치환 때문에 전용 클래스(DESIGN_ADMIN §4-2). */
function MoneyDelta({ current, previous }: { current: number; previous: number | null | undefined }) {
  if (previous === null || previous === undefined || previous === 0) return <span className="admin-delta admin-delta-flat font-mono font-black">—</span>;
  const ratio = (current - previous) / previous;
  const direction = ratio > 0 ? "up" : ratio < 0 ? "down" : "flat";
  return (
    <span className={`admin-delta admin-delta-${direction} font-mono font-black`}>
      {direction === "up" ? "▲" : direction === "down" ? "▼" : ""}{ratio > 0 ? "+" : ""}{(ratio * 100).toFixed(1)}%
    </span>
  );
}

/** 비율 %p 증감. goodWhenUp=false(비용 비율)는 상승=빨강으로 색 반전. */
function RateDelta({ current, previous, goodWhenUp = true }: { current: number | null; previous: number | null; goodWhenUp?: boolean }) {
  if (current === null || previous === null) return <span className="admin-delta admin-delta-flat font-mono font-black">—</span>;
  const diff = current - previous;
  const isGood = diff === 0 ? null : goodWhenUp ? diff > 0 : diff < 0;
  const cls = isGood === null ? "admin-delta-flat" : isGood ? "admin-delta-up" : "admin-delta-down";
  return <span className={`admin-delta ${cls} font-mono font-black`}>{diff > 0 ? "▲" : diff < 0 ? "▼" : ""}{ratePointDelta(current, previous)}</span>;
}

/** 표 셀 인라인 막대 — 값 텍스트 뒤에 최댓값 대비 막대를 깐다(05 순위표의 생산성 막대 문법). */
function CellBar({ ratio, tone, children }: { ratio: number; tone: "alice" | "honey" | "vanilla"; children: ReactNode }) {
  return (
    <div className="admin-cell-bar">
      <div className={`admin-cell-bar-fill admin-cell-bar-${tone}`} style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }} />
      <span className="admin-cell-bar-text font-mono">{children}</span>
    </div>
  );
}

/** 손익 요약표 전월비 텍스트 — good/bad/flat 색 + 특수 라벨(적자전환 등) 그대로 표시. */
function SummaryMomText({ mom, tone }: { mom: string; tone?: SummaryTone }) {
  const resolved: SummaryTone = tone ?? (mom.startsWith("+") || mom === "흑자전환" || mom === "적자축소" ? "good" : mom.startsWith("-") || mom === "적자전환" || mom === "적자확대" ? "bad" : "flat");
  const cls = resolved === "good" ? "admin-delta-up" : resolved === "bad" ? "admin-delta-down" : "admin-delta-flat";
  return <span className={`${cls} font-mono font-black`}>{mom}</span>;
}

/** 손익 요약표 한 항목(금액/%/전월비) 셀 3개. negBad=true(이익 열)면 음수 금액을 빨강으로. */
function renderSummaryCells(col: SummaryCol, key: number, negBad?: boolean) {
  return (
    <Fragment key={key}>
      {/* admin-group-end = 항목 그룹(매출/인건비/…) 경계선. nth-child 로 그으면 colSpan 쓰는 정산부 행과
          마지막 이익비중 칸에서 위치가 어긋난다(Codex P2) — 셀에 직접 클래스로 박는다.
          [왜 '끝' 칸인가 — 2026-08-03] 예전엔 그룹의 **첫 칸 왼쪽**(admin-group-start)에 그었다.
          그런데 표의 다른 세로선(본문 격자·헤더 격자)은 전부 **칸의 오른쪽**에 그린다. 경계가 같은 자리인데
          한쪽은 왼쪽, 한쪽은 오른쪽에 그리니 **선 두 개가 나란히 서서 겹쳐 보였다**(사용자 지적).
          그룹의 **마지막 칸 오른쪽**으로 옮겨 다른 선들과 같은 픽셀에 겹치게 했다 — 이제 한 줄이다. */}
      <td className={`py-1.5 px-2 text-right font-mono font-bold ${negBad && col.amount < 0 ? "admin-rate-hot" : "text-gray-700"}`}>{formatNumber(col.amount)}</td>
      <td className="py-1.5 px-2 text-right font-mono text-gray-400">{col.share === null ? "—" : `${(col.share * 100).toFixed(1)}%`}</td>
      <td className="admin-group-end py-1.5 px-2 text-right"><SummaryMomText mom={col.mom} tone={col.tone} /></td>
    </Fragment>
  );
}

/** 본사 손익계산서 한 행. 합계·이익금 행은 강조, 이익금 음수는 빨강. */
function renderHqLine(line: HqStatementLine) {
  const strong = line.kind === "salesTotal" || line.kind === "expenseTotal";
  const profit = line.kind === "profit";
  return (
    <tr key={line.label} className={profit ? "admin-hq-profit" : strong ? "admin-statement-strong" : ""}>
      <td className={`py-1.5 px-2 ${strong || profit ? "font-black" : "font-bold text-gray-600 pl-4"}`}>{line.label}</td>
      <td className={`py-1.5 px-2 text-right font-mono ${strong || profit ? "font-black" : "font-bold text-gray-700"} ${profit && line.amount < 0 ? "admin-rate-hot" : ""}`}>
        {formatNumber(line.amount)}
      </td>
      <td className="py-1.5 px-2 text-right font-mono text-gray-400">{formatRate(line.share)}</td>
      <td className="py-1.5 px-2 text-right">{line.mom ? <SummaryMomText mom={line.mom} tone={line.tone} /> : null}</td>
    </tr>
  );
}

/**
 * 결산월 드롭다운 — 줄의 **맨 왼쪽**에 둔다(사용자 지시 2026-08-03).
 * "지금 몇 월을 보고 있나"는 화면 해석의 전제라, 오른쪽 끝 도구 묶음에 섞이면 눈에 안 들어온다.
 * 칩 모양·색은 `.admin-band-filters`(흰 바탕)가 정한다 — 여기서 다시 칠하지 않는다.
 *
 * 목록은 **최신월이 맨 위**다(사용자 지시 2026-08-06). 실제로 보는 건 거의 언제나 최근 달인데
 * 오름차순이면 매달 스크롤을 더 내려야 했다. 원본 `months`(오름차순)는 업로드 안내의 기간 표시
 * (`months[0] ~ 마지막`)와 기본 선택월(`마지막`)이 그대로 쓰므로, 뒤집기는 **표시 직전에만** 한다.
 */
function AnalysisMonthPicker({ month, months, onChange }: { month: string; months: string[]; onChange: (v: string) => void }) {
  if (months.length === 0) return null;
  const descending = [...months].reverse();
  return (
    <div className="admin-band-filters">
      <select value={month} onChange={(e) => onChange(e.target.value)} aria-label="결산월 선택">
        {descending.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  );
}

/**
 * 분석 탭 공통 컨트롤 — 월 선택 · db파일 업로드 · 새로고침.
 *
 * 예전에는 화면 맨 위에서 **한 줄(카드 하나)을 통째로** 차지했다. 정작 매달 바꾸는 건 월 하나뿐인데
 * 표가 그만큼 아래로 밀렸다(2026-08-03 사용자 지시로 정리). 이제 탭마다 이미 있는 줄
 * ([손익 종합|본사 종합] 칩 · 지점 드롭다운) **오른쪽 끝**에 얹는다.
 *
 * 크기·모양은 `.admin-band-filters`(DESIGN_ADMIN.md §4-0)를 그대로 빌린다 — 값을 새로 정하지 않아야
 * 다른 화면 필터와 같은 덩치로 유지된다. `ml-auto` 로 그 줄의 오른쪽 끝에 붙는다.
 */
function AnalysisTopControls({ onUpload, uploading, onRefresh, loading, uploadedAtLabel }: {
  onUpload: (file: File) => void;
  uploading: boolean;
  onRefresh: () => void;
  loading: boolean;
  uploadedAtLabel: string;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="admin-band-filters ml-auto">
      <input ref={fileRef} type="file" accept=".xlsx" className="hidden" aria-label="db파일 업로드"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          // 같은 파일을 다시 올릴 수 있게 값을 비운다 — 안 비우면 두 번째부터 change 가 안 뜬다.
          e.target.value = "";
        }} />
      {/* 마지막 업로드 시각은 줄을 하나 더 쓰지 않도록 **툴팁**으로 옮겼다(마우스를 올리면 보인다). */}
      <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
        title={uploadedAtLabel ? `마지막 업로드: ${uploadedAtLabel}` : "04 에이전트의 db파일.xlsx 를 올립니다"}>
        {uploading ? "업로드 중…" : "db파일"}
      </button>
      <button type="button" onClick={onRefresh} disabled={loading}>
        {loading ? "불러오는 중…" : "새로고침"}
      </button>
    </div>
  );
}

/* [2026-08-03] 지점 손익계산서의 지점 선택은 **드롭다운**이다(사용자 지시).
   2026-07-23에 '드롭다운이 불편하다'는 지시로 전 지점을 한 줄에 펼치는 칩(BranchTabPicker)을 썼었는데,
   지점이 늘어 칩 줄이 두 줄로 접히면서 월 선택·업로드 같은 공통 컨트롤을 같은 줄에 얹을 자리가 없어졌다.
   그래서 칩 구현은 걷어내고 select 로 되돌렸다(구현을 남겨 두면 죽은 코드가 된다 — 필요하면 이 커밋에서 꺼낸다). */

/** PRIME 상태 배지 — 목표(60%) 이하 허니 / 60~70 바닐라 / 70 초과 빨강(05 PNG 의 PRIME 배지). */
function PrimeBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="admin-delta-flat font-mono font-black">—</span>;
  const cls = value <= PRIME_TARGET ? "admin-pnl-badge-good" : value <= 0.7 ? "admin-pnl-badge-warn" : "admin-pnl-badge-bad";
  return <span className={`admin-pnl-badge ${cls} font-mono`}>{formatRate(value)}</span>;
}

// ── 본체 ────────────────────────────────────────────────

export function AdminAnalysisSection({ view }: { view: AnalysisView }) {
  const [payload, setPayload] = useState<PnlDbPayload | null>(null);
  const [month, setMonth] = useState<string>("");
  const [branchPick, setBranchPick] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string>("");
  // 요약표에서 클릭한 행(지점명/정산부 라벨) — 읽기 전용 표라 focus-within 이 없어 클릭으로 커서 띠를 준다(§9-3).
  const [activeSummaryRow, setActiveSummaryRow] = useState<string | null>(null);
  // 손익 종합 페이지 상단 모드 탭: 요약표(table) / 본사 종합(trend, 전지점 총합이라 지점 선택 없음).
  const [summaryMode, setSummaryMode] = useState<"table" | "trend">("table");
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setLoadError(false);
    try {
      const value = await gasClient.getSharedDataFromServer<unknown>(DATA_KEY);
      if (requestRef.current !== requestId) return;
      const normalized = normalizePayload(value);
      setPayload(normalized);
      if (normalized) {
        const months = availableMonths(normalized.rows);
        setMonth((current) => (current && months.includes(current) ? current : months[months.length - 1] || ""));
      }
    } catch (error) {
      console.error("손익DB 로드 실패:", error);
      if (requestRef.current !== requestId) return;
      setPayload(null);
      setLoadError(true);
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { requestRef.current++; };
  }, [load]);

  /** db파일.xlsx 업로드 — 손익DB 시트를 브라우저에서 파싱해 같은 키에 저장(월별 갱신 경로). */
  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadMessage("");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer());
      const sheet = wb.Sheets["손익DB"];
      if (!sheet) { setUploadMessage(`업로드 실패: '손익DB' 시트가 없습니다 (시트: ${wb.SheetNames.join(", ")})`); return; }
      const { rows, missingColumns } = rowsFromSheetJson(XLSX.utils.sheet_to_json(sheet, { defval: null }) as any[]);
      if (missingColumns.length) { setUploadMessage(`업로드 실패: 필수 컬럼 누락 — ${missingColumns.join(", ")}`); return; }
      if (rows.length === 0) { setUploadMessage("업로드 실패: 읽을 수 있는 행이 없습니다."); return; }
      const months = availableMonths(rows);
      // [P0-2 fail-closed] 저장 직전 서버에서 현재값을 '신선하게' 다시 읽는다. 화면 상태(payload)를 기준으로 삼으면
      //   ① 로드 실패 상태에서 업로드 시 branchOps(테이블수·휴무일)가 빈 객체로 지워지고
      //   ② 행수 급감 가드(currentCount=0)가 통째로 우회된다 (Codex P0 지적).
      // 재조회가 실패하면 업로드를 막는다 — 못 읽은 채 덮어쓰면 무엇을 지우는지 모른 채 지우는 것이다.
      let fresh: ReturnType<typeof normalizePayload>;
      try {
        fresh = normalizePayload(await gasClient.getSharedDataFromServer<unknown>(DATA_KEY));
      } catch {
        setUploadMessage("업로드 중단: 서버의 기존 데이터를 확인하지 못했습니다. 네트워크 확인 후 다시 시도해주세요.");
        return;
      }
      // 다른 컴퓨터에서 방금 갱신됐으면 알리고 확인을 받는다(완전한 동시성 제어는 아니지만,
      // 월 1회·관리자 1명 워크플로에서 '모르고 덮어쓰는' 사고는 이것으로 잡힌다).
      if (fresh?.uploadedAt && payload?.uploadedAt && fresh.uploadedAt !== payload.uploadedAt) {
        const ok = window.confirm(`다른 곳에서 ${new Date(fresh.uploadedAt).toLocaleString("ko-KR")} 에 이미 갱신했습니다.\n그 데이터를 이 파일로 덮어쓸까요?`);
        if (!ok) { setUploadMessage("업로드를 취소했습니다. 새로고침 후 다시 확인해주세요."); return; }
      }
      // 행이 크게 줄어드는 업로드(잘못된 파일)를 조용히 덮어쓰지 않게 확인을 받는다 — 기준은 서버의 신선값.
      const currentCount = fresh?.rows.length ?? 0;
      if (currentCount > 0 && rows.length < currentCount * 0.7) {
        const ok = window.confirm(`업로드 파일이 ${rows.length}행으로 기존(${currentCount}행)보다 크게 적습니다.\n정말 이 파일로 덮어쓸까요?`);
        if (!ok) { setUploadMessage("업로드를 취소했습니다."); return; }
      }
      // 테이블수·휴무일(branchOps)은 db파일에 없으므로 서버의 신선값을 유지한다.
      await gasClient.saveSharedData(DATA_KEY, {
        rows,
        branchOps: fresh?.branchOps || payload?.branchOps || {},
        uploadedAt: new Date().toISOString(),
        uploadedBy: "관리자 화면 업로드",
      });
      setUploadMessage(`업로드 완료: ${rows.length}행 · ${months[0]} ~ ${months[months.length - 1]}`);
      await load();
    } catch (error) {
      console.error("db파일 업로드 실패:", error);
      setUploadMessage("업로드 실패: 파일을 처리하지 못했습니다. 네트워크 상태 확인 후 다시 시도해주세요.");
    } finally {
      setUploading(false);
      // 고른 파일을 비우는 일은 <input> 을 들고 있는 AnalysisTopControls 가 맡는다
      // (같은 파일을 연달아 올릴 때 change 이벤트가 안 뜨는 것을 막는 처리다).
    }
  };

  const rows = payload?.rows || [];
  const ops = payload?.branchOps || {};
  const months = useMemo(() => availableMonths(rows), [rows]);
  const curRows = useMemo(() => branchRowsOf(rows, month), [rows, month]);
  // [선택한 달 기준] 전 기간에 한 번이라도 나온 지점을 전부 뿌리면, 그 달에 없는 지점(개점 전·폐점 후)까지
  // 고를 수 있어 "데이터가 없습니다"만 뜬다(2026-07-23 사용자 지적 — 대골뼈국은 2026-04 한 달치뿐).
  // 그 달에 행이 있는 지점만 세운다. 달을 바꾸면 목록이 그 달 것으로 갈리고, 선택도 아래 branch 에서 보정된다.
  // [휴업 지점은 '지점 선택'에서만 뺀다 — 사용자 결정 2026-08-03]
  // 요약표·순위표·전사 합계에서는 빼지 않는다. 그쪽은 04 db파일을 셀 단위로 재현한 값이라
  // 한 지점을 덜어내면 **과거 달의 총매출·소계가 원본 엑셀과 달라진다**(결산 검증에 쓰는 숫자다).
  // 앞으로 그 지점 행은 db파일에 안 들어오므로, 고를 수 있는 목록에서만 감추면 충분하다.
  const branchNames = useMemo(
    () => Array.from(new Set<string>(
      curRows.filter((r) => r.지점 !== HQ_NAME && !isClosedBranch(r.지점)).map((r) => r.지점)
    )).sort((a, b) => a.localeCompare(b, "ko")),
    [curRows]
  );
  const prevRows = useMemo(() => branchRowsOf(rows, prevMonthOf(month)), [rows, month]);
  const totals = useMemo(() => hqTotalsOf(curRows), [curRows]);


  const hqRow = useMemo(() => hqRowOf(rows, month), [rows, month]);
  const prevHqRow = useMemo(() => hqRowOf(rows, prevMonthOf(month)), [rows, month]);
  // 손익 요약표(05 산출물 "손익요약표_증감률" 재현) — 2026-06 엑셀과 셀 단위 대조 검증됨(pnlDb.ts).
  const summaryTable = useMemo(
    () => (curRows.length > 0 ? buildPnlSummary(curRows, prevRows, hqRow, prevHqRow) : null),
    [curRows, prevRows, hqRow, prevHqRow]
  );
  const trendMonths = useMemo(() => monthsBack(month, TREND_MONTHS), [month]);

  // 순위표: 이익금 내림차순(2026-07-22 사용자 지시 — 비율보다 실제 벌어들인 금액 순으로 본다).
  const ranked = useMemo(() => [...curRows].sort((a, b) => b.이익금 - a.이익금), [curRows]);
  // 손익 차트 탭의 '이익률·생산성' 가로막대는 라벨대로 이익률 순을 유지한다(순위표와 목적이 다름).
  const rankedByProfitRate = useMemo(
    () => [...curRows].sort((a, b) => (profitRateOf(b) ?? -Infinity) - (profitRateOf(a) ?? -Infinity)),
    [curRows]
  );
  const maxSales = useMemo(() => Math.max(1, ...curRows.map((r) => r.총매출)), [curRows]);
  const maxProductivity = useMemo(() => Math.max(1e-9, ...curRows.map((r) => productivityOf(r) ?? 0)), [curRows]);

  // 지점 탭에서 쓸 지점 — 아직 안 골랐거나 데이터에서 사라졌으면 그 달 매출 1위 지점으로.
  // [기본값도 반드시 '고를 수 있는 목록(branchNames)' 안에서 고른다]
  // curRows 에는 휴업 지점·본사 행이 그대로 남아 있다(요약표·합계는 원본 그대로 둬야 하므로).
  // 거기서 1위를 뽑으면 **드롭다운에 없는 지점이 화면에 떠 버린다** — 감췄다고 생각한 지점이
  // 기본값으로 되살아나는 셈이다(코덱스 stop-time 2026-08-03).
  const branch = useMemo(() => {
    if (branchPick && branchNames.includes(branchPick)) return branchPick;
    const top = curRows
      .filter((r) => branchNames.includes(r.지점))
      .sort((a, b) => b.총매출 - a.총매출)[0];
    return top?.지점 || branchNames[0] || "";
  }, [branchPick, branchNames, curRows]);

  const branchRow = branch ? rowOf(rows, branch, month) : null;
  const branchPrevRow = branch ? rowOf(rows, branch, prevMonthOf(month)) : null;
  const statement = useMemo(() => (branchRow ? buildStatement(branchRow, branchPrevRow) : []), [branchRow, branchPrevRow]);

  const money = (v: number) => `${formatNumber(v)}원`;
  const percentValue = (v: number) => `${(v * 100).toFixed(1)}%`;
  const percentAxis = (v: number) => `${Math.round(v * 100)}%`;

  // ── 본사 종합 ──
  const hqOverview = useMemo(() => buildHqOverview(rows, month), [rows, month]);
  /** 달별 본사 표시값을 한 번만 계산해 재사용한다 — hqFiguresOf 는 호출마다 전체 행을 훑으므로
   *  차트 3계열 × 6개월을 매번 부르면 같은 스캔을 수십 번 반복한다(Codex 지적). */
  const hqFiguresByMonth = useMemo(
    () => new Map(trendMonths.map((m) => [m, hqFiguresOf(rows, m)] as const)),
    [trendMonths, rows]
  );
  /** 본사 행이 있는 달만 x축에 세운다 — 없는 달까지 세우면 빈 칸만 늘어난다(본사 행은 2026-05부터 있다). */
  const hqTrendMonths = useMemo(
    () => trendMonths.filter((m) => hqFiguresByMonth.get(m) != null),
    [trendMonths, hqFiguresByMonth]
  );
  const hqTrendVals = (pick: (f: NonNullable<ReturnType<typeof hqFiguresOf>>) => number | null): Array<number | null> =>
    hqTrendMonths.map((m) => { const f = hqFiguresByMonth.get(m); return f ? pick(f) : null; });

  /** 그 달의 대상 행 — target=null 이면 전사(본사 제외), 아니면 그 지점 1곳 */
  const monthRowsOf = (target: string | null, m: string): PnlDbRow[] =>
    target === null ? branchRowsOf(rows, m) : (() => { const r = rowOf(rows, target, m); return r ? [r] : []; })();

  /** 선그래프용 추이(두 계열) — SalesLineChart 는 두 계열을 '순번'으로 겹치므로, 각자 null 달을 버리면
   *  서로 다른 달이 같은 x에 겹쳐 가짜 추세가 된다(Codex P1). **두 값이 모두 있는 달만** 함께 남긴다. */
  const trendPairOf = (
    target: string | null,
    pickA: (rowsOfMonth: PnlDbRow[]) => number | null,
    pickB: (rowsOfMonth: PnlDbRow[]) => number | null
  ): { a: Array<{ x: string; y: number }>; b: Array<{ x: string; y: number }> } => {
    const paired = trendMonths
      .map((m) => {
        const monthRows = monthRowsOf(target, m);
        if (monthRows.length === 0) return null;
        const va = pickA(monthRows), vb = pickB(monthRows);
        return va !== null && vb !== null ? { m, va, vb } : null;
      })
      .filter((item): item is { m: string; va: number; vb: number } => item !== null);
    return {
      a: paired.map((p) => ({ x: p.m, y: p.va })),
      b: paired.map((p) => ({ x: p.m, y: p.vb })),
    };
  };

  /** 콤보(막대) 차트용 — 6개월 전체를 x축으로 두고 데이터 없는 달은 null(막대 생략). */
  const trendCats = trendMonths.map((m) => `${Number(m.slice(5, 7))}월`);
  const trendVals = (target: string | null, pick: (rowsOfMonth: PnlDbRow[]) => number | null): Array<number | null> =>
    trendMonths.map((m) => {
      const monthRows = monthRowsOf(target, m);
      return monthRows.length > 0 ? pick(monthRows) : null;
    });

  const uploadedAtLabel = payload?.uploadedAt ? new Date(payload.uploadedAt).toLocaleString("ko-KR") : "";

  return (
    <section className="space-y-5">
      {/* [2026-08-03 사용자 지시] 월 선택·db파일 업로드·새로고침이 화면 맨 위에서 **한 줄을 통째로**
          쓰고 있었다. 탭마다 이미 있는 줄(모드 칩 · 지점 선택) 오른쪽 끝에 얹어 세로 공간을 돌려준다.
          → 아래 각 탭의 `<AnalysisTopControls />` 참고. 여기는 안내 문구만 남긴다. */}
      {uploadMessage && (
        <p className={`text-[11px] font-black ${uploadMessage.startsWith("업로드 완료") ? "text-gray-500" : "admin-rate-hot"}`}>{uploadMessage}</p>
      )}

      {loadError && <p className="text-xs font-black text-rose-600">손익DB를 서버에서 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</p>}
      {!loading && !loadError && rows.length === 0 && (
        <p className="text-xs font-black text-rose-600">저장된 손익DB가 없습니다. 위의 'db파일 업로드'로 04 에이전트의 db파일.xlsx 를 올려주세요.</p>
      )}
      {loading && <div className="py-16 text-center"><LoadingSpinner size="md" /></div>}
      {!loading && rows.length > 0 && curRows.length === 0 && (
        <p className="text-xs font-black text-rose-600">{month} 데이터가 없습니다. db파일을 갱신해 업로드해주세요.</p>
      )}

      {/* ── 탭별 상단 줄 (2026-08-03) ─────────────────────────────────────────────────
          공통 컨트롤(월·db파일 업로드·새로고침)을 예전엔 화면 맨 위 카드가 한 줄 통째로 들고 있었다.
          그걸 없애고 탭마다 이미 있는 줄(모드 칩·지점 드롭다운) 오른쪽 끝에 얹었다.

          [P0] 이 줄은 **데이터가 없어도 반드시 그린다.** 탭 본문(`curRows.length > 0`) 안에 넣었더니
          손익DB가 비었을 때 업로드 버튼까지 같이 사라져, "db파일 업로드로 올려주세요" 안내만 뜨고
          정작 올릴 방법이 없는 막다른 화면이 됐다(코덱스 리뷰 2026-08-03). 그래서 본문과 분리한다.
          ──────────────────────────────────────────────────────────────────────── */}
      {view === "summary" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <AnalysisMonthPicker month={month} months={months} onChange={setMonth} />
          {/* 모드 탭: [손익 종합]=요약표·순위표 / [본사 종합]=05 본사 대시보드(KPI·추이·손익계산서) */}
          {[{ id: "table", label: "손익 종합" }, { id: "trend", label: "본사 종합" }].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setSummaryMode(m.id as "table" | "trend")}
              aria-pressed={summaryMode === m.id}
              className={`admin-period-chip h-8 px-3.5 rounded-full text-[11px] font-black ${summaryMode === m.id ? "is-active" : ""}`}
            >
              {m.label}
            </button>
          ))}
          <AnalysisTopControls
            onUpload={(f) => void handleUpload(f)} uploading={uploading}
            onRefresh={() => void load()} loading={loading} uploadedAtLabel={uploadedAtLabel}
          />
        </div>
      )}
      {view === "charts" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <AnalysisMonthPicker month={month} months={months} onChange={setMonth} />
          <AnalysisTopControls
            onUpload={(f) => void handleUpload(f)} uploading={uploading}
            onRefresh={() => void load()} loading={loading} uploadedAtLabel={uploadedAtLabel}
          />
        </div>
      )}
      {view === "branch" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <AnalysisMonthPicker month={month} months={months} onChange={setMonth} />
          {/* 지점 선택 드롭다운. 크기·모양은 `.admin-band-filters` 를 빌린다(값 재정의 금지 — §4-0).
              지점 목록이 비어도(=DB 없음) 컨트롤 줄 자체는 남아야 업로드로 복구할 수 있다. */}
          {branchNames.length > 0 && (
            <div className="admin-band-filters">
              <select value={branch} onChange={(e) => setBranchPick(e.target.value)} aria-label="지점 선택" className="min-w-36">
                {branchNames.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          )}
          <AnalysisTopControls
            onUpload={(f) => void handleUpload(f)} uploading={uploading}
            onRefresh={() => void load()} loading={loading} uploadedAtLabel={uploadedAtLabel}
          />
        </div>
      )}

      {/* ─────────────── ① 손익 종합 ─────────────── */}
      {!loading && view === "summary" && curRows.length > 0 && (
        <>

          {/* 본사 종합 — 05 본사 대시보드/손익계산서 PNG 재현(전지점 총합 기준이라 지점 선택 없음).
              표시용 총매출=전지점 이익금 합계, 이익률 분모=전사 총매출. 산식·검증은 pnlDb.buildHqOverview. */}
          {summaryMode === "trend" && (
            hqOverview === null ? (
              <p className="text-xs font-black text-rose-600">{month} 본사 행이 db파일에 없습니다. (본사 종합은 본사 행이 있는 달만 표시됩니다)</p>
            ) : (
            <div className="admin-analysis-uniform space-y-5">
              <section className="admin-hq-kpi-grid">
                <div className="admin-hq-kpi">
                  {/* 본사의 '총매출'은 각 지점이 올린 이익금의 합계다(05 본사 대시보드와 같은 정의).
                      그냥 '총매출'이라고만 적으면 전 지점 매출 합계로 오해한다 — 괄호로 밝힌다(2026-07-23 사용자 지적). */}
                  <span>총매출 (지점 이익금 합계)</span>
                  <strong>{formatNumber(hqOverview.총매출)}</strong>
                  <small>
                    <SummaryMomText mom={hqOverview.lines.find((l) => l.label === "총매출")?.mom || "—"}
                      tone={hqOverview.lines.find((l) => l.label === "총매출")?.tone} />
                    {hqOverview.prev총매출 !== null && <span className="text-gray-400 ml-1.5">전월 {formatNumber(hqOverview.prev총매출)}</span>}
                  </small>
                </div>
                <div className="admin-hq-kpi">
                  <span>이익금 &amp; 이익률</span>
                  <strong>{formatNumber(hqOverview.이익금)} <em className="not-italic text-gray-500">{formatRate(hqOverview.이익률)}</em></strong>
                  <small>
                    <SummaryMomText mom={hqOverview.lines.find((l) => l.label === "이익금")?.mom || "—"}
                      tone={hqOverview.lines.find((l) => l.label === "이익금")?.tone} />
                    {hqOverview.prev이익금 !== null && <span className="text-gray-400 ml-1.5">전월 {formatNumber(hqOverview.prev이익금)}</span>}
                  </small>
                </div>
              </section>

              {/* 그래프와 손익계산서를 한 줄에 나란히 — 각각 전폭을 먹지 않게(2026-07-22 사용자 지시).
                  왼쪽=손익계산서 / 오른쪽=추이 (2026-07-23 사용자 지시로 좌우 교환 — 지점 손익계산서 탭과 같은 순서). */}
              <div className="admin-chart-grid">
              <section className="admin-sales-overview-section bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
                <h2 className="admin-pill-title">손익계산서</h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[440px] admin-hq-statement">
                    <thead>
                      <tr>
                        <th className="py-2 px-2 text-left">항목</th>
                        <th className="py-2 px-2 text-right">금액</th>
                        <th className="py-2 px-2 text-right">비율</th>
                        <th className="py-2 px-2 text-right">전월대비</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="admin-statement-band"><td colSpan={4} className="py-1 px-2 font-black text-[#212121]">매출</td></tr>
                      {hqOverview.lines.filter((l) => l.kind === "sales" || l.kind === "salesTotal").map((l) => renderHqLine(l))}
                      <tr className="admin-statement-band"><td colSpan={4} className="py-1 px-2 font-black text-[#212121]">지출</td></tr>
                      {hqOverview.lines.filter((l) => l.kind === "expense" || l.kind === "expenseTotal").map((l) => renderHqLine(l))}
                      {hqOverview.lines.filter((l) => l.kind === "profit").map((l) => renderHqLine(l))}
                    </tbody>
                  </table>
                </div>
                <p className="text-gray-400">비율은 총매출 대비(이익금만 전사 총매출 대비) · 총지출·이익금의 전월대비는 비율 증감(%p)</p>
              </section>

              <section className="admin-sales-overview-section bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
                <h2 className="admin-pill-title">매출 &amp; 이익 추이</h2>
                {/* '매출' 계열도 위 KPI·손익계산서와 같은 값(전 지점 이익금 합계)이다 — 범례에 그대로 밝힌다. */}
                <PnlComboChart
                  showValues
                  lineZeroBase={false}
                  categories={hqTrendMonths}
                  series={[
                    { label: "매출(지점 이익금 합계)", tone: "alice", values: hqTrendVals((f) => f.display매출) },
                    { label: "이익", tone: "vanilla", values: hqTrendVals((f) => f.이익금) },
                  ]}
                  line={{ label: "이익률(%)", values: hqTrendVals((f) => f.이익률) }} />
              </section>
              </div>
            </div>
            )
          )}

          {summaryMode === "table" && (<div className="admin-analysis-uniform space-y-5">
          {/* 손익 요약표 — 05 산출물 "손익요약표_증감률.xlsx" 재현(맨 위 배치, 2026-07-22 사용자 지시).
              읽기 전용 엑셀형(DESIGN.md §9): 바닐라+검정 격자 헤더(§9-1) · 헤더/매장명 열 스크롤 고정 ·
              클릭한 행에 §9-3 커서 띠. 재료비=식재료+주류원가 · 하단 정산부는 본사 행 기준. */}
          {summaryTable && (
            <section className="admin-sales-overview-section admin-summary-card bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {/* 제목 밴드 — 월말업무 > 제출현황 탭과 같은 문법(사용자 지시 2026-08-03).
                  제목을 알약으로 띄우지 않고 **표 전체 폭에 띠로 깐 뒤 컬럼 헤더를 바로 아래 붙인다.**
                  띠(연한 바닐라)와 컬럼 줄(엘리스)이 두 톤으로 갈라져, 어디까지가 제목이고
                  어디부터가 표인지 한눈에 나뉜다.
                  · 바닐라는 `bg-amber-50` 이 관리자 스코프에서 `--admin-vanilla` 로 치환된 값이다(DESIGN_ADMIN §3).
                  · 컬럼 줄의 엘리스는 `.admin-design-preview .admin-sales-overview-section th` 가 `!important` 로
                    이미 주고 있다 — 여기서 색을 또 주면 규칙이 두 곳으로 갈라진다.
                  · [주의] 띠는 스크롤 칸(.admin-summary-scroll) **바깥**에 둔다. 안에 넣으면 표를 옆으로
                    밀 때 제목까지 같이 밀려 나간다(제출현황도 같은 이유로 바깥에 있다).
                  · 카드에 `overflow-hidden` 이 필요하다 — 없으면 띠의 위쪽 모서리가 카드의 둥근 모서리
                    밖으로 삐져나온다. 대신 `p-5` 를 걷어내고 띠·각주가 각자 여백을 갖는다. */}
              {/* [높이 53px] 제출현황 밴드와 세로폭을 같게 맞춘다(사용자 지시 2026-08-03).
                  그쪽은 `py-2.5`(위아래 10px) + 안에 든 **h-8(32px) 다운로드 버튼** + 아래 선 1px = 53px 이다.
                  이 밴드에는 버튼이 없어 글자 높이(약 17px)만큼밖에 안 서므로, 같은 여백을 줘도 37px 에 그친다.
                  그래서 최소 높이를 직접 못 박는다 — `items-center` 라 내용은 가운데에 선다.
                  (box-sizing 이 border-box 라 53px 안에 위아래 여백 20px + 아래 선 1px 이 포함된다.) */}
              <div className="admin-band">
                {/* 제목만 14px(.admin-band-title) — 제출현황 밴드 제목과 같은 크기다.
                    분석 탭은 `.admin-analysis-uniform` 이 전부 11px 로 누르므로 **클래스로만** 예외를 준다
                    (여기에 text-sm 을 적으면 !important 에 덮여 죽은 코드가 된다). 설명 문구는 11px 유지. */}
                <h3 className="admin-band-title">손익 요약표</h3>
                <p className="admin-band-meta">{month} · 전월({prevMonthOf(month)}) 대비 증감 · 본사 손익요약표와 동일 산식 (매출 순) · 행을 클릭하면 표시됩니다</p>
              </div>
              <div className="admin-summary-scroll">
                <table className="w-full min-w-[1040px] admin-summary-table">
                  <thead className="text-center">
                    <tr>
                      <th rowSpan={2} className="admin-sum-h1 admin-summary-name py-2 px-2 text-left">구분</th>
                      {summaryTable.columns.map((c) => (
                        <th key={c} colSpan={3} className="admin-sum-h1 py-1.5 px-2">{c}</th>
                      ))}
                      {/* admin-col-last = 표의 맨 오른쪽 칸. 여기에 세로선을 그으면 바로 옆 카드 테두리와
                          검정 선이 두 줄로 붙어 보인다(index.css 의 .admin-col-last 참고). */}
                      <th rowSpan={2} className="admin-sum-h1 admin-col-last py-2 px-2 text-center">이익비중</th>
                    </tr>
                    <tr>
                      {summaryTable.columns.map((c) => (
                        ["금액", "%", "전월비"].map((s) => (
                          <th key={`${c}-${s}`} className="admin-sum-h2 py-1 px-2 text-center">{s}</th>
                        ))
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* 선택 키는 행 종류별 prefix 로 분리한다 — 지점명이 우연히 "소계"/"본사지출" 같은
                        라벨과 겹쳐도(업로드 파일은 지점명을 제한하지 않는다) 선택·스타일이 섞이지 않게(Codex 지적).
                        소계 스타일도 이름 비교가 아니라 isSubtotal 플래그로 판단한다. */}
                    {[
                      ...summaryTable.branches.map((row) => ({ row, akey: `branch:${row.지점}`, isSubtotal: false })),
                      { row: summaryTable.subtotal, akey: "subtotal", isSubtotal: true },
                    ].map(({ row, akey, isSubtotal }) => (
                      <tr
                        key={akey}
                        // 클릭한 행에 커서 띠를 준다. 키보드로도 같은 동작이 되게 tabIndex/Enter·Space 를 배선한다.
                        // role="button" 은 쓰지 않는다 — 행의 표 의미가 사라져 스크린리더가 셀을 못 읽는다.
                        // 표 구조를 지키면서 선택 상태만 알리는 aria-selected 를 쓴다(Codex 지적).
                        tabIndex={0}
                        aria-selected={activeSummaryRow === akey}
                        onClick={() => setActiveSummaryRow((cur) => (cur === akey ? null : akey))}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          setActiveSummaryRow((cur) => (cur === akey ? null : akey));
                        }}
                        className={`cursor-pointer ${isSubtotal ? "admin-statement-strong" : ""} ${activeSummaryRow === akey ? "admin-summary-row-active" : ""}`}
                      >
                        <td title={row.지점} className={`admin-summary-name py-1.5 px-2 whitespace-nowrap ${isSubtotal ? "font-black text-[#212121]" : "font-bold text-[#2C3E50]"}`}>{row.지점}</td>
                        {row.cols.map((col, ci) => renderSummaryCells(col, ci, ci === 4))}
                        {/* 이 칸(이익비중) 왼쪽 경계는 바로 앞 '이익' 그룹의 마지막 칸이 오른쪽에 긋는다 —
                            여기에 또 그으면 선이 두 줄이 된다. */}
                        <td className="py-1.5 px-2 text-right font-mono font-bold text-gray-500">
                          {row.profitShare === null ? "—" : isSubtotal ? "100%" : `${(row.profitShare * 100).toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                    {summaryTable.hq?.map((line) => (
                      <tr
                        key={`hq:${line.label}`}
                        tabIndex={0}
                        aria-selected={activeSummaryRow === `hq:${line.label}`}
                        onClick={() => setActiveSummaryRow((cur) => (cur === `hq:${line.label}` ? null : `hq:${line.label}`))}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          setActiveSummaryRow((cur) => (cur === `hq:${line.label}` ? null : `hq:${line.label}`));
                        }}
                        className={`cursor-pointer ${line.strong ? "admin-statement-strong" : "admin-summary-hq"} ${activeSummaryRow === `hq:${line.label}` ? "admin-summary-row-active" : ""}`}
                      >
                        {/* 경계선은 '그룹의 마지막 칸 오른쪽'에 그린다(renderSummaryCells 주석 참고).
                            이 행은 앞쪽을 colSpan 하나로 묶으므로, 그 칸이 곧 '기타' 그룹의 마지막 칸이다. */}
                        <td colSpan={13} className="admin-group-end py-1.5 px-2 text-right font-black text-[#212121]">{line.label}</td>
                        <td className={`py-1.5 px-2 text-right font-mono font-black ${line.amount < 0 ? "text-gray-500" : "text-[#1A3C6E]"}`}>{formatNumber(line.amount)}</td>
                        <td className="py-1.5 px-2" />
                        <td className="admin-group-end py-1.5 px-2 text-right"><SummaryMomText mom={line.mom} tone={line.tone} /></td>
                        <td className="py-1.5 px-2 text-right font-mono font-black text-[#212121]">{line.shareLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* 각주 — 카드에서 `p-5` 를 걷어냈으므로 이 묶음이 자기 여백을 갖는다.
                  표와 각주 사이에 옅은 선을 그어 "표가 여기서 끝났다"를 보이게 한다. */}
              <div className="px-4 py-3 space-y-2 border-t border-gray-100">
                {/* 본사 행이 없는 달은 소계에서 끝난다 — "형식이 다르다"로 오해하지 않게 이유를 밝힌다.
                    (db파일의 본사 행은 2026-05부터 존재하며, 05 산출물 손익요약표도 그 두 달치뿐이다) */}
                {summaryTable.hq === null && (
                  <p className="font-bold admin-rate-hot">
                    {month}은 db파일에 <b>본사 행</b>이 없어 하단 정산부(본사지출 · 합계 · 배당/인센 · 이익잉여금)를 계산할 수 없습니다 — 소계까지만 표시됩니다.
                  </p>
                )}
                <p className="font-bold text-gray-400">
                  전월대비: <span className="admin-delta-up font-black">초록=개선</span> / <span className="admin-delta-down font-black">빨강=악화</span> · 매출·이익 증가는 좋음, 인건비·재료비·기타 증가는 나쁨 · 신규=전월 데이터 없음 · 재료비=식재료+주류원가
                </p>
              </div>
            </section>
          )}

          {/* 제목 밴드 + 엑셀형 표 = 관리자 표준(DESIGN_ADMIN.md §4-0) */}
          <section className="admin-sales-overview-section admin-sheet-card">
            <div className="admin-band">
              <h3 className="admin-band-title">지점별 손익 순위</h3>
              <p className="admin-band-meta">{month} · 이익금 순. 막대 = 그 달 최댓값 대비. 붉은 값 = 경보 기준. MOM = 이익률 전월 대비(%p).</p>
            </div>
            <div className="admin-sheet-scroll">
              <table className="admin-sheet min-w-[1080px]">
                <thead>
                  <tr>
                    {["#", "지점", "매출", "이익금", "이익률", "식재료율", "인건비율", "PRIME", "생산성", "회전율", "객단가", "MOM"].map((h, i) => (
                      <th key={h} className={i >= 2 ? "text-right" : ""}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ranked.map((r, index) => {
                    const food = foodRateOf(r), labor = laborRateOf(r), profit = profitRateOf(r);
                    const productivity = productivityOf(r);
                    const prev = prevRows.find((p) => p.지점 === r.지점) || null;
                    const turnover = turnoverOf(r, ops);
                    return (
                      <tr key={r.지점}>
                        <td className="py-1.5 px-2 font-mono font-bold text-gray-400">{index + 1}</td>
                        <td className="py-1.5 px-2 font-bold text-[#2C3E50] whitespace-nowrap">{r.지점}</td>
                        <td className="py-1.5 px-2 text-right min-w-[150px]">
                          <CellBar ratio={r.총매출 / maxSales} tone="alice"><span className="font-black text-[#1A3C6E]">{money(r.총매출)}</span></CellBar>
                        </td>
                        <td className={`py-1.5 px-2 text-right font-mono font-black ${r.이익금 < 0 ? "admin-rate-hot" : "text-[#1A3C6E]"}`}>{money(r.이익금)}</td>
                        <td className={`py-1.5 px-2 text-right font-mono font-black ${profit !== null && profit < ALERT_PROFIT_RATE ? "admin-rate-hot" : "text-gray-600"}`}>{formatRate(profit)}</td>
                        <td className={`py-1.5 px-2 text-right font-mono font-black ${food !== null && food > ALERT_FOOD_RATE ? "admin-rate-hot" : "text-gray-600"}`}>{formatRate(food)}</td>
                        <td className={`py-1.5 px-2 text-right font-mono font-black ${labor !== null && labor > ALERT_LABOR_RATE ? "admin-rate-hot" : "text-gray-600"}`}>{formatRate(labor)}</td>
                        <td className="py-1.5 px-2 text-right"><PrimeBadge value={primeOf(r)} /></td>
                        <td className="py-1.5 px-2 text-right min-w-[110px]">
                          <CellBar ratio={(productivity ?? 0) / maxProductivity} tone="honey"><span className="font-bold text-gray-600">{formatRate(productivity, 0)}</span></CellBar>
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono font-bold text-gray-500">{turnover === null ? "—" : `${turnover.toFixed(1)}회`}</td>
                        <td className="py-1.5 px-2 text-right font-mono font-bold text-gray-500">{r.객단가 > 0 ? money(r.객단가) : "—"}</td>
                        <td className="py-1.5 px-2 text-right"><RateDelta current={profit} previous={prev ? profitRateOf(prev) : null} /></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="admin-sales-total-row">
                    <td className="py-2 px-2" />
                    <td className="py-2 px-2 text-[11px] font-black text-[#212121]">합계/평균 (본사 제외)</td>
                    <td className="py-2 px-2 text-right font-mono font-black text-[#212121]">{money(totals.총매출)}</td>
                    <td className="py-2 px-2 text-right font-mono font-black text-[#212121]">{money(totals.이익금)}</td>
                    <td className="py-2 px-2 text-right font-mono font-black text-[#212121]">{formatRate(totals.이익률)}</td>
                    <td className="py-2 px-2 text-right font-mono font-black text-[#212121]">{formatRate(totals.식재료율)}</td>
                    <td className="py-2 px-2 text-right font-mono font-black text-[#212121]">{formatRate(totals.인건비율)}</td>
                    <td className="py-2 px-2" />
                    <td className="py-2 px-2 text-right font-mono font-black text-[#212121]">{formatRate(totals.생산성, 0)}</td>
                    <td className="py-2 px-2" />
                    <td className="py-2 px-2 text-right font-mono font-black text-[#212121]">{totals.객단가 === null ? "—" : money(totals.객단가)}</td>
                    <td className="py-2 px-2" />
                  </tr>
                </tfoot>
              </table>
            </div>
            {/* 본사 정산부(본사지출·배당/인센·이익잉여금)는 위 손익 요약표 하단에 있다.
                (예전 여기 있던 한 줄은 본사 행 의미를 잘못 읽어 — 총지출에 배당이 섞이고 이익금을 잉여금으로 —
                 틀린 숫자를 보여줬다. 요약표 재현 때 엑셀 대조로 바로잡음.) */}
          </section>

          <section className="admin-sales-overview-section bg-white rounded-2xl border border-gray-100 p-5 space-y-2">
            <h2 className="admin-pill-title">계산 기준</h2>
            <ul className="text-xs text-gray-500 font-medium leading-relaxed list-disc pl-4 space-y-1">
              <li>원천: 04 에이전트 <b>db파일.xlsx의 손익DB 시트</b> (은행 분류 지출·POS 매출이 반영된 확정 손익). 매월 갱신은 상단 'db파일 업로드'.</li>
              <li>식재료율 = 식재료 ÷ <b>메뉴매출</b> · 인건비율 = 인건비 ÷ 총매출 · Prime = 식재료율+인건비율 · 생산성 = 이익금 ÷ 인건비 · 회전율 = 영수건수 ÷ 테이블수 ÷ 영업일수 — 본사 PNG 대시보드와 동일 산식.</li>
              <li>전사 합계·평균·순위는 <b>본사 행 제외</b>(본사 행의 매출은 전지점 합산이라 섞으면 이중계상). 본사 배당/인센·이익잉여금은 순위표 아래 한 줄로 표시.</li>
              <li>테이블수·휴무일은 branches.xlsx 지점운영 시트 기준(미등록 지점은 회전율 '—').</li>
            </ul>
          </section>
          </div>)}
        </>
      )}

      {/* ─────────────── ② 손익 차트 (1행 2그래프 그리드) ─────────────── */}
      {!loading && view === "charts" && curRows.length > 0 && (
        <div className="admin-chart-grid">
          <section className="admin-sales-overview-section bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <div>
              <h2 className="admin-pill-title">매출 · 이익 추이</h2>
              <p className="text-xs text-gray-400 mt-1">전 지점 합계(본사 제외) · 최근 {TREND_MONTHS}개월 · 선=이익률</p>
            </div>
            {/* 05 PNG와 같은 문법: 매출·이익 막대 + 이익률 꺾은선(우측 % 축) */}
            <PnlComboChart
              categories={trendCats}
              series={[
                { label: "매출", tone: "alice", values: trendVals(null, (mr) => mr.reduce((s, r) => s + r.총매출, 0)) },
                { label: "이익금", tone: "honey", values: trendVals(null, (mr) => mr.reduce((s, r) => s + r.이익금, 0)) },
              ]}
              line={{ label: "이익률", values: trendVals(null, (mr) => hqTotalsOf(mr).이익률) }} />
          </section>

          <section className="admin-sales-overview-section bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <div>
              <h2 className="admin-pill-title">식재료율 · 인건비율 추이</h2>
              <p className="text-xs text-gray-400 mt-1">전 지점 가중 평균 · 최근 {TREND_MONTHS}개월</p>
            </div>
            {(() => {
              const pair = trendPairOf(null, (mr) => hqTotalsOf(mr).식재료율, (mr) => hqTotalsOf(mr).인건비율);
              return (
                <SalesLineChart compact autoScale granularity="month" currentLabel="식재료율" compareLabel="인건비율"
                  formatAxis={percentAxis} formatValue={percentValue}
                  current={pair.a} compare={pair.b} />
              );
            })()}
          </section>

          <section className="admin-sales-overview-section bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <div>
              <h2 className="admin-pill-title">지점별 매출 · 이익금</h2>
              <p className="text-xs text-gray-400 mt-1">{month} · 매출 순 가로 막대 · 적자는 빨강</p>
            </div>
            <PnlHBarChart
              items={[...curRows].sort((a, b) => b.총매출 - a.총매출).map((r) => ({ label: r.지점, values: [r.총매출, r.이익금] }))}
              series={[{ label: "매출", tone: "alice" }, { label: "이익금", tone: "honey" }]} />
          </section>

          <section className="admin-sales-overview-section bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <div>
              <h2 className="admin-pill-title">지점별 이익률 · 생산성</h2>
              <p className="text-xs text-gray-400 mt-1">{month} · 이익률 순 가로 막대</p>
            </div>
            <PnlHBarChart
              items={rankedByProfitRate.map((r) => ({ label: r.지점, values: [(profitRateOf(r) ?? 0), (productivityOf(r) ?? 0)] }))}
              series={[{ label: "이익률", tone: "vanilla" }, { label: "생산성", tone: "honey" }]}
              format={(v) => `${(v * 100).toFixed(1)}%`} />
          </section>

          <section className="admin-sales-overview-section bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <div>
              <h2 className="admin-pill-title">포지셔닝 — 매출 × 이익률</h2>
              <p className="text-xs text-gray-400 mt-1">{month} · 점선=평균 · 버블=Prime Cost</p>
            </div>
            <PnlScatterChart compact
              points={curRows.filter((r) => profitRateOf(r) !== null).map((r) => ({ label: r.지점, x: r.총매출, y: profitRateOf(r)!, size: primeOf(r) ?? undefined }))}
              xLabel="매출" yLabel="이익률" formatX={formatCompactWon} formatY={percentValue}
              quadrantLabels={["저매출·고이익", "고매출·고이익", "저매출·저이익", "고매출·저이익"]} />
          </section>

          <section className="admin-sales-overview-section bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <div>
              <h2 className="admin-pill-title">포지셔닝 — 인건비 × 이익률</h2>
              <p className="text-xs text-gray-400 mt-1">{month} · 인건비 대비 이익 효율</p>
            </div>
            <PnlScatterChart compact
              points={curRows.filter((r) => profitRateOf(r) !== null).map((r) => ({ label: r.지점, x: r.인건비, y: profitRateOf(r)! }))}
              xLabel="인건비" yLabel="이익률" formatX={formatCompactWon} formatY={percentValue}
              quadrantLabels={["효율 우수", "규모 성장", "매출 부족", "인건비 과다"]} />
          </section>

          <section className="admin-sales-overview-section bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <div>
              <h2 className="admin-pill-title">포지셔닝 — 회전율 × 객단가</h2>
              <p className="text-xs text-gray-400 mt-1">{month} · 좌상=고단가 체류형, 우하=박리다매형 · 테이블수 미등록 지점 제외</p>
            </div>
            <PnlScatterChart compact
              points={curRows
                .map((r) => ({ label: r.지점, x: turnoverOf(r, ops), y: r.객단가 }))
                .filter((p): p is { label: string; x: number; y: number } => p.x !== null && p.y > 0)}
              xLabel="회전율(회/일)" yLabel="객단가"
              formatX={(v) => `${v.toFixed(1)}회`} formatY={(v) => `${Math.round(v / 1000).toLocaleString("ko-KR")}천원`} />
          </section>
        </div>
      )}

      {/* ─────────────── ③ 지점 손익계산서 ───────────────
          손익 종합·본사 종합과 같은 타이포(11px)·컴팩트 KPI·2열 배치로 통일(2026-07-22 사용자 지시) */}
      {/* [지점 선택줄은 위쪽 '탭별 상단 줄'에 있다] 아래 본문은 '그 달 그 지점 데이터가 없으면'
          안내문만 렌더한다. 선택줄이 이 안에 있으면 데이터 없는 지점을 고른 순간 선택줄이 사라져
          다른 지점으로 돌아올 수 없다 — 업로드 버튼이 사라지던 것과 같은 종류의 막다른 길이다. */}
      {!loading && view === "branch" && (
        branchRow === null ? (
          curRows.length > 0 && <p className="text-xs font-black text-rose-600">{branch}의 {month} 데이터가 없습니다.</p>
        ) : (
        <div className="admin-analysis-uniform space-y-5">
          <section className="admin-hq-kpi-grid admin-hq-kpi-4">
            <div className="admin-hq-kpi">
              <span>총매출</span>
              <strong>{formatNumber(branchRow.총매출)}</strong>
              <small><MoneyDelta current={branchRow.총매출} previous={branchPrevRow?.총매출 ?? null} /> <span className="text-gray-400">전월</span></small>
            </div>
            <div className="admin-hq-kpi">
              <span>이익금 &amp; 이익률</span>
              <strong>{formatNumber(branchRow.이익금)} <em className="not-italic text-gray-500">{formatRate(profitRateOf(branchRow))}</em></strong>
              <small><RateDelta current={profitRateOf(branchRow)} previous={branchPrevRow ? profitRateOf(branchPrevRow) : null} /> <span className="text-gray-400">전월</span></small>
            </div>
            <div className="admin-hq-kpi">
              <span>객단가</span>
              <strong>{branchRow.객단가 > 0 ? formatNumber(branchRow.객단가) : "—"}</strong>
              <small><MoneyDelta current={branchRow.객단가} previous={branchPrevRow?.객단가 ?? null} /> <span className="text-gray-400">전월</span></small>
            </div>
            <div className="admin-hq-kpi">
              <span>영수건수</span>
              <strong>{branchRow.영수건수 > 0 ? `${formatNumber(branchRow.영수건수)}건` : "—"}</strong>
              <small><MoneyDelta current={branchRow.영수건수} previous={branchPrevRow?.영수건수 ?? null} /> <span className="text-gray-400">전월</span></small>
            </div>
          </section>

          <div className="admin-chart-grid">
            {/* 왼쪽: 손익계산서 → PRIME 게이지 순(2026-07-22 사용자 지시로 순서 교환)

                ┌─ [A안] 한 카드에 그대로 두고 **맨 위 제목만 밴드**로 올린다 ─────────────────
                │  카드 중간의 `PRIME COST` 는 섹션 제목이 아니라 값 옆에 붙는 라벨이라 알약으로 남긴다.
                │  (밴드로 만들면 카드 한가운데에 바닐라 띠가 가로로 끼어든다.)
                │  장점: 손익계산서와 PRIME 게이지가 "한 지점의 수익 구조"로 묶여 읽힌다. 카드 수가 안 는다.
                │  단점: 카드 안에 제목 양식이 두 가지(밴드+알약) 섞인다.
                └──────────────────────────────────────────────────────────────────── */}
            <section className="admin-sales-overview-section admin-sheet-card">
              <div className="admin-band"><h3 className="admin-band-title">손익계산서</h3></div>
              <div className="p-5 space-y-4">
              <table className="w-full admin-hq-statement">
                <thead>
                  <tr>
                    <th className="py-2 px-2 text-left">항목</th>
                    <th className="py-2 px-2 text-right">금액</th>
                    <th className="py-2 px-2 text-right w-28">비율</th>
                    <th className="py-2 px-2 text-right">전월대비</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="admin-statement-band"><td colSpan={4} className="py-1 px-2 font-black text-[#212121]">매출</td></tr>
                  {statement.filter((l) => l.kind === "sales" || l.kind === "salesTotal").map((line) => renderStatementRow(line, money))}
                  <tr className="admin-statement-band"><td colSpan={4} className="py-1 px-2 font-black text-[#212121]">지출</td></tr>
                  {statement.filter((l) => l.kind === "expense" || l.kind === "expenseTotal").map((line) => renderStatementRow(line, money))}
                  {statement.filter((l) => l.kind === "profit").map((line) => renderStatementRow(line, money))}
                </tbody>
              </table>
              <p className="font-bold text-gray-400">{branch} · {month} · 비율은 총매출 대비(막대) · 전월대비는 금액 기준</p>

              <div className="flex flex-wrap items-baseline gap-2 pt-1">
                <h2 className="admin-pill-title">PRIME COST</h2>
                <span className={`font-black font-mono ${(primeOf(branchRow) ?? 0) > PRIME_TARGET ? "admin-rate-hot" : "text-[#212121]"}`}>
                  {formatRate(primeOf(branchRow))}
                </span>
                <span className="font-bold text-gray-400">= 식재료율 {formatRate(foodRateOf(branchRow))} + 인건비율 {formatRate(laborRateOf(branchRow))} · 목표 {PRIME_TARGET * 100}% 이하</span>
              </div>
              <div className="admin-prime-gauge" role="img" aria-label={`Prime Cost ${formatRate(primeOf(branchRow))}, 목표 ${PRIME_TARGET * 100}%`}>
                <div className="admin-prime-food" style={{ width: `${Math.min(100, (foodRateOf(branchRow) ?? 0) * 100)}%` }} />
                <div className="admin-prime-labor" style={{ width: `${Math.min(100 - Math.min(100, (foodRateOf(branchRow) ?? 0) * 100), (laborRateOf(branchRow) ?? 0) * 100)}%` }} />
                <div className="admin-prime-target" style={{ left: `${PRIME_TARGET * 100}%` }} />
              </div>
              <p className="font-bold text-gray-400">노랑=식재료율 · 파랑=인건비율 · 빨간 세로선=목표 60%</p>
              </div>
            </section>
            {/* ┌─ [B안] 제목마다 카드 하나 ─ 카드 안에 제목이 하나뿐이라 전부 밴드로 통일된다 ────────
                │  부연 설명은 밴드 안(.admin-band-meta)으로 넣어 제목과 한 줄에 붙인다.
                │  장점: 제목 양식이 한 가지뿐이고, 어디까지가 한 덩어리인지 카드 경계로 분명해진다.
                │  단점: 카드가 늘어 세로가 길어지고, 원래 한 묶음이던 내용이 갈라진다.
                └──────────────────────────────────────────────────────────────────── */}
            <section className="admin-sales-overview-section admin-sheet-card">
              <div className="admin-band">
                <h3 className="admin-band-title">매출 · 이익 추이</h3>
                <p className="admin-band-meta">{branch} · 최근 {TREND_MONTHS}개월 · 선=이익률</p>
              </div>
              <div className="p-5">
              <PnlComboChart
                showValues
                categories={trendCats}
                series={[
                  { label: "매출", tone: "alice", values: trendVals(branch, (mr) => mr.reduce((s, r) => s + r.총매출, 0)) },
                  { label: "이익금", tone: "vanilla", values: trendVals(branch, (mr) => mr.reduce((s, r) => s + r.이익금, 0)) },
                ]}
                line={{ label: "이익률", values: trendVals(branch, (mr) => (mr[0] ? profitRateOf(mr[0]) : null)) }} />
              </div>
            </section>

            <section className="admin-sales-overview-section admin-sheet-card">
              <div className="admin-band">
                <h3 className="admin-band-title">식재료율 · 인건비율 추이</h3>
                <p className="admin-band-meta">{branch} · 최근 {TREND_MONTHS}개월 · 경보 기준 각 35%</p>
              </div>
              <div className="p-5">
              {(() => {
                const pair = trendPairOf(branch, (mr) => (mr[0] ? foodRateOf(mr[0]) : null), (mr) => (mr[0] ? laborRateOf(mr[0]) : null));
                return (
                  <SalesLineChart compact autoScale showValues granularity="month" currentLabel="식재료율" compareLabel="인건비율"
                    formatAxis={percentAxis} formatValue={percentValue}
                    current={pair.a} compare={pair.b} />
                );
              })()}
              </div>
            </section>

            {/* 05 branch PNG 처럼 객단가(막대)와 영수건수(선)를 한 차트에 겹쳐 카드 수를 줄인다. */}
            <section className="admin-sales-overview-section admin-sheet-card">
              <div className="admin-band">
                <h3 className="admin-band-title">객단가 &amp; 영수건수</h3>
                <p className="admin-band-meta">{branch} · 최근 {TREND_MONTHS}개월 · 막대=영수건수 · 선=객단가(원)</p>
              </div>
              <div className="p-5">
              <PnlComboChart
                showValues
                lineZeroBase={false}
                categories={trendCats}
                formatBar={(v) => `${formatNumber(Math.round(v))}건`}
                series={[{ label: "영수건수", tone: "alice", values: trendVals(branch, (mr) => (mr[0] && mr[0].영수건수 > 0 ? mr[0].영수건수 : null)) }]}
                line={{ label: "객단가(원)", values: trendVals(branch, (mr) => (mr[0] && mr[0].객단가 > 0 ? mr[0].객단가 : null)) }}
                lineAxisFormat={(v) => `${Math.round(v / 1000).toLocaleString("ko-KR")}천`}
                lineValueFormat={(v) => `${formatNumber(Math.round(v))}원`} />
              </div>
            </section>
          </div>
        </div>
        )
      )}
    </section>
  );
}

/** 손익계산서 한 행 — 비율 컬럼은 막대로 그린다(매출부=바닐라, 지출부=엘리스, 이익금=허니). */
function renderStatementRow(line: ReturnType<typeof buildStatement>[number], money: (v: number) => string) {
  const profit = line.kind === "profit";
  const strong = line.kind === "salesTotal" || line.kind === "expenseTotal" || profit;
  const tone: "alice" | "honey" | "vanilla" = profit ? "honey" : line.kind === "expense" || line.kind === "expenseTotal" ? "alice" : "vanilla";
  // 이익금 행은 본사 손익계산서와 같은 네이비 채움을 쓴다(Codex P1 — 지점 표에만 빠져 있었다).
  return (
    <tr key={line.label} className={profit ? "admin-hq-profit" : strong ? "admin-statement-strong" : ""}>
      <td className={`py-1.5 px-2 ${strong ? "font-black" : "font-bold text-gray-600 pl-5"} ${strong && !profit ? "text-[#212121]" : ""}`}>
        {line.label}
        {line.note ? <span className="ml-2 font-bold text-gray-400">{line.note}</span> : null}
      </td>
      <td className={`py-1.5 px-2 text-right font-mono ${strong ? "font-black" : "font-bold text-gray-600"} ${strong && !profit ? "text-[#212121]" : ""} ${profit && line.amount < 0 ? "admin-rate-hot" : ""}`}>
        {money(line.amount)}
      </td>
      <td className="py-1.5 px-2 text-right">
        {/* 이익금 행은 네이비 배경이라 막대를 얹으면 안 보인다 — 숫자만 표시한다. */}
        {profit ? (
          <span className="font-mono font-black">{formatRate(line.share)}</span>
        ) : (
          <CellBar ratio={Math.max(0, line.share ?? 0)} tone={tone}>
            <span className="font-bold text-gray-500">{formatRate(line.share)}</span>
          </CellBar>
        )}
      </td>
      <td className="py-1.5 px-2 text-right">
        {line.momRatio === null
          ? <span className="admin-delta admin-delta-flat font-mono font-black">—</span>
          : <MoneyDelta current={1 + line.momRatio} previous={1} />}
      </td>
    </tr>
  );
}
