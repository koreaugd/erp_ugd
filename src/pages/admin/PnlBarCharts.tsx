// src/pages/admin/PnlBarCharts.tsx
// 분석 탭 막대 차트 2종 — 로컬 05 대시보드 PNG의 차트 문법을 웹으로 옮긴 것(라이브러리 없이 인라인 SVG).
//   · PnlComboChart : 월별 그룹 막대(매출·이익) + 우측 % 축 꺾은선(이익률) — branch/hq PNG의 "매출 & 이익 추이"
//   · PnlHBarChart  : 지점별 가로 그룹 막대 — hq PNG의 순위 막대 문법
// 색은 관리자 토큰 계열만 쓴다: 막대 = alice(#E6EBF3)/honey(#E0EBDC)/vanilla(#F4F2CC), 선 = 액션 블루 #2E6DB4.
import { useState } from "react";
import { formatCompactWon } from "./SalesLineChart";

const BAR_TONES: Record<string, string> = {
  alice: "#C8D4E6",   // 연한 엘리스보다 한 단계 진하게(연한 배경 위에서 막대가 보여야 함)
  honey: "#BBD3B3",
  vanilla: "#E4E48A",
};
const LINE_COLOR = "#2E6DB4";

export interface ComboSeries { label: string; tone: "alice" | "honey" | "vanilla"; values: Array<number | null>; }

/**
 * 월별 그룹 막대 + 우측 % 선. categories 와 각 series.values 는 같은 길이여야 하며,
 * null 값은 그 달 막대를 그리지 않는다(0으로 속이지 않음). 음수 값은 0선 아래로 내려 그린다.
 */
export function PnlComboChart({
  categories,
  series,
  line,
  formatBar = formatCompactWon,
  lineAxisFormat = (v: number) => `${(v * 100).toFixed(0)}%`,
  lineValueFormat = (v: number) => `${(v * 100).toFixed(1)}%`,
  showValues = false,
  lineZeroBase = true,
}: {
  categories: string[];               // x축 라벨(예: "3월")
  series: ComboSeries[];              // 막대 1~2개 묶음
  line?: { label: string; values: Array<number | null> }; // 우측 축 꺾은선(기본 해석: 0.12 = 12%)
  formatBar?: (value: number) => string;
  /** 우측 축 눈금/hover 포맷 — 영수건수처럼 %가 아닌 선을 얹을 때 바꾼다 */
  lineAxisFormat?: (value: number) => string;
  lineValueFormat?: (value: number) => string;
  /** 막대 위·선 점 위에 값 라벨을 찍는다(05 PNG 문법) */
  showValues?: boolean;
  /** 우축을 0부터 그린다(기본). false 면 값 구간에 맞춰 확대해 변화를 크게 보여준다. */
  lineZeroBase?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // viewBox 는 `w-full h-auto` 로 렌더되므로 가로:세로 비가 곧 화면 높이를 정한다.
  // 차트는 전부 2열 그리드(.admin-chart-grid) 안에 들어가므로 반폭 기준 비율 하나면 된다.
  const W = 520, H = 320;
  // 상한에 이미 20% 여유가 있어 상단 패딩은 계열 2개 라벨이 어긋날 자리(11px)만 더 준다.
  const PAD = { top: showValues ? (series.length > 1 ? 26 : 18) : 14, right: line ? 48 : 16, bottom: 30, left: 56 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const count = categories.length;
  if (count === 0) return <p className="py-10 text-center text-xs font-bold text-gray-400">표시할 데이터가 없습니다.</p>;

  // [축 범위 — 2026-07-22 사용자 지정]
  // 막대(좌축): 0 기준 + **최댓값보다 20% 높은 값이 상한**. 눈금을 예쁜 수로 올리면(niceCeil) 막대가
  // 축 아래쪽에 눌려 붙어 변화가 안 보여서, 데이터에 딱 맞춘 여유폭만 준다.
  const allBarValues = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const maxBarRaw = Math.max(1, ...allBarValues);
  const maxBar = maxBarRaw * 1.2;
  const minRaw = Math.min(0, ...allBarValues);
  const minBar = minRaw < 0 ? minRaw * 1.2 : 0; // 막대는 0 기준(음수가 있으면 그만큼만 내린다)
  const span = maxBar - minBar;
  const yAt = (v: number) => PAD.top + plotH - ((v - minBar) / span) * plotH;

  // 선(우축): **최댓값보다 10% 높은 값이 상한**. lineZeroBase=false 면 아래도 최솟값에 붙여
  // 변화 폭을 크게 보여준다(비율·객단가처럼 값이 좁은 구간에 몰린 계열).
  const lineValues = (line?.values || []).filter((v): v is number => v !== null);
  const lineHi = lineValues.length ? Math.max(...lineValues) : 1;
  const lineLo = lineValues.length ? Math.min(...lineValues) : 0;
  const lineMax = lineHi >= 0 ? lineHi * 1.1 : lineHi * 0.9;
  const lineBase = lineZeroBase
    ? Math.min(0, lineLo * 1.1)
    : lineLo - Math.max((lineHi - lineLo) * 0.35, Math.abs(lineHi) * 0.05);
  const lineSpan = lineMax - lineBase || 1; // 값이 전부 같으면 0 나눗셈이 되므로 최소 1
  const lyAt = (v: number) => PAD.top + plotH - ((v - lineBase) / lineSpan) * plotH;

  const slotW = plotW / count;
  const groupW = slotW * 0.62;
  const barW = groupW / Math.max(1, series.length);
  const xAt = (i: number) => PAD.left + slotW * i + slotW / 2;

  /** 막대 값 라벨의 baseline y. 계열이 2개면 계열마다 한 줄씩 어긋나게 올린다. */
  const barLabelY = (i: number, si: number) => {
    const v = series[si].values[i];
    if (v === null) return 0;
    const top = Math.min(yAt(0), yAt(v));
    return Math.max(11, top - 4 - (series.length > 1 ? si * 11 : 0));
  };
  /** 그 달 막대 라벨 중 가장 위(작은 y). 선 라벨을 위/아래 어디에 둘지 판단하는 기준. */
  const topBarLabelY = (i: number) => {
    const ys = series.map((_, si) => (series[si].values[i] === null ? null : barLabelY(i, si)))
      .filter((y): y is number => y !== null);
    return ys.length ? Math.min(...ys) : Number.POSITIVE_INFINITY;
  };

  return (
    <div className="admin-sales-chart">
      <div className="flex flex-wrap items-center gap-3 pb-1">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 text-[11px] font-black text-[#212121]">
            <span style={{ background: BAR_TONES[s.tone], width: 14, height: 9, display: "inline-block", border: "1px solid rgba(33,33,33,0.35)" }} />
            {s.label}
          </span>
        ))}
        {line && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-black text-[#212121]">
            <svg width="18" height="8" aria-hidden="true"><line x1="0" y1="4" x2="18" y2="4" stroke={LINE_COLOR} strokeWidth="2.5" /></svg>
            {line.label}
          </span>
        )}
        {hover !== null && (
          <span className="ml-auto text-[11px] font-black text-[#212121] font-mono">
            {categories[hover]} · {series.map((s) => `${s.label} ${s.values[hover] === null ? "—" : formatBar(s.values[hover] as number)}`).join(" · ")}
            {line && line.values[hover] !== null ? ` · ${line.label} ${lineValueFormat(line.values[hover] as number)}` : ""}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${series.map((s) => s.label).join("·")} 월별 막대그래프`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (!rect.width) return;
          const vx = ((e.clientX - rect.left) / rect.width) * W;
          setHover(Math.min(count - 1, Math.max(0, Math.floor((vx - PAD.left) / slotW))));
        }}>
        {[0, 0.5, 1].map((r) => {
          const v = maxBar - span * r;
          const y = PAD.top + plotH * r;
          return (
            <g key={r}>
              <line x1={PAD.left} y1={y} x2={PAD.left + plotW} y2={y} stroke="rgba(33,33,33,0.10)" />
              <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize="11" fontWeight="700" fill="rgba(33,33,33,0.55)">{formatBar(v)}</text>
            </g>
          );
        })}
        {minBar < 0 && <line x1={PAD.left} y1={yAt(0)} x2={PAD.left + plotW} y2={yAt(0)} stroke="rgba(33,33,33,0.45)" strokeWidth="1.5" />}
        {line && [0, 0.5, 1].map((r) => {
          const v = lineMax - lineSpan * r;
          return (
            <text key={`l${r}`} x={W - PAD.right + 8} y={PAD.top + plotH * r + 4} fontSize="11" fontWeight="700" fill={LINE_COLOR}>
              {lineAxisFormat(v)}
            </text>
          );
        })}
        {categories.map((c, i) => (
          <text key={c + i} x={xAt(i)} y={H - 8} textAnchor="middle" fontSize="11" fontWeight="700" fill="rgba(33,33,33,0.55)">{c}</text>
        ))}
        {hover !== null && <rect x={PAD.left + slotW * hover} y={PAD.top} width={slotW} height={plotH} fill="rgba(33,33,33,0.05)" />}
        {series.map((s, si) =>
          s.values.map((v, i) => {
            if (v === null) return null;
            const x = xAt(i) - groupW / 2 + si * barW;
            const y0 = yAt(0), y1 = yAt(v);
            return (
              <g key={`${s.label}-${i}`}>
                <rect x={x} width={Math.max(2, barW - 2)}
                  y={Math.min(y0, y1)} height={Math.max(1, Math.abs(y0 - y1))}
                  fill={BAR_TONES[s.tone]} stroke="rgba(33,33,33,0.35)" strokeWidth="0.75" />
                {showValues && (
                  // 값 라벨: 각 막대 **중앙**에 검정 글씨로. 상한에 20% 여유를 줘서 세로 자리는 넉넉하다.
                  // 다만 계열이 2개면 라벨 폭(≈26px)이 막대 간격(≈21px)보다 넓어 옆 라벨과 겹치므로,
                  // 그때만 계열별로 한 줄씩 어긋나게 띄운다(Codex 실측 지적: 약 4.5px 겹침).
                  // 흰 테두리(paint-order=stroke)를 둘러 **선이 라벨 위를 지나가도 글자가 묻히지 않게** 한다.
                  <text
                    x={x + Math.max(2, barW - 2) / 2}
                    y={barLabelY(i, si)}
                    textAnchor="middle" fontSize="9.5" fontWeight="900" fill="#212121"
                    stroke="#ffffff" strokeWidth="2.6" paintOrder="stroke" strokeLinejoin="round"
                  >{formatBar(v)}</text>
                )}
              </g>
            );
          })
        )}
        {line && (
          <>
            <path
              // null 달 앞뒤를 선으로 잇지 않는다 — 빈 달을 이어 그리면 데이터 공백이 연속 추세처럼 보인다(Codex P1).
              // 직전 값이 null 이면 M(새 시작)으로 다시 찍어 선이 끊긴 채 남게 한다.
              d={line.values.map((v, i) => (v === null ? "" : `${i === 0 || line.values[i - 1] === null ? "M" : "L"} ${xAt(i).toFixed(1)} ${lyAt(v).toFixed(1)}`)).join(" ")}
              fill="none" stroke={LINE_COLOR} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {line.values.map((v, i) => {
              if (v === null) return null;
              const cy = lyAt(v);
              const label = lineValueFormat(v);
              // 선 값 라벨은 기본적으로 점 위에 두되, 그 자리가 막대 라벨과 겹치면 **점 아래로 내린다**.
              // (막대 높이와 이익률이 우연히 같은 높이에 오면 두 숫자가 포개져 읽을 수 없었다 — 2026-07-22)
              // 라벨끼리 세로로 11px 이상 떨어져야 안 겹친다.
              const above = cy - 9 <= topBarLabelY(i) - 11;
              const ty = above
                ? Math.max(11, cy - 9)
                : Math.min(PAD.top + plotH - 3, cy + 16);
              // 흰 칩 + 선 색 테두리 — 어떤 배경 위에 놓이든 읽히고, 이 숫자가 '선의 값'임을 알려 준다.
              // 칩이 슬롯보다 넓으면 이웃 달 칩과 부딪히므로 슬롯 폭 안으로 제한하고, 그만큼 글자도 좁힌다
              // (긴 원화 라벨 "1,234,567원" 같은 경우 — Codex P2).
              const wanted = label.length * 6 + 10;
              const chipW = Math.min(wanted, slotW - 4);
              const labelScale = chipW / wanted;
              return (
                <g key={i}>
                  <circle cx={xAt(i)} cy={cy} r="3" fill={LINE_COLOR} />
                  {showValues && (
                    <>
                      <rect x={xAt(i) - chipW / 2} y={ty - 9.5} width={chipW} height={13} rx="4"
                        fill="#ffffff" stroke={LINE_COLOR} strokeWidth="0.8" />
                      <text x={xAt(i)} y={ty} textAnchor="middle" fontSize={(9.5 * Math.max(0.8, labelScale)).toFixed(2)}
                        fontWeight="900" fill={LINE_COLOR}>{label}</text>
                    </>
                  )}
                </g>
              );
            })}
          </>
        )}
      </svg>
    </div>
  );
}

export interface HBarItem { label: string; values: Array<number>; note?: string; }

/** 지점별 가로 그룹 막대 — 이름·수치가 같이 읽히는 순위 차트. 음수는 빨강으로 표시. */
export function PnlHBarChart({
  items,
  series,
  format = formatCompactWon,
}: {
  items: HBarItem[];                                    // 위→아래(정렬은 호출부)
  series: Array<{ label: string; tone: "alice" | "honey" | "vanilla" }>;
  format?: (value: number) => string;
}) {
  if (items.length === 0) return <p className="py-10 text-center text-xs font-bold text-gray-400">표시할 지점이 없습니다.</p>;
  const max = Math.max(1, ...items.flatMap((it) => it.values.map((v) => Math.abs(v))));
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-3 pb-1">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 text-[11px] font-black text-[#212121]">
            <span style={{ background: BAR_TONES[s.tone], width: 14, height: 9, display: "inline-block", border: "1px solid rgba(33,33,33,0.35)" }} />
            {s.label}
          </span>
        ))}
      </div>
      {items.map((it) => (
        <div key={it.label} className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2">
          <span className="text-[11px] font-black text-[#212121] truncate" title={it.label}>{it.label}</span>
          <div className="space-y-0.5">
            {it.values.map((v, vi) => (
              <div key={vi} className="flex items-center gap-1.5">
                <div className="admin-hbar-track">
                  <div
                    className="admin-hbar-fill"
                    style={{ width: `${(Math.abs(v) / max) * 100}%`, background: v < 0 ? "#FDE2E2" : BAR_TONES[series[vi]?.tone || "alice"], borderColor: v < 0 ? "#C93A3A" : "rgba(33,33,33,0.35)" }}
                  />
                </div>
                <span className={`text-[10px] font-black font-mono whitespace-nowrap ${v < 0 ? "admin-rate-hot" : "text-gray-600"}`}>{format(v)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
