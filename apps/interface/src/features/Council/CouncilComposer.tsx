"use client";

import React from "react";
import { Lock, Mic, MessageSquare, Send } from "lucide-react";

import {
  COUNCIL_CATEGORIES,
  COUNCIL_ROOM_SIZES,
  categoryByKey,
  type CouncilCategoryKey,
  type CouncilMode,
  type CouncilRoomSize,
} from "./council-data";

const QUICK_CATEGORIES: CouncilCategoryKey[] = [
  "play",
  "creative",
  "career",
  "relationships",
  "private-council",
  "build",
  "research",
];

type Props = {
  prompt: string;
  categoryKey: CouncilCategoryKey;
  size: CouncilRoomSize;
  mode: CouncilMode;
  onPromptChange: (value: string) => void;
  onCategoryChange: (value: CouncilCategoryKey) => void;
  onSizeChange: (value: CouncilRoomSize) => void;
  onModeChange: (value: CouncilMode) => void;
  onStart: () => void;
};

export function CouncilComposer({
  prompt,
  categoryKey,
  size,
  mode,
  onPromptChange,
  onCategoryChange,
  onSizeChange,
  onModeChange,
  onStart,
}: Props) {
  const category = categoryByKey(categoryKey);
  const sizeIndex = COUNCIL_ROOM_SIZES.findIndex((item) => item.key === size);

  return (
    <section className="pearl-themed-app-surface grid gap-3 rounded-[8px] border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-white">Summon a room</div>
          <div className="mt-0.5 text-[11px] text-white/48">Private by default. Save or share only when you choose.</div>
        </div>
        <div className="inline-flex rounded border border-white/12 bg-black/20 p-1">
          <button
            type="button"
            onClick={() => onModeChange("text")}
            className={`inline-flex h-8 items-center gap-1.5 rounded px-2 text-[11px] ${mode === "text" ? "bg-white/14 text-white" : "text-white/55 hover:text-white"}`}
          >
            <MessageSquare size={13} />
            Text
          </button>
          <button
            type="button"
            onClick={() => onModeChange("voice")}
            className={`inline-flex h-8 items-center gap-1.5 rounded px-2 text-[11px] ${mode === "voice" ? "bg-white/14 text-white" : "text-white/55 hover:text-white"}`}
          >
            <Mic size={13} />
            Voice
          </button>
        </div>
      </div>

      <textarea
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder="What do you want to do?"
        className="min-h-[86px] resize-none rounded-[8px] border border-white/12 bg-black/24 p-3 text-sm leading-relaxed text-white outline-none placeholder:text-white/35 focus:border-white/30"
      />

      <div className="flex gap-2 overflow-x-auto pb-1">
        {QUICK_CATEGORIES.map((key) => {
          const item = categoryByKey(key);
          const selected = item.key === categoryKey;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onCategoryChange(item.key)}
              className={`shrink-0 rounded border px-2.5 py-1.5 text-[11px] font-bold ${selected ? "border-white/35 text-white" : "border-white/10 text-white/56 hover:text-white"}`}
              style={selected ? { backgroundColor: `${item.color}26` } : undefined}
            >
              {item.title}
            </button>
          );
        })}
        <select
          value={categoryKey}
          onChange={(event) => onCategoryChange(event.target.value as CouncilCategoryKey)}
          className="shrink-0 rounded border border-white/10 bg-black/35 px-2 py-1.5 text-[11px] text-white/70 outline-none"
          aria-label="Browse Council room categories"
        >
          {COUNCIL_CATEGORIES.map((item) => (
            <option key={item.key} value={item.key}>
              {item.title}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2 rounded-[8px] border border-white/10 bg-black/18 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold text-white">Room size</div>
            <div className="text-[10px] text-white/45">
              {COUNCIL_ROOM_SIZES[sizeIndex]?.label || "Solo"} - {COUNCIL_ROOM_SIZES[sizeIndex]?.hint || "Fast"}
            </div>
          </div>
          <div className="inline-flex items-center gap-1 rounded border border-white/10 bg-black/22 px-2 py-1 text-[10px] text-white/65">
            <Lock size={11} />
            Private Room
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={COUNCIL_ROOM_SIZES.length - 1}
          step={1}
          value={sizeIndex}
          onChange={(event) => onSizeChange(COUNCIL_ROOM_SIZES[Number(event.target.value)]?.key || "solo")}
          className="w-full accent-sky-300"
          aria-label="Council room size"
        />
        <div className="grid grid-cols-5 gap-1 text-center text-[10px] text-white/45">
          {COUNCIL_ROOM_SIZES.map((item) => (
            <span key={item.key} className={item.key === size ? "font-bold text-white" : ""}>
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onStart}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] border border-white/15 bg-white/12 text-sm font-bold text-white hover:bg-white/18"
        style={{ boxShadow: `0 0 26px ${category.color}26` }}
      >
        <Send size={15} />
        Start {category.title}
      </button>
    </section>
  );
}
