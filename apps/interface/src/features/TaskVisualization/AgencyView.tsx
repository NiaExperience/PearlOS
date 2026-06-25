"use client";

import React from "react";
import { Loader2, Plus, RefreshCw, Send, SlidersHorizontal, Sparkles, Users, X } from "lucide-react";
import {
  PEARL_AGENCY_ROOMS,
  PearlAgencyRooms,
  type AgencyRoomKey,
  type PearlAgencyTask,
  type RoomConfig,
} from "./PearlAgencyRooms";
import { useTaskVisualizationData } from "./useTaskVisualizationData";
import { AgencyBossControl } from "./AgencyBossControl";
import { DepartmentRoleRoster } from "./DepartmentRoleRoster";
import {
  AGENCY_DEPARTMENTS,
  defaultDepartmentAssignments,
  modelOptionById,
} from "@interface/lib/agency-roster";
import {
  requestWindowClose,
  requestWindowOpen,
} from "@interface/features/ManeuverableWindow/lib/windowLifecycleController";

type RoomSelection = Record<AgencyRoomKey, { enabled: boolean; agents: number }>;

const ROOM_AGENT_POOL: Record<AgencyRoomKey, string[]> = {
  code: ["Codex", "DeepSeek Pro V4", "Kimi K2.7 Code", "Qwen3.7 Max", "Qwen3 Coder Plus", "GLM 5.1", "Gemini 3.5 Flash"],
  generic: ["DeepSeek V4 Flash", "Claude Opus 4.6", "Qwen3.7 Max", "Gemini 3.5 Flash", "Codex", "Kimi K2.7 Code", "GLM 5.1"],
  research: ["DeepSeek Pro V4", "Kimi K2.7 Code", "Gemini 3.5 Flash", "Qwen3.7 Max", "Claude Opus 4.6", "GLM 5.1"],
  creative: ["Kimi K2.7 Code", "Claude Opus 4.6", "Grok", "Gemini 3.5 Flash", "Qwen3.7 Max"],
  strategy: ["Claude Opus 4.6", "DeepSeek Pro V4", "GLM 5.1", "Qwen3.7 Max", "Gemini 3.5 Flash", "Kimi K2.7 Code"],
  design: ["NanoBanana", "SeeDance", "Gemini 3.5 Flash", "Kimi K2.7 Code", "Qwen3.7 Max", "Codex"],
};

function defaultRoomSelection(): RoomSelection {
  return PEARL_AGENCY_ROOMS.reduce((acc, room) => {
    acc[room.key] = { enabled: room.key === "generic", agents: 1 };
    return acc;
  }, {} as RoomSelection);
}

function selectedRoomSummary(rooms: RoomConfig[], selection: RoomSelection): string {
  const parts = rooms
    .filter((room) => selection[room.key]?.enabled)
    .map((room) => `${room.title} x${selection[room.key]?.agents || 1}`);
  return parts.length ? parts.join(", ") : "No rooms selected";
}

function roleModelsForRoom(roomKey: AgencyRoomKey, assignments: Record<string, string>): string[] {
  const department = AGENCY_DEPARTMENTS.find((item) => item.key === roomKey);
  if (!department) return [];
  return department.roles.map((role) => modelOptionById(assignments[role.id] || role.defaultModelId).label);
}

function agentsForSelection(selection: RoomSelection, assignments: Record<string, string>): string[] {
  return Object.entries(selection).flatMap(([key, value]) => {
    if (!value.enabled) return [];
    const roomKey = key as AgencyRoomKey;
    const pool = roleModelsForRoom(roomKey, assignments);
    const fallback = ROOM_AGENT_POOL[roomKey] || ROOM_AGENT_POOL.generic;
    const candidates = pool.length ? pool : fallback;
    return Array.from({ length: value.agents }, (_, index) => candidates[index % candidates.length]);
  });
}

function selectedRoleSummary(selection: RoomSelection, assignments: Record<string, string>): string {
  const lines = Object.entries(selection).flatMap(([key, value]) => {
    if (!value.enabled) return [];
    const roomKey = key as AgencyRoomKey;
    const department = AGENCY_DEPARTMENTS.find((item) => item.key === roomKey);
    if (!department) return [];
    return department.roles.map((role) => {
      const model = modelOptionById(assignments[role.id] || role.defaultModelId);
      return `${department.title} - ${role.title}: ${model.label}`;
    });
  });
  return lines.length ? lines.join("\n") : "No role assignments selected.";
}

function loadRoleAssignments(): Record<string, string> {
  const defaults = defaultDepartmentAssignments();
  if (typeof window === "undefined") return defaults;
  try {
    const parsed = JSON.parse(window.localStorage.getItem("pearl-agency-role-assignments") || "{}");
    return { ...defaults, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return defaults;
  }
}

function saveRoleAssignments(assignments: Record<string, string>) {
  try {
    window.localStorage.setItem("pearl-agency-role-assignments", JSON.stringify(assignments));
  } catch {
    // Local preferences are optional.
  }
}

function primarySwarmCategory(rooms: RoomConfig[], selection: RoomSelection): string {
  const selected = rooms.filter((room) => selection[room.key]?.enabled);
  if (selected.length === 1) return selected[0].title;
  if (selected.length > 1) return "Multi-room";
  return "General";
}

function agencyTaskStatus(task: PearlAgencyTask): string {
  return String(task.rawStatus || task.status || "").toLowerCase();
}

function isLiveAgencyTask(task: PearlAgencyTask): boolean {
  return !["cancelled", "archived"].includes(agencyTaskStatus(task));
}

export default function AgencyView() {
  const { tasks, loading, error, refresh } = useTaskVisualizationData();
  const agencyTasks = tasks.filter(isLiveAgencyTask).slice(0, 24);
  const [newTaskOpen, setNewTaskOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [details, setDetails] = React.useState("");
  const [rooms, setRooms] = React.useState<RoomSelection>(() => defaultRoomSelection());
  const [roleAssignments, setRoleAssignments] = React.useState<Record<string, string>>(() => loadRoleAssignments());
  const [roleRosterOpen, setRoleRosterOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const roomSummary = selectedRoomSummary(PEARL_AGENCY_ROOMS, rooms);
  const roleSummary = selectedRoleSummary(rooms, roleAssignments);
  const selectedAgents = agentsForSelection(rooms, roleAssignments);
  const canSubmit = title.trim().length > 0 && selectedAgents.length > 0 && !submitting;
  const activeTaskCount = agencyTasks.filter((task) => ["pending", "in_progress", "running", "working"].includes(agencyTaskStatus(task))).length;
  const floorStatus = loading
    ? "Checking the floor..."
    : activeTaskCount > 0
      ? `${activeTaskCount} active task${activeTaskCount === 1 ? "" : "s"} on the floor`
      : "Floor is ready for the next job";

  const openCouncil = React.useCallback(() => {
    requestWindowClose({ viewType: "agency", source: "agency:summon-agent" });
    requestWindowOpen({
      viewType: "council",
      source: "agency:summon-agent",
      options: { allowDuplicate: false },
    });
  }, []);

  const resetForm = React.useCallback(() => {
    setTitle("");
    setDetails("");
    setRooms(defaultRoomSelection());
    setSubmitError(null);
  }, []);

  const updateRoleAssignment = React.useCallback((roleId: string, modelId: string) => {
    setRoleAssignments((previous) => {
      const next = { ...previous, [roleId]: modelId };
      saveRoleAssignments(next);
      return next;
    });
  }, []);

  const submitTask = React.useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    const allocation = roomSummary;
    const taskText = [
      title.trim(),
      details.trim(),
      `Agency room allocation: ${allocation}.`,
      `Requested agent count: ${selectedAgents.length}.`,
      `Agency role assignments:\n${roleSummary}`,
    ].filter(Boolean).join("\n\n");

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          title: title.trim(),
          task: taskText,
          source: "manual",
          createdBy: "agency",
          assignee: "claude_cli",
          urgency: "normal",
          execute: true,
          kind: "swarm",
          swarmCategory: primarySwarmCategory(PEARL_AGENCY_ROOMS, rooms),
          agents: selectedAgents,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof json?.error === "string" ? json.error : `Task create failed (${response.status})`);
      }
      resetForm();
      setNewTaskOpen(false);
      await refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not create task.");
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, details, refresh, resetForm, roleSummary, roomSummary, rooms, selectedAgents, title]);

  return (
    <main className="pearl-themed-app flex h-full min-h-0 flex-col overflow-hidden">
      <header className="pearl-themed-app-surface relative flex flex-shrink-0 items-center justify-center border-b px-3 py-1.5">
        <img
          src="/agency-assets/agency-logo.png"
          alt="The Agency"
          className="h-12 w-auto flex-shrink-0 object-contain"
          draggable={false}
        />
        <div className="absolute left-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          <button
            type="button"
            onClick={openCouncil}
            className="inline-flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-semibold hover:opacity-90"
            style={{
              background: "color-mix(in srgb, var(--pearl-accent), transparent 82%)",
              borderColor: "color-mix(in srgb, var(--pearl-accent), transparent 58%)",
              color: "var(--pearl-text)",
            }}
            title="Summon Agent"
            aria-label="Summon Agent"
          >
            <Sparkles size={14} />
            <span className="hidden sm:inline">Summon Agent</span>
            <span className="sm:hidden">Summon</span>
          </button>
          <button
            type="button"
            onClick={() => setNewTaskOpen(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-semibold hover:opacity-90"
            style={{
              background: "color-mix(in srgb, var(--pearl-accent), transparent 88%)",
              borderColor: "color-mix(in srgb, var(--pearl-accent), transparent 64%)",
              color: "var(--pearl-text)",
            }}
            title="Create Agency task"
            aria-label="Create Agency task"
          >
            <Plus size={14} />
            <span>New</span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded border pearl-themed-app-panel hover:opacity-90"
          title="Refresh Agency rooms"
          aria-label="Refresh Agency rooms"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </header>

      <section className="pearl-themed-app-surface flex flex-shrink-0 flex-col gap-2 border-b px-3 py-2">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <AgencyBossControl />
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <div className="pearl-themed-app-panel flex min-w-0 items-center gap-2 rounded border px-3 py-2">
              <Users size={15} className="flex-shrink-0 text-white/62" />
              <div className="min-w-0">
                <div className="truncate text-[11px] font-bold text-white">{floorStatus}</div>
                <div className="truncate text-[10px] text-white/44">Departments wake up when work lands in their room.</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRoleRosterOpen((value) => !value)}
              className="pearl-themed-app-panel inline-flex h-10 items-center justify-center gap-2 rounded border px-3 text-[11px] font-bold hover:opacity-90"
              aria-expanded={roleRosterOpen}
              aria-controls="agency-team-roles"
              title="Adjust Agency role models"
            >
              <SlidersHorizontal size={14} />
              Team roles
            </button>
          </div>
        </div>
        {roleRosterOpen ? (
          <div id="agency-team-roles">
            <DepartmentRoleRoster assignments={roleAssignments} onAssignmentChange={updateRoleAssignment} />
          </div>
        ) : null}
      </section>

      {error ? (
        <div className="mx-4 mt-3 rounded border border-red-400/25 bg-red-950/30 px-3 py-2 text-[11px] text-red-100">
          {error}
        </div>
      ) : null}

      <section className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 sm:px-3 sm:py-3">
        <PearlAgencyRooms tasks={agencyTasks} />
      </section>

      {newTaskOpen ? (
        <div className="absolute inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/62 px-3 py-4 sm:items-center">
          <div
            className="pearl-themed-app-surface flex max-h-[calc(100dvh-32px)] w-full max-w-[760px] flex-col overflow-hidden rounded-[8px] border shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agency-new-task-title"
          >
            <div className="pearl-themed-app-surface flex flex-shrink-0 items-center justify-between border-b px-4 py-3">
              <div>
                <h2 id="agency-new-task-title" className="text-sm font-bold">New Task</h2>
                <p className="pearl-themed-app-muted mt-0.5 text-[11px]">{roomSummary}</p>
              </div>
              <button
                type="button"
                onClick={() => setNewTaskOpen(false)}
                className="pearl-themed-app-panel inline-flex h-8 w-8 items-center justify-center rounded border hover:opacity-90"
                aria-label="Close new task"
              >
                <X size={15} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4">
              <label className="grid gap-1.5">
                <span className="pearl-themed-app-muted text-[11px] font-semibold uppercase tracking-[0.08em]">Title</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="pearl-themed-app-panel h-10 rounded border px-3 text-sm outline-none"
                  placeholder="What should the Agency do?"
                  autoFocus
                />
              </label>

              <label className="grid gap-1.5">
                <span className="pearl-themed-app-muted text-[11px] font-semibold uppercase tracking-[0.08em]">Details</span>
                <textarea
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  className="pearl-themed-app-panel min-h-20 resize-y rounded border px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-white/38 sm:min-h-24"
                  placeholder="Context, constraints, desired output, links, files, or acceptance notes."
                />
              </label>

              <div className="grid gap-2">
                <div className="pearl-themed-app-muted text-[11px] font-semibold uppercase tracking-[0.08em]">Rooms and Agents</div>
                <div className="grid gap-2 md:grid-cols-2">
                  {PEARL_AGENCY_ROOMS.map((room) => {
                    const current = rooms[room.key] || { enabled: false, agents: 1 };
                    return (
                      <div
                        key={room.key}
                        className="rounded-[8px] border p-3"
                        style={{
                          background: current.enabled
                            ? "color-mix(in srgb, var(--pearl-accent), transparent 86%)"
                            : "var(--pearl-window-content-bg)",
                          borderColor: current.enabled
                            ? "color-mix(in srgb, var(--pearl-accent), transparent 50%)"
                            : "var(--pearl-window-border)",
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => setRooms((prev) => ({
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
                              <span className="block truncate text-sm font-bold">{room.title}</span>
                              <span className="pearl-themed-app-muted block truncate text-[10px]">{room.subtitle}</span>
                            </span>
                          </button>
                          <span className="pearl-themed-app-accent w-12 text-right text-xs font-bold">{current.agents}</span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={7}
                          step={1}
                          value={current.agents}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            setRooms((prev) => ({
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

              {submitError ? (
                <div className="rounded border border-red-400/25 bg-red-950/35 px-3 py-2 text-[11px] text-red-100">{submitError}</div>
              ) : null}
            </div>

            <div className="pearl-themed-app-surface flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <div className="pearl-themed-app-muted text-[11px]">{selectedAgents.length} agent{selectedAgents.length === 1 ? "" : "s"} selected</div>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void submitTask()}
                className="inline-flex h-9 items-center gap-2 rounded border px-3 text-sm font-bold hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                style={{
                  background: "color-mix(in srgb, var(--pearl-accent), transparent 78%)",
                  borderColor: "color-mix(in srgb, var(--pearl-accent), transparent 48%)",
                  color: "var(--pearl-text)",
                }}
              >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                <span>Dispatch</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
