// src/components/SheetKeyHint.tsx
// 엑셀식 시트의 조작법 칩. 키보드로 칸을 옮길 수 있는 표라면 그 섹션 위에 붙인다.
//
// 안내 말풍선(작성방법)에 넣지 않고 별도 칩으로 두는 이유:
// 말풍선은 사용자가 버튼을 눌러야 뜨지만, 조작법은 표를 보는 순간 알아야 쓸모가 있다.
//
// 근무자 표와 같은 모양 — 섹션 테두리에 살짝 걸쳐 놓는다.
// 부모에 `relative`가 있어야 하고, 그 부모는 `overflow-hidden`이면 안 된다(칩 윗부분이 잘린다).
// 섹션 자체가 overflow-hidden이면 섹션을 relative 래퍼로 감싸고 그 래퍼에 이 칩을 둔다.
export function SheetKeyHint() {
  return (
    <span className="absolute -top-2.5 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-full border border-zinc-900 bg-[#EFF0A3] px-2.5 py-0.5 text-[10px] font-black text-zinc-900 shadow-sm">
      ↑ ↓ ← → · Tab · Enter 로 칸 이동
    </span>
  );
}
