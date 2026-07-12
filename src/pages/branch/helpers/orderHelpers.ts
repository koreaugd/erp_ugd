// src/pages/branch/helpers/orderHelpers.ts
// 발주관리/주류재고 탭이 공유하는 상수·헬퍼. BranchConfirmPage에서 분리 — 동작 변경 없음(코드 이동만).
import type { OrderCategory } from "../types";

export const ORDER_CATEGORIES: OrderCategory[] = ["식자재", "부식비", "주류", "식음료외 기타"];
export const ORDER_DEFAULT_VENDORS: Record<OrderCategory, string[]> = {
  식자재: ["비알(식자재)", "쿠팡(식자재)", "네이버(식자재)"],
  부식비: [],
  주류: [],
  "식음료외 기타": []
};
export const LIQUOR_CATEGORIES = ["샴페인", "스파클링", "화이트", "레드", "위스키", "소주", "맥주", "대표님술", "기타"];
export const VENDOR_HINT = "줄바꿈 또는 쉼표로 여러 개를 한꺼번에 추가할 수 있습니다.";
export const ALL_ORDER_CATEGORIES = "전체";

export const getLiquorCategoryClass = (category: string) => {
  const classes: Record<string, string> = {
    샴페인: "bg-amber-50 text-amber-800 border-amber-200",
    스파클링: "bg-cyan-50 text-cyan-800 border-cyan-200",
    화이트: "bg-lime-50 text-lime-800 border-lime-200",
    레드: "bg-rose-50 text-rose-800 border-rose-200",
    위스키: "bg-orange-50 text-orange-800 border-orange-200",
    소주: "bg-blue-50 text-blue-800 border-blue-200",
    맥주: "bg-yellow-50 text-yellow-800 border-yellow-200",
    대표님술: "bg-violet-50 text-violet-800 border-violet-200",
    기타: "bg-slate-100 text-slate-700 border-slate-200"
  };
  return classes[category] || classes.기타;
};

/**
 * 대분류 색. Tailwind 색 유틸(bg-amber-100 등)을 쓰면 안 된다 —
 * 지점 디자인 CSS가 그것들을 디자인 토큰으로 싹 덮어써서(amber→바닐라, indigo·slate→alice)
 * 네 분류가 같은 색으로 뭉개지거나 색이 아예 사라진다.
 * 덮어쓰기를 타지 않는 전용 클래스를 쓰고, 실제 색은 index.css에서 토큰으로 준다.
 */
export const getOrderCategoryHeaderClass = (category: string) => {
  const classes: Record<string, string> = {
    식자재: "order-cat order-cat-food",
    부식비: "order-cat order-cat-side",
    주류: "order-cat order-cat-liquor",
    "식음료외 기타": "order-cat order-cat-etc"
  };
  return classes[category] || "order-cat order-cat-etc";
};

export const monthDays = (monthValue: string) => {
  const [year, month] = monthValue.split("-").map(Number);
  const count = new Date(year, month, 0).getDate();
  return Array.from({ length: count }, (_, index) => String(index + 1).padStart(2, "0"));
};
