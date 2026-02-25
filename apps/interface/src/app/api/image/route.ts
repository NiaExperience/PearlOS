import { NextRequest, NextResponse } from 'next/server';

const BOT_GATEWAY_URL =
  process.env.BOT_GATEWAY_URL ||
  process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL ||
  'http://localhost:4444';

/**
 * Proxy /api/image?q=SUBJECT to the bot gateway's image resolver.
 * This allows the Wonder Canvas iframe (running on the client) to fetch
 * images without needing direct access to localhost:4444.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q');
  if (!q) {
    return NextResponse.json({ error: 'Missing q parameter' }, { status: 400 });
  }

  try {
    const upstream = await fetch(
      `${BOT_GATEWAY_URL}/api/image?q=${encodeURIComponent(q)}`,
      { redirect: 'follow' },
    );

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const body = await upstream.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('[api/image] proxy error:', err);
    return NextResponse.json({ error: 'Image fetch failed' }, { status: 502 });
  }
}
