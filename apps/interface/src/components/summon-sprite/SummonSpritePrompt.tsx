'use client';

import { isFeatureEnabled } from '@nia/features';
import { useSession } from 'next-auth/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import SpriteBotConfigPanel from './SpriteBotConfigPanel';
import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { NIA_EVENT_SPRITE_OPEN } from '@interface/features/DailyCall/events/niaEventRouter';
import { useToast } from '@interface/hooks/use-toast';
import { trackSessionHistory } from '@interface/lib/session-history';
import { MessageTypeEnum, MessageRoleEnum } from '@interface/types/conversation.types';

import { useSpriteState } from './useSpriteState';
import { useSpriteSound } from './useSpriteSound';
import SpriteStage from './SpriteStage';
import SpriteBubble from './SpriteBubble';
import './sprite-animations.css';

type ImageResult = {
    url: string;
    filename?: string;
    subfolder?: string;
    type?: string;
};

type ApiResponse =
    | { error: string; details?: string; promptId?: string }
    | {
          promptId: string;
          animationPromptId?: string;
          sourceImage?: ImageResult;
          gif?: ImageResult;
          images?: ImageResult[];
          spriteId?: string; // Prism record ID if sprite was persisted
          spriteName?: string; // Generated display name for the sprite
          voiceProvider?: string; // Voice provider for this sprite (from server)
          voiceId?: string; // Voice ID for this sprite (from server)
      };

type ChatResponse = { reply: string } | { error: string; details?: string };

const DEFAULT_PROMPT = 'panda doctor';
const DEFAULT_BUBBLE_LINE = 'Ready to help—just say the word.';

type SummonLifecycleStatus = 'success' | 'cancelled' | 'error';
type SummonLifecycleDetail = {
    prompt: string;
    requestId: string;
    status?: SummonLifecycleStatus;
};

const createSummonRequestId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const dispatchSummonLifecycleEvent = (eventName: 'sprite.summon.start' | 'sprite.summon.stop', detail: SummonLifecycleDetail) => {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
};

type LastSpriteCache = {
    prompt: string;
    gif: ImageResult | null;
    sourceImage: ImageResult | null;
    spriteId: string | null;
    spriteName: string | null;
    voiceProvider: string;
    voiceId: string;
};

// Saved sprite from Prism (simplified for list view)
type SavedSprite = {
    _id: string;
    name: string;
    description?: string;
    originalRequest?: string;
    hasGif: boolean;
    isShared?: boolean;
    createdAt: string;
    updatedAt: string;
};

// Full sprite data when recalled from Prism
type FullSavedSprite = {
    _id: string;
    name: string;
    description?: string;
    originalRequest?: string;
    isShared?: boolean;
    gifData?: string;
    gifMimeType?: string;
    primaryPrompt?: string;
    voiceProvider?: string;
    voiceId?: string;
    botConfig?: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
};

// In-memory cache for the current browser session (clears on page reload)
let lastSpriteMemory: LastSpriteCache | null = null;

interface SummonSpritePromptProps {
    /** Tenant ID for admin API calls - required for sending text to bot during voice sessions */
    tenantId?: string;
    supportedFeatures?: string[];
}

export default function SummonSpritePrompt({ tenantId, supportedFeatures }: SummonSpritePromptProps) {
    // Early return if feature is disabled
    if (!isFeatureEnabled('summonSpriteTool', supportedFeatures)) {
        return null;
    }

    // Get user session for userName in text attribution
    const { data: session } = useSession();
    const userName = session?.user?.name || session?.user?.email || 'User';

    // Toast notifications
    const { toast } = useToast();

    // Voice session context for transcript access and sending text to bot
    const { 
        callStatus,
        roomUrl,
        toggleCall,
        enableSpriteVoice,
        disableSpriteVoice,
        messages,
        activeTranscript,
        activeSpriteId,
        activeSpriteVoice,
        spriteStartedSession,
        setSpriteStartedSession,
        setMessages,
        setActiveTranscript,
        isAssistantSpeaking,
    } = useVoiceSessionContext();
    
    const isVoiceActive = callStatus === 'active';

    // Track previous speaking state to detect new speaking turns
    const wasAssistantSpeakingRef = useRef(false);

    // Clear transcript messages when bot starts a new speaking turn
    // This ensures the bubble shows only the current response, not accumulated conversation
    useEffect(() => {
        if (isAssistantSpeaking && !wasAssistantSpeakingRef.current && activeSpriteVoice) {
            // Bot just started speaking a new turn - clear previous transcripts
            setMessages([]);
            setActiveTranscript(null);
        }
        wasAssistantSpeakingRef.current = isAssistantSpeaking;
    }, [isAssistantSpeaking, activeSpriteVoice, setMessages, setActiveTranscript]);

    const [open, setOpen] = useState(false);
    const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
    const [isMobile, setIsMobile] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);

    // Audio ref for magicbell sound (click-to-talk feedback)
    const magicBellRef = useRef<HTMLAudioElement | null>(null);
    const summonAbortControllerRef = useRef<AbortController | null>(null);
    const recallAbortControllerRef = useRef<AbortController | null>(null);
    const summonLifecycleRef = useRef<SummonLifecycleDetail | null>(null);

    // Initialize audio element on mount (avoids re-creating on each play)
    useEffect(() => {
        magicBellRef.current = new Audio('/sounds/magicbell.wav');
        magicBellRef.current.preload = 'auto';
        return () => {
            magicBellRef.current = null;
        };
    }, []);

    // Detect mobile screen size for toggle behavior
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768); // md breakpoint
        };
        
        checkMobile();
        window.addEventListener('resize', checkMobile);
        
        return () => {
            window.removeEventListener('resize', checkMobile);
        };
    }, []);

    /**
     * Play the magic bell sound effect for voice activation feedback
     */
    const playMagicBell = useCallback(() => {
        if (magicBellRef.current) {
            magicBellRef.current.currentTime = 0;
            magicBellRef.current.play().catch(err => {
                // eslint-disable-next-line no-console
                console.warn('[SummonSpritePrompt] Audio play failed:', err);
            });
        }
    }, []);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [gif, setGif] = useState<ImageResult | null>(null);
    const [sourceImage, setSourceImage] = useState<ImageResult | null>(null);
    const [spriteId, setSpriteId] = useState<string | null>(null);
    // Sprite display name (used as persona name for voice sessions)
    const [spriteName, setSpriteName] = useState<string | null>(null);
    // Voice configuration for the current sprite (Kokoro voice settings)
    const [spriteVoiceProvider, setSpriteVoiceProvider] = useState<string>('pocket');
    const [spriteVoiceId, setSpriteVoiceId] = useState<string>('am_fenrir');
    const [bubbleLine, setBubbleLine] = useState(DEFAULT_BUBBLE_LINE);
    const [chatInput, setChatInput] = useState('');
    const [chatLoading, setChatLoading] = useState(false);
    const [chatError, setChatError] = useState<string | null>(null);
    const [lastSprite, setLastSprite] = useState<LastSpriteCache | null>(null);
    const [deletingSpriteId, setDeletingSpriteId] = useState<string | null>(null);
    const [shareLoading, setShareLoading] = useState(false);
    const [spriteIsShared, setSpriteIsShared] = useState(false);
    const [showBotConfig, setShowBotConfig] = useState(false);
    const [spriteBotConfig, setSpriteBotConfig] = useState<Record<string, unknown> | null>(null);
    
    // Saved sprites from Prism (persisted across sessions)
    const [savedSprites, setSavedSprites] = useState<SavedSprite[]>([]);
    const [savedSpritesLoading, setSavedSpritesLoading] = useState(false);
    const [recallDropdownOpen, setRecallDropdownOpen] = useState(false);
    const recallDropdownRef = useRef<HTMLDivElement | null>(null);
    const dialogRef = useRef<HTMLDivElement | null>(null);

    // ═══ Wonder Layer hooks ═══
    const hasSprite = !!(gif || sourceImage);
    const { state: spriteAnimState, triggerDismiss } = useSpriteState({
      isVoiceActive,
      isAssistantSpeaking,
      isLoading: loading || chatLoading,
      hasSprite,
      activeSpriteVoice: !!activeSpriteVoice,
    });
    const { playBloop, playSparkle, playDismiss, playSummonChime } = useSpriteSound();

    // Play sounds on state transitions
    useEffect(() => {
        if (spriteAnimState === 'summoning') playSummonChime();
    }, [spriteAnimState, playSummonChime]);

    useEffect(() => {
        if (!recallDropdownOpen) return;
        
        const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node | null;
            if (target && recallDropdownRef.current && !recallDropdownRef.current.contains(target)) {
                setRecallDropdownOpen(false);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        document.addEventListener('touchstart', handleOutsideClick);

        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
            document.removeEventListener('touchstart', handleOutsideClick);
        };
    }, [recallDropdownOpen]);

    // Collapse dialog when clicking outside on mobile
    useEffect(() => {
        if (!open || !isMobile || isCollapsed) return;
        
        const handleClickOutside = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node | null;
            if (target && dialogRef.current && !dialogRef.current.contains(target)) {
                // Collapse the dialog when clicking outside
                setIsCollapsed(true);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [open, isMobile, isCollapsed]);

    /**
     * Displayed text in the chat bubble - shows bot voice transcripts when sprite voice is active,
     * otherwise falls back to the static bubbleLine state.
     */
    const displayedBubbleLine = useMemo(() => {
        // When sprite voice is active and we have voice transcripts, show them
        if (activeSpriteVoice && isVoiceActive) {
            // First check for real-time partial transcript (assistant speaking)
            if (activeTranscript && activeTranscript.role === MessageRoleEnum.ASSISTANT && activeTranscript.transcript) {
                return `🎤 ${activeTranscript.transcript}`;
            }
            
            // Otherwise show the last assistant message from transcripts
            if (messages && messages.length > 0) {
                // Find the most recent assistant transcript message
                for (let i = messages.length - 1; i >= 0; i--) {
                    const msg = messages[i];
                    // Only handle TranscriptMessage type which has role and transcript
                    if (msg.type === MessageTypeEnum.TRANSCRIPT && msg.role === MessageRoleEnum.ASSISTANT && msg.transcript) {
                        // Show full transcript - bubble expands to fit
                        return msg.transcript;
                    }
                }
            }
        }
        
        // Fall back to static bubble line
        return bubbleLine;
    }, [activeSpriteVoice, isVoiceActive, activeTranscript, messages, bubbleLine]);

    /**
     * Click-to-talk handler: clicking Sprite GIF toggles voice
     * - If sprite voice active: disable sprite voice, end session if sprite started it
     * - If voice inactive: play magicbell, start voice session, mark spriteStartedSession
     * - If voice active but sprite not: play magicbell, mark sprite as voice-active (session continues)
     */
    const handleSpriteClick = useCallback(() => {
        // eslint-disable-next-line no-console
        console.log('[SummonSpritePrompt] Sprite clicked, isVoiceActive:', isVoiceActive, 'activeSpriteVoice:', activeSpriteVoice, 'activeSpriteId:', activeSpriteId, 'spriteId:', spriteId, 'spriteStartedSession:', spriteStartedSession);
        
        // Check feature flag for sprite voice interactions
        if (!isFeatureEnabled('spriteVoice', supportedFeatures)) {
            // eslint-disable-next-line no-console
            console.log('[SummonSpritePrompt] Sprite voice disabled by feature flag. Interaction restricted to text/LLM.');
            return;
        }

        // If ANY sprite voice is active and user clicks sprite, end the sprite voice session
        // This is the primary way to exit sprite voice mode
        if (activeSpriteVoice && isVoiceActive) {
            // Check if sprite started the session (no prior OS session)
            if (spriteStartedSession) {
                // Sprite started the session — end the entire voice session
                // eslint-disable-next-line no-console
                console.log('[SummonSpritePrompt] Sprite started session, ending voice session');
                disableSpriteVoice(); // Clear sprite state first
                setSpriteStartedSession(false); // Clear the flag
                if (toggleCall) {
                    toggleCall(); // End the voice session (no magic bell - toggleCall plays close sound)
                }
            } else {
                // OS session was already active — just restore OS personality, keep session
                // eslint-disable-next-line no-console
                console.log('[SummonSpritePrompt] OS session was active, restoring OS personality (keeping voice session)');
                disableSpriteVoice(); // This sends updateBotConfig to restore OS personality
                // Play a subtle sound to indicate transition back to OS
                playMagicBell();
            }
            return;
        }
        
        // Clear prior transcripts so the sprite bubble doesn't show the last OS response
        setMessages([]);
        setActiveTranscript(null);

        // Play magic bell only when activating the voice session
        playMagicBell();
        
        // Determine if this is a new session (sprite starting it) vs takeover (sprite joining existing OS session)
        // If isVoiceActive is true, this is a takeover and we want the sprite to greet
        // If isVoiceActive is false, this is a new session and the sprite will naturally greet from its prompt
        const isNewSession = !isVoiceActive;
        
        // IMPORTANT: Enable sprite voice BEFORE starting the call
        // This sets the pending sprite config that will be used in the /join request
        // Pass isNewSession so the greeting is only sent on takeover, not on fresh sessions
        // Pass spriteName so the bot's persona name is set to the sprite's name
        if (spriteId && spriteVoiceId) {
            enableSpriteVoice(spriteId, {
                voiceProvider: spriteVoiceProvider,
                voiceId: spriteVoiceId,
            }, isNewSession, spriteName ?? undefined, tenantId, spriteBotConfig);
        } else {
            // eslint-disable-next-line no-console
            console.warn('[SummonSpritePrompt] Cannot enable sprite voice: no spriteId or voiceId available');
        }
        
        if (!isVoiceActive && toggleCall) {
            // Start new voice session (like bell button click) — sprite is initiating it
            // eslint-disable-next-line no-console
            console.log('[SummonSpritePrompt] Starting voice session via toggleCall (sprite-initiated)');
            setSpriteStartedSession(true); // Track that sprite started this session
            toggleCall();
        }
        // Note: if isVoiceActive was already true, spriteStartedSession stays false (OS started it)
    }, [isVoiceActive, activeSpriteVoice, activeSpriteId, spriteStartedSession, toggleCall, playMagicBell, enableSpriteVoice, disableSpriteVoice, setSpriteStartedSession, spriteId, spriteName, spriteVoiceProvider, spriteVoiceId, setMessages, setActiveTranscript, supportedFeatures, tenantId, spriteBotConfig]);

    const isPromptValid = prompt.trim().length > 0;
    const summonButtonDisabled = loading ? false : !isPromptValid;
    const avatarUrl = gif?.url ?? sourceImage?.url ?? '/placeholder-avatar.png';
    // const askTargetName = spriteName?.trim() || prompt.trim() || 'sprite';
    // const askLabel = `Ask the ${
    //     askTargetName.length > 28 ? `${askTargetName.slice(0, 28)}…` : askTargetName
    // }`;
    const askLabel = 'Talk to me';

    /**
     * Fetch saved sprites from Prism API
     * Returns the fetched sprites array for optional post-processing
     */
    const fetchSavedSprites = useCallback(async (): Promise<SavedSprite[]> => {
        setSavedSpritesLoading(true);
        try {
            const res = await fetch('/api/summon-ai-sprite/list?limit=20');
            if (res.ok) {
                const data = await res.json();
                const sprites: SavedSprite[] = data.sprites || [];
                setSavedSprites(sprites);
                // eslint-disable-next-line no-console
                console.log('[SummonSpritePrompt] Loaded saved sprites:', sprites.length);
                return sprites;
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[SummonSpritePrompt] Failed to fetch saved sprites:', err);
        } finally {
            setSavedSpritesLoading(false);
        }
        return [];
    }, []);

    // Reusable function to summon sprite with a given prompt
    const summonSprite = useCallback(async (spritePrompt: string) => {
        if (summonAbortControllerRef.current) {
            summonAbortControllerRef.current.abort();
        }

        const controller = new AbortController();
        summonAbortControllerRef.current = controller;

        setLoading(true);
        setError(null);
        // Don't clear gif/sourceImage here - keep current sprite visible during generation
        // The new sprite will replace it when ready (setGif/setSourceImage in success handler)

        // eslint-disable-next-line no-console
        console.log('[SummonSpritePrompt] summonSprite called with prompt:', spritePrompt);
        // eslint-disable-next-line no-console
        console.log('the call was made yahoo'); // Debug log when API call is initiated

          // Use same-origin URL so the request always hits the app the user is viewing (fixes RunPod
        // and other deployments where NEXT_PUBLIC_INTERFACE_BASE_URL may be internal/unreachable).
        const endpoint =
            typeof window !== 'undefined'
                ? `${window.location.origin}/api/summon-ai-sprite`
                : (() => {
                      const apiBase = (process.env.NEXT_PUBLIC_INTERFACE_BASE_URL || '').replace(/\/$/, '');
                      return apiBase ? `${apiBase}/api/summon-ai-sprite` : '/api/summon-ai-sprite';
                  })();
        const requestId = createSummonRequestId();
        const lifecycleDetail: SummonLifecycleDetail = { prompt: spritePrompt, requestId };
        summonLifecycleRef.current = lifecycleDetail;
        dispatchSummonLifecycleEvent('sprite.summon.start', lifecycleDetail);

        let outcome: SummonLifecycleStatus = 'error';

        try {
            // eslint-disable-next-line no-console
            console.log('[SummonSpritePrompt] Calling summon sprite endpoint:', endpoint, 'prompt:', spritePrompt);
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: spritePrompt, tenantId }),
                signal: controller.signal,
            });
            // eslint-disable-next-line no-console
            console.log('[SummonSpritePrompt] API response status:', res.status, res.statusText);

            if (!res.ok) {
                // If the response is not ok, it might be a standard JSON error or a stream that failed immediately
                // Try to parse as JSON first
                try {
                    const errData = await res.json();
                    const reason = errData.error || 'Request failed';
                    const details = errData.details ? `: ${errData.details}` : '';
                    throw new Error(`${reason}${details}`);
                } catch {
                    // Fallback if not valid JSON
                    throw new Error(`Request failed with status ${res.status}`);
                }
            }

            if (!res.body) {
                throw new Error('No response body received');
            }

            // Stream handler
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finalData: ApiResponse | null = null;

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep partial line

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const msg = JSON.parse(line);
                            if (msg.type === 'log') {
                                setBubbleLine(msg.message);
                            } else if (msg.type === 'error') {
                                const details = msg.details ? `: ${msg.details}` : '';
                                throw new Error(`${msg.error}${details}`);
                            } else if (msg.type === 'result') {
                                finalData = msg.data;
                            }
                        } catch (e) {
                            if (e instanceof Error && e.message.startsWith('Unexpected token')) {
                                // Ignore JSON parse errors for partial chunks (shouldn't happen with line splitting but safety first)
                                continue;
                            }
                            throw e; // Re-throw actual errors (like the one we threw for msg.type === 'error')
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }

            if (!finalData) {
               throw new Error('Stream ended without a final result');
            }

            if ('error' in finalData) {
                throw new Error(finalData.error || 'Unknown error in response');
            }

            const data = finalData;

            // Voice info might be missing if voice generation is disabled
            const newVoiceProvider = data.voiceProvider || '';
            const newVoiceId = data.voiceId || '';
            
            // Always update state (empty string means disabled)
            setSpriteVoiceProvider(newVoiceProvider);
            setSpriteVoiceId(newVoiceId);

            if (newVoiceProvider && newVoiceId) {
                // eslint-disable-next-line no-console
                console.log('[SummonSpritePrompt] Using server-selected sprite voice:', { voiceProvider: newVoiceProvider, voiceId: newVoiceId });
            } else {
                // eslint-disable-next-line no-console
                console.log('[SummonSpritePrompt] No voice data returned from server (voice/personality disabled)');
            }

            setGif(data.gif ?? null);
            setSourceImage(data.sourceImage ?? null);
            setSpriteId(data.spriteId ?? null);
            setSpriteName(data.spriteName ?? null);
            const nextLast = {
                prompt: spritePrompt,
                gif: data.gif ?? null,
                sourceImage: data.sourceImage ?? null,
                spriteId: data.spriteId ?? null,
                spriteName: data.spriteName ?? null,
                voiceProvider: newVoiceProvider,
                voiceId: newVoiceId,
            };
            setLastSprite(nextLast);
            lastSpriteMemory = nextLast;
            setSpriteIsShared(false); // Newly summoned sprites are always owned
            setBubbleLine(`Summoned: ${data.spriteName ?? spritePrompt}`);
            
            // Refresh the full saved sprites list from Prism, then surgically add
            // the new sprite if it's not yet in the DB (handles replication delay)
            if (data.spriteId) {
                fetchSavedSprites().then(fetchedSprites => {
                    const found = fetchedSprites.some(s => s._id === data.spriteId);
                    if (!found) {
                        // Sprite not yet in DB list - add it surgically for immediate availability
                        const newSavedSprite: SavedSprite = {
                            _id: data.spriteId!,
                            name: data.spriteName ?? spritePrompt,
                            description: `Sprite summoned from: "${spritePrompt}"`,
                            originalRequest: spritePrompt,
                            hasGif: !!(data.gif),
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        };
                        // Dedupe: only add if not already in the current state
                        setSavedSprites(prev => {
                            if (prev.some(s => s._id === newSavedSprite._id)) {
                                return prev; // Already exists, no change
                            }
                            return [newSavedSprite, ...prev];
                        });
                        // eslint-disable-next-line no-console
                        console.log('[SummonSpritePrompt] New sprite not in DB yet, added surgically:', data.spriteId);
                    }
                }).catch(() => {
                    // Fetch failed - add sprite surgically as fallback
                    const newSavedSprite: SavedSprite = {
                        _id: data.spriteId!,
                        name: data.spriteName ?? spritePrompt,
                        description: `Sprite summoned from: "${spritePrompt}"`,
                        originalRequest: spritePrompt,
                        hasGif: !!(data.gif),
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    };
                    // Dedupe: only add if not already in the current state
                    setSavedSprites(prev => {
                        if (prev.some(s => s._id === newSavedSprite._id)) {
                            return prev; // Already exists, no change
                        }
                        return [newSavedSprite, ...prev];
                    });
                });
            }
            
            // Notify listeners that sprite generation succeeded
            window.dispatchEvent(
                new CustomEvent('sprite.ready', {
                    detail: { prompt: spritePrompt, spriteId: data.spriteId, spriteName: data.spriteName, requestId },
                }),
            );
            
            // Send admin message to active voice session
            if ((isVoiceActive || activeSpriteVoice) && roomUrl && tenantId) {
                const spriteName = data.spriteName ?? spritePrompt;
                const adminMessage = `Sprite "${spriteName}" has finished generating and is ready. The user can now interact with it.`;
                // eslint-disable-next-line no-console
                console.log('[SummonSpritePrompt] Sending admin message to voice session:', adminMessage);
                fetch('/api/bot/admin', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-room-url': roomUrl,
                    },
                    body: JSON.stringify({
                        message: adminMessage,
                        mode: 'queued',
                        tenantId,
                        roomUrl,
                        context: {
                            sourceType: 'sprite-generated',
                            spriteId: data.spriteId,
                            spriteName,
                        },
                    }),
                }).catch(err => {
                    // Don't block on admin message failure
                    // eslint-disable-next-line no-console
                    console.warn('[SummonSpritePrompt] Failed to send sprite-ready admin message:', err);
                });
            }
            
            // Hot-swap: If we're in an active sprite voice session, automatically switch to the new sprite
            // This sends a config update to the bot with the new sprite's personality and voice
            if (activeSpriteVoice && isVoiceActive && data.spriteId && newVoiceId && isFeatureEnabled('spriteVoice', supportedFeatures)) {
                const newSpriteName = data.spriteName ?? spritePrompt;
                // eslint-disable-next-line no-console
                console.log('[SummonSpritePrompt] Hot-swapping to new sprite during active sprite voice session:', {
                    newSpriteId: data.spriteId,
                    newSpriteName,
                    newVoiceId,
                    newVoiceProvider,
                });
                // Use enableSpriteVoice to send config update with new sprite's voice
                // isNewSession=true so the new sprite greets naturally without double greeting
                setMessages([]);
                setActiveTranscript(null);
                enableSpriteVoice(
                    data.spriteId,
                    { voiceProvider: newVoiceProvider, voiceId: newVoiceId },
                    true, // isNewSession - new sprite will greet naturally
                    newSpriteName,
                    tenantId
                );
                // Clear messages so the new sprite's greeting is fresh
                setMessages([]);
                setActiveTranscript(null);
            }

            // Track creation in session history with sprite id, name, and user request
            void trackSessionHistory('Sprite created', [
                {
                    type: 'sprite',
                    id: data.spriteId ?? 'unknown',
                    description: `name:${data.spriteName ?? spritePrompt}`,
                },
                {
                    type: 'sprite-request',
                    id: data.spriteId ?? 'unknown',
                    description: spritePrompt,
                },
            ]);
            
            // Notify user of successful sprite creation
            toast({ title: 'Sprite created!', description: `"${data.spriteName ?? spritePrompt}" is ready.` });

            outcome = 'success';
        } catch (e: unknown) {
            if (e instanceof DOMException && e.name === 'AbortError') {
                outcome = 'cancelled';
                return;
            }
            const message = e instanceof Error ? e.message : 'Unexpected error';
            // eslint-disable-next-line no-console
            console.error('Summon sprite error:', e, 'endpoint:', endpoint);
            setError(message);
            toast({ title: 'Sprite creation failed', description: message, variant: 'destructive' });
        } finally {
            setLoading(false);
            dispatchSummonLifecycleEvent('sprite.summon.stop', { ...lifecycleDetail, status: outcome });
            if (summonAbortControllerRef.current === controller) {
                summonAbortControllerRef.current = null;
            }
            if (summonLifecycleRef.current?.requestId === lifecycleDetail.requestId) {
                summonLifecycleRef.current = null;
            }
        }
    }, [tenantId, isVoiceActive, activeSpriteVoice, roomUrl, fetchSavedSprites, toast, enableSpriteVoice, setMessages, setActiveTranscript, supportedFeatures]);

    // Listen for voice-activated sprite summon requests
    useEffect(() => {
        const handleSpriteSummonRequest = (event: Event) => {
            const customEvent = event as CustomEvent<{ prompt?: string }>;
            const voicePrompt = customEvent.detail?.prompt;
            
            if (voicePrompt && voicePrompt.trim()) {
                // eslint-disable-next-line no-console
                console.log('[SummonSpritePrompt] Received spriteSummonRequest event:', voicePrompt);
                // Set the prompt from voice activation
                setPrompt(voicePrompt.trim());
                // Automatically summon the sprite with the voice prompt
                void summonSprite(voicePrompt.trim());
            }
        };

        window.addEventListener('spriteSummonRequest', handleSpriteSummonRequest);

        return () => {
            window.removeEventListener('spriteSummonRequest', handleSpriteSummonRequest);
        };
    }, [summonSprite]);



    // Restore last sprite from in-memory cache when component remounts (e.g., after mode switch)
    useEffect(() => {
        if (lastSpriteMemory) {
            setLastSprite(lastSpriteMemory);
        }
    }, []);

    // Fetch saved sprites from Prism when dialog opens
    useEffect(() => {
        if (!open) return;
        void fetchSavedSprites();
    }, [open, fetchSavedSprites]);

    const submit = async () => {
        if (!isPromptValid || loading) {
            return;
        }
        await summonSprite(prompt);
    };

    const handleStopSummoning = useCallback(() => {
        if (!loading) {
            return;
        }
        summonAbortControllerRef.current?.abort();
        recallAbortControllerRef.current?.abort();
    }, [loading]);

    // Recall from in-memory cache (current session)
    const recallLastSprite = useCallback(() => {
        if (!lastSprite) return;
        setGif(lastSprite.gif);
        setSourceImage(lastSprite.sourceImage);
        setPrompt(lastSprite.prompt);
        setSpriteId(lastSprite.spriteId);
        setSpriteName(lastSprite.spriteName ?? null);
        setSpriteIsShared(false); // In-memory cache is always from recent generation (owned)
        setBubbleLine(lastSprite.spriteName ?? lastSprite.prompt);
        setChatInput('');
        setChatError(null);
        
        // Restore voice configuration
        setSpriteVoiceProvider(lastSprite.voiceProvider);
        setSpriteVoiceId(lastSprite.voiceId);
        
        // eslint-disable-next-line no-console
        console.log('[SummonSpritePrompt] Recalled cached sprite:', lastSprite.spriteId, lastSprite.spriteName, 'voice:', lastSprite.voiceProvider, lastSprite.voiceId, 'isVoiceActive:', isVoiceActive);

        // If voice is already active, automatically switch to this sprite
        // This handles the sprite-to-sprite switch case where user recalls another sprite during active session
        if (isVoiceActive && lastSprite.spriteId && isFeatureEnabled('spriteVoice', supportedFeatures)) {
            // eslint-disable-next-line no-console
            console.log('[SummonSpritePrompt] Voice active during recall, switching to sprite:', lastSprite.spriteId, lastSprite.spriteName);
            playMagicBell();
            setMessages([]);
            setActiveTranscript(null);
            // isNewSession = true so sprite greets naturally from its personality prompt (no extra greeting message)
            enableSpriteVoice(lastSprite.spriteId, {
                voiceProvider: lastSprite.voiceProvider,
                voiceId: lastSprite.voiceId,
            }, true, lastSprite.spriteName ?? undefined, tenantId);
        }
    }, [lastSprite, isVoiceActive, playMagicBell, setMessages, setActiveTranscript, enableSpriteVoice, tenantId, supportedFeatures]);

    // Recall a saved sprite from Prism (persisted across sessions)
    const recallSavedSprite = useCallback(async (savedSpriteId: string) => {
        // Abort any in-flight recall before starting a new one
        if (recallAbortControllerRef.current) {
            recallAbortControllerRef.current.abort();
        }

        const controller = new AbortController();
        recallAbortControllerRef.current = controller;

        setLoading(true);
        setRecallDropdownOpen(false);
        try {
            const res = await fetch(`/api/summon-ai-sprite/${savedSpriteId}`, { signal: controller.signal });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                setError(errData.error || 'Failed to recall sprite');
                return;
            }
            
            const data: { sprite: FullSavedSprite } = await res.json();
            const sprite = data.sprite;
            
            // Convert base64 gifData to object URL if present
            let gifUrl: string | null = null;
            if (sprite.gifData && sprite.gifMimeType) {
                const binaryStr = atob(sprite.gifData);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) {
                    bytes[i] = binaryStr.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: sprite.gifMimeType });
                gifUrl = URL.createObjectURL(blob);
            }
            
            // Restore sprite state
            if (gifUrl) {
                setGif({ url: gifUrl });
            } else {
                setGif(null);
            }
            setSourceImage(null);
            setSpriteId(sprite._id);
            setSpriteName(sprite.name);
            setSpriteIsShared(!!sprite.isShared);
            setPrompt(sprite.originalRequest || sprite.name);
            setBubbleLine(sprite.name);
            setChatInput('');
            setChatError(null);
            
            // Store voice configuration from the sprite (defaults if not present)
            const voiceProvider = sprite.voiceProvider || 'kokoro';
            const voiceId = sprite.voiceId || 'am_fenrir';
            setSpriteVoiceProvider(voiceProvider);
            setSpriteVoiceId(voiceId);
            setSpriteBotConfig(sprite.botConfig ?? null);
            
            // eslint-disable-next-line no-console
            console.log('[SummonSpritePrompt] Recalled saved sprite:', sprite._id, sprite.name, 'voice:', voiceProvider, voiceId, 'isVoiceActive:', isVoiceActive);

            // If voice is already active, automatically switch to this sprite
            // This handles the sprite-to-sprite switch case where user recalls another sprite during active session
            if (isVoiceActive && isFeatureEnabled('spriteVoice', supportedFeatures)) {
                // eslint-disable-next-line no-console
                console.log('[SummonSpritePrompt] Voice active during recall, switching to sprite:', sprite._id, sprite.name);
                playMagicBell();
                setMessages([]);
                setActiveTranscript(null);
                // isNewSession = true so sprite greets naturally from its personality prompt (no extra greeting message)
                enableSpriteVoice(sprite._id, {
                    voiceProvider,
                    voiceId,
                }, true, sprite.name, tenantId);
            }

            void trackSessionHistory('Sprite recalled', [
                {
                    type: 'sprite',
                    id: sprite._id,
                    description: `name:${sprite.name}`,
                },
            ]);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                // Swallow aborts triggered by stop button
                return;
            }
            // eslint-disable-next-line no-console
            console.error('[SummonSpritePrompt] Failed to recall sprite:', err);
            setError('Failed to recall sprite');
        } finally {
            if (recallAbortControllerRef.current === controller) {
                recallAbortControllerRef.current = null;
            }
            setLoading(false);
        }
    }, [isVoiceActive, playMagicBell, setMessages, setActiveTranscript, enableSpriteVoice, tenantId, supportedFeatures]);

    // Listen for sprite open requests (e.g. from share links)
    useEffect(() => {
        const handleSpriteOpen = (event: Event) => {
            const customEvent = event as CustomEvent<{ payload: { spriteId: string } }>;
            const spriteId = customEvent.detail?.payload?.spriteId;
            
            if (spriteId) {
                // eslint-disable-next-line no-console
                console.log('[SummonSpritePrompt] Received sprite open event:', spriteId);
                void recallSavedSprite(spriteId);
            }
        };

        window.addEventListener(NIA_EVENT_SPRITE_OPEN, handleSpriteOpen);

        return () => {
            window.removeEventListener(NIA_EVENT_SPRITE_OPEN, handleSpriteOpen);
        };
    }, [recallSavedSprite]);

    // Handle recall button click - either direct recall or show dropdown
    const handleRecallClick = useCallback(() => {
        // Calculate total unique sprites available
        // lastSprite may already be in savedSprites (after surgical add), so dedupe by spriteId
        const lastSpriteInSaved = lastSprite?.spriteId && savedSprites.some(s => s._id === lastSprite.spriteId);
        const totalSprites = savedSprites.length + (lastSprite && !lastSpriteInSaved ? 1 : 0);
        
        // If only one sprite total, recall it directly
        if (totalSprites === 1) {
            if (lastSprite) {
                recallLastSprite();
            } else if (savedSprites.length === 1) {
                void recallSavedSprite(savedSprites[0]._id);
            }
            return;
        }
        
        // Multiple sprites available - toggle dropdown
        if (totalSprites > 1) {
            setRecallDropdownOpen(prev => !prev);
        }
    }, [lastSprite, savedSprites, recallLastSprite, recallSavedSprite]);

    const dismissSpriteImmediate = useCallback(() => {
        setGif(null);
        setSourceImage(null);
        setSpriteId(null);
        setSpriteName(null);
        setBubbleLine(DEFAULT_BUBBLE_LINE);
        setChatInput('');
        setChatError(null);
        disableSpriteVoice();
    }, [disableSpriteVoice]);

    const dismissSprite = useCallback(() => {
        // eslint-disable-next-line no-console
        console.log('[SummonSpritePrompt] dismissSprite called, activeSpriteVoice:', activeSpriteVoice, 'isVoiceActive:', isVoiceActive);
        
        playDismiss();
        triggerDismiss(() => {
            dismissSpriteImmediate();
        });
    }, [activeSpriteVoice, isVoiceActive, playDismiss, triggerDismiss, dismissSpriteImmediate]);

    const deleteSpriteById = useCallback(async (spriteIdToDelete: string) => {
        if (!spriteIdToDelete) return;
        // If this sprite is already being deleted, ignore extra clicks
        if (deletingSpriteId === spriteIdToDelete) return;

        setDeletingSpriteId(spriteIdToDelete);
        setError(null);
        setChatError(null);

        const isCurrentSprite = spriteId && spriteId === spriteIdToDelete;

        // Ensure voice session shuts down for this sprite before removal
        if (isCurrentSprite) {
            disableSpriteVoice();
            if (isVoiceActive && toggleCall) {
                // eslint-disable-next-line no-console
                console.log('[SummonSpritePrompt] Ending voice call due to delete');
                toggleCall();
            }
        }

        try {
            const res = await fetch(`/api/summon-ai-sprite/${spriteIdToDelete}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                const message = err?.error || 'Failed to delete sprite';
                setError(message);
                toast({ title: 'Delete failed', description: message, variant: 'destructive' });
                // eslint-disable-next-line no-console
                console.error('[SummonSpritePrompt] Delete sprite failed', err);
                return;
            }

            // Remove from saved list and memory caches
            setSavedSprites(prev => prev.filter(sprite => sprite._id !== spriteIdToDelete));
            if (lastSprite?.spriteId === spriteIdToDelete) {
                setLastSprite(null);
                lastSpriteMemory = null;
            }

            // Dismiss current sprite from UI (voice session already ended above via toggleCall)
            if (isCurrentSprite) {
                dismissSprite();
            }
            void trackSessionHistory('Sprite deleted', [
                {
                    type: 'sprite',
                    id: spriteIdToDelete,
                    description: isCurrentSprite ? `name:${prompt}` : 'sprite deleted from recall list',
                },
            ]);
            toast({ title: 'Sprite deleted', description: 'Voice session closed and sprite removed.' });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[SummonSpritePrompt] Error deleting sprite', err);
            setError('Failed to delete sprite');
            toast({ title: 'Delete failed', description: 'Failed to delete sprite', variant: 'destructive' });
        } finally {
            // Only clear if we're still tracking this sprite as deleting
            setDeletingSpriteId(prev => (prev === spriteIdToDelete ? null : prev));
        }
    }, [spriteId, deletingSpriteId, dismissSprite, lastSprite, isVoiceActive, toggleCall, disableSpriteVoice, toast, prompt]);

    const handleShare = useCallback(async () => {
        if (!spriteId || shareLoading) return;
        setShareLoading(true);
        try {
            const res = await fetch('/api/share/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    resourceId: spriteId,
                    contentType: 'Sprite',
                    role: 'viewer',
                    mode: 'quiet',
                    tenantId
                }),
            });
            const data = await res.json();
            if (res.ok && data.link) {
                await navigator.clipboard.writeText(data.link);
                toast({ 
                    title: 'Link copied', 
                    description: 'Sprite share link copied to clipboard.', 
                    duration: 30000 
                });
            } else {
                 throw new Error(data.error || 'Failed to generate link');
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[SummonSpritePrompt] Share failed', e);
            toast({ title: 'Share failed', description: 'Could not generate share link.', variant: 'destructive' });
        } finally {
            setShareLoading(false);
        }
    }, [spriteId, shareLoading, tenantId, toast]);

    /**
     * Send user text to the bot via the admin API
     * Used when voice session is active to relay typed messages to the Sprite
     */
    const sendTextToBot = useCallback(async (text: string) => {
        if (!roomUrl || !tenantId) {
            // eslint-disable-next-line no-console
            console.warn('[SummonSpritePrompt] Cannot send to bot: missing roomUrl or tenantId');
            return false;
        }

        try {
            const res = await fetch('/api/bot/admin', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-room-url': roomUrl,
                },
                body: JSON.stringify({
                    message: text,
                    mode: 'queued',
                    tenantId,
                    roomUrl,
                    context: {
                        sourceType: 'user-text',
                        userName,
                    },
                }),
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                // eslint-disable-next-line no-console
                console.error('[SummonSpritePrompt] Failed to send text to bot:', errorData);
                return false;
            }

            return true;
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[SummonSpritePrompt] Error sending text to bot:', e);
            return false;
        }
    }, [roomUrl, tenantId, userName]);

    const sendChat = async () => {
        const msg = chatInput.trim();
        if (!msg || chatLoading) return;
        setChatError(null);
        setChatInput('');
        setChatLoading(true);
        
        // eslint-disable-next-line no-console
        console.log('[SummonSpritePrompt] sendChat called', {
            message: msg,
            isVoiceActive,
            roomUrl: roomUrl ? 'set' : 'null',
            prompt,
            spriteId,
        });
        
        try {
            // If voice session is active, send via bot admin API for real-time response
            // ONLY if we are currently talking to the sprite (activeSpriteVoice is true)
            // Otherwise, even if voice is active (OS mode), we want the text-only sprite fallback
            if (isVoiceActive && roomUrl && activeSpriteVoice) {
                // eslint-disable-next-line no-console
                console.log('[SummonSpritePrompt] Routing to voice session via sendTextToBot');
                const sent = await sendTextToBot(msg);
                if (!sent) {
                    // eslint-disable-next-line no-console
                    console.error('[SummonSpritePrompt] sendTextToBot returned false');
                    setChatError('Failed to send message to voice session');
                    return;
                }
                setBubbleLine(`You: "${msg}" (sent to voice)`);
                return;
            }

            // Fallback to text-only sprite chat API when voice is not active
            // eslint-disable-next-line no-console
            console.log('[SummonSpritePrompt] Using text-only fallback API', {
                endpoint: '/api/summon-ai-sprite/chat',
                prompt,
                messageLength: msg.length,
            });
            
            const res = await fetch('/api/summon-ai-sprite/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, message: msg }),
            });
            
            // eslint-disable-next-line no-console
            console.log('[SummonSpritePrompt] Chat API response', {
                status: res.status,
                statusText: res.statusText,
                ok: res.ok,
            });
            
            let data: ChatResponse;
            try {
                data = await res.json();
                // eslint-disable-next-line no-console
                console.log('[SummonSpritePrompt] Chat API parsed response', {
                    hasReply: 'reply' in data,
                    hasError: 'error' in data,
                    replyLength: 'reply' in data ? data.reply.length : 0,
                });
            } catch (parseErr) {
                const text = await res.text().catch(() => 'Unable to read response');
                // eslint-disable-next-line no-console
                console.error('[SummonSpritePrompt] Failed to parse chat response', { status: res.status, text });
                setChatError(`Failed to parse chat response (${res.status}): ${text}`);
                return;
            }
            if (!res.ok || 'error' in data) {
                const reason = 'error' in data ? data.error : 'Chat request failed';
                const details = 'details' in data && data.details ? `: ${data.details}` : '';
                // eslint-disable-next-line no-console
                console.error('[SummonSpritePrompt] Chat API error', { reason, details });
                setChatError(`${reason}${details}`);
                return;
            }
            
            // eslint-disable-next-line no-console
            console.log('[SummonSpritePrompt] Chat successful, setting bubble line');
            setBubbleLine(data.reply);
            playBloop();
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'Unexpected error';
            // eslint-disable-next-line no-console
            console.error('Summon sprite chat error:', e);
            setChatError(message);
        } finally {
            setChatLoading(false);
        }
    };

    return (
        <>
            <div
                className="pointer-events-auto fixed top-4 left-1/2 z-[70] -translate-x-1/2 md:left-auto md:right-16 md:translate-x-0 flex flex-col items-center"
                style={{ fontFamily: 'Gohufont, monospace' }}
            >
                {/* Show button on mobile always, on desktop only when closed */}
                {(!open || isMobile) && (
                    <button
                        type="button"
                        onClick={() => {
                            if (isMobile) {
                                setOpen(!open);
                                setIsCollapsed(false); // Reset collapse state when toggling
                            } else {
                                setOpen(true);
                            }
                        }}
                        className={`rounded-full border border-white/30 px-4 py-2 text-sm font-semibold text-white shadow-lg backdrop-blur focus:outline-none focus:ring-2 focus:ring-indigo-300 whitespace-nowrap ${
                            open && isMobile 
                                ? 'bg-indigo-600 hover:bg-indigo-700' 
                                : 'bg-white/20 hover:bg-white/30'
                        } ${open && isMobile ? 'mb-3' : ''}`}
                    >
                        Summon Sprite
                    </button>
                )}

                {open && (
                    <div ref={dialogRef} className="w-full max-w-[90vw] md:w-[380px] rounded-2xl border border-white/30 bg-slate-900/85 p-5 text-white shadow-2xl backdrop-blur-md transition-all duration-300">
                        <div className="flex items-start justify-between gap-2">
                            <div 
                                className="flex-1"
                                onClick={() => {
                                    if (isMobile && isCollapsed) {
                                        setIsCollapsed(false);
                                    }
                                }}
                                style={{ cursor: isMobile && isCollapsed ? 'pointer' : 'default' }}
                            >
                                <p className="text-[12px] font-semibold whitespace-nowrap md:text-sm md:whitespace-normal">
                                    Create Your Sprite Companion
                                </p>
                                <p className="text-[10px] text-slate-100/90 whitespace-nowrap md:text-[12px] md:whitespace-normal">
                                    Describe your friend and click on Summon
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => isMobile ? setIsCollapsed(!isCollapsed) : setOpen(false)}
                                className={`px-2 py-1 text-[12px] font-semibold text-white focus:outline-none -mt-4 md:mt-0 ${
                                    isMobile ? 'bg-transparent' : 'rounded-full bg-white/20 shadow-sm hover:bg-white/30 focus:ring-2 focus:ring-indigo-300'
                                }`}
                            >
                                {isMobile ? (
                                    <span 
                                        className={`inline-block transition-transform duration-300 text-[16px] ${
                                            isCollapsed ? 'rotate 0' : 'rotate 0'
                                        }`}
                                    >
                                        {isCollapsed ? '↓' : '↑'}
                                    </span>
                                ) : '✕'}
                            </button>
                        </div>

                        <div className={`mt-4 space-y-3 transition-all duration-300 ${
                            isCollapsed && isMobile ? 'max-h-0 opacity-0 mt-0 overflow-hidden' : 'max-h-[500px] opacity-100'
                        }`}>
                            <input
                                className="w-full rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-[12px] md:py-2 md:text-sm text-white shadow-inner placeholder:text-slate-300 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                value={prompt}
                                onChange={e => setPrompt(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && !loading && isPromptValid) {
                                        e.preventDefault();
                                        void submit();
                                    }
                                }}
                                placeholder="Describe your sprite..."
                            />
                            <div className="flex items-center gap-1 md:gap-2">
                                <button
                                    type="button"
                                    onClick={loading ? handleStopSummoning : submit}
                                    disabled={summonButtonDisabled}
                                    className={`rounded-lg px-2.5 py-1.5 text-[11px] md:px-3 md:py-2 md:text-sm font-semibold text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-slate-900 whitespace-nowrap ${
                                        summonButtonDisabled
                                            ? 'bg-indigo-300/70 cursor-not-allowed focus:ring-indigo-300'
                                            : 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-300'
                                    }`}
                                >
                                    {loading ? 'Stop Summoning' : 'Summon'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPrompt(DEFAULT_PROMPT)}
                                    disabled={loading}
                                    className="rounded-lg border border-white/30 bg-white/10 px-2.5 py-1.5 text-[11px] md:px-3 md:py-2 md:text-sm font-semibold text-white shadow-sm hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-offset-1 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
                                >
                                    Clear
                                </button>
                                {/* Recall button - show if we have lastSprite OR any saved sprites */}
                                {(lastSprite || savedSprites.length > 0) && (() => {
                                    // Calculate total unique sprites for dropdown logic
                                    const lastSpriteInSaved = lastSprite?.spriteId && savedSprites.some(s => s._id === lastSprite.spriteId);
                                    const totalSprites = savedSprites.length + (lastSprite && !lastSpriteInSaved ? 1 : 0);
                                    const showDropdownIndicator = totalSprites > 1;
                                    
                                    return (
                                    <div className="relative" ref={recallDropdownRef}>
                                        <button
                                            type="button"
                                            onClick={handleRecallClick}
                                            disabled={loading || savedSpritesLoading}
                                            className="rounded-lg border border-white/30 bg-white/10 px-2.5 py-1.5 text-[11px] md:px-3 md:py-2 md:text-sm font-semibold text-white shadow-sm hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-offset-1 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
                                        >
                                            {savedSpritesLoading ? '...' : 'Recall'}
                                            {/* Show dropdown indicator if multiple sprites available */}
                                            {showDropdownIndicator && ' ▾'}
                                        </button>
                                        
                                        {/* Dropdown for multiple sprites (lastSprite + savedSprites) */}
                                        {recallDropdownOpen && totalSprites > 1 && (
                                            <div
                                                className="absolute left-1/2 -translate-x-1/2 md:left-auto md:right-0 md:translate-x-0 top-full mt-1 z-10 w-40 md:w-56 max-h-48 overflow-y-auto rounded-lg border border-white/30 bg-slate-800/95 shadow-xl backdrop-blur-md [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.6)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-400/60"
                                            >
                                                {/* Show lastSprite first if it's not in savedSprites (just generated) */}
                                                {lastSprite && !lastSpriteInSaved && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setRecallDropdownOpen(false);
                                                            recallLastSprite();
                                                        }}
                                                        className="w-full px-3 py-2 text-left text-sm text-white hover:bg-white/20 first:rounded-t-lg last:rounded-b-lg border-b border-white/10"
                                                    >
                                                        <span className="block truncate font-medium">{lastSprite.spriteName ?? lastSprite.prompt}</span>
                                                        <span className="block truncate text-xs text-emerald-400">✨ Just created</span>
                                                    </button>
                                                )}
                                                {savedSprites.map((sprite) => (
                                                    <div
                                                        key={sprite._id}
                                                        onClick={() => void recallSavedSprite(sprite._id)}
                                                        className="group w-full px-3 py-2 text-left text-sm text-white hover:bg-white/20 first:rounded-t-lg last:rounded-b-lg flex items-center justify-between gap-2"
                                                    >
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="block truncate font-medium max-w-[140px]">{sprite.name}</span>
                                                                {sprite.isShared && (
                                                                    <span className="text-[10px] bg-indigo-500/40 text-indigo-200 px-1.5 py-0.5 rounded ml-2">
                                                                        Shared
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <span className="block truncate text-xs text-slate-400">
                                                                {new Date(sprite.updatedAt).toLocaleDateString()}
                                                            </span>
                                                        </div>
                                                        {!sprite.isShared && (
                                                            <button
                                                                type="button"
                                                                onClick={e => {
                                                                    e.stopPropagation();
                                                                    void deleteSpriteById(sprite._id);
                                                                }}
                                                                aria-label="Delete sprite"
                                                                disabled={deletingSpriteId === sprite._id}
                                                                className={`ml-2 flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                                                                    deletingSpriteId === sprite._id
                                                                        ? 'text-rose-300 opacity-100 cursor-wait'
                                                                        : 'text-slate-200 hover:text-rose-300 opacity-0 group-hover:opacity-100 group-hover:pointer-events-auto'
                                                                }`}
                                                            >
                                                                ✕
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    );
                                })()}
                            </div>
                            {error ? <p className="text-xs text-rose-300">Error: {error}</p> : null}
                        </div>
                    </div>
                )}
            </div>

            {(gif || sourceImage) && (
                <div
                    className="pointer-events-auto fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 p-6"
                    style={{ fontFamily: 'Gohufont, monospace' }}
                >
                    {/* Vignette overlay */}
                    <div className="stage-vignette" />

                    <SpriteBubble text={displayedBubbleLine} state={spriteAnimState} />

                    <SpriteStage state={spriteAnimState}>
                        <button
                            type="button"
                            onClick={() => { handleSpriteClick(); playSparkle(); }}
                            className="group relative h-48 w-48 bg-transparent transition-transform duration-200 hover:scale-105 focus:outline-none"
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={avatarUrl}
                                alt="Sprite avatar"
                                className={`h-full w-full object-contain bg-transparent ${
                                    activeSpriteVoice ? 'drop-shadow-[0_0_30px_rgba(129,140,248,0.8)]' : 'drop-shadow-[0_10px_30px_rgba(0,0,0,0.35)]'
                                }`}
                                style={{ imageRendering: 'pixelated' }}
                            />
                            {/* Voice activation hint overlay */}
                            {!activeSpriteVoice && isFeatureEnabled('spriteVoice', supportedFeatures) && (
                                <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                                    <span className="rounded-full bg-indigo-600/95 px-3 py-1 text-[11px] font-semibold text-white shadow-lg">
                                        {isVoiceActive ? 'Talk' : 'Start Voice'}
                                    </span>
                                </div>
                            )}
                        </button>
                    </SpriteStage>
                    <div className="w-[260px] rounded-xl border border-white/30 bg-slate-900/85 p-2 shadow-inner backdrop-blur-sm">
                        <div className="mb-1 flex items-center justify-between">
                            <p className="pl-2 text-[11px] font-semibold text-slate-200">{askLabel}</p>
                            <button
                                type="button"
                                onClick={() => dismissSprite()}
                                aria-label="Close"
                                className="ml-2 flex h-5 w-5 items-center justify-center rounded-full text-[12px] font-semibold text-white hover:text-slate-200 focus:outline-none"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                value={chatInput}
                                onChange={e => setChatInput(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        sendChat();
                                    }
                                }}
                                placeholder="Drop your thoughts here"
                                className="w-full rounded-lg border border-white/40 bg-white/10 px-3 py-2 text-sm text-slate-100 shadow-inner placeholder:text-slate-300 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                            />
                            <button
                                type="button"
                                onClick={sendChat}
                                disabled={chatLoading || !chatInput.trim()}
                                className={`rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-offset-1 focus:ring-offset-slate-900 ${
                                    chatLoading || !chatInput.trim()
                                        ? 'bg-indigo-300/70 cursor-not-allowed'
                                        : 'bg-indigo-600 hover:bg-indigo-700'
                                }`}
                            >
                                {chatLoading ? '...' : 'Send'}
                            </button>
                        </div>
                        {chatError ? <p className="mt-1 text-[11px] text-rose-300">{chatError}</p> : null}
                    </div>
                    <div className="-mt-3 flex w-[260px] items-center justify-end gap-3">
                        {/* Configure button — only for owned sprites */}
                        {!spriteIsShared && (
                            <button
                                type="button"
                                onClick={() => setShowBotConfig(true)}
                                disabled={!spriteId}
                                className="rounded-full border border-white/30 bg-slate-800/80 px-3 py-1 text-[10px] font-semibold text-slate-200 shadow-sm hover:bg-slate-700/80 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-300"
                            >
                                ⚙️ Configure
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleShare}
                            disabled={!spriteId || shareLoading}
                            className="rounded-full border border-indigo-400/70 bg-indigo-900/70 px-3 py-1 text-[10px] font-semibold text-indigo-100 shadow-sm hover:bg-indigo-800/80 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        >
                             {shareLoading ? 'Sharing...' : 'Share'}
                        </button>
                    </div>
                </div>
            )}

            {/* Bot Config Panel */}
            {showBotConfig && spriteId && (
                <SpriteBotConfigPanel
                    spriteId={spriteId}
                    spriteName={spriteName}
                    initialConfig={spriteBotConfig as any}
                    onClose={() => setShowBotConfig(false)}
                    onSaved={(config) => {
                        setSpriteBotConfig(config as any);
                        setShowBotConfig(false);
                        toast({ title: 'Bot config saved', description: `${spriteName ?? 'Sprite'} updated.` });
                    }}
                />
            )}
        </>
    );
}


