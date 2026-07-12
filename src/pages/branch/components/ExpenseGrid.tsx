// src/pages/branch/components/ExpenseGrid.tsx
// 지출 내역(현금/카드) 입력을 엑셀 시트처럼 다루는 그리드.
// - PC(xl 이상): 격자 테두리 + 행번호. Tab/Enter/화살표로 칸 이동, 현재 셀을 강조 표시.
// - 그 이하 화면: 기존 카드형 입력 유지(좁은 폭에서 시트는 오히려 불편하므로).
import { useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import type { ExpenseRow } from "../types";
import { formatNumber } from "../../../utils/formatNumber";
import { cleanNumeric, formatWithCommas } from "../helpers/formatters";
import {
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
const LAST_COL = COL_DETAIL;
const COLUMN_LABELS = ["지출분류", "사용처", "금액", "지출상세내용"];

/** 행번호 | 지출분류 | 사용처 | 금액 | 지출상세내용 | 삭제 */
const GRID_COLS = "grid grid-cols-[1.75rem_5.5rem_4.75rem_6rem_minmax(0,1fr)_1.75rem]";

type Variant = "cash" | "card";
type CellPos = { row: number; col: number };

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
  { dot: string; sumText: string; sumBg: string; cellOutline: string; headHighlight: string }
> = {
  cash: {
    dot: "bg-amber-500",
    sumText: "text-amber-600",
    sumBg: "bg-amber-50",
    cellOutline: "outline-2 -outline-offset-2 outline-amber-500",
    headHighlight: "bg-amber-100 text-amber-800"
  },
  card: {
    dot: "bg-blue-500",
    sumText: "text-blue-600",
    sumBg: "bg-blue-50",
    cellOutline: "outline-2 -outline-offset-2 outline-blue-600",
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

  /** 지금 편집 중인 셀. 셀·행번호·머리글을 함께 강조해 위치를 눈으로 확인할 수 있게 한다. */
  const [activeCell, setActiveCell] = useState<CellPos | null>(null);

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

  // 셀 좌표 -> DOM 엘리먼트. 키보드 이동은 전적으로 이 레지스트리를 통한다.
  const cellRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const registerCell = (rowIndex: number, col: number) => (el: HTMLElement | null) => {
    const key = `${rowIndex}-${col}`;
    if (el) cellRefs.current.set(key, el);
    else cellRefs.current.delete(key);
  };

  /** 행이 새로 붙은 뒤에야 포커스를 줄 수 있으므로, 다음 렌더까지 목표 좌표를 들고 있는다. */
  const pendingFocus = useRef<CellPos | null>(null);

  const focusEl = (el: HTMLElement | null | undefined) => {
    if (!el) return false;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
    return true;
  };

  /** 위/아래 행의 같은 열로. 그 칸이 비활성이면 옆 칸으로 흘려보낸다. */
  const focusVertical = (rowIndex: number, col: number) => {
    if (rowIndex < 0 || rowIndex >= rows.length) return false;
    for (const candidate of [col, col + 1, col - 1, COL_CLASSIFICATION]) {
      if (candidate < 0 || candidate > LAST_COL) continue;
      if (focusEl(cellRefs.current.get(`${rowIndex}-${candidate}`))) return true;
    }
    return false;
  };

  /** 같은 행에서 좌/우로. 행 끝을 넘어가면 이웃 행으로 넘긴다(Tab과 같은 흐름). */
  const focusHorizontal = (rowIndex: number, col: number, delta: 1 | -1) => {
    let next = col + delta;
    while (next >= 0 && next <= LAST_COL) {
      if (focusEl(cellRefs.current.get(`${rowIndex}-${next}`))) return true;
      next += delta;
    }
    if (delta === 1) return focusVertical(rowIndex + 1, COL_CLASSIFICATION);
    return focusVertical(rowIndex - 1, LAST_COL);
  };

  const appendRow = (focusCol?: number) => {
    let appended = false;
    onRowsChange((prev) => {
      if (prev.length >= MAX_EXPENSE_ROWS) return prev;
      appended = true;
      if (focusCol !== undefined) pendingFocus.current = { row: prev.length, col: focusCol };
      return [...prev, createEmptyExpenseRow()];
    });
    return appended;
  };

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    focusVertical(target.row, target.col);
  }, [rows.length]);

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

  /**
   * 시트 키 조작. 네 칸 모두 규칙이 같다.
   * - ↑ ↓          : 위/아래 행 (드롭다운 칸에서도 옵션 변경이 아니라 행 이동이다)
   *                   마지막 행에서 ↓를 누르면 새 행이 생기며 그리로 내려간다.
   * - ← →          : 왼/오른쪽 칸. 글자 입력 칸에서는 커서가 끝에 닿았을 때만 넘어간다.
   * - Enter        : 아래 행 (Shift+Enter는 위 행)
   * - Alt+↓        : 드롭다운 목록 펼치기 (브라우저 기본 동작에 맡긴다)
   * - Tab          : 가로채지 않는다. DOM 순서가 곧 셀 순서라 브라우저 기본 동작으로 충분하다.
   */
  const handleCellKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    rowIndex: number,
    col: number
  ) => {
    // Alt+↓ / Alt+↑ 는 드롭다운을 펼치고 접는 기본 동작이므로 건드리지 않는다.
    if (event.altKey) return;

    const isSelect = col === COL_CLASSIFICATION || col === COL_USAGE;
    const moveDown = () => {
      if (rowIndex + 1 < rows.length) focusVertical(rowIndex + 1, col);
      else appendRow(col);
    };

    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) focusVertical(rowIndex - 1, col);
      else moveDown();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (event.key === "ArrowDown") moveDown();
      else focusVertical(rowIndex - 1, col);
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const delta = event.key === "ArrowRight" ? 1 : -1;
      if (isSelect) {
        event.preventDefault();
        focusHorizontal(rowIndex, col, delta);
        return;
      }
      const input = event.currentTarget as HTMLInputElement;
      const { selectionStart, selectionEnd, value } = input;
      if (selectionStart === null || selectionEnd === null || selectionStart !== selectionEnd) return;
      const atStart = selectionStart === 0;
      const atEnd = selectionStart === value.length;
      if ((delta === -1 && atStart) || (delta === 1 && atEnd)) {
        event.preventDefault();
        focusHorizontal(rowIndex, col, delta);
      }
    }
  };

  /** 셀 하나가 포커스를 잡거나 잃을 때 현재 위치를 갱신한다. */
  const cellFocusProps = (rowIndex: number, col: number) => ({
    onFocus: () => setActiveCell({ row: rowIndex, col }),
    onBlur: () => setActiveCell((current) => (current?.row === rowIndex && current?.col === col ? null : current))
  });

  const isActive = (rowIndex: number, col: number) => activeCell?.row === rowIndex && activeCell?.col === col;

  // 시트의 컬럼명은 화면상의 글자일 뿐이라 보조기술이 읽지 못한다. 칸마다 "3번 행 금액"처럼 이름을 달아준다.
  const cellLabel = (rowIndex: number, col: number) => `${rowIndex + 1}번 행 ${COLUMN_LABELS[col]}`;

  // 엑셀 셀: 모서리 없이 격자선으로만 구분한다. 강조는 감싸는 칸(div)의 outline이 담당한다.
  const cellBase = "w-full h-8 px-2 text-xs bg-transparent border-0 rounded-none focus:outline-none";
  const cellWrap = (rowIndex: number, col: number) =>
    [
      "border-r border-b border-gray-300 relative min-w-0",
      errorRows.has(rowIndex) ? "bg-rose-50" : "",
      isActive(rowIndex, col) ? `outline ${style.cellOutline} z-10 bg-white` : ""
    ].join(" ");

  return (
    <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
      <div className="flex items-center justify-between" data-guide={guideKey}>
        <h3 className="text-sm font-black text-gray-800 flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${style.dot}`} /> {title}
        </h3>
        <span className={`text-xs font-extrabold ${style.sumText} ${style.sumBg} px-2.5 py-1 rounded-lg`}>
          합계: {formatNumber(sum)} 원
        </span>
      </div>

      {/* ── PC: 엑셀형 시트 ─────────────────────────────────── */}
      <div className="hidden xl:block">
        <div className="border-t border-l border-gray-300 rounded-md overflow-hidden">
          {/* 머리글 — 지금 편집 중인 열을 함께 강조한다 */}
          <div className={`${GRID_COLS} bg-gray-100`}>
            <span className="border-r border-b border-gray-300" />
            {COLUMN_LABELS.map((label, col) => (
              <span
                key={label}
                className={`border-r border-b border-gray-300 px-2 py-1.5 text-[11px] font-bold text-center truncate transition-colors ${
                  activeCell?.col === col ? style.headHighlight : "text-gray-600"
                }`}
              >
                {label}
              </span>
            ))}
            <span className="border-r border-b border-gray-300" />
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
                    className={`border-r border-b border-gray-300 flex items-center justify-center text-[10px] font-mono transition-colors ${
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
                      ref={registerCell(rowIndex, COL_CLASSIFICATION)}
                      aria-label={cellLabel(rowIndex, COL_CLASSIFICATION)}
                      value={row.classification}
                      onChange={(e) => updateCell(rowIndex, "classification", e.target.value)}
                      onKeyDown={(e) => handleCellKeyDown(e, rowIndex, COL_CLASSIFICATION)}
                      {...cellFocusProps(rowIndex, COL_CLASSIFICATION)}
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
                      className="border-r border-b border-gray-300 bg-gray-100 flex items-center justify-center"
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
                        ref={registerCell(rowIndex, COL_USAGE)}
                        aria-label={cellLabel(rowIndex, COL_USAGE)}
                        value={row.usage}
                        onChange={(e) => updateCell(rowIndex, "usage", e.target.value)}
                        onKeyDown={(e) => handleCellKeyDown(e, rowIndex, COL_USAGE)}
                        {...cellFocusProps(rowIndex, COL_USAGE)}
                        className={`${cellBase} appearance-none pr-5 font-semibold cursor-pointer`}
                      >
                        {EXPENSE_USAGES.map((item) => (
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
                    <input
                      ref={registerCell(rowIndex, COL_AMOUNT)}
                      id={`daily-${variant}-expense-amount-${rowIndex}`}
                      aria-label={cellLabel(rowIndex, COL_AMOUNT)}
                      type="text"
                      inputMode="numeric"
                      value={formatWithCommas(row.amount)}
                      onChange={(e) => handleAmountInput(rowIndex, e.target.value)}
                      onCompositionEnd={(e) => handleAmountInput(rowIndex, e.currentTarget.value)}
                      onKeyDown={(e) => handleCellKeyDown(e, rowIndex, COL_AMOUNT)}
                      {...cellFocusProps(rowIndex, COL_AMOUNT)}
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
                      ref={registerCell(rowIndex, COL_DETAIL)}
                      id={`daily-${variant}-expense-detail-${rowIndex}`}
                      aria-label={cellLabel(rowIndex, COL_DETAIL)}
                      type="text"
                      value={row.detail}
                      onChange={(e) => updateCell(rowIndex, "detail", e.target.value)}
                      onKeyDown={(e) => handleCellKeyDown(e, rowIndex, COL_DETAIL)}
                      {...cellFocusProps(rowIndex, COL_DETAIL)}
                      className={cellBase}
                    />
                  </div>

                  {/* 행 삭제 */}
                  <div className="border-r border-b border-gray-300 flex items-center justify-center">
                    {!isExpenseRowBlank(row) && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => removeRow(rowIndex)}
                        title="행 삭제"
                        className="text-gray-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
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
            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 border border-dashed border-gray-300 rounded-lg text-[11px] font-bold text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
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
              {!isExpenseRowBlank(row) && (
                <button
                  type="button"
                  onClick={() => removeRow(rowIndex)}
                  className="absolute top-2 right-2 text-gray-400 hover:text-rose-500 p-1 rounded-lg transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}

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
                      {EXPENSE_USAGES.map((item) => (
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
