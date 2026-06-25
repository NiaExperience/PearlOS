const TARGET_BASENAME = '/bot-ChnpnNXN.js';
const DISCORD_SEND_SHARED_BASENAME_RE = /\/send\.shared-[^/]+\.js$/;
const DISCORD_SEND_HASH_BASENAME_RE = /\/send-[^/]+\.js$/;
const DISCORD_CORE_BASENAME_RE = /\/extensions\/discord\/discord-[^/]+\.js$/;
const DISCORD_PROVIDER_BASENAME_RE = /\/extensions\/discord\/provider-[^/]+\.js$/;
const DISCORD_INBOUND_PI_EMBEDDED_RE = /\/pi-embedded-[^/]+\.js$/;
const DISCORD_INBOUND_MESSAGE_HANDLER_RE = /\/extensions\/discord\/message-handler\.process-[^/]+\.js$/;
const DISCORD_INBOUND_LEGACY_MESSAGE_HANDLER_RE = /\/message-handler-[^/]+\.js$/;
const OPENCLAW_PLUGIN_REGISTRY_BUNDLE_RE = /\/(?:gateway-cli|pi-embedded|reply)-[^/]+\.js$/;
const MEMORY_CORE_INDEX_RE = /\/(?:dist|dist-runtime)\/extensions\/memory-core\/index\.js(?:\?.*)?$/;

const HELPER = `
const pearlOsTelegramDmContextCache = new Map();

async function pearlOsTelegramDmPreAllowlistVerification(params) {
  const secret = (process.env.TELEGRAM_DM_LINK_SECRET || process.env.MESH_SHARED_SECRET || "").trim();
  if (!secret) return false;
  const baseUrl = (process.env.PEARLOS_BASE_URL || "http://127.0.0.1:3000").replace(/\\/+$/, "");
  const text = String(params.msg?.text || params.msg?.caption || "").trim();
  if (!/\\b[A-Z0-9]{6}\\b/i.test(text)) return false;
  const telegramUserId = String(params.sender?.userId || params.sender?.candidateId || "").trim();
  const telegramChatId = String(params.chatId || telegramUserId).trim();
  if (!/^\\d{5,}$/.test(telegramUserId) || !/^-?\\d{5,}$/.test(telegramChatId)) return false;
  try {
    const response = await fetch(baseUrl + "/api/telegram/dm-link/consume-code", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": secret
      },
      body: JSON.stringify({
        text,
        telegramUserId,
        telegramChatId,
        telegramUsername: params.sender?.username || undefined
      })
    });
    if (!response.ok) return false;
    const body = await response.json().catch(() => ({}));
    if (!body || body.verified !== true) return false;
    const message = typeof body.responseMessage === "string" && body.responseMessage.trim()
      ? body.responseMessage.trim()
      : "Telegram linked. You can talk to Pearl here now.";
    await params.bot.api.sendMessage(params.chatId, message).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function pearlOsTelegramDmIdentityContext(params) {
  const secret = (process.env.TELEGRAM_DM_LINK_SECRET || process.env.MESH_SHARED_SECRET || "").trim();
  if (!secret) return "";
  const telegramUserId = String(params.senderId || "").trim();
  if (!/^\\d{5,}$/.test(telegramUserId)) return "";
  const cached = pearlOsTelegramDmContextCache.get(telegramUserId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  const baseUrl = (process.env.PEARLOS_BASE_URL || "http://127.0.0.1:3000").replace(/\\/+$/, "");
  try {
    const response = await fetch(baseUrl + "/api/telegram/dm-link/context?telegramUserId=" + encodeURIComponent(telegramUserId), {
      headers: { "x-internal-secret": secret }
    });
    if (!response.ok) return "";
    const body = await response.json().catch(() => ({}));
    if (!body || body.linked !== true || typeof body.context !== "string" || !body.context.trim()) return "";
    const nameLine = body.userName ? "Verified PearlOS user: " + body.userName + "\\n" : "";
    const value = [
      "[Trusted PearlOS identity context for this verified Telegram sender]",
      nameLine + body.context.trim(),
      "[/Trusted PearlOS identity context]"
    ].join("\\n");
    pearlOsTelegramDmContextCache.set(telegramUserId, { value, expiresAt: now + 60000 });
    return value;
  } catch {
    return "";
  }
}
`;

const INSERT_AFTER = `function resolveTelegramSenderIdentity(msg, chatId) {
\tconst from = msg.from;
\tconst userId = from?.id != null ? String(from.id) : null;
\treturn {
\t\tusername: from?.username ?? "",
\t\tuserId,
\t\tcandidateId: userId ?? String(chatId),
\t\tfirstName: from?.first_name,
\t\tlastName: from?.last_name
\t};
}`;

const REPLACE_BLOCK = `\tlogVerbose(\`Blocked unauthorized telegram sender \${sender.candidateId} (dmPolicy=\${dmPolicy}, \${allowMatchMeta})\`);
\treturn false;`;

const PATCHED_BLOCK = `\tif (await pearlOsTelegramDmPreAllowlistVerification({ msg, chatId, sender, bot })) return false;
\tlogVerbose(\`Blocked unauthorized telegram sender \${sender.candidateId} (dmPolicy=\${dmPolicy}, \${allowMatchMeta})\`);
\treturn false;`;

const CONTEXT_REPLACE_BLOCK = `\tlet bodyText = rawBody;
\tif (allMedia.length === 0 && placeholder && rawBody !== placeholder) bodyText = \`\${primaryMedia?.fileRef.file_id ? \`\${placeholder} [file_id:\${primaryMedia.fileRef.file_id}]\` : placeholder}\\n\${bodyText}\`.trim();`;

const CONTEXT_PATCHED_BLOCK = `\tlet bodyText = rawBody;
\tif (allMedia.length === 0 && placeholder && rawBody !== placeholder) bodyText = \`\${primaryMedia?.fileRef.file_id ? \`\${placeholder} [file_id:\${primaryMedia.fileRef.file_id}]\` : placeholder}\\n\${bodyText}\`.trim();
\tif (!isGroup && senderId) {
\t\tconst pearlOsIdentityContext = await pearlOsTelegramDmIdentityContext({ senderId });
\t\tif (pearlOsIdentityContext) bodyText = \`\${pearlOsIdentityContext}\\n\\nUser message:\\n\${bodyText}\`.trim();
\t}`;

const DISCORD_SANITIZER_HELPER = `
const PEARLOS_UNSCHEDULED_REMINDER_NOTE_RE = /\\n*\\s*Note:\\s*I did not schedule a reminder in this turn, so this will not trigger automatically\\.\\s*/gi;
const PEARLOS_FUNCTION_BLOCK_RE = /<function\\b[^>]*>[\\s\\S]*?<\\/function>/gi;
const PEARLOS_RAW_XML_TOOL_LINE_RE = /^\\s*<exec\\b[^\\n]*(?:\\n|$)/gim;
const PEARLOS_TOOL_XML_SELF_CLOSING_RE = /<\\/?(?:exec|file|session|sessions|tool|tool_call|tool_use|tool_result|function|function_call|function_result|description)\\b[^>]*\\/\\s*>/gi;
const PEARLOS_TOOL_XML_BLOCK_RE = /<\\/?(?:exec|file|session|sessions|tool|tool_call|tool_use|tool_result|function|function_call|function_result|description)\\b[^>]*>[\\s\\S]*?(?:<\\/(?:exec|file|session|sessions|tool|tool_call|tool_use|tool_result|function|function_call|function_result|description)>|$)/gi;
const PEARLOS_ORPHAN_TOOL_CLOSE_RE = /<\\/(?:exec|file|session|sessions|tool|tool_call|tool_use|tool_result|function|function_call|function_result|description)\\s*>/gi;
const PEARLOS_RAW_TOOL_LINE_RE = /^\\s*(?:memory_search|memory_get|web_fetch|web_search|dispatch_task|sessions_spawn|exec|tool|tool_call|function_call|recipient_name)\\b[^\\n]*(?:\\n|$)/gim;
const PEARLOS_PROVIDER_ERROR_RE = /^\\s*(?:LLM request failed|provider rejected the request schema or tool payload|rawError=|PROXY\\s+\\d{3}:)[^\\n]*(?:\\n|$)/gim;
const PEARLOS_JSON_TOOL_RE = /\\{\\s*"(?:(?:tool|function)_calls?|name|recipient_name)"\\s*:\\s*[^{}]*(?:memory_search|memory_get|web_fetch|web_search|dispatch_task|exec|exec_command|pearl-task-dispatch|pearl-swarm-dispatch)[\\s\\S]*?\\}/gi;
const PEARLOS_STANDALONE_SILENT_RE = /^\\s*(?:NO_REPLY|HEARTBEAT_OK)\\s*$/i;
const PEARLOS_EMPTY_PREFACE_RE = /^(?:let me check(?: what I have)?\\.?|checking(?: what I have)?\\.?|sure,?\\s*(?:let me )?(?:check|look)\\.?|i(?:'|’)ll (?:check|look)(?: what I have)?\\.?)\\s*$/i;
const PEARLOS_CANNED_PROGRESS_LINE_RE = /^(?:Still working on it\\.?|I['’]m checking the actual state before I say more\\.?|Working through\\b.*only post again\\b.*)$/i;
const PEARLOS_CANNED_PROGRESS_PREFIX_RE = /^\\s*(?:Still working on it|I['’]m checking the actual state before I say more)\\s*[.!?]*\\s*/i;
const PEARLOS_INTERNAL_UUID_RE = /\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b/gi;
const PEARLOS_LONG_HEX_RE = /\\b[a-f0-9]{32,64}\\b/gi;
const PEARLOS_PREFIXED_INTERNAL_ID_RE = /\\b(?:disp|dispatch|run|task|session)-[a-z0-9][a-z0-9_.:-]{7,}\\b/gi;
const PEARLOS_LABELED_TASK_ID_RE = /\\b(?:task|run|dispatch|disp|session)[\\s_-]*(?:id|hash)?\\s*[:=#]\\s*(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9][a-z0-9_.:-]{7,})\\b/gi;
const PEARLOS_LABELED_HASH_RE = /\\b(?:hash|sha|commit)\\s*(?:id\\s*)?[:=#]?\\s*[a-f0-9]{7,64}\\b/gi;
const PEARLOS_STANDALONE_INTERNAL_ID_RE = /^\\s*(?:(?:task|run|dispatch|disp|session)[\\s_-]*(?:id|hash)?\\s*[:=#]\\s*(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9][a-z0-9_.:-]{7,})|(?:hash|sha|commit)\\s*(?:id\\s*)?[:=#]?\\s*[a-f0-9]{7,64})\\s*[.;,]*\\s*$/gim;
const PEARLOS_RAW_SEARCH_DUMP_RE = /\\b(?:Top sources|search results?|URL\\s*:|Summary\\s*:|Snippet\\s*:|Result\\s+\\d+\\s*:)\\b/i;

function pearlOsStripInlineJsonToolObjects(value) {
\tlet text = String(value ?? "");
\tconst markers = ["\\"tool_call\\"", "\\"tool_calls\\"", "\\"function_call\\"", "\\"recipient_name\\"", "\\"exec_command\\"", "\\"parameters\\"", "\\"arguments\\""];
\tlet index = 0;
\twhile (index < text.length) {
\t\tconst markerIndex = markers.reduce((best, marker) => {
\t\t\tconst found = text.indexOf(marker, index);
\t\t\treturn found >= 0 && (best < 0 || found < best) ? found : best;
\t\t}, -1);
\t\tif (markerIndex < 0) break;
\t\tconst start = text.lastIndexOf("{", markerIndex);
\t\tif (start < 0) {
\t\t\tindex = markerIndex + 1;
\t\t\tcontinue;
\t\t}
\t\tlet depth = 0;
\t\tlet inString = false;
\t\tlet escaped = false;
\t\tlet end = -1;
\t\tfor (let pos = start; pos < text.length; pos += 1) {
\t\t\tconst char = text[pos];
\t\t\tif (escaped) {
\t\t\t\tescaped = false;
\t\t\t\tcontinue;
\t\t\t}
\t\t\tif (char === "\\\\") {
\t\t\t\tescaped = true;
\t\t\t\tcontinue;
\t\t\t}
\t\t\tif (char === "\\"") {
\t\t\t\tinString = !inString;
\t\t\t\tcontinue;
\t\t\t}
\t\t\tif (inString) continue;
\t\t\tif (char === "{") depth += 1;
\t\t\tif (char === "}") {
\t\t\t\tdepth -= 1;
\t\t\t\tif (depth === 0) {
\t\t\t\t\tend = pos + 1;
\t\t\t\t\tbreak;
\t\t\t\t}
\t\t\t}
\t\t}
\t\tif (end < 0) {
\t\t\ttext = text.slice(0, start).trimEnd();
\t\t\tbreak;
\t\t}
\t\tconst raw = text.slice(start, end);
\t\tif (!/(tool_calls?|function_call|recipient_name|exec_command|pearl-task-dispatch|pearl-swarm-dispatch|memory_search|web_search|exec_command)/i.test(raw)) {
\t\t\tindex = markerIndex + 1;
\t\t\tcontinue;
\t\t}
\t\ttext = text.slice(0, start) + text.slice(end);
\t\tindex = start;
\t}
\treturn text;
}

function pearlOsStripCannedProgressText(value) {
\treturn String(value ?? "")
\t\t.split(/\\r?\\n/)
\t\t.map((line) => {
\t\t\tconst trimmed = line.trim();
\t\t\tif (!trimmed || PEARLOS_CANNED_PROGRESS_LINE_RE.test(trimmed)) return "";
\t\t\treturn line.replace(PEARLOS_CANNED_PROGRESS_PREFIX_RE, "");
\t\t})
\t\t.filter((line) => line.trim())
\t\t.join("\\n");
}

function pearlOsSanitizeInternalIds(value) {
\tlet text = String(value ?? "");
\ttext = text.replace(PEARLOS_STANDALONE_INTERNAL_ID_RE, "");
\ttext = text.replace(PEARLOS_LABELED_TASK_ID_RE, "this task");
\ttext = text.replace(PEARLOS_LABELED_HASH_RE, "internal reference");
\ttext = text.replace(PEARLOS_PREFIXED_INTERNAL_ID_RE, "this task");
\ttext = text.replace(PEARLOS_INTERNAL_UUID_RE, "internal reference");
\ttext = text.replace(PEARLOS_LONG_HEX_RE, "internal reference");
\treturn text;
}

function pearlOsNormalizeStylePunctuation(value) {
\tlet text = String(value ?? "");
\ttext = text.replace(/\\\\u2014/g, ", ").replace(/\\\\u2013/g, "-");
\ttext = text.replace(/\\s*—+\\s*/g, ", ");
\ttext = text.replace(/\\s+–\\s+/g, ", ");
\ttext = text.replace(/–/g, "-");
\ttext = text.replace(/\\s+,/g, ",");
\ttext = text.replace(/,\\s{2,}/g, ", ");
\ttext = text.replace(/^\\s*,\\s*/, "");
\ttext = text.replace(/([.!?]\\s+),\\s*/g, "$1");
\treturn text;
}

function pearlOsSanitizeDiscordOutboundText(value) {
\tif (typeof value !== "string" || !value) return value;
\tlet text = pearlOsStripCannedProgressText(value);
\ttext = text.replace(PEARLOS_FUNCTION_BLOCK_RE, "");
\ttext = text.replace(PEARLOS_RAW_XML_TOOL_LINE_RE, "");
\ttext = text.replace(PEARLOS_TOOL_XML_SELF_CLOSING_RE, "");
\ttext = text.replace(PEARLOS_TOOL_XML_BLOCK_RE, "");
\ttext = text.replace(PEARLOS_ORPHAN_TOOL_CLOSE_RE, "");
\ttext = pearlOsStripInlineJsonToolObjects(text);
\ttext = text.replace(PEARLOS_JSON_TOOL_RE, "");
\ttext = text.replace(PEARLOS_RAW_TOOL_LINE_RE, "");
\ttext = text.replace(PEARLOS_UNSCHEDULED_REMINDER_NOTE_RE, "");
\ttext = text.replace(PEARLOS_PROVIDER_ERROR_RE, "");
\ttext = pearlOsSanitizeInternalIds(text);
\tif (PEARLOS_RAW_SEARCH_DUMP_RE.test(text)) return "";
\ttext = text.replace(new RegExp("\\\\\`\\\\\`\\\\\`(?:json|xml|tool|tools?|function|function_call|tool_code)?\\\\s*[\\\\s\\\\S]*?(?:\\\"tool_call\\\"|\\\"tool_use\\\"|\\\"function_call\\\"|\\\"recipient_name\\\"|\\\"exec_command\\\"|\\\"pearl-task-dispatch\\\"|\\\"pearl-swarm-dispatch\\\"|<exec\\\\b)[\\\\s\\\\S]*?\\\\\`\\\\\`\\\\\`", "gi"), "");
\ttext = text.replace(new RegExp("\\\\\`\\\\\`\\\\\`(?:json|xml|tool|function)?\\\\s*\\\\\`\\\\\`\\\\\`", "gi"), "");
\ttext = pearlOsNormalizeStylePunctuation(text);
\ttext = text.replace(/\\n{3,}/g, "\\n\\n").trim();
\tif (!text || PEARLOS_STANDALONE_SILENT_RE.test(text) || PEARLOS_EMPTY_PREFACE_RE.test(text)) return "";
\treturn text;
}
`;

const DISCORD_HELPER_INSERT_AFTER = `function stripUndefinedFields(value) {
\treturn Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== void 0));
}`;

const DISCORD_TEXT_REPLACE_BLOCKS = [
`async function sendDiscordText(rest, channelId, text, replyTo, request, maxLinesPerMessage, components, embeds, chunkMode, silent, maxChars) {
\tif (!text.trim()) throw new Error("Message must be non-empty for Discord sends");`,
`async function sendDiscordText(rest, channelId, text, replyTo, request, maxLinesPerMessage, components, embeds, chunkMode, silent) {
\tif (!text.trim()) throw new Error("Message must be non-empty for Discord sends");`,
`async function sendDiscordText(rest, channelId, text, replyTo, request, maxLinesPerMessage, embeds, chunkMode, silent) {
\tif (!text.trim()) throw new Error("Message must be non-empty for Discord sends");`
];

const DISCORD_TEXT_PATCHED_BLOCKS = [
`async function sendDiscordText(rest, channelId, text, replyTo, request, maxLinesPerMessage, components, embeds, chunkMode, silent, maxChars) {
\ttext = pearlOsSanitizeDiscordOutboundText(text ?? "");
\tif (!text.trim()) return null;`,
`async function sendDiscordText(rest, channelId, text, replyTo, request, maxLinesPerMessage, components, embeds, chunkMode, silent) {
\ttext = pearlOsSanitizeDiscordOutboundText(text ?? "");
\tif (!text.trim()) return null;`,
`async function sendDiscordText(rest, channelId, text, replyTo, request, maxLinesPerMessage, embeds, chunkMode, silent) {
\ttext = pearlOsSanitizeDiscordOutboundText(text ?? "");
\tif (!text.trim()) return null;`
];

const DISCORD_MEDIA_REPLACE_BLOCKS = [
`async function sendDiscordMedia(rest, channelId, text, mediaUrl, filename, mediaLocalRoots, mediaReadFile, maxBytes, replyTo, request, maxLinesPerMessage, components, embeds, chunkMode, silent, maxChars) {
\tconst media = await loadWebMedia(mediaUrl, buildOutboundMediaLoadOptions({`,
`async function sendDiscordMedia(rest, channelId, text, mediaUrl, filename, mediaLocalRoots, mediaReadFile, maxBytes, replyTo, request, maxLinesPerMessage, components, embeds, chunkMode, silent) {
\tconst media = await loadWebMedia(mediaUrl, buildOutboundMediaLoadOptions({`,
`async function sendDiscordMedia(rest, channelId, text, mediaUrl, replyTo, request, maxLinesPerMessage, embeds, chunkMode, silent) {
\tconst media = await loadWebMedia(mediaUrl);`
];

const DISCORD_MEDIA_PATCHED_BLOCKS = [
`async function sendDiscordMedia(rest, channelId, text, mediaUrl, filename, mediaLocalRoots, mediaReadFile, maxBytes, replyTo, request, maxLinesPerMessage, components, embeds, chunkMode, silent, maxChars) {
\ttext = pearlOsSanitizeDiscordOutboundText(text ?? "");
\tconst media = await loadWebMedia(mediaUrl, buildOutboundMediaLoadOptions({`,
`async function sendDiscordMedia(rest, channelId, text, mediaUrl, filename, mediaLocalRoots, mediaReadFile, maxBytes, replyTo, request, maxLinesPerMessage, components, embeds, chunkMode, silent) {
\ttext = pearlOsSanitizeDiscordOutboundText(text ?? "");
\tconst media = await loadWebMedia(mediaUrl, buildOutboundMediaLoadOptions({`,
`async function sendDiscordMedia(rest, channelId, text, mediaUrl, replyTo, request, maxLinesPerMessage, embeds, chunkMode, silent) {
\ttext = pearlOsSanitizeDiscordOutboundText(text ?? "");
\tconst media = await loadWebMedia(mediaUrl);`
];

function patchDiscordOutboundSendSource(source, { strict = false } = {}) {
  if (source.includes('pearlOsSanitizeDiscordOutboundText')) {
    return { source, patched: false };
  }

  let next = source;
  let helperInserted = false;
  if (next.includes(DISCORD_HELPER_INSERT_AFTER)) {
    next = next.replace(DISCORD_HELPER_INSERT_AFTER, `${DISCORD_HELPER_INSERT_AFTER}\n${DISCORD_SANITIZER_HELPER}`);
    helperInserted = true;
  } else {
    next = `${DISCORD_SANITIZER_HELPER}\n${next}`;
    helperInserted = true;
  }

  let textPatched = false;
  for (let index = 0; index < DISCORD_TEXT_REPLACE_BLOCKS.length; index += 1) {
    if (next.includes(DISCORD_TEXT_REPLACE_BLOCKS[index])) {
      next = next.replace(DISCORD_TEXT_REPLACE_BLOCKS[index], DISCORD_TEXT_PATCHED_BLOCKS[index]);
      textPatched = true;
      break;
    }
  }

  let mediaPatched = false;
  for (let index = 0; index < DISCORD_MEDIA_REPLACE_BLOCKS.length; index += 1) {
    if (next.includes(DISCORD_MEDIA_REPLACE_BLOCKS[index])) {
      next = next.replace(DISCORD_MEDIA_REPLACE_BLOCKS[index], DISCORD_MEDIA_PATCHED_BLOCKS[index]);
      mediaPatched = true;
      break;
    }
  }

  if (strict && (!helperInserted || !textPatched || !mediaPatched)) {
    throw new Error('OpenClaw Discord outbound sanitizer patch target not found');
  }
  if (!textPatched && !mediaPatched) {
    return { source, patched: false };
  }
  return { source: next, patched: true };
}

const DISCORD_PAYLOAD_SANITIZER_HELPER = `
function pearlOsSanitizeDiscordPayload(payload) {
\tif (typeof payload === "string") return pearlOsSanitizeDiscordOutboundText(payload ?? "");
\tif (!payload || typeof payload !== "object" || typeof payload.content !== "string") return payload;
\treturn { ...payload, content: pearlOsSanitizeDiscordOutboundText(payload.content) || "" };
}
`;

const DISCORD_CORE_HELPER_INSERT_AFTER = `function clean$2(value) {
\treturn Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== void 0));
}`;

const DISCORD_CORE_PAYLOAD_REPLACE_BLOCK = `function serializePayload(payload) {
\tif (typeof payload === "string") return { content: payload };
\tconst flags = normalizePayloadFlags(payload);
\treturn clean$2({
\t\tcontent: payload.content,`;

const DISCORD_CORE_PAYLOAD_PATCHED_BLOCK = `function serializePayload(payload) {
\tpayload = pearlOsSanitizeDiscordPayload(payload);
\tif (typeof payload === "string") return payload.trim() ? { content: payload } : {};
\tconst flags = normalizePayloadFlags(payload);
\treturn clean$2({
\t\tcontent: typeof payload.content === "string" && !payload.content.trim() ? void 0 : payload.content,`;

function patchDiscordCorePayloadSource(source, { strict = false } = {}) {
  if (source.includes('pearlOsSanitizeDiscordPayload')) {
    return { source, patched: false };
  }
  if (!source.includes(DISCORD_CORE_PAYLOAD_REPLACE_BLOCK)) {
    if (strict) throw new Error('OpenClaw Discord payload sanitizer patch target not found');
    return { source, patched: false };
  }

  let next = source;
  const helper = `${DISCORD_SANITIZER_HELPER}\n${DISCORD_PAYLOAD_SANITIZER_HELPER}`;
  if (next.includes(DISCORD_CORE_HELPER_INSERT_AFTER)) {
    next = next.replace(DISCORD_CORE_HELPER_INSERT_AFTER, `${DISCORD_CORE_HELPER_INSERT_AFTER}\n${helper}`);
  } else {
    next = `${helper}\n${next}`;
  }
  next = next.replace(DISCORD_CORE_PAYLOAD_REPLACE_BLOCK, DISCORD_CORE_PAYLOAD_PATCHED_BLOCK);
  return { source: next, patched: true };
}

const DISCORD_PROVIDER_INTERACTION_SEND_REPLACE_BLOCK = `\tconst sendMessage = async (content, files, components) => {
\t\tconst payload = files && files.length > 0 ? {`;

const DISCORD_PROVIDER_INTERACTION_SEND_PATCHED_BLOCK = `\tconst sendMessage = async (content, files, components) => {
\t\tcontent = pearlOsSanitizeDiscordOutboundText(content ?? "");
\t\tif (!content.trim() && (!files || files.length === 0) && (!components || components.length === 0)) return;
\t\tconst payload = files && files.length > 0 ? {`;

function patchDiscordProviderSource(source, { strict = false } = {}) {
  if (source.includes('pearlOsSanitizeDiscordOutboundText')) {
    return { source, patched: false };
  }
  if (!source.includes(DISCORD_PROVIDER_INTERACTION_SEND_REPLACE_BLOCK)) {
    if (strict) throw new Error('OpenClaw Discord provider sanitizer patch target not found');
    return { source, patched: false };
  }

  let next = `${DISCORD_SANITIZER_HELPER}\n${source}`;
  next = next.replace(DISCORD_PROVIDER_INTERACTION_SEND_REPLACE_BLOCK, DISCORD_PROVIDER_INTERACTION_SEND_PATCHED_BLOCK);
  return { source: next, patched: true };
}

const MEMORY_CORE_COMPAT_TARGET = `\tregister(api) {
\t\tregisterBuiltInMemoryEmbeddingProviders(api);
\t\tregisterShortTermPromotionDreaming(api);
\t\tregisterDreamingCommand(api);`;

const MEMORY_CORE_COMPAT_PATCHED = `\tregister(api) {
\t\tif (typeof api.registerMemoryEmbeddingProvider === "function") registerBuiltInMemoryEmbeddingProviders(api);
\t\tif (typeof api.on === "function") registerShortTermPromotionDreaming(api);
\t\tif (typeof api.registerCommand === "function") registerDreamingCommand(api);`;

const MEMORY_CORE_CAPABILITY_TARGET = `\t\tapi.registerMemoryCapability({`;
const MEMORY_CORE_CAPABILITY_PATCHED = `\t\tif (typeof api.registerMemoryCapability === "function") api.registerMemoryCapability({`;
const MEMORY_CORE_CLI_TARGET = `\t\tapi.registerCli(({ program }) => {`;
const MEMORY_CORE_CLI_PATCHED = `\t\tif (typeof api.registerCli === "function") api.registerCli(({ program }) => {`;

function patchMemoryCorePluginSource(source) {
  if (source.includes('api.registerMemoryEmbeddingProvider === "function"')) {
    return { source, patched: false };
  }
  if (!source.includes(MEMORY_CORE_COMPAT_TARGET)) {
    return { source, patched: false };
  }
  let next = source.replace(MEMORY_CORE_COMPAT_TARGET, MEMORY_CORE_COMPAT_PATCHED);
  next = next.replace(MEMORY_CORE_CAPABILITY_TARGET, MEMORY_CORE_CAPABILITY_PATCHED);
  next = next.replace(MEMORY_CORE_CLI_TARGET, MEMORY_CORE_CLI_PATCHED);
  return { source: next, patched: true };
}

const MEMORY_CORE_API_COMPAT_TARGET = `\t\tconst api = createApi(record, {
\t\t\tconfig: cfg,
\t\t\tpluginConfig: validatedConfig.value
\t\t});`;

const MEMORY_CORE_API_COMPAT_PATCHED = `\t\tconst api = createApi(record, {
\t\t\tconfig: cfg,
\t\t\tpluginConfig: validatedConfig.value
\t\t});
\t\tif (!api.__pearlOsPluginApiCompat) {
\t\t\tapi.__pearlOsPluginApiCompat = true;
\t\t\tif (typeof api.registerMemoryEmbeddingProvider !== "function") api.registerMemoryEmbeddingProvider = () => {};
\t\t\tif (typeof api.on !== "function") api.on = () => {};
\t\t\tif (typeof api.registerCommand !== "function") api.registerCommand = () => {};
\t\t\tif (typeof api.registerMemoryCapability !== "function") api.registerMemoryCapability = () => {};
\t\t\tif (typeof api.registerCli !== "function") api.registerCli = () => {};
\t\t\tif (typeof api.registerWebSearchProvider !== "function") api.registerWebSearchProvider = () => {};
\t\t\tif (typeof api.registerWebFetchProvider !== "function") api.registerWebFetchProvider = () => {};
\t\t}`;

const OPENCLAW_ACTIVATION_API_COMPAT_TARGET = `\t\t\tconst api = createApi(record, {
\t\t\t\tconfig: cfg,
\t\t\t\tpluginConfig: validatedConfig.value,
\t\t\t\thookPolicy: entry?.hooks,
\t\t\t\tregistrationMode
\t\t\t});`;

const OPENCLAW_ACTIVATION_API_COMPAT_PATCHED = `\t\t\tconst api = createApi(record, {
\t\t\t\tconfig: cfg,
\t\t\t\tpluginConfig: validatedConfig.value,
\t\t\t\thookPolicy: entry?.hooks,
\t\t\t\tregistrationMode
\t\t\t});
\t\t\tif (!api.__pearlOsPluginApiCompat) {
\t\t\t\tapi.__pearlOsPluginApiCompat = true;
\t\t\t\tif (record.id === "memory-core" && typeof api.registerMemoryEmbeddingProvider !== "function") api.registerMemoryEmbeddingProvider = () => {};
\t\t\t\tif (record.id === "memory-core" && typeof api.on !== "function") api.on = () => {};
\t\t\t\tif (record.id === "memory-core" && typeof api.registerCommand !== "function") api.registerCommand = () => {};
\t\t\t\tif (record.id === "memory-core" && typeof api.registerMemoryCapability !== "function") api.registerMemoryCapability = () => {};
\t\t\t\tif (record.id === "memory-core" && typeof api.registerCli !== "function") api.registerCli = () => {};
\t\t\t\tif (record.id === "brave" && typeof api.registerWebSearchProvider !== "function") api.registerWebSearchProvider = () => {};
\t\t\t\tif (record.id === "firecrawl" && typeof api.registerWebFetchProvider !== "function") api.registerWebFetchProvider = () => {};
\t\t\t}`;

const OPENCLAW_SETUP_API_COMPAT_TARGET = `\t\t\t\t\tconst api = createApi(record, {
\t\t\t\t\t\tconfig: cfg,
\t\t\t\t\t\tpluginConfig: {},
\t\t\t\t\t\thookPolicy: entry?.hooks,
\t\t\t\t\t\tregistrationMode
\t\t\t\t\t});`;

const OPENCLAW_SETUP_API_COMPAT_PATCHED = `\t\t\t\t\tconst api = createApi(record, {
\t\t\t\t\t\tconfig: cfg,
\t\t\t\t\t\tpluginConfig: {},
\t\t\t\t\t\thookPolicy: entry?.hooks,
\t\t\t\t\t\tregistrationMode
\t\t\t\t\t});
\t\t\t\t\tif (!api.__pearlOsPluginApiCompat) {
\t\t\t\t\t\tapi.__pearlOsPluginApiCompat = true;
\t\t\t\t\t\tif (record.id === "brave" && typeof api.registerWebSearchProvider !== "function") api.registerWebSearchProvider = () => {};
\t\t\t\t\t\tif (record.id === "firecrawl" && typeof api.registerWebFetchProvider !== "function") api.registerWebFetchProvider = () => {};
\t\t\t\t\t}`;

function patchMemoryCoreRegistryApiSource(source) {
  if (source.includes('__pearlOsPluginApiCompat')) {
    return { source, patched: false };
  }
  let next = source;
  let patched = false;
  if (next.includes(MEMORY_CORE_API_COMPAT_TARGET)) {
    next = next.replace(MEMORY_CORE_API_COMPAT_TARGET, MEMORY_CORE_API_COMPAT_PATCHED);
    patched = true;
  }
  if (next.includes(OPENCLAW_ACTIVATION_API_COMPAT_TARGET)) {
    next = next.replace(OPENCLAW_ACTIVATION_API_COMPAT_TARGET, OPENCLAW_ACTIVATION_API_COMPAT_PATCHED);
    patched = true;
  }
  if (next.includes(OPENCLAW_SETUP_API_COMPAT_TARGET)) {
    next = next.replace(OPENCLAW_SETUP_API_COMPAT_TARGET, OPENCLAW_SETUP_API_COMPAT_PATCHED);
    patched = true;
  }
  return patched ? { source: next, patched: true } : { source, patched: false };
}

const DISCORD_AGENCY_ROUTER_HELPER = `
const pearlOsDiscordAgencyDispatchDedupe = new Map();
const pearlOsDiscordMentionUserCache = new Map();
const pearlOsDiscordLiveSearchDedupe = new Map();
const pearlOsDiscordPublicCapabilityDedupe = new Map();
const pearlOsDiscordProfileContextCache = new Map();
const pearlOsDiscordQaStatusDedupe = new Map();
const pearlOsDiscordGuildChannelsCache = new Map();
const pearlOsDiscordQaChannelIds = new Set(["1491397542364315668"]);
let pearlOsDiscordBraveKeyCache = { value: "", checkedAt: 0 };
let pearlOsDiscordOpenRouterKeyCache = { value: "", checkedAt: 0 };

function pearlOsDiscordCompactText(value) {
\treturn String(value ?? "").replace(/<@!?\\d+>/g, "").replace(/\\s+/g, " ").trim();
}

function pearlOsDiscordLooksLikeRuntimeBreakageTask(text) {
\tconst hasRuntimeSurface = /\\b(?:prod|production|staging|live|app\\.pearlos\\.org|pearlos|webchat|canvas|wonder\\s+canvas|creation|artifact|studio|voice|discord|telegram)\\b/.test(text);
\tconst hasBreakage = /\\b(?:unavailable|not\\s+available|failed|fails|failure|error|404|500|not\\s+found|missing|blank|broken|crash(?:ed|es)?|could\\s+not\\s+be\\s+loaded|failed\\s+to\\s+fetch|doesn'?t\\s+load|does\\s+not\\s+load|won'?t\\s+load|not\\s+loading|stuck)\\b/.test(text);
\tif (!hasRuntimeSurface || !hasBreakage) return false;
\tif (/\\b(?:prod|production|staging|live|app\\.pearlos\\.org)\\b/.test(text)) return true;
\treturn /\\b(?:what(?:'|\\u2019)?s|what\\s+is|why(?:'|\\u2019)?s|why\\s+is|can\\s+you\\s+check|check|look\\s+into|investigate|debug|fix)\\b/.test(text);
}

function pearlOsDiscordLooksLikeToolOrTaskRequest(text) {
\tconst hasToolSurface = /\\b(?:tool\\s*calls?|tools?|task\\s*(?:queue|routing|runner|dispatch|dispatches|runs?|creation)?|agency\\s+tasks?)\\b/.test(text);
\tif (!hasToolSurface) return false;
\tif (/\\b(?:can|could|would)\\s+you\\b[\\s\\S]{0,120}\\b(?:use|call|run|do|make|create|start|kick|trigger|invoke|dispatch|queue)\\b/.test(text)) return true;
\tif (/\\b(?:use|call|run|do|make|create|start|kick|trigger|invoke|dispatch|queue|fix|repair|audit|debug|verify)\\b[\\s\\S]{0,120}\\b(?:tool\\s*calls?|tools?|tasks?|agency\\s+tasks?)\\b/.test(text)) return true;
\treturn /\\b(?:tool\\s*calls?|tasks?|agency\\s+tasks?)\\b[\\s\\S]{0,120}\\b(?:work(?:ing)?|run(?:ning)?|route|routing|create|creating|dispatch|queue|execute|not\\s+working|broken|fail(?:ed|ing)?)\\b/.test(text);
}

function pearlOsDiscordLooksLikeAgencyTask(value) {
\tconst text = pearlOsDiscordCompactText(value).toLowerCase();
\tif (!text || text.length < 10) return false;
\tif (pearlOsDiscordLooksLikeLookupTask(text)) return true;
\tif (pearlOsDiscordLooksLikeRuntimeBreakageTask(text)) return true;
\tif (pearlOsDiscordLooksLikeToolOrTaskRequest(text)) return true;
\tif (pearlOsDiscordLooksLikeChannelContextRequest(value) && pearlOsDiscordLooksLikeChannelActionRequest(value)) return true;
\tif (/\\b(?:codex|claude|swarm|agency)\\b/.test(text) && /\\b(?:investigate|audit|fix|repair|check|look\\s+into|research|debug|diagnose|verify)\\b/.test(text)) return true;
\tif (/\\b(?:codex|claude)\\s+cli\\b/.test(text) && /\\b(?:audit|check|inspect|research|investigate|fix|repair|build|implement|write|run|do)\\b/.test(text)) return true;
\tif (/\\b(?:have|ask|tell|dispatch|queue|fire|start|run|send|hand)\\b[\\s\\S]{0,80}\\b(?:the\\s+)?(?:agency|agent|codex|claude)\\b/.test(text)) return true;
\tif (/\\b(?:deep|diverse|parallel|swarm)\\b[\\s\\S]{0,120}\\b(?:audit|research|investigate|report|review)\\b/.test(text)) return true;
\tif (/\\b(?:fix|repair|ensure|patch|implement|verify|debug|audit|review)\\b/.test(text) && /\\b(?:discord|tool\\s*calls?|staging|prod|production|openclaw|pearlos|agency|worker|task\\s+queue)\\b/.test(text)) return true;
\tif (/\\b(?:write|draft|summari[sz]e|document|save|post)\\b/.test(text) && /\\b(?:notes?|write[-\\s]?up|summary|report|prod|production|developed|milestones?|nvidia|local\\s*llama|reddit)\\b/.test(text)) return true;
\treturn /\\b(?:dispatch|queue|start|run|create|build|write|research|investigate|audit|fix|repair|implement|verify)\\b/.test(text)
\t\t&& /\\b(?:agency|agent|task|codex|claude|swarm|report|notes?|file|sandbox)\\b/.test(text);
}

function pearlOsDiscordLooksLikeAgencyTaskDetails(value) {
\tconst text = pearlOsDiscordCompactText(value).toLowerCase();
\tif (!text || text.length < 12) return false;
\tif (/^(?:i need it to|make it|have it|it should|please include|include|also include|and include|the note should|the summary should)\\b/.test(text)
\t\t&& /\\b(?:summari[sz]e|cover|include|mention|explain|capture|document|notes?|summary|write[-\\s]?up|report|prod|production|developed|milestones?|nvidia|local\\s*llama|reddit)\\b/.test(text)) return true;
\treturn /\\b(?:summari[sz]e|draft|write|document)\\b/.test(text)
\t\t&& /\\b(?:last few months|new things|developed|nvidia|accelerator program|local\\s*llama|reddit|ways? that helped)\\b/.test(text);
}

function pearlOsDiscordLooksLikeLookupTask(value) {
\tconst text = pearlOsDiscordCompactText(value).toLowerCase();
\tif (!text || text.length < 10) return false;
\tif (/\\b(?:search|web\\s*search|look\\s+up|google|check\\s+(?:the\\s+)?(?:news|web|internet)|news\\s+search)\\b/.test(text)) return true;
\tif (/\\b(?:search\\s+tools?|search\\s+capabilit(?:y|ies)|web\\s+tools?)\\b/.test(text) && /\\b(?:back\\s+online|work(?:ing)?|available|online|up)\\b/.test(text)) return true;
\tif (/\\b(?:is\\s+this\\s+real|is\\s+that\\s+real|verify\\s+(?:this|that|the)|fact\\s*check|confirm\\s+(?:this|that|the))\\b/.test(text)) return true;
\tif (/\\b(?:latest|current|today|just\\s+happened|breaking|story|announcement|announcements|partnership|partnerships|press\\s+release)\\b/.test(text)
\t\t&& /\\b(?:real|true|verify|check|find|source|sources?|news|search|look\\s+up|happening|happened)\\b/.test(text)) return true;
\treturn false;
}

function pearlOsDiscordLooksLikeRetryRequest(value) {
\tconst text = pearlOsDiscordCompactText(value).toLowerCase();
\tif (!text) return false;
\tif (/^(?:yes|yeah|yep|yup|please|pls|do it|do that|go ahead|sounds good|correct|exactly|sure)\\.?$/.test(text)) return true;
\treturn /\\b(?:try again|retry|rerun|do it again|kick this off properly|glitch|tool_call|tool call|still doing it|didn'?t work|failed|fix pearl|fix discord pearl)\\b/.test(text);
}

function pearlOsDiscordSafeScopePart(value, fallback) {
	const safe = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9._@+-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "").slice(0, 120);
	return safe || fallback;
}

function pearlOsDiscordFallbackRequesterUserId(authorId) {
	const id = String(authorId ?? "").trim();
	return /^\\d{10,}$/.test(id) ? "discord-" + id : undefined;
}

function pearlOsDiscordFallbackRequesterTenantId(params) {
	const guildId = String(params?.guildId ?? "").trim();
	if (/^\\d{10,}$/.test(guildId)) return "discord-guild-" + guildId;
	return params?.isDirectMessage ? "discord-dm" : "discord-public";
}

function pearlOsDiscordRawMessageText(params) {
	const ctxPayload = params?.ctxPayload || {};
	return ctxPayload.RawBody || ctxPayload.CommandBody || params?.message?.content || ctxPayload.BodyForAgent || "";
}

function pearlOsDiscordChannelReferences(value) {
	const raw = String(value ?? "");
	const refs = [];
	for (const match of raw.matchAll(/<#(\\d{10,})>/g)) {
		refs.push({ id: match[1], label: "<#" + match[1] + ">" });
	}
	for (const match of raw.matchAll(/(^|[\\s(])#([a-z0-9][a-z0-9_-]{1,80})\\b/gi)) {
		const name = String(match[2] || "").toLowerCase();
		if (name) refs.push({ name, label: "#" + name });
	}
	const seen = new Set();
	return refs.filter((ref) => {
		const key = ref.id ? "id:" + ref.id : "name:" + ref.name;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function pearlOsDiscordLooksLikeChannelContextRequest(value) {
	const text = pearlOsDiscordCompactText(value).toLowerCase();
	if (!text || !pearlOsDiscordChannelReferences(value).length) return false;
	return /\\b(?:check|read|look\\s+(?:at|in|through)|catch\\s+up\\s+on|summari[sz]e|scan|review|what(?:'|’)s|what\\s+is|what\\s+happened|find)\\b/.test(text);
}

function pearlOsDiscordLooksLikeChannelActionRequest(value) {
	const text = pearlOsDiscordCompactText(value).toLowerCase();
	return /\\b(?:fix|repair|debug|patch|implement|deploy|restart|build|ship|copy|move|recover|restore|recreate|create|write|generate|make|update|change|permissions?|sandbox|source|prod|production|staging|document|notes?|report|file)\\b/.test(text);
}

async function pearlOsDiscordFetchGuildChannels(token, guildId) {
	const tokenValue = String(token ?? "").trim();
	const id = String(guildId ?? "").trim();
	if (!tokenValue || !/^\\d{10,}$/.test(id)) return [];
	const cached = pearlOsDiscordGuildChannelsCache.get(id);
	const now = Date.now();
	if (cached && cached.expiresAt > now) return cached.channels;
	try {
		const response = await fetch("https://discord.com/api/v10/guilds/" + encodeURIComponent(id) + "/channels", {
			headers: { "Authorization": tokenValue.startsWith("Bot ") ? tokenValue : "Bot " + tokenValue }
		});
		if (!response.ok) return [];
		const body = await response.json().catch(() => []);
		const channels = Array.isArray(body) ? body : [];
		pearlOsDiscordGuildChannelsCache.set(id, { channels, expiresAt: now + 5 * 60 * 1000 });
		return channels;
	} catch (error) {
		console.warn("pearlos discord channel list fetch error", String(error));
		return [];
	}
}

async function pearlOsDiscordResolveReferencedChannel(params, text) {
	const refs = pearlOsDiscordChannelReferences(text);
	if (!refs.length) return null;
	const currentChannelId = String(params?.messageChannelId || params?.message?.channelId || params?.message?.channel_id || "").trim();
	const currentChannelName = pearlOsDiscordCompactText(params?.channelName || params?.ctxPayload?.ChannelName || "").toLowerCase().replace(/^#/, "");
	const guildId = String(params?.data?.guild_id || params?.data?.guild?.id || params?.ctxPayload?.GroupSpace || "").trim();
	for (const ref of refs) {
		if (ref.id) return { id: ref.id, name: ref.name || ref.label || ref.id, label: ref.label || ("#" + ref.id) };
		if (ref.name && currentChannelName && ref.name === currentChannelName && /^\\d{10,}$/.test(currentChannelId)) {
			return { id: currentChannelId, name: currentChannelName, label: "#" + currentChannelName };
		}
	}
	if (!/^\\d{10,}$/.test(guildId)) return null;
	const channels = await pearlOsDiscordFetchGuildChannels(params?.token, guildId);
	for (const ref of refs) {
		if (!ref.name) continue;
		const channel = channels.find((item) => pearlOsDiscordCompactText(item?.name).toLowerCase() === ref.name);
		const id = String(channel?.id || "").trim();
		if (/^\\d{10,}$/.test(id)) return { id, name: ref.name, label: "#" + ref.name };
	}
	return null;
}

function pearlOsDiscordFormatHistoryMessage(message) {
	const author = message?.author || {};
	const name = pearlOsDiscordCompactText(author.global_name || author.globalName || author.username || author.display_name || author.id || "someone");
	let body = pearlOsDiscordCompactText(message?.content || "");
	const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
	if (attachments.length) {
		const names = attachments.slice(0, 3).map((item) => pearlOsDiscordCompactText(item?.filename || "attachment")).filter(Boolean).join(", ");
		body = (body ? body + " " : "") + "[attachment: " + (names || "file") + "]";
	}
	if (!body) return "";
	if (body.length > 260) body = body.slice(0, 257).replace(/\\s+\\S*$/g, "").trim() + "...";
	return (name ? name + ": " : "") + body;
}

async function pearlOsDiscordBuildChannelHistoryContext(params, text) {
	const target = await pearlOsDiscordResolveReferencedChannel(params, text);
	if (!target?.id) return "";
	const messages = await pearlOsDiscordFetchChannelMessages(params?.token, target.id);
	if (!messages.length) {
		return "[Fetched Discord channel context: " + (target.label || target.id) + "]\\nPearl could identify the channel but could not read recent message history with the current bot permissions.\\n[/Fetched Discord channel context]";
	}
	const lines = [];
	for (const message of messages.slice(0, 12).reverse()) {
		const line = pearlOsDiscordFormatHistoryMessage(message);
		if (line) lines.push("- " + line);
	}
	if (!lines.length) return "";
	return [
		"[Fetched Discord channel context: " + (target.label || target.id) + "]",
		"Recent visible messages from the Discord API. Use this as workspace context; do not claim the sandbox fetched Discord directly.",
		...lines,
		"[/Fetched Discord channel context]"
	].join("\\n");
}

async function pearlOsDiscordSendChannelContextReply(params, content) {
	const tokenValue = String(params?.token ?? "").trim();
	const channelId = String(params?.channelId ?? "").trim();
	if (!tokenValue || !/^\\d{10,}$/.test(channelId) || !content) return false;
	const body = {
		content,
		allowed_mentions: { parse: [] }
	};
	if (params?.isGuildMessage && params?.messageId) {
		body.message_reference = {
			message_id: String(params.messageId),
			channel_id: channelId,
			guild_id: params.guildId ? String(params.guildId) : undefined,
			fail_if_not_exists: false
		};
	}
	try {
		const response = await fetch("https://discord.com/api/v10/channels/" + encodeURIComponent(channelId) + "/messages", {
			method: "POST",
			headers: {
				"Authorization": tokenValue.startsWith("Bot ") ? tokenValue : "Bot " + tokenValue,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body)
		});
		return response.ok;
	} catch (error) {
		console.warn("pearlos discord channel context reply error", String(error));
		return false;
	}
}

async function pearlOsMaybeHandleDiscordChannelContextRequest(params) {
	const rawText = pearlOsDiscordRawMessageText(params);
	if (!pearlOsDiscordLooksLikeChannelContextRequest(rawText)) return false;
	if (pearlOsDiscordLooksLikeChannelActionRequest(rawText)) return false;
	const context = await pearlOsDiscordBuildChannelHistoryContext(params, rawText);
	if (!context) return false;
	const visible = context
		.replace(/^\\[Fetched Discord channel context:[^\\n]+\\]\\n?/, "")
		.replace(/\\n?\\[\\/Fetched Discord channel context\\]$/, "")
		.replace(/^Recent visible messages[^\\n]*\\n?/, "")
		.trim();
	let content = visible
		? "I can read that Discord channel. Recent visible context:\\n" + visible
		: "I can see that Discord channel, but I do not have useful recent message content to summarize.";
	if (content.length > 1900) content = content.slice(0, 1880).replace(/\\s+\\S*$/g, "").trim() + "...";
	const channelId = String(params?.messageChannelId || params?.message?.channelId || params?.message?.channel_id || "").trim();
	const guildId = String(params?.data?.guild_id || params?.data?.guild?.id || params?.ctxPayload?.GroupSpace || "").trim();
	return pearlOsDiscordSendChannelContextReply({
		token: params?.token,
		channelId,
		messageId: String(params?.message?.id || ""),
		guildId,
		isGuildMessage: params?.isGuildMessage
	}, content);
}

function pearlOsDiscordExtractPreviousAgencyText(ctxPayload) {
\tconst candidates = [];
\tif (Array.isArray(ctxPayload?.InboundHistory)) {
\t\tfor (const entry of ctxPayload.InboundHistory) {
\t\t\tconst body = pearlOsDiscordCompactText(entry?.body || entry?.Body || "");
\t\t\tif (body) candidates.push(body);
\t\t}
\t}
\tconst combined = String(ctxPayload?.Body || "");
\tif (combined) {
\t\tfor (const line of combined.split(/\\n+/)) {
\t\t\tconst cleaned = pearlOsDiscordCompactText(line)
\t\t\t\t.replace(/^body:\\s*/i, "")
\t\t\t\t.replace(/^user message:\\s*/i, "")
\t\t\t\t.trim();
\t\t\tif (cleaned) candidates.push(cleaned);
\t\t}
\t}
\tfor (let index = candidates.length - 1; index >= 0; index -= 1) {
\t\tconst candidate = candidates[index];
\t\tif (pearlOsDiscordLooksLikeAgencyTask(candidate)) return candidate;
\t}
\treturn "";
}

function pearlOsDiscordRecentVisibleContext(ctxPayload) {
\tconst lines = [];
\tif (Array.isArray(ctxPayload?.InboundHistory)) {
\t\tfor (const entry of ctxPayload.InboundHistory.slice(-8)) {
\t\t\tconst name = pearlOsDiscordCompactText(entry?.senderName || entry?.SenderName || entry?.authorName || entry?.AuthorName || entry?.sender || entry?.author || "");
\t\t\tconst body = pearlOsDiscordCompactText(entry?.body || entry?.Body || entry?.content || entry?.Content || "");
\t\t\tif (body) lines.push((name ? name + ": " : "") + body);
\t\t}
\t}
\tif (lines.length === 0) {
\t\tconst body = pearlOsDiscordCompactText(ctxPayload?.BodyForAgent || ctxPayload?.Body || "");
\t\tif (body) lines.push(body);
\t}
\tconst text = lines.join("\\n").trim();
\treturn text.length > 2600 ? text.slice(-2600) : text;
}

function pearlOsDiscordCollectionValues(value) {
\tif (!value) return [];
\tif (Array.isArray(value)) return value;
\tif (typeof value.values === "function") return Array.from(value.values());
\tif (typeof value === "object") return Object.values(value);
\treturn [];
}

function pearlOsDiscordUserId(value) {
\tconst raw = value?.id ?? value?.user?.id ?? value?.member?.user?.id ?? value?.author?.id;
\tconst id = String(raw ?? "").trim();
\treturn /^\\d{10,}$/.test(id) ? id : "";
}

function pearlOsDiscordUserLabel(value) {
\tconst user = value?.user ?? value?.member?.user ?? value?.author ?? value;
\tconst member = value?.member ?? value;
\tconst display = String(member?.displayName ?? member?.display_name ?? member?.nickname ?? user?.globalName ?? user?.global_name ?? user?.displayName ?? user?.display_name ?? "").trim();
\tconst username = String(user?.username ?? user?.tag ?? user?.name ?? "").trim();
\tconst globalName = String(user?.globalName ?? user?.global_name ?? "").trim();
\tconst label = display || globalName || username;
\tif (!label) return "";
\tif (username && username !== label && !label.includes(username)) return label + " (@" + username + ")";
\treturn label;
}

function pearlOsDiscordCollectMentionIds(message) {
\tconst ids = new Set();
\tconst content = String(message?.content ?? "");
\tfor (const match of content.matchAll(/<@!?(\\d{10,})>/g)) ids.add(match[1]);
\tconst collections = [
\t\tmessage?.mentionedUsers,
\t\tmessage?.mentions,
\t\tmessage?.mentions?.users,
\t\tmessage?.mentions?.members,
\t\tmessage?.mentions?.parsedUsers,
\t\tmessage?.mentions?.parsedMembers
\t];
\tfor (const collection of collections) {
\t\tfor (const entry of pearlOsDiscordCollectionValues(collection)) {
\t\t\tconst id = pearlOsDiscordUserId(entry);
\t\t\tif (id) ids.add(id);
\t\t}
\t}
\treturn Array.from(ids);
}

function pearlOsDiscordMentionObjectMap(message) {
\tconst map = new Map();
\tconst collections = [
\t\tmessage?.mentionedUsers,
\t\tmessage?.mentions,
\t\tmessage?.mentions?.users,
\t\tmessage?.mentions?.members,
\t\tmessage?.mentions?.parsedUsers,
\t\tmessage?.mentions?.parsedMembers
\t];
\tfor (const collection of collections) {
\t\tfor (const entry of pearlOsDiscordCollectionValues(collection)) {
\t\t\tconst id = pearlOsDiscordUserId(entry);
\t\t\tif (id && !map.has(id)) map.set(id, entry);
\t\t}
\t}
\treturn map;
}

async function pearlOsDiscordFetchPublicUserLabel(id, token) {
\tconst cached = pearlOsDiscordMentionUserCache.get(id);
\tconst now = Date.now();
\tif (cached && cached.expiresAt > now) return cached.label;
\tconst tokenValue = String(token ?? "").trim();
\tif (!tokenValue) return "";
\ttry {
\t\tconst response = await fetch("https://discord.com/api/v10/users/" + encodeURIComponent(id), {
\t\t\theaders: { "Authorization": tokenValue.startsWith("Bot ") ? tokenValue : "Bot " + tokenValue }
\t\t});
\t\tif (!response.ok) return "";
\t\tconst body = await response.json().catch(() => ({}));
\t\tconst label = pearlOsDiscordUserLabel(body);
\t\tif (label) pearlOsDiscordMentionUserCache.set(id, { label, expiresAt: now + 6 * 60 * 60 * 1000 });
\t\treturn label;
\t} catch {
\t\treturn "";
\t}
}

function pearlOsDiscordCleanSearchText(value, maxLength = 280) {
\tlet text = pearlOsDiscordCompactText(value)
\t\t.replace(/<[^>]+>/g, " ")
\t\t.replace(/&amp;/g, "&")
\t\t.replace(/&quot;/g, '"')
\t\t.replace(/&#39;/g, "'")
\t\t.replace(/&lt;/g, "<")
\t\t.replace(/&gt;/g, ">")
\t\t.replace(/&nbsp;/g, " ")
\t\t.replace(/@/g, "@ ");
\ttext = pearlOsDiscordCompactText(text);
\tif (maxLength > 0 && text.length > maxLength) {
\t\tconst clipped = text.slice(0, maxLength - 3).replace(/\\s+\\S*$/g, "").trim();
\t\treturn (clipped || text.slice(0, maxLength - 3)) + "...";
\t}
\treturn text;
}

function pearlOsDiscordExtractPreviousLookupText(ctxPayload) {
\tconst candidates = [];
\tif (Array.isArray(ctxPayload?.InboundHistory)) {
\t\tfor (const entry of ctxPayload.InboundHistory) {
\t\t\tconst body = pearlOsDiscordCompactText(entry?.body || entry?.Body || entry?.content || entry?.Content || "");
\t\t\tif (body) candidates.push(body);
\t\t}
\t}
\tconst combined = String(ctxPayload?.Body || "");
\tif (combined) {
\t\tfor (const line of combined.split(/\\n+/)) {
\t\t\tconst cleaned = pearlOsDiscordCompactText(line)
\t\t\t\t.replace(/^body:\\s*/i, "")
\t\t\t\t.replace(/^user message:\\s*/i, "")
\t\t\t\t.trim();
\t\t\tif (cleaned) candidates.push(cleaned);
\t\t}
\t}
\tfor (let index = candidates.length - 1; index >= 0; index -= 1) {
\t\tconst candidate = candidates[index];
\t\tif (pearlOsDiscordLooksLikeLookupTask(candidate)) return candidate;
\t}
\treturn "";
}

function pearlOsDiscordSearchQueryNeedsContext(query) {
\tconst text = pearlOsDiscordCompactText(query).toLowerCase();
\tif (!text || text.length < 4) return true;
\tif (/^(?:this|that|the|above|image|screenshot|tweet|post|story|news|info|information|claim)(?:\\s+(?:story|post|image|screenshot|tweet|news|thing|claim))?$/.test(text)) return true;
\tif (/\\b(?:this|that|above|image|screenshot)\\b/.test(text) && text.split(/\\s+/).length <= 8) return true;
\treturn false;
}

function pearlOsDiscordSearchQueryFromContext(contextText) {
\tconst visibleText = String(contextText ?? "").split(/\\n+/)
\t\t.map((line) => line.replace(/^[^:\\n]{1,40}:\\s+/g, ""))
\t\t.join("\\n");
\tconst text = pearlOsDiscordCleanSearchText(visibleText, 2200);
\tif (!text) return "";
\tconst stopWords = new Set([
\t\t"Pearl", "Pearl Omega", "APP", "Discord", "Blair", "Hey", "Yes", "No",
\t\t"Open", "Source", "Web", "Search", "User", "Message", "Body", "From"
\t]);
\tconst terms = [];
\tconst addTerm = (value) => {
\t\tconst term = pearlOsDiscordCleanSearchText(value, 80)
\t\t\t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
\t\t\t.trim();
\t\tif (!term || term.length < 3) return;
\t\tif (stopWords.has(term)) return;
\t\tif (terms.some((existing) => existing.toLowerCase() === term.toLowerCase())) return;
\t\tterms.push(term);
\t};
\tfor (const match of text.matchAll(/["']([^"']{3,80})["']/g)) addTerm(match[1]);
\tfor (const match of text.matchAll(/\\b[A-Z][A-Za-z0-9-]*(?:\\s+(?:[A-Z][A-Za-z0-9-]*|[0-9]{2,4}|[A-Z]{2,})){0,3}\\b/g)) {
\t\taddTerm(match[0]);
\t\tif (terms.length >= 10) break;
\t}
\tif (terms.length < 4) {
\t\tfor (const match of text.matchAll(/\\b[A-Za-z][A-Za-z0-9-]{2,}\\b/g)) {
\t\t\tconst token = match[0];
\t\t\tif (/[A-Z0-9]/.test(token) && !/^(?:Pearl|Discord|Message|Search|Source)$/i.test(token)) addTerm(token);
\t\t\tif (terms.length >= 10) break;
\t\t}
\t}
\treturn terms.slice(0, 10).join(" ");
}

function pearlOsDiscordExtractLiveSearchQuery(rawText, contextText) {
\tlet cleaned = pearlOsDiscordCompactText(rawText)
\t\t.replace(/^(?:pearl(?:\\s+omega)?|omega)[,\\s:.-]+/i, "")
\t\t.replace(/\\bare your search tools back online yet[?!.]?\\s*/i, "")
\t\t.replace(/\\bdo you have search(?: capabilities| tools)?(?: back online)?(?: yet)?[?!.]?\\s*/i, "")
\t\t.trim();
\tlet query = "";
\tconst patterns = [
\t\t/\\b(?:search(?:\\s+(?:the\\s+)?(?:web|internet|news))?|web\\s*search|news\\s*search)\\s*(?:for|about|on)?\\s+(.+)$/i,
\t\t/\\b(?:look\\s+up|google)\\s*(?:for|about|on)?\\s+(.+)$/i,
\t\t/\\b(?:check\\s+(?:the\\s+)?(?:news|web|internet)|find\\s+(?:info|information|sources?)?)\\s*(?:for|about|on)?\\s+(.+)$/i,
\t\t/\\b(?:verify|fact\\s*check|confirm)\\s+(?:whether\\s+)?(.+)$/i
\t];
\tfor (const pattern of patterns) {
\t\tconst match = cleaned.match(pattern);
\t\tif (match && match[1]) {
\t\t\tquery = match[1];
\t\t\tbreak;
\t\t}
\t}
\tif (!query) query = cleaned;
\tquery = pearlOsDiscordCleanSearchText(query, 260)
\t\t.replace(/^(?:info(?:rmation)?|sources?|news)\\s+(?:about|on|for)\\s+/i, "")
\t\t.replace(/\\b(?:please|pls|thanks|thank you)\\b/gi, " ")
\t\t.trim();
\tconst contextQuery = pearlOsDiscordSearchQueryFromContext(contextText);
\tif (pearlOsDiscordSearchQueryNeedsContext(query)) return contextQuery || query;
\tif (contextQuery && /\\b(?:this|that|above|image|screenshot|story|claim)\\b/i.test(query)) {
\t\treturn pearlOsDiscordCleanSearchText(query + " " + contextQuery, 260);
\t}
\treturn query;
}

async function pearlOsDiscordResolveBraveSearchKey() {
\tconst envKey = String(process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY || "").trim();
\tif (envKey) return envKey;
\tconst now = Date.now();
\tif (pearlOsDiscordBraveKeyCache.checkedAt && now - pearlOsDiscordBraveKeyCache.checkedAt < 5 * 60 * 1000) {
\t\treturn pearlOsDiscordBraveKeyCache.value || "";
\t}
\tlet key = "";
\ttry {
\t\tconst fs = await import("node:fs/promises");
\t\tconst candidates = [
\t\t\tprocess.env.OPENCLAW_CONFIG_PATH,
\t\t\tprocess.env.HOME ? process.env.HOME.replace(/\\/+$/, "") + "/.openclaw/openclaw.json" : "",
\t\t\t"/home/deploy/.openclaw/openclaw.json",
\t\t\t"/root/.openclaw/openclaw.json"
\t\t].filter(Boolean);
\t\tfor (const filePath of candidates) {
\t\t\ttry {
\t\t\t\tconst cfg = JSON.parse(await fs.readFile(filePath, "utf8"));
\t\t\t\tkey = String(
\t\t\t\t\tcfg?.env?.BRAVE_API_KEY ||
\t\t\t\t\tcfg?.env?.BRAVE_SEARCH_API_KEY ||
\t\t\t\t\tcfg?.plugins?.entries?.brave?.config?.webSearch?.apiKey ||
\t\t\t\t\tcfg?.plugins?.entries?.brave?.config?.apiKey ||
\t\t\t\t\t""
\t\t\t\t).trim();
\t\t\t\tif (key) break;
\t\t\t} catch {}
\t\t}
\t} catch {}
\tpearlOsDiscordBraveKeyCache = { value: key, checkedAt: now };
\treturn key;
}

async function pearlOsDiscordRunBraveSearch(query) {
\tconst apiKey = await pearlOsDiscordResolveBraveSearchKey();
\tif (!apiKey) return { ok: false, reason: "missing-brave-key", results: [] };
\tconst url = new URL("https://api.search.brave.com/res/v1/web/search");
\turl.searchParams.set("q", query);
\turl.searchParams.set("count", "5");
\turl.searchParams.set("country", "us");
\turl.searchParams.set("search_lang", "en");
\turl.searchParams.set("text_decorations", "false");
\ttry {
\t\tconst response = await fetch(url, {
\t\t\theaders: {
\t\t\t\t"X-Subscription-Token": apiKey,
\t\t\t\t"Accept": "application/json"
\t\t\t}
\t\t});
\t\tif (!response.ok) {
\t\t\tconsole.warn("pearlos discord live search failed", response.status);
\t\t\treturn { ok: false, reason: "brave-http-" + response.status, results: [] };
\t\t}
\t\tconst body = await response.json().catch(() => ({}));
\t\tconst sourceResults = [
\t\t\t...(Array.isArray(body?.web?.results) ? body.web.results : []),
\t\t\t...(Array.isArray(body?.news?.results) ? body.news.results : [])
\t\t];
\t\tconst results = [];
\t\tfor (const item of sourceResults) {
\t\t\tconst title = pearlOsDiscordCleanSearchText(item?.title || item?.name || "", 140);
\t\t\tconst urlValue = String(item?.url || "").trim();
\t\t\tconst snippet = pearlOsDiscordCleanSearchText(item?.description || item?.snippet || "", 240);
\t\t\tif (!title || !/^https?:\\/\\//i.test(urlValue)) continue;
\t\t\tif (results.some((existing) => existing.url === urlValue)) continue;
\t\t\tresults.push({ title, url: urlValue, snippet });
\t\t\tif (results.length >= 5) break;
\t\t}
\t\treturn { ok: true, results };
\t} catch (error) {
\t\tconsole.warn("pearlos discord live search error", String(error));
\t\treturn { ok: false, reason: "brave-error", results: [] };
\t}
}

function pearlOsDiscordFormatSearchReply(query, results) {
\tconst safeQuery = pearlOsDiscordCleanSearchText(query, 180);
\tif (!Array.isArray(results) || results.length === 0) {
\t\treturn "I could not get a clean live answer for " + safeQuery + ". Try a narrower name, link, or phrase and I can check again.";
\t}
\tconst facts = [];
\tfor (let index = 0; index < Math.min(results.length, 4); index += 1) {
\t\tconst item = results[index];
\t\tconst snippet = pearlOsDiscordCleanSearchText(item?.snippet || "", 260);
\t\tif (snippet && !facts.includes(snippet)) facts.push(snippet);
\t}
\tlet content = facts.length
\t\t? "The cleanest live read: " + facts.slice(0, 3).join(" ")
\t\t: "I found live matches for " + safeQuery + ", but the returned text was too thin to answer cleanly.";
\tif (content.length > 1900) content = content.slice(0, 1880).replace(/\\s+\\S*$/g, "").trim() + "...";
\treturn content;
}

async function pearlOsDiscordSendLiveSearchReply(params, content) {
\tconst tokenValue = String(params.token ?? "").trim();
\tconst channelId = String(params.channelId ?? "").trim();
\tif (!tokenValue || !/^\\d{10,}$/.test(channelId) || !content) return false;
\tconst body = {
\t\tcontent,
\t\tallowed_mentions: { parse: [] }
\t};
\tif (params.isGuildMessage && params.messageId) {
\t\tbody.message_reference = {
\t\t\tmessage_id: String(params.messageId),
\t\t\tchannel_id: channelId,
\t\t\tguild_id: params.guildId ? String(params.guildId) : undefined,
\t\t\tfail_if_not_exists: false
\t\t};
\t}
\ttry {
\t\tconst response = await fetch("https://discord.com/api/v10/channels/" + encodeURIComponent(channelId) + "/messages", {
\t\t\tmethod: "POST",
\t\t\theaders: {
\t\t\t\t"Authorization": tokenValue.startsWith("Bot ") ? tokenValue : "Bot " + tokenValue,
\t\t\t\t"Content-Type": "application/json"
\t\t\t},
\t\t\tbody: JSON.stringify(body)
\t\t});
\t\tif (!response.ok) {
\t\t\tconsole.warn("pearlos discord live search reply failed", response.status);
\t\t\treturn false;
\t\t}
\t\treturn true;
\t} catch (error) {
\t\tconsole.warn("pearlos discord live search reply error", String(error));
\t\treturn false;
\t}
}

async function pearlOsMaybeHandleDiscordLiveSearch(params) {
\tconst ctxPayload = params.ctxPayload || {};
\tconst rawText = ctxPayload.RawBody || ctxPayload.CommandBody || params.message?.content || ctxPayload.BodyForAgent || "";
\tlet lookupText = rawText;
\tif (!pearlOsDiscordLooksLikeLookupTask(lookupText)) {
\t\tif (!pearlOsDiscordLooksLikeRetryRequest(lookupText)) return false;
\t\tconst previousLookupText = pearlOsDiscordExtractPreviousLookupText(ctxPayload);
\t\tif (!previousLookupText) return false;
\t\tlookupText = previousLookupText + " " + pearlOsDiscordCompactText(rawText);
\t}
\tconst messageId = String(params.message?.id || "");
\tconst channelId = String(params.messageChannelId || params.message?.channelId || "").trim();
\tif (!/^\\d{10,}$/.test(channelId)) return false;
\tconst dedupeKey = channelId + ":" + (messageId || pearlOsDiscordCompactText(lookupText).slice(0, 80));
\tconst nowMs = Date.now();
\tfor (const [key, ts] of pearlOsDiscordLiveSearchDedupe) {
\t\tif (nowMs - ts > 10 * 60 * 1000) pearlOsDiscordLiveSearchDedupe.delete(key);
\t}
\tif (pearlOsDiscordLiveSearchDedupe.has(dedupeKey)) return true;
\tconst contextText = pearlOsDiscordRecentVisibleContext(ctxPayload);
\tconst query = pearlOsDiscordExtractLiveSearchQuery(lookupText, contextText);
\tif (!query) return false;
\tconst search = await pearlOsDiscordRunBraveSearch(query);
\tif (!search?.ok) return false;
\tconst guildId = String(params.data?.guild_id || params.data?.guild?.id || ctxPayload.GroupSpace || "").trim();
\tconst sent = await pearlOsDiscordSendLiveSearchReply({
\t\ttoken: params.token,
\t\tchannelId,
\t\tmessageId,
\t\tguildId,
\t\tisGuildMessage: params.isGuildMessage
\t}, pearlOsDiscordFormatSearchReply(query, search.results));
\tif (!sent) return false;
\tpearlOsDiscordLiveSearchDedupe.set(dedupeKey, nowMs);
\treturn true;
}

function pearlOsDiscordLooksLikeQaChannel(params) {
\tconst channelId = String(params.messageChannelId || params.message?.channelId || params.message?.channel_id || params.ctxPayload?.ChannelId || "").trim();
\tconst channelName = pearlOsDiscordCompactText(params.channelName || params.ctxPayload?.ChannelName || "").toLowerCase().replace(/^#/, "");
\treturn pearlOsDiscordQaChannelIds.has(channelId) || channelName === "qa";
}

function pearlOsDiscordLooksLikeQaStatusRequest(value) {
\tconst text = pearlOsDiscordCompactText(value).toLowerCase();
\tif (!text || text.length < 4) return false;
\tif (/\\b(?:qa\\s+(?:list|fixes|items|board|status)|#qa\\s+(?:list|fixes|items|board|status))\\b/.test(text)) return true;
\tif (/\\b(?:review|summari[sz]e|list|post|show)\\b[\\s\\S]{0,120}\\b(?:completed|done|remaining|remains?|left|priority|priorities|eta|qa\\s+list|qa\\s+items)\\b/.test(text)) return true;
\tif (/\\b(?:what(?:'|\\u2019)?s|what\\s+is|where(?:'|\\u2019)?s|where\\s+is|give|post|show|list)\\b[\\s\\S]{0,120}\\b(?:status|progress|completed|done|remaining|remains?|left|priority|priorities|eta|found)\\b/.test(text)) return true;
\tif (/\\b(?:did\\s+this\\s+get\\s+fixed|ready\\s+to\\s+start(?:\\s+the)?\\s+qa\\s+fixes|start(?:ed|ing)?\\s+on\\s+the\\s+qa\\s+list|let'?s\\s+get\\s+started\\s+on\\s+the\\s+qa\\s+list|list\\s+what\\s+you\\s+found|does\\s+this\\s+help\\s+pearl)\\b/.test(text)) return true;
\treturn false;
}

function pearlOsDiscordQaMessageContent(message) {
\treturn pearlOsDiscordCompactText(message?.content || "")
\t\t.replace(/<@!?\\d+>/g, "")
\t\t.replace(/<#\\d+>/g, "#qa")
\t\t.trim();
}

function pearlOsDiscordQaAuthor(message) {
\tconst author = message?.author || {};
\treturn pearlOsDiscordCompactText(author.global_name || author.globalName || author.username || author.display_name || author.id || "tester");
}

function pearlOsDiscordQaAge(message) {
\tconst timestamp = Date.parse(String(message?.timestamp || ""));
\tif (!Number.isFinite(timestamp)) return "";
\tconst minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
\tif (minutes < 2) return "just now";
\tif (minutes < 60) return String(minutes) + "m ago";
\tconst hours = Math.round(minutes / 60);
\tif (hours < 24) return String(hours) + "h ago";
\tconst days = Math.round(hours / 24);
\treturn String(days) + "d ago";
}

function pearlOsDiscordLooksLikeQaActionable(message) {
\tif (!message?.id || message?.author?.bot) return false;
\tif (message.type != null && message.type !== 0 && message.type !== 19) return false;
\tconst text = pearlOsDiscordQaMessageContent(message);
\tconst hasAttachment = Array.isArray(message.attachments) && message.attachments.length > 0;
\tif (!text && !hasAttachment) return false;
\tif (!hasAttachment && /^(?:yes|yep|yeah|ok|okay|thanks|thank you|thx|cool|got it|same|confirmed|done|fixed|works|works now|nice|perfect|great)$/i.test(text)) return false;
\tif (/\\bfyi\\b.*\\bauthori[sz]ed\\b|\\bnew rule\\b.*#qa|\\banyone in #qa can trigger\\b/i.test(text)) return false;
\tif (pearlOsDiscordLooksLikeQaStatusRequest(text) && !/\\b(?:fix|repair|debug|ship|deploy|push|rebuild|hotfix|work on|make a new build|broken|error|failed|missing|mute|slow|latency|stuck)\\b/i.test(text)) return false;
\tif (/\\b(?:fix|repair|debug|ship|deploy|push|rebuild|hotfix|work on|make a new build|new build|tell codex|have codex|queue|dispatch|swarm|task)\\b/i.test(text)) return true;
\tif (/\\b(?:bug|broken|breaks|not working|doesn'?t|doesnt|won'?t|failed|fails|failure|error|crash|crashes|mute|muted|slow|latency|missing|stuck|blank|overflow|cut off|cannot|can'?t|regression|wrong|leak|leaked|unresponsive|hang|loading|404|500|no greeting|does not appear|not appear|not loading|does not load|not load|older version|confused|stalling|ghosting|silent)\\b/i.test(text)) return true;
\treturn hasAttachment;
}

function pearlOsDiscordQaPriorityScore(item) {
\tconst text = String(item?.text || "").toLowerCase();
\tlet score = 0;
\tif (/\\b(?:prod|production|live|app\\.pearlos\\.org|older version|no v2|build|deploy|down|not loading)\\b/.test(text)) score += 40;
\tif (/\\b(?:discord|#qa|pearl omega|codex|claude|tool calls?|silent|ghosting|stalling|status|qa list)\\b/.test(text)) score += 35;
\tif (/\\b(?:voice|vision|mute|latency|audio|tts|pockettts)\\b/.test(text)) score += 25;
\tif (/\\b(?:auth|login|401|500|error|failed|crash)\\b/.test(text)) score += 20;
\tif (/\\b(?:mobile|layout|overflow|settings|agency|council|canvas|browser|pulse|notes|filespace)\\b/.test(text)) score += 10;
\treturn score;
}

function pearlOsDiscordQaShortText(message) {
\tlet text = pearlOsDiscordQaMessageContent(message);
\tconst attachments = Array.isArray(message?.attachments) ? message.attachments : [];
\tif (!text && attachments.length) text = "Screenshot or attachment report: " + (attachments[0]?.filename || "attachment");
\tif (attachments.length && !/attachment|screenshot/i.test(text)) text += " (with attachment)";
\ttext = text.replace(/\\b\\d{17,20}\\b/g, "a Discord message").trim();
\tif (text.length > 145) text = text.slice(0, 142).replace(/\\s+\\S*$/g, "").trim() + "...";
\treturn text || "QA report";
}

async function pearlOsDiscordFetchChannelMessages(token, channelId) {
\tconst tokenValue = String(token ?? "").trim();
\tif (!tokenValue || !/^\\d{10,}$/.test(channelId)) return [];
\ttry {
\t\tconst response = await fetch("https://discord.com/api/v10/channels/" + encodeURIComponent(channelId) + "/messages?limit=100", {
\t\t\theaders: { "Authorization": tokenValue.startsWith("Bot ") ? tokenValue : "Bot " + tokenValue }
\t\t});
\t\tif (!response.ok) {
\t\t\tconsole.warn("pearlos discord qa history fetch failed", response.status);
\t\t\treturn [];
\t\t}
\t\tconst body = await response.json().catch(() => []);
\t\treturn Array.isArray(body) ? body : [];
\t} catch (error) {
\t\tconsole.warn("pearlos discord qa history fetch error", String(error));
\t\treturn [];
\t}
}

function pearlOsDiscordTaskLooksQa(task) {
\tconst text = [task?.title, task?.full_title, task?.task, task?.result, task?.swarm_category].filter(Boolean).join("\\n");
\treturn /\\b(?:qa rapid fire|#qa|qa list|silver streak|golden views|discord follow-up|prod|production|pockettts|pearl vision|agency|council)\\b/i.test(text);
}

function pearlOsDiscordCleanQaTaskText(value, maxLength) {
\tlet text = pearlOsDiscordCompactText(value)
\t\t.replace(/<@!?\\d{10,}>/g, "a tester")
\t\t.replace(/<#\\d{10,}>/g, "#qa")
\t\t.replace(/\\b(?:task|run|dispatch|disp|session)[\\s_-]*(?:id|hash)?\\s*[:=#]\\s*(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9][a-z0-9_.:-]{7,})\\b/gi, "this task")
\t\t.replace(/\\b(?:disp|dispatch|run|task|session)-[a-z0-9][a-z0-9_.:-]{7,}\\b/gi, "this task")
\t\t.replace(/\\b(?:hash|sha|commit)\\s*[:=]?\\s*[a-f0-9]{7,40}\\b/gi, "internal reference")
\t\t.replace(/\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b/gi, "internal reference")
\t\t.replace(/\\b[a-f0-9]{32,64}\\b/gi, "internal reference");
\tif (maxLength > 0 && text.length > maxLength) text = text.slice(0, maxLength - 3).replace(/\\s+\\S*$/g, "").trim() + "...";
\treturn text;
}

async function pearlOsDiscordFetchQaTaskSnapshot() {
\tconst secret = String(process.env.BOT_CONTROL_SHARED_SECRET || process.env.PEARL_TASKS_BOT_SECRET || process.env.BOT_CONTROL_CLAIMS_SECRET || "").trim();
\tif (!secret) return "";
\tconst baseUrl = (process.env.BOT_GATEWAY_URL || "http://127.0.0.1:4444").replace(/\\/+$/, "");
\tconst params = new URLSearchParams({ source: "discord", include_archived: "false", limit: "120" });
\ttry {
\t\tconst response = await fetch(baseUrl + "/api/tasks?" + params.toString(), {
\t\t\theaders: {
\t\t\t\t"Accept": "application/json",
\t\t\t\t"X-Bot-Secret": secret,
\t\t\t\t"Authorization": "Bearer " + secret
\t\t\t}
\t\t});
\t\tif (!response.ok) return "";
\t\tconst body = await response.json().catch(() => ({}));
\t\tconst tasks = Array.isArray(body?.tasks) ? body.tasks.filter(pearlOsDiscordTaskLooksQa) : [];
\t\tif (!tasks.length) return "";
\t\tconst active = tasks.filter((task) => ["pending", "in_progress"].includes(String(task.status)));
\t\tconst done = tasks.filter((task) => String(task.status) === "completed");
\t\tconst failed = tasks.filter((task) => ["failed", "cancelled"].includes(String(task.status)));
\t\tconst parts = ["Tracked board: " + active.length + " active, " + done.length + " recently done, " + failed.length + " needing recovery."];
\t\tif (active.length) {
\t\t\tparts.push("Active:");
\t\t\tfor (const task of active.slice(0, 3)) parts.push("- " + pearlOsDiscordCleanQaTaskText(String(task.title || task.full_title || "QA task").replace(/^QA Rapid Fire:\\s*/i, ""), 90) + ": " + String(task.status).replace("_", " ") + ".");
\t\t}
\t\tif (done.length) {
\t\t\tparts.push("Recently done:");
\t\t\tfor (const task of done.slice(0, 3)) parts.push("- " + pearlOsDiscordCleanQaTaskText(String(task.title || task.full_title || "QA task").replace(/^QA Rapid Fire:\\s*/i, ""), 82) + ".");
\t\t}
\t\treturn parts.join("\\n");
\t} catch (error) {
\t\tconsole.warn("pearlos discord qa task snapshot failed", String(error));
\t\treturn "";
\t}
}

function pearlOsDiscordBuildQaChannelSummary(messages, taskSnapshot) {
\tconst seen = new Set();
\tconst items = [];
\tfor (const message of messages) {
\t\tif (!pearlOsDiscordLooksLikeQaActionable(message)) continue;
\t\tconst text = pearlOsDiscordQaShortText(message);
\t\tconst key = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);
\t\tif (!key || seen.has(key)) continue;
\t\tseen.add(key);
\t\titems.push({ text, author: pearlOsDiscordQaAuthor(message), age: pearlOsDiscordQaAge(message), score: pearlOsDiscordQaPriorityScore({ text }), timestamp: String(message.timestamp || "") });
\t}
\titems.sort((a, b) => (b.score - a.score) || String(b.timestamp).localeCompare(String(a.timestamp)));
\tconst lines = [
\t\t"I can read #qa directly now. Current picture from recent channel history:",
\t\t""
\t];
\tif (taskSnapshot) {
\t\tlines.push(taskSnapshot, "");
\t}
\tif (items.length) {
\t\tlines.push("Recent actionable QA items:");
\t\tfor (const item of items.slice(0, 10)) lines.push("- " + item.text + " (" + item.author + (item.age ? ", " + item.age : "") + ")");
\t\tlines.push("");
\t\tlines.push("Priority order: prod/version or downtime first, Discord/Codex coordination second, then voice/audio, auth/runtime errors, and layout/product QA.");
\t} else {
\t\tlines.push("I do not see recent actionable QA items in the last 100 messages. If the list is older, tag me with the first item again and I will pick it up from there.");
\t}
\tlines.push("I will not call anything complete unless there is live build, log, or test evidence.");
\tlet content = lines.join("\\n");
\tif (content.length > 1900) content = content.slice(0, 1880).replace(/\\s+\\S*$/g, "").trim() + "...";
\treturn content;
}

async function pearlOsDiscordSendQaStatusReply(params, content) {
\tconst tokenValue = String(params.token ?? "").trim();
\tconst channelId = String(params.channelId ?? "").trim();
\tif (!tokenValue || !/^\\d{10,}$/.test(channelId) || !content) return false;
\tconst body = {
\t\tcontent,
\t\tallowed_mentions: { parse: [] }
\t};
\tif (params.isGuildMessage && params.messageId) {
\t\tbody.message_reference = {
\t\t\tmessage_id: String(params.messageId),
\t\t\tchannel_id: channelId,
\t\t\tguild_id: params.guildId ? String(params.guildId) : undefined,
\t\t\tfail_if_not_exists: false
\t\t};
\t}
\ttry {
\t\tconst response = await fetch("https://discord.com/api/v10/channels/" + encodeURIComponent(channelId) + "/messages", {
\t\t\tmethod: "POST",
\t\t\theaders: {
\t\t\t\t"Authorization": tokenValue.startsWith("Bot ") ? tokenValue : "Bot " + tokenValue,
\t\t\t\t"Content-Type": "application/json"
\t\t\t},
\t\t\tbody: JSON.stringify(body)
\t\t});
\t\treturn response.ok;
\t} catch (error) {
\t\tconsole.warn("pearlos discord qa status reply error", String(error));
\t\treturn false;
\t}
}

async function pearlOsMaybeHandleQaStatusRequest(params) {
\tconst ctxPayload = params.ctxPayload || {};
\tconst rawText = ctxPayload.RawBody || ctxPayload.CommandBody || params.message?.content || ctxPayload.BodyForAgent || "";
\tif (!pearlOsDiscordLooksLikeQaChannel(params)) return false;
\tif (!pearlOsDiscordLooksLikeQaStatusRequest(rawText)) return false;
\tconst channelId = String(params.messageChannelId || params.message?.channelId || params.message?.channel_id || "").trim();
\tconst messageId = String(params.message?.id || "");
\tif (!/^\\d{10,}$/.test(channelId)) return false;
\tconst dedupeKey = channelId + ":" + (messageId || pearlOsDiscordCompactText(rawText).slice(0, 80));
\tconst nowMs = Date.now();
\tfor (const [key, ts] of pearlOsDiscordQaStatusDedupe) {
\t\tif (nowMs - ts > 5 * 60 * 1000) pearlOsDiscordQaStatusDedupe.delete(key);
\t}
\tif (pearlOsDiscordQaStatusDedupe.has(dedupeKey)) return true;
\tconst messages = await pearlOsDiscordFetchChannelMessages(params.token, channelId);
\tconst taskSnapshot = await pearlOsDiscordFetchQaTaskSnapshot();
\tlet content;
\tif (messages.length) {
\t\tcontent = pearlOsDiscordBuildQaChannelSummary(messages, taskSnapshot);
\t} else {
\t\tcontent = "I can answer #qa status requests, but this runtime could not read recent channel history. I am not going to fake a QA list. Codex needs to check the Discord gateway token/channel-history path and the #qa watcher logs.";
\t}
\tconst guildId = String(params.data?.guild_id || params.data?.guild?.id || ctxPayload.GroupSpace || "").trim();
\tconst sent = await pearlOsDiscordSendQaStatusReply({
\t\ttoken: params.token,
\t\tchannelId,
\t\tmessageId,
\t\tguildId,
\t\tisGuildMessage: params.isGuildMessage
\t}, content);
\tif (!sent) return false;
\tpearlOsDiscordQaStatusDedupe.set(dedupeKey, nowMs);
\treturn true;
}

async function pearlOsEnrichDiscordMentionContext(params) {
\tconst ctxPayload = params.ctxPayload || {};
\tconst message = params.message || {};
\tconst ids = pearlOsDiscordCollectMentionIds(message);
\tif (ids.length === 0) return;
\tconst objects = pearlOsDiscordMentionObjectMap(message);
\tconst lines = [];
\tfor (const id of ids) {
\t\tlet label = pearlOsDiscordUserLabel(objects.get(id));
\t\tif (!label) label = await pearlOsDiscordFetchPublicUserLabel(id, params.token);
\t\tif (!label) label = "Discord user " + id;
\t\tlines.push("- <@" + id + "> = " + label + " [public Discord mention metadata from this message]");
\t}
\tif (lines.length === 0) return;
\tconst context = [
\t\t"[Public Discord mention context]",
\t\t"These names come only from public Discord metadata on the current message. Do not infer or reveal private DM memory from this.",
\t\t...lines,
\t\t"[/Public Discord mention context]"
\t].join("\\n");
\tfor (const key of ["BodyForAgent", "Body"]) {
\t\tconst current = String(ctxPayload[key] ?? "").trim();
\t\tif (current && !current.includes("[Public Discord mention context]")) ctxPayload[key] = context + "\\n\\n" + current;
\t}
}

function pearlOsDiscordTaskTitle(value) {
\tconst text = pearlOsDiscordCompactText(value)
\t\t.replace(/^(?:pearl(?:\\s+omega)?[,\\s:.-]*)/i, "")
\t\t.replace(/^have\\s+(?:codex|claude)(?:\\s+cli)?\\s+(?:and\\s+(?:codex|claude)(?:\\s+cli)?\\s+)?(?:and\\s+)?(?:you\\s+)?(?:do\\s+)?/i, "")
\t\t.trim();
\tconst summary = (text || "Discord task request").slice(0, 72).replace(/[\\s:;,.!?-]+$/g, "");
\treturn "Handle Discord request - " + (summary || "Agency task");
}

function pearlOsDiscordTaskBody(params) {
\tconst taskText = pearlOsDiscordCompactText(params.text);
\tconst authorLabel = [params.authorName, params.authorId ? "(" + params.authorId + ")" : ""].filter(Boolean).join(" ");
\tconst location = params.isDirectMessage
\t\t? "Discord DM"
\t\t: "Discord channel " + (params.channelName ? "#" + params.channelName + " " : "") + params.channelId;
\treturn [
\t\t"Discord request from " + (authorLabel || "unknown sender") + " in " + location + ":",
\t\ttaskText,
\t\t"",
\t\tparams.contextText ? "Recent visible Discord context:\\n" + params.contextText : "",
\t\tparams.contextText ? "" : "",
\t\t"Discord source channel " + params.channelId + ". Return final user-visible updates there.",
\t\tparams.guildId ? "Discord guild " + params.guildId + "." : "Discord direct message.",
\t\tparams.requesterUserId ? "Linked PearlOS requester user " + params.requesterUserId + "." : "No linked PearlOS requester was found; use the Discord sender scope only.",
\t\t"Requester tenant " + params.requesterTenantId + ".",
\t\t"",
\t\t"Rules:",
\t\t"- Keep private DM details inside this requester scope.",
\t\t"- Do not expose task IDs, run IDs, hashes, or internal tool/session identifiers.",
\t\t"- If the user asked for a report, Notes write-up, file, or audit, make the final result suitable to save and send back to this Discord conversation.",
\t\t"- If the user asked for live news, search, or story verification, use current sources and cite links when possible. Do not guess or label something satire/parody without evidence.",
\t\t"- If this touches PearlOS code, follow /workspace/nia-universal as source of truth and the staging/prod workflow docs."
\t].filter(Boolean).join("\\n");
}

async function pearlOsDiscordResolveRequester(authorId) {
\tconst fallback = { userId: pearlOsDiscordFallbackRequesterUserId(authorId), tenantId: "", email: "", linked: false };
\tconst id = String(authorId ?? "").trim();
\tif (!/^\\d{10,}$/.test(id)) return fallback;
\tconst secret = (process.env.DISCORD_DM_LINK_SECRET || process.env.MESH_SHARED_SECRET || "").trim();
\tif (!secret) return fallback;
\tconst baseUrl = (process.env.PEARLOS_BASE_URL || "http://127.0.0.1:3000").replace(/\\/+$/, "");
\ttry {
\t\tconst response = await fetch(baseUrl + "/api/discord/dm-link/check?discordUserId=" + encodeURIComponent(id), {
\t\t\theaders: { "x-internal-secret": secret }
\t\t});
\t\tif (!response.ok) return fallback;
\t\tconst body = await response.json().catch(() => ({}));
\t\tif (body?.allowed === true && typeof body.userId === "string" && body.userId.trim()) {
\t\t\treturn {
\t\t\t\tuserId: pearlOsDiscordSafeScopePart(body.userId, fallback.userId || "discord-user"),
\t\t\t\ttenantId: pearlOsDiscordSafeScopePart(body.tenantId, ""),
\t\t\t\temail: typeof body.email === "string" ? body.email.trim() : "",
\t\t\t\tlinked: true
\t\t\t};
\t\t}
\t} catch {}
\treturn fallback;
}

async function pearlOsDiscordIdentityContext(params) {
\tconst secret = (process.env.DISCORD_DM_LINK_SECRET || process.env.MESH_SHARED_SECRET || "").trim();
\tif (!secret) return "";
\tconst discordUserId = String(params?.authorId || params?.senderId || "").trim();
\tif (!/^\\d{17,20}$/.test(discordUserId)) return "";
\tconst cached = pearlOsDiscordProfileContextCache.get(discordUserId);
\tconst now = Date.now();
\tif (cached && cached.expiresAt > now) return cached.value;
\tconst baseUrl = (process.env.PEARLOS_BASE_URL || "http://127.0.0.1:3000").replace(/\\/+$/, "");
\ttry {
\t\tconst response = await fetch(baseUrl + "/api/discord/dm-link/context?discordUserId=" + encodeURIComponent(discordUserId), {
\t\t\theaders: { "x-internal-secret": secret }
\t\t});
\t\tif (!response.ok) return "";
\t\tconst body = await response.json().catch(() => ({}));
\t\tif (!body || body.linked !== true || typeof body.context !== "string" || !body.context.trim()) return "";
\t\tconst nameLine = body.userName ? "Verified PearlOS user: " + body.userName + "\\n" : "";
\t\tconst value = [
\t\t\t"[Trusted PearlOS identity context for this verified Discord sender]",
\t\t\tnameLine + body.context.trim(),
\t\t\t"[/Trusted PearlOS identity context]"
\t\t].join("\\n");
\t\tpearlOsDiscordProfileContextCache.set(discordUserId, { value, expiresAt: now + 60000 });
\t\treturn value;
\t} catch {
\t\treturn "";
\t}
}

async function pearlOsEnrichDiscordLinkedIdentityContext(params) {
\tconst ctxPayload = params.ctxPayload || {};
\tconst context = await pearlOsDiscordIdentityContext({
\t\tauthorId: params.author?.id || ctxPayload.SenderId
\t});
\tif (!context) return;
\tconst rawText = ctxPayload.BodyForAgent || ctxPayload.Body || ctxPayload.RawBody || ctxPayload.CommandBody || params.message?.content || "";
\tconst bodyText = String(rawText ?? "").trim();
\tconst enriched = (context + "\\n\\nUser message:\\n" + bodyText).trim();
\tfor (const key of ["BodyForAgent", "Body"]) {
\t\tconst current = String(ctxPayload[key] ?? "").trim();
\t\tif (current && current.includes("[Trusted PearlOS identity context for this verified Discord sender]")) continue;
\t\tctxPayload[key] = enriched;
\t}
}

async function pearlOsDiscordSendAgencyAck(params) {
\tconst tokenValue = String(params.token ?? "").trim();
\tconst channelId = String(params.channelId ?? "").trim();
\tif (!tokenValue || !/^\\d{10,}$/.test(channelId)) return;
\tconst body = {
\t\tcontent: params.isLookup
\t\t\t? "I'll check live sources and bring back the usable answer."
\t\t\t: "Logged. I'll update this thread when the task changes state.",
\t\tallowed_mentions: { parse: [] }
\t};
\tif (params.isGuildMessage && params.messageId) {
\t\tbody.message_reference = {
\t\t\tmessage_id: String(params.messageId),
\t\t\tchannel_id: channelId,
\t\t\tguild_id: params.guildId ? String(params.guildId) : undefined,
\t\t\tfail_if_not_exists: false
\t\t};
\t}
\tawait fetch("https://discord.com/api/v10/channels/" + encodeURIComponent(channelId) + "/messages", {
\t\tmethod: "POST",
\t\theaders: {
\t\t\t"Authorization": tokenValue.startsWith("Bot ") ? tokenValue : "Bot " + tokenValue,
\t\t\t"Content-Type": "application/json"
\t\t},
\t\tbody: JSON.stringify(body)
\t});
}

async function pearlOsMaybeRouteDiscordAgencyTask(params) {
\tconst ctxPayload = params.ctxPayload || {};
\tconst rawText = ctxPayload.RawBody || ctxPayload.CommandBody || params.message?.content || ctxPayload.BodyForAgent || "";
\tlet routeText = rawText;
\tif (!pearlOsDiscordLooksLikeAgencyTask(routeText)) {
\t\tconst previousAgencyText = pearlOsDiscordExtractPreviousAgencyText(ctxPayload);
\t\tif (previousAgencyText && pearlOsDiscordLooksLikeAgencyTaskDetails(routeText)) {
\t\t\trouteText = previousAgencyText + "\\n\\nFollow-up details from the requester:\\n" + pearlOsDiscordCompactText(rawText);
\t\t} else {
\t\t\tif (!pearlOsDiscordLooksLikeRetryRequest(routeText)) return false;
\t\t\tif (!previousAgencyText) return false;
\t\t\trouteText = "Retry after Discord tool-call glitch. Current user message: " + pearlOsDiscordCompactText(rawText) + "\\n\\nPrevious actionable request:\\n" + previousAgencyText;
\t\t}
\t}
\tconst messageId = String(params.message?.id || "");
\tconst channelId = String(params.messageChannelId || params.message?.channelId || "").trim();
\tif (!/^\\d{10,}$/.test(channelId)) return false;
\tconst dedupeKey = channelId + ":" + messageId;
\tconst nowMs = Date.now();
\tfor (const [key, ts] of pearlOsDiscordAgencyDispatchDedupe) {
\t\tif (nowMs - ts > 10 * 60 * 1000) pearlOsDiscordAgencyDispatchDedupe.delete(key);
\t}
\tif (messageId && pearlOsDiscordAgencyDispatchDedupe.has(dedupeKey)) return true;
\tconst taskSecret = (process.env.BOT_CONTROL_SHARED_SECRET || "").trim();
\tif (!taskSecret) return false;
\tconst requester = await pearlOsDiscordResolveRequester(params.author?.id || ctxPayload.SenderId);
\tconst guildId = String(params.data?.guild_id || params.data?.guild?.id || ctxPayload.GroupSpace || "").trim();
\tconst requesterTenantId = requester.tenantId || pearlOsDiscordFallbackRequesterTenantId({ isDirectMessage: params.isDirectMessage, guildId });
\tconst requesterUserId = requester.userId || pearlOsDiscordFallbackRequesterUserId(params.author?.id || ctxPayload.SenderId);
\tconst isLookup = pearlOsDiscordLooksLikeLookupTask(routeText);
\tconst fetchedChannelContext = await pearlOsDiscordBuildChannelHistoryContext({
\t\tctxPayload,
\t\tmessage: params.message,
\t\tmessageChannelId: channelId,
\t\tchannelName: params.channelName,
\t\tdata: params.data,
\t\ttoken: params.token
\t}, routeText);
\tconst contextText = [pearlOsDiscordRecentVisibleContext(ctxPayload), fetchedChannelContext].filter(Boolean).join("\\n\\n");
\tconst taskBody = pearlOsDiscordTaskBody({
\t\ttext: routeText,
\t\tauthorName: ctxPayload.SenderName || params.author?.username,
\t\tauthorId: params.author?.id || ctxPayload.SenderId,
\t\tisDirectMessage: params.isDirectMessage,
\t\tchannelName: params.channelName,
\t\tchannelId,
\t\tguildId,
\t\trequesterUserId,
\t\trequesterTenantId,
\t\tcontextText
\t});
\tconst baseUrl = (process.env.BOT_GATEWAY_URL || "http://127.0.0.1:4444").replace(/\\/+$/, "");
\ttry {
\t\tconst response = await fetch(baseUrl + "/api/tasks", {
\t\t\tmethod: "POST",
\t\t\theaders: {
\t\t\t\t"Content-Type": "application/json",
\t\t\t\t"X-Bot-Secret": taskSecret,
\t\t\t\t"Authorization": "Bearer " + taskSecret,
\t\t\t\t...(requesterUserId ? { "x-user-id": requesterUserId } : {}),
\t\t\t\t"x-pearl-tenant-id": requesterTenantId
\t\t\t},
\t\t\tbody: JSON.stringify({
\t\t\t\ttask: taskBody,
\t\t\t\ttitle: pearlOsDiscordTaskTitle(routeText),
\t\t\t\tsource: isLookup ? "discord_lookup" : "discord",
\t\t\t\tcreated_by: "pearl",
\t\t\t\tassignee: "claude_cli",
\t\t\t\turgency: /\\b(?:urgent|now|asap|production|prod|live|broken|down)\\b/i.test(String(routeText)) ? "urgent" : "normal",
\t\t\t\trequester_user_id: requesterUserId,
\t\t\t\trequester_tenant_id: requesterTenantId,
\t\t\t\t...(requester.email ? { requester_email: requester.email } : {})
\t\t\t})
\t\t});
\t\tif (!response.ok) {
\t\t\tconsole.warn("pearlos discord agency task route failed", response.status, await response.text().catch(() => ""));
\t\t\treturn false;
\t\t}
\t\tpearlOsDiscordAgencyDispatchDedupe.set(dedupeKey, nowMs);
\t\tawait pearlOsDiscordSendAgencyAck({
\t\t\ttoken: params.token,
\t\t\tchannelId,
\t\t\tmessageId,
\t\t\tguildId,
\t\t\tisGuildMessage: params.isGuildMessage,
\t\t\tisLookup
\t\t}).catch((error) => console.warn("pearlos discord agency ack failed", String(error)));
\t\treturn true;
\t} catch (error) {
\t\tconsole.warn("pearlos discord agency task route error", String(error));
\t\treturn false;
\t}
}
`;

const DISCORD_AGENCY_ROUTER_INSERT_AFTER = `\tawait recordInboundSession({
\t\tstorePath,
\t\tsessionKey: ctxPayload.SessionKey ?? route.sessionKey,
\t\tctx: ctxPayload,
\t\tupdateLastRoute: isDirectMessage ? {
\t\t\tsessionKey: route.mainSessionKey,
\t\t\tchannel: "discord",
\t\t\tto: \`user:\${author.id}\`,
\t\t\taccountId: route.accountId
\t\t} : void 0,
\t\tonRecordError: (err) => {
\t\t\tlogVerbose(\`discord: failed updating session meta: \${String(err)}\`);
\t\t}
\t});`;

const DISCORD_AGENCY_ROUTER_PATCHED_BLOCK = `${DISCORD_AGENCY_ROUTER_INSERT_AFTER}
\tawait pearlOsEnrichDiscordLinkedIdentityContext({
\t\tctxPayload,
\t\tmessage,
\t\tauthor
\t}).catch((error) => console.warn("pearlos discord identity context failed", String(error)));
\tawait pearlOsEnrichDiscordMentionContext({
\t\tctxPayload,
\t\tmessage,
\t\ttoken
\t}).catch((error) => console.warn("pearlos discord mention context failed", String(error)));
\tif (await pearlOsMaybeHandleQaStatusRequest({
\t\tctxPayload,
\t\tmessage,
\t\tmessageChannelId: message.channelId,
\t\tauthor,
\t\tdata,
\t\tchannelName,
\t\tisDirectMessage,
\t\tisGuildMessage,
\t\tdeliverTarget,
\t\ttoken
\t}) || await pearlOsMaybeHandleDiscordChannelContextRequest({
\t\tctxPayload,
\t\tmessage,
\t\tmessageChannelId: message.channelId,
\t\tauthor,
\t\tdata,
\t\tchannelName,
\t\tisDirectMessage,
\t\tisGuildMessage,
\t\tdeliverTarget,
\t\ttoken
\t}) || await pearlOsMaybeHandleDiscordLiveSearch({
\t\tctxPayload,
\t\tmessage,
\t\tmessageChannelId: message.channelId,
\t\tauthor,
\t\tdata,
\t\tchannelName,
\t\tisDirectMessage,
\t\tisGuildMessage,
\t\tdeliverTarget,
\t\ttoken
\t}) || await pearlOsMaybeRouteDiscordAgencyTask({
\t\tctxPayload,
\t\tmessage,
\t\tauthor,
\t\tdata,
\t\tchannelName,
\t\tisDirectMessage,
\t\tisGuildMessage,
\t\tdeliverTarget,
\t\ttoken
\t})) {
\t\tremoveAckReactionAfterReply({
\t\t\tremoveAfterReply: removeAckAfterReply,
\t\t\tackReactionPromise,
\t\t\tackReactionValue: ackReaction,
\t\t\tremove: async () => {
\t\t\t\tawait removeReactionDiscord(message.channelId, message.id, ackReaction, { rest: client.rest });
\t\t\t},
\t\t\tonError: (err) => {
\t\t\t\tlogAckFailure({
\t\t\t\t\tlog: logVerbose,
\t\t\t\t\tchannel: "discord",
\t\t\t\t\ttarget: \`\${message.channelId}/\${message.id}\`,
\t\t\t\t\terror: err
\t\t\t\t});
\t\t\t}
\t\t});
\t\tif (isGuildMessage) clearHistoryEntriesIfEnabled({
\t\t\thistoryMap: guildHistories,
\t\t\thistoryKey: message.channelId,
\t\t\tlimit: historyLimit
\t\t});
\t\treturn;
\t}`;

const DISCORD_CURRENT_HANDLER_INSERT_AFTER = `\tconst { ctxPayload, persistedSessionKey, turn, replyPlan, deliverTarget, replyTarget, replyReference } = processContext;`;

const DISCORD_CURRENT_HANDLER_PATCHED_BLOCK = `${DISCORD_CURRENT_HANDLER_INSERT_AFTER}
\tawait pearlOsEnrichDiscordLinkedIdentityContext({
\t\tctxPayload,
\t\tmessage,
\t\tauthor: ctx.author || message.author
\t}).catch((error) => console.warn("pearlos discord identity context failed", String(error)));
\tawait pearlOsEnrichDiscordMentionContext({
\t\tctxPayload,
\t\tmessage,
\t\ttoken
\t}).catch((error) => console.warn("pearlos discord mention context failed", String(error)));
\tif (await pearlOsMaybeHandleQaStatusRequest({
\t\tctxPayload,
\t\tmessage,
\t\tmessageChannelId,
\t\tauthor: ctx.author || message.author,
\t\tdata: ctx.data || {},
\t\tchannelName: ctx.channelName || ctx.channelInfo?.name,
\t\tisDirectMessage,
\t\tisGuildMessage,
\t\tdeliverTarget,
\t\ttoken
\t}) || await pearlOsMaybeHandleDiscordChannelContextRequest({
\t\tctxPayload,
\t\tmessage,
\t\tmessageChannelId,
\t\tauthor: ctx.author || message.author,
\t\tdata: ctx.data || {},
\t\tchannelName: ctx.channelName || ctx.channelInfo?.name,
\t\tisDirectMessage,
\t\tisGuildMessage,
\t\tdeliverTarget,
\t\ttoken
\t}) || await pearlOsMaybeHandleDiscordLiveSearch({
\t\tctxPayload,
\t\tmessage,
\t\tmessageChannelId,
\t\tauthor: ctx.author || message.author,
\t\tdata: ctx.data || {},
\t\tchannelName: ctx.channelName || ctx.channelInfo?.name,
\t\tisDirectMessage,
\t\tisGuildMessage,
\t\tdeliverTarget,
\t\ttoken
\t}) || await pearlOsMaybeRouteDiscordAgencyTask({
\t\tctxPayload,
\t\tmessage,
\t\tmessageChannelId,
\t\tauthor: ctx.author || message.author,
\t\tdata: ctx.data || {},
\t\tchannelName: ctx.channelName || ctx.channelInfo?.name,
\t\tisDirectMessage,
\t\tisGuildMessage,
\t\tdeliverTarget,
\t\ttoken
\t})) {
\t\tif (statusReactionsEnabled) {
\t\t\tawait statusReactions.setDone().catch((error) => console.warn("pearlos discord agency status reaction failed", String(error)));
\t\t} else if (shouldSendAckReaction && ackReaction && removeAckAfterReply) {
\t\t\tremoveReactionDiscord(messageChannelId, message.id, ackReaction, ackReactionContext).catch((err) => {
\t\t\t\tlogAckFailure({
\t\t\t\t\tlog: logVerbose,
\t\t\t\t\tchannel: "discord",
\t\t\t\t\ttarget: \`\${messageChannelId}/\${message.id}\`,
\t\t\t\t\terror: err
\t\t\t\t});
\t\t\t});
\t\t}
\t\treturn;
\t}`;

const DISCORD_LEGACY_AGENCY_ROUTER_INSERT_AFTER = `\tawait recordInboundSession({
\t\tstorePath,
\t\tsessionKey: persistedSessionKey,
\t\tctx: ctxPayload,
\t\tupdateLastRoute: {
\t\t\tsessionKey: persistedSessionKey,
\t\t\tchannel: "discord",
\t\t\tto: lastRouteTo,
\t\t\taccountId: route.accountId
\t\t},
\t\tonRecordError: (err) => {
\t\t\tlogVerbose(\`discord: failed updating session meta: \${String(err)}\`);
\t\t}
\t});`;

const DISCORD_LEGACY_AGENCY_ROUTER_PATCHED_BLOCK = `${DISCORD_LEGACY_AGENCY_ROUTER_INSERT_AFTER}
\tawait pearlOsEnrichDiscordLinkedIdentityContext({
\t\tctxPayload,
\t\tmessage,
\t\tauthor
\t}).catch((error) => console.warn("pearlos discord identity context failed", String(error)));
\tawait pearlOsEnrichDiscordMentionContext({
\t\tctxPayload,
\t\tmessage,
\t\ttoken
\t}).catch((error) => console.warn("pearlos discord mention context failed", String(error)));
\tif (await pearlOsMaybeHandleQaStatusRequest({
\t\tctxPayload,
\t\tmessage,
\t\tmessageChannelId,
\t\tauthor,
\t\tdata,
\t\tchannelName,
\t\tisDirectMessage,
\t\tisGuildMessage,
\t\tdeliverTarget,
\t\ttoken
\t}) || await pearlOsMaybeHandleDiscordChannelContextRequest({
\t\tctxPayload,
\t\tmessage,
\t\tmessageChannelId,
\t\tauthor,
\t\tdata,
\t\tchannelName,
\t\tisDirectMessage,
\t\tisGuildMessage,
\t\tdeliverTarget,
\t\ttoken
\t}) || await pearlOsMaybeHandleDiscordLiveSearch({
\t\tctxPayload,
\t\tmessage,
\t\tmessageChannelId,
\t\tauthor,
\t\tdata,
\t\tchannelName,
\t\tisDirectMessage,
\t\tisGuildMessage,
\t\tdeliverTarget,
\t\ttoken
\t}) || await pearlOsMaybeRouteDiscordAgencyTask({
\t\tctxPayload,
\t\tmessage,
\t\tmessageChannelId,
\t\tauthor,
\t\tdata,
\t\tchannelName,
\t\tisDirectMessage,
\t\tisGuildMessage,
\t\tdeliverTarget,
\t\ttoken
\t})) {
\t\tif (statusReactionsEnabled) {
\t\t\tawait statusReactions.setDone().catch((error) => console.warn("pearlos discord agency status reaction failed", String(error)));
\t\t\tif (removeAckAfterReply) (async () => {
\t\t\t\tawait sleep(DEFAULT_TIMING.doneHoldMs);
\t\t\t\tawait statusReactions.clear();
\t\t\t})().catch((error) => console.warn("pearlos discord agency status clear failed", String(error)));
\t\t\telse statusReactions.restoreInitial();
\t\t} else if (shouldSendAckReaction && ackReaction && removeAckAfterReply) {
\t\t\tremoveReactionDiscord(messageChannelId, message.id, ackReaction, ackReactionContext).catch((err) => {
\t\t\t\tlogAckFailure({
\t\t\t\t\tlog: logVerbose,
\t\t\t\t\tchannel: "discord",
\t\t\t\t\ttarget: \`\${messageChannelId}/\${message.id}\`,
\t\t\t\t\terror: err
\t\t\t\t});
\t\t\t});
\t\t}
\t\tif (isGuildMessage) clearHistoryEntriesIfEnabled({
\t\t\thistoryMap: guildHistories,
\t\t\thistoryKey: messageChannelId,
\t\t\tlimit: historyLimit
\t\t});
\t\treturn;
\t}`;

export async function load(url, context, defaultLoad) {
  const result = await defaultLoad(url, context, defaultLoad);
  if (result.source == null) {
    return result;
  }

  let source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
  if (MEMORY_CORE_INDEX_RE.test(url)) {
    source = patchMemoryCorePluginSource(source).source;
    return { ...result, source };
  }

  if (DISCORD_SEND_SHARED_BASENAME_RE.test(url) || DISCORD_SEND_HASH_BASENAME_RE.test(url)) {
    source = patchDiscordOutboundSendSource(source, { strict: DISCORD_SEND_SHARED_BASENAME_RE.test(url) }).source;
    return { ...result, source };
  }

  if (DISCORD_CORE_BASENAME_RE.test(url)) {
    source = patchDiscordCorePayloadSource(source, { strict: true }).source;
    return { ...result, source };
  }

  if (DISCORD_PROVIDER_BASENAME_RE.test(url)) {
    source = patchDiscordProviderSource(source, { strict: true }).source;
    return { ...result, source };
  }

  if (OPENCLAW_PLUGIN_REGISTRY_BUNDLE_RE.test(url)) {
    source = patchMemoryCoreRegistryApiSource(source).source;
  }

  if (DISCORD_INBOUND_MESSAGE_HANDLER_RE.test(url)) {
    if (!source.includes('pearlOsMaybeRouteDiscordAgencyTask')) {
      if (!source.includes(DISCORD_CURRENT_HANDLER_INSERT_AFTER)) {
        return { ...result, source };
      }
      source = `${DISCORD_AGENCY_ROUTER_HELPER}\n${source}`;
      source = source.replace(DISCORD_CURRENT_HANDLER_INSERT_AFTER, DISCORD_CURRENT_HANDLER_PATCHED_BLOCK);
    }
    return { ...result, source };
  }

  if (DISCORD_INBOUND_LEGACY_MESSAGE_HANDLER_RE.test(url)) {
    if (!source.includes('pearlOsMaybeRouteDiscordAgencyTask')) {
      if (!source.includes(DISCORD_LEGACY_AGENCY_ROUTER_INSERT_AFTER)) {
        return { ...result, source };
      }
      source = `${DISCORD_AGENCY_ROUTER_HELPER}\n${source}`;
      source = source.replace(DISCORD_LEGACY_AGENCY_ROUTER_INSERT_AFTER, DISCORD_LEGACY_AGENCY_ROUTER_PATCHED_BLOCK);
    }
    return { ...result, source };
  }

  if (DISCORD_INBOUND_PI_EMBEDDED_RE.test(url)) {
    source = patchDiscordOutboundSendSource(source).source;
    if (!source.includes('pearlOsMaybeRouteDiscordAgencyTask')) {
      if (!source.includes(DISCORD_AGENCY_ROUTER_INSERT_AFTER)) {
        return { ...result, source };
      }
      source = `${DISCORD_AGENCY_ROUTER_HELPER}\n${source}`;
      source = source.replace(DISCORD_AGENCY_ROUTER_INSERT_AFTER, DISCORD_AGENCY_ROUTER_PATCHED_BLOCK);
    }
    return { ...result, source };
  }

  if (!url.endsWith(TARGET_BASENAME)) {
    return { ...result, source };
  }

  if (source.includes('pearlOsTelegramDmPreAllowlistVerification')) {
    return { ...result, source };
  }
  if (!source.includes(INSERT_AFTER) || !source.includes(REPLACE_BLOCK) || !source.includes(CONTEXT_REPLACE_BLOCK)) {
    throw new Error('OpenClaw Telegram pre-allowlist patch target not found');
  }

  source = source.replace(INSERT_AFTER, `${INSERT_AFTER}\n${HELPER}`);
  source = source.replace(REPLACE_BLOCK, PATCHED_BLOCK);
  source = source.replace(CONTEXT_REPLACE_BLOCK, CONTEXT_PATCHED_BLOCK);
  return { ...result, source };
}
