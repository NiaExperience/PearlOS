import { NextRequest, NextResponse } from 'next/server';
import { chromium } from 'playwright';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url') || 'http://localhost:3000/pearlos';
  const width = parseInt(request.nextUrl.searchParams.get('width') || '1280');
  const height = parseInt(request.nextUrl.searchParams.get('height') || '720');
  const fullPage = request.nextUrl.searchParams.get('fullPage') === 'true';

  // Only allow screenshotting localhost
  if (!url.startsWith('http://localhost')) {
    return NextResponse.json({ error: 'Only localhost URLs allowed' }, { status: 403 });
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

    return new NextResponse(screenshot, {
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
