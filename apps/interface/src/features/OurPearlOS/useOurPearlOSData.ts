"use client";

import { useCallback, useEffect, useState } from "react";
import type { DecoratedCatalog, DecoratedFeature } from "@interface/lib/our-pearlos-catalog";
import {
  communityShortcutId,
  type PersonalDesktopShortcut,
  readDesktopShortcuts,
  removeDesktopShortcut,
  upsertDesktopShortcut,
} from "@interface/lib/personal-desktop-shortcuts";

interface OurPearlOSState {
  catalog: DecoratedCatalog | null;
  signedIn: boolean;
  loading: boolean;
  error: string | null;
  votingId: string | null;
  installingId: string | null;
  installedFeatureIds: Record<string, true>;
}

const EMPTY_STATE: OurPearlOSState = {
  catalog: null,
  signedIn: false,
  loading: true,
  error: null,
  votingId: null,
  installingId: null,
  installedFeatureIds: {},
};

const INSTALLED_FEATURES_STORAGE_KEY = "pearlos:our-pearlos-installed-features:v1";
const WORKSPACE_EXTRAS_FEATURE_ID = "workspace-extras-pack";

type InstallableDesktopShortcut = Omit<PersonalDesktopShortcut, "createdAt" | "updatedAt">;

function readInstalledFeatures(): Record<string, true> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(INSTALLED_FEATURES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] === true)
        .map((key) => [key, true as const])
    );
  } catch {
    return {};
  }
}

function writeInstalledFeatures(installed: Record<string, true>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INSTALLED_FEATURES_STORAGE_KEY, JSON.stringify(installed));
  } catch {
    /* local demo state only */
  }
}

function normalizeInstalledFeatures(raw: unknown): Record<string, true> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => record[key] === true)
      .map((key) => [key, true as const])
  );
}

function catalogFeatures(catalog: DecoratedCatalog): DecoratedFeature[] {
  return [...catalog.public, ...catalog.integrating, ...catalog.community];
}

function communityShortcuts(feature: DecoratedFeature): InstallableDesktopShortcut[] {
  if (feature.id === WORKSPACE_EXTRAS_FEATURE_ID) {
    return [
      {
        id: `${communityShortcutId(feature.id)}:council`,
        title: "Council",
        iconSrc: "/icons/council.svg",
        source: "our-pearlos",
        target: {
          kind: "native-app",
          app: "council",
          viewType: "council",
        },
      },
      {
        id: `${communityShortcutId(feature.id)}:web-browser`,
        title: "Web Browser",
        iconSrc: "/desktopicons/chrome.png",
        source: "our-pearlos",
        target: {
          kind: "native-app",
          app: "browser",
          viewType: "enhancedBrowser",
        },
      },
      {
        id: `${communityShortcutId(feature.id)}:pulse`,
        title: "Pulse",
        iconSrc: "/desktopicons/social.png",
        source: "our-pearlos",
        target: {
          kind: "native-app",
          app: "pulse",
          viewType: "pulse",
        },
      },
    ];
  }

  return [{
    id: communityShortcutId(feature.id),
    title: feature.title,
    emoji: "✨",
    source: "our-pearlos",
    target: feature.launchUrl
      ? {
          kind: "studio-creation",
          projectId: feature.id,
          playUrl: feature.launchUrl,
        }
      : {
          kind: "native-app",
          app: "our-pearlos",
          viewType: "ourPearlos",
        },
  }];
}

function upsertCommunityShortcut(feature: DecoratedFeature): void {
  communityShortcuts(feature).forEach(upsertDesktopShortcut);
}

function removeCommunityShortcuts(feature: DecoratedFeature): void {
  const shortcutIds = new Set(communityShortcuts(feature).map((shortcut) => shortcut.id));
  shortcutIds.add(communityShortcutId(feature.id)); // Legacy single-icon package installs.
  shortcutIds.forEach(removeDesktopShortcut);
}

function syncDesktopShortcuts(
  catalog: DecoratedCatalog,
  installedFeatureIds: Record<string, true>,
  removeMissing: boolean
): void {
  const features = catalogFeatures(catalog).filter((feature) => installedFeatureIds[feature.id] === true);
  features.forEach(upsertCommunityShortcut);

  if (!removeMissing) return;
  const installedShortcutIds = new Set(features.flatMap((feature) => (
    communityShortcuts(feature).map((shortcut) => shortcut.id)
  )));
  readDesktopShortcuts()
    .filter((shortcut) => shortcut.source === "our-pearlos" && shortcut.id.startsWith("our-pearlos:"))
    .forEach((shortcut) => {
      if (!installedShortcutIds.has(shortcut.id)) {
        removeDesktopShortcut(shortcut.id);
      }
    });
}

/** Re-sort community items by live vote count after an optimistic toggle. */
function withFeature(catalog: DecoratedCatalog, next: DecoratedFeature): DecoratedCatalog {
  const swap = (list: DecoratedFeature[]) => list.map((f) => (f.id === next.id ? next : f));
  const community = swap(catalog.community).sort(
    (a, b) => b.voteCount - a.voteCount || a.title.localeCompare(b.title),
  );
  return {
    public: swap(catalog.public),
    integrating: swap(catalog.integrating),
    community,
  };
}

export function useOurPearlOSData() {
  const [state, setState] = useState<OurPearlOSState>(EMPTY_STATE);

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch("/api/our-pearlos/features", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.catalog) {
        throw new Error(typeof json?.error === "string" ? json.error : `Request failed (${res.status})`);
      }
      const catalog = json.catalog as DecoratedCatalog;
      const signedIn = json.signedIn === true;
      const installedFeatureIds = signedIn
        ? normalizeInstalledFeatures(json.installedFeatureIds)
        : readInstalledFeatures();
      writeInstalledFeatures(installedFeatureIds);
      syncDesktopShortcuts(catalog, installedFeatureIds, signedIn);
      setState({
        catalog,
        signedIn,
        loading: false,
        error: null,
        votingId: null,
        installingId: null,
        installedFeatureIds,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Could not load features.",
      }));
    }
  }, []);

  const vote = useCallback(async (feature: DecoratedFeature) => {
    if (!feature.votable) return;
    const voted = !feature.hasVoted;
    const optimistic: DecoratedFeature = {
      ...feature,
      hasVoted: voted,
      voteCount: feature.voteCount + (voted ? 1 : -1),
    };
    setState((prev) => ({
      ...prev,
      votingId: feature.id,
      error: null,
      catalog: prev.catalog ? withFeature(prev.catalog, optimistic) : prev.catalog,
    }));

    try {
      const res = await fetch("/api/our-pearlos/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId: feature.id, voted }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.feature) {
        throw new Error(typeof json?.error === "string" ? json.error : `Vote failed (${res.status})`);
      }
      setState((prev) => ({
        ...prev,
        votingId: null,
        catalog: prev.catalog ? withFeature(prev.catalog, json.feature as DecoratedFeature) : prev.catalog,
      }));
    } catch (err) {
      // Revert the optimistic toggle and surface a sign-in-aware message.
      setState((prev) => ({
        ...prev,
        votingId: null,
        error: err instanceof Error ? err.message : "Could not save your vote.",
        catalog: prev.catalog ? withFeature(prev.catalog, feature) : prev.catalog,
      }));
    }
  }, []);

  const installFeature = useCallback(async (feature: DecoratedFeature) => {
    if (feature.status !== "community") return;
    if (state.installedFeatureIds[feature.id]) return;
    const shouldPersist = state.signedIn;
    setState((prev) => {
      if (prev.installedFeatureIds[feature.id]) return prev;
      const installedFeatureIds = { ...prev.installedFeatureIds, [feature.id]: true as const };
      writeInstalledFeatures(installedFeatureIds);
      upsertCommunityShortcut(feature);
      return { ...prev, error: null, installingId: shouldPersist ? feature.id : null, installedFeatureIds };
    });

    if (!shouldPersist) return;
    try {
      const res = await fetch("/api/our-pearlos/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId: feature.id, installed: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.installedFeatureIds) {
        throw new Error(typeof json?.error === "string" ? json.error : `Install failed (${res.status})`);
      }
      const installedFeatureIds = normalizeInstalledFeatures(json.installedFeatureIds);
      setState((prev) => {
        if (prev.catalog) {
          writeInstalledFeatures(installedFeatureIds);
          syncDesktopShortcuts(prev.catalog, installedFeatureIds, true);
        }
        return { ...prev, installingId: null, installedFeatureIds };
      });
    } catch (err) {
      setState((prev) => {
        const installedFeatureIds = { ...prev.installedFeatureIds };
        delete installedFeatureIds[feature.id];
        writeInstalledFeatures(installedFeatureIds);
        removeCommunityShortcuts(feature);
        return {
          ...prev,
          installingId: null,
          installedFeatureIds,
          error: err instanceof Error ? err.message : "Could not add this feature.",
        };
      });
    }
  }, [state.installedFeatureIds, state.signedIn]);

  const uninstallFeature = useCallback(async (feature: DecoratedFeature) => {
    if (!state.installedFeatureIds[feature.id]) return;
    const shouldPersist = state.signedIn;
    setState((prev) => {
      if (!prev.installedFeatureIds[feature.id]) return prev;
      const installedFeatureIds = { ...prev.installedFeatureIds };
      delete installedFeatureIds[feature.id];
      writeInstalledFeatures(installedFeatureIds);
      removeCommunityShortcuts(feature);
      return { ...prev, error: null, installingId: shouldPersist ? feature.id : null, installedFeatureIds };
    });

    if (!shouldPersist) return;
    try {
      const res = await fetch("/api/our-pearlos/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId: feature.id, installed: false }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.installedFeatureIds) {
        throw new Error(typeof json?.error === "string" ? json.error : `Remove failed (${res.status})`);
      }
      const installedFeatureIds = normalizeInstalledFeatures(json.installedFeatureIds);
      setState((prev) => {
        if (prev.catalog) {
          writeInstalledFeatures(installedFeatureIds);
          syncDesktopShortcuts(prev.catalog, installedFeatureIds, true);
        }
        return { ...prev, installingId: null, installedFeatureIds };
      });
    } catch (err) {
      setState((prev) => {
        const installedFeatureIds = { ...prev.installedFeatureIds, [feature.id]: true as const };
        writeInstalledFeatures(installedFeatureIds);
        upsertCommunityShortcut(feature);
        return {
          ...prev,
          installingId: null,
          installedFeatureIds,
          error: err instanceof Error ? err.message : "Could not remove this feature.",
        };
      });
    }
  }, [state.installedFeatureIds, state.signedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh, vote, installFeature, uninstallFeature };
}
