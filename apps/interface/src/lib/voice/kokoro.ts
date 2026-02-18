import { getKokoroVoiceLanguage } from '@nia/prism/core/constants/kokoro-voices';

const KOKORO_SPEED_MIN = 0.5;
const KOKORO_SPEED_MAX = 2.0;

export type VoiceParametersInput = {
  speed?: number;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  optimizeStreamingLatency?: number;
  language?: string;
  [key: string]: unknown;
};

function clampSpeed(speed: number): number {
  return Math.min(Math.max(speed, KOKORO_SPEED_MIN), KOKORO_SPEED_MAX);
}

function normaliseLanguageCode(language: string | undefined): string | undefined {
  if (!language) {
    return undefined;
  }
  return language.toLowerCase();
}

export function normalizeVoiceParameters(
  voiceProvider: string | undefined,
  voiceId: string | undefined,
  voiceParameters?: VoiceParametersInput | null,
): VoiceParametersInput | undefined {
  const provider = voiceProvider?.toLowerCase();

  if (!voiceParameters && provider !== 'kokoro') {
    return undefined;
  }

  const initial: VoiceParametersInput = voiceParameters ? { ...voiceParameters } : {};

  if (provider === 'kokoro') {
    if (typeof initial.speed === 'number') {
      initial.speed = clampSpeed(initial.speed);
    }

    const language =
      typeof initial.language === 'string'
        ? initial.language
        : getKokoroVoiceLanguage(voiceId ?? '');
    const normalisedLanguage = normaliseLanguageCode(language);
    if (normalisedLanguage) {
      initial.language = normalisedLanguage;
    } else {
      delete initial.language;
    }
  }

  const entries = Object.entries(initial).filter(
    ([, value]) => value !== undefined && value !== null,
  );

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as VoiceParametersInput;
}
