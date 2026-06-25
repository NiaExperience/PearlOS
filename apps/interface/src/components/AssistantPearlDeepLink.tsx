'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { isFeatureEnabled } from '@nia/features';
import { NIA_EVENT_DESKTOP_MODE_SWITCH, NIA_EVENT_NOTE_OPEN } from '@interface/features/DailyCall/events/niaEventRouter';
import { findNoteWithFuzzySearch } from '@interface/features/Notes/lib/notes-api';
import type { Note } from '@interface/features/Notes/types/notes-types';
import { requestWindowOpen } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';
import {
  isHomeDesktopMode,
  parseDesktopModeQuery,
  parseOpenAppQuery,
  PEARL_DEEPLINK_QUERY_KEYS,
} from '@interface/lib/assistant-deeplink';
import {
  getComingSoonAppKey,
  isKnownDesktopAppSlug,
  isComingSoonDesktopApp,
  requestDesktopAppOpen,
  shouldRouteViaDesktopOpen,
  toDesktopAppSlug,
} from '@interface/lib/desktop-app-open';
import { getClientLogger } from '@interface/lib/client-logger';
import { useUI } from '@interface/contexts/ui-context';

const log = getClientLogger('[assistant_pearl_deeplink]');
const NOTE_OPEN_DELAY_MS = 200;

/**
 * Handles PearlOS assistant URL deep links:
 *
 * - `?desktopMode=work` or `?openDesktop=work` — switch desktop mode (work → work/desktop surface)
 * - `?openApp=notes` or `?app=terminal` — open a built-in app window
 * - `?openApp=browser&browserUrl=https://…` — open browser at URL
 * - `?noteId=…` / `?noteTitle=…` / `?note=…` — open a specific note in Notes
 *
 * Uses `desktopMode` / `openDesktop` instead of bare `mode=` to avoid clashing with
 * applet session overrides (`?mode=` + `resourceId` on the assistant page).
 */
export function AssistantPearlDeepLink({
  assistantName,
  supportedFeatures,
}: {
  assistantName: string;
  supportedFeatures?: string[] | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setIsChatMode } = useUI();
  const handlingSigRef = useRef<string | null>(null);

  useEffect(() => {
    if (!searchParams || !pathname) return;

    const desktopRaw =
      searchParams.get('desktopMode')?.trim() ||
      searchParams.get('openDesktop')?.trim() ||
      '';
    const appRaw =
      searchParams.get('openApp')?.trim() ||
      searchParams.get('app')?.trim() ||
      '';
    const browserUrl = searchParams.get('browserUrl')?.trim() || '';
    const noteId =
      searchParams.get('noteId')?.trim() ||
      searchParams.get('note_id')?.trim() ||
      '';
    const noteTitle =
      searchParams.get('noteTitle')?.trim() ||
      searchParams.get('note')?.trim() ||
      '';

    const desktopMode = parseDesktopModeQuery(desktopRaw || null);
    const viewType = parseOpenAppQuery(appRaw || null);
    const desktopAppSlug = appRaw ? toDesktopAppSlug(appRaw) : null;
    const hasOpenApp =
      !!viewType || !!(desktopAppSlug && isKnownDesktopAppSlug(desktopAppSlug));
    const wantsNote = !!(noteId || noteTitle);
    const notesEnabled = isFeatureEnabled('notes', supportedFeatures ?? undefined);

    if (!desktopMode && !hasOpenApp && !(wantsNote && notesEnabled)) return;

    const sig = PEARL_DEEPLINK_QUERY_KEYS.map((key) => `${key}=${searchParams.get(key) ?? ''}`)
      .filter((entry) => !entry.endsWith('='))
      .join('&');
    if (!sig || handlingSigRef.current === sig) return;
    handlingSigRef.current = sig;

    const stripDeepLinkParams = () => {
      const next = new URLSearchParams(searchParams.toString());
      for (const key of PEARL_DEEPLINK_QUERY_KEYS) {
        next.delete(key);
      }
      const q = next.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    };

    const switchDesktopMode = () => {
      if (!desktopMode) return;
      const modeToken = desktopRaw.toLowerCase() === 'work' ? 'work' : desktopMode;
      window.dispatchEvent(
        new CustomEvent(NIA_EVENT_DESKTOP_MODE_SWITCH, {
          detail: { mode: modeToken, payload: { mode: modeToken }, timestamp: Date.now() },
        }),
      );
      setIsChatMode(!isHomeDesktopMode(desktopMode));
      log.info('Deep link switched desktop mode', { mode: modeToken });
    };

    const openAppWindow = () => {
      if (!appRaw) return;

      // Pearl Vision still uses the Work desktop placeholder flow.
      if (isComingSoonDesktopApp(appRaw)) {
        requestDesktopAppOpen({ app: toDesktopAppSlug(appRaw) });
        log.info('Deep link showed coming soon', { app: toDesktopAppSlug(appRaw), comingSoon: getComingSoonAppKey(appRaw) });
        return;
      }

      if (shouldRouteViaDesktopOpen(appRaw)) {
        requestDesktopAppOpen({
          app: toDesktopAppSlug(appRaw),
          url: browserUrl || undefined,
        });
        log.info('Deep link opened desktop app', { app: toDesktopAppSlug(appRaw), appRaw });
        return;
      }

      if (!viewType) return;
      const viewState =
        viewType === 'notes' && noteId
          ? { openNoteId: noteId }
          : viewType === 'enhancedBrowser' && browserUrl
            ? { enhancedBrowserUrl: browserUrl }
            : viewType === 'miniBrowser' && browserUrl
              ? { browserUrl }
              : undefined;
      requestWindowOpen({
        viewType,
        viewState,
        source: 'assistant-deeplink',
      });
      log.info('Deep link opened app', { viewType, appRaw });
    };

    const openNoteDeepLink = async () => {
      if (!wantsNote || !notesEnabled) return;
      try {
        const result = await findNoteWithFuzzySearch(
          { id: noteId || undefined, title: noteTitle || undefined },
          assistantName,
        );
        if (!result.found || !result.note?._id) {
          log.warn('Note deep link: not found', { noteId: noteId || undefined, noteTitle: noteTitle || undefined });
          return;
        }
        const note = result.note as Note;
        requestWindowOpen({
          viewType: 'notes',
          viewState: { openNoteId: note._id },
          options: { resourceId: note._id, resourceTitle: note.title },
          source: 'assistant-deeplink',
        });
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent(NIA_EVENT_NOTE_OPEN, {
              detail: { event: 'note.open', payload: { noteId: note._id, note } },
            }),
          );
        }, NOTE_OPEN_DELAY_MS);
        log.info('Deep link opened note', { noteId: note._id });
      } catch (e) {
        log.error('Note deep link failed', { error: e instanceof Error ? e.message : String(e) });
      }
    };

    log.info('Deep link handling', {
      desktopMode: desktopMode ?? undefined,
      viewType: viewType ?? undefined,
      wantsNote,
    });

    switchDesktopMode();
    // Wonder Canvas apps (weather, news, discord) need the work desktop listener mounted.
    if (appRaw && shouldRouteViaDesktopOpen(appRaw) && !desktopMode) {
      window.dispatchEvent(
        new CustomEvent(NIA_EVENT_DESKTOP_MODE_SWITCH, {
          detail: { mode: 'work', payload: { mode: 'work' }, timestamp: Date.now() },
        }),
      );
      setIsChatMode(true);
    }
    // Window apps queue until BrowserWindow mounts; desktop apps queue until work desktop mounts.
    openAppWindow();
    void openNoteDeepLink();
    window.setTimeout(() => stripDeepLinkParams(), 0);
  }, [assistantName, pathname, router, searchParams, setIsChatMode, supportedFeatures]);

  return null;
}
