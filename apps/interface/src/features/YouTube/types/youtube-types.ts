/**
 * YouTube Feature Types
 * Types for YouTube video search, playback, and integration
 */

export interface YouTubeVideo {
  videoId: string;
  title: string;
  description: string;
  thumbnail: string;
  channelTitle: string;
  publishedAt: string;
}

export interface YouTubeComment {
  author: string;
  text: string;
  publishedAt: string;
  likeCount: number;
}

export interface YouTubeSearchResponse {
  videos: YouTubeVideo[];
  currentVideo: YouTubeVideo;
  totalResults: number;
  comments: YouTubeComment[];
}

export interface YouTubeSearchRequest {
  query: string;
  maxResults?: number;
}

export interface YouTubeViewProps {
  query?: string;
  assistantName?: string;
}

export interface YouTubePlayerState {
  loading: boolean;
  videoData: {
    videoId: string;
    title: string;
    embedUrl: string;
  } | null;
  error: boolean;
  isUserSpeaking: boolean;
  isAssistantSpeaking: boolean;
  videoQueue: YouTubeVideo[];
  currentVideoIndex: number;
  isPlaying: boolean;
}

// YouTube API types
declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}
