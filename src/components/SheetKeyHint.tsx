// src/components/SheetKeyHint.tsx
// 엑셀식 시트의 조작법 칩. 키보드로 칸을 옮길 수 있는 표라면 그 섹션에 붙인다.
//
// 안내 말풍선(작성방법)에 넣지 않고 별도 칩으로 두는 이유:
// 말풍선은 사용자가 버튼을 눌러야 뜨지만, 조작법은 표를 보는 순간 알아야 쓸모가 있다.
//
// 색은 푸른 계열로 고정한다(사용자 지시 2026-08-04) — 바닐라(노랑)로 하면 제목 밴드와 뭉쳐
// 안 보이고, 지점 CSS 의 노랑 계열 치환 규칙들과도 얽힌다. hex 로 못 박는다.
//
// 두 가지 놓임새:
// - inline(기본 권장): 제목 밴드나 도구 줄(.branch-band-toolbar) **안에** 일반 흐름으로 놓는다.
//   표준 카드는 `overflow: hidden` 이라 절대배치로 카드 밖에 걸치면 칩이 잘린다(2026-08-04 실제 발생).
// - inline 아님(옛 방식): 섹션 테두리에 살짝 걸쳐 띄운다. 아직 표준 카드로 안 옮긴
//   일일업무 탭(일일마감·주류재고·발주)에서만 쓴다. 부모에 `relative` 필요, overflow-hidden 금지.
export function SheetKeyHint({ inline = false }: { inline?: boolean }) {
  const color = "border-[#2E6DB4] bg-[#EAF1FA] text-[#2E6DB4]";
  if (inline) {
    return (
      <span className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-black leading-none ${color}`}>
        ↑ ↓ ← → · Tab · Enter 로 칸 이동
      </span>
    );
  }
  return (
    <span className={`absolute -top-2.5 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-black shadow-sm ${color}`}>
      ↑ ↓ ← → · Tab · Enter 로 칸 이동
    </span>
  );
}
