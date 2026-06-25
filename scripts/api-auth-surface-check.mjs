#!/usr/bin/env node

const args = process.argv.slice(2);
const baseUrl = (argValue("--base") || process.env.PEARLOS_API_AUTH_PREFLIGHT_URL || "").replace(/\/$/, "");
const strict = args.includes("--strict") || process.env.PEARLOS_API_AUTH_PREFLIGHT_STRICT === "1";

const protectedRoutes = [
  {
    name: "bot restart",
    method: "POST",
    path: "/api/bot/restart",
    body: null,
  },
  {
    name: "recovery chat",
    method: "POST",
    path: "/api/recovery/chat",
    body: { messages: [{ role: "user", content: "auth surface check" }] },
  },
  {
    name: "news config mutation",
    method: "POST",
    path: "/api/news/config",
    body: { action: "reset" },
  },
  {
    name: "news custom feed fetch",
    method: "GET",
    path: "/api/news/feed?url=http%3A%2F%2F127.0.0.1%3A4444%2Fhealth",
    body: null,
  },
];

function argValue(name) {
  const exact = `${name}=`;
  const match = args.find((arg) => arg.startsWith(exact));
  return match ? match.slice(exact.length) : "";
}

function okStatus(status) {
  return status === 401 || status === 403 || status === 404 || status === 410 || status === 405;
}

async function probe(route) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${baseUrl}${route.path}`, {
      method: route.method,
      headers: route.body ? { "content-type": "application/json" } : {},
      body: route.body ? JSON.stringify(route.body) : undefined,
      signal: controller.signal,
      redirect: "manual",
    });
    return { status: response.status, ok: okStatus(response.status) };
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
    return { status: 0, ok: false, detail };
  } finally {
    clearTimeout(timer);
  }
}

if (!baseUrl) {
  const msg = "api-auth-surface: skipped (set PEARLOS_API_AUTH_PREFLIGHT_URL to check live API auth)";
  if (strict) {
    console.error(msg);
    process.exit(1);
  }
  console.log(msg);
  process.exit(0);
}

try {
  new URL(baseUrl);
} catch {
  console.error(`api-auth-surface: invalid base URL: ${baseUrl}`);
  process.exit(2);
}

let failures = 0;
for (const route of protectedRoutes) {
  const result = await probe(route);
  if (result.ok) {
    console.log(`api-auth-surface: ${route.name} protected (${result.status})`);
  } else {
    failures += 1;
    const detail = result.status ? `unexpected HTTP ${result.status}` : result.detail || "request failed";
    console.error(`api-auth-surface: ${route.name} failed (${detail})`);
  }
}

if (failures > 0) {
  console.error(`api-auth-surface: failed with ${failures} exposed route(s)`);
  process.exit(1);
}

console.log("api-auth-surface: passed");
