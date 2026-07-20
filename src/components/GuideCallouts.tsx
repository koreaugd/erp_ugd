// src/components/GuideCallouts.tsx
// 화면 위에 안내 말풍선들을 "한꺼번에" 띄우는 공용 부품. 버튼 토글로 켜고 끈다.
// 배경을 어둡게 하지 않고, 말풍선 바깥은 클릭이 그대로 통과하므로 안내를 켜둔 채 작성할 수 있다.
// 앵커는 화면 요소의 data-guide 속성값으로 찾는다. steps만 받으며 어떤 탭인지 모른다.
//
// 위치는 화면(viewport) 좌표가 아니라 문서(document) 좌표로 잡는다.
//   - 화면 좌표로 고정하면 접힌 아래에 있는 섹션의 말풍선이 잘리거나 서로 겹친다.
//   - 문서 좌표에 붙이면 말풍선이 섹션을 따라 자연스럽게 스크롤되고, 스크롤 리스너도 필요 없다.
// 본문은 window가 스크롤한다(내부 overflow 컨테이너 없음)는 전제 — 그래서 body 기준 absolute 좌표가 유효하다.
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface GuideStep {
  anchor: string; // data-guide 속성값. 화면에 없으면 그 말풍선은 그리지 않는다.
  /** 한 앵커에 말풍선을 둘 이상 붙일 때 구분자. 생략하면 anchor를 쓴다. */
  id?: string;
  title: string;
  body: ReactNode;
  /** 기본 340px. 내용이 길어 세로로 늘어지는 안내는 넓혀서 줄 수를 줄인다. */
  width?: number;
  /**
   * below: 앵커 바로 아래에 붙인다. 입력칸처럼 작은 앵커용 — 앵커를 가리지 않는다.
   * above: 앵커 바로 위에 붙인다. 아래가 페이지 끝이거나 아래로 밀기 싫을 때.
   * right: 앵커 오른쪽에 붙인다. 위/아래 섹션과 겹치기 싫은 작은 앵커(제목 등)용.
   * inside-top-right: 앵커 안쪽 오른쪽 위에 겹쳐 놓는다. 표처럼 넓은 앵커용. (기본값)
   * inside-top-left: 앵커 안쪽 왼쪽 위에 겹쳐 놓는다.
   * outside-top-left: 앵커 바깥 왼쪽 위. 말풍선의 오른쪽 아래 모서리가 앵커의 왼쪽 위 모서리에 닿는다.
   */
  placement?: "below" | "above" | "right" | "inside-top-right" | "inside-top-left" | "outside-top-left";
  /** 꼬리(뾰족한 부분)의 가로 위치. start=왼쪽(기본), center=말풍선 가운데, anchor=앵커 중앙을 가리킴. below/above에서만. */
  arrow?: "start" | "center" | "anchor";
}

const BUBBLE_W = 340; // 말풍선 기본 너비(px)
const EDGE = 12; // 문서 좌우 최소 여백
const INSET = 14; // 앵커 모서리에서 안쪽으로 들여놓는 거리
const BELOW_GAP = 12; // 앵커 아래에 붙일 때 간격
const ARROW_LEFT = 22; // 말풍선 왼쪽 모서리에서 화살표까지

type Rect = { top: number; left: number; width: number; height: number };
type Placement = NonNullable<GuideStep["placement"]>;
// arrowX: below/above 꼬리의 가로 위치. right 꼬리는 CSS로 왼쪽면 세로 중앙에 둔다(높이 측정 불필요).
type Spot = { id: string; top: number; left: number; width: number; placement: Placement; arrowX: number };

const stepId = (step: GuideStep) => step.id ?? step.anchor;

const sameSpots = (a: Spot[], b: Spot[]) => a.length === b.length && JSON.stringify(a) === JSON.stringify(b);

export function GuideCallouts({ open, steps, onClose }: { open: boolean; steps: GuideStep[]; onClose: () => void }) {
  const [spots, setSpots] = useState<Spot[]>([]);
  // 말풍선이 입력칸을 가릴 때 하나씩 치울 수 있게 한다. 다시 켜면 초기화된다.
  const [dismissed, setDismissed] = useState<string[]>([]);

  const measure = useCallback(() => {
    const docWidth = document.documentElement.clientWidth;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const next: Spot[] = [];

    for (const step of steps) {
      const node = document.querySelector<HTMLElement>(`[data-guide="${step.anchor}"]`);
      if (!node) continue; // 아직 안 그려진 섹션(로딩 중 등)만 건너뛴다. 화면 밖이라는 이유로는 건너뛰지 않는다.
      const r = node.getBoundingClientRect();
      const ring: Rect = { top: r.top + scrollY, left: r.left + scrollX, width: r.width, height: r.height };

      const width = Math.min(step.width ?? BUBBLE_W, docWidth - EDGE * 2);
      const clamp = (left: number) => Math.min(Math.max(EDGE, left), Math.max(EDGE, docWidth - width - EDGE));

      // right는 오른쪽에 말풍선 폭이 안 들어가면(모바일 등) below로 폴백한다.
      // 안 그러면 앵커 위로 겹쳐 그려지고 꼬리가 화면 가장자리를 가리킨다.
      const placementReq: Placement = step.placement ?? "inside-top-right";
      const fellBack = placementReq === "right" && docWidth - (ring.left + ring.width + BELOW_GAP) - EDGE < width;
      const placement: Placement = fellBack ? "below" : placementReq;

      // above는 말풍선 높이를 알아야 하지만 그리기 전에는 알 수 없다.
      // 앵커 위쪽 모서리에 두고 CSS translateY(-100%)로 끌어올려 높이 측정을 피한다.
      const top =
        placement === "below" ? ring.top + ring.height + BELOW_GAP
        : placement === "above" ? ring.top - BELOW_GAP
        // right: 앵커 세로 중앙에 두고 말풍선을 -translate-y-1/2로 올려 꼬리(50%)가 앵커 중앙을 가리키게 한다.
        : placement === "right" ? ring.top + ring.height / 2
        // outside-top-left: 앵커 위쪽 모서리에 두고 -translate-y-full로 끌어올린다(높이 측정을 피한다).
        : placement === "outside-top-left" ? ring.top
        : ring.top + INSET;
      const left =
        placement === "inside-top-right" ? clamp(ring.left + ring.width - width - INSET)
        : placement === "inside-top-left" ? clamp(ring.left + INSET)
        : placement === "right" ? clamp(ring.left + ring.width + BELOW_GAP)
        // 말풍선 오른쪽 끝이 앵커 왼쪽 모서리에 닿게 한다.
        : placement === "outside-top-left" ? clamp(ring.left - width)
        : clamp(ring.left);

      // below/above 꼬리 가로 위치: start=왼쪽, center=말풍선 가운데, anchor=앵커 중앙(말풍선 안으로 가둠).
      // right에서 below로 폴백한 경우엔 앵커를 가리키도록 anchor로 강제한다.
      const arrowMode = fellBack ? "anchor" : (step.arrow ?? "start");
      const anchorCenterX = ring.left + ring.width / 2;
      const arrowX =
        arrowMode === "center" ? width / 2 - 6
        : arrowMode === "anchor" ? Math.min(Math.max(anchorCenterX - left - 6, 14), width - 26)
        : ARROW_LEFT;

      next.push({ id: stepId(step), top, left, width, placement, arrowX });
    }

    // 값이 그대로면 상태를 갱신하지 않는다 — ResizeObserver ↔ 리렌더 순환을 막는다.
    setSpots((prev) => (sameSpots(prev, next) ? prev : next));
  }, [steps]);

  useEffect(() => {
    if (!open) {
      setSpots([]);
      setDismissed([]);
      return;
    }
    measure();
    // 섹션이 늦게 그려지거나(로딩 완료) 높이가 바뀌면 따라간다. 스크롤은 문서 좌표라 추적할 필요가 없다.
    const observer = new ResizeObserver(() => measure());
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, measure, onClose]);

  if (!open) return null;

  const byId = new Map(steps.map((s) => [stepId(s), s]));

  return createPortal(
    // 문서 전체를 덮되 클릭은 통과시킨다(pointer-events-none). 클릭을 받는 것은 각 말풍선의 닫기 버튼뿐이다.
    // 사이드바(z-40)와 토스트 알림(z-50) 아래에 둬서 그 둘을 가리지 않는다.
    <div className="absolute top-0 left-0 w-full h-0 z-30 pointer-events-none">
      {spots.map((spot) => {
        const step = byId.get(spot.id);
        if (!step || dismissed.includes(spot.id)) return null;
        return (
          <div key={spot.id}>
            {/* 말풍선 몸통도 클릭을 통과시킨다(pointer-events-none).
                말풍선이 입력칸·버튼을 덮더라도 그 아래를 그대로 쓸 수 있어야 하기 때문.
                클릭을 받는 것은 닫기(X) 버튼 하나뿐이다. */}
            <div
              className={`absolute pointer-events-none bg-white border-2 border-rose-600 rounded-2xl shadow-xl ${
                spot.placement === "above" || spot.placement === "outside-top-left" ? "-translate-y-full"
                : spot.placement === "right" ? "-translate-y-1/2"
                : ""
              }`}
              style={{ top: spot.top, left: spot.left, width: spot.width }}
              role="note"
              aria-label={`${step.title} 작성방법`}
            >
              {/* 말풍선 꼬리 — below=위, above=아래, right=왼쪽을 가리킨다. below/above 가로 위치는 arrowX(measure), right는 CSS 세로 중앙. */}
              {spot.placement === "below" && (
                <div
                  className="absolute w-3 h-3 bg-[#EFF0A3] border-l-2 border-t-2 border-rose-600 rotate-45"
                  style={{ top: -8, left: spot.arrowX }}
                />
              )}
              {spot.placement === "above" && (
                <div
                  className="absolute w-3 h-3 bg-white border-r-2 border-b-2 border-rose-600 rotate-45"
                  style={{ bottom: -8, left: spot.arrowX }}
                />
              )}
              {spot.placement === "right" && (
                // 왼쪽면 세로 가운데를 가리킨다. top:50% + translateY(-50%)로 말풍선 높이와 무관하게 중앙.
                <div
                  className="absolute w-3 h-3 bg-white border-l-2 border-b-2 border-rose-600 rotate-45 -translate-y-1/2"
                  style={{ left: -8, top: "50%" }}
                />
              )}
              <div className="relative flex justify-between items-center gap-2 px-3.5 py-2 bg-[#EFF0A3] border-b-2 border-rose-600 rounded-t-xl">
                <strong className="text-[12px] font-black text-zinc-900">{step.title}</strong>
                <button
                  onClick={() => setDismissed((prev) => [...prev, spot.id])}
                  aria-label={`${step.title} 안내 닫기`}
                  title="이 안내만 닫기"
                  className="pointer-events-auto text-zinc-900 hover:opacity-60 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="px-3.5 py-3 text-[12px] leading-relaxed font-semibold text-zinc-800">{step.body}</div>
            </div>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
