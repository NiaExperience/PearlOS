"use client";

import React from "react";
import { Lock, Mic, MessageSquare } from "lucide-react";

import {
  agentsForRoom,
  categoryByKey,
  roomSizeByKey,
  type CouncilCategoryKey,
  type CouncilMode,
  type CouncilRoomSize,
} from "./council-data";

const SPRITES = [
  "/agency-assets/agents/Opus.png",
  "/agency-assets/agents/DeepSeek.png",
  "/agency-assets/agents/Gemini.png",
  "/agency-assets/agents/Kimi.png",
  "/agency-assets/agents/Qwen.png",
  "/agency-assets/agents/Grok.png",
  "/agency-assets/agents/NanoBanana.png",
];

const POSITIONS = [
  { left: "46%", bottom: "10%" },
  { left: "25%", bottom: "8%" },
  { left: "65%", bottom: "8%" },
  { left: "12%", bottom: "13%" },
  { left: "78%", bottom: "13%" },
  { left: "36%", bottom: "24%" },
  { left: "56%", bottom: "24%" },
];

type Props = {
  categoryKey: CouncilCategoryKey;
  size: CouncilRoomSize;
  mode: CouncilMode;
  prompt: string;
};

export function CouncilStage({ categoryKey, size, mode, prompt }: Props) {
  const category = categoryByKey(categoryKey);
  const agents = agentsForRoom(category, size);
  const sizeInfo = roomSizeByKey(size);
  const bubble = prompt.trim() ? "Room forming around your request." : category.prompt;

  return (
    <section className="relative min-h-[300px] overflow-hidden rounded-[8px] border border-white/10 bg-black text-white">
      <img
        src={category.background}
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-80"
        style={{ imageRendering: "pixelated" }}
        draggable={false}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/0 to-black/68" />

      <div className="absolute left-3 top-3 flex flex-wrap items-center gap-2">
        <span
          className="rounded border px-2.5 py-1 text-[11px] font-bold"
          style={{ borderColor: category.color, backgroundColor: `${category.color}2b` }}
        >
          {category.title} Room
        </span>
        <span className="inline-flex items-center gap-1 rounded border border-white/15 bg-black/38 px-2.5 py-1 text-[11px] text-white/80">
          <Lock size={12} />
          Private
        </span>
        <span className="inline-flex items-center gap-1 rounded border border-white/15 bg-black/38 px-2.5 py-1 text-[11px] text-white/80">
          {mode === "voice" ? <Mic size={12} /> : <MessageSquare size={12} />}
          {mode === "voice" ? "Voice" : "Text"}
        </span>
      </div>

      <div className="absolute right-3 top-3 rounded border border-white/15 bg-black/45 px-2.5 py-1 text-[11px] text-white/75">
        {sizeInfo.label} - {sizeInfo.hint}
      </div>

      <div className="absolute left-1/2 top-[27%] max-w-[420px] -translate-x-1/2 rounded-[8px] border border-white/12 bg-black/54 px-3 py-2 text-center text-[12px] leading-snug text-white/82 shadow-xl">
        {bubble}
      </div>

      {agents.map((agent, index) => (
        <div
          key={`${agent}-${index}`}
          className="absolute flex -translate-x-1/2 flex-col items-center gap-1"
          style={POSITIONS[index]}
        >
          <div className="rounded border border-white/12 bg-black/45 px-2 py-1 text-[10px] text-white/80 shadow-lg">
            {agent}
          </div>
          <img
            src={SPRITES[index % SPRITES.length]}
            alt={agent}
            className="h-20 w-20 object-contain drop-shadow-[0_8px_18px_rgba(0,0,0,0.58)]"
            style={{ imageRendering: "pixelated" }}
            draggable={false}
          />
        </div>
      ))}
    </section>
  );
}
