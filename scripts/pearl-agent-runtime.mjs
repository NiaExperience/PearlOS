#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { tickDiary, diaryStatus } from "./pearl-diary-scheduler.mjs";

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
const STATE_DIR = process.env.PEARL_RELAY_STATE_DIR ?? "/home/deploy/.openclaw/production-repair-relays";
const OPENCLAW_SESSIONS_PATH = process.env.OPENCLAW_SESSIONS_PATH ?? "/home/deploy/.openclaw/agents/main/sessions/sessions.json";
const DISCORD_IDENTITY_LINKS_PATH = process.env.PEARL_DISCORD_IDENTITY_LINKS_PATH ?? "/home/deploy/.openclaw/discord-identity-links.json";
const USER_MEMORY_ROOT = process.env.PEARL_USER_MEMORY_DIR ?? "/home/deploy/.openclaw/user-memory";
const TASKS_API_URL = (process.env.PEARL_TASKS_API ?? "http://127.0.0.1:4444/api/tasks").replace(/\/$/, "");
const CHAT_INBOX_API_URL = (process.env.PEARL_CHAT_INBOX_API ?? "http://127.0.0.1:4444/api/chat/inbox").replace(/\/$/, "");
const INTERFACE_DM_LINK_URL = (process.env.PEARLOS_BASE_URL || process.env.NEXT_PUBLIC_INTERFACE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const TASKS_LOG_PATH = process.env.PEARL_TASKS_LOG_PATH ?? "/home/deploy/.openclaw/tasks/tasks.jsonl";
const TICK_MS = Number(process.env.PEARL_AGENT_RUNTIME_TICK_MS ?? 15_000);
const RUNTIME_HEARTBEAT_MS = Number(process.env.PEARL_AGENT_RUNTIME_STATE_HEARTBEAT_MS ?? 60_000);
const DIARY_TICK_TIMEOUT_MS = Number(process.env.PEARL_AGENT_DIARY_TICK_TIMEOUT_MS ?? 8000);
const CHAT_FIRST_UPDATE_MS = Number(process.env.PEARL_AGENT_CHAT_FIRST_UPDATE_MS ?? 90_000);
const CHAT_REPEAT_UPDATE_MS = Number(process.env.PEARL_AGENT_CHAT_REPEAT_UPDATE_MS ?? 10 * 60_000);
const DISCORD_UNANSWERED_FIRST_UPDATE_MS = Number(process.env.PEARL_DISCORD_UNANSWERED_FIRST_UPDATE_MS ?? 90_000);
const DISCORD_SCAN_LOOKBACK_MS = Number(process.env.PEARL_DISCORD_SCAN_LOOKBACK_MS ?? 24 * 60 * 60_000);
const DISCORD_UNANSWERED_MAX_CREATE_AGE_MS = Number(process.env.PEARL_DISCORD_UNANSWERED_MAX_CREATE_AGE_MS ?? 2 * 60 * 60_000);
const TASK_CREATE_STALE_MS = Number(process.env.PEARL_TASK_CREATE_STALE_MS ?? 2 * 60_000);
const TASK_PENDING_STALE_MS = Number(process.env.PEARL_TASK_PENDING_STALE_MS ?? 30 * 60_000);
const DISCORD_NATIVE_ACTIVE_SUPPRESS_MS = Number(process.env.PEARL_DISCORD_NATIVE_ACTIVE_SUPPRESS_MS ?? 15 * 60_000);
const DISCORD_CONTEXT_MAX_CHARS = Number(process.env.PEARL_DISCORD_CONTEXT_MAX_CHARS ?? 2600);
const DISCORD_TASK_RESULT_LOOKBACK_MS = Number(process.env.PEARL_DISCORD_TASK_RESULT_LOOKBACK_MS ?? 24 * 60 * 60_000);
const DISCORD_NO_PROGRESS_CHANNELS = new Set(
	(process.env.PEARL_DISCORD_NO_PROGRESS_CHANNELS ?? "1471441655650324533")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
);
const MAX_AGE_MS = Number(process.env.PEARL_AGENT_OBLIGATION_MAX_AGE_MS ?? 72 * 60 * 60_000);
const DISCORD_LOG_CHANNEL = (process.env.PEARL_DISCORD_LOG_CHANNEL ?? "").trim();
const DISCORD_LOG_CHANNEL_NAME = (process.env.PEARL_DISCORD_LOG_CHANNEL_NAME ?? "pearl-log-messages").trim();
const DISCORD_LOG_FALLBACK_CHANNEL = (process.env.PEARL_DISCORD_LOG_FALLBACK_CHANNEL ?? "1473007676157071431").trim();
const DISCORD_LINK_GUIDANCE_TTL_MS = Number(process.env.PEARL_DISCORD_LINK_GUIDANCE_TTL_MS ?? 10 * 60_000);
const WEBCHAT_USER_EMAIL = (process.env.PEARL_WEBCHAT_FOLLOWUP_USER_EMAIL || process.env.PEARL_PRIMARY_USER_EMAIL || "").trim();
const WEBCHAT_TENANT_ID = (
	process.env.PEARL_WEBCHAT_FOLLOWUP_TENANT_ID
	|| process.env.PEARL_PRIMARY_TENANT_ID
	|| process.env.DEFAULT_TENANT_ID
	|| ""
).trim();
const AGENCY_TASK_ASSIGNEE = (process.env.PEARL_AGENT_TASK_ASSIGNEE || "claude_cli").trim() || "claude_cli";
const ENV_FILE_CANDIDATES = [
	"/home/deploy/pearlos/apps/pipecat-daily-bot/.env",
	"/opt/pearlos/apps/pipecat-daily-bot/.env",
	"/home/deploy/pearlos/.env",
	"/home/deploy/pearlos/.env.local",
	"/opt/pearlos/.env",
	"/opt/pearlos/.env.local",
	"/workspace/nia-universal/.env.local",
	"/workspace/nia-universal/apps/pipecat-daily-bot/.env"
];

fs.mkdirSync(STATE_DIR, { recursive: true });

const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message, extra = {}) {
	const rest = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
	console.log(`${now()} [pearl-agent-runtime] ${message}${rest}`);
}

function warn(message, extra = {}) {
	const rest = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
	console.warn(`${now()} [pearl-agent-runtime] ${message}${rest}`);
}

function readJson(file, fallback = null) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return fallback;
	}
}

function writeJson(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
	fs.renameSync(tmp, file);
}

function hashText(value) {
	return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function stableChoice(seed, options) {
	if (!Array.isArray(options) || options.length === 0) return "";
	const hash = hashText(seed || "");
	const value = Number.parseInt(hash.slice(0, 8), 16);
	return options[value % options.length];
}

const GENERIC_ACKNOWLEDGEMENT_PATTERNS = [
	/\bi[’']ve got it\b/i,
	/\bi[’']ll come back\b/i,
	/\bspecific result here\b/i,
	/\bmaking you chase it\b/i,
	/\bthe next update here should be\b/i,
	/\blet me just\b/i,
	/\bon it\b/i
];

function cleanGoalSnippet(value, fallback = "that") {
	const text = stripUserVisibleBoilerplate(value)
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[.?!,:;]+$/g, "");
	if (!text) return fallback;
	return text.length <= 96 ? text : `${text.slice(0, 93).trim()}...`;
}

function progressFocusSnippet(obligation) {
	const goal = `${obligation?.goal || ""} ${obligation?.title || ""} ${obligation?.context || ""}`.toLowerCase();
	if (/\bdiscord\b/.test(goal)
		&& (/\bgoogle\s*chat\b|\bgooglechat\b/.test(goal) || /\bslack\b/.test(goal))
		&& (/\bsms\b|\btext\b/.test(goal))) {
		return "the connector audit";
	}
	if (/\bnotes?\b/.test(goal) && /\b(report|audit|link|folder|deliver|delivery)\b/.test(goal)) {
		return "the Notes report and return link";
	}
	if (/\bmultimodal\b|\bimage\b|\bsharing\b/.test(goal)) {
		return "the multimodal sharing issue";
	}
	if (/\bdiscord\b/.test(goal) && /\b(security|stability)\b/.test(goal)) {
		return "the Discord security and stability check";
	}
	if (/\bgoogle\s*chat\b|\bgooglechat\b/.test(goal)) return "the GoogleChat status";
	if (/\bslack\b/.test(goal)) return "the Slack status";
	if (/\bsms\b|\btext\b/.test(goal)) return "the text/SMS status";
	if (/\baudit\b|\breport\b/.test(goal)) return "the audit report";
	return cleanGoalSnippet(obligation?.goal || obligation?.title || "that request");
}

function progressHistoryKey(obligation) {
	return [
		"progress",
		obligation?.surface || "",
		obligation?.guildId || "",
		obligation?.channelId || "",
		obligation?.userId || obligation?.userEmail || ""
	].join(":");
}

function rememberProgressMessage(state, obligation, message, nowMs) {
	if (!state.progressMessages || typeof state.progressMessages !== "object") {
		state.progressMessages = {};
	}
	const key = progressHistoryKey(obligation);
	const list = Array.isArray(state.progressMessages[key]) ? state.progressMessages[key] : [];
	list.push({
		at: nowMs,
		text: String(message || "").replace(/\s+/g, " ").trim().slice(0, 240)
	});
	state.progressMessages[key] = list
		.filter((item) => nowMs - Number(item.at || 0) < 24 * 60 * 60 * 1000)
		.slice(-12);
}

function recentlyUsedProgressMessage(state, obligation, message, nowMs) {
	const key = progressHistoryKey(obligation);
	const normalized = String(message || "").replace(/\s+/g, " ").trim().toLowerCase();
	const list = Array.isArray(state.progressMessages?.[key]) ? state.progressMessages[key] : [];
	return list.some((item) => {
		const age = nowMs - Number(item.at || 0);
		const text = String(item.text || "").replace(/\s+/g, " ").trim().toLowerCase();
		return age >= 0 && age < 6 * 60 * 60 * 1000 && text === normalized;
	});
}

function activeConfig() {
	const cfg = readJson(CONFIG_PATH);
	if (!cfg) throw new Error(`Unable to read ${CONFIG_PATH}`);
	return cfg;
}

function readText(file, maxChars = 200000) {
	try {
		return fs.readFileSync(file, "utf8").slice(0, maxChars);
	} catch {
		return "";
	}
}

function readJsonlTail(file, maxLines = 240) {
	const text = readText(file, 2_000_000);
	if (!text) return [];
	const lines = text.split(/\n/).filter(Boolean).slice(-maxLines);
	const rows = [];
	for (const line of lines) {
		try {
			rows.push(JSON.parse(line));
		} catch {
			// ignore malformed/in-flight line
		}
	}
	return rows;
}

function readEnvFileValue(file, key) {
	const text = readText(file);
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

function getDiscordBotToken(config) {
	const cfgValue = config?.channels?.discord?.token
		|| config?.env?.DISCORD_BOT_TOKEN
		|| config?.secrets?.DISCORD_BOT_TOKEN;
	if (typeof cfgValue === "string" && cfgValue.trim()) return cfgValue.trim();
	return getSecret(config, "DISCORD_BOT_TOKEN");
}

const discordLogChannelCache = new Map();
const discordLinkedAccountCache = new Map();
const discordLinkGuidanceCache = new Map();

async function resolveDiscordLogChannel(config, guildId) {
	if (DISCORD_LOG_CHANNEL) return DISCORD_LOG_CHANNEL;
	const token = getDiscordBotToken(config);
	const name = DISCORD_LOG_CHANNEL_NAME.toLowerCase();
	if (token && guildId && name) {
		const cacheKey = `${guildId}:${name}`;
		const cached = discordLogChannelCache.get(cacheKey);
		if (cached && Date.now() - cached.ts < 5 * 60_000) return cached.channelId;
		try {
			const channels = await fetchJson(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
				method: "GET",
				headers: { "authorization": `Bot ${token}` }
			}, 10000);
			const match = Array.isArray(channels)
				? channels.find((channel) => String(channel?.name || "").toLowerCase() === name && [0, 5].includes(Number(channel?.type)))
				: null;
			if (match?.id) {
				discordLogChannelCache.set(cacheKey, { ts: Date.now(), channelId: String(match.id) });
				return String(match.id);
			}
		} catch (error) {
			warn("discord log channel lookup failed", { error: String(error).slice(0, 160) });
		}
	}
	return DISCORD_LOG_FALLBACK_CHANNEL;
}

function safeComponent(value) {
	const cleaned = String(value || "").trim().replace(/[^a-zA-Z0-9._@+-]+/g, "_").slice(0, 180);
	return cleaned.replace(/^[._-]+|[._-]+$/g, "") || "unknown";
}

function normalizeCompare(text) {
	return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function userMemoryDir(scope) {
	return path.join(USER_MEMORY_ROOT, safeComponent(scope.tenantId), safeComponent(scope.userId));
}

function appendUserMemory(scope, text, { source = "discord", kind = "conversation_observation" } = {}) {
	const content = String(text || "").replace(/\s+/g, " ").trim().slice(0, 2000);
	if (!scope?.tenantId || !scope?.userId || !content) return false;
	const root = userMemoryDir(scope);
	fs.mkdirSync(root, { recursive: true });
	const eventsPath = path.join(root, "events.jsonl");
	const needle = normalizeCompare(content);
	for (const item of readJsonlTail(eventsPath, 80)) {
		if (normalizeCompare(item?.text) === needle) return false;
	}
	const ts = now();
	const entry = {
		id: `mem-${hashText(`${ts}:${scope.tenantId}:${scope.userId}:${content}`)}`,
		ts,
		tenantId: scope.tenantId,
		userId: scope.userId,
		userEmail: scope.userEmail || "",
		source,
		kind,
		text: content
	};
	fs.appendFileSync(eventsPath, `${JSON.stringify(entry)}\n`);
	const docs = {
		"USER.md": `# User Profile\n\n- Tenant ID: ${scope.tenantId}\n- User ID: ${scope.userId}\n${scope.userEmail ? `- User email: ${scope.userEmail}\n` : ""}\n`,
		"USER_FACTS.md": "# User Facts\n\n",
		"MEMORY.md": "# User Memory\n\n",
		"activity-log.md": "# User Activity Log\n\n",
		"skills.md": "# User Skill Preferences\n\n"
	};
	for (const [name, initial] of Object.entries(docs)) {
		const file = path.join(root, name);
		if (!fs.existsSync(file)) fs.writeFileSync(file, initial);
	}
	const line = `- ${ts.slice(0, 10)} [${kind}/${source}] ${content}\n`;
	fs.appendFileSync(path.join(root, "USER_FACTS.md"), line);
	fs.appendFileSync(path.join(root, "MEMORY.md"), line);
	fs.appendFileSync(path.join(root, "activity-log.md"), `- ${ts.slice(0, 10)} remembered a ${kind} from ${source}\n`);
	return true;
}

function loadDiscordIdentityLinks(config) {
	const explicit = readJson(DISCORD_IDENTITY_LINKS_PATH, {});
	const links = {
		users: { ...(explicit?.users || {}) },
		usernames: { ...(explicit?.usernames || {}) }
	};
	let envLinks = null;
	if (process.env.PEARL_DISCORD_IDENTITY_LINKS) {
		try {
			envLinks = JSON.parse(process.env.PEARL_DISCORD_IDENTITY_LINKS);
		} catch (error) {
			warn("invalid PEARL_DISCORD_IDENTITY_LINKS", { error: String(error).slice(0, 180) });
		}
	}
	if (envLinks) {
		Object.assign(links.users, envLinks.users || {});
		Object.assign(links.usernames, envLinks.usernames || {});
	}

	const allowFrom = config?.channels?.discord?.dm?.allowFrom || config?.channels?.discord?.allowFrom || [];
	const allowedIds = Array.isArray(allowFrom) ? allowFrom.filter((id) => /^\d{10,}$/.test(String(id))) : [];
	try {
		const tenants = fs.readdirSync(USER_MEMORY_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
		const scopes = [];
		for (const tenantId of tenants) {
			const tenantRoot = path.join(USER_MEMORY_ROOT, tenantId);
			for (const user of fs.readdirSync(tenantRoot, { withFileTypes: true })) {
				if (!user.isDirectory()) continue;
				const userId = user.name;
				const profile = readText(path.join(tenantRoot, userId, "USER.md"), 4000);
				const email = profile.match(/^- User email:\s*(.+)$/m)?.[1]?.trim() || "";
				scopes.push({ tenantId, userId, userEmail: email });
			}
		}
		if (allowedIds.length === 1 && scopes.length === 1 && !links.users[allowedIds[0]]) {
			links.users[allowedIds[0]] = scopes[0];
		}
	} catch {
		// identity links are optional; explicit config wins
	}
	return links;
}

function normalizeIdentityScope(scope) {
	if (!scope?.tenantId || !scope?.userId) return null;
	return {
		tenantId: String(scope.tenantId).trim(),
		userId: String(scope.userId).trim(),
		userEmail: String(scope.userEmail || scope.email || "").trim().toLowerCase()
	};
}

function scopeForDiscordSender(sender, links) {
	const userId = String(sender?.id || sender?.discordUserId || "").trim();
	if (userId && links.users?.[userId]) return normalizeIdentityScope(links.users[userId]);
	for (const key of [sender?.username, sender?.name, sender?.label, sender?.tag]) {
		const normalized = String(key || "").trim().toLowerCase();
		if (normalized && links.usernames?.[normalized]) return normalizeIdentityScope(links.usernames[normalized]);
	}
	return null;
}

async function getLinkedDiscordAccountScope(config, sender, { forceRefresh = false } = {}) {
	const discordUserId = String(sender?.id || sender?.discordUserId || "").trim();
	if (!/^\d{10,}$/.test(discordUserId)) return null;
	const cached = discordLinkedAccountCache.get(discordUserId);
	if (!forceRefresh && cached && Date.now() - cached.ts < 60_000) return cached.scope;
	const secret = getSecret(config, "DISCORD_DM_LINK_SECRET") || getSecret(config, "MESH_SHARED_SECRET");
	if (!secret) {
		discordLinkedAccountCache.set(discordUserId, { ts: Date.now(), scope: null });
		return null;
	}
	try {
		const query = new URLSearchParams({ discordUserId }).toString();
		const json = await fetchJson(`${INTERFACE_DM_LINK_URL}/api/discord/dm-link/check?${query}`, {
			method: "GET",
			headers: { "x-internal-secret": secret }
		}, 3000);
		const scope = json?.allowed === true ? normalizeIdentityScope({
			tenantId: json.tenantId,
			userId: json.userId,
			userEmail: json.email
		}) : null;
		discordLinkedAccountCache.set(discordUserId, { ts: Date.now(), scope });
		return scope;
	} catch (error) {
		warn("discord linked scope check failed", {
			discordUserId,
			error: String(error).slice(0, 180)
		});
		discordLinkedAccountCache.set(discordUserId, { ts: Date.now(), scope: null });
		return null;
	}
}

async function maybeSendDiscordLinkGuidance(config, metadata, state, nowMs) {
	const discordUserId = String(metadata?.sender?.id || metadata?.sender?.discordUserId || "").trim();
	const channelId = String(metadata?.channelId || "").trim();
	if (!/^\d{10,}$/.test(discordUserId) || !/^\d{10,}$/.test(channelId)) return false;
	const key = `${discordUserId}:${channelId}`;
	const last = Number(state.discordLinkGuidance?.[key]?.seenAt || discordLinkGuidanceCache.get(key) || 0);
	if (last && nowMs - last < DISCORD_LINK_GUIDANCE_TTL_MS) return false;
	if (!state.discordLinkGuidance || typeof state.discordLinkGuidance !== "object") state.discordLinkGuidance = {};
	state.discordLinkGuidance[key] = { seenAt: nowMs };
	discordLinkGuidanceCache.set(key, nowMs);
	const secret = getSecret(config, "DISCORD_DM_LINK_SECRET") || getSecret(config, "MESH_SHARED_SECRET");
	let issueStatus = "";
	if (secret) {
		try {
			await fetchJson(`${INTERFACE_DM_LINK_URL}/api/discord/dm-link/issue`, {
				method: "POST",
				headers: { "x-internal-secret": secret },
				body: JSON.stringify({ discordUserId })
			}, 5000);
			issueStatus = "sent";
		} catch (error) {
			issueStatus = /HTTP 404/.test(String(error)) ? "not_linked" : "failed";
		}
	}
	const message = issueStatus === "sent"
		? "I can talk here, but I can only run tasks after your PearlOS Discord link is verified. I sent the verification steps in DM."
		: "I can talk here, but I can only run tasks for linked PearlOS users. Link this Discord account in PearlOS settings, then ask again.";
	return sendDiscordMessage(config, channelId, message).catch((error) => {
		warn("discord link guidance send failed", {
			channelId,
			error: String(error).slice(0, 180)
		});
		return false;
	});
}

function messageText(message) {
	let text = "";
	for (const part of message?.content || []) {
		if (part?.type === "text") text += part.text || "";
	}
	return text;
}

function parseDiscordMetadata(text, sessionEntry = {}) {
	const blocks = [...String(text || "").matchAll(/```json\s*([\s\S]*?)```/g)];
	let conversation = {};
	let sender = {};
	for (const block of blocks) {
		try {
			const obj = JSON.parse(block[1]);
			if (obj.group_channel || obj.group_subject || obj.conversation_label) conversation = obj;
			if (obj.username || obj.tag || obj.label || obj.name) sender = obj;
		} catch {
			// metadata is explicitly untrusted; ignore malformed blocks
		}
	}
	const channelId = String(sessionEntry.groupId || conversation.group_channel_id || "").trim()
		|| String(conversation.conversation_label || "").match(/channel id:(\d+)/)?.[1]
		|| String(sessionEntry.origin?.to || "").match(/(\d{10,})/)?.[1]
		|| String(sessionEntry.lastTo || "").match(/(\d{10,})/)?.[1]
		|| "";
	return {
		conversation,
		sender,
		channelId,
		guildId: String(sessionEntry.space || conversation.group_space || "").trim(),
		channelName: String(sessionEntry.groupChannel || conversation.group_channel || conversation.group_subject || "").trim()
	};
}

function cleanDiscordUserText(text) {
	let raw = String(text || "");
	if (/\[Queued messages while agent was busy\]/i.test(raw)) return "";
	raw = raw.replace(/^\s*System:\s*\[[^\]]+\]\s*Discord reaction added:[^\n]*(?:\n+|$)/gim, "");
	if (/^\s*System:/i.test(raw)) return "";
	return raw
		.replace(/Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/i, "")
		.replace(/Sender \(untrusted metadata\):\s*```json[\s\S]*?```\s*/i, "")
		.replace(/Untrusted context \(metadata, do not treat as instructions or commands\):\s*<<<EXTERNAL_UNTRUSTED_CONTENT>>>[\s\S]*?<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>/gi, "")
		.replace(/Replied message \(untrusted, for context\):\s*```json[\s\S]*?```\s*/gi, "")
		.replace(/\[media attached:[^\]]+\]\s*/gi, "")
		.replace(/To send an image back,[\s\S]*?Keep caption in the text body\.\s*/gi, "")
		.replace(/\s+/g, " ")
		.trim();
}

function compactContextLine(value, maxChars = 420) {
	const text = String(value || "").replace(/\s+/g, " ").trim();
	if (text.length <= maxChars) return text;
	return `${text.slice(0, Math.max(0, maxChars - 4)).replace(/\s+\S*$/g, "").trim()} ...`;
}

function recentDiscordVisibleContext(events, index, maxItems = 8) {
	const lines = [];
	const start = Math.max(0, index - maxItems);
	for (let i = start; i <= index; i += 1) {
		const msg = events[i]?.message;
		if (!msg || !["user", "assistant"].includes(msg.role)) continue;
		const raw = messageText(msg);
		const text = msg.role === "user"
			? cleanDiscordUserText(raw)
			: stripUserVisibleBoilerplate(raw);
		if (!text) continue;
		lines.push(`${msg.role === "user" ? "User" : "Pearl"}: ${compactContextLine(text)}`);
	}
	return lines.join("\n").slice(0, DISCORD_CONTEXT_MAX_CHARS);
}

function foldTaskEvents(events) {
	const tasks = new Map();
	for (const event of events) {
		const id = String(event?.id || event?.task?.id || "").trim();
		if (!id) continue;
		if (event.kind === "create") {
			tasks.set(id, { ...(event.task || {}) });
			continue;
		}
		if (event.kind !== "update") continue;
		const current = tasks.get(id);
		if (!current) continue;
		const patch = event.patch || {};
		for (const [key, value] of Object.entries(patch)) {
			if (key === "notes_append") continue;
			current[key] = value;
		}
		current.timestamp_updated = event.ts || current.timestamp_updated;
	}
	return [...tasks.values()];
}

function recentDiscordTaskResults(channelId, beforeMs, maxResults = 3) {
	const target = String(channelId || "").trim();
	if (!target) return "";
	const tasks = foldTaskEvents(readJsonlTail(TASKS_LOG_PATH, 1600));
	const matches = tasks
		.filter((task) => {
			const taskText = String(task?.task || "");
			if (!taskText.includes(`Discord source channel ${target}`) && !taskText.includes(`channel ${target}`)) return false;
			if (!["completed", "failed", "cancelled"].includes(String(task?.status || ""))) return false;
			const result = String(task?.result || task?.last_failure_result || "").trim();
			if (!result) return false;
			const completedMs = Date.parse(task?.completed_at || task?.timestamp_updated || task?.timestamp_created || "");
			if (!completedMs || (beforeMs && completedMs > beforeMs)) return false;
			if (beforeMs && beforeMs - completedMs > DISCORD_TASK_RESULT_LOOKBACK_MS) return false;
			return true;
		})
		.sort((a, b) => {
			const left = Date.parse(a?.completed_at || a?.timestamp_updated || "");
			const right = Date.parse(b?.completed_at || b?.timestamp_updated || "");
			return right - left;
		})
		.slice(0, maxResults);
	if (!matches.length) return "";
	return matches
		.map((task) => {
			const status = String(task?.status || "finished");
			const title = compactContextLine(task?.title || "background task", 100);
			const result = compactContextLine(task?.result || task?.last_failure_result || "", 700);
			return `- ${title} (${status}): ${result}`;
		})
			.join("\n")
			.slice(0, DISCORD_CONTEXT_MAX_CHARS);
	}

async function recentDiscordTaskAlreadyQueued(config, channelId, cleanText) {
	const target = String(channelId || "").trim();
	const request = compactContextLine(cleanText, 180).toLowerCase();
	if (!target || request.length < 20) return false;
	try {
		const tasks = await fetchStatusTasks(config);
		return tasks.some((task) => {
			const text = taskSearchText(task);
			if (!text.includes(`discord source channel ${target}`) && !text.includes(`channel ${target}`)) return false;
			if (text.includes(request)) return true;
			return request.slice(0, 80).length >= 40 && text.includes(request.slice(0, 80));
		});
	} catch {
		return false;
	}
}

function taskSearchText(task) {
	return [
		task?.title,
		task?.full_title,
		task?.task,
		task?.result,
		task?.swarm_category,
		Array.isArray(task?.agents) ? task.agents.join(" ") : "",
		task?.assignee,
		task?.executor_effective,
		task?.executor_requested
	].filter(Boolean).join("\n").toLowerCase();
}

function scoreStatusTask(task, requestText = "") {
	const query = String(requestText || "").toLowerCase();
	const text = taskSearchText(task);
	let score = 0;
	if (/\bsilver streak\b/.test(query) && /\bsilver streak\b/.test(text)) score += 8;
	if (/\bqa\b/.test(query) && /\b(?:qa rapid fire|#qa|qa status|qa board|qa item)\b/.test(text)) score += 6;
	if (/\bcodex\b/.test(query) && /\bcodex\b/.test(text)) score += 5;
	if (/\bclaude\b/.test(query) && /\bclaude\b/.test(text)) score += 4;
	if (/\b(?:qa rapid fire|silver streak|current qa|qa status|style creation|openrouter 401|mobile launcher|pulse mobile|filespace markdown|agency dispatch|bottom task toast|codex|claude)\b/.test(text)) score += 4;
	if (["pending", "in_progress"].includes(String(task?.status || ""))) score += 2;
	if (task?.result || task?.last_failure_result) score += 1;
	return score;
}

function taskStatusPhrase(task) {
	const status = String(task?.status || "unknown");
	const executor = String(task?.executor_effective || task?.executor_requested || "").toLowerCase();
	if (status === "pending" && Number(task?.retry_count || 0) > 0) return "retrying";
	if (status === "pending") return "queued";
	if (status === "in_progress" && executor.includes("codex")) return "Codex is working";
	if (status === "in_progress" && executor.includes("claude")) return "Claude is working";
	if (status === "in_progress" && executor) return `${executor} is working`;
	if (status === "in_progress") return "claimed; executor is starting";
	if (status === "completed") return "done";
	if (status === "failed") return "needs attention";
	if (status === "cancelled") return "cancelled";
	return status.replace("_", " ");
}

function publicTaskLine(task) {
	const title = stripUserVisibleBoilerplate(String(task?.title || task?.full_title || "Agency task"))
		.replace(/^QA Rapid Fire:\s*/i, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 100);
	const result = stripUserVisibleBoilerplate(String(task?.result || task?.last_failure_result || ""))
		.replace(/\s+/g, " ")
		.trim();
	const shortResult = result ? ` ${result.slice(0, 260)}${result.length > 260 ? "..." : ""}` : "";
	return `- ${title}: ${taskStatusPhrase(task)}.${shortResult}`;
}

async function fetchStatusTasks(config) {
	const statuses = ["in_progress", "pending", "completed", "failed", "cancelled"];
	const headers = taskAuthHeaders(config);
	const groups = await Promise.all(statuses.map(async (status) => {
		try {
			const json = await fetchJson(`${TASKS_API_URL}?status=${encodeURIComponent(status)}&source=discord&include_archived=false&limit=50`, {
				method: "GET",
				headers
			}, 5000);
			return Array.isArray(json?.tasks) ? json.tasks : [];
		} catch {
			return [];
		}
	}));
	return groups.flat();
}

async function agencyStatusReply(config, requestText) {
	const tasks = await fetchStatusTasks(config);
	const ranked = tasks
		.map((task) => ({ task, score: scoreStatusTask(task, requestText) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || Date.parse(b.task?.timestamp_updated || b.task?.completed_at || b.task?.timestamp_created || "") - Date.parse(a.task?.timestamp_updated || a.task?.completed_at || a.task?.timestamp_created || ""))
		.map((entry) => entry.task)
		.slice(0, 6);
	if (!ranked.length) {
		return "I can read the tracked Agency task board, but I do not see a matching Codex/QA task yet. The next recovery step is to queue the work through the tracked Agency path so status can come back here.";
	}
	const active = ranked.filter((task) => ["pending", "in_progress"].includes(String(task.status)));
	const done = ranked.filter((task) => ["completed", "failed", "cancelled"].includes(String(task.status)));
	const lines = [`Current tracked Agency status: ${active.length} active, ${done.length} recently finished or needing recovery.`];
	if (active.length) {
		lines.push("", "Active:");
		lines.push(...active.slice(0, 3).map(publicTaskLine));
	}
	if (done.length) {
		lines.push("", "Latest results:");
		lines.push(...done.slice(0, 4).map(publicTaskLine));
	}
	return truncateForDiscord(lines.join("\n"), 1800);
}

function isProgressSubscription(text) {
	const clean = String(text || "").replace(/\s+/g, " ").trim();
	if (!clean) return false;
	return /^(?:keep me updated|keep us updated|update me|let me know|tell me when|ping me when|keep watching)(?:\b|[.!?])/i.test(clean)
		&& /\b(?:when|if|once|answer|done|finished|complete|ready|get|hear|find)\b/i.test(clean);
}

function isActionableDiscordRequest(text) {
	const clean = String(text || "").trim();
	if (clean.length < 12) return false;
	if (/^(hi|hey|hello|thanks|thank you|ok|okay|lol|haha)[.!? ]*$/i.test(clean)) return false;
	if (isProgressSubscription(clean)) return false;
	if (looksLikeDiscordCorrectionOnly(clean)) return false;
	if (isAgencyStatusRequest(clean)) return true;
	return clean.length >= 40 || /\b(get|fix|implement|repair|create|make|check|investigate|finish|continue|update|deploy|restart|wire|map|solve|correct|delegate|research|find|test|audit)\b/i.test(clean);
}

function looksLikeDiscordCorrectionOnly(text) {
	const clean = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
	if (!clean) return false;
	return /^(?:no|nah|nope|actually|stop)[,.\s]+/.test(clean)
		&& /\b(?:don[’']?t|do not|doesn[’']?t|shouldn[’']?t|should not)\s+(?:go through|use|dispatch|queue|start|create)\b[\s\S]{0,80}\b(?:agent|agency|task|codex|claude|swarm)\b/.test(clean)
		&& !/\b(?:fix|repair|audit|investigate|debug|diagnose|verify|patch|implement|deploy|build)\b/.test(clean);
}

function isAgencyStatusRequest(text) {
	const clean = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
	if (!clean) return false;
	if (/^(?:and|so|status|update|progress)\??$/.test(clean)) return true;
	if (/^(?:tell me|show me|give me)\b[\s\S]{0,80}\b(?:what(?:'s| is) going on|status|update|progress|result|answer)\b/.test(clean)) return true;
	if (/^(?:what(?:'s| is) going on|where are we|what happened|did it (?:finish|get done|work)|did the (?:task|agent|agency|worker|codex) (?:finish|get done|work))\??$/.test(clean)) return true;
	if (/^(?:any|got|have)\s+(?:update|progress|answer|result|news)\??$/.test(clean)) return true;
	const subject = /\b(codex|claude|openclaw|agency|agency boss|worker|task|tasks|qa list|qa board|qa item|qa items|silver streak)\b/.test(clean);
	const ask = /\b(status|update|progress|check in|checking in|connect|connected|able to connect|picked up|running|queued|pending|blocked|failed|finished|completed|no progress|progress has been made)\b/.test(clean);
	return subject && ask;
}

function assistantHasVisibleTextBetween(events, startIndex) {
	for (let i = startIndex + 1; i < events.length; i += 1) {
		const msg = events[i]?.message;
		if (msg?.role !== "assistant") continue;
		if (messageText(msg).trim()) return true;
	}
	return false;
}

function visibleAssistantMessagesAfter(events, startIndex) {
	const visible = [];
	for (let i = startIndex + 1; i < events.length; i += 1) {
		const msg = events[i]?.message;
		if (msg?.role !== "assistant") continue;
		const text = messageText(msg).trim();
		if (!text) continue;
		visible.push({
			text,
			ts: Date.parse(events[i]?.timestamp || events[i]?.createdAt || "") || 0
		});
	}
	return visible;
}

function assistantLooksLikeProgressOnly(text) {
	const clean = stripUserVisibleBoilerplate(text)
		.replace(/<\/?(?:exec|tools?|tool_calls?|tool_use|tool_result|function|function_call|function_result)\b[^>]*\/?\s*>/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!clean) return true;
	if (/\bI saw Discord go quiet and restarted the native gateway\b/i.test(clean)) return true;
	if (/\bI still see the native Discord listener not answering\b/i.test(clean)) return true;
	if (/\bdirect Discord fallback path is still alive\b/i.test(clean)) return true;
	if (clean.length > 420) return false;
	const looksLikeProgress = /\b(?:let me|i[’']?ll\s+(?:look|check|dig|trace|investigate|pull|compare)|i[’']?m\s+(?:looking|checking|tracing|investigating|digging|pulling|comparing)|checking|tracing|investigating|still working|working on it|on it|give me|one sec|one moment|under the hood|continuing)\b/i.test(clean);
	if (!looksLikeProgress) return false;
	return !/\b(?:here[’']?s|results?|answer|recommendation|short version|tl;dr|i found|found that|costs?|priced at|per image|per second)\b/i.test(clean);
}

function discordSessionEntries() {
	const sessions = readJson(OPENCLAW_SESSIONS_PATH, {});
	if (!sessions || typeof sessions !== "object") return [];
	return Object.entries(sessions)
		.map(([key, value]) => ({ key, ...(value || {}) }))
		.filter((entry) => entry.channel === "discord" || String(entry.key || "").includes(":discord:"))
		.filter((entry) => entry.sessionFile && fs.existsSync(entry.sessionFile));
}

function discordSessionForChannel(channelId) {
	const target = String(channelId || "").trim();
	if (!target) return null;
	return discordSessionEntries().find((entry) => {
		return String(entry.groupId || "") === target
			|| String(entry.origin?.to || "").includes(target)
			|| String(entry.lastTo || "").includes(target)
			|| String(entry.key || "").includes(target)
			|| String(entry.displayName || "").includes(target);
	}) || null;
}

function ensureRuntimeState(state) {
	let changed = false;
	if (!state.discordSeen || typeof state.discordSeen !== "object") {
		state.discordSeen = {};
		changed = true;
	}
	if (!state.discordMemorySeen || typeof state.discordMemorySeen !== "object") {
		state.discordMemorySeen = {};
		changed = true;
	}
	if (!state.discordLinkGuidance || typeof state.discordLinkGuidance !== "object") {
		state.discordLinkGuidance = {};
		changed = true;
	}
	if (!state.obligations || typeof state.obligations !== "object") {
		state.obligations = {};
		changed = true;
	}
	if (!state.progressMessages || typeof state.progressMessages !== "object") {
		state.progressMessages = {};
		changed = true;
	}
	for (const [key, obligation] of Object.entries(state.obligations)) {
		if (
			obligation?.kind === "discord_unanswered_turn"
			&& obligation?.surface === "discord"
			&& isProgressSubscription(obligation?.goal || "")
		) {
			delete state.obligations[key];
			changed = true;
		}
	}
	return changed;
}

function pruneSeenMap(map, nowMs, maxAgeMs = DISCORD_SCAN_LOOKBACK_MS) {
	for (const [key, value] of Object.entries(map || {})) {
		const seenAt = Number(value?.seenAt || value || 0);
		if (!seenAt || nowMs - seenAt > maxAgeMs) delete map[key];
	}
}

function discordTurnKey(entry, event, cleanText) {
	return hashText([
		entry.sessionFile || entry.key || "",
		event?.id || "",
		event?.timestamp || "",
		cleanText
	].join("\n"));
}

function rememberDiscordTurn(state, scope, metadata, cleanText, event, entry, nowMs) {
	const key = discordTurnKey(entry, event, cleanText);
	if (state.discordMemorySeen[key]) return false;
	const channel = metadata.channelName || metadata.channelId || "Discord";
	const wrote = appendUserMemory(scope, `User said in ${channel}: ${cleanText}`, {
		source: "discord",
		kind: "conversation_observation"
	});
	state.discordMemorySeen[key] = { seenAt: nowMs, wrote };
	return true;
}

function shouldCreateDiscordContinuation(events, index, eventTsMs, nowMs) {
	const ageMs = nowMs - eventTsMs;
	if (ageMs < DISCORD_UNANSWERED_FIRST_UPDATE_MS) return false;
	if (ageMs > DISCORD_UNANSWERED_MAX_CREATE_AGE_MS) return false;
	const visibleAfter = visibleAssistantMessagesAfter(events, index);
	if (!visibleAfter.length) return true;
	return visibleAfter.every((item) => assistantLooksLikeProgressOnly(item.text));
}

async function scanDiscordSessions(config, state, nowMs) {
	let changed = ensureRuntimeState(state);
	pruneSeenMap(state.discordSeen, nowMs, DISCORD_UNANSWERED_MAX_CREATE_AGE_MS + CHAT_REPEAT_UPDATE_MS);
	pruneSeenMap(state.discordMemorySeen, nowMs);
	pruneSeenMap(state.discordLinkGuidance, nowMs, DISCORD_LINK_GUIDANCE_TTL_MS * 6);
	for (const entry of discordSessionEntries()) {
		const events = readJsonlTail(entry.sessionFile, 260);
		for (let index = 0; index < events.length; index += 1) {
			const event = events[index];
			const msg = event?.message;
			if (msg?.role !== "user") continue;
			const eventTsMs = Date.parse(event.timestamp || event.createdAt || "");
			if (!eventTsMs || nowMs - eventTsMs > DISCORD_SCAN_LOOKBACK_MS) continue;
			const rawText = messageText(msg);
			const cleanText = cleanDiscordUserText(rawText);
			if (!cleanText) continue;
			const metadata = parseDiscordMetadata(rawText, entry);
			const scope = await getLinkedDiscordAccountScope(config, metadata.sender);
			if (scope) {
				changed = rememberDiscordTurn(state, scope, metadata, cleanText, event, entry, nowMs) || changed;
			}
			if (!isActionableDiscordRequest(cleanText)) continue;
			if (!shouldCreateDiscordContinuation(events, index, eventTsMs, nowMs)) continue;
			const key = discordTurnKey(entry, event, cleanText);
			if (state.discordSeen[key] || state.obligations[`discord:${key}`]) continue;
			state.discordSeen[key] = { seenAt: nowMs, session: entry.key || "" };
			if (!scope) {
				await maybeSendDiscordLinkGuidance(config, metadata, state, nowMs);
				changed = true;
				continue;
			}
			if (await recentDiscordTaskAlreadyQueued(config, metadata.channelId, cleanText)) {
				changed = true;
				continue;
			}
			const channelLabel = metadata.channelName || `#${metadata.channelId}` || "Discord";
			const visibleContext = recentDiscordVisibleContext(events, index);
			const recentResults = recentDiscordTaskResults(metadata.channelId, eventTsMs);
			state.obligations[`discord:${key}`] = {
				id: `discord:${key}`,
				kind: "discord_unanswered_turn",
				surface: "discord",
				status: "pending",
				title: `Discord follow-up from ${channelLabel}`,
				goal: cleanText,
				context: [
					`Native OpenClaw Discord session ${entry.displayName || entry.key || "unknown"}.`,
					metadata.channelName || metadata.channelId ? `Channel: ${metadata.channelName || metadata.channelId}.` : "",
					metadata.sender?.username || metadata.sender?.label ? `Sender: ${metadata.sender.username || metadata.sender.label}.` : "",
					`Original request: ${cleanText.slice(0, 200)}`,
					recentResults ? `Recent completed background results for this channel:\n${recentResults}` : "",
					visibleContext ? `Recent visible Discord context:\n${visibleContext}` : "",
					scope ? `Use tenant/user memory scope ${scope.tenantId}/${scope.userId}.` : ""
				].filter(Boolean).join(" "),
				channelId: metadata.channelId,
				guildId: metadata.guildId,
				userEmail: scope?.userEmail || "",
				userId: scope?.userId || "",
				tenantId: scope?.tenantId || "",
				createdAt: eventTsMs,
				updatedAt: now(),
				nextWakeAt: nowMs,
				lastUserVisibleUpdateAt: 0,
				urgency: "urgent"
			};
			changed = true;
		}
	}
	return changed;
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

function normalizeUrgency(value) {
	const raw = String(value || "").trim().toLowerCase();
	return raw === "urgent" || raw === "high" ? "urgent" : "normal";
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			...options,
			signal: controller.signal,
			headers: {
				"content-type": "application/json",
				...(options.headers || {})
			}
		});
		const text = await res.text();
		let json = null;
		if (text) {
			try {
				json = JSON.parse(text);
			} catch {
				json = { text };
			}
		}
		if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`);
		return json;
	} finally {
		clearTimeout(timer);
	}
}

function obligationFile() {
	return path.join(STATE_DIR, "pearl-agent-obligations.json");
}

function readObligations() {
	const state = readJson(obligationFile(), { obligations: {} });
	if (!state.obligations || typeof state.obligations !== "object") state.obligations = {};
	state.schemaVersion = state.schemaVersion || 1;
	state.updatedAt = state.updatedAt || now();
	return state;
}

function writeObligations(state) {
	state.updatedAt = now();
	writeJson(obligationFile(), state);
}

function refreshRuntimeHeartbeat(state, nowMs) {
	if (RUNTIME_HEARTBEAT_MS <= 0) return false;
	const lastHeartbeatMs = Number(state.runtimeHeartbeat?.ts || 0)
		|| Date.parse(state.runtimeHeartbeat?.at || "")
		|| 0;
	if (lastHeartbeatMs && nowMs - lastHeartbeatMs < RUNTIME_HEARTBEAT_MS) return false;
	const sessionCount = discordSessionEntries().length;
	state.runtimeHeartbeat = {
		at: now(),
		ts: nowMs,
		pid: process.pid,
		tickMs: TICK_MS,
		heartbeatMs: RUNTIME_HEARTBEAT_MS,
		discordSessionCount: sessionCount,
		obligationCount: Object.keys(state.obligations || {}).length
	};
	return true;
}

function isTerminalTaskStatus(status) {
	return ["completed", "failed", "cancelled", "archived"].includes(String(status || ""));
}

function statusWord(status) {
	if (status === "in_progress") return "running";
	if (status === "pending") return "queued";
	if (status === "completed") return "finished";
	if (status === "archived") return "archived";
	return status || "unknown";
}

function userFacingGoal(obligation, fallback = "that") {
	return String(obligation?.goal || obligation?.title || fallback)
		.replace(/^Continue Discord request:\s*/i, "")
		.replace(/^Recover OpenClaw turn:\s*/i, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 220) || fallback;
}

function formalTaskTitle(text, channelLabel) {
	const cleaned = text
		.replace(/^(nah|yeah|yes|no|maybe|sure|ok|okay|yup|nope|hmm|uh)[,.\s]*/i, "")
		.replace(/^(for now|i want|can you|could you|please|go ahead|let's|lets)[,.\s]*/i, "")
		.replace(/^(a |an |the )/i, "")
		.trim();
	const title = cleaned.slice(0, 80);
	return title || `Follow-up from ${channelLabel}`;
}

function minutesSince(value) {
	const ts = typeof value === "number" ? value : Date.parse(String(value || ""));
	if (!ts) return null;
	return Math.max(0, Math.round((Date.now() - ts) / 60_000));
}

function stripInlineJsonToolObjects(text) {
	let value = String(text ?? "");
	const markers = ['"tool_call"', '"tool_calls"', '"function_call"', '"recipient_name"', '"exec_command"', '"parameters"', '"arguments"'];
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

function stripUserVisibleBoilerplate(text) {
	let value = String(text || "").replace(/\s+/g, " ").trim();
	value = value.replace(/(?:^|\n)\s*<exec\b[^\n]*(?:\n|$)/gi, "\n");
	value = stripInlineJsonToolObjects(value);
	value = value.replace(/<file\b[^>]*>[\s\S]*?<\/file>/gi, "");
	value = value.replace(/^\s*<file\b[^\n]*(?:\n|$)/gim, "");
	value = value.replace(/<\/?(?:sessions?|session)\b[^>]*\/?\s*>/gi, "");
	value = value.replace(/<(?:exec|tool|tools|tool_call|tool_calls|tool_use|tool_result|tool_results|function|function_call|function_result)\b[^>]*\/\s*>/gi, "");
	value = value.replace(/<(?:exec|tool|tools|tool_call|tool_calls|tool_use|tool_result|tool_results|function|function_call|function_result)\b[\s\S]*?(?:<\/(?:exec|tool|tools|tool_call|tool_calls|tool_use|tool_result|tool_results|function|function_call|function_result)>|$)/gi, "");
	value = value.replace(/```(?:json|xml|tool|tools?|function|function_call|tool_code)?\s*[\s\S]*?(?:"tool_call"|"tool_use"|"function_call"|"recipient_name"|"exec_command"|"pearl-task-dispatch"|"pearl-swarm-dispatch"|<exec\b)[\s\S]*?```/gi, "");
	value = value.replace(/^\s*(?:\*\*)?(?:Step\s+\d+\s*:\s*)?(?:Check|Run|Execute)\b[^\n]*(?:\*\*)?\s*\n\s*```(?:bash|sh|shell|zsh)?\s*[\s\S]*?```\s*/gim, "");
	value = value.replace(/^✅?\s*Discord follow-up from #[^.!?]+(?:is done\.?|is finished\.?)\s*/i, "");
	value = value.replace(/^✅?\s*Discord follow-up from [^.!?]+(?:is done\.?|is finished\.?)\s*/i, "");
	value = value.replace(/^Done\.\s*/i, "");
	value = value.replace(/^Progress update:\s*/i, "");
	value = value.replace(/\b(?:disp|run|task|session)-[a-f0-9][a-f0-9_.:-]{7,}\b/gi, "the task");
	value = value.replace(/\b[a-f0-9]{32,64}\b/gi, "an internal reference");
	value = value.replace(/\b(?:Task IDs?|run IDs?|dispatch IDs?|hashes|session IDs?)\b[^.!?]*(?:[.!?]|$)/gi, "");
	value = value.replace(/(?:^|\n)\s*(?:Pearl(?:'s Agency)? says:\s*){2,}/gi, "Pearl's Agency says: ");
	value = value.replace(/^\s*Pearl's Agency says:\s*Pearl(?:'s Agency)? says:\s*/i, "Pearl's Agency says: ");
	return value.replace(/\s+/g, " ").trim();
}

function softenInternalFailureText(text) {
	const value = stripUserVisibleBoilerplate(text);
	if (!value) return "";
	if (/^\s*(?:LLM request failed|provider rejected|rawError=|PROXY\s+\d{3}:)/i.test(value)) return "";
	if (/\b(?:workspace-write|danger-full-access|approval policy|permission mode|sandbox_permissions|require_escalated)\b/i.test(value)) {
		return "I hit a worker permissions problem before the task could finish cleanly.";
	}
	if (
		/\b(?:sandbox|external DNS|DNS|OpenClaw gateway|Discord API call|connector access|local workspace has no exported channel history)\b/i.test(value)
		&& /\b(?:couldn['’]?t|could not|blocked|unreachable|disabled|not reachable|no exported)\b/i.test(value)
	) {
		return "I hit a connector gap there: that worker was not running with live Discord channel access. The fix is to route channel lookups through the Discord-connected PearlOS runtime, not a sandbox-only task. I kept the useful part and dropped the raw worker diagnostics.";
	}
	return value;
}

function truncateForDiscord(text, limit = 1800) {
	const value = String(text || "").trim();
	if (value.length <= limit) return value;
	const suffix = " ...";
	const hardLimit = Math.max(0, limit - suffix.length);
	const slice = value.slice(0, hardLimit);
	const sentenceCut = Math.max(
		slice.lastIndexOf(". "),
		slice.lastIndexOf("! "),
		slice.lastIndexOf("? "),
		slice.lastIndexOf("\n\n")
	);
	if (sentenceCut > Math.floor(hardLimit * 0.65)) {
		return slice.slice(0, sentenceCut + 1).trim();
	}
	const wordCut = slice.lastIndexOf(" ");
	return `${slice.slice(0, wordCut > 0 ? wordCut : hardLimit).trim()}${suffix}`;
}

function taskCreatedMs(task) {
	return Date.parse(task?.timestamp_created || task?.created_at || task?.createdAt || "") || 0;
}

function latestTaskNote(task) {
	const notes = Array.isArray(task?.notes) ? task.notes : [];
	for (let i = notes.length - 1; i >= 0; i -= 1) {
		const note = notes[i];
		const text = typeof note === "string" ? note : note?.text;
		const clean = String(text || "").replace(/\s+/g, " ").trim();
		if (clean) return clean.slice(0, 260);
	}
	return "";
}

function discordProgressSuppressed(obligation) {
	return obligation?.surface === "discord"
		&& obligation.channelId
		&& DISCORD_NO_PROGRESS_CHANNELS.has(String(obligation.channelId));
}

function startedMessage(obligation) {
	return "";
}

function composeStartedMessage(state, obligation, nowMs) {
	const candidates = [
		startedMessage(obligation)
	].filter(Boolean);
	for (const candidate of candidates) {
		if (!GENERIC_ACKNOWLEDGEMENT_PATTERNS.some((pattern) => pattern.test(candidate))
			&& !recentlyUsedProgressMessage(state, obligation, candidate, nowMs)) {
			return candidate;
		}
	}
	return "";
}

function progressMessage(obligation, task = null) {
	const title = userFacingGoal(obligation, "that task");
	const note = softenInternalFailureText(latestTaskNote(task));
	if (!note) return "";
	return truncateForDiscord(`${title}: ${note}`, 700);
}

function nativeDiscordSessionIsActive(obligation, nowMs) {
	if (obligation?.surface !== "discord" || !obligation.channelId) return false;
	const entry = discordSessionForChannel(obligation.channelId);
	if (!entry) return false;
	const threshold = Math.max(
		Number(obligation.lastUserVisibleUpdateAt || 0),
		Number(obligation.createdAt || 0),
		nowMs - DISCORD_NATIVE_ACTIVE_SUPPRESS_MS
	);
	for (const event of readJsonlTail(entry.sessionFile, 80).reverse()) {
		const msg = event?.message;
		if (msg?.role !== "assistant") continue;
		const text = messageText(msg).trim();
		if (!text) continue;
		if (assistantLooksLikeProgressOnly(text)) continue;
		const ts = Date.parse(event.timestamp || event.createdAt || "") || 0;
		if (ts > threshold) return true;
	}
	return false;
}

async function notifyIfNativeQuiet(config, obligation, message, nowMs, { terminal = false } = {}) {
	if (nativeDiscordSessionIsActive(obligation, nowMs)) {
		obligation.lastSuppressedNotifyAt = nowMs;
		obligation.updatedAt = now();
		warn("suppressed watchdog notify because native Discord session is active", {
			kind: obligation.kind,
			channelId: obligation.channelId,
			terminal
		});
		return false;
	}
	return await notify(config, obligation, message);
}

function taskCreationFailureMessage() {
	return "I tried to queue that work, but the task board did not accept it cleanly. I’m not going to pretend it is running.";
}

function taskResultSummary(task, fallbackTitle) {
	const result = softenInternalFailureText(task?.result || task?.last_failure_result || "");
	const title = stripUserVisibleBoilerplate(fallbackTitle || "that");
	if (task?.status === "completed") {
		return result ? result : `I finished ${title}, but the worker did not leave a useful summary.`;
	}
	if (task?.status === "failed") {
		return result ? `I hit a blocker on ${title}: ${result}` : `I hit a blocker on ${title}, but the worker did not leave a useful failure note.`;
	}
	if (task?.status === "cancelled") return `That was cancelled: ${title || "the work"}.`;
	return `${title || "That"} is ${statusWord(task?.status)}.`;
}

function taskAlreadyUserNotified(task) {
	return Boolean(
		task?.result_notified_at
		|| task?.webhook_notified_at
		|| task?.suppress_result_notification
	);
}

function taskLevelNotificationCanRetireObligation(obligation, task) {
	if (obligation?.surface === "discord") return false;
	return taskAlreadyUserNotified(task);
}

function terminalResultShouldBypassNativeSuppression(obligation) {
	return obligation?.surface === "discord" && Boolean(obligation.channelId);
}

function retireTerminalObligation(state, id, obligation, task, message) {
	obligation.status = task?.status === "completed" ? "completed" : "failed";
	obligation.result = message || taskResultSummary(task, obligation.title || obligation.goal);
	obligation.completedAt = now();
	obligation.updatedAt = now();
	delete state.obligations[id];
	return true;
}

function normalizeDiscordUserVisibleText(text) {
	return String(text || "")
		.replace(/\bteam\s+slack\b/gi, "Discord channel")
		.trim();
}

async function sendDiscordMessage(config, channelId, content, reference = null) {
	const token = getDiscordBotToken(config);
	if (!token || !channelId) return false;
	const cleanContent = truncateForDiscord(softenInternalFailureText(normalizeDiscordUserVisibleText(content)));
	if (!cleanContent) return false;
	const body = {
		content: cleanContent,
		allowed_mentions: { parse: [] },
		...(reference ? { message_reference: reference } : {})
	};
	await fetchJson(`https://discord.com/api/v10/channels/${channelId}/messages`, {
		method: "POST",
		headers: { "authorization": `Bot ${token}` },
		body: JSON.stringify(body)
	}, 15000);
	return true;
}

async function pushWebChatInbox(config, content, obligation) {
	const userEmail = obligation.userEmail || WEBCHAT_USER_EMAIL;
	if (!userEmail) return false;
	const tenantId = obligation.tenantId || obligation.requesterTenantId || obligation.requester_tenant_id || WEBCHAT_TENANT_ID;
	if (!tenantId) {
		warn("web chat inbox notify skipped because tenant scope is missing", {
			surface: obligation.surface || "",
			hasUserEmail: Boolean(userEmail)
		});
		return false;
	}
	await fetchJson(CHAT_INBOX_API_URL, {
		method: "POST",
		headers: {
			...taskAuthHeaders(config),
			"x-user-email": userEmail,
			"x-tenant-id": tenantId,
			"x-pearl-tenant-id": tenantId
		},
		body: JSON.stringify({
			content: String(content || "").slice(0, 4000),
			kind: "agent_obligation",
			for_user_email: userEmail,
			tenant_id: tenantId,
			task_id: obligation.taskId || obligation.id,
			task_title: obligation.title || obligation.goal || "Pearl background work"
		})
	}, 10000);
	return true;
}

async function notify(config, obligation, message) {
	let delivered = false;
	if (obligation.surface === "discord" && obligation.channelId) {
		try {
			delivered = await sendDiscordMessage(config, obligation.channelId, message);
		} catch (error) {
			warn("discord source-channel notify failed", {
				channelId: obligation.channelId,
				error: String(error).slice(0, 180)
			});
		}
	}
	if (!delivered && obligation.surface === "discord") {
		const discordLogChannel = await resolveDiscordLogChannel(config, obligation.guildId);
		if (discordLogChannel) {
			const label = obligation.channelId ?
				`[source <#${obligation.channelId}>] ${message}` :
				message;
			delivered = await sendDiscordMessage(config, discordLogChannel, label);
		}
	}
	if (!delivered) {
		delivered = await pushWebChatInbox(config, message, obligation);
	}
	return delivered;
}

async function createAgencyTask(config, obligation) {
	const allowedSources = new Set(["web_chat", "discord", "discord_lookup", "voice", "manual"]);
	const taskSource = allowedSources.has(obligation.surface) ? obligation.surface : "manual";
	const channelLabel = obligation.channelId ? `channel ${obligation.channelId}` : "Pearl background work";
	const taskTitle = formalTaskTitle(obligation.title || obligation.goal || "", channelLabel);
	const taskText = [
		"Pearl autonomous continuation obligation.",
		`Goal: ${obligation.goal || obligation.title || "Continue user request."}`,
		obligation.context ? `Context: ${obligation.context}` : "",
		obligation.channelId ? `Discord source channel ${obligation.channelId}. Do not post task links or private task results into the public channel; notify the requester through PearlOS or DM unless the result is explicitly public-safe.` : "",
		obligation.lastAnswer ? `Pearl's last visible answer: ${obligation.lastAnswer}` : "",
		"",
		"Progress update requirement: update the user(s) on progress of the task, give new information. Do not send generic still-running placeholders.",
		"Follow-up context rule: resolve pronouns like it/that/this from the recent Discord context and completed task results above. If the context is insufficient, say exactly what is missing instead of switching topics.",
		"Work autonomously. Use current sources/tools as needed. Do not wait for the user to re-ask. If you are blocked, report the blocker plainly and include the next recovery step. Return a concise result Pearl can give the user."
	].filter(Boolean).join("\n");
	const json = await fetchJson(TASKS_API_URL, {
		method: "POST",
		headers: taskAuthHeaders(config, { "content-type": "application/json" }),
		body: JSON.stringify({
			task: taskText,
			title: taskTitle.slice(0, 120),
			source: taskSource,
			created_by: "pearl",
			assignee: AGENCY_TASK_ASSIGNEE,
			urgency: normalizeUrgency(obligation.urgency),
			requester_email: obligation.userEmail || undefined,
			requester_user_id: obligation.userId || undefined,
			requester_tenant_id: obligation.tenantId || undefined
		})
	}, 10000);
	return json?.task ?? json;
}

async function fetchTask(config, taskId) {
	const json = await fetchJson(`${TASKS_API_URL}/${encodeURIComponent(taskId)}`, {
		method: "GET",
		headers: taskAuthHeaders(config)
	}, 8000);
	return json?.task ?? json;
}

async function checkTaskApiAuth(config) {
	await fetchJson(`${TASKS_API_URL}?limit=1`, {
		method: "GET",
		headers: taskAuthHeaders(config)
	}, 8000);
}

function shouldSendProgress(obligation, nowMs) {
	if (discordProgressSuppressed(obligation)) return false;
	if (!obligation.lastUserVisibleUpdateAt) return true;
	return nowMs - Number(obligation.lastUserVisibleUpdateAt || 0) >= CHAT_REPEAT_UPDATE_MS;
}

async function processObligation(config, id, obligation, state, nowMs) {
	if (!obligation || ["completed", "failed", "cancelled"].includes(String(obligation.status || ""))) {
		delete state.obligations[id];
		return true;
	}
	if (nowMs - Number(obligation.createdAt || 0) > MAX_AGE_MS) {
		obligation.status = "failed";
		obligation.result = "Expired before completion.";
		return true;
	}
	if (nowMs < Number(obligation.nextWakeAt || 0)) return false;

	if (!obligation.taskId) {
		if (obligation.kind === "discord_unanswered_turn" && isAgencyStatusRequest(obligation.goal || obligation.title || "")) {
			const message = await agencyStatusReply(config, obligation.goal || obligation.title || "");
			const delivered = await notify(config, obligation, message);
			if (!delivered) {
				obligation.nextWakeAt = nowMs + Math.min(CHAT_REPEAT_UPDATE_MS, 60_000);
				obligation.updatedAt = now();
				return true;
			}
			obligation.status = "completed";
			obligation.result = message;
			obligation.completedAt = now();
			delete state.obligations[id];
			return true;
		}
		if (obligation.status === "creating_task") {
			const startedAtMs = Number(obligation.creatingTaskStartedAt || 0) || Date.parse(obligation.updatedAt || "") || 0;
			if (startedAtMs && nowMs - startedAtMs < TASK_CREATE_STALE_MS) {
				obligation.nextWakeAt = nowMs + Math.min(CHAT_REPEAT_UPDATE_MS, 60_000);
				return true;
			}
			warn("retrying stale task creation", { obligation: id, title: String(obligation.title || "").slice(0, 120) });
		}
		obligation.status = "creating_task";
		obligation.creatingTaskStartedAt = nowMs;
		obligation.updatedAt = now();
		writeObligations(state);
		const task = await createAgencyTask(config, obligation);
		obligation.taskId = task?.id || task?.taskId || "";
		if (!obligation.taskId) {
			delete obligation.creatingTaskStartedAt;
			obligation.status = "failed";
			obligation.result = "Task API returned no task id.";
			obligation.updatedAt = now();
			await notifyIfNativeQuiet(config, obligation, taskCreationFailureMessage(), nowMs, { terminal: true });
			delete state.obligations[id];
			return true;
		}
		delete obligation.creatingTaskStartedAt;
		obligation.status = "running";
		obligation.updatedAt = now();
		obligation.nextWakeAt = nowMs + CHAT_FIRST_UPDATE_MS;
		if (shouldSendProgress(obligation, nowMs)) {
			const message = composeStartedMessage(state, obligation, nowMs);
			if (message) {
				await notifyIfNativeQuiet(config, obligation, message, nowMs);
				rememberProgressMessage(state, obligation, message, nowMs);
				obligation.lastUserVisibleUpdateAt = nowMs;
			}
		}
		return true;
	}

	let task = null;
	try {
		task = await fetchTask(config, obligation.taskId);
	} catch (error) {
		warn("task poll failed", { obligation: id, error: String(error).slice(0, 180), hint: /401/.test(String(error)) ? "auth rejected — check BOT_CONTROL_SHARED_SECRET" : "" });
		obligation.nextWakeAt = nowMs + Math.min(CHAT_REPEAT_UPDATE_MS, 60_000);
		return true;
	}

	if (task && isTerminalTaskStatus(task.status)) {
		const message = taskResultSummary(task, obligation.title || obligation.goal);
		if (taskLevelNotificationCanRetireObligation(obligation, task)) {
			return retireTerminalObligation(state, id, obligation, task, message);
		}
		if (taskAlreadyUserNotified(task) && obligation.surface === "discord") {
			warn("task has generic notification marker; still posting terminal result to Discord source channel", {
				kind: obligation.kind,
				channelId: obligation.channelId,
				status: task.status
			});
		}
		if (!terminalResultShouldBypassNativeSuppression(obligation) && nativeDiscordSessionIsActive(obligation, nowMs)) {
			obligation.lastSuppressedNotifyAt = nowMs;
			warn("retired terminal obligation because native Discord session is active", {
				kind: obligation.kind,
				channelId: obligation.channelId,
				status: task.status
			});
			return retireTerminalObligation(state, id, obligation, task, message);
		}
		const delivered = terminalResultShouldBypassNativeSuppression(obligation)
			? await notify(config, obligation, message)
			: await notifyIfNativeQuiet(config, obligation, message, nowMs, { terminal: true });
		if (!delivered) {
			obligation.nextWakeAt = nowMs + Math.min(CHAT_REPEAT_UPDATE_MS, DISCORD_NATIVE_ACTIVE_SUPPRESS_MS);
			obligation.updatedAt = now();
			return true;
		}
		obligation.status = task.status === "completed" ? "completed" : "failed";
		obligation.result = message;
		obligation.completedAt = now();
		delete state.obligations[id];
		return true;
	}

	// Stale pending — task exists and is still pending, but was created long
	// ago and no worker will pick it up (e.g. blocked by pattern matching).
	// Mark obligation failed so the runtime stops polling and spamming.
	if (task && String(task.status) === "pending") {
		const createdMs = taskCreatedMs(task) || Number(obligation.createdAt || 0);
		if (createdMs && nowMs - createdMs > TASK_PENDING_STALE_MS) {
			const mins = Math.round((nowMs - createdMs) / 60_000);
			obligation.status = "failed";
			obligation.result = `Task stayed pending for ${mins} min (no worker picked it up — may be blocked or misrouted).`;
			obligation.updatedAt = now();
			obligation.completedAt = now();
			await notifyIfNativeQuiet(config, obligation, obligation.result, nowMs, { terminal: true });
			delete state.obligations[id];
			return true;
		}
	}

	if (shouldSendProgress(obligation, nowMs)) {
		const message = progressMessage(obligation, task);
		if (message) {
			await notifyIfNativeQuiet(config, obligation, message, nowMs);
			obligation.lastUserVisibleUpdateAt = nowMs;
		}
	}
	obligation.nextWakeAt = nowMs + CHAT_REPEAT_UPDATE_MS;
	obligation.updatedAt = now();
	return true;
}

async function tick() {
	const config = activeConfig();
	const state = readObligations();
	const nowMs = Date.now();
	let changed = await scanDiscordSessions(config, state, nowMs);
	for (const [id, obligation] of Object.entries(state.obligations)) {
		try {
			changed = await processObligation(config, id, obligation, state, nowMs) || changed;
		} catch (error) {
			warn("obligation processing failed", { obligation: id, error: String(error).slice(0, 240) });
			obligation.nextWakeAt = Date.now() + Math.min(CHAT_REPEAT_UPDATE_MS, 60_000);
			obligation.updatedAt = now();
			changed = true;
		}
	}
	changed = refreshRuntimeHeartbeat(state, nowMs) || changed;
	if (changed) writeObligations(state);
	try {
		await tickDiary({
			getSecret: (key) => getSecret(config, key),
			timeoutMs: DIARY_TICK_TIMEOUT_MS
		});
	} catch (error) {
		warn("diary tick failed", { error: String(error).slice(0, 240) });
	}
}

async function main() {
	if (process.argv.includes("--diary-status")) {
		console.log(JSON.stringify(diaryStatus(), null, 2));
		return;
	}
	if (process.argv.includes("--status")) {
		const config = activeConfig();
		const state = readObligations();
		const obligations = Object.values(state.obligations);
		const headers = taskAuthHeaders(config);
		console.log(JSON.stringify({
			configPath: CONFIG_PATH,
			statePath: obligationFile(),
			tasksApiUrl: TASKS_API_URL,
			authConfigured: Boolean(headers.authorization || headers["x-bot-secret"]),
			runtimeHeartbeat: state.runtimeHeartbeat || null,
			diary: diaryStatus(),
			count: obligations.length,
			discordSeenCount: Object.keys(state.discordSeen || {}).length,
			discordMemorySeenCount: Object.keys(state.discordMemorySeen || {}).length,
			byStatus: obligations.reduce((acc, item) => {
				const key = item.status || "unknown";
				acc[key] = (acc[key] || 0) + 1;
				return acc;
			}, {}),
			obligations: obligations.map((item) => ({
				id: item.id,
				kind: item.kind,
				status: item.status,
				title: item.title,
				taskId: item.taskId || "",
				nextWakeAt: item.nextWakeAt ? new Date(item.nextWakeAt).toISOString() : null
			}))
		}, null, 2));
		return;
	}
	if (process.argv.includes("--check-auth")) {
		const config = activeConfig();
		await checkTaskApiAuth(config);
		console.log(JSON.stringify({
			ok: true,
			configPath: CONFIG_PATH,
			tasksApiUrl: TASKS_API_URL,
			authConfigured: true
		}, null, 2));
		return;
	}
	try {
		await checkTaskApiAuth(activeConfig());
	} catch (error) {
		const config = activeConfig();
		const headers = taskAuthHeaders(config);
		warn("task API auth check failed at startup; runtime will keep retrying", {
			configPath: CONFIG_PATH,
			tasksApiUrl: TASKS_API_URL,
			authConfigured: Boolean(headers.authorization || headers["x-bot-secret"]),
			secretSources: [
				process.env.PEARL_TASKS_BOT_SECRET ? "env:PEARL_TASKS_BOT_SECRET" : null,
				process.env.BOT_CONTROL_SHARED_SECRET ? "env:BOT_CONTROL_SHARED_SECRET" : null,
				config?.env?.BOT_CONTROL_SHARED_SECRET ? "config:env.BOT_CONTROL_SHARED_SECRET" : null,
				config?.secrets?.BOT_CONTROL_SHARED_SECRET ? "config:secrets.BOT_CONTROL_SHARED_SECRET" : null,
				config?.gateway?.auth?.token ? "config:gateway.auth.token" : null,
			].filter(Boolean),
			error: String(error).slice(0, 300)
		});
	}
	log("starting", { state: obligationFile(), tickMs: TICK_MS, heartbeatMs: RUNTIME_HEARTBEAT_MS, diaryTimeoutMs: DIARY_TICK_TIMEOUT_MS });
	if (process.argv.includes("--once")) {
		await tick();
		return;
	}
	for (;;) {
		await tick();
		await sleep(TICK_MS);
	}
}

export const __privateTesting = {
	assistantLooksLikeProgressOnly,
	cleanGoalSnippet,
	composeStartedMessage,
	isActionableDiscordRequest,
	isAgencyStatusRequest,
	progressFocusSnippet,
	scanDiscordSessions,
	startedMessage,
	taskLevelNotificationCanRetireObligation,
	terminalResultShouldBypassNativeSuppression
};

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
const pm2InvokedUrl = process.env.pm_exec_path ? pathToFileURL(process.env.pm_exec_path).href : "";
if (import.meta.url === invokedUrl || import.meta.url === pm2InvokedUrl) {
	main().catch((error) => {
		console.error(`${now()} [pearl-agent-runtime] fatal ${String(error.stack || error)}`);
		process.exit(1);
	});
}
