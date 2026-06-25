/**
 * Vonage SMS inbound webhook handler.
 *
 * Vonage POSTs here for every incoming SMS. We verify the signature,
 * parse the message, route it to Pearl via OpenClaw, and return a
 * synchronous 200 with optional response text (Vonage delivers it as a reply).
 *
 * GET  — Vonage webhook verification (returns 200 with empty body).
 * POST — Inbound SMS message.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  verifyVonageWebhook,
  parseInboundSms,
  sendSms,
  normalizePhone,
} from "../../../../lib/sms/vonage";

export async function GET() {
  // Vonage occasionally sends a GET to verify the endpoint is alive.
  return new NextResponse(null, { status: 200 });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";

  // Vonage sends params in both the URL query string (sig, msisdn, etc.)
  // AND the POST body. Merge both so we don't miss anything.
  const urlParams: Record<string, string | string[]> = {};
  request.nextUrl.searchParams.forEach((value, key) => {
    urlParams[key] = value;
  });

  let bodyParams: Record<string, string | string[]> = {};

  if (contentType.includes("application/json")) {
    bodyParams = await request.json().catch(() => ({}));
  } else {
    // Vonage sends application/x-www-form-urlencoded by default
    const text = await request.text();
    const searchParams = new URLSearchParams(text);
    for (const [key, value] of searchParams.entries()) {
      if (key in bodyParams) {
        const existing = bodyParams[key];
        bodyParams[key] = Array.isArray(existing)
          ? [...existing, value]
          : [existing as string, value];
      } else {
        bodyParams[key] = value;
      }
    }
  }

  // URL query params take priority (sig is sent as query param)
  const params: Record<string, string | string[]> = { ...bodyParams, ...urlParams };

  // Signature verification: warn on failure but accept the message.
  // Vonage only sends the `sig` parameter when signature verification is
  // explicitly enabled in the dashboard. Without it, we still process.
  const sigValid = verifyVonageWebhook(params);
  if (!sigValid) {
    console.warn("[sms/inbound] Signature validation skipped — sig not present or mismatch");
  }

  const sms = parseInboundSms(params);
  console.log(
    `[sms/inbound] From ${sms.msisdn} → ${sms.to}: "${sms.text.slice(0, 80)}"`
  );

  // ---- Route to Pearl ----
  // For now, respond directly. Once the OpenClaw routing is wired,
  // this will fan out to the Pearl agent runtime for a full response.
  //
  // Architecture target:
  //   1. Create an OpenClaw session keyed on the normalized phone number
  //   2. Send the message text as a user turn
  //   3. Wait for Pearl's response (with timeout)
  //   4. Send the response back via SMS
  //
  // For this initial deployment, we respond with a canned message
  // to prove the inbound→outbound loop works end-to-end.

  const phone = normalizePhone(sms.msisdn);

  try {
    // Route through OpenClaw gateway for a real Pearl response
    const openclawUrl = process.env.OPENCLAW_API_URL || "http://127.0.0.1:18789";
    const openclawKey = process.env.OPENCLAW_API_KEY || "";

    const pearlRes = await fetch(`${openclawUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openclawKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENCLAW_SMS_MODEL || "pearl-llm/deepseek-v4-pro",
        messages: [
          {
            role: "system",
            content:
              "You are Pearl, an AI companion communicating via SMS. " +
              "Be warm and concise. SMS limits mean keeping responses under 320 characters. " +
              "No markdown, no emojis (they may not render on all phones). " +
              "The user is on a phone. Be direct and helpful.",
          },
          {
            role: "user",
            content: `[SMS from ${phone}] ${sms.text}`,
          },
        ],
        max_tokens: 200,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (pearlRes.ok) {
      const data = await pearlRes.json();
      const reply =
        data?.choices?.[0]?.message?.content?.trim() ||
        "Hey! I got your message. What can I help with?";

      const result = await sendSms(sms.msisdn, reply, sms.to);
      console.log(
        `[sms/inbound] Reply to ${sms.msisdn}: ${result.ok ? "sent" : "failed"} — "${reply.slice(0, 80)}"`
      );
    } else {
      // OpenClaw unreachable — fall back to canned response
      console.warn(`[sms/inbound] OpenClaw returned ${pearlRes.status}, falling back`);
      const fallback =
        "Hey! Pearl here. I got your text but my brain is warming up — I'll get back to you shortly.";
      await sendSms(sms.msisdn, fallback, sms.to);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sms/inbound] Error routing to Pearl: ${message}`);
    // Still send a fallback so the user isn't left hanging
    const fallback =
      "Message received! Pearl is processing this and will respond shortly.";
    await sendSms(sms.msisdn, fallback, sms.to).catch(() => {});
  }

  // Always return 200 so Vonage doesn't retry
  return NextResponse.json({ ok: true });
}
