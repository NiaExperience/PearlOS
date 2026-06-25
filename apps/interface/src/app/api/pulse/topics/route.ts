import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type PulseTrend = 'rising' | 'steady' | 'falling';
type PulseSourceType = 'reddit' | 'hacker-news' | 'news' | 'seed';

interface RawPulseSignal {
  id: string;
  title: string;
  text: string;
  url: string;
  source: string;
  sourceType: PulseSourceType;
  region: string;
  lat: number;
  lon: number;
  language: string;
  score: number;
  commentCount: number;
  createdAt: string;
  comments: PulseComment[];
}

interface PulseComment {
  id: string;
  source: string;
  sourceLanguage: string;
  translatedText: string;
  region: string;
  score: number;
  url?: string;
}

interface PulseTopic {
  id: string;
  rank: number;
  title: string;
  summary: string;
  score: number;
  trend: PulseTrend;
  region: string;
  lat: number;
  lon: number;
  volumeLabel: string;
  sentimentLabel: string;
  languageLabel: string;
  sourceMix: Array<{ source: string; count: number }>;
  highlights: string[];
  comments: PulseComment[];
  sources: Array<{ label: string; url: string }>;
  coverageNote: string;
  updatedAt: string;
}

const REGION_COORDS: Record<string, { lat: number; lon: number }> = {
  Worldwide: { lat: 15, lon: 0 },
  'North America': { lat: 39, lon: -98 },
  Europe: { lat: 50, lon: 14 },
  'Middle East': { lat: 29, lon: 45 },
  Africa: { lat: 1, lon: 20 },
  Asia: { lat: 34, lon: 103 },
  'South Asia': { lat: 22, lon: 78 },
  'East Asia': { lat: 36, lon: 138 },
  Oceania: { lat: -25, lon: 134 },
  Technology: { lat: 37, lon: -122 },
  Culture: { lat: 34, lon: -118 },
  Sports: { lat: 25, lon: -45 },
};

const SUBREDDITS = [
  { name: 'worldnews', region: 'Worldwide' },
  { name: 'technology', region: 'Technology' },
  { name: 'science', region: 'Worldwide' },
  { name: 'entertainment', region: 'Culture' },
  { name: 'sports', region: 'Sports' },
];

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'amid',
  'and',
  'are',
  'around',
  'from',
  'has',
  'have',
  'into',
  'its',
  'new',
  'not',
  'over',
  'say',
  'says',
  'that',
  'the',
  'their',
  'this',
  'with',
  'will',
  'you',
  'your',
]);

function cleanText(value: unknown, limit = 320): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function safeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function coords(region: string): { lat: number; lon: number } {
  return REGION_COORDS[region] ?? REGION_COORDS.Worldwide;
}

function topicTitleFromSignal(signal: RawPulseSignal): string {
  const hashtag = signal.title.match(/#[\p{L}\p{N}_-]+/u)?.[0];
  if (hashtag) return hashtag;
  const words = signal.title
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, '').trim())
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word.toLowerCase()))
    .slice(0, 7);
  return words.length ? words.join(' ') : signal.title.slice(0, 90);
}

function matchesQuery(signal: RawPulseSignal, query: string): boolean {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
  if (tokens.length === 0) return true;
  const haystack = `${signal.title} ${signal.text} ${signal.source} ${signal.url}`.toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

function trendFor(signal: RawPulseSignal, rank: number): PulseTrend {
  if (signal.score > 900 || signal.commentCount > 450 || rank <= 3) return 'rising';
  if (signal.score < 80 && signal.commentCount < 25) return 'falling';
  return 'steady';
}

function volumeLabel(score: number, comments: number): string {
  if (score > 2500 || comments > 1200) return 'Very high activity';
  if (score > 800 || comments > 300) return 'High activity';
  if (score > 180 || comments > 75) return 'Moderate activity';
  return 'Emerging signal';
}

function buildSummary(signal: RawPulseSignal, title: string): string {
  const context = signal.text || signal.title;
  const sourceLabel =
    signal.sourceType === 'reddit'
      ? 'public Reddit threads'
      : signal.sourceType === 'hacker-news'
        ? 'Hacker News discussions'
        : signal.sourceType === 'news'
          ? 'public news feeds'
          : 'sample regional signals';
  return cleanText(
    `${title} is showing up across ${sourceLabel}. ${context} People are reacting through questions, criticism, jokes, and practical updates where comments are available.`,
    420,
  );
}

function sourceMix(signals: RawPulseSignal[]): Array<{ source: string; count: number }> {
  const counts = new Map<string, number>();
  for (const signal of signals) counts.set(signal.source, (counts.get(signal.source) ?? 0) + 1);
  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
    .slice(0, 4);
}

function topicFromSignal(signal: RawPulseSignal, rank: number, localeLabel: string): PulseTopic {
  const title = topicTitleFromSignal(signal);
  const highlights = [
    cleanText(signal.text || signal.title, 160),
    `${signal.commentCount.toLocaleString()} public comments or replies are attached to the strongest available signal.`,
    `Primary visible region: ${signal.region}.`,
  ].filter(Boolean);

  const comments =
    signal.comments.length > 0
      ? signal.comments.slice(0, 4)
      : [
          {
            id: `${signal.id}-context`,
            source: signal.source,
            sourceLanguage: signal.language,
            translatedText:
              signal.sourceType === 'news'
                ? 'Public comment access is limited for this source, so Pulse is summarizing the discussion context instead of showing raw comments.'
                : 'Comment access was limited for this source, but the topic signal is still visible.',
            region: signal.region,
            score: Math.max(1, Math.round(signal.score / 20)),
            url: signal.url,
          },
        ];

  return {
    id: `${safeId(title) || 'topic'}-${rank}`,
    rank,
    title,
    summary: buildSummary(signal, title),
    score: Math.max(1, Math.round(signal.score + signal.commentCount * 1.75)),
    trend: trendFor(signal, rank),
    region: signal.region,
    lat: signal.lat,
    lon: signal.lon,
    volumeLabel: volumeLabel(signal.score, signal.commentCount),
    sentimentLabel: 'Mixed / active',
    languageLabel: `Translated to ${localeLabel}`,
    sourceMix: sourceMix([signal]),
    highlights,
    comments,
    sources: [{ label: signal.source, url: signal.url }],
    coverageNote:
      'Pulse uses permitted public discussion/news signals when available. This is not a full scrape of every social network, and coverage varies by platform, region, and language.',
    updatedAt: new Date().toISOString(),
  };
}

async function fetchJson(url: string, timeoutMs = 6000): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'PearlOS Pulse/1.0 (+https://pearlos.org)',
    },
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchRedditComments(permalink: string, source: string, region: string): Promise<PulseComment[]> {
  if (!permalink.startsWith('/r/')) return [];
  try {
    const data = await fetchJson(`https://www.reddit.com${permalink}.json?limit=4&sort=top`, 4500);
    const listing = Array.isArray(data) ? data[1] : null;
    const children = listing?.data?.children;
    if (!Array.isArray(children)) return [];
    return children
      .map((child: any, index: number): PulseComment | null => {
        const body = cleanText(child?.data?.body, 280);
        if (!body || body === '[deleted]' || body === '[removed]') return null;
        return {
          id: `${source}-${child?.data?.id ?? index}`,
          source,
          sourceLanguage: 'English',
          translatedText: body,
          region,
          score: asNumber(child?.data?.score, 0),
          url: `https://www.reddit.com${child?.data?.permalink ?? permalink}`,
        };
      })
      .filter(Boolean) as PulseComment[];
  } catch {
    return [];
  }
}

async function loadRedditSignals(query: string): Promise<RawPulseSignal[]> {
  const signals: RawPulseSignal[] = [];
  const urls = query
    ? [
        {
          url: `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=hot&t=day&type=link&limit=12`,
          region: 'Worldwide',
          source: 'Reddit Search',
        },
      ]
    : SUBREDDITS.map((subreddit) => ({
        url: `https://www.reddit.com/r/${subreddit.name}/hot.json?limit=8`,
        region: subreddit.region,
        source: `r/${subreddit.name}`,
      }));

  const listings = await Promise.allSettled(urls.map((entry) => fetchJson(entry.url).then((data) => ({ ...entry, data }))));
  for (const result of listings) {
    if (result.status !== 'fulfilled') continue;
    const children = (result.value.data as any)?.data?.children;
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      const post = child?.data;
      const title = cleanText(post?.title, 180);
      if (!title) continue;
      const region = result.value.region;
      const point = coords(region);
      const permalink = String(post?.permalink ?? '');
      const comments = signals.length < 8 ? await fetchRedditComments(permalink, result.value.source, region) : [];
      signals.push({
        id: `reddit-${post?.id ?? safeId(title)}`,
        title,
        text: cleanText(post?.selftext || post?.subreddit_name_prefixed || title, 260),
        url: permalink ? `https://www.reddit.com${permalink}` : String(post?.url ?? 'https://www.reddit.com'),
        source: result.value.source,
        sourceType: 'reddit',
        region,
        lat: point.lat,
        lon: point.lon,
        language: 'English',
        score: asNumber(post?.score, 0),
        commentCount: asNumber(post?.num_comments, 0),
        createdAt: post?.created_utc ? new Date(post.created_utc * 1000).toISOString() : new Date().toISOString(),
        comments,
      });
    }
  }
  return signals;
}

async function loadHackerNewsSignals(query: string): Promise<RawPulseSignal[]> {
  try {
    const url = query
      ? `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=15`
      : 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=15';
    const data = await fetchJson(url, 5500) as { hits?: any[] };
    const point = coords('Technology');
    return (Array.isArray(data.hits) ? data.hits : [])
      .map((hit, index): RawPulseSignal | null => {
        const title = cleanText(hit?.title || hit?.story_title, 180);
        if (!title) return null;
        const count = asNumber(hit?.num_comments, 0);
        const points = asNumber(hit?.points, 0);
        return {
          id: `hn-${hit?.objectID ?? index}`,
          title,
          text: cleanText(hit?.url || hit?.story_text || title, 260),
          url: hit?.url || `https://news.ycombinator.com/item?id=${hit?.objectID}`,
          source: 'Hacker News',
          sourceType: 'hacker-news',
          region: 'Technology',
          lat: point.lat,
          lon: point.lon,
          language: 'English',
          score: points,
          commentCount: count,
          createdAt: hit?.created_at || new Date().toISOString(),
          comments: [
            {
              id: `hn-discussion-${hit?.objectID ?? index}`,
              source: 'Hacker News',
              sourceLanguage: 'English',
              translatedText: `${count.toLocaleString()} comments are attached to the public Hacker News discussion.`,
              region: 'Technology',
              score: points,
              url: `https://news.ycombinator.com/item?id=${hit?.objectID}`,
            },
          ],
        };
      })
      .filter(Boolean) as RawPulseSignal[];
  } catch {
    return [];
  }
}

async function loadNewsSignals(req: NextRequest, query: string): Promise<RawPulseSignal[]> {
  try {
    const feedUrl = new URL('/api/news/feed', req.nextUrl.origin);
    const res = await fetch(feedUrl, { signal: AbortSignal.timeout(6500), cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    const items = Array.isArray(json?.items) ? json.items : [];
    return items
      .filter((item: any) => {
        if (!query) return true;
        const haystack = `${item?.title ?? ''} ${item?.description ?? ''}`.toLowerCase();
        return haystack.includes(query.toLowerCase());
      })
      .slice(0, 35)
      .map((item: any, index: number): RawPulseSignal | null => {
        const title = cleanText(item?.title, 180);
        if (!title) return null;
        const category = cleanText(item?.category, 40);
        const region =
          category === 'technology' ? 'Technology'
            : category === 'entertainment' ? 'Culture'
              : category === 'sports' ? 'Sports'
                : category === 'world' ? 'Worldwide'
                  : 'Worldwide';
        const point = coords(region);
        return {
          id: `news-${index}-${safeId(title)}`,
          title,
          text: cleanText(item?.description || title, 260),
          url: String(item?.link || item?.sourceUrl || ''),
          source: cleanText(item?.source, 80) || 'Public news feed',
          sourceType: 'news',
          region,
          lat: point.lat,
          lon: point.lon,
          language: 'English',
          score: 95,
          commentCount: 0,
          createdAt: item?.pubDate || new Date().toISOString(),
          comments: [],
        };
      })
      .filter(Boolean) as RawPulseSignal[];
  } catch {
    return [];
  }
}

function fallbackTopics(localeLabel: string, query = ''): PulseTopic[] {
  if (query) {
    const point = coords('Worldwide');
    return [
      topicFromSignal(
        {
          id: `seed-query-${safeId(query) || 'topic'}`,
          title: `Public signals for ${query}`,
          text: `Pulse did not find enough reachable public discussion sources for "${query}" in this scan. The app is ready to show matched public comments as provider coverage expands.`,
          url: 'https://news.ycombinator.com/',
          source: 'Pulse transparent fallback',
          sourceType: 'seed',
          region: 'Worldwide',
          lat: point.lat,
          lon: point.lon,
          language: 'English',
          score: 1,
          commentCount: 0,
          createdAt: new Date().toISOString(),
          comments: [
            {
              id: `seed-query-${safeId(query) || 'topic'}-context`,
              source: 'Pulse coverage note',
              sourceLanguage: 'English',
              translatedText:
                'No strong public-source match was reachable for this exact topic. Connectors for licensed social-listening feeds, Bluesky, Mastodon, YouTube, TikTok, or X can populate this view through the same contract.',
              region: 'Worldwide',
              score: 1,
            },
          ],
        },
        1,
        localeLabel,
      ),
    ];
  }

  const seed: Array<Omit<RawPulseSignal, 'id' | 'sourceType' | 'createdAt'>> = [
    {
      title: 'AI agents at work',
      text: 'People are comparing how agentic tools handle coding, research, scheduling, and personal workflows.',
      url: 'https://news.ycombinator.com/',
      source: 'Seeded public-discussion sample',
      region: 'Technology',
      lat: coords('Technology').lat,
      lon: coords('Technology').lon,
      language: 'English',
      score: 720,
      commentCount: 310,
      comments: [
        {
          id: 'seed-ai-1',
          source: 'Translated sample',
          sourceLanguage: 'Spanish',
          translatedText: 'The useful part is not another chatbot, it is when it actually finishes the boring setup work.',
          region: 'Europe',
          score: 84,
        },
      ],
    },
    {
      title: 'Heat waves and city planning',
      text: 'Posts are focusing on shade, cooling centers, energy demand, and how cities should adapt.',
      url: 'https://www.reddit.com/r/worldnews/',
      source: 'Seeded public-discussion sample',
      region: 'Worldwide',
      lat: coords('Worldwide').lat,
      lon: coords('Worldwide').lon,
      language: 'English',
      score: 610,
      commentCount: 220,
      comments: [
        {
          id: 'seed-climate-1',
          source: 'Translated sample',
          sourceLanguage: 'Hindi',
          translatedText: 'People keep talking about records, but the daily problem is transport and work in the afternoon heat.',
          region: 'South Asia',
          score: 62,
        },
      ],
    },
    {
      title: 'Global football transfers',
      text: 'Fans are debating fees, rumors, roster strategy, and whether clubs are overpaying.',
      url: 'https://sports.yahoo.com/rss/',
      source: 'Seeded public-discussion sample',
      region: 'Sports',
      lat: coords('Sports').lat,
      lon: coords('Sports').lon,
      language: 'English',
      score: 540,
      commentCount: 420,
      comments: [
        {
          id: 'seed-sports-1',
          source: 'Translated sample',
          sourceLanguage: 'Portuguese',
          translatedText: 'Everyone wants a star signing, but the midfield still decides the season.',
          region: 'South America',
          score: 75,
        },
      ],
    },
  ];

  return seed.map((signal, index) =>
    topicFromSignal(
      {
        ...signal,
        id: `seed-${index}`,
        sourceType: 'seed',
        createdAt: new Date().toISOString(),
      },
      index + 1,
      localeLabel,
    ),
  );
}

function localeLabel(req: NextRequest): string {
  const locale = req.nextUrl.searchParams.get('locale') || req.headers.get('accept-language')?.split(',')[0] || 'en-US';
  const language = locale.toLowerCase().split('-')[0];
  const labels: Record<string, string> = {
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    hi: 'Hindi',
    ja: 'Japanese',
    ko: 'Korean',
    pt: 'Portuguese',
    zh: 'Chinese',
  };
  return labels[language] ?? locale;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limit = Math.min(20, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || 10)));
  const query = cleanText(req.nextUrl.searchParams.get('topic') || req.nextUrl.searchParams.get('q') || '', 80);
  const targetLanguage = localeLabel(req);

  const [reddit, hn, news] = await Promise.all([
    loadRedditSignals(query),
    loadHackerNewsSignals(query),
    loadNewsSignals(req, query),
  ]);

  const signals = [...reddit, ...hn, ...news]
    .filter((signal) => matchesQuery(signal, query))
    .filter((signal) => signal.title && signal.url)
    .sort((a, b) => {
      const scoreA = a.score + a.commentCount * 1.75;
      const scoreB = b.score + b.commentCount * 1.75;
      return scoreB - scoreA || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const topics = signals.length
    ? signals.slice(0, limit).map((signal, index) => topicFromSignal(signal, index + 1, targetLanguage))
    : fallbackTopics(targetLanguage, query).slice(0, limit);

  return NextResponse.json(
    {
      ok: true,
      generatedAt: new Date().toISOString(),
      query: query || null,
      window: '24h',
      targetLanguage,
      coverageNote:
        'Pulse currently combines public Reddit JSON, Hacker News discussion metadata, and public news feeds where reachable. Future provider integrations can add X, Bluesky, YouTube, TikTok, Mastodon, and licensed social-listening feeds without changing the desktop app contract.',
      sourceCounts: {
        reddit: reddit.length,
        hackerNews: hn.length,
        news: news.length,
      },
      topics,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
