#!/usr/bin/env node
import fs from "node:fs";

const DISCORD_API = "https://discord.com/api/v10";
const OPENROUTER_API = "https://openrouter.ai/api/v1";
const DEFAULT_OPENCLAW_CONFIG_PATHS = [
  process.env.OPENCLAW_CONFIG,
  "/home/deploy/.openclaw/relay-openclaw.json",
  "/home/deploy/.openclaw/openclaw.json",
  "/root/.openclaw/openclaw.json",
].filter(Boolean);
const DEFAULT_ENV_FILE_CANDIDATES = [
  process.env.PEARLOS_CONNECTOR_ENV_FILE,
  ...parseCsv(process.env.PEARLOS_CONNECTOR_ENV_FILES),
  "/workspace/nia-universal-pearl-prod/.env.local",
  "/workspace/nia-universal-pearl-prod/apps/interface/.env.local",
  "/workspace/nia-universal/.env.local",
  "/workspace/nia-universal/apps/interface/.env.local",
  "/home/deploy/pearlos/.env.local",
  "/home/deploy/pearlos/apps/interface/.env.local",
  "/opt/pearlos/.env.local",
  "/opt/pearlos/apps/interface/.env.local",
  "/workspace/nia-universal/apps/pipecat-daily-bot/.env",
  "/opt/pearlos/apps/pipecat-daily-bot/.env",
].filter(Boolean);

const args = process.argv.slice(2);
const warnOnly = args.includes("--warn-only") || process.env.PEARLOS_CONNECTOR_HEALTH_WARN_ONLY === "1";
const required = new Set(parseCsv(
  argValue("--require") || process.env.PEARLOS_CONNECTOR_HEALTH_REQUIRED || "",
));

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function argValue(name) {
  const exact = `${name}=`;
  const match = args.find((arg) => arg.startsWith(exact));
  return match ? match.slice(exact.length) : "";
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

function readEnvFileValue(file, key) {
  const text = readText(file);
  if (!text) return "";
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=\\s*(.*)\\s*$`, "m"));
  if (!match) return "";
  return match[1].trim().replace(/^['"]|['"]$/g, "");
}

const openclawConfigs = DEFAULT_OPENCLAW_CONFIG_PATHS.map(readJson).filter(Boolean);

function configValue(key) {
  for (const config of openclawConfigs) {
    const value =
      config?.env?.[key] ||
      config?.secrets?.[key] ||
      (key === "DISCORD_BOT_TOKEN"
        ? config?.channels?.discord?.token || config?.channels?.discord?.accounts?.default?.token
        : "");
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function envValue(key) {
  return envCandidates(key)[0] || "";
}

function envCandidates(key) {
  const values = [];
  const add = (value) => {
    const clean = typeof value === "string" ? value.trim() : "";
    if (clean && !values.includes(clean)) values.push(clean);
  };
  add(process.env[key]);
  for (const file of DEFAULT_ENV_FILE_CANDIDATES) {
    add(readEnvFileValue(file, key));
  }
  add(configValue(key));
  return values;
}

function normalizeDiscordToken(token) {
  return token.trim().replace(/^Bot\s+/i, "");
}

function validDiscordIds(values) {
  return Array.from(new Set(values.flatMap(parseCsv).filter((id) => /^\d{17,20}$/.test(id))));
}

function validAbsoluteUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function interfaceOrigin() {
  for (const key of ["NEXT_PUBLIC_INTERFACE_URL", "NEXTAUTH_INTERFACE_URL", "NEXTAUTH_URL", "PEARLOS_URL", "PUBLIC_URL"]) {
    const value = envValue(key);
    if (!value) continue;
    try {
      return new URL(value).origin;
    } catch {
      return "";
    }
  }
  return "";
}

function resolveDiscordRedirectUri() {
  const configured = envValue("DISCORD_OAUTH_REDIRECT_URI");
  if (configured) return configured;
  const origin = interfaceOrigin();
  return origin ? `${origin}/api/discord/callback` : "";
}

async function fetchStatus(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text().catch(() => "");
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
    return { ok: false, status: 0, text: message };
  } finally {
    clearTimeout(timer);
  }
}

function result(name, status, detail) {
  return { name, status, detail };
}

async function checkDiscord() {
  const tokenCandidates = envCandidates("DISCORD_BOT_TOKEN").map(normalizeDiscordToken);
  const discordRequired = required.has("discord");
  if (!tokenCandidates.length) {
    return discordRequired
      ? result("discord", "fail", "DISCORD_BOT_TOKEN is not configured")
      : result("discord", "skip", "DISCORD_BOT_TOKEN is not configured");
  }

  const clientId = envValue("DISCORD_CLIENT_ID");
  const clientSecret = envValue("DISCORD_CLIENT_SECRET");
  const redirectUri = resolveDiscordRedirectUri();
  const oauthConfigured = Boolean(clientId || clientSecret || envValue("DISCORD_OAUTH_REDIRECT_URI"));
  if (discordRequired || required.has("discord-oauth") || oauthConfigured) {
    if (!clientId || !clientSecret) {
      return result("discord", "fail", "OAuth credentials are incomplete");
    }
    if (!redirectUri || !validAbsoluteUrl(redirectUri)) {
      return result("discord", "fail", "OAuth redirect URI is missing or invalid");
    }
  }

  const dmLinkSecretConfigured = Boolean(envValue("DISCORD_DM_LINK_SECRET") || envValue("MESH_SHARED_SECRET"));
  if ((discordRequired || required.has("discord-dm-link")) && !dmLinkSecretConfigured) {
    return result("discord", "fail", "DM link secret is not configured");
  }

  const guildId = envValue("DISCORD_GUILD_ID");
  if (discordRequired && !guildId) {
    return result("discord", "fail", "DISCORD_GUILD_ID is not configured");
  }

  const channelIds = validDiscordIds([
    argValue("--discord-channel"),
    envValue("DISCORD_HEALTH_CHANNEL_IDS"),
    envValue("DISCORD_BRIDGE_CHANNEL_IDS"),
    envValue("DISCORD_PUBLIC_CHANNEL_IDS"),
    envValue("PEARL_DISCORD_WATCH_CHANNELS"),
    envValue("PEARL_QA_DISCORD_CHANNEL_ID"),
    envValue("PEARL_DISCORD_LOG_CHANNEL"),
  ]);
  const channelIdsToCheck = channelIds;
  const failures = [];
  for (const token of tokenCandidates) {
    const authHeaders = {
      authorization: `Bot ${token}`,
      "user-agent": "PearlOS connector health/1.0",
    };
    const me = await fetchStatus(`${DISCORD_API}/users/@me`, { headers: authHeaders });
    if (!me.ok) {
      failures.push(`bot auth failed (${httpDetail(me)})`);
      continue;
    }

    if (guildId) {
      const guild = await fetchStatus(`${DISCORD_API}/guilds/${guildId}`, { headers: authHeaders });
      if (!guild.ok) {
        failures.push(`guild check failed (${httpDetail(guild)})`);
        continue;
      }
    }

    let channelFailure = "";
    for (const channelId of channelIdsToCheck) {
      const channel = await fetchStatus(`${DISCORD_API}/channels/${channelId}`, { headers: authHeaders });
      if (!channel.ok) {
        channelFailure = `channel check failed (${httpDetail(channel)})`;
        break;
      }
      if (guildId) {
        try {
          const parsed = JSON.parse(channel.text);
          if (String(parsed?.guild_id || "") !== String(guildId)) {
            channelFailure = "channel is outside configured guild";
            break;
          }
        } catch {
          channelFailure = "channel response was not valid JSON";
          break;
        }
      }
    }
    if (channelFailure) {
      failures.push(channelFailure);
      continue;
    }

    const suffix = channelIdsToCheck.length ? `, ${channelIdsToCheck.length} channel(s)` : "";
    return result(
      "discord",
      "ok",
      `bot auth ok${guildId ? ", guild ok" : ""}${suffix}${clientId && clientSecret ? ", oauth config ok" : ""}${dmLinkSecretConfigured ? ", dm-link secret present" : ""}`,
    );
  }

  return result("discord", "fail", failures[failures.length - 1] || "no Discord credential candidate worked");
}

async function checkOpenRouter() {
  const keys = envCandidates("OPENROUTER_API_KEY");
  if (!keys.length) {
    return required.has("openrouter")
      ? result("openrouter", "fail", "OPENROUTER_API_KEY is not configured")
      : result("openrouter", "skip", "OPENROUTER_API_KEY is not configured");
  }

  let lastFailure = "";
  for (const key of keys) {
    const response = await fetchStatus(`${OPENROUTER_API}/auth/key`, {
      headers: {
        authorization: `Bearer ${key}`,
        "user-agent": "PearlOS connector health/1.0",
      },
    });
    if (response.ok) return result("openrouter", "ok", "auth ok");
    lastFailure = `auth check failed (${httpDetail(response)})`;
  }
  return result("openrouter", "fail", lastFailure || "auth check failed");
}

async function checkBotGateway() {
  const configured = envValue("BOT_GATEWAY_URL") || envValue("NEXT_PUBLIC_BOT_CONTROL_BASE_URL");
  const requiredGateway = required.has("bot-gateway");
  if (!configured && !requiredGateway) {
    return result("bot-gateway", "skip", "BOT_GATEWAY_URL is not configured");
  }
  const base = (configured || "http://localhost:4444").replace(/\/$/, "");
  const response = await fetchStatus(`${base}/health`, { headers: { "user-agent": "PearlOS connector health/1.0" } }, 3_000);
  if (!response.ok) {
    return result("bot-gateway", "fail", `health check failed (${httpDetail(response)})`);
  }
  return result("bot-gateway", "ok", "health ok");
}

function httpDetail(response) {
  if (response.status) return `http_${response.status}`;
  return response.text || "network_error";
}

const checks = await Promise.all([
  checkDiscord(),
  checkOpenRouter(),
  checkBotGateway(),
]);

let failures = 0;
for (const check of checks) {
  const line = `connector-health: ${check.name} ${check.status} - ${check.detail}`;
  if (check.status === "fail") {
    failures += 1;
    console.error(line);
  } else {
    console.log(line);
  }
}

if (failures > 0 && warnOnly) {
  console.warn(`connector-health: ${failures} failure(s) reported in warn-only mode`);
  process.exit(0);
}

if (failures > 0) {
  console.error(`connector-health: failed with ${failures} connector issue(s)`);
  process.exit(1);
}

console.log("connector-health: passed");
