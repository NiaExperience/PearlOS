export const PEARLOS_USER_PREFERENCES_KEY = 'pearlOSSettings';

export const VOICE_PROVIDER_KEY = 'pearlos-voice-provider';
export const MUSIC_ENABLED_KEY = 'pearlos-music-enabled';
export const LAUNCH_PREF_KEY = 'pearlos-launch-mode-preference';
export const LAST_MODE_KEY = 'pearlos-last-desktop-mode';
export const SOUNDTRACK_VOLUME_KEY = 'nia:soundtrack:baseVolume';
export const SOUNDTRACK_PLAYING_KEY = 'nia:soundtrack:isPlaying';

export type VoiceProvider = 'cartesia' | 'pockettts';
export type LaunchPref = 'auto' | 'home' | 'desktop';

export interface PearlOSUserPreferences {
  voiceProvider?: VoiceProvider;
  musicEnabled?: boolean;
  launchModePreference?: LaunchPref;
  lastDesktopMode?: string;
  soundtrackBaseVolume?: number;
  soundtrackIsPlaying?: boolean;
  interfaceCustomization?: unknown;
  /**
   * Reviewable record of personal PearlOS feature changes Pearl applied for
   * this account (live UI manifests and parked code artifacts). See
   * {@link ./studio-ledger}.
   */
  personalChangeLedger?: unknown;
  /**
   * This account's own votes for public, user-created "Our PearlOS" features.
   * A map of featureId -> true. Scoped to this account only — never global.
   * See {@link ./our-pearlos-catalog}.
   */
  featureVotes?: unknown;
  /**
   * Community features this account has added to its PearlOS desktop.
   * A map of featureId -> true. The client mirrors these into local desktop
   * shortcuts so every signed-in browser can recreate the visible icon.
   */
  installedCommunityFeatures?: unknown;
  /**
   * Safe, account-local feature packages created by Studio/Agency tasks.
   * These are declarative package records only, never source patches.
   */
  personalFeaturePackages?: unknown;
}

export const DEFAULT_VOICE_PROVIDER: VoiceProvider = 'cartesia';
export const DEFAULT_CARTESIA_VOICE_ID = 'cc00e582-ed66-4004-8336-0175b85c85f6';
export const DEFAULT_POCKET_TTS_VOICE_ID = 'azelma';
export const DEFAULT_MUSIC_ENABLED = true;
export const DEFAULT_LAUNCH_PREF: LaunchPref = 'auto';

export function normalizeVoiceProvider(value: unknown): VoiceProvider | null {
  if (value === 'cartesia' || value === 'pockettts') return value;
  if (value === 'pocket') return 'pockettts';
  return null;
}

export function toBotVoiceProvider(value: VoiceProvider | string | null | undefined): string {
  if (value === 'pockettts') return 'pocket';
  return 'cartesia';
}

export function defaultVoiceIdForBotProvider(value: string | null | undefined): string {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'pocket' || provider === 'pockettts') return DEFAULT_POCKET_TTS_VOICE_ID;
  return DEFAULT_CARTESIA_VOICE_ID;
}

export function normalizeLaunchPref(value: unknown): LaunchPref | null {
  if (value === 'auto' || value === 'home' || value === 'desktop') return value;
  if (value === 'work') return 'desktop';
  return null;
}

export function getPearlOSPreferences(privateMemory: unknown): PearlOSUserPreferences {
  const memory = privateMemory as { preferences?: Record<string, unknown> } | null | undefined;
  const prefs = memory?.preferences?.[PEARLOS_USER_PREFERENCES_KEY];
  return prefs && typeof prefs === 'object' && !Array.isArray(prefs)
    ? (prefs as PearlOSUserPreferences)
    : {};
}

export function scopedStorageKey(key: string, userId?: string | null): string {
  return userId ? `${key}:${userId}` : key;
}

export function readLocalPreference(key: string, userId?: string | null): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const scoped = window.localStorage.getItem(scopedStorageKey(key, userId));
    if (scoped !== null || userId) return scoped;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocalPreference(key: string, value: string, userId?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(scopedStorageKey(key, userId), value);
  } catch {
    // Ignore storage failures; backend profile persistence is authoritative.
  }
}

function parseBooleanPreference(value: string | null): boolean | null {
  if (value === null) return null;
  return value === 'false' ? false : true;
}

export function readMusicEnabledPreference(userId?: string | null): boolean {
  if (typeof window === 'undefined') return DEFAULT_MUSIC_ENABLED;
  try {
    if (userId) {
      const scoped = window.localStorage.getItem(scopedStorageKey(MUSIC_ENABLED_KEY, userId));
      const parsedScoped = parseBooleanPreference(scoped);
      if (parsedScoped !== null) return parsedScoped;

      const legacy = window.localStorage.getItem(MUSIC_ENABLED_KEY);
      const parsedLegacy = parseBooleanPreference(legacy);
      if (parsedLegacy !== null) {
        writeLocalPreference(MUSIC_ENABLED_KEY, String(parsedLegacy), userId);
        return parsedLegacy;
      }
    } else {
      const parsed = parseBooleanPreference(window.localStorage.getItem(MUSIC_ENABLED_KEY));
      if (parsed !== null) return parsed;
    }
  } catch {
    return DEFAULT_MUSIC_ENABLED;
  }
  return DEFAULT_MUSIC_ENABLED;
}

export function writeMusicEnabledPreference(enabled: boolean, userId?: string | null): void {
  writeLocalPreference(MUSIC_ENABLED_KEY, String(enabled), userId);
}
