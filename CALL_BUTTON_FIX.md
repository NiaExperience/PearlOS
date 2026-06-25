# Call Button Disconnect Fix

## Problem
The call start/stop button in PearlOS wasn't working to disconnect an active call. Starting a call worked fine, but during an active session, clicking the button to leave/disconnect didn't trigger anything.

## Root Cause Analysis

### Architecture Overview
The system uses a Daily.co-based video call system with the following flow:

1. **UI Layer**: `CallControls.tsx` - Contains the Leave Call button
2. **Call Layer**: `Call.tsx` - Manages the Daily.co call lifecycle
3. **View Layer**: `DailyCallView.tsx` - Orchestrates the call UI
4. **Bot Layer**: `bot_end_call` tool (Python) - Bot-initiated disconnect

### The Bug
When the bot calls the `bot_end_call` tool, it emits a `BOT_SESSION_END` event which gets routed to `NIA_EVENT_SESSION_END` (via `niaEventRouter.ts`). This event was being listened to in:
- `useVoiceSession.ts` - For voice-only sessions
- `voice-session-context.tsx` - For voice session context

**But NOT in the DailyCall (video forum) components!**

This meant:
- ✅ User clicking "Leave Call" button worked (direct UI -> endCall path)
- ✅ Voice-only sessions could be ended by bot
- ❌ Video call sessions could NOT be ended by bot (missing event listener)

### Event Flow

**Working Path (User-initiated):**
```
User clicks button
  → CallControls.leaveCall()
    → daily.leave()
    → onLeave() [endCall from DailyCallView]
      → Cleanup & window close
```

**Broken Path (Bot-initiated):**
```
Bot calls bot_end_call
  → Emits BOT_SESSION_END event
    → Routed to NIA_EVENT_SESSION_END
      → ❌ No listener in Call.tsx
        → Call continues (bug!)
```

## Solution

Added an event listener in `Call.tsx` to handle bot-initiated session ends:

```typescript
// Listen for bot-initiated session end (bot_end_call tool)
useEffect(() => {
  const handleBotSessionEnd = (event: Event) => {
    const customEvent = event as CustomEvent;
    const detail = customEvent.detail;
    const payload = detail?.payload || {};
    const initiator = payload.initiator;

    // Only handle bot-initiated session ends
    if (initiator !== 'assistant') {
      return;
    }

    log.info('[Call] Bot-initiated session end detected, leaving call', {
      event: 'daily_call_bot_session_end',
      roomUrl,
      username,
      reason: payload.reason,
    });

    // Trigger the leave callback
    onLeave();
  };

  window.addEventListener(NIA_EVENT_SESSION_END, handleBotSessionEnd as EventListener);
  return () => {
    window.removeEventListener(NIA_EVENT_SESSION_END, handleBotSessionEnd as EventListener);
  };
}, [onLeave, roomUrl, username, log]);
```

### Why This Works

1. **Event Source**: Bot's `bot_end_call` emits `BOT_SESSION_END` with `initiator: "assistant"`
2. **Event Routing**: `niaEventRouter.ts` maps `BOT_SESSION_END` → `NIA_EVENT_SESSION_END`
3. **Event Handling**: New listener in `Call.tsx` catches the event
4. **Disconnect**: Calls `onLeave()` which triggers the same cleanup path as user-initiated leave
5. **Cleanup**: `endCall()` in `DailyCallView.tsx` handles full cleanup

## Files Modified

- `apps/interface/src/features/DailyCall/components/Call.tsx`
  - Added import for `NIA_EVENT_SESSION_END`
  - Added `useEffect` hook to listen for bot-initiated session ends

## Testing Recommendations

1. **Manual Test**: User says "goodbye" or "hang up" during an active call
2. **Verify**: Call window should close and bot should disconnect
3. **Check Logs**: Should see `[Call] Bot-initiated session end detected` in console
4. **Edge Case**: Verify user-initiated leave still works (shouldn't be affected)

## Related Code

- **Event Source**: `apps/pipecat-daily-bot/bot/tools/misc_tools.py` - `bot_end_call` function
- **Event Router**: `apps/interface/src/features/DailyCall/events/niaEventRouter.ts`
- **Voice Session**: `apps/interface/src/hooks/useVoiceSession.ts` - Already had this listener
- **UI Controls**: `apps/interface/src/features/DailyCall/components/CallControls.tsx`

## Implementation Notes

- **No Hacks**: Proper event-driven architecture, no workarounds
- **Root Cause Fix**: Addressed missing event listener, not symptoms
- **Consistent Pattern**: Matches existing pattern in `useVoiceSession.ts`
- **Defensive**: Only handles `initiator === "assistant"` to avoid conflicts
