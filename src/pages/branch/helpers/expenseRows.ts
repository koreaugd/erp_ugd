// src/pages/branch/helpers/expenseRows.ts
// 지출 내역(현금/카드) 행의 기본값·빈행 판정·행 수 보정을 한곳에서 관리한다.
import type { ExpenseRow } from "../types";

export const EXPENSE_CLASSIFICATIONS: ExpenseRow["classification"][] = [
  "식재료",
  "소모품등 기타",
  "부식비",
  "음료",
  "현금입금"
];

export const EXPENSE_USAGES: ExpenseRow["usage"][] = [
  "쿠팡",
  "네이버",
  "인근매장",
  "그외기타",
  "현금입금"
];

/** 현금지출 사용처 — 쿠팡·네이버(온라인 결제)는 카드에서만 쓰므로 뺀다. 일일·월말 현금 화면이 공유. */
export const CASH_USAGES: ExpenseRow["usage"][] = EXPENSE_USAGES.filter(
  (usage) => usage !== "쿠팡" && usage !== "네이버"
);

/** 시트에 항상 깔아두는 빈 행 수. 마지막 행을 채우면 그 아래로 한 줄씩 늘어난다. */
export const MIN_EXPENSE_ROWS = 7;
/** 자동 증식이 폭주하지 않도록 하는 상한. */
export const MAX_EXPENSE_ROWS = 50;

// 기본 사용처는 중립값 "그외기타" — 현금지출 사용처에서 쿠팡/네이버를 빼도(현금엔 안 맞음)
// 기본값이 목록에 없어 빈 칸으로 보이는 일이 없게 한다. 카드는 필요 시 쿠팡/네이버를 직접 고른다.
export const createEmptyExpenseRow = (): ExpenseRow => ({
  classification: "식재료",
  usage: "그외기타",
  detail: "",
  amount: ""
});

/** 금액 칸이 받아들이는 최대 자릿수. 오붙여넣기로 말도 안 되는 금액이 들어가는 것을 막는다. */
export const MAX_AMOUNT_DIGITS = 12;

/** 저장 대상 행: 실제 금액(1원 이상)이 적힌 행만 지출로 취급한다. 0원 행은 지출이 아니다. */
export const isExpenseRowFilled = (row: ExpenseRow): boolean => (Number(row.amount) || 0) > 0;

/** 손을 댄 행인가. 금액이든 상세든 한 글자라도 들어갔으면 사용자가 쓰려던 행이다. */
export const isExpenseRowTouched = (row: ExpenseRow): boolean =>
  row.amount.trim() !== "" || row.detail.trim() !== "";

/** 제출을 막아야 할 사유. 없으면 null. */
export type ExpenseRowProblem = "missing-amount" | "missing-detail";

/**
 * 쓰다 만 행을 찾아낸다. 금액과 상세는 둘 다 있어야 온전한 지출 기록이다.
 * - 금액이 비었거나 0원  → 저장되지 않으므로 막는다 (상세 칸에 남은 오타 한 글자도 여기서 걸린다)
 * - 금액은 있는데 상세가 비었음 → 무슨 지출인지 알 수 없으므로 막는다
 */
export const getExpenseRowProblem = (row: ExpenseRow): ExpenseRowProblem | null => {
  if (!isExpenseRowTouched(row)) return null;
  if (!isExpenseRowFilled(row)) return "missing-amount";
  if (row.detail.trim() === "") return "missing-detail";
  return null;
};

export const isExpenseRowIncomplete = (row: ExpenseRow): boolean => getExpenseRowProblem(row) !== null;

/** 아무것도 입력되지 않은 행. */
export const isExpenseRowBlank = (row: ExpenseRow): boolean =>
  row.amount.trim() === "" && row.detail.trim() === "";

/**
 * 불러온 행 목록을 시트에 띄울 수 있는 형태로 보정한다.
 * - 배열이 아니거나 비어 있으면 빈 행으로 채운다(행이 0개가 되어 입력 자체가 막히는 것을 방지).
 * - 맨 아래에 항상 빈 행이 최소 한 줄 남도록 MIN_EXPENSE_ROWS까지 채운다.
 */
export const padExpenseRows = (rows: unknown): ExpenseRow[] => {
  const source = Array.isArray(rows) ? (rows as ExpenseRow[]) : [];
  const next = source.map((row) => ({ ...createEmptyExpenseRow(), ...row }));
  while (next.length < MIN_EXPENSE_ROWS) next.push(createEmptyExpenseRow());
  return next;
};
