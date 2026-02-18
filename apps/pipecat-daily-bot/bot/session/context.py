"""Context object for bot tool handlers.

Provides shared context (tenant_id, user_id, etc.) to handlers that need it,
without polluting every handler signature with optional parameters.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass
class HandlerContext:
    """Context object passed to tool handlers that need session information.
    
    Attributes:
        get_tenant_id: Callable that returns current tenant_id from bot session
        get_user_id: Callable that returns current user_id from bot session
        get_user_email: Callable that returns current user email from bot session
        get_user_name: Callable that returns current user name from bot session
    """
    get_tenant_id: Callable[[], str | None] | None = None
    get_user_id: Callable[[], str | None] | None = None
    get_user_email: Callable[[], str | None] | None = None
    get_user_name: Callable[[], str | None] | None = None
    
    def tenant_id(self) -> str | None:
        """Get current tenant_id, handling None callable gracefully."""
        return self.get_tenant_id() if self.get_tenant_id else None
    
    def user_id(self) -> str | None:
        """Get current user_id, handling None callable gracefully."""
        return self.get_user_id() if self.get_user_id else None
    
    def user_email(self) -> str | None:
        """Get current user email, handling None callable gracefully."""
        return self.get_user_email() if self.get_user_email else None
    
    def user_name(self) -> str | None:
        """Get current user name, handling None callable gracefully."""
        return self.get_user_name() if self.get_user_name else None
