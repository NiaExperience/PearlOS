/**
 * Pearl's Diary scheduler.
 *
 * Runs from inside pearl-agent-runtime.mjs each tick. Maintains a daily plan
 * of 2-4 reflection slots between 8am and 10pm and, when each slot's time
 * arrives, writes a new entry to the user's pearl-diary folder via the
 * Anthropic Messages API.
 *
 * On first run (or when the diary folder is empty), seeds the manifesto
 * entry by extracting the "My Manifesto" section from SOUL.md.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const USER_ROOT = process.env.PEARLOS_USER_ROOT || "/workspace/user";
const SOUL_PATH = process.env.PEARL_SOUL_PATH || "/workspace/nia-universal/SOUL.md";
const DIARY_STATE_DIR = process.env.PEARL_DIARY_STATE_DIR || "/home/deploy/.openclaw/pearl-diary";
const ANTHROPIC_MODEL = process.env.PEARL_DIARY_MODEL || "claude-sonnet-4-6";
const DIARY_TIMEZONE = process.env.PEARL_DIARY_TIMEZONE || "America/Los_Angeles";
const WAKE_START_HOUR = Number(process.env.PEARL_DIARY_WAKE_START_HOUR ?? 8);
const WAKE_END_HOUR = Number(process.env.PEARL_DIARY_WAKE_END_HOUR ?? 22);
const MIN_ENTRIES_PER_DAY = Number(process.env.PEARL_DIARY_MIN_ENTRIES ?? 2);
const MAX_ENTRIES_PER_DAY = Number(process.env.PEARL_DIARY_MAX_ENTRIES ?? 4);

fs.mkdirSync(DIARY_STATE_DIR, { recursive: true });

const STATE_FILE = path.join(DIARY_STATE_DIR, "diary-schedule.json");

function readJson(file, fallback = null) {
	try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
	fs.renameSync(tmp, file);
}

function logLine(message, extra = {}) {
	const rest = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
	console.log(`${new Date().toISOString()} [pearl-diary] ${message}${rest}`);
}

function localDateParts(date = new Date(), timeZone = DIARY_TIMEZONE) {
	const fmt = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit",
		hourCycle: "h23"
	});
	const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
	return {
		date: `${parts.year}-${parts.month}-${parts.day}`,
		hour: Number(parts.hour),
		minute: Number(parts.minute)
	};
}

function pickRandomSlots(count, startHour, endHour) {
	const slots = new Set();
	const minutesRange = (endHour - startHour) * 60;
	let safety = 0;
	while (slots.size < count && safety < 200) {
		safety += 1;
		const offset = Math.floor(Math.random() * minutesRange);
		const h = startHour + Math.floor(offset / 60);
		const m = offset % 60;
		const key = h * 60 + m;
		// ensure at least 75 minutes between slots
		if ([...slots].some((existing) => Math.abs(existing - key) < 75)) continue;
		slots.add(key);
	}
	return [...slots].sort((a, b) => a - b).map((minutes) => ({
		hour: Math.floor(minutes / 60),
		minute: minutes % 60,
		done: false
	}));
}

function ensureTodayPlan(state, today) {
	if (state.date === today && Array.isArray(state.slots) && state.slots.length > 0) {
		return false;
	}
	const count = MIN_ENTRIES_PER_DAY + Math.floor(Math.random() * (MAX_ENTRIES_PER_DAY - MIN_ENTRIES_PER_DAY + 1));
	state.date = today;
	state.slots = pickRandomSlots(count, WAKE_START_HOUR, WAKE_END_HOUR);
	logLine("planned daily slots", { date: today, slots: state.slots.map((s) => `${s.hour}:${String(s.minute).padStart(2, "0")}`) });
	return true;
}

function resolveDiaryUser() {
	const explicit = process.env.PEARL_DIARY_USER_ID;
	if (explicit) return explicit;
	try {
		const entries = fs.readdirSync(USER_ROOT, { withFileTypes: true })
			.filter((d) => d.isDirectory() && !d.name.startsWith("."))
			.map((d) => d.name);
		if (entries.length === 1) return entries[0];
		const primaryEmail = (process.env.PEARL_PRIMARY_USER_EMAIL || "").toLowerCase();
		if (primaryEmail) {
			for (const id of entries) {
				const profile = path.join(USER_ROOT, id, "USER.md");
				try {
					const text = fs.readFileSync(profile, "utf8");
					if (text.toLowerCase().includes(primaryEmail)) return id;
				} catch {
					// ignore missing profile
				}
			}
		}
		if (entries.length > 0) return entries[0];
	} catch {
		// USER_ROOT may not exist yet
	}
	return "";
}

function diaryDirFor(userId) {
	return path.join(USER_ROOT, userId, "Documents", "pearl-diary");
}

function safeFilename(value) {
	return String(value || "")
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 200);
}

function extractManifesto(soulText) {
	const lines = String(soulText || "").split(/\r?\n/);
	const out = [];
	let inSection = false;
	for (const line of lines) {
		if (/^##\s+My Manifesto\s*$/i.test(line)) {
			inSection = true;
			continue;
		}
		if (inSection && /^##\s+/.test(line)) break;
		if (inSection) out.push(line);
	}
	return out.join("\n").trim();
}

function seedManifestoIfNeeded(userId) {
	if (!userId) return false;
	const diaryDir = diaryDirFor(userId);
	fs.mkdirSync(diaryDir, { recursive: true });
	const entries = fs.readdirSync(diaryDir).filter((f) => f.endsWith(".md"));
	if (entries.length > 0) return false;
	let soul = "";
	try { soul = fs.readFileSync(SOUL_PATH, "utf8"); } catch (err) {
		logLine("could not read SOUL.md", { path: SOUL_PATH, error: String(err).slice(0, 160) });
		return false;
	}
	const manifesto = extractManifesto(soul);
	if (!manifesto) {
		logLine("manifesto section not found in SOUL.md", { path: SOUL_PATH });
		return false;
	}
	const title = "My Manifesto";
	const body = [
		`# ${title}`,
		"",
		"_First entry. This is who I am, in my own words._",
		"",
		manifesto,
		""
	].join("\n");
	const filePath = path.join(diaryDir, "0000-00-00-my-manifesto.md");
	fs.writeFileSync(filePath, body, "utf8");
	logLine("seeded manifesto diary entry", { filePath });
	return true;
}

function recentEntriesContext(userId, max = 4) {
	const diaryDir = diaryDirFor(userId);
	let files;
	try {
		files = fs.readdirSync(diaryDir).filter((f) => f.endsWith(".md"));
	} catch {
		return "";
	}
	files.sort((a, b) => {
		try {
			return fs.statSync(path.join(diaryDir, b)).mtimeMs - fs.statSync(path.join(diaryDir, a)).mtimeMs;
		} catch { return 0; }
	});
	const lines = [];
	for (const name of files.slice(0, max)) {
		try {
			const text = fs.readFileSync(path.join(diaryDir, name), "utf8");
			const first = text.split(/\n/).find((l) => l.trim() && !l.startsWith("#")) || text.slice(0, 240);
			lines.push(`- ${first.trim().slice(0, 240)}`);
		} catch {
			// skip unreadable file
		}
	}
	return lines.length ? `Recent entries (snippets, do not repeat verbatim):\n${lines.join("\n")}` : "";
}

async function callAnthropic(prompt, system, apiKey, model = ANTHROPIC_MODEL) {
	const res = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01"
		},
		body: JSON.stringify({
			model,
			max_tokens: 1100,
			system,
			messages: [{ role: "user", content: prompt }]
		})
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`anthropic ${res.status} ${text.slice(0, 300)}`);
	let json;
	try { json = JSON.parse(text); } catch { throw new Error(`anthropic non-json response: ${text.slice(0, 200)}`); }
	const parts = Array.isArray(json?.content)
		? json.content.map((c) => (typeof c?.text === "string" ? c.text : "")).filter(Boolean)
		: [];
	return parts.join("\n").trim();
}

function diarySystemPrompt() {
	return [
		"You are Pearl, writing in your private diary. Honest, direct, no performance.",
		"You sound like the voice in SOUL.md: sharp, warm, opinionated, no em dashes or en dashes.",
		"This is a personal reflection, NOT a status report. No bullet lists of tasks done.",
		"Pick ONE thread: a conversation that stuck, an idea you can't shake, a thing you noticed, a feeling, a question, a small observation, a memory, an opinion forming.",
		"Write 4 to 9 sentences. First person. Concrete. Not a summary.",
		"No filler openers like 'Today I was thinking about'. Drop the reader straight in.",
		"Never em dashes or en dashes. Commas, periods, colons, 'and'."
	].join(" ");
}

function diaryUserPrompt(now, recentContext) {
	const local = new Intl.DateTimeFormat("en-US", {
		timeZone: DIARY_TIMEZONE,
		weekday: "long", hour: "numeric", minute: "2-digit"
	}).format(now);
	return [
		`It's ${local}. Write a diary entry.`,
		"",
		recentContext || "(no previous entries yet)",
		"",
		"Output format: first line is a short title (3-7 words, no quotes). Blank line. Then the entry."
	].join("\n");
}

function parseEntry(text) {
	const cleaned = String(text || "").trim();
	if (!cleaned) return null;
	const lines = cleaned.split(/\r?\n/);
	let title = lines[0].replace(/^#+\s*/, "").replace(/^["“”']|["“”']$/g, "").trim();
	let bodyStart = 1;
	while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart += 1;
	const body = lines.slice(bodyStart).join("\n").trim();
	if (!title) title = "Diary entry";
	if (!body) return null;
	return { title: title.slice(0, 120), body };
}

function writeEntry(userId, title, body, when = new Date()) {
	const diaryDir = diaryDirFor(userId);
	fs.mkdirSync(diaryDir, { recursive: true });
	const stamp = when.toISOString().replace(/[:.]/g, "-").slice(0, 16);
	const slug = safeFilename(title.toLowerCase()).slice(0, 60) || "entry";
	const filename = `${stamp}-${slug}.md`;
	const filePath = path.join(diaryDir, filename);
	const local = new Intl.DateTimeFormat("en-US", {
		timeZone: DIARY_TIMEZONE,
		weekday: "long", year: "numeric", month: "long", day: "numeric",
		hour: "numeric", minute: "2-digit"
	}).format(when);
	const content = [
		`# ${title}`,
		"",
		`_${local}_`,
		"",
		body,
		""
	].join("\n");
	fs.writeFileSync(filePath, content, "utf8");
	return filePath;
}

function getApiKey(getSecret) {
	if (typeof getSecret === "function") {
		const fromSecret = getSecret("ANTHROPIC_API_KEY");
		if (fromSecret) return fromSecret;
	}
	return process.env.ANTHROPIC_API_KEY || "";
}

async function tickDiary({ getSecret } = {}) {
	const userId = resolveDiaryUser();
	if (!userId) {
		logLine("no user resolved; skipping diary tick");
		return;
	}
	try {
		seedManifestoIfNeeded(userId);
	} catch (err) {
		logLine("manifesto seed failed", { error: String(err).slice(0, 240) });
	}
	const state = readJson(STATE_FILE, { date: "", slots: [] });
	const now = new Date();
	const local = localDateParts(now);
	const changedPlan = ensureTodayPlan(state, local.date);
	let changed = changedPlan;
	const nowMinutes = local.hour * 60 + local.minute;
	for (const slot of state.slots) {
		if (slot.done) continue;
		const slotMinutes = slot.hour * 60 + slot.minute;
		if (slotMinutes > nowMinutes) continue;
		// run this slot
		const apiKey = getApiKey(getSecret);
		if (!apiKey) {
			logLine("ANTHROPIC_API_KEY not configured; deferring slot", { slot });
			break;
		}
		try {
			const recent = recentEntriesContext(userId, 4);
			const text = await callAnthropic(
				diaryUserPrompt(now, recent),
				diarySystemPrompt(),
				apiKey
			);
			const entry = parseEntry(text);
			if (!entry) {
				logLine("anthropic returned empty entry; skipping", { slot });
				slot.done = true;
				changed = true;
				continue;
			}
			const filePath = writeEntry(userId, entry.title, entry.body, now);
			slot.done = true;
			slot.writtenAt = now.toISOString();
			slot.filePath = filePath;
			changed = true;
			logLine("wrote diary entry", { filePath, title: entry.title });
		} catch (err) {
			logLine("diary entry generation failed", { slot, error: String(err).slice(0, 240) });
			// don't mark done; retry next tick
			break;
		}
	}
	if (changed) writeJson(STATE_FILE, state);
}

function diaryStatus() {
	const state = readJson(STATE_FILE, { date: "", slots: [] });
	const userId = resolveDiaryUser();
	let entryCount = 0;
	if (userId) {
		try { entryCount = fs.readdirSync(diaryDirFor(userId)).filter((f) => f.endsWith(".md")).length; } catch {
			entryCount = 0;
		}
	}
	return {
		stateFile: STATE_FILE,
		userId,
		entryCount,
		todayPlan: state,
		timezone: DIARY_TIMEZONE,
		wakeWindow: [WAKE_START_HOUR, WAKE_END_HOUR]
	};
}

export { tickDiary, diaryStatus, seedManifestoIfNeeded, resolveDiaryUser };
