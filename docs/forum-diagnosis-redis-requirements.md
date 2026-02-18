# Forum (DailyCall) Diagnosis & Redis Requirements

## Summary

This document outlines the diagnosis approach for the forum closing immediately issue and clarifies Redis requirements for the forum feature.

## Possible Causes of Immediate Close

Based on code analysis, the forum window can close immediately due to:

### 1. **Profile Gate Triggered** (Most Likely)
- **Location**: `DailyCallView.tsx` → `handlePreJoin()` → `shouldGateDailyCall()`
- **Conditions**:
  - `requireUserProfile` feature is enabled
  - User profile is missing or incomplete (no `first_name`)
  - Profile fetch fails
- **Action**: Calls `notifyProfileGate()` → `endCall()` → closes window
- **Logs to check**: 
  - `daily_call_profile_gate_start`
  - `daily_call_profile_gate_result`
  - `daily_call_profile_gate_triggered`

### 2. **Missing Room URL**
- **Location**: `Call.tsx` → join effect
- **Condition**: `roomUrl` is empty/null
- **Action**: Calls `onLeave()` immediately
- **Logs to check**:
  - `daily_call_missing_roomurl`
  - `daily_call_room_url_effect`
  - `daily_call_fetch_dev_room_*`

### 3. **User Timeout**
- **Location**: `Call.tsx` → join effect
- **Condition**: User is in timeout (kicked)
- **Action**: Blocks join, but doesn't close window (shows timeout message)
- **Logs to check**:
  - `daily_call_join_effect`
  - `join.timeout.gated`

### 4. **Auto-Join Profile Gate**
- **Location**: `Call.tsx` → join effect (when `localJoined` is true)
- **Condition**: Profile gate fails during auto-join
- **Action**: Calls `onProfileGate()` → `onLeave()`
- **Logs to check**:
  - `daily_call_profile_gate_close`
  - `join.profile.gated`

## Redis Requirements

### **Redis is NOT required for basic forum functionality**

Redis is only used for **optional features**:

1. **User Timeouts** (`apps/interface/src/features/DailyCall/lib/userTimeout.ts`)
   - Stores timeout state when users are kicked
   - **Fallback**: In-memory storage when Redis unavailable
   - **Impact**: Timeouts won't persist across server restarts without Redis

2. **Admin-to-Bot Messages** (`apps/interface/src/features/DailyCall/components/Chat.tsx`)
   - Used for admin messages to bot via `/api/bot/admin`
   - **Impact**: Admin messages won't work without Redis

3. **Pending Config Cleanup** (`apps/interface/src/features/DailyCall/routes/leaveImpl.ts`)
   - Clears pending sprite/voice config from Redis
   - **Impact**: Minor - stale config might persist

### Redis Configuration

- **Environment Variable**: `USE_REDIS=true` (default: `false`)
- **Connection URL**: `REDIS_URL=redis://localhost:6379` (default)
- **Client**: `apps/interface/src/lib/redis.ts` - lazy connection, graceful fallback

### Conclusion

**The forum will work without Redis.** The immediate close issue is likely **not** related to Redis, but rather:
1. Profile gating (most likely)
2. Missing room URL
3. Auto-join failure

## Diagnostic Logging Added

Comprehensive logging has been added to track the forum lifecycle:

### Key Log Events

1. **Component Mount**:
   - `daily_call_view_mount` - DailyCallView mounted with props
   - `init.view.mount` - Initial mount phase

2. **Room URL**:
   - `daily_call_room_url_effect` - Room URL effect triggered
   - `daily_call_fetch_dev_room_*` - Dev room fetch lifecycle

3. **Profile Gate**:
   - `daily_call_profile_gate_start` - Profile gate evaluation started
   - `daily_call_profile_gate_result` - Profile gate result
   - `daily_call_profile_gate_triggered` - Profile gate triggered (will close)
   - `daily_call_profile_gate_close` - Profile gate causing close

4. **Window Lifecycle**:
   - `dailycall_open_request` - DailyCall open requested
   - `window_open_request` - Window open request processing
   - `window_add` - Window added to state
   - `dailycall_window_removed` - DailyCall window removed
   - `window_remove` - Window removal

5. **Join Flow**:
   - `daily_call_join_effect` - Join effect triggered
   - `daily_call_prejoin_start` - Pre-join initiated
   - `daily_call_missing_roomurl` - Missing room URL (will close)

6. **End Call**:
   - `daily_call_endcall` - End call triggered
   - `leave.user` - User leaving

## How to Diagnose

1. **Open browser console** and filter for:
   - `🪟 [DailyCallView]`
   - `📞 [Call]`
   - `📞 [LIFECYCLE]`
   - `🪟 [LIFECYCLE]`

2. **Check the sequence**:
   - Window open request → Component mount → Room URL fetch → Profile gate → Join attempt → Close

3. **Look for error patterns**:
   - Profile gate triggered → Window closes
   - Missing room URL → Window closes
   - Join error → Window closes

4. **Check feature flags**:
   - Is `requireUserProfile` enabled?
   - Is `dailyCall` enabled?
   - Check `supportedFeatures` array in logs

## Next Steps

1. **Test with logging enabled** - Open forum and check console logs
2. **Check user profile** - Verify user has `first_name` set
3. **Check room URL** - Verify `NEXT_PUBLIC_DAILY_ROOM_URL` or dev room fetch works
4. **Disable profile gate temporarily** - If `requireUserProfile` is enabled, try disabling it to test
5. **Check Redis status** - Verify Redis is not causing issues (though unlikely)

## Files Modified

- `apps/interface/src/features/DailyCall/components/DailyCallView.tsx` - Added mount, room URL, profile gate, and endCall logging
- `apps/interface/src/features/DailyCall/components/Call.tsx` - Added join effect and profile gate logging
- `apps/interface/src/components/browser-window.tsx` - Enhanced window lifecycle logging

