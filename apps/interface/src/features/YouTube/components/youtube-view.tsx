/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
// Import name aligned with jest mock in tests (tests mock 'searchYouTube') and alias locally
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, Send, SkipBack, SkipForward, Sparkles } from 'lucide-react';
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
import type { YouTubeComment, YouTubeCuratorCue, YouTubeVideo, YouTubeViewProps } from '@interface/features/YouTube/types/youtube-types';
import { useLLMMessaging } from '@interface/lib/daily';
import { getClientLogger } from '@interface/lib/client-logger';
import { PixelatedLoader } from './PixelatedLoader';
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

type VjBubbleTone = 'news' | 'film' | 'mystery' | 'culture' | 'park' | 'comment';

interface VjBubble {
  id: number;
  text: string;
  tone: VjBubbleTone;
}

const PEARL_VJ_SUGGESTIONS: Array<{ label: string; query: string; tone: VjBubbleTone }> = [
  {
    label: 'World events, no fog machine',
    query: 'latest world events explained geopolitics analysis documentary 2026',
    tone: 'news',
  },
  {
    label: 'Hollywood production weirdness',
    query: 'movie production stories strange Hollywood history video essay',
    tone: 'film',
  },
  {
    label: 'True crime, clean timeline',
    query: 'thoughtful true crime documentary unsolved case analysis timeline',
    tone: 'mystery',
  },
  {
    label: 'Gossip with receipts',
    query: 'celebrity gossip explained media culture analysis receipts',
    tone: 'culture',
  },
  {
    label: 'Theme park ride drama',
    query: 'theme park vlog ride construction rumors Disney Universal analysis',
    tone: 'park',
  },
];

function decodeEntities(text: string): string {
  if (typeof window === 'undefined') {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

function cleanYouTubeText(text: unknown): string {
  if (typeof text !== 'string') return '';
  return decodeEntities(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

const YouTubeView = ({ query, assistantName }: YouTubeViewProps) => {
  const logger = getClientLogger('YouTubeView');
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
  const [comments, setComments] = useState<YouTubeComment[]>([]);
  const [curatorCue, setCuratorCue] = useState<YouTubeCuratorCue | null>(null);
  const [, setVjMessage] = useState('');
  const [vjBubbles, setVjBubbles] = useState<VjBubble[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [promptDraft, setPromptDraft] = useState('');
  const [, setCurating] = useState(false);
  const [vjControlsVisible, setVjControlsVisible] = useState(true);
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const normalVolume = useRef(70); // Store normal volume level
  const lastBubbleTextRef = useRef('');
  const commentCursorRef = useRef(0);
  const hideControlsTimerRef = useRef<number | null>(null);
  const controlsInteractingRef = useRef(false);

  const clearHideControlsTimer = useCallback(() => {
    if (hideControlsTimerRef.current !== null) {
      window.clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = null;
    }
  }, []);

  const revealVjControls = useCallback((delay = 2600) => {
    setVjControlsVisible(true);
    clearHideControlsTimer();

    if (controlsInteractingRef.current || promptInputRef.current === document.activeElement) {
      return;
    }

    hideControlsTimerRef.current = window.setTimeout(() => {
      setVjControlsVisible(false);
      hideControlsTimerRef.current = null;
    }, delay);
  }, [clearHideControlsTimer]);

  const hideVjControls = useCallback(() => {
    if (controlsInteractingRef.current || promptInputRef.current === document.activeElement) {
      return;
    }
    clearHideControlsTimer();
    setVjControlsVisible(false);
  }, [clearHideControlsTimer]);

  const addVjBubble = useCallback((tone: VjBubbleTone, text: string) => {
    const cleanText = cleanYouTubeText(text);
    if (!cleanText || cleanText === lastBubbleTextRef.current) return;
    lastBubbleTextRef.current = cleanText;
    setVjBubbles((prev) => [
      ...prev.slice(-2),
      {
        id: Date.now(),
        tone,
        text: cleanText,
      },
    ]);
  }, []);

  const buildVideoCommentary = useCallback((video: YouTubeVideo, videoComments: YouTubeComment[]) => {
    const comment = videoComments.find((item) => cleanYouTubeText(item.text));
    const cleanComment = cleanYouTubeText(comment?.text);
    if (comment) {
      return `Comments are already giving me a read on this: "${cleanComment.slice(0, 150)}"`;
    }
    if (video.channelTitle || video.publishedAt) {
      const date = video.publishedAt ? new Date(video.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      return `This one comes from ${video.channelTitle || 'the channel'}${date ? `, posted ${date}` : ''}. I am watching for the bit that explains why it travelled.`;
    }
    return 'This is the kind of clip I want in the channel: enough signal to stay interesting, easy enough to leave running.';
  }, []);

  // Shared search function used by both useEffect and event handler
  const performSearch = useCallback(async (searchQuery: string, cue?: YouTubeCuratorCue) => {
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
        setComments(data.comments || []);
        setCurrentVideoIndex(0);
        if (cue) setCuratorCue(cue);
        // Create comma-separated playlist of all video IDs
        const playlistIds = data.videos.map((v: YouTubeVideo) => v.videoId).join(',');
        setVideoData({
          videoId: data.currentVideo.videoId,
          title: data.currentVideo.title,
          embedUrl: `https://www.youtube.com/embed/${data.currentVideo.videoId}?autoplay=1&controls=0&playlist=${playlistIds}`
        });

        logger.info('YouTube video found', {
          title: data.currentVideo.title,
          videoId: data.currentVideo.videoId,
          queueLength: data.videos.length,
        });
        setVjMessage(buildVideoCommentary(data.currentVideo, data.comments || []));

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
          const commentsSummary = data.comments
            .map((c: any) => {
              const text = cleanYouTubeText(c.text);
              if (!text) return '';
              return `- "${text}" by ${cleanYouTubeText(c.author) || 'Unknown'}`;
            })
            .filter(Boolean)
            .join('\n');
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
        setComments(data.comments || []);
        if (cue) setCuratorCue(cue);
        setVideoData({
          videoId: fallbackVideo.videoId,
          title: fallbackVideo.title,
          embedUrl: `https://www.youtube.com/embed/${fallbackVideo.videoId}?autoplay=1&controls=0&playlist=${playlistIds}`
        });
        logger.info('YouTube video found (fallback)', {
          title: fallbackVideo.title,
          videoId: fallbackVideo.videoId,
          queueLength: data.videos.length,
        });
        setVjMessage(buildVideoCommentary(fallbackVideo, data.comments || []));
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
  }, [buildVideoCommentary, posthog, sendMessage]);

  const curateAndSearch = useCallback(async (request: string) => {
    try {
      setCurating(true);
      const cue = await youtubeApi.curateYouTubeCue({
        request,
        assistantName,
        currentTitle: videoData?.title,
      });
      setCuratorCue(cue);
      await performSearch(cue.query, cue);
    } catch (error) {
      logger.warn('Curator failed, falling back to direct YouTube search', { error });
      await performSearch(request || PEARL_VJ_SUGGESTIONS[4].query);
    } finally {
      setCurating(false);
    }
  }, [assistantName, logger, performSearch, videoData?.title]);

  useEffect(() => {
    if (query?.trim()) {
      performSearch(query);
      return;
    }
    setLoading(false);
    setCuratorCue(null);
    setVideoData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]); // Only trigger on query change, not on performSearch recreation

  // Load YouTube API and initialize player
  useEffect(() => {
    const loadYouTubeAPI = () => {
      // If YT API is fully ready, initialize immediately
      if (window.YT && window.YT.Player) {
        initializePlayer();
        return;
      }

      // Set callback BEFORE appending script to avoid race condition with cached scripts
      const previousCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (previousCallback) previousCallback();
        initializePlayer();
      };

      // Only append script if not already in DOM
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        document.body.appendChild(script);
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

        // Remove any existing orphan player divs before creating a new one
        const existingDivs = containerRef.current.querySelectorAll('[id^="youtube-player-"]');
        existingDivs.forEach((el) => el.parentNode?.removeChild(el));
        
        // Keep the YouTube iframe outside pointer handling; PearlOS owns the VJ controls.
        const playerWrapper = document.createElement('div');
        playerWrapper.id = `youtube-player-wrapper-${videoData.videoId}`;
        playerWrapper.style.position = 'absolute';
        playerWrapper.style.top = '0';
        playerWrapper.style.right = '0';
        playerWrapper.style.bottom = '0';
        playerWrapper.style.left = '0';
        playerWrapper.style.width = '100%';
        playerWrapper.style.pointerEvents = 'none';
        playerWrapper.style.borderRadius = '0.5rem 0.5rem 0 0';
        playerWrapper.style.overflow = 'hidden';

        // Create a div for the player with proper sizing
        const playerDiv = document.createElement('div');
        playerDiv.id = `youtube-player-${videoData.videoId}`;
        playerDiv.style.position = 'relative';
        playerDiv.style.width = '100%';
        playerDiv.style.height = '100%';
        playerDiv.style.pointerEvents = 'none';
        playerWrapper.appendChild(playerDiv);
        containerRef.current.appendChild(playerWrapper);

        try {
          playerRef.current = new window.YT.Player(playerDiv.id, {
            height: '100%',
            width: '100%',
            videoId: videoData.videoId,
            playerVars: {
              autoplay: 1,
              controls: 0,
              modestbranding: 1,
              rel: 0,
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
                        embedUrl: `https://www.youtube.com/embed/${nextVideo.videoId}?autoplay=1&controls=0&playlist=${playlistIds}`
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
      if (playerRef.current && playerRef.current.destroy) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      // Remove orphan player divs left behind by YouTube's destroy()
      if (containerRef.current) {
        const orphans = containerRef.current.querySelectorAll('[id^="youtube-player-"]');
        orphans.forEach((el) => el.parentNode?.removeChild(el));
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
          embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&controls=0&playlist=${playlistIds}`
        });
        setLoading(false);
        setError(false);
        setIsPlaying(true);
        setVjMessage(buildVideoCommentary(queue[0], comments));
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
  const playVideoAtIndex = (nextIndex: number) => {
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

    const normalizedIndex = ((nextIndex % videoQueue.length) + videoQueue.length) % videoQueue.length;
    const nextVideo = videoQueue[normalizedIndex];
    if (!nextVideo) return;

    setCurrentVideoIndex(normalizedIndex);
    const playlistIds = videoQueue.map((v: YouTubeVideo) => v.videoId).join(',');
    setVideoData({
      videoId: nextVideo.videoId,
      title: nextVideo.title,
      embedUrl: `https://www.youtube.com/embed/${nextVideo.videoId}?autoplay=1&controls=0&playlist=${playlistIds}`
    });

    if (playerRef.current && playerRef.current.loadVideoById) {
      playerRef.current.loadVideoById(nextVideo.videoId);
      setIsPlaying(true);
    }

    logger.info('Playing selected video', {
      title: nextVideo.title,
      index: normalizedIndex,
      total: videoQueue.length,
    });
    try {
      sendMessage({
        content: `Now playing: ${nextVideo.title} (${normalizedIndex + 1}/${videoQueue.length})`,
        role: 'system',
        mode: 'queued'
      });
    } catch (e) {
      // Session might be closed, ignore
    }
    setVjMessage(buildVideoCommentary(nextVideo, comments));
  };

  const playNextVideo = () => {
    playVideoAtIndex(currentVideoIndex + 1);
  };

  const playPreviousVideo = () => {
    playVideoAtIndex(currentVideoIndex - 1);
  };

  const togglePlayback = () => {
    if (!playerRef.current) return;
    if (isPlaying) {
      playerRef.current.pauseVideo?.();
      setIsPlaying(false);
      posthog?.capture('youtube_pause');
    } else {
      playerRef.current.playVideo?.();
      setIsPlaying(true);
      posthog?.capture('youtube_play');
    }
  };

  /*
    The previous implementation only exposed Skip in the VJ console. Keep the
    transport controls in PearlOS chrome because the embedded iframe has native
    YouTube controls disabled.
  */
  const queuePosition = videoQueue.length > 0 ? `${currentVideoIndex + 1}/${videoQueue.length}` : '0/0';

  const handlePromptSubmit = async (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const request = promptDraft.trim();
    if (!request) return;
    setPromptDraft('');
    setShowSuggestions(false);
    await curateAndSearch(request);
  };

  const handleCueClick = async (nextQuery: string) => {
    setShowSuggestions(false);
    await curateAndSearch(nextQuery);
  };

  const handleSuggestionClick = async (suggestion: (typeof PEARL_VJ_SUGGESTIONS)[number]) => {
    setShowSuggestions(false);
    await curateAndSearch(suggestion.query);
  };

  useEffect(() => {
    if (!videoData) return;
    commentCursorRef.current = 0;
    lastBubbleTextRef.current = '';
    addVjBubble('culture', `Now playing: ${cleanYouTubeText(videoData.title).slice(0, 120)}.`);
  }, [addVjBubble, videoData]);

  useEffect(() => {
    if (!videoData) return;
    const cleanComments = comments.map((comment) => cleanYouTubeText(comment.text)).filter(Boolean);
    if (!cleanComments.length) return;
    const interval = window.setInterval(() => {
      const seconds =
        playerRef.current && typeof playerRef.current.getCurrentTime === 'function'
          ? Number(playerRef.current.getCurrentTime())
          : 0;
      const index = commentCursorRef.current % cleanComments.length;
      commentCursorRef.current += 1;
      addVjBubble('comment', `${formatClock(seconds)} - "${cleanComments[index].slice(0, 130)}"`);
    }, 18000);
    return () => window.clearInterval(interval);
  }, [addVjBubble, comments, videoData]);

  useEffect(() => {
    (window as any).__ytComputeTargetVolume = computeTargetVolume;
    return () => { delete (window as any).__ytComputeTargetVolume; };
  }, []);

  useEffect(() => () => clearHideControlsTimer(), [clearHideControlsTimer]);

  // Note: Speech state test helpers removed - now managed by SpeechProvider context
  // Tests should mock useVoiceSessionContext hook instead of setting state directly

  return (
    <div 
      ref={containerRef}
      className={`yt-vj-root w-full h-full relative overflow-hidden ${vjControlsVisible ? 'yt-vj-root--active' : ''}`}
      style={{ backgroundColor: 'var(--theme-background)' }}
      onPointerMove={() => revealVjControls(2500)}
      onPointerDown={() => revealVjControls(3200)}
      onTouchStart={() => revealVjControls(4200)}
      onMouseLeave={hideVjControls}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: 'rgba(0,0,0,0.95)' }}>
          <PixelatedLoader />
        </div>
      )}
      {error || (!loading && !videoData) ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/90 text-center text-white">
          <div>
            <p className="text-sm text-white/80">{error ? 'Unable to load video' : 'Search YouTube'}</p>
            <p className="text-xs text-red-200/80">
              {error ? 'Try a different search below.' : 'Ask Pearl for a specific video or search below.'}
            </p>
          </div>
        </div>
      ) : null}

      <div className={`yt-vj-bubbles pointer-events-none absolute inset-x-3 bottom-4 z-[410] flex flex-col items-start gap-2 md:inset-x-5 ${vjControlsVisible ? 'yt-vj-bubbles--visible' : ''}`}>
        {vjBubbles.slice(-3).map((bubble) => (
          <div
            key={bubble.id}
            className={`yt-vj-bubble yt-vj-bubble--${bubble.tone} max-w-[min(34rem,92%)] px-3 py-2 text-xs leading-snug text-white shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2`}
          >
            {bubble.text}
          </div>
        ))}
      </div>

      <div
        className={`yt-vj-console pointer-events-auto absolute inset-x-3 top-12 z-[420] p-3 text-white shadow-2xl backdrop-blur-md md:inset-x-5 md:top-5 ${vjControlsVisible ? 'yt-vj-console--visible' : ''}`}
        onPointerEnter={() => {
          controlsInteractingRef.current = true;
          setVjControlsVisible(true);
          clearHideControlsTimer();
        }}
        onPointerLeave={() => {
          controlsInteractingRef.current = false;
          revealVjControls(1200);
        }}
        onFocusCapture={() => {
          controlsInteractingRef.current = true;
          setVjControlsVisible(true);
          clearHideControlsTimer();
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            controlsInteractingRef.current = false;
            revealVjControls(1200);
          }
        }}
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="yt-vj-title min-w-0">
            <Sparkles className="h-3.5 w-3.5" />
            <div>Pearl VJ</div>
          </div>
          <div className="yt-vj-transport flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={playPreviousVideo}
              className="yt-vj-icon-btn flex h-9 w-9 shrink-0 items-center justify-center"
              title="Previous"
              aria-label="Previous video"
            >
              <SkipBack className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={togglePlayback}
              className="yt-vj-icon-btn flex h-9 w-9 shrink-0 items-center justify-center"
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause video' : 'Play video'}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={playNextVideo}
              className="yt-vj-icon-btn flex h-9 w-9 shrink-0 items-center justify-center"
              title="Next"
              aria-label="Next video"
            >
              <SkipForward className="h-4 w-4" />
            </button>
            <span className="yt-vj-counter min-w-[2.75rem] text-center text-[11px] font-semibold text-white/70">
              {queuePosition}
            </span>
          </div>
        </div>
        {showSuggestions ? (
          <div className="yt-vj-presets mb-2 flex gap-1.5 overflow-x-auto pb-1" onScroll={() => revealVjControls(3000)}>
            {PEARL_VJ_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                onClick={() => void handleSuggestionClick(suggestion)}
                className={`yt-vj-preset yt-vj-preset--${suggestion.tone} shrink-0 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg`}
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        ) : curatorCue?.nextQueries?.length ? (
          <div className="yt-vj-presets mb-2 flex gap-1.5 overflow-x-auto pb-1" onScroll={() => revealVjControls(3000)}>
            {curatorCue.nextQueries.slice(0, 4).map((nextQuery) => (
              <button
                key={nextQuery}
                type="button"
                onClick={() => handleCueClick(nextQuery)}
                className="yt-vj-preset shrink-0 px-2.5 py-1 text-[11px] text-white/80"
              >
                {nextQuery}
              </button>
            ))}
          </div>
        ) : null}
        <form
          onSubmit={handlePromptSubmit}
          className="relative z-[430] flex items-center gap-2"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <input
            ref={promptInputRef}
            value={promptDraft}
            onChange={(event) => setPromptDraft(event.target.value)}
            onPointerDown={(event) => {
              event.stopPropagation();
              window.setTimeout(() => promptInputRef.current?.focus(), 0);
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            placeholder="Tell Pearl the vibe or ask for a specific video..."
            onFocus={() => {
              controlsInteractingRef.current = true;
              setVjControlsVisible(true);
              clearHideControlsTimer();
            }}
            onBlur={() => {
              controlsInteractingRef.current = false;
              revealVjControls(1600);
            }}
            className="yt-vj-input pointer-events-auto min-w-0 flex-1 px-3 py-2 text-sm text-white outline-none placeholder:text-white/50"
          />
          <button
            type="submit"
            disabled={!promptDraft.trim()}
            className="yt-vj-submit flex h-9 w-9 shrink-0 items-center justify-center disabled:cursor-not-allowed"
            title="Ask Pearl"
            aria-label="Ask Pearl"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
      {/* Player div is appended here by the YouTube IFrame API via containerRef */}
    </div>
  );
};

export default YouTubeView;
