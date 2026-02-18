"""Automatic discovery system for @bot_tool decorated functions.

This module scans the tools/ directory, finds decorated functions, and builds
a complete tool registry without manual imports or hardcoded lists.

Architecture:
- Filesystem scanning for Python modules
- Dynamic module import with error handling
- Function inspection to find decorated tools
- Tool registry building (schemas + handlers)
- Feature flag-based filtering

Usage:
    from tool_discovery import BotToolDiscovery
    
    # Discover all tools
    discovery = BotToolDiscovery()
    tools = discovery.discover_tools()
    
    # Build schemas for LLM
    schemas = discovery.build_schemas()
    
    # Build handler mapping
    handlers = discovery.build_handler_mapping(room_url, forwarder_ref)
    
    # Filter by feature flag
    note_tools = discovery.get_tools_by_feature("notes")
    for name, meta in note_tools.items():
        handler = meta["handler_function"]
        handlers = discovery.build_handler_mapping(room_url, forwarder_ref)
"""
from __future__ import annotations

import importlib
import inspect
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pipecat.adapters.schemas.function_schema import FunctionSchema

from tools.logging_utils import bind_context_logger


class BotToolDiscovery:
    """
    Automatic discovery system for @bot_tool decorated functions.
    
    Scans the tools/ directory, finds decorated functions, and builds
    complete tool registry without manual imports.
    
    Attributes:
        tools_dir: Path to tools directory containing tool modules
        tool_modules: List of discovered module names
        _tool_cache: Cached tool registry to avoid repeated discovery
    """
    
    def __init__(self, tools_dir: Path | None = None):
        """Initialize discovery system.
        
        Args:
            tools_dir: Path to tools directory (defaults to current directory)
        """
        self._log = bind_context_logger(tag="[tool_discovery]")
        if tools_dir is None:
            tools_dir = Path(__file__).parent
        self.tools_dir = tools_dir
        self.tool_modules = self._discover_tool_modules()
        self._tool_cache: dict[str, dict[str, Any]] | None = None
    
    def _discover_tool_modules(self) -> list[str]:
        """Scan tools/ directory for Python modules.
        
        Returns:
            List of module names (e.g., ['tools.notes_tools', 'tools.view_tools'])
        """
        module_names = []
        
        if not self.tools_dir.exists():
            self._log.warning(
                "tools directory not found",
                toolsDir=str(self.tools_dir),
            )
            return module_names
        
        # Use rglob to find all .py files recursively
        for py_file in self.tools_dir.rglob("*.py"):
            # Skip __init__.py, __pycache__, and private modules
            if py_file.name.startswith("_"):
                continue
            
            # Calculate relative path to get module structure
            rel_path = py_file.relative_to(self.tools_dir)
            
            # Convert path to module notation (e.g. sharing/notes.py -> sharing.notes)
            module_parts = list(rel_path.parts)
            module_parts[-1] = py_file.stem # remove .py extension
            
            # Construct full module name
            module_name = f"tools.{'.'.join(module_parts)}"
            module_names.append(module_name)
        
        self._log.info(
            "tool modules discovered",
            moduleCount=len(module_names),
            modules=module_names,
        )
        return module_names
    
    def discover_tools(self) -> dict[str, dict[str, Any]]:
        """Discover all @bot_tool decorated functions.
        
        Scans all tool modules, finds functions with @bot_tool decorator,
        and builds a registry with complete metadata. Results are cached
        to avoid repeated expensive discovery operations.
        
        Returns:
            Dict mapping tool_name -> tool_metadata
            
        Example:
            {
                "bot_create_note": {
                    "name": "bot_create_note",
                    "description": "Create a new note",
                    "parameters": {...},
                    "passthrough": False,
                    "feature_flag": "notes",
                    "handler_function": <function>,
                    "module": "tools.notes_tools"
                },
                ...
            }
        """
        # Return cached results if available
        if self._tool_cache is not None:
            self._log.debug(
                "returning cached tools",
                toolCount=len(self._tool_cache),
            )
            return self._tool_cache
        
        tool_registry = {}
        
        for module_name in self.tool_modules:
            try:
                module = importlib.import_module(module_name)
                tools = self._extract_tools_from_module(module)
                tool_registry.update(tools)
                self._log.info(
                    "tools discovered in module",
                    module=module_name,
                    toolCount=len(tools),
                )
            except ImportError as e:
                self._log.warning(
                    "module import failed",
                    module=module_name,
                    error=str(e),
                )
                continue
            except Exception as e:
                self._log.error(
                    "module processing error",
                    module=module_name,
                    error=str(e),
                )
                continue
        
        self._log.info(
            "total tools discovered",
            toolCount=len(tool_registry),
        )
        
        # Cache results
        self._tool_cache = tool_registry
        return tool_registry
    
    def _extract_tools_from_module(
        self, module
    ) -> dict[str, dict[str, Any]]:
        """Extract tool metadata from decorated functions in a module.
        
        Args:
            module: Python module to inspect
            
        Returns:
            Dict mapping tool_name -> tool_metadata
        """
        tools = {}
        
        for _name, obj in inspect.getmembers(module):
            # Check if function has @bot_tool decorator
            if hasattr(obj, '_is_bot_tool') and obj._is_bot_tool:
                tool_name = obj._tool_metadata["name"]
                tools[tool_name] = {
                    **obj._tool_metadata,
                    "handler_function": obj,
                    "module": module.__name__
                }
        
        return tools
    
    def build_tool_schemas(
        self,
        prompts: dict[str, str] | None = None,
        tools: dict[str, dict[str, Any]] | None = None
    ) -> list[FunctionSchema]:
        """Build FunctionSchema list from discovered tools.
        
        Args:
            prompts: Optional dict to override tool descriptions
                    (tool_name -> custom_description)
            tools: Optional pre-filtered tools dict. If None, uses all discovered tools.
                   Use filter_tools_by_features() first to get a filtered dict.
            
        Returns:
            List of FunctionSchema objects for LLM function calling
            
        Example:
            # Use all tools
            schemas = discovery.build_tool_schemas()
            
            # Use filtered tools
            filtered = discovery.filter_tools_by_features(['notes', 'gmail'])
            schemas = discovery.build_tool_schemas(tools=filtered)
            
            # Use custom prompts with filtered tools
            prompts = {"bot_create_note": "Custom description"}
            schemas = discovery.build_tool_schemas(prompts, filtered)
        """
        prompts = prompts or {}
        discovered = tools if tools is not None else self.discover_tools()
        
        schemas = []
        for tool_name, metadata in discovered.items():
            # Use prompt override if available, else decorator description
            description = prompts.get(tool_name, metadata["description"])
            
            # Extract properties and required from parameters dict
            params = metadata["parameters"]
            properties = params.get("properties", {})
            required = params.get("required", [])
            
            schema = FunctionSchema(
                name=tool_name,
                description=description,
                properties=properties,
                required=required
            )
            schemas.append(schema)
        
        self._log.info("tool schemas built", schemaCount=len(schemas))
        return schemas
    
    def build_handler_mapping(
        self,
        room_url: str,
        forwarder_ref: dict[str, Any],
        tools: dict[str, dict[str, Any]] | None = None
    ) -> dict[str, Callable]:
        """Build handler mapping with injected dependencies.
        
        Note: This version returns raw handler functions. In the future,
        when tools are decorated at definition time, we may need to inject
        dependencies (mesh_client, forwarder) at call time instead.
        
        Args:
            room_url: Daily room URL (for context)
            forwarder_ref: Reference to AppMessageForwarder
            tools: Optional pre-filtered tools dict. If None, uses all discovered tools.
                   Use filter_tools_by_features() first to get a filtered dict.
            
        Returns:
            Dict mapping tool_name -> handler_function
            
        Example:
            # Use all tools
            handlers = discovery.build_handler_mapping(
                "https://daily.co/room",
                {"instance": forwarder}
            )
            
            # Use filtered tools
            filtered = discovery.filter_tools_by_features(['notes'])
            handlers = discovery.build_handler_mapping(
                "https://daily.co/room",
                {"instance": forwarder},
                tools=filtered
            )
            
            # Call handler
            await handlers["bot_create_note"](
                "bot_create_note",
                "call_123",
                {"title": "Test"},
                llm,
                result_callback,
                mesh_client,
                forwarder,
                context
            )
        """
        discovered = tools if tools is not None else self.discover_tools()
        handlers = {}
        
        for tool_name, metadata in discovered.items():
            handler_func = metadata["handler_function"]
            
            # Handler is already bound, just map it
            handlers[tool_name] = handler_func
        
        self._log.info("handler mappings built", handlerCount=len(handlers))
        return handlers
    
    def get_tools_by_feature(
        self, feature: str
    ) -> dict[str, dict[str, Any]]:
        """Get tools filtered by feature flag.
        
        Args:
            feature: Feature flag name (notes, window, view, html, youtube, profile, misc)
            
        Returns:
            Dict of tools matching the feature flag
            
        Example:
            note_tools = discovery.get_tools_by_feature("notes")
            # Returns only tools with feature_flag="notes"
        """
        tools = self.discover_tools()
        return {
            name: meta for name, meta in tools.items()
            if meta.get("feature_flag") == feature
        }
    
    def get_tool_count(self) -> int:
        """Get total number of discovered tools.
        
        Returns:
            Count of discovered tools
        """
        return len(self.discover_tools())
    
    def get_tool_features(self) -> set[str]:
        """Get all unique feature flags.
        
        Returns:
            Set of feature flag names (excludes None)
        """
        tools = self.discover_tools()
        return {meta["feature_flag"] for meta in tools.values() if meta.get("feature_flag")}
    
    def filter_tools_by_features(
        self,
        supported_features: list[str] | None = None
    ) -> dict[str, dict[str, Any]]:
        """Filter discovered tools based on supported feature flags.
        
        Returns only tools that either:
        1. Have no feature_flag set (always included)
        2. Have a feature_flag that's in the supported_features list
        
        Args:
            supported_features: List of enabled feature flags (e.g., ['notes', 'youtube', 'gmail']).
                If None or empty, returns all tools.
                
        Returns:
            Dict mapping tool_name -> tool_metadata (filtered)
            
        Example:
            # Only return tools with no feature_flag or feature_flag in ['notes', 'gmail']
            filtered = discovery.filter_tools_by_features(['notes', 'gmail'])
            
            # Returns all tools (no filtering)
            all_tools = discovery.filter_tools_by_features(None)
        """
        all_tools = self.discover_tools()
        
        # If no feature list provided, return all tools
        if not supported_features:
            self._log.debug("[tool_discovery] No feature filter - returning all tools")
            return all_tools
        
        # Convert to set for O(1) lookup
        features_set = set(supported_features)
        
        # Filter tools: include if no feature_flag or if feature_flag is in supported list
        filtered_tools = {}
        for tool_name, tool_meta in all_tools.items():
            feature_flag = tool_meta.get("feature_flag")
            
            # Include tool if it has no feature_flag requirement
            if feature_flag is None:
                filtered_tools[tool_name] = tool_meta
                continue
            
            # Include tool if its feature_flag is in the supported list
            if feature_flag in features_set:
                filtered_tools[tool_name] = tool_meta
            else:
                self._log.debug(
                    "tool filtered by feature",
                    toolName=tool_name,
                    featureFlag=feature_flag,
                    supportedFeatures=list(features_set),
                )
        
            self._log.info(
                "feature filtering complete",
                totalTools=len(all_tools),
                matchedTools=len(filtered_tools),
                supportedFeatures=supported_features,
            )
        return filtered_tools
    
    def clear_cache(self) -> None:
        """Clear cached tool registry.
        
        Forces next discover_tools() call to re-scan and re-import all modules.
        Useful for testing or hot reload scenarios.
        """
        self._log.debug("clearing tool cache")
        self._tool_cache = None


# Export public API
__all__ = ["BotToolDiscovery"]

# Global singleton discovery instance for the process. Use get_discovery()
_GLOBAL_DISCOVERY: BotToolDiscovery | None = None


def get_discovery(tools_dir: Path | None = None) -> BotToolDiscovery:
    """Return a process-wide BotToolDiscovery singleton.

    This avoids repeated module imports and re-scans across the application.
    Tests may still create fresh BotToolDiscovery() instances if they need
    isolated behavior.
    """
    global _GLOBAL_DISCOVERY
    if _GLOBAL_DISCOVERY is None:
        _GLOBAL_DISCOVERY = BotToolDiscovery(tools_dir=tools_dir)
    return _GLOBAL_DISCOVERY

__all__.append("get_discovery")
