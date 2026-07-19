// src/pages/branch/components/ExpenseGrid.tsx
// 지출 내역(현금/카드) 입력을 엑셀 시트처럼 다루는 그리드.
// - PC(xl 이상): 격자 테두리 + 행번호. Tab/Enter/화살표로 칸 이동, 현재 셀을 강조 표시.
// - 그 이하 화면: 기존 카드형 입력 유지(좁은 폭에서 시트는 오히려 불편하므로).
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import type { ExpenseRow } from "../types";
import { useSheetKeyboardNav } from "../helpers/useSheetKeyboardNav";
import { SheetKeyHint } from "../../../components/SheetKeyHint";
import { formatNumber } from "../../../utils/formatNumber";
import { cleanNumeric, formatWithCommas } from "../helpers/formatters";
import {
  CASH_USAGES,
  EXPENSE_CLASSIFICATIONS,
  EXPENSE_USAGES,
  MAX_AMOUNT_DIGITS,
  MAX_EXPENSE_ROWS,
  createEmptyExpenseRow,
  isExpenseRowBlank,
  padExpenseRows
} from "../helpers/expenseRows";

/**
 * 금액 칸에 들어온 값을 숫자만 남겨 정리한다.
 * 한글 IME 조합 중에는 제어 입력이 조합 문자를 되돌리지 못하는 경우가 있어, 조합이 끝난 뒤에도 한 번 더 통과시킨다.
 */
const toAmountValue = (raw: string) => cleanNumeric(raw).slice(0, MAX_AMOUNT_DIGITS);

/** 셀 좌표의 열 번호. 화면에 보이는 순서와 같다. */
const COL_CLASSIFICATION = 0;
const COL_USAGE = 1;
const COL_AMOUNT = 2;
const COL_DETAIL = 3;
const COLUMN_LABELS = ["지출분류", "사용처", "금액", "지출상세내용"];

/** 행번호 | 지출분류 | 사용처 | 금액 | 지출상세내용 | 삭제 */
const GRID_COLS = "grid grid-cols-[1.75rem_5.5rem_4.75rem_6rem_minmax(0,1fr)_1.75rem]";

type Variant = "cash" | "card";

interface ExpenseGridProps {
  variant: Variant;
  title: string;
  sum: number;
  rows: ExpenseRow[];
  onRowsChange: Dispatch<SetStateAction<ExpenseRow[]>>;
  /** 상세만 적히고 금액이 비어 제출을 막은 행들 (빨간 표시용). */
  errorRowIndexes?: number[];
  guideKey?: string;
}

const VARIANT_STYLE: Record<
  Variant,
  { sumText: string; sumBg: string; cellOutline: string; headHighlight: string }
> = {
  cash: {
    sumText: "text-amber-600",
    sumBg: "bg-amber-50",
    cellOutline: "outline-2 -outline-offset-2 outline-[#2E6DB4]",
    headHighlight: "bg-amber-100 text-amber-800"
  },
  card: {
    sumText: "text-blue-600",
    sumBg: "bg-blue-50",
    cellOutline: "outline-2 -outline-offset-2 outline-[#2E6DB4]",
    headHighlight: "bg-blue-100 text-blue-800"
  }
};

export function ExpenseGrid({
  variant,
  title,
  sum,
  rows,
  onRowsChange,
  errorRowIndexes = [],
  guideKey
}: ExpenseGridProps) {
  const style = VARIANT_STYLE[variant];
  const errorRows = new Set(errorRowIndexes);

  // 현금지출 사용처에서는 쿠팡·네이버를 뺀다 — 온라인 결제라 카드에서만 쓰는 항목이다.
  const usageOptions = variant === "cash" ? CASH_USAGES : EXPENSE_USAGES;
  // 저장된 값이 목록에 없으면(옛 현금 기록의 쿠팡/네이버 등) 그 값도 넣어 실제 값이 보이게 한다.
  // 안 그러면 select가 엉뚱한 항목을 보여줘 과거 기록이 잘못 분류된 것처럼 읽힌다.
  const usageOptionsFor = (current: ExpenseRow["usage"]) =>
    usageOptions.includes(current) ? usageOptions : [current, ...usageOptions];

  /**
   * 금액 칸에 숫자가 아닌 글자를 친 행. 입력이 조용히 무시되면 키보드가 고장 난 줄 알기 쉬우므로 이유를 알려준다.
   * 잠깐 떴다가 사라진다.
   */
  const [amountHintRow, setAmountHintRow] = useState<number | null>(null);
  const amountHintTimer = useRef<number | null>(null);
  const flashAmountHint = (rowIndex: number) => {
    setAmountHintRow(rowIndex);
    if (amountHintTimer.current !== null) window.clearTimeout(amountHintTimer.current);
    amountHintTimer.current = window.setTimeout(() => setAmountHintRow(null), 2000);
  };
  useEffect(
    () => () => {
      if (amountHintTimer.current !== null) window.clearTimeout(amountHintTimer.current);
    },
    []
  );

  /** 금액 칸 입력. 숫자만 남기고, 버려진 글자가 있으면 안내를 띄운다. */
  const handleAmountInput = (rowIndex: number, raw: string) => {
    const cleaned = toAmountValue(raw);
    if (raw.replace(/,/g, "") !== cleaned) flashAmountHint(rowIndex);
    updateCell(rowIndex, "amount", cleaned);
  };

  // 엑셀식 칸 이동. 매입매출 표와 같은 훅을 쓴다.
  // activeCell은 지금 편집 중인 셀 — 셀·행번호·머리글을 함께 강조해 위치를 눈으로 확인할 수 있게 한다.
  const { cellProps, activeCell, isActive, requestFocus } = useSheetKeyboardNav({
    rowCount: rows.length,
    colCount: COLUMN_LABELS.length,
    onAppendRow: (col) => appendRow(col)
  });

  /**
   * 맨 아랫줄에서 더 내려가려 할 때 / 행 추가 버튼을 눌렀을 때 빈 행을 한 줄 붙인다.
   * 커서 예약은 업데이터 밖에서 한다 — setState 업데이터는 순수해야 하고, 개발 모드에서 두 번 호출될 수 있다.
   */
  const appendRow = (focusCol?: number) => {
    if (rows.length >= MAX_EXPENSE_ROWS) return;
    if (focusCol !== undefined) requestFocus(rows.length, focusCol);
    onRowsChange((prev) => (prev.length >= MAX_EXPENSE_ROWS ? prev : [...prev, createEmptyExpenseRow()]));
  };

  const updateCell = (rowIndex: number, field: keyof ExpenseRow, value: string) => {
    onRowsChange((prev) => {
      const next = prev.map((row, i) => (i === rowIndex ? { ...row, [field]: value } : row));
      // 마지막 행에 내용이 들어오면 그 아래로 빈 행을 한 줄 깔아둔다(엑셀처럼 계속 내려가며 입력).
      const last = next[next.length - 1];
      if (last && !isExpenseRowBlank(last) && next.length < MAX_EXPENSE_ROWS) {
        next.push(createEmptyExpenseRow());
      }
      return next;
    });
  };

  const removeRow = (rowIndex: number) => {
    onRowsChange((prev) => padExpenseRows(prev.filter((_, i) => i !== rowIndex)));
  };


  // 시트의 컬럼명은 화면상의 글자일 뿐이라 보조기술이 읽지 못한다. 칸마다 "3번 행 금액"처럼 이름을 달아준다.
  const cellLabel = (rowIndex: number, col: number) => `${rowIndex + 1}번 행 ${COLUMN_LABELS[col]}`;

  // 엑셀 셀: 모서리 없이 격자선으로만 구분한다. 강조는 감싸는 칸(div)의 outline이 담당한다.
  const cellBase = "w-full h-8 px-2 text-xs bg-transparent border-0 rounded-none focus:outline-none";
  const cellWrap = (rowIndex: number, col: number) =>
    [
      "border-r border-b border-gray-200 relative min-w-0",
      errorRows.has(rowIndex) ? "bg-rose-50" : "",
      isActive(rowIndex, col) ? `outline ${style.cellOutline} z-10 bg-white` : ""
    ].join(" ");

  return (
    <div className="relative bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
      {/* 조작법은 표를 보는 순간 알아야 한다 — 작성방법 버튼을 눌러야 보이면 늦다. */}
      <SheetKeyHint />
      <div className="flex flex-wrap items-center justify-between gap-2" data-guide={guideKey}>
        <h3 className="text-sm font-black text-gray-800 w-fit">{title}</h3>
        <span className={`text-xs font-extrabold ${style.sumText} ${style.sumBg} px-2.5 py-1 rounded-lg`}>
          합계: {formatNumber(sum)} 원
        </span>
      </div>

      {/* ── PC: 엑셀형 시트 ─────────────────────────────────── */}
      <div className="hidden xl:block">
        <div className="border-t border-l border-gray-200 rounded-md overflow-hidden">
          {/* 머리글 — 지금 편집 중인 열을 함께 강조한다 */}
          <div className={`${GRID_COLS} bg-gray-100`}>
            <span className="border-r border-b border-gray-200" />
            {COLUMN_LABELS.map((label, col) => (
              <span
                key={label}
                className={`border-r border-b border-gray-200 px-2 py-1.5 text-[11px] font-bold text-center truncate transition-colors ${
                  activeCell?.col === col ? style.headHighlight : "text-gray-600"
                }`}
              >
                {label}
              </span>
            ))}
            <span className="border-r border-b border-gray-200" />
          </div>

          {/* 데이터 행 */}
          <div className="max-h-[336px] overflow-y-auto">
            {rows.map((row, rowIndex) => {
              const usageDisabled = variant === "cash" && row.classification === "현금입금";
              const rowActive = activeCell?.row === rowIndex;
              return (
                <div key={rowIndex} className={`${GRID_COLS} group`}>
                  {/* 행번호 — 지금 편집 중인 행을 함께 강조한다 */}
                  <span
                    className={`border-r border-b border-gray-200 flex items-center justify-center text-[10px] font-mono transition-colors ${
                      rowActive
                        ? `${style.headHighlight} font-bold`
                        : errorRows.has(rowIndex)
                          ? "bg-gray-50 text-rose-500 font-bold"
                          : "bg-gray-50 text-gray-400"
                    }`}
                  >
                    {rowIndex + 1}
                  </span>

                  {/* 지출분류 */}
                  <div className={cellWrap(rowIndex, COL_CLASSIFICATION)}>
                    <select
                      {...cellProps(rowIndex, COL_CLASSIFICATION)}
                      aria-label={cellLabel(rowIndex, COL_CLASSIFICATION)}
                      value={row.classification}
                      onChange={(e) => updateCell(rowIndex, "classification", e.target.value)}
                      className={`${cellBase} appearance-none pr-5 font-semibold cursor-pointer`}
                    >
                      {EXPENSE_CLASSIFICATIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3 h-3 text-gray-300 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>

                  {/* 사용처 — 현금입금이면 쓰지 않는 칸이라 잠근다 */}
                  {usageDisabled ? (
                    <div
                      className="border-r border-b border-gray-200 bg-gray-100 flex items-center justify-center"
                      title="현금입금은 사용처를 적지 않습니다"
                    >
                      <span className="text-xs text-gray-300 select-none" aria-hidden="true">
                        —
                      </span>
                      <span className="sr-only">{`${rowIndex + 1}번 행 사용처 없음 (현금입금)`}</span>
                    </div>
                  ) : (
                    <div className={cellWrap(rowIndex, COL_USAGE)}>
                      <select
                        {...cellProps(rowIndex, COL_USAGE)}
                        aria-label={cellLabel(rowIndex, COL_USAGE)}
                        value={row.usage}
                        onChange={(e) => updateCell(rowIndex, "usage", e.target.value)}
                        className={`${cellBase} appearance-none pr-5 font-semibold cursor-pointer`}
                      >
                        {usageOptionsFor(row.usage).map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-3 h-3 text-gray-300 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  )}

                  {/* 금액 */}
                  <div className={cellWrap(rowIndex, COL_AMOUNT)}>
                    {/* inputMode="numeric"를 두면 이 칸에 들어갈 때 윈도우 IME가 영문으로 전환되고
                        그 상태가 전역으로 남아, 다음 지출상세내용 칸에서 한글이 안 쳐진다.
                        데스크톱 시트는 물리 키보드라 숫자키가 IME와 무관하게 들어오므로 inputMode를 뺀다.
                        (숫자만 남기는 필터는 handleAmountInput이 그대로 담당) */}
                    <input
                      {...cellProps(rowIndex, COL_AMOUNT)}
                      id={`daily-${variant}-expense-amount-${rowIndex}`}
                      aria-label={cellLabel(rowIndex, COL_AMOUNT)}
                      type="text"
                      value={formatWithCommas(row.amount)}
                      onChange={(e) => handleAmountInput(rowIndex, e.target.value)}
                      onCompositionEnd={(e) => handleAmountInput(rowIndex, e.currentTarget.value)}
                      className={`${cellBase} text-right font-mono`}
                    />
                    {amountHintRow === rowIndex && (
                      <span
                        role="status"
                        className="absolute z-20 left-1/2 -translate-x-1/2 top-full mt-1 whitespace-nowrap px-2 py-1 rounded-md bg-zinc-800 text-white text-[10px] font-bold shadow-lg pointer-events-none"
                      >
                        숫자만 입력 가능합니다
                      </span>
                    )}
                  </div>

                  {/* 지출상세내용 */}
                  <div className={cellWrap(rowIndex, COL_DETAIL)}>
                    <input
                      {...cellProps(rowIndex, COL_DETAIL)}
                      id={`daily-${variant}-expense-detail-${rowIndex}`}
                      aria-label={cellLabel(rowIndex, COL_DETAIL)}
                      type="text"
                      value={row.detail}
                      onChange={(e) => updateCell(rowIndex, "detail", e.target.value)}
                      className={cellBase}
                    />
                  </div>

                  {/* 행 삭제 — 모든 행에서 지울 수 있다(기본 줄은 지워도 빈 줄이 다시 채워진다). */}
                  <div className="border-r border-b border-gray-200 flex items-center justify-center">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => removeRow(rowIndex)}
                      title={`${rowIndex + 1}번 행 삭제`}
                      className="text-gray-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 gap-3">
          <p className="text-[10px] text-gray-400 leading-relaxed">
            화살표·Tab·Enter로 칸을 옮깁니다. 분류·사용처 목록은 <b>Alt+↓</b> 또는 클릭으로 펼칩니다.
            <br />
            맨 아랫줄에서 <b>↓</b> 또는 <b>Enter</b>를 누르면 새 행이 생깁니다.
          </p>
          <button
            type="button"
            onClick={() => appendRow()}
            disabled={rows.length >= MAX_EXPENSE_ROWS}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 border border-dashed border-gray-200 rounded-lg text-[11px] font-bold text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            <Plus className="w-3 h-3" /> 행 추가
          </button>
        </div>
      </div>

      {/* ── 좁은 화면: 기존 카드형 입력 유지 ────────────────── */}
      <div className="xl:hidden space-y-3">
        <div className="space-y-3 max-h-[290px] overflow-y-auto pr-1">
          {rows.map((row, rowIndex) => (
            <div
              key={rowIndex}
              className={`p-3 border rounded-xl space-y-2 relative ${
                errorRows.has(rowIndex) ? "border-rose-400 bg-rose-50" : "border-gray-100 bg-gray-50"
              }`}
            >
              <button
                type="button"
                onClick={() => removeRow(rowIndex)}
                title={`${rowIndex + 1}번 행 삭제`}
                className="absolute top-2 right-2 text-gray-400 hover:text-rose-500 p-1 rounded-lg transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>

              <div className="grid grid-cols-2 gap-2 mt-1">
                <div className="flex flex-col space-y-1">
                  <span className="text-[10px] font-bold text-gray-400">지출 분류</span>
                  <select
                    value={row.classification}
                    onChange={(e) => updateCell(rowIndex, "classification", e.target.value)}
                    className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold bg-white"
                  >
                    {EXPENSE_CLASSIFICATIONS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                {!(variant === "cash" && row.classification === "현금입금") && (
                  <div className="flex flex-col space-y-1">
                    <span className="text-[10px] font-bold text-gray-400">사용처</span>
                    <select
                      value={row.usage}
                      onChange={(e) => updateCell(rowIndex, "usage", e.target.value)}
                      className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold bg-white"
                    >
                      {usageOptionsFor(row.usage).map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 relative">
                <div className="col-span-2 flex flex-col space-y-1">
                  <span className="text-[10px] font-bold text-gray-400">지출 상세 내용</span>
                  <input
                    id={`daily-${variant}-expense-detail-${rowIndex}-card`}
                    type="text"
                    placeholder="구체적 명세 기록"
                    value={row.detail}
                    onChange={(e) => updateCell(rowIndex, "detail", e.target.value)}
                    className="px-2.5 py-1 border border-gray-200 rounded-lg text-xs bg-white"
                  />
                </div>
                <div className="flex flex-col space-y-1">
                  <span className="text-[10px] font-bold text-gray-400">금액</span>
                  <input
                    id={`daily-${variant}-expense-amount-${rowIndex}-card`}
                    type="text"
                    inputMode="numeric"
                    placeholder="금액(원)"
                    value={formatWithCommas(row.amount)}
                    onChange={(e) => handleAmountInput(rowIndex, e.target.value)}
                    onCompositionEnd={(e) => handleAmountInput(rowIndex, e.currentTarget.value)}
                    className="px-2.5 py-1 border border-gray-200 rounded-lg text-xs text-right font-mono bg-white"
                  />
                </div>
                {amountHintRow === rowIndex && (
                  <span
                    role="status"
                    className="absolute z-20 right-0 -bottom-5 whitespace-nowrap px-2 py-1 rounded-md bg-zinc-800 text-white text-[10px] font-bold shadow-lg pointer-events-none"
                  >
                    숫자만 입력 가능합니다
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => appendRow()}
          disabled={rows.length >= MAX_EXPENSE_ROWS}
          className="w-full py-2 bg-gray-50 hover:bg-gray-100 border border-dashed border-gray-200 font-bold text-xs text-gray-500 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" /> 행 추가
        </button>
      </div>
    </div>
  );
}
