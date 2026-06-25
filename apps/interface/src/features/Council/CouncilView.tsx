"use client";

import React from "react";
import { Lock, RefreshCw, Send, Share2, Sparkles, Trash2 } from "lucide-react";

import { CouncilStage } from "./CouncilStage";
import {
  agentsForRoom,
  categoryByKey,
  inferCouncilCategory,
  roomTitleFromPrompt,
  type CouncilRoom,
} from "./council-data";

const ROOM_SIZE = "trio" as const;
const ROOM_MODE = "text" as const;

function newRoomId() {
  return `council-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

export default function CouncilView() {
  const [prompt, setPrompt] = React.useState("");
  const [rooms, setRooms] = React.useState<CouncilRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = React.useState<string | null>(null);

  const activeRoom = rooms.find((room) => room.id === activeRoomId) || null;
  const inferredCategory = inferCouncilCategory(activeRoom?.prompt || prompt);
  const category = categoryByKey(activeRoom?.category || inferredCategory.key);
  const advisors = agentsForRoom(category, ROOM_SIZE);
  const cleanPrompt = (activeRoom?.prompt || prompt).trim();

  const startRoom = React.useCallback(() => {
    const request = prompt.trim() || category.prompt;
    const nextCategory = inferCouncilCategory(request);
    const room: CouncilRoom = {
      id: newRoomId(),
      title: roomTitleFromPrompt(request, nextCategory),
      prompt: request,
      category: nextCategory.key,
      size: ROOM_SIZE,
      mode: ROOM_MODE,
      status: "live",
      createdAt: Date.now(),
    };
    setRooms((previous) => [room, ...previous].slice(0, 8));
    setActiveRoomId(room.id);
  }, [category.prompt, prompt]);

  const resetDraft = React.useCallback(() => {
    setPrompt("");
    setActiveRoomId(null);
  }, []);

  const deleteRoom = React.useCallback((roomId: string) => {
    setRooms((previous) => previous.filter((room) => room.id !== roomId));
    setActiveRoomId((current) => (current === roomId ? null : current));
  }, []);

  return (
    <main className="pearl-themed-app flex h-full min-h-0 flex-col overflow-hidden" style={{ fontFamily: "Gohufont, monospace" }}>
      <header className="pearl-themed-app-surface flex flex-shrink-0 items-center justify-between gap-3 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-white/12 bg-white/[0.05]">
            <Sparkles size={19} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-white">Council</h1>
            <p className="truncate text-[11px] text-white/48">Describe the help you need. Council gathers the room.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1 rounded border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white/58 sm:inline-flex">
            <Lock size={11} />
            Private
          </span>
          <button
            type="button"
            onClick={resetDraft}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-white/[0.04] text-white/70 hover:text-white"
            aria-label="Reset Council"
            title="Reset"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      <section className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="grid min-h-0 gap-3">
          <CouncilStage categoryKey={category.key} size={ROOM_SIZE} mode={ROOM_MODE} prompt={cleanPrompt} />

          <section className="pearl-themed-app-surface rounded-[8px] border p-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
              <label className="grid gap-1.5">
                <span className="text-[11px] font-bold uppercase text-white/45">Ask Council</span>
                <textarea
                  value={prompt}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    setActiveRoomId(null);
                  }}
                  className="pearl-themed-app-panel min-h-[96px] resize-y rounded border px-3 py-2 text-sm leading-relaxed text-white outline-none placeholder:text-white/34"
                  placeholder="Example: I need advice on a landlord dispute, or help turning an idea into a game."
                />
              </label>

              <div className="grid gap-2">
                <div className="rounded-[8px] border border-white/10 bg-black/18 p-2">
                  <div className="text-[10px] uppercase text-white/42">Council read</div>
                  <div className="mt-0.5 text-xs font-bold text-white">{category.title}</div>
                  <div className="mt-1 text-[10px] leading-snug text-white/48">{category.subtitle}</div>
                </div>
                <button
                  type="button"
                  onClick={startRoom}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded border border-white/15 bg-white/[0.08] px-3 text-sm font-bold text-white hover:bg-white/[0.12]"
                >
                  <Send size={15} />
                  Gather the room
                </button>
              </div>
            </div>
          </section>

          <section className="pearl-themed-app-surface rounded-[8px] border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-white">Advisors forming</div>
                <div className="mt-0.5 text-[11px] text-white/45">Council picks the room from the request, not from a menu.</div>
              </div>
              <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white/58">
                <Lock size={10} />
                Not shared with Pearl
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {advisors.map((advisor, index) => (
                <div key={`${advisor}-${index}`} className="rounded-[8px] border border-white/10 bg-black/18 p-2">
                  <div className="text-[11px] font-bold text-white">{advisor}</div>
                  <div className="mt-1 text-[10px] leading-snug text-white/44">
                    {index === 0 ? "Frames the answer." : index === 1 ? "Checks the blind spots." : "Turns it into next steps."}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="grid content-start gap-3">
          <section className="pearl-themed-app-surface rounded-[8px] border p-3">
            <div className="text-xs font-bold text-white">Current room</div>
            {activeRoom ? (
              <div className="mt-3 grid gap-3">
                <div>
                  <div className="text-[11px] font-bold text-white">{activeRoom.title}</div>
                  <p className="mt-1 text-[11px] leading-snug text-white/48">{activeRoom.prompt}</p>
                </div>
                <div className="rounded-[8px] border border-white/10 bg-white/[0.04] p-2">
                  <div className="text-[10px] uppercase text-white/42">Pearl's take</div>
                  <p className="mt-1 text-[11px] leading-snug text-white/58">
                    Council will keep the conversation focused, compare advisor views, then leave the useful answer here.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="inline-flex h-8 items-center justify-center gap-1 rounded border border-white/10 bg-white/[0.04] text-[10px] text-white/58"
                    title="Share with Pearl is intentionally explicit"
                  >
                    <Share2 size={12} />
                    Share
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteRoom(activeRoom.id)}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded border border-red-300/20 bg-red-500/10 text-[10px] text-red-100"
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[11px] leading-snug text-white/45">No room yet. Write one sentence and Council will assemble it.</p>
            )}
          </section>

          <section className="pearl-themed-app-surface rounded-[8px] border p-3">
            <div className="text-xs font-bold text-white">Private rooms</div>
            <div className="mt-2 grid gap-2">
              {rooms.length ? rooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setActiveRoomId(room.id)}
                  className={`rounded-[8px] border p-2 text-left ${room.id === activeRoomId ? "border-white/35 bg-white/10" : "border-white/10 bg-black/18 hover:bg-white/[0.05]"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-bold text-white">{room.title}</span>
                    <span className="text-[10px] text-white/38">{relativeTime(room.createdAt)}</span>
                  </div>
                </button>
              )) : (
                <div className="rounded-[8px] border border-white/10 bg-black/18 p-3 text-[11px] leading-snug text-white/45">
                  Rooms stay local to this Council surface unless you explicitly share one.
                </div>
              )}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
