import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getLogger } from '@interface/lib/logger';
import { sendEmail } from '@interface/utils/sendMail';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const log = getLogger('waitlist-api');

const WaitlistSchema = z.object({
  email: z.string().trim().email(),
});

function getNotionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

function getWaitlistSource() {
  return process.env.WAITLIST_SOURCE || 'app.pearlos.org';
}

function getPublicErrorMessage(error: unknown): string {
  const fallback = 'Failed to join waitlist';
  if (process.env.NODE_ENV === 'production') {
    return fallback;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.message === 'string' && data.message.trim()) {
      return data.message;
    }
    if (typeof data?.error === 'string' && data.error.trim()) {
      return data.error;
    }
  } catch {
    // no-op; attempt plain text fallback below
  }

  try {
    const text = await response.text();
    return text.trim() || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function getNotionConfig() {
  const apiKey = process.env.NOTION_API_KEY;
  const dbId = process.env.NOTION_WAITLIST_DB_ID;
  if (!apiKey || !dbId) {
    return null;
  }
  return { apiKey, dbId };
}

async function fetchExistingEmail(dbId: string, normalizedEmail: string): Promise<boolean> {
  const queryResponse = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
    method: 'POST',
    headers: getNotionHeaders(),
    body: JSON.stringify({
      filter: {
        property: 'Email',
        title: {
          equals: normalizedEmail,
        },
      },
      page_size: 1,
    }),
  });

  if (!queryResponse.ok) {
    const message = await readResponseError(queryResponse);
    throw new Error(`Waitlist query failed (${queryResponse.status}): ${message}`);
  }

  const data = await queryResponse.json();
  return Boolean(data.results?.length);
}

async function createWaitlistRow(dbId: string, normalizedEmail: string): Promise<Response> {
  return fetch(`${NOTION_API}/pages`, {
    method: 'POST',
    headers: getNotionHeaders(),
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties: {
        Email: { title: [{ text: { content: normalizedEmail } }] },
        'Signed Up': { date: { start: new Date().toISOString().slice(0, 10) } },
        Source: { rich_text: [{ text: { content: getWaitlistSource() } }] },
      },
    }),
  });
}

async function notifyDiscordWaitlistWebhook(normalizedEmail: string): Promise<void> {
  const webhook = process.env.DISCORD_WAITLIST_WEBHOOK;
  if (!webhook) {
    return;
  }

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `New waitlist signup: ${normalizedEmail}`,
      }),
    });
  } catch {
    // Optional webhook; do not fail signup flow for notification issues.
  }
}

function getWaitlistConfirmationEmail(normalizedEmail: string): { subject: string; html: string } {
  const subject = 'You are on the PearlOS waitlist';
  const html = `
    <p>Thanks for joining the PearlOS waitlist.</p>
    <p>We have your signup for <strong>${normalizedEmail}</strong> and send invites in weekly batches.</p>
    <p>See you soon,<br />PearlOS</p>
  `.trim();
  return { subject, html };
}

async function sendWaitlistConfirmationEmail(normalizedEmail: string): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    log.warn('Waitlist confirmation email skipped; EMAIL_FROM is not configured', { email: normalizedEmail });
    return;
  }

  try {
    const { subject, html } = getWaitlistConfirmationEmail(normalizedEmail);
    await sendEmail({
      to: normalizedEmail,
      from,
      name: 'PearlOS',
      subject,
      message: html,
    });
  } catch (error) {
    log.warn('Waitlist confirmation email failed', { email: normalizedEmail, error });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const notionConfig = getNotionConfig();
  if (!notionConfig) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = WaitlistSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
  }

  const normalizedEmail = parsed.data.email.toLowerCase();
  try {
    const exists = await fetchExistingEmail(notionConfig.dbId, normalizedEmail);
    if (exists) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: 'You are already on the waitlist.',
      });
    }

    const createResponse = await createWaitlistRow(notionConfig.dbId, normalizedEmail);
    if (!createResponse.ok) {
      const message = await readResponseError(createResponse);
      return NextResponse.json(
        { error: getPublicErrorMessage(new Error(`Waitlist create failed (${createResponse.status}): ${message}`)) },
        { status: 502 }
      );
    }

    await notifyDiscordWaitlistWebhook(normalizedEmail);
    await sendWaitlistConfirmationEmail(normalizedEmail);
    return NextResponse.json({
      success: true,
      message: 'You are on the waitlist. We send invites in weekly batches.',
    });
  } catch (error) {
    return NextResponse.json({ error: getPublicErrorMessage(error) }, { status: 500 });
  }
}
