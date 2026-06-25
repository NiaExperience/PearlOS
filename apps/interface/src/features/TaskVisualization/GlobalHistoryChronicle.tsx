"use client";

import React from "react";
import { Sparkles } from "lucide-react";
import type { HistoryEra } from "./global-history-data";

interface Props {
  eras: HistoryEra[];
  activeEra: HistoryEra;
  onSelect: (id: string) => void;
}

export default function GlobalHistoryChronicle({ eras, activeEra, onSelect }: Props) {
  return (
    <section className="pearl-themed-app-panel rounded-md border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm">Chronicle Rail</h3>
          <p className="pearl-themed-app-muted mt-1 text-[11px]">Six jump points through connected world history.</p>
        </div>
        <Sparkles size={18} color={activeEra.color} />
      </div>
      <div className="mt-4 grid gap-2">
        {eras.map((era) => {
          const selected = era.id === activeEra.id;
          return (
            <button
              key={era.id}
              type="button"
              onClick={() => onSelect(era.id)}
              className="grid grid-cols-[88px_1fr] gap-3 rounded-md border p-3 text-left transition-colors hover:bg-white/[0.04]"
              style={{
                borderColor: selected ? era.color : "rgba(255,255,255,.1)",
                background: selected ? era.glow : "rgba(255,255,255,.02)",
              }}
            >
              <div className="pearl-themed-app-muted text-[10px] uppercase">{era.years}</div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <era.Icon size={15} color={era.color} />
                  <span className="truncate">{era.title}</span>
                </div>
                <p className="pearl-themed-app-muted mt-1 line-clamp-2 text-[11px] leading-5">{era.region}</p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
