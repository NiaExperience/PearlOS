import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/news/feed — Server-side RSS feed fetcher & parser.
 *
 * Fetches RSS/Atom feeds server-side (no CORS issues) and returns parsed JSON.
 * Accepts feed URLs as query params or fetches all configured feeds.
 *
 * Usage:
 *   GET /api/news/feed                    — fetch all configured feeds
 *   GET /api/news/feed?url=<rss-url>      — fetch a single feed
 *   GET /api/news/feed?urls=<url1>,<url2> — fetch specific feeds
 */

interface FeedItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  image: string;
  source: string;
  sourceUrl: string;
}

interface FeedConfig {
  url: string;
  name: string;
  enabled: boolean;
}

const DEFAULT_FEEDS: FeedConfig[] = [
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', name: 'NY Times', enabled: true },
  { url: 'https://feeds.bbci.co.uk/news/rss.xml', name: 'BBC News', enabled: true },
  { url: 'https://feeds.npr.org/1001/rss.xml', name: 'NPR', enabled: true },
  { url: 'https://feeds.arstechnica.com/arstechnica/index', name: 'Ars Technica', enabled: true },
  { url: 'https://www.theverge.com/rss/index.xml', name: 'The Verge', enabled: true },
];

// ── Minimal XML helpers (no external deps) ──────────────────────────

function getTagContent(xml: string, tag: string): string {
  // Handle both <tag>content</tag> and <tag><![CDATA[content]]></tag>
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'),
  ];
  for (const pat of patterns) {
    const m = xml.match(pat);
    if (m) return m[1].trim();
  }
  return '';
}

function getAttr(xml: string, tag: string, attr: string): string {
  const tagMatch = xml.match(new RegExp(`<${tag}[^>]*>`, 'i'));
  if (!tagMatch) return '';
  const attrMatch = tagMatch[0].match(new RegExp(`${attr}=["']([^"']*)["']`, 'i'));
  return attrMatch ? attrMatch[1] : '';
}

function extractImage(itemXml: string): string {
  // media:content or media:thumbnail
  const mediaUrl = getAttr(itemXml, 'media:content', 'url') || getAttr(itemXml, 'media:thumbnail', 'url');
  if (mediaUrl) return mediaUrl;

  // enclosure with image type
  const encUrl = getAttr(itemXml, 'enclosure', 'url');
  const encType = getAttr(itemXml, 'enclosure', 'type');
  if (encUrl && encType.includes('image')) return encUrl;

  // img tag inside description
  const desc = getTagContent(itemXml, 'description');
  const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)/i);
  if (imgMatch) return imgMatch[1];

  return '';
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

function parseRssFeed(xml: string, sourceName: string, sourceUrl: string): FeedItem[] {
  const items: FeedItem[] = [];

  // Handle RSS 2.0 <item> elements
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match;
  let count = 0;

  while ((match = itemRegex.exec(xml)) !== null && count < 8) {
    const itemXml = match[1];
    const title = stripHtml(getTagContent(itemXml, 'title'));
    if (!title) continue;

    const link = getTagContent(itemXml, 'link').trim();
    const rawDesc = getTagContent(itemXml, 'description');
    const description = stripHtml(rawDesc).substring(0, 300);
    const pubDate = getTagContent(itemXml, 'pubDate') || getTagContent(itemXml, 'dc:date');
    const image = extractImage(itemXml);

    items.push({ title, link, description, pubDate, image, source: sourceName, sourceUrl });
    count++;
  }

  // Handle Atom <entry> elements (e.g., The Verge)
  if (items.length === 0) {
    const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    count = 0;
    while ((match = entryRegex.exec(xml)) !== null && count < 8) {
      const entryXml = match[1];
      const title = stripHtml(getTagContent(entryXml, 'title'));
      if (!title) continue;

      // Atom uses <link href="..."/> 
      const linkHref = getAttr(entryXml, 'link', 'href');
      const link = linkHref || getTagContent(entryXml, 'link').trim();
      const rawContent = getTagContent(entryXml, 'content') || getTagContent(entryXml, 'summary');
      const description = stripHtml(rawContent).substring(0, 300);
      const pubDate = getTagContent(entryXml, 'published') || getTagContent(entryXml, 'updated');
      const image = extractImage(entryXml) || (() => {
        // Try to find image in content
        const imgMatch = rawContent.match(/<img[^>]+src=["']([^"']+)/i);
        return imgMatch ? imgMatch[1] : '';
      })();

      items.push({ title, link, description, pubDate, image, source: sourceName, sourceUrl });
      count++;
    }
  }

  return items;
}

async function fetchFeed(feed: FeedConfig): Promise<FeedItem[]> {
  try {
    const response = await fetch(feed.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PearlOS/1.0; +https://pearlos.ai)',
        'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      console.warn(`[news/feed] Feed ${feed.name} returned ${response.status}`);
      return [];
    }

    const xml = await response.text();
    return parseRssFeed(xml, feed.name, feed.url);
  } catch (err) {
    console.warn(`[news/feed] Failed to fetch ${feed.name}:`, err);
    return [];
  }
}

async function loadConfig(): Promise<FeedConfig[]> {
  try {
    const fs = await import('fs/promises');
    const configPath = '/tmp/pearlos-news-config.json';
    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);
    if (Array.isArray(config.feeds) && config.feeds.length > 0) {
      return config.feeds;
    }
  } catch {
    // Config doesn't exist yet, use defaults
  }
  return DEFAULT_FEEDS;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  // Single feed URL mode
  const singleUrl = searchParams.get('url');
  if (singleUrl) {
    const items = await fetchFeed({ url: singleUrl, name: 'Custom', enabled: true });
    return NextResponse.json({ items, fetchedAt: new Date().toISOString() });
  }

  // Multiple specific URLs mode
  const urlsCsv = searchParams.get('urls');
  if (urlsCsv) {
    const urls = urlsCsv.split(',').map(u => u.trim()).filter(Boolean);
    const feeds: FeedConfig[] = urls.map(u => ({ url: u, name: 'Custom', enabled: true }));
    const results = await Promise.allSettled(feeds.map(f => fetchFeed(f)));
    const allItems: FeedItem[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allItems.push(...r.value);
    }
    allItems.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    return NextResponse.json({ items: allItems, fetchedAt: new Date().toISOString() });
  }

  // Default: fetch all configured feeds
  const feeds = await loadConfig();
  const enabledFeeds = feeds.filter(f => f.enabled);

  const results = await Promise.allSettled(enabledFeeds.map(f => fetchFeed(f)));
  const allItems: FeedItem[] = [];
  const sourceStatus: Record<string, { ok: boolean; count: number }> = {};

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const feedName = enabledFeeds[i].name;
    if (r.status === 'fulfilled') {
      allItems.push(...r.value);
      sourceStatus[feedName] = { ok: true, count: r.value.length };
    } else {
      sourceStatus[feedName] = { ok: false, count: 0 };
    }
  }

  // Sort by date, newest first
  allItems.sort((a, b) => {
    const da = new Date(a.pubDate).getTime();
    const db = new Date(b.pubDate).getTime();
    if (isNaN(da) && isNaN(db)) return 0;
    if (isNaN(da)) return 1;
    if (isNaN(db)) return -1;
    return db - da;
  });

  return NextResponse.json(
    {
      items: allItems,
      sources: sourceStatus,
      fetchedAt: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
      },
    }
  );
}
