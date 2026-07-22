// src/pages/admin/PnlScatterChart.tsx
// 분석 탭 지점 포지셔닝 산점도 — 로컬 05 본사 차트 대시보드(hq_charts.html)의 4분면 차트를 웹으로 옮긴 것.
// 평균선 두 개로 사분면을 나누고, 각 지점을 버블(면적=크기값)로 찍는다. 라이브러리 없이 인라인 SVG.
import { useState } from "react";

export interface ScatterPoint {
  label: string;
  x: number;
  y: number;
  /** 버블 크기(선택) — 예: Prime Cost. 없으면 균일 크기 */
  size?: number;
}

const VIEW_W = 960;
const VIEW_H = 420;
const PAD = { top: 20, right: 24, bottom: 42, left: 72 };
const DOT_COLOR = "#2E6DB4";

export function PnlScatterChart({
  points,
  xLabel,
  yLabel,
  formatX,
  formatY,
  quadrantLabels,
  compact = false,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  /** [좌상, 우상, 좌하, 우하] 사분면 설명(선택) */
  quadrantLabels?: [string, string, string, string];
  /** 반폭 카드(1행 2그래프)용 — viewBox 를 좁혀 글자가 상대적으로 커지게 한다. */
  compact?: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  if (points.length === 0) {
    return <p className="py-10 text-center text-xs font-bold text-gray-400">표시할 지점이 없습니다.</p>;
  }

  const viewW = compact ? 560 : VIEW_W;
  const viewH = compact ? 400 : VIEW_H;
  const plotW = viewW - PAD.left - PAD.right;
  const plotH = viewH - PAD.top - PAD.bottom;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  // 축 범위: 최소~최대에 10% 여백. 값이 하나뿐이거나 전부 같아도 0으로 나누지 않게 폭을 보장한다.
  const pad = (min: number, max: number): [number, number] => {
    const span = max - min || Math.abs(max) || 1;
    return [min - span * 0.1, max + span * 0.1];
  };
  const [xMin, xMax] = pad(Math.min(...xs), Math.max(...xs));
  const [yMin, yMax] = pad(Math.min(...ys), Math.max(...ys));
  const xAt = (v: number) => PAD.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const yAt = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length;

  // 음수 크기값(예: 비용이 음수인 달의 Prime)은 sqrt 가 NaN 을 만들어 점이 아예 안 그려진다 — 0으로 눌러 최소 크기로.
  const sizes = points.map((p) => Math.max(0, p.size ?? 1));
  const sizeMax = Math.max(...sizes, 1e-9);
  const radiusOf = (p: ScatterPoint) => 6 + 10 * Math.sqrt(Math.max(0, p.size ?? 1) / sizeMax); // 면적 비례

  return (
    <div className="admin-sales-chart">
      <svg viewBox={`0 0 ${viewW} ${viewH}`} className="w-full h-auto" role="img"
        aria-label={`${xLabel} 대비 ${yLabel} 지점 분포도`} onMouseLeave={() => setHovered(null)}>
        {/* 평균 기준선(사분면) */}
        <line x1={xAt(xMean)} y1={PAD.top} x2={xAt(xMean)} y2={PAD.top + plotH} stroke="rgba(33,33,33,0.18)" strokeDasharray="4 4" />
        <line x1={PAD.left} y1={yAt(yMean)} x2={PAD.left + plotW} y2={yAt(yMean)} stroke="rgba(33,33,33,0.18)" strokeDasharray="4 4" />
        {quadrantLabels && (
          <>
            <text x={PAD.left + 8} y={PAD.top + 16} fontSize="11" fontWeight="800" fill="rgba(33,33,33,0.35)">{quadrantLabels[0]}</text>
            <text x={PAD.left + plotW - 8} y={PAD.top + 16} fontSize="11" fontWeight="800" fill="rgba(33,33,33,0.35)" textAnchor="end">{quadrantLabels[1]}</text>
            <text x={PAD.left + 8} y={PAD.top + plotH - 8} fontSize="11" fontWeight="800" fill="rgba(33,33,33,0.35)">{quadrantLabels[2]}</text>
            <text x={PAD.left + plotW - 8} y={PAD.top + plotH - 8} fontSize="11" fontWeight="800" fill="rgba(33,33,33,0.35)" textAnchor="end">{quadrantLabels[3]}</text>
          </>
        )}
        {/* 축 라벨 */}
        <text x={PAD.left + plotW / 2} y={viewH - 8} fontSize="12" fontWeight="800" fill="rgba(33,33,33,0.55)" textAnchor="middle">{xLabel}</text>
        <text x={16} y={PAD.top + plotH / 2} fontSize="12" fontWeight="800" fill="rgba(33,33,33,0.55)" textAnchor="middle" transform={`rotate(-90 16 ${PAD.top + plotH / 2})`}>{yLabel}</text>
        {/* 축 눈금(최소·평균·최대) */}
        {[xMin, xMean, xMax].map((v, i) => (
          <text key={`x${i}`} x={xAt(v)} y={PAD.top + plotH + 16} fontSize="11" fontWeight="700" fill="rgba(33,33,33,0.45)" textAnchor="middle">{formatX(v)}</text>
        ))}
        {[yMin, yMean, yMax].map((v, i) => (
          <text key={`y${i}`} x={PAD.left - 8} y={yAt(v) + 4} fontSize="11" fontWeight="700" fill="rgba(33,33,33,0.45)" textAnchor="end">{formatY(v)}</text>
        ))}
        {/* 버블 + 지점명 */}
        {points.map((p) => (
          <g key={p.label} onMouseEnter={() => setHovered(p.label)}>
            <circle cx={xAt(p.x)} cy={yAt(p.y)} r={radiusOf(p)}
              fill={DOT_COLOR} fillOpacity={hovered === p.label ? 0.85 : 0.45}
              stroke={DOT_COLOR} strokeWidth="1.5" />
            <text x={xAt(p.x)} y={yAt(p.y) - radiusOf(p) - 4} fontSize="11"
              fontWeight={hovered === p.label ? 900 : 700}
              fill={hovered === p.label ? "#212121" : "rgba(33,33,33,0.6)"} textAnchor="middle">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
      {hovered !== null && (() => {
        const p = points.find((item) => item.label === hovered);
        return p ? (
          <p className="text-[11px] font-black text-[#212121] font-mono text-right">
            {p.label} · {xLabel} {formatX(p.x)} · {yLabel} {formatY(p.y)}
          </p>
        ) : null;
      })()}
    </div>
  );
}
