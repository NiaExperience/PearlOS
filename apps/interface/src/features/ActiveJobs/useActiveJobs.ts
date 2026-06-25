"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { Task } from "./types";
import { useSessionPolling } from "./useSessionPolling";

/** Auto-dismiss delay for tasks that don't require acknowledgment (ms) */
const AUTO_DISMISS_DELAY = 3000;

export interface ActiveJobsState {
  tasks: Task[];
  expandedIds: Set<string>;
  addTask: (task: Task) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  dismissTask: (id: string) => void;
  toggleExpanded: (id: string) => void;
}

export function useActiveJobs(): ActiveJobsState {
  // Manual tasks (added via addTask)
  const [manualTasks, setManualTasks] = useState<Task[]>([]);
  
  // Auto-discovered tasks from session polling
  const { tasks: polledTasks } = useSessionPolling(true);
  
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const autoDismissTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  
  // Dismissed task IDs (to prevent re-showing completed sub-agents)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  
  // Merge manual and polled tasks, filter dismissed
  const tasks = [...manualTasks, ...polledTasks].filter(
    (task) => !dismissedIds.has(task.id)
  );

  const dismissTask = useCallback((id: string) => {
    // Remove from manual tasks
    setManualTasks((prev) => prev.filter((t) => t.id !== id));
    
    // Add to dismissed set (prevents re-showing polled tasks)
    setDismissedIds((prev) => new Set([...prev, id]));
    
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    // Clear any pending auto-dismiss timer
    const timer = autoDismissTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      autoDismissTimers.current.delete(id);
    }
  }, []);

  const scheduleAutoDismiss = useCallback(
    (task: Task) => {
      if (
        !task.requiresAcknowledgment &&
        (task.status === "done" || task.status === "failed")
      ) {
        // Don't double-schedule
        if (autoDismissTimers.current.has(task.id)) return;
        const timer = setTimeout(() => {
          dismissTask(task.id);
          autoDismissTimers.current.delete(task.id);
        }, AUTO_DISMISS_DELAY);
        autoDismissTimers.current.set(task.id, timer);
      }
    },
    [dismissTask],
  );

  const addTask = useCallback(
    (task: Task) => {
      setManualTasks((prev) => {
        // Prevent duplicates
        if (prev.some((t) => t.id === task.id)) return prev;
        return [...prev, task];
      });
      scheduleAutoDismiss(task);
    },
    [scheduleAutoDismiss],
  );

  const updateTask = useCallback(
    (id: string, patch: Partial<Task>) => {
      setManualTasks((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const updated = { ...t, ...patch };
          scheduleAutoDismiss(updated);
          return updated;
        }),
      );
    },
    [scheduleAutoDismiss],
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      autoDismissTimers.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  return { tasks, expandedIds, addTask, updateTask, dismissTask, toggleExpanded };
}
