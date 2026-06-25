"use client";

import React from "react";
import { Globe2 } from "lucide-react";
import type { HistoryEra } from "./global-history-data";

interface Props {
  eras: HistoryEra[];
  activeEra: HistoryEra;
  onSelect: (id: string) => void;
}

export default function GlobalHistoryMap({ eras, activeEra, onSelect }: Props) {
  return (
    <section className="pearl-themed-app-panel relative min-h-[330px] overflow-hidden rounded-md border">
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(circle at 23% 38%, rgba(61,124,143,.45), transparent 16%), radial-gradient(circle at 65% 42%, rgba(86,118,86,.44), transparent 18%), radial-gradient(circle at 50% 72%, rgba(117,82,68,.38), transparent 14%), linear-gradient(135deg, #07131b 0%, #102331 52%, #171a27 100%)",
        }}
      />
      <div className="absolute inset-6 rounded-full border border-[#9dc8ff]/15 opacity-70" />
      <div className="absolute left-[8%] top-[18%] h-[55%] w-[25%] rounded-[45%] border border-[#8bdc9a]/20 bg-[#346d5c]/20 blur-[1px]" />
      <div className="absolute left-[47%] top-[16%] h-[37%] w-[35%] rounded-[50%] border border-[#f3d483]/20 bg-[#6b7045]/20 blur-[1px]" />
      <div className="absolute left-[55%] top-[55%] h-[22%] w-[18%] rounded-[50%] border border-[#f0a0a0]/20 bg-[#7a4547]/20 blur-[1px]" />
      <div className="pearl-themed-app-panel absolute left-4 top-4 flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
        <Globe2 size={15} color={activeEra.color} />
        Touch a beacon to jump eras
      </div>

      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {eras.map((era) => (
          <line
            key={era.id}
            x1={activeEra.coordinate.x}
            y1={activeEra.coordinate.y}
            x2={era.coordinate.x}
            y2={era.coordinate.y}
            stroke={era.id === activeEra.id ? activeEra.color : "rgba(255,255,255,.12)"}
            strokeWidth={era.id === activeEra.id ? 0 : 0.18}
            strokeDasharray="1.1 1.4"
          />
        ))}
      </svg>

      {eras.map((era) => {
        const selected = era.id === activeEra.id;
        return (
          <button
            key={era.id}
            type="button"
            onClick={() => onSelect(era.id)}
            className="absolute flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border transition-transform hover:scale-110"
            style={{
              left: `${era.coordinate.x}%`,
              top: `${era.coordinate.y}%`,
              color: era.color,
              borderColor: selected ? era.color : "rgba(255,255,255,.18)",
              background: selected ? era.glow : "rgba(8,13,22,.78)",
              boxShadow: selected ? `0 0 42px ${era.glow}` : "none",
            }}
            aria-label={`Open ${era.title}`}
          >
            <era.Icon size={20} />
          </button>
        );
      })}
    </section>
  );
}
