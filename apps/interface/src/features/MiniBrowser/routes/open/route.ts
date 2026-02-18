import { NextRequest, NextResponse } from 'next/server';

function normalizeUrl(input: string): string {
  let u = (input || '').trim();
  if (!u) return 'https://www.google.com';
  if (!/^https?:\/\//i.test(u)) {
    if (u.includes('.') && !u.includes(' ')) u = `https://${u}`;
    else u = `https://www.google.com/search?q=${encodeURIComponent(u)}`;
  }
  return u;
}

export async function POST_impl(request: NextRequest) {
  try {
    const { url, userRequest } = await request.json();
    const processedUrl = normalizeUrl(url);
    return NextResponse.json({
      success: true,
      action: 'OPEN_ENHANCED_BROWSER',
      url: processedUrl,
      proxyUrl: `/api/mini-browser/enhanced-proxy/${encodeURIComponent(processedUrl)}`,
      features: ['Full website access', 'Real-time content scraping', 'Voice navigation'],
      payload: { app: 'enhancedBrowser', url: processedUrl, voiceEnabled: true, scrapingEnabled: true },
      userRequest: userRequest || null,
      timestamp: Date.now(),
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return NextResponse.json({ success: false, error: 'Invalid request', message: String(e?.message || e) }, { status: 400 });
  }
}


