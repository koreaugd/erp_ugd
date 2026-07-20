// src/pages/branch/tabs/OrderManagementTabV2.tsx
// 발주관리 탭. BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { BookOpen, Pencil, Plus, StickyNote, X } from "lucide-react";
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
import { evaluateOrderFormula, isFormulaInput } from "../helpers/orderFormula";
import { createSharedSaveSlot, flushSharedSave, scheduleSharedSave, replayPendingSave, setSharedSaveStatusListener, healSharedIfServerMissing, type SaveStatus } from "../helpers/sharedSaveSlot";

const MEMO_POPUP_WIDTH = 288;
const MEMO_POPUP_HEIGHT = 208;
// 수식 바: 활성 수식 칸 위에 뜨는 넓은 입력줄(입력 한 줄 + 결과 한 줄).
const FORMULA_BAR_WIDTH = 340;
const FORMULA_BAR_HEIGHT = 60;

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
  // 표 머리글에서 이름을 고치는 중인 거래처.
  // original은 고치기 전 이름, category는 그 머리글에 적혀 있던 대분류다(둘을 함께 봐야 발주 건을 찾는다 —
  // 대분류가 다른 같은 이름은 서로 다른 거래처라 이름만으로 찾으면 남의 발주까지 끌려온다).
  const [vendorRename, setVendorRename] = useState<{ original: string; category: OrderCategory; value: string } | null>(null);
  // 메모 팝업. 표가 스크롤 상자 안에 있어 칸 안에 그리면 잘리므로, 화면 좌표를 재서 표 바깥에 띄운다.
  const [memoEditor, setMemoEditor] = useState<MemoEditorState | null>(null);
  const [memoDraft, setMemoDraft] = useState("");
  // 작성방법 안내. 수동으로만 연다(다른 탭과 같은 규칙).
  const [guideOpen, setGuideOpen] = useState(false);
  // 원격 데이터를 다 불러왔는가.
  // 불러오기 전에 편집을 허용하면 안 된다 — 빈 상태에서 저장하는 순간 원격의 기존 발주가 통째로 지워진다.
  const [loaded, setLoaded] = useState(false);
  // 두 저장 슬롯(발주·거래처)의 상태를 합쳐 하나의 배지로 보여준다.
  // 어느 하나라도 실패면 "동기화 실패", 하나라도 저장 중이면 "저장 중", 둘 다 끝나면 "자동저장됨".
  const orderStatusRef = useRef<SaveStatus>("idle");
  const vendorStatusRef = useRef<SaveStatus>("idle");
  // Enter로 수식을 계산·커밋한 직후엔 곧이어 터지는 blur가 같은 칸을 또 계산하지 않도록 표시해 둔다("dateKey|vendor").
  const formulaJustCommitted = useRef<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // ── 수식 바 ── 활성 수식 칸 바로 위에 떠서 수식 전체를 크게 보여주고(칸은 결과 숫자만), ↑로 들어가 편집한다.
  const [formulaBar, setFormulaBar] = useState<{ dateKey: string; vendor: string; row: number; col: number; top: number; left: number } | null>(null);
  const [formulaBarDraft, setFormulaBarDraft] = useState("");
  const [barFocused, setBarFocused] = useState(false); // 바 입력에 포커스가 있는가(그동안은 activeCell이 null이어도 바를 유지)
  const activeCellElRef = useRef<HTMLInputElement | null>(null); // 현재 활성 칸의 DOM(바 위치 계산용)
  const formulaBarInputRef = useRef<HTMLInputElement | null>(null);
  // 화면을 떠날 때 실행할 flush 로직 — 최신 상태(바 편집값 등)를 보도록 매 렌더 갱신하는 ref에 담는다.
  const flushOnLeaveRef = useRef<() => void>(() => {});
  const recomputeSaveStatus = useCallback(() => {
    const a = orderStatusRef.current;
    const b = vendorStatusRef.current;
    setSaveStatus(a === "error" || b === "error" ? "error" : a === "saving" || b === "saving" ? "saving" : "idle");
  }, []);

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
      // 금액을 합치면 어느 한쪽 수식으로도 그 합을 나타낼 수 없다 — 수식은 버려 값과 어긋나지 않게 한다.
      const { formula: _mergedFormula, ...existingWithoutFormula } = existing;
      byCell.set(key, {
        ...existingWithoutFormula,
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
    const orderSlot = createSharedSaveSlot();
    const vendorSlot = createSharedSaveSlot();
    orderSaveSlot.current = orderSlot;
    vendorSaveSlot.current = vendorSlot;
    // 슬롯을 새로 만들 때마다 상태 구독을 다시 붙인다. 옛 지점 슬롯의 늦게 도착한 저장 콜백이
    // 새 지점 배지를 덮어쓰지 않도록, 이 콜백이 여전히 현재 슬롯의 것인지 확인하고서야 반영한다.
    orderStatusRef.current = "idle";
    vendorStatusRef.current = "idle";
    setSaveStatus("idle");
    setSharedSaveStatusListener(orderSlot, (status) => {
      if (orderSaveSlot.current !== orderSlot) return;
      orderStatusRef.current = status;
      recomputeSaveStatus();
    });
    setSharedSaveStatusListener(vendorSlot, (status) => {
      if (vendorSaveSlot.current !== vendorSlot) return;
      vendorStatusRef.current = status;
      recomputeSaveStatus();
    });
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
        } else if (remoteOrderItems === null && localOrders.length > 0) {
          // 서버엔 발주 문서가 아예 없고 로컬에만 있음 → 서버로 자가복구(다른 노트북에서도 보이도록).
          void healSharedIfServerMissing(sharedOrderKey, nextOrders, "orders");
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
  }, [dedupeOrders, normalizeRemoteOrderVendors, orderPendingKey, parseJsonArray, parseVendorJson, recomputeSaveStatus, sharedOrderKey, sharedVendorKey, storageKey, vendorKey, vendorPendingKey]);

  // flush 로직은 최신 상태(수식 바 편집값·포커스 등)를 봐야 하므로 매 렌더 ref에 갱신해 둔다.
  // 숫자는 키 입력마다 저장되지만 수식은 커밋(Enter/이동/적용) 때만 저장된다. 입력·바 편집 중 화면을 떠나면
  // 초안이 유실될 수 있어, 떠나기 직전 편집 중 수식을 flushSync로 동기 커밋한다 —
  // flushSync가 setState 업데이터(localStorage 기록 + 예약)를 즉시 돌려 flush 전에 반영되게 한다.
  useEffect(() => {
    flushOnLeaveRef.current = () => {
      try {
        flushSync(() => {
          if (barFocused && formulaBar) {
            // 수식 바에서 편집 중 — blur만으로는 커밋 안 되므로(바 onBlur는 barFocused만 끔) 여기서 직접 반영한다.
            const draft = formulaBarDraft.trim();
            const stored = (cellFormula(formulaBar.dateKey, formulaBar.vendor) || "").trim();
            if (draft && draft !== "=" && draft !== stored) {
              const expr = draft.startsWith("=") ? draft : "=" + draft;
              commitOrderFormula(formulaBar.dateKey, formulaBar.vendor, expr, false);
            }
          } else {
            // 칸에서 수식을 치던 중이면 blur → onBlur가 계산·저장한다(숫자 칸은 무해).
            const el = document.activeElement as HTMLElement | null;
            if (el && el !== document.body && typeof el.blur === "function") el.blur();
          }
        });
      } catch { /* flushSync가 실패해도 아래 flush는 시도한다 */ }
      flushSharedSave(orderSaveSlot.current, "orders");
      flushSharedSave(vendorSaveSlot.current, "order_vendors");
    };
  });

  useEffect(() => {
    const onLeave = () => flushOnLeaveRef.current();
    const onVisibility = () => { if (document.visibilityState === "hidden") onLeave(); };
    const onOnline = () => { // 온라인 복귀는 예약분만 내보낸다(입력 중 칸을 건드리지 않음)
      flushSharedSave(orderSaveSlot.current, "orders");
      flushSharedSave(vendorSaveSlot.current, "order_vendors");
    };
    window.addEventListener("beforeunload", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("online", onOnline);
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

  /**
   * 거래처 이름 바꾸기. 표 머리글에서 고치면 거래처 칩과 발주내역이 함께 따라간다.
   *
   * 이름은 두 곳에 각각 적혀 있다 — 거래처 목록(vendorsByCategory)과 발주 건 하나하나(order.vendorName).
   * 둘 중 하나만 고치면 옛 이름의 발주가 주인 없이 남아, 표에 옛 이름 열이 그대로 하나 더 생긴다.
   * (표의 열은 이름으로 묶이고, reportVendors가 발주 건의 이름까지 열로 올리기 때문이다.)
   *
   * **반드시 한 대분류 안에서만 바꾼다.** 이름만 보고 바꾸면 안 된다 —
   * 발주 건의 진짜 신원은 대분류+이름+날짜이고(dedupeOrders가 그 기준으로 합친다),
   * 대분류가 다른 같은 이름은 서로 다른 거래처다(식자재 "쿠팡"과 주류 "쿠팡"은 남남).
   * 이름만 보고 바꾸면 지금 화면에 보이지도 않는 다른 대분류의 거래처와 그 발주까지 말없이 끌려온다.
   * 그래서 머리글에 적힌 그 대분류(vendorRename.category)의 칩과 발주만 옮긴다.
   */
  const commitVendorRename = (mode: "enter" | "blur" = "enter") => {
    if (!vendorRename) return;
    if (!loaded) return; // 아직 안 불러온 상태에서 저장하면 원격의 기존 값을 지운다.
    const { original, category: scope } = vendorRename;
    const nextName = vendorRename.value.trim();
    // 이름을 비우거나 그대로면 바꿀 것이 없다 — 조용히 닫는다(빈 이름은 열을 잃는 것이라 반영하지 않는다).
    if (!nextName || nextName === original) {
      setVendorRename(null);
      return;
    }
    // 다른 대분류가 그 이름을 이미 쓰고 있으면 막는다.
    // 열은 이름으로 접히므로(reportVendors가 Set으로 합친다) 두 대분류의 거래처가 한 열이 되고,
    // 그 칸은 합계로 잠겨(isAggregateCell) 더는 고칠 수 없다 — 열에서 풀 방법이 없으니 미리 막는다.
    const usedInOtherCategory = ORDER_CATEGORIES.some((category) =>
      category !== scope && (
        (vendorsByCategory[category] || []).includes(nextName) ||
        orders.some((order) => order.category === category && order.vendorName === nextName)
      ));
    if (usedInOtherCategory) {
      window.alert(`"${nextName}"는 다른 대분류에서 이미 쓰고 있는 이름입니다.\n같은 이름이 두 대분류에 있으면 표에서 한 열로 겹쳐 금액을 고칠 수 없게 됩니다.\n\n대분류가 드러나는 다른 이름을 써 주세요. (예: ${nextName}(${scope}))`);
      if (mode === "blur") setVendorRename(null);
      return;
    }
    // 같은 대분류 안에서 막아야 하는 것은 "이름이 같은 것"이 아니라 "발주내역끼리 겹치는 것"이다.
    // 발주가 있는 두 거래처를 한 이름으로 만들면 같은 날짜 칸에 발주가 겹쳐
    // 금액이 합계로 잠기고(isAggregateCell) 다시 열 때 dedupeOrders가 금액을 더해버린다 — 되돌릴 수 없다.
    //
    // 반대로 상대가 "이름만 있고 발주는 없는" 거래처라면 겹칠 발주가 없어 합쳐도 안전하다.
    // 이 경우를 함께 막으면 안 된다 — 그러면 빠져나올 수 없는 상태가 생긴다:
    // 이름 변경은 두 문서(거래처 목록·발주내역)에 나뉘어 저장되므로 한쪽만 올라갈 수 있는데,
    // 그때 다른 노트북에는 "칩은 새 이름, 발주는 옛 이름"으로 어긋나 보인다.
    // 그 노트북에서 옛 이름을 새 이름으로 고쳐 맞추려 해도, 이름만 겹친다고 막으면 영영 복구할 수 없다.
    const targetHasOrders = orders.some((order) => order.category === scope && order.vendorName === nextName);
    if (targetHasOrders) {
      window.alert(`"${nextName}" 거래처에는 이미 발주내역이 있습니다.\n두 거래처를 한 이름으로 합치면 같은 날짜 칸에서 금액이 뭉쳐 되돌릴 수 없습니다.\n\n다른 이름을 쓰거나, 발주내역을 옮긴 뒤 지워 주세요.`);
      // Enter로 저장하려던 것이면 고칠 기회를 남긴다.
      // 다른 곳을 눌러 떠나는 중이면 닫는다 — 열어 두면 바깥을 누를 때마다 같은 경고가 다시 떠
      // 빠져나갈 길이 Esc뿐인 덫이 된다(저장된 것은 없으니 닫아도 잃는 값은 없다).
      if (mode === "blur") setVendorRename(null);
      return;
    }
    // 발주 없는 같은 이름과 합쳐지는 경우 — 안전하지만 실수로 그럴 수도 있으니 한 번 묻는다.
    const targetHasChip = (vendorsByCategory[scope] || []).includes(nextName);
    if (targetHasChip && !window.confirm(`"${nextName}" 거래처가 이미 ${scope} 목록에 있습니다.\n두 이름을 하나로 합치고 "${original}"의 발주내역을 "${nextName}"으로 옮길까요?`)) {
      if (mode === "blur") setVendorRename(null);
      return;
    }
    saveVendors({
      ...vendorsByCategory,
      // 합칠 때 같은 분류 안에 같은 이름이 둘 남을 수 있다([A, B]에서 A를 B로 → [B, B]).
      // 칩은 분류+이름을 key로 그리므로 그대로 두면 React key가 겹치고 목록에도 같은 칩이 두 번 뜬다.
      [scope]: Array.from(new Set((vendorsByCategory[scope] || []).map((vendor) => (vendor === original ? nextName : vendor))))
    });
    saveOrders(orders.map((order) =>
      (order.category === scope && order.vendorName === original) ? { ...order, vendorName: nextName } : order));
    // 이름은 두 문서(거래처 목록·발주내역)에 나뉘어 저장된다 — 하나만 올라가면 다른 노트북에서
    // 옛 이름 열과 새 이름 열이 함께 보인다(값이 사라지진 않지만 헷갈린다).
    // 그래서 0.6초 지연을 기다리지 않고 둘 다 지금 곧바로 내보낸다. 이름을 고치자마자 탭을 닫아도
    // 한쪽만 남는 일이 없다 — 떠날 때의 flush는 예약이 아직 살아 있을 때만 구해주기 때문이다.
    // 한쪽이 실패해도 값은 버리지 않는다: 슬롯이 재시도하고, pending 표시가 남아 다음에 열 때 다시 올라가며,
    // 실패하는 동안엔 위쪽 "동기화 실패" 배지가 빨갛게 뜬다.
    flushSharedSave(vendorSaveSlot.current, "order_vendors");
    flushSharedSave(orderSaveSlot.current, "orders");
    // 편집 중이던 임시 입력값과 메모 팝업은 옛 이름으로 묶여 있다 — 그대로 두면 엉뚱한 칸에 값이 남는다.
    setOrderDraftCells({});
    setMemoEditor(null);
    // 그 거래처만 보고 있었다면 새 이름으로 따라간다(안 그러면 필터가 풀려 전체보기로 튄다).
    if (reportVendor === original) setReportVendor(nextName);
    setVendorRename(null);
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

  /** 그 칸을 채운 발주 건의 원본 수식("=1000+2000"). 수식으로 넣지 않았으면 빈 문자열. (cellMemo와 같은 규칙 — 한 건만 본다) */
  const cellFormula = (dateKey: string, vendor: string) => {
    const index = cellOrderIndex(dateKey, vendor);
    return index >= 0 ? (orders[index].formula || "") : "";
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

  const updateOrderDraft = (dateKey: string, vendor: string, value: string, formula?: string) => {
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
          orderDate: dateKey,
          // 수식으로 넣었을 때만 원본 수식을 함께 저장한다. 숫자로 직접 치면 필드를 아예 넣지 않아
          // (undefined 저장은 Firestore가 거부) 이전에 있던 수식이 자연히 사라진다.
          ...(formula ? { formula } : {})
        }, ...kept]
        : kept;
      localStorage.setItem(storageKey, JSON.stringify(nextOrders));
      scheduleSharedSave(orderSaveSlot.current, sharedOrderKey, nextOrders, orderPendingKey, "orders");
      return nextOrders;
    });
  };

  /**
   * 엑셀식 수식 커밋. "=15000*3" 같은 글자를 계산해 그 칸에 결과 숫자를 넣는다
   * (숫자를 직접 친 것과 똑같은 저장 경로 updateOrderDraft 를 탄다 — 결과만 저장되고 수식은 남지 않는다).
   * 성공하면 true. 계산 실패면 alertOnError 가 켜진 경우에만 이유를 알리고, 값은 손대지 않는다(false).
   */
  const commitOrderFormula = (dateKey: string, vendor: string, rawText: string, alertOnError: boolean): boolean => {
    const result = evaluateOrderFormula(rawText);
    if (result.ok) {
      // "=5000"처럼 계산할 게 없는 순수 숫자면 수식으로 취급하지 않는다(수식 표시·팝업이 안 붙고, 수식→일반숫자 되돌리기도 이걸로 된다).
      const bare = rawText.trim().replace(/^=/, "").replace(/[\s,]/g, "");
      const isPlainNumber = /^\d+$/.test(bare);
      // 결과 숫자를 저장하되, 진짜 수식이면 원본도 함께 넘겨 나중에 다시 보고 고칠 수 있게 한다("=" 포함, 앞뒤 공백만 정리).
      updateOrderDraft(dateKey, vendor, String(result.value), isPlainNumber ? undefined : rawText.trim());
      return true;
    }
    if (alertOnError) window.alert("수식을 계산할 수 없습니다.\n\n" + result.reason + "\n\n예: =15000*3, =(1000+500)*2");
    return false;
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

  // useMemo로 참조를 안정화한다 — 매 렌더마다 새 배열이면 이 값을 deps로 쓰는 수식 바 effect가 매 렌더 실행돼 렌더 루프에 빠진다.
  const matrixVendors = useMemo(() => (reportVendor === "전체" ? reportVendors : [reportVendor]), [reportVendor, reportVendors]);
  const vendorCategoryOf = (vendor: string): OrderCategory => {
    return ORDER_CATEGORIES.find((category) => (vendorsByCategory[category] || []).includes(vendor))
      || orders.find((order) => order.vendorName === vendor)?.category
      || "식자재";
  };
  /**
   * 지금 화면에서 이 열이 실제로 가리키는 대분류.
   *
   * 대분류를 하나 고른 화면에서는 그 대분류가 곧 이 열의 정체다 — 표에 올라온 거래처와 금액이
   * 모두 그 대분류의 것이기 때문이다(reportVendors·cellAmount가 그렇게 거른다).
   * vendorCategoryOf를 그대로 쓰면 안 된다: 그건 이름만 보고 "첫 번째로 그 이름이 있는 대분류"를 준다.
   * 같은 이름이 다른 대분류에도 있으면, 주류 화면을 보고 있는데 식자재라고 답한다 —
   * 머리글 색도 틀리고, 이름 수정이 엉뚱한 대분류의 거래처와 발주를 고친다.
   * (칸에 금액을 적을 때 쓰는 resolveOrderCategory도 같은 규칙으로 reportCategory를 먼저 본다.)
   */
  const columnCategoryOf = (vendor: string): OrderCategory =>
    reportCategory === ALL_ORDER_CATEGORIES ? vendorCategoryOf(vendor) : reportCategory;
  const categoryHeaderGroups = matrixVendors.reduce<Array<{ category: OrderCategory; span: number }>>((groups, vendor) => {
    const category = columnCategoryOf(vendor);
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
  // useMemo로 참조 안정화(위 matrixVendors와 같은 이유 — 렌더 루프 방지).
  const matrixDays = useMemo(() => monthDays(reportMonth), [reportMonth]);

  // 수식이 걸린 칸("orderDate|vendorName") 집합. 셀마다 cellFormula(=orders 전체 스캔)를 부르면
  // 셀 수 × 발주건수라 이동 때마다 느려진다 → 렌더당 한 번만 만들어 셀은 O(1)로 조회한다.
  const cellFormulaKeys = useMemo(() => {
    const targetCategories = reportCategory === ALL_ORDER_CATEGORIES ? ORDER_CATEGORIES : [reportCategory];
    const set = new Set<string>();
    orders.forEach((o) => {
      if (o.formula && targetCategories.includes(o.category)) set.add(o.orderDate + "|" + o.vendorName);
    });
    return set;
  }, [orders, reportCategory]);
  const { cellProps, activeCell, isActive, focusCell } = useSheetKeyboardNav({
    rowCount: matrixDays.length,
    colCount: matrixVendors.length
  });

  // 활성 칸이 수식 칸이면 그 위에 수식 바를 띄운다(칸엔 결과 숫자만). 바에서 편집 중(barFocused)에는
  // activeCell이 잠시 null이 돼도 바를 닫지 않는다. 위치는 활성 칸 DOM에서 잰다.
  useEffect(() => {
    if (barFocused) return;
    if (!activeCell) { setFormulaBar(null); return; }
    // matrixDays[row]는 "일"(예: "01")일 뿐이다. 실제 dateKey는 렌더와 똑같이 reportMonth + "-" + day 로 만들어야
    // cellFormula가 그 칸의 발주 건(orderDate="2026-07-01")을 찾는다. (이걸 빼먹어 바가 안 떴다.)
    const day = matrixDays[activeCell.row];
    const dateKey = day ? reportMonth + "-" + day : "";
    const vendor = matrixVendors[activeCell.col];
    const formula = dateKey && vendor ? cellFormula(dateKey, vendor) : "";
    const el = activeCellElRef.current;
    if (!formula || !el) { setFormulaBar(null); return; }
    const rect = el.getBoundingClientRect();
    const spillsAbove = rect.top - FORMULA_BAR_HEIGHT - 6 < 8;
    const next = {
      dateKey,
      vendor,
      row: activeCell.row,
      col: activeCell.col,
      top: spillsAbove ? rect.bottom + 6 : rect.top - FORMULA_BAR_HEIGHT - 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - FORMULA_BAR_WIDTH - 8))
    };
    // 값이 그대로면 같은 참조를 돌려줘 React가 재렌더를 건너뛰게 한다(렌더 루프 이중 방지).
    setFormulaBar((prev) =>
      prev && prev.dateKey === next.dateKey && prev.vendor === next.vendor
        && prev.row === next.row && prev.col === next.col
        && prev.top === next.top && prev.left === next.left
        ? prev : next
    );
    setFormulaBarDraft((prev) => (prev === formula ? prev : formula));
  }, [activeCell, barFocused, orders, matrixDays, matrixVendors, reportMonth]);

  // 표는 안쪽 스크롤 상자에 있다 — 스크롤·리사이즈되면 바가 칸에서 떨어지므로 활성 칸을 다시 재서 따라붙인다.
  // 스크롤 폭주(포커스 이동 시 자동 스크롤 등)에 매번 reflow+재렌더하면 셀 이동이 버벅인다 → rAF로 한 프레임에 한 번만,
  // 위치가 실제로 바뀔 때만 갱신한다. 리스너는 passive로 스크롤 성능을 지킨다.
  useEffect(() => {
    if (!formulaBar) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = activeCellElRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const spillsAbove = rect.top - FORMULA_BAR_HEIGHT - 6 < 8;
      const top = spillsAbove ? rect.bottom + 6 : rect.top - FORMULA_BAR_HEIGHT - 6;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - FORMULA_BAR_WIDTH - 8));
      setFormulaBar((prev) => (prev && (prev.top !== top || prev.left !== left) ? { ...prev, top, left } : prev));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, [formulaBar?.dateKey, formulaBar?.vendor]);

  /** 수식 바의 값을 계산해 칸에 반영하고, 이어서 갈 칸으로 포커스를 돌린다(then이 없으면 원래 칸). 계산 실패면 바에 머문다. */
  const applyFormulaBar = (then?: () => void) => {
    if (!formulaBar) return;
    const { dateKey, vendor, row, col } = formulaBar;
    const draft = formulaBarDraft.trim();
    const stored = (cellFormula(dateKey, vendor) || "").trim();
    if (draft === stored) {
      // 안 바꿨으면 다시 저장하지 않는다(무의미한 재저장·크로스디바이스 부하 방지).
    } else if (draft === "" || draft === "=") {
      updateOrderDraft(dateKey, vendor, ""); // 비우고 적용 = 값 삭제(메모 있으면 확인창)
    } else {
      const expr = draft.startsWith("=") ? draft : "=" + draft;
      if (!commitOrderFormula(dateKey, vendor, expr, true)) return; // 실패 → alert 뒤 바 유지
    }
    // setBarFocused(false)는 여기서 하지 않는다 — 포커스가 칸으로 옮겨가며 바 input의 onBlur가 꺼준다.
    // (여기서 미리 끄면 effect가 잠깐 바를 닫았다 다시 여는 깜빡임이 생긴다.)
    setTimeout(() => (then ? then() : focusCell(row, col)), 0);
  };

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
              {/* 불러오는 동안 칸이 잠긴다. 이유를 안 알려주면 고장으로 보인다.
                  저장이 클라우드에 못 올라갔으면 초록 "저장됨"으로 안심시키면 안 된다 — 빨갛게 알린다. */}
              {!loaded ? (
                <div className="flex h-8 items-center rounded-lg bg-amber-50 px-2.5 text-[11px] font-black text-amber-700">불러오는 중…</div>
              ) : saveStatus === "error" ? (
                <div className="flex h-8 items-center rounded-lg bg-rose-50 px-2.5 text-[11px] font-black text-rose-700 whitespace-nowrap" title="입력값이 아직 클라우드에 저장되지 않았습니다. 인터넷 연결을 확인해 주세요. 연결이 돌아오면 자동으로 다시 저장을 시도합니다.">동기화 실패 · 재시도 중</div>
              ) : saveStatus === "saving" ? (
                <div className="flex h-8 items-center rounded-lg bg-amber-50 px-2.5 text-[11px] font-black text-amber-700">저장 중…</div>
              ) : (
                <div className="flex h-8 items-center rounded-lg bg-emerald-50 px-2.5 text-[11px] font-black text-emerald-700">자동저장됨</div>
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
                  const category = columnCategoryOf(vendor);
                  // 분류별 색은 그대로 두고, 지금 편집 중인 열만 안쪽 테두리로 짚어준다.
                  const columnActive = activeCell?.col === colIndex;
                  const renaming = vendorRename?.original === vendor;
                  return (
                    <th
                      key={vendor}
                      className={`group relative p-1.5 min-w-[78px] text-center border-r border-b ${getOrderCategoryHeaderClass(category)} ${
                        columnActive ? "ring-2 ring-inset ring-[#2E6DB4]" : ""
                      }`}
                    >
                      {renaming ? (
                        <input
                          autoFocus
                          value={vendorRename.value}
                          onChange={(e) => setVendorRename({ original: vendor, category, value: e.target.value })}
                          // 다른 곳을 눌러도 친 이름은 저장한다 — 애써 고친 값을 말없이 버리지 않는다.
                          onBlur={() => commitVendorRename("blur")}
                          onKeyDown={(e) => {
                            // 한글은 조합 중에도 Enter가 들어온다 — 조합이 끝나기 전에 저장하면 글자가 잘린다.
                            if (e.nativeEvent.isComposing) return;
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitVendorRename("enter");
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setVendorRename(null);
                            }
                          }}
                          maxLength={30}
                          aria-label={vendor + " 거래처명 수정"}
                          className="h-6 w-full min-w-0 rounded border border-[#2E6DB4] bg-white px-1 text-center text-[11px] font-black text-gray-800 focus:outline-none"
                        />
                      ) : (
                        <>
                          {/* 더블클릭으로도 열린다 — 엑셀에서 머리글을 고치던 손버릇 그대로. */}
                          <span
                            className="block pr-3"
                            onDoubleClick={() => { if (loaded) setVendorRename({ original: vendor, category, value: vendor }); }}
                            title={vendor + " — 더블클릭하거나 연필을 눌러 이름을 고칠 수 있습니다. (칸에서 F2)"}
                          >
                            {vendor}
                          </span>
                          {/* 늘 떠 있으면 좁은 머리글에서 이름보다 먼저 눈에 띈다 — 마우스를 올렸을 때만 보인다.
                              tabIndex=-1: 이 표의 Tab은 칸 사이 이동에 쓴다(useSheetKeyboardNav가 DOM 순서에 맡긴다).
                              머리글 버튼을 순서에 넣으면 거래처 수만큼 Tab을 눌러야 첫 칸에 닿는다.
                              아래 메모 버튼도 같은 이유로 순서에서 빼 두었다 — 이름 고치기는 더블클릭으로 연다. */}
                          <button
                            type="button"
                            tabIndex={-1}
                            disabled={!loaded}
                            onClick={() => setVendorRename({ original: vendor, category, value: vendor })}
                            aria-label={vendor + " 거래처명 수정"}
                            className="absolute right-0.5 top-0.5 rounded p-0.5 text-current opacity-0 transition hover:bg-white/60 group-hover:opacity-100 disabled:cursor-not-allowed"
                          >
                            <Pencil className="h-2.5 w-2.5" />
                          </button>
                        </>
                      )}
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
                      const typingFormula = isFormulaInput(draftValue); // "=" 로 시작 → 지금 셀에서 수식을 치는 중
                      const cellActive = isActive(rowIndex, colIndex);
                      // 대분류가 겹쳐 합계로 보이는 칸 — 낱개처럼 고칠 수 없으므로 잠근다(단, 메모는 전부 보여준다).
                      const aggregate = isAggregateCell(dateKey, vendor);
                      const memo = cellMemoDisplay(dateKey, vendor);
                      const cellHasFormula = cellFormulaKeys.has(dateKey + "|" + vendor); // 이 칸이 수식으로 저장돼 있나(O(1) 조회)
                      // 아래쪽 행은 말풍선이 표 밖으로 잘리므로 위로 뒤집는다.
                      const memoFlipUp = rowIndex >= matrixDays.length - 6;
                      // 한 번만 만든다 — F2를 가로채려면 훅이 준 onKeyDown을 다시 불러야 하는데,
                      // 핸들러 안에서 cellProps를 또 부르면 키를 칠 때마다 ref 콜백까지 새로 만들어진다.
                      const sheetCell = cellProps(rowIndex, colIndex);
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
                            {...sheetCell}
                            // 수식 편집 중엔 친 글자("=15000*3")를 그대로 보이고, 아니면 지금처럼 콤마 숫자로 보인다.
                            value={typingFormula ? (draftValue as string) : (draftValue !== undefined ? formatWithCommas(draftValue) : (value ? formatWithCommas(value) : ""))}
                            onChange={(e) => {
                              const raw = e.target.value;
                              formulaJustCommitted.current = null; // 새로 입력을 시작하면 직전 Enter 커밋 표시를 지운다(stale skip 방지)
                              if (isFormulaInput(raw)) {
                                // "=" 로 시작 = 수식 편집 중 — 숫자만 남기거나 저장하지 않는다. 친 그대로 두고 Enter/blur 때 계산한다.
                                setOrderDraftCells((prev) => ({ ...prev, [draftKey]: raw }));
                              } else {
                                updateOrderDraft(dateKey, vendor, raw); // 기존 동작 그대로: 숫자만 남기고 즉시 자동저장
                              }
                            }}
                            // F2 = 이 열의 거래처명 고치기. 머리글의 연필은 Tab 순서에서 빼 두었으므로(칸 이동이 우선)
                            // 키보드만 쓰는 사람에게는 이 키가 유일한 입구다. 칸은 늘 편집 상태라 F2는 비어 있다.
                            // 조합키(Ctrl/Alt/Cmd+F2)는 브라우저·OS 단축키다 — 가로채지 않고 그대로 흘려보낸다.
                            onKeyDown={(e) => {
                              if (e.key === "F2" && loaded && !e.altKey && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                setVendorRename({ original: vendor, category: columnCategoryOf(vendor), value: vendor });
                                return;
                              }
                              // 수식 모드에서 Enter: 계산해 결과를 넣고, 성공하면 평소 Enter처럼 아래 칸으로 내려간다.
                              // (한글 조합 중 Enter는 글자 확정이므로 건드리지 않는다 — sheetCell도 같은 규칙)
                              if (e.key === "Enter" && !e.nativeEvent.isComposing && isFormulaInput(e.currentTarget.value)) {
                                const raw = e.currentTarget.value;
                                const stored = cellFormula(dateKey, vendor);
                                if (stored && raw.trim() === stored.trim()) {
                                  // 저장된 수식을 열어보기만 하고 그대로 Enter — 다시 계산·저장하지 않고 숫자 표시로 되돌린 뒤 평소처럼 아래로.
                                  setOrderDraftCells((prev) => { const next = { ...prev }; delete next[draftKey]; return next; });
                                } else if (!commitOrderFormula(dateKey, vendor, raw, true)) {
                                  e.preventDefault(); // 계산 실패 → 이동을 막고 그 자리서 고치게 둔다
                                  return;
                                } else {
                                  formulaJustCommitted.current = draftKey; // 뒤이어 터질 blur가 같은 칸을 또 계산하지 않게
                                }
                              }
                              // 수식 칸에서 ↑ → 위 수식 바로 들어가 편집한다(칸엔 결과 숫자만 보이므로).
                              // setBarFocused를 먼저 켜서, 곧 터질 셀 blur가 바를 닫지 않게 한다.
                              if (e.key === "ArrowUp" && !e.nativeEvent.isComposing && cellHasFormula && !isFormulaInput(e.currentTarget.value) && formulaBarInputRef.current) {
                                e.preventDefault();
                                setBarFocused(true);
                                formulaBarInputRef.current.focus();
                                formulaBarInputRef.current.select();
                                return;
                              }
                              sheetCell.onKeyDown(e);
                            }}
                            // 다른 칸으로 옮길 때 수식이 남아 있으면 계산해 넣는다. 계산 못 하는 수식은 원래 값으로 되돌려
                            // 잘못된 "=..." 글자가 칸에 남지 않게 한다(Enter로 이미 계산한 직후엔 건너뛴다).
                            onBlur={(e) => {
                              const raw = e.currentTarget.value;
                              if (formulaJustCommitted.current === draftKey) {
                                formulaJustCommitted.current = null;
                              } else if (isFormulaInput(raw)) {
                                const stored = cellFormula(dateKey, vendor);
                                if (stored && raw.trim() === stored.trim()) {
                                  // 저장된 수식을 열어보기만 하고 다른 칸으로 나간다 — 다시 저장하지 않고 숫자 표시로 되돌린다.
                                  setOrderDraftCells((prev) => { const next = { ...prev }; delete next[draftKey]; return next; });
                                } else if (!commitOrderFormula(dateKey, vendor, raw, false)) {
                                  setOrderDraftCells((prev) => ({ ...prev, [draftKey]: String(cellAmount(dateKey, vendor) || "") }));
                                }
                              }
                              sheetCell.onBlur();
                            }}
                            // 칸을 고르면 그 DOM을 기억해 둔다(위 effect가 수식 칸일 때 이 위치 위에 수식 바를 띄운다).
                            // 칸엔 결과 숫자만 보이고, 수식은 바에서 본다·고친다(추천안).
                            onFocus={(e) => {
                              activeCellElRef.current = e.currentTarget;
                              sheetCell.onFocus();
                            }}
                            disabled={aggregate || !loaded}
                            title={aggregate ? AGGREGATE_CELL_HINT : (cellHasFormula ? "수식으로 입력된 칸 — 고르면 수식이 보여요. 지우려면 Delete." : undefined)}
                            aria-label={`${Number(day)}일 ${vendor} 발주금액${aggregate ? " (합계 · 잠김)" : ""}${cellHasFormula ? " (수식 입력됨)" : ""}${memo ? " (메모: " + memo + ")" : ""}`}
                            inputMode="numeric"
                            // 수식 모드에선 여러 항목을 더할 수 있게 넉넉히(파서 상한 120과 맞춤). 숫자만일 땐 지금처럼 9(9,999,999+콤마).
                            maxLength={typingFormula ? 120 : 9}
                            // 왼쪽에 아이콘 자리를 상시로 비워두면 안 된다 — 최대 금액(1,234,567 ≈ 65px)이 잘린다.
                            // 아이콘은 마우스를 올렸을 때만 뜨고, 숫자는 오른쪽 정렬이라 짧은 금액에선 애초에 겹치지 않는다.
                            // 수식 편집 중엔 왼쪽 정렬(수식은 왼→오로 읽으므로 앞부분이 보이게)하되, 왼쪽 패딩(pl-6)으로 메모 버튼 자리를 비워 겹침을 막는다.
                            // 수식 값·편집 중은 파란색으로 표시(겹치는 배지 없이).
                            className={`w-full h-8 bg-transparent border-0 rounded-none font-mono font-black focus:outline-none ${typingFormula ? "text-left pl-6 pr-1.5" : "text-right px-1.5"} ${
                              aggregate ? "text-gray-400 italic cursor-not-allowed" : ((cellHasFormula || typingFormula) ? "text-[#2E6DB4]" : "")
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

      {/* 수식 바 — 활성 수식 칸 바로 위에 떠서 수식을 넓게 보여준다. 칸에서 ↑로 들어와 편집, ↓/Enter로 적용·복귀, Esc로 취소. */}
      {formulaBar ? (
        <div
          className="fixed z-50 rounded-xl border border-[#2E6DB4] bg-white px-2.5 py-1.5 shadow-2xl"
          style={{ top: formulaBar.top, left: formulaBar.left, width: FORMULA_BAR_WIDTH }}
          role="group"
          aria-label={`${Number(formulaBar.dateKey.slice(-2))}일 ${formulaBar.vendor} 수식`}
        >
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-[10px] font-black italic text-[#2E6DB4]">fx</span>
            <input
              ref={formulaBarInputRef}
              value={formulaBarDraft}
              onChange={(e) => setFormulaBarDraft(e.target.value)}
              onFocus={() => setBarFocused(true)}
              onBlur={() => setBarFocused(false)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Escape") {
                  e.preventDefault();
                  setFormulaBarDraft(cellFormula(formulaBar.dateKey, formulaBar.vendor)); // 원래 수식으로 되돌림
                  focusCell(formulaBar.row, formulaBar.col); // 칸으로 복귀(바 onBlur가 barFocused를 꺼준다)
                } else if (e.key === "Enter" || e.key === "ArrowDown") {
                  e.preventDefault();
                  applyFormulaBar(); // 계산 반영 + 그 칸으로 복귀
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  applyFormulaBar(() => focusCell(formulaBar.row - 1, formulaBar.col)); // 적용 후 위 행으로
                }
              }}
              placeholder="예: =12000+3400+8000-500"
              spellCheck={false}
              className="w-full bg-transparent font-mono text-sm font-bold text-[var(--branch-black)] focus:outline-none"
            />
          </div>
          <div className="pl-5 pt-0.5 text-[11px] font-black">
            {(() => {
              const draft = formulaBarDraft.trim();
              if (draft === "" || draft === "=") {
                return <span className="text-rose-500">비우고 적용하면 값이 지워집니다{barFocused ? " (↓/Enter)" : ""}</span>;
              }
              const expr = draft.startsWith("=") ? draft : "=" + draft;
              const preview = evaluateOrderFormula(expr);
              if (!preview.ok) return <span className="text-rose-500">{preview.reason}</span>;
              return (
                <span className="text-[#2E6DB4]">
                  = {formatNumber(preview.value ?? 0)}원
                  <span className="ml-1.5 font-bold text-gray-400">{barFocused ? "· ↓/Enter 적용 · Esc 취소" : "· ↑ 눌러 편집"}</span>
                </span>
              );
            })()}
          </div>
        </div>
      ) : null}

    </div>
  );
}
