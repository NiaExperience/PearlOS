# NCP/Niabrain Routes vs Our Current Architecture

**Date:** October 24, 2025  
**Question:** How/why is the NCP/niabrain using routes? Is there a corrollary in our current work?

---

## TL;DR

**NCP uses FastAPI routes because it's a REST API service** that sits between the frontend and backend services. **Niabrain uses routes because it's also a FastAPI app** that handles WebSocket connections for voice pipelines.

**Our pipecat-daily-bot already uses FastAPI routes in `server.py`** - we just don't have the tool routes pattern yet.

---

## Architecture Comparison

### NCP (Nia Context Protocol) - REST API Gateway

```
Frontend (interface)
    ↓ HTTP POST
NCP Server (FastAPI)
    ├── /showAgenda (route)
    ├── /showSpeakers (route)
    ├── /searchYouTubeVideos (route)
    └── ...
    ↓ calls services
Services Layer
    ├── agenda_service.py
    ├── speaker_service.py
    └── youtube_service.py
    ↓ HTTP GET/POST
External APIs (Mesh, YouTube, etc.)
```

**Why routes?** NCP is a **REST API server** - it exposes HTTP endpoints for each tool function.

---

### Niabrain - WebSocket Voice Server

```
Frontend (interface)
    ↓ WebSocket handshake
Niabrain Server (FastAPI)
    ├── POST /api/ws/connect (route - get WS URL)
    └── WebSocket /ws (route - voice pipeline)
    ↓ builds pipeline
Pipecat Pipeline (voice-to-voice)
    ├── STT (Deepgram)
    ├── LLM (OpenAI)
    ├── TTS (ElevenLabs)
    └── Tools (via HTTP to NCP)
```

**Why routes?** Niabrain is a **WebSocket server** - it needs HTTP endpoints for connection setup and WebSocket endpoint for voice streaming.

---

### Our Pipecat-Daily-Bot - Hybrid Architecture

```
Frontend (interface)
    ↓ HTTP POST
server.py (FastAPI) ← WE ALREADY HAVE ROUTES!
    ├── POST /join (spawn bot process)
    ├── POST /leave (terminate bot)
    ├── GET /health (health check)
    ├── WebSocket /admin (admin messages)
    └── GET /events (SSE stream)
    ↓ spawns process
bot.py (Pipecat pipeline)
    ├── Daily.co transport (WebRTC)
    ├── STT → LLM → TTS
    └── Tools (direct to Mesh GraphQL)
```

**Why routes?** `server.py` is a **control plane** - it manages bot lifecycle via HTTP endpoints.

---

## Key Difference: Where Tools Are Invoked

### NCP Pattern (Tool Routes)

```python
# NCP exposes tools as HTTP routes
@router.post("/searchYouTubeVideos")  # ← Tool is a route
@tool_route(name="searchYouTubeVideos", ...)
async def search_youtube_videos(request: YouTubeSearchRequest):
    # Call service layer
    result = await youtube_service.search_videos(request.query)
    return {"system_message": "...", "metadata": result}
```

**Who calls it:** LLM (via HTTP POST to NCP server)

**Data flow:**
```
LLM function call → HTTP POST /searchYouTubeVideos → NCP route → Service → External API
```

---

### Niabrain Pattern (Tool Functions via HTTP)

```python
# Niabrain calls NCP tools via HTTP
async def call_ncp_tool(assistant_name, function_name, params):
    endpoint = f"/{function_name}"  # e.g., /searchYouTubeVideos
    payload = {"assistantName": assistant_name, **params.arguments}
    
    # HTTP POST to NCP server
    result = await _make_ncp_request(endpoint, payload)
    await params.result_callback(result)
```

**Who calls it:** Pipecat LLM service (function calling handler)

**Data flow:**
```
LLM function call → Niabrain handler → HTTP POST to NCP → NCP route → Service
```

---

### Our Current Pattern (Direct Mesh Integration)

```python
# We call Mesh GraphQL directly from tool handlers
async def create_note_handler(function_name, tool_call_id, args, ...):
    # Direct GraphQL call
    note = await create_note(mesh_client, args["title"], args["content"], ...)
    
    # Emit event to frontend
    await forwarder.emit_tool_event(events.NOTE_CREATED, {"note_id": note.id})
    
    # Return to LLM
    await result_callback(FunctionCallResultFrame(...))
```

**Who calls it:** Pipecat LLM service (function calling handler)

**Data flow:**
```
LLM function call → Tool handler → Actions → Mesh GraphQL → Database
```

---

## The Routes Question: Do We Need Them?

### What NCP Routes Provide

1. **HTTP interface for tools** - Expose tools via REST API
2. **Separation of concerns** - Tools live in separate service
3. **Language agnostic** - Any language can call HTTP endpoints
4. **Centralized tool server** - One NCP serves multiple clients
5. **Easy testing** - Can test tools via curl/Postman

### What We Already Have

Our `server.py` **already has routes**:

```python
# apps/pipecat-daily-bot/bot/server.py (FastAPI app)

@app.post("/join")
async def join_room(request: JoinRequest = ...) -> JoinResponse:
    """Spawn a bot process for a room."""
    ...

@app.post("/leave")
async def leave_room(request: LeaveRequest = ...) -> Response:
    """Terminate a bot session."""
    ...

@app.get("/health")
async def health() -> HealthResponse:
    """Health check endpoint."""
    ...

@app.websocket("/admin")
async def admin_websocket(websocket: WebSocket):
    """Admin control WebSocket."""
    ...

@app.get("/events")
async def events_stream(room_url: str = ...) -> StreamingResponse:
    """SSE stream for bot events."""
    ...
```

**We have routes for:**
- Bot lifecycle management (join/leave)
- Health monitoring
- Admin control
- Event streaming

**We DON'T have routes for:**
- Individual tool functions (like `/createNote`, `/searchYouTube`)

---

## Should We Add Tool Routes?

### Option A: Current Pattern (Direct Integration)

```python
# bot/tools/notes_tools.py
@bot_tool(name="bot_create_note", ...)
async def create_note_handler(...):
    # Direct call to Mesh
    note = await create_note(mesh_client, ...)
    await result_callback(...)
```

**Pros:**
- ✅ Direct, fast (no HTTP overhead)
- ✅ Type-safe (Pydantic → GraphQL)
- ✅ Simpler architecture (fewer moving parts)
- ✅ Tools are part of bot process

**Cons:**
- ❌ Tools can't be shared across services
- ❌ Testing requires bot environment
- ❌ Tightly coupled to Mesh

---

### Option B: NCP-Style Tool Routes

```python
# server.py - Add tool routes
@app.post("/tools/createNote")
@bot_tool_route(name="bot_create_note", ...)
async def create_note_route(request: CreateNoteRequest):
    # Call action layer
    note = await create_note(mesh_client, ...)
    return {"system_message": "...", "metadata": {...}}

# bot.py - Call via HTTP
async def create_note_handler(...):
    # HTTP POST to server.py
    result = await call_bot_tool_api("/tools/createNote", args)
    await result_callback(result)
```

**Pros:**
- ✅ Tools exposed via HTTP (testable with curl)
- ✅ Could be shared with other services
- ✅ Separation: control plane vs tools
- ✅ Matches NCP pattern (easier migration)

**Cons:**
- ❌ HTTP overhead for every tool call
- ❌ More complex architecture
- ❌ Requires HTTP client in bot.py
- ❌ Tools run in server.py process (different from bot)

---

### Option C: Hybrid (Recommended)

```python
# server.py - Expose tool registry via route (read-only)
@app.get("/tools")
async def get_tools() -> ToolRegistryResponse:
    """Get available tools for dynamic discovery."""
    discovery = BotToolDiscovery()
    tools = discovery.discover_tools()
    return {"tools": tools, "total": len(tools)}

# bot.py - Tools execute directly (as now)
@bot_tool(name="bot_create_note", ...)
async def create_note_handler(...):
    # Direct execution (no HTTP)
    note = await create_note(mesh_client, ...)
    await result_callback(...)
```

**Pros:**
- ✅ Best of both worlds
- ✅ Direct execution (fast)
- ✅ Discoverable via HTTP (frontend can query)
- ✅ Simple architecture
- ✅ Testable (unit tests for handlers)

**Cons:**
- ⚠️ Tools not callable via HTTP (but do we need that?)

---

## Corrollary in Our Work

### Direct Answer: Yes, We Have a Corrollary

**NCP's `/tools` endpoint with `@tool_route`** ↔ **Our `/tools` endpoint with `@bot_tool`**

**Difference:** 
- **NCP:** Tool routes are **executable** HTTP endpoints
- **Us:** Tool endpoint is **informational** (returns metadata)

### Implementation (Already Planned!)

From **Ticket #6** in `MIGRATION_TICKETS.md`:

```python
# This is what we planned to add
@router.get("/api/bot/tools")
async def get_bot_tools(category: Optional[str] = Query(None)):
    """Get available bot tools for dynamic frontend loading."""
    discovery = BotToolDiscovery()
    
    if category:
        tools = discovery.get_tools_by_category(category)
    else:
        tools = discovery.discover_tools()
    
    return {
        "tools": [
            {
                "name": meta["name"],
                "description": meta["description"],
                "category": meta["category"],
                "parameters": meta["parameters"],
                "passthrough": meta["passthrough"]
            }
            for name, meta in tools.items()
        ],
        "total": len(tool_list)
    }
```

**This is the corrollary** - we expose tool **metadata** via HTTP, but **execution** happens in-process.

---

## Why Different Architectures?

### NCP: Multi-Tenant Tool Server

**Use case:** Serve multiple clients (different bots, different apps)

```
Niabrain Bot 1 ──┐
Niabrain Bot 2 ──┼──> NCP (shared tool server)
Interface App   ──┤
Dashboard       ──┘
```

**Reason for routes:** Tools must be accessible via network

---

### Our Bot: Integrated Pipeline

**Use case:** Single bot process per room

```
Room A → Bot Process A (tools embedded)
Room B → Bot Process B (tools embedded)
Room C → Bot Process C (tools embedded)
```

**Reason for direct calls:** Tools are part of the bot, no need for HTTP

---

## When Would We Need Tool Routes?

### Scenario 1: Separate Tool Service

If we wanted to extract tools into a separate service:

```
Bot Process 1 ──┐
Bot Process 2 ──┼──> Tool Service (HTTP routes)
Dashboard      ──┘
```

**Benefits:**
- Share tools across multiple bot instances
- Independent scaling (tools vs pipelines)
- Easier testing (test tools independently)

**Tradeoffs:**
- Network latency
- More complex deployment
- Need HTTP client in bot

---

### Scenario 2: Tool Marketplace

If we wanted third-parties to add tools:

```
Core Tools (built-in)
    +
Plugin Tools (HTTP endpoints)
    +
Custom Tools (user-defined)
    ↓
Bot discovers and registers all
```

**Benefits:**
- Extensibility
- Community plugins
- No bot restarts for new tools

**Tradeoffs:**
- Security concerns
- Version management
- Error handling across network

---

## Recommendation

### For Now: Stick with Current Pattern + Discovery API

**Keep:**
- Direct tool execution (fast, simple)
- Tools in bot process (integrated)
- Actions layer (business logic)

**Add:**
- `GET /api/bot/tools` endpoint (Ticket #6)
- `@bot_tool` decorators (Ticket #1)
- `BotToolDiscovery` (Ticket #2)

**Benefits:**
- ✅ Fast execution
- ✅ Simple architecture
- ✅ Frontend can discover tools dynamically
- ✅ No breaking changes

---

### Future: Consider Tool Routes If...

**Scenario 1:** You need to share tools across multiple services
- → Add tool routes to `server.py`
- → Bot calls tools via HTTP

**Scenario 2:** You want to separate tool scaling from pipeline scaling
- → Extract tools to separate service
- → Multiple bots share one tool service

**Scenario 3:** You want third-party tool plugins
- → Plugin system with HTTP-based tools
- → Discovery includes external endpoints

---

## Code Example: What It Would Look Like

### If We Added Tool Routes (Like NCP)

```python
# server.py - Add tool routes
from fastapi import APIRouter
from bot.decorators import bot_tool_route

tool_router = APIRouter()

@tool_router.post("/tools/createNote")
@bot_tool_route(name="bot_create_note", ...)
async def create_note_endpoint(request: CreateNoteRequest):
    """HTTP endpoint for creating notes."""
    from bot.actions.notes_actions import create_note
    from bot.mesh_client import MeshClient
    
    mesh_client = MeshClient(...)
    note = await create_note(
        mesh_client,
        request.title,
        request.content,
        request.tenant_id,
        request.user_id
    )
    
    return {
        "system_message": f"Created note: {note.title}",
        "metadata": {"note_id": note.id}
    }

# Include in main app
app.include_router(tool_router, tags=["Tools"])

# bot.py - Call via HTTP
async def create_note_handler(...):
    """LLM function calling handler."""
    # HTTP POST instead of direct call
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://localhost:8080/tools/createNote",
            json={
                "title": args["title"],
                "content": args["content"],
                "tenant_id": get_tenant_id(),
                "user_id": get_user_id()
            }
        )
        result = response.json()
    
    await result_callback(FunctionCallResultFrame(...))
```

**Change needed:**
- Add ~30 tool route endpoints to `server.py`
- Change bot handlers to HTTP clients
- Add request/response models
- Handle HTTP errors

**Benefit:**
- Tools accessible via HTTP (curl testable)
- Could be shared across services

**Cost:**
- ~200ms latency per tool call (HTTP overhead)
- More complex architecture
- HTTP error handling

---

## Summary

### The Answer

**Q:** How/why is NCP/niabrain using routes?

**A:** 
- **NCP uses routes** because it's a REST API service exposing tools via HTTP
- **Niabrain uses routes** because it's a WebSocket server for voice pipelines
- **We already use routes** in `server.py` for bot control (join/leave/health)

**Q:** Is there a corrollary in our current work?

**A:** 
- **Yes:** `GET /api/bot/tools` endpoint (planned in Ticket #6)
- **Difference:** Ours returns metadata, NCP's are executable
- **Reason:** Our tools execute in-process (faster), NCP's via HTTP (shareable)

---

### Decision Matrix

| Aspect | Direct (Current) | Tool Routes (NCP-style) |
|--------|------------------|-------------------------|
| **Execution Speed** | ⚡ Fast (in-process) | 🐢 Slower (HTTP) |
| **Architecture** | ✅ Simple | ❌ Complex |
| **Testability** | ⚠️ Unit tests | ✅ curl/Postman |
| **Shareability** | ❌ Bot-only | ✅ Cross-service |
| **Discovery** | ✅ Via /tools API | ✅ Via routes |
| **Deployment** | ✅ Single process | ❌ Multiple services |

**Recommendation:** Stick with direct execution, add discovery API (Ticket #6)

---

### When to Reconsider

Add tool routes if you need:
1. **Multi-service tool sharing** (multiple bots, dashboard, etc.)
2. **Independent tool scaling** (scale tools separately)
3. **Third-party plugins** (external tool providers)
4. **Tool marketplace** (community-contributed tools)

Until then, direct execution is faster and simpler. ✅
