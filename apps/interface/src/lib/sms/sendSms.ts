/**
 * SMS Outbound Utility
 *
 * Sends SMS messages via Vonage's SMS API.
 * Used by the SMS webhook endpoint to deliver Pearl's responses.
 */

import { Vonage } from "@vonage/server-sdk";

function getVonageClient(): Vonage {
  const apiKey = process.env.VONAGE_API_KEY;
  const apiSecret = process.env.VONAGE_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error(
      "VONAGE_API_KEY and VONAGE_API_SECRET must be set in environment"
    );
  }

  return new Vonage({
    apiKey,
    apiSecret,
  });
}

const FROM_NUMBER = process.env.VONAGE_PHONE_NUMBER ?? "";

/**
 * Send an SMS message via Vonage.
 *
 * @param to - Recipient phone number (E.164 format, e.g. +15551234567)
 * @param body - Message body text (Vonage auto-concatenates long messages)
 * @returns The Vonage message ID on success
 * @throws On Vonage API errors (auth, invalid number, etc.)
 */
export async function sendSms(to: string, body: string): Promise<string> {
  if (!FROM_NUMBER) {
    throw new Error("VONAGE_PHONE_NUMBER is not set");
  }

  if (!to || !body) {
    throw new Error("Both 'to' and 'body' are required");
  }

  // Vonage handles long messages via concatenation (up to ~3200 chars)
  const truncatedBody = body.length > 3200 ? body.slice(0, 3197) + "..." : body;

  try {
    const vonage = getVonageClient();
    const response = await vonage.sms.send({
      from: FROM_NUMBER,
      to,
      text: truncatedBody,
    });

    const message = response.messages?.[0];
    if (message?.status !== "0") {
      throw new Error(
        `Vonage SMS error: ${message?.status} - ${message?.errorText || "unknown error"}`
      );
    }

    console.log(`[SMS] Sent to ${to}: ${message.messageId} (${message.status})`);
    return message.messageId;
  } catch (error: any) {
    console.error(`[SMS] Failed to send to ${to}:`, error.message);
    throw error;
  }
}
