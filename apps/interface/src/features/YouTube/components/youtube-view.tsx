/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
// Import name aligned with jest mock in tests (tests mock 'searchYouTube') and alias locally
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePostHog } from 'posthog-js/react';

// Import styles for content animations
import '@interface/features/YouTube/styles/youtube.css';

import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import {
  NIA_EVENT_YOUTUBE_NEXT,
  NIA_EVENT_YOUTUBE_PAUSE,
  NIA_EVENT_YOUTUBE_PLAY,
} from '@interface/features/DailyCall/events/niaEventRouter';
import * as youtubeApi from '@interface/features/YouTube/lib/youtube-api';
import type { YouTubeVideo, YouTubeViewProps } from '@interface/features/YouTube/types/youtube-types';
import { useLLMMessaging } from '@interface/lib/daily';
import { getClientLogger } from '@interface/lib/client-logger';
import { useAssistantTheme } from '@interface/theme/AssistantThemeContext';
import { PixelatedLoader, PixelatedLoaderInline } from './PixelatedLoader';
/**
 * YouTube Video Player with Smart Volume Control
 * 
 * Features:
 * - Automatically lowers volume to 30% when user speaks
 * - Automatically lowers volume to 30% when Nia (assistant) speaks  
 * - Restores normal volume (70%) when no one is speaking
 * - Uses YouTube Player API for programmatic volume control
 * - Multiple detection methods for robust speech recognition
 * - sends comments to assistant to help with context
 * Volume Control Methods:
 * 1. User Speech: LLM 'speech-start' and 'speech-end' events
 * 2. Assistant Speech: Multiple detection approaches:
 *    - 'speech-update' messages from LLM
 *    - Assistant message content analysis with duration estimation
 *    - Assistant transcript messages
 *    - Audio level monitoring (high levels indicate speech)
 */

// Pure helper to derive target volume given states (exported for tests via window & direct import)
export function computeTargetVolume(base: number, userSpeaking: boolean, assistantSpeaking: boolean) {
  if (userSpeaking || assistantSpeaking) return Math.round(base * 0.2);
  return base;
}

const YouTubeView = ({ query, assistantName }: YouTubeViewProps) => {
  const logger = getClientLogger('YouTubeView');
  const { tokens } = useAssistantTheme();
  const { sendMessage } = useLLMMessaging();
  const posthog = usePostHog();
  const { isUserSpeaking, isAssistantSpeaking } = useVoiceSessionContext(); // Get speech state from context
  const [loading, setLoading] = useState(true);
  const [videoData, setVideoData] = useState<{
    videoId: string;
    title: string;
    embedUrl: string;
  } | null>(null);
  const [error, setError] = useState(false);
  const [videoQueue, setVideoQueue] = useState<YouTubeVideo[]>([]);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const normalVolume = useRef(70); // Store normal volume level

  // Shared search function used by both useEffect and event handler
  const performSearch = useCallback(async (searchQuery: string) => {
    try {
      setLoading(true);
      setError(false);

      logger.info('Searching YouTube', { query: searchQuery });
      posthog?.capture('youtube_search', { query: searchQuery });
      const searchFn: any = (youtubeApi as any).searchYouTube || (youtubeApi as any).searchYouTubeApi;
      if (typeof searchFn !== 'function') {
        logger.error('YouTube search function not available');
        setError(true);
        setLoading(false);
        return;
      }
      const data = await searchFn(searchQuery);

      // Handle new API response format with multiple videos
      if (data.videos && data.currentVideo) {
        setVideoQueue(data.videos);
        setCurrentVideoIndex(0);
        // Create comma-separated playlist of all video IDs
        const playlistIds = data.videos.map((v: YouTubeVideo) => v.videoId).join(',');
        setVideoData({
          videoId: data.currentVideo.videoId,
          title: data.currentVideo.title,
          embedUrl: `https://www.youtube.com/embed/${data.currentVideo.videoId}?autoplay=1&controls=1&playlist=${playlistIds}`
        });

        logger.info('YouTube video found', {
          title: data.currentVideo.title,
          videoId: data.currentVideo.videoId,
          queueLength: data.videos.length,
        });

        // Send success message back to assistant (only if session is active)
        try {
          sendMessage({
            content: `Now playing: ${data.currentVideo.title}. Found ${data.videos.length} videos in queue.`,
            role: 'system',
            mode: 'queued'
          });
        } catch (e) {
          // Session might be closed, ignore
        }

        // Send comment summary to assistant for context
        if (data.comments && data.comments.length > 0) {
          const commentsSummary = data.comments.map((c: any) => `- "${c.text}" by ${c.author || 'Unknown'}`).join('\n');
          const systemMessage = `Here's a summary of what people are saying in the comments for "${data.currentVideo.title}":\n${commentsSummary}`;
          try {
            sendMessage({
              content: systemMessage,
              role: 'system',
              mode: 'queued'
            });
          } catch (e) {
            // Session might be closed, ignore
          }
        }
      } else if (data && Array.isArray(data.videos) && data.videos.length > 0) {
        // Fallback for old API format: use the first video in the array
        const fallbackVideo = data.videos[0];
        const playlistIds = data.videos.map((v: YouTubeVideo) => v.videoId).join(',');
        setVideoQueue(data.videos);
        setVideoData({
          videoId: fallbackVideo.videoId,
          title: fallbackVideo.title,
          embedUrl: `https://www.youtube.com/embed/${fallbackVideo.videoId}?autoplay=1&controls=1&playlist=${playlistIds}`
        });
        logger.info('YouTube video found (fallback)', {
          title: fallbackVideo.title,
          videoId: fallbackVideo.videoId,
          queueLength: data.videos.length,
        });
        try {
          sendMessage({
            content: `Now playing: ${fallbackVideo.title}`,
            role: 'system',
            mode: 'queued'
          });
        } catch (e) {
          // Session might be closed, ignore
        }
      }

    } catch (error) {
      if (error instanceof Error && /no videos found/i.test(error.message)) {
        logger.info('YouTube search returned no results', { query: searchQuery });
        setError(false);
        return;
      }
      logger.error('YouTube search error', { error });
      setError(true);
      try {
        sendMessage({
          content: 'Sorry, I could not find that video on YouTube.',
          role: 'system',
          mode: 'queued'
        });
      } catch (e) {
        // Session might be closed, ignore
      }
    } finally {
      setLoading(false);
    }
  }, [sendMessage]);

  useEffect(() => {
    if (!query) return;
    performSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]); // Only trigger on query change, not on performSearch recreation

  // Load YouTube API and initialize player
  useEffect(() => {
    const loadYouTubeAPI = () => {
      // Load YouTube API if not already loaded
      if (!window.YT) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        document.body.appendChild(script);

        window.onYouTubeIframeAPIReady = () => {
          initializePlayer();
        };
      } else {
        initializePlayer();
      }
    };

    const initializePlayer = () => {
      if (videoData && containerRef.current && !playerRef.current) {
        // Validate videoId before attempting to create player
        if (!videoData.videoId || typeof videoData.videoId !== 'string' || videoData.videoId.trim() === '') {
          logger.error('Invalid videoId', { videoId: videoData.videoId });
          setError(true);
          return;
        }

        logger.info('Initializing YouTube player', { videoId: videoData.videoId });
        
        // Create a div for the player
        const playerDiv = document.createElement('div');
        playerDiv.id = `youtube-player-${videoData.videoId}`;
        containerRef.current.appendChild(playerDiv);

        try {
          playerRef.current = new window.YT.Player(playerDiv.id, {
            height: '100%',
            width: '100%',
            videoId: videoData.videoId,
            playerVars: {
              autoplay: 1,
              controls: 1,
              playlist: videoData.embedUrl.split('playlist=')[1]?.split('&')[0] || videoData.videoId,
              enablejsapi: 1,
              origin: window.location.origin
            },
            events: {
              onReady: (event: any) => {
                logger.info('YouTube player ready');
                event.target.setVolume(normalVolume.current);
                const initialVol = computeTargetVolume(normalVolume.current, isUserSpeaking, isAssistantSpeaking);
                window.dispatchEvent(new CustomEvent('youtube.volume.change', { detail: { targetVolume: initialVol, user: isUserSpeaking, assistant: isAssistantSpeaking } }));
                // Explicitly start playback to ensure autoplay works
                event.target.playVideo();
              },
              onStateChange: (event: any) => {
                logger.debug('YouTube player state changed', { state: event.data });
                
                // Sync our currentVideoIndex with YouTube's actual playlist position
                if (playerRef.current && playerRef.current.getPlaylistIndex) {
                  const youtubeIndex = playerRef.current.getPlaylistIndex();
                  if (youtubeIndex !== -1 && youtubeIndex !== currentVideoIndex) {
                    setCurrentVideoIndex(youtubeIndex);
                  }
                }
              },
              onError: (event: any) => {
                logger.error('YouTube player error', { error: event.data });
                // Error codes: 2 = invalid video ID, 100/101/150 = video unavailable/restricted
                if (event.data === 2 || event.data === 100 || event.data === 101 || event.data === 150) {
                  // Try to play next video in queue
                  if (videoQueue.length > 1) {
                    logger.warn('Video unavailable, trying next in queue');
                    try {
                      sendMessage({
                        content: `This video is unavailable. Trying next video in queue...`,
                        role: 'system',
                        mode: 'queued'
                      });
                    } catch (err) {
                      logger.debug('Could not send unavailable message (session may be closed)', { error: err });
                    }
                    // Remove the current video from the queue
                    const newQueue = videoQueue.filter((_, index) => index !== currentVideoIndex);
                    setVideoQueue(newQueue);
                    // Play the next video (which is now at the current index in the new queue)
                    if (newQueue.length > 0) {
                      const nextVideo = newQueue[0];
                      const playlistIds = newQueue.map((v: YouTubeVideo) => v.videoId).join(',');
                      setCurrentVideoIndex(0);
                      setVideoData({
                        videoId: nextVideo.videoId,
                        title: nextVideo.title,
                        embedUrl: `https://www.youtube.com/embed/${nextVideo.videoId}?autoplay=1&controls=1&playlist=${playlistIds}`
                      });
                    } else {
                      setError(true);
                    }
                  } else {
                    setError(true);
                  }
                } else {
                  setError(true);
                }
              }
            }
          });
        } catch (err) {
          logger.error('Failed to initialize YouTube player', { error: err });
          setError(true);
          // Remove the player div if initialization failed
          if (playerDiv && playerDiv.parentNode) {
            playerDiv.parentNode.removeChild(playerDiv);
          }
        }
      }
    };

    if (videoData && !error) {
      loadYouTubeAPI();
    }

    return () => {
      // Cleanup player when component unmounts or video changes
      if (playerRef.current && playerRef.current.destroy) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [videoData]);

  // Handle volume control based on speech states
  useEffect(() => {
    if (playerRef.current && playerRef.current.setVolume) {
      const targetVolume = computeTargetVolume(normalVolume.current, isUserSpeaking, isAssistantSpeaking);
      playerRef.current.setVolume(targetVolume);
      window.dispatchEvent(new CustomEvent('youtube.volume.change', { detail: { targetVolume, user: isUserSpeaking, assistant: isAssistantSpeaking } }));
    }
  }, [isUserSpeaking, isAssistantSpeaking]);

  // Speech state is now managed by SpeechProvider via Pipecat bot events
  // No need for local event listeners - context tracks speaking state automatically

  // Bridge bot YouTube events to youtubeControl
  useEffect(() => {
    const handleYouTubePlay = (e: Event) => {
      const evt = e as CustomEvent;
      const detail = (evt && (evt as any).detail) || {};
      const payload = detail.payload || {};
      const videoId = payload.videoId as string;
      const queue = payload.queue as YouTubeVideo[];
      const title = payload.title as string;
      
      logger.info('Bot event: YouTube play', {
        videoId,
        queueLength: queue?.length,
        title,
      });
      
      // If we have a queue from the bot, use it directly (from search results)
      if (queue && queue.length > 0 && videoId) {
        setVideoQueue(queue);
        const playlistIds = queue.map((v: YouTubeVideo) => v.videoId).join(',');
        setCurrentVideoIndex(0);
        setVideoData({
          videoId: videoId,
          title: title || queue[0].title,
          embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1&playlist=${playlistIds}`
        });
        setLoading(false);
        setError(false);
        setIsPlaying(true);
        return;
      }
      
      // Otherwise dispatch play control (resume or play specific video)
      window.dispatchEvent(
        new CustomEvent('youtubeControl', {
          detail: { action: 'play', videoId },
        })
      );
    };

    const handleYouTubePause = () => {
      logger.info('Bot event: YouTube pause');
      window.dispatchEvent(
        new CustomEvent('youtubeControl', {
          detail: { action: 'pause' },
        })
      );
    };

    const handleYouTubeNext = () => {
      logger.info('Bot event: YouTube next');
      window.dispatchEvent(
        new CustomEvent('youtubeControl', {
          detail: { action: 'next' },
        })
      );
    };

    window.addEventListener(NIA_EVENT_YOUTUBE_PLAY, handleYouTubePlay as EventListener);
    window.addEventListener(NIA_EVENT_YOUTUBE_PAUSE, handleYouTubePause as EventListener);
    window.addEventListener(NIA_EVENT_YOUTUBE_NEXT, handleYouTubeNext as EventListener);

    return () => {
      window.removeEventListener(NIA_EVENT_YOUTUBE_PLAY, handleYouTubePlay as EventListener);
      window.removeEventListener(NIA_EVENT_YOUTUBE_PAUSE, handleYouTubePause as EventListener);
      window.removeEventListener(NIA_EVENT_YOUTUBE_NEXT, handleYouTubeNext as EventListener);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendMessage]);

  // Listen for YouTube control events from browser-window
  useEffect(() => {
    const handleYouTubeControl = (event: any) => {
      const { action } = event.detail;
      logger.info('YouTube control received', { action });

      if (!playerRef.current) {
        logger.warn('Player not ready for control');
        return;
      }

      switch (action) {
        case 'pause':
          playerRef.current.pauseVideo();
          setIsPlaying(false);
          posthog?.capture('youtube_pause');
          logger.info('Video paused');
          break;
          
        case 'play':
          playerRef.current.playVideo();
          setIsPlaying(true);
          posthog?.capture('youtube_play');
          logger.info('Video resumed');
          break;
          
        case 'next':
          posthog?.capture('youtube_next');
          playNextVideo();
          break;
          
        default:
          logger.warn('Unknown YouTube control action', { action });
      }
    };

    window.addEventListener('youtubeControl', handleYouTubeControl);

    return () => {
      window.removeEventListener('youtubeControl', handleYouTubeControl);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps  
  }, [videoQueue, currentVideoIndex]);

  // Function to play next video in queue
  const playNextVideo = () => {
    if (videoQueue.length === 0) {
      logger.info('No videos in queue');
      try {
        sendMessage({
          content: 'No more videos in the queue.',
          role: 'system',
          mode: 'queued'
        });
      } catch (e) {
        // Session might be closed, ignore
      }
      return;
    }

    const nextIndex = (currentVideoIndex + 1) % videoQueue.length;
    const nextVideo = videoQueue[nextIndex];
    
    if (nextVideo) {
      setCurrentVideoIndex(nextIndex);
      const playlistIds = videoQueue.map((v: YouTubeVideo) => v.videoId).join(',');
      setVideoData({
        videoId: nextVideo.videoId,
        title: nextVideo.title,
        embedUrl: `https://www.youtube.com/embed/${nextVideo.videoId}?autoplay=1&controls=1&playlist=${playlistIds}`
      });

      // Update the player with new video
      if (playerRef.current && playerRef.current.loadVideoById) {
        playerRef.current.loadVideoById(nextVideo.videoId);
        setIsPlaying(true);
      }

        logger.info('Playing next video', {
          title: nextVideo.title,
          index: nextIndex,
          total: videoQueue.length,
        });
      try {
        sendMessage({
          content: `Now playing next video: ${nextVideo.title} (${nextIndex + 1}/${videoQueue.length})`,
          role: 'system',
          mode: 'queued'
        });
      } catch (e) {
        // Session might be closed, ignore
      }
    }
  };

  useEffect(() => {
    (window as any).__ytComputeTargetVolume = computeTargetVolume;
    return () => { delete (window as any).__ytComputeTargetVolume; };
  }, []);

  // Note: Speech state test helpers removed - now managed by SpeechProvider context
  // Tests should mock useVoiceSessionContext hook instead of setting state directly

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--theme-text-secondary)' }}>
        <PixelatedLoaderInline />
      </div>
    );
  }

  if (error || !videoData) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--theme-text-secondary)' }}>
        <div className="text-center">
          <p className="" style={{ color: 'var(--theme-text-secondary)' }}>Unable to load video</p>
          <p className="text-sm" style={{ color: 'var(--theme-text-accent)' }}>Please try a different search</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="w-full h-full relative"
      style={{ backgroundColor: 'var(--theme-background)' }}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: 'rgba(0,0,0,0.95)' }}>
          <PixelatedLoader />
        </div>
      )}
  <div className="absolute inset-0 w-full h-full rounded-t-lg overflow-hidden pointer-events-none">
        {/* Player container - YouTube API will create iframe here */}
      </div>
    </div>
  );
};

export default YouTubeView;