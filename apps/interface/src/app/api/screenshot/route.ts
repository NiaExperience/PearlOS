import { NextRequest, NextResponse } from 'next/server';
import { chromium } from 'playwright';
import { requireAuth } from '@interface/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  const defaultUrl = `${request.nextUrl.origin}/pearlos`;
  const url = request.nextUrl.searchParams.get('url') || defaultUrl;
  const width = parseInt(request.nextUrl.searchParams.get('width') || '1280');
  const height = parseInt(request.nextUrl.searchParams.get('height') || '720');
  const fullPage = request.nextUrl.searchParams.get('fullPage') === 'true';

  const envOrigins = (process.env.SCREENSHOT_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as string[];
  const configuredInterfaceOrigins = [
    process.env.NEXTAUTH_INTERFACE_URL,
    process.env.NEXTAUTH_URL,
    process.env.NEXT_PUBLIC_INTERFACE_URL,
  ]
    .filter(Boolean)
    .map((url) => {
      try {
        return new URL(url as string).origin;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as string[];
  const allowedOrigins = Array.from(new Set([
    ...envOrigins,
    ...configuredInterfaceOrigins,
    ...(process.env.NODE_ENV !== 'production' ? [request.nextUrl.origin] : []),
  ]));
  if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
    return NextResponse.json(
      { error: 'Screenshot origin allow-list is not configured' },
      { status: 500 },
    );
  }
  let targetOrigin = '';
  try {
    targetOrigin = new URL(url).origin;
  } catch {
    return NextResponse.json({ error: 'Invalid screenshot URL' }, { status: 400 });
  }

  if (!allowedOrigins.includes(targetOrigin)) {
    return NextResponse.json(
      { error: 'URL origin is not allowed for screenshot capture' },
      { status: 403 },
    );
  }

  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    // Give animations a moment to settle
    await page.waitForTimeout(1000);
    const screenshot = await page.screenshot({ fullPage, type: 'png' });
    await browser.close();

    return new NextResponse(new Uint8Array(screenshot) as any, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="screenshot-${Date.now()}.png"`,
      },
    });
  } catch (err: unknown) {
    if (browser) await browser.close();
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
