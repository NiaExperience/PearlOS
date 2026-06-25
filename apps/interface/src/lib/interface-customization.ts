'use client';

export const INTERFACE_CUSTOMIZATION_STORAGE_KEY = 'pearlos:interface-customization:v1';
export const INTERFACE_CUSTOMIZATION_CHANGED_EVENT = 'pearl:interface-customization.changed';
export const NIA_EVENT_INTERFACE_CUSTOMIZE = 'nia:interface.customize';

export const INTERFACE_THEME_VALUES = ['pixel', 'glass', 'professional', 'calm'] as const;
export type InterfaceTheme = (typeof INTERFACE_THEME_VALUES)[number];
export type InterfaceThemeId = InterfaceTheme | string;

export const INTERFACE_THEME_OPTIONS: Array<{ value: InterfaceTheme; label: string }> = [
  { value: 'pixel', label: 'Pixel' },
  { value: 'glass', label: 'Glass' },
  { value: 'professional', label: 'Professional' },
  { value: 'calm', label: 'Calm' },
];

export interface InterfaceBackgrounds {
  home?: string;
  desktop?: string;
}

export interface CustomInterfaceTheme {
  id: string;
  label: string;
  prompt: string;
  backgrounds: Required<InterfaceBackgrounds>;
  icons: Record<string, string>;
  style: Record<string, string>;
  createdAt: number;
  updatedAt: number;
  generated: true;
}

export const INTERFACE_THEME_BACKGROUNDS: Record<InterfaceTheme, Required<InterfaceBackgrounds>> = {
  pixel: {
    home: '/backgrounds/home-sunset.png',
    desktop: '/backgrounds/desktop-forest.png',
  },
  glass: {
    home: '/backgrounds/pearl-aurora.png',
    desktop: '/backgrounds/pearl-cosmic.png',
  },
  professional: {
    home: '/backgrounds/pearl-geometric.png',
    desktop: '/backgrounds/pearl-minimal.png',
  },
  calm: {
    home: '/backgrounds/pearl-ocean.png',
    desktop: '/backgrounds/pearl-ocean.png',
  },
};

export const DEFAULT_INTERFACE_BACKGROUNDS: Required<InterfaceBackgrounds> = {
  ...INTERFACE_THEME_BACKGROUNDS.pixel,
};

export interface InterfaceCustomizationState {
  theme: InterfaceThemeId;
  backgrounds: InterfaceBackgrounds;
  icons: Record<string, string>;
  customThemes: CustomInterfaceTheme[];
  updatedAt: number;
}

export interface InterfaceCustomizePayload {
  action?: 'background' | 'icons' | 'theme' | 'all' | string;
  description?: string;
  backgroundDescription?: string;
  iconDescription?: string;
  sourceImageUrl?: string;
  theme?: InterfaceTheme | string;
  target?: 'home' | 'desktop' | 'both' | string;
  app?: string;
}

export interface DesktopIconTarget {
  key: string;
  label: string;
  subject: string;
}

interface CustomThemeAgencyTask {
  id: string;
}

export const DEFAULT_INTERFACE_CUSTOMIZATION: InterfaceCustomizationState = {
  theme: 'pixel',
  backgrounds: { ...DEFAULT_INTERFACE_BACKGROUNDS },
  icons: {},
  customThemes: [],
  updatedAt: 0,
};

export const DESKTOP_ICON_TARGETS: DesktopIconTarget[] = [
  { key: 'council', label: 'Council', subject: 'a round table with six small glowing seats around it' },
  { key: 'agency', label: 'The Agency', subject: 'a small courthouse office building with three front columns' },
  { key: 'notes', label: 'Notes', subject: 'a closed notebook with one pencil laid diagonally across it' },
  { key: 'studio', label: 'Studio', subject: 'a drafting compass over a simple triangular pyramid' },
  { key: 'our-pearlos', label: 'Our PearlOS', subject: 'a friendly public feature marketplace kiosk with a small pearl emblem' },
  { key: 'pearl-vision', label: 'Pearl Vision', subject: 'a single camera lens inside a rounded square frame' },
  { key: 'discord', label: 'Pearl Village', subject: 'two simple overlapping chat bubbles' },
  { key: 'weather', label: 'Weather', subject: 'a sun partly hidden behind one cloud' },
  { key: 'youtube', label: 'YouTube', subject: 'a rounded video screen with a play triangle in the center' },
  { key: 'news', label: 'The News', subject: 'a folded newspaper with a bold rectangular photo block' },
  { key: 'pulse', label: 'Pulse', subject: 'a small radio signal tower sending three circular broadcast waves' },
  { key: 'files', label: 'FileSpace', subject: 'a single open file folder' },
  { key: 'terminal', label: 'Terminal', subject: 'a command prompt window with one cursor block' },
  { key: 'browser', label: 'Web Browser', subject: 'a globe inside a simple browser window' },
  { key: 'styles', label: 'Styles', subject: 'an artist palette with three simple color dots' },
  { key: 'settings', label: 'Settings', subject: 'one gear with three small toggle switches below it' },
];

const DEFAULT_DESKTOP_ICON_ASSETS: Record<string, string> = {
  agency: '/icons/agency-building.svg',
  browser: '/desktopicons/chrome.png',
  council: '/icons/council.svg',
  discord: '/desktopicons/discord.png',
  files: '/desktopicons/files.png',
  news: '/desktopicons/news.png',
  notes: '/desktopicons/notepad.png',
  'our-pearlos': '/icons/pearl-clam.svg',
  'pearl-vision': '/desktopicons/pearl-vision.png',
  pulse: '/desktopicons/social.png',
  settings: '/pixel-ui/icons/settings.png',
  studio: '/desktopicons/creation-launchpad.png',
  styles: '/ThemeIco.png',
  terminal: '/desktopicons/Terminal.png',
  weather: '/desktopicons/weather.png',
  youtube: '/desktopicons/youtube.png',
};

const ICON_ALIASES: Record<string, string> = {
  summon: 'council',
  'summon-agent': 'council',
  summonagent: 'council',
  'the-council': 'council',
  creation: 'studio',
  'creation-engine': 'studio',
  creationengine: 'studio',
  'creation-launchpad': 'studio',
  creationlaunchpad: 'studio',
  launchpad: 'studio',
  ourpearlos: 'our-pearlos',
  'our-pearl': 'our-pearlos',
  ourpearl: 'our-pearlos',
  'public-features': 'our-pearlos',
  'feature-catalog': 'our-pearlos',
  'community-features': 'our-pearlos',
  notepad: 'notes',
  docs: 'files',
  filespace: 'files',
  file: 'files',
  chrome: 'browser',
  web: 'browser',
  style: 'styles',
  appearance: 'styles',
  village: 'discord',
  'pearl-village': 'discord',
  pearlvision: 'pearl-vision',
  'global-pulse': 'pulse',
  'social-pulse': 'pulse',
};

const CUSTOM_THEME_CSS_VARS = [
  '--pearl-ui-font',
  '--pearl-shell-bg',
  '--pearl-stage-bg',
  '--pearl-desktop-stage-bg',
  '--pearl-panel-bg',
  '--pearl-panel-muted-bg',
  '--pearl-panel-border',
  '--pearl-panel-backdrop',
  '--pearl-taskbar-bg',
  '--pearl-taskbar-button-bg',
  '--pearl-taskbar-button-border',
  '--pearl-taskbar-collapsed-bg',
  '--pearl-nav-button-bg',
  '--pearl-nav-button-hover-bg',
  '--pearl-nav-button-border',
  '--pearl-nav-button-hover-border',
  '--pearl-text',
  '--pearl-muted',
  '--pearl-soft',
  '--pearl-accent',
  '--pearl-radius',
  '--pearl-icon-label',
  '--pearl-icon-shadow',
  '--pearl-window-bg',
  '--pearl-window-content-bg',
  '--pearl-window-border',
  '--pearl-window-backdrop',
  '--pearl-window-title-bg',
  '--pearl-window-control-bg',
  '--pearl-window-control-hover-bg',
  '--pearl-window-control-border',
  '--pearl-window-control-hover-border',
  '--pearl-window-tab-bg',
  '--pearl-window-tab-active-bg',
  '--pearl-window-divider-bg',
  '--pearl-window-divider-active-bg',
  '--pearl-window-shadow',
] as const;

function canUseDOM(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function normalizeInterfaceTheme(raw: unknown): InterfaceTheme {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (INTERFACE_THEME_VALUES as readonly string[]).includes(value)
    ? (value as InterfaceTheme)
    : 'pixel';
}

export function normalizeIconKey(raw: unknown): string {
  const value = typeof raw === 'string'
    ? raw.trim().toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9-]/g, '')
    : '';
  return ICON_ALIASES[value] || value;
}

export function isAllowedInterfaceImageUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const value = raw.trim();
  if (!value) return false;
  if (value.startsWith('/api/pixel-art/image/')) return true;
  if (value.startsWith('/backgrounds/')) return true;
  if (value.startsWith('/desktopicons/') || value.startsWith('/icons/') || value.startsWith('/pixel-ui/')) return true;
  if (value.startsWith('blob:')) return true;

  if (!canUseDOM()) {
    return value.startsWith('/');
  }

  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) return false;
    return /\.(png|jpe?g|gif|webp|svg)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function sanitizeBackgrounds(raw: unknown): InterfaceBackgrounds {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  return {
    ...(isAllowedInterfaceImageUrl(input.home) ? { home: input.home } : {}),
    ...(isAllowedInterfaceImageUrl(input.desktop) ? { desktop: input.desktop } : {}),
  };
}

function sanitizeIcons(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalized = normalizeIconKey(key);
    if (normalized && isAllowedInterfaceImageUrl(value)) {
      result[normalized] = value;
    }
  }
  return result;
}

function completeDesktopIconMap(raw: Record<string, string>): Record<string, string> {
  const normalized = sanitizeIcons(raw);
  const complete: Record<string, string> = {};
  for (const target of DESKTOP_ICON_TARGETS) {
    const fallback = DEFAULT_DESKTOP_ICON_ASSETS[target.key];
    if (normalized[target.key]) {
      complete[target.key] = normalized[target.key];
    } else if (fallback) {
      complete[target.key] = fallback;
    }
  }
  return complete;
}

function sanitizeCssValue(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/[\n\r{};]/g, '');
  if (!value || value.length > 240) return null;
  return value;
}

function sanitizeThemeId(raw: unknown): string {
  const value = typeof raw === 'string'
    ? raw.trim().toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    : '';
  return value.slice(0, 72);
}

function sanitizeThemeLabel(raw: unknown): string {
  const value = typeof raw === 'string'
    ? raw.trim().replace(/\s+/g, ' ').replace(/[<>]/g, '')
    : '';
  return value.slice(0, 28);
}

function sanitizeThemePrompt(raw: unknown): string {
  const value = typeof raw === 'string'
    ? raw.trim().replace(/\s+/g, ' ').replace(/[<>]/g, '')
    : '';
  return value.slice(0, 180);
}

function normalizeThemeSearch(raw: unknown): string {
  return typeof raw === 'string'
    ? raw.trim().toLowerCase().replace(/_/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

function customThemeMatchScore(theme: CustomInterfaceTheme, raw: unknown): number {
  const query = normalizeThemeSearch(raw);
  const queryId = sanitizeThemeId(raw);
  if (!query && !queryId) return 0;
  const queryTokens = query.split(' ').filter((token) => token.length > 2);
  let best = 0;
  for (const field of [theme.id, theme.label, theme.prompt]) {
    const fieldText = normalizeThemeSearch(field);
    const fieldId = sanitizeThemeId(field);
    if (!fieldText && !fieldId) continue;
    if ((query && fieldText === query) || (queryId && fieldId === queryId)) best = Math.max(best, 120);
    else if (query && fieldText.includes(query)) best = Math.max(best, 95);
    else if (queryId && fieldId.includes(queryId)) best = Math.max(best, 90);
    else if (queryTokens.length && queryTokens.every((token) => fieldText.includes(token))) best = Math.max(best, 75);
  }
  return best;
}

function resolveCustomTheme(customThemes: CustomInterfaceTheme[], raw: unknown): CustomInterfaceTheme | undefined {
  return customThemes
    .map((theme) => ({ theme, score: customThemeMatchScore(theme, raw) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.theme.updatedAt - a.theme.updatedAt)[0]?.theme;
}

function sanitizeCustomThemes(raw: unknown): CustomInterfaceTheme[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const themes: CustomInterfaceTheme[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const input = item as Record<string, unknown>;
    const id = sanitizeThemeId(input.id);
    if (!id || seen.has(id) || (INTERFACE_THEME_VALUES as readonly string[]).includes(id)) continue;

    const backgrounds = sanitizeBackgrounds(input.backgrounds);
    if (!backgrounds.home || !backgrounds.desktop) continue;

    const style: Record<string, string> = {};
    if (input.style && typeof input.style === 'object' && !Array.isArray(input.style)) {
      for (const [key, value] of Object.entries(input.style as Record<string, unknown>)) {
        if (!CUSTOM_THEME_CSS_VARS.includes(key as (typeof CUSTOM_THEME_CSS_VARS)[number])) continue;
        const sanitized = sanitizeCssValue(value);
        if (sanitized) style[key] = sanitized;
      }
    }

    seen.add(id);
    themes.push({
      id,
      label: sanitizeThemeLabel(input.label) || 'Custom',
      prompt: sanitizeThemePrompt(input.prompt) || sanitizeThemeLabel(input.label) || 'custom theme',
      backgrounds: {
        home: backgrounds.home,
        desktop: backgrounds.desktop,
      },
      icons: sanitizeIcons(input.icons),
      style,
      createdAt: typeof input.createdAt === 'number' ? input.createdAt : Date.now(),
      updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : Date.now(),
      generated: true,
    });
  }

  return themes;
}

function cssUrl(url: string): string {
  const escaped = url.replace(/["\\\n\r]/g, '');
  return `url("${escaped}")`;
}

function themeBackgrounds(theme: InterfaceThemeId): Required<InterfaceBackgrounds> {
  return INTERFACE_THEME_BACKGROUNDS[normalizeInterfaceTheme(theme)];
}

function findCustomTheme(state: InterfaceCustomizationState, themeId: unknown): CustomInterfaceTheme | undefined {
  return resolveCustomTheme(state.customThemes, themeId);
}

function normalizeThemeId(raw: unknown, customThemes: CustomInterfaceTheme[]): InterfaceThemeId {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if ((INTERFACE_THEME_VALUES as readonly string[]).includes(value)) return value as InterfaceTheme;
  const custom = resolveCustomTheme(customThemes, value);
  if (custom) return custom.id;
  return 'pixel';
}

function effectiveBackgrounds(state: InterfaceCustomizationState): Required<InterfaceBackgrounds> {
  const custom = findCustomTheme(state, state.theme);
  if (custom) {
    return {
      home: state.backgrounds.home || custom.backgrounds.home,
      desktop: state.backgrounds.desktop || custom.backgrounds.desktop,
    };
  }
  const defaults = themeBackgrounds(state.theme);
  return {
    home: state.backgrounds.home || defaults.home,
    desktop: state.backgrounds.desktop || defaults.desktop,
  };
}

function normalizeBackgroundsForTheme(
  theme: InterfaceThemeId,
  backgrounds: InterfaceBackgrounds,
): Required<InterfaceBackgrounds> {
  const defaults = themeBackgrounds(theme);
  return {
    home: backgrounds.home || defaults.home,
    desktop: backgrounds.desktop || defaults.desktop,
  };
}

function clearCustomThemeCss(root: HTMLElement): void {
  for (const key of CUSTOM_THEME_CSS_VARS) {
    root.style.removeProperty(key);
  }
  delete root.dataset.pearlCustomTheme;
  if (document.body) {
    delete document.body.dataset.pearlCustomTheme;
  }
}

function persistInterfaceCustomization(state: InterfaceCustomizationState): InterfaceCustomizationState {
  if (canUseDOM()) {
    window.localStorage.setItem(INTERFACE_CUSTOMIZATION_STORAGE_KEY, JSON.stringify(state));
    applyInterfaceCustomization(state);
    window.dispatchEvent(new CustomEvent(INTERFACE_CUSTOMIZATION_CHANGED_EVENT, { detail: state }));
  }
  return state;
}

export function normalizeInterfaceCustomizationState(raw: unknown): InterfaceCustomizationState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_INTERFACE_CUSTOMIZATION;
  const parsed = raw as Partial<InterfaceCustomizationState>;
  const customThemes = sanitizeCustomThemes(parsed.customThemes);
  const theme = normalizeThemeId(parsed.theme, customThemes);
  return {
    theme,
    backgrounds: normalizeBackgroundsForTheme(theme, sanitizeBackgrounds(parsed.backgrounds)),
    icons: sanitizeIcons(parsed.icons),
    customThemes,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
  };
}

export function hasMeaningfulInterfaceCustomization(state: InterfaceCustomizationState): boolean {
  const defaults = themeBackgrounds(state.theme);
  const hasBackgroundOverrides = Object.entries(state.backgrounds).some(([key, value]) => {
    const backgroundKey = key as keyof Required<InterfaceBackgrounds>;
    return Boolean(value && value !== defaults[backgroundKey]);
  });

  return Boolean(
    state.updatedAt ||
    state.customThemes.length ||
    hasBackgroundOverrides ||
    Object.keys(state.icons).length ||
    normalizeInterfaceTheme(state.theme) !== 'pixel'
  );
}

export function replaceInterfaceCustomization(raw: unknown): InterfaceCustomizationState {
  return persistInterfaceCustomization(normalizeInterfaceCustomizationState(raw));
}

export function readInterfaceCustomization(): InterfaceCustomizationState {
  if (!canUseDOM()) return DEFAULT_INTERFACE_CUSTOMIZATION;

  try {
    const raw = window.localStorage.getItem(INTERFACE_CUSTOMIZATION_STORAGE_KEY);
    if (!raw) return DEFAULT_INTERFACE_CUSTOMIZATION;
    return normalizeInterfaceCustomizationState(JSON.parse(raw));
  } catch {
    return DEFAULT_INTERFACE_CUSTOMIZATION;
  }
}

export function applyInterfaceTheme(theme: InterfaceThemeId): void {
  if (!canUseDOM()) return;
  const normalized = normalizeInterfaceTheme(theme);
  const defaults = themeBackgrounds(normalized);
  clearCustomThemeCss(document.documentElement);
  document.documentElement.dataset.pearlTheme = normalized;
  document.body.dataset.pearlTheme = normalized;
  document.documentElement.style.setProperty('--pearl-home-default-background-image', cssUrl(defaults.home));
  document.documentElement.style.setProperty('--pearl-desktop-default-background-image', cssUrl(defaults.desktop));
}

function applyCustomInterfaceTheme(theme: CustomInterfaceTheme): void {
  const root = document.documentElement;
  root.dataset.pearlTheme = 'custom';
  root.dataset.pearlCustomTheme = theme.id;
  document.body.dataset.pearlTheme = 'custom';
  document.body.dataset.pearlCustomTheme = theme.id;
  root.style.setProperty('--pearl-home-default-background-image', cssUrl(theme.backgrounds.home));
  root.style.setProperty('--pearl-desktop-default-background-image', cssUrl(theme.backgrounds.desktop));

  for (const key of CUSTOM_THEME_CSS_VARS) {
    root.style.removeProperty(key);
  }
  for (const [key, value] of Object.entries(theme.style)) {
    if (CUSTOM_THEME_CSS_VARS.includes(key as (typeof CUSTOM_THEME_CSS_VARS)[number])) {
      root.style.setProperty(key, value);
    }
  }

  root.style.setProperty('--pearl-window-bg', 'var(--pearl-panel-bg)');
  root.style.setProperty('--pearl-window-content-bg', 'var(--pearl-panel-muted-bg)');
  root.style.setProperty('--pearl-window-border', 'var(--pearl-panel-border)');
  root.style.setProperty('--pearl-window-backdrop', 'var(--pearl-panel-backdrop)');
  root.style.setProperty('--pearl-window-title-bg', 'linear-gradient(135deg, var(--pearl-panel-muted-bg), transparent)');
  root.style.setProperty('--pearl-window-control-bg', 'var(--pearl-nav-button-bg)');
  root.style.setProperty('--pearl-window-control-hover-bg', 'var(--pearl-nav-button-hover-bg)');
  root.style.setProperty('--pearl-window-control-border', 'var(--pearl-nav-button-border)');
  root.style.setProperty('--pearl-window-control-hover-border', 'var(--pearl-nav-button-hover-border)');
  root.style.setProperty('--pearl-window-tab-bg', 'var(--pearl-taskbar-button-bg)');
  root.style.setProperty('--pearl-window-tab-active-bg', 'var(--pearl-nav-button-hover-bg)');
  root.style.setProperty('--pearl-window-divider-bg', 'var(--pearl-taskbar-button-border)');
  root.style.setProperty('--pearl-window-divider-active-bg', 'var(--pearl-accent)');
  root.style.setProperty('--pearl-window-shadow', '0 18px 60px rgba(0, 0, 0, 0.42)');
}

export function applyInterfaceCustomization(state: InterfaceCustomizationState): void {
  if (!canUseDOM()) return;
  const custom = findCustomTheme(state, state.theme);
  if (custom) {
    applyCustomInterfaceTheme(custom);
  } else {
    applyInterfaceTheme(state.theme);
  }

  const root = document.documentElement;
  const backgrounds = effectiveBackgrounds(state);
  root.style.setProperty('--pearl-home-background-image', cssUrl(backgrounds.home));
  root.style.setProperty('--pearl-desktop-background-image', cssUrl(backgrounds.desktop));
}

export function writeInterfaceCustomization(
  patch: Partial<InterfaceCustomizationState>,
): InterfaceCustomizationState {
  const current = readInterfaceCustomization();
  const customThemes = patch.customThemes ? sanitizeCustomThemes(patch.customThemes) : current.customThemes;
  const next: InterfaceCustomizationState = {
    theme: normalizeThemeId(patch.theme ?? current.theme, customThemes),
    backgrounds: normalizeBackgroundsForTheme(
      patch.theme ?? current.theme,
      sanitizeBackgrounds({ ...current.backgrounds, ...(patch.backgrounds || {}) }),
    ),
    icons: sanitizeIcons({ ...current.icons, ...(patch.icons || {}) }),
    customThemes,
    updatedAt: Date.now(),
  };

  return persistInterfaceCustomization(next);
}

export function setInterfaceTheme(theme: InterfaceThemeId): InterfaceCustomizationState {
  const current = readInterfaceCustomization();
  const custom = findCustomTheme(current, theme);
  if (custom) {
    return persistInterfaceCustomization({
      ...current,
      theme: custom.id,
      backgrounds: custom.backgrounds,
      icons: custom.icons,
      updatedAt: Date.now(),
    });
  }
  const nextTheme = normalizeInterfaceTheme(theme);
  return persistInterfaceCustomization({
    ...current,
    theme: nextTheme,
    backgrounds: { ...themeBackgrounds(nextTheme) },
    icons: {},
    updatedAt: Date.now(),
  });
}

export function deleteCustomInterfaceTheme(themeId: string): InterfaceCustomizationState {
  const current = readInterfaceCustomization();
  const id = sanitizeThemeId(themeId);
  if (!id) return current;
  const customThemes = current.customThemes.filter((theme) => theme.id !== id);
  const deletingActiveTheme = sanitizeThemeId(current.theme) === id;
  return persistInterfaceCustomization({
    ...current,
    theme: deletingActiveTheme ? 'pixel' : normalizeThemeId(current.theme, customThemes),
    backgrounds: deletingActiveTheme ? { ...DEFAULT_INTERFACE_BACKGROUNDS } : current.backgrounds,
    icons: deletingActiveTheme ? {} : current.icons,
    customThemes,
    updatedAt: Date.now(),
  });
}

export function resetInterfaceAssets(): InterfaceCustomizationState {
  const current = readInterfaceCustomization();
  const next: InterfaceCustomizationState = {
    ...current,
    theme: normalizeInterfaceTheme(current.theme),
    backgrounds: { ...themeBackgrounds(current.theme) },
    icons: {},
    updatedAt: Date.now(),
  };
  return persistInterfaceCustomization(next);
}

export function getIconOverride(
  icons: Record<string, string> | undefined,
  key: string,
  fallback: string,
): string {
  const normalized = normalizeIconKey(key);
  return icons?.[normalized] || fallback;
}

export function shouldBypassNextImageOptimization(src: string | undefined): boolean {
  const value = String(src || '');
  if (value.startsWith('/api/pixel-art/image/') || value.startsWith('blob:')) return true;
  if (!canUseDOM()) return false;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/pixel-art/image/');
  } catch {
    return false;
  }
}

export async function generatePixelArtUrl(body: Record<string, unknown>): Promise<string> {
  const response = await fetch('/api/pixel-art/generate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(friendlyThemeGenerationError(message || `Pixel art generation failed with ${response.status}`));
  }

  const url = response.headers.get('X-Pixel-Art-Url');
  if (!isAllowedInterfaceImageUrl(url)) {
    throw new Error('Pixel art generator did not return a usable image URL');
  }

  await response.arrayBuffer().catch(() => undefined);
  return url;
}

function friendlyThemeGenerationError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  const message = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (/504|gateway time-?out|timed out|timeout|nginx/i.test(raw)) {
    return 'Theme generation timed out before PearlOS could save the finished theme. I kept your current theme.';
  }
  if (
    /openrouter|missing authentication|authentication header|credentials|unauthorized|\b401\b|image models failed|pixel art generation failed/i.test(message)
  ) {
    return 'Theme image generation is unavailable right now. I kept your current theme.';
  }
  return message || 'Theme generation failed. I kept your current theme.';
}

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function titleCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function customThemeLabelFor(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes('noir') || (lower.includes('film') && lower.includes('black') && lower.includes('white'))) {
    return 'Noir';
  }
  if (lower.includes('sci') && lower.includes('80')) return '80s Sci-Fi';
  if (lower.includes('cyber')) return 'Cyber';
  if (lower.includes('forest')) return 'Forest';
  if (lower.includes('ocean') || lower.includes('sea')) return 'Ocean';
  return titleCase(prompt) || 'Custom';
}

function customThemeIdFor(label: string): string {
  const slug = sanitizeThemeId(label) || 'custom';
  return `custom-${slug}-${Date.now().toString(36)}`;
}

function themeStyleForPrompt(prompt: string): Record<string, string> {
  const lower = prompt.toLowerCase();
  if (lower.includes('noir') || (lower.includes('film') && lower.includes('black') && lower.includes('white'))) {
    return {
      '--pearl-ui-font': 'Inter, ui-sans-serif, system-ui, sans-serif',
      '--pearl-shell-bg': 'linear-gradient(180deg, #111111 0%, #080808 56%, #000000 100%)',
      '--pearl-stage-bg': 'radial-gradient(ellipse at 50% 35%, #2f2f2f 0%, #111111 58%, #000000 100%)',
      '--pearl-desktop-stage-bg': 'radial-gradient(ellipse at 50% 35%, #242424 0%, #0b0b0b 58%, #000000 100%)',
      '--pearl-panel-bg': 'rgba(9, 9, 10, 0.88)',
      '--pearl-panel-muted-bg': 'rgba(255, 255, 255, 0.075)',
      '--pearl-panel-border': 'rgba(245, 245, 245, 0.24)',
      '--pearl-panel-backdrop': 'blur(18px) saturate(80%)',
      '--pearl-taskbar-bg': 'linear-gradient(135deg, rgba(255, 255, 255, 0.16), rgba(0, 0, 0, 0.72))',
      '--pearl-taskbar-button-bg': 'rgba(255, 255, 255, 0.11)',
      '--pearl-taskbar-button-border': 'rgba(255, 255, 255, 0.24)',
      '--pearl-taskbar-collapsed-bg': 'rgba(18, 18, 18, 0.94)',
      '--pearl-nav-button-bg': 'rgba(255, 255, 255, 0.1)',
      '--pearl-nav-button-hover-bg': 'rgba(255, 255, 255, 0.18)',
      '--pearl-nav-button-border': 'rgba(255, 255, 255, 0.22)',
      '--pearl-nav-button-hover-border': 'rgba(255, 255, 255, 0.42)',
      '--pearl-text': '#f8fafc',
      '--pearl-muted': '#c9c9c9',
      '--pearl-soft': '#ececec',
      '--pearl-accent': '#f5f5f5',
      '--pearl-radius': '5px',
      '--pearl-icon-label': '#ffffff',
      '--pearl-icon-shadow': '0 1px 2px #000000, 0 0 6px rgba(0, 0, 0, 0.95), 0 0 14px rgba(0, 0, 0, 0.85)',
    };
  }
  if ((lower.includes('sci') && lower.includes('80')) || lower.includes('cyber')) {
    return {
      '--pearl-ui-font': 'Inter, ui-sans-serif, system-ui, sans-serif',
      '--pearl-shell-bg': 'linear-gradient(180deg, #150724 0%, #090c22 52%, #02030b 100%)',
      '--pearl-stage-bg': 'radial-gradient(ellipse at 50% 35%, rgba(34, 211, 238, 0.2) 0%, #13071f 56%, #02030b 100%)',
      '--pearl-desktop-stage-bg': 'radial-gradient(ellipse at 50% 35%, rgba(236, 72, 153, 0.18) 0%, #070b1f 58%, #02030b 100%)',
      '--pearl-panel-bg': 'rgba(9, 10, 28, 0.82)',
      '--pearl-panel-muted-bg': 'rgba(34, 211, 238, 0.09)',
      '--pearl-panel-border': 'rgba(125, 211, 252, 0.28)',
      '--pearl-panel-backdrop': 'blur(20px) saturate(155%)',
      '--pearl-taskbar-bg': 'linear-gradient(135deg, rgba(236, 72, 153, 0.2), rgba(34, 211, 238, 0.11))',
      '--pearl-taskbar-button-bg': 'rgba(34, 211, 238, 0.1)',
      '--pearl-taskbar-button-border': 'rgba(244, 114, 182, 0.28)',
      '--pearl-taskbar-collapsed-bg': 'rgba(88, 28, 135, 0.86)',
      '--pearl-nav-button-bg': 'rgba(15, 23, 42, 0.72)',
      '--pearl-nav-button-hover-bg': 'rgba(236, 72, 153, 0.24)',
      '--pearl-nav-button-border': 'rgba(125, 211, 252, 0.28)',
      '--pearl-nav-button-hover-border': 'rgba(244, 114, 182, 0.44)',
      '--pearl-text': '#f8fbff',
      '--pearl-muted': '#a5f3fc',
      '--pearl-soft': '#f0abfc',
      '--pearl-accent': '#22d3ee',
      '--pearl-radius': '8px',
      '--pearl-icon-label': '#ffffff',
      '--pearl-icon-shadow': '0 1px 2px #020617, 0 0 6px rgba(2, 6, 23, 0.9), 0 0 14px rgba(34, 211, 238, 0.65)',
    };
  }
  return {
    '--pearl-ui-font': 'Inter, ui-sans-serif, system-ui, sans-serif',
    '--pearl-shell-bg': 'linear-gradient(180deg, #14201d 0%, #172033 50%, #05070c 100%)',
    '--pearl-stage-bg': 'radial-gradient(ellipse at 50% 35%, rgba(148, 163, 184, 0.18) 0%, #172033 56%, #05070c 100%)',
    '--pearl-desktop-stage-bg': 'radial-gradient(ellipse at 50% 35%, rgba(45, 212, 191, 0.14) 0%, #111827 58%, #05070c 100%)',
    '--pearl-panel-bg': 'rgba(12, 18, 28, 0.86)',
    '--pearl-panel-muted-bg': 'rgba(255, 255, 255, 0.08)',
    '--pearl-panel-border': 'rgba(203, 213, 225, 0.22)',
    '--pearl-panel-backdrop': 'blur(16px) saturate(125%)',
    '--pearl-taskbar-bg': 'linear-gradient(135deg, rgba(20, 184, 166, 0.16), rgba(148, 163, 184, 0.1))',
    '--pearl-taskbar-button-bg': 'rgba(255, 255, 255, 0.09)',
    '--pearl-taskbar-button-border': 'rgba(203, 213, 225, 0.22)',
    '--pearl-taskbar-collapsed-bg': 'rgba(15, 23, 42, 0.9)',
    '--pearl-nav-button-bg': 'rgba(15, 23, 42, 0.74)',
    '--pearl-nav-button-hover-bg': 'rgba(20, 184, 166, 0.2)',
    '--pearl-nav-button-border': 'rgba(203, 213, 225, 0.22)',
    '--pearl-nav-button-hover-border': 'rgba(45, 212, 191, 0.4)',
    '--pearl-text': '#f8fafc',
    '--pearl-muted': '#cbd5e1',
    '--pearl-soft': '#e2e8f0',
    '--pearl-accent': '#2dd4bf',
    '--pearl-radius': '8px',
    '--pearl-icon-label': '#ffffff',
    '--pearl-icon-shadow': '0 1px 2px #020617, 0 0 6px rgba(2, 6, 23, 0.9), 0 0 14px rgba(2, 6, 23, 0.78)',
  };
}

function backgroundPromptFor(theme: string, target: 'home' | 'desktop'): string {
  const themeText = sentenceCase(theme);
  const surface = target === 'home'
    ? 'home screen wallpaper'
    : 'desktop wallpaper for readable icons and windows';
  const openArea = target === 'home'
    ? 'leave a clean open area in the center for foreground interface elements'
    : 'keep the center and upper-left areas calm and low-clutter so app icons remain readable';
  return [
    `A 16:9 full-screen pixel-art ${surface} in this visual style: ${themeText}.`,
    'Show one coherent environment, not a collage.',
    'Use a clear foreground, middle ground, and background with atmospheric lighting.',
    openArea,
    'No text, no letters, no logos, no characters, no menus, no desktop icons, no UI chrome.',
    'Fill the whole frame edge to edge.',
  ].join(' ');
}

function iconPromptFor(theme: string, target: DesktopIconTarget): string {
  return [
    `An isometric ${theme.trim()} pixel-art icon of ${target.subject}.`,
    'One single recognizable object only, centered and large in the frame.',
    'Simple bold silhouette, crisp outline, high contrast, readable when scaled down.',
    'Use clean lighting and 3 to 5 large shapes; avoid tiny details.',
    'No app name, no text, no letters, no logo, no people, no extra props, no scenery.',
    'Pure white #FFFFFF background only.',
  ].join(' ');
}

function customThemeTaskPrompt(theme: string): string {
  const backgroundLines = [
    `Home background: ${backgroundPromptFor(theme, 'home')}`,
    `Desktop background: ${backgroundPromptFor(theme, 'desktop')}`,
  ];
  const iconLines = DESKTOP_ICON_TARGETS.map((target) =>
    `${target.label}: ${iconPromptFor(theme, target)}`
  );
  return [
    `Create a PearlOS custom interface theme from this user prompt: "${theme}".`,
    '',
    'Craft and apply a coherent pixel-art asset set:',
    ...backgroundLines.map((line) => `- ${line}`),
    ...iconLines.map((line) => `- ${line}`),
    '',
    'Icon rules are strict: each icon must read instantly as its app, use one clear subject, avoid clutter, avoid text, and stay legible when displayed at desktop icon size.',
    'Use the generated assets to update the PearlOS home background, desktop background, and desktop icon overrides.',
  ].join('\n');
}

async function createCustomThemeAgencyTask(theme: string): Promise<CustomThemeAgencyTask> {
  const label = customThemeLabelFor(theme);
  const response = await fetch('/api/tasks', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      title: `Create PearlOS theme - ${label}`,
      task: customThemeTaskPrompt(theme),
      source: 'web_chat',
      createdBy: 'system',
      assignee: 'pearl',
      execute: false,
      maxRetries: 0,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `Could not create Agency theme task (${response.status})`);
  }
  const data = await response.json().catch(() => ({}));
  const id = String(data?.task?.id || data?.task?.taskId || '');
  if (!id) throw new Error('Agency theme task was created without a usable task id');
  await updateCustomThemeAgencyTask({ id }, {
    status: 'in_progress',
    note: 'Custom theme generation started from Settings.',
  });
  return { id };
}

async function updateCustomThemeAgencyTask(
  task: CustomThemeAgencyTask | null,
  patch: {
    status?: string;
    note?: string;
    result?: string;
    noRetry?: boolean;
    suppressResultNotification?: boolean;
  },
): Promise<void> {
  if (!task) return;
  await fetch('/api/tasks', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'update',
      taskId: task.id,
      ...patch,
    }),
  }).catch(() => undefined);
}

export async function generatePixelBackgroundPair(description: string): Promise<InterfaceCustomizationState> {
  const scene = description.trim();
  if (!scene) throw new Error('Background description is required');

  const home = await generatePixelArtUrl({
    type: 'background',
    preset: '1920x1080',
    description: backgroundPromptFor(scene, 'home'),
  });
  const desktop = await generatePixelArtUrl({
    type: 'background',
    preset: '1920x1080',
    description: backgroundPromptFor(scene, 'desktop'),
  });

  return writeInterfaceCustomization({ backgrounds: { home, desktop } });
}

async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function runOne(): Promise<void> {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= items.length) return;
    results[index] = await worker(items[index]);
    await runOne();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runOne));
  return results;
}

export async function generatePixelIconPack(
  description: string,
  app?: string,
): Promise<InterfaceCustomizationState> {
  const theme = description.trim();
  if (!theme) throw new Error('Icon description is required');

  const requestedKey = normalizeIconKey(app);
  const targets = requestedKey
    ? DESKTOP_ICON_TARGETS.filter((target) => target.key === requestedKey)
    : DESKTOP_ICON_TARGETS;

  if (requestedKey && targets.length === 0) {
    throw new Error(`Unknown desktop icon: ${app}`);
  }

  const entries = await runWithLimit(targets, 3, async (target) => {
    try {
      const url = await generatePixelArtUrl({
        type: 'icon',
        size: 128,
        description: iconPromptFor(theme, target),
      });
      return [target.key, url] as const;
    } catch (error) {
      console.warn('[interface-customization] icon generation failed, using fallback', {
        icon: target.key,
        error: error instanceof Error ? error.message : String(error),
      });
      return [target.key, DEFAULT_DESKTOP_ICON_ASSETS[target.key]] as const;
    }
  });

  return writeInterfaceCustomization({ icons: Object.fromEntries(entries) });
}

export async function generateCustomInterfaceTheme(description: string): Promise<InterfaceCustomizationState> {
  const theme = description.trim();
  if (!theme) throw new Error('Theme prompt is required');

  let task: CustomThemeAgencyTask | null = null;
  try {
    task = await createCustomThemeAgencyTask(theme);
    const currentState = readInterfaceCustomization();
    const baseBackgrounds = effectiveBackgrounds(currentState);
    const label = customThemeLabelFor(theme);
    const customThemeId = customThemeIdFor(label);
    const backgroundResults = await Promise.allSettled([
      generatePixelArtUrl({
        type: 'background',
        preset: '1920x1080',
        description: backgroundPromptFor(theme, 'home'),
      }),
      generatePixelArtUrl({
        type: 'background',
        preset: '1920x1080',
        description: backgroundPromptFor(theme, 'desktop'),
      }),
    ]);
    const [homeResult, desktopResult] = backgroundResults;
    if (homeResult.status === 'rejected' && desktopResult.status === 'rejected') {
      throw homeResult.reason || desktopResult.reason || new Error('Theme background generation failed');
    }
    const backgrounds = {
      home: homeResult.status === 'fulfilled' ? homeResult.value : baseBackgrounds.home,
      desktop: desktopResult.status === 'fulfilled' ? desktopResult.value : baseBackgrounds.desktop,
    };
    const shellTheme: CustomInterfaceTheme = {
      id: customThemeId,
      label,
      prompt: sanitizeThemePrompt(theme),
      backgrounds,
      icons: completeDesktopIconMap({}),
      style: themeStyleForPrompt(theme),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      generated: true,
    };
    let state = writeInterfaceCustomization({
      theme: shellTheme.id,
      backgrounds: shellTheme.backgrounds,
      icons: shellTheme.icons,
      customThemes: [
        ...currentState.customThemes.filter(
          (existing) => existing.id !== shellTheme.id && existing.label.toLowerCase() !== shellTheme.label.toLowerCase(),
        ),
        shellTheme,
      ],
    });
    await updateCustomThemeAgencyTask(task, {
      status: 'in_progress',
      note: `${label} theme shell applied. Generating desktop icons now.`,
    });

    const iconEntries = await runWithLimit(DESKTOP_ICON_TARGETS, 4, async (target) => {
      try {
        const url = await generatePixelArtUrl({
          type: 'icon',
          size: 128,
          description: iconPromptFor(theme, target),
        });
        return [target.key, url, true] as const;
      } catch (error) {
        console.warn('[interface-customization] theme icon generation failed, using fallback', {
          icon: target.key,
          error: error instanceof Error ? error.message : String(error),
        });
        return [target.key, DEFAULT_DESKTOP_ICON_ASSETS[target.key], false] as const;
      }
    });
    const generatedIconCount = iconEntries.filter((entry) => entry[2]).length;
    const customTheme: CustomInterfaceTheme = {
      ...shellTheme,
      label,
      icons: completeDesktopIconMap(Object.fromEntries(iconEntries.map(([key, url]) => [key, url]))),
      updatedAt: Date.now(),
    };
    state = writeInterfaceCustomization({
      theme: customTheme.id,
      backgrounds: customTheme.backgrounds,
      icons: customTheme.icons,
      customThemes: [
        ...readInterfaceCustomization().customThemes.filter(
          (existing) => existing.id !== customTheme.id && existing.label.toLowerCase() !== customTheme.label.toLowerCase(),
        ),
        customTheme,
      ],
    });
    await updateCustomThemeAgencyTask(task, {
      status: 'completed',
      note: `${customTheme.label} theme assets applied to PearlOS.`,
      result: `Created the ${customTheme.label} theme with home and desktop backgrounds. ${generatedIconCount} custom desktop icons were generated; the rest use readable fallback icons.`,
      suppressResultNotification: true,
    });
    return state;
  } catch (error) {
    const message = friendlyThemeGenerationError(error);
    await updateCustomThemeAgencyTask(task, {
      status: 'failed',
      noRetry: true,
      note: message.slice(0, 300),
      result: message.slice(0, 1000),
      suppressResultNotification: true,
    });
    throw new Error(message);
  }
}

export async function applyInterfaceCustomizePayload(
  rawPayload: InterfaceCustomizePayload | Record<string, unknown> | undefined | null,
): Promise<InterfaceCustomizationState> {
  const payload = (rawPayload || {}) as InterfaceCustomizePayload;
  const action = typeof payload.action === 'string' ? payload.action.toLowerCase() : '';
  let state = readInterfaceCustomization();

  if (payload.theme) {
    state = setInterfaceTheme(payload.theme);
  }

  const sourceImageUrl = payload.sourceImageUrl;
  if (isAllowedInterfaceImageUrl(sourceImageUrl)) {
    const target = typeof payload.target === 'string' ? payload.target.toLowerCase() : 'both';
    if (action === 'icons') {
      const key = normalizeIconKey(payload.app || 'settings');
      state = writeInterfaceCustomization({ icons: { [key]: sourceImageUrl } });
    } else if (target === 'home') {
      state = writeInterfaceCustomization({ backgrounds: { home: sourceImageUrl } });
    } else if (target === 'desktop') {
      state = writeInterfaceCustomization({ backgrounds: { desktop: sourceImageUrl } });
    } else {
      state = writeInterfaceCustomization({ backgrounds: { home: sourceImageUrl, desktop: sourceImageUrl } });
    }
  }

  const description = typeof payload.description === 'string' ? payload.description : '';
  const backgroundDescription =
    typeof payload.backgroundDescription === 'string'
      ? payload.backgroundDescription
      : action === 'background' || action === 'all'
        ? description
        : '';
  const iconDescription =
    typeof payload.iconDescription === 'string'
      ? payload.iconDescription
      : action === 'icons' || action === 'all'
        ? description
        : '';

  if (backgroundDescription.trim()) {
    state = await generatePixelBackgroundPair(backgroundDescription);
  }
  if (iconDescription.trim()) {
    state = await generatePixelIconPack(iconDescription, payload.app);
  }

  return state;
}
