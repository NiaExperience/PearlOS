# Bot Participant Identification for Resource Sharing

**Date**: October 29, 2025  
**Context**: Phase 2 Bot Integration - Identifying which participant initiates `bot_set_current_note` or `bot_set_current_applet`  
**Problem**: Bot needs to know which user's note/applet to share when multiple participants are in the call

## Current Architecture

### Existing Infrastructure

1. **Participant Session Metadata** (`userData`):
   - `sessionUserId`: User's database ID
   - `sessionUserName`: Display name
   - `sessionUserEmail`: Email address
   - Set during join via `joinRoom()` in `botClient.ts`
   - Accessible in bot via `participant.info.userData`

2. **FunctionCallParams** Object:
   - `params.arguments`: LLM-provided function arguments
   - `params.room_url`: Current room URL
   - `params.forwarder`: Event forwarder
   - `params.context`: LLM conversation context (includes messages, user info)
   - **Not currently available**: Participant ID of who triggered the conversation

3. **Bot Participant Tracking**:
   - `get_session_user_id_from_participant()`: Maps Daily participant ID → sessionUserId
   - `lookup_participant_meta()`: Retrieves participant metadata from transport
   - `active_participants`: Dictionary of current participants in room

## Problem Statement

When a user says "open my meeting notes," the bot needs to determine:

1. **Which participant** made the request
2. **Which user's resources** to query (using their `sessionUserId` as `ownerId`)
3. **Who to credit** as the resource owner when sharing with others

Currently, the LLM receives the user's speech but the function call handler has no direct way to know which participant spoke.

## Proposed Solutions

### Option 1: LLM Context Enhancement (Recommended)

**Approach**: Add participant identity to LLM context so it's available in conversation memory

**Implementation**:

```python
# In bot.py pipeline setup
def build_system_prompt_with_participant_context(participants):
    """Build system prompt with current participant information."""
    participant_info = []
    for pid, data in participants.items():
        if pid == 'local':  # Skip bot
            continue
        user_data = data.get('info', {}).get('userData', {})
        if user_id := user_data.get('sessionUserId'):
            name = user_data.get('sessionUserName', 'User')
            participant_info.append(f"- {name} (userId: {user_id})")
    
    context = "\n".join(participant_info) if participant_info else "No participants yet"
    return f"""
You are Pearl, an AI assistant in a Daily call.

Current Participants:
{context}

When a user asks to open their note/applet, use their userId from the context above.
"""

# In tool handler (sharing_tools.py)
async def bot_set_current_note(params: FunctionCallParams):
    # Extract userId from LLM conversation context
    context = params.context  # Access conversation history
    
    # Option 1A: Parse from system message
    system_message = context.messages[0] if context.messages else None
    # Extract userId from system prompt
    
    # Option 1B: Add to function arguments via prompt engineering
    # LLM includes userId: "user-123" in its function call arguments
    user_id = params.arguments.get("userId")  # Provided by LLM
```

**Pros**:

- ✅ Natural language understanding: LLM can infer "my notes" → specific userId
- ✅ Handles multi-participant scenarios: "show John's presentation"
- ✅ No changes to Pipecat framework or transport layer
- ✅ Works with existing conversation context

**Cons**:

- ⚠️ Requires prompt engineering to ensure LLM includes userId
- ⚠️ LLM could make mistakes or omit the userId
- ⚠️ System prompt must be updated when participants join/leave

**Complexity**: Medium  
**Reliability**: Medium-High (depends on LLM accuracy)

---

### Option 2: Single-User Assumption (Simplest)

**Approach**: Assume single human participant per call, exclude bot

**Implementation**:

```python
# In sharing_tools.py
async def _get_current_user_id(room_url: str) -> str | None:
    """Get the userId of the (only) human participant in the call."""
    if not _transport:
        return None
    
    participants = _transport.get_participants()
    for pid, data in participants.items():
        if pid == 'local':  # Skip bot
            continue
        
        user_data = data.get('info', {}).get('userData', {})
        if user_id := user_data.get('sessionUserId'):
            logger.info(f"[sharing] Found user_id={user_id} for pid={pid}")
            return user_id
    
    logger.warning("[sharing] No human participant found with userId")
    return None

# In bot_set_current_note
async def bot_set_current_note(params: FunctionCallParams):
    room_url = params.room_url
    user_id = await _get_current_user_id(room_url)
    
    if not user_id:
        return {"error": "Could not identify user in call"}
    
    # Query notes where ownerId = user_id
    note = await notes_actions.fuzzy_search_notes(
        tenant_id=tenant_id,
        user_id=user_id,  # Use detected user
        title=title
    )
```

**Pros**:

- ✅ Simple, no LLM or prompt changes needed
- ✅ Reliable for single-user scenario (most common)
- ✅ Matches current bot usage pattern (1:1 calls)

**Cons**:

- ❌ Breaks in multi-user calls (which user's notes?)
- ❌ Assumes only one human participant
- ❌ Won't scale to collaborative scenarios

**Complexity**: Low  
**Reliability**: High (for single-user calls)  
**Recommendation**: **Use this for Phase 2**, defer multi-user to Phase 3

---

### Option 3: Speaker Detection via VAD (Advanced)

**Approach**: Use Voice Activity Detection to identify who's currently speaking

**Implementation**:

```python
# In bot.py - track recent speakers
_recent_speakers: dict[str, float] = {}  # pid → last_spoke_timestamp

@transport.event_handler("on_participant_audio_level")
async def on_audio_level(transport, participant_id, audio_level):
    if audio_level > 0.1:  # Speaking threshold
        _recent_speakers[participant_id] = time.time()

# In sharing_tools.py
async def _get_most_recent_speaker(room_url: str) -> str | None:
    """Get userId of participant who spoke most recently."""
    if not _recent_speakers:
        return None
    
    # Get most recent speaker (within last 5 seconds)
    recent_pid = max(_recent_speakers.items(), 
                     key=lambda x: x[1] if time.time() - x[1] < 5 else 0)[0]
    
    # Map participant ID → userId
    return get_session_user_id_from_participant(recent_pid)
```

**Pros**:

- ✅ Automatic detection, no LLM involvement
- ✅ Works for multi-participant calls
- ✅ Natural: whoever spoke last is the requester

**Cons**:

- ⚠️ Complex: requires VAD integration and timing logic
- ⚠️ Can fail if multiple people speak simultaneously
- ⚠️ Latency: need to wait for audio processing
- ⚠️ False positives: background noise, crosstalk

**Complexity**: High  
**Reliability**: Medium  
**Recommendation**: Consider for Phase 3+

---

### Option 4: Explicit Participant ID in Tool Context (Framework Change)

**Approach**: Modify Pipecat/bot framework to pass participant ID to tool handlers

**Implementation**:

```python
# In toolbox.py - enhance wrapper
async def make_wrapper(func, name):
    async def wrapper(params):
        # NEW: Add participant_id to params
        params.participant_id = _current_speaker_pid  # From VAD or turn-taking
        params.user_id = get_session_user_id_from_participant(params.participant_id)
        
        return await func(params)
    return wrapper

# In sharing_tools.py - use directly
async def bot_set_current_note(params: FunctionCallParams):
    user_id = params.user_id  # Directly available!
    
    note = await notes_actions.fuzzy_search_notes(
        tenant_id=tenant_id,
        user_id=user_id,
        title=title
    )
```

**Pros**:

- ✅ Clean API: participant identity always available
- ✅ Reliable: no LLM guessing or VAD complexity
- ✅ Scales to multi-user scenarios

**Cons**:

- ❌ Requires framework changes to Pipecat/toolbox
- ❌ Needs turn-taking or speaker tracking system
- ❌ More infrastructure to maintain

**Complexity**: High  
**Reliability**: High  
**Recommendation**: Long-term architecture improvement

---

### Option 5: Hybrid Approach (Graceful Degradation)

**Approach**: Try multiple strategies in order of reliability

**Implementation**:

```python
async def _resolve_user_id(params: FunctionCallParams, room_url: str) -> str | None:
    """Resolve userId using multiple strategies (fallback chain)."""
    
    # Strategy 1: Check if LLM provided userId explicitly
    if user_id := params.arguments.get("userId"):
        logger.info(f"[sharing] userId from LLM: {user_id}")
        return user_id
    
    # Strategy 2: Parse from LLM context (if prompt includes it)
    if params.context:
        # Extract from conversation history
        user_id = _extract_user_from_context(params.context)
        if user_id:
            logger.info(f"[sharing] userId from context: {user_id}")
            return user_id
    
    # Strategy 3: Single-user assumption (most common case)
    participants = _transport.get_participants()
    human_participants = [
        p for pid, p in participants.items() 
        if pid != 'local'  # Exclude bot
    ]
    
    if len(human_participants) == 1:
        user_id = human_participants[0].get('info', {}).get('userData', {}).get('sessionUserId')
        if user_id:
            logger.info(f"[sharing] userId from single-user: {user_id}")
            return user_id
    
    # Strategy 4: Most recent speaker (if VAD available)
    if user_id := await _get_most_recent_speaker(room_url):
        logger.info(f"[sharing] userId from VAD: {user_id}")
        return user_id
    
    logger.warning("[sharing] Could not resolve userId - all strategies failed")
    return None
```

**Pros**:

- ✅ Robust: handles multiple scenarios
- ✅ Graceful degradation: falls back to simpler methods
- ✅ Future-proof: can add more strategies later

**Cons**:

- ⚠️ Complex: multiple code paths to maintain
- ⚠️ Harder to debug when strategies conflict

**Complexity**: Medium-High  
**Reliability**: High

---

## Recommendation for Phase 2

### **Use Option 2 (Single-User Assumption) + Basic Validation**

**Rationale**:

1. **Current usage**: Most bot calls are 1:1 (user + bot)
2. **Simplicity**: No LLM changes, no framework changes, no VAD
3. **Reliability**: 100% accurate for intended use case
4. **Fast implementation**: Can ship Phase 2 quickly
5. **Clear error handling**: Explicitly fail if ambiguous

**Implementation Strategy**:

```python
# In sharing_tools.py
async def _get_current_user_id(room_url: str) -> tuple[str | None, str]:
    """Get the userId of the human participant in the call.
    
    Returns:
        (user_id, error_message) - user_id is None if error
    """
    if not _transport:
        return None, "No transport available"
    
    participants = _transport.get_participants()
    human_participants = []
    
    for pid, data in participants.items():
        if pid == 'local':  # Skip bot
            continue
        
        user_data = data.get('info', {}).get('userData', {})
        if user_id := user_data.get('sessionUserId'):
            human_participants.append((pid, user_id))
    
    if len(human_participants) == 0:
        return None, "No human participants found in call"
    
    if len(human_participants) > 1:
        # Phase 2 limitation: multi-user not supported yet
        user_names = [data.get('info', {}).get('userData', {}).get('sessionUserName', 'Unknown') 
                      for _, data in participants.items()]
        return None, f"Multiple participants detected ({', '.join(user_names)}). Please specify which user's resources to access."
    
    return human_participants[0][1], ""  # Return the single user's ID

# Usage in bot_set_current_note
user_id, error_msg = await _get_current_user_id(room_url)
if not user_id:
    return {
        "success": False,
        "error": error_msg,
        "user_message": f"Sorry, I couldn't identify whose note to open. {error_msg}"
    }
```

**Phase 3 Migration Path**:

- Add Option 1 (LLM context) for multi-user support
- Or add Option 3 (VAD) for automatic detection
- Keep single-user as fast path/fallback

---

## Implementation Checklist

- [ ] Add `_get_current_user_id()` helper to sharing_tools.py
- [ ] Update `bot_set_current_note` to use resolved userId
- [ ] Update `bot_set_current_applet` to use resolved userId
- [ ] Add error messages for ambiguous cases
- [ ] Update plan document with participant identification approach
- [ ] Add unit tests for single-user and multi-user scenarios
- [ ] Document Phase 3 migration path in follow-up tasks

---

**Last Updated**: October 29, 2025  
**Status**: **ACCEPTED - Option 5 (Hybrid Approach)** with LLM system prompt enhancement  
**Implementation**: See Phase 2 plan Checkpoint 3 for detailed specifications  
**Recommended Option**: Option 5 (Hybrid) for Phase 2, with future VAD support in Phase 3+

---

## Decision Summary

**Selected**: Option 5 (Hybrid Approach) with following enhancements:

1. **Multi-strategy resolution** with graceful fallback:
   - Strategy 1: LLM-provided userId in function arguments
   - Strategy 2: Parse userId from LLM conversation context
   - Strategy 3: Single-user assumption (most common)
   - Strategy 4: VAD/speaker detection (future Phase 3+)

2. **LLM system prompt enhancement**:
   - Include participant list with userId and username in system prompt
   - Update dynamically when participants join/leave
   - Enable LLM to understand "my notes" → specific userId
   - Support explicit references: "show John's presentation" → John's userId

3. **Session history filtering**:
   - For DailyCall sessions (non-private): Omit joining user's session history from system prompt
   - For private/stealth participants: Retain full context access
   - Prevents information leakage across multi-user calls

4. **Clear error handling**:
   - No strategy succeeds: "Could not identify which user's resources to access"
   - Multi-user ambiguity: "Multiple participants detected. Please specify whose resources."
   - Explicit about limitations while preserving UX

**Implementation Location**:

- `apps/pipecat-daily-bot/bot/tools/sharing_tools.py` - `_resolve_user_id()` helper
- `apps/pipecat-daily-bot/bot/bot.py` - System prompt building with participant context

See `docs/transitions/organization-resource-sharing-phase2-bot-integration.md` Checkpoint 3 for full implementation details.

