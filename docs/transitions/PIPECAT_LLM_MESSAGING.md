# Pipecat LLM Messaging Migration Guide

## Overview

This document proposes a drop-in replacement for legacy VAPI `vapi.send()` calls to inject messages into the pipecat bot's LLM conversation context.

## Key Architectural Decisions

### 1. **Abstract Provider Pattern** ✅
- **Decision:** Use `LLMMessageProvider` interface, not direct Daily dependency
- **Rationale:** Decouples components from transport, enables testing, future flexibility
- **Implementation:** Components call `sendLLMMessage(provider, options)`

### 2. **Shared Library** ✅  
- **Decision:** Create `packages/nia-shared/src/llm-messaging/` package
- **Rationale:** Reusable by all components including DailyCall admin UI
- **Benefit:** Single source of truth, consistent behavior across codebase

### 3. **No Admin Privilege Requirement** ✅
- **Decision:** Remove auth checks from bot message handler, keep at route layer only
- **Rationale:** System-generated messages shouldn't require admin status
- **UI Impact:** DailyCall UI keeps admin checks for user-initiated messages
- **Event Type:** New `llm-context-message` type (no privilege check) vs `admin-message` (legacy)

### 4. **Reuse Existing Infrastructure** ✅
- **Decision:** Leverage existing admin message flow mechanism
- **Rationale:** Already tested, handles immediate/queued modes, proper event routing
- **Change:** Just add new event type without privilege checks

### 5. **Voice Session Wiring** ✅
- **Decision:** `useLLMMessageProvider()` hook wires to voice-only Daily session
- **Rationale:** Components don't manage Daily connection, just get provider
- **Benefit:** Centralized session management, easier to swap providers

## Current State

### Legacy VAPI Pattern (TO BE REPLACED)

```typescript
// Old way - directly sent messages to VAPI LLM
vapi.send({
  type: MessageTypeEnum.ADD_MESSAGE,
  message: {
    role: 'system' | 'assistant',
    content: 'Message content here'
  }
});
```

### Current Pipecat Architecture

**Message Flow:**
```
Frontend Component
  ↓ (sendAppMessage)
Daily WebRTC Transport
  ↓ (app-message event)
Pipecat Bot Transport
  ↓ (app_message_forwarder.handle_incoming)
Event Bus
  ↓ (subscribe handlers)
Bot Handlers
  ↓ (LLMMessagesAppendFrame)
OpenAI LLM Context
```

## Problem Analysis

### Where TODO Comments Appear

Found in 29+ locations across:
- `apps/interface/src/components/auth.tsx` (6 instances)
- `apps/interface/src/features/Gmail/components/GmailViewWithAuth.tsx` (1 instance)
- `apps/interface/src/features/MiniBrowser/components/EnhancedMiniBrowserView.tsx` (2 instances)
- `apps/interface/src/features/Notes/components/notes-view.tsx` (14 instances)
- `apps/interface/src/features/YouTube/components/youtube-view.tsx` (7 instances)

### Use Cases

1. **System notifications** - Inform LLM about component state changes
2. **Context injection** - Provide real-time data to LLM (e.g., YouTube comments, search results)
3. **User feedback** - Relay success/error messages through the assistant
4. **Dialog prompts** - Ask LLM to handle user confirmations
5. **Event listeners** - VAPI speech-start/end/volume events (different problem - may not need migration)

## Proposed Solutions

### Solution 1: Shared Message Provider (RECOMMENDED)

**Pros:**
- ✅ Uses existing tested infrastructure
- ✅ Supports immediate vs queued modes
- ✅ Abstract provider pattern - decoupled from Daily
- ✅ No admin privilege requirement (auth at route layer)
- ✅ Shared library - reusable by DailyCall and components
- ✅ Event-based response tracking
- ✅ Works with any transport provider

**Cons:**
- ⚠️ Requires minor refactor of DailyCall admin message UI
- ⚠️ Need to create shared lib interface

**Architecture:**

```
Component (Notes, YouTube, Auth, etc.)
  ↓ calls sendLLMMessage(provider, options)
Shared Library (LLMMessageProvider interface)
  ↓ provider.sendMessage(payload)
Voice Session Provider (useVoiceSession)
  ↓ daily.sendAppMessage()
Daily WebRTC Transport
  ↓
Pipecat Bot (no auth check - route layer handles it)
```

**Implementation:**

```typescript
// Shared library interface
// Location: packages/nia-shared/src/llm-messaging/types.ts

export interface LLMMessageProvider {
  /**
   * Send a message through the provider (Daily, HTTP, etc.)
   */
  sendMessage(payload: unknown): Promise<void>;
  
  /**
   * Check if provider is available/ready
   */
  isReady(): boolean;
}

export interface SendLLMMessageOptions {
  content: string;
  role?: 'system' | 'assistant';
  mode?: 'immediate' | 'queued';
  senderId?: string;
  senderName?: string;
}

// Location: packages/nia-shared/src/llm-messaging/index.ts

/**
 * Send a message to the Pipecat LLM context via abstract provider.
 * Drop-in replacement for vapi.send({ type: MessageTypeEnum.ADD_MESSAGE, ... })
 * 
 * @param provider - Transport provider (Daily session, HTTP client, etc.)
 * @param options - Message content and delivery options
 */
export async function sendLLMMessage(
  provider: LLMMessageProvider | null,
  options: SendLLMMessageOptions
): Promise<void> {
  if (!provider || !provider.isReady()) {
    console.warn('[sendLLMMessage] No provider available or provider not ready');
    return;
  }

  const {
    content,
    role = 'system',
    mode = 'queued',
    senderId = 'system',
    senderName = 'System'
  } = options;

  try {
    await provider.sendMessage({
      type: 'llm-context-message', // New type - no admin restriction
      prompt: content,
      role: role,
      mode: mode,
      senderId: senderId,
      senderName: senderName,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[sendLLMMessage] Failed to send message:', error);
    throw error;
  }
}

/**
 * Create a message dispatcher with a send() method.
 * Useful for gradual migration or creating reusable message senders.
 */
export function createMessageDispatcher(provider: LLMMessageProvider | null) {
  return {
    send: (message: { type: string; message: { role: string; content: string } }) => {
      if (message.type === 'add-message' || message.type === MessageTypeEnum.ADD_MESSAGE) {
        return sendLLMMessage(provider, {
          content: message.message.content,
          role: message.message.role as 'system' | 'assistant',
          mode: 'queued'
        });
      }
      console.warn('[message-dispatcher] Unsupported message type:', message.type);
    }
  };
}

// Daily provider implementation
// Location: packages/nia-shared/src/llm-messaging/providers/daily-provider.ts

import { DailyCall } from '@daily-co/daily-js';

export class DailyLLMMessageProvider implements LLMMessageProvider {
  constructor(private daily: DailyCall | null) {}

  async sendMessage(payload: unknown): Promise<void> {
    if (!this.daily) {
      throw new Error('Daily instance not available');
    }
    await this.daily.sendAppMessage(payload);
  }

  isReady(): boolean {
    return this.daily !== null;
  }
}

// Hook for React components
// Location: apps/interface/src/hooks/useLLMMessageProvider.ts

import { useMemo } from 'react';
import { DailyLLMMessageProvider } from '@nia/shared/llm-messaging';
import { useDaily } from './useDaily';

/**
 * Get LLM message provider wired to voice-only Daily session.
 * Use this in components that need to send context to the bot.
 */
export function useLLMMessageProvider() {
  const daily = useDaily();
  
  return useMemo(() => {
    return daily ? new DailyLLMMessageProvider(daily) : null;
  }, [daily]);
}
```

**Usage Examples:**

```typescript
// Example 1: Notes view - document processing feedback
import { sendLLMMessage } from '@nia/shared/llm-messaging';
import { useLLMMessageProvider } from '@interface/hooks/useLLMMessageProvider';

const NotesView = () => {
  const llmProvider = useLLMMessageProvider(); // Wired to voice session
  
  const handleDocumentDrop = async (file: File) => {
    const result = await processDocument(file);
    
    if (result.error) {
      // OLD WAY:
      // vapi.send({
      //   type: MessageTypeEnum.ADD_MESSAGE,
      //   message: { 
      //     role: 'assistant', 
      //     content: `I couldn't extract readable text from "${file.name}". ${result.error}` 
      //   }
      // });
      
      // NEW WAY:
      await sendLLMMessage(llmProvider, {
        content: `I couldn't extract readable text from "${file.name}". ${result.error}`,
        role: 'assistant',
        mode: 'immediate' // Use immediate for error feedback
      });
    }
  };
};

// Example 2: YouTube view - comment context injection
const YouTubeView = () => {
  const llmProvider = useLLMMessageProvider();
  
  const handleVideoLoad = async (data: VideoData) => {
    if (data.comments?.length > 0) {
      const commentsSummary = data.comments
        .map(c => `- "${c.text}" by ${c.author}`)
        .join('\n');
      
      // OLD WAY:
      // vapi.send({
      //   type: MessageTypeEnum.ADD_MESSAGE,
      //   message: {
      //     role: 'system',
      //     content: `Here's a summary of comments:\n${commentsSummary}`
      //   }
      // });
      
      // NEW WAY:
      await sendLLMMessage(llmProvider, {
        content: `Here's a summary of comments for "${data.title}":\n${commentsSummary}`,
        role: 'system',
        mode: 'queued' // Queue context for next LLM run
      });
    }
  };
};

// Example 3: Auth component - user context
const AuthComponent = () => {
  const llmProvider = useLLMMessageProvider();
  
  const handleUserLogin = async (user: User) => {
    // OLD WAY:
    // vapi.send({
    //   type: MessageTypeEnum.ADD_MESSAGE,
    //   message: {
    //     role: 'system',
    //     content: `User found: ${user.name || user.email}`
    //   }
    // });
    
    // NEW WAY:
    await sendLLMMessage(llmProvider, {
      content: `User found: ${user.name || user.email}`,
      role: 'system',
      mode: 'queued'
    });
  };
};

// Example 4: DailyCall Chat - refactored admin message UI
// This now uses the same shared library
const Chat = () => {
  const llmProvider = useLLMMessageProvider();
  
  const handleAdminMessage = async (message: string) => {
    // Simplified - no longer needs admin-specific logic
    await sendLLMMessage(llmProvider, {
      content: message,
      role: 'system',
      mode: isUrgent ? 'immediate' : 'queued',
      senderId: currentUser.id,
      senderName: currentUser.name
    });
  };
};
```

### Solution 2: New Dedicated Event Type (NOT NEEDED)

**Status:** ⛔ **Superseded by Solution 1**

Solution 1 already provides a new event type (`llm-context-message`) as part of the shared library approach. No need for separate implementation.

**Why this was considered:**

- Originally thought we'd need completely new bot-side handler
- Wanted to separate from admin message infrastructure
- **Resolution:** Reuse existing admin flow infrastructure, just add new event type without privilege checks

### Solution 3: Direct Frame Injection via HTTP API (REJECTED)

**Pros:**
- ✅ Most direct path to LLM context
- ✅ Could support richer message structures

**Cons:**
- ❌ Requires new HTTP endpoint in bot server
- ❌ Authentication/authorization complexity
- ❌ Must map session/room to bot instance
- ❌ Bypasses existing event architecture
- ❌ Much more implementation work

## Recommendation

**Use Solution 1: Shared Message Provider**

### Rationale

1. **Uses existing infrastructure** - Leverages tested admin message plumbing
2. **Abstract provider pattern** - Decoupled from Daily, testable, flexible
3. **No admin requirement** - Auth moved to route layer (bot-side)
4. **Shared library** - Reusable by all components including DailyCall
5. **Mode flexibility** - Supports immediate vs queued injection
6. **Backward compatible** - Can create vapi.send() shim for minimal code changes

### Implementation Plan

#### Phase 1: Create Shared Library ✅

- [ ] Create `packages/nia-shared/src/llm-messaging/` package
- [ ] Define `LLMMessageProvider` interface
- [ ] Implement `sendLLMMessage()` function  
- [ ] Implement `DailyLLMMessageProvider` class
- [ ] Implement `createMessageDispatcher()` helper
- [ ] Add TypeScript types and JSDoc
- [ ] Write unit tests

#### Phase 2: Update Bot-Side Route Handling ✅

- [ ] Add new event type: `llm-context-message` (or rename from `admin-message`)
- [ ] Remove admin privilege check in bot message handler
- [ ] Keep authentication at route/transport layer only
- [ ] Update event flow documentation

#### Phase 3: Create Interface Hooks ✅

- [ ] Create `hooks/useLLMMessageProvider.ts` 
- [ ] Wire to voice session (useDaily)
- [ ] Add error handling and ready checks
- [ ] Document usage patterns

#### Phase 4: Refactor DailyCall Admin UI ✅

- [ ] Update Chat.tsx to use shared `sendLLMMessage()`
- [ ] Remove duplicate admin message logic
- [ ] Keep UI-level admin checks (who can send)
- [ ] Simplify message sending code

#### Phase 5: Migrate Components (by feature)

- [ ] **auth.tsx** (6 instances) - System messages for auth state
- [ ] **GmailViewWithAuth.tsx** (1 instance) - Gmail auth status
- [ ] **EnhancedMiniBrowserView.tsx** (2 instances) - Browser events (may skip)
- [ ] **notes-view.tsx** (14 instances) - Document processing, errors, confirmations
- [ ] **youtube-view.tsx** (7 instances) - Video/comment context, playback state

#### Phase 6: Testing & Validation

- [ ] Test message delivery to bot
- [ ] Verify LLM receives context correctly
- [ ] Check immediate vs queued behavior
- [ ] Validate error handling
- [ ] Test with multiple concurrent messages
- [ ] Verify DailyCall admin messages still work

#### Phase 7: Cleanup

- [ ] Remove all `TODO: migrate to pipecat` comments
- [ ] Remove VAPI import remnants
- [ ] Update architecture documentation
- [ ] Update developer guide with new patterns
- [ ] Archive this migration guide

## Event Listener TODOs (SEPARATE ISSUE)

Some TODOs involve VAPI event listeners, not message sending:

```typescript
// These are different - listening to speech events
vapi.on('speech-start', onSpeechStart);
vapi.on('speech-end', onSpeechEnd);
vapi.on('volume-level', onVolumeLevel);
```

**These may not need migration** - Pipecat bot already emits speaking events:
- `BOT_SPEAKING_STARTED` 
- `BOT_SPEAKING_STOPPED`

These events flow through:
1. Bot emits via event bus
2. AppMessageForwarder forwards to Daily
3. Frontend receives via Daily app-message listener
4. niaEventRouter dispatches as CustomEvents
5. Components listen via `addEventListener`

**Action:** Audit each speech event listener to determine if:
1. Already handled by existing event flow
2. Needs new event type emitted from bot
3. Can be removed entirely (unused)

## References

### Key Files

**Frontend:**
- `apps/interface/src/features/DailyCall/components/Chat.tsx` - Admin message sending
- `apps/interface/src/features/DailyCall/events/niaEventRouter.ts` - Event routing
- `apps/interface/src/hooks/useVoiceSession.ts` - Daily integration

**Backend:**
- `apps/pipecat-daily-bot/bot/handlers.py` - Event handlers, admin message processing
- `apps/pipecat-daily-bot/bot/app_message_forwarder.py` - Daily message forwarding
- `apps/pipecat-daily-bot/bot/eventbus/events.py` - Event type definitions
- `apps/pipecat-daily-bot/bot/flows/core.py` - LLMMessagesAppendFrame usage

### Event Types

**New LLM Context Message Structure:**

```typescript
{
  type: 'llm-context-message',  // New type - no admin restriction
  prompt: string,               // Message content
  role: 'system' | 'assistant', // LLM role
  mode: 'immediate' | 'queued', // Delivery mode
  senderId: string,             // Sender identifier
  senderName: string,           // Display name
  timestamp: number             // Unix timestamp
}
```

**Legacy Admin Message Structure (deprecated):**

```typescript
{
  type: 'admin-message',        // Old type - had admin checks
  prompt: string,
  mode: 'immediate' | 'queued',
  senderId: string,
  senderName: string,
  timestamp: number
}
```

**Bot Event Flow:**

```text
'llm.context.message' → handlers._on_llm_context_message()
  → flows.enqueue_admin_instruction()  // Reuses existing flow logic
  → LLMMessagesAppendFrame
  → OpenAI LLM context
```

**Migration Path:**

- Old `admin-message` type → Routes through admin handler with privilege check
- New `llm-context-message` type → Routes directly to LLM context (no privilege check)
- Both use same underlying flow mechanism
- DailyCall admin UI can use either (keeps UI-level checks)

## Migration Checklist

### Before Starting
- [x] Understand current admin message flow
- [x] Review all TODO locations and use cases
- [x] Design utility API
- [ ] Get team approval on approach

### During Migration
- [ ] Create utility with tests
- [ ] Migrate one component completely
- [ ] Validate in dev environment
- [ ] Review with team
- [ ] Continue with remaining components

### After Migration
- [ ] Remove legacy VAPI references
- [ ] Update architecture docs
- [ ] Add examples to developer guide
- [ ] Document any gotchas/learnings

## Questions & Decisions

### Q: Should non-admin users be able to inject system messages?

**Current State:** Admin messages require admin privileges checked in UI.

**Options:**

1. Keep admin-only, accept some features are admin-only
2. Create separate non-privileged message type for system context
3. Add permission bypass for system-generated messages

**Decision:** ✅ Option 2 - New `llm-context-message` type with no privilege requirement. Auth stays at route/transport layer only. UI-level checks remain for user-initiated admin messages in DailyCall.

### Q: How to handle message delivery failures?

**Options:**

1. Silent fail (current admin message behavior)
2. Toast notification to user
3. Retry logic
4. Error event emission

**Decision:** Start with silent fail + console.error, add retry for critical messages if needed.

### Q: Should we support assistant-response tracking?

**Current State:** Admin messages emit `admin.prompt.response` events.

**Question:** Do we need promise-based completion tracking?

**Decision:** Not initially - most use cases are fire-and-forget context injection. Can add later if needed.

### Q: What about the DailyCall admin message UI?

**Current State:** Chat.tsx has admin-only message sending with UI-level checks.

**Decision:** ✅ Refactor to use shared `sendLLMMessage()` library. Keep UI-level admin checks for who can send messages. Simplify by removing duplicate message plumbing code.

## Future Enhancements

### Rich Message Types
- Structured data injection (JSON context)
- Image/media context
- Multi-modal message support

### Message Prioritization
- High-priority immediate messages
- Low-priority background context
- Message expiration/TTL

### Response Handling
- Promise-based delivery confirmation
- LLM response to injected context
- Bi-directional request/response pattern

---

**Status:** PROPOSAL - Awaiting approval and implementation  
**Author:** GitHub Copilot  
**Date:** 2025-10-26  
**Next Steps:** Review with team, create utility, begin migration
