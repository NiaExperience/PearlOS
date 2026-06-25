"use client";

import React, { useMemo, useState } from "react";

export type PearlAgencyTask = {
  id: string;
  title?: string;
  label?: string;
  description?: string;
  status?: string;
  rawStatus?: string;
  assignee?: string;
  agents?: string[];
  swarmCategory?: string;
  kind?: string;
  executionMode?: string;
  result?: string | null;
  notes?: Array<{ text?: string; ts?: string; kind?: string }>;
  agentActivity?: Record<string, { status?: string; thought?: string; updatedAt?: string }>;
};

export type AgencyRoomKey = "code" | "generic" | "research" | "creative" | "strategy" | "design";

export type RoomConfig = {
  key: AgencyRoomKey;
  title: string;
  subtitle: string;
  background: string;
  agents: string[];
  keywords: RegExp[];
  accent: string;
};

const ROOM_CONFIGS: RoomConfig[] = [
  {
    key: "code",
    title: "Code",
    subtitle: "Build, repair, ship",
    background: "/agency-assets/rooms/backg1.png",
    agents: ["Codex", "DeepSeek Pro V4", "Kimi K2.7 Code", "Qwen3.7 Max"],
    keywords: [/code/i, /codex/i, /engineer/i, /developer/i, /bug/i, /build/i, /deploy/i, /api/i, /tsx?/i, /python/i],
    accent: "#2f8cff",
  },
  {
    key: "generic",
    title: "General",
    subtitle: "Triage and handoff",
    background: "/agency-assets/rooms/backg2.png",
    agents: ["Claude Opus 4.6", "Qwen3.7 Max", "Gemini 3.5 Flash"],
    keywords: [/generic/i, /agency/i, /task/i, /assistant/i, /pearl/i],
    accent: "#9b7cff",
  },
  {
    key: "research",
    title: "Research",
    subtitle: "Find, compare, verify",
    background: "/agency-assets/rooms/backg3.png",
    agents: ["DeepSeek Pro V4", "Kimi K2.7 Code", "Gemini 3.5 Flash"],
    keywords: [/research/i, /lookup/i, /investigate/i, /audit/i, /compare/i, /source/i, /market/i, /news/i],
    accent: "#29b6a3",
  },
  {
    key: "creative",
    title: "Creative",
    subtitle: "Writing and concepts",
    background: "/agency-assets/rooms/backg4.png",
    agents: ["Kimi K2.7 Code", "Claude Opus 4.6", "Grok"],
    keywords: [/creative/i, /writing/i, /writer/i, /story/i, /copy/i, /script/i, /brand/i, /narrative/i],
    accent: "#e05aa8",
  },
  {
    key: "strategy",
    title: "Strategy",
    subtitle: "Plan, sequence, decide",
    background: "/agency-assets/rooms/backg5.png",
    agents: ["Claude Opus 4.6", "DeepSeek Pro V4", "GLM 5.1", "Qwen3.7 Max"],
    keywords: [/strategy/i, /plan/i, /architect/i, /roadmap/i, /product/i, /decision/i, /ops/i],
    accent: "#e0a43a",
  },
  {
    key: "design",
    title: "Design",
    subtitle: "Art and interface",
    background: "/agency-assets/rooms/backg6.png",
    agents: ["NanoBanana", "SeeDance", "Gemini"],
    keywords: [/design/i, /art/i, /ui/i, /ux/i, /visual/i, /sprite/i, /image/i, /video/i, /pixel/i],
    accent: "#6bd15f",
  },
];

const SPRITES: Record<string, string> = {
  codex: "/agency-assets/agents/Codex.png",
  openai: "/agency-assets/agents/Codex.png",
  claude: "/agency-assets/agents/Opus.png",
  opus: "/agency-assets/agents/Opus.png",
  fable: "/agency-assets/agents/Opus.png",
  anthropic: "/agency-assets/agents/Opus.png",
  deepseek: "/agency-assets/agents/DeepSeek.png",
  deepseekv4: "/agency-assets/agents/DeepSeek.png",
  kimi: "/agency-assets/agents/Kimi.png",
  qwen: "/agency-assets/agents/Qwen.png",
  glm: "/agency-assets/agents/Qwen.png",
  gemini: "/agency-assets/agents/Gemini.png",
  gemma: "/agency-assets/agents/Gemini.png",
  grok: "/agency-assets/agents/Grok.png",
  nanobanana: "/agency-assets/agents/NanoBanana.png",
  nano: "/agency-assets/agents/NanoBanana.png",
  seedance: "/agency-assets/agents/SeeDance.png",
  seed: "/agency-assets/agents/SeeDance.png",
  seedream: "/agency-assets/agents/SeeDance.png",
  seedvideo: "/agency-assets/agents/SeeDance.png",
};

function scrubLegacyFableNames(value: string): string {
  return String(value || "")
    .replace(/\banthropic\/claude[-_\s.]*opus[-_\w.]*/gi, "Claude Opus 4.6")
    .replace(/\bclaude[-_\s.]*opus[-_\w.]*/gi, "Claude Opus 4.6")
    .replace(/\bclaude\s+opus\b/gi, "Claude Opus 4.6")
    .replace(/\bfable\s*5?\b/gi, "Claude Opus 4.6")
    .replace(/\bopus\b/gi, "Claude Opus 4.6");
}

function normalizeStatus(task: PearlAgencyTask): string {
  return String(task.rawStatus || task.status || "pending").toLowerCase();
}

function isTaskActive(task: PearlAgencyTask): boolean {
  const status = normalizeStatus(task);
  return ["running", "in_progress", "processing", "working", "queued", "pending", "idle"].includes(status);
}

function isTaskComplete(task: PearlAgencyTask): boolean {
  const status = normalizeStatus(task);
  return ["completed", "complete", "done", "succeeded", "success"].includes(status);
}

function isFastDraftTask(task: PearlAgencyTask): boolean {
  return task.executionMode === "fast_draft";
}

function jackalopeSpriteForTask(task: PearlAgencyTask): string {
  if (isTaskComplete(task)) return "/pixel-ui/sprites/jackalope/done.png";
  if (isTaskActive(task)) return "/pixel-ui/sprites/jackalope/working.png";
  return "/pixel-ui/sprites/jackalope/idle.png";
}

function taskText(task: PearlAgencyTask): string {
  return [
    task.swarmCategory,
    task.kind,
    task.assignee,
    task.title,
    task.label,
    task.description,
    ...(task.agents || []),
  ].filter(Boolean).join(" ");
}

function roomForTask(task: PearlAgencyTask): AgencyRoomKey {
  const text = taskText(task);
  const explicit = String(task.swarmCategory || "").toLowerCase();
  if (/design|art|visual|image|video/.test(explicit)) return "design";
  if (/strategy|plan|architect|product/.test(explicit)) return "strategy";
  if (/creative|writing|writer|copy/.test(explicit)) return "creative";
  if (/research|legal|market|news|analysis/.test(explicit)) return "research";
  if (/code|engineering|developer/.test(explicit)) return "code";

  const match = ROOM_CONFIGS.find((room) => room.key !== "generic" && room.keywords.some((pattern) => pattern.test(text)));
  return match?.key || "generic";
}

function friendlyAgentName(agent: string): string {
  const raw = String(agent || "").trim();
  if (!raw) return "Agent";
  if (/deepseek.*flash|flash.*deepseek|deepseekflash/i.test(raw)) return "DeepSeekFlashV4";
  if (/deepseek/i.test(raw)) return /pro|v4/i.test(raw) ? "DeepSeek Pro V4" : "DeepSeek";
  if (/codex|openai/i.test(raw)) return "Codex";
  if (/claude|opus|fable/i.test(raw)) return "Claude Opus 4.6";
  if (/sonnet/i.test(raw)) return "Sonnet";
  if (/kimi/i.test(raw)) return /2\.?7|k2\.?7/i.test(raw) ? "Kimi K2.7 Code" : "Kimi";
  if (/qwen/i.test(raw)) {
    if (/3\.7|max|best/i.test(raw)) return "Qwen3.7 Max";
    return /coder|plus/i.test(raw) ? "Qwen3 Coder Plus" : "Qwen";
  }
  if (/glm/i.test(raw)) return /5\.?1/i.test(raw) ? "GLM 5.1" : "GLM";
  if (/gemini|gemma/i.test(raw)) return /3\.?5|latest/i.test(raw) ? "Gemini 3.5 Flash" : "Gemini";
  if (/grok/i.test(raw)) return "Grok";
  if (/nano.?banana/i.test(raw)) return "NanoBanana";
  if (/see.?dance|seed/i.test(raw)) return "SeeDance";
  return raw.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 18);
}

function spriteForAgent(agent: string): string {
  const compact = String(agent || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = Object.keys(SPRITES).find((candidate) => compact.includes(candidate));
  return key ? SPRITES[key] : "/agency-assets/agency-logo.png";
}

function hasSpecificTaskAgents(agents: string[] | undefined): agents is string[] {
  if (!agents?.length) return false;
  return agents.some((agent) => {
    const compact = String(agent || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return compact !== "" && compact !== "agent" && compact !== "pearl" && compact !== "pearlagent";
  });
}

function activeAgentsForTask(task: PearlAgencyTask | null, room: RoomConfig): string[] {
  if (!task) return [];
  const candidates = [
    ...(task.agents || []),
    ...(task.agentActivity ? Object.keys(task.agentActivity) : []),
    task.assignee,
  ].filter(Boolean) as string[];

  const namedAgents = candidates.filter((agent) => hasSpecificTaskAgents([agent]));
  const uniqueAgents = Array.from(new Set(namedAgents.map(friendlyAgentName)));
  return (uniqueAgents.length ? uniqueAgents : room.agents).slice(0, 7);
}

function latestThought(task: PearlAgencyTask, agent: string): string {
  const activity = task.agentActivity || {};
  const compactAgent = agent.toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = Object.entries(activity).find(([key]) => {
    const compactKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const compactFriendlyKey = friendlyAgentName(key).toLowerCase().replace(/[^a-z0-9]/g, "");
    return (
      compactKey.includes(compactAgent) ||
      compactAgent.includes(compactKey) ||
      compactFriendlyKey === compactAgent
    );
  });
  const thought = scrubLegacyFableNames(match?.[1]?.thought || "").trim();
  if (thought) return thought;
  const note = [...(task.notes || [])].reverse().find(isVisibleTaskNote);
  if (note?.text) return scrubLegacyFableNames(note.text).trim();
  if (task.result?.trim()) return `Result: ${scrubLegacyFableNames(task.result).trim()}`;
  const status = normalizeStatus(task);
  if (status === "pending" || status === "idle" || status === "queued") return "Queued and ready.";
  if (status === "completed" || status === "complete" || status === "done") return "Work complete.";
  if (status === "failed") return "Needs attention.";
  return "Working through the next step.";
}

function usefulWorkingSummary(task: PearlAgencyTask, agent: string): string {
  const thought = latestThought(task, agent).trim();
  const title = displayTitle(task);
  if (thought && !/^(Queued and ready\.|Working through the next step\.|No agent log lines were recorded)/i.test(thought)) {
    return thought;
  }

  const status = normalizeStatus(task);
  if (["pending", "idle", "queued"].includes(status)) return `Queued for ${title}`;
  if (["completed", "complete", "done", "succeeded", "success"].includes(status)) return `Finished ${title}`;
  if (["failed", "error"].includes(status)) return `Needs review on ${title}`;
  return `Working on ${title}`;
}

function isVisibleTaskNote(note: { text?: string; kind?: string }): boolean {
  const text = (note.text || "").trim();
  if (!text) return false;
  if (note.kind === "internal" || note.kind === "internal_retry") return false;
  if (/^Claimed by pearl-worker@/i.test(text)) return false;
  if (/^worker (?:reconciled|detected|handled|direct|failed|exception)/i.test(text)) return false;
  if (/^\[REAPER\]/i.test(text)) return false;
  if (/^executor:\s/i.test(text)) return false;
  if (/^manual trigger\s/i.test(text)) return false;
  if (/^Attempt #\d+ failed: .*Auto-requeued as pending for retry\.?$/i.test(text)) return false;
  return true;
}

function displayTitle(task: PearlAgencyTask): string {
  return scrubLegacyFableNames(String(task.title || task.label || task.description || "Agency task")).trim().slice(0, 96);
}

function roomStatusLabel(tasks: PearlAgencyTask[]): string {
  if (!tasks.length) return "Idle";
  const running = tasks.some((task) => ["running", "in_progress", "processing", "working"].includes(normalizeStatus(task)));
  if (running) return "Working";
  const pending = tasks.some((task) => ["pending", "queued", "idle"].includes(normalizeStatus(task)));
  if (pending) return "Queued";
  const failed = tasks.some((task) => ["failed", "error"].includes(normalizeStatus(task)));
  if (failed) return "Needs review";
  return "Done";
}

function taskLogLines(task: PearlAgencyTask): string[] {
  const lines = [
    ...(task.agentActivity
      ? Object.entries(task.agentActivity).map(([agent, activity]) => {
          const thought = activity?.thought?.trim();
          return thought ? `${friendlyAgentName(agent)}: ${scrubLegacyFableNames(thought)}` : "";
        })
      : []),
    ...(task.notes || []).filter(isVisibleTaskNote).map((note) => scrubLegacyFableNames(note.text || "").trim()),
    task.result?.trim() ? `Result: ${scrubLegacyFableNames(task.result).trim()}` : "",
  ].filter(Boolean);
  return lines.length ? lines : ["No agent log lines were recorded for this task."];
}

function AgencyRoom({
  room,
  tasks,
  compact = false,
}: {
  room: RoomConfig;
  tasks: PearlAgencyTask[];
  compact?: boolean;
}) {
  const [openPile, setOpenPile] = useState(false);
  const fastDraftTask = tasks.find(isFastDraftTask) || null;
  const activeTask = tasks.find(isTaskActive) || null;
  const completedTasks = tasks.filter(isTaskComplete);
  const taskAgents = activeAgentsForTask(activeTask, room);
  const active = Boolean(activeTask && isTaskActive(activeTask));
  const visibleAgents = active ? taskAgents : room.agents.slice(0, compact ? 3 : 4);
  const firstThought = activeTask ? usefulWorkingSummary(activeTask, friendlyAgentName(visibleAgents[0] || room.agents[0])) : "";

  if (fastDraftTask) {
    const statusLabel = isTaskComplete(fastDraftTask)
      ? "Draft delivered"
      : isTaskActive(fastDraftTask)
      ? "Messenger running"
      : "Messenger waiting";
    return (
      <section
        className="agency-room agency-room-working relative isolate min-w-0 max-w-full overflow-hidden rounded-[8px] border bg-[#0b0f16] shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
        style={{ aspectRatio: "4 / 1" }}
      >
        <img
          src={room.background}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
          style={{ imageRendering: "pixelated" }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/42 via-black/10 to-black/24" />
        <div
          className="agency-department-label agency-department-working absolute left-1/2 top-[12%] z-20 flex -translate-x-1/2 items-center justify-center rounded px-3 py-1 text-center text-[10px] font-bold uppercase tracking-[0.08em] text-white md:text-[11px]"
          style={{ backgroundColor: "#10b981", boxShadow: "0 0 18px rgba(16,185,129,0.92), 0 0 0 1px #10b981" }}
        >
          <span>Fast Draft</span>
        </div>
        <div className="agency-task-dialogue absolute left-2 top-[48%] z-10 max-w-[52%] -translate-y-1/2 rounded border border-white/15 bg-white px-2.5 py-1.5 text-[#1d1b24] shadow-[0_4px_0_rgba(0,0,0,0.28)] md:left-3 md:max-w-[42%] md:px-3 md:py-2">
          <div className="truncate text-[12px] font-semibold leading-tight">{displayTitle(fastDraftTask)}</div>
          <div className="mt-1 line-clamp-3 text-[10px] leading-snug text-[#4c4658] md:text-[11px]">
            {statusLabel}
          </div>
        </div>
        <div className="agency-agent-row agency-agents-working absolute inset-x-0 bottom-[6%] z-10 flex items-end justify-center">
          <div className="agency-agent agency-agent-working relative flex flex-col items-center" style={{ ["--agency-agent-count" as string]: 1 }}>
            <img
              src={jackalopeSpriteForTask(fastDraftTask)}
              alt="Jackalope messenger"
              className={`agency-agent-sprite object-contain drop-shadow-[0_5px_5px_rgba(0,0,0,0.65)] ${isTaskActive(fastDraftTask) ? "agency-agent-bob" : ""}`}
              draggable={false}
              style={{ imageRendering: "pixelated" }}
            />
            <div className="agency-name-tag mb-1 max-w-[104px] truncate rounded-full border border-white/20 bg-[#090712]/90 px-2 text-center text-[8px] font-semibold leading-4 text-white shadow-[0_2px_8px_rgba(0,0,0,0.75)] md:text-[10px]">
              Jackalope
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`agency-room relative isolate min-w-0 max-w-full overflow-hidden rounded-[8px] border bg-[#0b0f16] shadow-[0_10px_30px_rgba(0,0,0,0.35)] ${active ? "agency-room-working" : "agency-room-idle"}`}
      style={{ aspectRatio: active ? "4 / 1.25" : "8 / 1" }}
    >
      <img
        src={room.background}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
        style={{ imageRendering: "pixelated" }}
      />
      <div className={active ? "absolute inset-0 bg-gradient-to-r from-black/36 via-black/4 to-black/24" : "absolute inset-0 bg-black/50"} />
      <div
        className={`agency-department-label absolute left-1/2 top-[12%] z-20 flex -translate-x-1/2 items-center justify-center rounded px-3 py-1 text-center text-[10px] font-bold uppercase tracking-[0.08em] text-white md:text-[11px] ${active ? "agency-department-working" : ""}`}
        style={{ backgroundColor: room.accent, boxShadow: active ? `0 0 18px rgba(136,220,255,0.92), 0 0 0 1px ${room.accent}` : `0 0 0 1px ${room.accent}` }}
      >
        <span>{room.title}</span>
      </div>

      {activeTask ? (
        <div className="agency-task-dialogue absolute left-2 top-[48%] z-10 max-w-[48%] -translate-y-1/2 rounded border border-white/15 bg-white px-2.5 py-1.5 text-[#1d1b24] shadow-[0_4px_0_rgba(0,0,0,0.28)] md:left-3 md:max-w-[40%] md:px-3 md:py-2">
          <div className="truncate text-[12px] font-semibold leading-tight">{displayTitle(activeTask)}</div>
          <div className="mt-1 line-clamp-3 text-[10px] leading-snug text-[#4c4658] md:text-[11px]">
            {firstThought}
          </div>
        </div>
      ) : null}

      {completedTasks.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpenPile((value) => !value)}
          className="agency-paper-pile absolute right-2 top-2 z-30 h-9 w-11 text-left md:right-3 md:top-3 md:h-11 md:w-14"
          title="Show completed task logs"
          aria-label={`Show ${completedTasks.length} completed task logs`}
        >
          <span className="absolute left-1 top-1 h-7 w-9 rotate-[-7deg] rounded-[2px] border border-[#b89d65] bg-[#ead8ac] shadow-sm md:h-9 md:w-11" />
          <span className="absolute left-0.5 top-0.5 h-7 w-9 rotate-[4deg] rounded-[2px] border border-[#b89d65] bg-[#f3e3bc] shadow-sm md:h-9 md:w-11" />
          <span className="absolute left-0 top-0 h-7 w-9 rounded-[2px] border border-[#b89d65] bg-[#fff0c8] shadow md:h-9 md:w-11">
            <span className="absolute left-1.5 top-2 h-0.5 w-5 bg-[#8c7040]/45 md:w-7" />
            <span className="absolute left-1.5 top-4 h-0.5 w-4 bg-[#8c7040]/35 md:w-6" />
            <span className="absolute bottom-0 right-0 rounded-tl bg-[#2d2118]/80 px-1 text-[8px] leading-3 text-white md:text-[9px]">{completedTasks.length}</span>
          </span>
        </button>
      ) : null}

      {openPile ? (
        <div className="absolute right-2 top-12 z-40 max-h-[70%] w-[min(360px,72%)] overflow-y-auto rounded border border-[#b89d65] bg-[#fff4cf] p-2 text-[10px] leading-snug text-[#2b2118] shadow-xl md:right-3 md:top-16 md:text-[11px]">
          {completedTasks.slice(0, 5).map((task) => (
            <div key={task.id} className="border-b border-[#b89d65]/35 py-1.5 last:border-b-0">
              <div className="font-bold">{displayTitle(task)}</div>
              {taskLogLines(task).slice(0, 4).map((line, index) => (
                <div key={`${task.id}-line-${index}`} className="mt-1 text-[#5c4a32]">{line}</div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      <div className={`agency-agent-row absolute inset-x-0 bottom-[6%] z-10 flex items-end justify-center ${active ? "agency-agents-working" : "agency-agents-idle"}`}>
        {visibleAgents.map((agent, index) => {
          const name = friendlyAgentName(agent);
          const thought = activeTask ? usefulWorkingSummary(activeTask, name) : "Idle";
          return (
            <div
              key={`${room.key}-${name}-${index}`}
              className={`agency-agent relative flex flex-col items-center ${active ? "agency-agent-working" : "agency-agent-idle"}`}
              style={{ ["--agency-agent-index" as string]: index, ["--agency-agent-count" as string]: visibleAgents.length }}
            >
              {activeTask && index < 4 ? (
                <div className="agency-speech-bubble mb-1 max-w-[86px] rounded border border-[#d7d4cc] bg-white px-1.5 py-1 text-center text-[8px] leading-tight text-[#2b2633] shadow-md md:max-w-[116px] md:text-[10px]">
                  <span className="line-clamp-3">{thought}</span>
                </div>
              ) : null}
              <img
                src={spriteForAgent(name)}
                alt={name}
                className={`agency-agent-sprite object-contain drop-shadow-[0_5px_5px_rgba(0,0,0,0.65)] ${activeTask ? "agency-agent-bob" : ""}`}
                draggable={false}
                style={{ imageRendering: "pixelated", animationDelay: `${index * 120}ms` }}
              />
              <div className="agency-name-tag mb-1 max-w-[78px] truncate rounded-full border border-white/20 bg-[#090712]/90 px-2 text-center text-[8px] font-semibold leading-4 text-white shadow-[0_2px_8px_rgba(0,0,0,0.75)] md:max-w-[104px] md:text-[10px]">
                {name}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function PearlAgencyRooms({
  tasks = [],
  focusTask,
  compact = false,
  className = "",
}: {
  tasks?: PearlAgencyTask[];
  focusTask?: PearlAgencyTask | null;
  compact?: boolean;
  className?: string;
}) {
  const roomTasks = useMemo(() => {
    const map = new Map<AgencyRoomKey, PearlAgencyTask[]>();
    ROOM_CONFIGS.forEach((room) => map.set(room.key, []));
    const source = focusTask ? [focusTask] : tasks;
    source.filter(Boolean).forEach((task) => {
      const key = roomForTask(task);
      map.get(key)?.push(task);
    });
    return map;
  }, [focusTask, tasks]);

  const roomsToShow = focusTask
    ? ROOM_CONFIGS.filter((room) => room.key === roomForTask(focusTask))
    : ROOM_CONFIGS;

  return (
    <div className={`agency-room-stack ${className}`}>
      <style>{`
        .agency-room-stack { min-width: 0; max-width: 100%; overflow-x: hidden; font-family: Gohufont, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
        .agency-room-grid { min-width: 0; max-width: 100%; }
        .agency-room { width: 100%; max-width: 100%; border-color: rgba(255,255,255,0.12); transition: min-height 180ms ease, opacity 180ms ease; }
        .agency-room-working { min-height: 210px; }
        .agency-room-idle { min-height: 96px; }
        .agency-room-working { border-color: rgba(136,220,255,0.42); box-shadow: 0 0 22px rgba(80,185,255,0.2), 0 10px 30px rgba(0,0,0,0.35); }
        .agency-agent-row { gap: clamp(4px, 1.8vw, 18px); padding-inline: 7%; }
        .agency-agents-idle { justify-content: space-around; bottom: 8%; }
        .agency-agent { width: clamp(48px, 12vw, 112px); }
        .agency-agent-sprite { width: clamp(46px, 10vw, 98px); height: clamp(46px, 10vw, 98px); }
        .agency-agent-working .agency-agent-sprite { filter: drop-shadow(0 0 8px rgba(125,218,255,0.98)) drop-shadow(0 6px 6px rgba(0,0,0,0.68)); }
        .agency-agent-idle { animation: agency-agent-wiggle 3.8s ease-in-out infinite; animation-delay: calc(var(--agency-agent-index) * -520ms); transform-origin: 50% 100%; }
        .agency-agent-bob { animation: agency-agent-bob 1.9s ease-in-out infinite; }
        @keyframes agency-agent-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        @keyframes agency-agent-wiggle {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-2px) rotate(-1.2deg); }
          50% { transform: translateY(1px) rotate(0.8deg); }
          75% { transform: translateY(-1px) rotate(1.1deg); }
        }
        @media (min-width: 768px) {
          .agency-room-working { min-height: 264px; }
          .agency-room-idle { min-height: 132px; }
          .agency-agent-sprite { width: clamp(116px, 9vw, 178px); height: clamp(116px, 9vw, 178px); }
          .agency-agent { width: clamp(120px, 9.6vw, 188px); }
          .agency-agents-idle { bottom: max(0px, calc(8% - 30px)); }
          .agency-agents-working { gap: clamp(8px, 1.5vw, 26px); padding-inline: 12%; }
        }
        @media (max-width: 767px) {
          .agency-room-working { min-height: 138px; aspect-ratio: 3.7 / 1.2; }
          .agency-room-idle { min-height: 70px; aspect-ratio: 7.4 / 1; }
          .agency-department-label { top: 8%; max-width: 52%; padding-inline: 7px; font-size: 9px; }
          .agency-agent-row { bottom: 1%; gap: 1px; padding-inline: 4px; }
          .agency-agents-working { gap: 2px; }
          .agency-task-dialogue { left: 6px; top: 43%; max-width: 43%; padding: 5px 7px; }
          .agency-speech-bubble { max-width: 54px; padding: 3px 4px; font-size: 7px; }
          .agency-agent { width: min(42px, calc((100% - 10px) / var(--agency-agent-count))); min-width: 0; }
          .agency-agent-sprite { width: min(40px, calc((100vw - 58px) / var(--agency-agent-count))); height: min(40px, calc((100vw - 58px) / var(--agency-agent-count))); }
          .agency-name-tag { display: block; max-width: 50px; padding-inline: 5px; font-size: 7px; line-height: 13px; }
        }
      `}</style>
      <div className={compact ? "agency-room-grid grid gap-2" : "agency-room-grid grid gap-3"}>
        {roomsToShow.map((room) => (
          <AgencyRoom
            key={room.key}
            room={room}
            tasks={roomTasks.get(room.key) || []}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}

export { ROOM_CONFIGS as PEARL_AGENCY_ROOMS };
