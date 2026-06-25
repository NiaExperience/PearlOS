'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';

import type { PersonalFeaturePackageRecord } from '@interface/lib/personal-feature-packages';
import {
  readDesktopShortcuts,
  removeDesktopShortcut,
  upsertDesktopShortcut,
} from '@interface/lib/personal-desktop-shortcuts';

const PERSONAL_FEATURE_SHORTCUT_PREFIX = 'personal-feature:';

function personalFeatureShortcutId(packageId: string): string {
  return `${PERSONAL_FEATURE_SHORTCUT_PREFIX}${packageId}`;
}

function syncPersonalFeatureShortcuts(packages: PersonalFeaturePackageRecord[]): void {
  const launchable = packages.filter((record) => record.desktopShortcut?.enabled !== false);
  for (const record of launchable) {
    upsertDesktopShortcut({
      id: personalFeatureShortcutId(record.id),
      title: record.title,
      iconSrc: record.desktopShortcut?.iconSrc,
      emoji: record.desktopShortcut?.emoji || '✨',
      source: 'studio',
      target: record.launchUrl
        ? {
            kind: 'studio-creation',
            projectId: record.id,
            playUrl: record.launchUrl,
          }
        : {
            kind: 'native-app',
            app: 'studio',
            viewType: 'studio',
          },
    });
  }

  const expected = new Set(launchable.map((record) => personalFeatureShortcutId(record.id)));
  readDesktopShortcuts()
    .filter((shortcut) => shortcut.id.startsWith(PERSONAL_FEATURE_SHORTCUT_PREFIX))
    .forEach((shortcut) => {
      if (!expected.has(shortcut.id)) removeDesktopShortcut(shortcut.id);
    });
}

export function PersonalFeaturePackageHydrator() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== 'authenticated') return;
    const controller = new AbortController();
    fetch('/api/personal-features', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        const packages = Array.isArray(data?.packages) ? data.packages : [];
        syncPersonalFeatureShortcuts(packages as PersonalFeaturePackageRecord[]);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [status]);

  return null;
}
