"""Decorator system for bot tool registration and discovery.

This module provides the @bot_tool decorator that allows tool functions to
self-document their metadata (name, description, parameters) without requiring
manual registration in toolbox.py. Decorated functions can be automatically
discovered by the BotToolDiscovery system.

Architecture Pattern:
- Based on niabrain-websocket-purge-merge branch patterns
- Inspired by NCP's @tool_route decorator
- Adapted for pipecat-daily-bot's in-process tool execution

Example Usage:
    @bot_tool(
        name="bot_create_note",
        description="Create a new collaborative note",
        feature_flag="notes",
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Note title"},
                "content": {"type": "string", "description": "Note content"}
            },
            "required": ["title", "content"]
        }
    )
    async def create_note_handler(
        function_name: str,
        tool_call_id: str,
        args: dict,
        llm: Any,
        result_callback: Callable,
        mesh_client: MeshClient,
        forwarder: AppMessageForwarder,
        context: HandlerContext
    ):
        # Tool implementation
        pass
"""
from __future__ import annotations

import inspect
from collections.abc import Callable
from functools import wraps
from typing import Any


def bot_tool(
    name: str,
    description: str,
    parameters: dict[str, Any] | None = None,
    passthrough: bool = False,
    feature_flag: str | None = None,
) -> Callable:
    """
    Decorator to mark a function as a bot tool for auto-discovery.
    
    This decorator attaches metadata to tool handler functions, enabling:
    1. Automatic discovery via filesystem scanning
    2. Dynamic tool schema generation
    3. Runtime tool registry building
    4. Feature flag-based tool filtering
    
    Args:
        name: Tool name for LLM function calling (e.g., "bot_create_note").
            Should match the function name in tool schemas.
        description: Human-readable description of what the tool does.
            Used for LLM context and documentation.
        parameters: JSON Schema object describing tool parameters.
            If omitted, defaults to empty object schema.
            Example: {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "..."},
                    "content": {"type": "string"}
                },
                "required": ["title"]
            }
        passthrough: If True, tool should execute client-side (browser).
            Backend returns schema but doesn't execute handler.
            Used for UI manipulation tools (window focus, scroll, etc.).
        feature_flag: Optional feature flag name for tool filtering (e.g., "notes", "youtube", "gmail").
            Tools with the same feature_flag are grouped together and can be conditionally
            enabled/disabled via the supportedFeatures list during bot join.
            If None, the tool is always available (core functionality).
            Use this to organize tools into logical feature sets.
    
    Returns:
        Decorated function with _is_bot_tool=True and _tool_metadata dict.
    
    Example:
        @bot_tool(
            name="bot_create_note",
            description="Create a new collaborative note",
            parameters={
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "content": {"type": "string"}
                },
                "required": ["title"]
            },
            feature_flag="notes"
        )
        async def create_note_handler(...):
            # Implementation
            pass
    
    Notes:
        - Decorator preserves async/sync function behavior
        - Metadata is stored as function attributes for introspection
        - Works with both async and sync handler functions
        - Does not modify function behavior, only adds metadata
        - Feature flag filtering happens at tool registration time
    """
    def decorator(func: Callable) -> Callable:
        # Build complete metadata dictionary
        metadata = {
            "name": name,
            "description": description,
            "parameters": parameters or {
                "type": "object",
                "properties": {},
                "required": []
            },
            "passthrough": passthrough,
            "feature_flag": feature_flag,
        }
        
        # Store metadata on original function
        func._is_bot_tool = True
        func._tool_metadata = metadata
        
        # Preserve function behavior with appropriate wrapper
        if inspect.iscoroutinefunction(func):
            # Async function - use async wrapper
            @wraps(func)
            async def async_wrapper(*args, **kwargs):
                return await func(*args, **kwargs)
            
            # Attach metadata to wrapper
            async_wrapper._is_bot_tool = True
            async_wrapper._tool_metadata = metadata
            return async_wrapper
        else:
            # Sync function - use sync wrapper
            @wraps(func)
            def sync_wrapper(*args, **kwargs):
                return func(*args, **kwargs)
            
            # Attach metadata to wrapper
            sync_wrapper._is_bot_tool = True
            sync_wrapper._tool_metadata = metadata
            return sync_wrapper
    
    return decorator


# Export public API
__all__ = ["bot_tool"]
