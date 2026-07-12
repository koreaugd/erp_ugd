// src/pages/branch/tabs/LiquorInventoryTabV2.tsx
// 주류재고 탭. BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { BookOpen, Plus, X } from "lucide-react";
import { GuideCallouts } from "../../../components/GuideCallouts";
import { SheetKeyHint } from "../../../components/SheetKeyHint";
import { liquorGuideSteps } from "../helpers/guideSteps";
import { gasClient } from "../../../api/gasClient";
import type { InventoryMovement, InventoryProduct } from "../types";
import { cleanNumeric, addMonthsToMonthInputValue, formatWithCommas, toLocalDateInputValue, toLocalMonthInputValue } from "../helpers/formatters";
import { pendingLocalSaveStorageKey } from "../helpers/staffHelpers";
import { LIQUOR_CATEGORIES, VENDOR_HINT, getLiquorCategoryClass, monthDays } from "../helpers/orderHelpers";
import { useSheetKeyboardNav } from "../helpers/useSheetKeyboardNav";
import { createSharedSaveSlot, flushSharedSave, scheduleSharedSave, replayPendingSave } from "../helpers/sharedSaveSlot";

// 왼쪽에 고정되는 칸들(분류·상품명·입고가·판매가·마진률·월초)의 너비.
// 고정 위치(left)를 앞 칸들의 합으로 계산하므로 px로 못박는다. 하나 바꾸면 뒤 칸들이 전부 따라 밀린다.
const COL_CATEGORY_W = 88;
const COL_ITEM_W = 150;
const COL_COST_W = 72;
const COL_SALE_W = 72;
const COL_MARGIN_W = 60;
const COL_PREV_W = 60;
// 고정 칸들의 왼쪽 시작 위치. 합계가 곧 얼어붙는 폭이라, 늘릴수록 날짜 칸이 볼 자리가 줄어든다.
const LEFT_ITEM = COL_CATEGORY_W;
const LEFT_COST = LEFT_ITEM + COL_ITEM_W;
const LEFT_SALE = LEFT_COST + COL_COST_W;
const LEFT_MARGIN = LEFT_SALE + COL_SALE_W;
const LEFT_PREV = LEFT_MARGIN + COL_MARGIN_W;
const FROZEN_W = LEFT_PREV + COL_PREV_W;
// 날짜 하나가 차지하는 입·판·재 세 칸의 너비. 못박지 않으면 내용(1 vs 10)에 따라 폭이 들쭉날쭉해진다.
const COL_DAY_CELL_W = 48;

/** 마진률 = (판매가 − 입고가) ÷ 판매가. 판매가가 없으면 계산할 수 없다. */
const marginRate = (costPrice: string, salePrice: string) => {
  const cost = Number(cleanNumeric(costPrice || ""));
  const sale = Number(cleanNumeric(salePrice || ""));
  if (!sale) return null;
  return Math.round(((sale - cost) / sale) * 100);
};

export function LiquorInventoryTabV2({ branchName }: { branchName: string }) {
  const productKey = "erp_liquor_products_" + branchName;
  const movementKey = "erp_liquor_movements_" + branchName;
  const sharedProductKey = "liquor_products:" + branchName;
  const sharedMovementKey = "liquor_movements:" + branchName;
  const productPendingKey = pendingLocalSaveStorageKey(productKey);
  const movementPendingKey = pendingLocalSaveStorageKey(movementKey);
  // 지연 저장 슬롯. 상품(가격 포함)과 입출고는 저장 키가 달라 슬롯도 따로 둔다.
  const productSaveSlot = useRef(createSharedSaveSlot());
  const movementSaveSlot = useRef(createSharedSaveSlot());
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [classification, setClassification] = useState("샴페인");
  const [itemName, setItemName] = useState("");
  // "당일 입력" 보조 화면은 없앴다 — 재고 시트에서 오늘 칸에 바로 적으면 되므로 두 화면을 유지할 이유가 없었다.
  // 작성방법 안내. 수동으로만 연다(다른 탭과 같은 규칙).
  const [guideOpen, setGuideOpen] = useState(false);
  // 원격 데이터를 다 불러왔는가.
  // 불러오기 전에 편집을 허용하면 안 된다 — 빈 상태에서 저장하는 순간 원격의 기존 상품·재고가 통째로 지워진다.
  const [loaded, setLoaded] = useState(false);
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

  const parseLiquorJsonArray = useCallback(<T,>(json: string | null): T[] => {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    // 지점을 바꿔도 이 컴포넌트는 다시 만들어지지 않는다(탭이 그대로면 key가 같다).
    // 그래서 새 지점을 불러오는 동안 이전 지점의 loaded=true 가 남아 편집이 열려 있었다.
    // 불러오기를 시작할 때마다 다시 잠그고, 저장 슬롯도 새 지점 것으로 갈아끼운다
    // (슬롯을 물려받으면 이전 지점의 gen이 남아 pending 재전송이 건너뛰어진다).
    setLoaded(false);
    productSaveSlot.current = createSharedSaveSlot();
    movementSaveSlot.current = createSharedSaveSlot();
    let cancelled = false;
    const localProductsJson = localStorage.getItem(productKey);
    const localMovementsJson = localStorage.getItem(movementKey);

    void Promise.all([
      gasClient.getSharedData<InventoryProduct[]>(sharedProductKey),
      gasClient.getSharedData<InventoryMovement[]>(sharedMovementKey)
    ]).then(([remoteProducts, remoteMovements]) => {
      if (cancelled) return;
      const localProducts = parseLiquorJsonArray<InventoryProduct>(localProductsJson);
      // pending 표시는 이제 저장마다 다른 토큰이다("1"이 아니다) — 값이 있기만 하면 밀린 저장이 있다는 뜻.
      const hasPendingProducts = localStorage.getItem(productPendingKey) !== null && localProductsJson !== null;
      const remoteProductItems = Array.isArray(remoteProducts) ? remoteProducts : null;
      const nextProducts = hasPendingProducts ? localProducts : remoteProductItems ?? localProducts;
      if (hasPendingProducts || remoteProductItems !== null || localProductsJson !== null) {
        setProducts(nextProducts);
        localStorage.setItem(productKey, JSON.stringify(nextProducts));
        if (hasPendingProducts) {
          // 재전송도 슬롯을 타야 한다 — 직접 보내면 방금 고친 값의 저장과 경쟁해 옛 값이 남을 수 있다.
          replayPendingSave(productSaveSlot.current, sharedProductKey, nextProducts, productPendingKey, "liquor_products");
        }
      }

      const localMovements = parseLiquorJsonArray<InventoryMovement>(localMovementsJson);
      const hasPendingMovements = localStorage.getItem(movementPendingKey) !== null && localMovementsJson !== null;
      const remoteMovementItems = Array.isArray(remoteMovements) ? remoteMovements : null;
      const nextMovements = hasPendingMovements ? localMovements : remoteMovementItems ?? localMovements;
      if (hasPendingMovements || remoteMovementItems !== null || localMovementsJson !== null) {
        setMovements(nextMovements);
        localStorage.setItem(movementKey, JSON.stringify(nextMovements));
        if (hasPendingMovements) {
          replayPendingSave(movementSaveSlot.current, sharedMovementKey, nextMovements, movementPendingKey, "liquor_movements");
        }
      }
    }).catch((error) => {
      console.error("Failed to load shared liquor inventory", error);
    }).finally(() => {
      // 실패해도 화면을 잠가두면 아무 작업도 못 한다. 로컬 값으로라도 편집을 연다.
      if (!cancelled) setLoaded(true);
    });

    return () => {
      cancelled = true;
      // 화면을 떠날 때 예약만 되고 못 나간 저장을 지금 올린다.
      // 그냥 타이머만 지우면 그 값은 로컬에만 남아, 다른 기기에서는 영영 보이지 않는다.
      flushSharedSave(productSaveSlot.current, "liquor_products");
      flushSharedSave(movementSaveSlot.current, "liquor_movements");
    };
  }, [movementKey, movementPendingKey, parseLiquorJsonArray, productKey, productPendingKey, sharedMovementKey, sharedProductKey]);

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
    scheduleSharedSave(productSaveSlot.current, sharedProductKey, next, productPendingKey, "liquor_products");
  };

  const saveMovements = (next: InventoryMovement[]) => {
    setMovements(next);
    localStorage.setItem(movementKey, JSON.stringify(next));
    scheduleSharedSave(movementSaveSlot.current, sharedMovementKey, next, movementPendingKey, "liquor_movements");
  };

  /**
   * 입고가·판매가 수정. 상품 정보라 movements가 아니라 products에 저장된다(날짜와 무관).
   * 입력 즉시 저장한다 — 원격 쓰기는 지연 저장 슬롯이 미뤄주므로 폭증하지 않고,
   * 칸을 빠져나가지 않은 채 새로고침해도 값이 사라지지 않는다.
   */
  const updateProductPrice = (productId: string, field: "costPrice" | "salePrice", value: string) => {
    if (!loaded) return;
    const nextValue = cleanNumeric(value).slice(0, 9);
    saveProducts(products.map((product) => (product.id === productId ? { ...product, [field]: nextValue } : product)));
  };

  const addProduct = (event: React.FormEvent) => {
    event.preventDefault();
    if (!loaded) return; // 아직 안 불러온 데이터를 고치면, 저장할 때 원격의 기존 상품이 지워진다.
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
    if (!loaded) return;
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
    if (!loaded) return; // 아직 안 불러온 데이터를 고치면, 저장할 때 원격의 기존 재고가 지워진다.
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
      scheduleSharedSave(movementSaveSlot.current, sharedMovementKey, nextMovements, movementPendingKey, "liquor_movements");
      return nextMovements;
    });
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
   * 맨 왼쪽 기준 재고 칸의 기준일 — 시트의 첫 날(그 달 1일).
   *
   * 이 칸은 1일 바로 왼쪽에 있으므로, 거기서 출발해 오른쪽으로 입고를 더하고 판매를 빼면
   * 각 날짜의 재고가 나와야 한다. 즉 값은 "그 달이 시작되기 전 재고"여야 한다.
   * (마지막 날 기준으로 두면 왼쪽 끝 숫자와 그 옆 1일 재고가 이어지지 않아 검산이 어긋난다.)
   */
  const sheetAnchorDate = sheetDates[0] ?? todayKey;

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
    const container = sheetScrollRef.current;
    if (container) container.scrollLeft = container.scrollWidth;
  }, [sheetMonth, filteredProducts.length, sheetDates.length]);

  return (
    <div className="space-y-5" id="liquor-inventory-tab">
      {/* 작성방법 안내: 탭 최상단 가운데(일일마감정산과 같은 자리).
          보이는 화면(재고 시트 / 당일 입력)에 있는 말풍선만 그려진다 — 없는 앵커는 건너뛴다. */}
      <div className="flex justify-center">
        <button
          onClick={() => setGuideOpen((prev) => !prev)}
          aria-pressed={guideOpen}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-zinc-900 text-[12px] font-black leading-none transition cursor-pointer ${
            guideOpen ? "bg-zinc-900 text-[#EFF0A3]" : "bg-[#EFF0A3] text-zinc-900 hover:brightness-95"
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" /> {guideOpen ? "작성방법 닫기" : "작성방법 보기"}
        </button>
      </div>
      <GuideCallouts open={guideOpen} steps={liquorGuideSteps} onClose={() => setGuideOpen(false)} />

      {/* 상단은 '고르고 넣는' 도구 줄이다 — 카드 안에 카드를 겹쳐 넣으면 빈 공간만 커진다.
          분류 칩과 상품 등록 폼을 한 줄로 붙이고 여백·글자를 표 크기에 맞춰 줄였다. */}
      <section className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3">
        <div>
          <h3 className="text-sm font-black text-gray-900 w-fit">주류 재고 관리표</h3>
          <p className="text-[11px] text-gray-400 mt-1">재고 시트에 날짜별 입고·판매를 바로 적습니다.</p>
        </div>
        <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {["전체", ...LIQUOR_CATEGORIES].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategoryFilter(item)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-black transition-colors ${
                  categoryFilter === item ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
          <form onSubmit={addProduct} className="flex shrink-0 items-center gap-1.5" data-guide="liquor-product-add">
            <select
              value={classification}
              onChange={(e) => setClassification(e.target.value)}
              disabled={!loaded}
              aria-label="분류"
              className="h-8 w-[104px] rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold"
            >
              {LIQUOR_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <label className="relative group">
              {/* textarea여야 한다 — input은 붙여넣을 때 줄바꿈을 지워버려 여러 개 한 번에 넣기가 깨진다. */}
              <textarea
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                disabled={!loaded}
                title={VENDOR_HINT}
                rows={1}
                placeholder="상품명 (쉼표·줄바꿈으로 여러 개)"
                className="h-8 w-[200px] resize-none overflow-y-auto rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-bold leading-tight"
              />
              <span className="pointer-events-none absolute right-0 top-full mt-1.5 z-20 hidden w-56 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-bold text-white shadow-lg group-focus-within:block">{VENDOR_HINT}</span>
            </label>
            <button disabled={!loaded} className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-slate-800 px-3 text-[11px] font-black text-white disabled:opacity-40 disabled:cursor-not-allowed">
              <Plus className="h-3.5 w-3.5" /> 추가
            </button>
          </form>
        </div>
      </section>

      {/* 섹션이 overflow-hidden이라 칩을 그 안에 두면 윗부분이 잘린다 — 테두리에 걸치도록 바깥에서 얹는다. */}
      <div className="relative">
      <SheetKeyHint />
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1.5">
            {/* 다른 섹션 제목과 같은 h3 — 알약 디자인이 CSS에서 h3에 걸린다. p로 두면 그냥 글자로 보인다. */}
            <h3 className="text-sm font-black text-gray-900 w-fit">재고 시트</h3>
            <p className="text-[11px] text-gray-400 font-bold">
              날짜 칸에 입고·판매를 바로 적으면 자동 저장됩니다.
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
            {loaded ? (
              <div className="h-[38px] px-4 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-black flex items-center">자동저장</div>
            ) : (
              <div className="h-[38px] px-4 rounded-xl bg-amber-50 text-amber-700 text-xs font-black flex items-center">불러오는 중…</div>
            )}
          </div>
        </div>
        <div ref={sheetScrollRef} className="max-h-[68vh] overflow-auto" data-guide="liquor-month-sheet">
          {/* border-separate: 테두리를 합치면(border-collapse) 고정 칸(sticky)이 1px씩 어긋나 사이에 틈이 생긴다.
              table-fixed: 지정한 컬럼 너비를 그대로 지킨다. 안 그러면 내용(1 vs 10)에 따라 칸 폭이 들쭉날쭉해진다. */}
          <table
            className="text-xs border-separate border-spacing-0 table-fixed"
            style={{ width: FROZEN_W + sheetDates.length * COL_DAY_CELL_W * 3 }}
          >
            <thead className="bg-[#202A5A] text-white font-black">
              <tr>
                <th
                  rowSpan={2}
                  style={{ left: 0, width: COL_CATEGORY_W, minWidth: COL_CATEGORY_W }}
                  className="sticky top-0 z-30 bg-[#202A5A] p-1.5 text-left border-r border-white/20"
                >
                  분류
                </th>
                <th
                  rowSpan={2}
                  style={{ left: LEFT_ITEM, width: COL_ITEM_W, minWidth: COL_ITEM_W }}
                  className="sticky top-0 z-30 bg-[#202A5A] p-1.5 text-left border-r border-white/20"
                >
                  상품명
                </th>
                <th
                  rowSpan={2}
                  style={{ left: LEFT_COST, width: COL_COST_W, minWidth: COL_COST_W }}
                  className="sticky top-0 z-30 bg-[#202A5A] p-1.5 text-center whitespace-nowrap border-r border-white/20"
                  title="한 병(개)을 들여오는 가격입니다. 날짜와 무관한 상품 정보라 한 번 적으면 계속 유지됩니다."
                >
                  입고가
                </th>
                <th
                  rowSpan={2}
                  style={{ left: LEFT_SALE, width: COL_SALE_W, minWidth: COL_SALE_W }}
                  className="sticky top-0 z-30 bg-[#202A5A] p-1.5 text-center whitespace-nowrap border-r border-white/20"
                  title="손님에게 파는 가격입니다."
                >
                  판매가
                </th>
                <th
                  rowSpan={2}
                  style={{ left: LEFT_MARGIN, width: COL_MARGIN_W, minWidth: COL_MARGIN_W }}
                  className="sticky top-0 z-30 bg-[#202A5A] p-1.5 text-center whitespace-nowrap border-r border-white/20"
                  title="(판매가 − 입고가) ÷ 판매가. 자동 계산됩니다."
                >
                  마진률
                </th>
                <th
                  rowSpan={2}
                  style={{ left: LEFT_PREV, width: COL_PREV_W, minWidth: COL_PREV_W }}
                  className="liquor-stock-alice-green sticky top-0 z-30 p-1.5 text-center whitespace-nowrap border-r-2 border-r-slate-900"
                  title="이 달이 시작되기 전 재고입니다. 여기서 출발해 오른쪽으로 입고를 더하고 판매를 빼면 그날의 재고가 됩니다."
                >
                  월초
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
                <tr><td colSpan={6 + sheetDates.length * 3} className="p-10 text-center text-gray-400 font-bold">등록된 주류 상품이 없습니다.</td></tr>
              ) : filteredProducts.map((product, rowIndex) => {
                // 편집 중인 값이 있으면 그것으로 보여준다 — 저장 전에도 마진률이 따라 움직인다.
                const costValue = product.costPrice || "";
                const saleValue = product.salePrice || "";
                const margin = marginRate(costValue, saleValue);
                return (
                <tr key={product.id} className="hover:bg-slate-50/70">
                  <td
                    style={{ left: 0, width: COL_CATEGORY_W, minWidth: COL_CATEGORY_W }}
                    className="sticky z-10 bg-white p-1 whitespace-nowrap border-r border-b border-black/10"
                  >
                    <span className={`inline-flex min-w-[52px] justify-center rounded-lg border px-1.5 py-0.5 text-[11px] font-black ${getLiquorCategoryClass(product.classification)}`}>{product.classification}</span>
                  </td>
                  {/* 상품 삭제는 이제 여기서만 한다("당일 입력" 화면을 없애면서 그쪽 관리 열도 함께 사라졌다).
                      유일한 삭제 경로이므로 마우스를 올려야 보이게 숨기면 안 된다 —
                      태블릿에는 hover가 없어 지울 방법이 통째로 사라진다. 늘 보이고 Tab으로도 닿아야 한다. */}
                  <td
                    style={{ left: LEFT_ITEM, width: COL_ITEM_W, minWidth: COL_ITEM_W }}
                    className="sticky z-10 bg-white p-1 font-black text-gray-900 border-r border-b border-black/10"
                  >
                    <div className="flex items-center gap-1">
                      <span className="block flex-1 truncate" title={product.itemName}>{product.itemName}</span>
                      <button
                        type="button"
                        onClick={() => deleteProduct(product)}
                        aria-label={product.itemName + " 삭제"}
                        title={product.itemName + " 삭제"}
                        className="shrink-0 rounded p-0.5 text-gray-300 transition hover:bg-rose-50 hover:text-rose-600 focus:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-400"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td
                    style={{ left: LEFT_COST, width: COL_COST_W, minWidth: COL_COST_W }}
                    className="sticky z-10 bg-white p-0 border-r border-b border-black/10"
                  >
                    <input
                      value={costValue ? formatWithCommas(costValue) : ""}
                      onChange={(e) => updateProductPrice(product.id, "costPrice", e.target.value)}
                      aria-label={product.itemName + " 입고가"}
                      inputMode="numeric"
                      placeholder="0"
                      disabled={!loaded}
                      className="w-full h-7 bg-transparent px-1.5 text-right font-mono font-bold text-slate-700 focus:outline-none focus:bg-blue-50 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td
                    style={{ left: LEFT_SALE, width: COL_SALE_W, minWidth: COL_SALE_W }}
                    className="sticky z-10 bg-white p-0 border-r border-b border-black/10"
                  >
                    <input
                      value={saleValue ? formatWithCommas(saleValue) : ""}
                      onChange={(e) => updateProductPrice(product.id, "salePrice", e.target.value)}
                      aria-label={product.itemName + " 판매가"}
                      inputMode="numeric"
                      placeholder="0"
                      disabled={!loaded}
                      className="w-full h-7 bg-transparent px-1.5 text-right font-mono font-bold text-slate-700 focus:outline-none focus:bg-blue-50 disabled:cursor-not-allowed"
                    />
                  </td>
                  {/* 마진률 — 자동 계산. 판매가가 없으면 계산할 수 없으므로 비워 둔다. */}
                  <td
                    style={{ left: LEFT_MARGIN, width: COL_MARGIN_W, minWidth: COL_MARGIN_W }}
                    className={`sticky z-10 p-1 text-center font-mono font-black border-r border-b border-black/10 ${
                      margin === null ? "bg-white text-gray-300" : margin < 0 ? "bg-rose-50 text-rose-700" : "bg-white text-slate-700"
                    }`}
                  >
                    {margin === null ? "—" : margin + "%"}
                  </td>
                  {/* 월초 재고 — 이 달 시작 시점. 오른쪽으로 입고를 더하고 판매를 빼면 그날의 재고가 된다. */}
                  <td
                    style={{ left: LEFT_PREV, width: COL_PREV_W, minWidth: COL_PREV_W }}
                    className="liquor-stock-alice-green sticky z-10 p-1 text-center font-mono font-black border-r-2 border-r-slate-900 border-b border-b-black/10"
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
                            disabled={!loaded}
                            className="liquor-sheet-cell w-full h-7 px-1 text-center font-mono font-bold text-blue-800 focus:outline-none disabled:cursor-not-allowed"
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
                            disabled={!loaded}
                            className="liquor-sheet-cell w-full h-7 px-1 text-center font-mono font-bold text-rose-800 focus:outline-none disabled:cursor-not-allowed"
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
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      </div>
    </div>
  );
}
