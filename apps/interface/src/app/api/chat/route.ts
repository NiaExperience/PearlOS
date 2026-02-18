import { NextRequest } from 'next/server';

const BOT_GATEWAY_URL = process.env.BOT_GATEWAY_URL || process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || 'http://localhost:4444';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const upstream = await fetch(`${BOT_GATEWAY_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Upstream error: ${upstream.status}` }), {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Stream the SSE response through
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
