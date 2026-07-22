// src/pages/admin/SalesLineChart.tsx
// 관리자 대시보드 매출 추이 선그래프. 차트 라이브러리를 새로 넣지 않고 인라인 SVG로 그린다
// (번들이 이미 크고, 선 2개짜리 그래프에 의존성을 더할 이유가 없다).
//
// 두 계열을 '인덱스로 겹쳐' 그린다 — 날짜로 맞추지 않는다. 저번달(30일) vs 그 전달(31일)처럼
// 기간 길이가 다를 수 있어서, x축은 현재 기간을 쓰고 직전 동기는 같은 순번에 얹는다.
import { useId, useState } from "react";
import { formatAxisLabel } from "./helpers/salesRollup";

export interface ChartPoint { x: string; y: number; }

// 선 색: DESIGN.md §3 에 등재된 값만 쓴다 — 현재는 액션 블루(#2E6DB4), 직전 동기는 검정 32%(점선).
// 색이 안 보여도 구분되도록 실선/점선을 함께 다르게 둔다.
const CURRENT_COLOR = "#2E6DB4";
const COMPARE_COLOR = "rgba(33, 33, 33, 0.32)";

const VIEW_W = 960;
const VIEW_H = 300;
const PAD = { top: 16, right: 16, bottom: 34, left: 72 };

/** 4,500,000 → "450만" / 1,200,000,000 → "12억" — 축 라벨이 길어지지 않게 */
export function formatCompactWon(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100_000_000) return `${(value / 100_000_000).toFixed(abs >= 1_000_000_000 ? 0 : 1)}억`;
  if (abs >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만`;
  return value.toLocaleString("ko-KR");
}

/** 눈금이 예쁜 값(1·2·5 × 10^n)으로 올림 — 축 최댓값 정하기 */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const scaled = value / base;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * base;
}

export function SalesLineChart({
  current,
  compare,
  granularity,
  compareLabel,
  currentLabel = "선택 기간",
  formatAxis = formatCompactWon,
  formatValue = (value: number) => `${value.toLocaleString("ko-KR")}원`,
  compact = false,
  autoScale = false,
}: {
  current: ChartPoint[];
  compare: ChartPoint[];
  granularity: "day" | "month";
  compareLabel: string;
  /** 파란 실선의 범례 이름. 분석 탭처럼 두 지표를 겹칠 때 바꿔 쓴다. */
  currentLabel?: string;
  /** y축 눈금 포맷(기본: 원화 축약 "450만"). 비율 차트는 % 포맷을 넘긴다. */
  formatAxis?: (value: number) => string;
  /** hover 값 포맷(기본: "1,234,567원"). */
  formatValue?: (value: number) => string;
  /** 반폭 카드(1행 2그래프)용 — viewBox 를 좁혀 글자가 상대적으로 커지게 한다. */
  compact?: boolean;
  /** 0 기준 대신 데이터 구간에 맞춰 확대해 변화를 크게 보여준다(비율 추이 등). */
  autoScale?: boolean;
}) {
  const clipId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (current.length === 0) {
    return <p className="py-16 text-center text-xs font-bold text-gray-400">표시할 매출 기록이 없습니다.</p>;
  }

  const viewW = compact ? 520 : VIEW_W;
  const viewH = VIEW_H;
  const plotW = viewW - PAD.left - PAD.right;
  const plotH = viewH - PAD.top - PAD.bottom;
  const count = current.length;
  // 점이 하나면 0으로 나누게 되므로 분모를 최소 1로 둔다.
  const stepX = count > 1 ? plotW / (count - 1) : 0;
  const xAt = (index: number) => PAD.left + (count > 1 ? index * stepX : plotW / 2);

  // autoScale=true 면 0 기준을 버리고 **데이터 구간에 맞춰 확대**한다 — 식재료율 25~46% 처럼
  // 좁은 구간에 몰린 값이 0부터 그려지면 선이 거의 평평해져 변화가 안 보인다(2026-07-22 사용자 지시).
  const allY = [...current.map((p) => p.y), ...compare.map((p) => p.y)];
  const dataHi = allY.length ? Math.max(...allY) : 1;
  const dataLo = allY.length ? Math.min(...allY) : 0;
  const maxValue = autoScale ? dataHi + Math.max((dataHi - dataLo) * 0.25, Math.abs(dataHi) * 0.05) : niceCeil(Math.max(1, ...allY));
  // 음수(적자 달의 이익금 등)도 축 안에 들어오게 아래쪽 범위를 함께 잡는다.
  // 0~max 고정 스케일이면 음수 점이 차트 영역 밖으로 그려져 선이 잘린다(Codex P1 지적).
  const minRaw = Math.min(0, ...allY);
  const minValue = autoScale
    ? dataLo - Math.max((dataHi - dataLo) * 0.25, Math.abs(dataLo) * 0.05)
    : minRaw < 0 ? -niceCeil(-minRaw) : 0;
  const span = maxValue - minValue || 1; // 값이 전부 같으면 0 나눗셈이 된다
  const yAt = (value: number) => PAD.top + plotH - ((value - minValue) / span) * plotH;

  const pathOf = (points: ChartPoint[]) =>
    points
      .slice(0, count)
      .map((point, index) => `${index === 0 ? "M" : "L"} ${xAt(index).toFixed(1)} ${yAt(point.y).toFixed(1)}`)
      .join(" ");

  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  // x축 라벨이 겹치지 않게 솎아낸다(최대 12개).
  const labelStride = Math.max(1, Math.ceil(count / 12));

  const hovered = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < count ? hoverIndex : null;

  return (
    <div className="admin-sales-chart">
      <div className="flex flex-wrap items-center gap-4 pb-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-black text-[#212121]">
          <svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke={CURRENT_COLOR} strokeWidth="2.5" /></svg>
          {currentLabel}
        </span>
        {compare.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-black text-[#212121]">
            <svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke={COMPARE_COLOR} strokeWidth="2.5" strokeDasharray="5 3" /></svg>
            {compareLabel}
          </span>
        )}
        {hovered !== null && (
          <span className="ml-auto text-[11px] font-black text-[#212121] font-mono">
            {formatAxisLabel(current[hovered].x, granularity)} · {currentLabel} {formatValue(current[hovered].y)}
            {compare[hovered] ? ` · ${compareLabel} ${formatValue(compare[hovered].y)}` : ""}
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${viewW} ${viewH}`}
        className="w-full h-auto"
        role="img"
        aria-label={`매출 추이 그래프. 선택 기간과 ${compareLabel}를 함께 표시합니다.`}
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width === 0) return;
          // 화면 좌표 → viewBox 좌표로 환산한 뒤 가장 가까운 점을 고른다.
          const viewX = ((event.clientX - rect.left) / rect.width) * viewW;
          const index = count > 1 ? Math.round((viewX - PAD.left) / stepX) : 0;
          setHoverIndex(Math.min(count - 1, Math.max(0, index)));
        }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        {gridLines.map((ratio) => {
          const value = maxValue - span * ratio;
          const y = PAD.top + plotH * ratio;
          return (
            <g key={ratio}>
              <line x1={PAD.left} y1={y} x2={PAD.left + plotW} y2={y} stroke="rgba(33,33,33,0.10)" strokeWidth="1" />
              <text x={PAD.left - 10} y={y + 4} textAnchor="end" fontSize="12" fontWeight="700" fill="rgba(33,33,33,0.55)">
                {formatAxis(value)}
              </text>
            </g>
          );
        })}
        {/* 음수 구간이 있으면 0원 기준선을 또렷하게 — 어디부터 적자인지 한눈에 보이게. */}
        {minValue < 0 && (
          <line x1={PAD.left} y1={yAt(0)} x2={PAD.left + plotW} y2={yAt(0)} stroke="rgba(33,33,33,0.45)" strokeWidth="1.5" />
        )}

        {current.map((point, index) =>
          index % labelStride === 0 || index === count - 1 ? (
            <text key={point.x} x={xAt(index)} y={viewH - 10} textAnchor="middle" fontSize="12" fontWeight="700" fill="rgba(33,33,33,0.55)">
              {formatAxisLabel(point.x, granularity)}
            </text>
          ) : null
        )}

        <g clipPath={`url(#${clipId})`}>
          {compare.length > 0 && (
            <path d={pathOf(compare)} fill="none" stroke={COMPARE_COLOR} strokeWidth="2.5" strokeDasharray="6 4" strokeLinejoin="round" strokeLinecap="round" />
          )}
          <path d={pathOf(current)} fill="none" stroke={CURRENT_COLOR} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {/* 점이 하나뿐이면 선이 안 보이므로 점을 찍어 준다. */}
          {count === 1 && <circle cx={xAt(0)} cy={yAt(current[0].y)} r="4" fill={CURRENT_COLOR} />}
        </g>

        {hovered !== null && (
          <g>
            <line x1={xAt(hovered)} y1={PAD.top} x2={xAt(hovered)} y2={PAD.top + plotH} stroke="rgba(33,33,33,0.28)" strokeWidth="1" />
            {compare[hovered] && <circle cx={xAt(hovered)} cy={yAt(compare[hovered].y)} r="4" fill={COMPARE_COLOR} />}
            <circle cx={xAt(hovered)} cy={yAt(current[hovered].y)} r="4.5" fill={CURRENT_COLOR} />
          </g>
        )}
      </svg>
    </div>
  );
}
