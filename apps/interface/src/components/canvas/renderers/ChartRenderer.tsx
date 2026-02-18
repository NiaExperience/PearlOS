'use client';

import React, { useMemo } from 'react';
import type { ChartContent, LineChartData, BarChartData, PieChartData } from '../types';

// ─── Color Palette ───────────────────────────────────────────────────────────

const CHART_COLORS = [
  '#818cf8', // indigo-400
  '#34d399', // emerald-400
  '#f97316', // orange-500
  '#f472b6', // pink-400
  '#60a5fa', // blue-400
  '#a78bfa', // violet-400
  '#fbbf24', // amber-400
  '#2dd4bf', // teal-400
];

function getColor(index: number, custom?: string): string {
  return custom || CHART_COLORS[index % CHART_COLORS.length];
}

// ─── SVG-based Charts (no external deps) ─────────────────────────────────────

function LineChart({ data }: { data: LineChartData }) {
  const { series, xLabel, yLabel } = data;

  const allValues = series.flatMap(s => s.data.map(d => d.value));
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal || 1;

  const W = 600, H = 300, PAD = 50;
  const chartW = W - PAD * 2;
  const chartH = H - PAD * 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(frac => {
        const y = PAD + chartH * (1 - frac);
        const val = minVal + range * frac;
        return (
          <g key={frac}>
            <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="#334155" strokeWidth={0.5} />
            <text x={PAD - 8} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize={10}>
              {val.toFixed(range > 10 ? 0 : 1)}
            </text>
          </g>
        );
      })}

      {/* Series */}
      {series.map((s, si) => {
        const color = getColor(si, s.color);
        const maxLen = Math.max(...series.map(s => s.data.length));
        const points = s.data.map((d, i) => {
          const x = PAD + (i / Math.max(maxLen - 1, 1)) * chartW;
          const y = PAD + chartH * (1 - (d.value - minVal) / range);
          return `${x},${y}`;
        });
        return (
          <g key={si}>
            <polyline
              points={points.join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {s.data.map((d, i) => {
              const x = PAD + (i / Math.max(s.data.length - 1, 1)) * chartW;
              const y = PAD + chartH * (1 - (d.value - minVal) / range);
              return <circle key={i} cx={x} cy={y} r={3} fill={color} />;
            })}
          </g>
        );
      })}

      {/* X-axis labels */}
      {series[0]?.data.map((d, i) => {
        const maxLen = series[0].data.length;
        // Show max 10 labels
        if (maxLen > 10 && i % Math.ceil(maxLen / 10) !== 0) return null;
        const x = PAD + (i / Math.max(maxLen - 1, 1)) * chartW;
        return (
          <text key={i} x={x} y={H - 10} textAnchor="middle" fill="#94a3b8" fontSize={9}>
            {d.time}
          </text>
        );
      })}

      {/* Axis labels */}
      {xLabel && <text x={W / 2} y={H - 2} textAnchor="middle" fill="#64748b" fontSize={11}>{xLabel}</text>}
      {yLabel && (
        <text x={12} y={H / 2} textAnchor="middle" fill="#64748b" fontSize={11} transform={`rotate(-90 12 ${H / 2})`}>
          {yLabel}
        </text>
      )}

      {/* Legend */}
      {series.length > 1 && series.map((s, i) => (
        <g key={i} transform={`translate(${PAD + i * 100}, ${PAD - 15})`}>
          <rect width={12} height={12} rx={2} fill={getColor(i, s.color)} />
          <text x={16} y={10} fill="#cbd5e1" fontSize={10}>{s.name}</text>
        </g>
      ))}
    </svg>
  );
}

function BarChart({ data }: { data: BarChartData }) {
  const { categories, series, xLabel, yLabel } = data;
  const allValues = series.flatMap(s => s.data);
  const maxVal = Math.max(...allValues, 0);

  const W = 600, H = 300, PAD = 50;
  const chartW = W - PAD * 2;
  const chartH = H - PAD * 2;
  const barGroupWidth = chartW / categories.length;
  const barWidth = Math.min(barGroupWidth * 0.7 / series.length, 40);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map(frac => {
        const y = PAD + chartH * (1 - frac);
        return (
          <g key={frac}>
            <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="#334155" strokeWidth={0.5} />
            <text x={PAD - 8} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize={10}>
              {(maxVal * frac).toFixed(0)}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {categories.map((cat, ci) => {
        const groupX = PAD + ci * barGroupWidth + barGroupWidth / 2;
        return (
          <g key={ci}>
            {series.map((s, si) => {
              const barH = (s.data[ci] / (maxVal || 1)) * chartH;
              const x = groupX - (series.length * barWidth) / 2 + si * barWidth;
              const y = PAD + chartH - barH;
              return (
                <rect
                  key={si}
                  x={x}
                  y={y}
                  width={barWidth - 2}
                  height={barH}
                  rx={3}
                  fill={getColor(si, s.color)}
                  opacity={0.85}
                />
              );
            })}
            <text x={groupX} y={H - PAD + 16} textAnchor="middle" fill="#94a3b8" fontSize={9}>
              {cat}
            </text>
          </g>
        );
      })}

      {xLabel && <text x={W / 2} y={H - 2} textAnchor="middle" fill="#64748b" fontSize={11}>{xLabel}</text>}
      {yLabel && (
        <text x={12} y={H / 2} textAnchor="middle" fill="#64748b" fontSize={11} transform={`rotate(-90 12 ${H / 2})`}>
          {yLabel}
        </text>
      )}

      {series.length > 1 && series.map((s, i) => (
        <g key={i} transform={`translate(${PAD + i * 100}, ${PAD - 15})`}>
          <rect width={12} height={12} rx={2} fill={getColor(i, s.color)} />
          <text x={16} y={10} fill="#cbd5e1" fontSize={10}>{s.name}</text>
        </g>
      ))}
    </svg>
  );
}

function PieChart({ data }: { data: PieChartData }) {
  const total = data.segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const CX = 150, CY = 150, R = 120;

  let cumAngle = -Math.PI / 2;
  const slices = data.segments.map((seg, i) => {
    const angle = (seg.value / total) * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;

    const x1 = CX + R * Math.cos(startAngle);
    const y1 = CY + R * Math.sin(startAngle);
    const x2 = CX + R * Math.cos(endAngle);
    const y2 = CY + R * Math.sin(endAngle);
    const largeArc = angle > Math.PI ? 1 : 0;

    const midAngle = startAngle + angle / 2;
    const labelR = R * 0.65;
    const lx = CX + labelR * Math.cos(midAngle);
    const ly = CY + labelR * Math.sin(midAngle);

    return { seg, i, x1, y1, x2, y2, largeArc, lx, ly, pct: ((seg.value / total) * 100).toFixed(1) };
  });

  return (
    <div className="flex items-center gap-6 flex-wrap justify-center">
      <svg viewBox="0 0 300 300" className="w-64 h-64 flex-shrink-0">
        {slices.map(({ seg, i, x1, y1, x2, y2, largeArc, lx, ly, pct }) => (
          <g key={i}>
            <path
              d={`M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`}
              fill={getColor(i, seg.color)}
              stroke="#1e293b"
              strokeWidth={2}
            />
            {parseFloat(pct) > 5 && (
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={11} fontWeight="bold">
                {pct}%
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="flex flex-col gap-1.5">
        {data.segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-sm text-slate-300">
            <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: getColor(i, seg.color) }} />
            <span>{seg.label}</span>
            <span className="text-slate-500 ml-auto">{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main ChartRenderer ──────────────────────────────────────────────────────

interface Props {
  content: ChartContent;
}

export default function ChartRenderer({ content }: Props) {
  const { data } = content;

  return (
    <div className="canvas-chart px-6 py-4">
      {content.title && (
        <h2 className="text-xl font-bold text-slate-100 mb-4">{content.title}</h2>
      )}
      <div className="bg-slate-900/50 border border-slate-700/40 rounded-xl p-4">
        {data.chartType === 'line' && <LineChart data={data} />}
        {data.chartType === 'bar' && <BarChart data={data} />}
        {data.chartType === 'pie' && <PieChart data={data} />}
      </div>
    </div>
  );
}
