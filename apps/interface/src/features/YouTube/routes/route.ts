/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse, NextRequest } from 'next/server';

import { getLogger } from '@interface/lib/logger';

const logger = getLogger('YouTubeRoute');

const DEFAULT_INVIDIOUS_INSTANCE = 'https://vid.puffyan.us';
const INVIDIOUS_FALLBACKS = [
  'https://inv.tux.pizza',
  'https://invidious.privacyredirect.com',
  'https://vid.puffyan.us',
];
const SEARCH_RESULT_LIMIT = 15;
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'for', 'from', 'in', 'me', 'of', 'on', 'or',
  'show', 'the', 'to', 'video', 'videos', 'with', 'youtube',
]);

/** Invidious search result item (video type). */
interface InvidiousVideoItem {
  type: string;
  title?: string;
  videoId?: string;
  description?: string;
  author?: string;
  published?: number;
  videoThumbnails?: Array< { url: string; quality?: string } >;
  [key: string]: unknown;
}

type SearchVideo = {
  videoId: string;
  title: string;
  description: string;
  thumbnail: string;
  channelTitle: string;
  publishedAt: string;
};

function decodeSearchQuery(query: string): string {
  try {
    return decodeURIComponent(query.replace(/\+/g, ' '));
  } catch {
    return query;
  }
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function scoreVideoForQuery(rawQuery: string, video: SearchVideo): number {
  const tokens = [...new Set(tokenize(rawQuery))];
  if (tokens.length === 0) return 0;
  const title = `${video.title || ''}`.toLowerCase();
  const description = `${video.description || ''}`.toLowerCase();
  const channel = `${video.channelTitle || ''}`.toLowerCase();
  const haystack = `${title} ${description} ${channel}`;
  let score = 0;

  for (const token of tokens) {
    if (title.includes(token)) score += 8;
    if (description.includes(token)) score += 3;
    if (channel.includes(token)) score += 1;
  }

  const compactQuery = rawQuery.toLowerCase().replace(/\s+/g, ' ').trim();
  if (compactQuery && title.includes(compactQuery)) score += 20;
  if (tokens.length >= 3 && tokens.every((token) => haystack.includes(token))) score += 12;

  const userAskedForLongform =
    /\b(movie|film|documentary|comedian|comedy|stand ?up|trailer|review|essay)\b/i.test(rawQuery);
  if (!userAskedForLongform && /\b(full movie|movie|official trailer|stand ?up|comedian|comedy special)\b/i.test(title)) {
    score -= 18;
  }
  if (/\b(kids?|children|school bus|bus)\b/i.test(rawQuery) && /\b(horror|true crime|stand ?up|comedian)\b/i.test(haystack)) {
    score -= 20;
  }

  return score;
}

function rankVideos(rawQuery: string, videos: SearchVideo[]): SearchVideo[] {
  const scored = videos.map((video, index) => ({
    video,
    index,
    score: scoreVideoForQuery(rawQuery, video),
  }));
  const hasPositiveSignal = scored.some((item) => item.score > 0);
  if (!hasPositiveSignal) return videos;
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.video);
}

function normalizeInvidiousToVideo(item: InvidiousVideoItem): {
  videoId: string;
  title: string;
  description: string;
  thumbnail: string;
  channelTitle: string;
  publishedAt: string;
} {
  const thumb = item.videoThumbnails?.[0]?.url ?? item.thumbnail ?? '';
  const publishedAt: string =
    typeof item.published === 'number'
      ? new Date(item.published * 1000).toISOString()
      : String(item.publishedText ?? '');
  return {
    videoId: item.videoId ?? '',
    title: item.title ?? '',
    description: item.description ?? '',
    thumbnail: typeof thumb === 'string' ? thumb : '',
    channelTitle: item.author ?? '',
    publishedAt
  };
}

async function searchViaInvidious(queryEnc: string): Promise<{
  videos: SearchVideo[];
  totalResults: number;
}> {
  const configuredInstance = process.env.YOUTUBE_INVIDIOUS_INSTANCE;
  const instances = configuredInstance
    ? [configuredInstance, ...INVIDIOUS_FALLBACKS]
    : INVIDIOUS_FALLBACKS;
  // Deduplicate
  const uniqueInstances = [...new Set(instances.map(i => i.replace(/\/$/, '')))];

  let lastError: Error | null = null;
  for (const base of uniqueInstances) {
    try {
      const url = `${base}/api/v1/search?q=${queryEnc}&type=video`;
      const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) });
      if (!response.ok) {
        lastError = new Error(`Invidious search error: ${response.status} from ${base}`);
        continue;
      }
      const data = (await response.json()) as InvidiousVideoItem[];
      if (!Array.isArray(data)) {
        lastError = new Error('Invalid Invidious search response');
        continue;
      }
      const videoItems = data.filter((item: InvidiousVideoItem) => item.type === 'video' && item.videoId);
      const videos = videoItems
        .slice(0, SEARCH_RESULT_LIMIT)
        .map(normalizeInvidiousToVideo)
        .filter((v) => v.videoId);
      return { videos, totalResults: videoItems.length };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      logger.warn(`Invidious instance ${base} failed`, { error: lastError.message });
    }
  }
  throw lastError || new Error('All Invidious instances failed');
}

export async function GET_impl(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawQuery = (searchParams.get('query') ?? '').trim();
  if (!rawQuery) {
    return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 });
  }
  const query = encodeURIComponent(rawQuery);

  const apiKey = process.env.YOUTUBE_API_KEY?.trim();

  try {
    if (apiKey) {
      return await getViaYouTubeApi(query, apiKey);
    }
    return await getViaInvidious(query);
  } catch (error) {
    logger.error('YouTube search error', { error });
    return NextResponse.json({ error: 'Failed to search YouTube' }, { status: 500 });
  }
}

async function getViaInvidious(query: string) {
  const { videos, totalResults } = await searchViaInvidious(query);
  const rankedVideos = rankVideos(decodeSearchQuery(query), videos).slice(0, 5);
  if (rankedVideos.length === 0) {
    return NextResponse.json({ error: 'No videos found' }, { status: 404 });
  }
  return NextResponse.json({
    videos: rankedVideos,
    currentVideo: rankedVideos[0],
    totalResults,
    comments: []
  });
}

async function getViaYouTubeApi(query: string, apiKey: string) {
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=${SEARCH_RESULT_LIMIT}&q=${query}&type=video&order=relevance&safeSearch=strict&videoEmbeddable=true&key=${apiKey}`,
    { method: 'GET' }
  );

  if (!response.ok) {
    throw new Error(`YouTube API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.items || data.items.length === 0) {
    return NextResponse.json({ error: 'No videos found' }, { status: 404 });
  }

  const videos = data.items
    .filter((item: any) => item.id?.videoId)
    .map((item: any) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnail: item.snippet.thumbnails?.default?.url ?? '',
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt
    }));
  const rankedVideos = rankVideos(decodeSearchQuery(query), videos).slice(0, 5);

  if (rankedVideos.length === 0) {
    return NextResponse.json({ error: 'No videos found' }, { status: 404 });
  }

  let comments: Array<{ author: string; text: string; publishedAt: string; likeCount: number }> = [];
  const firstVideoId = rankedVideos[0]?.videoId;
  if (firstVideoId) {
    try {
      const commentsResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${firstVideoId}&order=relevance&maxResults=10&key=${apiKey}`
      );
      if (commentsResponse.ok) {
        const commentsData = await commentsResponse.json();
        comments = (commentsData.items ?? []).map((item: any) => ({
          author: item.snippet?.topLevelComment?.snippet?.authorDisplayName ?? '',
          text: item.snippet?.topLevelComment?.snippet?.textDisplay ?? '',
          publishedAt: item.snippet?.topLevelComment?.snippet?.publishedAt ?? '',
          likeCount: item.snippet?.topLevelComment?.snippet?.likeCount ?? 0
        }));
      }
    } catch (commentError) {
      logger.warn('Could not fetch comments', { error: commentError });
    }
  }

  return NextResponse.json({
    videos: rankedVideos,
    currentVideo: rankedVideos[0],
    totalResults: data.items.length,
    comments
  });
}
