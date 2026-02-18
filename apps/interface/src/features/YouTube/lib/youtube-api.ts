// YouTube/lib/youtube-api.ts
// Client-side API for YouTube feature: fetches from the Next.js API route
import { YouTubeSearchResponse } from "@interface/features/YouTube/types/youtube-types";

// Search YouTube videos via the API route
export async function searchYouTubeApi(query: string): Promise<YouTubeSearchResponse> {
  const res = await fetch(`/api/youtube-search?query=${encodeURIComponent(query)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to search YouTube');
  }
  return data;
}

// Backwards-compatible named export expected by older tests/mocks
export const searchYouTube = searchYouTubeApi;

// Optionally, add more methods for other API endpoints as needed
