const TOOL_TAG_NAMES = [
  'tool_use',
  'tool_result',
  'tool_call',
  'function_call',
  'function_result',
];

// Detect inline JSON tool_call objects embedded in text body (not OpenAI delta form).
// When found, extract the tool name + args so the caller can dispatch them.
// This is intentionally not a single regex because normal tool-call JSON has a
// nested arguments object, e.g. {"tool_call":"bot_web_search","arguments":{...}}.
const JSON_TOOL_NAME_RE = /"(?:tool_call|name|tool)"\s*:\s*"(bot_[a-z0-9_]+)"/gi;

export interface DetectedTextToolCall {
  toolName: string;
  args: Record<string, unknown>;
  rawJson: string;
}

/** Scan text for embedded JSON tool_call objects before sanitization strips them. */
export function detectTextBodyToolCalls(text: string): DetectedTextToolCall[] {
  const results: DetectedTextToolCall[] = [];
  JSON_TOOL_NAME_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JSON_TOOL_NAME_RE.exec(text)) !== null) {
    const objectStart = text.lastIndexOf('{', match.index);
    if (objectStart < 0) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let objectEnd = -1;
    for (let i = objectStart; i < text.length; i += 1) {
      const char = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          objectEnd = i + 1;
          break;
        }
      }
    }
    if (objectEnd < 0) continue;
    const rawJson = text.slice(objectStart, objectEnd);
    try {
      const parsed = JSON.parse(rawJson);
      const toolName = parsed.tool_call || parsed.name || parsed.tool || '';
      if (!toolName) continue;
      const args = parsed.arguments || parsed.args || parsed.params || {};
      results.push({ toolName: toolName.toLowerCase(), args, rawJson });
    } catch {
      // Malformed JSON — skip
    }
  }
  return results;
}

const BANNED_OPENING_PATTERNS: RegExp[] = [
  /(?:^|[.!?]\s+)let me (?:check|look|verify|see|pull up|find|inspect|trace|fire up|grab|navigate|open|read|write|run|execute|dispatch|try|think|figure out|go through)\b/gi,
  /(?:^|[.!?]\s+)i(?:'| a)?ll (?:check|look|verify|see|pull up|find|inspect|trace|grab|navigate|open|read|write|run|execute|dispatch|try|think|figure out)\b/gi,
  /(?:^|[.!?]\s+)i(?:'| a)?m (?:going to |gonna |about to |checking |looking |trying to )/gi,
  /(?:^|[.!?]\s+)checking (?:that|this|now|the|if|whether)\b/gi,
  /(?:^|[.!?]\s+)looking (?:into|at|that|this|for|through)\b/gi,
  /(?:^|[.!?]\s+)one moment\b/gi,
  /(?:^|[.!?]\s+)hold on\b/gi,
  /(?:^|[.!?]\s+)give me (?:a )?(?:sec|second|moment)\b/gi,
  /(?:^|[.!?]\s+)first i(?:'| a)?ll\b/gi,
  /(?:^|[.!?]\s+)next i(?:'| a)?ll\b/gi,
  /(?:^|[.!?]\s+)then i(?:'| a)?ll\b/gi,
  /(?:^|[.!?]\s+)now (?:let me|i(?:'| a)?ll|i need to|i should|i(?:'| a)?m going to)\b/gi,
  /(?:^|[.!?]\s+)dispatching\b/gi,
  /(?:^|[.!?]\s+)let's see\b/gi,
];

const SENTENCE_END = /[.!?](?:\s|$)/;

/**
 * Strip all sentences that start with any banned opening pattern,
 * wherever they appear in the text (not just at the very beginning).
 */
function stripAllBannedPatterns(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]?|\s+/g);
  if (!sentences) return text;
  const kept = sentences.filter((part) => {
    if (!part.trim()) return true;
    for (const pattern of BANNED_OPENING_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(part.trimStart())) return false;
    }
    return !/^\s*sources sampled\b/i.test(part);
  });
  return kept.join('').replace(/[.!?]\s*[.!?]/g, '.').trim();
}

function stripToolTags(text: string): string {
  let next = text;
  for (const tag of TOOL_TAG_NAMES) {
    next = next.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    // Streaming can expose the opening tag before the closing tag arrives.
    next = next.replace(new RegExp(`<${tag}\\b[\\s\\S]*$`, 'gi'), '');
    next = next.replace(new RegExp(`<\\/${tag}\\s*>`, 'gi'), '');
  }
  next = next.replace(/<\/(?:tool|tools|function)\w*\s*>/gi, '');
  return next;
}

function stripFencedToolJson(text: string): string {
  return text.replace(
    /^\s*```(?:json)?\s*\n\s*\{[\s\S]*?(?:"tool"|\"tool_use\"|\"tool_call\"|\"name\"|\"arguments\")[\s\S]*?\}\s*```\s*/i,
    '',
  );
}

function stripInlineToolJson(text: string): string {
  const calls = detectTextBodyToolCalls(text);
  if (!calls.length) return text;
  let next = text;
  const rawObjects = Array.from(new Set(calls.map((call) => call.rawJson))).sort((a, b) => b.length - a.length);
  for (const rawJson of rawObjects) {
    next = next.split(rawJson).join('');
  }
  return next;
}

function stripBareToolLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*(?:tool_use|tool_result|tool_call|function_call|arguments|name)\s*[:=]/i.test(line))
    .join('\n');
}

function stripBannedOpening(text: string): string {
  const trimmedStart = text.trimStart();
  if (!trimmedStart) return '';
  if (!BANNED_OPENING_PATTERNS.some((pattern) => pattern.test(trimmedStart))) return text;

  const leadingWhitespace = text.slice(0, text.length - trimmedStart.length);
  const sentenceMatch = trimmedStart.match(SENTENCE_END);
  if (!sentenceMatch || sentenceMatch.index == null) return '';

  const rest = trimmedStart.slice(sentenceMatch.index + sentenceMatch[0].length).trimStart();
  return rest ? `${leadingWhitespace}${rest}` : '';
}

export function sanitizeAssistantText(text: string): string {
  let next = String(text ?? '');
  next = stripToolTags(next);
  next = stripFencedToolJson(next);
  next = stripInlineToolJson(next);
  next = stripBareToolLines(next);
  next = stripAllBannedPatterns(next);
  next = stripBannedOpening(next);
  next = next
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return next;
}

export { BANNED_OPENING_PATTERNS };
