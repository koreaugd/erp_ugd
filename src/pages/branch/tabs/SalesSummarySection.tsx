// src/pages/branch/tabs/SalesSummarySection.tsx
// 월말마감 매입매출 탭 상단 - 매출집계 섹션 (자동계산 + 검증 + 경고 + 빈칸사유)
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { AlertTriangle, TrendingUp, CreditCard, Utensils, CheckCircle2, Pencil, Trash2, X } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import { SheetKeyHint } from "../../../components/SheetKeyHint";
import { formatNumber } from "../../../utils/formatNumber";
import { cleanNumeric, formatWithCommas } from "../helpers/formatters";
import { pendingLocalSaveStorageKey } from "../helpers/staffHelpers";
import { useSheetKeyboardNav } from "../helpers/useSheetKeyboardNav";

export interface SalesSummary {
  totalSales: string;
  totalDiscount: string;
  netSales: string;
  receiptCount: string;
  cardPay: string;
  cashPlain: string;
  cashReceipt: string;
  menuSales: string;
  liquorSales: string;
  seatCharge: string;
  coverCharge?: string; // 금샤빠 전용(커버차지)
}

const EMPTY: SalesSummary = {
  totalSales: "", totalDiscount: "", netSales: "", receiptCount: "",
  cardPay: "", cashPlain: "", cashReceipt: "",
  menuSales: "", liquorSales: "", seatCharge: "",
  coverCharge: "",
};

// 빈칸 사유 대상 필드 (파생값 영수단가/종매출 제외)
const REQUIRED_FIELDS: Array<{ key: keyof SalesSummary; label: string }> = [
  { key: "totalSales", label: "총매출" },
  { key: "totalDiscount", label: "총할인" },
  { key: "netSales", label: "실매출" },
  { key: "receiptCount", label: "영수건수" },
  { key: "cardPay", label: "카드결제" },
  { key: "cashPlain", label: "단순현금결제" },
  { key: "cashReceipt", label: "현금영수증" },
  { key: "menuSales", label: "메뉴매출" },
  { key: "liquorSales", label: "주류매출" },
  { key: "seatCharge", label: "자릿값(예약정산금)" },
];

const num = (v: string) => Number(cleanNumeric(String(v || ""))) || 0;
const filled = (v: string) => String(v || "").trim() !== "";

// 커버차지는 금샤빠 지점에서만 매출구성에 포함/필수. branch-aware로 판정해, 다른 지점에 남아있을 수 있는
// stale coverCharge 값이 그 지점 검증을 오염시키지 않도록 한다.
export const salesSummaryUsesCover = (branchName?: string) => String(branchName || "").includes("금샤빠");

// 검증 규칙 — 섹션 화면과 마감제출 가드(MonthlySettleTab)가 공유한다. 규칙을 한 곳에서만 정의해 드리프트를 막는다.
export function computeSalesSummaryWarnings(input: Partial<SalesSummary> | null, branchName?: string): string[] {
  const data = { ...EMPTY, ...(input || {}) };
  // 매출구성 = 메뉴+주류(+금샤빠 커버차지)로 실매출과 대조. 자릿값(예약정산금)은 별도 정산항목이라 제외.
  const gross = num(data.menuSales) + num(data.liquorSales) + (salesSummaryUsesCover(branchName) ? num(data.coverCharge || "") : 0);
  const list: string[] = [];
  if (filled(data.totalSales) && filled(data.totalDiscount) && filled(data.netSales)
    && num(data.totalSales) - num(data.totalDiscount) !== num(data.netSales)) {
    list.push(`총매출 − 총할인(${formatNumber(num(data.totalSales) - num(data.totalDiscount))}) 이 실매출(${formatNumber(num(data.netSales))})과 일치하지 않습니다.`);
  }
  if (filled(data.cardPay) && filled(data.cashPlain) && filled(data.cashReceipt) && filled(data.netSales)
    && num(data.cardPay) + num(data.cashPlain) + num(data.cashReceipt) !== num(data.netSales)) {
    list.push(`카드+단순현금+현금영수증(${formatNumber(num(data.cardPay) + num(data.cashPlain) + num(data.cashReceipt))}) 합이 실매출(${formatNumber(num(data.netSales))})과 맞지 않습니다.`);
  }
  if (filled(data.menuSales) && filled(data.liquorSales) && filled(data.netSales)
    && gross !== num(data.netSales)) {
    list.push(`매출구성 합계(${formatNumber(gross)})가 실매출(${formatNumber(num(data.netSales))})과 맞지 않습니다.`);
  }
  return list;
}

export function salesSummaryBlankBlocking(input: Partial<SalesSummary> | null, branchName?: string): boolean {
  const data = { ...EMPTY, ...(input || {}) };
  // 모든 필수 칸이 채워져야 한다(값이 0이어도 "0"이면 채워진 것). 빈칸이 하나라도 있으면 차단.
  const requiredBlank = REQUIRED_FIELDS.some((f) => !filled(String((data as any)[f.key] || "")));
  // 커버차지는 금샤빠 지점에서만 필수(다른 지점은 요구하지 않음).
  const coverBlank = salesSummaryUsesCover(branchName) && !filled(String(data.coverCharge || ""));
  return requiredBlank || coverBlank;
}

// 마감제출 차단 여부: 금액 불일치 경고가 있거나, 사유 없는 빈칸이 있으면 true.
export function isSalesSummaryDataInvalid(input: Partial<SalesSummary> | null, branchName?: string): boolean {
  return computeSalesSummaryWarnings(input, branchName).length > 0 || salesSummaryBlankBlocking(input, branchName);
}

export const salesSummaryLocalKey = (branchName: string, selectedMonth: string) => `erp_monthly_sales_summary_${branchName}_${selectedMonth}`;
export const salesSummarySharedKey = (branchName: string, selectedMonth: string) => `monthly_sales_summary:${branchName}:${selectedMonth}`;

// 마감 검증 로드 결과. blocked=true면 마감을 진행하면 안 된다(데이터를 신뢰/영속화할 수 없음).
export interface SalesSummaryCloseResult {
  blocked: boolean;
  reason?: "save_failed" | "read_failed";
  data: SalesSummary | null;
}

// 마감제출 검증용 원본 로드:
// (1) 미저장 로컬 편집(pending)이 있으면 그 최신값을 백엔드에 반영한 뒤 그 값으로 검증한다.
//     → 백엔드 반영에 실패하면 마감을 막는다(다른 기기와 불일치 방지).
// (2) pending이 없으면 공유 백엔드(크로스-컴퓨터 원본)를 읽는다. 읽기 실패 시에도 마감을 막는다(오래된 데이터로 확정 방지).
export async function loadSalesSummaryForClose(branchName: string, selectedMonth: string): Promise<SalesSummaryCloseResult> {
  const storageKey = salesSummaryLocalKey(branchName, selectedMonth);
  const sharedKey = salesSummarySharedKey(branchName, selectedMonth);
  const pendingKey = pendingLocalSaveStorageKey(storageKey);

  if (localStorage.getItem(pendingKey) === "1") {
    let local: SalesSummary | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) local = JSON.parse(raw);
    } catch {}
    if (local) {
      try {
        await gasClient.saveSharedData(sharedKey, local);
        localStorage.removeItem(pendingKey);
        return { blocked: false, data: local };
      } catch {
        // 미저장 최신 편집을 백엔드에 반영하지 못하면 마감을 진행하면 안 된다.
        return { blocked: true, reason: "save_failed", data: local };
      }
    }
  }

  try {
    // 캐시로 승인되면 안 되므로 서버 문서만 읽는다(오프라인이면 throw).
    const remote = await gasClient.getSharedDataFromServer<SalesSummary>(sharedKey);
    return { blocked: false, data: remote && typeof remote === "object" ? remote : null };
  } catch {
    // 원본(공유) 읽기 실패 시 마감을 승인하면 오래된/불확실한 데이터로 확정될 수 있으므로 막는다.
    return { blocked: true, reason: "read_failed", data: null };
  }
}

export function SalesSummarySection({
  branchName,
  selectedMonth,
  triggerToast,
  isLocked = false,
  closeStatus = null,
  onConfirm,
  onEdit,
  onCancel,
  onCancelEdit,
  onMonthChange,
}: {
  branchName: string;
  selectedMonth: string;
  triggerToast: (msg: string, type?: "success" | "error") => void;
  isLocked?: boolean;
  closeStatus?: "confirmed" | "editing" | "pending" | null;
  onConfirm?: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
  onCancelEdit?: () => void;
  onMonthChange?: (m: string) => void;
}) {
  const [data, setData] = useState<SalesSummary>(EMPTY);
  const [showErrors, setShowErrors] = useState(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  // 저장 세대 카운터: 저장 요청이 나간 뒤에도 더 최신 편집이 있으면(gen 불일치) pending 플래그를 지우지 않는다.
  const autoSaveGenRef = useRef(0);
  const storageKey = salesSummaryLocalKey(branchName, selectedMonth);
  const sharedKey = salesSummarySharedKey(branchName, selectedMonth);
  const pendingKey = pendingLocalSaveStorageKey(storageKey);
  const invalidFlagKey = `erp_sales_summary_invalid:${branchName}:${selectedMonth}`;

  // ---- 로드 ----
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let next: SalesSummary | null = null;
      const hasPendingLocal = localStorage.getItem(pendingKey) === "1";
      try {
        if (hasPendingLocal) {
          const local = localStorage.getItem(storageKey);
          if (local) next = JSON.parse(local);
        } else {
          const remote = await gasClient.getSharedData<SalesSummary>(sharedKey);
          if (remote && typeof remote === "object") next = remote;
          else {
            const local = localStorage.getItem(storageKey);
            if (local) next = JSON.parse(local);
          }
        }
      } catch {
        try {
          const local = localStorage.getItem(storageKey);
          if (local) next = JSON.parse(local);
        } catch {}
      }
      if (!cancelled) setData({ ...EMPTY, ...(next || {}) });
    };
    load();
    return () => {
      cancelled = true;
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      if (localStorage.getItem(pendingKey) === "1") {
        const local = localStorage.getItem(storageKey);
        if (local) {
          try {
            void gasClient.saveSharedData(sharedKey, JSON.parse(local))
              .then(() => localStorage.removeItem(pendingKey))
              .catch(() => {});
          } catch {}
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchName, selectedMonth]);

  const persist = useCallback((next: SalesSummary) => {
    setData(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
    localStorage.setItem(pendingKey, "1");
    const gen = ++autoSaveGenRef.current;
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      gasClient.saveSharedData(sharedKey, next)
        // 이 저장 이후 새 편집이 없을 때만 pending 해제(경쟁 시 최신 미저장분 보호).
        .then(() => { if (autoSaveGenRef.current === gen) localStorage.removeItem(pendingKey); })
        .catch(() => triggerToast("저장 중 부득이한 에러발생", "error"));
    }, 450);
  }, [pendingKey, sharedKey, storageKey, triggerToast]);

  const update = (key: keyof SalesSummary, value: string) => {
    if (isLocked) return;
    persist({ ...data, [key]: cleanNumeric(value) } as SalesSummary);
  };

  // ---- 파생값 ----
  const unitPrice = useMemo(() => {
    const n = num(data.netSales);
    const c = num(data.receiptCount);
    return filled(data.netSales) && c > 0 ? Math.round(n / c) : null;
  }, [data.netSales, data.receiptCount]);

  const isGeumshabba = salesSummaryUsesCover(branchName);

  const paymentSum = num(data.cardPay) + num(data.cashPlain) + num(data.cashReceipt);
  const paymentDiff = num(data.netSales) - paymentSum;
  // 매출구성 = 메뉴+주류(+금샤빠 커버차지). 커버차지는 금샤빠에서만 합산(branch-aware)해 다른 지점 오염 방지.
  const compositionSum = num(data.menuSales) + num(data.liquorSales) + (isGeumshabba ? num(data.coverCharge || "") : 0);
  const compositionDiff = num(data.netSales) - compositionSum;

  // ---- 검증 (마감제출 가드와 동일 규칙 공유, branchName 전달로 커버차지 branch-aware) ----
  const warnings = useMemo(() => computeSalesSummaryWarnings(data, branchName), [data, branchName]);
  const blankBlocking = salesSummaryBlankBlocking(data, branchName);
  const invalid = warnings.length > 0 || blankBlocking;

  // 매출집계 자체 '제출': 경고가 있으면 빈칸을 빨갛게 표시하고 제출을 막는다.
  const handleSubmitClick = () => {
    if (invalid) {
      setShowErrors(true);
      triggerToast("매출집계에 확인이 필요합니다(금액 불일치 또는 빈칸).", "error");
      return;
    }
    onConfirm?.();
  };

  // ---- 마감제출 차단 플래그 (MonthlySettleTab에서 확인) ----
  useEffect(() => {
    (window as any).__ugdSalesSummaryInvalid = invalid;
    try { localStorage.setItem(invalidFlagKey, invalid ? "1" : "0"); } catch {}
    if (!invalid) setShowErrors(false);
    return () => { (window as any).__ugdSalesSummaryInvalid = false; };
  }, [invalid, invalidFlagKey]);

  // 마감제출이 차단되면 MonthlySettleTab이 이벤트를 보내 빈칸을 빨갛게 표시하게 한다.
  useEffect(() => {
    const onShow = () => setShowErrors(true);
    window.addEventListener("ugd_show_monthly_errors", onShow);
    return () => window.removeEventListener("ugd_show_monthly_errors", onShow);
  }, []);

  // 세 카드를 하나의 격자로 보고 방향키로 오간다.
  // 열 = 카드(매출구성/결제구성/매출요약), 행 = 카드 안의 칸 순번. 카드마다 칸 수가 달라 빈 자리가 생기는데,
  // 훅이 없는 칸을 만나면 옆 칸으로 흘려보내므로 들쭉날쭉한 격자도 그대로 동작한다.
  const { cellProps } = useSheetKeyboardNav({ rowCount: 4, colCount: 3 });

  // ---- 렌더 헬퍼: 라벨(좌) + 입력값(우). 모든 칸 필수(빈칸이면 붉게 표시), 0 입력은 유효 ----
  // guideAnchor: 작성방법 안내 말풍선이 붙을 칸에만 붙인다(GuideCallouts가 data-guide로 찾는다).
  const rowField = (
    fieldKey: keyof SalesSummary,
    label: string,
    /** 셀 좌표. 열 = 카드(0 매출구성 / 1 결제구성 / 2 매출요약), 행 = 그 카드 안의 순번. */
    cell: { row: number; col: number },
    guideAnchor?: string
  ) => {
    const isBlank = !filled(String(data[fieldKey] || ""));
    const err = showErrors && isBlank;
    return (
      <div key={fieldKey} className="flex items-center justify-between gap-2" data-guide={guideAnchor}>
        <span className={`text-[11px] font-black shrink-0 ${err ? "text-rose-600" : "text-zinc-700"}`}>{label}</span>
        <input
          {...cellProps(cell.row, cell.col)}
          aria-label={label}
          type="text"
          inputMode="numeric"
          value={formatWithCommas(String(data[fieldKey] || ""))}
          disabled={isLocked}
          onChange={(e) => update(fieldKey, e.target.value)}
          placeholder="입력(0 가능)"
          className={`w-28 p-1.5 border-2 rounded-lg text-xs font-mono font-black text-right focus:outline-none disabled:text-gray-400 ${err ? "border-rose-500 bg-rose-50 text-rose-700 placeholder-rose-300 focus:border-rose-600" : "border-zinc-300 bg-white focus:border-[#2E6DB4]"}`}
        />
      </div>
    );
  };

  const autoRow = (label: string, value: string, warn = false) => (
    <div className="flex items-center justify-between gap-2 pt-2 mt-1 border-t border-zinc-200">
      <span className="text-[11px] font-black text-zinc-500 shrink-0">{label} <span className="text-[9px] font-bold text-zinc-400">자동</span></span>
      <span className={`w-28 p-1.5 rounded-lg text-xs font-mono font-black text-right border-2 ${warn ? "bg-rose-50 text-rose-600 border-rose-400" : "bg-zinc-50 text-blue-700 border-zinc-200"}`}>{value}</span>
    </div>
  );

  // 카드: 흰 바탕 + 검정 테두리 (다른 섹션과 동일). 제목은 노란(바닐라) pill.
  // rounded-xl 사용: bg-white+rounded-2xl/3xl에 걸린 테두리색 !important 덮어쓰기를 피해 검정 테두리를 살린다.
  const cardCls = "bg-white rounded-xl border border-zinc-900 p-4 space-y-2.5";
  // 기존 섹션 제목과 동일: 캡슐(rounded-full) + 1px 검정 테두리 + 바닐라 바탕
  const pillTitleCls = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-900 bg-[#EFF0A3] text-zinc-900 text-[11px] font-black leading-none";

  return (
    <div className="relative bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4 animate-fade-in" id="sales-summary-section">
      <SheetKeyHint />
      {/* 헤더 (월말마감결산포탈과 동일 배치): 제목 pill(좌) / 결산월 선택 + 마감버튼(우), 제출상태는 그 아래 */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 pb-3 border-b border-gray-50">
        <div>
          <div className="inline-flex items-center px-3.5 py-1.5 rounded-full border border-zinc-900 bg-[#EFF0A3] text-zinc-900 text-[13px] font-black leading-none">
            매출집계
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 w-full md:w-auto">
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <span className="text-xs font-black text-gray-500 whitespace-nowrap">결산월 선택:</span>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => onMonthChange?.(e.target.value)}
              disabled={!onMonthChange}
              data-guide="sales-summary-month"
              className="p-2 bg-zinc-50 hover:bg-zinc-100/50 border border-gray-200 text-xs font-extrabold rounded-xl shadow-inner focus:outline-none cursor-pointer disabled:cursor-not-allowed"
            />
            <button onClick={handleSubmitClick} className="monthly-action-confirm p-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-subtle">
              <CheckCircle2 className="w-3.5 h-3.5" /> 마감제출
            </button>
            {closeStatus === "editing" ? (
              <button onClick={() => onCancelEdit?.()} className="monthly-action-edit-cancel p-2 px-4 bg-slate-600 hover:bg-slate-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-subtle">
                <X className="w-3.5 h-3.5" /> 마감수정 취소
              </button>
            ) : (
              <button onClick={() => onEdit?.()} className="monthly-action-edit p-2 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-subtle">
                <Pencil className="w-3.5 h-3.5" /> 마감수정
              </button>
            )}
            <button onClick={() => onCancel?.()} className="monthly-action-cancel p-2 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-subtle">
              <Trash2 className="w-3.5 h-3.5" /> 마감취소
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-400">{selectedMonth} 제출상태</span>
            <span className={`monthly-close-status-pill rounded-lg px-2.5 py-1 text-[11px] font-black ${closeStatus === "confirmed" ? "monthly-close-status-confirmed" : closeStatus === "editing" ? "monthly-close-status-editing" : "monthly-close-status-missing"}`}>
              {closeStatus === "confirmed" ? "확정" : closeStatus === "editing" ? "수정중" : "미제출"}
            </span>
          </div>
        </div>
      </div>

      {/* 경고 */}
      {warnings.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 space-y-1.5">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px] font-bold text-rose-700">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{w}</span>
            </div>
          ))}
        </div>
      )}
      {showErrors && blankBlocking && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 flex items-start gap-2 text-[11px] font-bold text-rose-700">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>붉게 표시된 칸을 모두 입력해야 마감제출할 수 있습니다. (해당 없으면 0을 입력하세요)</span>
        </div>
      )}

      {/* 가로 3개 카드 (흰 바탕 + 검정 테두리 + 노란 pill 제목) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={cardCls}>
          <div className={pillTitleCls}><Utensils className="w-3.5 h-3.5" /> 매출구성</div>
          {rowField("menuSales", "메뉴매출", { row: 0, col: 0 })}
          {rowField("liquorSales", "주류매출", { row: 1, col: 0 })}
          {rowField("seatCharge", "자릿값(예약정산금)", { row: 2, col: 0 }, "sales-summary-seat-charge")}
          {isGeumshabba && rowField("coverCharge", "커버차지", { row: 3, col: 0 })}
          <p className="text-[9px] text-zinc-900 leading-snug pt-0.5">※ 자릿값(예약정산금): 캐치테이블 예약 이용 매장은 <span className="text-rose-600 font-black">캐치테이블 관리자페이지 → 정산 → 부가세 참고자료</span> → 해당 월 선택 후 나오는 금액을 입력하세요.</p>
          {autoRow(isGeumshabba ? "실매출과 차이(메뉴+주류+커버)" : "실매출과 차이(메뉴+주류)", formatNumber(compositionDiff), filled(data.netSales) && compositionDiff !== 0)}
        </div>
        <div className={cardCls}>
          <div className={pillTitleCls}><CreditCard className="w-3.5 h-3.5" /> 결제구성</div>
          {rowField("cardPay", "카드결제", { row: 0, col: 1 })}
          {rowField("cashPlain", "단순현금결제", { row: 1, col: 1 })}
          {rowField("cashReceipt", "현금영수증", { row: 2, col: 1 })}
          {autoRow("실매출과 차이", formatNumber(paymentDiff), filled(data.netSales) && paymentDiff !== 0)}
        </div>
        <div className={cardCls}>
          <div className={pillTitleCls}><TrendingUp className="w-3.5 h-3.5" /> 매출요약</div>
          {rowField("totalSales", "총매출", { row: 0, col: 2 })}
          {rowField("totalDiscount", "총할인", { row: 1, col: 2 })}
          {rowField("netSales", "실매출", { row: 2, col: 2 })}
          {rowField("receiptCount", "영수건수", { row: 3, col: 2 })}
          {autoRow("영수단가", unitPrice === null ? "-" : formatNumber(unitPrice))}
        </div>
      </div>
    </div>
  );
}
