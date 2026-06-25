"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { VisualRoom, VisualTask } from "./types";

const TASK_STATUSES = ["pending", "in_progress", "completed", "failed", "cancelled"] as const;

function roomNameFromUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "Room";
  try {
    const parsed = new URL(trimmed);
    const slug = parsed.pathname.split("/").filter(Boolean).pop();
    return slug ? slug.replace(/[-_]/g, " ") : parsed.hostname;
  } catch {
    return trimmed.replace(/[-_]/g, " ").slice(0, 42);
  }
}

function collectRooms(): VisualRoom[] {
  if (typeof window === "undefined") return [];
  const rooms = new Map<string, VisualRoom>();
  const addRoom = (url: string | null, status: VisualRoom["status"]) => {
    if (!url) return;
    const trimmed = url.trim();
    if (!trimmed || rooms.has(trimmed)) return;
    rooms.set(trimmed, {
      id: trimmed,
      name: roomNameFromUrl(trimmed),
      detail: trimmed,
      status,
    });
  };

  addRoom(localStorage.getItem("dailyRoomUrl"), "active");
  addRoom(sessionStorage.getItem("dailySharedRoomUrl"), "recent");

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !/room|daily/i.test(key)) continue;
    const value = localStorage.getItem(key);
    if (value && /^https?:\/\//.test(value)) addRoom(value, "recent");
  }

  return Array.from(rooms.values());
}

export function useTaskVisualizationData() {
  const [tasks, setTasks] = useState<VisualTask[]>([]);
  const [rooms, setRooms] = useState<VisualRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const responses = await Promise.all(
        TASK_STATUSES.map(async (status) => {
          const response = await fetch(`/api/tasks?status=${status}&limit=40`, { cache: "no-store" });
          if (!response.ok) return [];
          const json = await response.json();
          return Array.isArray(json.tasks) ? (json.tasks as VisualTask[]) : [];
        })
      );
      const unique = new Map<string, VisualTask>();
      responses.flat().forEach((task) => {
        if (task?.id) unique.set(task.id, task);
      });
      setTasks(
        Array.from(unique.values()).sort((a, b) => {
          const left = Date.parse(a.updatedAt || a.createdAt || "");
          const right = Date.parse(b.updatedAt || b.createdAt || "");
          return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
        })
      );
      setRooms(collectRooms());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load tasks.");
      setRooms(collectRooms());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const summary = useMemo(() => {
    const active = tasks.filter((task) => task.status === "pending" || task.status === "in_progress").length;
    const completed = tasks.filter((task) => task.status === "completed").length;
    const failed = tasks.filter((task) => task.status === "failed").length;
    return { active, completed, failed };
  }, [tasks]);

  return { tasks, rooms, loading, error, summary, refresh };
}
