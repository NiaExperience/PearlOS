/**
 * Vonage SMS utility — send and receive SMS via Vonage REST API.
 *
 * Inbound:  Vonage POSTs to /api/sms/inbound → validated → routed to Pearl.
 * Outbound: This module's sendSms() → Vonage REST API → user's phone.
 */

import { createHmac } from "crypto";

const VONAGE_API_KEY = process.env.VONAGE_API_KEY || "";
const VONAGE_API_SECRET = process.env.VONAGE_API_SECRET || "";
const VONAGE_WEBHOOK_SECRET = process.env.VONAGE_WEBHOOK_SECRET || "";
const VONAGE_DEFAULT_FROM = process.env.VONAGE_DEFAULT_FROM || "18776449412";

const VONAGE_REST_SMS = "https://rest.nexmo.com/sms/json";

// ---------------------------------------------------------------------------
// Webhook signature validation
// ---------------------------------------------------------------------------

/**
 * Verify a Vonage inbound-message webhook using the configured shared secret.
 * Vonage sends `sig` as a query param: md5( msisdn + secret + timestamp ).
 */
export function verifyVonageWebhook(params: Record<string, string | string[]>): boolean {
  if (!VONAGE_WEBHOOK_SECRET) {
    console.warn("[sms] VONAGE_WEBHOOK_SECRET not configured — skipping signature check");
    return true; // permit in dev with warning
  }

  const msisdn = singleParam(params, "msisdn");
  const timestamp = singleParam(params, "message-timestamp") || singleParam(params, "timestamp");
  const sig = singleParam(params, "sig");

  if (!msisdn || !timestamp || !sig) {
    console.warn("[sms] Missing webhook params: msisdn=%s ts=%s sig=%s", !!msisdn, !!timestamp, !!sig);
    return false;
  }

  const expected = createHmac("md5", VONAGE_WEBHOOK_SECRET)
    .update(msisdn + timestamp)
    .digest("hex");

  return expected === sig;
}

// ---------------------------------------------------------------------------
// Outbound SMS
// ---------------------------------------------------------------------------

export interface SmsResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  remainingBalance?: string;
}

/**
 * Send an SMS message via Vonage REST API.
 * Message is automatically split if > 160 chars (GSM-7) or > 70 chars (UCS-2).
 */
export async function sendSms(
  to: string,
  text: string,
  from: string = VONAGE_DEFAULT_FROM
): Promise<SmsResult> {
  if (!VONAGE_API_KEY || !VONAGE_API_SECRET) {
    return { ok: false, error: "Vonage API credentials not configured" };
  }

  const body = new URLSearchParams({
    api_key: VONAGE_API_KEY,
    api_secret: VONAGE_API_SECRET,
    from,
    to,
    text,
    type: "text",
  });

  try {
    const res = await fetch(VONAGE_REST_SMS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const data = await res.json();

    if (!res.ok || !data?.messages?.length) {
      return { ok: false, error: `Vonage HTTP ${res.status}: ${JSON.stringify(data)}` };
    }

    const msg = data.messages[0];
    if (msg.status !== "0") {
      return {
        ok: false,
        error: `Vonage error ${msg.status}: ${msg["error-text"] || "unknown"}`,
      };
    }

    return {
      ok: true,
      messageId: msg["message-id"],
      remainingBalance: data.messages[0]?.["remaining-balance"],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Network error: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// Inbound message parsing
// ---------------------------------------------------------------------------

export interface InboundSms {
  msisdn: string;       // sender phone number
  to: string;           // recipient (our Vonage number)
  messageId: string;
  text: string;
  keyword: string;      // first word, uppercase
  timestamp: string;
  type: "text" | "unicode";
}

/**
 * Parse Vonage inbound-message webhook body into a typed InboundSms.
 * Vonage sends application/x-www-form-urlencoded or JSON.
 */
export function parseInboundSms(body: Record<string, string | string[]>): InboundSms {
  const text = singleParam(body, "text") || "";
  return {
    msisdn: singleParam(body, "msisdn") || "",
    to: singleParam(body, "to") || "",
    messageId: singleParam(body, "messageId") || "",
    text,
    keyword: singleParam(body, "keyword") || text.split(" ")[0]?.toUpperCase() || "",
    timestamp: singleParam(body, "message-timestamp") || new Date().toISOString(),
    type: (singleParam(body, "type") as "text" | "unicode") || "text",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function singleParam(
  params: Record<string, string | string[]>,
  key: string
): string {
  const v = params[key];
  if (Array.isArray(v)) return v[0] || "";
  return v || "";
}

/** Strip +1 prefix for consistent storage */
export function normalizePhone(msisdn: string): string {
  return msisdn.replace(/^\+?1/, "").replace(/\D/g, "");
}

/** Vonage sends msisdn without leading + — add it back for display */
export function displayPhone(msisdn: string): string {
  const cleaned = msisdn.replace(/\D/g, "");
  if (cleaned.length === 10) return `+1 ${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  return `+${cleaned}`;
}
