import { NextRequest } from 'next/server';
import { requireAuth } from '@interface/lib/api-auth';

const BOT_GATEWAY_URL = process.env.BOT_GATEWAY_URL || process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || 'http://localhost:4444';

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  try {
    const limit = req.nextUrl.searchParams.get('limit') || '50';
    const before = req.nextUrl.searchParams.get('before') || '';

    const params = new URLSearchParams({ limit });
    if (before) params.set('before', before);

    const upstream = await fetch(`${BOT_GATEWAY_URL}/api/chat/history?${params}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await upstream.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ messages: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
