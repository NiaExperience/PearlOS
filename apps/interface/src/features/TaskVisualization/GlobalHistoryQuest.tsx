"use client";

import React, { useEffect, useState } from "react";
import { Check, RotateCcw, Trophy, X } from "lucide-react";
import type { HistoryEra } from "./global-history-data";

interface Props {
  activeEra: HistoryEra;
  solved: string[];
  onSolve: (id: string) => void;
  onReset: () => void;
}

export default function GlobalHistoryQuest({ activeEra, solved, onSolve, onReset }: Props) {
  const isSolved = solved.includes(activeEra.id);
  const [picked, setPicked] = useState<number | null>(null);
  const correct = picked === activeEra.puzzle.answer;

  useEffect(() => {
    setPicked(null);
  }, [activeEra.id]);

  function choose(index: number) {
    setPicked(index);
    if (index === activeEra.puzzle.answer) {
      onSolve(activeEra.id);
    }
  }

  function resetJournal() {
    setPicked(null);
    onReset();
  }

  return (
    <section className="pearl-themed-app-panel rounded-md border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Trophy size={16} color={activeEra.color} />
          Expedition Challenge
        </div>
        <button
          type="button"
          onClick={resetJournal}
          className="pearl-themed-app-panel inline-flex h-8 w-8 items-center justify-center rounded-md border hover:opacity-90"
          aria-label="Reset solved challenges"
        >
          <RotateCcw size={14} />
        </button>
      </div>
      <div className="mt-4 rounded-md border p-4" style={{ borderColor: activeEra.color, background: activeEra.glow }}>
        <p className="text-xs uppercase text-[#fff8e8]/80">Dispatch</p>
        <p className="mt-2 text-sm leading-6 text-[#fff8e8]">{activeEra.dispatch}</p>
      </div>
      <div className="pearl-themed-app-panel mt-4 rounded-md border p-3">
        <p className="pearl-themed-app-muted text-[11px] uppercase">Decode the artifact</p>
        <p className="mt-2 text-sm leading-6">{activeEra.puzzle.prompt}</p>
        <div className="mt-3 grid gap-2">
          {activeEra.puzzle.options.map((option, index) => {
            const selected = picked === index;
            const isAnswer = activeEra.puzzle.answer === index;
            return (
              <button
                key={option}
                type="button"
                onClick={() => choose(index)}
                className="flex min-h-10 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs transition-colors hover:opacity-90"
                style={{
                  borderColor: selected ? (isAnswer ? activeEra.color : "#f0a0a0") : "rgba(255,255,255,.12)",
                  background: selected ? (isAnswer ? activeEra.glow : "rgba(240,160,160,.16)") : "rgba(255,255,255,.03)",
                }}
              >
                <span>{option}</span>
                {selected && (isAnswer ? <Check size={14} color={activeEra.color} /> : <X size={14} color="#f0a0a0" />)}
              </button>
            );
          })}
        </div>
        {picked !== null && (
          <p className="pearl-themed-app-muted mt-3 text-[12px] leading-5">
            {correct ? activeEra.puzzle.reveal : "Not that timeline. Try the clue in the artifact again."}
          </p>
        )}
        {isSolved && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px]" style={{ borderColor: activeEra.color }}>
            <Check size={13} color={activeEra.color} />
            Logged in field journal
          </div>
        )}
      </div>
      <div className="mt-4 grid grid-cols-6 gap-1.5" aria-label={`${solved.length} challenges solved`}>
        {Array.from({ length: 6 }).map((_, index) => (
          <span
            key={index}
            className="h-2 rounded-full"
            style={{ background: index < solved.length ? activeEra.color : "rgba(255,255,255,.12)" }}
          />
        ))}
      </div>
    </section>
  );
}
