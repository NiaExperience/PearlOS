export interface KokoroVoiceMetadata {
  voiceId: string;
  language: string;
  category: string;
}

const rawVoices: Array<[string, string, string]> = [
  // US female
  ['af_alloy', 'en-US', 'US female'],
  ['af_aoede', 'en-US', 'US female'],
  ['af_bella', 'en-US', 'US female'],
  ['af_heart', 'en-US', 'US female'],
  ['af_jessica', 'en-US', 'US female'],
  ['af_kore', 'en-US', 'US female'],
  ['af_nicole', 'en-US', 'US female'],
  ['af_nova', 'en-US', 'US female'],
  ['af_river', 'en-US', 'US female'],
  ['af_sarah', 'en-US', 'US female'],
  ['af_sky', 'en-US', 'US female'],
  // US male
  ['am_adam', 'en-US', 'US male'],
  ['am_echo', 'en-US', 'US male'],
  ['am_eric', 'en-US', 'US male'],
  ['am_fenrir', 'en-US', 'US male'],
  ['am_liam', 'en-US', 'US male'],
  ['am_michael', 'en-US', 'US male'],
  ['am_onyx', 'en-US', 'US male'],
  ['am_puck', 'en-US', 'US male'],
  // UK voices
  ['bf_alice', 'en-GB', 'UK female'],
  ['bf_emma', 'en-GB', 'UK female'],
  ['bf_isabella', 'en-GB', 'UK female'],
  ['bf_lily', 'en-GB', 'UK female'],
  ['bm_daniel', 'en-GB', 'UK male'],
  ['bm_fable', 'en-GB', 'UK male'],
  ['bm_george', 'en-GB', 'UK male'],
  ['bm_lewis', 'en-GB', 'UK male'],
  // French
  ['ff_siwis', 'fr-FR', 'French'],
  // Italian
  ['if_sara', 'it-IT', 'Italian'],
  ['im_nicola', 'it-IT', 'Italian'],
  // Japanese
  ['jf_alpha', 'ja-JP', 'Japanese'],
  ['jf_gongitsune', 'ja-JP', 'Japanese'],
  ['jf_nezumi', 'ja-JP', 'Japanese'],
  ['jf_tebukuro', 'ja-JP', 'Japanese'],
  ['jm_kumo', 'ja-JP', 'Japanese'],
  // Mandarin
  ['zf_xiaobei', 'zh-CN', 'Mandarin'],
  ['zf_xiaoni', 'zh-CN', 'Mandarin'],
  ['zf_xiaoxiao', 'zh-CN', 'Mandarin'],
  ['zf_xiaoyi', 'zh-CN', 'Mandarin'],
  ['zm_yunjian', 'zh-CN', 'Mandarin'],
  ['zm_yunxi', 'zh-CN', 'Mandarin'],
  ['zm_yunxia', 'zh-CN', 'Mandarin'],
  ['zm_yunyang', 'zh-CN', 'Mandarin'],
];

export const KOKORO_VOICES: KokoroVoiceMetadata[] = rawVoices.map(
  ([voiceId, language, category]) => ({
    voiceId,
    language,
    category,
  }),
);

const languageLookup = new Map<string, string>(
  KOKORO_VOICES.map(({ voiceId, language }) => [voiceId, language]),
);

export function getKokoroVoiceLanguage(voiceId: string | undefined | null): string | undefined {
  if (!voiceId) {
    return undefined;
  }
  return languageLookup.get(voiceId);
}
