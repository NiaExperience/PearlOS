import { NextRequest, NextResponse } from 'next/server';

/**
 * Generic image proxy — fetches an external image URL server-side and returns
 * the bytes directly. This avoids CORS, CSP, referrer-policy, and hotlinking
 * issues that plague external images inside sandboxed iframes (Wonder Canvas).
 *
 * Usage: /api/image-proxy?url=https://upload.wikimedia.org/...
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  // Basic validation — only allow http/https URLs
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: 'Invalid protocol' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PearlOS/1.0)',
        'Accept': 'image/*,*/*',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${upstream.status}` },
        { status: 502 },
      );
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const body = await upstream.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('[api/image-proxy] error:', err);
    return NextResponse.json({ error: 'Image fetch failed' }, { status: 502 });
  }
}
