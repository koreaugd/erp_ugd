// src/pages/branch/tabs/MonthlyPurchaseSalesSubTab.tsx  (BranchConfirmPage에서 분리 — 동작 변경 없음)
import { useState, useEffect, useCallback, useRef } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import { SheetKeyHint } from "../../../components/SheetKeyHint";
import { formatNumber } from "../../../utils/formatNumber";
import { addMonthsToMonthInputValue, cleanNumeric, formatWithCommas } from "../helpers/formatters";
import { pendingLocalSaveStorageKey } from "../helpers/staffHelpers";
import { purchaseRowHasExportableAmount } from "../helpers/monthlyCloseWorkbook";
import { useSheetKeyboardNav } from "../helpers/useSheetKeyboardNav";

// 표에 보이는 순서 그대로의 셀 좌표. 키보드 이동이 이 순서를 따른다.
const COL_CATEGORY = 0;
const COL_VENDOR = 1;
const COL_IS_PREPAID = 2;
const COL_TRANSFER_NEEDED = 3;
const COL_PREPAID_CHARGE = 4;
const COL_TRANSFER_AMOUNT = 5;
const COL_MONTHLY_USAGE = 6;
const COL_BANK = 7;
const COL_ACCOUNT = 8;
const COL_MEMO = 9;
const PURCHASE_COL_COUNT = 10;

interface PurchaseSalesRow {
  id: string;
  category: "식재료비" | "주류비" | "식음료외 기타";
  vendorName: string;
  transferAmount: string;
  bank: string;
  accountNumber: string;
  isPrepaid: boolean;
  prepaidChargeAmount?: string;
  monthlyUsageAmount: string;
  // 이체 필요 여부: 체크=이체 필요(기본), 해제=이미 결제 완료. 옛 데이터엔 없으므로 로드 시 true로 보정.
  transferNeeded?: boolean;
  memo: string;
}

// 분류항목 표시 정렬 순서 (식재료비 → 주류비 → 식음료외 기타). 저장 순서는 건드리지 않고 화면 표시에만 사용.
const CATEGORY_ORDER: Record<PurchaseSalesRow["category"], number> = {
  "식재료비": 0,
  "주류비": 1,
  "식음료외 기타": 2,
};

// 분류항목별 행 배경색은 index.css에서 DESIGN.md 토큰(--branch-vanilla/honey/alice)으로 지정한다.
// (.branch-redesign #purchase-sales-subtab tbody tr[data-cat=...]) — tbody nth-child !important 줄무늬를
// ID 특이성으로 이겨야 하므로 Tailwind bg 클래스 대신 CSS 규칙 + data-cat 속성으로 처리.

// 마감제출 전, "지점이 수정/등록한 최신 내용"이 서버(공유)에 반영된 뒤에만 확정되도록 보장한다. 실패하면 blocked=true.
// (0) 이 기기에 미저장 편집(pending)이 있으면 내용 불문(추가·수정·삭제·비움) 확정 전에 서버로 반영하고 그 상태로 판정
//     → pending이 옛 서버값에 밀려 무시된 채 확정되는(=옛/삭제전 데이터가 다운로드되는) 사고를 방지. 실패 시 확정 차단(fail-safe).
// (1) pending이 없으면 서버 최신값을 신뢰(실 데이터 있으면 통과)  (2) 서버가 비었고 로컬에 실 데이터가 있으면 복구 저장
// (3) 둘 다 없거나 서버 확인 실패 → 중단
// ※ 지점당 단일 로그인·단일 기기 사용 전제. 같은 지점·달을 두 기기서 동시 편집하는 경우의 충돌 방어는
//   명시적 결정(2026-07-08)으로 범위 외 — 완전 방어가 필요하면 payload에 버전/타임스탬프를 심어 별도 대응.
export async function flushMonthlyPurchasesForClose(branchName: string, selectedMonth: string): Promise<{ blocked: boolean }> {
  const storageKey = `erp_monthly_purchases_${branchName}_${selectedMonth}`;
  const sharedKey = `monthly_purchases:${branchName}:${selectedMonth}`;
  const pendingKey = pendingLocalSaveStorageKey(storageKey);
  const readLocal = (): PurchaseSalesRow[] | null => {
    try { const raw = localStorage.getItem(storageKey); return raw ? JSON.parse(raw) : null; } catch { return null; }
  };
  // 확정 판정은 실제 export(5시트 매입매출 대장)에 0 초과 금액으로 나가는 행이 하나라도 있는지로 본다.
  // export에 안 나가는 값(결제완료 이체금액·선입금 충전액)만으로 확정되면 '확정인데 워크북은 0/0' 모순이 생기므로,
  // 관리자 다운로드 게이트와 동일한 공유 헬퍼(purchaseRowHasExportableAmount)를 사용한다.
  const hasMeaningful = (rows: PurchaseSalesRow[] | null) =>
    Array.isArray(rows) && rows.some(purchaseRowHasExportableAmount);
  const local = readLocal();

  // 0) 이 기기에 미저장 편집(pending)이 있으면, 그 최신 상태(행 추가·수정·삭제·비움 모두 포함)를 확정 전에 서버로 반영한다.
  //    → 지점이 방금 수정하거나 비운 내용이 옛 서버값에 밀려 무시된 채 확정되는 경우를 전부 차단. 저장 실패 시 확정 차단(fail-safe).
  //    반영 후엔 서버=로컬이므로 로컬 기준으로 판정한다(실 데이터가 없으면 — 예: 전부 비움 — 확정 불가).
  if (localStorage.getItem(pendingKey) === "1" && Array.isArray(local)) {
    try { await gasClient.saveSharedData(sharedKey, local as PurchaseSalesRow[]); localStorage.removeItem(pendingKey); }
    catch { return { blocked: true }; }
    return hasMeaningful(local) ? { blocked: false } : { blocked: true };
  }

  // 1) 미저장 편집이 없으면 서버(공유) 최신값을 신뢰한다(오프라인/서버 실패 → throw → 마감 차단).
  //    실 데이터가 있으면 그대로 확정(로컬로 덮어쓰지 않음).
  let remote: PurchaseSalesRow[] | null = null;
  try { remote = await gasClient.getSharedDataFromServer<PurchaseSalesRow[]>(sharedKey); }
  catch { return { blocked: true }; }
  if (hasMeaningful(remote)) return { blocked: false };

  // 2) 서버가 비었지만(=pending이 아니어서 아직 안 올라간) 로컬에 실 데이터가 있으면 복구 저장 후 확정.
  //    → "확정 기록은 있는데 서버 상세가 비어있는" 레거시 상태를 지점 재확정만으로 만회.
  if (hasMeaningful(local)) {
    try { await gasClient.saveSharedData(sharedKey, local as PurchaseSalesRow[]); localStorage.removeItem(pendingKey); return { blocked: false }; }
    catch { return { blocked: true }; }
  }

  // 3) 서버·로컬 모두 실 데이터 없음 → 확정 불가.
  return { blocked: true };
}

export function MonthlyPurchaseSalesSubTab({
  branchName,
  selectedMonth,
  triggerToast,
  resetToken = 0,
  isLocked = false
}: {
  branchName: string;
  selectedMonth: string;
  triggerToast: (msg: string, type?: "success" | "error") => void;
  resetToken?: number;
  isLocked?: boolean;
}) {
  const [rows, setRows] = useState<PurchaseSalesRow[]>([]);
  const autoSaveTimerRef = useRef<number | null>(null);
  // 저장 세대 카운터: 저장 요청 후 더 최신 편집이 있으면(gen 불일치) pending 플래그를 지우지 않는다.
  const autoSaveGenRef = useRef(0);
  const storageKey = `erp_monthly_purchases_${branchName}_${selectedMonth}`;
  const sharedKey = `monthly_purchases:${branchName}:${selectedMonth}`;
  const pendingKey = pendingLocalSaveStorageKey(storageKey);

  const normalizePurchaseRows = useCallback((sourceRows: PurchaseSalesRow[]) => {
    return sourceRows.map((row) => ({
      ...row,
      prepaidChargeAmount: row.prepaidChargeAmount || "",
      // 옛 데이터엔 transferNeeded가 없으므로 기본 '이체 필요(true)'로 보정.
      transferNeeded: row.transferNeeded ?? true,
    }));
  }, []);

  const emptyAmounts = useCallback((sourceRows: PurchaseSalesRow[]) => {
    return normalizePurchaseRows(sourceRows).map((row) => ({
      ...row,
      id: `p_${selectedMonth}_${row.id || Date.now()}`,
      transferAmount: "",
      prepaidChargeAmount: "",
      monthlyUsageAmount: "",
      // 이월 시 '결제완료' 상태는 초기화한다 — 다음 달 결제 여부는 아직 미정이므로 '이체 필요'로 시작.
      transferNeeded: true
    }));
  }, [normalizePurchaseRows, selectedMonth]);

  // 가짜 샘플 기본행을 두지 않는다(샘플이 서버로 나가 확정되는 것을 방지). 거래처는 '매입 업체 추가'로 입력.
  const defaultRows = useCallback((): PurchaseSalesRow[] => ([]), []);

  useEffect(() => {
    let cancelled = false;
    const loadPurchases = async () => {
      let nextRows: PurchaseSalesRow[] = [];
      let remoteLoaded = false;
      const hasPendingLocal = localStorage.getItem(pendingKey) === "1";
      if (hasPendingLocal) {
        try {
          const saved = localStorage.getItem(storageKey);
          if (saved) {
            nextRows = normalizePurchaseRows(JSON.parse(saved));
            remoteLoaded = true;
          }
        } catch {}
      }
      try {
        const remote = await gasClient.getSharedData<PurchaseSalesRow[]>(sharedKey);
        if (!hasPendingLocal && Array.isArray(remote)) {
          nextRows = normalizePurchaseRows(remote);
          remoteLoaded = true;
        }
      } catch (error) {
        console.warn("월 매입 공통 데이터를 불러오지 못했습니다.", error);
      }
      if (!remoteLoaded && nextRows.length === 0) {
        try {
          const saved = localStorage.getItem(storageKey);
          if (saved) nextRows = normalizePurchaseRows(JSON.parse(saved));
        } catch {}
      }
      if (!remoteLoaded && nextRows.length === 0) {
        const previousMonth = addMonthsToMonthInputValue(selectedMonth, -1);
        try {
          const previous = await gasClient.getSharedData<PurchaseSalesRow[]>(`monthly_purchases:${branchName}:${previousMonth}`);
          if (Array.isArray(previous) && previous.length > 0) nextRows = emptyAmounts(previous);
        } catch {}
      }
      if (!remoteLoaded && nextRows.length === 0) {
        try {
          const previousLocal = localStorage.getItem(`erp_monthly_purchases_${branchName}_${addMonthsToMonthInputValue(selectedMonth, -1)}`);
          if (previousLocal) nextRows = emptyAmounts(JSON.parse(previousLocal));
        } catch {}
      }
      if (!remoteLoaded && nextRows.length === 0) nextRows = defaultRows();
      if (!cancelled) {
        setRows(nextRows);
        localStorage.setItem(storageKey, JSON.stringify(nextRows));
        if (hasPendingLocal && remoteLoaded) {
          gasClient.saveSharedData(sharedKey, nextRows)
            .then(() => localStorage.removeItem(pendingKey))
            .catch((error) => console.warn("월 매입 공통 데이터 재저장 실패", error));
        }
      }
    };
    loadPurchases();
    return () => {
      cancelled = true;
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      if (localStorage.getItem(pendingKey) === "1") {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          try {
            const pendingRows = normalizePurchaseRows(JSON.parse(saved));
            void gasClient.saveSharedData(sharedKey, pendingRows)
              .then(() => localStorage.removeItem(pendingKey))
              .catch((error) => console.warn("Pending monthly purchases save failed during tab change.", error));
          } catch (error) {
            console.warn("Pending monthly purchases could not be parsed during tab change.", error);
          }
        }
      }
    };
  }, [branchName, defaultRows, emptyAmounts, normalizePurchaseRows, pendingKey, selectedMonth, sharedKey, storageKey]);

  const persistRows = useCallback((nextRows: PurchaseSalesRow[], showToast = false) => {
    setRows(nextRows);
    localStorage.setItem(storageKey, JSON.stringify(nextRows));
    localStorage.setItem(pendingKey, "1");
    const gen = ++autoSaveGenRef.current;
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      gasClient.saveSharedData(sharedKey, nextRows)
        .then(() => {
          if (autoSaveGenRef.current === gen) localStorage.removeItem(pendingKey);
          if (showToast) triggerToast("매입매출 내용이 저장되었습니다!", "success");
        })
        .catch(() => triggerToast("저장 중 부득이한 에러발생", "error"));
    }, 450);
  }, [pendingKey, sharedKey, storageKey, triggerToast]);

  const handleUpdateRow = (id: string, field: keyof PurchaseSalesRow, val: any) => {
    if (isLocked) return;
    const nextValue = ["transferAmount", "prepaidChargeAmount", "monthlyUsageAmount"].includes(String(field))
      ? cleanNumeric(String(val || ""))
      : val;
    setRows(prev => {
      const nextRows = prev.map(r => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: nextValue };
        // If it's regular vendor and transferAmount changes, sync usageAmount
        if (field === "transferAmount" && !updated.isPrepaid) {
          updated.monthlyUsageAmount = nextValue;
        }
        if (field === "isPrepaid" && val === true && !updated.prepaidChargeAmount) {
          updated.prepaidChargeAmount = updated.transferAmount || "";
        }
        if (field === "isPrepaid" && val === false) {
          updated.prepaidChargeAmount = "";
          updated.monthlyUsageAmount = updated.transferAmount || "";
        }
        // 이체 필요?를 다시 체크(true)하면 비선입금 업체의 이달사용액은 이체 필요금액을 다시 미러링한다.
        // (결제완료 상태에서 따로 적은 값은 '이체 필요' 복귀 시 이체금액 기준으로 되돌린다.)
        if (field === "transferNeeded" && val === true && !updated.isPrepaid) {
          updated.monthlyUsageAmount = updated.transferAmount || "";
        }
        return updated;
      });
      localStorage.setItem(storageKey, JSON.stringify(nextRows));
      localStorage.setItem(pendingKey, "1");
      const gen = ++autoSaveGenRef.current;
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = window.setTimeout(() => {
        gasClient.saveSharedData(sharedKey, nextRows)
          .then(() => { if (autoSaveGenRef.current === gen) localStorage.removeItem(pendingKey); })
          .catch(() => triggerToast("저장 중 부득이한 에러발생", "error"));
      }, 450);
      return nextRows;
    });
  };

  const handleAddRow = () => {
    if (isLocked) return;
    const nextRow: PurchaseSalesRow = {
      id: `p_${Date.now()}`,
      category: "식재료비",
      vendorName: "",
      transferAmount: "",
      bank: "",
      accountNumber: "",
      isPrepaid: false,
      prepaidChargeAmount: "",
      monthlyUsageAmount: "",
      transferNeeded: true,
      memo: ""
    };
    persistRows([...rows, nextRow]);
    return nextRow.id;
  };

  /**
   * 새로 추가한 행으로 커서를 보내기 위해 id를 들고 있는다.
   * 표는 분류항목으로 정렬돼 표시되므로 새 행이 맨 아래로 간다는 보장이 없다 — 그려진 뒤 위치를 찾아야 한다.
   */
  const pendingFocusRowId = useRef<string | null>(null);

  const addRowAndFocus = () => {
    const newId = handleAddRow();
    if (newId) pendingFocusRowId.current = newId;
  };

  const handleDeleteRow = (id: string) => {
    if (isLocked) return;
    persistRows(rows.filter(r => r.id !== id));
  };

  useEffect(() => {
    if (!resetToken) return;
    setRows((currentRows) => {
      const resetRows = currentRows.map((row) => ({
        ...row,
        transferAmount: "",
        prepaidChargeAmount: "",
        monthlyUsageAmount: "",
        // 금액 초기화 시 '결제완료' 상태도 초기화 — 재입력한 이체가 결제완료로 오인돼 배너·엑셀에서 누락되는 것을 방지.
        transferNeeded: true
      }));
      localStorage.setItem(storageKey, JSON.stringify(resetRows));
      localStorage.setItem(pendingKey, "1");
      // 대기 중이던 디바운스 저장이 초기화값을 덮어쓰지 못하도록 타이머 취소 + 세대 갱신.
      if (autoSaveTimerRef.current) { window.clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
      const gen = ++autoSaveGenRef.current;
      gasClient.saveSharedData(sharedKey, resetRows)
        .then(() => { if (autoSaveGenRef.current === gen) localStorage.removeItem(pendingKey); })
        .catch((error) => {
          console.warn("월말마감 취소 금액 초기화 저장 실패:", error);
        });
      return resetRows;
    });
  }, [pendingKey, resetToken, sharedKey, storageKey]);

  // Calculations
  // 결제완료(이체 필요 해제) 업체는 이체 불필요이므로 이체 합계에서 제외 — 관리자 엑셀(이체금액 0 처리)과 일치시킨다.
  const totalTransfer = rows.reduce((acc, r) => acc + (r.transferNeeded === false ? 0 : (Number(r.transferAmount) || 0)), 0);
  const totalPrepaidCharge = rows.reduce((acc, r) => acc + (Number(r.prepaidChargeAmount) || 0), 0);
  const totalUsage = rows.reduce((acc, r) => acc + (Number(r.monthlyUsageAmount) || 0), 0);

  // 화면 표시용 정렬: 분류항목 순서대로(식재료비→주류비→식음료외 기타). Array.sort는 안정 정렬이라 같은 분류 내 입력 순서는 유지된다.
  // 저장(rows)·자동저장·확정 로직은 원래 순서를 그대로 쓰므로 표시 정렬은 부작용이 없다.
  const displayRows = [...rows].sort((a, b) => (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99));

  // 엑셀처럼 키보드로 칸을 옮긴다.
  // 마지막 행에서 ↓/Enter로 행을 늘리지는 않는다 — 아래로 훑어보다가 실수로 빈 업체가 생긴다.
  // 업체는 '매입 업체 추가' 버튼으로만 늘린다.
  const { cellProps, isActive, focusCell } = useSheetKeyboardNav({
    rowCount: displayRows.length,
    colCount: PURCHASE_COL_COUNT
  });

  // 엑셀 셀: 격자선은 td가 긋고, 현재 칸은 굵은 테두리로 짚어준다. 분류별 행 색상(data-cat)은 그대로 비쳐 보인다.
  const cellTd = (rowIndex: number, col: number, extra = "") =>
    [
      "border-r border-b border-black/10 p-0 relative",
      isActive(rowIndex, col) ? "outline outline-2 -outline-offset-2 outline-[#2E6DB4] z-10" : "",
      extra
    ].join(" ");
  // sheet-cell-input: index.css에서 전역 input 배경/테두리 !important를 ID 특이성으로 되돌리는 클래스.
  const cellInput = "sheet-cell-input w-full h-9 px-2 text-xs focus:outline-none";

  // 새로 추가한 업체가 그려지면 그 행의 업체명 칸으로 커서를 보낸다.
  // (분류항목 정렬 때문에 새 행이 표 맨 아래에 있지 않을 수 있어, id로 위치를 찾는다.)
  useEffect(() => {
    const targetId = pendingFocusRowId.current;
    if (!targetId) return;
    const index = displayRows.findIndex((row) => row.id === targetId);
    if (index < 0) return;
    pendingFocusRowId.current = null;
    focusCell(index, COL_VENDOR);
  }, [displayRows, focusCell]);

  return (
    <div className="space-y-5 animate-fade-in" id="purchase-sales-subtab">
      {isLocked && (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
          월말마감이 확정되어 입력값이 잠겨 있습니다. 수정하려면 상단의 월말마감 수정 버튼을 눌러주세요.
        </div>
      )}

      {/* Aggregate Banner cards */}
      {/* 합계 카드 3장을 없앴다 — 세 숫자는 각각 표의 한 열 합계라, 그 열 바로 아래(표 바닥 합계 행)에
          있어야 무슨 숫자인지 설명 없이 읽힌다. 합계 행이 바닥에 고정돼 늘 보이므로,
          위쪽에 같은 숫자를 또 띄우면 같은 값을 두 군데서 관리하게 될 뿐이다. */}

      {/* 매입 업체 추가 / 저장 상태 — 지점이 작성하는 표 바로 위에 배치 */}
      <div className="flex flex-wrap justify-end items-center gap-2">
        <div className="flex items-center gap-2">
        <button
          onClick={addRowAndFocus}
          disabled={isLocked}
          className="p-1 px-3 bg-blue-50 hover:bg-blue-100 text-[#2E6DB4] rounded-lg text-xs font-black flex items-center gap-1 cursor-pointer transition-colors shadow-none disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" /> 매입 업체 추가
        </button>
        <div className={`p-1 px-3.5 rounded-lg text-xs font-black flex items-center gap-1 shadow-subtle ${isLocked ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}>
          <Check className="w-3.5 h-3.5" /> {isLocked ? "확정 잠금" : "자동저장"}
        </div>
        </div>
      </div>

      {/* Sheet Table — 표 자체가 가로 스크롤(overflow)이라 칩은 바깥 relative 층에 얹는다. */}
      <div className="relative">
      <SheetKeyHint />
      <div className="max-h-[62vh] overflow-auto rounded-2xl border border-gray-100" data-guide="purchase-table">
        <table className="w-full text-left text-xs border-collapse font-medium">
          <thead>
            <tr className="bg-zinc-50 border-b border-gray-100 text-zinc-500 font-black text-[10px] tracking-wider">
              <th className="py-3 px-3">분류항목</th>
              <th className="py-3 px-3">업체명</th>
              <th className="py-3 px-3 w-20">선입금 충전?</th>
              <th className="py-3 px-3 w-20 text-center">이체 필요?</th>
              <th className="py-3 px-3 w-24">충전금액 (원)</th>
              <th className="py-3 px-3 w-24">이체필요 금액 (원)</th>
              <th className="py-3 px-3 w-24">실제 이달사용액 (원)</th>
              <th className="py-3 px-3 w-20">은행</th>
              <th className="py-3 px-3 min-w-[160px]">계좌번호</th>
              <th className="py-3 px-3 min-w-[150px]">거래 비고 고지</th>
              <th className="py-3 px-3 text-center w-12">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-[11px]">
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-16 text-center text-gray-400">
                  매입매출에 등록된 거래처가 없습니다. 상단의 '매입 업체 추가'를 클릭해 작성해주세요.
                </td>
              </tr>
            ) : (
              displayRows.map((row, rowIndex) => (
                <tr key={row.id} data-cat={row.category} className="transition-colors">
                  <td className={cellTd(rowIndex, COL_CATEGORY)}>
                    <select
                      {...cellProps(rowIndex, COL_CATEGORY)}
                      aria-label={`${rowIndex + 1}번 행 분류항목`}
                      value={row.category}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "category", e.target.value)}
                      className={`${cellInput} font-bold text-gray-800 cursor-pointer`}
                    >
                      <option value="식재료비">식재료비</option>
                      <option value="주류비">주류비</option>
                      <option value="식음료외 기타">식음료외 기타</option>
                    </select>
                  </td>
                  <td className={cellTd(rowIndex, COL_VENDOR)}>
                    <input
                      {...cellProps(rowIndex, COL_VENDOR)}
                      aria-label={`${rowIndex + 1}번 행 업체명`}
                      type="text"
                      value={row.vendorName}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "vendorName", e.target.value)}
                      placeholder="자재상호 혹은 업체명"
                      className={`${cellInput} font-bold placeholder-gray-300`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_IS_PREPAID, "text-center")}>
                    <label className="flex h-9 items-center justify-center gap-1.5 cursor-pointer select-none">
                      <input
                        {...cellProps(rowIndex, COL_IS_PREPAID)}
                        aria-label={`${rowIndex + 1}번 행 선입금 충전`}
                        type="checkbox"
                        checked={row.isPrepaid}
                        disabled={isLocked}
                        onChange={(e) => handleUpdateRow(row.id, "isPrepaid", e.target.checked)}
                        className="w-4 h-4 text-[#2E6DB4] border-gray-300 rounded focus:ring-2 focus:ring-[#2E6DB4] disabled:cursor-not-allowed"
                      />
                      <span className={`text-[9px] ${row.isPrepaid ? "font-black text-rose-600" : "font-normal text-gray-400"}`}>
                        선입금
                      </span>
                    </label>
                  </td>
                  <td className={cellTd(rowIndex, COL_TRANSFER_NEEDED, "text-center")}>
                    <label className="flex h-9 items-center justify-center gap-1.5 cursor-pointer select-none">
                      <input
                        {...cellProps(rowIndex, COL_TRANSFER_NEEDED)}
                        aria-label={`${rowIndex + 1}번 행 이체 필요`}
                        type="checkbox"
                        checked={row.transferNeeded ?? true}
                        disabled={isLocked}
                        onChange={(e) => handleUpdateRow(row.id, "transferNeeded", e.target.checked)}
                        className="w-4 h-4 text-[#2E6DB4] border-gray-300 rounded focus:ring-2 focus:ring-[#2E6DB4] disabled:cursor-not-allowed"
                      />
                      <span className={`text-[9px] ${(row.transferNeeded ?? true) ? "font-black text-rose-600" : "font-normal text-gray-400"}`}>
                        이체필요
                      </span>
                    </label>
                  </td>
                  <td className={cellTd(rowIndex, COL_PREPAID_CHARGE)}>
                    <input
                      {...cellProps(rowIndex, COL_PREPAID_CHARGE)}
                      aria-label={`${rowIndex + 1}번 행 충전금액`}
                      type="text"
                      inputMode="numeric"
                      value={formatWithCommas(row.prepaidChargeAmount || "")}
                      disabled={isLocked || !row.isPrepaid}
                      onChange={(e) => handleUpdateRow(row.id, "prepaidChargeAmount", e.target.value)}
                      placeholder={row.isPrepaid ? "충전 금액" : "-"}
                      className={`${cellInput} font-mono font-black text-right text-blue-700`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_TRANSFER_AMOUNT)}>
                    <input
                      {...cellProps(rowIndex, COL_TRANSFER_AMOUNT)}
                      aria-label={`${rowIndex + 1}번 행 이체필요 금액`}
                      type="text"
                      inputMode="numeric"
                      value={formatWithCommas(row.transferAmount)}
                      disabled={isLocked || row.transferNeeded === false}
                      onChange={(e) => handleUpdateRow(row.id, "transferAmount", e.target.value)}
                      placeholder={row.transferNeeded === false ? "-" : "송금 필요 금액"}
                      className={`${cellInput} font-mono font-black text-right text-red-650`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_MONTHLY_USAGE)}>
                    <input
                      {...cellProps(rowIndex, COL_MONTHLY_USAGE)}
                      aria-label={`${rowIndex + 1}번 행 실제 이달사용액`}
                      type="text"
                      inputMode="numeric"
                      value={formatWithCommas(row.monthlyUsageAmount)}
                      disabled={isLocked || !(row.isPrepaid || row.transferNeeded === false)}
                      onChange={(e) => handleUpdateRow(row.id, "monthlyUsageAmount", e.target.value)}
                      placeholder={row.isPrepaid ? "발주액 합계" : (row.transferNeeded === false ? "이달 사용액" : "-")}
                      className={`${cellInput} font-mono font-black text-right text-gray-800`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_BANK)}>
                    <input
                      {...cellProps(rowIndex, COL_BANK)}
                      aria-label={`${rowIndex + 1}번 행 은행`}
                      type="text"
                      value={row.bank}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "bank", e.target.value)}
                      placeholder="은행"
                      className={`${cellInput} font-bold placeholder-gray-300`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_ACCOUNT)}>
                    <input
                      {...cellProps(rowIndex, COL_ACCOUNT)}
                      aria-label={`${rowIndex + 1}번 행 계좌번호`}
                      type="text"
                      value={row.accountNumber}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "accountNumber", e.target.value)}
                      placeholder="계좌 번호 입력"
                      className={`${cellInput} font-mono font-medium placeholder-gray-300`}
                    />
                  </td>
                  <td className={cellTd(rowIndex, COL_MEMO)}>
                    <input
                      {...cellProps(rowIndex, COL_MEMO)}
                      aria-label={`${rowIndex + 1}번 행 거래 비고`}
                      type="text"
                      value={row.memo}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "memo", e.target.value)}
                      placeholder="예시: 매월 자동 이체"
                      className={`${cellInput} font-semibold placeholder-gray-350`}
                    />
                  </td>
                  <td className="border-b border-black/10 p-0 text-center">
                    <button
                      onClick={() => handleDeleteRow(row.id)}
                      disabled={isLocked}
                      tabIndex={-1}
                      title={`${rowIndex + 1}번 행 삭제`}
                      className="text-gray-400 hover:text-rose-600 p-1.5 rounded-lg transition-colors cursor-pointer disabled:text-gray-200 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {/* 합계는 각 열 바로 아래에 정렬돼야 무슨 숫자인지 설명이 필요 없다.
              스크롤과 무관하게 바닥에 붙여 둔다(발주내역 리포트와 같은 방식). */}
          {rows.length > 0 && (
            <tfoot className="sticky bottom-0 z-10">
              <tr className="bg-zinc-100 text-[11px] font-black text-zinc-800 shadow-[0_-1px_0_0_rgb(203_213_225)]">
                <td className="bg-zinc-100 py-2 px-3" colSpan={4}>합계</td>
                <td className="bg-zinc-100 py-2 px-3 text-right font-mono">{formatNumber(totalPrepaidCharge)}</td>
                <td className="bg-zinc-100 py-2 px-3 text-right font-mono">{formatNumber(totalTransfer)}</td>
                <td className="bg-zinc-100 py-2 px-3 text-right font-mono text-[#2E6DB4]">{formatNumber(totalUsage)}</td>
                <td className="bg-zinc-100 py-2 px-3" colSpan={4}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      </div>
    </div>
  );
}
