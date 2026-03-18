# VAPI to Pipecat Voice Session Migration Plan

**Date:** October 24, 2025  
**Branch:** `staging-functional-tools`  
**Status:** Planning & Implementation

---

## Executive Summary

Replace the VAPI-based voice interaction system with user-specific Daily.co rooms powered by pipecat-daily-bot. This migration will provide a unified voice infrastructure, eliminate external VAPI dependency, and leverage our existing pipecat tooling capabilities.

### Key Benefits
- **Unified Infrastructure**: Single voice platform (Daily.co + Pipecat) for both 1:1 voice and multi-user video
- **Enhanced Capabilities**: Full access to pipecat toolbox (notes, browser, HTML, etc.)
- **Cost Reduction**: Eliminate VAPI subscription
- **Better Control**: Direct access to bot behavior, tools, and events
- **Consistent UX**: Same event bus, same state management patterns

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Interface Application (Next.js)                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ AssistantButton / AssistantCanvas                             │ │
│  │ (Components using voice)                                       │ │
│  └─────────────────────────────┬─────────────────────────────────┘ │
│                                │                                   │
│  ┌─────────────────────────────▼─────────────────────────────────┐ │
│  │ useVoiceSession Hook (NEW)                                    │ │
│  │ - Replaces useVapi                                            │ │
│  │ - start() / stop() / toggleSession()                          │ │
│  │ - State: sessionStatus, isSpeaking, audioLevel, transcript    │ │
│  └─────────────────────────────┬─────────────────────────────────┘ │
│                                │                                   │
│  ┌─────────────────────────────▼─────────────────────────────────┐ │
│  │ VoiceSessionProvider (NEW)                                    │ │
│  │ - Singleton voice session management                          │ │
│  │ - Lifecycle: create room → join → bot /join → leave           │ │
│  │ - Replaces SpeechProvider                                     │ │
│  └─────────────────────────────┬─────────────────────────────────┘ │
│                                │                                   │
│  ┌─────────────────────────────▼─────────────────────────────────┐ │
│  │ Shared Daily Utilities (NEW LIB)                              │ │
│  │ @interface/lib/daily/                                         │ │
│  │ - room-manager.ts: create/reuse persistent rooms              │ │
│  │ - token-service.ts: generate Daily tokens                     │ │
│  │ - participant-manager.ts: identity tracking                   │ │
│  │ - event-bridge.ts: Daily → React events                       │ │
│  │ - audio-manager.ts: audio levels, speech detection            │ │
│  │ - config.ts: voice session configuration                      │ │
│  └─────────────────────────────┬─────────────────────────────────┘ │
│                                │                                   │
└────────────────────────────────┼───────────────────────────────────┘
                                 │
                  ┌──────────────┴─────────────┐
                  │ Daily.co WebRTC            │
                  │ - User room: voice-{userId}│
                  │ - Persistent (configurable)│
                  └──────────────┬─────────────┘
                                 │
┌────────────────────────────────▼───────────────────────────────────┐
│  Pipecat Daily Bot Backend                                         │
├────────────────────────────────────────────────────────────────────┤
│  POST /join                                                        │
│  - voiceOnly: true flag (camera off, mic on)                      │
│  - Room: voice-{userId}                                            │
│  - Personality/Persona/Voice config                                │
│  - Session persistence config (default 300s)                       │
│                                                                    │
│  Bot Behavior:                                                     │
│  - Joins with camera off, mic on (stealth video)                  │
│  - Full toolbox access (notes, browser, etc.)                     │
│  - Event forwarding via AppMessageForwarder                        │
│  - Auto-teardown after configured idle time                        │
└────────────────────────────────────────────────────────────────────┘
```

---

## Design Decisions

### 1. Room Management & Naming

**Decision**: User-specific persistent rooms with deterministic naming

**Room Naming Convention:**
```
voice-{userId}
```

**Rationale:**
- **Deterministic**: Same user always gets same room (enables reuse)
- **Persistent**: Room survives across sessions (configurable teardown delay)
- **Unique**: userId guaranteed unique within our system
- **Discoverable**: Easy to identify voice rooms vs multi-user DailyCall rooms

**Room Lifecycle:**
```typescript
interface VoiceRoomConfig {
  userId: string;
  roomName: string;              // voice-{userId}
  persistAfterLeave: number;     // seconds (default: 300)
  created: Date;
  lastActivity: Date;
}
```

**Teardown Strategy:**
- Default: 300 seconds (5 minutes) after user leaves
- Configurable per assistant via `assistant.voiceSessionPersistence`
- 0 = immediate teardown
- Prevents unnecessary bot resource usage
- Allows quick reconnect within window

### 2. Daily.co Room Privacy

**Daily.co Room Properties** (to prevent uninvited joins):

Daily.co API supports room-level privacy via room properties:

```typescript
// When creating room via Daily API
{
  privacy: "private",           // Requires token to join
  properties: {
    enable_knocking: false,     // No knock-to-enter
    enable_prejoin_ui: false,   // Skip prejoin screen
    max_participants: 2,        // User + bot only
    enable_network_ui: false,   // Hide network quality UI
    enable_screenshare: false,  // Voice-only
    enable_chat: false,         // Use pipecat tools instead
    enable_recording: false     // Unless explicitly enabled
  }
}
```

**Implementation:**
```typescript
// apps/interface/src/lib/daily/room-manager.ts
export async function createVoiceRoom(userId: string): Promise<VoiceRoom> {
  const roomName = `voice-${userId}`;
  
  // Check if room exists
  const existing = await checkRoomExists(roomName);
  if (existing) {
    return { roomUrl: existing.url, roomName, reused: true };
  }
  
  // Create new private room
  const room = await dailyApi.createRoom({
    name: roomName,
    privacy: 'private',
    properties: {
      enable_knocking: false,
      max_participants: 2,
      enable_prejoin_ui: false,
      enable_screenshare: false,
      enable_chat: false,
      exp: Math.floor(Date.now() / 1000) + (86400 * 30) // 30 days
    }
  });
  
  return { roomUrl: room.url, roomName, reused: false };
}
```

### 3. Daily SDK Management

**`allowMultipleCallInstances` Explanation:**

From Daily.co documentation:
- **Default (false)**: Only one `DailyIframe` instance can exist in the page
- **True**: Allows multiple simultaneous Daily call objects

**Our Usage:**
- Currently: DailyCall uses `allowMultipleCallInstances: true` to avoid singleton conflicts during React StrictMode double-mounting
- **Recommendation**: Use single shared call object for voice sessions
- Voice session and DailyCall will be **mutually exclusive** (enforced via state)
- When DailyCall active, voice session pauses (like VAPI currently)

**Strategy:**
```typescript
// Shared singleton (lazy-loaded)
let sharedDailyCallObject: DailyCall | null = null;

export function getOrCreateDailyCallObject(
  config: DailyCallConfig
): DailyCall {
  if (!sharedDailyCallObject) {
    sharedDailyCallObject = DailyIframe.createCallObject({
      ...config,
      allowMultipleCallInstances: false // Single instance
    });
  }
  return sharedDailyCallObject;
}
```

**Lazy Loading:**
```typescript
// apps/interface/src/lib/daily/index.ts
let dailySdkLoaded = false;

export async function ensureDailySdkLoaded(): Promise<void> {
  if (dailySdkLoaded) return;
  
  // Dynamic import
  await import('@daily-co/daily-js');
  dailySdkLoaded = true;
}
```

### 4. Event System Integration

**Unified Event Bus:**

Extend existing DailyCall event infrastructure for voice sessions:

```typescript
// apps/interface/src/features/DailyCall/events/types.ts

export enum VoiceEventType {
  VOICE_SESSION_START = 'voice.session.start',
  VOICE_SESSION_END = 'voice.session.end',
  VOICE_SPEECH_START = 'voice.speech.start',
  VOICE_SPEECH_END = 'voice.speech.end',
  VOICE_TRANSCRIPT = 'voice.transcript',
  VOICE_AUDIO_LEVEL = 'voice.audio.level',
  VOICE_BOT_SPEAKING = 'voice.bot.speaking',
  VOICE_ERROR = 'voice.error'
}

// Inherit from existing DailyCall events
export interface VoiceSessionEvent extends BaseEvent {
  type: VoiceEventType;
  userId: string;
  roomUrl: string;
  sessionId: string;
}
```

**Event Flow:**
1. Daily.co SDK events → Daily event bridge
2. Pipecat bot events → AppMessageForwarder → app-message bridge
3. Both flow through unified event bus
4. React components subscribe via hooks

### 5. Mutual Exclusion with DailyCall

**Current Behavior (VAPI + DailyCall):**
```typescript
// DailyCallView.tsx line 580
window.dispatchEvent(new CustomEvent('dailyCall.session.start'));

// SpeechProvider listens and pauses VAPI
```

**New Behavior (Voice Session + DailyCall):**

Same pattern - voice session listens for DailyCall events:

```typescript
// VoiceSessionProvider
useEffect(() => {
  const handleDailyCallStart = () => {
    if (voiceSessionActive) {
      pauseVoiceSession(); // Mute mic, keep connection
    }
  };
  
  const handleDailyCallEnd = () => {
    if (voiceSessionPaused) {
      resumeVoiceSession(); // Unmute, resume
    }
  };
  
  window.addEventListener('dailyCall.session.start', handleDailyCallStart);
  window.addEventListener('dailyCall.session.end', handleDailyCallEnd);
  
  return () => {
    window.removeEventListener('dailyCall.session.start', handleDailyCallStart);
    window.removeEventListener('dailyCall.session.end', handleDailyCallEnd);
  };
}, [voiceSessionActive, voiceSessionPaused]);
```

**UI State Management:**

Improve existing state to make it clearer:

```typescript
// New unified voice state context
export interface UnifiedVoiceState {
  activeSession: 'none' | 'voice' | 'dailyCall';
  voiceSession: {
    status: 'inactive' | 'connecting' | 'active' | 'paused';
    roomUrl: string | null;
  };
  dailyCall: {
    joined: boolean;
    roomUrl: string | null;
  };
}
```

---

## Implementation Phases

### Phase 1: Shared Daily Library

**Goal**: Extract reusable Daily.co utilities

**Files to Create:**

```
apps/interface/src/lib/daily/
├── index.ts                   # Barrel exports + lazy loading
├── config.ts                  # Voice session configuration
├── room-manager.ts            # Room lifecycle management
├── token-service.ts           # Token generation
├── participant-manager.ts     # Identity & participant tracking
├── event-bridge.ts            # Daily → React event bridge
├── audio-manager.ts           # Audio levels, muting, speech detection
└── types.ts                   # Shared TypeScript types
```

**Key Functions:**

```typescript
// config.ts
export interface VoiceSessionConfig {
  noiseCancellation: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  audioOnly: boolean;
  dailyConfig: {
    subscribeToTracksAutomatically: boolean;
    receiveSettings: {
      video: 'off';
      audio: 'on';
    };
  };
}

export const DEFAULT_VOICE_CONFIG: VoiceSessionConfig = {
  noiseCancellation: true,
  echoCancellation: true,
  autoGainControl: true,
  audioOnly: true,
  dailyConfig: {
    subscribeToTracksAutomatically: true,
    receiveSettings: { video: 'off', audio: 'on' }
  }
};

// room-manager.ts
export interface VoiceRoom {
  roomUrl: string;
  roomName: string;
  token: string;
  reused: boolean;
  expiresAt: Date;
}

export async function getOrCreateVoiceRoom(
  userId: string,
  config?: Partial<VoiceSessionConfig>
): Promise<VoiceRoom>;

export async function leaveVoiceRoom(
  roomUrl: string,
  teardownDelay: number
): Promise<void>;

// token-service.ts
export async function generateVoiceRoomToken(
  roomName: string,
  userId: string
): Promise<string>;

// event-bridge.ts
export function setupVoiceSessionEventBridge(
  callObject: DailyCall,
  callbacks: VoiceEventCallbacks
): () => void;

// audio-manager.ts
export class VoiceAudioManager {
  constructor(callObject: DailyCall);
  getAudioLevel(): number;
  mute(): Promise<void>;
  unmute(): Promise<void>;
  isMuted(): boolean;
  detectSpeech(): Observable<SpeechEvent>;
}
```

### Phase 2: Backend Support (Pipecat)

**Goal**: Add voice-only mode support to pipecat bot

**Changes Required:**

#### 1. Add `voiceOnly` flag to JoinRequest

```python
# apps/pipecat-daily-bot/bot/server.py

class JoinRequest(BaseModel):
    room_url: str | None = None
    personalityId: str | None = None
    persona: str | None = None
    tenantId: str | None = None
    voice: str | None = None
    voiceParameters: VoiceParameters | None = None
    voiceOnly: bool = False  # NEW: voice-only mode flag
    sessionPersistence: int = 300  # NEW: teardown delay in seconds
    # ... existing fields
```

#### 2. Handle voice-only mode in bot initialization

```python
# apps/pipecat-daily-bot/bot/bot.py

async def run_pipeline_session(
    room_url: str,
    personalityId: str,
    persona: str,
    token: str | None = None,
    tenantId: str | None = None,
    voice_only: bool = False,  # NEW
    session_persistence: int = 300,  # NEW
):
    # ... existing setup
    
    # Configure transport for voice-only mode
    if voice_only:
        # Join with camera off
        transport = DailyTransport(
            room_url,
            token,
            "Nia Assistant",
            DailyParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                camera_out_enabled=False,  # Camera off for voice-only
                vad_enabled=True,
                vad_audio_passthrough=True,
                transcription_enabled=True
            )
        )
        logger.info(f"[voice-only] Joining room {room_url} in voice-only mode")
    else:
        # Normal multi-user mode (existing behavior)
        transport = DailyTransport(...)
    
    # Set teardown timer
    empty_room_shutdown_config = {
        'post_leave_idle_secs': float(session_persistence),
        # ... other config
    }
```

#### 3. Update /join endpoint

```python
# apps/pipecat-daily-bot/bot/server.py

@app.post('/join', response_model=JoinResponse)
async def join(req: JoinRequest):
    # ... existing validation
    
    voice_only = req.voiceOnly or False
    session_persistence = req.sessionPersistence or 300
    
    logger.info(
        f'[join] room={room_url} personality={personalityId} '
        f'voice_only={voice_only} persistence={session_persistence}s'
    )
    
    # Pass flags to bot spawn
    if USE_BOT_POOL:
        bot_info = await bot_pool.acquire_bot(
            room_url=room_url,
            personalityId=personalityId,
            persona=persona,
            tenantId=tenantId,
            voice=voice,
            voiceOnly=voice_only,  # NEW
            sessionPersistence=session_persistence,  # NEW
            # ... other params
        )
    else:
        # Direct spawn
        proc = subprocess.Popen([
            sys.executable, '-m', 'bot',
            '--room', room_url,
            # ... other args
            '--voice-only' if voice_only else '',
            '--session-persistence', str(session_persistence),
        ])
```

#### 4. Add CLI arguments to bot.py

```python
# apps/pipecat-daily-bot/bot/bot.py

async def main(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(description="Run Pipecat Daily bot session")
    # ... existing args
    parser.add_argument(
        "--voice-only",
        dest="voiceOnly",
        action="store_true",
        help="Join in voice-only mode (camera off)"
    )
    parser.add_argument(
        "--session-persistence",
        dest="sessionPersistence",
        type=int,
        default=300,
        help="Seconds to persist empty room after user leaves (default: 300)"
    )
    
    args = parser.parse_args(argv or sys.argv[1:])
    
    await run_pipeline_session(
        room_url=args.room_url,
        personalityId=args.personalityId,
        persona=args.persona,
        tenantId=args.tenantId,
        voice_only=args.voiceOnly,  # NEW
        session_persistence=args.sessionPersistence,  # NEW
    )
```

### Phase 3: Voice Session Hook

**Goal**: Create useVoiceSession hook to replace useVapi

**File**: `apps/interface/src/hooks/useVoiceSession.ts`

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import DailyIframe, { DailyCall } from '@daily-co/daily-js';
import { 
  getOrCreateVoiceRoom, 
  generateVoiceRoomToken,
  setupVoiceSessionEventBridge,
  VoiceAudioManager,
  DEFAULT_VOICE_CONFIG
} from '@interface/lib/daily';
import type { TranscriptMessage } from '@interface/types/conversation.types';

export enum SESSION_STATUS {
  INACTIVE = 'inactive',
  CONNECTING = 'connecting',
  ACTIVE = 'active',
  PAUSED = 'paused',
  UNAVAILABLE = 'unavailable',
}

interface UseVoiceSessionOptions {
  userId: string;
  assistantName: string;
  clientLanguage?: string;
  personalityId?: string;
  persona?: string;
  voiceId?: string;
  sessionPersistence?: number; // seconds
}

interface UseVoiceSessionReturn {
  sessionStatus: SESSION_STATUS;
  isSpeaking: boolean;
  audioLevel: number;
  transcript: TranscriptMessage | null;
  messages: Message[];
  start: () => Promise<void>;
  stop: () => Promise<void>;
  toggleSession: () => void;
  sendMessage: (content: string) => void;
}

export function useVoiceSession(options: UseVoiceSessionOptions): UseVoiceSessionReturn {
  const {
    userId,
    assistantName,
    clientLanguage = 'en',
    personalityId = 'pearl',
    persona = 'Pearl',
    voiceId,
    sessionPersistence = 300
  } = options;

  // State (mirrors useVapi interface)
  const [sessionStatus, setSessionStatus] = useState<SESSION_STATUS>(SESSION_STATUS.INACTIVE);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptMessage | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  // Daily.co state
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const callObjectRef = useRef<DailyCall | null>(null);
  const audioManagerRef = useRef<VoiceAudioManager | null>(null);
  const cleanupFnRef = useRef<(() => void) | null>(null);

  // Start voice session
  const start = useCallback(async () => {
    if (sessionStatus !== SESSION_STATUS.INACTIVE) {
      console.warn('[useVoiceSession] Session already active or connecting');
      return;
    }

    try {
      setSessionStatus(SESSION_STATUS.CONNECTING);
      console.log('[useVoiceSession] Starting voice session', { userId, assistantName });

      // 1. Get or create voice room
      const room = await getOrCreateVoiceRoom(userId);
      setRoomUrl(room.roomUrl);
      console.log('[useVoiceSession] Room ready', { 
        roomUrl: room.roomUrl, 
        reused: room.reused 
      });

      // 2. Initialize Daily call object
      if (!callObjectRef.current) {
        callObjectRef.current = DailyIframe.createCallObject({
          url: room.roomUrl,
          token: room.token,
          dailyConfig: DEFAULT_VOICE_CONFIG.dailyConfig,
        });

        // Setup audio manager
        audioManagerRef.current = new VoiceAudioManager(callObjectRef.current);
      }

      // 3. Setup event bridge
      cleanupFnRef.current = setupVoiceSessionEventBridge(callObjectRef.current, {
        onSpeechStart: () => setIsSpeaking(true),
        onSpeechEnd: () => setIsSpeaking(false),
        onTranscript: (msg) => setTranscript(msg),
        onMessage: (msg) => setMessages(prev => [...prev, msg]),
        onAudioLevel: (level) => setAudioLevel(level),
        onError: (error) => {
          console.error('[useVoiceSession] Error:', error);
          setSessionStatus(SESSION_STATUS.UNAVAILABLE);
        }
      });

      // 4. Join Daily room
      await callObjectRef.current.join();
      console.log('[useVoiceSession] Joined Daily room');

      // 5. Call pipecat /join endpoint
      const botJoinResponse = await fetch('/api/bot/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_url: room.roomUrl,
          personalityId,
          persona,
          voice: voiceId,
          voiceOnly: true, // NEW FLAG
          sessionPersistence, // NEW FLAG
          sessionUserId: userId,
        })
      });

      if (!botJoinResponse.ok) {
        throw new Error(`Bot join failed: ${botJoinResponse.status}`);
      }

      const botData = await botJoinResponse.json();
      console.log('[useVoiceSession] Bot joined', { pid: botData.pid });

      setSessionStatus(SESSION_STATUS.ACTIVE);
      console.log('[useVoiceSession] Voice session active');

    } catch (error) {
      console.error('[useVoiceSession] Failed to start session:', error);
      setSessionStatus(SESSION_STATUS.UNAVAILABLE);
      
      // Cleanup on error
      if (callObjectRef.current) {
        await callObjectRef.current.leave();
        await callObjectRef.current.destroy();
        callObjectRef.current = null;
      }
    }
  }, [userId, assistantName, personalityId, persona, voiceId, sessionPersistence, sessionStatus]);

  // Stop voice session
  const stop = useCallback(async () => {
    if (sessionStatus === SESSION_STATUS.INACTIVE) {
      return;
    }

    try {
      console.log('[useVoiceSession] Stopping voice session');
      setSessionStatus(SESSION_STATUS.INACTIVE);

      // 1. Leave Daily room
      if (callObjectRef.current) {
        await callObjectRef.current.leave();
        await callObjectRef.current.destroy();
        callObjectRef.current = null;
      }

      // 2. Cleanup event bridge
      if (cleanupFnRef.current) {
        cleanupFnRef.current();
        cleanupFnRef.current = null;
      }

      // 3. Cleanup audio manager
      audioManagerRef.current = null;

      // 4. Bot will auto-teardown based on sessionPersistence setting
      // No need to call /leave endpoint explicitly

      setRoomUrl(null);
      setIsSpeaking(false);
      setAudioLevel(0);
      setTranscript(null);

      console.log('[useVoiceSession] Voice session stopped');

    } catch (error) {
      console.error('[useVoiceSession] Error stopping session:', error);
    }
  }, [sessionStatus]);

  // Toggle session
  const toggleSession = useCallback(() => {
    if (sessionStatus === SESSION_STATUS.ACTIVE) {
      stop();
    } else if (sessionStatus === SESSION_STATUS.INACTIVE) {
      start();
    }
  }, [sessionStatus, start, stop]);

  // Send message to bot
  const sendMessage = useCallback((content: string) => {
    if (sessionStatus !== SESSION_STATUS.ACTIVE || !callObjectRef.current) {
      console.warn('[useVoiceSession] Cannot send message - session not active');
      return;
    }

    // Send via Daily app message
    callObjectRef.current.sendAppMessage({
      type: 'user-message',
      content,
      timestamp: Date.now()
    });
  }, [sessionStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (callObjectRef.current) {
        callObjectRef.current.leave();
        callObjectRef.current.destroy();
      }
      if (cleanupFnRef.current) {
        cleanupFnRef.current();
      }
    };
  }, []);

  return {
    sessionStatus,
    isSpeaking,
    audioLevel,
    transcript,
    messages,
    start,
    stop,
    toggleSession,
    sendMessage
  };
}
```

### Phase 4: Voice Session Provider

**Goal**: Create context provider to replace SpeechProvider

**File**: `apps/interface/src/contexts/voice-session-context.tsx`

```typescript
'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { useVoiceSession, SESSION_STATUS } from '@interface/hooks/useVoiceSession';

interface VoiceSessionContextType {
  sessionStatus: SESSION_STATUS;
  isAssistantSpeaking: boolean;
  isUserSpeaking: boolean;
  audioLevel: number;
  transcript: any;
  messages: any[];
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  toggleSession: () => void;
  sendMessage: (content: string) => void;
}

const VoiceSessionContext = createContext<VoiceSessionContextType | undefined>(undefined);

export const VoiceSessionProvider: React.FC<{
  children: React.ReactNode;
  assistantName: string;
  clientLanguage?: string;
  personalityId?: string;
  persona?: string;
  voiceId?: string;
}> = ({ children, assistantName, clientLanguage, personalityId, persona, voiceId }) => {
  const { data: session } = useResilientSession();
  const userId = session?.user?.id ?? 'guest';

  const voiceSession = useVoiceSession({
    userId,
    assistantName,
    clientLanguage,
    personalityId,
    persona,
    voiceId
  });

  // Listen for DailyCall events (mutual exclusion)
  const [pausedForDailyCall, setPausedForDailyCall] = useState(false);

  useEffect(() => {
    const handleDailyCallStart = () => {
      console.log('[VoiceSession] DailyCall started - pausing voice session');
      if (voiceSession.sessionStatus === SESSION_STATUS.ACTIVE) {
        // Don't stop completely, just pause/mute
        setPausedForDailyCall(true);
        // TODO: Implement pause logic (mute mic, keep connection)
      }
    };

    const handleDailyCallEnd = () => {
      console.log('[VoiceSession] DailyCall ended - resuming voice session');
      if (pausedForDailyCall) {
        setPausedForDailyCall(false);
        // TODO: Resume (unmute mic)
      }
    };

    window.addEventListener('dailyCall.session.start', handleDailyCallStart);
    window.addEventListener('dailyCall.session.end', handleDailyCallEnd);

    return () => {
      window.removeEventListener('dailyCall.session.start', handleDailyCallStart);
      window.removeEventListener('dailyCall.session.end', handleDailyCallEnd);
    };
  }, [voiceSession.sessionStatus, pausedForDailyCall]);

  const contextValue: VoiceSessionContextType = {
    sessionStatus: pausedForDailyCall ? SESSION_STATUS.PAUSED : voiceSession.sessionStatus,
    isAssistantSpeaking: voiceSession.isSpeaking,
    isUserSpeaking: false, // TODO: Implement user speech detection
    audioLevel: voiceSession.audioLevel,
    transcript: voiceSession.transcript,
    messages: voiceSession.messages,
    startSession: voiceSession.start,
    stopSession: voiceSession.stop,
    toggleSession: voiceSession.toggleSession,
    sendMessage: voiceSession.sendMessage
  };

  return (
    <VoiceSessionContext.Provider value={contextValue}>
      {children}
    </VoiceSessionContext.Provider>
  );
};

export function useVoiceSessionContext() {
  const context = useContext(VoiceSessionContext);
  if (!context) {
    throw new Error('useVoiceSessionContext must be used within VoiceSessionProvider');
  }
  return context;
}
```

### Phase 5: Component Updates

**Goal**: Replace VAPI usage in components

**Files to Update:**

1. **AssistantButton** (`apps/interface/src/components/assistant-button.tsx`)
   - Replace `useVapi` → `useVoiceSessionContext`
   - Update `CALL_STATUS` → `SESSION_STATUS`

2. **AssistantCanvas** (`apps/interface/src/components/assistant-canvas.tsx`)
   - Replace `useVapi` → `useVoiceSessionContext`
   - Update status checks

3. **RiveAvatar** components
   - Update to use `useVoiceSessionContext`
   - Keep same animation triggers

4. **Provider replacement** (`apps/interface/src/providers/client-providers.tsx`)
   ```typescript
   // BEFORE
   <SpeechProvider>
     {children}
   </SpeechProvider>

   // AFTER
   <VoiceSessionProvider
     assistantName={assistantName}
     personalityId={personalityId}
     persona={persona}
     voiceId={voiceId}
   >
     {children}
   </VoiceSessionProvider>
   ```

### Phase 6: Testing & Migration

**Goal**: Validate new system, migrate users

**Testing Checklist:**

- [ ] Voice session creates correct room name format
- [ ] Bot joins with camera off, mic on
- [ ] Audio routing works (user → bot → user)
- [ ] Speech detection triggers animations
- [ ] Transcript updates in real-time
- [ ] Messages flow through event bus
- [ ] DailyCall pauses voice session
- [ ] Voice session resumes after DailyCall ends
- [ ] Session persistence works (reconnect within window)
- [ ] Bot auto-teardown after configured delay
- [ ] Multiple users can't join voice rooms
- [ ] Room privacy prevents uninvited joins

**Migration Strategy:**

1. **Phase 6.1**: Feature flag implementation
   ```typescript
   // env variable
   NEXT_PUBLIC_USE_PIPECAT_VOICE=false

   // provider selection
   {usePipecatVoice ? <VoiceSessionProvider> : <SpeechProvider>}
   ```

2. **Phase 6.2**: Parallel testing
   - Enable for internal testing assistants
   - Monitor logs, errors, performance
   - Gather feedback

3. **Phase 6.3**: Gradual rollout
   - Enable for 10% of assistants
   - Monitor Daily.co usage metrics
   - Compare VAPI vs Pipecat behavior

4. **Phase 6.4**: Full migration
   - Enable for all assistants
   - Remove VAPI SDK dependencies
   - Delete old code

5. **Phase 6.5**: Cleanup
   - Remove feature flags
   - Remove `useVapi` hook
   - Remove `SpeechProvider`
   - Remove `vapi.sdk.ts`
   - Update documentation

---

## Database Schema Changes

### Assistant Record Updates

Add voice session configuration to assistant documents:

```typescript
interface AssistantRecord {
  // ... existing fields
  
  // NEW: Voice session configuration
  voiceSessionConfig?: {
    enabled: boolean;           // Enable pipecat voice (vs VAPI)
    persistence: number;        // Teardown delay in seconds (default: 300)
    roomPrivacy: 'private' | 'public';  // Room privacy level
    maxDuration: number;        // Max session duration in seconds
    autoStart: boolean;         // Auto-start voice on load
  };
}
```

**Migration Script:**

```typescript
// scripts/migrate-assistant-voice-config.ts
import { MongoClient } from 'mongodb';

async function migrateAssistants() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db();
  
  await db.collection('assistants').updateMany(
    { voiceSessionConfig: { $exists: false } },
    {
      $set: {
        voiceSessionConfig: {
          enabled: true,
          persistence: 300,
          roomPrivacy: 'private',
          maxDuration: 3600,
          autoStart: false
        }
      }
    }
  );
  
  console.log('Migration complete');
  await client.close();
}
```

---

## Configuration Files

### Voice Session Config

**File**: `apps/interface/src/lib/daily/config.ts`

```typescript
export interface VoiceSessionConfig {
  // Audio settings
  noiseCancellation: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  
  // Session settings
  audioOnly: boolean;
  maxDuration: number;          // seconds
  defaultPersistence: number;   // seconds
  reconnectWindow: number;      // seconds
  
  // Daily.co settings
  dailyConfig: {
    subscribeToTracksAutomatically: boolean;
    receiveSettings: {
      video: 'off';
      audio: 'on';
    };
    inputSettings: {
      audio: {
        processor: {
          type: 'noise-cancellation';
        };
      };
    };
  };
  
  // Room settings
  roomPrivacy: 'private' | 'public';
  maxParticipants: number;
  enableKnocking: boolean;
  enableScreenshare: boolean;
}

export const DEFAULT_VOICE_CONFIG: VoiceSessionConfig = {
  noiseCancellation: true,
  echoCancellation: true,
  autoGainControl: true,
  audioOnly: true,
  maxDuration: 3600,
  defaultPersistence: 300,
  reconnectWindow: 300,
  dailyConfig: {
    subscribeToTracksAutomatically: true,
    receiveSettings: {
      video: 'off',
      audio: 'on'
    },
    inputSettings: {
      audio: {
        processor: {
          type: 'noise-cancellation'
        }
      }
    }
  },
  roomPrivacy: 'private',
  maxParticipants: 2,
  enableKnocking: false,
  enableScreenshare: false
};

// Environment overrides
export const VOICE_SESSION_CONFIG = {
  ...DEFAULT_VOICE_CONFIG,
  maxDuration: parseInt(process.env.NEXT_PUBLIC_VOICE_MAX_DURATION || '3600'),
  defaultPersistence: parseInt(process.env.NEXT_PUBLIC_VOICE_PERSISTENCE || '300'),
};
```

---

## API Endpoints

### Voice Room Management

**File**: `apps/interface/src/app/api/voice/room/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateVoiceRoom, leaveVoiceRoom } from '@interface/lib/daily/room-manager';
import { getServerSession } from 'next-auth';

// POST /api/voice/room - Get or create voice room
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { assistantName } = await req.json();
    const room = await getOrCreateVoiceRoom(session.user.id);
    
    return NextResponse.json({
      roomUrl: room.roomUrl,
      token: room.token,
      reused: room.reused,
      expiresAt: room.expiresAt
    });
  } catch (error) {
    console.error('[API] Voice room creation failed:', error);
    return NextResponse.json({ error: 'Room creation failed' }, { status: 500 });
  }
}

// DELETE /api/voice/room - Leave voice room
export async function DELETE(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { roomUrl, teardownDelay } = await req.json();
    await leaveVoiceRoom(roomUrl, teardownDelay);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Voice room leave failed:', error);
    return NextResponse.json({ error: 'Leave failed' }, { status: 500 });
  }
}
```

---

## Monitoring & Observability

### Metrics to Track

1. **Voice Session Metrics:**
   - Sessions created per hour/day
   - Average session duration
   - Room reuse rate
   - Bot join latency
   - Audio quality metrics

2. **Daily.co Usage:**
   - Active rooms count
   - Minutes consumed
   - Participant count
   - Token generation rate

3. **Pipecat Bot Metrics:**
   - Bot spawn time
   - Bot pool utilization
   - Voice-only vs multi-user ratio
   - Tool usage in voice sessions

4. **Error Rates:**
   - Room creation failures
   - Bot join failures
   - Audio routing issues
   - Token expiration events

### Logging Standards

```typescript
// Use consistent logging prefix
console.log('[VoiceSession]', event, metadata);
console.log('[DailyRoom]', event, metadata);
console.log('[BotJoin]', event, metadata);

// Example
console.log('[VoiceSession] Session started', {
  userId,
  roomUrl,
  reused: true,
  latency: 234
});
```

---

## Rollback Plan

### If Issues Arise

1. **Immediate Rollback:**
   ```bash
   # Set feature flag
   NEXT_PUBLIC_USE_PIPECAT_VOICE=false
   
   # Redeploy
   npm run build
   ```

2. **Partial Rollback:**
   - Disable for specific assistants via database flag
   - Keep for internal testing only

3. **Data Preservation:**
   - Voice room data in Daily.co
   - Pipecat logs preserved
   - Event bus logs retained

4. **User Communication:**
   - In-app notification of voice system change
   - Fallback messaging if issues detected

---

## Timeline Estimate

- **Phase 1** (Shared Daily Library): 2-3 days
- **Phase 2** (Backend Support): 2 days
- **Phase 3** (Voice Session Hook): 2-3 days
- **Phase 4** (Voice Session Provider): 1-2 days
- **Phase 5** (Component Updates): 2 days
- **Phase 6** (Testing & Migration): 3-5 days

**Total**: 12-17 days (2.5-3.5 weeks)

---

## Questions & Decisions

✅ **Resolved:**
1. Room reuse strategy → User-specific persistent rooms
2. Bot join mode → Voice-only flag (camera off)
3. Room privacy → Private rooms with max 2 participants
4. Daily SDK management → Single call object, mutually exclusive
5. Event integration → Unified event bus
6. Mutual exclusion → DailyCall pauses voice session
7. Backward compatibility → No VAPI fallback
8. State management → Separate providers
9. Performance → Lazy load Daily SDK
10. Testing → Manual testing, no automated VAPI tests to port

---

## Success Criteria

- ✅ Voice sessions work seamlessly (audio quality, latency)
- ✅ Bot joins correctly with voice-only configuration
- ✅ Room persistence prevents unnecessary reconnects
- ✅ DailyCall and voice session never conflict
- ✅ Event bus delivers all events (speech, transcript, tools)
- ✅ UI components show correct state
- ✅ No regression in existing DailyCall feature
- ✅ Daily.co costs remain within budget
- ✅ User experience matches or exceeds VAPI
- ✅ Documentation updated, VAPI code removed

---

## Next Steps

1. **Review this plan** with team
2. **Approve** architecture decisions
3. **Create** feature branch: `feature/voice-session-pipecat`
4. **Begin Phase 1**: Shared Daily Library implementation
5. **Daily standups** to track progress
6. **Weekly demos** to validate incremental progress

---

*Document Status: Ready for Review*  
*Last Updated: October 24, 2025*
