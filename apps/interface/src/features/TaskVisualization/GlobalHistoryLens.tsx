"use client";

import React from "react";
import { Eye, Lightbulb, Scale, ShipWheel } from "lucide-react";
import type { HistoryEra } from "./global-history-data";

export type HistoryLens = "trade" | "power" | "ideas";

interface Props {
  activeEra: HistoryEra;
  lens: HistoryLens;
  onLensChange: (lens: HistoryLens) => void;
}

const lenses: Array<{ id: HistoryLens; label: string; Icon: typeof ShipWheel }> = [
  { id: "trade", label: "Trade", Icon: ShipWheel },
  { id: "power", label: "Power", Icon: Scale },
  { id: "ideas", label: "Ideas", Icon: Lightbulb },
];

export default function GlobalHistoryLens({ activeEra, lens, onLensChange }: Props) {
  return (
    <section className="pearl-themed-app-panel rounded-md border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Eye size={16} color={activeEra.color} />
          Lens Console
        </div>
        <div className="pearl-themed-app-panel grid grid-cols-3 gap-1 rounded-md border p-1">
          {lenses.map(({ id, label, Icon }) => {
            const selected = id === lens;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onLensChange(id)}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded px-2 text-[11px] transition-colors"
                style={{
                  color: selected ? "#09111a" : "var(--pearl-text)",
                  background: selected ? activeEra.color : "transparent",
                }}
                aria-pressed={selected}
              >
                <Icon size={13} />
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4 rounded-md border p-4" style={{ borderColor: activeEra.color, background: activeEra.glow }}>
        <p className="text-[11px] uppercase text-[#fff8e8]/75">{activeEra.title} through {lens}</p>
        <p className="mt-2 text-sm leading-6 text-[#fff8e8]">{activeEra.lensNotes[lens]}</p>
      </div>
    </section>
  );
}
