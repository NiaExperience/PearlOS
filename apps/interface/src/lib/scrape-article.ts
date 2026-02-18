/**
 * Article scraping utility for PearlOS Canvas.
 *
 * Takes a URL, fetches the page, and extracts structured article content.
 * Designed for server-side use (API routes / server actions).
 */

import type { ArticleContent, ArticleData } from '@interface/components/canvas/types';

export interface ScrapeResult {
  success: boolean;
  content?: ArticleContent;
  error?: string;
}

/**
 * Extract article metadata from HTML using basic DOM parsing.
 * Works server-side with a simple regex-based approach (no jsdom dependency needed).
 */
function extractMeta(html: string, name: string): string | null {
  // Try og: and standard meta tags
  for (const attr of ['property', 'name']) {
    for (const prefix of ['og:', 'article:', '']) {
      const pattern = new RegExp(
        `<meta[^>]+${attr}=["']${prefix}${name}["'][^>]+content=["']([^"']*)["']`,
        'i'
      );
      const match = html.match(pattern);
      if (match?.[1]) return match[1];

      // Also try content before property
      const pattern2 = new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${prefix}${name}["']`,
        'i'
      );
      const match2 = html.match(pattern2);
      if (match2?.[1]) return match2[1];
    }
  }
  return null;
}

function extractTitle(html: string): string {
  return extractMeta(html, 'title') ||
    html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ||
    'Untitled';
}

function extractImages(html: string, baseUrl: string): Array<{ url: string; caption?: string }> {
  const images: Array<{ url: string; caption?: string }> = [];
  const imgPattern = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgPattern.exec(html)) !== null && images.length < 6) {
    let src = match[1];
    if (src.startsWith('//')) src = 'https:' + src;
    else if (src.startsWith('/')) {
      try { src = new URL(src, baseUrl).href; } catch { continue; }
    }
    // Skip tiny images, tracking pixels, icons
    if (src.includes('1x1') || src.includes('pixel') || src.includes('.svg') || src.includes('icon')) continue;

    const alt = match[0].match(/alt=["']([^"']*)["']/)?.[1];
    images.push({ url: src, caption: alt || undefined });
  }
  return images;
}

/**
 * Extract readable body text from HTML.
 * Strips tags, scripts, styles, and returns cleaned text as markdown-ish content.
 */
function extractBody(html: string): string {
  // Remove scripts, styles, nav, header, footer, aside
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '');

  // Try to find article or main content
  const articleMatch = clean.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch = clean.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const contentDiv = clean.match(/<div[^>]+class="[^"]*(?:content|article|post|entry)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  const body = articleMatch?.[1] || mainMatch?.[1] || contentDiv?.[1] || clean;

  // Convert paragraphs to text
  let text = body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<h([1-6])[^>]*>/gi, (_, level) => '\n' + '#'.repeat(parseInt(level)) + ' ')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Limit to reasonable length
  if (text.length > 10000) {
    text = text.slice(0, 10000) + '\n\n*[Article truncated]*';
  }

  return text;
}

/**
 * Scrape an article URL and return structured CanvasContent.
 *
 * @param url - The article URL to scrape
 * @returns ScrapeResult with the article content or error
 */
export async function scrapeArticle(url: string): Promise<ScrapeResult> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PearlOS/1.0; +https://pearlos.ai)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const html = await response.text();

    const articleData: ArticleData = {
      headline: extractTitle(html),
      author: extractMeta(html, 'author') || undefined,
      source: extractMeta(html, 'site_name') || new URL(url).hostname,
      date: extractMeta(html, 'published_time') || extractMeta(html, 'date') || undefined,
      body: extractBody(html),
      heroImage: extractMeta(html, 'image') || undefined,
      images: extractImages(html, url),
      url,
    };

    return {
      success: true,
      content: {
        type: 'article',
        title: articleData.headline,
        data: articleData,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to scrape article',
    };
  }
}
