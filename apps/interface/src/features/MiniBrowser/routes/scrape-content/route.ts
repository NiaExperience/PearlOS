import { NextRequest, NextResponse } from 'next/server';
import { ContentScraper } from '../../services/content-scraper';

export async function POST(request: NextRequest) {
  try {
    const { url, html } = await request.json();
    const scraper = new ContentScraper(url || 'https://example.com');
    const data = html ? await scraper.scrapeFromHtml(html, url || 'about:blank') : await scraper.scrapeFromUrl(url);
    const domain = (url ? new URL(url) : new URL('https://example.com')).hostname.replace(/^www\./, '');
    return NextResponse.json({ success: true, data, domain, timestamp: Date.now() });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: 'Failed to scrape', message: String(e?.message || e) }, { status: 500 });
  }
}


