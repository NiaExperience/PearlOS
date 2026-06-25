const UNSCHEDULED_REMINDER_NOTE =
  'Note: I did not schedule a reminder in this turn, so this will not trigger automatically.';

const XML_TOOL_BLOCK_TAGS = [
  'read',
  'write',
  'edit',
  'grep',
  'glob',
  'ls',
  'bash',
  'command',
  'description',
  'exec',
  'function',
  'function_call',
  'tool',
  'tools',
  'tool_call',
  'tool_use',
  'tool_result',
  'memory_search',
  'memory_update'
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripXmlToolBlocks(text) {
  let value = text;
  value = value.replace(/(?:^|\n)\s*<exec\b[^\n]*(?:\n|$)/gi, '\n');
  for (const tag of XML_TOOL_BLOCK_TAGS) {
    const escaped = escapeRegex(tag);
    value = value.replace(new RegExp(`<${escaped}\\b[^>]*\\/\\s*>`, 'gi'), '');
    value = value.replace(new RegExp(`<${escaped}\\b[^>]*>[\\s\\S]*?(?:<\\/${escaped}>|$)`, 'gi'), '');
    value = value.replace(new RegExp(`<\\/${escaped}\\s*>`, 'gi'), '');
  }
  value = value.replace(/<((?:tool|function|memory|exec)[\w:-]*)\b[^>]*\/\s*>/gi, '');
  value = value.replace(/<((?:tool|function|memory|exec)[\w:-]*)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, '');
  value = value.replace(/<\/(?:tool|function|memory|exec)[\w:-]*\s*>/gi, '');
  value = value.replace(/<file\b[^>]*>[\s\S]*?<\/file>/gi, '');
  value = value.replace(/^\s*<file\b[^\n]*(?:\n|$)/gim, '');
  value = value.replace(/^\s*<path>\s*(?:\/(?:workspace|home|opt|root|tmp|var)\/[^<]+|[A-Za-z]:\\[^<]+)\s*<\/path>\s*$/gim, '');
  value = value.replace(/<\/?(?:sessions?|session)\b[^>]*\/?\s*>/gi, '');
  return value;
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const LONG_HEX_RE = /\b[a-f0-9]{32,64}\b/gi;
const PREFIXED_INTERNAL_ID_RE = /\b(?:disp|dispatch|run|task|session)-[a-z0-9][a-z0-9_.:-]{7,}\b/gi;
const LABELED_TASK_ID_RE =
  /\b(?:task|run|dispatch|disp|session)[\s_-]*(?:id|hash)?\s*[:=#]\s*(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9][a-z0-9_.:-]{7,})\b/gi;
const LABELED_HASH_RE = /\b(?:hash|sha|commit)\s*(?:id\s*)?[:=#]?\s*[a-f0-9]{7,64}\b/gi;

function stripInternalIdentifiers(text) {
  let value = String(text ?? '');
  value = value.replace(
    new RegExp(`^\\s*(?:${LABELED_TASK_ID_RE.source}|${LABELED_HASH_RE.source})\\s*[.;,]*\\s*$`, 'gim'),
    ''
  );
  value = value.replace(LABELED_TASK_ID_RE, 'this task');
  value = value.replace(LABELED_HASH_RE, 'internal reference');
  value = value.replace(PREFIXED_INTERNAL_ID_RE, 'this task');
  value = value.replace(UUID_RE, 'internal reference');
  value = value.replace(LONG_HEX_RE, 'internal reference');
  return value;
}

function stripInternalFailureText(text) {
  let value = text;
  value = stripInternalIdentifiers(value);
  value = value.replace(/^\s*(?:LLM request failed|provider rejected|rawError=|PROXY\s+\d{3}:).*(?:\n|$)/gim, '');
  value = value.replace(
    /^(?!.*\b(?:workspace-write|danger-full-access|approval policy|permission mode|sandbox_permissions|require_escalated)\b)\s*(?:sandbox|connector|tool|executor|codex|claude)\b.*\b(?:failed|error|rejected|permission|denied|unavailable|not configured)\b.*(?:\n|$)/gim,
    ''
  );
  value = value.replace(
    /\bsandbox\b[^\n.!?]*\b(?:workspace-write|danger-full-access|approval policy|permission mode|sandbox_permissions|require_escalated)\b[^.!?\n]*(?:[.!?]|\n|$)/gi,
    'I hit a worker permissions problem before the task could finish cleanly. '
  );
  return value;
}

function stripInlineJsonToolObjects(text) {
  let value = String(text ?? '');
  const markers = [
    '"tool_call"',
    '"tool_calls"',
    '"function_call"',
    '"recipient_name"',
    '"exec_command"',
    '"parameters"',
    '"arguments"'
  ];
  let index = 0;
  while (index < value.length) {
    const markerIndex = markers.reduce((best, marker) => {
      const found = value.indexOf(marker, index);
      return found >= 0 && (best < 0 || found < best) ? found : best;
    }, -1);
    if (markerIndex < 0) break;
    const start = value.lastIndexOf('{', markerIndex);
    if (start < 0) {
      index = markerIndex + 1;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let pos = start; pos < value.length; pos += 1) {
      const char = value[pos];
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
      value = value.slice(0, start).trimEnd();
      break;
    }
    const raw = value.slice(start, end);
    if (!/(tool_calls?|function_call|recipient_name|exec_command|pearl-task-dispatch|pearl-swarm-dispatch|memory_search|web_search|exec_command)/i.test(raw)) {
      index = markerIndex + 1;
      continue;
    }
    value = `${value.slice(0, start)}${value.slice(end)}`;
    index = start;
  }
  return value;
}

function normalizePearlPrefix(text) {
  let value = text.replace(/(?:^|\n)\s*(?:Pearl(?:'s Agency)? says:\s*){2,}/gi, "Pearl's Agency says: ");
  value = value.replace(/^\s*Pearl's Agency says:\s*Pearl(?:'s Agency)? says:\s*/i, "Pearl's Agency says: ");
  return value;
}

function normalizeStylePunctuation(text) {
  let value = text;
  value = value.replace(/\\u2014/g, ', ').replace(/\\u2013/g, '-');
  value = value.replace(/\s*—+\s*/g, ', ');
  value = value.replace(/\s+–\s+/g, ', ');
  value = value.replace(/–/g, '-');
  value = value.replace(/\s+,/g, ',');
  value = value.replace(/,\s{2,}/g, ', ');
  value = value.replace(/^\s*,\s*/, '');
  value = value.replace(/([.!?]\s+),\s*/g, '$1');
  return value;
}

const CANNED_PROGRESS_LINE_RE =
  /^(?:Still working on it\.?|I['’]m checking the actual state before I say more\.?|Working through\b.*only post again\b.*)$/i;
const CANNED_PROGRESS_PREFIX_RE =
  /^\s*(?:Still working on it|I['’]m checking the actual state before I say more)\s*[.!?]*\s*/i;

function stripCannedProgressFallback(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || CANNED_PROGRESS_LINE_RE.test(trimmed)) return '';
      return line.replace(CANNED_PROGRESS_PREFIX_RE, '');
    })
    .filter((line) => line.trim())
    .join('\n');
}

function trimAtSentenceBoundary(text, limit = 1800) {
  const value = String(text ?? '').trim();
  if (value.length <= limit) return value;
  const slice = value.slice(0, limit);
  const cut = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '), slice.lastIndexOf('\n'));
  if (cut >= Math.floor(limit * 0.55)) return slice.slice(0, cut + 1).trim();
  return `${slice.replace(/\s+\S*$/, '').trim()}...`;
}

function shellWords(command) {
  const words = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (const char of String(command ?? '')) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = '';
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) words.push(current);
  return words;
}

const PEARL_TASK_DISPATCH_TOOL_NAMES = new Set([
  'bot_openclaw_task',
  'dispatch_task',
  'pearl-task-dispatch',
  'pearl_task_dispatch'
]);

const PEARL_TASK_DISPATCH_VALUE_FLAGS = new Set([
  '--assignee',
  '--created-by',
  '--requester-email',
  '--requester-tenant-id',
  '--requester-user-id',
  '--source',
  '--tenant',
  '--tenant-id',
  '--title',
  '--urgency'
]);

function normalizeTaskDispatchToolName(value) {
  return String(value ?? '').trim().split(/[./]/).pop().toLowerCase();
}

function isPearlTaskDispatchToolName(value) {
  return PEARL_TASK_DISPATCH_TOOL_NAMES.has(normalizeTaskDispatchToolName(value));
}

function allowedPearlTaskDispatchCommand(rawCommand) {
  const words = shellWords(rawCommand);
  if (words.length < 2) return null;
  const binary = words[0].replace(/\\/g, '/');
  if (!/(?:^|\/)pearl-task-dispatch$/.test(binary)) return null;
  const positionals = [];
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (!word) continue;
    if (word.startsWith('--')) {
      const flag = word.includes('=') ? word.slice(0, word.indexOf('=')) : word;
      if (!word.includes('=') && PEARL_TASK_DISPATCH_VALUE_FLAGS.has(flag)) index += 1;
      continue;
    }
    if (word.startsWith('-')) continue;
    positionals.push(word);
  }
  const taskArg = positionals.join(' ').trim();
  return taskArg.length >= 10 ? taskArg : null;
}

function parseJsonMaybe(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function extractTaskTextFromDispatchArgs(args) {
  const value = parseJsonMaybe(args);
  if (typeof value === 'string') {
    const commandTask = /\bpearl-task-dispatch\b/.test(value) ? allowedPearlTaskDispatchCommand(value) : null;
    const text = commandTask || value.trim();
    return text.length >= 10 ? text : null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const taskText = extractTaskTextFromDispatchArgs(entry);
      if (taskText) return taskText;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  for (const key of ['command', 'cmd', 'shell', 'bash']) {
    const commandTask = allowedPearlTaskDispatchCommand(value[key]);
    if (commandTask) return commandTask;
  }

  for (const key of ['task', 'task_text', 'taskText', 'description', 'prompt', 'request', 'body', 'text', 'title']) {
    const candidate = typeof value[key] === 'string' ? value[key].trim() : '';
    if (candidate.length >= 10) return candidate;
  }

  return null;
}

function extractTaskTextFromJsonToolObject(value) {
  const parsed = parseJsonMaybe(value);
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const taskText = extractTaskTextFromJsonToolObject(entry);
      if (taskText) return taskText;
    }
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const functionShape = parsed.function || parsed.tool || parsed.tool_call || parsed.call;
  if (functionShape && typeof functionShape === 'object') {
    const taskText = extractTaskTextFromJsonToolObject(functionShape);
    if (taskText) return taskText;
  }

  const directName = parsed.name || parsed.tool_name || parsed.toolName || parsed.recipient_name || parsed.recipientName;
  if (isPearlTaskDispatchToolName(directName)) {
    return extractTaskTextFromDispatchArgs(
      parsed.arguments ?? parsed.args ?? parsed.parameters ?? parsed.input ?? parsed
    );
  }

  for (const key of ['arguments', 'args', 'parameters', 'input']) {
    const taskText = extractTaskTextFromDispatchArgs(parsed[key]);
    if (taskText) return taskText;
  }

  for (const key of ['tool_calls', 'toolCalls', 'function_calls', 'functionCalls', 'calls', 'steps']) {
    const taskText = extractTaskTextFromJsonToolObject(parsed[key]);
    if (taskText) return taskText;
  }

  const commandTask = extractTaskTextFromDispatchArgs({
    command: parsed.command ?? parsed.cmd
  });
  if (commandTask) return commandTask;

  return null;
}

function balancedJsonSlices(text) {
  const value = String(text ?? '');
  const slices = [];
  for (let index = 0; index < value.length; index += 1) {
    const open = value[index];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    const stack = [close];
    let inString = false;
    let escaped = false;
    for (let pos = index + 1; pos < value.length; pos += 1) {
      const char = value[pos];
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
      if (char === '{') stack.push('}');
      if (char === '[') stack.push(']');
      if (char === '}' || char === ']') {
        if (char !== stack[stack.length - 1]) break;
        stack.pop();
        if (stack.length === 0) {
          slices.push(value.slice(index, pos + 1));
          index = pos;
          break;
        }
      }
    }
  }
  return slices;
}

function extractJsonPearlTaskDispatchText(text) {
  const markerRe = /\b(?:bot_openclaw_task|dispatch_task|pearl[-_]task[-_]dispatch)\b/i;
  for (const rawJson of balancedJsonSlices(text)) {
    if (!markerRe.test(rawJson)) continue;
    const taskText = extractTaskTextFromJsonToolObject(rawJson);
    if (taskText) return taskText;
  }
  return null;
}

function extractXmlPearlTaskDispatchText(text) {
  const value = String(text ?? '');
  const invokeRe = /<invoke\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/invoke>/gi;
  for (const match of value.matchAll(invokeRe)) {
    if (!isPearlTaskDispatchToolName(match[1])) continue;
    const body = match[2] || '';
    for (const field of ['task', 'task_text', 'description', 'prompt', 'request', 'body', 'text']) {
      const fieldRe = new RegExp(`<parameter\\b[^>]*\\bname=["']${field}["'][^>]*>([\\s\\S]*?)<\\/parameter>`, 'i');
      const fieldMatch = body.match(fieldRe);
      const taskText = fieldMatch?.[1]?.trim();
      if (taskText && taskText.length >= 10) return taskText;
    }
  }

  const namedToolRe = /<(?:tool|tool_call|function|function_call)\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:tool|tool_call|function|function_call)>/gi;
  for (const match of value.matchAll(namedToolRe)) {
    if (!isPearlTaskDispatchToolName(match[1])) continue;
    const taskText = extractTaskTextFromDispatchArgs(match[2]);
    if (taskText) return taskText;
  }

  return null;
}

export function extractPearlTaskDispatchText(text) {
  const value = String(text ?? '');
  const jsonTask = extractJsonPearlTaskDispatchText(value);
  if (jsonTask) return jsonTask;
  const xmlTask = extractXmlPearlTaskDispatchText(value);
  if (xmlTask) return xmlTask;
  const commandBlocks = [
    ...value.matchAll(/<command\b[^>]*>([\s\S]*?)<\/command>/gi),
    ...value.matchAll(/```(?:bash|sh|shell|zsh|xml)?\s*([\s\S]*?pearl-task-dispatch[\s\S]*?)```/gi)
  ];
  for (const match of commandBlocks) {
    const taskText = allowedPearlTaskDispatchCommand(match[1]);
    if (taskText) return taskText;
  }
  for (const line of value.split(/\r?\n/)) {
    if (!/\bpearl-task-dispatch\b/.test(line)) continue;
    const taskText = allowedPearlTaskDispatchCommand(line.trim());
    if (taskText) return taskText;
  }
  return null;
}

export function sanitizePublicDiscordOutboundText(text) {
  let value = String(text ?? '');
  const trimmed = value.trim();

  if (/^(?:LLM request failed|provider rejected)\b/i.test(trimmed)) return '';
  if (/^NO_REPLY$/i.test(trimmed)) return '';

  value = stripCannedProgressFallback(value);
  value = value.replaceAll(UNSCHEDULED_REMINDER_NOTE, '');
  value = stripXmlToolBlocks(value);
  value = stripInternalFailureText(value);
  value = stripInlineJsonToolObjects(value);
  value = value.replace(/^\s*memory_search\b[^\n]*\bquery\s*=.*(?:\n|$)/gim, '');
  value = value.replace(/^\s*memory_search\b[^\n]*(?:\n|$)/gim, '');
  value = value.replace(/^\s*(?:memory_get|web_fetch|web_search|dispatch_task|sessions_spawn|exec)\b[^\n]*(?:\n|$)/gim, '');
  value = value.replace(/^\s*(?:LLM request failed|provider rejected)\b.*(?:\n|$)/gim, '');
  value = value.replace(/^\s*(?:rawError=|PROXY\s+\d{3}:).*(?:\n|$)/gim, '');
  value = value.replace(/```(?:json|xml|tool|tools?|function|function_call|tool_code)?\s*[\s\S]*?(?:"tool_call"|"tool_use"|"function_call"|"recipient_name"|"exec_command"|"pearl-task-dispatch"|"pearl-swarm-dispatch"|<(?:exec|read|command)\b)[\s\S]*?```/gi, '');
  value = value.replace(/\{\s*"(?:(?:tool|function)_calls?|name|recipient_name)"\s*:\s*[^{}]*(?:memory_search|memory_get|web_fetch|web_search|dispatch_task|exec|exec_command|pearl-task-dispatch|pearl-swarm-dispatch)[\s\S]*?\}/gi, '');
  value = value.replace(/\{\s*"sessions?"\s*:\s*\[[\s\S]*?\]\s*\}/gi, '');
  value = value.replace(/^\s*(?:\*\*)?(?:Step\s+\d+\s*:\s*)?(?:Check|Run|Execute)\b[^\n]*(?:\*\*)?\s*\n\s*```(?:bash|sh|shell|zsh)?\s*[\s\S]*?```\s*/gim, '');
  value = value.replace(/```(?:json|xml|tool|function)?\s*```/gi, '');
  value = value.replace(/^\s*<exec\b[^>]*\/?>\s*$/gim, '');
  value = value.replace(/^\s*NO_REPLY\s*$/gim, '');
  value = normalizePearlPrefix(value);
  value = normalizeStylePunctuation(value);
  value = value.replace(/\n{3,}/g, '\n\n').trim();

  return trimAtSentenceBoundary(value);
}

export function sanitizePublicDiscordEmbed(embed) {
  if (!embed || typeof embed !== 'object') return embed;
  const next = { ...embed };
  if (typeof next.title === 'string') next.title = sanitizePublicDiscordOutboundText(next.title);
  if (typeof next.description === 'string') next.description = sanitizePublicDiscordOutboundText(next.description);
  if (typeof next.footer?.text === 'string') next.footer = {
    ...next.footer,
    text: sanitizePublicDiscordOutboundText(next.footer.text)
  };
  if (Array.isArray(next.fields)) {
    next.fields = next.fields.map((field) => {
      if (!field || typeof field !== 'object') return field;
      return {
        ...field,
        name: typeof field.name === 'string' ? sanitizePublicDiscordOutboundText(field.name) : field.name,
        value: typeof field.value === 'string' ? sanitizePublicDiscordOutboundText(field.value) : field.value
      };
    }).filter((field) => {
      if (!field || typeof field !== 'object') return true;
      return String(field.name ?? '').trim() || String(field.value ?? '').trim();
    });
  }
  return next;
}
