#!/usr/bin/env node
import fs from "node:fs";

const DEFAULT_CONFIG_CANDIDATES = [
  process.env.OPENCLAW_CONFIG_PATH,
  process.env.OPENCLAW_CONFIG,
  "/home/deploy/.openclaw/openclaw.json",
  "/root/.openclaw/openclaw.json",
].filter(Boolean);

const GUILD_ID = "1471441655126167553";
const REQUIRED_GUILD_USERS = [
  { id: "223124728502550528", label: "Blair" },
  { id: "698983049660203018", label: "Stephanie/Riggs" },
  { id: "761459233392427018", label: "Paddy" },
  { id: "496705799687766016", label: "Himanshu/Void" },
  { id: "1196318566505533546", label: "Angel" },
];

function usage() {
  console.error("Usage: scripts/audit-discord-allowlist.mjs [openclaw.json]");
}

function resolveConfigPath() {
  const explicit = process.argv[2];
  if (explicit) return explicit;
  return DEFAULT_CONFIG_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || "";
}

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`could not read ${path}: ${error.message}`);
  }
}

function asStringSet(value) {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.map((entry) => String(entry).trim()).filter(Boolean));
}

function main() {
  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    usage();
    process.exit(0);
  }

  const configPath = resolveConfigPath();
  if (!configPath) {
    throw new Error("no OpenClaw config found; pass a path explicitly");
  }

  const cfg = readJson(configPath);
  const discord = cfg?.channels?.discord;
  if (!discord || discord.enabled === false) {
    console.log("discord-allowlist-audit: skipped, Discord channel disabled");
    return;
  }

  const groupPolicy = discord.groupPolicy ?? "open";
  const guild = discord.guilds?.[GUILD_ID];
  if (groupPolicy !== "allowlist" || !guild) {
    console.log("discord-allowlist-audit: passed, no guild user allowlist is active");
    return;
  }

  const guildUsers = asStringSet(guild.users);
  if (guildUsers.size === 0) {
    console.log("discord-allowlist-audit: passed, guild channels are allowlisted without per-user restriction");
    return;
  }

  const missing = REQUIRED_GUILD_USERS.filter((user) => !guildUsers.has(user.id));
  if (missing.length > 0) {
    console.error("discord-allowlist-audit: required Discord users missing from guild allowlist:");
    for (const user of missing) {
      console.error(`  ${user.label}: ${user.id}`);
    }
    process.exit(1);
  }

  console.log(`discord-allowlist-audit: passed (${configPath})`);
}

try {
  main();
} catch (error) {
  console.error(`discord-allowlist-audit: ${error.message}`);
  process.exit(1);
}
