import type { ViewType } from '@interface/features/ManeuverableWindow/types/maneuverable-window-types';
import { DesktopMode } from '@interface/types/desktop-modes';

/** Query keys consumed by AssistantPearlDeepLink (stripped from URL after handling). */
export const PEARL_DEEPLINK_QUERY_KEYS = [
  'desktopMode',
  'openDesktop',
  'openApp',
  'app',
  'browserUrl',
  'noteId',
  'note_id',
  'noteTitle',
  'note',
] as const;

/**
 * Maps URL tokens to PearlOS desktop modes.
 * `work` → DESKTOP (same as voice/chat and DesktopBackgroundSwitcher).
 */
const DESKTOP_MODE_ALIASES: Record<string, DesktopMode> = {
  work: DesktopMode.DESKTOP,
  desktop: DesktopMode.DESKTOP,
  home: DesktopMode.HOME,
  quiet: DesktopMode.QUIET,
  creative: DesktopMode.CREATIVE,
  create: DesktopMode.CREATIVE,
  focus: DesktopMode.FOCUS,
  relax: DesktopMode.RELAXATION,
  relaxation: DesktopMode.RELAXATION,
  gaming: DesktopMode.GAMING,
  default: DesktopMode.DEFAULT,
};

export function parseDesktopModeQuery(raw: string | null | undefined): DesktopMode | null {
  if (!raw?.trim()) return null;
  const key = raw.trim().toLowerCase();
  if (key in DESKTOP_MODE_ALIASES) return DESKTOP_MODE_ALIASES[key];
  if ((Object.values(DesktopMode) as string[]).includes(key)) return key as DesktopMode;
  return null;
}

/** App slug → WindowManager viewType (aligned with chat-tool-handlers APP_TO_VIEW_TYPE). */
const OPEN_APP_ALIASES: Record<string, ViewType> = {
  notes: 'notes',
  notepad: 'notes',
  text: 'notes',
  youtube: 'youtube' as ViewType,
  video: 'youtube' as ViewType,
  terminal: 'terminal' as ViewType,
  cmd: 'terminal' as ViewType,
  command: 'terminal' as ViewType,
  files: 'files' as ViewType,
  'file-manager': 'files' as ViewType,
  explorer: 'files' as ViewType,
  browser: 'enhancedBrowser' as ViewType,
  chrome: 'enhancedBrowser' as ViewType,
  web: 'enhancedBrowser' as ViewType,
  'creation-engine': 'htmlContent' as ViewType,
  creationengine: 'htmlContent' as ViewType,
  creation: 'htmlContent' as ViewType,
  news: 'news' as ViewType,
  weather: 'weather' as ViewType,
  settings: 'settings' as ViewType,
  styles: 'styles' as ViewType,
  style: 'styles' as ViewType,
  appearance: 'styles' as ViewType,
  discord: 'discord' as ViewType,
  agency: 'agency' as ViewType,
  'the-agency': 'agency' as ViewType,
  theagency: 'agency' as ViewType,
  tasks: 'agency' as ViewType,
  tasklist: 'agency' as ViewType,
  'task-list': 'agency' as ViewType,
  rooms: 'agency' as ViewType,
  gmail: 'gmail' as ViewType,
  email: 'gmail' as ViewType,
  'google-drive': 'googleDrive' as ViewType,
  googledrive: 'googleDrive' as ViewType,
  drive: 'googleDrive' as ViewType,
  studio: 'creationLaunchpad' as ViewType,
  launchpad: 'creationLaunchpad' as ViewType,
  'creation-launchpad': 'creationLaunchpad' as ViewType,
  creationlaunchpad: 'creationLaunchpad' as ViewType,
  pearlvision: 'dailyCall' as ViewType,
  'pearl-vision': 'dailyCall' as ViewType,
  vision: 'dailyCall' as ViewType,
  'pearl-village': 'discord' as ViewType,
  village: 'discord' as ViewType,
  filespace: 'files' as ViewType,
  'photo-magic': 'photoMagic' as ViewType,
  photomagic: 'photoMagic' as ViewType,
};

export function parseOpenAppQuery(raw: string | null | undefined): ViewType | null {
  if (!raw?.trim()) return null;
  const key = raw.trim().toLowerCase();
  return OPEN_APP_ALIASES[key] ?? null;
}

export function isHomeDesktopMode(mode: DesktopMode): boolean {
  return mode === DesktopMode.HOME || mode === DesktopMode.DEFAULT;
}
