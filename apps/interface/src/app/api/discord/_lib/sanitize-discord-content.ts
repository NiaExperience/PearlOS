const TOOL_TAG_NAMES = [
  'read',
  'write',
  'edit',
  'grep',
  'glob',
  'ls',
  'bash',
  'command',
  'exec',
  'tool',
  'tools',
  'tool_call',
  'tool_use',
  'tool_result',
  'function',
  'function_call',
  'function_result',
  'memory_search',
  'memory_update',
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripXmlToolBlocks(text: string): string {
  let next = text;
  next = next.replace(/(?:^|\n)\s*<exec\b[^\n]*(?:\n|$)/gi, '\n');
  for (const tag of TOOL_TAG_NAMES) {
    const escaped = escapeRegex(tag);
    next = next.replace(new RegExp(`<${escaped}\\b[^>]*\\/\\s*>`, 'gi'), '');
    next = next.replace(new RegExp(`<${escaped}\\b[^>]*>[\\s\\S]*?(?:<\\/${escaped}>|$)`, 'gi'), '');
    next = next.replace(new RegExp(`<\\/${escaped}\\s*>`, 'gi'), '');
  }
  next = next.replace(/<((?:tool|function|memory|exec)[\w:-]*)\b[^>]*\/\s*>/gi, '');
  next = next.replace(/<((?:tool|function|memory|exec)[\w:-]*)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, '');
  next = next.replace(/<\/(?:tool|function|memory|exec)[\w:-]*\s*>/gi, '');
  next = next.replace(/<file\b[^>]*>[\s\S]*?<\/file>/gi, '');
  next = next.replace(/^\s*<file\b[^\n]*(?:\n|$)/gim, '');
  next = next.replace(/^\s*<path>\s*(?:\/(?:workspace|home|opt|root|tmp|var)\/[^<]+|[A-Za-z]:\\[^<]+)\s*<\/path>\s*$/gim, '');
  next = next.replace(/<\/?(?:sessions?|session)\b[^>]*\/?\s*>/gi, '');
  return next;
}

function stripInternalFailureText(text: string): string {
  let next = text;
  next = next.replace(/\b(?:disp|run|task|session)-[a-f0-9][a-f0-9_.:-]{7,}\b/gi, 'this task');
  next = next.replace(/\b[a-f0-9]{32,64}\b/gi, 'internal reference');
  next = next.replace(/^\s*(?:LLM request failed|provider rejected|rawError=|PROXY\s+\d{3}:).*(?:\n|$)/gim, '');
  next = next.replace(
    /^(?!.*\b(?:workspace-write|danger-full-access|approval policy|permission mode|sandbox_permissions|require_escalated)\b)\s*(?:sandbox|connector|tool|executor|codex|claude)\b.*\b(?:failed|error|rejected|permission|denied|unavailable|not configured)\b.*(?:\n|$)/gim,
    '',
  );
  next = next.replace(
    /\bsandbox\b[^\n.!?]*\b(?:workspace-write|danger-full-access|approval policy|permission mode|sandbox_permissions|require_escalated)\b[^.!?\n]*(?:[.!?]|\n|$)/gi,
    'I hit a worker permissions problem before the task could finish cleanly. ',
  );
  return next;
}

function stripInlineJsonToolObjects(text: string): string {
  let next = String(text ?? '');
  const markers = [
    '"tool_call"',
    '"tool_calls"',
    '"function_call"',
    '"recipient_name"',
    '"exec_command"',
    '"parameters"',
    '"arguments"',
  ];
  let index = 0;
  while (index < next.length) {
    const markerIndex = markers.reduce((best, marker) => {
      const found = next.indexOf(marker, index);
      return found >= 0 && (best < 0 || found < best) ? found : best;
    }, -1);
    if (markerIndex < 0) break;
    const start = next.lastIndexOf('{', markerIndex);
    if (start < 0) {
      index = markerIndex + 1;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let pos = start; pos < next.length; pos += 1) {
      const char = next[pos];
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
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = pos + 1;
          break;
        }
      }
    }
    if (end < 0) {
      next = next.slice(0, start).trimEnd();
      break;
    }
    const raw = next.slice(start, end);
    if (!/(tool_calls?|function_call|recipient_name|exec_command|pearl-task-dispatch|pearl-swarm-dispatch|memory_search|web_search|exec_command)/i.test(raw)) {
      index = markerIndex + 1;
      continue;
    }
    next = `${next.slice(0, start)}${next.slice(end)}`;
    index = start;
  }
  return next;
}

function normalizePearlPrefix(text: string): string {
  let next = text.replace(/(?:^|\n)\s*(?:Pearl(?:'s Agency)? says:\s*){2,}/gi, "Pearl's Agency says: ");
  next = next.replace(/^\s*Pearl's Agency says:\s*Pearl(?:'s Agency)? says:\s*/i, "Pearl's Agency says: ");
  return next;
}

function normalizeStylePunctuation(text: string): string {
  let next = text;
  next = next.replace(/\\u2014/g, ', ').replace(/\\u2013/g, '-');
  next = next.replace(/\s*—+\s*/g, ', ');
  next = next.replace(/\s+–\s+/g, ', ');
  next = next.replace(/–/g, '-');
  next = next.replace(/\s+,/g, ',');
  next = next.replace(/,\s{2,}/g, ', ');
  next = next.replace(/^\s*,\s*/, '');
  next = next.replace(/([.!?]\s+),\s*/g, '$1');
  return next;
}

function trimAtSentenceBoundary(text: string, limit = 1800): string {
  const compact = text.trim();
  if (compact.length <= limit) return compact;
  const slice = compact.slice(0, limit);
  const boundary = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('\n'),
  );
  if (boundary >= Math.floor(limit * 0.55)) return slice.slice(0, boundary + 1).trim();
  return `${slice.replace(/\s+\S*$/, '').trim()}...`;
}

export function sanitizeDiscordContent(content: string): string {
  let next = String(content ?? '');
  next = next.replace(/<\|[^|>]+?\|>/g, '');
  next = stripXmlToolBlocks(next);
  next = stripInternalFailureText(next);
  next = next.replace(
    /```(?:json|xml|tool|tools?|function|function_call|tool_code)?\s*[\s\S]*?(?:"tool_call"|"tool_use"|"function_call"|"recipient_name"|"exec_command"|"pearl-task-dispatch"|"pearl-swarm-dispatch"|<(?:exec|read)\b)[\s\S]*?```/gi,
    '',
  );
  next = stripInlineJsonToolObjects(next);
  next = next.replace(/\{\s*"sessions?"\s*:\s*\[[\s\S]*?\]\s*\}/gi, '');
  next = next.replace(/^\s*(?:\*\*)?(?:Step\s+\d+\s*:\s*)?(?:Check|Run|Execute)\b[^\n]*(?:\*\*)?\s*\n\s*```(?:bash|sh|shell|zsh)?\s*[\s\S]*?```\s*/gim, '');
  next = next.replace(/^\s*(?:exec|tool|tool_call|tool_use|function_call|recipient_name)\b[^\n]*(?:\n|$)/gim, '');
  next = normalizePearlPrefix(next);
  next = next.replace(/(I hit a worker permissions problem before the task could finish cleanly\.)\s*\n\s*/g, '$1 ');
  next = normalizeStylePunctuation(next);
  next = next.replace(/\n{3,}/g, '\n\n').trim();
  return trimAtSentenceBoundary(next);
}
