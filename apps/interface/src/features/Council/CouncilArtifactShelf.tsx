"use client";

import React from "react";
import { FileText, Lock, Share2, Trash2 } from "lucide-react";

import { categoryByKey, roomSizeByKey, type CouncilRoom } from "./council-data";

type Props = {
  room: CouncilRoom | null;
  onDeleteRoom: (roomId: string) => void;
};

export function CouncilArtifactShelf({ room, onDeleteRoom }: Props) {
  if (!room) {
    return (
      <aside className="pearl-themed-app-surface rounded-[8px] border p-3">
        <div className="text-xs font-bold text-white">Shelf</div>
        <div className="mt-2 text-[11px] leading-snug text-white/45">
          Room outputs will appear here as drafts, plans, memos, scenes, or checklists.
        </div>
      </aside>
    );
  }

  const category = categoryByKey(room.category);
  const size = roomSizeByKey(room.size);

  return (
    <aside className="pearl-themed-app-surface grid gap-3 rounded-[8px] border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-white">Shelf</div>
          <div className="mt-0.5 text-[10px] text-white/45">{category.artifactLabel}</div>
        </div>
        <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white/60">
          <Lock size={10} />
          Private
        </span>
      </div>

      <div className="rounded-[8px] border border-white/10 bg-black/20 p-3">
        <div className="flex items-center gap-2 text-[11px] font-bold text-white">
          <FileText size={14} />
          {category.artifactLabel}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-white/50">
          Council will keep the conversation clean and place the useful result here. This first slice does not save it to Pearl.
        </p>
        <div className="mt-3 rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-white/48">
          {size.label} room - {room.mode === "voice" ? "voice" : "text"} session
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          className="inline-flex h-8 items-center justify-center gap-1 rounded border border-white/10 bg-white/[0.04] text-[10px] text-white/58"
          title="Save to Pearl is intentionally explicit"
        >
          <Share2 size={12} />
          Save
        </button>
        <button
          type="button"
          className="inline-flex h-8 items-center justify-center gap-1 rounded border border-white/10 bg-white/[0.04] text-[10px] text-white/58"
          title="Export will be wired when Council persistence lands"
        >
          <FileText size={12} />
          Export
        </button>
        <button
          type="button"
          onClick={() => onDeleteRoom(room.id)}
          className="inline-flex h-8 items-center justify-center gap-1 rounded border border-red-300/20 bg-red-500/10 text-[10px] text-red-100"
        >
          <Trash2 size={12} />
          Delete
        </button>
      </div>
    </aside>
  );
}
