# Pipecat-Based Notes Collaboration Feature

## Overview

The Pipecat Notes Collaboration feature enables real-time sharing of work notes in DailyCall sessions, powered by the Pipecat AI bot. Users can queue notes for sharing, and the bot provides context-aware assistance based on the active note content. The system handles multiple users, late joiners, conflicts, and provides clear visual feedback throughout the collaboration lifecycle.

**Implementation Date**: October 2024  
**Status**: ✅ Complete

---

## Architecture

### System Components

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   NotesView     │────────▶│  DailyCall       │────────▶│  Bot Server     │
│   (Frontend)    │  Queue  │  (Frontend)      │  HTTP   │  (Pipecat)      │
│                 │◀────────│                  │◀────────│                 │
│  - Queue UI     │  Events │  - Join/Leave    │  REST   │  - Context API  │
│  - Indicators   │         │  - Sync State    │         │  - Active Note  │
│  - State Mgmt   │         │  - Emit Events   │         │  - Conflict Det │
└─────────────────┘         └──────────────────┘         └─────────────────┘
         │                           │                            │
         └───────────────────────────┴────────────────────────────┘
                        localStorage (Queue Persistence)
```

### Communication Flow

1. **Queue Phase**: User queues note → Stored in localStorage
2. **Activation Phase**: User joins call → Note sent to bot via POST /context
3. **Sync Phase**: Late joiners query bot via GET /active-note
4. **Cleanup Phase**: Call ends → Events clear all indicators

---

## Features

### 1. Queue Widget

**Location**: Inline badge next to "PUBLIC NOTES" in NotesView

**States**:
- 🔵 **Idle** - Blue "Queue for Call" button (no note queued)
- 🟢 **Queued** - Green "✓ Queued" badge with × cancel button
- 🔴 **Active** - Red pulsing "Live" badge (note active in call)
- 🟡 **Conflict** - Yellow "⚠ Conflict" badge (another note already active)

**Behavior**:
- Only visible for work/public notes (hidden for personal notes)
- Tooltip: "Queue for Collaboration"
- Toast on queue: "Queued for Collaboration"
- Auto-expires after 3 minutes if not used
- Persists in localStorage across page refreshes

### 2. Sidebar Active Indicator

**Location**: Note list in NotesView sidebar

**Appearance**:
- Red pulsing "Live" badge next to note title
- Visible for the note currently active in call
- Automatically appears for late joiners
- Clears when call ends

### 3. Late Joiner Synchronization

**Problem**: Users joining after a note is already shared miss the context

**Solution**: Query-on-join pattern
- When user joins call, client queries `GET /active-note`
- Bot returns current active note details (ID, title, owner)
- Client displays appropriate indicators
- ~50-100ms latency, reliable and simple

### 4. Conflict Detection

**Problem**: Multiple users might try to share different notes simultaneously

**Solution**: Server-side conflict detection
- Bot checks if note already active before accepting new one
- Returns 409 Conflict with details of active note
- Client shows toast: "{userName} is already sharing '{noteTitle}'"
- Queue is automatically cleared
- Only one note can be active per call

### 5. Queue Management

**Features**:
- 3-minute timeout with auto-expiration
- Cancel button (×) to remove queue
- Persists across page refreshes
- Automatic cleanup on activation or expiration
- Toast notifications for all state changes

---

## API Endpoints

### POST /api/session/{room}/context

**Purpose**: Activate a note in the call (existing endpoint, enhanced with conflict detection)

**Request**:
```json
{
  "action": "open",
  "userId": "user-id-uuid",
  "activeNoteId": "uuid-of-note"
}
```

**Note**: `userId` is the User.id from the database (UUID), NOT the username/display name or email address.

**Response (Success - 200)**:
```json
{
  "success": true
}
```

**Response (Conflict - 409)**:
```json
{
  "detail": "A note is already active in this call",
  "activeNoteTitle": "Engineering Design Doc",
  "activeNoteOwnerId": "user-id-uuid"
}
```

**Note**: `activeNoteOwnerId` contains the **userId** (User.id from database), NOT an email address.

**Implementation**: `apps/pipecat-daily-bot/bot/server.py` lines 795-836

### GET /api/session/{room}/active-note

**Purpose**: Query current active note for late joiners (new endpoint)

**Request**: No body

**Response (Active Note)**:
```json
{
  "has_active_note": true,
  "note_id": "uuid-of-note",
  "note_title": "Engineering Design Doc",
  "owner_id": "user-id-uuid",
  "owner_name": "John Doe"
}
```

**Note**: `owner_id` contains the **userId** (User.id from database), NOT an email address. The `owner_name` is a display name for UI purposes.

**Response (No Active Note)**:
```json
{
  "has_active_note": false,
  "note_id": null,
  "note_title": null,
  "owner_id": null,
  "owner_name": null
}
```

**Implementation**: `apps/pipecat-daily-bot/bot/server.py` lines 853-915

---

## Frontend Events

### Custom Events

The system uses `window.dispatchEvent` and `window.addEventListener` for cross-component communication:

#### noteActiveInCall
```typescript
window.dispatchEvent(new CustomEvent('noteActiveInCall', {
  detail: {
    noteId: string,
    noteTitle: string
  }
}));
```
**Emitted**: When note becomes active in call  
**Listeners**: NotesView (shows Live badge)

#### noteInactiveInCall
```typescript
window.dispatchEvent(new Event('noteInactiveInCall'));
```
**Emitted**: When note is closed in call  
**Listeners**: NotesView (clears Live badge)

#### dailyCallEnded
```typescript
window.dispatchEvent(new Event('dailyCallEnded'));
```
**Emitted**: When call ends (left-meeting event)  
**Listeners**: NotesView (clears all indicators)

#### noteQueueConflict
```typescript
window.dispatchEvent(new CustomEvent('noteQueueConflict', {
  detail: {
    noteTitle: string,
    userName: string
  }
}));
```
**Emitted**: When 409 conflict detected  
**Listeners**: NotesView (shows toast, clears queue)

---

## Implementation Details

### Files Modified

#### Backend: apps/pipecat-daily-bot/bot/server.py

**Lines 193-198**: ActiveNoteResponse model
```python
class ActiveNoteResponse(BaseModel):
    """Response for active note query."""
    has_active_note: bool
    note_id: str | None = None
    note_title: str | None = None
    owner_id: str | None = None
    owner_name: str | None = None
```

**Lines 795-836**: Conflict detection in POST /context
- Checks if note already active before accepting 'open' action
- Returns 409 with structured error details
- Graceful error handling with try/except

**Lines 853-915**: GET /active-note endpoint
- Queries bot module for active note ID
- Fetches note details from Mesh API
- Returns structured ActiveNoteResponse
- No authentication required (public room state)

#### Frontend: apps/interface/src/features/Notes/components/notes-view.tsx

**Lines 282-285**: Queue state variables
```typescript
const [queuedNoteId, setQueuedNoteId] = useState<string | null>(null);
const [queuedAt, setQueuedAt] = useState<number | null>(null);
const [activeCallNoteId, setActiveCallNoteId] = useState<string | null>(null);
const [callStatus, setCallStatus] = useState<'idle' | 'starting' | 'active'>('idle');
```

**Lines 547-562**: Queue timeout effect (3-minute expiration)

**Lines 564-623**: Event listener effects
- noteActiveInCall → sets activeCallNoteId
- noteInactiveInCall → clears activeCallNoteId
- dailyCallEnded → resets to idle state
- noteQueueConflict → shows toast, clears queue

**Lines 627-669**: Queue action functions
- `handleQueueForCall()`: Validates, sets state, saves to localStorage
- `handleCancelQueue()`: Clears state and localStorage

**Lines 1960-2008**: Queue widget UI component
- 4 conditional states (idle/queued/active/conflict)
- Inline with PUBLIC NOTES badge
- Responsive button/badge styles

**Lines 1840-1849**: Sidebar active indicator
- Red pulsing "Live" badge
- Shown when `activeCallNoteId === note._id`
- Flex layout to prevent title truncation

#### Frontend: apps/interface/src/features/DailyCall/components/Call.tsx

**Lines 614-704**: Dynamic note activation (replaces hardcoded ID)
- Reads queue from localStorage
- Validates 3-minute expiration
- Sends dynamic noteId to bot
- Handles 409 conflicts
- Emits success/conflict events
- Clears queue after activation

**Lines 674-697**: Late joiner sync function
- Queries GET /active-note on join
- 500ms delay after join for stability
- Emits noteActiveInCall if note found
- Silent failure if no active note

**Line 882**: dailyCallEnded event emission
- Triggered on 'left-meeting' Daily event
- Ensures cleanup across all clients

---

## User Flows

### Flow 1: Early Joiner (Queue → Activate)

1. User opens work note in NotesView
2. User clicks "Queue for Call" button
3. System shows green "✓ Queued" badge
4. Toast: "Queued for Collaboration"
5. Note details saved to localStorage
6. User joins DailyCall
7. System reads queue from localStorage
8. System validates queue not expired
9. System sends POST /context to bot
10. Bot activates note context
11. System clears queue from localStorage
12. System emits noteActiveInCall event
13. NotesView shows red "Live" badge (current note)
14. NotesView shows "Live" badge in sidebar
15. User leaves call
16. System emits dailyCallEnded event
17. All indicators cleared

### Flow 2: Late Joiner (Join → Sync)

1. User A has already activated Note X
2. User B joins same call
3. System detects 'joined-meeting' event
4. System checks localStorage (no queue found)
5. System queries GET /active-note (500ms delay)
6. Bot returns Note X details
7. System emits noteActiveInCall event
8. User B sees "Live" badge on Note X
9. Both users now see same indicators

### Flow 3: Conflict (Two Queues)

1. User A queues Note A and starts call
2. Note A becomes active
3. User B queues Note B
4. User B joins same call
5. System attempts to activate Note B
6. Bot detects Note A already active
7. Bot returns 409 Conflict with Note A details
8. System emits noteQueueConflict event
9. User B sees toast: "Alice is already sharing 'Note A'"
10. User B's queue cleared
11. User B sees Note A as active (via late joiner sync)

### Flow 4: Queue Expiration

1. User queues note at timestamp T
2. User does not join call
3. At T + 3 minutes, timeout effect triggers
4. System clears queue state
5. System removes localStorage entry
6. Toast: "Queue expired - Note queue cleared after 3 minutes"
7. Badge disappears

### Flow 5: Manual Cancel

1. User queues note
2. User sees green "✓ Queued" badge
3. User clicks × button
4. System clears queue state
5. System removes localStorage entry
6. Toast: "Queue cancelled - Note will not be shared in call"
7. Badge disappears
8. User joins call → no note activates

---

## Testing

### Manual Test Scenarios

#### Test 1: Basic Queue Flow
**Steps**: Queue note → Join call → Verify activation → Leave call  
**Expected**: Badges show correctly, bot receives context, cleanup on exit

#### Test 2: Late Joiner Sync
**Steps**: User A activates note → User B joins call  
**Expected**: User B sees Live indicator on same note

#### Test 3: Queue Timeout
**Steps**: Queue note → Wait 3 minutes  
**Expected**: Green badge disappears, toast shown, localStorage cleared

#### Test 4: Conflict Detection
**Steps**: User A activates Note A → User B tries Note B  
**Expected**: User B sees conflict toast with User A's note title

#### Test 5: Personal Note Validation
**Steps**: Switch to personal mode → Try to queue  
**Expected**: Button hidden, or validation toast if triggered

#### Test 6: Refresh Persistence
**Steps**: Queue note → Refresh page  
**Expected**: Green badge reappears if not expired

#### Test 7: Cancel Queue
**Steps**: Queue note → Click × → Join call  
**Expected**: Note does NOT activate

#### Test 8: Multiple Sequential Notes
**Steps**: Activate Note A → Close → Activate Note B  
**Expected**: Only one note active at a time, smooth transitions

### API Testing

```bash
# Test GET /active-note (no active note)
curl http://localhost:8080/api/session/test-room/active-note

# Test POST /context (activate note)
curl -X POST http://localhost:8080/api/session/test-room/context \
  -H "Content-Type: application/json" \
  -d '{"action":"open","userId":"user-uuid-1","activeNoteId":"note-123"}'

# Test conflict (second activation)
curl -X POST http://localhost:8080/api/session/test-room/context \
  -H "Content-Type: application/json" \
  -d '{"action":"open","userId":"user-uuid-2","activeNoteId":"note-456"}'
# Expected: 409 Conflict
```

### Browser Console Logs

**NotesView logs**:
```
[notes-queue] Expiring queued note after timeout
[notes] Note active in call: {title}
[notes] No note active in call
[notes] Call ended, clearing active note indicator
```

**Call.tsx logs**:
```
[notes] joined-meeting event detected
[notes] Sending queued note context to bot: {noteId}
[notes] Successfully sent note context to bot
[notes] Querying active note state as late joiner
[notes] Active note detected: {title}
[notes] Conflict: another note is already active
[notes] Call ended, emitted dailyCallEnded event
```

---

## Technical Considerations

### State Management

**Why localStorage?**
- Persists across page refreshes during call setup
- Simple key-value storage, no complex state sync needed
- Automatically cleared on activation or expiration
- Single source of truth for queue state

**Event-Driven Architecture**:
- Decouples NotesView from Call.tsx
- Clean separation of concerns
- Easy to add new listeners
- No prop drilling through component tree

### Conflict Resolution Strategy

**Server-Side Validation** (chosen approach):
- Bot maintains authoritative state
- Single source of truth prevents race conditions
- Graceful degradation if network issues
- Clear error messages with context

**Alternative Considered**: Client-side coordination via Daily.co messages
- Rejected due to complexity and race condition risks
- Server-side is simpler and more reliable

### Late Joiner Sync Strategy

**Query-on-Join** (chosen approach):
- Simple HTTP GET request
- ~50-100ms latency (acceptable)
- Stateless, no subscription management
- Works with existing infrastructure

**Alternative Considered**: WebSocket push notifications
- Rejected as overkill for this use case
- Would require additional infrastructure
- Query-on-join is sufficient for MVP

### Queue Timeout

**3-Minute Duration**:
- Long enough for typical call setup flow
- Short enough to prevent stale queues
- User can always re-queue if needed
- Toast notification provides clear feedback

---

## Known Limitations

1. **Single Active Note**: Only one note can be active per call at a time
2. **Work Mode Only**: Personal notes cannot be queued or shared
3. **3-Minute Timeout**: Queue expires if not used within 3 minutes
4. **No Queue Persistence Across Sessions**: Queue cleared on logout
5. **No Multi-Room Support**: Queue is room-agnostic until activation
6. **No Offline Support**: Requires active internet connection

---

## Future Enhancements

### Potential Improvements

1. **Multiple Notes**: Support sidebar of multiple active notes
2. **Note History**: Show history of notes discussed in call
3. **Quick Switch**: Button to quickly switch between notes in call
4. **Permissions**: Control who can activate notes in call
5. **Notifications**: Desktop notifications when note becomes active
6. **Analytics**: Track note usage patterns in calls
7. **Templates**: Pre-queue common note templates
8. **Keyboard Shortcuts**: Quick key to queue/cancel
9. **Mobile Optimization**: Touch-friendly queue controls
10. **Export**: Download notes discussed in call session

### Technical Debt

- Reduce complexity in notes-view.tsx (currently 1810 lines)
- Extract queue logic into custom hook
- Add TypeScript types for CustomEvent details
- Add unit tests for queue timeout logic
- Add E2E tests for conflict scenarios
- Document Pydantic models with OpenAPI annotations

---

## Troubleshooting

### Issue: Queue doesn't activate on call join

**Possible Causes**:
- Queue expired (check timestamp)
- localStorage cleared
- Bot server not running
- Network connectivity issues

**Debug Steps**:
1. Check browser console for errors
2. Verify `nia_queued_note` exists in localStorage
3. Check bot server logs
4. Verify `POST /context` request in Network tab

### Issue: Late joiner doesn't see active note

**Possible Causes**:
- Bot not running
- 500ms delay insufficient
- CORS blocking request
- Event listener not registered

**Debug Steps**:
1. Check `GET /active-note` response
2. Look for JavaScript errors in console
3. Verify event listener in React DevTools
4. Check if component unmounted before event

### Issue: Conflict toast doesn't appear

**Possible Causes**:
- Response not 409
- Response missing conflict details
- Event listener not registered
- Toast system error

**Debug Steps**:
1. Check Network tab for 409 response
2. Verify response body has conflict details
3. Check console for event emission logs
4. Test toast system with manual call

### Issue: Indicators don't clear on call end

**Possible Causes**:
- `left-meeting` event not firing
- Event listener removed too early
- Component unmounted
- State not updating

**Debug Steps**:
1. Check for 'left-meeting' event in logs
2. Verify `dailyCallEnded` event emitted
3. Check React component lifecycle
4. Verify state setters are called

---

## Security Considerations

### Access Control

- **No Authentication on GET /active-note**: Room state is considered public within call
- **Participant Validation**: Username/email used for tracking, not authorization
- **Note Permissions**: Respects existing note access controls (work vs personal)

### Data Privacy

- **No PII in localStorage**: Only note ID, title, timestamp stored
- **Automatic Cleanup**: Queue cleared after use or expiration
- **No Logging of Content**: Only metadata logged, not note content
- **Server-Side Filtering**: Bot validates note access before activation

### Rate Limiting

**Current**: No rate limiting implemented

**Recommendation**: Add rate limiting for:
- POST /context: Max 5 activations per user per minute
- GET /active-note: Max 10 queries per user per minute

---

## Performance Metrics

### Expected Performance

- **Queue Action**: <50ms (localStorage write)
- **Activate Note**: <200ms (HTTP POST + bot processing)
- **Late Joiner Sync**: <150ms (HTTP GET)
- **Conflict Detection**: <100ms (server-side check)
- **Event Propagation**: <10ms (DOM events)

### Monitoring

**Key Metrics to Track**:
- Queue activation success rate
- Late joiner sync success rate
- Conflict detection accuracy
- Average time to activate note
- Queue expiration rate

---

## Glossary

- **Queue**: Temporary storage of note selection for future call activation
- **Active Note**: Note currently shared and providing context to bot in call
- **Late Joiner**: User who joins call after note already activated
- **Conflict**: Situation where two users try to activate different notes simultaneously
- **Pipecat Bot**: AI assistant in DailyCall that uses note content for context
- **Early Joiner**: User who joins call with note already queued

---

## References

### Related Documentation

- `/docs/ARCHITECTURE.md` - Overall system architecture
- `/docs/DEVELOPER_GUIDE.md` - Development setup and guidelines
- `/README.testing.md` - Testing strategies and tools

### External Documentation

- [Daily.co Events API](https://docs.daily.co/reference/daily-js/events)
- [Pipecat Framework](https://github.com/pipecat-ai/pipecat)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)

---

**Last Updated**: October 2024  
**Maintained By**: NIA Engineering Team  
**Questions?** See `/docs/DEVELOPER_GUIDE.md` or contact the team
