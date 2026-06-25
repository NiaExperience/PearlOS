/**
 * Creation Intent Detector — Kitchen Workflow (Steps 1-2)
 *
 * Pure heuristic classifier (no LLM call) that sniffs out
 * "I want to build a ___" style messages and extracts the
 * project title + type. Keeps the chat loop responsive.
 */

export type ProjectType = 'game' | 'app' | 'feature';

export interface CreationIntent {
  isCreation: boolean;
  title?: string;
  type?: ProjectType;
  description?: string;
}

const NO_MATCH: CreationIntent = { isCreation: false };

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * Capture group 1 = the thing they want to create.
 * We're intentionally loose — false positives are cheap (we just ask
 * a follow-up), false negatives mean we miss the Kitchen trigger.
 */
const CREATION_PATTERNS: RegExp[] = [
  /\b(?:i\s+)?want\s+to\s+(?:make|build|create)\s+(?:a\s+)?(.+)/i,
  /\blet(?:'s|s)\s+(?:make|build|create)\s+(?:a\s+)?(.+)/i,
  /\bcan\s+you\s+(?:make|build|create)\s+(?:me\s+)?(?:a\s+)?(.+)/i,
  /\b(?:help\s+me\s+)?(?:make|build|create)\s+(?:a\s+)?(.+)/i,
  /\bi(?:'d|d)\s+like\s+(?:to\s+)?(?:make|build|create)\s+(?:a\s+)?(.+)/i,
  /\bi\s+(?:need|wanna)\s+(?:to\s+)?(?:make|build|create)\s+(?:a\s+)?(.+)/i,
];

// ---------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------

const GAME_KEYWORDS = [
  'game', 'platformer', 'rpg', 'roguelike', 'shooter', 'puzzle game',
  'arcade', 'dungeon', 'adventure game', 'tower defense', 'clicker',
  'survival', 'racing game', 'fighting game', 'card game', 'board game',
];

const APP_KEYWORDS = [
  'app', 'application', 'dashboard', 'portal', 'tool', 'website',
  'web app', 'mobile app', 'tracker', 'manager', 'planner', 'calculator',
  'editor', 'viewer', 'converter', 'generator',
];

function inferType(text: string): ProjectType {
  const lower = text.toLowerCase();
  for (const kw of GAME_KEYWORDS) {
    if (lower.includes(kw)) return 'game';
  }
  for (const kw of APP_KEYWORDS) {
    if (lower.includes(kw)) return 'app';
  }
  return 'feature';
}

// ---------------------------------------------------------------------------
// Title cleanup
// ---------------------------------------------------------------------------

/** Strip trailing punctuation, filler phrases, and clamp length. */
function cleanTitle(raw: string): string {
  let title = raw
    .replace(/[.!?,;:]+$/, '')             // trailing punctuation
    .replace(/\b(please|pls|for me)\b/gi, '') // filler
    .replace(/\s{2,}/g, ' ')              // collapse whitespace
    .trim();

  // Capitalize first letter
  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  // Clamp at ~80 chars (find a word boundary)
  if (title.length > 80) {
    const cut = title.lastIndexOf(' ', 80);
    title = title.slice(0, cut > 20 ? cut : 80).trim();
  }

  return title;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a user message for creation intent.
 *
 * Returns `{ isCreation: true, title, type, description }` when it
 * detects a build/create/make request, otherwise `{ isCreation: false }`.
 */
export function detectCreationIntent(message: string): CreationIntent {
  if (!message || message.length < 8) return NO_MATCH;

  for (const pattern of CREATION_PATTERNS) {
    const match = message.match(pattern);
    if (match?.[1]) {
      const rawCapture = match[1].trim();
      const title = cleanTitle(rawCapture);
      if (title.length < 2) continue;

      const type = inferType(message);

      return {
        isCreation: true,
        title,
        type,
        description: message.trim(),
      };
    }
  }

  return NO_MATCH;
}
