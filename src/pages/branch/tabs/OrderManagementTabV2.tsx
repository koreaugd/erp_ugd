// src/pages/branch/tabs/OrderManagementTabV2.tsx
// 발주관리 탭. BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Plus, ShoppingCart, X } from "lucide-react";
import { gasClient } from "../../../api/gasClient";
import { formatNumber } from "../../../utils/formatNumber";
import type { OrderCategory, OrderItem, OrderReportCategory } from "../types";
import { cleanNumeric, formatWithCommas, toLocalMonthInputValue } from "../helpers/formatters";
import { pendingLocalSaveStorageKey } from "../helpers/staffHelpers";
import { ORDER_CATEGORIES, ORDER_DEFAULT_VENDORS, VENDOR_HINT, ALL_ORDER_CATEGORIES, getOrderCategoryHeaderClass, monthDays } from "../helpers/orderHelpers";
import { useSheetKeyboardNav } from "../helpers/useSheetKeyboardNav";

export function OrderManagementTabV2({ branchName }: { branchName: string }) {
  const storageKey = "erp_orders_" + branchName;
  const vendorKey = "erp_order_vendors_" + branchName;
  const sharedOrderKey = "orders:" + branchName;
  const sharedVendorKey = "order_vendors:" + branchName;
  const orderPendingKey = pendingLocalSaveStorageKey(storageKey);
  const vendorPendingKey = pendingLocalSaveStorageKey(vendorKey);
  const orderSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vendorSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [vendorsByCategory, setVendorsByCategory] = useState<Record<OrderCategory, string[]>>(ORDER_DEFAULT_VENDORS);
  const [vendorCategory, setVendorCategory] = useState<OrderCategory>("식자재");
  const [vendorText, setVendorText] = useState("");
  const [reportMonth, setReportMonth] = useState(() => toLocalMonthInputValue());
  const [reportCategory, setReportCategory] = useState<OrderReportCategory>(ALL_ORDER_CATEGORIES);
  const [reportVendor, setReportVendor] = useState("전체");
  const [orderDraftCells, setOrderDraftCells] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const savedOrders = localStorage.getItem(storageKey);
      const savedVendors = localStorage.getItem(vendorKey);
      if (savedOrders) setOrders(JSON.parse(savedOrders));
      if (savedVendors) {
        const parsed = JSON.parse(savedVendors);
        if (Array.isArray(parsed)) {
          setVendorsByCategory({ ...ORDER_DEFAULT_VENDORS, 식자재: Array.from(new Set([...ORDER_DEFAULT_VENDORS.식자재, ...parsed])) });
        } else if (parsed && typeof parsed === "object") {
          setVendorsByCategory({
            식자재: Array.isArray(parsed.식자재) ? parsed.식자재 : ORDER_DEFAULT_VENDORS.식자재,
            부식비: Array.isArray(parsed.부식비) ? parsed.부식비 : [],
            주류: Array.isArray(parsed.주류) ? parsed.주류 : [],
            "식음료외 기타": Array.isArray(parsed["식음료외 기타"]) ? parsed["식음료외 기타"] : []
          });
        }
      }
    } catch (err) {
      console.error("Failed to load order data", err);
    }
  }, [storageKey, vendorKey]);

  const normalizeRemoteOrderVendors = useCallback((value: unknown): Record<OrderCategory, string[]> | null => {
    if (Array.isArray(value)) {
      const firstCategory = ORDER_CATEGORIES[0];
      return {
        ...ORDER_DEFAULT_VENDORS,
        [firstCategory]: Array.from(new Set([...(ORDER_DEFAULT_VENDORS[firstCategory] || []), ...value.filter((item): item is string => typeof item === "string")]))
      };
    }
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<Record<OrderCategory, unknown>>;
    return ORDER_CATEGORIES.reduce((acc, category) => {
      acc[category] = Array.isArray(source[category])
        ? (source[category] as string[]).filter((item) => typeof item === "string")
        : (ORDER_DEFAULT_VENDORS[category] || []);
      return acc;
    }, {} as Record<OrderCategory, string[]>);
  }, []);

  const saveSharedDebounced = useCallback((key: string, value: unknown, timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>, pendingKey: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    localStorage.setItem(pendingKey, "1");
    void gasClient.saveSharedData(key, value)
      .then(() => localStorage.removeItem(pendingKey))
      .catch((error) => {
        console.error("Failed to save shared order data", error);
      });
  }, []);

  const parseJsonArray = useCallback(<T,>(json: string | null): T[] => {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, []);

  const parseVendorJson = useCallback((json: string | null) => {
    if (!json) return null;
    try {
      return normalizeRemoteOrderVendors(JSON.parse(json));
    } catch {
      return null;
    }
  }, [normalizeRemoteOrderVendors]);

  const mergeOrders = useCallback((remoteItems: OrderItem[], localItems: OrderItem[]) => {
    const byCell = new Map<string, OrderItem>();
    [...remoteItems, ...localItems].forEach((item) => {
      if (!item || !item.vendorName || !item.orderDate) return;
      byCell.set(`${item.category}|${item.vendorName}|${item.orderDate}`, item);
    });
    return Array.from(byCell.values());
  }, []);

  const mergeVendorMaps = useCallback((remoteMap: Record<OrderCategory, string[]> | null, localMap: Record<OrderCategory, string[]> | null) => {
    if (!remoteMap && !localMap) return null;
    return ORDER_CATEGORIES.reduce((acc, category) => {
      acc[category] = Array.from(new Set([
        ...(ORDER_DEFAULT_VENDORS[category] || []),
        ...(remoteMap?.[category] || []),
        ...(localMap?.[category] || [])
      ]));
      return acc;
    }, {} as Record<OrderCategory, string[]>);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const localOrdersJson = localStorage.getItem(storageKey);
    const localVendorsJson = localStorage.getItem(vendorKey);

    void Promise.all([
      gasClient.getSharedData<OrderItem[]>(sharedOrderKey),
      gasClient.getSharedData<Record<OrderCategory, string[]>>(sharedVendorKey)
    ]).then(([remoteOrders, remoteVendors]) => {
      if (cancelled) return;
      const localOrders = parseJsonArray<OrderItem>(localOrdersJson);
      const hasPendingOrders = localStorage.getItem(orderPendingKey) === "1" && localOrdersJson !== null;
      const remoteOrderItems = Array.isArray(remoteOrders) ? remoteOrders : null;
      const nextOrders = hasPendingOrders ? localOrders : remoteOrderItems ?? localOrders;
      if (hasPendingOrders || remoteOrderItems !== null || localOrdersJson !== null) {
        setOrders(nextOrders);
        localStorage.setItem(storageKey, JSON.stringify(nextOrders));
        if (hasPendingOrders) {
          void gasClient.saveSharedData(sharedOrderKey, nextOrders)
            .then(() => localStorage.removeItem(orderPendingKey))
            .catch((error) => console.error("Failed to resave pending order data", error));
        }
      }

      const localVendors = parseVendorJson(localVendorsJson);
      const hasPendingVendors = localStorage.getItem(vendorPendingKey) === "1" && localVendors !== null;
      const remoteVendorMap = normalizeRemoteOrderVendors(remoteVendors);
      const normalizedVendors = hasPendingVendors ? localVendors : remoteVendorMap ?? localVendors;
      if (normalizedVendors) {
        setVendorsByCategory(normalizedVendors);
        localStorage.setItem(vendorKey, JSON.stringify(normalizedVendors));
        if (hasPendingVendors || (remoteVendorMap === null && localVendors !== null)) {
          void gasClient.saveSharedData(sharedVendorKey, normalizedVendors)
            .then(() => localStorage.removeItem(vendorPendingKey))
            .catch((error) => console.error("Failed to resave pending order vendors", error));
        }
      }
    }).catch((error) => {
      console.error("Failed to load shared order data", error);
    });

    return () => {
      cancelled = true;
      if (orderSaveTimerRef.current) clearTimeout(orderSaveTimerRef.current);
      if (vendorSaveTimerRef.current) clearTimeout(vendorSaveTimerRef.current);
    };
  }, [mergeOrders, mergeVendorMaps, normalizeRemoteOrderVendors, orderPendingKey, parseJsonArray, parseVendorJson, sharedOrderKey, sharedVendorKey, storageKey, vendorKey, vendorPendingKey]);

  const reportVendors = useMemo(() => {
    const targetCategories = reportCategory === ALL_ORDER_CATEGORIES ? ORDER_CATEGORIES : [reportCategory];
    const names = [
      ...targetCategories.flatMap((category) => vendorsByCategory[category] || []),
      ...orders.filter((order) => targetCategories.includes(order.category)).map((order) => order.vendorName)
    ];
    return Array.from(new Set(names));
  }, [orders, reportCategory, vendorsByCategory]);

  useEffect(() => {
    if (reportVendor !== "전체" && !reportVendors.includes(reportVendor)) setReportVendor("전체");
  }, [reportVendor, reportVendors]);

  const saveVendors = (next: Record<OrderCategory, string[]>) => {
    setVendorsByCategory(next);
    localStorage.setItem(vendorKey, JSON.stringify(next));
    saveSharedDebounced(sharedVendorKey, next, vendorSaveTimerRef, vendorPendingKey);
  };

  const saveOrders = (next: OrderItem[]) => {
    setOrders(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
    saveSharedDebounced(sharedOrderKey, next, orderSaveTimerRef, orderPendingKey);
  };

  const resolveOrderCategory = (vendor: string): OrderCategory => {
    if (reportCategory !== ALL_ORDER_CATEGORIES) return reportCategory;
    const registeredCategory = ORDER_CATEGORIES.find((category) => (vendorsByCategory[category] || []).includes(vendor));
    const existingCategory = orders.find((order) => order.vendorName === vendor)?.category;
    return registeredCategory || existingCategory || "식자재";
  };

  const addVendors = () => {
    const names = vendorText.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    if (names.length === 0) return;
    const next = {
      ...vendorsByCategory,
      [vendorCategory]: Array.from(new Set([...(vendorsByCategory[vendorCategory] || []), ...names]))
    };
    saveVendors(next);
    setVendorText("");
  };

  const deleteVendor = (targetCategory: OrderCategory, targetVendor: string) => {
    if (!window.confirm(targetVendor + " 거래처를 목록에서 삭제할까요? 기존 발주내역은 유지됩니다.")) return;
    const next = {
      ...vendorsByCategory,
      [targetCategory]: (vendorsByCategory[targetCategory] || []).filter((vendor) => vendor !== targetVendor)
    };
    saveVendors(next);
  };

  const cellAmount = (dateKey: string, vendor: string) => {
    const targetCategories = reportCategory === ALL_ORDER_CATEGORIES ? ORDER_CATEGORIES : [reportCategory];
    return orders
      .filter((order) => targetCategories.includes(order.category) && order.orderDate === dateKey && order.vendorName === vendor)
      .reduce((sum, order) => sum + Number(order.amount || 0), 0);
  };

  const updateOrderDraft = (dateKey: string, vendor: string, value: string) => {
    const nextValue = cleanNumeric(value).slice(0, 7);
    const draftKey = dateKey + "|" + vendor;
    setOrderDraftCells((prev) => ({ ...prev, [draftKey]: nextValue }));
    const categoryForCell = resolveOrderCategory(vendor);
    setOrders((currentOrders) => {
      const replaceCategories = reportCategory === ALL_ORDER_CATEGORIES ? ORDER_CATEGORIES : [categoryForCell];
      const kept = currentOrders.filter((order) => !(replaceCategories.includes(order.category) && order.orderDate === dateKey && order.vendorName === vendor));
      const nextOrders = Number(nextValue) > 0
        ? [{
          id: "ord-cell-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
          category: categoryForCell,
          vendorName: vendor,
          amount: nextValue,
          memo: "",
          orderDate: dateKey
        }, ...kept]
        : kept;
      localStorage.setItem(storageKey, JSON.stringify(nextOrders));
      saveSharedDebounced(sharedOrderKey, nextOrders, orderSaveTimerRef, orderPendingKey);
      return nextOrders;
    });
  };

  const filteredOrders = useMemo(() => {
    const targetCategories = reportCategory === ALL_ORDER_CATEGORIES ? ORDER_CATEGORIES : [reportCategory];
    return orders.filter((order) => {
      const sameMonth = String(order.orderDate || "").startsWith(reportMonth);
      const sameCategory = targetCategories.includes(order.category);
      const sameVendor = reportVendor === "전체" || order.vendorName === reportVendor;
      return sameMonth && sameCategory && sameVendor;
    });
  }, [orders, reportCategory, reportMonth, reportVendor]);

  const matrixVendors = reportVendor === "전체" ? reportVendors : [reportVendor];
  const vendorCategoryOf = (vendor: string): OrderCategory => {
    return ORDER_CATEGORIES.find((category) => (vendorsByCategory[category] || []).includes(vendor))
      || orders.find((order) => order.vendorName === vendor)?.category
      || "식자재";
  };
  const categoryHeaderGroups = matrixVendors.reduce<Array<{ category: OrderCategory; span: number }>>((groups, vendor) => {
    const category = vendorCategoryOf(vendor);
    const last = groups[groups.length - 1];
    if (last && last.category === category) {
      last.span += 1;
    } else {
      groups.push({ category, span: 1 });
    }
    return groups;
  }, []);
  const totals = matrixVendors.map((vendor) => filteredOrders.filter((order) => order.vendorName === vendor).reduce((sum, order) => sum + Number(order.amount || 0), 0));
  const monthTotal = totals.reduce((sum, item) => sum + item, 0);

  // 엑셀식 칸 이동. 행=날짜, 열=거래처. 날짜 행은 달력이 정하므로 행 추가는 없다.
  const matrixDays = monthDays(reportMonth);
  const { cellProps, activeCell, isActive } = useSheetKeyboardNav({
    rowCount: matrixDays.length,
    colCount: matrixVendors.length
  });

  return (
    <div className="space-y-5" id="orders-tab-view">
      <section className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        <div>
          <h3 className="text-base font-black text-gray-900 flex items-center gap-2"><ShoppingCart className="w-5 h-5 text-[#2E6DB4]" /> 거래처 추가</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr_auto] gap-3 items-end">
          <label className="space-y-1 text-xs font-bold text-gray-500">
            <span>대분류</span>
            <select value={vendorCategory} onChange={(e) => setVendorCategory(e.target.value as OrderCategory)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-gray-50 font-extrabold text-gray-800">
              {ORDER_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs font-bold text-gray-500 relative group">
            <span>거래처명</span>
            <textarea value={vendorText} onChange={(e) => setVendorText(e.target.value)} title={VENDOR_HINT} rows={1} placeholder="예: 대정, 크리스탈, 카나와인" className="w-full h-[42px] px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-bold resize-none overflow-y-auto" />
            <span className="pointer-events-none absolute left-0 top-full mt-2 z-20 hidden rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-bold text-white shadow-lg group-focus-within:block">{VENDOR_HINT}</span>
          </label>
          <button type="button" onClick={addVendors} className="h-[42px] px-5 bg-slate-800 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5"><Plus className="w-4 h-4" /> 업체 추가</button>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {(vendorsByCategory[vendorCategory] || []).length === 0 ? (
            <span className="text-xs text-gray-400 font-bold">등록된 거래처가 없습니다.</span>
          ) : (vendorsByCategory[vendorCategory] || []).map((vendor) => (
            <span key={vendor} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700">
              {vendor}
              <button type="button" onClick={() => deleteVendor(vendorCategory, vendor)} className="text-slate-400 hover:text-rose-600" aria-label={vendor + " 삭제"}><X className="w-3.5 h-3.5" /></button>
            </span>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-100 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-gray-900">발주내역 리포트</h3>
              <p className="text-xs text-gray-400 mt-1">
                날짜별 칸에 금액을 입력하면 자동 저장됩니다. 화살표·Tab·Enter로 칸을 옮길 수 있습니다.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="px-3 py-2 rounded-xl bg-[#2E6DB4]/10 text-[#1A3C6E] text-xs font-black">월 합계 {formatNumber(monthTotal)}원</div>
              <div className="h-[38px] px-4 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-black flex items-center">자동저장</div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-bold" />
            <select value={reportCategory} onChange={(e) => { setReportCategory(e.target.value as OrderReportCategory); setOrderDraftCells({}); }} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-bold bg-white">
              <option value={ALL_ORDER_CATEGORIES}>전체보기</option>
              {ORDER_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={reportVendor} onChange={(e) => setReportVendor(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-bold bg-white">
              <option value="전체">전체 거래처</option>
              {reportVendors.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}
            </select>
          </div>
        </div>
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="sticky top-0 z-20 bg-gray-50 text-gray-600 font-black border-b shadow-sm">
              <tr>
                <th rowSpan={2} className="sticky left-0 z-30 bg-gray-50 p-3 w-20 border-r align-middle">일</th>
                {categoryHeaderGroups.map((group, index) => (
                  <th key={`${group.category}-${index}`} colSpan={group.span} className={`p-2 text-center border-r border-b ${getOrderCategoryHeaderClass(group.category)}`}>
                    {group.category}
                  </th>
                ))}
                <th rowSpan={2} className="p-3 min-w-[130px] text-right bg-slate-100 align-middle">일 합계</th>
              </tr>
              <tr>
                {matrixVendors.map((vendor, colIndex) => {
                  const category = vendorCategoryOf(vendor);
                  // 분류별 색은 그대로 두고, 지금 편집 중인 열만 안쪽 테두리로 짚어준다.
                  const columnActive = activeCell?.col === colIndex;
                  return (
                    <th
                      key={vendor}
                      className={`p-2 min-w-[92px] text-center border-r border-b ${getOrderCategoryHeaderClass(category)} ${
                        columnActive ? "ring-2 ring-inset ring-[#2E6DB4]" : ""
                      }`}
                    >
                      {vendor}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="[&_td]:border-b [&_td]:border-gray-200">
              {matrixDays.map((day, rowIndex) => {
                const dateKey = reportMonth + "-" + day;
                const rowValues = matrixVendors.map((vendor) => {
                  const draftValue = orderDraftCells[dateKey + "|" + vendor];
                  return draftValue !== undefined ? Number(draftValue || 0) : cellAmount(dateKey, vendor);
                });
                const rowTotal = rowValues.reduce((sum, item) => sum + item, 0);
                const rowActive = activeCell?.row === rowIndex;
                return (
                  <tr key={dateKey} className="hover:bg-slate-50/70">
                    {/* 날짜 칸 — 지금 편집 중인 행을 짚어준다 */}
                    <td
                      className={`sticky left-0 p-3 text-center font-mono font-black border-r transition-colors ${
                        rowActive ? "bg-blue-50 text-[#2E6DB4]" : "bg-white text-gray-600"
                      }`}
                    >
                      {Number(day)}
                    </td>
                    {rowValues.map((value, colIndex) => {
                      const vendor = matrixVendors[colIndex];
                      const draftKey = dateKey + "|" + vendor;
                      const draftValue = orderDraftCells[draftKey];
                      const cellActive = isActive(rowIndex, colIndex);
                      return (
                        <td
                          key={vendor}
                          className={`p-0 text-right font-mono border-r relative ${
                            cellActive ? "outline outline-2 -outline-offset-2 outline-[#2E6DB4] z-10 bg-white" : ""
                          }`}
                        >
                          <input
                            {...cellProps(rowIndex, colIndex)}
                            value={draftValue !== undefined ? formatWithCommas(draftValue) : (value ? formatWithCommas(value) : "")}
                            onChange={(e) => updateOrderDraft(dateKey, vendor, e.target.value)}
                            aria-label={`${Number(day)}일 ${vendor} 발주금액`}
                            inputMode="numeric"
                            maxLength={9}
                            className="w-full h-9 bg-transparent border-0 rounded-none px-2 text-right font-mono font-black focus:outline-none"
                          />
                        </td>
                      );
                    })}
                    <td className="p-3 text-right font-mono font-black bg-slate-50">{rowTotal ? formatNumber(rowTotal) : ""}</td>
                  </tr>
                );
              })}
              <tr className="bg-gray-100 font-black">
                <td className="sticky left-0 bg-gray-100 p-3 text-center border-r">합계</td>
                {totals.map((value, index) => <td key={matrixVendors[index]} className="p-3 text-right font-mono border-r">{value ? formatNumber(value) : ""}</td>)}
                <td className="p-3 text-right font-mono text-[#2E6DB4]">{formatNumber(monthTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
