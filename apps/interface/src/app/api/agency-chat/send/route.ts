import { NextRequest, NextResponse } from 'next/server';

const BOT_GATEWAY = (process.env.BOT_GATEWAY_URL || 'http://localhost:4444').replace(/\/$/, '');
const SHARED_SECRET = process.env.BOT_CONTROL_SHARED_SECRET || '';

// The upstream agency-chat write endpoint requires the bot secret. Blair's
// replies from the widget are posted as Pearl with type="user" so the frontend
// can render them in a different bubble style without changing stored history.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (!text) {
      return NextResponse.json({ error: 'body is required' }, { status: 400 });
    }
    if (text.length > 2000) {
      return NextResponse.json({ error: 'body too long (max 2000 chars)' }, { status: 400 });
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (SHARED_SECRET) headers['X-Bot-Secret'] = SHARED_SECRET;

    const r = await fetch(`${BOT_GATEWAY}/api/agency-chat/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ speaker: 'Pearl', body: text, type: 'user' }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return NextResponse.json(
        { error: 'upstream_error', status: r.status, detail },
        { status: r.status },
      );
    }
    const data = await r.json();

    return NextResponse.json({ ok: true, message: data?.message ?? null });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'proxy_failed', detail }, { status: 502 });
  }
}
