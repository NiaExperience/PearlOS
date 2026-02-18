"""Centralized toolbox helpers for Pipecat Daily bot.

This module aggregates functional prompts, tool schemas, and registration
handlers so the bot pipeline and control server can work with a single
interface when preparing LLM tools.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict

from actions import functional_prompt_actions
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.frames.frames import FunctionCallResultProperties, LLMMessagesAppendFrame
from tools.discovery import get_discovery
from session.context import HandlerContext
from flows.registry import get_flow_manager
from flows.state import get_flow_greeting_state
from tools.logging_utils import bind_context_logger
from utils.flow_utils import schedule_flow_llm_run as _schedule_flow_llm_run

# Track blocked tool call attempts per room to prevent infinite loops
_BLOCKED_TOOL_ATTEMPTS: dict[str, int] = {}
MAX_BLOCKED_ATTEMPTS = 3  # Max attempts before giving up

# Cache for discovered tool metadata
_DISCOVERED_TOOLS: dict[str, dict] | None = None
_TOOL_NAMES: tuple[str, ...] | None = None

GREETING_GATE_ENABLED = os.getenv("BOT_TOOL_REQUIRE_GREETING", "true").lower() != "false"
GREETING_WAIT_SECS = float(os.getenv("BOT_TOOL_GREETING_WAIT_SECS", "3.0"))
GREETING_POLL_SECS = float(os.getenv("BOT_TOOL_GREETING_POLL_INTERVAL_SECS", "0.1"))


def _toolbox_logger(room_url: str | None = None):
    return bind_context_logger(room_url=room_url, tag="[toolbox]")


def _reset_blocked_attempts(room_url: str) -> None:
    """Reset the blocked attempts counter for a room (call after greeting completes)."""
    global _BLOCKED_TOOL_ATTEMPTS
    if room_url in _BLOCKED_TOOL_ATTEMPTS:
        del _BLOCKED_TOOL_ATTEMPTS[room_url]


def _increment_blocked_attempts(room_url: str) -> int:
    """Increment and return blocked attempts count for a room."""
    global _BLOCKED_TOOL_ATTEMPTS
    current = _BLOCKED_TOOL_ATTEMPTS.get(room_url, 0)
    _BLOCKED_TOOL_ATTEMPTS[room_url] = current + 1
    return current + 1


async def _wait_for_greeting(room_url: str, timeout_secs: float = GREETING_WAIT_SECS) -> bool:
    """Wait for a greeting to occur for the room or time out.
    
    Returns True if greeting speech has started, False if timeout reached.
    """
    log = _toolbox_logger(room_url)
    if not room_url:
        return False

    deadline = time.monotonic() + max(timeout_secs, 0)

    while True:
        flow_manager = get_flow_manager(room_url)
        if flow_manager:
            try:
                st = get_flow_greeting_state(flow_manager, room_url)
                # Check if greeting speech has actually started (TTS output began)
                # Not just that greeted_user_ids is populated (which happens at event emission)
                greeting_speech_started = st.get("greeting_speech_started", False) if isinstance(st, dict) else False
                if greeting_speech_started:
                    return True
            except Exception:
                log.debug("Failed to read greeting state for gating", exc_info=True)

        if time.monotonic() >= deadline:
            return False

        await asyncio.sleep(max(GREETING_POLL_SECS, 0.05))


def _ensure_discovery():
    """Use discovery system to find all tools and cache metadata."""
    global _DISCOVERED_TOOLS, _TOOL_NAMES
    log = _toolbox_logger()

    if _DISCOVERED_TOOLS is None or _TOOL_NAMES is None:
        # Initialize and reuse the global discovery instance from tool_discovery
        discovery = get_discovery()
        _DISCOVERED_TOOLS = discovery.discover_tools()
        _TOOL_NAMES = tuple(sorted(_DISCOVERED_TOOLS.keys()))

        log.bind(toolCount=len(_TOOL_NAMES)).info("Discovered tools via BotToolDiscovery")

    return _DISCOVERED_TOOLS, _TOOL_NAMES


def get_required_prompt_keys() -> tuple[str, ...]:
    """Return the ordered list of tool names (used as prompt keys).
    
    Note: With the discovery system, tool names ARE the prompt keys.
    Default descriptions come from decorator metadata.
    """
    _, tool_names = _ensure_discovery()
    return tool_names


def get_default_prompts() -> dict[str, str]:
    """Return default descriptions from decorator metadata.
    
    Note: These are extracted from @bot_tool decorator metadata,
    not from hardcoded DEFAULT_*_PROMPTS dictionaries.
    """
    discovered_tools, _ = _ensure_discovery()
    return {
        tool_name: metadata["description"]
        for tool_name, metadata in discovered_tools.items()
    }


def _is_valid_prompt(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _sanitize_prompt_dict(values: Dict[str, Any]) -> dict[str, str]:
    return {k: v for k, v in values.items() if isinstance(k, str) and _is_valid_prompt(v)}


def parse_prompt_payload(raw: str | Dict[str, Any] | None) -> dict[str, str]:
    """Parse a JSON or dict payload of functional prompts into a sanitized dict."""
    log = _toolbox_logger()
    if not raw:
        return {}

    if isinstance(raw, dict):
        return _sanitize_prompt_dict(raw)

    if not isinstance(raw, str):
        log.bind(payloadType=type(raw).__name__).warning("Unsupported prompt payload type; ignoring")
        return {}

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:  # noqa: BLE001 - log and continue
        log.bind(error=str(exc)).warning("Failed to parse preloaded prompt payload")
        return {}

    if isinstance(payload, dict):
        return _sanitize_prompt_dict(payload)

    log.warning("Preloaded prompt payload was not a mapping; ignoring")
    return {}


def serialize_prompt_payload(prompts: dict[str, str] | None) -> str:
    """Serialize prompts to JSON for process env transport."""
    log = _toolbox_logger()
    safe: dict[str, str] = {}
    if prompts:
        safe = {k: v for k, v in prompts.items() if isinstance(k, str) and isinstance(v, str)}

    try:
        return json.dumps(safe)
    except (TypeError, ValueError) as exc:  # noqa: BLE001 - defensive logging
        log.bind(error=str(exc)).warning("Failed to serialize functional prompts")
        return json.dumps({})


async def load_prompts(initial_prompts: dict[str, str] | None = None) -> dict[str, str]:
    """Load prompt overrides from DB, falling back to decorator defaults.
    
    This simplified approach:
    1. Gets all tool names from discovery
    2. Applies any preloaded prompts (from env/config)
    3. Fetches missing prompts from DB  
    4. Falls back to decorator metadata (via build_schemas)
    
    Note: The actual fallback to defaults happens in build_schemas(),
    so we only need to return the overrides here.
    """
    log = _toolbox_logger()
    _, tool_names = _ensure_discovery()

    log.bind(toolCount=len(tool_names), preloadedCount=len(initial_prompts) if initial_prompts else 0).info(
        "Loading prompt overrides"
    )

    # Start with empty overrides dict
    prompt_overrides: dict[str, str] = {}
    
    # Track which tools have overrides from preloaded
    preloaded_keys: set[str] = set()

    if initial_prompts:
        sanitized = _sanitize_prompt_dict(initial_prompts)
        prompt_overrides.update(sanitized)
        preloaded_keys = set(sanitized.keys())
        log.bind(preloadedCount=len(sanitized)).info("Applied preloaded prompt overrides")

    # Find tools that need DB fetch (not in preloaded)
    missing = [key for key in tool_names if key not in preloaded_keys]
    if missing:
        log.bind(missingCount=len(missing)).info("Fetching prompt overrides from Mesh")
        try:
            fetched = await functional_prompt_actions.fetch_functional_prompts(missing)
            fetched_count = len(fetched)
            log.bind(fetchedCount=fetched_count).info("Successfully fetched prompt overrides from Mesh")
            prompt_overrides.update(_sanitize_prompt_dict(fetched))
        except Exception as exc:  # noqa: BLE001 - continue with defaults
            log.bind(error=str(exc)).error("Failed to fetch prompt overrides from Mesh", exc_info=True)
        
    # Calculate how many will use defaults (not in overrides)
    using_defaults = [key for key in tool_names if not _is_valid_prompt(prompt_overrides.get(key))]
    if using_defaults:
        log.bind(defaultCount=len(using_defaults)).info("Tools will use decorator default descriptions")

    log.bind(customCount=(len(tool_names) - len(using_defaults)), defaultCount=len(using_defaults)).info(
        "Prepared prompt overrides"
    )
    
    # Return overrides only - build_schemas() handles fallback to decorator defaults
    return prompt_overrides


@dataclass
class ToolRegistration:
    name: str
    handler: Callable[[Any], Awaitable[None]]
    cancel_on_interruption: bool = False


@dataclass
class ToolboxBundle:
    prompts: dict[str, str]
    schemas: list[Any]
    tools_schema: ToolsSchema | None
    registrations: list[ToolRegistration]


async def prepare_toolbox(
    room_url: str,
    forwarder_ref: dict[str, Any],
    preloaded_prompts: dict[str, str] | None = None,
    get_tenant_id: Callable[[], str | None] | None = None,
    get_user_id: Callable[[], str | None] | None = None,
    supported_features: list[str] | None = None,
) -> ToolboxBundle:
    """Prepare complete toolbox using automatic tool discovery.
    
    This function now uses BotToolDiscovery to automatically find all decorated
    tool handlers instead of manually importing and collecting from each module.
    
    Args:
        room_url: Daily room URL for context
        forwarder_ref: Reference to AppMessageForwarder
        preloaded_prompts: Optional pre-loaded prompt overrides
        get_tenant_id: Function to get current tenant ID
        get_user_id: Function to get current user ID
        supported_features: Optional list of feature flags for tool filtering.
                          If provided, only tools with matching feature_flag will be included.
                          Example: ['notes', 'youtube'] will only include tools with
                          feature_flag='notes' or feature_flag='youtube', plus tools with no flag.
    
    Returns:
        ToolboxBundle with filtered tools based on supported_features
    """
    prompts = await load_prompts(preloaded_prompts)
    log = _toolbox_logger(room_url).bind(supportedFeatures=supported_features)
    
    # Use discovery system to find all decorated tools (reuse global discovery)
    log.info("Using BotToolDiscovery to find all tools")
    discovery = get_discovery()
    
    # Filter tools by supported features if provided
    if supported_features:
        log.info("Filtering tools by features")
        filtered_tools = discovery.filter_tools_by_features(supported_features)
        log.bind(filteredCount=len(filtered_tools), totalCount=len(discovery.discover_tools())).info(
            "Filtered tool set"
        )
        log.bind(registeredTools=sorted(filtered_tools.keys())).info("Registered tools after filter")
    else:
        log.info("No feature filtering - using all tools")
        filtered_tools = None
        all_tools = discovery.discover_tools()
        log.bind(registeredTools=sorted(all_tools.keys())).info("Registered tools")
    
    # Apply Sprite Bot Config tool whitelist (if a sprite bot is active)
    from tools.sprite_bot_config import filter_tools_by_sprite_config
    if filtered_tools is not None:
        filtered_tools = filter_tools_by_sprite_config(filtered_tools)
    else:
        all_discovered = discovery.discover_tools()
        sprite_filtered = filter_tools_by_sprite_config(all_discovered)
        if len(sprite_filtered) < len(all_discovered):
            filtered_tools = sprite_filtered
            log.bind(spriteFilteredCount=len(filtered_tools)).info("Applied sprite bot config tool whitelist")

    # Build schemas using filtered tools (with prompt overrides from DB)
    log.info("Building schemas from discovered tools")
    schemas = discovery.build_tool_schemas(prompts=prompts, tools=filtered_tools)
    log.bind(schemaCount=len(schemas)).info("Total schemas collected")
    
    # Create HandlerContext for injecting session context
    log.info("Building HandlerContext for session")
    context = HandlerContext(
        get_tenant_id=get_tenant_id or (lambda: None),
        get_user_id=get_user_id or (lambda: None),
        get_user_email=lambda: os.environ.get('BOT_SESSION_USER_EMAIL'),
        get_user_name=lambda: os.environ.get('BOT_SESSION_USER_NAME')
    )
    
    # Collect handlers from discovered tools (use filtered set if available)
    log.info("Building handlers from discovered tools")
    discovered_tools = filtered_tools if filtered_tools is not None else discovery.discover_tools()
    handlers: dict[str, Any] = {}
    
    for tool_name, metadata in discovered_tools.items():
        handler_func = metadata["handler_function"]
        
        # Create wrapper that injects dependencies via FunctionCallParams
        async def make_wrapper(func, name):
            async def wrapper(params):
                """Wrapper that accepts FunctionCallParams and injects custom attributes.
                
                This uses the new single-parameter calling convention to avoid
                deprecation warnings from pipecat.
                """
                # Import FunctionCallParams from pipecat
                from pipecat.services.llm_service import FunctionCallParams

                # Ensure we received a FunctionCallParams object
                if not isinstance(params, FunctionCallParams):
                    raise TypeError(f"Expected FunctionCallParams, got {type(params)}")

                # Prefer passed context if provided, else use our HandlerContext
                if params.context is None:
                    params.context = context

                # Monkey-patch custom attributes onto params
                params.room_url = room_url
                params.forwarder = forwarder_ref.get("instance")
                params.handler_context = context

                if GREETING_GATE_ENABLED:
                    greeted = await _wait_for_greeting(room_url)
                    if not greeted:
                        attempts = _increment_blocked_attempts(room_url)
                        log.bind(toolName=name, attempts=attempts).warning(
                            "Blocking tool because greeting has not completed"
                        )
                        
                        # Inject a system message telling LLM to speak before using tools
                        # This is the KEY fix - we need to explicitly instruct the LLM
                        flow_manager = get_flow_manager(room_url)
                        if flow_manager and attempts <= MAX_BLOCKED_ATTEMPTS:
                            task = getattr(flow_manager, 'task', None)
                            if task and hasattr(task, 'queue_frames'):
                                # Queue a system message that will be seen before next LLM run
                                speak_first_message = {
                                    'role': 'system',
                                    'content': (
                                        'IMPORTANT: You attempted to use a tool before speaking. '
                                        'You MUST speak aloud to greet the user FIRST before using ANY tools. '
                                        'DO NOT call any functions yet. Instead, produce speech output now - '
                                        'welcome the user as instructed in BEAT 1. '
                                        'After you have spoken your greeting, tools will become available.'
                                    )
                                }
                                log.bind(toolName=name).info(
                                    "Injecting speak-first system message and re-triggering LLM"
                                )
                                try:
                                    await task.queue_frames([
                                        LLMMessagesAppendFrame(messages=[speak_first_message])
                                    ])
                                except Exception as e:
                                    log.bind(error=str(e)).warning("Failed to inject system message")
                        
                        # Use result_callback to return error AND trigger LLM to try again
                        # The run_llm=True tells pipecat to run the LLM after this result
                        if hasattr(params, 'result_callback') and params.result_callback:
                            await params.result_callback(
                                {
                                    "status": "blocked",
                                    "reason": "greeting_required",
                                    "instruction": "You must speak to greet the user before using tools. Produce speech output now."
                                },
                                properties=FunctionCallResultProperties(run_llm=True)
                            )
                            return None  # Callback already handled the result
                        
                        # Fallback: return dict (less ideal but maintains compatibility)
                        return {
                            "status": "blocked",
                            "reason": "greeting_required",
                            "instruction": "You must speak to greet the user before using tools."
                        }
                    else:
                        # Greeting completed, reset blocked attempts counter
                        _reset_blocked_attempts(room_url)

                # === TOOL EXECUTION LOGGING ===
                import time as _time
                _tool_start = _time.monotonic()
                _tool_args = {}
                try:
                    _tool_args = params.arguments if hasattr(params, 'arguments') else {}
                except Exception:
                    pass
                log.bind(toolName=name, toolArgs=_tool_args).info(
                    "🔧 TOOL CALL START: %s" % name
                )
                try:
                    _result = await func(params)
                    _elapsed_ms = int((_time.monotonic() - _tool_start) * 1000)
                    # Summarize result for logging (avoid huge payloads)
                    _result_summary = None
                    if isinstance(_result, dict):
                        _result_summary = {k: (str(v)[:200] if isinstance(v, str) and len(str(v)) > 200 else v) for k, v in _result.items() if k != "content"}
                    log.bind(toolName=name, elapsedMs=_elapsed_ms, resultSummary=_result_summary).info(
                        "✅ TOOL CALL DONE: %s (%dms)" % (name, _elapsed_ms)
                    )
                    return _result
                except Exception as _tool_err:
                    _elapsed_ms = int((_time.monotonic() - _tool_start) * 1000)
                    log.bind(toolName=name, elapsedMs=_elapsed_ms, error=str(_tool_err)).error(
                        "❌ TOOL CALL FAILED: %s (%dms) — %s" % (name, _elapsed_ms, _tool_err)
                    )
                    raise

            wrapper.__name__ = name
            return wrapper
        
        handlers[tool_name] = await make_wrapper(handler_func, tool_name)
    
    log.bind(handlerCount=len(handlers)).info("Total handlers collected")
    
    # Build registrations
    registrations: list[ToolRegistration] = [
        ToolRegistration(name=name, handler=handler, cancel_on_interruption=False)
        for name, handler in handlers.items()
    ]
    
    log.bind(schemaCount=len(schemas)).info("Registered tool schemas")
    log.bind(registrationCount=len(registrations)).info("Registered tool handlers")

    tools_schema = ToolsSchema(standard_tools=schemas) if schemas else None

    return ToolboxBundle(
        prompts=prompts,
        schemas=schemas,
        tools_schema=tools_schema,
        registrations=registrations,
    )


__all__ = [
    "ToolRegistration",
    "ToolboxBundle",
    "load_prompts",
    "parse_prompt_payload",
    "prepare_toolbox",
    "serialize_prompt_payload",
    "get_required_prompt_keys",
    "get_default_prompts",
    "reset_blocked_attempts",
]


def reset_blocked_attempts(room_url: str) -> None:
    """Public function to reset blocked attempts counter for a room.
    
    Call this when a room session ends or is reset to prevent stale state.
    """
    _reset_blocked_attempts(room_url)
