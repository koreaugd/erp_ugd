// src/pages/branch/tabs/LiquorInventoryTabV2.tsx
// 주류재고 탭. BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Database, Plus, X } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import type { InventoryMovement, InventoryProduct } from "../types";
import { cleanNumeric, addDaysToDateInputValue, toLocalDateInputValue } from "../helpers/formatters";
import { pendingLocalSaveStorageKey } from "../helpers/staffHelpers";
import { LIQUOR_CATEGORIES, VENDOR_HINT, getLiquorCategoryClass } from "../helpers/orderHelpers";

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
  const [inventoryView, setInventoryView] = useState<"daily" | "weekly">("daily");
  const [categoryFilter, setCategoryFilter] = useState("전체");
  const [weeklyViewDate, setWeeklyViewDate] = useState(() => toLocalDateInputValue());
  const [draftCells, setDraftCells] = useState<Record<string, { inbound: string; sold: string }>>({});

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

    setDraftCells((prev) => ({
      ...prev,
      [key]: {
        inbound: prev[key]?.inbound || "",
        sold: prev[key]?.sold || "",
        [field]: nextValue
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

  const weekDates = useMemo(() => {
    const base = new Date(`${weeklyViewDate}T00:00:00`);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(base);
      date.setDate(base.getDate() - 6 + index);
      return toLocalDateInputValue(date);
    });
  }, [weeklyViewDate]);

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

  return (
    <div className="space-y-5" id="liquor-inventory-tab">
      <section className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        <div>
          <h3 className="text-base font-black text-gray-900 flex items-center gap-2"><Database className="w-5 h-5 text-[#2E6DB4]" /> 주류 재고 관리표</h3>
          <p className="text-xs text-gray-400 mt-1">지점 입력은 당일 입고/판매만 빠르게 작성하고, 7일 보기에서 최근 흐름을 확인합니다.</p>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
          <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setInventoryView("daily")} className={`px-4 py-2 rounded-xl text-xs font-black ${inventoryView === "daily" ? "bg-[#2E6DB4] text-white" : "bg-white text-slate-500 border border-slate-200"}`}>당일 입력</button>
              <button type="button" onClick={() => setInventoryView("weekly")} className={`px-4 py-2 rounded-xl text-xs font-black ${inventoryView === "weekly" ? "bg-[#2E6DB4] text-white" : "bg-white text-slate-500 border border-slate-200"}`}>7일 보기</button>
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
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setWeeklyViewDate((current) => addDaysToDateInputValue(current, -7))} className="h-[38px] px-3 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-600 hover:bg-gray-50">이전 7일</button>
            <button type="button" onClick={() => setWeeklyViewDate(toLocalDateInputValue())} className="h-[38px] px-3 rounded-xl border border-[#2E6DB4]/20 bg-[#2E6DB4]/10 text-xs font-black text-[#1A3C6E] hover:bg-[#2E6DB4]/15">이번 7일</button>
            <button type="button" onClick={() => setWeeklyViewDate((current) => addDaysToDateInputValue(current, 7))} className="h-[38px] px-3 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-600 hover:bg-gray-50">다음 7일</button>
            <input type="date" value={weeklyViewDate} onChange={(e) => setWeeklyViewDate(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono font-bold" />
            <span className="text-xs text-gray-400 font-bold">선택한 날짜 기준 최근 7일 흐름을 확인합니다.</span>
          </div>
        </div>
        <div className="max-h-[68vh] overflow-auto">
          <table className="w-full min-w-[980px] text-xs">
            <thead className="bg-[#202A5A] text-white font-black">
              <tr>
                <th rowSpan={2} className="sticky left-0 top-0 z-30 bg-[#202A5A] p-2 text-left w-20">분류</th>
                <th rowSpan={2} className="sticky left-20 top-0 z-30 bg-[#202A5A] p-2 text-left w-44">상품명</th>
                <th rowSpan={2} className="liquor-stock-alice-green sticky top-0 z-20 p-2 text-center w-16">현재</th>
                {weekDates.map((date) => <th key={date} colSpan={3} className="sticky top-0 z-20 bg-[#202A5A] p-1.5 text-center border-l border-white/20">{date.slice(5)}</th>)}
              </tr>
              <tr>
                {weekDates.map((date) => (
                  <React.Fragment key={date}>
                    <th className="sticky top-[29px] z-20 p-1 bg-blue-100 text-blue-900 w-10">입</th>
                    <th className="sticky top-[29px] z-20 p-1 bg-rose-100 text-rose-900 w-10">판</th>
                    <th className="liquor-stock-alice-green sticky top-[29px] z-20 p-1 text-green-900 w-10">재</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProducts.length === 0 ? (
                <tr><td colSpan={3 + weekDates.length * 3} className="p-10 text-center text-gray-400 font-bold">등록된 주류 상품이 없습니다.</td></tr>
              ) : filteredProducts.map((product) => (
                <tr key={product.id} className="hover:bg-slate-50/70">
                  <td className="sticky left-0 z-10 bg-white p-2 whitespace-nowrap">
                    <span className={`inline-flex min-w-[58px] justify-center rounded-lg border px-2 py-1 text-[11px] font-black ${getLiquorCategoryClass(product.classification)}`}>{product.classification}</span>
                  </td>
                  <td className="sticky left-20 z-10 bg-white p-2 font-black text-gray-900">
                    <span className="truncate" title={product.itemName}>{product.itemName}</span>
                  </td>
                  <td className="liquor-stock-alice-green p-2 text-center font-mono font-black">{stockOf(product.id)}</td>
                  {weekDates.map((date) => {
                    const inbound = getDraftOrSavedAmount(product.id, date, "inbound");
                    const sold = getDraftOrSavedAmount(product.id, date, "sold");
                    const stock = stockOnDate(product.id, date);
                    return (
                      <React.Fragment key={date}>
                        <td className="p-1 text-center font-mono bg-blue-50 text-blue-800">{inbound || ""}</td>
                        <td className="p-1 text-center font-mono bg-rose-50 text-rose-800">{sold || ""}</td>
                        <td className={`p-1 text-center font-mono font-black ${stock < 0 ? "bg-rose-100 text-rose-700" : "liquor-stock-alice-green text-slate-800"}`}>{stock}</td>
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
