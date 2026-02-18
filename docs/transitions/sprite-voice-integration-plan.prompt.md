# Sprite Voice Integration - Architecture & Implementation Plan

> **Status:** Phase 3 In Progress  
> **Author:** AI Assistant + Jeffrey Klug  
> **Created:** 2026-01-06  
> **Last Updated:** 2026-01-06

---

## COPILOT: you will continue to update the status of this document as you complete each step in each phase

---

## STICKY PROMPT — Remaining Work

**Use this section as context for continued implementation.**

### Completed ✅
- Phase 1: Bot infrastructure (lock, Sprite resolution, user text formatting, context chain)
- Phase 2: Prism/Platform (sprite.block.ts, Sprite.definition.ts, sprite-actions.ts, registration)
- Phase 3 partial: VoiceSessionContext lift, SummonSpritePrompt wiring, RiveAvatar idle state
- Phase 3: **Sprite persistence** — summon-ai-sprite API now creates Prism Sprite records with:
  - Base64-encoded GIF data
  - Generated personality prompt
  - Hardcoded voice defaults: `kokoro` provider, `am_fenrir` voice ID
- Phase 3: **Bug Fix — spriteId** — Fixed `enableSpriteVoice()` to pass Prism record ID instead of sprite name
- Phase 3: **Saved Sprites Recall** — Added APIs and UI for loading saved sprites from Prism:
  - `GET /api/summon-ai-sprite/list` — Lists user's sprites (without gifData)
  - `GET /api/summon-ai-sprite/[id]` — Fetches single sprite with full data
  - Recall button: 0 sprites = hidden, 1 sprite = direct load, 2+ = dropdown
- Phase 3: **Text-Only Chat Logging** — Added comprehensive logging for debugging:
  - Frontend: `[SummonSpritePrompt]` prefixed console logs in `sendChat()`
  - Backend: Structured logger (`api:summon-ai-sprite:chat`) for request/response tracing
- Phase 3: **Sprite Deletion** — UI delete button closes voice session, dismisses sprite, and deletes Prism record with toast feedback
- Phase 3: **Random Voice Selection** — Sprites get random Kokoro voices with gender/accent weighting:
  - Gender inference from prompt keywords (female/male names, pronouns, roles)
  - Accent weighting: 60% American, 40% British
  - Gender weighting when unknown: 60% female, 40% male
  - Combined probabilities: 36% AF, 24% AM, 24% BF, 16% BM
- Phase 3: **Persona Name** — Sprite voice sessions now include sprite name as `persona`:
  - `generateSpriteName()` creates display name from first 3 words of prompt
  - Frontend passes `spriteName` through `enableSpriteVoice()` → `updateBotConfig()`
  - Bot receives `persona` field for participant identification and name-based interaction
- Phase 3: **Disable Smart Silence for Sprites** — Sprites are characters that should always respond:
  - Bot config listener checks `mode === 'sprite'` and skips `SMART_SILENCE_NOTE`
  - Prevents over-silent behavior where sprites wouldn't respond to casual conversation

---

## 🧪 TESTING CHECKPOINT — 2026-01-06

**Ready to test the following fixes:**

### Test 1: Sprite Voice Activation (Critical)
**What was fixed:** `enableSpriteVoice()` was receiving sprite NAME instead of Prism record ID
**How to test:**
1. Start a voice session (click bell on RiveAvatar)
2. Summon a sprite via voice: "Summon a funny robot"
3. Wait for sprite to appear
4. Click the sprite GIF
5. **Expected:** Voice should switch to sprite personality, RiveAvatar goes idle
6. **Check logs:** Look for `enableSpriteVoice` call with UUID format (not text description)

### Test 2: Text-Only Chat (Fallback Mode)
**What was added:** Comprehensive logging for debugging stateless Ollama chat
**How to test:**
1. Summon a sprite (voice or via UI)
2. Do NOT click the sprite GIF (stay in text mode)
3. Type a message in the text input
4. **Expected:** Response appears in chat bubble
5. **Check browser console:** Look for `[SummonSpritePrompt]` prefixed logs
6. **Check interface pod logs:** Look for `api:summon-ai-sprite:chat` logger output

### Test 3: Saved Sprites Recall
**What was added:** List/get APIs and recall UI
**How to test:**
1. Summon a sprite (creates a Prism record)
2. Close the sprite
3. Click "Recall" button
4. **Expected (1 saved sprite):** Sprite loads directly
5. **Expected (2+ saved sprites):** Dropdown appears with sprite list
6. Select a sprite from dropdown
7. **Expected:** Sprite fully restores (GIF, name, personality)

### Log Locations
- **Browser console:** `[SummonSpritePrompt]` prefix
- **Interface pod:** `kubectl logs -n default -l app=interface-stg -c web --tail=100 | grep summon-ai-sprite`
- **Local dev:** Terminal running `npm run dev` in interface workspace

---

### Remaining Work 🔧

#### Phase 3: Click-to-Talk Activation (NEW)
- [ ] **Sprite GIF click handler** — clicking the Sprite GIF starts voice session (like RiveAvatar bell button)
- [ ] **Play magicbell.wav** — browser audio feedback on:
  - Starting a new voice session via Sprite click
  - Transitioning to Sprite personality during an active voice session
- [ ] **Default to text mode** — when Sprite is summoned, do NOT auto-start voice; user must click GIF
- [ ] **Visual affordance** — show "Click to talk" hint or pulsing border on GIF when voice available

#### Phase 3: Remaining Integration
- [ ] Implement `enableSpriteVoice()` / `disableSpriteVoice()` actions
- [ ] Handle DailyCall pause/resume for Sprite voice
- [ ] Ensure onboarding resumes when Sprite dismissed

### Known Gaps (TBD) 🚧

#### Gap 1: Text-Only Mode Has No Conversation Context
**Current behavior:** Each text chat request is stateless — only sends system prompt + current message. No multi-turn conversation history.

**Impact:** User can't have back-and-forth text conversations with context ("What did I just ask you?").

**Options to consider:**
1. **Client-side history** — Maintain message array in React state, send full history with each request
2. **Server-side sessions** — Store conversation by sessionId in Redis/DB
3. **Zero-voice Daily session** — Start a bot session without audio, use admin API for text
4. **Accept limitation** — Text mode is for quick Q&A; real conversations use voice

**Recommendation:** For POC, keep stateless. Document as enhancement.

#### Gap 2: Text → Voice Transition Loses Context
**Current behavior:** If user chats via text, then clicks GIF to start voice, the voice session starts fresh with no knowledge of the text conversation.

**Impact:** Conversation continuity is broken when switching modes.

**Options to consider:**
1. **Inject text history** — When starting voice, serialize text chat history and send as context injection to bot
2. **Always use bot backend** — Route all text through admin API (requires active session)
3. **Summary injection** — Summarize text conversation and inject as "previous context" prompt
4. ⭐ **Zero-voice Daily session upgrade** — Start Daily session with audio disabled, upgrade mid-conversation:
   ```
   Sprite summon → Join Daily with audioSource: false + bot TTS disabled
                 → Text via admin API (context accumulates)
                 → Click GIF → setLocalAudio(true) + enable bot TTS
                 → Voice continues with FULL CONTEXT
   ```
   **Pros:** Single session, unified context, seamless UX
   **Cons:** Bot resource usage during text-only phase, needs "text-only mode" flag for bot

**Recommendation:** Option 4 (zero-voice upgrade) is the cleanest solution for unified context. Implement post-POC.

---

#### Phase 4: Testing
- [ ] Bot: switchPersonality handler with lock
- [ ] Bot: User text queue during speech
- [ ] Bot: Personality resolution (OS + Sprite)
- [ ] Frontend: Click-to-talk activation
- [ ] Frontend: DailyCall pause/resume
- [ ] Integration: OS → Sprite → OS switching
- [ ] Integration: Text + voice unified context

### Key Files for Remaining Work
```
apps/interface/src/components/summon-sprite/SummonSpritePrompt.tsx  # Click handler, magicbell
apps/interface/src/contexts/voice-session-context.tsx               # enableSpriteVoice action
apps/interface/src/hooks/useVoiceSession.ts                         # Voice session start
public/sounds/magicbell.wav                                         # Audio file (verify exists)
```

### Click-to-Talk Flow
```
User summons Sprite (text or voice command)
    │
    ▼
Sprite renders with GIF + text chat (TEXT MODE)
    │
    ├─── User types in text box → /api/summon-ai-sprite/chat (existing)
    │
    └─── User clicks Sprite GIF
            │
            ├─── If voice session INACTIVE:
            │        1. Play magicbell.wav
            │        2. Start voice session (like bell button click)
            │        3. Switch to Sprite personality
            │        4. Set activeSpriteVoice = true
            │
            └─── If voice session ACTIVE:
                     1. Play magicbell.wav
                     2. Switch to Sprite personality (admin API)
                     3. Set activeSpriteVoice = true
```

---

## Executive Summary

This document outlines the architecture for adding voice capabilities to the Sprite feature. Users can have voice conversations with Sprite characters using the existing pipecat voice infrastructure. When a Sprite is summoned during an active voice session, voice automatically routes to the Sprite until dismissed.

---

## 1. Feature Overview

### 1.1 Current Sprite Feature

The merged Sprite feature provides:

- **Visual:** Pixelated GIF character generated via ComfyUI workflows
- **Chat Bubble:** Speech/response display above the character  
- **Text Input:** Chat-style text box beneath the character
- **Controls:** Summon, Reset, Close, Recall (restore last sprite)
- **Chat:** Text-based LLM chat via OpenAI (gpt-4o-mini)
- **Voice Trigger:** Bot tool `bot_summon_sprite` emits `sprite.summon` event

**Key Files:**
| Component | Path |
|-----------|------|
| Widget UI | `apps/interface/src/components/summon-sprite/SummonSpritePrompt.tsx` |
| Generate API | `apps/interface/src/app/api/summon-ai-sprite/route.ts` |
| Chat API | `apps/interface/src/app/api/summon-ai-sprite/chat/route.ts` |
| Bot Tool | `apps/pipecat-daily-bot/bot/tools/sprite_tools.py` |
| Feature Flag | `packages/features/src/feature-flags.ts` (`summonSpriteTool`) |

### 1.2 Voice Integration Goals

1. **Voice Conversations:** Speak with Sprite characters using existing voice infrastructure
2. **Click-to-Talk:** Sprite defaults to text mode; clicking GIF activates voice (plays `magicbell.wav`)
3. **Seamless Transition:** If already in voice session, clicking Sprite switches personality with audio cue
4. **One Sprite at a Time:** Single active Sprite per session
5. **Unified Text/Voice:** Text and voice share the same conversation context
6. **Visual Coordination:** RiveAvatar goes idle when Sprite voice is active
7. **DailyCall Handling:** Sprite voice pauses during DailyCall, resumes after
8. **Onboarding Compatibility:** Closing Sprite resumes onboarding if active

---

## 2. Architecture

### 2.1 Personality Switching

Personality switching updates the system prompt and voice config. **Messages remain intact across switches** — the Sprite sees the full conversation history including prior Pearl interactions.

```
┌─────────────────────────────────────────────────────────────┐
│                    Bot Session                               │
├─────────────────────────────────────────────────────────────┤
│  Active: sprite_char_123                                     │
│                                                              │
│  system_prompt: "You are a friendly dragon..."               │
│  voice_config: { provider: 'kokoro', voice_id: '...' }       │
│                                                              │
│  messages: [                                                 │
│    {role: 'user', content: 'Hello Pearl'},                   │
│    {role: 'assistant', content: 'Hi there!'},                │
│    {role: 'user', content: 'Hello dragon'},                  │
│    {role: 'assistant', content: 'Greetings, adventurer!'}    │
│  ]                                                           │
└─────────────────────────────────────────────────────────────┘
```

This simplifies implementation — we leverage the existing `_update_personality_config()` behavior with an added `asyncio.Lock` to prevent race conditions.

### 2.2 Text/Voice Unification

Text input routes through the existing Admin Message API (`/api/bot/admin` → Redis → bot). The bot:
1. Detects `sourceType: 'user-text'` in the message context
2. Queues the message if currently speaking
3. Fires queued messages when speech ends
4. Formats as `[Message from user {name}]: {content}` to distinguish from admin directives

```
Frontend                          API                           Bot
   │                               │                             │
   │ sendInstruction(text,         │                             │
   │   'sprite-chat',              │                             │
   │   { sourceType: 'user-text',  │                             │
   │     userName, personalityId })│                             │
   │ ─────────────────────────────►│                             │
   │                               │ redis.lpush(...)            │
   │                               │────────────────────────────►│
   │                               │                             │ if speaking: queue
   │                               │                             │ else: inject to LLM
   │                               │                             │
   │◄────────────────────────────────────────────────────────────│
   │                         transcript event                    │
```

### 2.3 Transcript Delivery

`VoiceSessionContext` exposes `messages[]` and `activeTranscript` for consumers. `SummonSpritePrompt` subscribes to these for chat bubble display — no separate transcript subscription needed.

```typescript
// SummonSpritePrompt.tsx
const { messages, activeTranscript } = useVoiceSessionContext();
```

### 2.4 DailyCall Interaction

When a DailyCall starts:
- Sprite voice pauses (personality switch blocked by `session_override_locked`)
- Track `spriteVoiceWasPaused` flag

When DailyCall ends:
- If flag set, restore Sprite voice automatically

If user opens Sprite during DailyCall:
- Sprite renders (GIF + text chat)
- Voice unavailable until call ends
- UI shows "Voice available after call"

---

## 3. Data Model

### 3.1 Sprite Content Type

User-owned record with embedded personality, voice configuration, and GIF binary.

```typescript
// packages/prism/src/core/blocks/sprite.block.ts
interface ISprite {
  _id: string;
  parent_id: string;          // userId (owner)
  tenantId: string;
  
  // Identity
  name: string;
  description: string;
  originalRequest: string;    // User's original summon prompt (e.g. "a wise old turtle who loves jazz")
  
  // Visual — GIF stored as base64 for persistence across sessions
  gifData: string;            // Base64-encoded GIF binary
  gifMimeType: string;        // 'image/gif'
  
  // Personality
  primaryPrompt: string;
  
  // Voice (Kokoro for POC)
  voiceProvider: 'kokoro';
  voiceId: string;
  voiceParameters?: Record<string, unknown>;
  
  // Memory (future: richer conversation summaries)
  lastConversationSummary?: string;
  lastConversationAt?: Date;
  
  createdAt: Date;
  updatedAt: Date;
}
```

**GIF Storage Notes:**
- ComfyUI returns a temporary URL; we fetch the binary and encode as base64
- Typical GIF size: 100KB–2MB → base64 adds ~33% overhead → trivial for Postgres TEXT columns
- On load, decode and create object URL: `URL.createObjectURL(new Blob([decode(gifData)], { type: gifMimeType }))`

**Schema Registration:**
- This TypeScript interface will be duplicated as a `jsonSchema` in the Prism platform-definitions
- Location: `packages/prism/src/platform-definitions/sprite.definition.ts`
- The jsonSchema enables runtime validation and Mesh type generation

### 3.2 Personality Resolution

The bot resolves personality from multiple content types:

```python
async def resolve_personality(personality_id: str) -> PersonalityData:
    # Try Personality content type first
    result = await mesh_client.get_content('Personality', personality_id)
    if result:
        return normalize_personality(result)
    
    # Try Sprite content type
    result = await mesh_client.get_content('Sprite', personality_id)
    if result:
        return normalize_sprite_to_personality(result)
    
    raise PersonalityNotFound(personality_id)
```

---

## 4. Frontend Integration

### 4.1 Voice Session Context Extensions

Add to `VoiceSessionContext`:

```typescript
interface VoiceSessionContextValue {
  // Existing...
  
  // Transcript state (lifted from useVoiceSession local state)
  messages: TranscriptMessage[];
  activeTranscript: TranscriptMessage | null;
  
  // Sprite voice state
  activeSpriteId: string | null;
  activeSpriteVoice: boolean;
  spriteVoiceWasPaused: boolean;  // For DailyCall resume
}
```

### 4.2 SummonSpritePrompt Integration

```typescript
const SummonSpritePrompt = () => {
  const { 
    messages,
    activeTranscript,
    callStatus,
    roomUrl,
    activeSpriteVoice,
    toggleCall,
  } = useVoiceSessionContext();

  const isVoiceActive = callStatus === 'active';

  // Play magicbell.wav audio feedback
  const playMagicBell = useCallback(() => {
    const audio = new Audio('/sounds/magicbell.wav');
    audio.play().catch(err => console.warn('Audio play failed:', err));
  }, []);

  // Click-to-talk: clicking Sprite GIF activates voice
  const handleSpriteClick = async () => {
    if (!sprite) return;
    
    playMagicBell();
    
    if (!isVoiceActive) {
      // Start new voice session (like bell button click)
      toggleCall?.();
      // Voice session will start, then we switch personality
      // Use effect to detect session start and switch
    } else {
      // Already in voice session — just switch personality
      await switchToSpritePersonality(sprite.id);
    }
    
    setActiveSpriteVoice(true);
  };

  // Send text — bot handles queuing if speaking
  const sendChat = async (text: string) => {
    if (activeSpriteVoice && isVoiceActive) {
      await sendTextToBot(text);  // Routes through admin API
    } else {
      // Fallback to direct API (no voice session)
      await fetch('/api/summon-ai-sprite/chat', { ... });
    }
  };

  // Dismiss sprite — return to OS personality
  const dismissSprite = async () => {
    if (activeSpriteVoice) {
      await disableSpriteVoice();
      // If onboarding was active, it resumes automatically
    }
    setSprite(null);
  };

  return (
    <>
      {/* Sprite GIF — clickable to start voice */}
      <div 
        onClick={handleSpriteClick}
        className="cursor-pointer hover:ring-2 hover:ring-indigo-400"
        title="Click to talk"
      >
        <img src={avatarUrl} alt="Sprite" />
      </div>
      {/* Chat bubble, text input, etc. */}
    </>
  );
};
```

### 4.3 RiveAvatar Idle State

```typescript
const avatarMode = useMemo(() => {
  if (!isVoiceActive) return 'offline';
  if (activeDailyCall) return 'idle';
  if (activeSpriteVoice) return 'idle';  // Sprite has voice focus
  return 'active';
}, [isVoiceActive, activeDailyCall, activeSpriteVoice]);
```

---

## 5. Bot Implementation

### 5.1 Config Listener Updates

```python
# config_listener.py

_config_lock = asyncio.Lock()

async def handle_switch_personality(msg: dict) -> None:
    """Switch personality with race condition protection."""
    async with _config_lock:
        personality_id = msg['personalityId']
        
        # Validate tenant
        tenant_id = TenantContextFromMetadata()
        if not tenant_id:
            await emit_error_event('personality_switch_failed', 'Missing tenant context')
            return
        
        try:
            personality = await resolve_personality(personality_id)
        except PersonalityNotFound:
            await emit_error_event('personality_switch_failed', f'Personality not found: {personality_id}')
            return
        
        # Apply system prompt (messages unchanged)
        await apply_system_prompt(personality.primary_prompt)
        
        # Apply voice config
        voice_config = msg.get('voiceConfig') or {
            'provider': personality.voice_provider,
            'voiceId': personality.voice_id,
        }
        await apply_voice_config(voice_config)
        
        current_personality_id = personality_id
        log.info(f"Switched to personality: {personality_id}")
```

### 5.2 User Text Message Handler

```python
# admin_handlers.py

_pending_user_messages: list[dict] = []

async def on_llm_context_message(msg: str) -> None:
    payload = json.loads(msg)
    content = payload['content']
    context = payload.get('context', {})
    
    if context.get('sourceType') == 'user-text':
        formatted = f"[Message from user {context['userName']}]: {content}"
        
        if is_speaking:
            # Queue for later
            _pending_user_messages.append({'role': 'user', 'content': formatted})
            return
    else:
        formatted = f"[Instruction from admin]: {content}"
    
    await inject_message({'role': 'user', 'content': formatted})

async def on_speech_ended() -> None:
    """Flush queued user messages when bot stops speaking."""
    while _pending_user_messages:
        msg = _pending_user_messages.pop(0)
        await inject_message(msg)
```

---

## 6. Implementation Checklist

### Phase 1: Bot Infrastructure ✅ COMPLETE

- [x] Add `asyncio.Lock` to `_update_personality_config()`
- [x] Add `switchPersonality` message handler (via existing config_listener)
- [x] Extend `resolve_personality()` for Sprite content type
- [x] Implement user text message formatting with attribution
- [x] Add context parameter chain (API → bot-messaging-server → Redis → bot)
- [ ] Implement user text message queuing (queue while speaking) — *deferred*
- [ ] Add error event emission for personality switch failures — *deferred*

### Phase 2: Prism/Platform ✅ COMPLETE

- [x] Create `sprite.block.ts` with schema
- [x] Create `Sprite.definition.ts` for platform registration (including `jsonSchema`)
- [x] Create `sprite-actions.ts` for CRUD operations
- [x] Register Sprite in block index and platform-definitions index

### Phase 3: Frontend Integration 🔧 IN PROGRESS

**Completed:**
- [x] Lift `messages[]` and `activeTranscript` to `VoiceSessionContext`
- [x] Add `activeSpriteId`, `activeSpriteVoice`, `spriteVoiceWasPaused` state
- [x] Update RiveAvatar mode derivation for Sprite idle state
- [x] Wire SummonSpritePrompt to consume voice context
- [x] Add `context` parameter support for user text attribution

**Remaining:**
- [ ] **Click-to-talk handler** — clicking Sprite GIF starts/transitions voice
- [ ] **Play magicbell.wav** — audio feedback on voice activation
- [ ] **Visual affordance** — hover state / "click to talk" hint on GIF
- [ ] Implement `enableSpriteVoice()` / `disableSpriteVoice()` actions
- [ ] Handle DailyCall pause/resume for Sprite voice
- [ ] Ensure onboarding resumes when Sprite dismissed

### Phase 4: Testing

- [ ] Bot: switchPersonality handler with lock
- [ ] Bot: User text queue during speech
- [ ] Bot: Personality resolution (OS + Sprite)
- [ ] Frontend: Click-to-talk activation
- [ ] Frontend: Magicbell audio playback
- [ ] Frontend: DailyCall pause/resume
- [ ] Integration: OS → Sprite → OS switching
- [ ] Integration: Text + voice unified context

---

## 7. Future Enhancements

### 7.1 Sprite Conversation Memory

Currently, session summaries are stored in user profile. Future enhancement: store per-Sprite conversation summaries in the Sprite record's `lastConversationSummary` field for personality-specific memory.

### 7.2 Richer Summaries

The current summarization prompt is minimal. Enhance to capture:
- Key topics discussed
- User preferences learned
- Emotional tone
- Action items or follow-ups

### 7.3 Multiple Voice Providers

POC uses Kokoro for all Sprites. Future: allow per-Sprite voice provider selection (ElevenLabs, Cartesia, etc.) with provider-specific voice IDs.

---

## Appendix: File Locations

```
Bot (Python):
├── apps/pipecat-daily-bot/bot/
│   ├── session/config_listener.py     # MODIFY: Add lock, switchPersonality
│   ├── handlers/admin_handlers.py     # MODIFY: User text queuing
│   └── actions/personality_actions.py # MODIFY: Sprite resolution

Prism (TypeScript):
├── packages/prism/src/core/
│   ├── blocks/sprite.block.ts         # NEW
│   └── actions/sprite-actions.ts      # NEW

Frontend (React):
├── apps/interface/src/
│   ├── contexts/VoiceSessionContext.tsx  # MODIFY: Add messages, sprite state
│   ├── hooks/useVoiceSession.ts          # MODIFY: Sync to context
│   └── components/summon-sprite/
│       └── SummonSpritePrompt.tsx        # MODIFY: Voice integration
```
