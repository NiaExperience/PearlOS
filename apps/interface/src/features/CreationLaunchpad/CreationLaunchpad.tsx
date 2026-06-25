"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Maximize2, Plus, Send, Share2, X } from "lucide-react";
import {
  planAgencyTasks,
  startAgencyBuild,
  SWARM_DURATION_DEFAULT_MINUTES,
  type AgencyProject,
  type AgencyProjectType,
} from "./lib/agency-coordinator";
import { requestWindowOpen } from "@interface/features/ManeuverableWindow/lib/windowLifecycleController";
import { openStudioCreation } from "./lib/play-creation";
import AttachmentChip, {
  type SpriteAttachment,
  type NoteAttachment,
} from "./components/AttachmentChip";
import {
  TOPBAR_TITLE_SET_EVENT,
  TOPBAR_TITLE_CLEAR_EVENT,
} from "@interface/components/TopBarTitle";
import {
  PEARL_AGENCY_ROOMS,
  type AgencyRoomKey,
  type RoomConfig,
} from "@interface/features/TaskVisualization/PearlAgencyRooms";
import {
  STUDIO_SWARM_TEMPLATES,
  STUDIO_TEMPLATE_GROUPS,
  type StudioTemplate,
} from "./lib/studio-templates";
import {
  readDesktopShortcuts,
  removeDesktopShortcut,
  studioShortcutId,
  upsertDesktopShortcut,
} from "@interface/lib/personal-desktop-shortcuts";

// ─── Types ─────────────────────────────────────────────────────────
type CreatorMode = Extract<AgencyProjectType, "app" | "game" | "pearlos">;
type ExecutionMode = "fast_draft" | "full_build";

interface Sprite {
  _id: string;
  name: string;
  description?: string;
  hasGif: boolean;
  gifData?: string;
  gifMimeType?: string;
  createdAt?: string;
}

interface PhotoMagicAsset {
  filename: string;
  url: string;
  created: number;
  size: number;
}

interface PipelineJob {
  id: string;
  title: string;
  status: "running" | "completed" | "failed";
  type: string;
  updatedAt: number;
}

type ProjectStatus = "queued" | "building" | "complete" | "error";
type ProjectType = "game" | "app" | "feature" | "pearlos";
type RoomSelection = Record<AgencyRoomKey, { enabled: boolean; agents: number }>;

interface LaunchpadProject {
  id: string;
  title: string;
  content?: string;
  type: ProjectType;
  status: ProjectStatus;
  estimatedMinutes?: number;
  swarmDurationMinutes?: number;
  sprites?: Array<{ id: string; name: string; imageUrl: string }>;
  createdAt: string;
  buildPassCompletedAt?: string;
  playUrl?: string;
}

const typeIcon: Record<ProjectType, string> = {
  game: "🎮",
  app: "🌐",
  feature: "⚙️",
  pearlos: "🪩",
};

const ROOM_AGENT_POOL: Record<AgencyRoomKey, string[]> = {
  code: ["Codex", "Claude Opus 4.6", "Kimi", "DeepSeek", "Qwen", "Gemini", "GLM"],
  generic: ["Codex", "Qwen", "Gemini", "Kimi", "DeepSeek", "GLM", "Claude Opus 4.6"],
  research: ["DeepSeek", "Kimi", "Gemini", "Qwen", "Claude Opus 4.6", "Codex", "GLM"],
  creative: ["Kimi", "Claude Opus 4.6", "Grok", "Gemini", "Qwen", "DeepSeek", "Codex"],
  strategy: ["Claude Opus 4.6", "DeepSeek", "Qwen", "Gemini", "Kimi", "Codex", "GLM"],
  design: ["NanoBanana", "SeeDance", "Gemini", "Claude Opus 4.6", "Kimi", "Qwen", "Codex"],
};

function defaultRoomSelection(): RoomSelection {
  return PEARL_AGENCY_ROOMS.reduce((acc, room) => {
    acc[room.key] = { enabled: room.key === "generic", agents: 1 };
    return acc;
  }, {} as RoomSelection);
}

function templateRoomSelection(template: StudioTemplate): RoomSelection {
  const next = defaultRoomSelection();
  for (const key of Object.keys(next) as AgencyRoomKey[]) {
    next[key] = { enabled: key === template.room, agents: key === template.room ? 3 : 1 };
  }
  return next;
}

function selectedRoomSummary(rooms: RoomConfig[], selection: RoomSelection): string {
  const parts = rooms
    .filter((room) => selection[room.key]?.enabled)
    .map((room) => `${room.title} x${selection[room.key]?.agents || 1}`);
  return parts.length ? parts.join(", ") : "No rooms selected";
}

function agentsForSelection(selection: RoomSelection): string[] {
  return Object.entries(selection).flatMap(([key, value]) => {
    if (!value.enabled) return [];
    const roomKey = key as AgencyRoomKey;
    const pool = ROOM_AGENT_POOL[roomKey] || ROOM_AGENT_POOL.generic;
    return Array.from({ length: value.agents }, (_, index) => pool[index % pool.length]);
  });
}

function primarySwarmCategory(rooms: RoomConfig[], selection: RoomSelection): string {
  const selected = rooms.filter((room) => selection[room.key]?.enabled);
  if (selected.length === 1) return selected[0].title;
  if (selected.length > 1) return "Multi-room";
  return "Studio Dream Team";
}

function loadPinned(): string[] {
  return readDesktopShortcuts()
    .map((shortcut) => shortcut.target.kind === "studio-creation" ? shortcut.target.projectId : null)
    .filter((id): id is string => Boolean(id));
}

// ─── Section wrapper ───────────────────────────────────────────────
const Section: React.FC<{
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}> = ({ title, icon, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-white/[0.04] transition-colors"
      >
        <span className="text-lg">{icon}</span>
        <span className="text-sm font-semibold text-[#faf8f5] tracking-wide flex-1">
          {title}
        </span>
        <span className="text-xs text-[#d4c0e8]/60">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
};

// ─── Slot-machine carousel ─────────────────────────────────────────
const CreationsCarousel: React.FC<{
  projects: LaunchpadProject[];
  loading: boolean;
  selectedId: string | null;
  pinnedIds: Set<string>;
  onSelect: (id: string | null) => void;
  onTogglePin: (project: LaunchpadProject) => void;
  onPlay: (project: LaunchpadProject) => void;
  onEdit: (project: LaunchpadProject) => void;
  onShare: (project: LaunchpadProject) => void;
  onDelete: (project: LaunchpadProject) => void;
}> = ({ projects, loading, selectedId, pinnedIds, onSelect, onTogglePin, onPlay, onEdit, onShare, onDelete }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-xs text-[#d4c0e8]/50">
        Loading creations…
      </div>
    );
  }
  if (projects.length === 0) {
    return (
      <div className="text-center py-6 space-y-2">
        <div className="text-3xl opacity-40">🎰</div>
        <div className="text-xs text-[#d4c0e8]/50">
          No creations yet. Describe one below to begin.
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        className="studio-carousel flex flex-row gap-3 overflow-x-auto pb-2 pr-2 -mx-1 px-1"
        style={{
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {projects.map((p) => {
          const isSelected = p.id === selectedId;
          const isPinned = pinnedIds.has(p.id);
          return (
            <div
              key={p.id}
              className="flex flex-col items-center"
              style={{ scrollSnapAlign: "start" }}
            >
              <button
                type="button"
                onClick={() => onSelect(isSelected ? null : p.id)}
                title={p.title}
                className={`relative flex flex-col items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 min-w-[88px] max-w-[88px] transition-all ${
                  isSelected
                    ? "border-sky-400 bg-sky-500/15 shadow-md shadow-sky-500/20"
                    : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                }`}
              >
                <span className="text-2xl leading-none">{typeIcon[p.type]}</span>
                <span className="text-[10px] text-[#faf8f5] truncate w-full text-center">
                  {p.title}
                </span>
                {isPinned && !isSelected && (
                  <span
                    aria-hidden
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-sky-400 text-[#0a0614] text-[8px] flex items-center justify-center font-bold"
                    title="Pinned to desktop"
                  >
                    ★
                  </span>
                )}
                {(p.status === 'building' || p.status === 'queued') && (
                  <div
                    aria-hidden
                    className="studio-building-overlay"
                    title={p.status === 'queued' ? 'Queued for build' : 'Building…'}
                  >
                    <div className="studio-building-pulse" />
                    <div className="studio-building-label">
                      {p.status === 'queued' ? 'QUEUED' : 'BUILDING'}
                    </div>
                  </div>
                )}
              </button>
              {isSelected && (
                <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0a0614]/95 px-1.5 py-1.5 shadow-lg">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(p);
                    }}
                    title="Edit creation"
                    aria-label="Edit creation"
                    className="w-7 h-7 rounded-md flex items-center justify-center text-[#d4c0e8]/80 hover:text-[#faf8f5] hover:bg-white/[0.08] transition-colors"
                  >
                    {/* pencil */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePin(p);
                    }}
                    title={isPinned ? "Remove from desktop" : "Pin to desktop"}
                    aria-label={isPinned ? "Remove from desktop" : "Pin to desktop"}
                    className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                      isPinned
                        ? "text-red-400 hover:bg-red-400/10"
                        : "text-[#d4c0e8]/80 hover:text-[#faf8f5] hover:bg-white/[0.08]"
                    }`}
                  >
                    {isPinned ? (
                      // trash icon
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    ) : (
                      // pin icon
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 17v5" />
                        <path d="M9 10.76V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v5.76l2 2.24v2H7v-2Z" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlay(p);
                    }}
                    title="Play creation"
                    aria-label="Play creation"
                    className="w-7 h-7 rounded-md flex items-center justify-center text-emerald-400 hover:bg-emerald-400/10 transition-colors"
                  >
                    {/* play */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onShare(p);
                    }}
                    title="Share to Our PearlOS"
                    aria-label="Share to Our PearlOS"
                    className="w-7 h-7 rounded-md flex items-center justify-center text-cyan-300 hover:bg-cyan-300/10 transition-colors"
                  >
                    <Share2 size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const ok = typeof window !== 'undefined'
                        ? window.confirm(`Delete "${p.title}"? This can't be undone.`)
                        : true;
                      if (ok) onDelete(p);
                    }}
                    title="Delete creation"
                    aria-label="Delete creation"
                    className="w-7 h-7 rounded-md flex items-center justify-center text-red-400 hover:bg-red-400/15 transition-colors"
                  >
                    {/* trash */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Creations (formerly Pipeline Output) ─────────────────────────
const Creations: React.FC = () => {
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as PipelineJob;
      if (!detail?.id) return;
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === detail.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = detail;
          return updated;
        }
        return [detail, ...prev];
      });
    };

    window.addEventListener("nia.pipeline.status", handler);
    const t = setTimeout(() => setLoading(false), 600);
    return () => {
      window.removeEventListener("nia.pipeline.status", handler);
      clearTimeout(t);
    };
  }, []);

  const statusColors: Record<string, string> = {
    running: "text-amber-400",
    completed: "text-emerald-400",
    failed: "text-red-400",
  };

  const statusIcons: Record<string, string> = {
    running: "⏳",
    completed: "✓",
    failed: "✕",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-xs text-[#d4c0e8]/50">
        Loading creations…
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="text-center py-6 space-y-2">
        <div className="text-2xl opacity-40">✨</div>
        <div className="text-xs text-[#d4c0e8]/50">
          No creations yet. Create something to see results here.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-48 overflow-y-auto">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2.5"
        >
          <span className={`text-sm ${statusColors[job.status] ?? "text-gray-400"}`}>
            {statusIcons[job.status] ?? "?"}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[#faf8f5] truncate">{job.title}</div>
            <div className="text-[10px] text-[#d4c0e8]/40">{job.type}</div>
          </div>
          <span className={`text-[10px] font-medium uppercase tracking-wider ${statusColors[job.status]}`}>
            {job.status}
          </span>
        </div>
      ))}
    </div>
  );
};

// ─── Sprites menu ──────────────────────────────────────────────────
const SpritesMenu: React.FC<{
  selectedSpriteIds: Set<string>;
  onToggle: (sprite: Sprite) => void;
  onOpenApp: () => void;
}> = ({ selectedSpriteIds, onToggle, onOpenApp }) => {
  const [sprites, setSprites] = useState<Sprite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/summon-ai-sprite/list?includeGif=1&limit=50");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setSprites(data.sprites ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load sprites");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-xs text-[#d4c0e8]/50">
        Loading sprites…
      </div>
    );
  }
  if (error) {
    return <div className="text-center py-6 text-xs text-red-400/70">{error}</div>;
  }
  if (sprites.length === 0) {
    return (
      <div className="text-center py-6 space-y-2">
        <button
          type="button"
          onClick={onOpenApp}
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-300/40 bg-emerald-500/20 text-emerald-100 transition-colors hover:bg-emerald-500/30"
          title="Open Sprites"
          aria-label="Open Sprites"
        >
          <Plus className="h-5 w-5" />
        </button>
        <div className="text-2xl opacity-40">👾</div>
        <div className="text-xs text-[#d4c0e8]/50">
          No sprites yet. Ask Pearl to summon one!
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 max-h-72 overflow-y-auto">
      <button
        type="button"
        onClick={onOpenApp}
        title="Open Sprites"
        aria-label="Open Sprites"
        className="group relative flex flex-col items-center rounded-xl border border-emerald-300/40 bg-emerald-500/20 p-2 text-emerald-100 transition-all hover:bg-emerald-500/30"
      >
        <div className="relative mb-1.5 flex h-14 w-14 items-center justify-center rounded-lg bg-emerald-300/14">
          <Plus className="h-7 w-7" />
        </div>
        <span className="w-full truncate text-center text-[10px] font-bold uppercase tracking-[0.08em]">
          Sprites
        </span>
      </button>
      {sprites.map((sprite) => {
        const selected = selectedSpriteIds.has(sprite._id);
        return (
          <button
            type="button"
            key={sprite._id}
            onClick={() => onToggle(sprite)}
            title={sprite.description || sprite.name}
            className={`group relative flex flex-col items-center rounded-xl border transition-all p-2 ${
              selected
                ? "border-sky-400 ring-2 ring-sky-400 bg-sky-500/10"
                : "border-white/5 bg-white/[0.02] hover:border-[#D94F8E]/30 hover:bg-white/[0.05]"
            }`}
          >
            <div className="relative w-14 h-14 rounded-lg bg-white/[0.04] flex items-center justify-center overflow-hidden mb-1.5">
              {sprite.gifData ? (
                <img
                  src={`data:${sprite.gifMimeType || "image/gif"};base64,${sprite.gifData}`}
                  alt={sprite.name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-2xl opacity-40">👾</span>
              )}
              {selected && (
                <span
                  aria-hidden
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-sky-400 text-[#0a0614] flex items-center justify-center text-[10px] font-bold"
                >
                  ✓
                </span>
              )}
            </div>
            <span className="text-[10px] text-[#d4c0e8]/70 text-center truncate w-full">
              {sprite.name}
            </span>
          </button>
        );
      })}
    </div>
  );
};

// ─── PhotoMagic gallery menu ──────────────────────────────────────
const PhotoMagicMenu: React.FC<{
  selectedAssetIds: Set<string>;
  onToggle: (asset: PhotoMagicAsset) => void;
  onOpenApp: () => void;
}> = ({ selectedAssetIds, onToggle, onOpenApp }) => {
  const [assets, setAssets] = useState<PhotoMagicAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/photo-magic/gallery");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setAssets(data.items ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load PhotoMagic assets");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-xs text-[#d4c0e8]/50">
        Loading PhotoMagic…
      </div>
    );
  }
  if (error) {
    return <div className="text-center py-6 text-xs text-red-400/70">{error}</div>;
  }
  if (assets.length === 0) {
    return (
      <div className="text-center py-6 space-y-2">
        <button
          type="button"
          onClick={onOpenApp}
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-300/40 bg-emerald-500/20 text-emerald-100 transition-colors hover:bg-emerald-500/30"
          title="Open PhotoMagic"
          aria-label="Open PhotoMagic"
        >
          <Plus className="h-5 w-5" />
        </button>
        <div className="text-2xl opacity-40">✨</div>
        <div className="text-xs text-[#d4c0e8]/50">
          No PhotoMagic images yet. Generate one in Photo Magic, then attach it here.
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 max-h-72 overflow-y-auto">
      <button
        type="button"
        onClick={onOpenApp}
        title="Open PhotoMagic"
        aria-label="Open PhotoMagic"
        className="group relative flex flex-col items-center rounded-xl border border-emerald-300/40 bg-emerald-500/20 p-2 text-emerald-100 transition-all hover:bg-emerald-500/30"
      >
        <div className="relative mb-1.5 flex h-14 w-14 items-center justify-center rounded-lg bg-emerald-300/14">
          <Plus className="h-7 w-7" />
        </div>
        <span className="w-full truncate text-center text-[10px] font-bold uppercase tracking-[0.08em]">
          PhotoMagic
        </span>
      </button>
      {assets.map((asset) => {
        const id = `photo-magic:${asset.filename}`;
        const selected = selectedAssetIds.has(id);
        return (
          <button
            type="button"
            key={asset.filename}
            onClick={() => onToggle(asset)}
            title={asset.filename}
            className={`group relative flex flex-col items-center rounded-xl border transition-all p-2 ${
              selected
                ? "border-fuchsia-300 ring-2 ring-fuchsia-300 bg-fuchsia-500/10"
                : "border-white/5 bg-white/[0.02] hover:border-fuchsia-300/30 hover:bg-white/[0.05]"
            }`}
          >
            <div className="relative w-14 h-14 rounded-lg bg-white/[0.04] flex items-center justify-center overflow-hidden mb-1.5">
              <img src={asset.url} alt="" className="w-full h-full object-cover" />
              {selected && (
                <span
                  aria-hidden
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-fuchsia-300 text-[#0a0614] flex items-center justify-center text-[10px] font-bold"
                >
                  ✓
                </span>
              )}
            </div>
            <span className="text-[10px] text-[#d4c0e8]/70 text-center truncate w-full">
              {asset.filename.replace(/\.(png|jpe?g|webp)$/i, "")}
            </span>
          </button>
        );
      })}
    </div>
  );
};

// ─── Main Launchpad ────────────────────────────────────────────────
const CreationLaunchpad: React.FC = () => {
  // Topbar title
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(TOPBAR_TITLE_SET_EVENT, { detail: { title: "Studio" } })
    );
    return () => {
      window.dispatchEvent(new CustomEvent(TOPBAR_TITLE_CLEAR_EVENT));
    };
  }, []);

  // ── Project list (carousel data) ──
  const [projects, setProjects] = useState<LaunchpadProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/launchpad/projects");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch {
      /* keep prior list */
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    const handler = () => fetchProjects();
    window.addEventListener("nia.pipeline.status", handler);
    window.addEventListener("nia.launchpad.project.created", handler);
    return () => {
      window.removeEventListener("nia.pipeline.status", handler);
      window.removeEventListener("nia.launchpad.project.created", handler);
    };
  }, [fetchProjects]);

  // ── Pinned creations (localStorage) ──
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => new Set(loadPinned()));

  const togglePin = useCallback((project: LaunchpadProject) => {
    const currentlyPinned = pinnedIds.has(project.id);
    const playUrl = project.playUrl || "";
    if (!currentlyPinned && (!playUrl || project.status !== "complete" || !project.buildPassCompletedAt)) {
      setError("Desktop shortcuts unlock after the first build pass completes.");
      return;
    }
    setPinnedIds((prev) => {
      const next = new Set(prev);
      const shortcutId = studioShortcutId(project.id);
      const willPin = !next.has(project.id);
      if (willPin) {
        next.add(project.id);
        upsertDesktopShortcut({
          id: shortcutId,
          title: project.title,
          emoji: typeIcon[project.type] || "✨",
          source: "studio",
          target: {
            kind: "studio-creation",
            projectId: project.id,
            playUrl,
          },
        });
      } else {
        next.delete(project.id);
        removeDesktopShortcut(shortcutId);
      }
      return next;
    });
  }, [pinnedIds]);

  // ── Selected creation (carousel tap reveal) ──
  const [selectedCreationId, setSelectedCreationId] = useState<string | null>(null);

  // ── Edit mode (tied to selected creation) ──
  const [editingCreationId, setEditingCreationId] = useState<string | null>(null);

  // ── Description input ──
  const [description, setDescription] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [agencyRooms, setAgencyRooms] = useState<RoomSelection>(() => defaultRoomSelection());
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("fast_draft");

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [description, adjustTextareaHeight]);

  // ── Selected sprites + attached notes ──
  const [selectedSprites, setSelectedSprites] = useState<SpriteAttachment[]>([]);
  const [attachedNotes, setAttachedNotes] = useState<NoteAttachment[]>([]);

  const toggleSprite = useCallback((sprite: Sprite) => {
    setSelectedSprites((prev) => {
      const exists = prev.some((s) => s.id === sprite._id);
      if (exists) return prev.filter((s) => s.id !== sprite._id);
      const imageUrl = sprite.gifData
        ? `data:${sprite.gifMimeType || "image/gif"};base64,${sprite.gifData}`
        : "";
      return [
        ...prev,
        {
          kind: "sprite",
          id: sprite._id,
          name: sprite.name,
          imageUrl,
        },
      ];
    });
  }, []);

  const togglePhotoMagicAsset = useCallback((asset: PhotoMagicAsset) => {
    const id = `photo-magic:${asset.filename}`;
    setSelectedSprites((prev) => {
      const exists = prev.some((s) => s.id === id);
      if (exists) return prev.filter((s) => s.id !== id);
      return [
        ...prev,
        {
          kind: "sprite",
          id,
          name: `PhotoMagic: ${asset.filename.replace(/\.(png|jpe?g|webp)$/i, "")}`,
          imageUrl: asset.url,
          description: `PhotoMagic image asset available at ${asset.url}`,
        },
      ];
    });
  }, []);

  const removeSprite = useCallback((id: string) => {
    setSelectedSprites((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const removeNote = useCallback((id: string) => {
    setAttachedNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const selectedSpriteIds = useMemo(
    () => new Set(selectedSprites.map((s) => s.id)),
    [selectedSprites]
  );

  const selectedPhotoMagicAssetIds = useMemo(
    () => new Set(selectedSprites.filter((s) => s.id.startsWith("photo-magic:")).map((s) => s.id)),
    [selectedSprites]
  );
  const roomSummary = useMemo(
    () => selectedRoomSummary(PEARL_AGENCY_ROOMS, agencyRooms),
    [agencyRooms]
  );
  const selectedAgents = useMemo(() => agentsForSelection(agencyRooms), [agencyRooms]);
  const selectedSwarmCategory = useMemo(
    () => primarySwarmCategory(PEARL_AGENCY_ROOMS, agencyRooms),
    [agencyRooms]
  );

  const openSpritesApp = useCallback(() => {
    requestWindowOpen({
      viewType: "sprites",
      title: "Sprites",
      source: "studio:sprites-gallery",
      options: { allowDuplicate: false },
    });
  }, []);

  const openPhotoMagicApp = useCallback(() => {
    requestWindowOpen({
      viewType: "photoMagic",
      title: "PhotoMagic",
      source: "studio:photomagic-gallery",
      options: { allowDuplicate: false },
    });
  }, []);

  // ── Listen for note attach events ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const note = detail?.note;
      if (!note?.id || typeof note.title !== "string") return;
      setAttachedNotes((prev) =>
        prev.some((n) => n.id === note.id)
          ? prev
          : [
              ...prev,
              {
                kind: "note",
                id: String(note.id),
                title: String(note.title),
                content: typeof note.content === "string" ? note.content : "",
              },
            ]
      );
    };
    window.addEventListener("nia.studio.note.attach", handler);
    return () => window.removeEventListener("nia.studio.note.attach", handler);
  }, []);

  // ── Creation type toggle ──
  const [creationType, setCreationType] = useState<CreatorMode>("app");

  // ── Launching state ──
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editingProject = useMemo(
    () => (editingCreationId ? projects.find((p) => p.id === editingCreationId) ?? null : null),
    [editingCreationId, projects]
  );

  const isEditing = Boolean(editingProject);

  const ctaLabel = useMemo(() => {
    if (launching) return isEditing ? "EDITING…" : "LAUNCHING…";
    return isEditing ? "EDIT" : "CREATE";
  }, [launching, isEditing]);

  const placeholder = isEditing ? "What should change?" : "Describe your creation.";

  const applyTemplate = useCallback(
    (template: StudioTemplate) => {
      setCreationType(template.creationType);
      setDescription(template.prompt);
      setAgencyRooms(templateRoomSelection(template));
      setExecutionMode("fast_draft");
      setEditingCreationId(null);
      setSelectedCreationId(null);
      setTimeout(() => {
        adjustTextareaHeight();
        textareaRef.current?.focus();
      }, 0);
    },
    [adjustTextareaHeight]
  );

  // ── Carousel handlers ──
  const handleCarouselSelect = useCallback((id: string | null) => {
    setSelectedCreationId(id);
  }, []);

  const handleCarouselEdit = useCallback((project: LaunchpadProject) => {
    setEditingCreationId(project.id);
    setSelectedCreationId(project.id);
    setDescription("");
    // Focus the textarea once edit mode is active.
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const handleCarouselPlay = useCallback((project: LaunchpadProject) => {
    openStudioCreation(project, "launchpad:carousel-play");
  }, []);

  const handleCarouselShare = useCallback(async (project: LaunchpadProject) => {
    if (project.status !== "complete" || !project.buildPassCompletedAt || !project.playUrl) {
      setError("Share unlocks after the first build pass completes.");
      return;
    }
    try {
      const res = await fetch(`/api/launchpad/projects/${project.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: project.type }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(typeof json?.error === "string" ? json.error : `Share failed (${res.status})`);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not share this creation.");
    }
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingCreationId(null);
  }, []);

  // ── Delete handler ──
  const handleCarouselDelete = useCallback(async (project: LaunchpadProject) => {
    try {
      const res = await fetch(`/api/launchpad/projects/${project.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setError(`Could not delete "${project.title}": ${res.status}`);
        return;
      }
      // Optimistic local removal so the carousel updates immediately.
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      if (selectedCreationId === project.id) setSelectedCreationId(null);
      if (editingCreationId === project.id) setEditingCreationId(null);
      setPinnedIds((prev) => {
        if (!prev.has(project.id)) return prev;
        const next = new Set(prev);
        next.delete(project.id);
        removeDesktopShortcut(studioShortcutId(project.id));
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      setError(`Could not delete "${project.title}": ${msg}`);
    }
  }, [selectedCreationId, editingCreationId]);

  // ── Submit handler ──
  const handleLaunch = useCallback(async () => {
    if (!description.trim() && attachedNotes.length === 0 && selectedSprites.length === 0) return;
    setLaunching(true);
    setError(null);
    try {
      if (isEditing && editingProject) {
        // EDIT path: PATCH the existing project with the user's edit notes,
        // then dispatch the Agency to actually rebuild the creation in place.
        const editNotes = description.trim();
        const newSpritesPayload = selectedSprites.map((s) => ({
          id: s.id,
          name: s.name,
          imageUrl: s.imageUrl,
          description: s.description,
        }));
        const mergedSprites = [
          ...(editingProject.sprites ?? []),
          ...newSpritesPayload.filter(
            (s) => !(editingProject.sprites ?? []).some((existing) => existing.id === s.id)
          ),
        ];
        const patchBody: Record<string, unknown> = {
          editNotes,
          attachedNotes: attachedNotes.map((n) => ({
            id: n.id,
            title: n.title,
            content: n.content,
          })),
          sprites: mergedSprites,
          // Flip back into 'building' so the carousel + project list reflect
          // that an edit pass is in flight (mirrors the CREATE path which
          // transitions via agency-start).
          status: "building",
        };
        const res = await fetch(`/api/launchpad/projects/${editingProject.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(txt || `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => ({}));
        const updated = data?.project ?? null;

        // Map the persisted lowercase project type to the agency-coordinator
        // type. Studio only edits app/game/pearlos creations; "feature"
        // collapses into "app" for swarm planning purposes.
        const editAgencyType: AgencyProjectType =
          editingProject.type === "game"
            ? "game"
            : editingProject.type === "pearlos"
            ? "pearlos"
            : editingProject.type === "feature"
            ? "feature"
            : "app";

        const swarmDurationMinutes =
          editingProject.swarmDurationMinutes ?? SWARM_DURATION_DEFAULT_MINUTES;

        // Build a fresh agency project payload for the EDIT pass. The task
        // plan is regenerated so the pipeline UI refreshes; the projectId
        // stays the same so the existing creation directory is reused.
        const agencyProject: AgencyProject = {
          projectId: editingProject.id,
          title: editingProject.title,
          type: editAgencyType,
          content: editNotes || editingProject.content || editingProject.title,
          tasks: planAgencyTasks(
            editingProject.id,
            editingProject.title,
            editAgencyType,
            swarmDurationMinutes
          ),
          status: "queued",
          createdAt: Date.now(),
          swarmDurationMinutes,
        };

        startAgencyBuild(agencyProject, {
          agents: selectedAgents,
          swarmCategory: selectedSwarmCategory,
          agencyRoomSummary: roomSummary,
          executionMode,
          agencyStartPayload: {
            userPrompt: editNotes || editingProject.title,
            editingCreationId: editingProject.id,
            editNotes,
            execution_mode: executionMode,
            attachedNotes: attachedNotes.map((n) => ({
              id: n.id,
              title: n.title,
              content: n.content,
            })),
            selectedSprites: selectedSprites.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description,
              imageUrl: s.imageUrl,
            })),
            agents: selectedAgents,
            swarmCategory: selectedSwarmCategory,
            agencyRoomSummary: roomSummary,
          },
        }).catch(() => {});

        window.dispatchEvent(
          new CustomEvent("nia.launchpad.project.updated", {
            detail: { project: updated, editingCreationId: editingProject.id, editNotes },
          })
        );
        window.dispatchEvent(
          new CustomEvent("nia.creation.edit", {
            detail: {
              editingCreationId: editingProject.id,
              editNotes,
              attachedNotes,
              selectedSprites,
            },
          })
        );
        window.dispatchEvent(
          new CustomEvent("nia.pipeline.status", {
            detail: {
              id: editingProject.id,
              title: editingProject.title,
              status: "running",
              type: editingProject.type,
              updatedAt: Date.now(),
            },
          })
        );

        // Reset form back to CREATE mode so the box prompts "Describe your
        // creation." again and the CTA reverts from EDIT to CREATE.
        setDescription("");
        setSelectedSprites([]);
        setAttachedNotes([]);
        setEditingCreationId(null);
        setSelectedCreationId(null);
        fetchProjects();
        return;
      }

      // CREATE path
      const derivedTitle =
        description.trim().split(/\n/)[0]?.slice(0, 60).trim() ||
        attachedNotes[0]?.title ||
        "Studio creation";
      const creationContent = description.trim() || attachedNotes[0]?.content || derivedTitle;

      const apiType: AgencyProjectType = creationType;

      const res = await fetch("/api/launchpad/create-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: derivedTitle,
          content: creationContent,
          type: apiType,
          creationType:
            apiType === "game" ? "GAME" : apiType === "pearlos" ? "PEARLOS" : "APP",
          swarmDurationMinutes: SWARM_DURATION_DEFAULT_MINUTES,
          selectedSprites: selectedSprites.map((s) => ({
            id: s.id,
            name: s.name,
            imageUrl: s.imageUrl,
            description: s.description,
          })),
          attachedNotes: attachedNotes.map((n) => ({
            id: n.id,
            title: n.title,
            content: n.content,
          })),
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const project = data.project;

      const agencyProject: AgencyProject = {
        projectId: project.id,
        title: project.title,
        type: apiType,
        content: project.content,
        tasks: planAgencyTasks(
          project.id,
          project.title,
          apiType,
          SWARM_DURATION_DEFAULT_MINUTES
        ),
        status: "queued",
        createdAt: Date.now(),
        swarmDurationMinutes: SWARM_DURATION_DEFAULT_MINUTES,
      };

      startAgencyBuild(agencyProject, {
        agents: selectedAgents,
        swarmCategory: selectedSwarmCategory,
        agencyRoomSummary: roomSummary,
        executionMode,
      }).catch(() => {});

      window.dispatchEvent(
        new CustomEvent("nia.project.created", { detail: { project } })
      );
      window.dispatchEvent(
        new CustomEvent("nia.launchpad.project.created", { detail: { project } })
      );
      window.dispatchEvent(
        new CustomEvent("nia.creation.request", {
          detail: {
            type: apiType,
            title: derivedTitle,
            description: description.trim(),
            swarmDurationMinutes: SWARM_DURATION_DEFAULT_MINUTES,
            selectedSprites,
            attachedNotes,
          },
        })
      );

      // Reset form
      setDescription("");
      setSelectedSprites([]);
      setAttachedNotes([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setLaunching(false);
    }
  }, [
    description,
    attachedNotes,
    selectedSprites,
    isEditing,
    editingProject,
    creationType,
    fetchProjects,
    roomSummary,
    selectedAgents,
    selectedSwarmCategory,
    executionMode,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!launching) handleLaunch();
      }
    },
    [launching, handleLaunch]
  );

  const hasAttachments = selectedSprites.length > 0 || attachedNotes.length > 0;

  // ── Type toggle row data ──
  const typeButtons: Array<{
    id: CreatorMode | "pearlos";
    label: string;
    disabled?: boolean;
    title?: string;
  }> = [
    { id: "app", label: "APP" },
    { id: "game", label: "GAME" },
    {
      id: "pearlos",
      label: "PEARLOS",
      title: "Build a PearlOS-style module prototype",
    },
  ];

  return (
    <div
      className="studio-scroll flex flex-col h-full overflow-y-auto pt-24"
      style={{
        backgroundColor: "#0a0614",
        color: "#faf8f5",
        fontFamily: "Gohufont, monospace",
      }}
    >
      <div className="flex-1 p-4 space-y-3">
        {/* 1. Carousel */}
        <Section title="Creations" icon="🎰">
          <CreationsCarousel
            projects={projects}
            loading={projectsLoading}
            selectedId={selectedCreationId}
            pinnedIds={pinnedIds}
            onSelect={handleCarouselSelect}
            onTogglePin={togglePin}
            onPlay={handleCarouselPlay}
            onEdit={handleCarouselEdit}
            onShare={handleCarouselShare}
            onDelete={handleCarouselDelete}
          />
        </Section>

        {/* 2-4. Creator (input + chips + type toggle / CREATE) */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          {isEditing && editingProject && (
            <div className="flex items-center gap-2 rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-200">
              <span aria-hidden>✏️</span>
              <span className="flex-1 truncate">
                Editing <span className="font-semibold">{editingProject.title}</span>
              </span>
              <button
                type="button"
                onClick={cancelEdit}
                className="text-sky-200/80 hover:text-sky-100 underline underline-offset-2"
              >
                cancel
              </button>
            </div>
          )}

          <div className="relative">
            <textarea
              ref={textareaRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={3}
              className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 pr-12 text-sm text-[#faf8f5] placeholder-[#d4c0e8]/40 outline-none focus:border-sky-400/50 transition-colors font-[Gohufont,monospace] resize-none"
              style={{ minHeight: 72, maxHeight: 240 }}
            />
            <button
              type="button"
              onClick={() => setPromptExpanded(true)}
              className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sky-300/35 bg-sky-300/12 text-sky-50 hover:bg-sky-300/20"
              title="Expand Studio prompt and Agency controls"
              aria-label="Expand Studio prompt and Agency controls"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
          <div className="px-1 text-[10px] uppercase tracking-[0.08em] text-sky-100/55">
            Agency: {roomSummary}
          </div>

          <div className="space-y-2 rounded-xl border border-white/10 bg-black/15 p-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#d4c0e8]/60">
              Swarm templates
            </div>
            <div className="grid gap-2">
              {STUDIO_TEMPLATE_GROUPS.map((group) => {
                const templates = STUDIO_SWARM_TEMPLATES.filter((template) => template.category === group.id);
                return (
                  <div key={group.id} className="grid gap-1.5">
                    <div className="text-[10px] uppercase tracking-[0.1em] text-sky-100/45">{group.label}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {templates.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => applyTemplate(template)}
                          className="max-w-[190px] rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-left transition-colors hover:border-sky-300/45 hover:bg-sky-300/10"
                          title={template.summary}
                        >
                          <span className="block truncate text-[11px] font-bold text-[#faf8f5]">
                            {template.title}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-[#d4c0e8]/55">
                            {template.summary}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. Attachment chips */}
          {hasAttachments && (
            <div className="flex flex-wrap gap-1.5 px-1" aria-label="Attachments">
              {attachedNotes.map((n) => (
                <AttachmentChip
                  key={`note-${n.id}`}
                  attachment={n}
                  onRemove={removeNote}
                />
              ))}
              {selectedSprites.map((s) => (
                <AttachmentChip
                  key={`sprite-${s.id}`}
                  attachment={s}
                  onRemove={removeSprite}
                />
              ))}
            </div>
          )}

          {/* 4. Type toggle + CREATE button row */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {typeButtons.map((btn) => {
                const isActive = !btn.disabled && creationType === btn.id;
                return (
                  <button
                    key={btn.id}
                    type="button"
                    title={btn.title}
                    disabled={btn.disabled}
                    onClick={() => {
                      if (btn.disabled) return;
                      setCreationType(btn.id as CreatorMode);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wide transition-all ${
                      btn.disabled
                        ? "opacity-40 cursor-not-allowed text-[#d4c0e8]/40"
                        : isActive
                          ? "bg-sky-500/30 text-sky-100 border border-sky-400/40"
                          : "text-[#d4c0e8]/60 hover:text-[#faf8f5] hover:bg-white/[0.04] border border-transparent"
                    }`}
                  >
                    {btn.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {([
                { id: "fast_draft", label: "⚡ Fast Draft" },
                { id: "full_build", label: "🔧 Full Build" },
              ] as const).map((btn) => {
                const isActive = executionMode === btn.id;
                return (
                  <button
                    key={btn.id}
                    type="button"
                    onClick={() => setExecutionMode(btn.id)}
                    aria-pressed={isActive}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wide transition-all ${
                      isActive
                        ? "bg-emerald-500/25 text-emerald-100 border border-emerald-300/40"
                        : "text-[#d4c0e8]/60 hover:text-[#faf8f5] hover:bg-white/[0.04] border border-transparent"
                    }`}
                  >
                    {btn.label}
                  </button>
                );
              })}
            </div>

            <div className="flex-1" />

            <button
              type="button"
              onClick={handleLaunch}
              disabled={
                launching ||
                (!description.trim() &&
                  attachedNotes.length === 0 &&
                  selectedSprites.length === 0)
              }
              className="studio-pixel-btn"
              style={{
                fontFamily: "Gohufont, monospace",
                backgroundColor: "#22c55e",
                color: "#ffffff",
                padding: "8px 18px",
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                borderRadius: 0,
                border: "none",
                imageRendering: "pixelated",
                boxShadow:
                  "inset -3px -3px 0 0 rgba(0,0,0,0.35), inset 3px 3px 0 0 rgba(255,255,255,0.25), 0 0 0 2px #14532d",
                cursor: "pointer",
                opacity:
                  launching ||
                  (!description.trim() &&
                    attachedNotes.length === 0 &&
                    selectedSprites.length === 0)
                    ? 0.45
                    : 1,
              }}
            >
              {ctaLabel}
            </button>
          </div>

          {error && <div className="text-[11px] text-red-400/80 px-1">{error}</div>}
        </div>

        {/* 5. Sprites */}
        <Section title="Sprites" icon="👾">
          <SpritesMenu
            selectedSpriteIds={selectedSpriteIds}
            onToggle={toggleSprite}
            onOpenApp={openSpritesApp}
          />
        </Section>

        <Section title="PhotoMagic" icon="✨">
          <PhotoMagicMenu
            selectedAssetIds={selectedPhotoMagicAssetIds}
            onToggle={togglePhotoMagicAsset}
            onOpenApp={openPhotoMagicApp}
          />
        </Section>

        {/* "Creations Status" slot removed 2026-05-01 — Blair: keep just the
            top Creations carousel. Status is reflected on the carousel tiles
            themselves via the building indicator. The Creations component is
            still defined upstream in case it's needed elsewhere. */}
      </div>

      {promptExpanded ? (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/70 px-3 py-4">
          <div
            className="max-h-full w-full max-w-[760px] overflow-y-auto rounded-[8px] border border-white/14 bg-[#10131b] shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="studio-expanded-prompt-title"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#10131b] px-4 py-3">
              <div>
                <h2 id="studio-expanded-prompt-title" className="text-sm font-bold text-white">Studio Build</h2>
                <p className="mt-0.5 text-[11px] text-white/55">{roomSummary}</p>
              </div>
              <button
                type="button"
                onClick={() => setPromptExpanded(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"
                aria-label="Close Studio build controls"
              >
                <X size={15} />
              </button>
            </div>

            <div className="grid gap-4 p-4">
              <label className="grid gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">Prompt</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="min-h-40 resize-y rounded border border-white/12 bg-[#151a22] px-3 py-2 text-sm leading-relaxed text-white outline-none placeholder:text-white/38 focus:border-sky-300/55"
                  placeholder={placeholder}
                  autoFocus
                />
              </label>

              <div className="grid gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">Rooms and Agents</div>
                <div className="grid gap-2 md:grid-cols-2">
                  {PEARL_AGENCY_ROOMS.map((room) => {
                    const current = agencyRooms[room.key] || { enabled: false, agents: 1 };
                    return (
                      <div
                        key={room.key}
                        className={`rounded-[8px] border p-3 ${current.enabled ? "border-sky-300/45 bg-sky-300/10" : "border-white/10 bg-white/[0.035]"}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => setAgencyRooms((prev) => ({
                              ...prev,
                              [room.key]: { ...(prev[room.key] || { agents: 1 }), enabled: !current.enabled },
                            }))}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            aria-pressed={current.enabled}
                          >
                            <span
                              className="h-3 w-3 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: room.accent, boxShadow: current.enabled ? "0 0 14px rgba(125,218,255,0.9)" : "none" }}
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-bold text-white">{room.title}</span>
                              <span className="block truncate text-[10px] text-white/50">{room.subtitle}</span>
                            </span>
                          </button>
                          <span className="w-12 text-right text-xs font-bold text-sky-100">{current.agents}</span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={7}
                          step={1}
                          value={current.agents}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            setAgencyRooms((prev) => ({
                              ...prev,
                              [room.key]: { enabled: prev[room.key]?.enabled ?? false, agents: next },
                            }));
                          }}
                          className="mt-3 w-full accent-sky-300"
                          aria-label={`${room.title} agent count`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
                <div className="text-[11px] text-white/50">{selectedAgents.length} agent{selectedAgents.length === 1 ? "" : "s"} selected</div>
                <button
                  type="button"
                  onClick={() => setPromptExpanded(false)}
                  className="inline-flex h-9 items-center gap-2 rounded border border-sky-300/40 bg-sky-300/18 px-3 text-sm font-bold text-sky-50 hover:bg-sky-300/26"
                >
                  <Send size={15} />
                  <span>Use Controls</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        .studio-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(155, 142, 196, 0.7) rgba(255, 255, 255, 0.06);
        }
        .studio-scroll::-webkit-scrollbar,
        .studio-scroll *::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .studio-scroll::-webkit-scrollbar-track,
        .studio-scroll *::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 999px;
        }
        .studio-scroll::-webkit-scrollbar-thumb,
        .studio-scroll *::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, rgba(217, 79, 142, 0.8), rgba(123, 63, 142, 0.9));
          border: 2px solid rgba(10, 6, 20, 0.95);
          border-radius: 999px;
          min-height: 36px;
        }
        .studio-scroll::-webkit-scrollbar-thumb:hover,
        .studio-scroll *::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, rgba(230, 95, 156, 0.95), rgba(143, 78, 168, 0.95));
        }
        .studio-carousel {
          scroll-padding-inline: 8px;
        }
        .studio-pixel-btn:hover:not(:disabled) {
          filter: brightness(1.1);
        }
        .studio-pixel-btn:active:not(:disabled) {
          box-shadow:
            inset 3px 3px 0 0 rgba(0,0,0,0.35),
            inset -3px -3px 0 0 rgba(255,255,255,0.25),
            0 0 0 2px #14532d !important;
          transform: translateY(1px);
        }
        .studio-building-overlay {
          position: absolute;
          inset: 0;
          border-radius: 11px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          background: rgba(8, 12, 28, 0.72);
          backdrop-filter: blur(2px);
          pointer-events: none;
          overflow: hidden;
        }
        .studio-building-pulse {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, rgba(125, 195, 255, 0.95), rgba(60, 110, 200, 0.55) 60%, rgba(20, 40, 90, 0) 75%);
          box-shadow: 0 0 14px rgba(125, 195, 255, 0.55);
          animation: studio-building-bob 1.4s ease-in-out infinite;
        }
        .studio-building-label {
          font-size: 8px;
          letter-spacing: 0.12em;
          color: rgba(220, 235, 255, 0.92);
          font-family: 'Gohufont', monospace;
          animation: studio-building-blink 1.4s ease-in-out infinite;
        }
        @keyframes studio-building-bob {
          0%, 100% { transform: scale(0.85); opacity: 0.85; }
          50% { transform: scale(1.05); opacity: 1; }
        }
        @keyframes studio-building-blink {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default CreationLaunchpad;
