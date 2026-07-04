// src/pages/branch/tabs/MonthlyPurchaseSalesSubTab.tsx  (BranchConfirmPage에서 분리 — 동작 변경 없음)
import { useState, useEffect, useCallback, useRef } from "react";
import { Check, Coins, FileText, Landmark, Plus, Trash2, TrendingUp } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import { formatNumber } from "../../../utils/formatNumber";
import { addMonthsToMonthInputValue, cleanNumeric, formatWithCommas } from "../helpers/formatters";
import { pendingLocalSaveStorageKey } from "../helpers/staffHelpers";

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
  memo: string;
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
  const storageKey = `erp_monthly_purchases_${branchName}_${selectedMonth}`;
  const sharedKey = `monthly_purchases:${branchName}:${selectedMonth}`;
  const pendingKey = pendingLocalSaveStorageKey(storageKey);

  const normalizePurchaseRows = useCallback((sourceRows: PurchaseSalesRow[]) => {
    return sourceRows.map((row) => ({ ...row, prepaidChargeAmount: row.prepaidChargeAmount || "" }));
  }, []);

  const emptyAmounts = useCallback((sourceRows: PurchaseSalesRow[]) => {
    return normalizePurchaseRows(sourceRows).map((row) => ({
      ...row,
      id: `p_${selectedMonth}_${row.id || Date.now()}`,
      transferAmount: "",
      prepaidChargeAmount: "",
      monthlyUsageAmount: ""
    }));
  }, [normalizePurchaseRows, selectedMonth]);

  const defaultRows = useCallback((): PurchaseSalesRow[] => ([
    {
      id: "p1",
      category: "식재료비",
      vendorName: "주식회사 식자재창고",
      transferAmount: "1250000",
      bank: "국민은행",
      accountNumber: "123-456-789012",
      isPrepaid: false,
      prepaidChargeAmount: "",
      monthlyUsageAmount: "1250000",
      memo: "일반 후불 외상 결제"
    },
    {
      id: "p2",
      category: "식음료외 기타",
      vendorName: "드림 물류 (선입금 업체)",
      transferAmount: "0",
      bank: "신한은행",
      accountNumber: "987-654-321098",
      isPrepaid: true,
      prepaidChargeAmount: "0",
      monthlyUsageAmount: "450000",
      memo: "매월 선충전 후 발주금액 차감 방식"
    }
  ]), []);

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
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      gasClient.saveSharedData(sharedKey, nextRows)
        .then(() => {
          localStorage.removeItem(pendingKey);
          if (showToast) triggerToast("매입매출 내용이 저장되었습니다!", "success");
        })
        .catch(() => triggerToast("저장 중 부득이한 에러발생", "error"));
    }, 450);
  }, [pendingKey, sharedKey, storageKey, triggerToast]);

  const handleSave = async () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(rows));
      localStorage.setItem(pendingKey, "1");
      await gasClient.saveSharedData(sharedKey, rows);
      localStorage.removeItem(pendingKey);
      triggerToast("매입매출 내용이 저장되었습니다!", "success");
    } catch {
      triggerToast("저장 중 부득이한 에러발생", "error");
    }
  };

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
        return updated;
      });
      localStorage.setItem(storageKey, JSON.stringify(nextRows));
      localStorage.setItem(pendingKey, "1");
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = window.setTimeout(() => {
        gasClient.saveSharedData(sharedKey, nextRows)
          .then(() => localStorage.removeItem(pendingKey))
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
      memo: ""
    };
    persistRows([...rows, nextRow]);
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
        monthlyUsageAmount: ""
      }));
      localStorage.setItem(storageKey, JSON.stringify(resetRows));
      localStorage.setItem(pendingKey, "1");
      gasClient.saveSharedData(sharedKey, resetRows)
        .then(() => localStorage.removeItem(pendingKey))
        .catch((error) => {
          console.warn("월말마감 취소 금액 초기화 저장 실패:", error);
        });
      return resetRows;
    });
  }, [pendingKey, resetToken, sharedKey, storageKey]);

  // Calculations
  const totalTransfer = rows.reduce((acc, r) => acc + (Number(r.transferAmount) || 0), 0);
  const totalPrepaidCharge = rows.reduce((acc, r) => acc + (Number(r.prepaidChargeAmount) || 0), 0);
  const totalUsage = rows.reduce((acc, r) => acc + (Number(r.monthlyUsageAmount) || 0), 0);

  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5 animate-fade-in" id="purchase-sales-subtab">
      <div className="flex justify-between items-center pb-3 border-b border-gray-50">
        <div>
          <h3 className="text-sm font-black text-zinc-900 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-[#2E6DB4]" />
            월말 이체 필요한 거래처 등록
          </h3>
          <p className="text-[10px] text-gray-400 font-semibold mt-0.5">
            이체 필요한 업체만 기입을 하세요. 쿠팡,네이버는 등록x
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleAddRow}
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
      {isLocked && (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
          월말마감이 확정되어 입력값이 잠겨 있습니다. 수정하려면 상단의 월말마감 수정 버튼을 눌러주세요.
        </div>
      )}

      {/* Aggregate Banner cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-zinc-50/50 p-4 rounded-2xl border border-zinc-100/80 flex justify-between items-center">
          <div>
            <span className="text-[10px] text-gray-400 font-black font-sans">선입금 충전금액 합계</span>
            <p className="text-xl font-black text-blue-700 font-mono mt-0.5">{formatNumber(totalPrepaidCharge)} 원</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-700">
            <Landmark className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-zinc-50/50 p-4 rounded-2xl border border-zinc-100/80 flex justify-between items-center">
          <div>
            <span className="text-[10px] text-gray-400 font-black font-sans">이번 달 실제 현금이체 합계</span>
            <p className="text-xl font-black text-gray-900 font-mono mt-0.5">{formatNumber(totalTransfer)} 원</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600">
            <Coins className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-zinc-50/50 p-4 rounded-2xl border border-zinc-100/80 flex justify-between items-center">
          <div>
            <span className="text-[10px] text-gray-400 font-black font-sans">이달 실제 총 사용금액 합계 (선입금 포함)</span>
            <p className="text-xl font-black text-[#2E6DB4] font-mono mt-0.5">{formatNumber(totalUsage)} 원</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-[#2E6DB4]">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Sheet Table */}
      <div className="overflow-x-auto rounded-2xl border border-gray-100">
        <table className="w-full text-left text-xs border-collapse font-medium">
          <thead>
            <tr className="bg-zinc-50 border-b border-gray-100 text-zinc-500 font-black text-[10px] tracking-wider">
              <th className="py-3 px-3">분류항목</th>
              <th className="py-3 px-3">송금/사용 대상업체명</th>
              <th className="py-3 px-3 w-32">선입금 충전방식?</th>
              <th className="py-3 px-3 w-32">충전금액 (원)</th>
              <th className="py-3 px-3 w-36">이체필요 금액 (원)</th>
              <th className="py-3 px-3 w-32">실제 이달사용액 (원)</th>
              <th className="py-3 px-3 w-28">은행</th>
              <th className="py-3 px-3">계좌번호</th>
              <th className="py-3 px-3">거래 비고 고지</th>
              <th className="py-3 px-3 text-center w-12">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-[11px]">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-16 text-center text-gray-400">
                  매입매출에 등록된 거래처가 없습니다. 상단의 '매입 업체 추가'를 클릭해 작성해주세요.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50/30">
                  <td className="py-2 px-2.5">
                    <select
                      value={row.category}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "category", e.target.value)}
                      className="w-full p-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-800 focus:outline-none disabled:bg-zinc-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    >
                      <option value="식재료비">식재료비</option>
                      <option value="주류비">주류비</option>
                      <option value="식음료외 기타">식음료외 기타</option>
                    </select>
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      value={row.vendorName}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "vendorName", e.target.value)}
                      placeholder="자재상호 혹은 업체명"
                      className="w-full p-1.5 border border-gray-200 rounded-lg text-xs font-bold placeholder-gray-300 focus:outline-none focus:border-[#2E6DB4] disabled:bg-zinc-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="py-2 px-2.5 text-center">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={row.isPrepaid}
                        disabled={isLocked}
                        onChange={(e) => handleUpdateRow(row.id, "isPrepaid", e.target.checked)}
                        className="w-4 h-4 text-[#2E6DB4] border-gray-300 rounded focus:ring-1 focus:ring-[#2E6DB4] disabled:cursor-not-allowed"
                      />
                      <span className="text-[9px] font-black text-gray-600">선입금</span>
                    </label>
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatWithCommas(row.prepaidChargeAmount || "")}
                      disabled={isLocked || !row.isPrepaid}
                      onChange={(e) => handleUpdateRow(row.id, "prepaidChargeAmount", e.target.value)}
                      placeholder={row.isPrepaid ? "충전 금액" : "-"}
                      className={`w-full p-1.5 border rounded-lg text-xs font-mono font-black text-right focus:outline-none ${
                        row.isPrepaid ? "border-gray-200 focus:border-[#2E6DB4] text-blue-700" : "bg-zinc-100 text-gray-400 border-gray-200 cursor-not-allowed"
                      }`}
                    />
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatWithCommas(row.transferAmount)}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "transferAmount", e.target.value)}
                      placeholder="송금 필요 금액"
                      className="w-full p-1.5 border border-gray-200 rounded-lg text-xs font-mono font-black text-right focus:outline-none focus:border-[#2E6DB4] text-red-650 disabled:bg-zinc-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatWithCommas(row.monthlyUsageAmount)}
                      disabled={isLocked || !row.isPrepaid}
                      onChange={(e) => handleUpdateRow(row.id, "monthlyUsageAmount", e.target.value)}
                      placeholder={row.isPrepaid ? "발주액 합계" : "-"}
                      className={`w-full p-1.5 border rounded-lg text-xs font-mono font-black text-right focus:outline-none ${
                        row.isPrepaid ? "border-gray-200 focus:border-[#2E6DB4] text-gray-800" : "bg-zinc-100 text-gray-400 border-gray-200 cursor-not-allowed"
                      }`}
                    />
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      value={row.bank}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "bank", e.target.value)}
                      placeholder="은행"
                      className="w-full p-1.5 border border-gray-200 rounded-lg text-xs font-bold placeholder-gray-300 focus:outline-none focus:border-[#2E6DB4] disabled:bg-zinc-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      value={row.accountNumber}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "accountNumber", e.target.value)}
                      placeholder="계좌 번호 입력"
                      className="w-full p-1.5 border border-gray-200 rounded-lg text-xs font-mono font-medium placeholder-gray-300 focus:outline-none focus:border-[#2E6DB4] disabled:bg-zinc-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="py-2 px-2.5">
                    <input
                      type="text"
                      value={row.memo}
                      disabled={isLocked}
                      onChange={(e) => handleUpdateRow(row.id, "memo", e.target.value)}
                      placeholder="예시: 매월 자동 이체"
                      className="w-full p-1.5 border border-gray-200 rounded-lg text-xs font-semibold placeholder-gray-350 focus:outline-none focus:border-[#2E6DB4] disabled:bg-zinc-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="py-2 px-2.5 text-center">
                    <button
                      onClick={() => handleDeleteRow(row.id)}
                      disabled={isLocked}
                      className="text-gray-400 hover:text-rose-600 p-1.5 rounded-lg transition-colors cursor-pointer disabled:text-gray-200 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
