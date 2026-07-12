// src/pages/branch/helpers/useSheetKeyboardNav.ts
// 표를 엑셀 시트처럼 키보드로 돌아다니게 해주는 공용 훅.
// 지출 시트(ExpenseGrid)와 매입매출 표가 함께 쓴다.
//
// 규칙
//   Enter / ↓        아래 행, 같은 열   (Shift+Enter / ↑ 는 위 행)
//   ← →              왼/오른쪽 칸. 글자 입력 칸에서는 커서가 양 끝에 닿았을 때만 넘어간다.
//                    드롭다운·체크박스는 항상 칸을 옮긴다(방향키 기본 동작을 막는다).
//   Tab              가로채지 않는다. DOM 순서가 곧 셀 순서라 브라우저 기본 동작으로 충분하다.
//   Alt/Ctrl/Cmd 조합 손대지 않는다 (Alt+↓ 로 드롭다운을 펼치는 등 기본 동작을 남겨둔다).
//
// 잠긴(disabled) 칸은 건너뛴다. 마지막 행에서 아래로 내려가려 하면 onAppendRow를 부른다.
// 새 행이 어디에 꽂히는지는 표마다 다르므로(정렬되는 표도 있다) 이 훅은 위치를 추측하지 않는다.
// 행을 추가한 쪽이 requestFocus로 갈 곳을 직접 지정한다.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

export type SheetCell = { row: number; col: number };
type SheetElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * 글자 커서(캐럿)를 가진 칸인가.
 *
 * 이런 칸에서만 좌우 방향키가 "커서가 양 끝에 닿았을 때만 옆 칸으로" 규칙을 쓴다.
 * number·date·time 같은 칸은 브라우저가 selectionStart를 항상 null로 돌려주기 때문에 경계를 알 수 없다.
 * 그대로 두면 좌우 방향키가 아무 일도 하지 않아 그 칸에 갇힌다 — 그래서 곧바로 옆 칸으로 옮긴다.
 */
const CARET_INPUT_TYPES = ["text", "search", "url", "tel", "password"];
const hasCaret = (el: SheetElement) =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && CARET_INPUT_TYPES.includes(el.type));

export function useSheetKeyboardNav({
  rowCount,
  colCount,
  onAppendRow
}: {
  rowCount: number;
  colCount: number;
  /** 마지막 행에서 ↓/Enter를 눌렀을 때. 행을 추가한 뒤 requestFocus로 커서를 보낼 책임은 호출한 쪽에 있다. */
  onAppendRow?: (col: number) => void;
}) {
  const cellRefs = useRef<Map<string, SheetElement>>(new Map());
  const pendingFocus = useRef<SheetCell | null>(null);
  const [activeCell, setActiveCell] = useState<SheetCell | null>(null);

  const registerCell = useCallback(
    (row: number, col: number) => (el: SheetElement | null) => {
      const key = `${row}-${col}`;
      if (el) cellRefs.current.set(key, el);
      else cellRefs.current.delete(key);
    },
    []
  );

  const focusElement = (el: SheetElement | undefined) => {
    if (!el || el.disabled) return false;
    el.focus();
    // 값을 통째로 잡아두면 곧바로 덮어쓸 수 있다. date·checkbox처럼 선택을 지원하지 않는 칸은 조용히 넘어간다.
    if (!(el instanceof HTMLSelectElement)) {
      try {
        el.select();
      } catch {
        /* 선택을 지원하지 않는 입력 칸 */
      }
    }
    return true;
  };

  /** 특정 행의 같은 열로. 그 칸이 잠겨 있으면 가장 가까운 옆 칸으로 흘려보낸다. */
  const focusCell = useCallback(
    (row: number, col: number) => {
      if (row < 0 || row >= rowCount) return false;
      for (let offset = 0; offset < colCount; offset++) {
        const candidates = offset === 0 ? [col] : [col + offset, col - offset];
        for (const candidate of candidates) {
          if (candidate < 0 || candidate >= colCount) continue;
          if (focusElement(cellRefs.current.get(`${row}-${candidate}`))) return true;
        }
      }
      return false;
    },
    [rowCount, colCount]
  );

  /** 같은 행에서 좌/우로. 행 끝을 넘어가면 이웃 행으로 넘긴다(Tab과 같은 흐름). */
  const focusSideways = useCallback(
    (row: number, col: number, delta: 1 | -1) => {
      let next = col + delta;
      while (next >= 0 && next < colCount) {
        if (focusElement(cellRefs.current.get(`${row}-${next}`))) return true;
        next += delta;
      }
      return delta === 1 ? focusCell(row + 1, 0) : focusCell(row - 1, colCount - 1);
    },
    [colCount, focusCell]
  );

  /** 아직 그려지지 않은 칸으로 커서를 보낸다. 다음 렌더에서 실행된다. */
  const requestFocus = useCallback((row: number, col: number) => {
    pendingFocus.current = { row, col };
  }, []);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    focusCell(target.row, target.col);
  }, [rowCount, focusCell]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<SheetElement>, row: number, col: number) => {
      // 한글을 조합하는 중에는 Enter가 "글자 확정", 방향키가 "조합 이동"이다.
      // 여기서 가로채면 '한글'을 치다 Enter를 눌렀을 때 글자가 확정되지 않고 아래 칸으로 내려가 버린다.
      // (keyCode 229는 isComposing을 지원하지 않는 브라우저의 IME 신호)
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;

      // Alt+↓(드롭다운 펼치기) 등 조합키의 기본 동작은 그대로 둔다.
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const element = event.currentTarget;

      const moveDown = () => {
        if (row + 1 < rowCount) focusCell(row + 1, col);
        else onAppendRow?.(col);
      };

      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) focusCell(row - 1, col);
        else moveDown();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (event.key === "ArrowDown") moveDown();
        else focusCell(row - 1, col);
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const delta = event.key === "ArrowRight" ? 1 : -1;

        // 드롭다운·체크박스·숫자·날짜 칸: 커서 개념이 없으므로 곧바로 옆 칸으로.
        if (!hasCaret(element)) {
          event.preventDefault();
          focusSideways(row, col, delta);
          return;
        }

        // 글자 칸: 커서가 끝에 닿았을 때만 옆 칸으로 넘어간다. 그 전에는 평범한 커서 이동.
        const input = element as HTMLInputElement;
        const { selectionStart, selectionEnd, value } = input;
        if (selectionStart === null || selectionEnd === null) {
          event.preventDefault();
          focusSideways(row, col, delta);
          return;
        }
        if (selectionStart !== selectionEnd) return;
        const atEdge = delta === -1 ? selectionStart === 0 : selectionStart === value.length;
        if (atEdge) {
          event.preventDefault();
          focusSideways(row, col, delta);
        }
      }
    },
    [rowCount, focusCell, focusSideways, onAppendRow]
  );

  /** 각 셀(input/select)에 그대로 펼쳐 넣는다. */
  const cellProps = useCallback(
    (row: number, col: number) => ({
      ref: registerCell(row, col),
      onKeyDown: (event: KeyboardEvent<SheetElement>) => handleKeyDown(event, row, col),
      onFocus: () => setActiveCell({ row, col }),
      onBlur: () => setActiveCell((current) => (current?.row === row && current?.col === col ? null : current))
    }),
    [registerCell, handleKeyDown]
  );

  const isActive = useCallback(
    (row: number, col: number) => activeCell?.row === row && activeCell?.col === col,
    [activeCell]
  );

  return { cellProps, activeCell, isActive, focusCell, requestFocus };
}
