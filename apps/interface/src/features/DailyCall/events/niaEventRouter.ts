/**
 * niaEventRouter.ts
 * Routes events from the backend and dispatches CustomEvents to React components.
 *
 * This is the critical bridge between the bot backend event emission and
 * React component event handling. It also bridges to the WindowManager system
 * by dispatching pearl:window:* events that WindowManagerContext listens for.
 */

import {
  WINDOW_OPEN_EVENT,
  WINDOW_CLOSE_EVENT,
  type WindowOpenRequest,
  type WindowCloseRequest,
  type ViewType,
} from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';
import { NIA_EVENT_INTERFACE_CUSTOMIZE } from '@interface/lib/interface-customization';
import { buildNewsHTML } from '@interface/lib/news-app-html';
import { dispatchPearlSettingsOpen } from '@interface/lib/webchat-onboarding';

export enum EventEnum {
  // Desktop/UI events
  DESKTOP_MODE_SWITCH = 'nia.event.desktopModeSwitch',
  VIEW_CLOSE = 'nia.event.viewClose',

  // Wonder Canvas events
  WONDER_SCENE = 'wonder.scene',
  WONDER_ADD = 'wonder.add',
  WONDER_REMOVE = 'wonder.remove',
  WONDER_CLEAR = 'wonder.clear',
  WONDER_ANIMATE = 'wonder.animate',

  // Window management (direct from bot tools)
  WINDOW_OPEN = 'nia.event.windowOpen',
  WINDOW_CLOSE = 'nia.event.windowClose',
  WINDOW_CLOSE_ALL = 'nia.event.windowCloseAll',
  SESSION_END = 'nia.event.sessionEnd',
  ONBOARDING_COMPLETE = 'nia.event.onboardingComplete',
}

// Event constants for CustomEvent dispatch
export const NIA_EVENT_DESKTOP_MODE_SWITCH = 'nia:desktop.mode.switch';
export const NIA_EVENT_LAYOUT_MODE_SWITCH = 'nia:layout.mode.switch';
export const NIA_EVENT_VIEW_CLOSE = 'nia:view.close';
export const NIA_EVENT_ONBOARDING_COMPLETE = 'nia:onboarding.complete';
export const NIA_EVENT_WONDER_SCENE = 'nia:wonder.scene';
export const NIA_EVENT_WONDER_ADD = 'nia:wonder.add';
export const NIA_EVENT_WONDER_REMOVE = 'nia:wonder.remove';
export const NIA_EVENT_WONDER_CLEAR = 'nia:wonder.clear';
export const NIA_EVENT_WONDER_ANIMATE = 'nia:wonder.animate';

// Restored event constants (removed in refactor but still imported by many components)
export const NIA_EVENT_ALL = 'nia:all';
export const NIA_EVENT_APP_OPEN = 'nia:app.open';
export const NIA_EVENT_APPS_CLOSE = 'nia:apps.close';
export const NIA_EVENT_APPLET_OPEN = 'nia:applet.open';
export const NIA_EVENT_APPLET_REFRESH = 'nia:applet.refresh';
export const NIA_EVENT_APPLET_SHARE_OPEN = 'nia:applet.share.open';
export const NIA_EVENT_APPLET_UPDATED = 'nia:applet.updated';
export const NIA_EVENT_BOT_SPEAKING_STARTED = 'nia:bot.speaking.started';
export const NIA_EVENT_BOT_SPEAKING_STOPPED = 'nia:bot.speaking.stopped';
export const NIA_EVENT_BROWSER_OPEN = 'nia:browser.open';
export const NIA_EVENT_BROWSER_CLOSE = 'nia:browser.close';
export const NIA_EVENT_CALL_START = 'nia:call.start';
export const NIA_EVENT_CANVAS_CLEAR = 'nia:canvas.clear';
export const NIA_EVENT_CANVAS_RENDER = 'nia:canvas.render';
export const NIA_EVENT_CONVERSATION_WRAPUP = 'nia:conversation.wrapup';
export const NIA_EVENT_HTML_CREATED = 'nia:html.created';
export const NIA_EVENT_HTML_GENERATION_REQUESTED = 'nia:html.generation.requested';
export const NIA_EVENT_HTML_MODIFICATION_REQUESTED = 'nia:html.modification.requested';
export const NIA_EVENT_HTML_ROLLBACK_REQUESTED = 'nia:html.rollback.requested';
export const NIA_EVENT_HTML_UPDATED = 'nia:html.updated';
export const NIA_EVENT_NOTE_CLOSE = 'nia:note.close';
export const NIA_EVENT_NOTE_DELETED = 'nia:note.deleted';
export const NIA_EVENT_NOTE_DOWNLOAD = 'nia:note.download';
export const NIA_EVENT_NOTE_HIGHLIGHT = 'nia:note.highlight';
export const NIA_EVENT_NOTE_HIGHLIGHT_CLEAR = 'nia:note.highlight.clear';
export const NIA_EVENT_NOTE_MODE_SWITCH = 'nia:note.mode.switch';
export const NIA_EVENT_NOTE_NAVIGATE_HEADING = 'nia:note.navigate.heading';
export const NIA_EVENT_NOTE_OPEN = 'nia:note.open';
export const NIA_EVENT_NOTE_SAVED = 'nia:note.saved';
export const NIA_EVENT_NOTE_SCROLL = 'nia:note.scroll';
export const NIA_EVENT_NOTE_UPDATED = 'nia:note.updated';
export const NIA_EVENT_NOTES_LIST = 'nia:notes.list';
export const NIA_EVENT_NOTES_REFRESH = 'nia:notes.refresh';
export const NIA_EVENT_SESSION_END = 'nia:session.end';
export const NIA_EVENT_SPRITE_OPEN = 'nia:sprite.open';
export const NIA_EVENT_WINDOW_MAXIMIZE = 'nia:window.maximize';
export const NIA_EVENT_WINDOW_MINIMIZE = 'nia:window.minimize';
export const NIA_EVENT_WINDOW_RESET = 'nia:window.reset';
export const NIA_EVENT_WINDOW_RESTORE = 'nia:window.restore';
export const NIA_EVENT_WINDOW_SNAP_LEFT = 'nia:window.snap.left';
export const NIA_EVENT_WINDOW_SNAP_RIGHT = 'nia:window.snap.right';
export const NIA_EVENT_YOUTUBE_NEXT = 'nia:youtube.next';
export const NIA_EVENT_YOUTUBE_PAUSE = 'nia:youtube.pause';
export const NIA_EVENT_YOUTUBE_PLAY = 'nia:youtube.play';
export const NIA_EVENT_YOUTUBE_SEARCH = 'nia:youtube.search';

interface EventPayload {
  mode?: string;
  timestamp?: number;
  viewType?: string;
  viewId?: string;
  windowId?: string;
  html?: string;
  html_url?: string;
  url?: string;
  title?: string;
  all?: boolean;
  [key: string]: any;
}

export type NiaEventDetail = EventPayload;

interface EventLogger {
  debug: (msg: string, data?: any) => void;
  info: (msg: string, data?: any) => void;
  warn: (msg: string, data?: any) => void;
  error: (msg: string, data?: any) => void;
}

const logger: EventLogger = {
  debug: (msg, data) => console.debug(`[niaEventRouter] ${msg}`, data),
  info: (msg, data) => console.info(`[niaEventRouter] ${msg}`, data),
  warn: (msg, data) => console.warn(`[niaEventRouter] ${msg}`, data),
  error: (msg, data) => console.error(`[niaEventRouter] ${msg}`, data),
};

/**
 * Routes an event from the backend to appropriate handlers and CustomEvent listeners.
 */
// Map backend event names (from bot tools/events.py) to frontend EventEnum values.
// The gateway sends short names like "app.open"; the router expects "nia.event.windowOpen".
const BACKEND_EVENT_ALIASES: Record<string, string> = {
  'desktop.mode.switch': EventEnum.DESKTOP_MODE_SWITCH,
  'app.open': EventEnum.WINDOW_OPEN,
  'apps.close': EventEnum.VIEW_CLOSE,
  'app.close': EventEnum.VIEW_CLOSE,
  'browser.close': EventEnum.VIEW_CLOSE,
  // note.open is handled specially in routeNiaEvent — NOT via WINDOW_OPEN
  'note.close': EventEnum.VIEW_CLOSE,
  'window.open': EventEnum.WINDOW_OPEN,
  'window.close': EventEnum.WINDOW_CLOSE,
  'window.close.all': EventEnum.WINDOW_CLOSE_ALL,
  'bot.session.end': EventEnum.SESSION_END,
  'onboarding.complete': EventEnum.ONBOARDING_COMPLETE,
};

export function routeNiaEvent(eventTypeOrEnvelope: string | { event: string; payload?: EventPayload }, payload: EventPayload = {}): void {
  // Accept either (eventType, payload) or (envelope) — the gateway WebSocket
  // bridge and the unit tests both pass an envelope as the single argument.
  // Without this normalization those callers silently no-op, which is what
  // hid the duplicate-bridge issue behind the mobile ghost-windows symptom.
  let eventType: string;
  if (typeof eventTypeOrEnvelope === 'string') {
    eventType = eventTypeOrEnvelope;
  } else if (eventTypeOrEnvelope && typeof eventTypeOrEnvelope === 'object' && typeof eventTypeOrEnvelope.event === 'string') {
    eventType = eventTypeOrEnvelope.event;
    payload = eventTypeOrEnvelope.payload ?? {};
  } else {
    logger.warn('routeNiaEvent called with invalid argument', eventTypeOrEnvelope);
    return;
  }

  // Normalize backend event names to frontend enum values
  const normalized = BACKEND_EVENT_ALIASES[eventType] || eventType;
  logger.debug(`Event received: ${eventType}${normalized !== eventType ? ` → ${normalized}` : ''}`, payload);

  // Dedup: same event arriving from both Daily data channel and gateway WebSocket
  if (isDuplicate(normalized, payload)) return;
  dispatchCustomEvent(NIA_EVENT_ALL, {
    event: eventType,
    normalizedEvent: normalized,
    payload,
    timestamp: Date.now(),
  });

  switch (normalized) {
    case EventEnum.DESKTOP_MODE_SWITCH:
      handleDesktopModeSwitch(payload);
      break;

    case EventEnum.VIEW_CLOSE:
    case EventEnum.WINDOW_CLOSE:
      handleViewClose(payload);
      break;

    case EventEnum.WINDOW_CLOSE_ALL:
      handleCloseAll();
      break;

    case EventEnum.SESSION_END:
      handleSessionEnd(payload);
      break;

    case EventEnum.ONBOARDING_COMPLETE:
      handleOnboardingComplete(payload);
      break;

    case EventEnum.WINDOW_OPEN:
      handleWindowOpen(payload);
      break;

    case 'youtube.search':
      handleYouTubeSearch(payload);
      break;

    case 'interface.customize':
      dispatchCustomEvent(NIA_EVENT_INTERFACE_CUSTOMIZE, { payload });
      break;

    case 'bot.speaking.started':
      dispatchNiaEventDetail(NIA_EVENT_BOT_SPEAKING_STARTED, eventType, payload);
      break;

    case 'bot.speaking.stopped':
      dispatchNiaEventDetail(NIA_EVENT_BOT_SPEAKING_STOPPED, eventType, payload);
      break;

    case 'notes.refresh':
      dispatchNiaEventDetail(NIA_EVENT_NOTES_REFRESH, eventType, payload);
      break;

    case 'applet.refresh':
      dispatchNiaEventDetail(NIA_EVENT_APPLET_REFRESH, eventType, payload);
      break;

    case 'window.minimize':
      dispatchNiaEventDetail(NIA_EVENT_WINDOW_MINIMIZE, eventType, payload);
      break;

    case 'window.maximize':
      dispatchNiaEventDetail(NIA_EVENT_WINDOW_MAXIMIZE, eventType, payload);
      break;

    case 'window.restore':
      dispatchNiaEventDetail(NIA_EVENT_WINDOW_RESTORE, eventType, payload);
      break;

    case 'window.snap.left':
      dispatchNiaEventDetail(NIA_EVENT_WINDOW_SNAP_LEFT, eventType, payload);
      break;

    case 'window.snap.right':
      dispatchNiaEventDetail(NIA_EVENT_WINDOW_SNAP_RIGHT, eventType, payload);
      break;

    case 'window.reset':
      dispatchNiaEventDetail(NIA_EVENT_WINDOW_RESET, eventType, payload);
      break;

    // Wonder Canvas events → open as custom window + dispatch specific event
    case EventEnum.WONDER_SCENE:
      handleWonderScene(payload);
      break;

    case EventEnum.WONDER_CLEAR:
      handleWonderClear(payload);
      break;

    case EventEnum.WONDER_ADD:
    case EventEnum.WONDER_REMOVE:
    case EventEnum.WONDER_ANIMATE:
      // Wrap in { payload } — WonderCanvasRenderer destructures detail.payload
      dispatchCustomEvent(`nia:${eventType}`, { payload });
      break;

    default:
      // note.open → dispatch NIA_EVENT_NOTE_OPEN so Notes component handles it
      if (eventType === 'note.open') {
        handleNoteOpen(payload);
      } else if (eventType.startsWith('wonder.')) {
        dispatchCustomEvent(`nia:${eventType}`, { payload });
      } else {
        logger.warn(`Unknown event type: ${eventType}`, payload);
      }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function dispatchCustomEvent(name: string, detail: any): void {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, cancelable: true }));
    logger.info(`Dispatched ${name}`);
  } catch (error) {
    logger.error(`Failed to dispatch ${name}`, error);
  }
}

function dispatchNiaEventDetail(name: string, event: string, payload: EventPayload): void {
  dispatchCustomEvent(name, {
    event,
    payload,
    timestamp: Date.now(),
  });
}

// ── Handlers ────────────────────────────────────────────────────────

function handleDesktopModeSwitch(payload: EventPayload): void {
  const { mode = 'desktop' } = payload;
  dispatchCustomEvent(NIA_EVENT_DESKTOP_MODE_SWITCH, {
    mode,
    payload: { ...payload, mode },
    timestamp: Date.now(),
  });
}

function handleOnboardingComplete(payload: EventPayload): void {
  dispatchCustomEvent(NIA_EVENT_ONBOARDING_COMPLETE, {
    ...payload,
    timestamp: Date.now(),
  });
}

/**
 * Handle VIEW_CLOSE / WINDOW_CLOSE event.
 * Dispatches BOTH the legacy nia:view.close AND the pearl:window:close event
 * that WindowManagerContext actually listens for.
 *
 * Backend `apps.close` events carry `{ apps: ["terminal", ...] }`. Earlier
 * versions of this handler only inspected viewType/windowId/viewId/all and
 * silently dropped that array, so "close terminal" closed nothing while the
 * safe-fallback branch closed unrelated custom windows. We now expand the
 * apps array, map each name through APP_NAME_TO_VIEW_TYPE, and dispatch one
 * close per app.
 */
function handleViewClose(payload: EventPayload): void {
  const { viewId, viewType, windowId, all } = payload;
  const apps = Array.isArray(payload.apps)
    ? (payload.apps as string[])
    : typeof payload.app === 'string'
      ? [payload.app]
      : null;

  // Dispatch legacy event for backward compatibility
  dispatchCustomEvent(NIA_EVENT_VIEW_CLOSE, { viewId, apps, timestamp: Date.now() });

  // ── Per-app fan-out for `apps.close` events ──────────────────────────
  if (apps && apps.length > 0) {
    if (apps.some(app => typeof app === 'string' && app.toLowerCase() === 'all')) {
      handleCloseAll();
      return;
    }

    for (const app of apps) {
      if (typeof app !== 'string') continue;
      const resolved = APP_NAME_TO_VIEW_TYPE[app.toLowerCase()] ?? (app as ViewType);
      try {
        window.dispatchEvent(
          new CustomEvent<WindowCloseRequest>(WINDOW_CLOSE_EVENT, {
            detail: { viewType: resolved },
          }),
        );
        logger.info(`Dispatched pearl:window:close for app "${app}" → viewType="${resolved}"`);
      } catch (error) {
        logger.error(`Failed to dispatch pearl:window:close for app "${app}"`, error);
      }
    }
    return;
  }

  // *** CRITICAL: Also dispatch pearl:window:close for WindowManagerContext ***
  const closeReq: WindowCloseRequest = {};
  if (all) {
    closeReq.all = true;
  } else if (viewType) {
    closeReq.viewType = viewType as ViewType;
  } else if (windowId) {
    closeReq.windowId = windowId;
  } else if (viewId) {
    // Try viewId as viewType (common case: "close youtube", "close custom")
    closeReq.viewType = viewId as ViewType;
  } else {
    handleCloseAll();
    return;
  }

  try {
    window.dispatchEvent(
      new CustomEvent<WindowCloseRequest>(WINDOW_CLOSE_EVENT, { detail: closeReq }),
    );
    logger.info('Dispatched pearl:window:close', closeReq);
  } catch (error) {
    logger.error('Failed to dispatch pearl:window:close', error);
  }
}

function handleCloseAll(): void {
  dispatchCustomEvent(NIA_EVENT_VIEW_CLOSE, { all: true, timestamp: Date.now() });

  try {
    window.dispatchEvent(
      new CustomEvent<WindowCloseRequest>(WINDOW_CLOSE_EVENT, {
        detail: {
          all: true,
          reason: 'close-all',
          source: 'niaEventRouter:closeAll',
        },
      }),
    );
  } catch (error) {
    logger.error('Failed to dispatch pearl:window:close for all windows', error);
  }
  logger.info('Dispatched pearl:window:close for all windows');
}

function handleSessionEnd(payload: EventPayload): void {
  dispatchCustomEvent(NIA_EVENT_SESSION_END, {
    payload: {
      ...payload,
      initiator: payload.initiator || 'assistant',
      reason: payload.reason || 'bot.session.end',
    },
    timestamp: Date.now(),
  });
}

/**
 * Translate a bot `app` name (e.g. "notes", "youtube", "browser") into the
 * correct WindowManager ViewType.  This mirrors the switch-case mapping in
 * browser-window.tsx `handleAppLaunch` so voice-triggered `app.open` events
 * produce the correct window instead of a blank "custom" placeholder.
 */
const APP_NAME_TO_VIEW_TYPE: Record<string, ViewType> = {
  notes: 'notes' as ViewType,
  notepad: 'notes' as ViewType,
  text: 'notes' as ViewType,
  youtube: 'youtube' as ViewType,
  terminal: 'terminal' as ViewType,
  cmd: 'terminal' as ViewType,
  command: 'terminal' as ViewType,
  files: 'files' as ViewType,
  filespace: 'files' as ViewType,
  docs: 'files' as ViewType,
  'file-manager': 'files' as ViewType,
  explorer: 'files' as ViewType,
  gmail: 'gmail' as ViewType,
  email: 'gmail' as ViewType,
  googledrive: 'googleDrive' as ViewType,
  'google-drive': 'googleDrive' as ViewType,
  drive: 'googleDrive' as ViewType,
  browser: 'enhancedBrowser' as ViewType,
  chrome: 'enhancedBrowser' as ViewType,
  web: 'enhancedBrowser' as ViewType,
  minibrowser: 'miniBrowser' as ViewType,
  studio: 'creationLaunchpad' as ViewType,
  'the-studio': 'creationLaunchpad' as ViewType,
  thestudio: 'creationLaunchpad' as ViewType,
  'creation-launchpad': 'creationLaunchpad' as ViewType,
  creationlaunchpad: 'creationLaunchpad' as ViewType,
  launchpad: 'creationLaunchpad' as ViewType,
  'creation-engine': 'creationLaunchpad' as ViewType,
  creationengine: 'creationLaunchpad' as ViewType,
  creation: 'creationLaunchpad' as ViewType,
  canvas: 'canvas' as ViewType,
  universalcanvas: 'canvas' as ViewType,
  wonder: 'custom' as ViewType,
  wonder_canvas: 'custom' as ViewType,
  'wonder-canvas': 'custom' as ViewType,
  dailycall: 'dailyCall' as ViewType,
  'daily-call': 'dailyCall' as ViewType,
  daily: 'dailyCall' as ViewType,
  call: 'dailyCall' as ViewType,
  social: 'dailyCall' as ViewType,
  meeting: 'dailyCall' as ViewType,
  news: 'news' as ViewType,
  pulse: 'pulse' as ViewType,
  'global-pulse': 'pulse' as ViewType,
  'social-pulse': 'pulse' as ViewType,
  weather: 'weather' as ViewType,
  settings: 'settings' as ViewType,
  styles: 'styles' as ViewType,
  style: 'styles' as ViewType,
  appearance: 'styles' as ViewType,
  discord: 'discord' as ViewType,
  council: 'council' as ViewType,
  'the-council': 'council' as ViewType,
  summon: 'council' as ViewType,
  'summon-agent': 'council' as ViewType,
  summonagent: 'council' as ViewType,
  agency: 'agency' as ViewType,
  'the-agency': 'agency' as ViewType,
  theagency: 'agency' as ViewType,
  tasks: 'agency' as ViewType,
  tasklist: 'agency' as ViewType,
  'task-list': 'agency' as ViewType,
  rooms: 'agency' as ViewType,
  'our-pearlos': 'ourPearlos' as ViewType,
  ourpearlos: 'ourPearlos' as ViewType,
  'our-pearl': 'ourPearlos' as ViewType,
  ourpearl: 'ourPearlos' as ViewType,
  'public-features': 'ourPearlos' as ViewType,
  'feature-catalog': 'ourPearlos' as ViewType,
  'community-features': 'ourPearlos' as ViewType,
};

function resolveViewType(payload: EventPayload): ViewType {
  // 1. Explicit viewType from payload takes priority
  if (payload.viewType) return payload.viewType as ViewType;
  // 2. Translate payload.app name to viewType
  if (payload.app && typeof payload.app === 'string') {
    const resolved = APP_NAME_TO_VIEW_TYPE[payload.app.toLowerCase()];
    if (resolved) return resolved;
  }
  // 3. Fallback to custom
  return 'custom' as ViewType;
}

function handleWindowOpen(payload: EventPayload): void {
  const appName = typeof payload.app === 'string' ? payload.app.toLowerCase() : '';
  const requestedViewType = typeof payload.viewType === 'string' ? payload.viewType.toLowerCase() : '';
  const viewType = resolveViewType(payload);
  const fileSearchQuery = typeof payload.fileSearchQuery === 'string'
    ? payload.fileSearchQuery
    : typeof payload.query === 'string'
      ? payload.query
      : undefined;

  if (appName === 'news' || requestedViewType === 'news') {
    const category = typeof payload.category === 'string' ? payload.category : undefined;
    dispatchCustomEvent(NIA_EVENT_WONDER_SCENE, {
      payload: {
        html: buildNewsHTML(category),
        layer: 'main',
        transition: 'fade',
        hideChrome: true,
        sceneId: 'news',
      },
    });
    window.dispatchEvent(new CustomEvent('nia:request.news', { detail: {} }));
    logger.info('Opened News app via Wonder Canvas');
    return;
  }

  if (appName === 'settings' || requestedViewType === 'settings') {
    dispatchPearlSettingsOpen('connections');
    logger.info('Opened Settings via PearlOS settings modal');
    return;
  }

  const req: WindowOpenRequest = {
    viewType,
    viewState: viewType === 'files' && fileSearchQuery
      ? { fileSearchQuery, fileSearchNonce: Date.now() }
      : payload.viewState,
    source: 'niaEventRouter',
    title: payload.title,
    url: payload.url,
    html: payload.html,
    meta: payload.meta,
  };

  try {
    window.dispatchEvent(
      new CustomEvent<WindowOpenRequest>(WINDOW_OPEN_EVENT, { detail: req }),
    );
    logger.info('Dispatched pearl:window:open', req);
  } catch (error) {
    logger.error('Failed to dispatch pearl:window:open', error);
  }
}

function handleYouTubeSearch(payload: EventPayload): void {
  const query = typeof payload.query === 'string' ? payload.query.trim() : '';
  const req: WindowOpenRequest = {
    viewType: 'youtube' as ViewType,
    source: 'niaEventRouter:youtube.search',
    title: query ? `YouTube: ${query}` : 'YouTube',
    meta: {
      ...(payload.meta && typeof payload.meta === 'object' ? payload.meta : {}),
      youtubeQuery: query,
    },
  };

  try {
    window.dispatchEvent(
      new CustomEvent<WindowOpenRequest>(WINDOW_OPEN_EVENT, { detail: req }),
    );
    logger.info('Dispatched pearl:window:open for YouTube search', req);
  } catch (error) {
    logger.error('Failed to dispatch pearl:window:open for YouTube search', error);
  }

  dispatchCustomEvent(NIA_EVENT_YOUTUBE_SEARCH, { payload: { ...payload, query } });
}

/**
 * Handle note.open events from voice/bot.
 * Dispatches NIA_EVENT_NOTE_OPEN so the Notes component (notes-view-next.tsx)
 * can navigate to the note directly, instead of creating a blank custom window.
 * Also opens a notes-type window so the Notes UI is visible.
 */
function handleNoteOpen(payload: EventPayload): void {
  // Open/ensure the Notes window is visible
  const req: WindowOpenRequest = {
    viewType: 'notes' as ViewType,
    source: 'niaEventRouter:note.open',
    title: payload.title || 'Notes',
  };

  try {
    window.dispatchEvent(
      new CustomEvent<WindowOpenRequest>(WINDOW_OPEN_EVENT, { detail: req }),
    );
    logger.info('Dispatched pearl:window:open for notes', req);
  } catch (error) {
    logger.error('Failed to dispatch pearl:window:open for notes', error);
  }

  // Dispatch the note-specific event so NotesView navigates to the note.
  // The Notes listener expects detail shape: { payload: { noteId, note, ... } }
  try {
    window.dispatchEvent(
      new CustomEvent(NIA_EVENT_NOTE_OPEN, {
        detail: { payload },
        bubbles: true,
        cancelable: true,
      }),
    );
    logger.info(`Dispatched ${NIA_EVENT_NOTE_OPEN}`, payload);
  } catch (error) {
    logger.error(`Failed to dispatch ${NIA_EVENT_NOTE_OPEN}`, error);
  }
}

/**
 * Wonder Canvas scene: render through exactly one canvas surface.
 *
 * In webchat, the split WindowManager owns the visible canvas pane so chat and
 * canvas sit side-by-side. Outside that context, fall back to the Stage-backed
 * WonderCanvasRenderer.
 */
function escapeWonderHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildWonderSceneLoadFailureHtml(htmlUrl: string, errorMessage: string): string {
  return `
    <div data-wonder-app-managed style="display:flex;min-height:100%;align-items:center;justify-content:center;padding:32px;background:#100b18;color:#f5efe7;font-family:Inter,system-ui,sans-serif;">
      <div style="max-width:520px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);border-radius:14px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.35);">
        <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#ffd46b;margin-bottom:10px;">Wonder Canvas</div>
        <h2 style="margin:0 0 10px;font-size:26px;line-height:1.15;">Canvas unavailable</h2>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:rgba(245,239,231,.78);">The visual scene could not be loaded. Ask Pearl to show it again and she will regenerate it.</p>
        <div style="font-size:12px;line-height:1.5;color:rgba(245,239,231,.52);word-break:break-all;">${escapeWonderHtml(htmlUrl)}<br>${escapeWonderHtml(errorMessage)}</div>
      </div>
    </div>
  `;
}

function handleWonderScene(payload: EventPayload): void {
  if (!payload.html && typeof payload.html_url === 'string' && payload.html_url.trim()) {
    const htmlUrl = payload.html_url;
    fetch(htmlUrl, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch Wonder Canvas HTML (${response.status})`);
        }
        return response.text();
      })
      .then((html) => {
        handleWonderScene({ ...payload, html, html_url: undefined });
      })
      .catch((error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Wonder scene rejected — failed to load html_url', {
          html_url: htmlUrl,
          error: errorMessage,
        });
        handleWonderScene({
          ...payload,
          html: buildWonderSceneLoadFailureHtml(htmlUrl, errorMessage),
          html_url: undefined,
          sceneId: payload.sceneId || 'canvas-load-error',
          title: payload.title || 'Canvas unavailable',
        });
      });
    return;
  }

  // Guard 1: reject scenes with no content at all
  if (!payload.html && !payload.url) {
    logger.warn('Wonder scene rejected — no html or url provided');
    return;
  }

  // Guard 2: reject empty/trivial HTML that would render a blank canvas.
  // This prevents the pathological cascade where empty scene → close-all → Daily teardown.
  if (payload.html && !payload.url) {
    const stripped = payload.html.replace(/<[^>]*>/g, '').trim();
    if (!stripped && payload.html.length < 200) {
      logger.warn('Wonder scene rejected — HTML is effectively empty', { htmlLen: payload.html.length });
      return;
    }
  }

  const nativeWindowManagerReady =
    typeof window !== 'undefined' &&
    (window as typeof window & { __pearlNativeWindowManagerReady?: boolean }).__pearlNativeWindowManagerReady === true;

  dispatchCustomEvent(NIA_EVENT_WONDER_SCENE, {
    payload: nativeWindowManagerReady
      ? { ...payload, _renderTarget: 'managed-window' }
      : payload,
  });

  if (!nativeWindowManagerReady) {
    logger.info('Wonder scene dispatched to Stage canvas');
    return;
  }

  const req: WindowOpenRequest = {
    viewType: 'wonderCanvas' as ViewType,
    source: 'chat:wonder-canvas',
    title: payload.title || 'Wonder Canvas',
    html: payload.html,
    url: payload.url,
    slot: 'right',
    widthFraction: 0.62,
    heightFraction: 1.0,
    meta: {
      ...(payload.meta && typeof payload.meta === 'object' ? payload.meta : {}),
      wonder: true,
      wonderLayout: 'split',
      sceneId: payload.sceneId,
      layer: payload.layer,
      transition: payload.transition,
      hideChrome: payload.hideChrome,
    },
  };

  try {
    window.dispatchEvent(
      new CustomEvent<WindowOpenRequest>(WINDOW_OPEN_EVENT, { detail: req }),
    );
    logger.info('Wonder scene opened in split canvas pane');
  } catch (error) {
    logger.error('Failed to open wonder scene window', error);
  }
}

/**
 * Wonder Canvas clear: close the wonder canvas window
 */
function handleWonderClear(payload: EventPayload): void {
  dispatchCustomEvent(NIA_EVENT_WONDER_CLEAR, { payload });

  try {
    window.dispatchEvent(
      new CustomEvent<WindowCloseRequest>(WINDOW_CLOSE_EVENT, {
        detail: {
          viewType: 'wonderCanvas' as ViewType,
          source: 'chat:wonder-canvas-clear',
          reason: 'wonder-clear',
        },
      }),
    );
    logger.info('Wonder canvas cleared and pane closed');
  } catch (error) {
    logger.error('Failed to close wonder canvas pane', error);
  }
}

// ── Exported close helper for direct use ────────────────────────────
/**
 * Programmatically close windows. Can be called from anywhere.
 * This is the function that bot tools should ultimately trigger.
 */
/**
 * Programmatically close windows. Can be called from anywhere.
 * Default closes custom windows only (safe). Pass explicit {all: true} only if you
 * understand the Daily session teardown risk.
 */
export function closeWindows(req: WindowCloseRequest = { viewType: 'custom' as ViewType }): void {
  if (req.all) {
    // Route through safe close-all handler instead of raw {all: true}
    handleCloseAll();
  } else {
    handleViewClose({ ...req, viewType: req.viewType || undefined });
  }
}

// ── Event deduplication ─────────────────────────────────────────────
// Events may arrive from BOTH Daily real-time data channel AND gateway WebSocket.
// Dedup by hashing event type + payload to prevent double rendering.
const _recentEvents = new Map<string, number>(); // hash → timestamp
const DEDUP_WINDOW_MS = 2000; // ignore duplicate within 2s
const DEDUP_MAX_SIZE = 30; // hard cap to prevent memory leaks in long sessions

function eventHash(eventType: string, payload: any): string {
  // Use event type + a stable subset of payload for dedup
  const key = eventType + '|'
    + (payload?.html?.length ?? '') + '|'
    + (payload?.url ?? '') + '|'
    + (payload?.title ?? '') + '|'
    + (payload?.action ?? '') + '|'
    + (payload?.theme ?? '') + '|'
    + (payload?.mode ?? '') + '|'
    + (payload?.targetMode ?? '') + '|'
    + (payload?.description ?? '') + '|'
    + (payload?.backgroundDescription ?? '') + '|'
    + (payload?.iconDescription ?? '') + '|'
    + (payload?.app ?? '');
  return key;
}

function isDuplicate(eventType: string, payload: any): boolean {
  const hash = eventHash(eventType, payload);
  const now = Date.now();
  const prev = _recentEvents.get(hash);
  if (prev && now - prev < DEDUP_WINDOW_MS) {
    logger.info(`Dedup: suppressing duplicate ${eventType} (${now - prev}ms since last)`);
    return true;
  }
  _recentEvents.set(hash, now);
  // Clean old entries aggressively to prevent memory leaks in long voice sessions
  if (_recentEvents.size > DEDUP_MAX_SIZE) {
    for (const [k, t] of _recentEvents) {
      if (now - t > DEDUP_WINDOW_MS) _recentEvents.delete(k);
    }
    // If still over limit after time-based cleanup, evict oldest
    if (_recentEvents.size > DEDUP_MAX_SIZE) {
      const entries = [..._recentEvents.entries()].sort((a, b) => a[1] - b[1]);
      const toRemove = entries.slice(0, entries.length - DEDUP_MAX_SIZE);
      for (const [k] of toRemove) _recentEvents.delete(k);
    }
  }
  return false;
}

let _initialized = false;
let _appMessageListener: EventListener | null = null;
let _toolResultListener: EventListener | null = null;

/**
 * Initialize event router - call this once during app startup.
 * Sets up listeners for Daily app-message and gateway WebSocket events.
 * Safe to call multiple times; only the first call registers listeners.
 */
export function initializeNiaEventRouter(): void {
  if (_initialized) {
    logger.info('niaEventRouter already initialized, skipping');
    return;
  }
  _initialized = true;
  logger.info('Initializing niaEventRouter');

  // Listen for Daily app-message events (forwarded by useVoiceSession or similar).
  // We hold the reference so resetNiaEventRouter can detach it during tests
  // or HMR — previously these were anonymous arrows that could only ever leak.
  _appMessageListener = ((e: Event) => {
    const data = (e as CustomEvent).detail;
    if (data?.kind === 'nia.event' && data?.event) {
      routeNiaEvent(data.event, data.payload || {});
    }
  }) as EventListener;
  window.addEventListener('nia:app-message', _appMessageListener);

  // Listen for tool result events that may contain window actions
  _toolResultListener = ((e: Event) => {
    const data = (e as CustomEvent).detail;
    if (data?.action === 'close' || data?.action === 'hide') {
      handleViewClose({ viewType: data.viewType, all: data.all });
    }
    if (data?.action === 'open' || data?.action === 'present') {
      handleWindowOpen(data);
    }
  }) as EventListener;
  window.addEventListener('nia:tool-result', _toolResultListener);

  // Expose closeWindows globally for emergency/debug use
  if (typeof window !== 'undefined') {
    (window as any).__niaCloseWindows = closeWindows;
    (window as any).__niaRouteEvent = routeNiaEvent;
  }

  logger.info('niaEventRouter ready — listening for nia:app-message and nia:tool-result');
}

/**
 * Tear down the router's window listeners and clear its dedup state.
 * Intended for tests/HMR; not used in normal production code paths.
 */
export function resetNiaEventRouter(): void {
  if (typeof window !== 'undefined') {
    if (_appMessageListener) window.removeEventListener('nia:app-message', _appMessageListener);
    if (_toolResultListener) window.removeEventListener('nia:tool-result', _toolResultListener);
  }
  _appMessageListener = null;
  _toolResultListener = null;
  _initialized = false;
  _recentEvents.clear();
}
