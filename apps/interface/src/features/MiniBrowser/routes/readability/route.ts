import { NextRequest, NextResponse } from 'next/server';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

/**
 * SSRF protection: block internal/private IPs and localhost
 */
function isBlockedUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();
    // Block localhost variants
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') return true;
    // Block private IP ranges
    if (/^10\./.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
    if (/^192\.168\./.test(hostname)) return true;
    // Block link-local
    if (/^169\.254\./.test(hostname)) return true;
    // Block metadata endpoints
    if (hostname === 'metadata.google.internal') return true;
    if (hostname === '169.254.169.254') return true;
    return false;
  } catch {
    return true;
  }
}

export async function POST_impl(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid URL' }, { status: 400 });
    }

    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: 'URL must start with http:// or https://' }, { status: 400 });
    }

    if (isBlockedUrl(url)) {
      return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
    }

    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Failed to fetch: ${response.status} ${response.statusText}` }, { status: 502 });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return NextResponse.json({ error: 'URL does not point to an HTML page' }, { status: 422 });
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      return NextResponse.json({ error: 'Could not extract readable content from this page' }, { status: 422 });
    }

    return NextResponse.json({
      title: article.title,
      byline: article.byline,
      content: article.content,
      textContent: article.textContent,
      excerpt: article.excerpt,
      siteName: article.siteName,
      length: article.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('timeout') || message.includes('abort')) {
      return NextResponse.json({ error: 'Request timed out' }, { status: 504 });
    }
    return NextResponse.json({ error: `Readability error: ${message}` }, { status: 500 });
  }
}
