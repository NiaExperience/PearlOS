#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Client } from "pg";

const DISCORD_API = "https://discord.com/api/v10";
const DEFAULT_CHANNEL_ID = "1483865384384729239";
const DEFAULT_TIME_ZONE = "America/New_York";
const DEFAULT_STATE_FILE = "/var/lib/pearlos/user-growth-discord-report-state.json";
const DEFAULT_ENV_FILES = [
  process.env.PEARLOS_USER_GROWTH_ENV_FILE,
  process.env.PEARLOS_CONNECTOR_ENV_FILE,
  "/workspace/nia-universal-pearl-prod/.env.local",
  "/workspace/nia-universal-pearl-prod/apps/interface/.env.local",
  "/workspace/nia-universal/.env.local",
  "/workspace/nia-universal/apps/interface/.env.local",
  "/home/deploy/pearlos/.env.local",
  "/home/deploy/pearlos/apps/interface/.env.local",
  "/opt/pearlos/.env.local",
  "/opt/pearlos/apps/interface/.env.local",
].filter(Boolean);
const DEFAULT_CONFIG_FILES = [
  process.env.OPENCLAW_CONFIG,
  "/root/.openclaw/openclaw.json",
  "/home/deploy/.openclaw/openclaw.json",
].filter(Boolean);

const args = process.argv.slice(2);
const post = args.includes("--post");
const dryRun = args.includes("--dry-run") || !post;
const dedupeDay = args.includes("--dedupe-day");
const channelId =
  argValue("--channel-id") ||
  process.env.PEARLOS_USER_GROWTH_DISCORD_CHANNEL_ID ||
  DEFAULT_CHANNEL_ID;
const timeZone =
  argValue("--time-zone") ||
  process.env.PEARLOS_USER_GROWTH_TIME_ZONE ||
  DEFAULT_TIME_ZONE;
const stateFile =
  argValue("--state-file") ||
  process.env.PEARLOS_USER_GROWTH_STATE_FILE ||
  DEFAULT_STATE_FILE;

function argValue(name) {
  const prefix = `${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch {
    return null;
  }
}

function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

const envFiles = DEFAULT_ENV_FILES.map((file) => ({ file, values: parseEnvFile(readText(file)) }));
const configs = DEFAULT_CONFIG_FILES.map((file) => ({ file, json: readJson(file) })).filter((entry) => entry.json);

function envValue(key) {
  if (process.env[key]) return process.env[key];
  for (const entry of envFiles) {
    if (entry.values[key]) return entry.values[key];
  }
  return "";
}

function discordTokenCandidates() {
  const candidates = [];
  const add = (source, value) => {
    const token = typeof value === "string" ? value.trim().replace(/^Bot\s+/i, "") : "";
    if (!token || candidates.some((candidate) => candidate.token === token)) return;
    candidates.push({ source, token });
  };

  add("process env", process.env.DISCORD_BOT_TOKEN);
  for (const entry of envFiles) add(entry.file, entry.values.DISCORD_BOT_TOKEN);
  for (const entry of configs) {
    const config = entry.json;
    add(`${entry.file}:env`, config?.env?.DISCORD_BOT_TOKEN);
    add(`${entry.file}:secrets`, config?.secrets?.DISCORD_BOT_TOKEN);
    add(`${entry.file}:discord`, config?.channels?.discord?.token);
    add(`${entry.file}:discord-default`, config?.channels?.discord?.accounts?.default?.token);
  }
  return candidates;
}

function postgresConfig() {
  return {
    host: envValue("POSTGRES_HOST") || "localhost",
    port: Number(envValue("POSTGRES_PORT") || "5432"),
    database: envValue("POSTGRES_DB") || envValue("POSTGRES_DATABASE") || "testdb",
    user: envValue("POSTGRES_USER") || "postgres",
    password: envValue("POSTGRES_PASSWORD") || "password",
    ssl: envValue("POSTGRES_SSL") === "true" ? { rejectUnauthorized: false } : false,
  };
}

async function queryUserGrowth() {
  const client = new Client(postgresConfig());
  await client.connect();
  try {
    const metrics = await client.query(
      `
      WITH bounds AS (
        SELECT date_trunc('day', now() AT TIME ZONE $1) AS today_local
      )
      SELECT
        count(*)::int AS total_users,
        count(*) FILTER (WHERE "createdAt" >= now() - interval '24 hours')::int AS new_last_24h,
        count(*) FILTER (WHERE "createdAt" >= now() - interval '7 days')::int AS new_last_7d,
        count(*) FILTER (
          WHERE "createdAt" >= ((SELECT today_local FROM bounds) AT TIME ZONE $1)
        )::int AS new_today
      FROM notion_blocks
      WHERE type = 'User';
      `,
      [timeZone],
    );
    const daily = await client.query(
      `
      WITH days AS (
        SELECT generate_series(
          date_trunc('day', now() AT TIME ZONE $1) - interval '6 days',
          date_trunc('day', now() AT TIME ZONE $1),
          interval '1 day'
        ) AS day_local
      )
      SELECT
        to_char(days.day_local, 'YYYY-MM-DD') AS day,
        count(notion_blocks.*)::int AS signups
      FROM days
      LEFT JOIN notion_blocks
        ON notion_blocks.type = 'User'
       AND notion_blocks."createdAt" >= (days.day_local AT TIME ZONE $1)
       AND notion_blocks."createdAt" < ((days.day_local + interval '1 day') AT TIME ZONE $1)
      GROUP BY days.day_local
      ORDER BY days.day_local DESC;
      `,
      [timeZone],
    );
    return {
      metrics: metrics.rows[0],
      daily: daily.rows,
    };
  } finally {
    await client.end();
  }
}

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function formatReport({ metrics, daily }) {
  const dailyLines = daily.map((row) => `\`${row.day}\` ${row.signups}`).join("\n");
  return [
    `**PearlOS user growth — ${localTimestamp()}**`,
    "",
    `Total registered users: **${metrics.total_users}**`,
    `New today: **${metrics.new_today}**`,
    `New last 24h: **${metrics.new_last_24h}**`,
    `New last 7d: **${metrics.new_last_7d}**`,
    "",
    "**Daily signups, last 7 days:**",
    dailyLines || "No signup activity.",
    "",
    "_Aggregate User records only. No emails or profile data included._",
  ].join("\n");
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function findWorkingDiscordToken() {
  const failures = [];
  for (const candidate of discordTokenCandidates()) {
    const headers = {
      authorization: `Bot ${candidate.token}`,
      "user-agent": "PearlOS user growth report/1.0",
    };
    const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages?limit=1`, { headers });
    if (response.ok) return candidate;
    failures.push(`${candidate.source}: http_${response.status}`);
  }
  throw new Error(`No configured Discord bot token can read channel ${channelId}. ${failures.join("; ")}`);
}

async function postDiscordMessage(token, content) {
  const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
      "user-agent": "PearlOS user growth report/1.0",
    },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] },
    }),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Discord post failed for channel ${channelId}: http_${response.status} ${text.slice(0, 200)}`);
  }
}

async function main() {
  if (!/^\d{17,20}$/.test(channelId)) {
    throw new Error(`Invalid Discord channel id: ${channelId}`);
  }

  const today = localDateKey();
  const state = readState();
  if (dedupeDay && post && state.lastPostedDay === today) {
    console.log(`user-growth-report: skipped; already posted for ${today} ${timeZone}`);
    return;
  }

  const data = await queryUserGrowth();
  const content = formatReport(data);

  if (dryRun) {
    console.log(content);
    return;
  }

  const candidate = await findWorkingDiscordToken();
  await postDiscordMessage(candidate.token, content);
  writeState({
    ...state,
    lastPostedDay: today,
    lastPostedAt: new Date().toISOString(),
    channelId,
    timeZone,
  });
  console.log(`user-growth-report: posted to ${channelId} for ${today} ${timeZone}`);
}

main().catch((error) => {
  console.error(`user-growth-report: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
