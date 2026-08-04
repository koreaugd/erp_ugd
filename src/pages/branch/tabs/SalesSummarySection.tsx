// src/pages/branch/tabs/SalesSummarySection.tsx
// 월말마감 매입매출 탭 상단 - 매출집계 섹션 (자동계산 + 검증 + 경고 + 빈칸사유)
import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Pencil, Trash2, X } from "lucide-react";
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
  menuSales: string;
  liquorSales: string;
  // 커버차지(자릿값)·배달매출 — POS 실매출에는 들어 있으나 메뉴/주류 어느 쪽에도 안 잡히는 금액을 모아 적는다.
  // 전 지점 입력, 해당 없으면 0. (필드 이름은 커버차지만 있던 시절 것을 유지 — 과거 데이터와 키를 맞춘다.)
  coverCharge: string;
  seatCharge: string;  // 캐치테이블 예약정산금 — POS 실매출에 안 잡히는 별도 정산금
  // ── 아래는 입력칸이 없어진 레거시 필드다(결제구성 섹션·영수건수 삭제, 2026-08-02).
  // 지운 게 아니라 남겨 둔다: 과거 달에 저장된 값이 로드→저장 왕복에서 날아가지 않게 하고,
  // 관리자 매출집계 엑셀이 아직 이 값들을 읽는다. 새 달에는 빈 값으로 남는다.
  receiptCount?: string;
  cardPay?: string;
  cashPlain?: string;
  cashReceipt?: string;
}

const EMPTY: SalesSummary = {
  totalSales: "", totalDiscount: "", netSales: "",
  menuSales: "", liquorSales: "", coverCharge: "", seatCharge: "",
  receiptCount: "", cardPay: "", cashPlain: "", cashReceipt: "",
};

// 빈칸 사유 대상 필드 = 화면에 입력칸이 있는 칸만. 입력칸이 없는 레거시 필드를 여기 두면
// 새 달은 채울 방법이 없어 영영 마감할 수 없다.
const REQUIRED_FIELDS: Array<{ key: keyof SalesSummary; label: string }> = [
  { key: "totalSales", label: "총매출" },
  { key: "totalDiscount", label: "총할인" },
  { key: "netSales", label: "실매출" },
  { key: "seatCharge", label: "캐치테이블 예약정산금" },
  { key: "menuSales", label: "메뉴매출" },
  { key: "liquorSales", label: "주류매출" },
  { key: "coverCharge", label: "커버차지·배달매출" },
];

const num = (v?: string) => Number(cleanNumeric(String(v || ""))) || 0;
const filled = (v?: string) => String(v || "").trim() !== "";

// 검증 규칙 — 섹션 화면과 마감제출 가드(MonthlySettleTab)가 공유한다. 규칙을 한 곳에서만 정의해 드리프트를 막는다.
export function computeSalesSummaryWarnings(input: Partial<SalesSummary> | null): string[] {
  const data = { ...EMPTY, ...(input || {}) };
  // 매출구성 = 메뉴+주류+커버차지로 실매출과 대조. 커버차지는 POS 실매출에 포함되므로 여기서 더한다.
  // 캐치테이블 예약정산금은 POS에 잡히지 않는 별도 정산금이라 이 대조에서 제외한다(매출요약에서 따로 더한다).
  const gross = num(data.menuSales) + num(data.liquorSales) + num(data.coverCharge);
  const list: string[] = [];
  if (filled(data.totalSales) && filled(data.totalDiscount) && filled(data.netSales)
    && num(data.totalSales) - num(data.totalDiscount) !== num(data.netSales)) {
    list.push(`총매출 − 총할인(${formatNumber(num(data.totalSales) - num(data.totalDiscount))}) 이 실매출(${formatNumber(num(data.netSales))})과 일치하지 않습니다.`);
  }
  if (filled(data.menuSales) && filled(data.liquorSales) && filled(data.coverCharge) && filled(data.netSales)
    && gross !== num(data.netSales)) {
    list.push(`매출구성 합계(${formatNumber(gross)})가 실매출(${formatNumber(num(data.netSales))})과 맞지 않습니다.`);
  }
  return list;
}

/**
 * 레거시 안내(경고 아님) — 마감을 막지 않는다.
 *
 * 결제구성(카드·단순현금·현금영수증) 입력칸은 2026-08-02에 없앴지만 과거 달에는 값이 저장돼 있고,
 * 관리자 매출집계 엑셀이 그 값을 그대로 내보낸다. 그 달을 다시 열어 실매출만 고치면 결제구성과 어긋난 채
 * 확정되고, 엑셀은 어긋난 값을 실적처럼 싣는다(Codex 2R 지적).
 *
 * 그렇다고 이걸 마감 차단 경고로 되살리면 안 된다 — 고칠 입력칸이 화면에서 사라졌기 때문에
 * 지점이 영영 마감할 수 없는 막다른 길이 된다. 그래서 **막지 않고 알리기만** 한다.
 */
export function computeSalesSummaryLegacyNotices(input: Partial<SalesSummary> | null): string[] {
  const data = { ...EMPTY, ...(input || {}) };
  // 세 칸이 모두 저장된 달(=결제구성을 입력하던 과거 달)에만 대조한다. 새 달은 전부 비어 있어 뜨지 않는다.
  if (!(filled(data.cardPay) && filled(data.cashPlain) && filled(data.cashReceipt) && filled(data.netSales))) return [];
  const paySum = num(data.cardPay) + num(data.cashPlain) + num(data.cashReceipt);
  if (paySum === num(data.netSales)) return [];
  return [
    `이 달에 저장된 결제구성(카드+단순현금+현금영수증 ${formatNumber(paySum)})이 실매출(${formatNumber(num(data.netSales))})과 맞지 않습니다. `
    + `결제구성 입력칸은 현재 화면에서 없어졌으므로 지점에서 고칠 수 없습니다 — 마감은 그대로 진행하시고, 본사에 알려주세요.`,
  ];
}

export function salesSummaryBlankBlocking(input: Partial<SalesSummary> | null): boolean {
  const data = { ...EMPTY, ...(input || {}) };
  // 모든 필수 칸이 채워져야 한다(값이 0이어도 "0"이면 채워진 것). 빈칸이 하나라도 있으면 차단.
  return REQUIRED_FIELDS.some((f) => !filled(String((data as any)[f.key] || "")));
}

// 마감제출 차단 여부: 금액 불일치 경고가 있거나, 사유 없는 빈칸이 있으면 true.
export function isSalesSummaryDataInvalid(input: Partial<SalesSummary> | null): boolean {
  return computeSalesSummaryWarnings(input).length > 0 || salesSummaryBlankBlocking(input);
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
  reasonBox,
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
  reasonBox?: ReactNode;
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
  // 매출구성 = 메뉴+주류+커버차지. 이 셋이 POS 실매출을 이루므로 실매출과 대조한다.
  const compositionSum = num(data.menuSales) + num(data.liquorSales) + num(data.coverCharge);
  const compositionDiff = num(data.netSales) - compositionSum;
  // 매출요약 최종값 = 실매출 + 캐치테이블 예약정산금. 예약정산금은 POS에 안 잡히므로 실매출과 겹치지 않는다.
  const netWithCatchTable = num(data.netSales) + num(data.seatCharge);

  // ---- 검증 (마감제출 가드와 동일 규칙 공유) ----
  const warnings = useMemo(() => computeSalesSummaryWarnings(data), [data]);
  const blankBlocking = salesSummaryBlankBlocking(data);
  const invalid = warnings.length > 0 || blankBlocking;
  // 과거 달 결제구성 불일치 안내 — invalid에 넣지 않는다(고칠 칸이 없어 막으면 마감 불가가 된다).
  const legacyNotices = useMemo(() => computeSalesSummaryLegacyNotices(data), [data]);

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

  // 두 카드를 하나의 격자로 보고 방향키로 오간다.
  // 열 = 카드(0 매출구성 / 1 매출요약), 행 = 카드 안의 칸 순번. 카드마다 칸 수가 달라 빈 자리가 생기는데,
  // 훅이 없는 칸을 만나면 옆 칸으로 흘려보내므로 들쭉날쭉한 격자도 그대로 동작한다.
  const { cellProps } = useSheetKeyboardNav({ rowCount: 4, colCount: 2 });

  // ---- 렌더 헬퍼: 세로형 엑셀 시트 한 행(§9-1 개정 2026-08-04) — 왼쪽 라벨 열 = 헤더 취급(엘리스),
  //      오른쪽 값 칸 = 납작 투명 입력. 모양은 index.css `#sales-summary-section .sales-sheet-*` 가 정한다.
  //      모든 칸 필수(빈칸이면 값 칸을 오류색 §11 hex 로 표시), 0 입력은 유효.
  // guideAnchor: 작성방법 안내 말풍선이 붙을 칸에만 붙인다(GuideCallouts가 data-guide로 찾는다).
  const rowField = (
    fieldKey: keyof SalesSummary,
    label: string,
    /** 셀 좌표. 열 = 카드(0 매출구성 / 1 매출요약), 행 = 그 카드 안의 순번. */
    cell: { row: number; col: number },
    guideAnchor?: string,
    /** 성격이 갈리는 행(캐치테이블) 앞을 1px 검정으로 끊는다. */
    sep = false
  ) => {
    const isBlank = !filled(String(data[fieldKey] || ""));
    const err = showErrors && isBlank;
    return (
      <div key={fieldKey} className={`sales-sheet-row ${sep ? "sales-sheet-row-sep" : ""}`} data-guide={guideAnchor}>
        <span className={`sales-sheet-label ${err ? "text-[#B91C1C]" : "text-[#212121]"}`}>{label}</span>
        <div className={`sales-sheet-cell ${err ? "is-error" : ""}`}>
          <input
            {...cellProps(cell.row, cell.col)}
            aria-label={label}
            type="text"
            inputMode="numeric"
            value={formatWithCommas(String(data[fieldKey] || ""))}
            disabled={isLocked}
            onChange={(e) => update(fieldKey, e.target.value)}
            placeholder="입력(0 가능)"
            className={`sheet-cell-input w-full h-9 px-2.5 text-xs font-mono font-black text-right focus:outline-none ${err ? "text-[#B91C1C]" : "text-zinc-900"}`}
          />
        </div>
      </div>
    );
  };

  // 자동 계산 행. strong = 카드의 최종 합계 — 앞을 1px 검정으로 끊고 값을 강조한다.
  const autoRow = (label: string, value: string, warn = false, strong = false) => (
    <div className={`sales-sheet-row ${strong ? "sales-sheet-row-sep" : ""}`}>
      <span className="sales-sheet-label text-[#212121]">
        {label} <span className="text-[9px] font-bold text-zinc-500">자동</span>
      </span>
      <span className={`sales-sheet-cell h-9 px-2.5 text-xs font-mono font-black ${warn ? "is-error text-[#B91C1C]" : strong ? "bg-[#F6F5FA] text-[#2E6DB4]" : "text-[#2E6DB4]"}`}>{value}</span>
    </div>
  );

  // 상자: 흰 바탕 + 검정 테두리, 안쪽 여백 없음 — 제목 줄·시트가 상자 폭을 꽉 채운다(§6-3과 같은 원리).
  // rounded-xl 사용: bg-white+rounded-2xl/3xl에 걸린 테두리색 !important 덮어쓰기를 피해 검정 테두리를 살린다.
  const cardCls = "bg-white rounded-xl border border-zinc-900 overflow-hidden";

  return (
    /* 표준 카드 — 카드에 padding 을 주지 않는다(제목 밴드가 카드 폭을 꽉 채워야 한다).
       안쪽 내용이 자기 여백(p-4)을 갖는다(DESIGN.md §6-3). */
    /* 키 이동 칩은 제목 밴드 상단선에 걸친다(2026-08-04) — 카드 overflow:hidden 을 피해 카드 밖 래퍼 기준. */
    <div className="relative">
      <SheetKeyHint />
    <div className="branch-sheet-card animate-fade-in" id="sales-summary-section">
      {/* 제목 밴드 = 지점 표준. 제목 → 결산월(필터) → 제출상태·마감버튼 순으로 자리가 고정된다. */}
      <div className="branch-band">
        <h3 className="branch-band-title">매출집계</h3>
        {/* 모양(28px·11px·알약·흰 바탕)은 `.branch-band-filters` 가 !important 로 강제한다 — 여기 적지 않는다. */}
        <div className="branch-band-filters">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => onMonthChange?.(e.target.value)}
            disabled={!onMonthChange}
            data-guide="sales-summary-month"
            aria-label="결산월 선택"
            title="결산월 선택"
          />
        </div>
        <div className="branch-band-actions">
          <span className="text-[11px] font-bold text-slate-400">{selectedMonth} 제출상태</span>
          <span className={`monthly-close-status-pill rounded-lg px-2.5 py-1 text-[11px] font-black ${closeStatus === "confirmed" ? "monthly-close-status-confirmed" : closeStatus === "editing" ? "monthly-close-status-editing" : "monthly-close-status-missing"}`}>
            {closeStatus === "confirmed" ? "확정" : closeStatus === "editing" ? "수정중" : "미제출"}
          </span>
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
      </div>

      <div className="p-4 space-y-4">
      {/* 확정 후 수정 시 제출 전 사유 입력(부모에서 주입) */}
      {reasonBox}

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
      {/* 과거 달 안내 — 붉은 경고(마감 차단)와 구분되도록 호박색으로, 항상 보이게 둔다. */}
      {legacyNotices.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1.5">
          {legacyNotices.map((n, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px] font-bold text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{n}</span>
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

      {/* 카드 2개(매출구성·매출요약)를 3열 격자의 왼쪽 두 칸에 두고, 오른쪽 한 칸은 비워 둔다.
          결제구성 섹션은 삭제했다(사용자 지시 2026-08-02) — 남은 두 카드가 왼쪽으로 당겨지고 빈 자리는 오른쪽에 생긴다.
          빈 칸에는 아무것도 렌더하지 않는다(빈 카드 껍데기를 두면 입력할 수 있는 칸처럼 보인다). */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={cardCls}>
          {/* 제목 줄 = 바닐라 미니 밴드(§6-3과 같은 원리, 글자만 — 아이콘 금지 §6-1) */}
          <div className="sales-sheet-title">매출구성</div>
          {rowField("menuSales", "메뉴매출", { row: 0, col: 0 })}
          {rowField("liquorSales", "주류매출", { row: 1, col: 0 })}
          {/* 전 지점 입력칸이다. 해당 없으면 0을 넣으면 되고, 0도 '채워진 값'으로 본다.
              메뉴·주류로 안 잡히는 실매출(커버차지·배달매출)을 여기 모아야 아래 검산이 맞는다. */}
          {rowField("coverCharge", "커버차지·배달매출", { row: 2, col: 0 })}
          <p className="sales-sheet-note">※ 자릿값(커버차지)과 <span className="font-black">배달매출</span>을 합쳐 입력하세요. 둘 다 없으면 <span className="font-black">0</span>을 입력하세요.</p>
          {autoRow("실매출과 차이(메뉴+주류+커버·배달)", formatNumber(compositionDiff), filled(data.netSales) && compositionDiff !== 0)}
        </div>
        <div className={cardCls}>
          <div className="sales-sheet-title">매출요약</div>
          {rowField("totalSales", "총매출", { row: 0, col: 1 })}
          {rowField("totalDiscount", "총할인", { row: 1, col: 1 })}
          {rowField("netSales", "실매출", { row: 2, col: 1 })}
          {/* 여기부터는 POS가 아니라 캐치테이블에서 받아 적는 값이다. 위 세 칸(POS 실적)과 성격이 달라
              1px 검정 선(sep)으로 끊는다. 예약정산금은 POS 실매출에 잡히지 않으므로 실매출과 겹치지 않는다. */}
          {rowField("seatCharge", "캐치테이블 예약정산금", { row: 3, col: 1 }, "sales-summary-seat-charge", true)}
          <p className="sales-sheet-note">※ 캐치테이블 예약 이용 매장은 <span className="text-rose-600 font-black">캐치테이블 관리자페이지 → 정산 → 부가세 참고자료</span> → 해당 월 선택 후 나오는 금액을 입력하세요. 해당 없으면 <span className="font-black">0</span>을 입력하세요.</p>
          {autoRow("실매출 + 캐치테이블", formatNumber(netWithCatchTable), false, true)}
        </div>
      </div>
      </div>
    </div>
    </div>
  );
}
