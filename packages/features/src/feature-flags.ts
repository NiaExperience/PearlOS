/**
 * Shared feature flags module used by Interface and Dashboard.
 * Semantics: enabled by default unless an env var explicitly disables them.
 * Disabling tokens: 0, false, off, disabled (case-insensitive). Any other value (incl. empty / missing) => enabled.
 */
export type FeatureKey =
    | 'appletApi'
    | 'avatar'
    | 'avatarLipsync'
    | 'summonSpriteTool'
    | 'googleAuth'
    | 'guestLogin'
    | 'browserAutomation'
    | 'dailyCall'
    | 'assistantSelfClose'
    | 'requireUserProfile'
    | 'gmail'
    | 'googleDrive'
    | 'htmlContent'
    | 'maneuverableWindow'
    | 'miniBrowser'
    | 'passwordLogin'
    | 'notes'
    | 'onboarding'
    | 'openclawBridge'
    | 'enhancedBrowser'
    | 'pearlMultiMenu'
    | 'resourceSharing'
    | 'screenSharePrompt'
    | 'terminal'
    | 'soundtrack'
    | 'userProfile'
    | 'wikipedia'
    | 'youtube'
    | 'smartSilence'
    | 'lullDetection'
    | 'spriteVoice';

export const FeatureKeys: FeatureKey[] = [
    'appletApi',
    'avatar',
    'avatarLipsync',
    'summonSpriteTool',
    'googleAuth',
    'guestLogin',
    'browserAutomation',
    'dailyCall',
    'assistantSelfClose',
    'requireUserProfile',
    'gmail',
    'googleDrive',
    'htmlContent',
    'maneuverableWindow',
    'miniBrowser',
    'passwordLogin',
    'notes',
    'onboarding',
    'openclawBridge',
    'enhancedBrowser',
    'pearlMultiMenu',
    'resourceSharing',
    'screenSharePrompt',
    'terminal',
    'soundtrack',
    'userProfile',
    'wikipedia',
    'youtube',
    'smartSilence',
    'lullDetection',
    'spriteVoice',
];

interface FeatureDefinition {
    key: FeatureKey;
    canonical: FeatureKey;
    env: string[];
    default: boolean;
    description: string;
    hasPrompt: boolean;
}

const definitions: FeatureDefinition[] = [
    { key: 'appletApi', hasPrompt: true, canonical: 'appletApi', env: ['NEXT_PUBLIC_FEATURE_APPLET_API', 'FEATURE_APPLET_API'], default: true, description: 'API integration instructions for HTML applets' },
    { key: 'avatar', hasPrompt: false, canonical: 'avatar', env: ['NEXT_PUBLIC_FEATURE_AVATAR', 'FEATURE_RIVEAVATAR'], default: true, description: 'Rive avatar + state machine + assistant button' },
    { key: 'avatarLipsync', hasPrompt: false, canonical: 'avatarLipsync', env: ['NEXT_PUBLIC_FEATURE_AVATAR_LIPSYNC', 'FEATURE_AVATAR_LIPSYNC'], default: true, description: 'Advanced Rive avatar lipsync with voice confusion prevention' },
    { key: 'summonSpriteTool', hasPrompt: false, canonical: 'summonSpriteTool', env: ['NEXT_PUBLIC_FEATURE_SUMMON_SPRITE_TOOL', 'FEATURE_SUMMON_SPRITE_TOOL'], default: true, description: 'Enable bot summon sprite tool' },
    { key: 'googleAuth', hasPrompt: false, canonical: 'googleAuth', env: ['NEXT_PUBLIC_FEATURE_GOOGLE_AUTH'], default: true, description: 'Enable Google OAuth login option for the assistant' },
    { key: 'guestLogin', hasPrompt: false, canonical: 'guestLogin', env: ['NEXT_PUBLIC_FEATURE_GUEST_LOGIN'], default: true, description: 'Enable guest/anonymous login option for the assistant' },
    { key: 'browserAutomation', hasPrompt: false, canonical: 'browserAutomation', env: ['NEXT_PUBLIC_FEATURE_BROWSERAUTOMATION', 'FEATURE_BROWSERAUTOMATION'], default: true, description: 'Experimental browser automation panel' },
    { key: 'dailyCall', hasPrompt: true, canonical: 'dailyCall', env: ['NEXT_PUBLIC_FEATURE_DAILYCALL', 'FEATURE_DAILYCALL'], default: true, description: 'Daily.co call experience (video/audio, pre-join, tiles)' },
    { key: 'assistantSelfClose', hasPrompt: false, canonical: 'assistantSelfClose', env: ['NEXT_PUBLIC_FEATURE_ASSISTANT_SELF_CLOSE', 'FEATURE_ASSISTANT_SELF_CLOSE'], default: false, description: 'Allow assistants to programmatically end voice-only calls when explicitly enabled' },
    { key: 'requireUserProfile', hasPrompt: false, canonical: 'requireUserProfile', env: ['NEXT_PUBLIC_FEATURE_REQUIREUSERPROFILE', 'FEATURE_REQUIREUSERPROFILE'], default: false, description: 'Gate DailyCall behind user profile completion flow' },
    { key: 'gmail', hasPrompt: true, canonical: 'gmail', env: ['NEXT_PUBLIC_FEATURE_GMAIL', 'FEATURE_GMAIL'], default: true, description: 'Gmail inbox integration & scan API' },
    { key: 'googleDrive', hasPrompt: true, canonical: 'googleDrive', env: ['NEXT_PUBLIC_FEATURE_GOOGLEDRIVE', 'FEATURE_GOOGLEDRIVE'], default: true, description: 'Google Drive placeholder view' },
    { key: 'htmlContent', hasPrompt: true, canonical: 'htmlContent', env: ['NEXT_PUBLIC_FEATURE_HTMLCONTENT', 'FEATURE_HTMLGENERATION'], default: true, description: 'Dynamic / generated HTML mini-apps' },
    { key: 'maneuverableWindow', hasPrompt: true, canonical: 'maneuverableWindow', env: ['NEXT_PUBLIC_FEATURE_MANEUVERABLEWINDOW', 'FEATURE_MANEUVERABLEWINDOW'], default: true, description: 'Draggable, resizable, and snappable window' },
    { key: 'miniBrowser', hasPrompt: true, canonical: 'miniBrowser', env: ['NEXT_PUBLIC_FEATURE_MINIBROWSER', 'FEATURE_MINIBROWSER'], default: true, description: 'Embedded browsing surface' },
    { key: 'passwordLogin', hasPrompt: false, canonical: 'passwordLogin', env: ['NEXT_PUBLIC_FEATURE_PASSWORD_LOGIN'], default: true, description: 'Enable password-based login option for the assistant' },
    { key: 'notes', hasPrompt: true, canonical: 'notes', env: ['NEXT_PUBLIC_FEATURE_NOTES', 'FEATURE_NOTES'], default: true, description: 'Notes feature (content CRUD)' },
    /** TEMPORARILY hardcode disabled pearlMultiMenu, until we revise the design - it collides with our voice-per-room/mode workflow */
    { key: 'onboarding', hasPrompt: false, canonical: 'onboarding', env: ['NEXT_PUBLIC_FEATURE_ONBOARDING', 'FEATURE_ONBOARDING'], default: true, description: 'User onboarding flow, uses default personality/voice until onboarding is complete' },  
    { key: 'pearlMultiMenu', hasPrompt: false, canonical: 'pearlMultiMenu', env: ['NEXT_PUBLIC_FEATURE_PEARL_MULTI_MENU', 'FEATURE_PEARL_MULTI_MENU'], default: false, description: 'Pearl multi-menu with icon buttons (when disabled, uses simple click behavior)' },
    { key: 'resourceSharing', hasPrompt: false, canonical: 'resourceSharing', env: ['NEXT_PUBLIC_FEATURE_RESOURCE_SHARING', 'FEATURE_RESOURCE_SHARING'], default: true, description: 'Cross-user resource sharing for notes and applets' },
    { key: 'screenSharePrompt', hasPrompt: false, canonical: 'screenSharePrompt', env: ['NEXT_PUBLIC_FEATURE_SCREEN_SHARE_PROMPT', 'FEATURE_SCREEN_SHARE_PROMPT'], default: true, description: 'Prompt the user to share their screen upon joining a session' },
    { key: 'terminal', hasPrompt: true, canonical: 'terminal', env: ['NEXT_PUBLIC_FEATURE_TERMINAL', 'FEATURE_TERMINAL'], default: true, description: 'Mock terminal interface' },
    { key: 'soundtrack', hasPrompt: true, canonical: 'soundtrack', env: ['NEXT_PUBLIC_FEATURE_SOUNDTRACK', 'FEATURE_SOUNDTRACK'], default: true, description: 'Pearl soundtrack playback with smart ducking' },
    { key: 'userProfile', hasPrompt: true, canonical: 'userProfile', env: ['NEXT_PUBLIC_FEATURE_USERPROFILE', 'FEATURE_USERPROFILE'], default: true, description: 'UserProfile capture feature' },
    { key: 'wikipedia', hasPrompt: true, canonical: 'wikipedia', env: ['NEXT_PUBLIC_FEATURE_WIKIPEDIA', 'FEATURE_WIKIPEDIA'], default: true, description: 'Wikipedia search & article open helper' },
    { key: 'youtube', hasPrompt: true, canonical: 'youtube', env: ['NEXT_PUBLIC_FEATURE_YOUTUBE', 'FEATURE_YOUTUBE'], default: true, description: 'YouTube search / playback surface & tool integration' },
    { key: 'smartSilence', hasPrompt: false, canonical: 'smartSilence', env: ['NEXT_PUBLIC_FEATURE_SMART_SILENCE', 'FEATURE_SMART_SILENCE'], default: true, description: 'Enable smart silence: the bot stays silent when appropriate (responds with SILENCE).' },
    { key: 'lullDetection', hasPrompt: false, canonical: 'lullDetection', env: ['NEXT_PUBLIC_FEATURE_LULL_DETECTION', 'FEATURE_LULL_DETECTION'], default: false, description: 'Enable lull detection: the bot proactively speaks if the user is silent for a while.' },
    { key: 'spriteVoice', hasPrompt: false, canonical: 'spriteVoice', env: ['NEXT_PUBLIC_FEATURE_SPRITE_VOICE', 'FEATURE_SPRITE_VOICE'], default: true, description: 'Enable voice/personality switching when interacting with Sprites' },
    { key: 'openclawBridge', hasPrompt: true, canonical: 'openclawBridge', env: ['NEXT_PUBLIC_FEATURE_OPENCLAW_BRIDGE', 'FEATURE_OPENCLAW_BRIDGE'], default: true, description: 'OpenClaw integration tools (bot_openclaw_task, bot_think_deeply)' },
    { key: 'enhancedBrowser', hasPrompt: true, canonical: 'enhancedBrowser', env: ['NEXT_PUBLIC_FEATURE_ENHANCED_BROWSER', 'FEATURE_ENHANCED_BROWSER'], default: true, description: 'Enhanced browser with full navigation controls' },
];

const byKey: Record<FeatureKey, FeatureDefinition> = definitions.reduce((acc, d) => {
    acc[d.key] = d;
    return acc;
}, {} as Record<FeatureKey, FeatureDefinition>);

const DISABLE_PATTERN = /^(0|false|off|disabled)$/i;

function evalDefinition(def: FeatureDefinition): boolean {
    for (const envName of def.env) {
        const raw = process.env[envName];
        if (raw != null) return !DISABLE_PATTERN.test(String(raw).trim());
    }
    return def.default;
}

const canonicalKeys = definitions; // all canonical here
const canonicalEnabled: Record<string, boolean> = canonicalKeys.reduce((acc, def) => {
    acc[def.canonical] = evalDefinition(def);
    return acc;
}, {} as Record<string, boolean>);

export const featureFlags: Record<string, boolean> = { ...canonicalEnabled };

export const featureRegistry = canonicalKeys.reduce((acc, def) => {
    acc[def.canonical] = {
        key: def.canonical,
        enabled: canonicalEnabled[def.canonical],
        description: def.description,
    };
    return acc;
}, {} as Record<string, { key: string; enabled: boolean; description: string }>);

export function envIsFeatureEnabled(key: FeatureKey): boolean {
    const def = byKey[key];
    if (!def) return false;
    return featureFlags[def.canonical];
}

// Optional global assistant-supported features used as a default in client/runtime
let activeSupportedFeatures: Set<FeatureKey> | null = null;

export function setAssistantSupportedFeatures(list: FeatureKey[] | null | undefined): void {
    activeSupportedFeatures = Array.isArray(list) ? new Set(list) : null;
}

export function isFeatureEnabled(key: FeatureKey, supportedFeatures?: string[] | null): boolean {
    // Explicit list takes precedence
    if (Array.isArray(supportedFeatures)) {
        const enabled = supportedFeatures.includes(key) && envIsFeatureEnabled(key);
        return enabled;
    }
    // Fallback to global active list if set (client/runtime convenience)
    if (activeSupportedFeatures) {
        const enabled = activeSupportedFeatures.has(key) && envIsFeatureEnabled(key);
        return enabled;
    }
    // Default to environment flag only
    return envIsFeatureEnabled(key);
}

export function guardFeature<T>(key: FeatureKey, onDisabled: () => T, onEnabled: () => T, supportedFeatures: string[]): T {
    return isFeatureEnabled(key, supportedFeatures) ? onEnabled() : onDisabled();
}

/**
 * Async variant of guardFeature. Accepts sync or async callbacks and returns a Promise.
 * Usage mirrors guardFeature, but allows awaiting side effects in onEnabled/onDisabled.
 */
export async function guardFeatureAsync<T>(
    key: FeatureKey,
    onDisabled: () => Promise<T> | T,
    onEnabled: () => Promise<T> | T,
    supportedFeatures?: string[] | null,
): Promise<T> {
    return isFeatureEnabled(key, supportedFeatures)
        ? await onEnabled()
        : await onDisabled();
}

/**
 * Returns an array of FeatureKeys that have associated functional prompts.
 * Use this to filter the feature key dropdown in the functional prompt creation dialog.
 */
export function getFeatureKeysWithPrompts(): FeatureKey[] {
    return definitions.filter(def => def.hasPrompt).map(def => def.key);
}

// Back-compat exports for existing consumers
export const featureDefinitions = featureRegistry;
export default featureFlags;