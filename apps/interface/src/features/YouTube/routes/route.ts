/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse, NextRequest } from 'next/server';

import { getLogger } from '@interface/lib/logger';

const logger = getLogger('YouTubeRoute');

const DEFAULT_INVIDIOUS_INSTANCE = 'https://vid.puffyan.us';

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
  videos: Array<{ videoId: string; title: string; description: string; thumbnail: string; channelTitle: string; publishedAt: string }>;
  totalResults: number;
}> {
  const base =
    (process.env.YOUTUBE_INVIDIOUS_INSTANCE ?? DEFAULT_INVIDIOUS_INSTANCE).replace(/\/$/, '');
  const url = `${base}/api/v1/search?q=${queryEnc}&type=video`;
  const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`Invidious search error: ${response.status}`);
  }
  const data = (await response.json()) as InvidiousVideoItem[];
  if (!Array.isArray(data)) {
    throw new Error('Invalid Invidious search response');
  }
  const videoItems = data.filter((item: InvidiousVideoItem) => item.type === 'video' && item.videoId);
  const videos = videoItems
    .slice(0, 5)
    .map(normalizeInvidiousToVideo)
    .filter((v) => v.videoId);
  return { videos, totalResults: videoItems.length };
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
  if (videos.length === 0) {
    return NextResponse.json({ error: 'No videos found' }, { status: 404 });
  }
  return NextResponse.json({
    videos,
    currentVideo: videos[0],
    totalResults,
    comments: []
  });
}

async function getViaYouTubeApi(query: string, apiKey: string) {
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=5&q=${query}&type=video&key=${apiKey}`,
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

  if (videos.length === 0) {
    return NextResponse.json({ error: 'No videos found' }, { status: 404 });
  }

  let comments: Array<{ author: string; text: string; publishedAt: string; likeCount: number }> = [];
  const firstVideoId = videos[0]?.videoId;
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
    videos,
    currentVideo: videos[0],
    totalResults: data.items.length,
    comments
  });
} 