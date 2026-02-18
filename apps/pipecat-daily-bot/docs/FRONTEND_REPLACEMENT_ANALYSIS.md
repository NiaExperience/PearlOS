# Frontend Replacement Analysis: Learning from `niabrain-websocket-purge-merge`

**Date:** October 23, 2025  
**Purpose:** Extract architectural guidance from the `niabrain-websocket-purge-merge` branch to inform our frontend replacement strategy for migrating from VAPI to pipecat-daily-bot.

---

## Executive Summary

The `niabrain-websocket-purge-merge` branch contains valuable architectural patterns that can significantly improve our current toolbox architecture. The key insights center around **dynamic tool discovery via decorators** and **clean separation of routing/services** that eliminate hardcoded imports and registration.

### Key Takeaways

1. **@tool_route decorator pattern** - Eliminates manual tool registration
2. **ToolDiscovery class** - Automatic scanning and registration of tools
3. **Services vs Actions** - Services map to our current actions layer
4. **Passthrough tools** - Client-side execution pattern for frontend tools
5. **Clean separation** - Routers (tool handlers) call Services (business logic)

---

## Architecture Comparison

### Current Architecture (staging-functional-tools)

```
bot.py
  ↓
toolbox.py (orchestrator)
  ↓
tools/
  ├── notes_tools.py (get_schemas, get_handlers)
  ├── view_tools.py
  ├── html_tools.py
  └── ... (7 modules, manually imported)
  ↓
actions/
  ├── notes_actions.py (business logic)
  ├── html_actions.py
  └── ... (6 modules)
  ↓
mesh_client.py (GraphQL)
```

**Issues:**
- Manual imports in `toolbox.py` and `tools/__init__.py`
- Hardcoded module list
- Adding new tools requires updating multiple files
- Tool keys maintained in separate lists

### niabrain-websocket-purge-merge Architecture

```
app/websocket.py
  ↓
core/pipeline_factory.py
  ↓
pipelines/v2v.py (pipeline builder)
  ↓
services/tool_functions.py
  ↓
NCP Backend (via HTTP)
  ↓
ncp/routers/ (auto-discovered)
  ├── youtube_routes.py (@tool_route decorated)
  ├── desktop_routes.py
  └── ... (auto-discovered via ToolDiscovery)
  ↓
ncp/services/
  ├── youtube_service.py (business logic)
  └── ... (service modules)
```

**Advantages:**
- Zero manual imports for new tools
- Decorator-based registration
- Automatic discovery and collection
- Clean router → service → API flow

---

## Pattern 1: @tool_route Decorator

### How It Works

```python
# ncp/decorators.py
def tool_route(
    name: str, 
    description: str, 
    async_execution: bool = False,
    parameters: Optional[Dict[str, Any]] = None,
    toolAppendix: Optional[str] = None,
    passthrough: bool = False
) -> Callable:
    """Decorator to mark a function as a tool route for auto-discovery."""
    def decorator(func: Callable) -> Callable:
        # Store tool metadata on the function
        func._tool_metadata = {
            "name": name,
            "description": description,
            "async": async_execution,
            "parameters": parameters,
            "toolAppendix": toolAppendix,
            "passthrough": passthrough
        }
        func._is_tool_route = True
        return func
    return decorator
```

### Usage Example

```python
# ncp/routers/youtube_routes.py
@router.post("/searchYouTubeVideos")
@tool_route(
    name="searchYouTubeVideos",
    description="Searches for and plays YouTube videos based on user query.",
    async_execution=True,
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search term to find on YouTube"
            }
        },
        "required": ["query"]
    },
    toolAppendix="=== YOUTUBE VIDEO SEARCH ===\n..."
)
async def search_youtube_videos(request: YouTubeSearchRequest) -> dict[str, Any]:
    # Implementation
    pass
```

### Benefits

- **Self-documenting**: Tool metadata lives with the handler
- **Type-safe**: Pydantic request models + parameters schema
- **DRY principle**: Description defined once, used everywhere
- **Discoverable**: No manual registration needed

---

## Pattern 2: ToolDiscovery Class

### Implementation

```python
# ncp/tool_discovery.py
class ToolDiscovery:
    """Auto-discovery system for tool routes decorated with @tool_route."""
    
    def __init__(self):
        self.router_modules = self._discover_router_modules()
    
    def _discover_router_modules(self) -> list[str]:
        """Automatically discover all router modules in ncp/routers/."""
        router_modules = []
        routers_dir = Path(__file__).parent / "routers"
        
        for py_file in routers_dir.glob("*.py"):
            if py_file.name.startswith("__") or py_file.name == "utils.py":
                continue
            module_name = f"ncp.routers.{py_file.stem}"
            router_modules.append(module_name)
        
        return router_modules
    
    def discover_tools(self) -> Dict[str, Dict[str, Any]]:
        """Discover all tools from router modules."""
        tool_registry = {}
        
        for module_name in self.router_modules:
            module = importlib.import_module(module_name)
            tools = self._extract_tools_from_module(module)
            tool_registry.update(tools)
        
        return tool_registry
    
    def _extract_tools_from_module(self, module) -> Dict[str, Dict[str, Any]]:
        """Extract tool metadata from decorated functions."""
        tools = {}
        
        for name, obj in inspect.getmembers(module):
            if hasattr(obj, '_is_tool_route') and obj._is_tool_route:
                tool_name = obj._tool_metadata["name"]
                tools[tool_name] = obj._tool_metadata
        
        return tools
```

### How It Works

1. **Scan filesystem** - Find all Python files in `routers/` directory
2. **Import modules** - Dynamically import each router module
3. **Inspect functions** - Use Python's `inspect` to find decorated functions
4. **Extract metadata** - Collect `_tool_metadata` from each decorated function
5. **Build registry** - Return complete tool registry

### Benefits

- **Zero configuration**: Just add a file in `routers/`, it's discovered
- **Resilient**: Graceful handling of import errors
- **Testable**: Can verify discovery in unit tests
- **Scalable**: Works for 5 tools or 500 tools

---

## Pattern 3: Services vs Actions

### Current: Actions Layer

```python
# apps/pipecat-daily-bot/bot/actions/notes_actions.py
async def get_note(mesh_client, note_id, tenant_id, user_id):
    """Get a note by ID (business logic)."""
    query = """
        query GetNote($noteId: ID!) {
            note(id: $noteId) { id title content }
        }
    """
    result = await mesh_client.request(query, {"noteId": note_id})
    return result
```

### niabrain: Services Layer

```python
# apps/ncp/ncp/services/youtube_service.py
async def search_youtube_videos_api(query: str):
    """Fetch YouTube videos from external API."""
    params = {"query": query}
    url = f"{API_BASE_URL}/api/youtube-search"
    return await make_api_get_request(url, params)
```

### Comparison

| Aspect | Our Actions | Their Services |
|--------|-------------|----------------|
| **Purpose** | Business logic + data transformation | API/external service calls |
| **Testing** | Mocked mesh_client | Mocked HTTP client |
| **Reusability** | Called by tool handlers | Called by routers |
| **Dependencies** | mesh_client (GraphQL) | httpx (REST) |

### Mapping

**niabrain services** ≈ **our actions** - Both provide business logic abstraction

The key difference is their services call external HTTP APIs (NCP backend), while our actions call an internal GraphQL API (Mesh). The abstraction pattern is the same.

---

## Pattern 4: Passthrough Tools

### Concept

Some tools should execute **client-side** (in the frontend) rather than server-side (in the bot). The niabrain architecture has a clever pattern for this:

```python
# niabrain/services/tool_functions.py
async def call_passthrough_tool(
    assistant_name: str, function_name: str, params: FunctionCallParams
):
    """Handle passthrough tools by returning instructions for client execution."""
    filtered_args = {k: v for k, v in params.arguments.items() if v}
    
    result = {
        "system_message": f"Executing {function_name} on client.",
        "metadata": {
            "passthrough": True,
            "function_name": function_name,
            "arguments": filtered_args
        }
    }
    
    await params.result_callback(result)
```

### Use Cases

**Passthrough tools** are ideal for:
- UI manipulation (minimize/maximize window, open apps)
- Client-side state changes (switch views, close modals)
- Browser actions (navigate, play/pause media)
- Local device control

**Server-side tools** are needed for:
- Data persistence (create notes, save profiles)
- External API calls (search Wikipedia, fetch data)
- Complex computation
- Multi-user coordination

### Implementation Strategy

We could add a `passthrough` flag to our tool schemas:

```python
# Example: Window control should be passthrough
FunctionSchema(
    name="bot_minimize_window",
    description="Minimize the window",
    passthrough=True,  # ← New flag
    properties={}
)
```

The frontend event router would handle passthrough tools directly without round-tripping through the bot.

---

## Pattern 5: Routers → Services Architecture

### niabrain Pattern

```python
# ncp/routers/youtube_routes.py (Handler/Router)
@router.post("/searchYouTubeVideos")
@tool_route(name="searchYouTubeVideos", ...)
async def search_youtube_videos(request: YouTubeSearchRequest):
    """Route handler - orchestrates the request."""
    # Call service layer
    search_result = await search_youtube_videos_api(request.query)
    
    # Transform for client
    videos = [YouTubeVideo(**item) for item in search_result["videos"]]
    
    # Return formatted response
    return {
        "system_message": f"Now playing: {videos[0].title}",
        "metadata": {"videos": videos}
    }

# ncp/services/youtube_service.py (Service/Business Logic)
async def search_youtube_videos_api(query: str):
    """Service layer - handles external API call."""
    url = f"{API_BASE_URL}/api/youtube-search"
    data = await make_api_get_request(url, {"query": query})
    return data
```

### Our Current Pattern

```python
# bot/tools/notes_tools.py (Handler)
async def create_note_handler(function_name, tool_call_id, args, llm, context, result_callback):
    """Tool handler - orchestrates the request."""
    # Get context
    tenant_id = get_tenant_id()
    user_id = get_user_id()
    
    # Call action layer
    note = await create_note(mesh_client, args["title"], args["content"], tenant_id, user_id)
    
    # Emit event
    await forwarder.emit_tool_event(events.NOTE_CREATED, {"note_id": note.id})
    
    # Return to LLM
    await result_callback(FunctionCallResultFrame(...))

# bot/actions/notes_actions.py (Action/Business Logic)
async def create_note(mesh_client, title, content, tenant_id, user_id):
    """Action layer - handles GraphQL mutation."""
    mutation = "..."
    result = await mesh_client.request(mutation, {...})
    return result
```

### Similarity

Both architectures follow the same pattern:
- **Handlers/Routes**: Orchestrate the request (thin layer)
- **Services/Actions**: Contain business logic (fat layer)

The separation is **identical in concept**, just different in naming.

---

## Proposed Migration Path

### Phase 1: Add Decorator System (Non-Breaking)

**Goal**: Introduce decorators alongside existing system

```python
# bot/decorators.py (NEW)
def bot_tool(
    name: str,
    description: str,
    category: str = "general",
    parameters: Optional[Dict[str, Any]] = None,
    passthrough: bool = False
):
    """Decorator to mark a function as a bot tool."""
    def decorator(func: Callable) -> Callable:
        func._is_bot_tool = True
        func._tool_metadata = {
            "name": name,
            "description": description,
            "category": category,
            "parameters": parameters,
            "passthrough": passthrough
        }
        return func
    return decorator
```

**Usage**: Start decorating existing tools

```python
# bot/tools/notes_tools.py (UPDATED)
@bot_tool(
    name="bot_create_note",
    description="Create a new collaborative note",
    category="notes",
    parameters={...}
)
async def create_note_handler(...):
    # Existing implementation unchanged
    pass
```

---

### Phase 2: Add ToolDiscovery (Parallel System)

**Goal**: Auto-discover decorated tools, compare with manual registry

```python
# bot/tool_discovery.py (NEW)
class BotToolDiscovery:
    """Auto-discovery for decorated bot tools."""
    
    def discover_tools(self) -> Dict[str, Any]:
        """Scan tools/ directory for decorated functions."""
        tools_dir = Path(__file__).parent / "tools"
        tool_registry = {}
        
        for py_file in tools_dir.glob("*.py"):
            if py_file.name.startswith("_"):
                continue
            
            module_name = f"tools.{py_file.stem}"
            module = importlib.import_module(module_name)
            
            for name, obj in inspect.getmembers(module):
                if hasattr(obj, '_is_bot_tool') and obj._is_bot_tool:
                    tool_registry[obj._tool_metadata["name"]] = obj._tool_metadata
        
        return tool_registry
```

**Testing**: Run discovery and compare with manual registry to ensure completeness

---

### Phase 3: Migrate Functional Prompts to Decorators

**Goal**: Move prompts from database/toolbox into decorator metadata

**Current**: Prompts loaded from database, merged in toolbox
**Target**: Prompts defined in decorators, overrideable by database

```python
@bot_tool(
    name="bot_create_note",
    description="Create a new collaborative note with title and content",  # Default
    category="notes",
    parameters={...}
)
async def create_note_handler(...):
    pass
```

**Database override**: Allow tenant-specific customization in dashboard to override decorator defaults

---

### Phase 4: Deprecate Manual Registration

**Goal**: Remove hardcoded imports and registration

**Before**: `toolbox.py` manually imports and calls each module
**After**: `toolbox.py` uses `BotToolDiscovery` to scan and register

```python
# bot/toolbox.py (REFACTORED)
async def prepare_toolbox(
    room_url: str,
    forwarder_ref: dict[str, Any],
    preloaded_prompts: dict[str, str] | None = None,
) -> ToolboxBundle:
    
    # Discover all tools via decorator scanning
    discovery = BotToolDiscovery()
    discovered_tools = discovery.discover_tools()
    
    # Load database prompts for overrides
    db_prompts = await load_prompts(preloaded_prompts)
    
    # Merge: database overrides decorator defaults
    final_prompts = {
        tool_name: db_prompts.get(tool_name, metadata["description"])
        for tool_name, metadata in discovered_tools.items()
    }
    
    # Build schemas from discovered tools
    schemas = [
        FunctionSchema(
            name=tool_name,
            description=final_prompts[tool_name],
            parameters=metadata["parameters"]
        )
        for tool_name, metadata in discovered_tools.items()
    ]
    
    # Build handler registry
    handlers = discovery.build_handler_mapping(room_url, forwarder_ref)
    
    return ToolboxBundle(prompts=final_prompts, schemas=schemas, ...)
```

**Benefits**:
- Add tool: Create file, add decorator, done
- Remove tool: Delete file, done
- No more manual maintenance of tool lists

---

## Frontend Integration Pattern

### Current (VAPI)

```typescript
// interface/src/actions/getAssistant.tsx
export const functions = [
  {
    name: "createNote",
    description: "Create a note",
    parameters: {...}
  },
  // ... hardcoded list
];

// interface/src/components/browser-window.tsx
case "createNote":
  // Handle in switch statement
```

### Proposed (Pipecat with Discovery)

```typescript
// interface/src/lib/botToolRegistry.ts
export async function fetchBotTools() {
  const response = await fetch('/api/bot/tools');
  return response.json();
}

// interface/src/features/DailyCall/events/niaEventRouter.ts
export function routeToolResult(result: ToolResult) {
  if (result.metadata?.passthrough) {
    // Handle passthrough tools (UI actions)
    handlePassthroughTool(result.function_name, result.metadata.arguments);
  } else {
    // Handle server tools (data operations)
    handleServerTool(result);
  }
}
```

**Key Advantage**: Frontend can dynamically load available tools from bot, no hardcoded list

---

## Recommendations

### Immediate Actions (High Priority)

1. **Implement @bot_tool decorator** (1-2 days)
   - Create `bot/decorators.py`
   - Start decorating existing tools
   - No breaking changes

2. **Add BotToolDiscovery class** (1-2 days)
   - Create `bot/tool_discovery.py`
   - Write tests comparing discovered vs manual registry
   - Validate completeness

3. **Add /api/bot/tools endpoint** (1 day)
   - Expose discovered tools to frontend
   - Support dynamic tool loading

### Medium-Term Actions (Next Sprint)

4. **Migrate to decorator-based prompts** (3-5 days)
   - Move default prompts into decorators
   - Keep database override capability
   - Update dashboard UI

5. **Refactor toolbox.py** (2-3 days)
   - Replace manual imports with discovery
   - Thorough integration testing
   - Monitor for regressions

### Long-Term Actions (Future Sprints)

6. **Implement passthrough tools** (3-5 days)
   - Add passthrough flag to decorators
   - Update frontend router
   - Migrate UI tools to passthrough

7. **Dynamic frontend tool loading** (3-5 days)
   - Fetch tools from `/api/bot/tools`
   - Remove hardcoded function lists
   - Enable runtime tool discovery

---

## Risk Assessment

### Low Risk (Safe to Proceed)

- Adding decorators (additive, no breaking changes)
- Parallel discovery system (validation only)
- New API endpoint (additive)

### Medium Risk (Requires Testing)

- Refactoring toolbox.py (touches critical path)
- Migrating prompts (database changes)
- Passthrough tools (new execution model)

### High Risk (Phase Carefully)

- Removing manual registration (requires extensive testing)
- Dynamic frontend loading (affects all tool calls)

### Mitigation Strategies

1. **Feature flags**: Gate decorator system behind flag
2. **Parallel running**: Run both systems, compare outputs
3. **Gradual migration**: One tool category at a time
4. **Extensive testing**: 100% coverage on discovery logic
5. **Rollback plan**: Keep manual system as fallback

---

## Code Examples

### Example: Migrating notes_tools.py

**Before** (manual):

```python
# bot/tools/notes_tools.py
def get_schemas(prompts: dict[str, str]) -> list[FunctionSchema]:
    merged_prompts = {**DEFAULT_NOTE_TOOL_PROMPTS}
    merged_prompts.update(prompts)
    
    return [
        FunctionSchema(
            name="bot_create_note",
            description=merged_prompts["bot_create_note"],
            parameters={...}
        ),
        # ... 15 more tools
    ]

def get_handlers(room_url, forwarder_ref) -> dict:
    return {
        "bot_create_note": create_note_handler,
        # ... 15 more handlers
    }
```

**After** (decorator):

```python
# bot/tools/notes_tools.py
from bot.decorators import bot_tool

@bot_tool(
    name="bot_create_note",
    description="Create a new collaborative note with the specified title and content",
    category="notes",
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Note title"},
            "content": {"type": "string", "description": "Note content in markdown"}
        },
        "required": ["title", "content"]
    }
)
async def create_note_handler(
    function_name: str,
    tool_call_id: str,
    args: dict,
    llm: Any,
    context: LLMContext,
    result_callback: callable
):
    """Create a new note (implementation unchanged)."""
    tenant_id = get_tenant_id()
    user_id = get_user_id()
    
    note = await create_note(
        mesh_client,
        args["title"],
        args["content"],
        tenant_id,
        user_id
    )
    
    await forwarder.emit_tool_event(events.NOTE_CREATED, {
        "note_id": note.id,
        "title": note.title
    })
    
    await result_callback(FunctionCallResultFrame(
        function_name=function_name,
        tool_call_id=tool_call_id,
        arguments=args,
        result={"success": True, "note_id": note.id}
    ))

# Repeat @bot_tool decorator for all 16 note tools...
```

**Toolbox (after)**:

```python
# bot/toolbox.py
async def prepare_toolbox(...) -> ToolboxBundle:
    # Discover all decorated tools
    discovery = BotToolDiscovery()
    all_tools = discovery.discover_tools()
    
    # Filter by category if needed
    note_tools = {k: v for k, v in all_tools.items() if v["category"] == "notes"}
    
    # Build schemas
    schemas = [
        FunctionSchema(
            name=name,
            description=metadata["description"],
            parameters=metadata["parameters"]
        )
        for name, metadata in all_tools.items()
    ]
    
    # Build handlers
    handlers = discovery.build_handler_mapping(room_url, forwarder_ref)
    
    return ToolboxBundle(schemas=schemas, registrations=handlers, ...)
```

**Result**: No manual lists, no hardcoded imports, fully discoverable

---

## Testing Strategy

### Unit Tests

```python
# bot/tests/test_tool_discovery.py
def test_discovers_all_decorated_tools():
    discovery = BotToolDiscovery()
    tools = discovery.discover_tools()
    
    # Should find all 45 tools
    assert len(tools) == 45
    assert "bot_create_note" in tools
    assert "bot_search_youtube_videos" in tools

def test_tool_metadata_structure():
    discovery = BotToolDiscovery()
    tools = discovery.discover_tools()
    
    note_tool = tools["bot_create_note"]
    assert note_tool["name"] == "bot_create_note"
    assert "description" in note_tool
    assert "parameters" in note_tool
    assert "category" in note_tool

def test_handler_mapping_completeness():
    discovery = BotToolDiscovery()
    handlers = discovery.build_handler_mapping("room_url", {"instance": mock_forwarder})
    
    # Should have handler for every tool
    assert len(handlers) == 45
    assert callable(handlers["bot_create_note"])
```

### Integration Tests

```python
# bot/tests/test_toolbox_discovery.py
async def test_toolbox_uses_discovered_tools():
    toolbox = await prepare_toolbox("room_url", forwarder_ref)
    
    # Should have all 45 tools
    assert len(toolbox.schemas) == 45
    assert len(toolbox.registrations) == 45
    
    # Schemas should match metadata
    create_note_schema = next(s for s in toolbox.schemas if s.name == "bot_create_note")
    assert create_note_schema.description
    assert create_note_schema.parameters

async def test_prompt_override_from_database():
    db_prompts = {"bot_create_note": "CUSTOM DESCRIPTION FROM DATABASE"}
    toolbox = await prepare_toolbox("room_url", forwarder_ref, preloaded_prompts=db_prompts)
    
    create_note_schema = next(s for s in toolbox.schemas if s.name == "bot_create_note")
    assert create_note_schema.description == "CUSTOM DESCRIPTION FROM DATABASE"
```

### Comparison Tests

```python
# bot/tests/test_discovery_parity.py
def test_discovered_tools_match_manual_registry():
    """Ensure we haven't missed any tools during migration."""
    # Old way
    manual_tools = get_all_tool_schemas({})
    manual_handlers = get_all_tool_handlers("room_url", {})
    
    # New way
    discovery = BotToolDiscovery()
    discovered_tools = discovery.discover_tools()
    discovered_handlers = discovery.build_handler_mapping("room_url", {})
    
    # Should be identical
    assert set(discovered_tools.keys()) == set(t.name for t in manual_tools)
    assert set(discovered_handlers.keys()) == set(manual_handlers.keys())
```

---

## Open Questions

1. **Functional prompts in decorators vs database?**
   - Option A: Decorators have defaults, database overrides (recommended)
   - Option B: All prompts in database, decorators have minimal description
   - **Decision**: Option A allows code to be self-documenting while preserving tenant customization

2. **Should we keep tool categories?**
   - Current: Implicit via module name (`notes_tools.py` = notes category)
   - Proposed: Explicit via decorator (`category="notes"`)
   - **Decision**: Explicit is better for filtering and organization

3. **Passthrough vs server execution - who decides?**
   - Option A: Decorator flag (static)
   - Option B: Runtime decision based on context
   - **Decision**: Start with static flag, add runtime later if needed

4. **Migration timeline?**
   - Fast path: 2 weeks (add decorators, refactor toolbox)
   - Safe path: 4-6 weeks (gradual migration, extensive testing)
   - **Recommendation**: Safe path to avoid regressions

5. **Frontend dynamic loading - immediate or future?**
   - Immediate: Required for VAPI replacement
   - Future: Can use static list initially
   - **Decision**: Static list initially, dynamic loading in phase 2

---

## Conclusion

The `niabrain-websocket-purge-merge` branch demonstrates a mature, scalable architecture for tool management that eliminates most of the manual wiring we currently do. The key patterns we should adopt:

### Must Have (Critical for VAPI Replacement)

1. **@bot_tool decorator** - Self-documenting, discoverable tools
2. **BotToolDiscovery** - Automatic scanning and registration
3. **/api/bot/tools endpoint** - Expose tools to frontend

### Should Have (Improves Architecture)

4. **Passthrough tools** - Client-side execution for UI actions
5. **Decorator-based prompts** - Move defaults out of database
6. **Category metadata** - Better organization and filtering

### Nice to Have (Future Enhancements)

7. **Dynamic frontend loading** - Runtime tool discovery
8. **Tool appendix system** - Rich LLM guidance
9. **Tool versioning** - Backward compatibility

By adopting these patterns gradually, we can create a much more maintainable and scalable tool system that will serve us well as we continue to grow the bot's capabilities.

---

**Next Steps**: Review this analysis with the team, get consensus on migration path, and create implementation tickets for Phase 1.
