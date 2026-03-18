import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/news/feed — Server-side RSS feed fetcher & parser.
 *
 * Fetches RSS/Atom feeds server-side (no CORS issues) and returns parsed JSON.
 * Each item includes a `category` field from the feed config.
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
  category: string;
}

interface FeedConfig {
  url: string;
  name: string;
  enabled: boolean;
  category: string;
}

const DEFAULT_FEEDS: FeedConfig[] = [
  // ── World (Independent) ──
  { url: 'https://apnews.com/feed', name: 'AP News', enabled: true, category: 'world' },
  { url: 'https://www.theguardian.com/world/rss', name: 'The Guardian', enabled: true, category: 'world' },
  { url: 'https://www.democracynow.org/democracynow.rss', name: 'Democracy Now!', enabled: true, category: 'world' },
  { url: 'https://restofworld.org/feed/', name: 'Rest of World', enabled: true, category: 'world' },

  // ── Tech (Independent) ──
  { url: 'https://404media.co/rss/', name: '404 Media', enabled: true, category: 'tech' },
  { url: 'https://www.techdirt.com/feed/', name: 'Techdirt', enabled: true, category: 'tech' },
  { url: 'https://www.theregister.com/headlines.atom', name: 'The Register', enabled: true, category: 'tech' },
  { url: 'https://themarkup.org/feeds/rss.xml', name: 'The Markup', enabled: true, category: 'tech' },
  { url: 'https://feeds.arstechnica.com/arstechnica/index', name: 'Ars Technica', enabled: true, category: 'tech' },

  // ── Science (Independent) ──
  { url: 'https://undark.org/feed/', name: 'Undark Magazine', enabled: true, category: 'science' },
  { url: 'https://theconversation.com/us/articles.atom', name: 'The Conversation', enabled: true, category: 'science' },

  // ── Politics (Independent) ──
  { url: 'https://feeds.propublica.org/propublica/main', name: 'ProPublica', enabled: true, category: 'politics' },
  { url: 'https://www.thelever.com/feed/', name: 'The Lever', enabled: true, category: 'politics' },
  { url: 'https://www.themarshallproject.org/rss/main', name: 'Marshall Project', enabled: true, category: 'politics' },
  { url: 'https://theintercept.com/feed/?lang=en', name: 'The Intercept', enabled: true, category: 'politics' },

  // ── Entertainment ──
  { url: 'https://variety.com/feed/', name: 'Variety', enabled: true, category: 'entertainment' },
  { url: 'https://www.rollingstone.com/feed/', name: 'Rolling Stone', enabled: true, category: 'entertainment' },

  // ── Health (Independent) ──
  { url: 'https://kffhealthnews.org/feed/', name: 'KFF Health News', enabled: true, category: 'health' },
];

// ── Minimal XML helpers (no external deps) ──────────────────────────

function getTagContent(xml: string, tag: string): string {
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
  const mediaUrl = getAttr(itemXml, 'media:content', 'url') || getAttr(itemXml, 'media:thumbnail', 'url');
  if (mediaUrl) return mediaUrl;

  const encUrl = getAttr(itemXml, 'enclosure', 'url');
  const encType = getAttr(itemXml, 'enclosure', 'type');
  if (encUrl && encType.includes('image')) return encUrl;

  const desc = getTagContent(itemXml, 'description');
  const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)/i);
  if (imgMatch) return imgMatch[1];

  return '';
}

function stripHtml(html: string): string {
  // First decode HTML entities so &lt;h4&gt; becomes <h4>, then strip tags
  const decoded = html
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#8217;/g, "'").replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"').replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, '-').replace(/&#8212;/g, '-');
  return decoded.replace(/<[^>]*>/g, '').trim();
}

function parseRssFeed(xml: string, sourceName: string, sourceUrl: string, category: string): FeedItem[] {
  const items: FeedItem[] = [];

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

    items.push({ title, link, description, pubDate, image, source: sourceName, sourceUrl, category });
    count++;
  }

  // Handle Atom <entry> elements
  if (items.length === 0) {
    const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    count = 0;
    while ((match = entryRegex.exec(xml)) !== null && count < 8) {
      const entryXml = match[1];
      const title = stripHtml(getTagContent(entryXml, 'title'));
      if (!title) continue;

      const linkHref = getAttr(entryXml, 'link', 'href');
      const link = linkHref || getTagContent(entryXml, 'link').trim();
      const rawContent = getTagContent(entryXml, 'content') || getTagContent(entryXml, 'summary');
      const description = stripHtml(rawContent).substring(0, 300);
      const pubDate = getTagContent(entryXml, 'published') || getTagContent(entryXml, 'updated');
      const image = extractImage(entryXml) || (() => {
        const imgMatch = rawContent.match(/<img[^>]+src=["']([^"']+)/i);
        return imgMatch ? imgMatch[1] : '';
      })();

      items.push({ title, link, description, pubDate, image, source: sourceName, sourceUrl, category });
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
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      console.warn(`[news/feed] Feed ${feed.name} returned ${response.status}`);
      return [];
    }

    const xml = await response.text();
    return parseRssFeed(xml, feed.name, feed.url, feed.category);
  } catch (err) {
    console.warn(`[news/feed] Failed to fetch ${feed.name}:`, err);
    return [];
  }
}

// ── OG image fetcher for items missing images ──────────────────────

const ogImageCache = new Map<string, string>(); // url -> og:image URL

async function fetchOgImage(url: string): Promise<string> {
  if (!url) return '';
  const cached = ogImageCache.get(url);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PearlOS/1.0)' },
      signal: AbortSignal.timeout(3_000),
      redirect: 'follow',
    });
    if (!res.ok) { ogImageCache.set(url, ''); return ''; }
    // Only read first 50KB to find og:image
    const reader = res.body?.getReader();
    if (!reader) { ogImageCache.set(url, ''); return ''; }
    let html = '';
    const decoder = new TextDecoder();
    while (html.length < 50_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      // Check if we've passed </head>
      if (html.includes('</head>')) break;
    }
    reader.cancel().catch(() => {});

    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const img = ogMatch ? ogMatch[1] : '';
    ogImageCache.set(url, img);
    return img;
  } catch {
    ogImageCache.set(url, '');
    return '';
  }
}

async function enrichItemsWithOgImages(items: FeedItem[]): Promise<void> {
  const needsImage = items.filter(i => !i.image && i.link);
  if (needsImage.length === 0) return;

  const results = await Promise.allSettled(
    needsImage.map(async (item) => {
      const img = await fetchOgImage(item.link);
      if (img) item.image = img;
    })
  );
}

// ── In-memory cache (stale-while-revalidate) ────────────────────────

interface FeedCache {
  items: FeedItem[];
  sources: Record<string, { ok: boolean; count: number }>;
  fetchedAt: string;
  timestamp: number;
}

let feedCache: FeedCache | null = null;
let refreshInProgress = false;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function refreshCache(): Promise<FeedCache> {
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

  // Enrich items missing images with OG images from article pages
  await enrichItemsWithOgImages(allItems);

  // Sort by date, then within each category put items with images first
  allItems.sort((a, b) => {
    const da = new Date(a.pubDate).getTime();
    const db = new Date(b.pubDate).getTime();
    if (isNaN(da) && isNaN(db)) return 0;
    if (isNaN(da)) return 1;
    if (isNaN(db)) return -1;
    return db - da;
  });

  // Group by category, sort images-first within each, then interleave back
  const byCategory = new Map<string, FeedItem[]>();
  for (const item of allItems) {
    const cat = item.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(item);
  }
  const sortedItems: FeedItem[] = [];
  for (const [, catItems] of byCategory) {
    // Stable sort: items with images first, preserving date order within each group
    const withImg = catItems.filter(i => !!i.image);
    const withoutImg = catItems.filter(i => !i.image);
    sortedItems.push(...withImg, ...withoutImg);
  }

  const cache: FeedCache = {
    items: sortedItems,
    sources: sourceStatus,
    fetchedAt: new Date().toISOString(),
    timestamp: Date.now(),
  };

  feedCache = cache;
  return cache;
}

async function getCachedFeed(): Promise<FeedCache> {
  const now = Date.now();

  // No cache at all — must fetch
  if (!feedCache) {
    return refreshCache();
  }

  const age = now - feedCache.timestamp;

  // Cache is fresh
  if (age < CACHE_TTL_MS) {
    return feedCache;
  }

  // Cache is stale — return stale data, kick off background refresh
  if (!refreshInProgress) {
    refreshInProgress = true;
    refreshCache()
      .catch(err => console.warn('[news/feed] Background refresh failed:', err))
      .finally(() => { refreshInProgress = false; });
  }

  return feedCache;
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
    const items = await fetchFeed({ url: singleUrl, name: 'Custom', enabled: true, category: 'uncategorized' });
    return NextResponse.json({ items, fetchedAt: new Date().toISOString() });
  }

  // Multiple specific URLs mode
  const urlsCsv = searchParams.get('urls');
  if (urlsCsv) {
    const urls = urlsCsv.split(',').map(u => u.trim()).filter(Boolean);
    const feeds: FeedConfig[] = urls.map(u => ({ url: u, name: 'Custom', enabled: true, category: 'uncategorized' }));
    const results = await Promise.allSettled(feeds.map(f => fetchFeed(f)));
    const allItems: FeedItem[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allItems.push(...r.value);
    }
    allItems.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    return NextResponse.json({ items: allItems, fetchedAt: new Date().toISOString() });
  }

  // Default: fetch all configured feeds (with in-memory cache)
  const cached = await getCachedFeed();

  return NextResponse.json(
    {
      items: cached.items,
      sources: cached.sources,
      fetchedAt: cached.fetchedAt,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    }
  );
}
