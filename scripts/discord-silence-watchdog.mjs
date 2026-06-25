#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

const CONFIG_PATH = process.env.OPENCLAW_CONFIG ?? "/home/deploy/.openclaw/openclaw.json";
const STATE_PATH = process.env.PEARL_DISCORD_SILENCE_STATE ?? "/home/deploy/.openclaw/discord-silence-watchdog.json";
const OPENCLAW_SESSIONS_PATH = process.env.PEARL_OPENCLAW_SESSIONS_PATH ?? "/home/deploy/.openclaw/agents/main/sessions/sessions.json";
const OPENCLAW_SESSION_ARCHIVE_DIR = process.env.PEARL_OPENCLAW_SESSION_ARCHIVE_DIR ?? "/home/deploy/.openclaw/agents/main/session-archives";
const AGENT_OBLIGATIONS_PATH = process.env.PEARL_AGENT_OBLIGATIONS_PATH
	?? path.join(process.env.PEARL_RELAY_STATE_DIR ?? "/home/deploy/.openclaw/production-repair-relays", "pearl-agent-obligations.json");
const PEARLOS_BASE_URL = (process.env.PEARLOS_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const CHANNELS = parseCsv(process.env.PEARL_DISCORD_WATCH_CHANNELS ?? "1482123068854763642,1484598545502961795,1494906069149941921");
const POLL_MS = numberEnv("PEARL_DISCORD_SILENCE_POLL_MS", 60_000);
const UNANSWERED_MS = numberEnv("PEARL_DISCORD_SILENCE_UNANSWERED_MS", 2 * 60_000);
const RESTART_COOLDOWN_MS = numberEnv("PEARL_DISCORD_SILENCE_RESTART_COOLDOWN_MS", 15 * 60_000);
const FETCH_TIMEOUT_MS = numberEnv("PEARL_DISCORD_SILENCE_FETCH_TIMEOUT_MS", 15_000);
const SESSION_RESET_AFTER_RESTART_ATTEMPTS = numberEnv("PEARL_DISCORD_SESSION_RESET_AFTER_RESTART_ATTEMPTS", 3);
const MESSAGE_LIMIT = numberEnv("PEARL_DISCORD_SILENCE_MESSAGE_LIMIT", 50);
const NO_REPLY_RESET_THRESHOLD = numberEnv("PEARL_DISCORD_NO_REPLY_RESET_THRESHOLD", 2);
const PROMISE_FALLBACK_AFTER_RESTART_ATTEMPTS = numberEnv("PEARL_DISCORD_PROMISE_FALLBACK_AFTER_RESTART_ATTEMPTS", 2);
const PM2_PROCESSES = parseCsv(process.env.PEARL_DISCORD_SILENCE_PM2_PROCESS ?? "pearl-chat-relays-production-repair,openclaw-gateway");
const NOTICE_ENABLED = String(process.env.PEARL_DISCORD_SILENCE_NOTICE ?? "false").toLowerCase() === "true";
const PROMISE_FALLBACK_NOTICE_ENABLED = String(process.env.PEARL_DISCORD_PROMISE_FALLBACK_NOTICE ?? "true").toLowerCase() !== "false";
const ONCE = process.argv.includes("--once");
const linkedSenderCache = new Map();

function parseCsv(value) {
	return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function numberEnv(key, fallback) {
	const value = Number(process.env[key]);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function now() {
	return new Date().toISOString();
}

function log(message, extra = {}) {
	const rest = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
	console.log(`${now()} [discord-silence-watchdog] ${message}${rest}`);
}

function warn(message, extra = {}) {
	const rest = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
	console.warn(`${now()} [discord-silence-watchdog] ${message}${rest}`);
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

function compactTimestamp() {
	return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function getDiscordBotToken(config) {
	const value = config?.channels?.discord?.token
		|| config?.env?.DISCORD_BOT_TOKEN
		|| config?.secrets?.DISCORD_BOT_TOKEN
		|| process.env.DISCORD_BOT_TOKEN;
	if (typeof value === "string" && value.trim()) return value.trim();
	return "";
}

async function discordJson(token, route, options = {}) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await fetch(`https://discord.com/api/v10${route}`, {
			...options,
			signal: options.signal ?? controller.signal,
			headers: {
				"authorization": `Bot ${token}`,
				"content-type": "application/json",
				"user-agent": "DiscordBot (PearlOS silence watchdog, 1.0)",
				...(options.headers || {})
			}
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`Discord HTTP ${response.status}: ${text.slice(0, 240)}`);
		}
		return text ? JSON.parse(text) : null;
	} finally {
		clearTimeout(timeout);
	}
}

async function restartGateway() {
	const restarts = PM2_PROCESSES.map((processName) => `pm2 restart ${shellQuote(processName)} --update-env`).join(" ; ");
	const command = `${restarts} ; pm2 save`;
	await execFileAsync("/bin/bash", ["-lc", command], { timeout: 45_000 });
}

function shellQuote(value) {
	return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function newestHumanMessage(messages, botId) {
	return messages.find((message) => message?.author?.id !== botId && !message?.author?.bot) || null;
}

function humanMessages(messages, botId) {
	return messages.filter((message) => message?.author?.id !== botId && !message?.author?.bot);
}

function hasBotReplyAfter(messages, botId, messageTs) {
	const ts = Date.parse(messageTs);
	return messages.some((message) => {
		if (message?.author?.id !== botId) return false;
		if (isWatchdogNotice(message)) return false;
		if (assistantLooksLikeProgressPromise(message?.content || "")) return false;
		return Date.parse(message.timestamp) > ts;
	});
}

function isWatchdogNotice(message) {
	const content = String(message?.content || "");
	return content.includes("I saw Discord go quiet and restarted the native gateway")
		|| content.includes("I still see the native Discord listener not answering")
		|| content.includes("I promised to check that and did not come back with the result.");
}

function compactDiscordText(value) {
	return String(value ?? "").replace(/<@!?\d+>/g, "").replace(/\s+/g, " ").trim();
}

function looksLikePearlName(value) {
	return /\bpearl(?:\s+omega)?\b/i.test(compactDiscordText(value));
}

function looksLikeNudge(value) {
	const text = compactDiscordText(value).toLowerCase();
	return /^\?{1,3}$/.test(text)
		|| /^(?:pearl\??|pearl\s+omega\??|ping\??|hello\??|hey\??|you\s+there\??|still\s+there\??|any\s+update\??|update\??|status\??|and\??|so\??)$/.test(text);
}

function looksLikePublicQuestion(value) {
	const text = compactDiscordText(value).toLowerCase();
	if (!text) return false;
	if (looksLikeNudge(text)) return true;
	if (text.length < 8) return false;
	if (/^(?:what|which|who|where|when|why|how)\b/.test(text)) return true;
	if (/^(?:can|could|would|will|should|do|does|did|is|are|was|were)\s+(?:you|pearl|we|i|the\b)/.test(text)) return true;
	if (/\?\s*$/.test(text) && /\b(?:what|which|who|where|when|why|how|can|could|would|should|is|are|do|does|recommend|best|fastest|cheapest|available|rates?|prices?)\b/.test(text)) return true;
	return false;
}

function looksLikeConversationFollowup(value) {
	const text = compactDiscordText(value).toLowerCase();
	if (!text) return false;
	if (looksLikeNudge(text)) return true;
	if (/^(?:tell me|show me|give me)\b[\s\S]{0,80}\b(?:what(?:'s| is) going on|status|update|progress|result|answer)\b/.test(text)) return true;
	if (/^(?:what(?:'s| is) going on|where are we|what happened|did it (?:finish|get done|work)|did the (?:task|agent|agency|worker|codex) (?:finish|get done|work))\??$/.test(text)) return true;
	if (/^(?:any|got|have)\s+(?:update|progress|answer|result|news)\??$/.test(text)) return true;
	if (/^(?:still|is it|are we)\s+(?:running|working|blocked|stuck|waiting|queued|done|finished)\??$/.test(text)) return true;
	if (/^(?:seems|looks|sounds|feels)\s+like\s+(?:not|no|it|that|this|you|we)\b/.test(text)) return true;
	if (/^(?:nope|not really|still nothing|still silent|nothing yet)\.?$/.test(text)) return true;
	return false;
}

function looksLikeAgencyTask(value) {
	const text = compactDiscordText(value).toLowerCase();
	if (!text || text.length < 10) return false;
	if (/\b(?:tell|ask|have|dispatch|queue|run|send|hand|start)\b[\s\S]{0,80}\b(?:the\s+)?(?:agency|agent|task|codex|claude|swarm)\b/.test(text)) return true;
	if (/\b(?:agency|codex|claude|swarm)\b[\s\S]{0,120}\b(?:fix|repair|audit|investigate|debug|diagnose|verify|check|look\s+into|patch|implement|deploy|build)\b/.test(text)) return true;
	if (/\b(?:fix|repair|audit|investigate|debug|diagnose|verify|patch|implement|deploy|build|queue|dispatch)\b[\s\S]{0,120}\b(?:agency|task|codex|claude|swarm)\b/.test(text)) return true;
	return false;
}

function resolveDiscordGuildConfig(config, guildId, channelId) {
	const discord = config?.channels?.discord ?? {};
	const guilds = discord.guilds ?? {};
	if (guildId && guilds[guildId]) return guilds[guildId];
	for (const guild of Object.values(guilds)) {
		if (isDiscordChannelAllowed(channelId, guild?.channels)) return guild;
	}
	return null;
}

function isDiscordChannelAllowed(channelId, channels) {
	if (!channels) return true;
	if (Array.isArray(channels)) return channels.map(String).includes(String(channelId));
	if (typeof channels === "object") {
		const direct = channels[String(channelId)];
		if (direct && typeof direct === "object" && direct.enabled === false) return false;
		if (direct === false) return false;
		if (direct === true || direct?.enabled === true) return true;
		const wildcard = channels["*"];
		if (wildcard && typeof wildcard === "object") return wildcard.enabled !== false;
		return wildcard !== false;
	}
	return true;
}

function discordSenderAllowlisted(config, message, channelId) {
	const discord = config?.channels?.discord ?? {};
	const guild = resolveDiscordGuildConfig(config, message?.guild_id, channelId);
	const users = [
		...(Array.isArray(discord.users) ? discord.users : []),
		...(Array.isArray(guild?.users) ? guild.users : [])
	].map(String);
	const authorId = String(message?.author?.id || "");
	if (authorId && users.includes(authorId)) return true;
	const roles = new Set([
		...(Array.isArray(discord.roles) ? discord.roles : []),
		...(Array.isArray(guild?.roles) ? guild.roles : [])
	].map(String));
	const memberRoles = Array.isArray(message?.member?.roles) ? message.member.roles.map(String) : [];
	return memberRoles.some((role) => roles.has(role));
}

async function linkedDiscordSenderAllowed(config, senderId) {
	const discordUserId = String(senderId || "").trim();
	if (!/^\d{17,20}$/.test(discordUserId)) return false;
	const secret = (process.env.DISCORD_DM_LINK_SECRET || process.env.MESH_SHARED_SECRET || "").trim();
	if (!secret) return false;
	const cached = linkedSenderCache.get(discordUserId);
	const nowMs = Date.now();
	if (cached && cached.expiresAt > nowMs) return cached.allowed === true;
	try {
		const response = await fetch(`${PEARLOS_BASE_URL}/api/discord/dm-link/check?discordUserId=${encodeURIComponent(discordUserId)}`, {
			headers: { "x-internal-secret": secret }
		});
		if (!response.ok) {
			linkedSenderCache.set(discordUserId, { allowed: false, expiresAt: nowMs + 10_000 });
			return false;
		}
		const body = await response.json().catch(() => ({}));
		const allowed = body?.allowed === true;
		linkedSenderCache.set(discordUserId, { allowed, expiresAt: nowMs + (allowed ? 60_000 : 10_000) });
		return allowed;
	} catch {
		linkedSenderCache.set(discordUserId, { allowed: false, expiresAt: nowMs + 10_000 });
		return false;
	}
}

function messageMentionsBot(message, botId) {
	return Array.isArray(message?.mentions) && message.mentions.some((mention) => String(mention?.id || "") === String(botId));
}

function hasPriorActionableHumanMessage(messages, target, botId) {
	const targetTs = Date.parse(target?.timestamp || "");
	if (!targetTs) return false;
	return humanMessages(messages, botId).some((message) => {
		if (message?.id === target?.id) return false;
		if (message?.author?.id !== target?.author?.id) return false;
		const ts = Date.parse(message?.timestamp || "");
		if (!ts || ts >= targetTs) return false;
		if (hasBotReplyAfter(messages, botId, message.timestamp)) return false;
		const text = message?.content || "";
		return !looksLikeNudge(text) && (looksLikePearlName(text) || looksLikePublicQuestion(text) || looksLikeAgencyTask(text));
	});
}

function assistantLooksLikeProgressPromise(value) {
	const text = compactDiscordText(value);
	if (!text) return false;
	if (/\b(?:here(?:'s| is)|done|finished|completed|the answer|result(?:s)?|i found|found that)\b/i.test(text)) return false;
	return /\b(?:let me|i[’']?ll\s+(?:check|look|dig|trace|investigate|pull|audit|dispatch|queue|report)|i[’']?m\s+(?:checking|looking|digging|tracing|investigating|pulling|auditing)|checking|looking into|give me|one sec|one moment|working on it)\b/i.test(text);
}

function hasRecentBotProgressBefore(messages, target, botId) {
	const targetTs = Date.parse(target?.timestamp || "");
	if (!targetTs) return false;
	const maxAgeMs = 45 * 60 * 1000;
	return messages.some((message) => {
		if (message?.author?.id !== botId || isWatchdogNotice(message)) return false;
		const ts = Date.parse(message?.timestamp || "");
		if (!ts || ts >= targetTs || targetTs - ts > maxAgeMs) return false;
		return assistantLooksLikeProgressPromise(message?.content || "");
	});
}

function progressOnlyBotRepliesAfter(messages, botId, messageTs) {
	const ts = Date.parse(messageTs || "");
	if (!ts) return [];
	return messages
		.filter((message) => {
			if (message?.author?.id !== botId || isWatchdogNotice(message)) return false;
			const messageTime = Date.parse(message?.timestamp || "");
			return messageTime > ts && assistantLooksLikeProgressPromise(message?.content || "");
		})
		.sort((a, b) => Date.parse(a.timestamp || "") - Date.parse(b.timestamp || ""));
}

function hasRecentFollowupContext(messages, target, botId) {
	if (hasPriorActionableHumanMessage(messages, target, botId)) return true;
	if (hasRecentBotProgressBefore(messages, target, botId)) return true;
	const targetTs = Date.parse(target?.timestamp || "");
	if (!targetTs) return false;
	const maxAgeMs = 45 * 60 * 1000;
	return humanMessages(messages, botId).some((message) => {
		if (message?.id === target?.id) return false;
		if (message?.author?.id !== target?.author?.id) return false;
		const ts = Date.parse(message?.timestamp || "");
		if (!ts || ts >= targetTs || targetTs - ts > maxAgeMs) return false;
		const text = message?.content || "";
		return looksLikePearlName(text) || looksLikePublicQuestion(text) || looksLikeAgencyTask(text);
	});
}

async function shouldRecoverHumanMessage({ config, messages, message, botId, channelId }) {
	const content = message?.content || "";
	if (!compactDiscordText(content)) return false;
	const guild = resolveDiscordGuildConfig(config, message?.guild_id, channelId);
	const channelAllowed = isDiscordChannelAllowed(channelId, guild?.channels ?? config?.channels?.discord?.channels);
	if (!channelAllowed) return false;
	const addressed = messageMentionsBot(message, botId) || looksLikePearlName(content);
	const agencyTask = looksLikeAgencyTask(content);
	const publicQuestion = looksLikePublicQuestion(content);
	const conversationFollowup = looksLikeConversationFollowup(content);
	if (!addressed && !agencyTask && !publicQuestion && !conversationFollowup) return false;
	if ((looksLikeNudge(content) || conversationFollowup) && !addressed && !hasRecentFollowupContext(messages, message, botId)) return false;
	if (addressed) return true;
	if (discordSenderAllowlisted(config, message, channelId)) return true;
	return linkedDiscordSenderAllowed(config, message?.author?.id);
}

async function newestRecoverableHumanMessage({ config, messages, botId, channelId }) {
	for (const message of humanMessages(messages, botId)) {
		if (!message?.timestamp || !message?.id) continue;
		if (hasBotReplyAfter(messages, botId, message.timestamp)) return null;
		if (await shouldRecoverHumanMessage({ config, messages, message, botId, channelId })) return message;
	}
	return null;
}

function stateForChannel(state, channelId) {
	state.channels ??= {};
	state.channels[channelId] ??= {};
	return state.channels[channelId];
}

function sessionKeyForChannel(channelId) {
	return `agent:main:discord:channel:${channelId}`;
}

function sessionKeysForChannel(sessions, channelId) {
	const channel = String(channelId);
	const keys = new Set([sessionKeyForChannel(channel)]);
	for (const key of Object.keys(sessions || {})) {
		if (key.includes(`:${channel}:`) || key.endsWith(`:${channel}`)) keys.add(key);
	}
	return [...keys];
}

function sessionFileForId(sessionId) {
	return path.join(path.dirname(OPENCLAW_SESSIONS_PATH), `${sessionId}.jsonl`);
}

function textFromContent(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((item) => typeof item?.text === "string" ? item.text : "").join("");
}

function countRecentNoReply(sessionFile) {
	if (!fs.existsSync(sessionFile)) return 0;
	const lines = fs.readFileSync(sessionFile, "utf8").trim().split("\n").slice(-80).reverse();
	let count = 0;
	for (const line of lines) {
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event?.type !== "message") continue;
		const message = event.message;
		if (message?.role === "assistant") {
			if (textFromContent(message.content).trim() === "NO_REPLY") {
				count += 1;
				continue;
			}
			break;
		}
		if (message?.role === "user") break;
	}
	return count;
}

function resetOpenClawChannelSession(channelId, reason) {
	const sessions = readJson(OPENCLAW_SESSIONS_PATH);
	const keys = sessionKeysForChannel(sessions, channelId).filter((key) => sessions?.[key]);
	if (keys.length === 0) return { reset: false, reason: "no-session" };

	const stamp = compactTimestamp();
	fs.mkdirSync(OPENCLAW_SESSION_ARCHIVE_DIR, { recursive: true });
	fs.copyFileSync(OPENCLAW_SESSIONS_PATH, path.join(OPENCLAW_SESSION_ARCHIVE_DIR, `sessions.json.before-${channelId}-${stamp}`));
	const sessionIds = [];
	for (const key of keys) {
		const session = sessions[key];
		const sessionId = session?.sessionId || session?.id;
		if (!sessionId) continue;
		sessionIds.push(sessionId);
		const sessionFile = sessionFileForId(sessionId);
		if (fs.existsSync(sessionFile)) {
			fs.copyFileSync(sessionFile, path.join(OPENCLAW_SESSION_ARCHIVE_DIR, `${sessionId}.before-${reason}-${stamp}.jsonl`));
		}
	}

	for (const key of keys) delete sessions[key];
	writeJson(OPENCLAW_SESSIONS_PATH, sessions);
	return { reset: true, sessionId: sessionIds[0] || "", resetKeys: keys.length };
}

function inspectNoReplyFault(channelId) {
	const sessions = readJson(OPENCLAW_SESSIONS_PATH);
	const keys = sessionKeysForChannel(sessions, channelId);
	let max = { count: 0, sessionId: "" };
	for (const key of keys) {
		const session = sessions?.[key];
		const sessionId = session?.sessionId || session?.id;
		if (!sessionId) continue;
		const count = countRecentNoReply(sessionFileForId(sessionId));
		if (count > max.count) max = { count, sessionId };
	}
	return max;
}

function visibleDiscordContext(messages, botId, targetHuman, maxChars = 1800) {
	const targetTs = Date.parse(targetHuman?.timestamp || "");
	const targetAuthor = String(targetHuman?.author?.id || "");
	const rows = [...messages]
		.reverse()
		.filter((message) => {
			const ts = Date.parse(message?.timestamp || "");
			if (!ts || Math.abs(ts - targetTs) > 45 * 60 * 1000) return false;
			if (message?.author?.bot && message?.author?.id !== botId) return false;
			return message?.author?.id === botId || String(message?.author?.id || "") === targetAuthor;
		})
		.map((message) => {
			const speaker = message?.author?.id === botId ? "Pearl" : "User";
			return `${speaker}: ${compactDiscordText(message?.content || "").slice(0, 500)}`;
		})
		.filter((line) => !line.endsWith(":"));
	const joined = rows.join("\n");
	return joined.length > maxChars ? `${joined.slice(0, maxChars)}...` : joined;
}

function ensureAgentObligationState(value) {
	if (!value || typeof value !== "object") value = {};
	if (!value.obligations || typeof value.obligations !== "object") value.obligations = {};
	return value;
}

function createProgressFallbackObligation({ messages, botId, channelId, targetHuman, progressMessages }) {
	const state = ensureAgentObligationState(readJson(AGENT_OBLIGATIONS_PATH, { obligations: {} }));
	const obligationId = `discord-watchdog:${channelId}:${targetHuman.id}`;
	if (state.obligations[obligationId]) return { created: false, obligationId };
	const lastProgress = progressMessages[progressMessages.length - 1];
	const context = [
		"Native OpenClaw Discord replied only with progress/process narration and did not return a concrete answer.",
		`Original request: ${compactDiscordText(targetHuman.content || "").slice(0, 500)}`,
		lastProgress ? `Pearl's last visible progress-only answer: ${compactDiscordText(lastProgress.content || "").slice(0, 500)}` : "",
		`Recent visible Discord context:\n${visibleDiscordContext(messages, botId, targetHuman)}`
	].filter(Boolean).join("\n");
	const nowMs = Date.now();
	state.obligations[obligationId] = {
		id: obligationId,
		kind: "discord_unanswered_turn",
		surface: "discord",
		status: "pending",
		title: `Discord follow-up from #${channelId}`,
		goal: compactDiscordText(targetHuman.content || ""),
		context,
		lastAnswer: lastProgress ? compactDiscordText(lastProgress.content || "") : "",
		channelId: String(channelId),
		guildId: String(targetHuman.guild_id || ""),
		userId: String(targetHuman.author?.id || ""),
		createdAt: Date.parse(targetHuman.timestamp || "") || nowMs,
		updatedAt: now(),
		nextWakeAt: nowMs,
		lastUserVisibleUpdateAt: nowMs,
		urgency: "high"
	};
	writeJson(AGENT_OBLIGATIONS_PATH, state);
	return { created: true, obligationId };
}

async function checkChannel({ config, token, botId, state, channelId }) {
	const messages = await discordJson(token, `/channels/${channelId}/messages?limit=${MESSAGE_LIMIT}`);
	if (!Array.isArray(messages) || messages.length === 0) {
		log("no recent messages", { channelId });
		return;
	}

	const latestHuman = newestHumanMessage(messages, botId);
	if (!latestHuman?.timestamp || !latestHuman?.id) {
		log("no recent human messages", { channelId });
		return;
	}

	const channelState = stateForChannel(state, channelId);
	if (hasBotReplyAfter(messages, botId, latestHuman.timestamp)) {
		channelState.lastAnsweredHumanMessageId = latestHuman.id;
		channelState.lastAnsweredAt = now();
		log("channel healthy", { channelId, latestHumanAt: latestHuman.timestamp });
		return;
	}

	const targetHuman = await newestRecoverableHumanMessage({ config, messages, botId, channelId });
	if (!targetHuman?.timestamp || !targetHuman?.id) {
		channelState.lastIgnoredHumanMessageId = latestHuman.id;
		channelState.lastIgnoredAt = now();
		log("latest unanswered human message is not actionable under Discord policy", {
			channelId,
			latestHumanAt: latestHuman.timestamp
		});
		return;
	}

	const humanTs = Date.parse(targetHuman.timestamp);
	const ageMs = Date.now() - humanTs;
	const answered = hasBotReplyAfter(messages, botId, targetHuman.timestamp);
	const progressMessages = progressOnlyBotRepliesAfter(messages, botId, targetHuman.timestamp);

	if (answered) {
		channelState.lastAnsweredHumanMessageId = targetHuman.id;
		channelState.lastAnsweredAt = now();
		log("channel healthy", { channelId, latestHumanAt: targetHuman.timestamp });
		return;
	}

	const restartAttemptsSoFar = channelState.lastRestartForHumanMessageId === targetHuman.id
		? Number(channelState.restartAttemptsForHumanMessageId || 1)
		: 0;
	if (
		progressMessages.length > 0
		&& restartAttemptsSoFar >= PROMISE_FALLBACK_AFTER_RESTART_ATTEMPTS
	) {
		const result = createProgressFallbackObligation({ messages, botId, channelId, targetHuman, progressMessages });
		channelState.lastProgressFallbackForHumanMessageId = targetHuman.id;
		channelState.lastProgressFallbackAt = now();
		warn(result.created ? "progress-only Discord answer escalated to tracked continuation" : "progress-only Discord answer already escalated", {
			channelId,
			latestHumanAt: targetHuman.timestamp,
			restartAttempts: restartAttemptsSoFar
		});
		if (PROMISE_FALLBACK_NOTICE_ENABLED && channelState.lastProgressFallbackNoticeForHumanMessageId !== targetHuman.id) {
			const content = "I promised to check that and did not come back with the result. I am moving it into a tracked continuation now instead of pretending a restart fixed it.";
			await discordJson(token, `/channels/${channelId}/messages`, {
				method: "POST",
				body: JSON.stringify({
					content,
					message_reference: {
						message_id: targetHuman.id,
						channel_id: channelId,
						guild_id: targetHuman.guild_id,
						fail_if_not_exists: false
					},
					allowed_mentions: { parse: [] }
				})
			});
			channelState.lastProgressFallbackNoticeForHumanMessageId = targetHuman.id;
			channelState.lastProgressFallbackNoticeAt = now();
		}
		return;
	}

	if (ageMs < UNANSWERED_MS) {
		log("waiting before recovery", { channelId, latestHumanAt: targetHuman.timestamp, ageMs });
		return;
	}

	const channelCooldownAge = Date.now() - Number(channelState.lastRestartAtMs || 0);
	const globalCooldownAge = Date.now() - Number(state.lastRestartAtMs || 0);
	const cooldownAge = Math.min(channelCooldownAge, globalCooldownAge);
	if (cooldownAge < RESTART_COOLDOWN_MS) {
		const alreadyRestartedForMessage = channelState.lastRestartForHumanMessageId === targetHuman.id;
		warn(alreadyRestartedForMessage
			? "unanswered message already recovered once and remains inside restart cooldown"
			: "unanswered message remains inside restart cooldown", {
			channelId,
			latestHumanAt: targetHuman.timestamp,
			ageMs,
			channelCooldownAge,
			globalCooldownAge
		});
		if (NOTICE_ENABLED && channelState.lastNoticeForHumanMessageId !== targetHuman.id) {
			const content = "I still see the native Discord listener not answering, so I am keeping the direct fallback visible while the gateway cooldown runs. No mystery silence.";
			await discordJson(token, `/channels/${channelId}/messages`, {
				method: "POST",
				body: JSON.stringify({ content })
			});
			channelState.lastNoticeForHumanMessageId = targetHuman.id;
			channelState.lastNoticeAt = now();
		} else if (!NOTICE_ENABLED) {
			log("restart cooldown notice suppressed", { channelId, latestHumanAt: targetHuman.timestamp });
		}
		return;
	}

	const retryingSameMessage = channelState.lastRestartForHumanMessageId === targetHuman.id;
	const restartAttempts = retryingSameMessage
		? Number(channelState.restartAttemptsForHumanMessageId || 1) + 1
		: 1;
	warn(retryingSameMessage
		? "unanswered message still unrecovered after previous restart; retrying gateway recovery"
		: "unanswered message exceeded threshold; restarting gateway", {
		channelId,
		latestHumanAt: targetHuman.timestamp,
		ageMs,
		restartAttempts
	});
	const noReplyFault = inspectNoReplyFault(channelId);
	const resetReason = noReplyFault.count >= NO_REPLY_RESET_THRESHOLD
		? "no-reply"
		: restartAttempts >= SESSION_RESET_AFTER_RESTART_ATTEMPTS && channelState.lastSessionResetForHumanMessageId !== targetHuman.id
			? "unanswered-retry"
			: "";
	if (resetReason) {
		const resetResult = resetOpenClawChannelSession(channelId, resetReason);
		warn(resetReason === "no-reply"
			? "reset OpenClaw channel session after repeated NO_REPLY"
			: "reset OpenClaw channel session after repeated unanswered recovery attempts", {
			channelId,
			noReplyCount: noReplyFault.count,
			restartAttempts,
			sessionId: resetResult.sessionId || noReplyFault.sessionId,
			reset: resetResult.reset,
			resetKeys: resetResult.resetKeys || 0
		});
		channelState.lastSessionResetAt = now();
		channelState.lastSessionResetForHumanMessageId = targetHuman.id;
	}
	await restartGateway();

	channelState.lastRestartForHumanMessageId = targetHuman.id;
	channelState.restartAttemptsForHumanMessageId = restartAttempts;
	channelState.lastRestartAt = now();
	channelState.lastRestartAtMs = Date.now();
	state.lastRestartAt = channelState.lastRestartAt;
	state.lastRestartAtMs = channelState.lastRestartAtMs;

	if (NOTICE_ENABLED && channelState.lastNoticeForHumanMessageId !== targetHuman.id) {
		const content = "I saw Discord go quiet and restarted the native gateway. If this message arrived, the direct Discord fallback path is still alive while the main listener recovers.";
		await discordJson(token, `/channels/${channelId}/messages`, {
			method: "POST",
			body: JSON.stringify({ content })
		});
		channelState.lastNoticeForHumanMessageId = targetHuman.id;
		channelState.lastNoticeAt = now();
	} else if (!NOTICE_ENABLED) {
		log("restart notice suppressed", { channelId, latestHumanAt: targetHuman.timestamp });
	}
}

async function tick() {
	const config = readJson(CONFIG_PATH);
	const token = getDiscordBotToken(config);
	if (!token) throw new Error(`Discord bot token not configured in ${CONFIG_PATH}`);
	const me = await discordJson(token, "/users/@me");
	const botId = String(me?.id || "");
	if (!botId) throw new Error("Unable to resolve Discord bot id");

	const state = readJson(STATE_PATH, { channels: {} }) ?? { channels: {} };
	state.lastCheckAt = now();
	state.botId = botId;

	for (const channelId of CHANNELS) {
		try {
			await checkChannel({ config, token, botId, state, channelId });
		} catch (error) {
			warn("channel check failed", { channelId, error: String(error).slice(0, 240) });
		}
	}

	writeJson(STATE_PATH, state);
}

async function main() {
	if (CHANNELS.length === 0) throw new Error("No Discord channels configured for watchdog");
	if (PM2_PROCESSES.length === 0) throw new Error("No PM2 processes configured for watchdog recovery");
	log("starting", { channels: CHANNELS, pollMs: POLL_MS, unansweredMs: UNANSWERED_MS, pm2Processes: PM2_PROCESSES });
	do {
		try {
			await tick();
		} catch (error) {
			warn("tick failed", { error: String(error).slice(0, 240) });
		}
		if (ONCE) break;
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	} while (true);
}

export const __privateTesting = {
	assistantLooksLikeProgressPromise,
	hasRecentBotProgressBefore,
	hasBotReplyAfter,
	looksLikeConversationFollowup,
	shouldRecoverHumanMessage,
	discordJson,
	progressOnlyBotRepliesAfter
};

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
const pm2InvokedUrl = process.env.pm_exec_path ? pathToFileURL(process.env.pm_exec_path).href : "";
if (import.meta.url === invokedUrl || import.meta.url === pm2InvokedUrl) {
	main().catch((error) => {
		warn("fatal", { error: String(error).slice(0, 240) });
		process.exit(1);
	});
}
