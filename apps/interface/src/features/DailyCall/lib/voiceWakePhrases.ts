const PEARL_NAME_PATTERN = "(?:pearl|purl|perle|april|app pearl)";

const WAKE_PATTERNS: RegExp[] = [
  new RegExp(`^\\s*(?:hey|hi|hello|yo|okay|ok)?\\s*${PEARL_NAME_PATTERN}\\s*$`, "i"),
  new RegExp(`\\b(?:hey|hi|hello|yo|okay|ok)\\s+${PEARL_NAME_PATTERN}\\b`, "i"),
  new RegExp(`\\b(?:wake up|wake|hello|hi)\\s+${PEARL_NAME_PATTERN}\\b`, "i"),
  new RegExp(
    `^\\s*${PEARL_NAME_PATTERN}\\s+(?:` +
      [
        "you there",
        "are you there",
        "wake up",
        "wake",
        "wake yourself up",
        "it'?s me",
        "its me",
        "can you hear me",
        "are you awake",
        "start listening",
        "let'?s talk",
        "lets talk",
      ].join("|") +
      `)\\b`,
    "i",
  ),
];

export function normalizeWakePhraseTranscript(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/[^a-z0-9'\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPearlWakePhrase(value: string): boolean {
  const normalized = normalizeWakePhraseTranscript(value);
  if (!normalized) return false;
  return WAKE_PATTERNS.some((pattern) => pattern.test(normalized));
}
