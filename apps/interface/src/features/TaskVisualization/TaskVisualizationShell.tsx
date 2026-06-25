"use client";

import React from "react";
import { RefreshCw } from "lucide-react";
import type { VisualRoom, VisualTask } from "./types";

interface ShellProps {
  title: string;
  subtitle: string;
  accent: string;
  children: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

export function TaskVisualizationShell({
  title,
  subtitle,
  accent,
  children,
  loading,
  error,
  onRefresh,
}: ShellProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-[#11131a] text-[#f7f3ea]" style={{ fontFamily: "Gohufont, monospace" }}>
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-white/10 bg-[#171a22] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold leading-tight" style={{ color: accent }}>{title}</h2>
            <p className="mt-1 text-[11px] text-[#c9c1b4]">{subtitle}</p>
          </div>
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/15 bg-white/5 text-[#f7f3ea] hover:bg-white/10"
              aria-label="Refresh"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
          ) : null}
        </header>
        {error ? <div className="border-b border-[#e28a8a]/30 bg-[#3a1d24] px-4 py-2 text-xs text-[#ffd4d4]">{error}</div> : null}
        <main className="min-h-0 flex-1 overflow-auto p-4">{children}</main>
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const color =
    status === "completed" ? "#8bdc9a" :
    status === "failed" ? "#f0a0a0" :
    status === "in_progress" ? "#9dc8ff" :
    status === "pending" ? "#f3d483" :
    "#c6c6c6";

  return (
    <span className="rounded px-2 py-1 text-[10px] uppercase tracking-normal" style={{ color, background: `${color}1f` }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function CompactTaskRow({ task }: { task: VisualTask }) {
  return (
    <article className="border-b border-white/10 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm text-[#fff8e8]">{task.title || "Untitled task"}</h3>
          <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[#b9b2a8]">{task.description || task.result || "No details yet."}</p>
        </div>
        <StatusPill status={task.status || "pending"} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[#8f98a8]">
        {task.assignee ? <span>{task.assignee}</span> : null}
        {task.kind ? <span>{task.kind}</span> : null}
        {task.swarmCategory ? <span>{task.swarmCategory}</span> : null}
      </div>
    </article>
  );
}

export function RoomRow({ room }: { room: VisualRoom }) {
  return (
    <article className="border-b border-white/10 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-sm text-[#fff8e8]">{room.name}</h3>
        <StatusPill status={room.status} />
      </div>
      <p className="mt-1 truncate text-[11px] text-[#9ea8b8]">{room.detail}</p>
    </article>
  );
}
