"use client";

import type { ViewType } from "@interface/features/ManeuverableWindow/types/maneuverable-window-types";

export const DESKTOP_SHORTCUTS_STORAGE_KEY = "pearlos:desktop-shortcuts:v1";
export const DESKTOP_SHORTCUTS_CHANGED_EVENT = "pearlos:desktop-shortcuts:changed";

export type DesktopShortcutTarget =
  | {
      kind: "studio-creation";
      projectId: string;
      playUrl: string;
    }
  | {
      kind: "native-app";
      app: string;
      viewType: ViewType;
    };

export interface PersonalDesktopShortcut {
  id: string;
  title: string;
  iconSrc?: string;
  emoji?: string;
  source: "studio" | "our-pearlos" | "core";
  target: DesktopShortcutTarget;
  createdAt: number;
  updatedAt: number;
}

const LEGACY_SHORTCUT_BLOCKLIST = [
  /horror\s*movie\s*html/i,
  /horrormoviehtml/i,
  /legacy\s*chat\s*mode/i,
  /chatmode/i,
];

function cleanText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().replace(/[<>]/g, "").slice(0, limit) : "";
}

function normalizeShortcut(raw: unknown, now = Date.now()): PersonalDesktopShortcut | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const id = cleanText(input.id, 120);
  const title = cleanText(input.title, 120);
  if (LEGACY_SHORTCUT_BLOCKLIST.some((pattern) => pattern.test(`${id} ${title}`))) return null;
  const target = input.target;
  if (!id || !title || !target || typeof target !== "object" || Array.isArray(target)) return null;
  const targetInput = target as Record<string, unknown>;
  let normalizedTarget: DesktopShortcutTarget | null = null;
  if (targetInput.kind === "studio-creation") {
    const projectId = cleanText(targetInput.projectId, 120);
    const playUrl = cleanText(targetInput.playUrl, 400);
    if (projectId && playUrl) normalizedTarget = { kind: "studio-creation", projectId, playUrl };
  } else if (targetInput.kind === "native-app") {
    const app = cleanText(targetInput.app, 80);
    const viewType = cleanText(targetInput.viewType, 80) as ViewType;
    if (app && viewType) normalizedTarget = { kind: "native-app", app, viewType };
  }
  if (!normalizedTarget) return null;
  const source =
    input.source === "our-pearlos" || input.source === "core" || input.source === "studio"
      ? input.source
      : "studio";
  return {
    id,
    title,
    iconSrc: cleanText(input.iconSrc, 240) || undefined,
    emoji: cleanText(input.emoji, 8) || undefined,
    source,
    target: normalizedTarget,
    createdAt: typeof input.createdAt === "number" ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === "number" ? input.updatedAt : now,
  };
}

export function readDesktopShortcuts(): PersonalDesktopShortcut[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DESKTOP_SHORTCUTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const list = Array.isArray(parsed?.shortcuts) ? parsed.shortcuts : Array.isArray(parsed) ? parsed : [];
    return list.map((entry: unknown) => normalizeShortcut(entry)).filter(Boolean) as PersonalDesktopShortcut[];
  } catch {
    return [];
  }
}

function writeDesktopShortcuts(shortcuts: PersonalDesktopShortcut[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DESKTOP_SHORTCUTS_STORAGE_KEY, JSON.stringify({ shortcuts }));
  window.dispatchEvent(new CustomEvent(DESKTOP_SHORTCUTS_CHANGED_EVENT, { detail: { shortcuts } }));
}

export function upsertDesktopShortcut(shortcut: Omit<PersonalDesktopShortcut, "createdAt" | "updatedAt">): PersonalDesktopShortcut[] {
  const now = Date.now();
  const current = readDesktopShortcuts();
  const prior = current.find((entry) => entry.id === shortcut.id);
  const nextShortcut: PersonalDesktopShortcut = {
    ...shortcut,
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
  };
  const next = [nextShortcut, ...current.filter((entry) => entry.id !== shortcut.id)].slice(0, 80);
  writeDesktopShortcuts(next);
  return next;
}

export function removeDesktopShortcut(id: string): PersonalDesktopShortcut[] {
  const next = readDesktopShortcuts().filter((entry) => entry.id !== id);
  writeDesktopShortcuts(next);
  return next;
}

export function studioShortcutId(projectId: string): string {
  return `studio:${projectId}`;
}

export function communityShortcutId(featureId: string): string {
  return `our-pearlos:${featureId}`;
}
