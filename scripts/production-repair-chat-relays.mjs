#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function firstReadablePath(paths) {
	for (const file of paths) {
		try {
			fs.accessSync(file, fs.constants.R_OK);
			return file;
		} catch {
			// Try the next known runtime location.
		}
	}
	return paths[0];
}

const CONFIG_PATH = process.env.OPENCLAW_CONFIG ?? firstReadablePath([
	"/home/deploy/.openclaw/openclaw.json",
	"/root/.openclaw/openclaw.json"
]);
const STATE_DIR = process.env.PEARL_RELAY_STATE_DIR ?? `${firstReadablePath([
	"/home/deploy/.openclaw",
	"/root/.openclaw"
])}/production-repair-relays`;
const SOURCE_DIR = process.env.PEARLOS_SOURCE_DIR ?? "/workspace/nia-universal";
const USER_MEMORY_ROOT = process.env.PEARL_USER_MEMORY_DIR ?? "/home/deploy/.openclaw/user-memory";
const DISCORD_IDENTITY_LINKS_PATH = process.env.PEARL_DISCORD_IDENTITY_LINKS_PATH ?? "/home/deploy/.openclaw/discord-identity-links.json";
const OPENCLAW_URL = process.env.OPENCLAW_URL ?? "http://127.0.0.1:18789/v1/chat/completions";
const DEEPSEEK_PROXY_URL = process.env.DEEPSEEK_PROXY_URL ?? "http://127.0.0.1:8200/v1/chat/completions";
const OPENROUTER_CHAT_URL = process.env.OPENROUTER_CHAT_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.PEARL_RELAY_MODEL ?? "openclaw/main";
const REPAIR_MODEL = process.env.PEARL_RELAY_REPAIR_MODEL ?? "deepseek-v4-flash";
const VISION_MODEL = process.env.PEARL_RELAY_VISION_MODEL ?? "qwen/qwen3-vl-8b-instruct";
const TASKS_API_URL = (process.env.PEARL_TASKS_API ?? "http://127.0.0.1:4444/api/tasks").replace(/\/$/, "");
const CHAT_INBOX_API_URL = (process.env.PEARL_CHAT_INBOX_API ?? "http://127.0.0.1:4444/api/chat/inbox").replace(/\/$/, "");
const WEBCHAT_FOLLOWUP_USER_EMAIL = (process.env.PEARL_WEBCHAT_FOLLOWUP_USER_EMAIL || process.env.PEARL_PRIMARY_USER_EMAIL || "").trim();
const WEBCHAT_FOLLOWUP_TENANT_ID = (
	process.env.PEARL_WEBCHAT_FOLLOWUP_TENANT_ID
	|| process.env.PEARL_PRIMARY_TENANT_ID
	|| process.env.DEFAULT_TENANT_ID
	|| "public"
).trim();
// Internal link-check endpoint for Discord DM verification gates.
// INTERFACE_DM_LINK_URL should point at the running interface app origin.
// DISCORD_DM_LINK_SECRET must match apps/interface /api/discord/dm-link/check.
const INTERFACE_DM_LINK_URL = (process.env.INTERFACE_DM_LINK_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const DISCORD_DM_LINK_SECRET = String(process.env.DISCORD_DM_LINK_SECRET ?? process.env.MESH_SHARED_SECRET ?? "");
const ENABLE_DISCORD_RELAY = String(process.env.PEARL_RELAY_ENABLE_DISCORD ?? "").toLowerCase() === "true";
const SKIP_OPENCLAW = String(process.env.PEARL_RELAY_SKIP_OPENCLAW ?? "").toLowerCase() === "true";
const OPENCLAW_MODE = String(process.env.PEARL_RELAY_OPENCLAW_MODE ?? (SKIP_OPENCLAW ? "legacy" : "primary")).toLowerCase();
const OPENCLAW_PRIMARY_CHANNELS = parseCsvSet(process.env.PEARL_RELAY_OPENCLAW_PRIMARY_CHANNELS);
const OPENCLAW_SHADOW_CHANNELS = parseCsvSet(process.env.PEARL_RELAY_OPENCLAW_SHADOW_CHANNELS);
const ENABLE_DIRECT_LIVE_LOOKUP = String(process.env.PEARL_RELAY_DIRECT_LIVE_LOOKUP ?? "true").toLowerCase() !== "false";
const MAX_INPUT_CHARS = 6000;
const MAX_REPLY_CHARS = 1800;
const MAX_ATTACHMENT_TEXT_BYTES = Number(process.env.PEARL_ATTACHMENT_TEXT_BYTES ?? 1_000_000);
const MAX_ATTACHMENT_TEXT_CHARS = Number(process.env.PEARL_ATTACHMENT_TEXT_CHARS ?? 12000);
const CLOUDFLARE_LOG_CANDIDATES = [
	"/tmp/cloudflared-3000.log",
	"/tmp/cloudflared-4444.log",
	"/tmp/cf-blair-term.log"
];

const TELEGRAM_TOKEN_SOURCES = [
	CONFIG_PATH,
	"/root/.openclaw/openclaw.json.runpod-backup",
	"/root/.openclaw/openclaw.json.backup.1775798996",
	"/root/.openclaw/.ipynb_checkpoints/openclaw.json-checkpoint.bak"
];
const ENV_FILE_CANDIDATES = [
	"/home/deploy/pearlos/apps/pipecat-daily-bot/.env",
	"/opt/pearlos/apps/pipecat-daily-bot/.env",
	"/home/deploy/pearlos/.env",
	"/home/deploy/pearlos/.env.local",
	"/opt/pearlos/.env",
	"/opt/pearlos/.env.local",
	path.join(SOURCE_DIR, ".env.local"),
	path.join(SOURCE_DIR, "apps/pipecat-daily-bot/.env")
];
const DISCORD_DELEGATION_TTL_MS = 10 * 60 * 1000;
const DISCORD_LAST_REQUEST_TTL_MS = 15 * 60 * 1000;
const DISCORD_DM_ALLOW_CACHE_TTL_MS = 60 * 1000;
const DISCORD_VERIFY_PROMPT_COOLDOWN_MS = 10 * 60 * 1000;
const DISCORD_HISTORY_MAX_TURNS = Number(process.env.PEARL_DISCORD_HISTORY_MAX_TURNS ?? 28);
const DISCORD_HISTORY_MAX_CHARS = Number(process.env.PEARL_DISCORD_HISTORY_MAX_CHARS ?? 6500);
const DISCORD_TASK_FOLLOWUP_INTERVAL_MS = Number(process.env.PEARL_DISCORD_TASK_FOLLOWUP_MS ?? 600_000);
const DISCORD_GATEWAY_ACK_GRACE_MS = Number(process.env.PEARL_DISCORD_GATEWAY_ACK_GRACE_MS ?? 10_000);
const CONVERSATION_WORK_CHECK_INTERVAL_MS = Number(process.env.PEARL_CONVERSATION_WORK_CHECK_MS ?? 15_000);
const CONVERSATION_WORK_CHAT_FIRST_MS = Number(process.env.PEARL_CONVERSATION_WORK_CHAT_FIRST_MS ?? 90_000);
const CONVERSATION_WORK_VOICE_FIRST_MS = Number(process.env.PEARL_CONVERSATION_WORK_VOICE_FIRST_MS ?? 15_000);
const CONVERSATION_WORK_REPEAT_MS = Number(process.env.PEARL_CONVERSATION_WORK_REPEAT_MS ?? 10 * 60_000);
const CONVERSATION_WORK_MAX_AGE_MS = Number(process.env.PEARL_CONVERSATION_WORK_MAX_AGE_MS ?? 48 * 60 * 60_000);
const WEBCHAT_TASK_FOLLOWUP_INTERVAL_MS = Number(process.env.PEARL_WEBCHAT_TASK_FOLLOWUP_MS ?? 120_000);
const WEBCHAT_TASK_STALE_MS = Number(process.env.PEARL_WEBCHAT_TASK_STALE_MS ?? 10 * 60_000);
const WEBCHAT_TASK_REPEAT_MS = Number(process.env.PEARL_WEBCHAT_TASK_REPEAT_MS ?? 30 * 60_000);
const WEBCHAT_TASK_MAX_AGE_MS = Number(process.env.PEARL_WEBCHAT_TASK_MAX_AGE_MS ?? 48 * 60 * 60_000);
const WEBCHAT_TASK_TERMINAL_CATCHUP_MS = Number(process.env.PEARL_WEBCHAT_TASK_TERMINAL_CATCHUP_MS ?? 5 * 60_000);
const DISCORD_LOG_CHANNEL = (process.env.PEARL_DISCORD_LOG_CHANNEL || process.env.PEARL_LOG_MESSAGES_CHANNEL || "").trim();
const DISCORD_LOG_CHANNEL_NAME = (process.env.PEARL_DISCORD_LOG_CHANNEL_NAME ?? "pearl-log-messages").trim();
const DISCORD_LOG_FALLBACK_CHANNEL = (process.env.PEARL_DISCORD_LOG_FALLBACK_CHANNEL ?? "1473007676157071431").trim();
const TRUSTED_DISCORD_GUILD_ID = "1471441655126167553";
const QA_DISCORD_CHANNEL_ID = (process.env.PEARL_QA_DISCORD_CHANNEL_ID ?? "1491397542364315668").trim();
const TRUSTED_DISCORD_CHANNELS = new Set([
	"1471441655650324533",
	"1482123068854763642",
	"1484598509683478549",
	"1484598537177137163",
	"1494906069149941921",
	"1484598545502961795",
	"1484598530071859355"
]);
if (QA_DISCORD_CHANNEL_ID) TRUSTED_DISCORD_CHANNELS.add(QA_DISCORD_CHANNEL_ID);
const discordChannelCache = new Map();
const pendingDiscordDelegations = new Map();
const discordDmAllowCache = new Map();
const discordLinkedAccountCache = new Map();
const discordVerifyPromptCache = new Map();
const discordTaskFollowupTimers = new Map();
let webChatTaskFollowupTimer = null;
let conversationWorkHeartbeatTimer = null;
let discordSessionState = null;

fs.mkdirSync(STATE_DIR, { recursive: true });

function parseCsvSet(value) {
	return new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();
const log = (surface, message, extra = {}) => {
	const rest = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
	console.log(`${now()} [${surface}] ${message}${rest}`);
};
const warn = (surface, message, extra = {}) => {
	const rest = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
	console.warn(`${now()} [${surface}] ${message}${rest}`);
};

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

function stateFile(name) {
	return path.join(STATE_DIR, name);
}

function readStateFile(name, fallback = {}) {
	return readJson(stateFile(name)) ?? fallback;
}

function writeStateFile(name, value) {
	const file = stateFile(name);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
	fs.renameSync(tmp, file);
}

function appendTextFile(file, text) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, text);
}

function pickTelegramConfig() {
	for (const file of TELEGRAM_TOKEN_SOURCES) {
		const cfg = readJson(file);
		const token = cfg?.env?.TELEGRAM_BOT_TOKEN || cfg?.channels?.telegram?.botToken;
		if (typeof token === "string" && token.includes(":")) {
			return {
				source: file,
				token,
				config: cfg.channels?.telegram ?? {}
			};
		}
	}
	return null;
}

function activeConfig() {
	const cfg = readJson(CONFIG_PATH);
	if (!cfg) throw new Error(`Unable to read ${CONFIG_PATH}`);
	return cfg;
}

function shortId(value) {
	if (typeof value !== "string" || value.length < 8) return "unknown";
	return value.slice(-8);
}

function readText(file, maxChars = 12000) {
	try {
		return fs.readFileSync(file, "utf8").slice(0, maxChars);
	} catch {
		return "";
	}
}

function readEnvFileValue(file, key) {
	const text = readText(file, 200000);
	if (!text) return "";
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = text.match(new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=\\s*(.*)\\s*$`, "m"));
	if (!match) return "";
	return match[1].trim().replace(/^['"]|['"]$/g, "");
}

function getSecret(config, key) {
	if (process.env[key]) return process.env[key];
	const cfgValue = config?.env?.[key] || config?.secrets?.[key];
	if (typeof cfgValue === "string" && cfgValue.trim()) return cfgValue.trim();
	for (const file of ENV_FILE_CANDIDATES) {
		const value = readEnvFileValue(file, key);
		if (value) return value;
	}
	return "";
}

function taskAuthHeaders(config, extra = {}) {
	const taskSecret = getSecret(config, "PEARL_TASKS_BOT_SECRET")
		|| getSecret(config, "BOT_CONTROL_SHARED_SECRET")
		|| getSecret(config, "BOT_CONTROL_CLAIMS_SECRET")
		|| config?.gateway?.auth?.token;
	return {
		...extra,
		...(taskSecret ? {
			"authorization": `Bearer ${taskSecret}`,
			"x-bot-secret": taskSecret
		} : {})
	};
}

function isAllowed(value, allowed) {
	if (!Array.isArray(allowed) || allowed.length === 0) return true;
	if (allowed.includes("*")) return true;
	return allowed.map(String).includes(String(value));
}

function resolveDiscordGuildConfig(discord, guildId) {
	const guilds = discord?.guilds;
	if (Array.isArray(guilds)) {
		return guilds.find((guild) => String(guild.id) === String(guildId)) ?? null;
	}
	if (guilds && typeof guilds === "object") {
		return guilds[String(guildId)] ?? null;
	}
	return null;
}

function isDiscordChannelAllowed(channelId, channelConfig) {
	if (channelConfig === "*") return true;
	if (Array.isArray(channelConfig)) return isAllowed(channelId, channelConfig);
	if (channelConfig && typeof channelConfig === "object") {
		const exact = channelConfig[String(channelId)];
		if (exact && typeof exact === "object" && exact.enabled === false) return false;
		if (exact === false) return false;
		const wildcard = channelConfig["*"];
		if (wildcard && typeof wildcard === "object") return wildcard.enabled !== false;
		if (wildcard === false) return false;
		if (wildcard === true) return true;
		return Boolean(exact);
	}
	return isAllowed(channelId, channelConfig);
}

function openClawRoutingMode(surface, context = {}) {
	const channelId = String(context.channelId || context.channel_id || "");
	if (channelId && OPENCLAW_PRIMARY_CHANNELS.has(channelId)) return "primary";
	if (channelId && OPENCLAW_SHADOW_CHANNELS.has(channelId)) return "shadow";
	if (["legacy", "shadow", "primary"].includes(OPENCLAW_MODE)) return OPENCLAW_MODE;
	return SKIP_OPENCLAW ? "legacy" : "primary";
}

function trimMessage(text) {
	return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_INPUT_CHARS);
}

function trimAtSentenceBoundary(text, limit = MAX_REPLY_CHARS) {
	const value = String(text ?? "").trim();
	if (value.length <= limit) return value;
	const slice = value.slice(0, limit);
	const sentenceCut = Math.max(
		slice.lastIndexOf(". "),
		slice.lastIndexOf("! "),
		slice.lastIndexOf("? "),
		slice.lastIndexOf("\n\n"),
		slice.lastIndexOf("\n")
	);
	if (sentenceCut >= Math.floor(limit * 0.55)) return slice.slice(0, sentenceCut + 1).trim();
	const wordCut = slice.lastIndexOf(" ");
	return `${slice.slice(0, wordCut > 0 ? wordCut : limit).trim()}...`;
}

function isImageAttachment(att) {
	const mime = String(att?.content_type ?? att?.contentType ?? "").toLowerCase();
	const name = String(att?.filename ?? att?.name ?? "").toLowerCase();
	return mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(name);
}

function isInlineTextAttachment(att) {
	const mime = String(att?.content_type ?? att?.contentType ?? "").toLowerCase();
	const name = String(att?.filename ?? att?.name ?? "").toLowerCase();
	if (mime.startsWith("text/")) return true;
	if (/json|csv|xml|yaml|toml|markdown|javascript|typescript|x-python|x-sh|sql/.test(mime)) return true;
	return /\.(txt|md|markdown|json|jsonl|csv|tsv|xml|yml|yaml|toml|js|jsx|ts|tsx|py|sh|sql|log)$/i.test(name);
}

async function readAttachmentText(att) {
	const size = Number(att?.size ?? 0);
	if (size && size > MAX_ATTACHMENT_TEXT_BYTES) {
		return `[not inlined: ${size} bytes exceeds ${MAX_ATTACHMENT_TEXT_BYTES} byte inline limit]`;
	}
	const url = att?.url || att?.proxy_url;
	if (!url) return "[not inlined: no URL available]";
	try {
		const res = await fetch(url, { method: "GET" });
		if (!res.ok) return `[not inlined: fetch returned HTTP ${res.status}]`;
		const text = await res.text();
		return text.slice(0, MAX_ATTACHMENT_TEXT_CHARS);
	} catch (error) {
		return `[not inlined: ${String(error).slice(0, 160)}]`;
	}
}

async function buildAttachmentContext(attachments = []) {
	const list = Array.isArray(attachments) ? attachments : [];
	if (list.length === 0) return { systemBlocks: [], imageParts: [], summary: "" };
	const systemBlocks = [
		"## Files attached to the latest user message",
		"Treat these as direct conversation context. Discuss them naturally. Do not say you need a separate task just to inspect the attachment."
	];
	const imageParts = [];
	const summaryParts = [];
	for (const att of list.slice(0, 8)) {
		const filename = String(att?.filename ?? att?.name ?? "attachment").slice(0, 180);
		const mime = String(att?.content_type ?? att?.contentType ?? "application/octet-stream");
		const size = Number(att?.size ?? 0);
		const url = att?.url || att?.proxy_url || "";
		summaryParts.push(`${filename}${mime ? ` (${mime})` : ""}`);
		systemBlocks.push(`\n### ${filename}\nMIME: ${mime}\nSize: ${size || "unknown"} bytes${url ? `\nURL: ${url}` : ""}`);
		if (isImageAttachment(att) && url) {
			imageParts.push({ type: "image_url", image_url: { url } });
			systemBlocks.push("Image attachment was passed to the model as an image input.");
			continue;
		}
		if (isInlineTextAttachment(att)) {
			const text = await readAttachmentText(att);
			systemBlocks.push(`Content preview:\n\`\`\`\n${text}\n\`\`\``);
			continue;
		}
		systemBlocks.push("Binary/non-text attachment. Use available metadata now; deeper parsing requires the core extractor for this MIME type.");
	}
	return {
		systemBlocks: [systemBlocks.join("\n")],
		imageParts,
		summary: summaryParts.join(", ")
	};
}

function extractChatText(json) {
	return json?.choices?.[0]?.message?.content
		|| json?.choices?.[0]?.delta?.content
		|| json?.output_text
		|| "";
}

function textOnlyMessages(messages) {
	return messages.map((message) => {
		const content = message?.content;
		if (!Array.isArray(content)) return message;
		const text = content
			.map((part) => {
				if (part?.type === "text") return part.text ?? "";
				if (part?.type === "image_url") {
					const imageUrl = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
					return imageUrl ? `[image attachment: ${imageUrl}]` : "[image attachment]";
				}
				return "";
			})
			.filter(Boolean)
			.join("\n");
		return { ...message, content: text };
	});
}

function normalizeStylePunctuation(text) {
	let value = String(text ?? "");
	value = value.replace(/\\u2014/g, ", ").replace(/\\u2013/g, "-");
	value = value.replace(/\s*—+\s*/g, ", ");
	value = value.replace(/\s+–\s+/g, ", ");
	value = value.replace(/–/g, "-");
	value = value.replace(/\s+,/g, ",");
	value = value.replace(/,\s{2,}/g, ", ");
	value = value.replace(/^\s*,\s*/, "");
	value = value.replace(/([.!?]\s+),\s*/g, "$1");
	return value;
}

function sanitizeAssistantText(text) {
	let value = String(text ?? "");
	value = value.replace(/<\|[^|>]+?\|>/g, "");
	value = value.replace(/(?:^|\n)\s*<exec\b[^\n]*(?:\n|$)/gi, "\n");
	value = value.replace(/<file\b[^>]*>[\s\S]*?<\/file>/gi, "");
	value = value.replace(/^\s*<file\b[^\n]*(?:\n|$)/gim, "");
	value = value.replace(/<\/?(?:sessions?|session)\b[^>]*\/?\s*>/gi, "");
	value = stripInlineJsonToolObjects(value);
	value = value.replace(/<(?:read|write|edit|grep|glob|ls|bash|command|exec|file|session|sessions|tool|tools|tool_call|tool_use|tool_result|function|function_call|function_result)\b[^>]*\/\s*>/gi, "");
	value = value.replace(/<tool_(?:call|use|result)[\s\S]*?(?:<\/tool_(?:call|use|result)>|$)/gi, "");
	value = value.replace(/<(?:read|write|edit|grep|glob|ls|bash|command|exec|file|session|sessions|tool|tools|tool_call|tool_use|tool_result|function|function_call|function_result)\b[\s\S]*?(?:<\/(?:read|write|edit|grep|glob|ls|bash|command|exec|file|session|sessions|tool|tools|tool_call|tool_use|tool_result|function|function_call|function_result)>|$)/gi, "");
	value = value.replace(/<\/(?:read|write|edit|grep|glob|ls|bash|command|exec|file|session|sessions|tool|tools|tool_call|tool_use|tool_result|function|function_call|function_result)\s*>/gi, "");
	value = value.replace(/^\s*<path>\s*(?:\/(?:workspace|home|opt|root|tmp|var)\/[^<]+|[A-Za-z]:\\[^<]+)\s*<\/path>\s*$/gim, "");
	value = value.replace(/```(?:json|xml|tool|tools?|function_call|tool_code)?\s*[\s\S]*?(?:"tool_call"|"tool_use"|"function_call"|"recipient_name"|"exec_command"|"pearl-task-dispatch"|"pearl-swarm-dispatch"|<(?:exec|read|command)\b)[\s\S]*?```/gi, "");
	value = value.replace(/```(?:json|xml|tool|tools?|function_call|tool_code)?\s*```/gi, "");
	value = value.replace(/^\s*(?:\*\*)?(?:Step\s+\d+\s*:\s*)?(?:Check|Run|Execute)\b[^\n]*(?:\*\*)?\s*\n\s*```(?:bash|sh|shell|zsh)?\s*[\s\S]*?```\s*/gim, "");
	value = value.replace(/^\s*(?:exec|tool|function_call|recipient_name)\s+\/?[^\n]*(?:\n|$)/gim, "");
	value = value.replace(/^\s*(?:Dispatching to CLI|Loading memory context|Checking the actual|Let me check|I'?m checking|Now let me|Let me now|I will now|I'?m going to|First I'?ll|Next I'?ll|Let's see|Now I need to|I should first)[^\n]*(?:\n|$)/gim, "");
	value = value.replace(/(?:^|\n)\s*(?:Let me |Let's |I(?:'| a)?ll |I(?:'| a)m (?:going to |gonna )|Now I need to |I should |First[ ,]|Next[ ,]|Then[ ,])[^\n]*(?:\n|$)/gim, "");
	value = normalizeStylePunctuation(value);
	value = value.replace(/\b(?:through|via)\s+(?:my\s+)?(?:worker|agency|task|backend)\s+path\b/gi, "now");
	value = value.replace(/\n{3,}/g, "\n\n").trim();
	return value;
}

function stripInlineJsonToolObjects(text) {
	let value = String(text ?? "");
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
		const start = value.lastIndexOf("{", markerIndex);
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
			if (char === "\\") {
				escaped = true;
				continue;
			}
			if (char === "\"") {
				inString = !inString;
				continue;
			}
			if (inString) continue;
			if (char === "{") depth += 1;
			if (char === "}") {
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

function isProviderSchemaFailure(text) {
	const value = String(text ?? "").toLowerCase();
	if (!value) return false;
	return /\bllm request failed\b/.test(value)
		&& /\b(provider rejected|request schema|tool payload|tool schema|schema or tool)\b/.test(value);
}

function filterOpenClawToolErrors(text) {
	const value = String(text ?? "");
	if (isProviderSchemaFailure(value)) {
		return "";
	}
	if (/⚠️.*📨/.test(value) && /\b(session|send|failed|error|no session found)\b/i.test(value)) {
		return "A minor routing issue hit a background thread. Try that again when you have a second.";
	}
	if (/⚠️\s*(Agent|Subagent)\s+(failed|error)/i.test(value)) {
		return "A background task ran into trouble. Let me know if you want me to retry.";
	}
	if (/No session found/i.test(value) && /\d{10,}/.test(value)) {
		return "A routing glitch hit one of my background processes. Try sending that again.";
	}
	return value;
}

function looksLikeRawSearchDump(text) {
	const value = String(text ?? "");
	if (!value.trim()) return false;
	if (/\b(?:Top sources|search results?|URL\s*:|Summary\s*:|Snippet\s*:|Result\s+\d+\s*:)\b/i.test(value)) return true;
	const numberedUrlRows = value.match(/(?:^|\n)\s*\d+\.\s+[^\n]+\n\s*(?:Published\/age:\s*[^\n]+\n)?\s*URL:\s*https?:\/\/[^\n]+/gi) || [];
	return numberedUrlRows.length > 0;
}

function stripModelStatusLeaks(text) {
	return String(text ?? "")
		.replace(/^\s*(?:[A-Z][\w .'-]{0,40}\.\s*)?(?:(?:DeepSeek|Claude|GPT|Gemini|Kimi|Qwen|Grok|OpenRouter|pearl-llm)\b[^\n]{0,160}\b(?:instead of|default\s+(?:pearl-llm|model)|model\s+override|runtime\s+model|provider\s+route|just a heads up)\b[^\n]*)(?:\n|$)/gim, "")
		.trim();
}

function normalizeDiscordOutboundText(text) {
	let value = redactInternalIdentifiers(sanitizeAssistantText(text));
	value = naturalizeOpenClawSubagentAnnounce(value);
	value = stripOpenClawMachineData(value);
	value = filterOpenClawToolErrors(value);
	value = stripModelStatusLeaks(value);
	if (looksLikeRawSearchDump(value)) return "";
	value = value
		.replace(/\b(?:disp|run|task|session)-[a-f0-9][a-f0-9_.:-]{7,}\b/gi, "this task")
		.replace(/\b[a-f0-9]{32,64}\b/gi, "an internal reference")
		.replace(/^\s*(?:LLM request failed|provider rejected|rawError=|PROXY\s+\d{3}:).*(?:\n|$)/gim, "")
		.replace(/^(?!.*\b(?:workspace-write|danger-full-access|approval policy|permission mode|sandbox_permissions|require_escalated)\b)\s*(?:sandbox|connector|tool|executor|codex|claude)\b.*\b(?:failed|error|rejected|permission|denied|unavailable|not configured)\b.*(?:\n|$)/gim, "")
		.replace(/\bsandbox\b[^\n.!?]*\b(?:workspace-write|danger-full-access|approval policy|permission mode|sandbox_permissions|require_escalated)\b[^.!?\n]*(?:[.!?]|\n|$)/gi, "I hit a worker permissions problem before the task could finish cleanly. ")
		.replace(/(?:^|\n)\s*(?:Pearl(?:'s Agency)? says:\s*){2,}/gi, "Pearl's Agency says: ")
		.replace(/^\s*Pearl's Agency says:\s*Pearl(?:'s Agency)? says:\s*/i, "Pearl's Agency says: ")
		.replace(/\bteam\s+slack\b/gi, "Discord channel")
		.replace(/\bjust\s+timed\s+out\b/gi, "is taking longer than expected")
		.replace(/\btimed[_ -]?out\b/gi, "taking longer than expected")
		.replace(/\bin[_ -]?progress\b/gi, "in progress")
		.replace(/\bstatus\s*[:=]\s*/gi, "")
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\s+([.,;:!?])/g, "$1")
		.replace(/(?:\s*\.\s*){2,}/g, ". ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return value;
}

function naturalizeOpenClawSubagentAnnounce(text) {
	const value = String(text ?? "").trim();
	if (!isOpenClawSubagentAnnounce(value)) return value;
	const lower = value.toLowerCase();
	if (/\btimed[_ -]?out\b|\btimeout\b/.test(lower)) {
		return "A background task is taking longer than expected. I'll keep watching it.";
	}
	if (/\b(?:completed|complete|finished|succeeded|success)\b/.test(lower)) {
		return "A background task finished.";
	}
	if (/\b(?:failed|failure|errored|error)\b/.test(lower)) {
		return "A background task failed.";
	}
	if (/\b(?:cancelled|canceled)\b/.test(lower)) {
		return "A background task was cancelled.";
	}
	if (/\b(?:queued|pending|waiting)\b/.test(lower)) {
		return "A background task is queued.";
	}
	if (/\b(?:started|running|in[_ -]?progress|working)\b/.test(lower)) {
		return "A background task is running.";
	}
	return "A background task was updated.";
}

function isOpenClawSubagentAnnounce(text) {
	const value = String(text ?? "");
	const hasSubagentMarker = /\bsubagent\b|\bagent:main:subagent\b/i.test(value);
	const hasTimestamp = /\[[A-Z][a-z]{2}\s+\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?\s+UTC\]|\[\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/i.test(value);
	const hasMachineData = /\bsession[_ -]?key\b|\bsessionKey\b|\bstats\s*:|\btokens?\s*[:=]?\s*[\d.]+k?\b|\bruntime\s*[:=]?\s*\d/i.test(value);
	const hasAnnounceVerb = /\b(?:queued|pending|started|running|in[_ -]?progress|completed|finished|succeeded|failed|errored|cancelled|canceled|timed[_ -]?out|timeout|updated)\b/i.test(value);
	const hasTaskNameDump = /\bsubagent\s+task\s*["'][^"']+["']/i.test(value);
	return hasSubagentMarker && hasAnnounceVerb && (hasMachineData || hasTimestamp || hasTaskNameDump);
}

function stripOpenClawMachineData(text) {
	return String(text ?? "")
		.replace(/\[[A-Z][a-z]{2}\s+\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?\s+UTC\]\s*/g, "")
		.replace(/\[\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?\s*(?:UTC)?\]\s*/gi, "")
		.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "")
		.replace(/\bsession[_ -]?key\s*[:=]?\s*[\w:./@-]+/gi, "")
		.replace(/\bsessionKey\s*[:=]?\s*[\w:./@-]+/g, "")
		.replace(/\bagent:main:subagent:[\w.-]+\b/gi, "")
		.replace(/\b(?:input|output|total|prompt|completion)?\s*tokens?\s*[:=]?\s*[\d.]+k?\b/gi, "")
		.replace(/\bruntime\s*[:=]?\s*\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|seconds|m|min|mins|minutes)\b/gi, "")
		.replace(/\belapsed\s*[:=]?\s*\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|seconds|m|min|mins|minutes)\b/gi, "")
		.replace(/\best(?:imated)?\s*(?:cost)?\s*[:=]?\s*\$[\d.]+\b/gi, "")
		.replace(/\bcost\s*[:=]?\s*\$[\d.]+\b/gi, "")
		.replace(/\bstats\s*:\s*(?:(?:runtime|tokens?|est|cost)\s*[:=]?\s*[\d.$]+(?:\s*(?:ms|s|sec|secs|seconds|m|min|mins|minutes|k))?\s*[ ,;|•·]*)+/gi, "")
		.replace(/\bfindings\s*:\s*\([^)]*\)/gi, "")
		.replace(/\bfindings\s*:\s*(?:no output|none|n\/a)\b/gi, "")
		.replace(/\braw\s+status\s*[:=]\s*[\w.-]+\b/gi, "")
		.replace(/\bstatus\s*[:=]\s*(queued|pending|running|in_progress|completed|failed|cancelled|canceled|timed_out)\b/gi, "$1")
		.trim();
}

function redactInternalIdentifiers(text) {
	let value = String(text ?? "");
	value = value.replace(/\bdisp-[a-z0-9-]{6,}\b/gi, "the task");
	value = value.replace(/\brun[-_ ][a-z0-9-]{6,}\b/gi, "the task");
	value = value.replace(/\btask[-_ ](?:id|ids)\s*[:#]?\s*[a-z0-9-]{6,}\b/gi, "task reference");
	value = value.replace(/\brun[-_ ](?:id|ids)\s*[:#]?\s*[a-z0-9-]{6,}\b/gi, "task reference");
	value = value.replace(/\bdispatch[-_ ](?:id|ids)\s*[:#]?\s*[a-z0-9-]{6,}\b/gi, "task reference");
	value = value.replace(/\b[a-f0-9]{7,40}\b/gi, (match) => {
		if (!/[a-f]/i.test(match) || !/\d/.test(match)) return match;
		return "[internal reference]";
	});
	return value;
}

function fileTail(file, maxChars = 200000) {
	try {
		const stat = fs.statSync(file);
		const start = Math.max(0, stat.size - maxChars);
		const fd = fs.openSync(file, "r");
		const buffer = Buffer.alloc(stat.size - start);
		fs.readSync(fd, buffer, 0, buffer.length, start);
		fs.closeSync(fd);
		return buffer.toString("utf8");
	} catch {
		return "";
	}
}

function latestTryCloudflareUrl(text) {
	const matches = [...String(text ?? "").matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi)].map((m) => m[0]);
	return matches.length ? matches[matches.length - 1] : null;
}

function originFromText(text) {
	const settings = String(text ?? "").match(/url:(http:\/\/localhost:\d+)/);
	if (settings) return settings[1];
	const cmd = String(text ?? "").match(/--url\s+(http:\/\/localhost:\d+)/);
	return cmd ? cmd[1] : null;
}

function activeCloudflareTunnels() {
	const tunnels = new Map();
	for (const file of CLOUDFLARE_LOG_CANDIDATES) {
		const text = fileTail(file);
		const url = latestTryCloudflareUrl(text);
		const origin = originFromText(text);
		if (url && origin) tunnels.set(origin, { origin, url, source: file });
	}
	try {
		for (const pid of fs.readdirSync("/proc")) {
			if (!/^\d+$/.test(pid)) continue;
			const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
			if (!cmdline.includes("cloudflared tunnel --url")) continue;
			const origin = originFromText(cmdline);
			const fd2 = fs.readlinkSync(`/proc/${pid}/fd/2`);
			const text = fileTail(fd2);
			const url = latestTryCloudflareUrl(text);
			if (url && origin) tunnels.set(origin, { origin, url, source: fd2 });
		}
	} catch {
		// Best effort only. If /proc is unavailable, the static log candidates above still work.
	}
	return [...tunnels.values()].sort((a, b) => a.origin.localeCompare(b.origin));
}

function wantsOperationalContext(content) {
	const text = trimMessage(content).toLowerCase();
	if (!text) return false;
	if (/\b(codex|claude|openclaw|agency boss|worker|silver streak)\b/.test(text)
		&& /\b(status|update|progress|connect|connected|check in|checking in|running|picked up|executing|blocked|failed|finished|completed)\b/.test(text)) {
		return true;
	}
	if (/\b(build|release|version|codename|commit|branch|staging|status)\b/.test(text)
		&& /\b(pearl|pearlos|build|release|version|codename|commit|branch|staging|deploy|deployment|app|interface)\b/.test(text)) {
		return true;
	}
	if (/\b(task|tasks|job|jobs|dispatch|dispatched|running|finished|completed|failed|follow[- ]?up|active jobs|what finished|what is running|what's running)\b/.test(text)) {
		return true;
	}
	if (/\b(cloudflare|trycloudflare|cf)\b/.test(text) && /\b(url|link|tunnel|latest)\b/.test(text)) {
		return true;
	}
	if (/\b(url|link|preview|deploy|deployment)\b/.test(text) && /\b(pearlos|staging|stage|branch|site|app)\b/.test(text)) {
		return true;
	}
	if (/\b(staging branch|current branch|active branch|git branch)\b/.test(text)) {
		return true;
	}
	return (
		/\bwhat can you connect\b/.test(text)
		|| (/\bbackend\b/.test(text) && /\b(openclaw|connect|access|available|reachable)\b/.test(text))
		|| (/\bopenclaw\b/.test(text) && /\b(connect|backend|access|available|reachable)\b/.test(text))
	);
}

const STALE_BUILD_NAMES = [
	"GENERATION PAINT",
	"GOLD VISION",
	"GOLD-SILVER-SPRINGS-v3",
	"GOLDEN VOICE WORKING",
	"GOLDEN HORIZON",
	"GOLD STANDARD",
	"gold-2026-03-03",
	"pearl/next-gen-ui",
	"pearlos-candidate",
	"Joyboy"
];

function buildQuietRuntimeGuard(content) {
	if (wantsOperationalContext(content)) return null;
	const text = trimMessage(content);
	if (!text) return null;
	return [
		"Social-channel runtime guard:",
		"- This user message did not ask for build, deployment, backend, or task status.",
		"- Reply conversationally. Do not mention build codenames, PM2, staging status, backend health, or task machinery.",
		"- Never call any remembered build codename current unless a live build manifest was loaded for this turn and confirms it.",
		`- Historical/stale build names include: ${STALE_BUILD_NAMES.join(", ")}.`
	].join("\n");
}

function isTaskFollowupRequest(content) {
	const text = trimMessage(content).toLowerCase();
	if (!text) return false;
	const taskWords = /\b(agency|agency boss|codex|claude|openclaw|worker|task|tasks|job|jobs|dispatch|dispatched|research|report|test page|silver streak|status|done|finish|finished|complete|completed|failed|running|pending|taking so long|what happened)\b/.test(text);
	const followupShape = /\b(did|does|is|are|was|were|what|where|when|why|show|see|give|get|send|pull|check|connect|report|status|latest|update|progress)\b/.test(text);
	return taskWords && followupShape;
}

function isBareUpdateRequest(content) {
	const text = trimMessage(content).toLowerCase();
	return /^(?:any\s+)?(?:update|updates|progress|status|anything yet|news)\??$/.test(text);
}

function isTaskishPreviousRequest(content) {
	const text = trimMessage(content).toLowerCase();
	return /\b(agency|agent|task|research|lookup|look up|search|find|track down|investigate|report|dispatch|queued|running)\b/.test(text);
}

async function fetchJson(url, init, timeoutMs = 30000) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { ...init, signal: controller.signal });
		const text = await res.text();
		let json = null;
		try {
			json = text ? JSON.parse(text) : null;
		} catch {
			json = { raw: text };
		}
		if (!res.ok) {
			const detail = typeof text === "string" ? text.slice(0, 500) : "";
			throw new Error(`HTTP ${res.status} ${detail}`);
		}
		return json;
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchOpenClawModels() {
	const cfg = activeConfig();
	const gatewayToken = cfg?.gateway?.auth?.token;
	if (!gatewayToken) return [];
	try {
		const json = await fetchJson("http://127.0.0.1:18789/v1/models", {
			method: "GET",
			headers: { "authorization": `Bearer ${gatewayToken}` }
		}, 3000);
		return Array.isArray(json?.data) ? json.data.map((model) => String(model.id ?? "")).filter(Boolean) : [];
	} catch (error) {
		warn("discord", "model list failed", { error: String(error).slice(0, 160) });
		return [];
	}
}

async function fetchBuildManifest() {
	try {
		const manifest = await fetchJson("http://127.0.0.1:3000/api/health/build", {
			method: "GET",
			headers: { "content-type": "application/json" }
		}, 2500);
		const parts = [
			manifest?.codename ? `codename=${manifest.codename}` : "",
			manifest?.commitSha ? `builtCommit=${manifest.commitSha}` : "",
			manifest?.nextBuildId ? `nextBuildId=${manifest.nextBuildId}` : "",
			manifest?.buildTime ? `buildTime=${manifest.buildTime}` : ""
		].filter(Boolean);
		return parts.length ? `Live build manifest: ${parts.join(", ")}` : "Live build manifest: reachable but incomplete";
	} catch (error) {
		return `Live build manifest: not confirmed (${String(error).slice(0, 120)})`;
	}
}

function summarizeTask(task) {
	const title = String(task?.title || task?.task || task?.id || "untitled task").replace(/\s+/g, " ").trim();
	const shortTitle = title.length > 90 ? `${title.slice(0, 87)}...` : title;
	const bits = [
		task?.status ? `status=${task.status}` : "",
		task?.assignee ? `assignee=${task.assignee}` : "",
		task?.timestamp_updated ? `updated=${task.timestamp_updated}` : "",
		task?.completed_at ? `completed=${task.completed_at}` : ""
	].filter(Boolean);
	const result = String(task?.result || task?.last_failure_result || "").replace(/\s+/g, " ").trim();
	const shortResult = result ? ` result=${result.slice(0, 220)}${result.length > 220 ? "..." : ""}` : "";
	return `- ${shortTitle} (${bits.join(", ")})${shortResult}`;
}

async function fetchTaskGroups(headers = {}) {
	const statuses = ["in_progress", "pending", "completed", "failed"];
	return await Promise.all(statuses.map(async (status) => {
		try {
			const json = await fetchJson(`${TASKS_API_URL}?status=${encodeURIComponent(status)}&limit=15`, {
				method: "GET",
				headers
			}, 3000);
			const tasks = Array.isArray(json?.tasks) ? json.tasks : [];
			return { status, count: Number(json?.count ?? tasks.length), tasks };
		} catch (error) {
			return { status, error: String(error).slice(0, 120), count: 0, tasks: [] };
		}
	}));
}

async function fetchTaskSnapshot(headers = {}) {
	const groups = await fetchTaskGroups(headers);
	const lines = [
		"Live PearlOS task snapshot from /api/tasks:",
		...groups.flatMap((group) => {
			if (group.error) return [`${group.status}: not confirmed (${group.error})`];
			if (!group.tasks.length) return [`${group.status}: ${group.count || 0}`];
			return [
				`${group.status}: ${group.count}`,
				...group.tasks.map(summarizeTask)
			];
		}),
		"Task follow-up rule: if the user asks about a task, use the snapshot to answer from the title, status, result, and latest notes, but task IDs, run IDs, dispatch IDs, hashes, and any other system-generated identifiers must never be shown or spoken to the user. Describe what the task did in plain language only, with no IDs, no hashes, and no run references. If a task failed, say it failed and offer the concrete next action: rerun a smaller scoped task, inspect logs or notes, or continue the work from the existing task context. If a task is in_progress, say it is still running and summarize latest notes. Do not invent hidden task progress."
	];
	return lines.join("\n");
}

function wantsActiveTaskStatus(content) {
	const text = trimMessage(content).toLowerCase();
	return /\b(agency|agency boss|codex|claude|openclaw|worker|task|tasks|job|jobs)\b/.test(text)
		&& /\b(working on|running|active|atm|right now|currently|pending|queue|queued|status)\b/.test(text);
}

function wantsAgencyBossStatus(content) {
	const text = trimMessage(content).toLowerCase();
	if (!text) return false;
	return /\b(codex|claude|openclaw|agency boss|worker|silver streak|qa list|qa board|qa item|qa items)\b/.test(text)
		&& /\b(status|update|progress|check in|checking in|connect|connected|picked up|executing|running|blocked|finished|completed|failed|made on qa|progress has been made)\b/.test(text);
}

function formatTaskTitle(task) {
	const title = String(task?.title || task?.task || "untitled task").replace(/\s+/g, " ").trim();
	return title.length > 110 ? `${title.slice(0, 107)}...` : title;
}

function titleFromTaskRequest(text, prefix = "") {
	const prefixText = trimMessage(prefix).replace(/[:\s]+$/g, "");
	if (/lookup|research|search/i.test(prefixText)) return "Discord research follow-up";
	if (/repair|fix/i.test(prefixText)) return "Discord repair follow-up";
	return "Discord Agency task";
}

async function answerActiveTaskStatus(config) {
	const groups = await fetchTaskGroups(taskAuthHeaders(config));
	const runningGroup = groups.find((group) => group.status === "in_progress");
	const pendingGroup = groups.find((group) => group.status === "pending");
	const running = runningGroup?.tasks || [];
	const pending = pendingGroup?.tasks || [];
	const errors = groups.filter((group) => group.error);
	if (errors.length && running.length === 0 && pending.length === 0) {
		return `I can't read the task board cleanly right now. ${errors.map((group) => `${group.status}: ${group.error}`).join("; ")}`;
	}
	const lines = [];
	if (running.length) {
		lines.push(`${running.length} running:`);
		lines.push(...running.map((task) => `- ${formatTaskTitle(task)}`));
	}
	if (pending.length) {
		lines.push(`${pending.length} pending:`);
		lines.push(...pending.map((task) => `- ${formatTaskTitle(task)}`));
	}
	if (!lines.length) return "Nothing active right now.";
	return lines.join("\n");
}

function statusTaskSearchText(task) {
	return [
		task?.title,
		task?.full_title,
		task?.task,
		task?.result,
		task?.swarm_category,
		Array.isArray(task?.agents) ? task.agents.join(" ") : "",
		task?.assignee,
	].filter(Boolean).join("\n").toLowerCase();
}

function scoreTaskForStatusQuery(task, content) {
	const query = trimMessage(content).toLowerCase();
	const text = statusTaskSearchText(task);
	let score = 0;
	if (/\bsilver streak\b/.test(query) && /\bsilver streak\b/.test(text)) score += 8;
	if (/\bqa\b/.test(query) && /\b(?:qa rapid fire|#qa|qa status|qa board|qa item)\b/.test(text)) score += 6;
	if (/\bcodex\b/.test(query) && /\bcodex\b/.test(text)) score += 5;
	if (/\bclaude\b/.test(query) && /\bclaude\b/.test(text)) score += 4;
	if (/\bstyle|styles|openrouter|image\b/.test(query) && /\bstyle|styles|openrouter|image\b/.test(text)) score += 5;
	if (/\b(?:qa rapid fire|silver streak|current qa|qa status|style creation|openrouter 401|mobile launcher|pulse mobile|filespace markdown|agency dispatch|bottom task toast)\b/.test(text)) score += 4;
	if (task?.status === "in_progress" || task?.status === "pending") score += 2;
	if (task?.result) score += 1;
	return score;
}

function taskUpdatedTime(task) {
	return Date.parse(task?.timestamp_updated || task?.completed_at || task?.timestamp_created || "") || 0;
}

function shortPublicTaskTitle(task) {
	const title = redactInternalIdentifiers(String(task?.title || task?.full_title || task?.task || "Agency task"))
		.replace(/^QA Rapid Fire:\s*/i, "")
		.replace(/\s+/g, " ")
		.trim();
	return title.length > 90 ? `${title.slice(0, 87)}...` : title;
}

function shortPublicTaskResult(task) {
	const result = redactInternalIdentifiers(normalizeDiscordOutboundText(String(task?.result || task?.last_failure_result || "")))
		.replace(/\s+/g, " ")
		.trim();
	if (!result) return "";
	return trimAtSentenceBoundary(result, 360);
}

async function fetchRecentTasksForStatus(config) {
	const groups = await fetchTaskGroups(taskAuthHeaders(config));
	return groups.flatMap((group) => group.tasks || []);
}

async function answerAgencyBossStatus(config, content) {
	const tasks = await fetchRecentTasksForStatus(config);
	const ranked = tasks
		.map((task) => ({ task, score: scoreTaskForStatusQuery(task, content) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || taskUpdatedTime(b.task) - taskUpdatedTime(a.task))
		.map((entry) => entry.task)
		.slice(0, 6);
	const connectivityQuestion = /\b(?:able to connect|connect to|connected to)\b/i.test(content)
		&& /\b(?:codex|claude|agency boss|worker)\b/i.test(content);
	const prefix = connectivityQuestion
		? "I can read the tracked Agency/Codex task board and report results from it. I cannot attach this Discord thread to a live interactive Codex CLI session unless the work is running through that tracked path."
		: "Here is the tracked Agency/Codex status I can see:";
	if (!ranked.length) {
		return `${prefix}\n\nI do not see a matching tracked task yet. The recovery move is to queue or rerun the work as a tracked Agency task so Pearl can report progress back here.`;
	}
	const active = ranked.filter((task) => ["pending", "in_progress"].includes(String(task.status)));
	const terminal = ranked.filter((task) => ["completed", "failed", "cancelled"].includes(String(task.status)));
	const lines = [prefix];
	if (active.length) {
		lines.push("", "Active:");
		for (const task of active.slice(0, 3)) {
			lines.push(`- ${shortPublicTaskTitle(task)} is ${String(task.status).replace("_", " ")}.`);
		}
	}
	if (terminal.length) {
		lines.push("", "Latest results:");
		for (const task of terminal.slice(0, 4)) {
			const result = shortPublicTaskResult(task);
			const status = String(task.status || "updated").replace("_", " ");
			lines.push(`- ${shortPublicTaskTitle(task)}: ${status}${result ? `. ${result}` : "."}`);
		}
	}
	return trimAtSentenceBoundary(lines.join("\n"), 1800);
}

async function answerTaskFollowup({ config, msg, content }) {
	if (wantsAgencyBossStatus(content)) {
		if (!isDiscordStatusContextTrusted(msg)) return null;
		return await answerAgencyBossStatus(config, content);
	}
	if (wantsActiveTaskStatus(content)) {
		if (!isDiscordStatusContextTrusted(msg)) return null;
		return await answerActiveTaskStatus(config);
	}
	if (!isTrustedDiscordContext(msg)) return null;
	const headers = taskAuthHeaders(config);
	const taskContext = [
		await fetchTaskSnapshot(headers),
		"Hard routing rule: Blair is asking about existing work, research, a report, or why a promised answer has not arrived. Answer from the task snapshot and recent Discord history. Do not create a new task unless the snapshot proves there is no existing work to report and the user explicitly asks to start or rerun it.",
		"If a completed result answers the question, give the answer directly. If no result is visible, say that plainly and give the next concrete recovery step."
	].join("\n\n");
	return await callPearl({
		surface: "discord",
		sessionKey: discordSessionKey(msg.guild_id, msg.channel_id, "task-followup"),
		text: content,
		author: msg.author?.username,
		context: {
			authorId: msg.author?.id,
			authorName: msg.author?.username,
			guildId: msg.guild_id,
			channelId: msg.channel_id
		},
		extraSystemContext: [taskContext],
		attachments: msg.attachments
	});
}

async function probe(name, url) {
	try {
		await fetchJson(url, { method: "GET", headers: { "content-type": "application/json" } }, 2500);
		return `${name}: reachable (${url})`;
	} catch (error) {
		return `${name}: not confirmed (${String(error).slice(0, 120)})`;
	}
}

async function tcpProbe(name, host, port) {
	return await new Promise((resolve) => {
		const socket = net.createConnection({ host, port });
		const timeout = setTimeout(() => {
			socket.destroy();
			resolve(`${name}: not confirmed (TCP timeout on ${host}:${port})`);
		}, 1500);
		socket.once("connect", () => {
			clearTimeout(timeout);
			socket.destroy();
			resolve(`${name}: reachable (TCP ${host}:${port})`);
		});
		socket.once("error", (error) => {
			clearTimeout(timeout);
			resolve(`${name}: not confirmed (${String(error).slice(0, 120)})`);
		});
	});
}

function gitSummary() {
	try {
		const branch = execFileSync("git", ["branch", "--show-current"], { cwd: SOURCE_DIR, encoding: "utf8", timeout: 1500 }).trim();
		const commit = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: SOURCE_DIR, encoding: "utf8", timeout: 1500 }).trim();
		return `${branch || "detached"} @ ${commit}`;
	} catch (error) {
		return `not confirmed (${String(error).slice(0, 120)})`;
	}
}

async function buildOperationalContext(text, context = {}) {
	if (!wantsOperationalContext(text)) return null;
	const cfg = activeConfig();
	const headers = taskAuthHeaders(cfg);
	const tunnels = activeCloudflareTunnels();
	const tunnelLines = tunnels.length
		? tunnels.map((t) => `- ${t.origin} -> ${t.url}`).join("\n")
		: "- No active trycloudflare URLs found in local tunnel logs";
	const checks = await Promise.all([
		probe("Web interface", "http://127.0.0.1:3000/api/health"),
		fetchBuildManifest(),
		fetchTaskSnapshot(headers),
		probe("OpenClaw gateway", "http://127.0.0.1:18789/health"),
		fetchJson(`${TASKS_API_URL}?limit=1`, { method: "GET", headers }, 2500)
			.then(() => `Pipecat/Bot gateway: reachable (${TASKS_API_URL})`)
			.catch((error) => `Pipecat/Bot gateway: not confirmed (${String(error).slice(0, 120)})`),
		tcpProbe("DeepSeek proxy", "127.0.0.1", 8200)
	]);
	return [
		"Live PearlOS backend context gathered by the relay before replying:",
		...checks.map((line) => `- ${line}`),
		`- Source branch: ${gitSummary()}`,
		`- Build-status rule: the live build manifest and current git summary are authoritative. Treat old memory entries and stale build names such as ${STALE_BUILD_NAMES.join(", ")} as historical unless this live manifest confirms them.`,
		"- Repair state: background agent dispatch is available through the PearlOS task system. The Agency Boss setting chooses Codex or Claude at runtime. Some social channels may be owned by native OpenClaw instead of this relay, so do not guess the channel path without live evidence.",
		"Active Cloudflare tunnels:",
		tunnelLines,
		"If the user asks for the latest PearlOS staging URL, prefer the active web interface tunnel for http://127.0.0.1:3000 when it is present. Mention pearlos.app only when the user asks for the public production domain.",
		"Use this live context as authoritative over memory or public docs when the user asks about PearlOS, staging, tools, tasks, or backend state. Treat it as quiet background context for casual conversation; do not turn every greeting into an ops status report. Do not invent unavailable access, and do not describe yourself as isolated if the context shows reachable services."
	].join("\n");
}

function shouldLoadPrivateMemory(context = {}) {
	const scope = resolvePrivateMemoryScope(context);
	if (!scope) return false;
	if (context.surface === "discord") {
		if (!context.guildId) return true;
		if (String(context.guildId) !== TRUSTED_DISCORD_GUILD_ID) return false;
		return TRUSTED_DISCORD_CHANNELS.has(String(context.channelId));
	}
	if (context.surface === "telegram") return context.chatType === "private";
	return context.surface === "web" || context.surface === "voice";
}

function safeComponent(value) {
	const cleaned = String(value || "").trim().replace(/[^a-zA-Z0-9._@+-]+/g, "_").slice(0, 180);
	return cleaned.replace(/^[._-]+|[._-]+$/g, "") || "unknown";
}

function normalizePrivateMemoryScope(scope) {
	const tenantId = String(scope?.tenantId || scope?.tenant_id || "").trim();
	const userId = String(scope?.userId || scope?.user_id || "").trim();
	if (!tenantId || !userId) return null;
	return {
		tenantId,
		userId,
		userEmail: String(scope?.userEmail || scope?.user_email || scope?.email || "").trim().toLowerCase()
	};
}

function scopedPrivateMemoryDir(scope) {
	return path.join(USER_MEMORY_ROOT, safeComponent(scope.tenantId), safeComponent(scope.userId));
}

function loadDiscordIdentityLinks() {
	const explicit = readJson(DISCORD_IDENTITY_LINKS_PATH) ?? {};
	const links = {
		users: { ...(explicit.users || {}) },
		usernames: { ...(explicit.usernames || {}) }
	};
	if (process.env.PEARL_DISCORD_IDENTITY_LINKS) {
		try {
			const envLinks = JSON.parse(process.env.PEARL_DISCORD_IDENTITY_LINKS);
			Object.assign(links.users, envLinks.users || {});
			Object.assign(links.usernames, envLinks.usernames || {});
		} catch (error) {
			warn("relay", "invalid PEARL_DISCORD_IDENTITY_LINKS", { error: String(error).slice(0, 180) });
		}
	}
	return links;
}

function resolvePrivateMemoryScope(context = {}) {
	const direct = normalizePrivateMemoryScope(context);
	if (direct) return direct;
	if (context.surface === "discord") {
		const links = loadDiscordIdentityLinks();
		const authorId = String(context.authorId || context.discordUserId || "").trim();
		if (authorId && links.users?.[authorId]) return normalizePrivateMemoryScope(links.users[authorId]);
		for (const key of [context.authorName, context.authorUsername, context.authorLabel]) {
			const normalized = String(key || "").trim().toLowerCase();
			if (normalized && links.usernames?.[normalized]) return normalizePrivateMemoryScope(links.usernames[normalized]);
		}
	}
	return null;
}

function buildPrivateMemoryContext(context = {}) {
	const scope = resolvePrivateMemoryScope(context);
	if (!scope || !shouldLoadPrivateMemory({ ...context, ...scope })) return null;
	const root = scopedPrivateMemoryDir(scope);
	const files = [
		["Pearl scoped user profile", path.join(root, "USER.md"), 5000],
		["Pearl scoped durable user facts", path.join(root, "USER_FACTS.md"), 12000],
		["Pearl scoped long-term memory", path.join(root, "MEMORY.md"), 18000],
		["Pearl scoped activity log", path.join(root, "activity-log.md"), 8000],
		["Pearl scoped skill preferences", path.join(root, "skills.md"), 7000]
	];
	const sections = files
		.map(([label, file, max]) => {
			const text = readText(file, max);
			return text ? `## ${label}\n${text}` : "";
		})
		.filter(Boolean);
	if (sections.length === 0) return null;
	const sender = [
		context.authorName ? `name=${context.authorName}` : "",
		context.authorId ? `discord_id=${context.authorId}` : "",
		context.guildId ? `guild_id=${context.guildId}` : "",
		context.channelId ? `channel_id=${context.channelId}` : ""
	].filter(Boolean).join(" ");
	return [
		"Private PearlOS memory/context is loaded only for this authenticated tenant/user scope.",
		sender ? `Current sender/context: ${sender}` : "",
		"Use this memory naturally and respectfully for this actor only. Never apply it to another tenant, user, channel, or untrusted/public conversation. If the user asks what you know about them, answer from this loaded memory instead of claiming you have no memory. Do not dump private details unnecessarily; summarize what is relevant and warm.",
		"If a personal fact is not present in the loaded memory, say that plainly. Do not claim you can remember it unless the current relay has written it to durable user facts.",
		"Only say a file is loaded if it appears in this private context. Do not claim root workspace memory, CLAUDE.md, HANDOFF.md, or global MEMORY.md are loaded.",
		"Do not reveal this private memory in untrusted/public contexts.",
		...sections
	].filter(Boolean).join("\n\n");
}

function readDiscordHistoryState() {
	const state = readStateFile("discord-history.json", { channels: {} });
	if (!state.channels || typeof state.channels !== "object") state.channels = {};
	return state;
}

function discordHistoryKey(guildId, channelId) {
	return discordConversationKey(guildId, channelId);
}

function compactDiscordHistoryTurn(turn) {
	const role = turn?.role === "assistant" ? "Pearl" : String(turn?.author || "User");
	const text = trimMessage(turn?.text || "");
	return text ? `${role}: ${text}` : "";
}

function rememberDiscordTurn({ guildId, channelId, role, author, text }) {
	const clean = trimMessage(text);
	if (!clean) return;
	const state = readDiscordHistoryState();
	const key = discordHistoryKey(guildId, channelId);
	const existing = Array.isArray(state.channels[key]?.turns) ? state.channels[key].turns : [];
	const turns = [
		...existing,
		{
			role: role === "assistant" ? "assistant" : "user",
			author: String(author || (role === "assistant" ? "Pearl" : "User")).slice(0, 80),
			text: clean.slice(0, MAX_REPLY_CHARS),
			at: now()
		}
	].slice(-DISCORD_HISTORY_MAX_TURNS);
	state.channels[key] = { updatedAt: now(), turns };
	writeStateFile("discord-history.json", state);
}

function clearDiscordHistory(guildId, channelId) {
	const state = readDiscordHistoryState();
	delete state.channels[discordHistoryKey(guildId, channelId)];
	writeStateFile("discord-history.json", state);
}

function buildDiscordHistoryContext(context = {}) {
	if (context.surface !== "discord") return null;
	const state = readDiscordHistoryState();
	const turns = state.channels[discordHistoryKey(context.guildId, context.channelId)]?.turns;
	if (!Array.isArray(turns) || turns.length === 0) return null;
	const lines = [];
	let total = 0;
	for (const turn of turns.slice(-DISCORD_HISTORY_MAX_TURNS).reverse()) {
		const line = compactDiscordHistoryTurn(turn);
		if (!line) continue;
		total += line.length + 1;
		if (total > DISCORD_HISTORY_MAX_CHARS) break;
		lines.push(line);
	}
	if (lines.length === 0) return null;
	return [
		"Recent Discord conversation history for continuity. Use it to remember what was just said, answer follow-ups, and avoid repeating startup/status boilerplate.",
		"Do not expose this as a transcript unless asked.",
		...lines.reverse()
	].join("\n");
}

function recentDiscordHistoryText(guildId, channelId, maxTurns = 10, maxChars = 3000) {
	const state = readDiscordHistoryState();
	const turns = state.channels[discordHistoryKey(guildId, channelId)]?.turns;
	if (!Array.isArray(turns) || turns.length === 0) return "";
	const lines = [];
	let total = 0;
	for (const turn of turns.slice(-maxTurns).reverse()) {
		const line = compactDiscordHistoryTurn(turn);
		if (!line) continue;
		total += line.length + 1;
		if (total > maxChars) break;
		lines.push(line);
	}
	return lines.reverse().join("\n");
}

function lastDiscordAssistantText(guildId, channelId) {
	const state = readDiscordHistoryState();
	const turns = state.channels[discordHistoryKey(guildId, channelId)]?.turns;
	if (!Array.isArray(turns) || turns.length === 0) return "";
	for (const turn of turns.slice().reverse()) {
		if (turn?.role === "assistant") return trimMessage(turn.text || "");
	}
	return "";
}

async function callPearl({ surface, sessionKey, text, author, context = {}, extraSystemContext = [], attachments = [] }) {
	const cfg = activeConfig();
	const gatewayToken = cfg?.gateway?.auth?.token;
	const providerKey = cfg?.models?.providers?.["pearl-llm"]?.apiKey;
	const openrouterKey = cfg?.models?.providers?.openrouter?.apiKey;
	const enrichedContext = { ...context, surface };
	const operationalContext = await buildOperationalContext(text, enrichedContext);
	const quietRuntimeGuard = buildQuietRuntimeGuard(text);
	const privateMemoryContext = buildPrivateMemoryContext(enrichedContext);
	const conversationHistoryContext = buildDiscordHistoryContext(enrichedContext);
	const attachmentContext = await buildAttachmentContext(attachments);
	const routingMode = openClawRoutingMode(surface, enrichedContext);
	const userText = `[${surface}] ${author ? `${author}: ` : ""}${trimMessage(text)}`;
	const userContent = attachmentContext.imageParts.length
		? [{ type: "text", text: userText }, ...attachmentContext.imageParts]
		: userText;
	const capabilityInstruction = routingMode === "legacy"
		? "Do not pretend to have a browser or local shell inside this chat model. The relay handles live lookups and task dispatch before your response. Do not narrate those mechanics unless Blair explicitly asks how it works."
		: "You are running through the OpenClaw agent loop. Use available OpenClaw tools, browser/search, memory, task, model routing, and delegation capabilities when the request needs them. Do not ask the user for permission to do ordinary lookup, task, or computer work; proceed, then report the result or create a durable follow-up if it will take longer.";
	const messages = [
		{
			role: "system",
			content: [
				"You are Pearl, replying through PearlOS production-repair chat relays.",
				"Be human, emotionally intelligent, warm, and direct. You are Blair's companion, not a status bot.",
				"For casual greetings, respond like a present friend: a little warmth, a little personality, and a simple invitation. Do not lead with relays, builds, backend state, task machinery, or remembered build codenames unless Blair asks about them.",
				"Keep answers natural and concise, but not sterile.",
				"Voice rules: no em dashes. Do not say 'let me', 'I'll dispatch', 'worker path', 'task API', 'backend path', 'give me a moment', or other generic assistant process narration. If live results or task results are available, just answer as Pearl.",
				"Do not use canned refusal or not-knowing catchphrases. If something is missing, say it plainly in normal language.",
				"If the user attaches an image, inspect the image input and answer from it. Do not claim you are text-only or that you cannot see images unless the vision route explicitly fails.",
				"Do not claim you are cut off from PearlOS. You have a fast relay path with OpenClaw gateway first and DeepSeek proxy fallback.",
				"Current repair truth: this relay can provide live PearlOS context and background agent dispatch through the PearlOS task system. The Agency Boss setting chooses Codex or Claude at runtime. Some social channels may be handled by native OpenClaw instead of this relay.",
				"Never mention the active runtime model, default model, provider, model override, proxy route, token usage, or fallback model in a Discord/social reply unless Blair explicitly asks about model routing.",
				"If asked operational questions about backend access, explain only what the live context confirms. Do not say you have no direct access to OpenClaw.",
				"You have live PearlOS staging context and the ability to delegate work through the Agency/Codex/Claude task path.",
				"Durable user memory is available only when scoped private memory has been explicitly loaded for this authenticated actor.",
				capabilityInstruction,
				"If asked for current news or latest real-world events, do not answer from stale model memory. Use current live lookup results when the relay supplies them. If no current results are supplied, say you need the live path fixed instead of inventing headlines.",
				"For factual recommendations, model capability claims, pricing, availability, documentation, product catalogs, or anything the user expects a simple web search to answer, do not guess from memory. Use supplied live lookup or task context. If neither is supplied, say you need to look it up instead of naming made-up options."
			].join(" ")
		},
		...(privateMemoryContext ? [{
			role: "system",
			content: privateMemoryContext
		}] : []),
		...(conversationHistoryContext ? [{
			role: "system",
			content: conversationHistoryContext
		}] : []),
		...(quietRuntimeGuard ? [{
			role: "system",
			content: quietRuntimeGuard
		}] : []),
		...(operationalContext ? [{
			role: "system",
			content: operationalContext
		}] : []),
		...extraSystemContext
			.map((content) => trimMessage(content))
			.filter(Boolean)
			.map((content) => ({ role: "system", content })),
		...attachmentContext.systemBlocks.map((content) => ({ role: "system", content })),
		{
			role: "user",
			content: userContent
		}
	];
	const body = JSON.stringify({
		model: MODEL,
		messages,
		stream: false,
		temperature: 0.7
	});
	const hasImages = attachmentContext.imageParts.length > 0;
	async function callOpenRouterVisionForReply() {
		if (!openrouterKey) throw new Error("Missing OpenRouter provider key for image vision");
		log(surface, "message contains images; routing through configured vision fallback", { model: VISION_MODEL });
		const visionJson = await fetchJson(OPENROUTER_CHAT_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"authorization": `Bearer ${openrouterKey}`,
				"HTTP-Referer": "https://pearlos.app",
				"X-Title": "PearlOS"
			},
			body: JSON.stringify({
				model: VISION_MODEL,
				messages,
				stream: false,
				temperature: 0.4
			})
		}, 35000);
		const visionReply = sanitizeAssistantText(extractChatText(visionJson));
		if (!visionReply.trim()) throw new Error("Empty DeepSeek vision response");
		return visionReply.trim().slice(0, MAX_REPLY_CHARS);
	}
	const useOpenClaw = gatewayToken && (routingMode === "primary" || hasImages);
	const shadowOpenClaw = gatewayToken && routingMode === "shadow" && !hasImages;
	async function callOpenClawForReply(timeoutMs = 35000) {
		const json = await fetchJson(OPENCLAW_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"authorization": `Bearer ${gatewayToken}`,
				"x-openclaw-session-key": sessionKey,
				"x-openclaw-channel": surface
			},
				body
			}, timeoutMs);
			const reply = filterOpenClawToolErrors(sanitizeAssistantText(extractChatText(json)));
			if (isProviderSchemaFailure(reply)) {
				throw new Error("OpenClaw provider schema/tool payload failure");
			}
			return reply;
		}
	if (shadowOpenClaw) {
		callOpenClawForReply(20000)
			.then((reply) => log(surface, "openclaw shadow reply", {
				mode: routingMode,
				channelId: enrichedContext.channelId || "",
				replyPreview: String(reply || "").replace(/\s+/g, " ").trim().slice(0, 240)
			}))
			.catch((error) => warn(surface, "openclaw shadow call failed", { error: String(error).slice(0, 160) }));
	}
	if (useOpenClaw) {
		try {
			if (hasImages) {
				log(surface, "message contains images; routing through OpenClaw primary", { model: MODEL });
			}
			const reply = await callOpenClawForReply();
			if (hasImages && /\b(context overflow|unknown variant `?image_url|model does not support images|cannot (?:see|view|inspect) images)\b/i.test(reply)) {
				throw new Error(`OpenClaw vision response was not usable: ${reply.slice(0, 160)}`);
			}
			if (reply.trim()) return reply.trim().slice(0, MAX_REPLY_CHARS);
		} catch (error) {
			warn(surface, hasImages ? "openclaw vision call failed; falling back to vision model" : "openclaw call failed; falling back to deepseek proxy", { error: String(error).slice(0, 160) });
		}
	}
	if (hasImages) {
		return await callOpenRouterVisionForReply();
	}
	if (!providerKey) throw new Error("Missing pearl-llm provider key for fallback");
	const fallbackJson = await fetchJson(DEEPSEEK_PROXY_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"authorization": `Bearer ${providerKey}`
		},
		body: JSON.stringify({
			model: REPAIR_MODEL,
			messages: textOnlyMessages(messages),
			stream: false,
			temperature: 0.7
		})
	}, 35000);
	const fallback = sanitizeAssistantText(extractChatText(fallbackJson));
	if (!fallback.trim()) throw new Error("Empty model response");
	return fallback.trim().slice(0, MAX_REPLY_CHARS);
}

async function discordApi(token, route, init = {}) {
	return fetchJson(`https://discord.com/api/v10${route}`, {
		...init,
		headers: {
			"authorization": `Bot ${token}`,
			"content-type": "application/json",
			...(init.headers ?? {})
		}
	}, 30000);
}

async function acknowledgeDiscordInteraction(interaction) {
	return await fetchJson(`https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type: 5 })
	}, 2500);
}

async function editDiscordInteraction(applicationId, token, content) {
	const cleanContent = trimAtSentenceBoundary(normalizeDiscordOutboundText(content), MAX_REPLY_CHARS) || "I couldn't produce a reply.";
	return await fetchJson(`https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			content: cleanContent,
			allowed_mentions: { parse: [] }
		})
	}, 30000);
}

function discordApprovers(config) {
	const values = config?.channels?.discord?.execApprovals?.approvers;
	return Array.isArray(values) ? values.map(String) : [];
}

function canUseDiscordDelegation(config, msg) {
	const approvers = discordApprovers(config);
	if (approvers.length === 0) return false;
	return approvers.includes(String(msg?.author?.id ?? ""));
}

function normalizeChannelName(name) {
	return String(name ?? "").trim().toLowerCase().replace(/^#/, "");
}

async function getDiscordGuildChannels(token, guildId) {
	const key = String(guildId);
	const cached = discordChannelCache.get(key);
	if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.channels;
	const channels = await discordApi(token, `/guilds/${guildId}/channels`);
	discordChannelCache.set(key, { ts: Date.now(), channels });
	return channels;
}

async function resolveDiscordChannel(token, guildId, rawTarget) {
	const target = String(rawTarget ?? "").trim();
	const mention = target.match(/^<#(\d+)>$/);
	if (/^\d{10,}$/.test(target) || mention) {
		const id = mention ? mention[1] : target;
		return { id, name: id };
	}
	const wanted = normalizeChannelName(target);
	if (!wanted) return null;
	const channels = await getDiscordGuildChannels(token, guildId);
	return channels.find((channel) => normalizeChannelName(channel.name) === wanted) ?? null;
}

async function resolveDiscordLogChannel(token, guildId) {
	if (DISCORD_LOG_CHANNEL) return { id: DISCORD_LOG_CHANNEL, name: DISCORD_LOG_CHANNEL_NAME || DISCORD_LOG_CHANNEL };
	if (token && guildId && DISCORD_LOG_CHANNEL_NAME) {
		try {
			const channels = await getDiscordGuildChannels(token, guildId);
			const wanted = normalizeChannelName(DISCORD_LOG_CHANNEL_NAME);
			const match = Array.isArray(channels)
				? channels.find((channel) => normalizeChannelName(channel.name) === wanted && [0, 5].includes(Number(channel.type)))
				: null;
			if (match?.id) return { id: String(match.id), name: String(match.name || DISCORD_LOG_CHANNEL_NAME) };
		} catch (error) {
			warn("discord", "log channel lookup failed", { error: String(error).slice(0, 160) });
		}
	}
	return DISCORD_LOG_FALLBACK_CHANNEL
		? { id: DISCORD_LOG_FALLBACK_CHANNEL, name: DISCORD_LOG_CHANNEL_NAME || "pearl-log-messages" }
		: null;
}

function pendingKey(msg) {
	return `${msg.guild_id ?? "dm"}:${msg.channel_id}:${msg.author?.id ?? "unknown"}`;
}

function lastRequestKey(msg) {
	return `${msg.guild_id ?? "dm"}:${msg.channel_id}:${msg.author?.id ?? "unknown"}`;
}

function discordConversationKey(guildId, channelId) {
	return `${guildId ?? "dm"}:${channelId ?? "unknown"}`;
}

function loadDiscordSessionState() {
	if (discordSessionState) return discordSessionState;
	discordSessionState = readStateFile("discord-sessions.json", { channels: {} });
	if (!discordSessionState.channels || typeof discordSessionState.channels !== "object") {
		discordSessionState.channels = {};
	}
	return discordSessionState;
}

function discordSessionKey(guildId, channelId, kind = "chat") {
	const state = loadDiscordSessionState();
	const key = discordConversationKey(guildId, channelId);
	if (!state.channels[key]) {
		state.channels[key] = { generation: 0, updatedAt: now() };
		writeStateFile("discord-sessions.json", state);
	}
	const generation = state.channels[key]?.generation ?? 0;
	const suffix = generation > 0 ? `:new-${generation}` : "";
	return `production-repair:discord:${guildId ?? "dm"}:${channelId}:${kind}${suffix}`;
}

function resetDiscordSession(guildId, channelId) {
	const state = loadDiscordSessionState();
	const key = discordConversationKey(guildId, channelId);
	const current = state.channels[key]?.generation ?? 0;
	state.channels[key] = {
		generation: current + 1,
		updatedAt: now()
	};
	writeStateFile("discord-sessions.json", state);
	clearDiscordHistory(guildId, channelId);
	return state.channels[key].generation;
}

function cleanupPendingDelegations() {
	const cutoff = Date.now() - DISCORD_DELEGATION_TTL_MS;
	for (const [key, value] of pendingDiscordDelegations.entries()) {
		if (value.createdAt < cutoff) pendingDiscordDelegations.delete(key);
	}
}

function readDiscordLastRequests() {
	const state = readStateFile("discord-last-requests.json", { requests: {} });
	if (!state.requests || typeof state.requests !== "object") state.requests = {};
	return state;
}

function rememberDiscordRequest(msg, content) {
	const text = trimMessage(content);
	if (!text || isAgencyDispatchRequest(text)) return;
	const state = readDiscordLastRequests();
	state.requests[lastRequestKey(msg)] = {
		text,
		actionable: isActionableConversationRequest(text),
		liveLookup: isLiveLookupRequest(text),
		agency: isAgencyDispatchRequest(text) || isStagingWorkRequest(text) || isDocumentRetrievalRequest(text),
		createdAt: Date.now(),
		updatedAt: now()
	};
	writeStateFile("discord-last-requests.json", state);
}

function recallDiscordRequest(msg) {
	const state = readDiscordLastRequests();
	const item = state.requests[lastRequestKey(msg)];
	if (!item || typeof item.text !== "string") return null;
	if (Date.now() - Number(item.createdAt || 0) > DISCORD_LAST_REQUEST_TTL_MS) return null;
	return item.text;
}

function recallDiscordRequestItem(msg) {
	const state = readDiscordLastRequests();
	const item = state.requests[lastRequestKey(msg)];
	if (!item || typeof item.text !== "string") return null;
	if (Date.now() - Number(item.createdAt || 0) > DISCORD_LAST_REQUEST_TTL_MS) return null;
	return item;
}

function readConversationWork() {
	const state = readStateFile("conversation-work-items.json", { items: {} });
	if (!state.items || typeof state.items !== "object") state.items = {};
	return state;
}

function writeConversationWork(state) {
	writeStateFile("conversation-work-items.json", state);
}

function readPearlAgentObligations() {
	const state = readStateFile("pearl-agent-obligations.json", { obligations: {} });
	if (!state.obligations || typeof state.obligations !== "object") state.obligations = {};
	return state;
}

function writePearlAgentObligations(state) {
	state.schemaVersion = state.schemaVersion || 1;
	state.updatedAt = now();
	writeStateFile("pearl-agent-obligations.json", state);
}

function conversationWorkId(prefix = "work") {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createPearlAgentObligation({
	surface = "discord",
	kind = "background_continuation",
	msg,
	title,
	goal,
	context = "",
	lastAnswer = "",
	taskId = "",
	urgency = "normal",
	firstWakeMs = CONVERSATION_WORK_CHAT_FIRST_MS
}) {
	const state = readPearlAgentObligations();
	const createdAt = Date.now();
	const id = conversationWorkId(kind);
	const dedupeKey = [
		surface,
		kind,
		msg?.guild_id || "dm",
		msg?.channel_id || "",
		trimMessage(goal || title || taskId || "").toLowerCase().slice(0, 240)
	].join("|");
	const existing = Object.values(state.obligations).find((item) => {
		return item?.dedupeKey === dedupeKey && !["completed", "failed", "cancelled"].includes(String(item?.status || ""));
	});
	if (existing) {
		log("agent-runtime", "obligation already active", { id: existing.id, kind, channel: msg?.channel_id || "" });
		return existing;
	}
	state.obligations[id] = {
		id,
		dedupeKey,
		surface,
		kind,
		status: taskId ? "running" : "active",
		title: trimMessage(title || goal || "Pearl background work").slice(0, 180),
		goal: trimMessage(goal || title || ""),
		context: trimMessage(context || ""),
		lastAnswer: sanitizeAssistantText(lastAnswer || "").slice(0, 1600),
		taskId: String(taskId || ""),
		urgency,
		channelId: msg?.channel_id || "",
		guildId: msg?.guild_id || null,
		messageId: msg?.id || null,
		authorId: msg?.author?.id || "",
		authorName: msg?.author?.username || "",
		createdAt,
		updatedAt: now(),
		nextWakeAt: createdAt + Math.max(1000, firstWakeMs),
		lastUserVisibleUpdateAt: 0
	};
	writePearlAgentObligations(state);
	log("agent-runtime", "obligation created", { id, kind, channel: msg?.channel_id || "" });
	return state.obligations[id];
}

function createConversationWorkItem({
	surface = "discord",
	kind = "task",
	msg,
	title,
	taskId = "",
	taskText = "",
	query = "",
	status = "running",
	firstCheckMs
}) {
	const state = readConversationWork();
	const createdAt = Date.now();
	const id = conversationWorkId(kind);
	const firstMs = Number(firstCheckMs ?? (surface === "voice" ? CONVERSATION_WORK_VOICE_FIRST_MS : CONVERSATION_WORK_CHAT_FIRST_MS));
	state.items[id] = {
		id,
		surface,
		kind,
		status,
		title: trimMessage(title || taskText || query || "background work").slice(0, 180),
		taskId: String(taskId || ""),
		taskText: trimMessage(taskText || ""),
		query: trimMessage(query || ""),
		channelId: msg?.channel_id || "",
		guildId: msg?.guild_id || null,
		messageId: msg?.id || null,
		authorId: msg?.author?.id || "",
		authorName: msg?.author?.username || "",
		createdAt,
		updatedAt: now(),
		nextCheckAt: createdAt + Math.max(1000, firstMs),
		lastNoticeAt: 0,
		noticeCount: 0,
		deliveryAttempts: 0
	};
	writeConversationWork(state);
	return state.items[id];
}

function updateConversationWorkItem(id, patch = {}) {
	if (!id) return null;
	const state = readConversationWork();
	const item = state.items[id];
	if (!item) return null;
	state.items[id] = {
		...item,
		...patch,
		updatedAt: now()
	};
	writeConversationWork(state);
	return state.items[id];
}

function readDiscordTaskFollowups() {
	const state = readStateFile("discord-task-followups.json", { tasks: {} });
	if (!state.tasks || typeof state.tasks !== "object") state.tasks = {};
	return state;
}

function discordChannelHalted(guildId, channelId) {
	const key = discordConversationKey(guildId, channelId);
	const state = loadDiscordSessionState();
	const entry = state.channels?.[key];
	return entry?.halted === true;
}

function setDiscordChannelHalted(guildId, channelId, halted, reason = "") {
	const state = loadDiscordSessionState();
	const key = discordConversationKey(guildId, channelId);
	const current = state.channels[key] || { generation: 0 };
	state.channels[key] = {
		...current,
		halted: Boolean(halted),
		haltedAt: halted ? now() : null,
		haltReason: halted ? trimMessage(reason).slice(0, 240) : "",
		updatedAt: now()
	};
	writeStateFile("discord-sessions.json", state);
}

function isDiscordHaltRequest(content) {
	const text = trimMessage(content).toLowerCase();
	if (!text) return false;
	return /\b(?:halt|stop|pause|cancel)\b.*\b(?:all\s+)?(?:actions?|tasks?|agency|work|follow[- ]?ups?|updates?)\b/.test(text)
		|| /\b(?:halt|stop|pause)\s+all\b/.test(text)
		|| /\bno\s+more\s+(?:actions?|follow[- ]?ups?|updates?)\b/.test(text);
}

function isDiscordResumeRequest(content) {
	const text = trimMessage(content).toLowerCase();
	if (!text) return false;
	return /\b(?:resume|unhalt|continue|restart)\b.*\b(?:actions?|tasks?|agency|work|follow[- ]?ups?|updates?)\b/.test(text)
		|| /\b(?:ok|okay)\s+to\s+(?:resume|continue)\b/.test(text);
}

function writeDiscordTaskFollowups(state) {
	writeStateFile("discord-task-followups.json", state);
}

function taskPublicTitle(task, fallback = "that task") {
	return formatTaskTitle(task || { title: fallback });
}

function taskStatusWord(status) {
	if (status === "in_progress") return "running";
	if (status === "pending") return "queued";
	if (status === "completed") return "finished";
	if (status === "archived") return "archived";
	return status || "unknown";
}

function isTerminalTaskStatus(status) {
	return ["completed", "failed", "cancelled", "archived"].includes(String(status || ""));
}

function taskMs(value) {
	const ms = Date.parse(String(value || ""));
	return Number.isFinite(ms) ? ms : 0;
}

function taskCreatedMs(task) {
	return taskMs(task?.timestamp_created || task?.createdAt || task?.created_at);
}

function taskUpdatedMs(task) {
	return taskMs(task?.timestamp_updated || task?.updatedAt || task?.updated_at || task?.completed_at);
}

function minutesSince(ms, nowMs = Date.now()) {
	if (!ms) return null;
	return Math.max(0, Math.floor((nowMs - ms) / 60_000));
}

function latestTaskNote(task) {
	const notes = Array.isArray(task?.notes) ? task.notes : [];
	for (let index = notes.length - 1; index >= 0; index -= 1) {
		const note = notes[index];
		const text = String(note?.text || "").replace(/\s+/g, " ").trim();
		if (text) return { text, ts: note?.ts || "" };
	}
	return null;
}

function discordTaskFingerprint(task, status) {
	const note = latestTaskNote(task);
	const result = String(task?.result || task?.last_failure_result || "").replace(/\s+/g, " ").trim();
	return [
		status,
		taskUpdatedMs(task),
		note?.ts || "",
		note?.text || "",
		result.slice(0, 240)
	].join("|");
}

function shouldNotifyDiscordTaskStatus(status, item = {}, task = null, nowMs = Date.now()) {
	if (status === "archived") return false;
	if (status === "completed" || status === "failed" || status === "cancelled") return item.terminalNotified !== true;
	const createdAt = Number(item.createdAt || 0);
	if (createdAt && nowMs - createdAt > 24 * 60 * 60 * 1000) return false;
	if (status !== "pending" && status !== "in_progress") return false;
	const fingerprint = task ? discordTaskFingerprint(task, status) : "";
	if (!fingerprint || !item.lastFingerprint || fingerprint === item.lastFingerprint) return false;
	const hasMaterialUpdate = Boolean(latestTaskNote(task) || task?.result || task?.last_failure_result);
	if (!hasMaterialUpdate) return false;
	const lastNoticeAt = Number(item.lastNoticeAt || 0);
	return !lastNoticeAt || nowMs - lastNoticeAt >= DISCORD_TASK_FOLLOWUP_INTERVAL_MS;
}

async function fetchTaskRecord(taskId, headers = taskAuthHeaders(activeConfig())) {
	const json = await fetchJson(`${TASKS_API_URL}/${encodeURIComponent(taskId)}`, {
		method: "GET",
		headers
	}, 5000);
	return json?.task || json;
}

function summarizeTaskResultForDiscord(task, fallbackTitle) {
	const title = normalizeDiscordOutboundText(taskPublicTitle(task, fallbackTitle));
	const status = String(task?.status || "");
	const latestNote = latestTaskNote(task);
	const noteText = latestNote?.text ? trimAtSentenceBoundary(normalizeDiscordOutboundText(latestNote.text), 220) : "";
	const result = normalizeDiscordOutboundText(String(task?.result || task?.last_failure_result || ""))
		.replace(/\s+/g, " ")
		.trim();
	if (status === "completed") {
		return result
			? trimAtSentenceBoundary(`Done: ${title}\n${result}`, 1500)
			: `Done: ${title}.`;
	}
	if (status === "failed" || status === "cancelled") {
		return result
			? trimAtSentenceBoundary(`That ${taskStatusWord(status)}: ${title}\n${result}`, 1300)
			: `That ${taskStatusWord(status)}: ${title}.`;
	}
	const parts = [`${title} is ${taskStatusWord(status)}`];
	if (noteText) parts.push(`latest: ${noteText}`);
	return `${parts.join(". ")}.`;
}

async function pushWebChatInboxMessage({ content, taskId, taskTitle, kind = "task_followup", userEmail = "", tenantId = "" }) {
	const targetEmail = String(userEmail || WEBCHAT_FOLLOWUP_USER_EMAIL || "").trim();
	if (!targetEmail) {
		warn("webchat", "skipping inbox follow-up; no PEARL_WEBCHAT_FOLLOWUP_USER_EMAIL/PEARL_PRIMARY_USER_EMAIL configured");
		return false;
	}
	const targetTenantId = String(tenantId || WEBCHAT_FOLLOWUP_TENANT_ID || "").trim();
	if (!targetTenantId || targetTenantId === "public") {
		warn("webchat", "skipping inbox follow-up; no tenant scope configured");
		return false;
	}
	const headers = taskAuthHeaders(activeConfig(), {
		"content-type": "application/json",
		"x-user-email": targetEmail,
		"x-tenant-id": targetTenantId,
		"x-pearl-tenant-id": targetTenantId
	});
	await fetchJson(CHAT_INBOX_API_URL, {
		method: "POST",
		headers,
		body: JSON.stringify({
			content,
			for_user_email: targetEmail,
			tenant_id: targetTenantId,
			task_id: taskId,
			task_title: taskTitle,
			kind
		})
	}, 5000);
	return true;
}

function readWebChatTaskFollowups() {
	const state = readStateFile("webchat-task-followups.json", { tasks: {} });
	if (!state.tasks || typeof state.tasks !== "object") state.tasks = {};
	return state;
}

function writeWebChatTaskFollowups(state) {
	writeStateFile("webchat-task-followups.json", state);
}

async function fetchRecentTasksForFollowup(headers = taskAuthHeaders(activeConfig(), {
	"x-tenant-id": WEBCHAT_FOLLOWUP_TENANT_ID,
	"x-pearl-tenant-id": WEBCHAT_FOLLOWUP_TENANT_ID,
	...(WEBCHAT_FOLLOWUP_USER_EMAIL ? { "x-user-email": WEBCHAT_FOLLOWUP_USER_EMAIL } : {})
})) {
	const statuses = ["in_progress", "pending", "completed", "failed", "cancelled"];
	const groups = await Promise.all(statuses.map(async (status) => {
		try {
			const json = await fetchJson(`${TASKS_API_URL}?status=${encodeURIComponent(status)}&limit=50`, {
				method: "GET",
				headers
			}, 5000);
			return Array.isArray(json?.tasks) ? json.tasks : [];
		} catch (error) {
			warn("webchat", "task follow-up fetch failed", { status, error: String(error).slice(0, 160) });
			return [];
		}
	}));
	return groups.flat();
}

function isWebChatFollowupTask(task) {
	const source = String(task?.source || "").toLowerCase();
	const requester = String(task?.requester_email || task?.requesterEmail || "").trim();
	return source === "web_chat" || (source === "chat" && requester) || (WEBCHAT_FOLLOWUP_USER_EMAIL && requester === WEBCHAT_FOLLOWUP_USER_EMAIL);
}

function summarizeTaskResultForWebChat(task, fallbackTitle) {
	const title = redactInternalIdentifiers(taskPublicTitle(task, fallbackTitle));
	const status = String(task?.status || "");
	const result = redactInternalIdentifiers(String(task?.result || task?.last_failure_result || ""))
		.replace(/\s+/g, " ")
		.trim();
	if (status === "completed") {
		return result
			? `Done: ${title}\n${result.slice(0, 1500)}`
			: `Done: ${title}.`;
	}
	if (status === "failed" || status === "cancelled") {
		return result
			? `That ${taskStatusWord(status)}: ${title}\n${result.slice(0, 1300)}`
			: `That ${taskStatusWord(status)}: ${title}.`;
	}
	return `Still tracking: ${title} is ${taskStatusWord(status)}. I will keep watching and post the result here.`;
}

function shouldNotifyWebChatTask(task, item, nowMs) {
	const status = String(task?.status || item?.lastStatus || "unknown");
	if (status === "archived") return false;
	if (status === "completed" || status === "failed" || status === "cancelled") {
		const existedBeforeThisPoll = item?.seenBefore === true || item?.terminalNotified === true;
		const updatedAt = taskUpdatedMs(task) || taskCreatedMs(task) || nowMs;
		if (!existedBeforeThisPoll && updatedAt && nowMs - updatedAt > WEBCHAT_TASK_TERMINAL_CATCHUP_MS) return false;
		return item?.terminalNotified !== true;
	}
	if (status !== item?.lastStatus && item?.lastStatus) return true;
	const createdAt = Number(item?.createdAt || taskCreatedMs(task) || nowMs);
	const lastNoticeAt = Number(item?.lastNoticeAt || 0);
	if (nowMs - createdAt < WEBCHAT_TASK_STALE_MS) return false;
	if (!lastNoticeAt) return true;
	return nowMs - lastNoticeAt >= WEBCHAT_TASK_REPEAT_MS;
}

async function pollWebChatTaskFollowups() {
	const state = readWebChatTaskFollowups();
	const seen = new Set();
	const nowMs = Date.now();
	try {
		const tasks = await fetchRecentTasksForFollowup();
		for (const task of tasks) {
			if (!isWebChatFollowupTask(task)) continue;
			const taskId = task?.id || task?.taskId;
			if (!taskId) continue;
			const taskIdText = String(taskId);
			seen.add(taskIdText);
			const status = String(task?.status || "unknown");
			const createdAt = taskCreatedMs(task) || nowMs;
			if (nowMs - createdAt > WEBCHAT_TASK_MAX_AGE_MS && !state.tasks[taskIdText]) continue;
			const requesterEmail = String(task?.requester_email || task?.requesterEmail || WEBCHAT_FOLLOWUP_USER_EMAIL || "").trim();
			const requesterTenantId = String(task?.requester_tenant_id || task?.requesterTenantId || WEBCHAT_FOLLOWUP_TENANT_ID || "").trim();
			const existing = state.tasks[taskIdText] || {};
			const item = {
				...existing,
				taskId: taskIdText,
				title: task?.title || task?.task || existing.title || "background task",
				requesterEmail: requesterEmail || existing.requesterEmail || "",
				requesterTenantId: requesterTenantId || existing.requesterTenantId || "",
				createdAt: Number(existing.createdAt || createdAt),
				lastStatus: existing.lastStatus || status,
				lastUpdatedAt: taskUpdatedMs(task) || existing.lastUpdatedAt || 0,
				updatedAt: now()
			};
			if (shouldNotifyWebChatTask(task, item, nowMs)) {
				const terminal = isTerminalTaskStatus(status);
				const message = summarizeTaskResultForWebChat(task, item.title);
				const pushed = await pushWebChatInboxMessage({
					content: message,
					taskId: taskIdText,
					taskTitle: taskPublicTitle(task, item.title),
					kind: terminal ? "task_result" : "task_followup",
					userEmail: item.requesterEmail,
					tenantId: item.requesterTenantId
				});
				log("webchat", pushed ? "task follow-up routed to inbox" : "task follow-up not routed", { status, terminal });
				item.lastNoticeAt = nowMs;
				if (terminal) item.terminalNotified = true;
			}
			item.lastStatus = status;
			item.seenBefore = true;
			state.tasks[taskIdText] = item;
			if (isTerminalTaskStatus(status) && item.terminalNotified) {
				state.tasks[taskIdText].doneAt = state.tasks[taskIdText].doneAt || nowMs;
			}
		}
		for (const [taskId, item] of Object.entries(state.tasks)) {
			const doneAt = Number(item?.doneAt || 0);
			const createdAt = Number(item?.createdAt || 0);
			if ((doneAt && nowMs - doneAt > WEBCHAT_TASK_REPEAT_MS) || (createdAt && nowMs - createdAt > WEBCHAT_TASK_MAX_AGE_MS && !seen.has(taskId))) {
				delete state.tasks[taskId];
			}
		}
		writeWebChatTaskFollowups(state);
	} catch (error) {
		warn("webchat", "task follow-up poll failed", { error: String(error).slice(0, 240) });
	}
}

function startWebChatTaskFollowups() {
	if (webChatTaskFollowupTimer) clearInterval(webChatTaskFollowupTimer);
	void pollWebChatTaskFollowups();
	webChatTaskFollowupTimer = setInterval(() => {
		void pollWebChatTaskFollowups();
	}, Math.max(30_000, WEBCHAT_TASK_FOLLOWUP_INTERVAL_MS));
	if (typeof webChatTaskFollowupTimer.unref === "function") webChatTaskFollowupTimer.unref();
	log("webchat", "task follow-up watcher started", {
		intervalMs: WEBCHAT_TASK_FOLLOWUP_INTERVAL_MS,
		staleMs: WEBCHAT_TASK_STALE_MS
	});
}

async function pollDiscordTaskFollowup(token, taskId) {
	const state = readDiscordTaskFollowups();
	const item = state.tasks?.[taskId];
	if (!item) {
		discordTaskFollowupTimers.delete(taskId);
		return;
	}
	try {
		const task = await fetchTaskRecord(taskId);
		const status = String(task?.status || item.lastStatus || "unknown");
		const terminal = isTerminalTaskStatus(status);
		const nowMs = Date.now();
		const fingerprint = discordTaskFingerprint(task, status);
		let notified = false;
		if (shouldNotifyDiscordTaskStatus(status, item, task, nowMs)) {
			const message = summarizeTaskResultForDiscord(task, item.title || item.taskText);
			let sentDiscord = false;
			for (const destination of await discordLogFollowupDestinations(token, item)) {
				if (discordChannelHalted(destination.guildId, destination.channelId)) {
					log("discord", "task follow-up suppressed because channel is halted", { status, terminal });
					continue;
				}
				try {
					await sendDiscordMessage(token, destination.channelId, message, destination.guildId && destination.messageId ? {
						message_id: destination.messageId,
						channel_id: destination.channelId,
						guild_id: destination.guildId,
						fail_if_not_exists: false
					} : undefined);
					sentDiscord = true;
				} catch (sendError) {
					warn("discord", "task follow-up channel send failed", {
						taskId,
						channel: destination.channelId,
						error: String(sendError).slice(0, 180)
					});
				}
			}
			const pushed = await pushWebChatInboxMessage({
				content: message,
				taskId,
				taskTitle: taskPublicTitle(task, item.title || item.taskText),
				kind: terminal ? "task_result" : "task_followup",
				userEmail: item.requesterEmail,
				tenantId: item.requesterTenantId
			});
			log("discord", "task follow-up routed", { taskId, status, terminal, discord: sentDiscord, webchat: pushed });
			notified = sentDiscord || pushed;
		} else {
			log("discord", "task follow-up pruned without user notification", { taskId, status, terminal });
		}
		if (terminal) {
			delete state.tasks[taskId];
			writeDiscordTaskFollowups(state);
			discordTaskFollowupTimers.delete(taskId);
			return;
		}
		state.tasks[taskId] = {
			...item,
			lastStatus: status,
			lastCheckedAt: nowMs,
			lastNoticeAt: notified ? nowMs : item.lastNoticeAt,
			lastFingerprint: fingerprint,
			terminalNotified: terminal ? (item.terminalNotified || notified) : false,
			updatedAt: now()
		};
		writeDiscordTaskFollowups(state);
		scheduleDiscordTaskFollowup(token, taskId, DISCORD_TASK_FOLLOWUP_INTERVAL_MS);
	} catch (error) {
		warn("discord", "task follow-up poll failed", { taskId, error: String(error).slice(0, 180) });
		scheduleDiscordTaskFollowup(token, taskId, DISCORD_TASK_FOLLOWUP_INTERVAL_MS);
	}
}

function discordFollowupDestinations(item) {
	const raw = Array.isArray(item?.destinations) ? item.destinations : [];
	const destinations = raw
		.map((destination) => ({
			channelId: destination?.channelId || destination?.channel_id,
			guildId: destination?.guildId || destination?.guild_id || null,
			messageId: destination?.messageId || destination?.message_id || null
		}))
		.filter((destination) => destination.channelId);
	if (destinations.length) return destinations;
	if (!item?.channelId) return [];
	return [{
		channelId: item.channelId,
		guildId: item.guildId || null,
		messageId: item.messageId || null
	}];
}

async function discordLogFollowupDestinations(token, item) {
	return discordFollowupDestinations(item);
}

function scheduleDiscordTaskFollowup(token, taskId, delayMs = DISCORD_TASK_FOLLOWUP_INTERVAL_MS) {
	if (!token || !taskId) return;
	const existing = discordTaskFollowupTimers.get(taskId);
	if (existing) clearTimeout(existing);
	const timer = setTimeout(() => {
		void pollDiscordTaskFollowup(token, taskId);
	}, Math.max(1000, delayMs));
	if (typeof timer.unref === "function") timer.unref();
	discordTaskFollowupTimers.set(taskId, timer);
}

async function trackDiscordTaskFollowup({ token, msg, task, taskText }) {
	const taskId = task?.id || task?.taskId;
	if (!token || !taskId || !msg?.channel_id) return;
	const state = readDiscordTaskFollowups();
	const destinationChannelId = msg.channel_id;
	state.tasks[taskId] = {
		taskId,
		channelId: destinationChannelId,
		guildId: msg.guild_id || null,
		messageId: msg.id || null,
		destinations: [{
			channelId: destinationChannelId,
			guildId: msg.guild_id || null,
			messageId: null
		}],
		sourceChannelId: msg.channel_id,
		title: task?.title || taskText || "background task",
		taskText: taskText || task?.task || "",
		requesterEmail: task?.requester_email || task?.requesterEmail || "",
		requesterTenantId: task?.requester_tenant_id || task?.requesterTenantId || "",
		createdAt: Date.now(),
		updatedAt: now(),
		lastStatus: task?.status || "pending"
	};
	writeDiscordTaskFollowups(state);
	scheduleDiscordTaskFollowup(token, taskId, DISCORD_TASK_FOLLOWUP_INTERVAL_MS);
}

function resumeDiscordTaskFollowups(token) {
	const state = readDiscordTaskFollowups();
	for (const taskId of Object.keys(state.tasks || {})) {
		scheduleDiscordTaskFollowup(token, taskId, DISCORD_TASK_FOLLOWUP_INTERVAL_MS);
	}
}

function conversationWorkProgressMessage(item, task = null) {
	const title = normalizeDiscordOutboundText(trimMessage(item?.title || item?.taskText || item?.query || "that work"));
	if (isTerminalTaskStatus(task?.status)) {
		return summarizeTaskResultForDiscord(task, title);
	}
	const note = latestTaskNote(task);
	if (!note?.text) return null;
	return trimAtSentenceBoundary(`${title}: ${normalizeDiscordOutboundText(note.text)}`, 500);
}

async function pollConversationWorkItems(config, token) {
	const state = readConversationWork();
	const nowMs = Date.now();
	let changed = false;
	for (const [id, item] of Object.entries(state.items || {})) {
		const createdAt = Number(item.createdAt || 0);
		if (!createdAt || nowMs - createdAt > CONVERSATION_WORK_MAX_AGE_MS || ["completed", "failed", "cancelled"].includes(String(item.status || ""))) {
			delete state.items[id];
			changed = true;
			continue;
		}
		if (nowMs < Number(item.nextCheckAt || 0)) continue;
		let task = null;
		if (item.taskId) {
			try {
				task = await fetchTaskRecord(item.taskId, taskAuthHeaders(config));
			} catch (error) {
				warn("discord", "conversation work task poll failed", { error: String(error).slice(0, 160) });
			}
		}
		if (task && isTerminalTaskStatus(task.status)) {
			item.status = task.status;
		}
		const channelId = item.channelId;
		if (item.surface === "discord" && channelId) {
			if (discordChannelHalted(item.guildId, channelId)) {
				item.nextCheckAt = nowMs + CONVERSATION_WORK_REPEAT_MS;
				item.updatedAt = now();
				changed = true;
				log("discord", "conversation work notice suppressed because channel is halted", { kind: item.kind || "" });
				continue;
			}
			try {
				const progressMessage = conversationWorkProgressMessage(item, task);
				if (progressMessage) {
					await sendDiscordMessage(token, channelId, progressMessage);
				}
				item.lastNoticeAt = nowMs;
				item.noticeCount = Number(item.noticeCount || 0) + 1;
				item.deliveryAttempts = Number(item.deliveryAttempts || 0) + 1;
				if (task && isTerminalTaskStatus(task.status)) {
					delete state.items[id];
				} else {
					item.nextCheckAt = nowMs + CONVERSATION_WORK_REPEAT_MS;
					item.updatedAt = now();
				}
				changed = true;
			} catch (error) {
				item.deliveryAttempts = Number(item.deliveryAttempts || 0) + 1;
				item.nextCheckAt = nowMs + Math.min(CONVERSATION_WORK_REPEAT_MS, 60_000);
				item.updatedAt = now();
				changed = true;
				warn("discord", "conversation work notice failed", { error: String(error).slice(0, 160) });
			}
		}
	}
	if (changed) writeConversationWork(state);
}

function startConversationWorkHeartbeat(config, token) {
	if (!token || conversationWorkHeartbeatTimer) return;
	conversationWorkHeartbeatTimer = setInterval(() => {
		void pollConversationWorkItems(config, token).catch((error) => {
			warn("discord", "conversation work heartbeat failed", { error: String(error).slice(0, 180) });
		});
	}, CONVERSATION_WORK_CHECK_INTERVAL_MS);
	if (typeof conversationWorkHeartbeatTimer.unref === "function") conversationWorkHeartbeatTimer.unref();
}

function normalizeFactValue(value) {
	return String(value ?? "")
		.replace(/[.?!,;:]+$/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function extractDurableUserFact(content) {
	const text = trimMessage(content);
	if (!text) return null;
	const patterns = [
		{
			re: /\bmy\s+daughter'?s\s+name\s+is\s+([A-Z][A-Za-z' -]{1,60})/i,
			key: "Blair's daughter's name",
			format: (value) => `Blair's daughter's name is ${value}.`
		},
		{
			re: /\bmy\s+(son|child|kid)'?s\s+name\s+is\s+([A-Z][A-Za-z' -]{1,60})/i,
			key: (match) => `Blair's ${match[1].toLowerCase()}'s name`,
			format: (value, match) => `Blair's ${match[1].toLowerCase()}'s name is ${value}.`,
			valueIndex: 2
		},
		{
			re: /\bremember\s+(?:that\s+)?(.{8,180})$/i,
			key: "Blair explicitly asked Pearl to remember",
			format: (value) => `Blair explicitly asked Pearl to remember: ${value}.`
		}
	];
	for (const pattern of patterns) {
		const match = text.match(pattern.re);
		if (!match) continue;
		const rawValue = match[pattern.valueIndex || 1];
		const value = normalizeFactValue(rawValue);
		if (!value) continue;
		const key = typeof pattern.key === "function" ? pattern.key(match) : pattern.key;
		return {
			key,
			value,
			line: `- ${now()} - ${pattern.format(value, match)}`
		};
	}
	return null;
}

function ensureScopedPrivateMemoryFiles(scope) {
	const root = scopedPrivateMemoryDir(scope);
	const docs = {
		"USER.md": `# User Profile\n\n- Tenant ID: ${scope.tenantId}\n- User ID: ${scope.userId}\n${scope.userEmail ? `- User email: ${scope.userEmail}\n` : ""}\n`,
		"USER_FACTS.md": "# User Facts\n\n",
		"MEMORY.md": "# User Memory\n\n",
		"activity-log.md": "# User Activity Log\n\n",
		"skills.md": "# User Skill Preferences\n\n"
	};
	for (const [name, initial] of Object.entries(docs)) {
		const file = path.join(root, name);
		if (!fs.existsSync(file)) {
			appendTextFile(file, initial);
		}
	}
	return root;
}

function rememberDurableUserFact(content, context = {}) {
	const fact = extractDurableUserFact(content);
	if (!fact) return null;
	const scope = resolvePrivateMemoryScope(context);
	if (!scope || !shouldLoadPrivateMemory({ ...context, ...scope })) return null;
	const root = ensureScopedPrivateMemoryFiles(scope);
	const factsFile = path.join(root, "USER_FACTS.md");
	const memoryFile = path.join(root, "MEMORY.md");
	const activityFile = path.join(root, "activity-log.md");
	const existing = readText(factsFile, 200000);
	if (existing.toLowerCase().includes(fact.line.replace(/^-\s+\S+\s+-\s+/, "").toLowerCase())) {
		return fact;
	}
	const source = [
		context.surface ? `surface=${context.surface}` : "",
		context.channelId ? `channel=${context.channelId}` : "",
		context.authorName ? `author=${context.authorName}` : ""
	].filter(Boolean).join(" ");
	const line = `${fact.line}${source ? ` (${source})` : ""}\n`;
	appendTextFile(factsFile, line);
	appendTextFile(memoryFile, line);
	appendTextFile(activityFile, `- ${now().slice(0, 10)} remembered a durable user fact${source ? ` (${source})` : ""}\n`);
	return fact;
}

function isTrustedDiscordContext(msg) {
	if (!msg?.guild_id) return true;
	return String(msg.guild_id) === TRUSTED_DISCORD_GUILD_ID
		&& TRUSTED_DISCORD_CHANNELS.has(String(msg.channel_id));
}

function isDiscordStatusContextTrusted(msg) {
	if (isTrustedDiscordContext(msg)) return true;
	if (!msg?.guild_id) return true;
	return String(msg.guild_id) === TRUSTED_DISCORD_GUILD_ID
		&& QA_DISCORD_CHANNEL_ID
		&& String(msg.channel_id) === QA_DISCORD_CHANNEL_ID;
}

function isAgencyDispatchRequest(content) {
	const text = trimMessage(content).toLowerCase();
	if (!text) return false;
	if (/^(?:task|todo|agency task)\s*[:：]\s*\S/.test(text)) return true;
	if (/^(?:create|start|open|queue|file|log)\s+(?:a\s+)?task\b/.test(text)) return true;
	if (/^(yeah|yes|yep|no|nah)?\s*,?\s*send\s+(?:it|this|that|the task)\s+to\s+(?:the\s+)?agency\b/.test(text)) return true;
	if (/^(yeah|yes|yep)\s*,?\s*have\s+it\s+/.test(text)) return true;
	if (/\bhave\s+(?:the\s+)?agency\s+(?:do|handle|take|run|research|investigate|look\s+into|deep\s+dive|make|write|create|check|fix|update|send|post)\b/.test(text)) return true;
	if (/\b(?:the\s+)?agency\s+(?:do|handle|take|run|research|investigate|look\s+into|deep\s+dive|make|write|create|check|fix|update|send|post)\b/.test(text)) return true;
	if (/\b(research|lookup|look up|search|find|track down|investigate)\b.*\bagent\b/.test(text)) return true;
	if (/\bagent\b.*\b(research|lookup|look up|search|find|track down|investigate)\b/.test(text)) return true;
	return /\b(send|dispatch|queue|tell|ask|have|hand|fire|start|run)\b/.test(text)
		&& /\b(the\s+)?agency\b|\bclaude\s+cli\b|\bcodex\b|\bpearl-worker\b/.test(text);
}

function isStagingWorkRequest(content) {
	const text = trimMessage(content).toLowerCase();
	if (!text) return false;
	const action = /\b(fix|patch|change|update|implement|adjust|make|set|wire|add|remove|stop|start|ensure|check|test|verify|debug|investigate|look into|see if you can)\b/.test(text);
	const target = /\b(staging|build|deploy|web|interface|app|button|chat|text chat|input|window|component|discord|telegram|voice|pearl|pearlos|openclaw|agency|worker|task|pm2|server|do|digital ocean|droplet)\b/.test(text);
	return action && target;
}

function isLiveLookupRequest(content) {
	const text = trimMessage(content).toLowerCase();
	if (!text) return false;
	if (isLocalConfigQuestion(text)) return false;
	return /\b(search|look up|lookup|find out|verify|check current|current news|latest news|today's news|what'?s latest|what is latest|latest with|latest on|right now)\b/.test(text)
		|| /\b(recommend|recommendation|recommended|best|top|which|what\s+(?:is|are)|who\s+(?:is|are)|where\s+(?:is|are)|links?|sources?|docs?|documentation|available|listed|supports?|capabilities|pricing|cost|compare)\b/.test(text)
		|| (/\b(news|headlines|happening)\b/.test(text) && /\b(uk|britain|british|england|london|ukraine|russia|iran|israel|gaza|taiwan|china|europe|us|america|washington)\b/.test(text));
}

function isActionableConversationRequest(content) {
	const text = trimMessage(content);
	if (!text) return false;
	return isLiveLookupRequest(text)
		|| isAgencyDispatchRequest(text)
		|| isStagingWorkRequest(text)
		|| isDocumentRetrievalRequest(text)
		|| isImplicitRepairRequest(text);
}

function isActionConfirmation(content) {
	const text = trimMessage(content).toLowerCase();
	if (!text) return false;
	return /^(?:yeah|yes|yep|yup|ok|okay|sure|please|pls|do it|go ahead|sounds good|that works|correct|right)\b[\s,.:;-]*(?:see\s+if\s+you\s+can\s+)?(?:get|grab|pull|check|look(?:\s+up)?|search|find|run|send|do|handle|try)?\s*(?:it|this|that|tha|them|those|the\s+same)?\s*\.?$/.test(text)
		|| /^(?:yeah|yes|yep|yup|ok|okay|sure|please|pls)\b[\s\S]{0,80}\b(?:get|grab|pull|check|look(?:\s+up)?|search|find|run|send|do|handle)\b[\s\S]{0,40}\b(?:it|this|that|tha|them|those)?\.?$/.test(text);
}

function isPearlBehaviorComplaint(content) {
	const text = trimMessage(content).toLowerCase();
	if (!text) return false;
	const pearlTarget = /\b(pearl|you|your|this)\b/.test(text);
	const behaviorTarget = /\b(dispatch(?:ing|ed)?|queue(?:ing|d)?|task(?:s)?|agency|talk(?:ing)? about|narrat(?:e|ing)|not doing|actually do(?:ing)?|autonomous(?:ly)?|follow(?:ing)? through|dead[- ]?end(?:ing)?)\b/.test(text);
	const complaintShape = /\b(problem|issue|bug|bad|broken|keeps?|stop|instead|rather than|not|been working on|should(?:n'?t)?|needs? to)\b/.test(text);
	return pearlTarget && behaviorTarget && complaintShape;
}

function resolveInheritedAction(content, previous = "") {
	if (isPearlBehaviorComplaint(content)) return null;
	if (!isActionConfirmation(content) || !previous) return null;
	if (isDocumentRetrievalRequest(previous)) return { kind: "agency", content: previous };
	if (isStagingWorkRequest(previous) || isAgencyDispatchRequest(previous) || isImplicitRepairRequest(previous)) {
		return { kind: "agency", content: previous };
	}
	if (isLiveLookupRequest(previous) || isLiveLookupFollowup(content, previous)) {
		return { kind: "lookup", content: previous };
	}
	if (isActionableConversationRequest(previous)) return { kind: "agency", content: previous };
	return null;
}

function needsDeeperLookupFromLastReply(reply = "") {
	const text = trimMessage(reply).toLowerCase();
	if (!text) return false;
	return /\b(?:dispatch|deeper lookup|deeper search|deeper research|look(?:ing)? deeper|pull .*breakdown|agency)\b/.test(text)
		&& /\b(?:if you want|want me to|i can|can dispatch|deeper)\b/.test(text);
}

function needsAutonomousContinuation(reply = "") {
	const text = trimMessage(reply).toLowerCase();
	if (!text) return false;
	const incomplete = /\b(?:can't|cannot|couldn't|could not|don't have|do not have|not enough|not surfaced|isn't surfaced|not public|not listed|unclear|missing|no clean|no direct|not in what i got|not in the results|thin|conflicting|need(?:s)? deeper|need(?:s)? more|would need|have to dig|keep digging)\b/.test(text);
	const factualGap = /\b(?:pricing|cost|rate|per[- ]?(?:hour|minute)|comparison|compare|docs?|sources?|current|latest|capabilities|availability|model|api)\b/.test(text);
	return incomplete && factualGap;
}

function buildDeeperLookupTaskText(previous = "", lastReply = "") {
	const prior = trimMessage(previous);
	const reply = trimMessage(lastReply);
	return [
		"Run the deeper lookup Pearl just offered instead of repeating the same direct-search answer.",
		prior ? `Original user request: ${prior}` : "",
		reply ? `Pearl's last answer/offered next step: ${reply}` : "",
		"",
		"Find current source-backed details, resolve the missing values, and return a concise side-by-side answer. If the exact number is not public, say what is public and what assumption would be needed."
	].filter(Boolean).join("\n");
}

function hasPromissoryLanguage(content) {
	const text = trimMessage(content).toLowerCase();
	if (!text) return false;
	return /\b(?:on it|i(?:'|’)ll|i will|let me|i(?:'|’)m going to|i am going to|i(?:'|’)m checking|i am checking|i(?:'|’)ll check|i(?:'|’)ll pull|i(?:'|’)ll look|i(?:'|’)ll get|i(?:'|’)ll bring|i(?:'|’)ll report|i(?:'|’)ll follow up|stand by|give me (?:a )?(?:sec|second|minute|moment))\b/.test(text);
}

function isLocalConfigQuestion(content) {
	const text = trimMessage(content).toLowerCase();
	if (!text) return false;
	const localTarget = /\b(openclaw|pearl(?:os)?|relay|gateway|configuration|config|context size|context window|token window|model|running inside|current one)\b/.test(text);
	const configAsk = /\b(context size|context window|token window|max tokens|max output|configured|configuration|config|current|running|set at|using|inside)\b/.test(text);
	return localTarget && configAsk;
}

function configuredModelDetails(config, modelRef) {
	const ref = String(modelRef || "").trim();
	if (!ref) return null;
	const providers = config?.models?.providers || {};
	for (const [provider, providerConfig] of Object.entries(providers)) {
		for (const model of providerConfig?.models || []) {
			const id = String(model?.id || "");
			const full = `${provider}/${id}`;
			if (ref === full || ref === id || ref.endsWith(`/${id}`)) {
				return {
					ref: full,
					id,
					name: model?.name || id,
					contextWindow: model?.contextWindow ?? model?.context_window ?? null,
					maxTokens: model?.maxTokens ?? model?.max_tokens ?? null
				};
			}
		}
	}
	return null;
}

function formatNumber(value) {
	const n = Number(value);
	return Number.isFinite(n) ? n.toLocaleString("en-US") : String(value ?? "not set");
}

function answerLocalConfigQuestion(config, content) {
	if (!isLocalConfigQuestion(content)) return null;
	const primaryRef = config?.agents?.defaults?.model?.primary || "";
	const fallbackRefs = Array.isArray(config?.agents?.defaults?.model?.fallbacks)
		? config.agents.defaults.model.fallbacks
		: [];
	const primary = configuredModelDetails(config, primaryRef);
	const fallbacks = fallbackRefs.map((ref) => configuredModelDetails(config, ref)).filter(Boolean);
	const configuredGateway = config?.gateway?.port ? `127.0.0.1:${config.gateway.port}` : "the local OpenClaw gateway";
	if (!primary) {
		return `The relay is pointed at ${configuredGateway}, but I couldn't resolve the configured primary model from the loaded OpenClaw config.`;
	}
	const fallbackText = fallbacks.length
		? ` Fallback is ${fallbacks.map((model) => `${model.name} with ${formatNumber(model.contextWindow)} context`).join(", ")}.`
		: "";
	return `The OpenClaw relay is using ${primary.name} as the primary model. Its configured context window is ${formatNumber(primary.contextWindow)} tokens, with max output set to ${formatNumber(primary.maxTokens)} tokens.${fallbackText}`;
}

function isLiveLookupFollowup(content, previous = "") {
	const text = trimMessage(content).toLowerCase();
	const prior = trimMessage(previous).toLowerCase();
	if (!text || !prior) return false;
	const subjectFollowup = /^(?:so|and|okay|ok|yeah)?\s*(ukraine|russia|iran|israel|gaza|taiwan|china|election|war)\b/.test(text);
	return subjectFollowup && /\b(latest|current|news|today|right now|look up|search|what'?s latest)\b/.test(prior);
}

function isImplicitRepairRequest(content) {
	const text = trimMessage(content).toLowerCase();
	if (!text) return false;
	return /^(?:yeah\s+)?(?:we\s+)?should\s+fix\s+(?:that|this|it)\.?$/.test(text)
		|| /^(?:fix|repair)\s+(?:that|this|it)\.?$/.test(text)
		|| /^that\s+needs\s+(?:a\s+)?fix\.?$/.test(text);
}

function isDocumentRetrievalRequest(content, previous = "") {
	const text = `${trimMessage(previous)}\n${trimMessage(content)}`.toLowerCase();
	if (!text.trim()) return false;
	const artifact = /\b(white\s*paper|whitepaper|paper|document|doc|file|notes?|archive|runpod|workspace|forensic)\b/.test(text);
	const action = /\b(find|get|retrieve|recover|pull|look|check|search|locate|bring|send|have|do you have|can you get|what you find)\b/.test(text);
	return artifact && action;
}

function liveLookupQuery(content, previous = "") {
	const text = trimMessage(content);
	if (previous && /\b(latest|current|news|today|right now)\b/i.test(previous)) return previous;
	return text
		.replace(/\b(?:please|pls|just)\b/gi, "")
		.replace(/\s+/g, " ")
		.trim()
		.split(/[.?!]\s+/)[0]
		.slice(0, 180);
}

function formatSearchResults(results) {
	return results.map((result, index) => {
		const title = trimMessage(result.title || "Untitled");
		const url = trimMessage(result.url || "");
		const description = trimMessage(result.description || result.snippet || "");
		const age = trimMessage(result.age || result.published || result.page_age || "");
		return [
			`${index + 1}. ${title}`,
			age ? `Published/age: ${age}` : "",
			url ? `URL: ${url}` : "",
			description ? `Summary: ${description}` : ""
		].filter(Boolean).join("\n");
	}).join("\n\n");
}

function needsFreshSearch(query) {
	return /\b(latest|current|today|right now|news|headlines|happening|recent|new|202[5-9])\b/i.test(query);
}

async function braveSearch(config, query) {
	const apiKey = getSecret(config, "BRAVE_API_KEY");
	if (!apiKey) return null;
	const params = new URLSearchParams({
		q: query,
		count: "6",
		country: "us",
		search_lang: "en",
		safesearch: "moderate"
	});
	if (needsFreshSearch(query)) params.set("freshness", "pd");
	const json = await fetchJson(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
		method: "GET",
		headers: {
			"accept": "application/json",
			"x-subscription-token": apiKey
		}
	}, 12000);
	const web = Array.isArray(json?.web?.results) ? json.web.results : [];
	const news = Array.isArray(json?.news?.results) ? json.news.results : [];
	return [...news, ...web].slice(0, 6);
}

async function answerLiveLookup({ config, msg, content }) {
	if (!ENABLE_DIRECT_LIVE_LOOKUP || !isTrustedDiscordContext(msg)) return null;
	const previous = recallDiscordRequest(msg);
	const query = liveLookupQuery(content, previous).slice(0, 180);
	const work = createConversationWorkItem({
		surface: "discord",
		kind: "direct_lookup",
		msg,
		title: query,
		query,
		firstCheckMs: CONVERSATION_WORK_CHAT_FIRST_MS
	});
	try {
		const results = await braveSearch(config, query);
		if (!Array.isArray(results) || results.length === 0) {
			updateConversationWorkItem(work.id, { status: "failed", result: "No live search results returned." });
			return null;
		}
		const searchContext = [
			`Current date: ${now().slice(0, 10)}.`,
			`Blair asked for a live/current answer. Search query: ${query}`,
			"Use only these current web results for facts. If they are thin or conflicting, say that plainly.",
			"Answer like Pearl: natural, concise, emotionally intelligent, not a report dump. No em dashes. No 'let me', no 'I checked', no 'worker path', no backend narration. Include source names/links inline where useful.",
			"Current web results:",
			formatSearchResults(results)
		].join("\n\n");
		const reply = await callPearl({
			surface: "discord",
			sessionKey: discordSessionKey(msg.guild_id, msg.channel_id, "live"),
			text: content,
			author: msg.author?.username,
			context: {
				authorId: msg.author?.id,
				authorName: msg.author?.username,
				guildId: msg.guild_id,
				channelId: msg.channel_id
			},
			extraSystemContext: [searchContext],
			attachments: msg.attachments
			});
			updateConversationWorkItem(work.id, { status: "completed", result: sanitizeAssistantText(reply).slice(0, 600) });
			if (needsAutonomousContinuation(reply)) {
				createPearlAgentObligation({
					surface: "discord",
					kind: "deeper_lookup",
					msg,
					title: `Continue lookup: ${query}`.slice(0, 180),
					goal: query,
					context: [
						`User request: ${content}`,
						`Search query already tried: ${query}`,
						"The first visible answer had an unresolved factual gap. Continue autonomously and bring back the missing details."
					].join("\n"),
					lastAnswer: reply,
					firstWakeMs: 15_000
				});
				return `${reply}\n\nI'm going to keep digging in the background rather than make you ask twice.`;
			}
			return reply;
	} catch (error) {
		warn("discord", "direct live lookup failed", { error: String(error).slice(0, 180) });
		updateConversationWorkItem(work.id, { status: "failed", result: String(error).slice(0, 240) });
		return null;
	}
}

function extractAgencyTask(content, previous, force = false) {
	let text = trimMessage(content);
	text = text.replace(/^(yeah|yes|yep|no|nah)\s*,?\s*/i, "").trim();
	text = text.replace(/^send\s+(?:it|this|that|the task)\s+to\s+(?:the\s+)?agency\.?\s*/i, "").trim();
	text = text.replace(/^tell\s+(?:the\s+)?agency\s+(?:to\s+)?/i, "").trim();
	text = text.replace(/^ask\s+(?:the\s+)?agency\s+(?:to\s+)?/i, "").trim();
	text = text.replace(/^dispatch\s+(?:this|that|the task)?\s*(?:to\s+(?:the\s+)?agency)?\.?\s*/i, "").trim();
	text = text.replace(/^have\s+(?:the\s+agency|it)\s+/i, "").trim();
	text = text.replace(/^(?:task|todo|agency task)\s*[:：]\s*/i, "").trim();
	text = text.replace(/^(?:create|start|open|queue|file|log)\s+(?:a\s+)?task\s*(?:to|for|about)?\s*/i, "").trim();
	text = text.replace(/^have\s+(?:a\s+)?(?:research\s+)?agent\s+(?:to\s+)?/i, "").trim();
	text = text.replace(/^tell\s+(?:a\s+)?(?:research\s+)?agent\s+(?:to\s+)?/i, "").trim();
	text = text.replace(/^ask\s+(?:a\s+)?(?:research\s+)?agent\s+(?:to\s+)?/i, "").trim();
	text = text.replace(/^fire\s+(?:a\s+)?(?:task\s+)?(?:to\s+)?(?:the\s+)?agency\s*(?:to\s+)?/i, "").trim();
	if (!force && (!text || text.length < 20 || /^(to\s+)?(the\s+)?agency\.?$/i.test(text)) && previous) return previous;
	return text || previous || "";
}

function isPearlOSChangeRequest(content) {
	const text = trimMessage(content).toLowerCase();
	if (!text) return false;
	const mentionsPearlOS = /\b(pearlos|pearl os|my pearl|my pearlos|their pearlos|her pearlos|his pearlos|app|interface|dashboard|feature|setting|settings|workspace|terminal|jupyter|notes|chat|voice|discord|homepage|page|screen|button|component|ui)\b/.test(text);
	const changeIntent = /\b(add|build|create|change|update|edit|modify|fix|repair|remove|delete|replace|install|enable|disable|wire|hook up|route|implement|make|turn on|turn off)\b/.test(text);
	const codeIntent = /\b(code|source|tsx?|jsx?|python|api|endpoint|route|component|build|deploy|staging|production|prod)\b/.test(text);
	return changeIntent && (mentionsPearlOS || codeIntent);
}

function discordLinkRequiredMessage() {
	return "I can't change your PearlOS from Discord until that Discord account is linked and verified to your PearlOS account. Open PearlOS Settings, link Discord, then send the request again.";
}

function requesterFieldsFromDiscordScope(scope) {
	if (!scope?.allowed || !scope?.userId || !scope?.tenantId || !scope?.email) return null;
	return {
		requester_email: scope.email,
		requester_user_id: scope.userId,
		requester_tenant_id: scope.tenantId
	};
}

function agencyDispatchReply(taskText, replyStyle = "agency") {
	const text = trimMessage(taskText).toLowerCase();
	if (replyStyle === "lookup") {
		return "That needs a current lookup. I'll bring the sourced answer back here instead of guessing.";
	}
	if (replyStyle === "repair") {
		return "Yeah. That needs a behavior fix, not another narration loop. I'm using the recent context.";
	}
	const wantsNotesReport = /\bnotes?\b/.test(text) && /\b(report|audit|link|folder|deliver|delivery)\b/.test(text);
	const connectorAudit = /\bdiscord\b/.test(text)
		&& (/\bgoogle\s*chat\b|\bgooglechat\b/.test(text) || /\bslack\b/.test(text))
		&& (/\bsms\b|\btext\b/.test(text));
	if (wantsNotesReport && connectorAudit) {
		return "I'll audit the connector statuses, write it up in Notes, and bring the link back here.";
	}
	if (wantsNotesReport) {
		return "I'll write the audit into Notes and bring the direct link back to this channel.";
	}
	if (/\baudit\b|\breport\b/.test(text)) {
		return "I'll turn this into a clean audit report and bring it back here.";
	}
	if (/\bfix|patch|debug|staging|deploy|build|security|stability|multimodal|image\b/.test(text)) {
		return "I've got the request. I'll come back here with what changed or what stopped it.";
	}
	return "I've got the request. The finished answer comes back here when there is something real to say.";
}

async function createAgencyTask({ config, token, msg, content, force = false, titlePrefix = "", replyStyle = "agency", overrideTaskText = "" }) {
	if (!isTrustedDiscordContext(msg)) return null;
	if (!force && isPearlBehaviorComplaint(content)) return null;
	if (!force && !isAgencyDispatchRequest(content)) return null;
	const previous = recallDiscordRequest(msg);
	const taskText = trimMessage(overrideTaskText) || extractAgencyTask(content, previous, force);
	if (!taskText || taskText.length < 10) {
		return "I know you want this sent to the Agency, but I don't have the task body in recent context. Say it once more and I'll queue it.";
	}
	const pearlOSChangeRequest = isPearlOSChangeRequest(taskText);
	const linkedScope = await getDiscordLinkedAccountScope(msg.author?.id, { forceRefresh: pearlOSChangeRequest });
	const requesterFields = requesterFieldsFromDiscordScope(linkedScope);
	if (pearlOSChangeRequest && !requesterFields) {
		await requestDiscordVerificationCode(msg.author?.id);
		return discordLinkRequiredMessage();
	}
	const headers = taskAuthHeaders(config, { "content-type": "application/json" });
	const taskTitle = titleFromTaskRequest(taskText, titlePrefix);
	// Attribute the request to the exact linked PearlOS account when we have one,
	// otherwise the raw Discord identity. Never silently default to Blair: that
	// would let an unlinked or unrelated Discord user have work attributed to him.
	const requesterLabel =
		requesterFields?.requester_email ||
		msg.author?.username ||
		(msg.author?.id ? `discord:${msg.author.id}` : "an unidentified Discord user");
	const json = await fetchJson(TASKS_API_URL, {
		method: "POST",
		headers,
		body: JSON.stringify({
			task: [
				`Discord request from ${requesterLabel} in channel ${msg.channel_id}:`,
				taskText,
				"",
				msg.author?.id ? `Discord author discord:${msg.author.id}.` : "",
				`Discord source channel ${msg.channel_id}. Return final user-visible updates there.`,
				"Context: This was dispatched by the DO production repair relay. Operate only on PearlOS staging unless the task explicitly says otherwise. Keep prod and database setup untouched. If this is a live lookup/search request, use current sources and report concise findings with dates."
			].filter(Boolean).join("\n"),
			title: taskTitle,
			source: replyStyle === "lookup" ? "discord_lookup" : "discord",
			created_by: "agency",
			...requesterFields,
			assignee: "claude_cli",
			urgency: "normal"
		})
	}, 10000);
	const task = json?.task ?? json;
	const taskId = task?.id || task?.taskId || "queued";
	log("discord", "agency task dispatched", { taskId, channel: msg.channel_id });
	await trackDiscordTaskFollowup({ token, msg, task, taskText });
	createConversationWorkItem({
		surface: "discord",
		kind: replyStyle === "lookup" ? "lookup_task" : "agency_task",
		msg,
		title: taskTitle,
		taskId,
		taskText,
		firstCheckMs: CONVERSATION_WORK_CHAT_FIRST_MS
	});
	createPearlAgentObligation({
		surface: "discord",
		kind: replyStyle === "lookup" ? "lookup_task_watch" : "agency_task_watch",
		msg,
		title: taskTitle,
		goal: taskText,
		taskId,
		firstWakeMs: CONVERSATION_WORK_CHAT_FIRST_MS
	});
	return agencyDispatchReply(taskText, replyStyle);
}

function detectPendingDelegation(content) {
	const text = trimMessage(content);
	const match = text.match(/\bget\s+back\s+to\s+([A-Za-z][A-Za-z0-9_-]*)\b/i);
	if (!match || !/\bchannel\b/i.test(text)) return null;
	return {
		person: match[1],
		request: text
	};
}

function detectChannelFollowup(content) {
	const text = trimMessage(content);
	const match = text.match(/(?:^|\s)#?([a-z0-9][a-z0-9_-]{1,80})\s+is\s+(?:her|his|their|[A-Za-z][A-Za-z0-9_-]*'s)\s+channel\b/i);
	return match ? match[1] : null;
}

function parseDirectDiscordSend(content) {
	const text = trimMessage(content);
	const directMatch = text.match(/^(?:send|tell|message|post)\s+(<#\d+>|#?[a-z0-9][a-z0-9_-]{1,80}|\d{10,})[:\s]+([\s\S]{2,})$/i);
	if (directMatch) {
		return {
			target: directMatch[1],
			message: directMatch[2].trim()
		};
	}

	const channelMentionMatch = text.match(/\b(?:send|tell|message|post)\b[\s\S]*?\b(?:to|in|into)\b[\s\S]*?(<#\d+>|#[a-z0-9][a-z0-9_-]{1,80}|\d{10,})\s*\.?$/i);
	if (!channelMentionMatch) return null;
	const target = channelMentionMatch[1];
	let message = "";
	const tellThatMatch = text.match(/\btell\s+(?:her|him|them|[A-Za-z][A-Za-z0-9_-]*)\b[\s\S]*?\bthat\s+([\s\S]+?)(?:\.\s*)?(?:send|tell|message|post)\b[\s\S]*?\b(?:to|in|into)\b[\s\S]*?(?:<#\d+>|#[a-z0-9][a-z0-9_-]{1,80}|\d{10,})\s*\.?$/i);
	if (tellThatMatch) {
		message = tellThatMatch[1].trim();
	}
	if (!message) {
		const beforeTarget = text.slice(0, text.lastIndexOf(target)).trim();
		const sentence = beforeTarget.split(/[.!?]\s+/).map((part) => part.trim()).filter(Boolean).pop() || "";
		const thatMatch = sentence.match(/\bthat\s+([\s\S]+)$/i);
		message = (thatMatch?.[1] || sentence).trim();
	}
	message = message
		.replace(/^the\s+file\s+is\s+in\s+her\b/i, "the file is in your")
		.replace(/\bher\s+Notes\b/g, "your Notes")
		.replace(/\bhis\s+Notes\b/g, "your Notes")
		.replace(/\btheir\s+Notes\b/g, "your Notes")
		.replace(/^(?:no\s+i\s+mean\s+)?(?:tell|message|post|send)\s+(?:her|him|them|[A-Za-z][A-Za-z0-9_-]*)\b[\s\S]*?\bthat\s+/i, "")
		.replace(/[.?!,;:]+$/g, "")
		.trim();
	if (!message || message.length < 2) return null;
	return {
		target,
		message: `Blair wanted you to know ${message}.`
	};
}

async function sendDiscordMessage(token, channelId, content, reference) {
	const cleanContent = trimAtSentenceBoundary(normalizeDiscordOutboundText(content), MAX_REPLY_CHARS) || "I couldn't produce a clean reply.";
	return await discordApi(token, `/channels/${channelId}/messages`, {
		method: "POST",
		body: JSON.stringify({
			content: cleanContent,
			allowed_mentions: { parse: [] },
			message_reference: reference
		})
	});
}

async function enforceDiscordPromiseFirewall({ config, token, msg, content, reply }) {
	if (!hasPromissoryLanguage(reply) || !isTrustedDiscordContext(msg)) return reply;
	const previousRequest = recallDiscordRequest(msg);
	const inheritedAction = resolveInheritedAction(content, previousRequest);
	const actionableContent = inheritedAction?.content || (isActionableConversationRequest(content) ? content : "");
	if (actionableContent) {
		if (inheritedAction?.kind === "lookup" || isLiveLookupRequest(actionableContent)) {
			const liveReply = await answerLiveLookup({ config, msg, content: actionableContent });
			if (liveReply) return liveReply;
			const taskReply = await createAgencyTask({
				config,
				token,
				msg,
				content: actionableContent,
				force: true,
				titlePrefix: "Promise firewall lookup: ",
				replyStyle: "lookup"
			});
			if (taskReply) return taskReply;
		}
		const taskReply = await createAgencyTask({
			config,
			token,
			msg,
			content: actionableContent,
			force: true,
			titlePrefix: "Promise firewall task: ",
			replyStyle: "agency"
		});
		if (taskReply) return taskReply;
	}
	warn("discord", "promise firewall blocked unsupported promise", { channel: msg.channel_id });
	return "I need to make that a tracked lookup or task before I promise a follow-up. Say the request once more and I'll either answer it directly or queue it with a timer.";
}

async function maybeHandleDiscordDelegation({ config, token, msg, content }) {
	cleanupPendingDelegations();
	const previousRequest = recallDiscordRequest(msg);
	const direct = msg.guild_id ? parseDirectDiscordSend(content) : null;
	if (direct && isTrustedDiscordContext(msg)) {
		warn("discord", "blocked direct cross-channel bot post request", {
			channel: msg.channel_id,
			target: direct.target,
			author: msg.author?.id
		});
		return "I can't post as public Pearl from a user command. I can draft the message here, or route it through an approved operator task.";
	}
	if (isPearlBehaviorComplaint(content) && isTrustedDiscordContext(msg)) {
		return await callPearl({
			surface: "discord",
			sessionKey: discordSessionKey(msg.guild_id, msg.channel_id, "behavior"),
			text: content,
			author: msg.author?.username,
			context: {
				authorId: msg.author?.id,
				authorName: msg.author?.username,
				guildId: msg.guild_id,
				channelId: msg.channel_id
			},
			extraSystemContext: [[
				"Blair is complaining about Pearl talking about dispatching instead of doing the work.",
				"Answer directly as Pearl. Own the behavior plainly.",
				"Do not create or describe a new task from this meta complaint.",
				"Do not say 'I'll dispatch', 'sent it through', 'let me check', or any process narration.",
				"If the next useful move is obvious from recent context, say the concrete result or correction, not a plan."
			].join(" ")]
		});
	}
	const lastAssistant = lastDiscordAssistantText(msg.guild_id, msg.channel_id);
	if (isActionConfirmation(content) && previousRequest && needsDeeperLookupFromLastReply(lastAssistant) && isTrustedDiscordContext(msg)) {
		return await createAgencyTask({
			config,
			token,
			msg,
			content: previousRequest,
			force: true,
			titlePrefix: "Deeper lookup: ",
			replyStyle: "lookup",
			overrideTaskText: buildDeeperLookupTaskText(previousRequest, lastAssistant)
		});
	}
	const inheritedAction = resolveInheritedAction(content, previousRequest);
	if (inheritedAction?.kind === "lookup" && isTrustedDiscordContext(msg)) {
		const liveReply = await answerLiveLookup({ config, msg, content: inheritedAction.content });
		if (liveReply) return liveReply;
		return await createAgencyTask({
			config,
			token,
			msg,
			content: inheritedAction.content,
			force: true,
			titlePrefix: "Live lookup: ",
			replyStyle: "lookup"
		});
	}
	if (inheritedAction?.kind === "agency" && isTrustedDiscordContext(msg)) {
		return await createAgencyTask({
			config,
			token,
			msg,
			content: inheritedAction.content,
			force: true,
			titlePrefix: "Confirmed Discord request: ",
			replyStyle: "agency"
		});
	}
	if (isBareUpdateRequest(content) && isTaskishPreviousRequest(previousRequest)) {
		if (isAgencyDispatchRequest(previousRequest) || isDocumentRetrievalRequest(previousRequest)) {
			return await createAgencyTask({
				config,
				token,
				msg,
				content: previousRequest,
				force: true,
				titlePrefix: "Recovered Discord request: ",
				replyStyle: "agency"
			});
		}
		const taskReply = await answerTaskFollowup({
			config,
			msg,
			content: `agency status update on: ${previousRequest}`
		});
		if (taskReply) return taskReply;
	}
	if (isTaskFollowupRequest(content)) {
		const taskReply = await answerTaskFollowup({ config, msg, content });
		if (taskReply) return taskReply;
	}
	const agencyReply = await createAgencyTask({ config, token, msg, content });
	if (agencyReply) return agencyReply;
	if (isDocumentRetrievalRequest(content, previousRequest) && isTrustedDiscordContext(msg)) {
		return await createAgencyTask({
			config,
			token,
			msg,
			content,
			force: true,
			titlePrefix: "Discord document retrieval: ",
			replyStyle: "agency"
		});
	}
	const localConfigReply = answerLocalConfigQuestion(config, content);
	if (localConfigReply && isTrustedDiscordContext(msg)) return localConfigReply;
	if ((isLiveLookupRequest(content) || isLiveLookupFollowup(content, previousRequest)) && isTrustedDiscordContext(msg)) {
		const liveReply = await answerLiveLookup({ config, msg, content });
		if (liveReply) return liveReply;
		return await createAgencyTask({
			config,
			token,
			msg,
			content,
			force: true,
			titlePrefix: "Live lookup: ",
			replyStyle: "lookup"
		});
	}
	if (isImplicitRepairRequest(content) && isTrustedDiscordContext(msg)) {
		const history = recentDiscordHistoryText(msg.guild_id, msg.channel_id, 12, 3500);
		return await createAgencyTask({
			config,
			token,
			msg,
			content,
			force: true,
			titlePrefix: "Repair Discord Pearl follow-up issue: ",
			replyStyle: "repair",
			overrideTaskText: [
				"Fix the Discord Pearl issue Blair referred to with an implicit phrase like 'should fix that'.",
				"",
				"Recent Discord context:",
				history || "(No recent relay history was available.)",
				"",
				"Required outcome:",
				"- Pearl should resolve short follow-ups like 'so Ukraine' and 'should fix that' from recent channel context.",
				"- Live current-news lookups must not fail because Claude CLI is waiting for interactive web-search approval.",
				"- Prefer a relay-owned web lookup path when credentials exist, with Agency as fallback.",
				"- Keep Pearl's reply human and concise; do not ask Blair what 'that' means when the immediately prior context is clear.",
				"- Operate only on PearlOS staging. Do not touch prod or database setup."
			].join("\n")
		});
	}
	if (isStagingWorkRequest(content) && isTrustedDiscordContext(msg)) {
		return await createAgencyTask({
			config,
			token,
			msg,
			content,
			force: true,
			titlePrefix: "Discord staging request: ",
			replyStyle: "agency"
		});
	}
	if (!msg.guild_id || !canUseDiscordDelegation(config, msg)) return null;
	const followupChannel = detectChannelFollowup(content);
	if (followupChannel) {
		const pending = pendingDiscordDelegations.get(pendingKey(msg));
		if (pending) {
			const channel = await resolveDiscordChannel(token, msg.guild_id, followupChannel);
			if (!channel) return `I couldn't find channel ${followupChannel}.`;
			const outbound = await callPearl({
				surface: "discord",
				sessionKey: `production-repair:discord:delegation:${msg.guild_id}:${channel.id}`,
				author: msg.author?.username,
				text: `Write a brief Discord message to ${pending.person}. Context: ${pending.request}. Mention that Pearl is back online and responsive after the backend repair.`,
				context: {
					authorId: msg.author?.id,
					authorName: msg.author?.username,
					guildId: msg.guild_id,
					channelId: msg.channel_id
				}
			});
			await sendDiscordMessage(token, channel.id, outbound);
			pendingDiscordDelegations.delete(pendingKey(msg));
			return `Sent ${pending.person} a note in #${channel.name ?? channel.id}.`;
		}
	}
	const pending = detectPendingDelegation(content);
	if (pending) {
		pendingDiscordDelegations.set(pendingKey(msg), { ...pending, createdAt: Date.now() });
		return `I can do that. Tell me the channel name, or use: send #channel message.`;
	}
	return null;
}

async function isDiscordDmAllowed(authorId, options = {}) {
	const scope = await getDiscordLinkedAccountScope(authorId, options);
	return Boolean(scope?.allowed);
}

async function getDiscordLinkedAccountScope(authorId, options = {}) {
	const forceRefresh = Boolean(options?.forceRefresh);
	const id = String(authorId ?? "").trim();
	if (!/^\d{10,}$/.test(id)) return { allowed: false };
	const cached = discordLinkedAccountCache.get(id) ?? discordDmAllowCache.get(id);
	if (!forceRefresh && cached && Date.now() - cached.ts < DISCORD_DM_ALLOW_CACHE_TTL_MS) {
		return cached;
	}
	if (!DISCORD_DM_LINK_SECRET) return { allowed: false };
	try {
		const query = new URLSearchParams({ discordUserId: id }).toString();
		const json = await fetchJson(`${INTERFACE_DM_LINK_URL}/api/discord/dm-link/check?${query}`, {
			method: "GET",
			headers: { "x-internal-secret": DISCORD_DM_LINK_SECRET }
		}, 3000);
		const scope = {
			allowed: Boolean(json?.allowed),
			discordUserId: String(json?.discordUserId || id),
			userId: String(json?.userId || ""),
			email: String(json?.email || "").trim().toLowerCase(),
			tenantId: String(json?.tenantId || "").trim(),
			ts: Date.now()
		};
		if (!scope.userId || !scope.email || !scope.tenantId) scope.allowed = false;
		discordLinkedAccountCache.set(id, scope);
		discordDmAllowCache.set(id, scope);
		return scope;
	} catch {
		const scope = { allowed: false, ts: Date.now() };
		discordLinkedAccountCache.set(id, scope);
		discordDmAllowCache.set(id, scope);
		return scope;
	}
}

function extractOpenClawPairingCode(text) {
	const body = String(text ?? "");
	const commandMatch = body.match(/openclaw\s+pairing\s+approve\s+discord\s+([A-Z0-9]{6,12})/i);
	if (commandMatch?.[1]) return commandMatch[1].toUpperCase();
	const labelMatch = body.match(/Pairing code:\s*\n?\s*([A-Z0-9]{6,12})/i);
	if (labelMatch?.[1]) return labelMatch[1].toUpperCase();
	return null;
}

async function maybeApproveVerifiedDiscordPairing(authorId, replyText) {
	const code = extractOpenClawPairingCode(replyText);
	if (!code) return false;
	const verified = await isDiscordDmAllowed(authorId, { forceRefresh: true });
	if (!verified) return false;
	try {
		execFileSync("openclaw", ["pairing", "approve", "discord", code, "--notify"], {
			timeout: 12000,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"]
		});
		discordDmAllowCache.delete(String(authorId ?? ""));
		log("discord", "auto-approved verified OpenClaw pairing", { authorId: String(authorId ?? "unknown"), code });
		return true;
	} catch (error) {
		warn("discord", "auto approval of verified OpenClaw pairing failed", {
			authorId: String(authorId ?? "unknown"),
			code,
			error: String(error).slice(0, 240)
		});
		return false;
	}
}

async function requestDiscordVerificationCode(authorId) {
	const id = String(authorId ?? "").trim();
	if (!/^\d{10,}$/.test(id)) return { status: "invalid" };
	const lastPromptedAt = discordVerifyPromptCache.get(id) ?? 0;
	if (Date.now() - lastPromptedAt < DISCORD_VERIFY_PROMPT_COOLDOWN_MS) {
		return { status: "recently_sent" };
	}
	if (!DISCORD_DM_LINK_SECRET) return { status: "misconfigured" };
	try {
		await fetchJson(`${INTERFACE_DM_LINK_URL}/api/discord/dm-link/issue`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-internal-secret": DISCORD_DM_LINK_SECRET
			},
			body: JSON.stringify({ discordUserId: id })
		}, 5000);
		discordVerifyPromptCache.set(id, Date.now());
		return { status: "sent" };
	} catch (error) {
		const message = String(error);
		if (message.includes("HTTP 404")) return { status: "not_linked" };
		if (message.includes("HTTP 429")) return { status: "rate_limited" };
		return { status: "failed", error: message.slice(0, 180) };
	}
}

async function shouldHandleDiscordMessage(config, msg, selfId) {
	if (!msg || msg.author?.bot || msg.author?.id === selfId) return false;
	const content = trimMessage(msg.content);
	if (!content) return false;
	const discord = config?.channels?.discord ?? {};
	if (!msg.guild_id) {
		if (discord.dm?.enabled === false) return false;
		return true;
	}
	const guildCfg = resolveDiscordGuildConfig(discord, msg.guild_id);
	const channelAllowed = isDiscordChannelAllowed(msg.channel_id, guildCfg?.channels ?? discord.channels);
	const requireMention = guildCfg?.requireMention ?? discord.requireMention ?? false;
	const mentionedById = Array.isArray(msg.mentions) && msg.mentions.some((m) => m.id === selfId);
	const mentionedByName = /\bpearl(?:\s+omega)?\b/i.test(content);
	if (!channelAllowed) return false;
	if (!requireMention || mentionedById || mentionedByName) return true;
	if (!isTrustedDiscordContext(msg) || !looksLikePublicDiscordQuestion(content)) return false;
	const linked = await isDiscordDmAllowed(msg.author?.id);
	return Boolean(linked);
}

function looksLikePublicDiscordQuestion(content) {
	const text = trimMessage(content).toLowerCase();
	if (!text) return false;
	if (/^\?{1,3}$/.test(text)) return true;
	if (/^(?:pearl\??|pearl\s+omega\??|ping\??|hello\??|hey\??|you\s+there\??|still\s+there\??|any\s+update\??)$/.test(text)) return true;
	if (text.length < 8) return false;
	if (/^(?:what|which|who|where|when|why|how)\b/.test(text)) return true;
	if (/^(?:can|could|would|will|should|do|does|did|is|are|was|were)\s+(?:you|pearl|we|i|the\b)/.test(text)) return true;
	if (/\?\s*$/.test(text) && /\b(?:what|which|who|where|when|why|how|can|could|would|should|is|are|do|does|recommend|best|fastest|cheapest|available|rates?|prices?)\b/.test(text)) return true;
	return false;
}

function flattenInteractionOptions(options = []) {
	const parts = [];
	for (const option of options) {
		if (!option) continue;
		if (Array.isArray(option.options) && option.options.length > 0) {
			const nested = flattenInteractionOptions(option.options);
			parts.push(nested ? `${option.name} ${nested}` : String(option.name));
			continue;
		}
		if (option.value !== undefined) {
			parts.push(`${option.name}=${option.value}`);
		} else if (option.name) {
			parts.push(String(option.name));
		}
	}
	return parts.join(" ");
}

function interactionUser(interaction) {
	return interaction?.member?.user ?? interaction?.user ?? null;
}

function interactionCommandText(interaction) {
	const name = trimMessage(interaction?.data?.name ?? "");
	const options = flattenInteractionOptions(interaction?.data?.options ?? []);
	return trimMessage(`/${name}${options ? ` ${options}` : ""}`);
}

async function shouldHandleDiscordInteraction(config, interaction, selfId) {
	if (!interaction || interaction.type !== 2) return false;
	const user = interactionUser(interaction);
	if (!user || user.bot || user.id === selfId) return false;
	const content = interactionCommandText(interaction);
	if (!content) return false;
	const pseudoMessage = {
		author: user,
		channel_id: interaction.channel_id,
		guild_id: interaction.guild_id,
		content,
		mentions: [{ id: selfId }]
	};
	return await shouldHandleDiscordMessage(config, pseudoMessage, selfId);
}

async function maybeHandleDiscordCommand(interaction, content) {
	const [rawCommand, ...rest] = trimMessage(content).split(/\s+/);
	const command = rawCommand.replace(/^\//, "").toLowerCase();
	const args = rest.join(" ");
	if (command === "new" || command === "reset") {
		resetDiscordSession(interaction.guild_id, interaction.channel_id);
		return "Fresh Pearl thread. Ask me right here and I'll pick it up.";
	}
	if (command === "model" || command === "models") {
		const models = await fetchOpenClawModels();
		const modelLine = models.length ? models.join(", ") : "not available from the gateway right now";
		if (args && !/\b(list|status|current|show)\b/i.test(args)) {
			return [
				`Current repair route: OpenClaw model ${MODEL}, fallback ${REPAIR_MODEL}.`,
				`Gateway-advertised models: ${modelLine}.`,
				"Model switching is not enabled in the emergency repair relay because native OpenClaw sidecars are still suppressed; I will not claim the model changed until that path is restored."
			].join("\n");
		}
		return [
			`Current repair route: OpenClaw model ${MODEL}, fallback ${REPAIR_MODEL}.`,
			`Gateway-advertised models: ${modelLine}.`
		].join("\n");
	}
	return null;
}

async function handleDiscordInteraction({ config, interaction, selfId }) {
	if (!(await shouldHandleDiscordInteraction(config, interaction, selfId))) return;
	const content = interactionCommandText(interaction);
	const user = interactionUser(interaction);
	log("discord", "interaction accepted", {
		command: interaction.data?.name,
		channel: interaction.channel_id,
		guild: interaction.guild_id ?? "dm"
	});
	try {
		await acknowledgeDiscordInteraction(interaction);
	} catch (error) {
		warn("discord", "interaction acknowledge failed", { error: String(error).slice(0, 240) });
		return;
	}
	try {
		const commandReply = await maybeHandleDiscordCommand(interaction, content);
		rememberDiscordTurn({
			guildId: interaction.guild_id,
			channelId: interaction.channel_id,
			role: "user",
			author: user?.username,
			text: content
		});
		const reply = commandReply ?? await callPearl({
			surface: "discord",
			sessionKey: discordSessionKey(interaction.guild_id, interaction.channel_id, "interaction"),
			text: content,
			author: user?.username,
			context: {
				authorId: user?.id,
				authorName: user?.username,
				guildId: interaction.guild_id,
				channelId: interaction.channel_id
			}
		});
		await editDiscordInteraction(interaction.application_id, interaction.token, reply);
		rememberDiscordTurn({
			guildId: interaction.guild_id,
			channelId: interaction.channel_id,
			role: "assistant",
			author: "Pearl",
			text: reply
		});
		log("discord", "interaction reply sent", { channel: interaction.channel_id });
	} catch (error) {
		warn("discord", "interaction reply failed", { error: String(error).slice(0, 240) });
		try {
			await editDiscordInteraction(interaction.application_id, interaction.token, "I hit a backend error while handling that command. The relay is online, but this command path needs another repair pass.");
		} catch (editError) {
			warn("discord", "interaction error edit failed", { error: String(editError).slice(0, 240) });
		}
	}
}

async function startDiscordRelay(config) {
	if (!ENABLE_DISCORD_RELAY) {
		warn("discord", "disabled; OpenClaw native Discord plugin owns the gateway connection");
		return;
	}
	const token = config?.env?.DISCORD_BOT_TOKEN;
	if (!token) {
		warn("discord", "disabled; missing token");
		return;
	}
	const me = await discordApi(token, "/users/@me");
	const selfId = me.id;
	log("discord", "relay token verified", { bot: me.username, id: selfId });
	resumeDiscordTaskFollowups(token);
	startConversationWorkHeartbeat(config, token);
	let reconnectDelay = 1000;
	for (;;) {
		try {
			const gateway = await discordApi(token, "/gateway/bot");
			await new Promise((resolve) => {
				const ws = new WebSocket(`${gateway.url}/?v=10&encoding=json`);
				let heartbeat = null;
				let heartbeatAcked = true;
				let lastHeartbeatAtMs = 0;
				let seq = null;
				let closed = false;
				const closeForReconnect = () => {
					if (closed) return;
					closed = true;
					if (heartbeat) clearInterval(heartbeat);
					try {
						ws.close();
					} catch {}
					resolve();
				};
				const sendGatewayHeartbeat = () => {
					if (!heartbeatAcked && Date.now() - lastHeartbeatAtMs > DISCORD_GATEWAY_ACK_GRACE_MS) {
						warn("discord", "gateway heartbeat ACK missed; reconnecting", {
							lastHeartbeatAtMs,
							graceMs: DISCORD_GATEWAY_ACK_GRACE_MS
						});
						closeForReconnect();
						return;
					}
					try {
						heartbeatAcked = false;
						lastHeartbeatAtMs = Date.now();
						ws.send(JSON.stringify({ op: 1, d: seq }));
					} catch (error) {
						warn("discord", "gateway heartbeat send failed; reconnecting", { error: String(error).slice(0, 160) });
						closeForReconnect();
					}
				};
				ws.addEventListener("message", async (event) => {
					let packet;
					try {
						packet = JSON.parse(event.data);
					} catch {
						return;
					}
					if (packet.s) seq = packet.s;
					if (packet.op === 10) {
						const interval = packet.d.heartbeat_interval;
						heartbeat = setInterval(sendGatewayHeartbeat, interval);
						ws.send(JSON.stringify({
							op: 2,
							d: {
								token,
								intents: 1 | 512 | 4096 | 32768,
								properties: { os: "linux", browser: "pearl-repair-relay", device: "pearl-repair-relay" }
							}
						}));
					}
					if (packet.op === 11) {
						heartbeatAcked = true;
						return;
					}
					if (packet.t === "READY") {
						reconnectDelay = 1000;
						log("discord", "gateway ready", { session: packet.d?.session_id ? "present" : "missing" });
					}
					if (packet.t === "MESSAGE_CREATE" && await shouldHandleDiscordMessage(config, packet.d, selfId)) {
						const msg = packet.d;
						const content = trimMessage(msg.content.replace(new RegExp(`<@!?${selfId}>`, "g"), ""));
						log("discord", "message accepted", { channel: msg.channel_id, guild: msg.guild_id ?? "dm" });
						try {
							if (isDiscordHaltRequest(content)) {
								setDiscordChannelHalted(msg.guild_id, msg.channel_id, true, content);
								await sendDiscordMessage(token, msg.channel_id, "Understood. I halted background actions and follow-ups for this channel. Say “resume actions” when you want me to continue.", msg.guild_id ? { message_id: msg.id, channel_id: msg.channel_id, guild_id: msg.guild_id, fail_if_not_exists: false } : undefined);
								rememberDiscordTurn({
									guildId: msg.guild_id,
									channelId: msg.channel_id,
									role: "user",
									author: msg.author?.username,
									text: content
								});
								rememberDiscordTurn({
									guildId: msg.guild_id,
									channelId: msg.channel_id,
									role: "assistant",
									author: "Pearl",
									text: "Understood. I halted background actions and follow-ups for this channel."
								});
								return;
							}
							if (isDiscordResumeRequest(content)) {
								setDiscordChannelHalted(msg.guild_id, msg.channel_id, false, content);
								await sendDiscordMessage(token, msg.channel_id, "Resumed. I’ll keep replies direct and route any new work through the tracked path.", msg.guild_id ? { message_id: msg.id, channel_id: msg.channel_id, guild_id: msg.guild_id, fail_if_not_exists: false } : undefined);
								return;
							}
							if (discordChannelHalted(msg.guild_id, msg.channel_id)) {
								log("discord", "message ignored because channel is halted", { channel: msg.channel_id });
								return;
							}
							if (!msg.guild_id && !await isDiscordDmAllowed(msg.author?.id, { forceRefresh: true })) {
								await requestDiscordVerificationCode(msg.author?.id);
								const reply = discordLinkRequiredMessage();
								await sendDiscordMessage(token, msg.channel_id, reply);
								rememberDiscordTurn({
									guildId: msg.guild_id,
									channelId: msg.channel_id,
									role: "user",
									author: msg.author?.username,
									text: content
								});
								rememberDiscordTurn({
									guildId: msg.guild_id,
									channelId: msg.channel_id,
									role: "assistant",
									author: "Pearl",
									text: reply
								});
								return;
							}
							const mentionedBot = Array.isArray(msg.mentions) && msg.mentions.some((m) => m.id === selfId);
							const trustedGuildChannel = isTrustedDiscordContext(msg);
							if (msg.guild_id && mentionedBot && !trustedGuildChannel) {
								// Force-refresh here so users who just verified are not stuck behind TTL cache.
								const verified = await isDiscordDmAllowed(msg.author?.id, { forceRefresh: true });
								if (!verified) {
									const verification = await requestDiscordVerificationCode(msg.author?.id);
									if (verification.status === "misconfigured" || verification.status === "failed") {
										warn("discord", "verification DM request failed", {
											status: verification.status,
											authorId: msg.author?.id,
											channel: msg.channel_id
										});
									}
									return;
								}
							}
							const rememberedFact = rememberDurableUserFact(content, {
								surface: "discord",
								authorId: msg.author?.id,
								authorName: msg.author?.username,
								guildId: msg.guild_id,
								channelId: msg.channel_id
							});
							const delegatedReply = await maybeHandleDiscordDelegation({ config, token, msg, content });
							rememberDiscordRequest(msg, content);
							rememberDiscordTurn({
								guildId: msg.guild_id,
								channelId: msg.channel_id,
								role: "user",
								author: msg.author?.username,
								text: content
							});
							let reply = delegatedReply ?? (rememberedFact
								? `Got it. I wrote that to durable memory.`
								: await callPearl({
								surface: "discord",
								sessionKey: discordSessionKey(msg.guild_id, msg.channel_id),
								text: content,
								author: msg.author?.username,
								context: {
									authorId: msg.author?.id,
									authorName: msg.author?.username,
									guildId: msg.guild_id,
									channelId: msg.channel_id
								},
								attachments: msg.attachments
							}));
								if (!delegatedReply && !rememberedFact && await maybeApproveVerifiedDiscordPairing(msg.author?.id, reply)) {
									try {
										reply = await callPearl({
										surface: "discord",
										sessionKey: `${discordSessionKey(msg.guild_id, msg.channel_id)}:approved`,
										text: content,
										author: msg.author?.username,
										context: {
											authorId: msg.author?.id,
											authorName: msg.author?.username,
											guildId: msg.guild_id,
											channelId: msg.channel_id
										},
										attachments: msg.attachments
									});
								} catch {
										reply = "You're verified and approved now. Send that again and I should answer normally.";
									}
								}
								if (!delegatedReply && !rememberedFact) {
									reply = await enforceDiscordPromiseFirewall({ config, token, msg, content, reply });
								}
								await sendDiscordMessage(token, msg.channel_id, reply, msg.guild_id ? { message_id: msg.id, channel_id: msg.channel_id, guild_id: msg.guild_id, fail_if_not_exists: false } : undefined);
							rememberDiscordTurn({
								guildId: msg.guild_id,
								channelId: msg.channel_id,
								role: "assistant",
								author: "Pearl",
								text: reply
							});
							log("discord", "reply sent", { channel: msg.channel_id });
							} catch (error) {
								warn("discord", "reply failed", { error: String(error).slice(0, 240) });
								try {
									await sendDiscordMessage(token, msg.channel_id, "I hit an error before I could finish that path. I did not queue hidden work for it, so send it again and I'll route it through the tracked path.", msg.guild_id ? { message_id: msg.id, channel_id: msg.channel_id, guild_id: msg.guild_id, fail_if_not_exists: false } : undefined);
								} catch (fallbackError) {
									warn("discord", "reply failure notice failed", { error: String(fallbackError).slice(0, 240) });
								}
							}
					}
					if (packet.t === "INTERACTION_CREATE") {
						await handleDiscordInteraction({ config, interaction: packet.d, selfId });
					}
				});
				ws.addEventListener("close", closeForReconnect);
				ws.addEventListener("error", closeForReconnect);
			});
		} catch (error) {
			warn("discord", "gateway loop failed", { error: String(error).slice(0, 240) });
		}
		await sleep(reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, 30000);
	}
}

async function telegramApi(token, method, payload = {}) {
	return fetchJson(`https://api.telegram.org/bot${token}/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload)
	}, 90000);
}

function offsetFile() {
	return path.join(STATE_DIR, "telegram-offset.json");
}

function readTelegramOffset() {
	try {
		return JSON.parse(fs.readFileSync(offsetFile(), "utf8")).offset ?? 0;
	} catch {
		return 0;
	}
}

function writeTelegramOffset(offset) {
	fs.writeFileSync(offsetFile(), JSON.stringify({ offset, updatedAt: now() }, null, 2));
}

function shouldHandleTelegramMessage(tgConfig, msg) {
	const text = trimMessage(msg?.text ?? msg?.caption ?? "");
	if (!text) return false;
	const chat = msg.chat ?? {};
	const from = msg.from ?? {};
	const allowed = tgConfig.allowFrom;
	if (chat.type === "private") return tgConfig.dmPolicy !== "closed" && isAllowed(from.id, allowed);
	return isAllowed(chat.id, allowed);
}

async function startTelegramRelay() {
	const picked = pickTelegramConfig();
	if (!picked) {
		warn("telegram", "disabled; token not found in active config or known backups");
		return;
	}
	const token = picked.token;
	const tgConfig = picked.config;
	let me = null;
	try {
		me = await telegramApi(token, "getMe");
	} catch (error) {
		warn("telegram", "disabled; token rejected during startup", {
			source: picked.source,
			error: String(error).slice(0, 180)
		});
		return;
	}
	if (!me?.ok) {
		warn("telegram", "disabled; getMe returned not ok", { source: picked.source });
		return;
	}
	log("telegram", "relay token verified", { bot: me.result?.username, source: picked.source });
	let offset = readTelegramOffset();
	for (;;) {
		try {
			const updates = await telegramApi(token, "getUpdates", {
				offset: offset || undefined,
				timeout: 50,
				allowed_updates: ["message"]
			});
			if (!updates?.ok) throw new Error("Telegram getUpdates returned not ok");
			for (const update of updates.result ?? []) {
				offset = Math.max(offset, update.update_id + 1);
				writeTelegramOffset(offset);
				const msg = update.message;
				if (!shouldHandleTelegramMessage(tgConfig, msg)) continue;
				const text = trimMessage(msg.text ?? msg.caption ?? "");
				log("telegram", "message accepted", { chat: msg.chat?.id, type: msg.chat?.type });
				try {
					const reply = await callPearl({
						surface: "telegram",
						sessionKey: `production-repair:telegram:${msg.chat?.id}`,
						text,
						author: msg.from?.username || msg.from?.first_name,
						context: {
							authorId: msg.from?.id,
							authorName: msg.from?.username || msg.from?.first_name,
							chatType: msg.chat?.type
						}
					});
					await telegramApi(token, "sendMessage", {
						chat_id: msg.chat.id,
						text: reply,
						reply_to_message_id: msg.message_id,
						allow_sending_without_reply: true
					});
					log("telegram", "reply sent", { chat: msg.chat?.id });
				} catch (error) {
					warn("telegram", "reply failed", { error: String(error).slice(0, 240) });
				}
			}
		} catch (error) {
			if (/HTTP 409/.test(String(error))) {
				warn("telegram", "disabled; another Telegram poller is already active", {
					error: String(error).slice(0, 180)
				});
				return;
			}
			warn("telegram", "poll loop failed", { error: String(error).slice(0, 240) });
			await sleep(5000);
		}
	}
}

async function main() {
	const cfg = activeConfig();
	log("relay", "starting production repair chat relays", {
		openclaw: OPENCLAW_URL,
		deepseekFallback: DEEPSEEK_PROXY_URL,
		config: CONFIG_PATH,
		discordToken: cfg?.env?.DISCORD_BOT_TOKEN ? "present" : "missing"
	});
	startWebChatTaskFollowups();
	await Promise.all([
		startDiscordRelay(cfg),
		startTelegramRelay()
	]);
	for (;;) {
		await sleep(60_000);
	}
}

export const __privateMemoryTesting = {
	agencyDispatchReply,
	buildPrivateMemoryContext,
	createAgencyTask,
	conversationWorkProgressMessage,
	discordLinkRequiredMessage,
	getDiscordLinkedAccountScope,
	isDiscordStatusContextTrusted,
	isPearlBehaviorComplaint,
	isPearlOSChangeRequest,
	isTaskFollowupRequest,
	isTrustedDiscordContext,
	maybeHandleDiscordDelegation,
	rememberDurableUserFact,
	normalizeDiscordOutboundText,
	parseDirectDiscordSend,
	requesterFieldsFromDiscordScope,
	resolvePrivateMemoryScope,
	shouldNotifyDiscordTaskStatus,
	scopedPrivateMemoryDir,
	shouldLoadPrivateMemory,
	shouldHandleDiscordMessage,
	wantsAgencyBossStatus
};

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedUrl) {
	main().catch((error) => {
		console.error(`${now()} [relay] fatal ${String(error.stack || error)}`);
		process.exit(1);
	});
}
