"""Tool handler layer for LLM integration.

Tools accept function call parameters from the LLM, call actions/
for business logic, emit events via AppMessageForwarder, and return
structured responses to the LLM.

Architecture:
- Aggregation is handled by toolbox.py for proper logging
"""

from typing import Any, Callable

# Tool handler function type
ToolHandlerFunc = Callable[..., dict[str, Any]]

__all__ = ['ToolHandlerFunc']
