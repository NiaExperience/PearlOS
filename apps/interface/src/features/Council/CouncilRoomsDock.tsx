"use client";

import React from "react";
import { Lock } from "lucide-react";

import { categoryByKey, type CouncilRoom } from "./council-data";

type Props = {
  rooms: CouncilRoom[];
  activeRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
};

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

export function CouncilRoomsDock({ rooms, activeRoomId, onSelectRoom }: Props) {
  return (
    <aside className="pearl-themed-app-surface flex min-h-0 flex-col rounded-[8px] border">
      <div className="border-b border-white/10 px-3 py-2">
        <div className="text-xs font-bold text-white">Rooms</div>
        <div className="mt-0.5 text-[10px] text-white/45">Private session rooms stay here while Council is open.</div>
      </div>
      <div className="flex gap-2 overflow-x-auto p-2 md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto md:overflow-x-hidden">
        {rooms.length === 0 ? (
          <div className="rounded-[8px] border border-white/10 bg-black/18 p-3 text-[11px] leading-snug text-white/45">
            No rooms yet. Describe what you need and Council will open one.
          </div>
        ) : null}
        {rooms.map((room) => {
          const category = categoryByKey(room.category);
          const selected = room.id === activeRoomId;
          return (
            <button
              key={room.id}
              type="button"
              onClick={() => onSelectRoom(room.id)}
              className={`w-[220px] shrink-0 rounded-[8px] border p-2 text-left md:w-full ${selected ? "border-white/35 bg-white/10" : "border-white/10 bg-black/18 hover:bg-white/[0.05]"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-bold text-white">{room.title}</span>
                <span className="text-[10px] text-white/38">{relativeTime(room.createdAt)}</span>
              </div>
              <div className="mt-1 flex items-center gap-1 text-[10px] text-white/50">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: category.color }} />
                <span>{category.title}</span>
                <span>-</span>
                <Lock size={10} />
                <span>Private</span>
              </div>
              <div className="mt-1 text-[10px] capitalize text-white/42">{room.status}</div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
