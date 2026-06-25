/**
 * Opens work-desktop apps the same way icon clicks do (desktop-background-work).
 * Wonder Canvas apps (weather, news, discord) must use this path — not requestWindowOpen.
 */

export const DESKTOP_OPEN_APP_EVENT = 'nia:desktop.openApp';

export interface DesktopOpenAppRequest {
  app: string;
  url?: string;
  category?: string;
}

/** Apps that render via Wonder Canvas — must use openDesktopApp, not raw requestWindowOpen. */
export const WONDER_DESKTOP_APP_SLUGS = new Set([
  'weather',
  'news',
  'the-news',
  'thenews',
  'discord',
  'pearl-village',
  'village',
]);

/** Icons that show the coming-soon modal instead of opening a real app window. */
export type ComingSoonAppKey = 'pearlVision';

const COMING_SOON_BY_SLUG: Record<string, ComingSoonAppKey> = {};

/** Slugs handled by desktop-background-work openDesktopApp (icon click parity). */
export const KNOWN_DESKTOP_APP_SLUGS = new Set([
  ...WONDER_DESKTOP_APP_SLUGS,
  'creation-launchpad',
  'creationlaunchpad',
  'launchpad',
  'council',
  'the-council',
  'summon',
  'summon-agent',
  'summonagent',
  'agency',
  'the-agency',
  'theagency',
  'our-pearlos',
  'ourpearlos',
  'our-pearl',
  'ourpearl',
  'public-features',
  'feature-catalog',
  'community-features',
  'pulse',
  'global-pulse',
  'social-pulse',
  'settings',
  'preferences',
  'profile-settings',
  'styles',
  'style',
  'appearance',
  'notepad',
  'notes',
  'text',
  'terminal',
  'cmd',
  'command',
  'browser',
  'chrome',
  'web',
  'youtube',
  'video',
  'files',
  'pearlvision',
  'pearl-vision',
  'vision',
  'creation-engine',
  'creationengine',
  'creation',
  'photo-magic',
  'photomagic',
  'dailycall',
  'daily-call',
  'call',
  'meeting',
  'googledrive',
  'google-drive',
  'drive',
  'gmail',
  'email',
  'sprites',
  'sprite',
]);

let desktopAppOpenReady = false;
const pendingDesktopAppOpens: DesktopOpenAppRequest[] = [];

function dispatchDesktopAppOpen(request: DesktopOpenAppRequest) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DESKTOP_OPEN_APP_EVENT, { detail: request }));
}

/** DesktopBackgroundWork calls this when its openApp listener is attached. */
export function setDesktopAppOpenReady(ready: boolean) {
  desktopAppOpenReady = ready;
  if (!ready || typeof window === 'undefined') return;
  const batch = pendingDesktopAppOpens.splice(0);
  for (const request of batch) {
    dispatchDesktopAppOpen(request);
  }
}

export function requestDesktopAppOpen(request: DesktopOpenAppRequest) {
  if (typeof window === 'undefined') return;
  if (!desktopAppOpenReady) {
    pendingDesktopAppOpens.push(request);
    return;
  }
  dispatchDesktopAppOpen(request);
}

/** Map URL slugs to desktop-background-work openDesktopApp names. */
export function toDesktopAppSlug(raw: string): string {
  const key = raw.trim().toLowerCase();
  const aliases: Record<string, string> = {
    notes: 'notepad',
    text: 'notepad',
    studio: 'creation-launchpad',
    launchpad: 'creation-launchpad',
    'creation-launchpad': 'creation-launchpad',
    'pearl-village': 'discord',
    village: 'discord',
    'pearl-vision': 'pearlvision',
    vision: 'pearlvision',
    filespace: 'files',
    'the-news': 'news',
    thenews: 'news',
    'global-pulse': 'pulse',
    'social-pulse': 'pulse',
    web: 'browser',
    chrome: 'browser',
    cmd: 'terminal',
    command: 'terminal',
    video: 'youtube',
    council: 'council',
    'the-council': 'council',
    summon: 'council',
    'summon-agent': 'council',
    summonagent: 'council',
    agency: 'agency',
    'the-agency': 'agency',
    theagency: 'agency',
    'our-pearlos': 'our-pearlos',
    ourpearlos: 'our-pearlos',
    'our-pearl': 'our-pearlos',
    ourpearl: 'our-pearlos',
    'public-features': 'our-pearlos',
    'feature-catalog': 'our-pearlos',
    'community-features': 'our-pearlos',
    preferences: 'settings',
    'profile-settings': 'settings',
    style: 'styles',
    appearance: 'styles',
    tasks: 'agency',
    tasklist: 'agency',
    'task-list': 'agency',
    rooms: 'agency',
  };
  return aliases[key] ?? key;
}

export function getComingSoonAppKey(raw: string): ComingSoonAppKey | null {
  const slug = toDesktopAppSlug(raw);
  return COMING_SOON_BY_SLUG[slug] ?? null;
}

export function isComingSoonDesktopApp(raw: string): boolean {
  return getComingSoonAppKey(raw) != null;
}

export function isKnownDesktopAppSlug(slug: string): boolean {
  return KNOWN_DESKTOP_APP_SLUGS.has(slug.trim().toLowerCase());
}

/** Route through openDesktopApp when URL slug maps to a work-desktop app. */
export function shouldRouteViaDesktopOpen(raw: string): boolean {
  const slug = toDesktopAppSlug(raw);
  return isKnownDesktopAppSlug(slug);
}

/** @deprecated Use shouldRouteViaDesktopOpen — kept for wonder-only auto work-mode switch. */
export function shouldUseDesktopAppOpen(raw: string): boolean {
  return WONDER_DESKTOP_APP_SLUGS.has(toDesktopAppSlug(raw));
}
