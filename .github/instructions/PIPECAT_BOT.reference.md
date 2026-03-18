# Pipecat Bot Development Instructions

## Purpose
Guidelines for AI-assisted development of the Pipecat-based voice bot server (`apps/pipecat-daily-bot/`).

## Architecture Context

The Pipecat bot is a Python FastAPI server that:
- Manages real-time voice conversations via Daily.co WebRTC
- Integrates with Deepgram STT, OpenAI LLM, and a configurable TTS provider (ElevenLabs by default, Kokoro/Chorus when `BOT_TTS_PROVIDER=kokoro`)
- Maintains session state and context for ongoing calls
- Provides REST API for controlling bot behavior mid-session

### Text-to-Speech Providers

- `BOT_TTS_PROVIDER` defaults to `elevenlabs`. Dashboard voice settings and `/api/bot/join` now forward the selected provider and voice id.
- When targeting Kokoro, ensure `KOKORO_TTS_API_KEY`, `KOKORO_TTS_BASE_URL`, and `KOKORO_TTS_VOICE_ID` are present (optional overrides: `KOKORO_TTS_SAMPLE_RATE`, `KOKORO_TTS_AUTO_MODE`, `KOKORO_TTS_ENABLE_SSML_PARSING`, etc.).
- Pipecat falls back to ElevenLabs if the provider is missing or misconfigured; update tests whenever new provider-specific parameters are introduced.

**Key Files:**
- `bot/server.py` - FastAPI endpoints, session management, bot lifecycle
- `bot/bot.py` - PipecatBot class, pipeline setup, Daily.co integration
- `bot/system_prompts.py` - System prompts and conversation context
- `requirements.txt` - Python dependencies

## Development Patterns

### 0. CRITICAL: Python Logging Format

**MANDATORY Pattern**: Old-school % string formatting for ALL logger calls
```python
# ✅ CORRECT - Use % operator with tuple
logger.info("[module] message with %s and %s" % (var1, var2))
logger.debug("[module] single value: %s" % value)
logger.error("[module] error: %s context: %s" % (error, context))

# ❌ WRONG - These produce literal '%s' in logs
logger.info("[module] message with %s and %s", var1, var2)  # comma notation
logger.info(f"[module] message with {var1} and {var2}")      # f-strings
```

**Why**: The logging system requires old-school % formatting. Using comma notation or f-strings results in literal `%s` appearing in log output instead of actual variable values.

**Rule**: ALWAYS use `"string %s" % (value,)` or `"string %s %s" % (val1, val2)` for logging.

### 1. Session State Management

**Pattern**: Session-scoped state stored in `RTVIProcessor` or bot module variables
```python
# In bot module (server.py)
bot_sessions: Dict[str, SessionData] = {}

# Access in endpoints
@app.post("/api/session/{room}/context")
async def set_context(room: str, request: ContextRequest):
    if room not in bot_sessions:
        raise HTTPException(status_code=404)
    bot_sessions[room].context = request.context
```

**When to use:**
- Cross-request state (active note ID, user preferences)
- State that survives bot reconnection
- State needed by late joiners

**Anti-pattern**: Storing in bot pipeline (lost on reconnection)

### 2. Conflict Detection

**Pattern**: Check-then-set with 409 response for concurrent modification
```python
if session.has_active_resource and session.active_resource != request.resource_id:
    raise HTTPException(
        status_code=409,
        detail={
            "error": "Resource conflict",
            "active_resource": session.active_resource,
            "active_owner": session.active_owner
        }
    )
```

**When to use:**
- Multiple users can request same resource type
- First-come-first-served enforcement needed
- Client needs to know who won the race

### 3. Late Joiner Synchronization

**Pattern**: Query endpoint for current session state
```python
@app.get("/api/session/{room}/state")
async def get_state(room: str) -> StateResponse:
    """Query current session state for late joiners."""
    session = bot_sessions.get(room)
    if not session:
        return StateResponse(has_state=False)
    
    return StateResponse(
        has_state=True,
        current_resource=session.active_resource,
        owner_id=session.owner_id
    )
```

**When to use:**
- State changes while users offline
- New users join mid-session
- Reconnection scenarios

**Anti-pattern**: Using WebSockets (adds complexity, Daily.co already provides real-time channel)

### 4. Event Emission to Frontend

**Pattern**: Emit events through Daily.co app message channel
```python
# In bot pipeline (bot.py)
await self.app_message_handler({
    'event_type': 'resource_activated',
    'resource_id': resource_id,
    'user_id': user_id,
    'timestamp': datetime.utcnow().isoformat()
})
```

**When to use:**
- State changes that affect all participants
- User actions that trigger UI updates
- Session lifecycle events (started, ended)

**Important**: Use snake_case for Python event fields (converted from camelCase in frontend)

### 5. API Request Validation

**Pattern**: Pydantic models with explicit field types and descriptions
```python
class ResourceRequest(BaseModel):
    """Request to activate a resource in the session."""
    userId: str  # Database User.id (UUID)
    action: Literal['open', 'close']
    resourceId: str | None = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "userId": "123e4567-e89b-12d3-a456-426614174000",
                "action": "open",
                "resourceId": "note-uuid"
            }
        }
```

**Field naming convention:**
- Frontend sends camelCase: `userId`, `resourceId`, `activeNote`
- Backend uses camelCase in Pydantic models (for JSON serialization)
- Backend uses snake_case in internal Python code: `user_id`, `resource_id`
- Events emitted to frontend use snake_case: `'user_id': user_id`

### 6. Error Handling

**Pattern**: Structured HTTP exceptions with detail dictionaries
```python
try:
    result = await some_operation()
except SpecificError as e:
    logger.error(f"Operation failed: {e}")
    raise HTTPException(
        status_code=422,
        detail={
            "error": "Operation failed",
            "reason": str(e),
            "context": {"field": value}
        }
    )
```

**Status codes:**
- `404` - Session/resource not found
- `409` - Conflict (resource already in use)
- `422` - Validation error (invalid request data)
- `500` - Server error (unexpected failure)

### 7. Integration with Mesh API

**Pattern**: Async HTTP calls with error handling
```python
async with httpx.AsyncClient() as client:
    try:
        response = await client.get(
            f"{MESH_URL}/graphql",
            json={"query": query, "variables": variables},
            headers={"Authorization": f"Bearer {token}"}
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as e:
        logger.error(f"Mesh API error: {e}")
        return None
```

**When to fetch:**
- Late joiner needs resource metadata (title, owner name)
- Bot needs to validate resource exists
- Session needs to display resource info

**Anti-pattern**: Storing redundant data; query when needed

## Testing Requirements

### Test Execution

**CRITICAL**: Always run tests from the `apps/pipecat-daily-bot/bot` directory using `poetry run pytest`.

```bash
cd apps/pipecat-daily-bot/bot
poetry run pytest tests/
```

**Why**: The tests rely on the poetry environment and relative paths from the `bot` directory. Running from the root or without `poetry run` will fail.

### Unit Tests

- Test conflict detection logic
- Test state transitions
- Mock Daily.co and Mesh API calls

### Integration Tests

- Test full request/response cycle
- Test late joiner synchronization
- Test concurrent modification scenarios

### Manual Testing

- Multi-user scenarios (2-3 participants)
- Late joiner flow
- Conflict detection (different resources)
- Session cleanup on call end

## Common Pitfalls

1. **Using Daily participant ID as user identifier**
   - ❌ Wrong: `participant_id` from Daily.co
   - ✅ Correct: `userId` from database (User.id UUID)

2. **Storing state in bot pipeline**
   - ❌ Wrong: Instance variables in `PipecatBot`
   - ✅ Correct: Module-level `bot_sessions` dict

3. **Forgetting late joiner sync**
   - ❌ Wrong: Emit event only, no query endpoint
   - ✅ Correct: Event + query endpoint for current state

4. **Inconsistent field naming**
   - ❌ Wrong: Mixing camelCase/snake_case randomly
   - ✅ Correct: camelCase in JSON, snake_case in Python code

5. **Not handling 404 for missing sessions**
   - ❌ Wrong: Assume session exists
   - ✅ Correct: Check `bot_sessions.get(room)` and raise 404

## Quality Checklist

Before completing Pipecat bot changes:

- [ ] Pydantic models have docstrings and examples
- [ ] Error responses include structured detail dicts
- [ ] Late joiner query endpoint exists for stateful features
- [ ] Conflict detection returns 409 with current state
- [ ] Events use snake_case field names
- [ ] Request models use camelCase (for JSON compatibility)
- [ ] Session cleanup on bot disconnection
- [ ] Logging includes room/user context
- [ ] Integration with Mesh API handles errors gracefully
- [ ] Manual testing with 2+ users completed

## Related Documentation

- `ARCHITECTURE.reference.md` - Platform architecture overview
- `DEVELOPMENT.reference.md` - Testing and PR workflows
- `apps/pipecat-daily-bot/README.md` - Bot setup and configuration
- `docs/features/pipecat-beats-conversation.md` - Flow architecture details

**Full docs** (load on-demand):

- `ARCHITECTURE.md` - Complete system architecture
- `DEVELOPER_GUIDE.md` - Comprehensive development guide
