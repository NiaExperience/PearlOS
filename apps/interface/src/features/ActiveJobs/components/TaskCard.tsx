"use client";

import { useState, useEffect } from "react";
import type { Task, TaskStatus } from "../types";
import { formatDuration, formatTokens } from "../types";
import { requestWindowOpen } from "@interface/features/ManeuverableWindow/lib/windowLifecycleController";

const STATUS_ICONS: Record<TaskStatus, string> = {
  running: "⚙️",
  done: "✅",
  failed: "❌",
};

interface TaskCardProps {
  task: Task;
  expanded: boolean;
  onToggleExpanded: () => void;
  onDismiss: () => void;
  onStop?: () => void;
  onPause?: () => void;
  onChangePriority?: () => void;
  /** Raw task result text (for REVIEW button) */
  result?: string | null;
  /** Note filename if auto-delivered to user workspace */
  noteFilename?: string | null;
}

function scrubLegacyFableNames(value: string): string {
  return String(value || "")
    .replace(/\banthropic\/claude[-_\s.]*opus[-_\w.]*/gi, "Claude Opus 4.6")
    .replace(/\bclaude[-_\s.]*opus[-_\w.]*/gi, "Claude Opus 4.6")
    .replace(/\bclaude\s+opus\b/gi, "Claude Opus 4.6")
    .replace(/\bfable\s*5?\b/gi, "Claude Opus 4.6")
    .replace(/\bopus\b/gi, "Claude Opus 4.6");
}

function cleanTaskTitle(raw: string): string {
  const cleaned = (raw || "Task")
    .replace(/(?:🏆|🏅|🎖️)+/gu, "")
    .replace(/^\s*(?:discord|webchat|web chat|agency chat|telegram|slack)\s+request(?:\s+from\s+[^:\u2013\u2014-]+)?\s*[:\u2013\u2014-]\s*/i, "")
    .replace(/^\s*(?:discord|webchat|web chat|agency chat|telegram|slack)\s+request(?:\s+from\s+\S+)?\s+/i, "")
    .replace(/^\s*request\s+from\s+[^:\u2013\u2014-]+\s*[:\u2013\u2014-]\s*/i, "")
    .replace(/^\s*(?:task|job)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return scrubLegacyFableNames(cleaned || "Task");
}

function resultNoteId(noteFilename?: string | null): string | null {
  const raw = (noteFilename || "").trim();
  return raw ? raw.replace(/\.md$/i, "") : null;
}

function escapeHtmlText(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resultDataUrl(taskName: string, result?: string | null): string {
  const title = escapeHtmlText(cleanTaskTitle(taskName) || "Task Result");
  const body = escapeHtmlText(scrubLegacyFableNames((result || "").trim()) || "This task completed without a saved result.");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{margin:0;padding:24px;background:#0f1419;color:#e6edf3;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}h1{font:600 18px/1.3 system-ui,sans-serif;margin:0 0 18px;color:#fff;}pre{white-space:pre-wrap;word-break:break-word;margin:0;}</style></head><body><h1>${title}</h1><pre>${body}</pre></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function openLegacyTaskResult(task: Task, result?: string | null, noteFilename?: string | null): void {
  const noteId = resultNoteId(noteFilename);
  if (noteId) {
    requestWindowOpen({
      viewType: "notes",
      title: "Notes",
      source: "active-jobs-card:result",
      viewState: { openNoteId: noteId },
    });
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("openNoteFromFile", { detail: { noteId } }));
      window.dispatchEvent(new CustomEvent("notepadCommand", {
        detail: { action: "openNote", payload: { noteId } },
      }));
    }, 160);
    return;
  }
  requestWindowOpen({
    viewType: "miniBrowser",
    title: cleanTaskTitle(task.name) || "Task Result",
    source: "active-jobs-card:raw-result",
    viewState: { browserUrl: resultDataUrl(task.name, result) },
    options: { allowDuplicate: true },
  });
}

export function TaskCard({
  task,
  expanded,
  onToggleExpanded,
  onDismiss,
  onStop,
  onPause,
  onChangePriority,
  result,
  noteFilename,
}: TaskCardProps) {
  // Live duration ticker for running tasks
  const [, setTick] = useState(0);
  useEffect(() => {
    if (task.status !== "running") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [task.status]);

  const showDismiss =
    task.requiresAcknowledgment && (task.status === "done" || task.status === "failed");
  const title = cleanTaskTitle(task.name);

  return (
    <div style={styles.card}>
      {/* ── TITLE BAR (collapsed): title first, details below. No buttons. ── */}
      <button
        type="button"
        onClick={onToggleExpanded}
        style={styles.header}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse task" : "Expand task"}
      >
        <span style={styles.taskName}>{title}</span>
        <span style={styles.headerDetails}>
          <span style={styles.statusIcon}>{STATUS_ICONS[task.status]}</span>
          <span style={styles.statusText}>
            {task.status === "running" ? "Running" : task.status === "done" ? "Complete" : "Failed"}
          </span>
        </span>
      </button>

      {/* ── EXPANDED ── */}
      {expanded && (
        <div style={styles.expanded}>
          {/* Description */}
          {task.description && <div style={styles.description}>{task.description}</div>}

          {/* Compact metadata */}
          <div style={styles.meta}>
            <DetailRow
              label="Started"
              value={new Date(task.startedAt).toLocaleTimeString()}
            />
            <DetailRow label="Duration" value={formatDuration(task.startedAt)} />
            {task.source && <DetailRow label="Source" value={task.source} />}
            {task.tokens != null && (
              <DetailRow label="Tokens" value={formatTokens(task.tokens)} />
            )}
            <DetailRow
              label="Status"
              value={
                task.status === "running"
                  ? "Running…"
                  : task.status === "done"
                  ? "Complete"
                  : "Failed"
              }
            />
            {task.sessionId && <DetailRow label="Session" value={task.sessionId} />}
            {task.meta &&
              Object.entries(task.meta).map(([k, v]) => (
                <DetailRow key={k} label={k} value={v} />
              ))}
          </div>

          {/* Action icon row: stop / pause / change priority — single row */}
          <div style={styles.actions}>
            {onStop && (
              <button
                type="button"
                onClick={onStop}
                style={styles.iconButton}
                aria-label="Stop task"
                title="Stop"
              >
                ⏹️
              </button>
            )}
            {onPause && task.status === "running" && (
              <button
                type="button"
                onClick={onPause}
                style={styles.iconButton}
                aria-label="Pause task"
                title="Pause"
              >
                ⏸️
              </button>
            )}
            {onChangePriority && (
              <button
                type="button"
                onClick={onChangePriority}
                style={styles.iconButton}
                aria-label="Change priority"
                title="Change priority"
              >
                🎚️
              </button>
            )}
            {showDismiss && (
              <button type="button" onClick={onDismiss} style={styles.dismissButton}>
                ✓ Dismiss
              </button>
            )}
            {(task.status === "done") && (result || noteFilename) && (
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    openLegacyTaskResult(task, result, noteFilename);
                  }
                }}
                style={styles.reviewButton}
                aria-label="Review task result"
              >
                REVIEW
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.detailRow}>
      <span style={styles.detailLabel}>{label}:</span>
      <span style={styles.detailValue}>{value}</span>
    </div>
  );
}

// ── Inline styles ──
const styles: Record<string, React.CSSProperties> = {
  card: {
    background: "#141414",
    border: "1px solid #2a2a2a",
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 8,
    transition: "all 0.2s ease",
  },
  header: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "stretch",
    width: "100%",
    padding: "10px 12px",
    gap: 6,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "inherit",
    textAlign: "left" as const,
  },
  headerDetails: {
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    gap: 6,
  },
  statusIcon: {
    fontSize: "1rem",
    flexShrink: 0,
  },
  taskName: {
    display: "block",
    fontSize: "0.9rem",
    fontWeight: 500,
    color: "#e0e0e0",
    lineHeight: 1.3,
    overflowWrap: "anywhere" as const,
  },
  statusText: {
    flex: 1,
    minWidth: 0,
    fontSize: "0.78rem",
    color: "#888",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  expanded: {
    borderTop: "1px solid #2a2a2a",
    padding: 12,
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
    background: "#0f0f0f",
  },
  description: {
    fontSize: "0.85rem",
    lineHeight: 1.45,
    color: "#cfcfcf",
  },
  meta: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  detailRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "2px 0",
    fontSize: "0.78rem",
  },
  detailLabel: {
    color: "#888",
    fontWeight: 500,
  },
  detailValue: {
    color: "#bbb",
    textAlign: "right" as const,
  },
  actions: {
    display: "flex",
    flexDirection: "row" as const,
    alignItems: "center",
    gap: 8,
  },
  iconButton: {
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: "0.95rem",
    cursor: "pointer",
    color: "#ddd",
    lineHeight: 1,
  },
  dismissButton: {
    marginLeft: "auto",
    background: "#1a3a1a",
    color: "#4ade80",
    border: "1px solid #2a4a2a",
    borderRadius: 8,
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: "0.8rem",
    fontWeight: 500,
  },
  reviewButton: {
    background: "#1a2a4a",
    color: "#60a5fa",
    border: "1px solid #2a3a5a",
    borderRadius: 8,
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: "0.8rem",
    fontWeight: 600,
    letterSpacing: "0.05em",
  },
};
