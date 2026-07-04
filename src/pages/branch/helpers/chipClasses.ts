// src/pages/branch/helpers/chipClasses.ts
// 월마감 지출 항목 칩(chip)에 붙는 CSS 클래스 결정 헬퍼.
// 동작 변경 없음 — 원본 코드를 그대로 이동함.

export const getMonthlyExpenseCategoryChipClass = (value: string) => {
  const text = String(value || "");
  if (text.includes("식재료")) return "monthly-chip-vanilla";
  if (text.includes("음료")) return "monthly-chip-alice";
  return "monthly-chip-honey";
};

export const getMonthlyExpenseUsageChipClass = (value: string) => {
  const text = String(value || "");
  if (text.includes("쿠팡")) return "monthly-chip-vanilla";
  if (text.includes("네이버")) return "monthly-chip-honey";
  return "monthly-chip-alice";
};
