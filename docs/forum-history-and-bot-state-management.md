# Forum History & Bot State Management - Complete Analysis

## Executive Summary

This document provides a comprehensive analysis of how the Forum (DailyCall) feature worked historically, how bot states were managed, and what changes may have broken the forum functionality. The analysis is based on git commit history, codebase structure, and architectural patterns.

---

## Part 1: Forum (DailyCall) Architecture Overview

### What is the Forum?

The Forum is a real-time voice/video communication feature built on Daily.co that allows users to:
- Join voice/video rooms
- Interact with an AI bot (Pearl) in real-time
- Share notes, applets, and desktop modes
- Use admin features like stealth mode and bot messaging

**Key Components:**
- **Frontend**: `apps/interface/src/features/DailyCall/`
- **Bot Backend**: `apps/pipecat-daily-bot/`
- **State Management**: Redis (optional) + in-memory fallbacks

---

## Part 2: How Bot States Were Managed

### 2.1 Bot State Management Architecture

The bot state management system evolved through several phases:

#### Phase 1: Direct Mode (Early Development)
- **Location**: `apps/pipecat-daily-bot/bot/bot_gateway.py`
- **Mode**: `USE_REDIS=false`
- **Behavior**: Gateway directly launches bot runner processes
- **State Storage**: In-memory only (process-local)
- **Limitations**: No persistence, no scaling, single-process

#### Phase 2: Redis Queue Mode (Production)
- **Location**: `apps/pipecat-daily-bot/bot/bot_gateway.py` + `bot_operator.py`
- **Mode**: `USE_REDIS=true`
- **Behavior**: Gateway pushes jobs to Redis queue, operator watches queue and spawns Kubernetes Jobs
- **State Storage**: Redis keys with in-memory fallbacks

### 2.2 Key State Management Components

#### A. Room Active Lock (`room_active:{room_url}`)

**Purpose**: Prevents duplicate bot instances for the same room

**Location**: 
- Gateway: `apps/pipecat-daily-bot/bot/bot_gateway.py:535`
- Operator: `apps/pipecat-daily-bot/bot/bot_operator.py:434`

**How It Works**:
1. When `/join` is called, gateway checks for existing `room_active:{room_url}` key
2. If exists → returns existing bot state (idempotency)
3. If not → sets `pending` state (60s expiry) → queues job → operator spawns bot
4. Operator marks room as `active` when bot starts (24h expiry)

**Key Code**:
```python
# Gateway check (bot_gateway.py:535-553)
lock_key = f"room_active:{room_url}"
existing_state = r.get(lock_key)
if existing_state:
    state_data = json.loads(existing_state)
    return {
        "status": state_data.get("status", "running"),
        "pid": state_data.get("pid") or state_data.get("job_id"),
        "session_id": state_data.get("session_id"),
        "reused": True,
        ...
    }
```

**Evolution**:
- **Commit d6939721** (Nov 2025): Refactored bot architecture, introduced warm pool
- **Commit 533e7e48** (Dec 2025): Fixed zombie sessions, added reaping logic
- **Commit 3dd723f7** (Dec 2025): Dedupe config, fix cold bot startup healthchecks

#### B. Room State (`room:{room_url}:*`)

**Purpose**: Tracks room-specific state (notes, applets, desktop mode)

**Location**: `apps/pipecat-daily-bot/bot/room/state.py`

**State Keys**:
- `room:{room_url}:active_note` - Currently open note ID and owner
- `room:{room_url}:active_applet` - Currently open applet ID and owner
- `room:{room_url}:desktop_mode` - Current desktop mode (home/work/etc)

**Features**:
- Redis with 24h expiry
- In-memory fallback when Redis unavailable
- Process-local tenant tracking (`_room_tenants` dict)

**Key Functions**:
```python
async def set_active_note_id(room_url: str, note_id: str | None, owner: str | None = None)
async def get_active_note_id(room_url: str) -> str | None
async def clear_room_state(room_url: str) -> None
```

#### C. Bot Flow State (In-Memory)

**Purpose**: Tracks conversation flow, participants, timers, nodes

**Location**: `apps/pipecat-daily-bot/bot/flows/types.py`

**Structure**:
```python
@dataclass
class DailyBotFlowState:
    timers: Dict[str, float | int]
    nodes: Dict[str, NodeConfig]
    next_node_after_boot: str
    participants: list[str]
    participant_contexts: Dict[str, Dict[str, Any]]
    stealth_participants: set[str]
    last_joined_participant: Optional[str]
    greeting_rooms: Dict[str, Dict[str, Any]]
    wrapup_prompt: Optional[str]
    room: Optional[str]
    admin_state: Dict[str, Any]
    opening_prompt: Optional[str]
```

**Storage**: In-memory only (FlowManager instance)
**Persistence**: None (lost on bot restart)

#### D. Keepalive System (`room_keepalive:{room_url}`)

**Purpose**: Health checks for active bots

**Location**: `apps/pipecat-daily-bot/bot/bot_operator.py:451-520`

**How It Works**:
1. Bot runner sends periodic keepalive signals
2. Operator checks keepalive freshness (30s stale threshold)
3. Stale keepalives trigger cleanup/reaping

**Key Code**:
```python
keepalive_key = f"room_keepalive:{room_url}"
keepalive_data = await self.redis.get(keepalive_key)
if keepalive_data:
    last_heartbeat = json.loads(keepalive_data).get("timestamp", 0)
    age = time.time() - last_heartbeat
    if age > STALE_KEEPALIVE_SECONDS:
        # Bot is dead, clean up
```

---

## Part 3: Forum Join Flow (How It Used to Work)

### 3.1 Frontend Join Flow

**Location**: `apps/interface/src/features/DailyCall/components/Call.tsx`

**Steps**:

1. **Component Mount** (`Call.tsx:402`)
   - Logs join effect trigger
   - Checks for room URL
   - Validates user profile (if `requireUserProfile` enabled)

2. **Bot Join Request** (`Call.tsx:670-701`)
   - Calls `joinRoom()` from `botClient.ts`
   - Sends POST to `/api/dailyCall/join` (proxies to bot gateway)
   - Includes: `room_url`, `personalityId`, `persona`, `voice`, `sessionId`, etc.

3. **Token Request** (`Call.tsx:714`)
   - Requests Daily.co join token
   - Includes display name, stealth mode, etc.

4. **Daily.co Join** (`Call.tsx:758`)
   - Joins Daily.co room with token
   - Sets up event listeners
   - Initializes app message bridge

### 3.2 Backend Join Flow

**Location**: `apps/pipecat-daily-bot/bot/bot_gateway.py:473`

**Steps**:

1. **Gateway Receives Request** (`/join` endpoint)
   - Validates `room_url` required
   - Generates `session_id` if missing
   - Logs request summary

2. **Direct Mode Check** (`bot_gateway.py:523`)
   - If `USE_REDIS=false` → direct runner start
   - Returns immediately with PID

3. **Redis Mode Check** (`bot_gateway.py:534`)
   - Checks `room_active:{room_url}` for existing bot
   - If exists → returns existing state (idempotency)
   - If not → sets pending state → queues job

4. **Operator Processing** (`bot_operator.py`)
   - Watches Redis queue
   - Spawns Kubernetes Job or assigns to warm pool
   - Marks room as active when bot starts

5. **Bot Runner Initialization** (`runner_main.py`)
   - Connects to Daily.co room
   - Initializes FlowManager with state
   - Starts keepalive loop

### 3.3 State Synchronization

**Frontend → Bot**:
- App messages via `appMessageBridge.ts`
- Events via `niaEventRouter.ts`
- Admin messages via `/api/bot/admin`

**Bot → Frontend**:
- Daily.co events (participant join/leave, speaking, etc.)
- App messages via `AppMessageForwarder`
- Redis pub/sub (for admin messages)

---

## Part 4: What Changed That Broke the Forum

### 4.1 Recent Changes Analysis

#### Commit 286dfb6c: "Operational Forum" (Feb 6, 2026)

**Files Changed**:
- `DailyCallView.tsx`: **473 lines removed, major refactor**
- `Call.tsx`: 75 lines changed
- `tokenImpl.ts`: 19 lines changed
- `browser-window.tsx`: 50 lines changed

**Key Changes** (from git diff analysis):

1. **Profile Gate Complete Removal**:
   - **Removed**: `ProfileGateModalState` type definition
   - **Removed**: `shouldGateDailyCall` import (kept only `ProfileGateReason` type)
   - **Removed**: `fetchProfileForGate()` function (async profile fetch)
   - **Removed**: `primeMicrophone()` function (mic permission priming)
   - **Removed**: `finalizeProfileGate()` function (gate completion logic)
   - **Removed**: `profileGatePrompt` state and `profileGateProcessing` state
   - **Removed**: All profile gate UI/modal rendering code
   - **Changed**: `notifyProfileGate()` is now a no-op that only logs
   - **Impact**: Profile gate no longer blocks joins, but `Call.tsx` may still call `onProfileGate()` prop

2. **Simplified State Management**: 
   - Reduced from ~1100 lines to ~600 lines in `DailyCallView.tsx`
   - Removed `micPrimeSuccessfulRef` ref
   - Removed profile gate state variables
   - Kept persistent singleton state for username/joined/stealth

3. **Enhanced Logging**:
   - Added comprehensive diagnostic logging on component mount
   - Added room URL effect logging
   - Added dev room fetch lifecycle logging
   - Added endCall logging with duplicate detection
   - All logs use structured format with `event` field

4. **Window Lifecycle Changes**: 
   - Modified `endCall()` to log duplicate calls
   - Added cleanup guard with `cleanupRanRef`
   - Enhanced error logging in dev room fetch

**Potential Issues**:
- Profile gate removal may have broken join validation
- State management simplification may have lost critical state
- Window lifecycle changes may cause premature closes

#### Commit d6939721: "Refactor: Pipecat Bot Architecture" (Nov 25, 2025)

**Key Changes**:
- Introduced warm pod pool
- Removed legacy CLI bot startup mode
- Refactored `run_pipeline_session`
- Fixed Redis client initialization
- Removed unused bot heartbeat

**Potential Issues**:
- Warm pool may have race conditions
- Redis client changes may cause connection issues
- Heartbeat removal may affect health checks

#### Commit 533e7e48: "Fix zombie sessions" (Dec 12, 2025)

**Key Changes**:
- Added reaping logic for stale sessions
- Improved migration reliability
- Enhanced bot logging

**Potential Issues**:
- Reaping logic may be too aggressive
- May clean up active sessions incorrectly

### 4.2 Common Breakage Patterns

#### Pattern 1: Room Active Lock Stuck

**Symptom**: Forum closes immediately, bot never joins

**Root Cause**: 
- `room_active:{room_url}` key exists but bot is dead
- Gateway returns "reused" but bot isn't actually running
- No keepalive to detect dead bot

**Evidence**:
- Gateway code checks lock but doesn't verify bot health
- Operator reaping may not clear stale locks

**Fix Needed**:
- Verify bot health before returning "reused"
- Clear stale locks in gateway
- Add health check to gateway lock check

#### Pattern 2: Profile Gate Still Triggering

**Symptom**: Forum closes immediately after opening

**Root Cause**:
- Profile gate code removed but still being called
- `notifyProfileGate()` is no-op but `onProfileGate()` may still trigger
- `Call.tsx` still has profile gate logic

**Evidence** (from commit 286dfb6c diff):
```typescript
// DailyCallView.tsx - Profile gate is no-op
const notifyProfileGate = useCallback(
  (reason: ProfileGateReason) => {
    log.info('🪟 [DailyCallView] Profile gate callback called (ignored)', {
      event: 'daily_call_profile_gate_ignored',
      reason,
    });
    // No-op: profile gate removed, just log for debugging
  },
  []
);

// But Call.tsx:91 still receives onProfileGate prop and may call it
onProfileGate: (reason: ProfileGateReason) => void;
```

**Removed Code**:
- `fetchProfileForGate()` - async profile fetch
- `primeMicrophone()` - mic permission priming  
- `finalizeProfileGate()` - gate completion
- `ProfileGateModalState` type
- All profile gate UI rendering
- `profileGatePrompt` and `profileGateProcessing` state

**Fix Needed**:
- Remove profile gate logic from `Call.tsx` join flow
- Or properly implement profile gate in `DailyCallView.tsx`

#### Pattern 3: Missing Room URL

**Symptom**: Forum closes immediately, no room URL

**Root Cause**:
- Dev room fetch fails
- `initialRoomUrl` not provided
- Room URL state not persisted

**Evidence**:
- `DailyCallView.tsx:172-217` has dev room fetch logic
- If fetch fails, `roomUrl` stays empty
- `Call.tsx:402` checks for room URL and calls `onLeave()` if missing

**Fix Needed**:
- Better error handling for dev room fetch
- Fallback room URL
- Retry logic

#### Pattern 4: Bot Join Race Condition

**Symptom**: Bot never joins, or joins but doesn't respond

**Root Cause**:
- Bot join request sent before Daily.co join completes
- Bot spawns but can't connect to room
- Race between token request and bot join

**Evidence**:
- `Call.tsx:670-701` sends bot join before Daily.co join
- Bot may spawn before room is ready
- No synchronization between bot join and Daily.co join

**Fix Needed**:
- Wait for Daily.co join before bot join
- Or handle bot join failures gracefully
- Add retry logic

---

## Part 5: State Management Evolution Timeline

### Timeline of Key Changes

**September 2024**: Initial DailyCall implementation
- Basic room join/leave
- Simple bot integration
- No Redis (direct mode only)

**October 2024**: Redis integration
- Commit `fa7b492d`: Redis messaging system
- Commit `e273b9ac`: Finish Redis integration, harden failover
- Introduced `room_active` locks
- Added keepalive system

**November 2024**: Bot context management
- Commit `ca6abca1`: Bot context queue management
- Improved participant tracking
- Enhanced state persistence

**November 2025**: Major refactor
- Commit `d6939721`: Pipecat bot architecture refactor
- Introduced warm pool
- Removed legacy code
- Simplified state management

**December 2025**: Stability fixes
- Commit `533e7e48`: Fix zombie sessions
- Commit `3dd723f7`: Dedupe config, fix cold bot startup
- Improved health checks
- Better error handling

**February 2026**: "Operational Forum" commit
- Commit `286dfb6c`: Major DailyCallView refactor
- Removed profile gate
- Simplified state management
- **This may be where things broke**

---

## Part 6: Current State Management Architecture

### 6.1 State Storage Layers

```
┌─────────────────────────────────────────┐
│  Frontend (DailyCallView, Call)        │
│  - Component state (React hooks)       │
│  - Persistent singleton state           │
│  - Daily.co call object state           │
└──────────────┬──────────────────────────┘
               │
               │ HTTP API
               │
┌──────────────▼──────────────────────────┐
│  Gateway (bot_gateway.py)                │
│  - Room active locks (Redis)            │
│  - Pending state (Redis, 60s expiry)    │
│  - Job queue (Redis)                    │
└──────────────┬──────────────────────────┘
               │
               │ Redis Queue
               │
┌──────────────▼──────────────────────────┐
│  Operator (bot_operator.py)             │
│  - Watches queue                         │
│  - Spawns Kubernetes Jobs                │
│  - Manages warm pool                     │
│  - Updates room_active locks             │
└──────────────┬──────────────────────────┘
               │
               │ Kubernetes Job
               │
┌──────────────▼──────────────────────────┐
│  Bot Runner (runner_main.py)           │
│  - FlowManager state (in-memory)       │
│  - Daily.co connection                  │
│  - Keepalive signals (Redis)           │
│  - Room state (Redis + in-memory)       │
└────────────────────────────────────────┘
```

### 6.2 State Keys Reference

| Key Pattern | Purpose | Expiry | Location |
|------------|---------|--------|----------|
| `room_active:{room_url}` | Active bot lock | 24h | Gateway, Operator |
| `room_keepalive:{room_url}` | Bot health check | 30s stale | Runner, Operator |
| `room:{room_url}:active_note` | Open note ID | 24h | Runner (state.py) |
| `room:{room_url}:active_applet` | Open applet ID | 24h | Runner (state.py) |
| `room:{room_url}:desktop_mode` | Desktop mode | 24h | Runner (state.py) |
| `bot:launch:queue` | Job queue | None | Gateway, Operator |
| `bot:config:{room_url}` | Bot config | 24h | Gateway, Runner |

### 6.3 State Lifecycle

**Room Creation**:
1. Frontend requests `/api/dailyCall/devRoom` (if no room URL)
2. Backend creates Daily.co room
3. Returns room URL

**Bot Join**:
1. Frontend calls `joinRoom()` → Gateway `/join`
2. Gateway checks `room_active:{room_url}`
3. If exists → return existing bot
4. If not → set pending → queue job → operator spawns bot
5. Bot runner connects → sends keepalive → operator marks active

**Bot Leave**:
1. Frontend calls `/api/dailyCall/leave` → Gateway `/leave`
2. Gateway publishes leave message to Redis
3. Bot runner receives message → disconnects → clears state
4. Operator detects missing keepalive → cleans up → clears `room_active` lock

**State Cleanup**:
- Manual: `/leave` endpoint clears state
- Automatic: Operator reaping clears stale locks
- Expiry: Redis keys expire after 24h

---

## Part 7: Diagnosis Checklist

### 7.1 Immediate Close Issues

**Check 1: Profile Gate**
- [ ] Is `requireUserProfile` feature enabled?
- [ ] Does user have `first_name` in profile?
- [ ] Check logs for `daily_call_profile_gate_*` events
- [ ] Verify `notifyProfileGate()` is actually no-op

**Check 2: Room URL**
- [ ] Is `roomUrl` prop provided to `DailyCallView`?
- [ ] Does dev room fetch succeed? (`/api/dailyCall/devRoom`)
- [ ] Check logs for `daily_call_fetch_dev_room_*` events
- [ ] Verify `roomUrl` state is set before `Call` component mounts

**Check 3: Bot State**
- [ ] Is `room_active:{room_url}` key stuck?
- [ ] Is bot actually running? (check keepalive)
- [ ] Does gateway return "reused" for dead bot?
- [ ] Check operator logs for bot spawn failures

**Check 4: Window Lifecycle**
- [ ] Is window closing due to `onLeave()` being called?
- [ ] Check `browser-window.tsx` lifecycle logs
- [ ] Verify window state persistence
- [ ] Check for duplicate close events

### 7.2 Bot Join Issues

**Check 1: Gateway**
- [ ] Is `USE_REDIS` set correctly?
- [ ] Is Redis connection working?
- [ ] Does `/join` endpoint return success?
- [ ] Check gateway logs for join requests

**Check 2: Operator**
- [ ] Is operator watching queue?
- [ ] Are jobs being spawned?
- [ ] Check operator logs for errors
- [ ] Verify warm pool availability

**Check 3: Bot Runner**
- [ ] Does bot connect to Daily.co?
- [ ] Is keepalive being sent?
- [ ] Check runner logs for errors
- [ ] Verify FlowManager initialization

### 7.3 State Persistence Issues

**Check 1: Redis**
- [ ] Is Redis accessible?
- [ ] Are keys being set correctly?
- [ ] Are keys expiring as expected?
- [ ] Check Redis logs for errors

**Check 2: In-Memory Fallback**
- [ ] Is fallback being used?
- [ ] Are local state dicts populated?
- [ ] Check for state loss on restart

---

## Part 8: Recommendations

### 8.1 Immediate Fixes

1. **Restore Profile Gate Logic**
   - Re-implement profile gate in `DailyCallView.tsx`
   - Or remove profile gate checks from `Call.tsx`
   - Ensure consistent behavior

2. **Fix Room Active Lock Health Check**
   - Verify bot health before returning "reused"
   - Clear stale locks in gateway
   - Add health check endpoint

3. **Improve Error Handling**
   - Better dev room fetch error handling
   - Retry logic for bot join
   - Graceful degradation when Redis unavailable

4. **Add Comprehensive Logging**
   - Log all state transitions
   - Log all error conditions
   - Add structured logging for diagnosis

### 8.2 Long-Term Improvements

1. **State Management Refactor**
   - Centralize state management
   - Add state versioning
   - Implement state recovery

2. **Health Check System**
   - Periodic health checks for all components
   - Automatic recovery from failures
   - Better monitoring and alerting

3. **Testing**
   - Add integration tests for join flow
   - Test state persistence
   - Test error conditions

---

## Part 9: Key Files Reference

### Frontend
- `apps/interface/src/features/DailyCall/components/DailyCallView.tsx` - Main view component
- `apps/interface/src/features/DailyCall/components/Call.tsx` - Call component with join logic
- `apps/interface/src/features/DailyCall/lib/botClient.ts` - Bot API client
- `apps/interface/src/features/DailyCall/routes/joinImpl.ts` - Join API route

### Backend
- `apps/pipecat-daily-bot/bot/bot_gateway.py` - Gateway API (join/leave/config)
- `apps/pipecat-daily-bot/bot/bot_operator.py` - Kubernetes operator
- `apps/pipecat-daily-bot/bot/runner_main.py` - Bot runner entry point
- `apps/pipecat-daily-bot/bot/room/state.py` - Room state management
- `apps/pipecat-daily-bot/bot/flows/types.py` - Flow state types

### Documentation
- `docs/forum-diagnosis-redis-requirements.md` - Diagnosis guide
- `docs/pipecat-daily-bot-flow-behavior.md` - Flow behavior docs

---

## Conclusion

The Forum (DailyCall) feature is a complex system with multiple state management layers. The recent "Operational Forum" commit (286dfb6c) made significant changes that may have broken the forum:

1. **Profile gate removal** - May have broken join validation
2. **State management simplification** - May have lost critical state
3. **Window lifecycle changes** - May cause premature closes

The bot state management system relies on Redis for coordination but has in-memory fallbacks. The system evolved from simple direct mode to complex Redis-based queue system with Kubernetes operator.

**Most Likely Breakage Points**:
1. Room active lock stuck (dead bot, stale lock)
2. Profile gate still triggering despite removal
3. Missing room URL (dev room fetch failure)
4. Bot join race condition (bot spawns before room ready)

**Next Steps**:
1. Review commit 286dfb6c diff in detail
2. Check logs for specific error patterns
3. Test with Redis enabled/disabled
4. Verify profile gate behavior
5. Check room URL resolution

