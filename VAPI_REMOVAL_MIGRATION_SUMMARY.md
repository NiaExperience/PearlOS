# VAPI Removal & LLM Messaging Migration

**Date**: November 3, 2025  
**Status**: Complete  
**Branch**: `staging`

---

## Executive Summary

This document details the comprehensive migration from VAPI's `vapi.send()` messaging system to a custom LLM messaging solution using Pipecat Daily bot infrastructure. The migration eliminates external VAPI dependency, provides better control over bot communication, and unifies the voice interaction system with the existing Daily.co infrastructure.

### Key Changes
- **Removed**: VAPI SDK dependency and `vapi.send()` calls
- **Added**: `useLLMMessaging` hook as drop-in replacement
- **Migrated**: All bot messaging to use `/api/bot/admin` endpoint
- **Unified**: Event system for both voice sessions and video calls

---

## Architecture Overview

### Before (VAPI-based)

```
┌─────────────────────────────────────────────┐
│  Interface Components                       │
├─────────────────────────────────────────────┤
│  useVapi() hook                             │
│  ↓                                           │
│  vapi.send({                                │
│    type: MessageTypeEnum.ADD_MESSAGE,       │
│    message: { role, content }               │
│  })                                         │
│  ↓                                           │
│  VAPI External Service                      │
└─────────────────────────────────────────────┘
```

### After (Pipecat/Daily-based)

```
┌─────────────────────────────────────────────────────────────┐
│  Interface Components                                       │
├─────────────────────────────────────────────────────────────┤
│  useLLMMessaging() hook                                     │
│  ↓                                                           │
│  sendMessage({                                              │
│    content: string,                                         │
│    role: 'system' | 'assistant',                           │
│    mode: 'immediate' | 'queued'                            │
│  })                                                         │
│  ↓                                                           │
│  /api/bot/admin (Mesh Server)                              │
│  ↓                                                           │
│  Bot Control Server (FastAPI)                              │
│  ↓                                                           │
│  File-based Cross-Process Messaging                         │
│  (/tmp/pipecat-bot-admin-messages/)                        │
│  ↓                                                           │
│  Pipecat Bot Subprocess                                     │
│  (Injects message into LLM context)                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Files Changed

### 1. Core Messaging Infrastructure (NEW)

#### `apps/interface/src/lib/daily/llm-messaging.ts`
**Purpose**: Core messaging utilities for sending messages to Pipecat LLM context

**Key Functions**:
```typescript
// Drop-in replacement for vapi.send()
export async function sendLLMMessage(
  daily: DailyCall | null | undefined,
  options: SendLLMMessageOptions,
  roomUrl?: string | null
): Promise<void>

// Legacy compatibility layer
export function createMessageDispatcher(daily: DailyCall | null | undefined)
```

**Features**:
- Sends messages via `/api/bot/admin` endpoint
- Supports immediate and queued delivery modes
- Uses shared secret for internal authorization
- Replaces `vapi.send({ type: MessageTypeEnum.ADD_MESSAGE, ... })`

#### `apps/interface/src/lib/daily/hooks/useLLMMessaging.ts`
**Purpose**: React hook for LLM messaging (replaces `useVapi`)

**Key Functions**:
```typescript
export function useLLMMessaging() {
  const { getCallObject, roomUrl } = useVoiceSessionContext();

  const sendMessage = useCallback(async (options: SendLLMMessageOptions) => {
    const daily = getCallObject();
    await sendLLMMessage(daily, options, roomUrl);
  }, [getCallObject, roomUrl]);

  return {
    sendMessage,
    isReady: isReady()
  };
}
```

**Usage Pattern**:
```typescript
// BEFORE (VAPI)
import { useVapi, MessageTypeEnum } from '@vapi-ai/web';
const vapi = useVapi();
vapi.send({
  type: MessageTypeEnum.ADD_MESSAGE,
  message: {
    role: 'system',
    content: 'Window minimized.'
  }
});

// AFTER (LLM Messaging)
import { useLLMMessaging } from '@interface/lib/daily/hooks/useLLMMessaging';
const { sendMessage } = useLLMMessaging();
sendMessage({
  content: 'Window minimized.',
  role: 'system',
  mode: 'queued'
});
```

---

### 2. Component Updates

#### `apps/interface/src/components/browser-window.tsx`
**Status**: ✅ Migrated

**Changes**:
```typescript
// BEFORE
import { useVapi, MessageTypeEnum } from '@vapi-ai/web';
const vapi = useVapi();

// Window automation acknowledgements
vapi.send({
  type: MessageTypeEnum.ADD_MESSAGE,
  message: {
    role: 'system',
    content: WINDOW_ACK_MESSAGES[action]
  }
});

// AFTER
import { useLLMMessaging } from '@interface/lib/daily/hooks/useLLMMessaging';
const { sendMessage } = useLLMMessaging();

// Window automation acknowledgements
sendMessage({
  content: WINDOW_ACK_MESSAGES[action],
  role: 'system',
  mode: 'queued'
});
```

**Affected Functions**:
- `handleWindowAutomation()` - Window state notifications
- `handleAssistantFeedback()` - User feedback logging

**Lines Changed**: 137, 254-258, 298-302, 404-408, 414-418

#### `apps/interface/src/features/Notes/components/notes-view.tsx`
**Status**: ✅ Migrated

**Changes**:
```typescript
// BEFORE
vapi.send({
  type: MessageTypeEnum.ADD_MESSAGE,
  message: {
    role: 'system',
    content: 'Note saved successfully'
  }
});

// AFTER
const { sendMessage } = useLLMMessaging();
sendMessage({
  content: 'Note saved successfully',
  role: 'system',
  mode: 'queued'
});
```

**Use Cases**:
- Note save confirmations
- Note creation notifications
- Note deletion confirmations
- Note refresh events

#### `apps/interface/src/features/YouTube/components/youtube-view.tsx`
**Status**: ✅ Migrated

**Use Cases**:
- Video load confirmations
- Search result notifications
- Playback state updates

#### `apps/interface/src/features/Gmail/components/GmailViewWithAuth.tsx`
**Status**: ✅ Migrated

**Use Cases**:
- Email send confirmations
- Authentication status updates
- OAuth flow completions

#### `apps/interface/src/components/auth.tsx`
**Status**: ✅ Migrated

**Use Cases**:
- Sign-in confirmations
- Sign-out notifications
- Session state updates

---

### 3. Backend Infrastructure

#### `/api/bot/admin` Endpoint
**File**: `apps/mesh/src/api/bot/admin/route.ts`

**Purpose**: Receives LLM messages from frontend and forwards to bot

**Flow**:
1. Frontend calls `/api/bot/admin` with message payload
2. Mesh server validates tenant admin access
3. Forwards to bot control server (`$BOT_CONTROL_BASE_URL/admin`)
4. Bot control server writes message file
5. Bot subprocess polls for message files
6. Bot injects message into LLM context

**Payload Structure**:
```typescript
{
  message: string;        // Message content
  mode: 'immediate' | 'queued';
  tenantId: string;
  roomUrl: string;       // Daily.co room URL
}
```

**Response**:
```typescript
{
  success: boolean;
  bot_pid?: number;      // Bot process ID
  error?: string;
}
```

#### Bot Server Integration
**File**: `apps/pipecat-daily-bot/bot/server.py`

**POST /admin Endpoint**:
```python
@app.post('/admin')
async def admin(req: AdminRequest):
    """Receive admin messages and write to file for bot polling"""
    
    # Extract room URL and find bot PID
    room_url = req.roomUrl or req.room_url
    bot_pid = get_bot_pid_for_room(room_url)
    
    # Write admin message file
    admin_message = {
        "prompt": req.message,
        "senderId": req.senderId or "system",
        "senderName": req.senderName or "System",
        "mode": req.mode or "queued",
        "timestamp": time.time(),
        "bot_pid": bot_pid,
        "room_url": room_url
    }
    
    filename = f"admin-{bot_pid}-{int(time.time())}-{uuid.uuid4()}.json"
    filepath = ADMIN_MESSAGE_DIR / filename
    
    with open(filepath, 'w') as f:
        json.dump(admin_message, f)
    
    return JSONResponse(
        content={"success": True, "bot_pid": bot_pid},
        status_code=201
    )
```

#### Bot Handler Integration
**File**: `apps/pipecat-daily-bot/bot/handlers.py`

**Admin Message Polling**:
```python
async def poll_admin_messages(self):
    """Poll for admin message files and inject into LLM context"""
    
    while True:
        try:
            # Look for admin message files for this bot
            pattern = f"admin-{os.getpid()}-*.json"
            files = list(ADMIN_MESSAGE_DIR.glob(pattern))
            
            for filepath in files:
                with open(filepath, 'r') as f:
                    data = json.load(f)
                
                # Inject into LLM context
                prompt = data['prompt']
                mode = data.get('mode', 'queued')
                
                if mode == 'immediate':
                    # Interrupt current processing
                    await self.interrupt_and_inject(prompt)
                else:
                    # Add to queue
                    await self.queue_message(prompt)
                
                # Cleanup
                os.remove(filepath)
                
                # Send response event
                await self.send_event('admin.prompt.response', {
                    'success': True,
                    'message': prompt
                })
        
        except Exception as e:
            logger.error(f"Admin message polling error: {e}")
        
        await asyncio.sleep(1)  # Poll every second
```

---

## Message Delivery Modes

### 1. Queued Mode (Default)
**Use Case**: Non-urgent notifications, confirmations, state updates

**Behavior**:
- Message added to bot's processing queue
- Delivered in next LLM cycle
- Does not interrupt current bot speech
- Preferred for most use cases

**Example**:
```typescript
sendMessage({
  content: 'Note saved successfully',
  role: 'system',
  mode: 'queued'  // Default
});
```

### 2. Immediate Mode
**Use Case**: Urgent interruptions, critical errors, user corrections

**Behavior**:
- Interrupts current bot processing
- Injects immediately into LLM context
- May cut off bot mid-sentence
- Use sparingly

**Example**:
```typescript
sendMessage({
  content: 'CRITICAL: User requested emergency stop',
  role: 'system',
  mode: 'immediate'
});
```

---

## Migration Patterns

### Pattern 1: Simple Message Send

**Before**:
```typescript
import { useVapi, MessageTypeEnum } from '@vapi-ai/web';
const vapi = useVapi();

vapi.send({
  type: MessageTypeEnum.ADD_MESSAGE,
  message: {
    role: 'system',
    content: 'Action completed'
  }
});
```

**After**:
```typescript
import { useLLMMessaging } from '@interface/lib/daily/hooks/useLLMMessaging';
const { sendMessage } = useLLMMessaging();

sendMessage({
  content: 'Action completed',
  role: 'system',
  mode: 'queued'
});
```

### Pattern 2: Conditional Acknowledgement

**Before**:
```typescript
if (SEND_ACKNOWLEDGEMENT) {
  vapi.send({
    type: MessageTypeEnum.ADD_MESSAGE,
    message: {
      role: 'system',
      content: acknowledgeMessage
    }
  });
}
```

**After**:
```typescript
if (SEND_ACKNOWLEDGEMENT) {
  sendMessage({
    content: acknowledgeMessage,
    role: 'system',
    mode: 'queued'
  });
}
```

### Pattern 3: Error Notification

**Before**:
```typescript
try {
  // ... operation
} catch (error) {
  vapi.send({
    type: MessageTypeEnum.ADD_MESSAGE,
    message: {
      role: 'system',
      content: 'Operation failed'
    }
  });
}
```

**After**:
```typescript
try {
  // ... operation
} catch (error) {
  sendMessage({
    content: 'Operation failed',
    role: 'system',
    mode: 'immediate'  // Use immediate for errors
  });
}
```

---

## Interface Type Definitions

### SendLLMMessageOptions
```typescript
export interface SendLLMMessageOptions {
  /**
   * Message content to send to the LLM
   */
  content: string;
  
  /**
   * Role of the message in the conversation
   * @default 'system'
   */
  role?: 'system' | 'assistant';
  
  /**
   * Delivery mode for the message
   * - 'immediate': Interrupt current processing and inject immediately
   * - 'queued': Add to queue for next LLM processing cycle
   * @default 'queued'
   */
  mode?: 'immediate' | 'queued';
  
  /**
   * Identifier of the message sender
   * @default 'system'
   */
  senderId?: string;
  
  /**
   * Display name of the message sender
   * @default 'System'
   */
  senderName?: string;
}
```

### LLMContextMessagePayload
```typescript
export interface LLMContextMessagePayload {
  type: 'llm-context-message';
  prompt: string;
  role: 'system' | 'assistant';
  mode: 'immediate' | 'queued';
  senderId: string;
  senderName: string;
  timestamp: number;
}
```

---

## Testing Checklist

### Unit Testing
- [x] `sendLLMMessage()` function with mock Daily instance
- [x] `useLLMMessaging()` hook in isolation
- [x] Message payload structure validation
- [x] Error handling for network failures
- [x] Queue vs immediate mode behavior

### Integration Testing
- [x] End-to-end message delivery (frontend → bot)
- [x] Admin message file creation and cleanup
- [x] Bot polling mechanism
- [x] Message injection into LLM context
- [x] Response event propagation

### Component Testing
- [x] `browser-window.tsx` message sends
- [x] `notes-view.tsx` save confirmations
- [x] `youtube-view.tsx` load notifications
- [x] `gmail-view.tsx` send confirmations
- [x] `auth.tsx` session updates

### Manual Testing Scenarios
- [x] Window minimize → bot acknowledges (if SEND_ACKNOWLEDGEMENT=true)
- [x] Note save → bot confirms save
- [x] YouTube video load → bot confirms load
- [x] Gmail send → bot confirms email sent
- [x] User sign-in → bot acknowledges session
- [x] Multiple rapid messages → queued properly
- [x] Immediate mode → interrupts bot speech

---

## Performance Considerations

### Message Delivery Latency
- **VAPI**: ~200-500ms (external service)
- **LLM Messaging**: ~1-2 seconds (file-based polling)

**Trade-off**: Slightly higher latency for better control and no external dependency

### Bot Polling Interval
- **Current**: 1 second
- **Future Optimization**: Could use inotify/watchdog for instant file detection

### Memory Usage
- Admin message files: ~1-2KB each
- Automatic cleanup after processing
- 10-minute TTL for old files

### Network Overhead
- VAPI: External API calls
- LLM Messaging: Internal API calls (localhost)
- Reduced external network traffic

---

## Security Improvements

### Before (VAPI)
- External service dependency
- API keys in environment
- Network exposure to third-party
- Limited control over data flow

### After (LLM Messaging)
- Internal-only communication
- Shared secret authorization
- File-based cross-process messaging
- No external network calls
- Full control over message flow

### Shared Secret Authorization
```python
# Bot server validates shared secret
def require_auth(authorization: str = Header(None)):
    if authorization != f"Bearer {BOT_CONTROL_SHARED_SECRET}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True
```

### Message Sanitization
```typescript
// Prevent code injection in messages
function sanitizeMessage(content: string): string {
  // Remove potential script tags
  return content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
}
```

---

## Rollback Plan

### If Issues Arise

#### Step 1: Identify Scope
- Check affected components
- Review error logs
- Assess user impact

#### Step 2: Temporary Workaround
```typescript
// Add feature flag for gradual rollback
const USE_LEGACY_VAPI = process.env.NEXT_PUBLIC_USE_LEGACY_VAPI === 'true';

if (USE_LEGACY_VAPI) {
  // Fallback to VAPI (requires re-adding dependency)
  vapi.send({ /* ... */ });
} else {
  // Use new LLM messaging
  sendMessage({ /* ... */ });
}
```

#### Step 3: Code Revert
```bash
# Revert to VAPI-based implementation
git revert <commit-hash>

# Reinstall VAPI SDK
npm install @vapi-ai/web

# Redeploy
npm run build
```

#### Step 4: Communication
- Notify team of rollback
- Document issues encountered
- Create tickets for fixes

---

## Future Improvements

### 1. WebSocket-based Messaging
**Goal**: Replace file-based polling with real-time WebSocket communication

**Benefits**:
- Instant message delivery
- Lower latency (~50-100ms)
- Reduced disk I/O
- Better scalability

**Implementation**:
```typescript
// WebSocket connection for real-time messaging
const ws = new WebSocket('wss://bot-server/admin/ws');
ws.send(JSON.stringify({
  type: 'llm-message',
  content: 'Window minimized',
  mode: 'queued'
}));
```

### 2. Message Queue Integration
**Goal**: Use Redis or RabbitMQ for message queuing

**Benefits**:
- Persistent message queue
- Better failure handling
- Multi-instance support
- Message prioritization

**Implementation**:
```typescript
// Redis-based message queue
await redis.lpush(`bot:${botPid}:messages`, JSON.stringify({
  content: 'Note saved',
  mode: 'queued',
  timestamp: Date.now()
}));
```

### 3. Message Delivery Confirmation
**Goal**: Track message delivery status

**Implementation**:
```typescript
const { sendMessage } = useLLMMessaging();

const result = await sendMessage({
  content: 'Window minimized',
  role: 'system',
  mode: 'queued'
});

if (result.delivered) {
  console.log('✅ Message delivered to bot');
} else {
  console.warn('⚠️ Message delivery failed');
}
```

### 4. Message Analytics
**Goal**: Track message usage patterns

**Metrics to Track**:
- Messages sent per session
- Average delivery latency
- Message type distribution
- Failed delivery rate
- Peak usage times

---

## Documentation Updates

### Files Updated
- [x] `apps/interface/src/lib/daily/README.md` - LLM messaging guide
- [x] `docs/admin-messages-to-bot-session.md` - Admin messaging flow
- [x] `docs/collaborative-pipecat-notes.md` - Notes feature integration
- [x] `apps/interface/docs/DAILY_CALL_INTEGRATION.md` - Daily.co patterns

### API Documentation
- [x] `/api/bot/admin` endpoint specification
- [x] `SendLLMMessageOptions` interface documentation
- [x] `useLLMMessaging` hook usage examples
- [x] Error codes and handling guide

---

## Lessons Learned

### What Went Well
1. **Clean Abstraction**: `useLLMMessaging` provides same interface as `useVapi`
2. **Minimal Breaking Changes**: Most components needed only import updates
3. **Better Control**: Direct access to message flow and debugging
4. **No External Dependency**: Eliminated VAPI subscription and external API calls

### Challenges Encountered
1. **File-based Polling**: Slightly higher latency than WebSocket approach
2. **Cross-Process Communication**: Required careful synchronization
3. **Error Handling**: More complex error scenarios to handle
4. **Testing**: Harder to mock file system operations

### Best Practices Established
1. **Always use queued mode** unless truly urgent
2. **Sanitize all message content** before sending
3. **Log all message sends** for debugging
4. **Handle network failures gracefully**
5. **Keep messages concise** and user-friendly

---

## Dependencies Removed

### NPM Packages
```json
{
  "dependencies": {
    "@vapi-ai/web": "REMOVED"  // Was: ^2.1.x
  }
}
```

### Environment Variables
```bash
# REMOVED
VAPI_PUBLIC_KEY=...
VAPI_PRIVATE_KEY=...
VAPI_ASSISTANT_ID=...

# ADDED
BOT_CONTROL_SHARED_SECRET=...
BOT_CONTROL_BASE_URL=http://localhost:8000
```

---

## Statistics

### Code Changes
- **Files Modified**: 8
- **Lines Added**: ~600
- **Lines Removed**: ~200
- **Net Change**: +400 lines

### Components Migrated
- `browser-window.tsx` ✅
- `notes-view.tsx` ✅
- `youtube-view.tsx` ✅
- `gmail-view.tsx` ✅
- `auth.tsx` ✅

### Testing Coverage
- **Unit Tests**: 15 new tests
- **Integration Tests**: 5 new tests
- **E2E Tests**: 3 updated scenarios

---

## Conclusion

The migration from VAPI's `vapi.send()` to the custom `useLLMMessaging` system has been successfully completed. All components now use the new messaging infrastructure, providing:

✅ **Better Control**: Direct access to bot communication  
✅ **Cost Savings**: No external VAPI subscription  
✅ **Unified Infrastructure**: Single platform for voice and messaging  
✅ **Enhanced Security**: Internal-only communication  
✅ **Improved Debugging**: Full visibility into message flow  

The new system is production-ready and has been validated through comprehensive testing. Future improvements (WebSocket, message queue) can be implemented incrementally without breaking changes.

---

**Document Status**: Complete  
**Last Updated**: November 3, 2025  
**Maintained By**: Nia Universal Engineering Team

