"use client";

import React, { useState, useEffect, useCallback } from "react";

import { SpriteChips, type ProjectSprite } from "./AttachmentChip";
import { openStudioCreation } from "../lib/play-creation";

// ─── Types ─────────────────────────────────────────────────────────
type ProjectStatus = "queued" | "building" | "complete" | "error";
type ProjectType = "game" | "app" | "feature" | "pearlos";

interface LaunchpadProject {
  id: string;
  title: string;
  content?: string;
  type: ProjectType;
  status: ProjectStatus;
  estimatedMinutes: number;
  swarmDurationMinutes?: number;
  sprites: ProjectSprite[];
  createdAt: string;
  buildPassCompletedAt?: string;
  playUrl?: string;
}

// ─── Status indicators ────────────────────────────────────────────
const StatusDot: React.FC<{ status: ProjectStatus }> = ({ status }) => {
  const base = "inline-block w-2.5 h-2.5 rounded-full";

  switch (status) {
    case "queued":
      return <span className={`${base} bg-amber-400`} />;
    case "building":
      return (
        <span className={`${base} bg-sky-400 animate-pulse`} />
      );
    case "complete":
      return (
        <span className="text-emerald-400 text-xs leading-none font-bold">✓</span>
      );
    case "error":
      return (
        <span className="text-red-400 text-xs leading-none font-bold">✕</span>
      );
  }
};

const statusLabel: Record<ProjectStatus, string> = {
  queued: "Queued",
  building: "Building",
  complete: "Complete",
  error: "Error",
};

const statusColor: Record<ProjectStatus, string> = {
  queued: "text-amber-400",
  building: "text-sky-400",
  complete: "text-emerald-400",
  error: "text-red-400",
};

const statusBorder: Record<ProjectStatus, string> = {
  queued: "border-amber-400/20",
  building: "border-sky-400/20",
  complete: "border-emerald-400/20",
  error: "border-red-400/20",
};

const statusBg: Record<ProjectStatus, string> = {
  queued: "bg-amber-500/10",
  building: "bg-sky-500/10",
  complete: "bg-emerald-500/10",
  error: "bg-red-500/10",
};

const typeIcon: Record<ProjectType, string> = {
  game: "🎮",
  app: "🌐",
  feature: "⚙️",
  pearlos: "🪩",
};

// ─── Helpers ──────────────────────────────────────────────────────
function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─── Actions ──────────────────────────────────────────────────────
function handleDelete(project: LaunchpadProject, onRemove: (id: string) => void) {
  if (!window.confirm(`Delete "${project.title}"?`)) return;
  fetch(`/api/launchpad/projects/${project.id}`, { method: "DELETE" })
    .then((res) => {
      if (res.ok) onRemove(project.id);
    })
    .catch(() => {});
}

// ─── Action Button ────────────────────────────────────────────────
const ActionButton: React.FC<{
  label: string;
  onClick: () => void;
  variant?: "default" | "danger" | "primary";
}> = ({ label, onClick, variant = "default" }) => {
  const styles: Record<string, string> = {
    default:
      "border-white/10 text-[#d4c0e8]/70 hover:bg-white/[0.06] hover:text-[#faf8f5]",
    danger:
      "border-red-400/20 text-red-400/70 hover:bg-red-400/10 hover:text-red-400",
    primary:
      "border-[#D94F8E]/30 text-[#D94F8E]/80 hover:bg-[#D94F8E]/10 hover:text-[#D94F8E]",
  };

  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-1 text-[11px] font-medium transition-all ${styles[variant]}`}
    >
      {label}
    </button>
  );
};

// ─── Project Card ─────────────────────────────────────────────────
const ProjectCard: React.FC<{
  project: LaunchpadProject;
  onRemove: (id: string) => void;
  onUpdate: (project: LaunchpadProject) => void;
}> = ({ project, onRemove, onUpdate }) => {
  // Launch / Edit only unlock once a build pass has produced an artifact.
  // Status alone isn't enough — buildPassCompletedAt is the explicit signal
  // that the swarm finished a successful pass.
  const canLaunch =
    project.status === "complete" && Boolean(project.buildPassCompletedAt);

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(project.title);
  const [editContent, setEditContent] = useState(project.content ?? "");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const startEdit = useCallback(() => {
    setEditTitle(project.title);
    setEditContent(project.content ?? "");
    setEditError(null);
    setEditing(true);
  }, [project.title, project.content]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditError(null);
  }, []);

  const saveEdit = useCallback(async () => {
    const title = editTitle.trim();
    if (!title) {
      setEditError("Title is required");
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/launchpad/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content: editContent }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.project) onUpdate(data.project);
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [editTitle, editContent, project.id, onUpdate]);

  const handleLaunch = useCallback(() => {
    openStudioCreation(project, "launchpad:project-menu-play");
  }, [project]);

  const handleRemoveSprite = useCallback((spriteId: string) => {
    const updatedSprites = project.sprites.filter((s) => s.id !== spriteId);
    fetch(`/api/launchpad/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sprites: updatedSprites }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.project) onUpdate(data.project);
      })
      .catch(() => {});
  }, [project, onUpdate]);

  const editInputClass =
    "w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-[#faf8f5] placeholder-[#d4c0e8]/40 outline-none focus:border-[#D94F8E]/50 transition-colors";

  return (
    <div
      className={`rounded-2xl border bg-white/[0.03] p-4 transition-all hover:bg-white/[0.05] ${statusBorder[project.status]}`}
    >
      {/* Top row: icon + title + status chip */}
      <div className="flex items-start gap-3 mb-2">
        <span className="text-xl mt-0.5">{typeIcon[project.type]}</span>
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Project title"
              className={editInputClass}
              autoFocus
            />
          ) : (
            <div className="text-sm font-semibold text-[#faf8f5] truncate">{project.title}</div>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            <StatusDot status={project.status} />
            <span className={`text-[10px] font-medium uppercase tracking-wider ${statusColor[project.status]}`}>
              {statusLabel[project.status]}
            </span>
            <span className="text-[10px] text-[#d4c0e8]/30">·</span>
            <span className="text-[10px] text-[#d4c0e8]/40">{formatTime(project.estimatedMinutes)}</span>
          </div>
        </div>
        <div className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBg[project.status]} ${statusColor[project.status]}`}>
          {statusLabel[project.status]}
        </div>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-3 mb-2 text-[10px] text-[#d4c0e8]/40">
        <span className="capitalize">{project.type}</span>
        <span>·</span>
        <span>{formatDate(project.createdAt)}</span>
      </div>

      {/* Edit description / Sprite chips */}
      {editing ? (
        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          placeholder="Project description / brief"
          rows={4}
          className={`${editInputClass} resize-none mt-2`}
        />
      ) : (
        <SpriteChips sprites={project.sprites} onRemove={handleRemoveSprite} editable />
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3">
        {editing ? (
          <>
            <ActionButton
              label={saving ? "Saving…" : "Save"}
              onClick={saveEdit}
              variant="primary"
            />
            <ActionButton label="Cancel" onClick={cancelEdit} />
          </>
        ) : canLaunch ? (
          <>
            <ActionButton label="Edit" onClick={startEdit} />
            <ActionButton
              label="Launch"
              onClick={handleLaunch}
              variant="primary"
            />
          </>
        ) : null}
        <div className="flex-1" />
        {!editing && (
          <ActionButton
            label="Delete"
            onClick={() => handleDelete(project, onRemove)}
            variant="danger"
          />
        )}
      </div>

      {editError && (
        <div className="mt-2 text-[10px] text-red-400/80">{editError}</div>
      )}

      {!editing && !canLaunch && project.status !== "error" && (
        <div className="mt-2 text-[10px] text-[#d4c0e8]/30 italic">
          Launch and Edit unlock once the first build pass completes.
        </div>
      )}
    </div>
  );
};

// ─── Main ProjectMenu ─────────────────────────────────────────────
const ProjectMenu: React.FC = () => {
  const [projects, setProjects] = useState<LaunchpadProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/launchpad/projects");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProjects(data.projects ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Listen for pipeline status updates to refresh project list
  useEffect(() => {
    const handler = () => fetchProjects();
    window.addEventListener("nia.pipeline.status", handler);
    return () => window.removeEventListener("nia.pipeline.status", handler);
  }, [fetchProjects]);

  // Listen for new project creation events
  useEffect(() => {
    const handler = () => fetchProjects();
    window.addEventListener("nia.launchpad.project.created", handler);
    return () => window.removeEventListener("nia.launchpad.project.created", handler);
  }, [fetchProjects]);

  const removeProject = useCallback((id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const updateProject = useCallback((updated: LaunchpadProject) => {
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }, []);

  // ─── Loading ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-xs text-[#d4c0e8]/50">
        Loading projects…
      </div>
    );
  }

  // ─── Error ────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="text-center py-10 space-y-3">
        <div className="text-xs text-red-400/70">{error}</div>
        <button
          onClick={() => {
            setLoading(true);
            fetchProjects();
          }}
          className="text-[11px] text-[#D94F8E]/70 hover:text-[#D94F8E] transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // ─── Empty ────────────────────────────────────────────────────
  if (projects.length === 0) {
    return (
      <div className="text-center py-10 space-y-2">
        <div className="text-3xl opacity-40">📂</div>
        <div className="text-xs text-[#d4c0e8]/50">
          No projects yet. Use the Studio Creator to start building!
        </div>
      </div>
    );
  }

  // ─── Project list ─────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pr-1">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} onRemove={removeProject} onUpdate={updateProject} />
      ))}
    </div>
  );
};

export default ProjectMenu;
