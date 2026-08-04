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
// - inline 아님(표준, 2026-08-04 확정): 제목 밴드 상단선에 반쯤 걸치게 띄운다.
//   표준 카드는 `overflow: hidden` 이라 카드 안에서 위로 내밀면 잘린다 — 반드시 카드를 감싼
//   **카드 밖 relative 래퍼**를 기준으로 띄울 것(`<div className="relative"><SheetKeyHint /><section …>`).
// - inline: 제목 밴드나 도구 줄(.branch-band-toolbar) **안에** 일반 흐름으로 놓고 싶을 때만.
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
