// PearlOS error feedback intake.
// Frontend (ErrorBoundary, global error handler) POSTs errors here.
// Server logs + fans out to team Discord webhook if DISCORD_ERROR_WEBHOOK is set.
//
// ENV:
//   DISCORD_ERROR_WEBHOOK  - Discord channel webhook URL (dev team error feed)
//
// Intentional: no auth requirement (errors must report even from logged-out crashes),
// but we rate-limit by IP in-memory and redact obvious secrets.

import { NextRequest, NextResponse } from "next/server";
import { getLogger } from "@interface/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = getLogger("[api_report_error]");

// Simple in-memory token bucket per IP. Survives hot reload within one process.
type Bucket = { tokens: number; last: number };
const RATE_LIMIT_MAX = 20;          // max reports per window
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const buckets = new Map<string, Bucket>();

function allow(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: RATE_LIMIT_MAX, last: now };
  const elapsed = now - b.last;
  const refill = (elapsed / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_MAX;
  b.tokens = Math.min(RATE_LIMIT_MAX, b.tokens + refill);
  b.last = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  return true;
}

function redact(s: string | undefined): string {
  if (!s) return "";
  return s
    .replace(/sk-[A-Za-z0-9_\-]{20,}/g, "sk-REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer REDACTED")
    .replace(/([A-Z_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z_]*)\s*[=:]\s*\S+/gi, "$1=REDACTED")
    .slice(0, 4000);
}

interface ErrorReport {
  message?: string;
  stack?: string;
  componentStack?: string;
  url?: string;
  userAgent?: string;
  userId?: string | null;
  userEmail?: string | null;
  context?: Record<string, unknown>;
  severity?: "info" | "warn" | "error" | "fatal";
  source?: string; // e.g. "ErrorBoundary", "window.onerror", "unhandledrejection"
}

async function sendToDiscord(payload: ErrorReport, ip: string) {
  const webhook = process.env.DISCORD_ERROR_WEBHOOK;
  if (!webhook) return;

  const who = payload.userEmail || payload.userId || "anonymous";
  const title = `🚨 ${payload.severity ?? "error"} — ${payload.source ?? "client"}`;
  const fields = [
    { name: "User", value: `${who} (${ip})`.slice(0, 1024), inline: true },
    { name: "URL", value: (payload.url ?? "unknown").slice(0, 1024), inline: true },
    { name: "UA", value: (payload.userAgent ?? "unknown").slice(0, 1024) },
    { name: "Message", value: "```" + redact(payload.message) + "```" },
  ];
  if (payload.stack) {
    fields.push({ name: "Stack", value: "```" + redact(payload.stack).slice(0, 1000) + "```" });
  }
  if (payload.componentStack) {
    fields.push({
      name: "Component stack",
      value: "```" + redact(payload.componentStack).slice(0, 1000) + "```",
    });
  }
  if (payload.context && Object.keys(payload.context).length) {
    const ctx = redact(JSON.stringify(payload.context)).slice(0, 1000);
    fields.push({ name: "Context", value: "```json\n" + ctx + "```" });
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "PearlOS Error Bot",
        embeds: [
          {
            title: title.slice(0, 256),
            color: 0xff4d4f,
            timestamp: new Date().toISOString(),
            fields,
          },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn("Discord webhook rejected error report", { status: res.status, detail: text.slice(0, 300) });
    }
  } catch (err) {
    log.warn("Discord webhook dispatch failed", { err: (err as Error).message });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (!allow(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: ErrorReport;
  try {
    body = (await req.json()) as ErrorReport;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body.message !== "string") {
    return NextResponse.json({ error: "missing_message" }, { status: 400 });
  }

  log.error("client_error_report", {
    ip,
    source: body.source,
    severity: body.severity,
    url: body.url,
    userId: body.userId,
    message: redact(body.message),
    stack: redact(body.stack),
  });

  await sendToDiscord(body, ip);

  return NextResponse.json({ ok: true });
}
