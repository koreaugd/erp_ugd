// src/pages/branch/tabs/LiquorInventoryTabV2.tsx
// 주류재고 탭. BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Database, Plus, X } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import type { InventoryMovement, InventoryProduct } from "../types";
import { cleanNumeric, addDaysToDateInputValue, addMonthsToMonthInputValue, toLocalDateInputValue, toLocalMonthInputValue } from "../helpers/formatters";
import { pendingLocalSaveStorageKey } from "../helpers/staffHelpers";
import { LIQUOR_CATEGORIES, VENDOR_HINT, getLiquorCategoryClass, monthDays } from "../helpers/orderHelpers";
import { useSheetKeyboardNav } from "../helpers/useSheetKeyboardNav";

// 왼쪽에 고정되는 세 칸(분류·상품명·전일)의 너비. 고정 위치를 계산해야 하므로 px로 못박는다.
const COL_CATEGORY_W = 96;
const COL_ITEM_W = 192;
const COL_PREV_W = 72;
// 날짜 하나가 차지하는 입·판·재 세 칸의 너비. 못박지 않으면 내용(1 vs 10)에 따라 폭이 들쭉날쭉해진다.
const COL_DAY_CELL_W = 48;

export function LiquorInventoryTabV2({ branchName }: { branchName: string }) {
  const productKey = "erp_liquor_products_" + branchName;
  const movementKey = "erp_liquor_movements_" + branchName;
  const sharedProductKey = "liquor_products:" + branchName;
  const sharedMovementKey = "liquor_movements:" + branchName;
  const productPendingKey = pendingLocalSaveStorageKey(productKey);
  const movementPendingKey = pendingLocalSaveStorageKey(movementKey);
  const productSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movementSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [classification, setClassification] = useState("샴페인");
  const [itemName, setItemName] = useState("");
  const [draftDate, setDraftDate] = useState(() => toLocalDateInputValue());
  // 기본은 엑셀형 재고 시트. "당일 입력"은 하루치만 빠르게 치고 싶을 때 쓰는 보조 화면으로 남긴다.
  const [inventoryView, setInventoryView] = useState<"sheet" | "daily">("sheet");
  const [categoryFilter, setCategoryFilter] = useState("전체");
  const [draftCells, setDraftCells] = useState<Record<string, { inbound: string; sold: string }>>({});
  // 재고 시트가 보고 있는 달. 기본은 이번 달이고, 전월 버튼으로 거슬러 올라간다.
  const [sheetMonth, setSheetMonth] = useState(() => toLocalMonthInputValue());
  const sheetScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const savedProducts = localStorage.getItem(productKey);
      const savedMovements = localStorage.getItem(movementKey);
      if (savedProducts) setProducts(JSON.parse(savedProducts));
      if (savedMovements) setMovements(JSON.parse(savedMovements));
    } catch (err) {
      console.error("Failed to load liquor inventory", err);
    }
  }, [productKey, movementKey]);

  const saveLiquorSharedDebounced = useCallback((key: string, value: unknown, timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>, pendingKey: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    localStorage.setItem(pendingKey, "1");
    void gasClient.saveSharedData(key, value)
      .then(() => localStorage.removeItem(pendingKey))
      .catch((error) => {
        console.error("Failed to save shared liquor inventory", error);
      });
  }, []);

  const parseLiquorJsonArray = useCallback(<T,>(json: string | null): T[] => {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, []);

  const mergeById = useCallback(<T extends { id: string }>(remoteItems: T[], localItems: T[]) => {
    const byId = new Map<string, T>();
    [...remoteItems, ...localItems].forEach((item) => {
      if (!item?.id) return;
      byId.set(item.id, item);
    });
    return Array.from(byId.values());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const localProductsJson = localStorage.getItem(productKey);
    const localMovementsJson = localStorage.getItem(movementKey);

    void Promise.all([
      gasClient.getSharedData<InventoryProduct[]>(sharedProductKey),
      gasClient.getSharedData<InventoryMovement[]>(sharedMovementKey)
    ]).then(([remoteProducts, remoteMovements]) => {
      if (cancelled) return;
      const localProducts = parseLiquorJsonArray<InventoryProduct>(localProductsJson);
      const hasPendingProducts = localStorage.getItem(productPendingKey) === "1" && localProductsJson !== null;
      const remoteProductItems = Array.isArray(remoteProducts) ? remoteProducts : null;
      const nextProducts = hasPendingProducts ? localProducts : remoteProductItems ?? localProducts;
      if (hasPendingProducts || remoteProductItems !== null || localProductsJson !== null) {
        setProducts(nextProducts);
        localStorage.setItem(productKey, JSON.stringify(nextProducts));
        if (hasPendingProducts) {
          void gasClient.saveSharedData(sharedProductKey, nextProducts)
            .then(() => localStorage.removeItem(productPendingKey))
            .catch((error) => console.error("Failed to resave pending liquor products", error));
        }
      }

      const localMovements = parseLiquorJsonArray<InventoryMovement>(localMovementsJson);
      const hasPendingMovements = localStorage.getItem(movementPendingKey) === "1" && localMovementsJson !== null;
      const remoteMovementItems = Array.isArray(remoteMovements) ? remoteMovements : null;
      const nextMovements = hasPendingMovements ? localMovements : remoteMovementItems ?? localMovements;
      if (hasPendingMovements || remoteMovementItems !== null || localMovementsJson !== null) {
        setMovements(nextMovements);
        localStorage.setItem(movementKey, JSON.stringify(nextMovements));
        if (hasPendingMovements) {
          void gasClient.saveSharedData(sharedMovementKey, nextMovements)
            .then(() => localStorage.removeItem(movementPendingKey))
            .catch((error) => console.error("Failed to resave pending liquor movements", error));
        }
      }
    }).catch((error) => {
      console.error("Failed to load shared liquor inventory", error);
    });

    return () => {
      cancelled = true;
      if (productSaveTimerRef.current) clearTimeout(productSaveTimerRef.current);
      if (movementSaveTimerRef.current) clearTimeout(movementSaveTimerRef.current);
    };
  }, [mergeById, movementKey, movementPendingKey, parseLiquorJsonArray, productKey, productPendingKey, sharedMovementKey, sharedProductKey]);

  useEffect(() => {
    (window as any).__ugdLiquorInventoryDirty = false;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!(window as any).__ugdLiquorInventoryDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    return () => {
      (window as any).__ugdLiquorInventoryDirty = false;
    };
  }, []);

  const saveProducts = (next: InventoryProduct[]) => {
    setProducts(next);
    localStorage.setItem(productKey, JSON.stringify(next));
    saveLiquorSharedDebounced(sharedProductKey, next, productSaveTimerRef, productPendingKey);
  };

  const saveMovements = (next: InventoryMovement[]) => {
    setMovements(next);
    localStorage.setItem(movementKey, JSON.stringify(next));
    saveLiquorSharedDebounced(sharedMovementKey, next, movementSaveTimerRef, movementPendingKey);
  };

  const addProduct = (event: React.FormEvent) => {
    event.preventDefault();
    const names = itemName.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    if (names.length === 0) return;
    const nextProducts = names.map((name, index) => ({
      id: "liq-product-" + Date.now() + "-" + index,
      classification,
      importer: "",
      itemName: name,
      salePrice: "",
      costPrice: ""
    }));
    saveProducts([...products, ...nextProducts]);
    setItemName("");
  };

  const deleteProduct = (product: InventoryProduct) => {
    if (!window.confirm(product.itemName + " 상품을 삭제할까요? 해당 상품의 입고/판매 기록도 함께 삭제됩니다.")) return;
    saveProducts(products.filter((item) => item.id !== product.id));
    saveMovements(movements.filter((movement) => movement.productId !== product.id));
    setDraftCells((prev) => {
      const next: Record<string, { inbound: string; sold: string }> = {};
      (Object.entries(prev) as Array<[string, { inbound: string; sold: string }]>).forEach(([key, value]) => {
        if (!key.startsWith(product.id + "|")) next[key] = value;
      });
      return next;
    });
  };

  const updateDraft = (productId: string, date: string, field: "inbound" | "sold", value: string) => {
    const key = productId + "|" + date;
    const nextValue = cleanNumeric(value);
    const currentDraft = draftCells[key];
    const nextInbound = field === "inbound" ? nextValue : (currentDraft?.inbound ?? String(savedAmount(productId, date, "inbound") || ""));
    const nextSold = field === "sold" ? nextValue : (currentDraft?.sold ?? String(savedAmount(productId, date, "sold") || ""));

    // 옆 칸(입고를 고치면 판매)은 손대지 않은 값이므로, 저장된 값을 그대로 물려준다.
    // 빈 문자열로 덮으면 시트에서 그 칸이 빈칸으로 보여 "기록이 날아갔다"고 오해하게 된다.
    setDraftCells((prev) => ({
      ...prev,
      [key]: {
        inbound: nextInbound,
        sold: nextSold
      }
    }));
    setMovements((currentMovements) => {
      const kept = currentMovements.filter((movement) => !(movement.productId === productId && movement.movementDate === date));
      const nextMovements = Number(nextInbound || 0) > 0 || Number(nextSold || 0) > 0
        ? [{
          id: "liq-move-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
          productId,
          movementDate: date,
          inbound: nextInbound,
          sold: nextSold,
          memo: ""
        }, ...kept]
        : kept;
      localStorage.setItem(movementKey, JSON.stringify(nextMovements));
      saveLiquorSharedDebounced(sharedMovementKey, nextMovements, movementSaveTimerRef, movementPendingKey);
      return nextMovements;
    });
  };

  const stockOf = (productId: string, untilDate?: string) => {
    return movements
      .filter((movement) => movement.productId === productId && (!untilDate || movement.movementDate <= untilDate))
      .reduce((sum, movement) => sum + Number(movement.inbound || 0) - Number(movement.sold || 0), 0);
  };

  const savedAmount = (productId: string, date: string, field: "inbound" | "sold") => {
    return movements
      .filter((movement) => movement.productId === productId && movement.movementDate === date)
      .reduce((sum, movement) => sum + Number(movement[field] || 0), 0);
  };

  const filteredProducts = useMemo(() => {
    return products.filter((product) => categoryFilter === "전체" || product.classification === categoryFilter);
  }, [categoryFilter, products]);

  /**
   * 재고 시트에 깔 날짜들 — 보고 있는 달의 1일부터.
   * 이번 달이면 오늘까지만 깐다(아직 오지 않은 날은 적을 것이 없다). 지난 달이면 그 달 전체를 깐다.
   */
  const todayKey = toLocalDateInputValue();
  const currentMonth = toLocalMonthInputValue();
  const isCurrentMonth = sheetMonth === currentMonth;
  const sheetDates = useMemo(() => {
    const dates = monthDays(sheetMonth).map((day) => `${sheetMonth}-${day}`);
    return isCurrentMonth ? dates.filter((date) => date <= todayKey) : dates;
  }, [sheetMonth, isCurrentMonth, todayKey]);

  /**
   * "전일" 칸의 기준일 — 시트의 마지막 날.
   * 이번 달이면 오늘이므로 전일 = 어제까지의 재고.
   * 지난 달을 펼쳐 보면 그 달 말일이 기준이 되어, 오늘까지의 재고가 섞여 보이지 않는다.
   */
  const sheetAnchorDate = sheetDates[sheetDates.length - 1] ?? todayKey;

  const getDraftOrSavedAmount = (productId: string, date: string, field: "inbound" | "sold") => {
    const draft = draftCells[productId + "|" + date]?.[field];
    return draft !== undefined && draft !== "" ? Number(draft || 0) : savedAmount(productId, date, field);
  };

  const stockBeforeDate = (productId: string, date: string) => {
    return movements
      .filter((movement) => movement.productId === productId && movement.movementDate < date)
      .reduce((sum, movement) => sum + Number(movement.inbound || 0) - Number(movement.sold || 0), 0);
  };

  const stockOnDate = (productId: string, date: string) => {
    return stockBeforeDate(productId, date) + getDraftOrSavedAmount(productId, date, "inbound") - getDraftOrSavedAmount(productId, date, "sold");
  };

  // 엑셀식 칸 이동. 행 = 상품, 열 = 날짜마다 입고·판매 두 칸(재고 칸은 계산 결과라 커서가 서지 않는다).
  const { cellProps, isActive } = useSheetKeyboardNav({
    rowCount: filteredProducts.length,
    colCount: sheetDates.length * 2
  });

  // 시트를 열면 가장 최근 날짜가 보이도록 오른쪽 끝으로 보내둔다. 이전 날은 왼쪽으로 스크롤해서 본다.
  useEffect(() => {
    if (inventoryView !== "sheet") return;
    const container = sheetScrollRef.current;
    if (container) container.scrollLeft = container.scrollWidth;
  }, [inventoryView, sheetMonth, filteredProducts.length, sheetDates.length]);

  return (
    <div className="space-y-5" id="liquor-inventory-tab">
      <section className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        <div>
          <h3 className="text-base font-black text-gray-900 flex items-center gap-2"><Database className="w-5 h-5 text-[#2E6DB4]" /> 주류 재고 관리표</h3>
          <p className="text-xs text-gray-400 mt-1">재고 시트에 날짜별 입고/판매를 바로 적습니다. 하루치만 빠르게 치려면 '당일 입력'을 쓰세요.</p>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
          <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setInventoryView("sheet")} className={`px-4 py-2 rounded-xl text-xs font-black ${inventoryView === "sheet" ? "bg-[#2E6DB4] text-white" : "bg-white text-slate-500 border border-slate-200"}`}>재고 시트</button>
              <button type="button" onClick={() => setInventoryView("daily")} className={`px-4 py-2 rounded-xl text-xs font-black ${inventoryView === "daily" ? "bg-[#2E6DB4] text-white" : "bg-white text-slate-500 border border-slate-200"}`}>당일 입력</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {["전체", ...LIQUOR_CATEGORIES].map((item) => (
                <button key={item} type="button" onClick={() => setCategoryFilter(item)} className={`rounded-full border px-3 py-1.5 text-xs font-black ${categoryFilter === item ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"}`}>
                  {item}
                </button>
              ))}
            </div>
          </div>
          <form onSubmit={addProduct} className="rounded-2xl border border-slate-100 bg-white p-4 space-y-3">
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <select value={classification} onChange={(e) => setClassification(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-bold bg-white">
                {LIQUOR_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <label className="relative group">
                <textarea value={itemName} onChange={(e) => setItemName(e.target.value)} title={VENDOR_HINT} rows={1} placeholder="상품명 대량등록" className="w-full h-[42px] px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-bold resize-none overflow-y-auto" />
                <span className="pointer-events-none absolute right-0 top-full mt-2 z-20 hidden rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-bold text-white shadow-lg group-focus-within:block">{VENDOR_HINT}</span>
              </label>
            </div>
            <button className="h-[40px] w-full px-5 bg-slate-800 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5"><Plus className="w-4 h-4" /> 상품 추가</button>
          </form>
        </div>
      </section>

      {inventoryView === "daily" ? (
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setDraftDate((current) => addDaysToDateInputValue(current, -1))} className="h-[38px] px-3 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-600 hover:bg-gray-50">이전날</button>
            <button type="button" onClick={() => setDraftDate(toLocalDateInputValue())} className="h-[38px] px-3 rounded-xl border border-[#2E6DB4]/20 bg-[#2E6DB4]/10 text-xs font-black text-[#1A3C6E] hover:bg-[#2E6DB4]/15">오늘</button>
            <button type="button" onClick={() => setDraftDate((current) => addDaysToDateInputValue(current, 1))} className="h-[38px] px-3 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-600 hover:bg-gray-50">다음날</button>
            <input type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono font-bold" />
            <span className="text-xs text-gray-400 font-bold">선택한 하루의 입고/판매만 입력합니다.</span>
          </div>
          <div className="h-[42px] px-5 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-black flex items-center">자동저장</div>
        </div>
        <div className="max-h-[68vh] overflow-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 z-20 bg-[#202A5A] text-white font-black">
              <tr>
                <th className="p-3 text-left w-24">분류</th>
                <th className="p-3 text-left w-48">상품명</th>
                <th className="p-3 text-center bg-slate-700 w-20">전일재고</th>
                <th className="p-3 text-center bg-blue-100 text-blue-900 w-28">오늘 입고</th>
                <th className="p-3 text-center bg-rose-100 text-rose-900 w-28">오늘 판매</th>
                <th className="liquor-stock-alice-green p-3 text-center text-green-900 w-20">오늘 재고</th>
                <th className="p-3 text-center w-12">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProducts.length === 0 ? (
                <tr><td colSpan={7} className="p-10 text-center text-gray-400 font-bold">등록된 주류 상품이 없습니다.</td></tr>
              ) : filteredProducts.map((product) => {
                const key = product.id + "|" + draftDate;
                const inSum = savedAmount(product.id, draftDate, "inbound");
                const soldSum = savedAmount(product.id, draftDate, "sold");
                const draft = draftCells[key] || { inbound: "", sold: "" };
                return (
                  <tr key={product.id} className="hover:bg-slate-50/70">
                    <td className="p-3 whitespace-nowrap">
                      <span className={`inline-flex min-w-[58px] justify-center rounded-lg border px-2 py-1 text-[11px] font-black ${getLiquorCategoryClass(product.classification)}`}>
                        {product.classification}
                      </span>
                    </td>
                    <td className="p-3 font-black text-gray-900">
                      <span className="truncate" title={product.itemName}>{product.itemName}</span>
                    </td>
                    <td className="p-3 text-center font-mono font-black bg-slate-50">{stockBeforeDate(product.id, draftDate)}</td>
                    <td className="p-2 bg-blue-50"><input value={draft.inbound} onChange={(e) => updateDraft(product.id, draftDate, "inbound", e.target.value)} inputMode="numeric" placeholder={inSum ? String(inSum) : "0"} className="w-full rounded-xl border border-blue-100 bg-white px-2 py-2 text-center font-mono font-black text-blue-800" /></td>
                    <td className="p-2 bg-rose-50"><input value={draft.sold} onChange={(e) => updateDraft(product.id, draftDate, "sold", e.target.value)} inputMode="numeric" placeholder={soldSum ? String(soldSum) : "0"} className="w-full rounded-xl border border-rose-100 bg-white px-2 py-2 text-center font-mono font-black text-rose-800" /></td>
                    <td className={`p-3 text-center font-mono font-black ${stockOnDate(product.id, draftDate) < 0 ? "bg-rose-100 text-rose-700" : "liquor-stock-alice-green text-slate-800"}`}>{stockOnDate(product.id, draftDate)}</td>
                    <td className="p-3 text-center">
                      <button type="button" onClick={() => deleteProduct(product)} className="text-gray-300 hover:text-rose-600" aria-label={product.itemName + " 삭제"}><X className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      ) : (
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-xs font-black text-slate-800">재고 시트</p>
            <p className="text-[11px] text-gray-400 font-bold mt-0.5">
              날짜 칸에 입고·판매를 바로 적으면 자동 저장됩니다. 화살표·Tab·Enter로 칸을 옮기고,
              <b className="text-slate-600"> 왼쪽으로 스크롤하면 이번 달 지난 날</b>을 볼 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSheetMonth((current) => addMonthsToMonthInputValue(current, -1))}
              className="h-[38px] px-3 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-600 hover:bg-gray-50"
            >
              전월
            </button>
            <span className="h-[38px] px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-black text-slate-700 font-mono flex items-center">
              {sheetMonth}
            </span>
            <button
              type="button"
              disabled={isCurrentMonth}
              onClick={() => setSheetMonth((current) => addMonthsToMonthInputValue(current, 1))}
              className="h-[38px] px-3 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              다음달
            </button>
            <button
              type="button"
              onClick={() => setSheetMonth(currentMonth)}
              className="h-[38px] px-3 rounded-xl border border-[#2E6DB4]/20 bg-[#2E6DB4]/10 text-xs font-black text-[#1A3C6E] hover:bg-[#2E6DB4]/15"
            >
              이번달
            </button>
            <div className="h-[38px] px-4 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-black flex items-center">자동저장</div>
          </div>
        </div>
        <div ref={sheetScrollRef} className="max-h-[68vh] overflow-auto">
          {/* border-separate: 테두리를 합치면(border-collapse) 고정 칸(sticky)이 1px씩 어긋나 사이에 틈이 생긴다.
              table-fixed: 지정한 컬럼 너비를 그대로 지킨다. 안 그러면 내용(1 vs 10)에 따라 칸 폭이 들쭉날쭉해진다. */}
          <table
            className="text-xs border-separate border-spacing-0 table-fixed"
            style={{ width: COL_CATEGORY_W + COL_ITEM_W + COL_PREV_W + sheetDates.length * COL_DAY_CELL_W * 3 }}
          >
            <thead className="bg-[#202A5A] text-white font-black">
              <tr>
                <th
                  rowSpan={2}
                  style={{ left: 0, width: COL_CATEGORY_W, minWidth: COL_CATEGORY_W }}
                  className="sticky top-0 z-30 bg-[#202A5A] p-2 text-left border-r border-white/20"
                >
                  분류
                </th>
                <th
                  rowSpan={2}
                  style={{ left: COL_CATEGORY_W, width: COL_ITEM_W, minWidth: COL_ITEM_W }}
                  className="sticky top-0 z-30 bg-[#202A5A] p-2 text-left border-r border-white/20"
                >
                  상품명
                </th>
                <th
                  rowSpan={2}
                  style={{ left: COL_CATEGORY_W + COL_ITEM_W, width: COL_PREV_W, minWidth: COL_PREV_W }}
                  className="liquor-stock-alice-green sticky top-0 z-30 p-2 text-center whitespace-nowrap border-r-2 border-r-slate-900"
                  title={
                    isCurrentMonth
                      ? "어제까지의 입고·판매를 모두 반영한 재고"
                      : `${sheetAnchorDate} 직전까지의 입고·판매를 반영한 재고`
                  }
                >
                  {isCurrentMonth ? "전일" : "직전"}
                </th>
                {sheetDates.map((date) => (
                  <th
                    key={date}
                    colSpan={3}
                    className={`sticky top-0 z-20 p-1.5 text-center whitespace-nowrap border-l border-white/20 ${
                      date === todayKey ? "bg-rose-600" : "bg-[#202A5A]"
                    }`}
                  >
                    {date.slice(5)}
                    {date === todayKey && <span className="ml-1 text-[9px] font-black">오늘 입력</span>}
                  </th>
                ))}
              </tr>
              <tr>
                {sheetDates.map((date) => (
                  <React.Fragment key={date}>
                    <th style={{ width: COL_DAY_CELL_W, minWidth: COL_DAY_CELL_W }} className="sticky top-[29px] z-20 p-1 bg-blue-100 text-blue-900 border-b border-b-black/20">입</th>
                    <th style={{ width: COL_DAY_CELL_W, minWidth: COL_DAY_CELL_W }} className="sticky top-[29px] z-20 p-1 bg-rose-100 text-rose-900 border-b border-b-black/20">판</th>
                    <th style={{ width: COL_DAY_CELL_W, minWidth: COL_DAY_CELL_W }} className="liquor-stock-alice-green sticky top-[29px] z-20 p-1 text-green-900 border-b border-b-black/20">재</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 ? (
                <tr><td colSpan={3 + sheetDates.length * 3} className="p-10 text-center text-gray-400 font-bold">등록된 주류 상품이 없습니다.</td></tr>
              ) : filteredProducts.map((product, rowIndex) => (
                <tr key={product.id} className="hover:bg-slate-50/70">
                  <td
                    style={{ left: 0, width: COL_CATEGORY_W, minWidth: COL_CATEGORY_W }}
                    className="sticky z-10 bg-white p-2 whitespace-nowrap border-r border-b border-black/10"
                  >
                    <span className={`inline-flex min-w-[58px] justify-center rounded-lg border px-2 py-1 text-[11px] font-black ${getLiquorCategoryClass(product.classification)}`}>{product.classification}</span>
                  </td>
                  <td
                    style={{ left: COL_CATEGORY_W, width: COL_ITEM_W, minWidth: COL_ITEM_W }}
                    className="sticky z-10 bg-white p-2 font-black text-gray-900 border-r border-b border-black/10"
                  >
                    <span className="block truncate" title={product.itemName}>{product.itemName}</span>
                  </td>
                  {/* 전일 재고 — 어제 마감 시점. 오늘 칸에 적는 입고/판매는 여기서 출발해 계산된다. */}
                  <td
                    style={{ left: COL_CATEGORY_W + COL_ITEM_W, width: COL_PREV_W, minWidth: COL_PREV_W }}
                    className="liquor-stock-alice-green sticky z-10 p-2 text-center font-mono font-black border-r-2 border-r-slate-900 border-b border-b-black/10"
                  >
                    {stockBeforeDate(product.id, sheetAnchorDate)}
                  </td>
                  {sheetDates.map((date, dateIndex) => {
                    const key = product.id + "|" + date;
                    const inboundDraft = draftCells[key]?.inbound;
                    const soldDraft = draftCells[key]?.sold;
                    const inboundValue = inboundDraft !== undefined ? inboundDraft : String(savedAmount(product.id, date, "inbound") || "");
                    const soldValue = soldDraft !== undefined ? soldDraft : String(savedAmount(product.id, date, "sold") || "");
                    const stock = stockOnDate(product.id, date);
                    const colInbound = dateIndex * 2;
                    const colSold = dateIndex * 2 + 1;
                    // 오늘 = 지금 적어야 할 날. 열 전체를 하나의 사각형으로 감싼다.
                    // 붉은 선은 바깥 네 변에만 — 위쪽은 첫 행에, 아래쪽은 마지막 행에만 긋는다.
                    // (모든 행에 위아래 선을 그으면 격자가 붉은 창살처럼 보인다.)
                    const isToday = date === todayKey;
                    const isFirstRow = rowIndex === 0;
                    const isLastRow = rowIndex === filteredProducts.length - 1;
                    const todayTop = isToday && isFirstRow ? "border-t-2 border-t-rose-500" : "";
                    const todayBand =
                      isToday && isLastRow ? `${todayTop} border-b-2 border-b-rose-500` : `${todayTop} border-b border-b-black/10`;
                    return (
                      <React.Fragment key={date}>
                        <td
                          style={{ width: COL_DAY_CELL_W, minWidth: COL_DAY_CELL_W }}
                          className={`p-0 bg-blue-50 ${todayBand} border-l-2 ${isToday ? "border-l-rose-500" : "border-l-black/10"} ${isActive(rowIndex, colInbound) ? "outline outline-2 -outline-offset-2 outline-[#2E6DB4] relative z-10" : ""}`}
                        >
                          <input
                            {...cellProps(rowIndex, colInbound)}
                            aria-label={`${product.itemName} ${date} 입고`}
                            type="text"
                            inputMode="numeric"
                            value={inboundValue}
                            onChange={(e) => updateDraft(product.id, date, "inbound", e.target.value)}
                            className="liquor-sheet-cell w-full h-8 px-1 text-center font-mono font-bold text-blue-800 focus:outline-none"
                          />
                        </td>
                        <td
                          style={{ width: COL_DAY_CELL_W, minWidth: COL_DAY_CELL_W }}
                          className={`p-0 bg-rose-50 ${todayBand} ${isActive(rowIndex, colSold) ? "outline outline-2 -outline-offset-2 outline-[#2E6DB4] relative z-10" : ""}`}
                        >
                          <input
                            {...cellProps(rowIndex, colSold)}
                            aria-label={`${product.itemName} ${date} 판매`}
                            type="text"
                            inputMode="numeric"
                            value={soldValue}
                            onChange={(e) => updateDraft(product.id, date, "sold", e.target.value)}
                            className="liquor-sheet-cell w-full h-8 px-1 text-center font-mono font-bold text-rose-800 focus:outline-none"
                          />
                        </td>
                        <td
                          style={{ width: COL_DAY_CELL_W, minWidth: COL_DAY_CELL_W }}
                          className={`p-1 text-center font-mono font-black ${todayBand} border-r-2 ${isToday ? "border-r-rose-500" : "border-r-transparent"} ${stock < 0 ? "bg-rose-100 text-rose-700" : "liquor-stock-alice-green text-slate-800"}`}
                        >
                          {stock}
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </div>
  );
}
