from __future__ import annotations

import logging
import os
import json
from typing import Any

try:
    from session.context import HandlerContext
except Exception:  # pragma: no cover
    HandlerContext = None  # type: ignore


class StructuredLogger:
    """Lightweight structured logger with bind-style context accumulation."""

    def __init__(self, logger: logging.Logger, context: dict[str, Any] | None = None):
        self._logger = logger
        self._context = context or {}

    def bind(self, **kwargs: Any) -> "StructuredLogger":
        merged = {**self._context}
        for key, value in kwargs.items():
            if value is not None:
                merged[key] = value
        return StructuredLogger(self._logger, merged)

    def _log(self, level: int, msg: str | None = None, **kwargs: Any) -> None:
        exc_info = kwargs.pop("exc_info", None)
        stack_info = kwargs.pop("stack_info", False)

        # Support callers that pass "message" as a kwarg to match loguru style
        kw_message = kwargs.pop("message", None)
        text = msg if msg is not None else kw_message
        if text is None:
            text = ""

        context = {**self._context}
        for key, value in kwargs.items():
            if value is not None:
                context[key] = value

        extra = {"context": context} if context else None
        self._logger.log(level, text, extra=extra, exc_info=exc_info, stack_info=stack_info)

    def debug(self, msg: str | None = None, **kwargs: Any) -> None:
        self._log(logging.DEBUG, msg, **kwargs)

    def trace(self, msg: str | None = None, **kwargs: Any) -> None:
        # Align trace calls to DEBUG so legacy loguru usages do not break
        self._log(logging.DEBUG, msg, **kwargs)

    def info(self, msg: str | None = None, **kwargs: Any) -> None:
        self._log(logging.INFO, msg, **kwargs)

    def warning(self, msg: str | None = None, **kwargs: Any) -> None:
        self._log(logging.WARNING, msg, **kwargs)

    def error(self, msg: str | None = None, **kwargs: Any) -> None:
        self._log(logging.ERROR, msg, **kwargs)

    def exception(self, msg: str | None = None, **kwargs: Any) -> None:
        self._log(logging.ERROR, msg, exc_info=True, **kwargs)


def _base_logger() -> logging.Logger:
    logger = logging.getLogger("pipecat.tools")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(_JsonFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger


class _JsonFormatter(logging.Formatter):
    """JSON formatter to keep tool logs structured."""

    def format(self, record: logging.LogRecord) -> str:  # type: ignore[override]
        context = getattr(record, "context", None)

        message = record.getMessage()

        payload: dict[str, Any] = {
            "ts": self.formatTime(record, datefmt="%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "message": message,
        }

        if isinstance(context, dict):
            for key, value in context.items():
                if value is not None:
                    payload[key] = value

        try:
            return json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
        except Exception:
            payload["serializationError"] = True
            return json.dumps(payload, ensure_ascii=True, separators=(",", ":"))


def _bind_logger(**context: Any) -> StructuredLogger:
    return StructuredLogger(_base_logger(), context)


def _env_context() -> dict[str, str | None]:
    """Return session/user context from environment for fallback binding."""
    return {
        "room_url": os.getenv("BOT_ROOM_URL"),
        "session_id": os.getenv("BOT_SESSION_ID"),
        "user_id": os.getenv("BOT_SESSION_USER_ID"),
        "user_name": os.getenv("BOT_SESSION_USER_NAME"),
        "user_email": os.getenv("BOT_SESSION_USER_EMAIL"),
    }


def bind_context_logger(
    *,
    room_url: str | None = None,
    session_id: str | None = None,
    user_id: str | None = None,
    user_name: str | None = None,
    tag: str | None = None,
    **extra: Any,
) -> StructuredLogger:
    """Bind a structured logger with contextual fields."""
    env_ctx = _env_context()
    ctx = {
        "roomUrl": room_url or env_ctx["room_url"],
        "sessionId": session_id or env_ctx["session_id"],
        "userId": user_id or env_ctx["user_id"],
        "userName": user_name or env_ctx["user_name"],
        "userEmail": env_ctx["user_email"],
    }
    for key, value in extra.items():
        if value is not None:
            ctx[key] = value

    bound = _bind_logger(**ctx)
    if tag:
        bound = bound.bind(tag=tag)
    return bound


def _safe_call(value_or_callable: Any, attr_name: str) -> Any:
    if callable(value_or_callable):
        try:
            return value_or_callable()
        except Exception:
            return None
    if value_or_callable is None:
        return None
    try:
        attr = getattr(value_or_callable, attr_name)
        return attr() if callable(attr) else attr
    except Exception:
        return None


def bind_tool_logger(params: Any, *, tag: str | None = None) -> StructuredLogger:
    """Bind a structured logger from FunctionCallParams-like objects.

    Safely extracts room_url, session/user info from params, handler_context, or environment.
    """
    room_url = getattr(params, "room_url", None) or getattr(getattr(params, "forwarder", None), "room_url", None)
    context = getattr(params, "handler_context", None) or getattr(params, "context", None)

    user_id = None
    user_name = None
    if HandlerContext and isinstance(context, HandlerContext):
        user_id = _safe_call(context, "user_id")
        user_name = _safe_call(context, "user_name")
    else:
        user_id = _safe_call(context, "user_id")
        user_name = _safe_call(context, "user_name")

    session_id = (
        getattr(params, "session_id", None)
        or getattr(params, "sessionId", None)
        or os.getenv("BOT_SESSION_ID")
    )

    env_ctx = _env_context()

    return bind_context_logger(
        room_url=room_url or env_ctx["room_url"],
        session_id=session_id or env_ctx["session_id"],
        user_id=user_id or env_ctx["user_id"],
        user_name=user_name or env_ctx["user_name"],
        tag=tag,
    )
