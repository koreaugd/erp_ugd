// src/pages/admin/ReportGrid.tsx
// 통합보고서 격자 — 엑셀 시트 한 장을 **칸 위치·서식 그대로** 그리고, 아무 칸이나 눌러 고친다.
//
// [왜 별도 파일인가] 한 시트가 640행 × 27열(약 17,000칸)이라, 렌더링과 키보드 처리를 탭 화면
// (업로드·월 선택·저장)과 한 파일에 두면 둘 다 읽기 어려워진다. 여기는 "격자를 그리고 고치는 일"만 한다.
//
// [성능 — 두 겹으로 막는다]
//  ① **보이는 행만 그린다(가상 스크롤).** 640행을 통째로 그리면 시트 탭을 누를 때마다 17,920칸을
//     새로 만들어 약 500ms 가 걸렸다(2026-08-11 사용자 지적). 화면에 들어오는 30~40행만 그리고
//     위아래를 빈 행(스페이서)으로 채우면 시트 크기와 상관없이 같은 시간에 뜬다.
//  ② **행 단위 memo.** 커서를 옮길 때 다시 그려지는 행은 둘뿐(떠난 행·도착한 행)이다.
//     값을 고칠 때도 그 행 배열만 새로 만든다. 편집 입력칸은 비제어라 한 글자마다 부모를 흔들지 않는다.
//
// [가상 스크롤이 성립하려면 행 높이가 **미리 정확히** 계산돼야 한다]
// 그래서 모든 행에 높이를 못 박는다(엑셀 hpx, 없으면 기본값). 같은 이유로 엑셀의 '자동 줄바꿈'은
// 따르지 않는다 — 줄이 늘면 행이 계산보다 높아져 스크롤 위치가 어긋난다. 엑셀도 행 높이가 고정된
// 칸에서는 넘치는 줄을 감추므로, 줄바꿈을 무시하는 편이 오히려 원본에 가깝다.
//
// [엑셀 서식 적용 규칙]
//   · 배경·글자색·볼드·기울임·정렬 : 엑셀 값을 그대로
//   · 글자 크기 : pt × 1.1 × 배율 → px (10pt·100%가 ERP 기본 글자 11px)
//   · 테두리    : 엑셀에 테두리가 있는 칸만 진하게, **오른쪽·아래만** 긋는다(DESIGN.md §9-1-A —
//                 왼쪽·위까지 그으면 이웃 칸이 같은 경계를 두 번 그려 선이 두 줄로 굵어진다)
import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent,
} from "react";
import {
  columnLabel, formatCellText, parseEditedValue, MIN_COL_PX, MIN_ROW_PX,
  type ReportCell, type ReportSheet,
} from "./helpers/reportPack";
import type { XlsxCellStyle } from "./helpers/xlsxStyles";

export type CellRef = { r: number; c: number };

/** 행 번호 열의 폭(px, 배율 100% 기준). 헤더 모서리 칸과 값이 같아야 열이 어긋나지 않는다. */
const ROW_HEAD_PX = 42;
/** 엑셀이 높이를 따로 지정하지 않은 행의 높이(px, 배율 100% 기준). 관찰된 기본값 19.15pt 에 맞춘다. */
const DEFAULT_ROW_PX = 19;
/** 열 문자 머리글 줄의 높이(px). 커서를 따라 스크롤할 때 머리글 뒤로 숨지 않게 하는 데 쓴다. */
const HEAD_ROW_PX = 22;
/** 화면 밖으로 조금 더 그려 두는 행 수 — 빠르게 굴릴 때 빈 줄이 스쳐 보이는 것을 막는다. */
const OVERSCAN = 10;

/**
 * 화면 배율 — 엑셀의 확대/축소와 같은 뜻이다.
 *
 * [왜 폭만 줄이지 않는가] 엑셀 열 너비는 그 열의 **가장 긴 값**에 맞춰져 있다(마음죽 B열은 아래쪽
 * 거래내역의 긴 거래처명 때문에 128px). 그래서 위쪽 손익계산서만 볼 때는 헐거워 보이는데,
 * 폭만 줄이면 아래쪽 값이 잘리고 글자만 상대적으로 커져 비율이 깨진다.
 * 배율은 **글자·폭·행높이를 함께** 줄이므로 엑셀에서 축소한 것과 같은 그림이 된다.
 */
export const ZOOM_OPTIONS = [0.7, 0.8, 0.9, 1] as const;
export const DEFAULT_ZOOM = 0.8;

/** 엑셀 pt → 화면 px(배율 포함). */
function fontPx(pt: number | undefined, zoom: number): number | undefined {
  return pt ? Math.max(8, Math.round(pt * 1.1 * zoom)) : undefined;
}

/** 엑셀 셀 서식 → 인라인 스타일. 테두리는 §9-1-A 대로 오른쪽·아래만 그린다. */
function styleOf(style: XlsxCellStyle | undefined, selected: boolean, zoom: number): CSSProperties {
  const css: CSSProperties = {};
  if (!style) {
    css.borderRight = "1px solid rgba(33,33,33,0.08)";
    css.borderBottom = "1px solid rgba(33,33,33,0.08)";
  } else {
    if (style.bg) css.backgroundColor = `#${style.bg}`;
    if (style.fg) css.color = `#${style.fg}`;
    if (style.bold) css.fontWeight = 800;
    if (style.italic) css.fontStyle = "italic";
    const size = fontPx(style.size, zoom);
    if (size) css.fontSize = `${size}px`;
    if (style.align) css.textAlign = style.align;
    // [줄바꿈(wrap)은 따르지 않는다] 줄이 늘면 행이 계산 높이보다 커져 가상 스크롤이 어긋난다.
    // 엑셀도 높이가 고정된 행에서는 넘치는 줄을 감춘다 — 무시하는 편이 원본에 가깝다.
    css.borderRight = style.br ? "1px solid rgba(33,33,33,0.45)" : "1px solid rgba(33,33,33,0.08)";
    css.borderBottom = style.bb ? "1px solid rgba(33,33,33,0.45)" : "1px solid rgba(33,33,33,0.08)";
  }
  // 커서 칸은 엑셀처럼 굵은 테두리로 짚는다. outline 은 이웃 칸 위로 그려져 격자를 가리지 않는다.
  if (selected) {
    css.outline = "2px solid #1A3C6E";
    css.outlineOffset = "-2px";
  }
  return css;
}

/** 편집 중인 칸의 입력. **비제어** 다 — 한 글자마다 부모를 다시 그리지 않기 위해서다. */
function CellEditor({ initial, onCommit, onCancel, align }: {
  initial: string;
  onCommit: (raw: string, move: "down" | "right" | "left" | "up" | "none") => void;
  onCancel: () => void;
  align?: "left" | "center" | "right";
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  // IME 조합 중에는 Enter 가 "글자 확정"이라 칸을 옮기면 안 된다(한글이 잘려 들어간다).
  const composing = useRef(false);
  // 이미 확정했는지 — 확정 뒤 언마운트될 때 같은 값을 두 번 쓰지 않게 한다.
  const settled = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // [가상 스크롤 대비] 편집 중인 행이 화면 밖으로 밀려나면 이 입력칸이 통째로 사라진다.
  // 그때는 blur 가 뜨지 않으므로, 언마운트에서 마지막 값을 확정해 **친 내용이 조용히 사라지지 않게** 한다.
  // (onCommit 은 부모가 useCallback 으로 정체를 고정한다 — 안 그러면 이 정리가 매 렌더 헛돈다.)
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (settled.current || !el) return;
      settled.current = true;
      onCommit(el.value, "none");
    };
  }, [onCommit]);

  const commit = (value: string, move: "down" | "right" | "left" | "up" | "none") => {
    settled.current = true;
    onCommit(value, move);
  };

  return (
    <input
      ref={ref}
      // [IME] inputMode="numeric" 을 절대 넣지 않는다 — 윈도우 IME 가 그 칸에서 영문으로 바뀌고
      // 그 상태가 전역에 남아 다음 칸의 한글 입력이 깨진다(DESIGN.md §9 의 실제 사고).
      type="text"
      className="report-grid-input"
      style={align ? { textAlign: align } : undefined}
      defaultValue={initial}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onBlur={(e) => commit(e.currentTarget.value, "none")}
      onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Escape") { e.preventDefault(); settled.current = true; onCancel(); return; }
        if (composing.current || e.nativeEvent.isComposing) return; // 조합 중 Enter 는 글자 확정이다
        if (e.key === "Enter") { e.preventDefault(); commit(e.currentTarget.value, e.shiftKey ? "up" : "down"); return; }
        if (e.key === "Tab") { e.preventDefault(); commit(e.currentTarget.value, e.shiftKey ? "left" : "right"); return; }
        // 방향키는 글자 사이를 오가는 데 쓴다(칸 이동은 편집을 끝낸 뒤 선택 모드에서).
      }}
    />
  );
}

type RowProps = {
  rowIndex: number;
  values: ReportCell[];
  fmt: number[];
  sty: number[];
  colCount: number;
  height: number;
  styles: XlsxCellStyle[];
  numFmts: string[];
  ssf: any;
  zoom: number;
  /** 이 행에 커서가 있으면 그 열, 없으면 null — memo 가 나머지 행을 건너뛰게 하는 열쇠다. */
  activeCol: number | null;
  editing: boolean;
  /** 병합에 가려 그리지 않을 열 + 병합 시작 칸의 span */
  spans: Map<number, { rs: number; cs: number }>;
  covered: Set<number>;
  onSelect: (cell: CellRef) => void;
  onBeginEdit: (cell: CellRef) => void;
  onCommit: (cell: CellRef, raw: string, move: "down" | "right" | "left" | "up" | "none") => void;
  onCancel: () => void;
  /** 행 번호 칸 아래 모서리를 끌어 높이를 바꾼다. **정체가 고정된 함수**여야 memo 가 살아 있다. */
  onStartRowResize: (event: ReactPointerEvent<HTMLElement>, rowIndex: number) => void;
};

const GridRow = memo(function GridRow({
  rowIndex, values, fmt, sty, colCount, height, styles, numFmts, ssf, zoom,
  activeCol, editing, spans, covered, onSelect, onBeginEdit, onCommit, onCancel, onStartRowResize,
}: RowProps) {
  const cells = [];
  for (let c = 0; c < colCount; c += 1) {
    if (covered.has(c)) continue;
    const span = spans.get(c);
    const value = values[c] ?? "";
    const styleIndex = sty[c] ?? -1;
    const style = styleIndex >= 0 ? styles[styleIndex] : undefined;
    const formatIndex = fmt[c] ?? -1;
    const selected = activeCol === c;
    const isEditing = selected && editing;
    cells.push(
      <td
        key={c}
        rowSpan={span?.rs}
        colSpan={span?.cs}
        style={styleOf(style, selected, zoom)}
        onMouseDown={() => onSelect({ r: rowIndex, c })}
        onDoubleClick={() => onBeginEdit({ r: rowIndex, c })}
      >
        {isEditing ? (
          <CellEditor
            initial={value === "" ? "" : String(value)}
            align={style?.align}
            onCommit={(raw, move) => onCommit({ r: rowIndex, c }, raw, move)}
            onCancel={onCancel}
          />
        ) : (
          <span className="report-grid-text">
            {formatCellText(value, formatIndex >= 0 ? numFmts[formatIndex] : undefined, ssf)}
          </span>
        )}
      </td>
    );
  }
  return (
    <tr style={{ height: `${height}px` }}>
      <td className="report-grid-rownum">
        {rowIndex + 1}
        {/* 엑셀처럼 행 아래 모서리를 끌어 높이를 바꾼다. */}
        <span
          className="report-row-resizer"
          role="separator"
          aria-label={`${rowIndex + 1}행 높이 조절`}
          onPointerDown={(e) => onStartRowResize(e, rowIndex)}
        />
      </td>
      {cells}
    </tr>
  );
});

/** 누적합 배열(길이 n+1)에서 offset 이 몇 번째 칸에 드는지 찾는다(이분 탐색). */
function indexAt(prefix: number[], offset: number): number {
  let lo = 0;
  let hi = Math.max(0, prefix.length - 2);
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (prefix[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function ReportGrid({ sheet, styles, numFmts, ssf, zoom, onEdit, onResizeColumn, onResizeRow }: {
  sheet: ReportSheet;
  styles: XlsxCellStyle[];
  numFmts: string[];
  ssf: any;
  /** 화면 배율(0.7~1). 열 너비·행 높이·글자 크기에 함께 곱한다. */
  zoom: number;
  /** 값이 바뀌면 부모가 시트를 통째로 새로 만들어 되돌려 준다(불변 갱신). */
  onEdit: (cell: CellRef, value: ReportCell) => void;
  /** 열 너비를 바꾼다. px 는 **배율 100% 기준**(화면에서 끈 폭 ÷ 배율). */
  onResizeColumn: (col: number, px: number) => void;
  /** 행 높이를 바꾼다. px 는 배율 100% 기준. */
  onResizeRow: (row: number, px: number) => void;
}) {
  const [active, setActive] = useState<CellRef>({ r: 0, c: 0 });
  const [editing, setEditing] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  /** `<col>` 요소들 — 끄는 동안 폭을 여기에 직접 적는다(아래 주석 참고). */
  const colElRefs = useRef<(HTMLTableColElement | null)[]>([]);
  /** 지금 화면에 걸린 세로 구간 — 가상 스크롤의 입력값이다. */
  const [viewport, setViewport] = useState({ top: 0, height: 600 });

  const colCount = sheet.cols.length;
  const rowCount = sheet.rows.length;

  // ── 치수(배율 반영) ──
  // [선언 위치] 아래 moveTo 의 useCallback 의존성 배열이 이 값들을 **즉시** 평가한다 —
  // 선언이 그보다 아래면 초기화 전 접근(TDZ)으로 화면이 통째로 죽는다.
  const rowHeadPx = Math.round(ROW_HEAD_PX * zoom);
  const colPx = useMemo(() => sheet.cols.map((w) => Math.max(22, Math.round(w * zoom))), [sheet.cols, zoom]);
  const rowPx = useMemo(
    () => sheet.rows.map((_, r) => Math.max(12, Math.round((sheet.heights[r] || DEFAULT_ROW_PX) * zoom))),
    [sheet, zoom]
  );
  /** 각 행의 위쪽 offset 누적합(길이 n+1). 마지막 값이 표 전체 높이다. */
  const rowTop = useMemo(() => {
    const acc = [0];
    for (let r = 0; r < rowPx.length; r += 1) acc.push(acc[r] + rowPx[r]);
    return acc;
  }, [rowPx]);
  /** 각 열의 왼쪽 offset 누적합(행번호 열 다음부터). */
  const colLeft = useMemo(() => {
    const acc = [0];
    for (let c = 0; c < colPx.length; c += 1) acc.push(acc[c] + colPx[c]);
    return acc;
  }, [colPx]);
  const totalWidth = colLeft[colLeft.length - 1] + rowHeadPx;
  const totalHeight = rowTop[rowTop.length - 1] ?? 0;

  // 시트를 바꾸면 커서와 스크롤을 처음으로 되돌린다 — 안 그러면 없는 칸을 가리킨 채로 남는다.
  useEffect(() => {
    setActive({ r: 0, c: 0 });
    setEditing(false);
    const box = scrollRef.current;
    if (box) { box.scrollTop = 0; box.scrollLeft = 0; }
    setViewport((v) => (v.top === 0 ? v : { ...v, top: 0 }));
  }, [sheet.name]);

  /** 스크롤 칸의 실제 높이를 재 둔다(창 크기가 바뀌면 다시 잰다). */
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const measure = () => setViewport((v) => (v.height === box.clientHeight ? v : { ...v, height: box.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  /** 스크롤은 프레임당 한 번만 반영한다 — 매 이벤트마다 setState 하면 굴릴 때 버벅인다. */
  const scrollTick = useRef(0);
  const handleScroll = useCallback(() => {
    if (scrollTick.current) return;
    scrollTick.current = requestAnimationFrame(() => {
      scrollTick.current = 0;
      const box = scrollRef.current;
      if (box) setViewport((v) => (v.top === box.scrollTop ? v : { ...v, top: box.scrollTop }));
    });
  }, []);
  useEffect(() => () => { if (scrollTick.current) cancelAnimationFrame(scrollTick.current); }, []);

  // ── 그릴 행 범위 ──
  // rowTop 은 본문 기준, viewport.top 은 표 전체 기준이라 머리글 줄 높이만큼 빼서 좌표계를 맞춘다.
  const firstRow = Math.max(0, indexAt(rowTop, Math.max(0, viewport.top - HEAD_ROW_PX)) - OVERSCAN);
  const lastRow = Math.min(rowCount - 1, indexAt(rowTop, Math.max(0, viewport.top + viewport.height - HEAD_ROW_PX)) + OVERSCAN);
  const padTop = rowTop[firstRow] ?? 0;
  const padBottom = Math.max(0, totalHeight - (rowTop[lastRow + 1] ?? totalHeight));

  // 병합 — 시작 칸에 span 을 주고, 가려지는 칸은 그리지 않는다.
  // [memo] 매 렌더마다 새 Map 을 만들면 그 행의 props 정체가 바뀌어 memo 가 무너진다 — 시트가 바뀔 때만 만든다.
  const { spanByRow, coveredByRow } = useMemo(() => {
    const spans = new Map<number, Map<number, { rs: number; cs: number }>>();
    const covered = new Map<number, Set<number>>();
    for (const m of sheet.merges) {
      let starts = spans.get(m.r);
      if (!starts) { starts = new Map(); spans.set(m.r, starts); }
      starts.set(m.c, { rs: m.rs, cs: m.cs });
      for (let r = m.r; r < m.r + m.rs; r += 1) {
        let set = covered.get(r);
        if (!set) { set = new Set(); covered.set(r, set); }
        for (let c = m.c; c < m.c + m.cs; c += 1) {
          if (r === m.r && c === m.c) continue;
          set.add(c);
        }
      }
    }
    return { spanByRow: spans, coveredByRow: covered };
  }, [sheet.merges]);
  const emptySpans = useRef(new Map<number, { rs: number; cs: number }>()).current;
  const emptyCovered = useRef(new Set<number>()).current;

  /**
   * 커서를 옮기고 그 칸이 보이도록 스크롤한다.
   * 위치는 **누적합으로 계산**한다 — 가상 스크롤이라 화면 밖 행은 DOM 에 없어서 찾을 수가 없다.
   */
  const moveTo = useCallback((r: number, c: number) => {
    const next = {
      r: Math.max(0, Math.min(rowCount - 1, r)),
      c: Math.max(0, Math.min(colCount - 1, c)),
    };
    setActive(next);
    const box = scrollRef.current;
    if (!box) return;

    // [좌표계 주의] rowTop/colLeft 는 **본문(tbody) 기준**이고, 스크롤 위치는 **표 전체 기준**이다.
    // 표의 맨 위에는 열 문자 머리글 줄이, 맨 왼쪽에는 행 번호 열이 자리를 차지하므로 그만큼 더해야
    // 같은 좌표계가 된다. 게다가 그 둘은 고정(sticky)이라 **화면 가장자리 그만큼을 늘 덮고 있다** —
    // 그래서 "보이는 영역"의 시작도 그만큼 안쪽이다. 이 둘을 빼먹으면 커서가 머리글 뒤에 숨거나
    // 아예 화면 밖에 남는다(PageDown 을 여러 번 눌렀을 때 실제로 그랬다).
    const cellLeft = rowHeadPx + colLeft[next.c];
    const cellRight = rowHeadPx + colLeft[next.c + 1];
    if (cellLeft < box.scrollLeft + rowHeadPx) box.scrollLeft = Math.max(0, cellLeft - rowHeadPx);
    else if (cellRight > box.scrollLeft + box.clientWidth) box.scrollLeft = cellRight - box.clientWidth;

    const cellTop = HEAD_ROW_PX + rowTop[next.r];
    const cellBottom = HEAD_ROW_PX + rowTop[next.r + 1];
    if (cellTop < box.scrollTop + HEAD_ROW_PX) box.scrollTop = Math.max(0, cellTop - HEAD_ROW_PX);
    else if (cellBottom > box.scrollTop + box.clientHeight) box.scrollTop = cellBottom - box.clientHeight;

    handleScroll();
  }, [rowCount, colCount, colLeft, rowTop, rowHeadPx, handleScroll]);

  const commit = useCallback((cell: CellRef, raw: string, move: "down" | "right" | "left" | "up" | "none") => {
    onEdit(cell, parseEditedValue(raw));
    setEditing(false);
    if (move === "down") moveTo(cell.r + 1, cell.c);
    else if (move === "up") moveTo(cell.r - 1, cell.c);
    else if (move === "right") moveTo(cell.r, cell.c + 1);
    else if (move === "left") moveTo(cell.r, cell.c - 1);
    // 편집을 끝냈으면 키보드 초점을 격자로 되돌린다 — 안 그러면 방향키가 아무 데도 안 먹는다.
    if (move !== "none") requestAnimationFrame(() => scrollRef.current?.focus());
  }, [onEdit, moveTo]);

  /**
   * 열/행 크기 끌기 — 엑셀과 같은 동작.
   *
   * [끄는 동안에는 React 상태를 건드리지 않는다]
   * 움직일 때마다 상태를 바꾸면 보이는 행(약 50행 × 27열)이 매 프레임 다시 그려져 끌리는 느낌이 뚝뚝 끊긴다.
   * 그래서 **끄는 중에는 `<col>`/`<tr>` 의 style 만 직접 적고**, 손을 뗄 때 한 번만 부모에 알린다.
   * 그 뒤 React 가 새 값으로 다시 그리면서 누적합(스크롤 위치 계산)까지 함께 맞춘다.
   *
   * 포인터를 손잡이에 가둬(setPointerCapture) 격자 밖으로 나가도 계속 따라오게 한다.
   */
  const startResize = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    axis: "col" | "row",
    index: number,
    startSize: number,
    apply: (px: number) => void,
    commit: (px: number) => void
  ) => {
    // 손잡이를 눌렀을 때 칸이 선택되거나 글자가 드래그되지 않게 막는다.
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const start = axis === "col" ? event.clientX : event.clientY;
    const min = axis === "col" ? MIN_COL_PX : MIN_ROW_PX;
    const minOnScreen = Math.max(4, Math.round(min * zoom));
    let latest = startSize;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add(axis === "col" ? "report-resizing-col" : "report-resizing-row");

    const onMove = (e: PointerEvent) => {
      const delta = (axis === "col" ? e.clientX : e.clientY) - start;
      latest = Math.max(minOnScreen, Math.round(startSize + delta));
      apply(latest);
    };
    const finish = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      document.body.classList.remove("report-resizing-col", "report-resizing-row");
      try { handle.releasePointerCapture(event.pointerId); } catch { /* 이미 풀렸으면 그만 */ }
      // 저장값은 **배율 100% 기준**으로 되돌린다 — 화면에서 끈 폭을 그대로 담으면 배율을 바꿨을 때 어긋난다.
      commit(latest / zoom);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }, [zoom]);

  const handleStartColResize = useCallback((event: ReactPointerEvent<HTMLElement>, col: number) => {
    const colEl = colElRefs.current[col];
    const table = tableRef.current;
    const startPx = colEl ? colEl.getBoundingClientRect().width : 0;
    const startTablePx = table ? table.getBoundingClientRect().width : 0;
    startResize(event, "col", col, Math.round(startPx),
      (px) => {
        if (colEl) colEl.style.width = `${px}px`;
        // 표 전체 폭도 같이 늘려야 가로 스크롤 범위가 따라온다.
        if (table) table.style.width = `${Math.round(startTablePx - startPx + px)}px`;
      },
      (px) => onResizeColumn(col, px));
  }, [startResize, onResizeColumn]);

  const handleStartRowResize = useCallback((event: ReactPointerEvent<HTMLElement>, row: number) => {
    const tr = event.currentTarget.closest("tr") as HTMLTableRowElement | null;
    const startPx = tr ? tr.getBoundingClientRect().height : 0;
    startResize(event, "row", row, Math.round(startPx),
      (px) => { if (tr) tr.style.height = `${px}px`; },
      (px) => onResizeRow(row, px));
  }, [startResize, onResizeRow]);

  // [memo] 아래 세 콜백은 **정체가 고정돼야 한다.** map 안에서 화살표 함수로 만들면 렌더마다 새 함수가 되고,
  // 그러면 GridRow 의 props 가 매번 달라져 memo 가 아무 일도 하지 않는다.
  const handleSelect = useCallback((cell: CellRef) => { setActive(cell); setEditing(false); }, []);
  const handleBeginEdit = useCallback((cell: CellRef) => { setActive(cell); setEditing(true); }, []);
  const handleCancel = useCallback(() => {
    setEditing(false);
    requestAnimationFrame(() => scrollRef.current?.focus());
  }, []);

  /**
   * 선택 모드 키보드 — 엑셀과 같은 규칙이다.
   *   방향키/Tab/Enter = 칸 이동 · F2·Enter·글자입력 = 편집 시작 · Delete/Backspace = 지우기
   * 편집 중에는 방향키가 **글자 사이**를 오간다(CellEditor 가 처리) — 한글 입력 중에 칸이 튀지 않게.
   */
  const onGridKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const { r, c } = active;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); moveTo(r + 1, c); return;
      case "ArrowUp": e.preventDefault(); moveTo(r - 1, c); return;
      case "ArrowRight": e.preventDefault(); moveTo(r, c + 1); return;
      case "ArrowLeft": e.preventDefault(); moveTo(r, c - 1); return;
      case "Tab": e.preventDefault(); moveTo(r, e.shiftKey ? c - 1 : c + 1); return;
      case "Home": e.preventDefault(); moveTo(r, 0); return;
      case "End": e.preventDefault(); moveTo(r, colCount - 1); return;
      case "PageDown": e.preventDefault(); moveTo(r + 20, c); return;
      case "PageUp": e.preventDefault(); moveTo(r - 20, c); return;
      case "Enter": case "F2": e.preventDefault(); setEditing(true); return;
      case "Delete": case "Backspace": e.preventDefault(); onEdit(active, ""); return;
      default: break;
    }
    // 글자를 치면 그대로 편집을 시작한다(엑셀과 같음). 조합키가 걸린 단축키는 건드리지 않는다.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) setEditing(true);
  };

  const visible = [];
  for (let r = firstRow; r <= lastRow; r += 1) {
    visible.push(
      <GridRow
        key={r}
        rowIndex={r}
        values={sheet.rows[r] || []}
        fmt={sheet.fmt[r] || []}
        sty={sheet.sty[r] || []}
        colCount={colCount}
        height={rowPx[r]}
        styles={styles}
        numFmts={numFmts}
        ssf={ssf}
        zoom={zoom}
        activeCol={active.r === r ? active.c : null}
        editing={active.r === r && editing}
        spans={spanByRow.get(r) || emptySpans}
        covered={coveredByRow.get(r) || emptyCovered}
        onSelect={handleSelect}
        onBeginEdit={handleBeginEdit}
        onCommit={commit}
        onCancel={handleCancel}
        onStartRowResize={handleStartRowResize}
      />
    );
  }

  return (
    <div
      ref={scrollRef}
      className="report-grid-scroll"
      tabIndex={0}
      role="grid"
      aria-label={`${sheet.name} 시트`}
      aria-rowcount={rowCount}
      onKeyDown={onGridKeyDown}
      onScroll={handleScroll}
    >
      {/* [가로 스크롤의 핵심] 열 너비를 **엑셀의 실제 폭(px)** 으로 못 박고 table-layout:fixed 를 쓴다.
          폭을 내용에 맡기면 빈 열이 쪼그라들어 표가 화면보다 좁아지고, 그러면 스크롤이 아예 생기지 않아
          오른쪽 열을 볼 방법이 없다(2026-08-11 사용자 지적). */}
      <table ref={tableRef} className="report-grid" style={{ width: `${totalWidth}px`, fontSize: `${Math.max(8, Math.round(11 * zoom))}px` }}>
        <colgroup>
          <col style={{ width: `${rowHeadPx}px` }} />
          {colPx.map((w, i) => (
            <col key={i} ref={(el) => { colElRefs.current[i] = el; }} style={{ width: `${w}px` }} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ height: `${HEAD_ROW_PX}px` }}>
            <th className="report-grid-corner" scope="col"><span className="sr-only">행 번호</span></th>
            {colPx.map((_, i) => (
              <th key={i} scope="col" className={active.c === i ? "is-active" : undefined}>
                {columnLabel(i)}
                {/* 엑셀처럼 열 오른쪽 모서리를 끌어 너비를 바꾼다. */}
                <span
                  className="report-col-resizer"
                  role="separator"
                  aria-label={`${columnLabel(i)}열 너비 조절`}
                  onPointerDown={(e) => handleStartColResize(e, i)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* 위아래 빈 자리 — 안 그린 행들의 높이를 대신 차지해 스크롤 막대가 실제 크기대로 움직이게 한다. */}
          {padTop > 0 && (
            <tr className="report-grid-spacer" style={{ height: `${padTop}px` }} aria-hidden="true">
              <td colSpan={colCount + 1} />
            </tr>
          )}
          {visible}
          {padBottom > 0 && (
            <tr className="report-grid-spacer" style={{ height: `${padBottom}px` }} aria-hidden="true">
              <td colSpan={colCount + 1} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
