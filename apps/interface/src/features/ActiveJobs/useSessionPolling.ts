"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Task } from "./types";

interface SessionInfo {
  sessionId: string;
  agent: string;
  label?: string;
  description?: string;
  startedAt?: string;
  isSubagent: boolean;
}

interface SessionsResponse {
  sessions: SessionInfo[];
}

function friendlySessionAgent(agentName: string): string {
  const lower = (agentName || "").toLowerCase();
  if (lower.includes("codex")) return "Codex";
  if (lower.includes("sonnet")) return "Sonnet";
  if (lower.includes("opus") || lower.includes("fable") || lower.includes("claude")) return "Claude Opus 4.6";
  if (lower.includes("gemini")) return "Gemini";
  if (lower.includes("qwen")) return "Qwen";
  if (lower.includes("gemma")) return "Gemma";
  return agentName.split("/").pop() || "Agent";
}

/**
 * Poll the /api/sessions endpoint and convert sessions to Tasks.
 *
 * Only sub-agent sessions become tasks — main sessions are ignored.
 * Polling interval: 2 seconds (adjustable).
 */
export function useSessionPolling(enabled: boolean = true) {
  const [tasks, setTasks] = useState<Map<string, Task>>(new Map());
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const fetchSessions = useCallback(async () => {
    if (!enabled) return;

    try {
      const response = await fetch("/api/sessions");
      if (!response.ok) {
        console.warn("Failed to fetch sessions:", response.statusText);
        return;
      }

      const data: SessionsResponse = await response.json();
      const prevTasks = tasksRef.current;

      // Convert sub-agent sessions to tasks
      const newTasks = new Map<string, Task>();

      for (const session of data.sessions) {
        // Only track sub-agents
        if (!session.isSubagent) continue;

        const existingTask = prevTasks.get(session.sessionId);

        // If task already exists and is completed, don't overwrite
        if (existingTask && existingTask.status !== "running") {
          newTasks.set(session.sessionId, existingTask);
          continue;
        }

        // Create or update task
        const rawLabel = session.label || '';
        const isHexId = /^[0-9a-f]{6,}(-[0-9a-f]+)*$/i.test(rawLabel.replace(/^agent:main:subagent:/, ''));
        const taskName = (rawLabel && !isHexId) ? rawLabel : `Task (${friendlySessionAgent(session.agent)})`;
        newTasks.set(session.sessionId, {
          id: session.sessionId,
          name: taskName,
          description: session.description,
          status: "running",
          requiresAcknowledgment: true, // Safe default — assume review needed
          startedAt: session.startedAt || new Date().toISOString(),
          model: session.agent,
          source: "Sub-agent",
          sessionId: session.sessionId,
        });
      }

      // Mark tasks as completed if they're no longer in the sessions list
      prevTasks.forEach((task, id) => {
        if (!newTasks.has(id) && task.status === "running") {
          newTasks.set(id, {
            ...task,
            status: "done",
          });
        }
      });

      setTasks(newTasks);
    } catch (error) {
      console.error("Session polling error:", error);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setIsPolling(false);
      return;
    }

    // Initial fetch
    fetchSessions();
    setIsPolling(true);

    // Poll every 2 seconds
    pollIntervalRef.current = setInterval(fetchSessions, 2000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [enabled, fetchSessions]);

  return {
    tasks: Array.from(tasks.values()),
    isPolling,
  };
}
