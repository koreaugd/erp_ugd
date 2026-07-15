// src/pages/branch/tabs/OrderManagementTabV2.tsx
// 발주관리 탭. BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { BookOpen, Plus, StickyNote, X } from "lucide-react";
import { GuideCallouts } from "../../../components/GuideCallouts";
import { SheetKeyHint } from "../../../components/SheetKeyHint";
import { orderGuideSteps } from "../helpers/guideSteps";
import { gasClient } from "../../../api/gasClient";
import { formatNumber } from "../../../utils/formatNumber";
import type { OrderCategory, OrderItem, OrderReportCategory } from "../types";
import { cleanNumeric, formatWithCommas, toLocalMonthInputValue } from "../helpers/formatters";
import { pendingLocalSaveStorageKey } from "../helpers/staffHelpers";
import { ORDER_CATEGORIES, ORDER_DEFAULT_VENDORS, VENDOR_HINT, ALL_ORDER_CATEGORIES, getOrderCategoryHeaderClass, monthDays } from "../helpers/orderHelpers";
import { useSheetKeyboardNav } from "../helpers/useSheetKeyboardNav";
import { createSharedSaveSlot, flushSharedSave, scheduleSharedSave, replayPendingSave } from "../helpers/sharedSaveSlot";

const MEMO_POPUP_WIDTH = 288;
const MEMO_POPUP_HEIGHT = 208;

/** 메모를 편집 중인 칸. 화면 좌표(top/left)는 열 때 한 번 재서 들고 있는다. */
type MemoEditorState = {
  dateKey: string;
  vendor: string;
  day: string;
  amount: number;
  top: number;
  left: number;
};

export function OrderManagementTabV2({ branchName }: { branchName: string }) {
  const storageKey = "erp_orders_" + branchName;
  const vendorKey = "erp_order_vendors_" + branchName;
  const sharedOrderKey = "orders:" + branchName;
  const sharedVendorKey = "order_vendors:" + branchName;
  const orderPendingKey = pendingLocalSaveStorageKey(storageKey);
  const vendorPendingKey = pendingLocalSaveStorageKey(vendorKey);
  // 지연 저장 슬롯. 발주와 거래처는 저장 키가 달라 슬롯도 따로 둔다.
  const orderSaveSlot = useRef(createSharedSaveSlot());
  const vendorSaveSlot = useRef(createSharedSaveSlot());
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [vendorsByCategory, setVendorsByCategory] = useState<Record<OrderCategory, string[]>>(ORDER_DEFAULT_VENDORS);
  // 기본값은 "선택" — 고르지 않으면 어느 분류에 넣을지 알 수 없으므로 추가를 막는다.
  const [vendorCategory, setVendorCategory] = useState<OrderCategory | "">("");
  const [vendorText, setVendorText] = useState("");
  const [reportMonth, setReportMonth] = useState(() => toLocalMonthInputValue());
  const [reportCategory, setReportCategory] = useState<OrderReportCategory>(ALL_ORDER_CATEGORIES);
  const [reportVendor, setReportVendor] = useState("전체");
  const [orderDraftCells, setOrderDraftCells] = useState<Record<string, string>>({});
  // 메모 팝업. 표가 스크롤 상자 안에 있어 칸 안에 그리면 잘리므로, 화면 좌표를 재서 표 바깥에 띄운다.
  const [memoEditor, setMemoEditor] = useState<MemoEditorState | null>(null);
  const [memoDraft, setMemoDraft] = useState("");
  // 작성방법 안내. 수동으로만 연다(다른 탭과 같은 규칙).
  const [guideOpen, setGuideOpen] = useState(false);
  // 원격 데이터를 다 불러왔는가.
  // 불러오기 전에 편집을 허용하면 안 된다 — 빈 상태에서 저장하는 순간 원격의 기존 발주가 통째로 지워진다.
  const [loaded, setLoaded] = useState(false);

  /**
   * 한 칸(대분류·거래처·날짜)에 발주 건이 두 개 이상 쌓인 데이터를 하나로 합친다.
   *
   * 화면은 한 칸을 언제나 한 건으로 다룬다(금액을 고치면 그 칸의 건을 지우고 새로 한 건을 쓴다).
   * 그래서 중복이 섞여 들어오면 편집하는 순간 나머지 건의 금액과 메모가 말없이 사라진다.
   * 불러올 때 미리 합쳐 두어 그 사고를 막는다 — 금액은 더하고(화면이 이미 합계로 보여주던 값 그대로),
   * 메모는 하나도 버리지 않고 줄 단위로 모두 남긴다.
   *
   * 아래 useEffect들이 의존성으로 참조하므로 반드시 그보다 먼저 선언돼야 한다.
   */
  const dedupeOrders = useCallback((items: OrderItem[]) => {
    const byCell = new Map<string, OrderItem>();
    items.forEach((item) => {
      if (!item || !item.vendorName || !item.orderDate) return;
      const key = `${item.category}|${item.vendorName}|${item.orderDate}`;
      const existing = byCell.get(key);
      if (!existing) {
        byCell.set(key, item);
        return;
      }
      // 메모는 하나만 남기면 안 된다 — 둘 다 지점이 적어둔 기록이라, 첫 번째만 남기면
      // 나머지가 복구 불가능하게 사라진다. 서로 다른 메모는 이어 붙여 전부 보존한다.
      //
      // 이미 합쳐진 메모는 줄 단위로 되풀어서 비교해야 한다. 통째로 한 덩어리로 다루면
      // 중복이 3건 이상일 때 "A\nB" 와 "A" 가 서로 다른 값으로 보여 A가 두 번 들어간다.
      const memos = Array.from(new Set(
        [existing.memo, item.memo]
          .flatMap((memo) => (memo || "").split("\n"))
          .map((line) => line.trim())
          .filter(Boolean)
      ));
      byCell.set(key, {
        ...existing,
        amount: String(Number(existing.amount || 0) + Number(item.amount || 0)),
        memo: memos.join("\n")
      });
    });
    return Array.from(byCell.values());
  }, []);

  useEffect(() => {
    try {
      const savedOrders = localStorage.getItem(storageKey);
      const savedVendors = localStorage.getItem(vendorKey);
      if (savedOrders) setOrders(dedupeOrders(JSON.parse(savedOrders)));
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
  }, [dedupeOrders, storageKey, vendorKey]);

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

  useEffect(() => {
    // 지점을 바꿔도 이 컴포넌트는 다시 만들어지지 않는다(탭이 그대로면 key가 같다).
    // 그래서 새 지점을 불러오는 동안 이전 지점의 loaded=true 가 남아 편집이 열려 있었다.
    // 불러오기를 시작할 때마다 다시 잠그고, 저장 슬롯도 새 지점 것으로 갈아끼운다
    // (슬롯을 물려받으면 이전 지점의 gen이 남아 pending 재전송이 건너뛰어진다).
    setLoaded(false);
    orderSaveSlot.current = createSharedSaveSlot();
    vendorSaveSlot.current = createSharedSaveSlot();
    let cancelled = false;
    const localOrdersJson = localStorage.getItem(storageKey);
    const localVendorsJson = localStorage.getItem(vendorKey);

    void Promise.all([
      gasClient.getSharedData<OrderItem[]>(sharedOrderKey),
      gasClient.getSharedData<Record<OrderCategory, string[]>>(sharedVendorKey)
    ]).then(([remoteOrders, remoteVendors]) => {
      if (cancelled) return;
      const localOrders = parseJsonArray<OrderItem>(localOrdersJson);
      // pending 표시는 이제 저장마다 다른 토큰이다("1"이 아니다) — 값이 있기만 하면 밀린 저장이 있다는 뜻.
      const hasPendingOrders = localStorage.getItem(orderPendingKey) !== null && localOrdersJson !== null;
      const remoteOrderItems = Array.isArray(remoteOrders) ? remoteOrders : null;
      // 한 칸에 두 건 이상 쌓여 있으면 여기서 합친다. 안 그러면 그 칸을 고치는 순간 나머지가 사라진다.
      const nextOrders = dedupeOrders(hasPendingOrders ? localOrders : remoteOrderItems ?? localOrders);
      if (hasPendingOrders || remoteOrderItems !== null || localOrdersJson !== null) {
        setOrders(nextOrders);
        localStorage.setItem(storageKey, JSON.stringify(nextOrders));
        if (hasPendingOrders) {
          // 재전송도 슬롯을 타야 한다 — 직접 보내면 방금 고친 값의 저장과 경쟁해 옛 값이 남을 수 있다.
          replayPendingSave(orderSaveSlot.current, sharedOrderKey, nextOrders, orderPendingKey, "orders");
        }
      }

      const localVendors = parseVendorJson(localVendorsJson);
      const hasPendingVendors = localStorage.getItem(vendorPendingKey) !== null && localVendors !== null;
      const remoteVendorMap = normalizeRemoteOrderVendors(remoteVendors);
      const normalizedVendors = hasPendingVendors ? localVendors : remoteVendorMap ?? localVendors;
      if (normalizedVendors) {
        setVendorsByCategory(normalizedVendors);
        localStorage.setItem(vendorKey, JSON.stringify(normalizedVendors));
        if (hasPendingVendors || (remoteVendorMap === null && localVendors !== null)) {
          replayPendingSave(vendorSaveSlot.current, sharedVendorKey, normalizedVendors, vendorPendingKey, "order_vendors");
        }
      }
    }).catch((error) => {
      console.error("Failed to load shared order data", error);
    }).finally(() => {
      // 실패해도 화면을 잠가두면 아무 작업도 못 한다. 로컬 값으로라도 편집을 연다.
      if (!cancelled) setLoaded(true);
    });

    return () => {
      cancelled = true;
      // 화면을 떠날 때 예약만 되고 못 나간 저장을 지금 올린다.
      // 그냥 타이머만 지우면 그 값은 로컬에만 남아, 다른 기기에서는 영영 보이지 않는다.
      flushSharedSave(orderSaveSlot.current, "orders");
      flushSharedSave(vendorSaveSlot.current, "order_vendors");
    };
  }, [dedupeOrders, normalizeRemoteOrderVendors, orderPendingKey, parseJsonArray, parseVendorJson, sharedOrderKey, sharedVendorKey, storageKey, vendorKey, vendorPendingKey]);

  useEffect(() => {
    // 예약만 되고 아직 클라우드로 못 나간 저장을, 화면을 떠나는 순간·온라인 복귀 순간에 즉시 내보낸다.
    // 이게 없으면 값을 적고 0.6초 안에 새로고침/탭닫기 시 그 저장이 사라져(메모리 전용)
    // 다른 노트북에서는 영영 보이지 않는다.
    const flushAll = () => {
      flushSharedSave(orderSaveSlot.current, "orders");
      flushSharedSave(vendorSaveSlot.current, "order_vendors");
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") flushAll();
    };
    window.addEventListener("beforeunload", flushAll);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", flushAll);
    window.addEventListener("online", flushAll);
    return () => {
      window.removeEventListener("beforeunload", flushAll);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", flushAll);
      window.removeEventListener("online", flushAll);
    };
  }, []);

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
    scheduleSharedSave(vendorSaveSlot.current, sharedVendorKey, next, vendorPendingKey, "order_vendors");
  };

  const saveOrders = (next: OrderItem[]) => {
    setOrders(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
    scheduleSharedSave(orderSaveSlot.current, sharedOrderKey, next, orderPendingKey, "orders");
  };

  const resolveOrderCategory = (vendor: string): OrderCategory => {
    if (reportCategory !== ALL_ORDER_CATEGORIES) return reportCategory;
    const registeredCategory = ORDER_CATEGORIES.find((category) => (vendorsByCategory[category] || []).includes(vendor));
    const existingCategory = orders.find((order) => order.vendorName === vendor)?.category;
    return registeredCategory || existingCategory || "식자재";
  };

  const addVendors = () => {
    if (!loaded) return;
    if (!vendorCategory) {
      window.alert("대분류를 먼저 선택해 주세요.");
      return;
    }
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
    if (!loaded) return;
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

  /**
   * 그 칸이 가리키는 발주 건 하나. 메모는 읽을 때도 쓸 때도 반드시 이 한 건만 본다.
   *
   * "전체보기"에서는 여러 대분류가 한 칸에 겹쳐 보일 수 있다(같은 날짜·거래처가 분류만 다른 경우).
   * 이때 조건에 맞는 건을 전부 건드리면 다른 분류의 메모까지 덮어쓰므로, 언제나 첫 한 건으로 못 박는다.
   */
  const cellOrderIndex = (dateKey: string, vendor: string) => {
    const targetCategories = reportCategory === ALL_ORDER_CATEGORIES ? ORDER_CATEGORIES : [reportCategory];
    return orders.findIndex((order) =>
      targetCategories.includes(order.category) && order.orderDate === dateKey && order.vendorName === vendor);
  };

  const cellMemo = (dateKey: string, vendor: string) => {
    const index = cellOrderIndex(dateKey, vendor);
    return index >= 0 ? (orders[index].memo || "") : "";
  };

  /**
   * 전체보기에서 대분류가 둘 이상 겹친 칸인가.
   *
   * 이런 칸에 보이는 금액은 여러 발주 건의 "합계"다. 합계 칸을 낱개 칸처럼 고치면
   * 겹친 건을 지우거나(발주·메모 유실) 한 건만 고쳐 합계가 친 값과 어긋난다 — 둘 다 틀렸다.
   * 그래서 아예 잠그고, 대분류를 하나 고른 뒤 수정하게 한다. (대분류당 건은 최대 1개다)
   */
  const isAggregateCell = (dateKey: string, vendor: string) => {
    if (reportCategory !== ALL_ORDER_CATEGORIES) return false;
    return orders.filter((order) => order.orderDate === dateKey && order.vendorName === vendor).length > 1;
  };

  const AGGREGATE_CELL_HINT = "대분류가 둘 이상 겹친 칸입니다. 위에서 대분류를 하나 고른 뒤 수정해 주세요.";

  /**
   * 화면에 보여줄 메모. 편집용 `cellMemo`(한 건만)와 달리, 겹친 칸에서는 겹친 건의 메모를 전부 모아 보여준다.
   *
   * 겹친 칸은 편집을 잠그므로, 첫 건의 메모만 읽으면 나머지 건에 적힌 메모가 화면에서 사라진다 —
   * 고칠 수도 없고 보이지도 않는 메모가 되어버린다. 잠그는 것과 감추는 것은 다르다.
   */
  const cellMemoDisplay = (dateKey: string, vendor: string) => {
    if (!isAggregateCell(dateKey, vendor)) return cellMemo(dateKey, vendor);
    return ORDER_CATEGORIES
      .map((category) => {
        const found = orders.find((order) =>
          order.category === category && order.orderDate === dateKey && order.vendorName === vendor);
        return found?.memo ? category + ": " + found.memo : "";
      })
      .filter(Boolean)
      .join("\n");
  };

  const updateOrderDraft = (dateKey: string, vendor: string, value: string) => {
    if (!loaded) return; // 아직 안 불러온 데이터를 고치면, 저장할 때 원격의 기존 발주를 지운다.
    if (isAggregateCell(dateKey, vendor)) return; // 잠긴 합계 칸. 입력칸이 disabled라 닿지 않지만 확실히 막는다.
    const nextValue = cleanNumeric(value).slice(0, 7);
    const draftKey = dateKey + "|" + vendor;
    const existingMemo = cellMemo(dateKey, vendor);
    const restoreCell = () => setOrderDraftCells((prev) => ({ ...prev, [draftKey]: String(cellAmount(dateKey, vendor) || "") }));

    if (existingMemo && Number(nextValue) <= 0) {
      // 숫자가 아닌 글자(한글 조합 중 등)라 값이 걸러진 것뿐이라면 지우려는 뜻이 아니다.
      // 여기서 확인창을 띄우면 한글을 치다가 삭제 경고를 보게 된다 — 조용히 되돌린다.
      const clearedOnPurpose = value.trim() === "";
      if (!clearedOnPurpose) {
        restoreCell();
        return;
      }
      // 금액을 지우면 그 칸의 발주 건이 통째로 사라진다 — 메모도 함께 사라지므로 먼저 묻는다.
      if (!window.confirm("이 칸의 메모도 함께 삭제됩니다.\n\n\"" + existingMemo + "\"\n\n계속할까요?")) {
        restoreCell();
        return;
      }
    }

    setOrderDraftCells((prev) => ({ ...prev, [draftKey]: nextValue }));

    // 이 칸이 실제로 가리키는 발주 건의 대분류. 아직 없으면 거래처가 등록된 대분류에 새로 만든다.
    // 전체보기라고 해서 같은 날짜·거래처의 "모든" 대분류를 지우면 안 된다 —
    // 다른 대분류에 들어 있는 발주와 그 메모까지 말없이 날아간다(cellMemo가 보는 건과 반드시 같은 한 건만 건드린다).
    const targetIndex = cellOrderIndex(dateKey, vendor);
    const categoryForCell = targetIndex >= 0 ? orders[targetIndex].category : resolveOrderCategory(vendor);

    setOrders((currentOrders) => {
      const kept = currentOrders.filter((order) => !(order.category === categoryForCell && order.orderDate === dateKey && order.vendorName === vendor));
      const nextOrders = Number(nextValue) > 0
        ? [{
          id: "ord-cell-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
          category: categoryForCell,
          vendorName: vendor,
          amount: nextValue,
          // 금액을 고쳐도 메모는 살아남아야 한다. 예전에는 여기서 빈 값으로 덮어써 메모가 날아갔다.
          memo: existingMemo,
          orderDate: dateKey
        }, ...kept]
        : kept;
      localStorage.setItem(storageKey, JSON.stringify(nextOrders));
      scheduleSharedSave(orderSaveSlot.current, sharedOrderKey, nextOrders, orderPendingKey, "orders");
      return nextOrders;
    });
  };

  /** 메모만 갈아끼운다. 칸이 가리키는 발주 건 한 개만 바꾼다(다른 분류의 메모를 덮어쓰지 않는다). */
  const updateOrderMemo = (dateKey: string, vendor: string, memo: string) => {
    if (!loaded) return;
    const index = cellOrderIndex(dateKey, vendor);
    setMemoEditor(null);
    if (index < 0) return; // 금액이 없는 칸 — 담을 발주 건이 없다.
    const nextMemo = memo.trim();
    if ((orders[index].memo || "") === nextMemo) return;
    saveOrders(orders.map((order, i) => (i === index ? { ...order, memo: nextMemo } : order)));
  };

  /** 표는 스크롤 상자 안에 있다. 칸 안에 팝업을 그리면 잘리므로 화면 좌표를 재서 표 바깥에 띄운다. */
  const openMemoEditor = (anchor: HTMLElement, dateKey: string, vendor: string, day: string, shownAmount: number) => {
    if (isAggregateCell(dateKey, vendor)) {
      // 겹친 칸에 메모를 쓰면 어느 건에 붙는지 알 수 없다. 금액과 같은 규칙으로 잠근다.
      window.alert(AGGREGATE_CELL_HINT);
      return;
    }
    if (shownAmount <= 0) {
      window.alert("금액을 먼저 입력해 주세요.\n메모는 발주 금액이 있는 칸에만 달 수 있습니다.");
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const spillsBelow = rect.bottom + MEMO_POPUP_HEIGHT > window.innerHeight - 8;
    setMemoDraft(cellMemo(dateKey, vendor));
    setMemoEditor({
      dateKey,
      vendor,
      day,
      amount: shownAmount,
      top: spillsBelow ? Math.max(8, rect.top - MEMO_POPUP_HEIGHT - 6) : rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - MEMO_POPUP_WIDTH - 8))
    });
  };

  // 팝업 위치는 열 때 한 번 잰 값이다. 화면이 바뀌면 칸에서 떨어져 나가므로 그냥 닫는다.
  useEffect(() => {
    if (!memoEditor) return;
    const closeEditor = () => setMemoEditor(null);
    window.addEventListener("resize", closeEditor);
    window.addEventListener("scroll", closeEditor);
    return () => {
      window.removeEventListener("resize", closeEditor);
      window.removeEventListener("scroll", closeEditor);
    };
  }, [memoEditor]);

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
      {/* 작성방법 안내: 탭 최상단 가운데(일일마감정산과 같은 자리). 켜둔 채로 작성할 수 있게 배경을 어둡게 하지 않는다. */}
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
      <GuideCallouts open={guideOpen} steps={orderGuideSteps} onClose={() => setGuideOpen(false)} />

      {/* 입력 도구 줄 — 라벨을 따로 두고 칸을 키우면 세로로만 길어진다.
          한 줄에 붙이고 글자·높이를 표에 맞춰 줄였다(주류재고 상단과 같은 규칙). */}
      <section className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3">
        <h3 className="text-sm font-black text-gray-900 w-fit">거래처 추가</h3>
        {/* 안내 말풍선은 대분류·거래처명 칸을 따로 가리키지 않고 이 줄 전체를 하나로 가리킨다.
            둘로 나누면 말풍선이 서로 겹치고, 어차피 "왼쪽부터 오른쪽으로" 한 흐름이라 나눌 이유가 없다. */}
        <div className="flex flex-wrap items-center gap-1.5" data-guide="order-vendor-add">
          {/* 고른 대분류의 색이 그대로 칸에 들어간다 — 아래 거래처 칩·표 머리글과 같은 색이라 눈으로 이어진다. */}
          <select
            value={vendorCategory}
            onChange={(e) => setVendorCategory(e.target.value as OrderCategory | "")}
            disabled={!loaded}
            aria-label="대분류"
            className={`h-8 w-[124px] rounded-lg px-2 text-[11px] font-extrabold ${
              vendorCategory ? getOrderCategoryHeaderClass(vendorCategory) : "border border-gray-200 bg-white text-gray-400"
            }`}
          >
            <option value="">선택</option>
            {ORDER_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <label className="relative group">
            {/* textarea여야 한다 — input은 붙여넣을 때 줄바꿈을 지워버려 여러 곳 한 번에 넣기가 깨진다. */}
            <textarea
              value={vendorText}
              onChange={(e) => setVendorText(e.target.value)}
              disabled={!loaded}
              title={VENDOR_HINT}
              rows={1}
              placeholder="거래처명 (쉼표·줄바꿈으로 여러 개)"
              className="h-8 w-[240px] resize-none overflow-y-auto rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-bold leading-tight"
            />
            <span className="pointer-events-none absolute left-0 top-full mt-1.5 z-20 hidden w-56 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-bold text-white shadow-lg group-focus-within:block">{VENDOR_HINT}</span>
          </label>
          <button type="button" onClick={addVendors} disabled={!loaded} className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-slate-800 px-3 text-[11px] font-black text-white disabled:opacity-40 disabled:cursor-not-allowed">
            <Plus className="h-3.5 w-3.5" /> 추가
          </button>
        </div>
        {/* 고른 분류의 거래처만 보여주면 나머지가 어디 있는지 알 수 없다 —
            전 분류를 한꺼번에 펼치고, 각 거래처는 자기 분류 색을 달고 있게 한다. */}
        <div className="flex flex-wrap gap-1.5">
          {ORDER_CATEGORIES.every((category) => (vendorsByCategory[category] || []).length === 0) ? (
            <span className="text-[11px] text-gray-400 font-bold">등록된 거래처가 없습니다.</span>
          ) : ORDER_CATEGORIES.flatMap((category) =>
            (vendorsByCategory[category] || []).map((vendor) => (
              <span key={category + "|" + vendor} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black ${getOrderCategoryHeaderClass(category)} order-cat-soft`}>
                {vendor}
                <button type="button" onClick={() => deleteVendor(category, vendor)} className="opacity-50 hover:opacity-100 hover:text-rose-600" aria-label={vendor + " 삭제"}><X className="w-3 h-3" /></button>
              </span>
            ))
          )}
        </div>
      </section>

      {/* 섹션이 overflow-hidden이라 칩을 그 안에 두면 윗부분이 잘린다 — 테두리에 걸치도록 바깥에서 얹는다. */}
      <div className="relative">
      <SheetKeyHint />
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="space-y-1">
              <h3 className="text-sm font-black text-gray-900">발주내역 리포트</h3>
              <p className="text-[11px] text-gray-400">
                날짜별 칸에 금액을 입력하면 자동 저장됩니다. 특이사항은 칸을 고른 뒤 메모 아이콘(또는 우클릭)으로 남깁니다.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <div className="flex h-8 items-center rounded-lg bg-[#2E6DB4]/10 px-2.5 text-[11px] font-black text-[#1A3C6E]">월 합계 {formatNumber(monthTotal)}원</div>
              {/* 불러오는 동안 칸이 잠긴다. 이유를 안 알려주면 고장으로 보인다. */}
              {loaded ? (
                <div className="flex h-8 items-center rounded-lg bg-emerald-50 px-2.5 text-[11px] font-black text-emerald-700">자동저장</div>
              ) : (
                <div className="flex h-8 items-center rounded-lg bg-amber-50 px-2.5 text-[11px] font-black text-amber-700">불러오는 중…</div>
              )}
            </div>
          </div>
          {/* 필터는 도구 줄이다 — 표만큼 넓힐 이유가 없어 내용 폭에 맞춰 붙인다. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} className="h-8 w-[132px] rounded-lg border border-gray-200 px-2 text-[11px] font-bold" />
            <select data-guide="order-report-category" value={reportCategory} onChange={(e) => { setReportCategory(e.target.value as OrderReportCategory); setOrderDraftCells({}); }} className={`h-8 w-[124px] rounded-lg px-2 text-[11px] font-extrabold ${reportCategory === ALL_ORDER_CATEGORIES ? "border border-gray-200 bg-white" : getOrderCategoryHeaderClass(reportCategory)}`}>
              <option value={ALL_ORDER_CATEGORIES}>전체보기</option>
              {ORDER_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={reportVendor} onChange={(e) => setReportVendor(e.target.value)} className="h-8 w-[150px] rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold">
              <option value="전체">전체 거래처</option>
              {reportVendors.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}
            </select>
          </div>
        </div>
        <div className="max-h-[70vh] overflow-auto" data-guide="order-matrix">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="sticky top-0 z-20 bg-gray-50 text-gray-600 font-black border-b shadow-sm">
              <tr>
                <th rowSpan={2} className="sticky left-0 z-30 bg-gray-50 p-2 w-12 border-r align-middle">일</th>
                {categoryHeaderGroups.map((group, index) => (
                  <th key={`${group.category}-${index}`} colSpan={group.span} className={`p-2 text-center border-r border-b ${getOrderCategoryHeaderClass(group.category)}`}>
                    {group.category}
                  </th>
                ))}
                <th rowSpan={2} className="p-2 min-w-[104px] text-right bg-slate-100 align-middle">일 합계</th>
              </tr>
              <tr>
                {matrixVendors.map((vendor, colIndex) => {
                  const category = vendorCategoryOf(vendor);
                  // 분류별 색은 그대로 두고, 지금 편집 중인 열만 안쪽 테두리로 짚어준다.
                  const columnActive = activeCell?.col === colIndex;
                  return (
                    <th
                      key={vendor}
                      className={`p-1.5 min-w-[78px] text-center border-r border-b ${getOrderCategoryHeaderClass(category)} ${
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
                    {/* 날짜 칸 — 왼쪽에 고정되고, 지금 편집 중인 행을 짚어준다.
                        z-20이 없으면 안 된다: 금액 칸들이 relative(위치 지정)라, 같은 층위에서는
                        DOM 순서상 뒤에 오는 금액 칸이 위에 그려져 가로 스크롤 시 날짜를 덮는다.
                        메모 말풍선(z-30)보다는 아래여야 하므로 z-20으로 둔다. */}
                    <td
                      className={`sticky left-0 z-20 p-1.5 text-center font-mono font-black border-r transition-colors ${
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
                      // 대분류가 겹쳐 합계로 보이는 칸 — 낱개처럼 고칠 수 없으므로 잠근다(단, 메모는 전부 보여준다).
                      const aggregate = isAggregateCell(dateKey, vendor);
                      const memo = cellMemoDisplay(dateKey, vendor);
                      // 아래쪽 행은 말풍선이 표 밖으로 잘리므로 위로 뒤집는다.
                      const memoFlipUp = rowIndex >= matrixDays.length - 6;
                      return (
                        <td
                          key={vendor}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            openMemoEditor(e.currentTarget, dateKey, vendor, day, value);
                          }}
                          className={`group p-0 text-right font-mono border-r relative ${
                            cellActive ? "outline outline-2 -outline-offset-2 outline-[#2E6DB4] z-10 bg-white" : ""
                          }`}
                        >
                          <input
                            {...cellProps(rowIndex, colIndex)}
                            value={draftValue !== undefined ? formatWithCommas(draftValue) : (value ? formatWithCommas(value) : "")}
                            onChange={(e) => updateOrderDraft(dateKey, vendor, e.target.value)}
                            disabled={aggregate || !loaded}
                            title={aggregate ? AGGREGATE_CELL_HINT : undefined}
                            aria-label={`${Number(day)}일 ${vendor} 발주금액${aggregate ? " (합계 · 잠김)" : ""}${memo ? " (메모: " + memo + ")" : ""}`}
                            inputMode="numeric"
                            maxLength={9}
                            // 왼쪽에 아이콘 자리를 상시로 비워두면 안 된다 — 최대 금액(1,234,567 ≈ 65px)이 잘린다.
                            // 아이콘은 마우스를 올렸을 때만 뜨고, 숫자는 오른쪽 정렬이라 짧은 금액에선 애초에 겹치지 않는다.
                            className={`w-full h-8 bg-transparent border-0 rounded-none px-1.5 text-right font-mono font-black focus:outline-none ${
                              aggregate ? "text-gray-400 italic cursor-not-allowed" : ""
                            }`}
                          />

                          {/* 메모 있음 — 엑셀처럼 우상단 삼각형 */}
                          {memo ? (
                            <span className="pointer-events-none absolute right-0 top-0 h-0 w-0 border-l-[7px] border-t-[7px] border-l-transparent border-t-[#2E6DB4]" />
                          ) : null}

                          {/*
                            메모 버튼. 이 표는 숫자를 읽는 표다 — 아이콘이 늘 떠 있으면 숫자보다 먼저 눈에 들어온다.
                            메모가 있다는 신호는 우상단 삼각형이 맡고, 이 버튼은 쓰거나 고칠 때만 나타난다.

                            늘 그려두고 보이기만 바꾸는 이유: 조건부로 그리면 입력칸이 포커스를 잃는 순간
                            버튼이 사라져 클릭이 먹지 않는다. 대신 안 보이는 동안엔 클릭이 밑의 입력칸으로 지나가야 한다
                            (투명해도 클릭은 가로채므로 pointer-events-none이 필요하다).
                            Tab은 칸 사이 이동에 써야 하므로 tabIndex=-1로 순서에서 뺀다(키보드는 우클릭 키로 연다).
                          */}
                          <button
                            type="button"
                            tabIndex={-1}
                            hidden={aggregate}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => openMemoEditor(e.currentTarget, dateKey, vendor, day, value)}
                            aria-label={`${Number(day)}일 ${vendor} 메모 ${memo ? "수정" : "추가"}`}
                            className={`absolute left-0.5 top-1/2 z-20 -translate-y-1/2 rounded p-0.5 text-gray-400 opacity-0 transition pointer-events-none hover:bg-blue-50 hover:text-[#2E6DB4] group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto ${
                              memo ? "text-[#2E6DB4]" : ""
                            }`}
                          >
                            <StickyNote className="h-3 w-3" />
                          </button>

                          {/* 읽기 전용 말풍선. 마우스를 올리거나(데스크톱) 칸을 고르면(터치) 뜬다. */}
                          {memo ? (
                            <span
                              className={`pointer-events-none absolute right-0 z-30 w-56 whitespace-pre-wrap break-words rounded-lg bg-slate-900 px-3 py-2 text-left text-[11px] font-bold leading-relaxed text-white shadow-lg ${
                                memoFlipUp ? "bottom-full mb-1" : "top-full mt-1"
                              } ${cellActive ? "block" : "hidden group-hover:block"}`}
                            >
                              {memo}
                            </span>
                          ) : null}
                        </td>
                      );
                    })}
                    <td className="p-1.5 text-right font-mono font-black bg-slate-50">{rowTotal ? formatNumber(rowTotal) : ""}</td>
                  </tr>
                );
              })}
              {/* 합계는 표 맨 아래까지 내려가야 보였다 — 스크롤과 무관하게 바닥에 붙여 둔다. */}
              <tr className="sticky bottom-0 z-20 bg-gray-100 font-black shadow-[0_-1px_0_0_rgb(203_213_225)]">
                <td className="sticky left-0 z-30 bg-gray-100 p-2 text-center border-r">합계</td>
                {totals.map((value, index) => <td key={matrixVendors[index]} className="bg-gray-100 p-2 text-right font-mono border-r">{value ? formatNumber(value) : ""}</td>)}
                <td className="bg-gray-100 p-2 text-right font-mono text-[#2E6DB4]">{formatNumber(monthTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      </div>

      {memoEditor ? (
        <>
          {/* 바깥을 누르면 닫힌다. 표 스크롤도 함께 막아 팝업이 칸에서 떨어져 나가지 않게 한다. */}
          <div className="fixed inset-0 z-40" onClick={() => setMemoEditor(null)} />
          <div
            className="fixed z-50 rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl"
            style={{ top: memoEditor.top, left: memoEditor.left, width: MEMO_POPUP_WIDTH }}
            role="dialog"
            aria-label="발주 메모"
          >
            <div className="flex items-center justify-between pb-2">
              <span className="text-[11px] font-black text-gray-500">
                {Number(memoEditor.day)}일 · {memoEditor.vendor} · {formatNumber(memoEditor.amount)}원
              </span>
              <button type="button" onClick={() => setMemoEditor(null)} aria-label="메모 닫기" className="text-gray-400 hover:text-gray-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <textarea
              autoFocus
              value={memoDraft}
              onChange={(e) => setMemoDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMemoEditor(null);
                }
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  updateOrderMemo(memoEditor.dateKey, memoEditor.vendor, memoDraft);
                }
              }}
              rows={4}
              // 중복 데이터를 합치면 여러 줄 메모가 하나로 이어질 수 있어 한도를 넉넉히 둔다.
              maxLength={1000}
              placeholder="예: 세금계산서 금액과 3천원 차이 있음"
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold leading-relaxed focus:border-[#2E6DB4] focus:outline-none"
            />
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => updateOrderMemo(memoEditor.dateKey, memoEditor.vendor, "")}
                className="px-2 py-1.5 text-[11px] font-black text-rose-500 hover:text-rose-700"
              >
                메모 삭제
              </button>
              <button
                type="button"
                onClick={() => updateOrderMemo(memoEditor.dateKey, memoEditor.vendor, memoDraft)}
                className="rounded-xl bg-slate-800 px-4 py-1.5 text-[11px] font-black text-white"
              >
                저장
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
