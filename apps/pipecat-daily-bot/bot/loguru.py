from __future__ import annotations

import itertools
import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any

_handler_ids = itertools.count(1)
_handlers: dict[int, logging.Handler] = {}


def _level_to_int(level: str | int | None) -> int:
    if isinstance(level, int):
        return level
    if isinstance(level, str):
        try:
            return getattr(logging, level.upper())
        except Exception:
            return logging.INFO
    return logging.INFO


def _resolve_default_level() -> int:
    raw = (os.getenv("PYTHON_DEBUG_LEVEL") or os.getenv("DEBUG_BOT") or "info").strip().lower()
    if raw in ("1", "true", "yes", "on", "debug"):
        return logging.DEBUG
    if raw in ("warn", "warning"):
        return logging.WARNING
    if raw in ("error", "err"):
        return logging.ERROR
    return logging.INFO


def _frame_logging_enabled() -> bool:
    raw = (os.getenv("PIPECAT_FRAME_DEBUG") or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _derive_tag_from_name(name: str | None) -> str | None:
    if not name:
        return None
    base = name.split(".")[-1]
    return base or None


def _normalize_tag(tag: str | None) -> str | None:
    if not tag:
        return None
    trimmed = str(tag).strip()
    if not trimmed:
        return None
    return trimmed if trimmed.startswith("[") else f"[{trimmed}]"


def _configure_noisy_subloggers() -> None:
    """Force chatty pipecat internals to INFO unless explicitly enabled."""
    noisy_loggers = [
        "pipecat.pipeline",
        "pipecat.transports",
        "pipecat.frames",
        "pipecat.services",
        "pipecat.adapters",
    ]
    level = logging.DEBUG if _frame_logging_enabled() else logging.INFO
    for name in noisy_loggers:
        logging.getLogger(name).setLevel(level)


class StructuredLogger:
    """Minimal loguru-compatible wrapper using standard logging with context binding."""

    def __init__(self, base: logging.Logger, context: dict[str, Any] | None = None):
        self._base = base
        self._context = context or {}

    def bind(self, **kwargs: Any) -> "StructuredLogger":
        merged = {**self._context}
        for key, value in kwargs.items():
            if value is not None:
                merged[key] = value
        return StructuredLogger(self._base, merged)

    def _log(self, level: int, message: str, *args: Any, **kwargs: Any) -> None:
        exc_info = kwargs.pop("exc_info", None)
        stack_info = kwargs.pop("stack_info", False)
        context = {**self._context}
        # Merge any supplemental key/value pairs passed into the call
        for key, value in kwargs.items():
            if value is not None:
                context[key] = value

        extra = {"context": context} if context else None
        self._base.log(level, message, *args, exc_info=exc_info, stack_info=stack_info, extra=extra)

    def debug(self, message: str, *args: Any, **kwargs: Any) -> None:
        self._log(logging.DEBUG, message, *args, **kwargs)

    def trace(self, message: str, *args: Any, **kwargs: Any) -> None:
        # Loguru's TRACE maps here to DEBUG to keep compatibility without custom levels
        self._log(logging.DEBUG, message, *args, **kwargs)

    def info(self, message: str, *args: Any, **kwargs: Any) -> None:
        self._log(logging.INFO, message, *args, **kwargs)

    def warning(self, message: str, *args: Any, **kwargs: Any) -> None:
        self._log(logging.WARNING, message, *args, **kwargs)

    def error(self, message: str, *args: Any, **kwargs: Any) -> None:
        self._log(logging.ERROR, message, *args, **kwargs)

    def exception(self, message: str, *args: Any, **kwargs: Any) -> None:
        self._log(logging.ERROR, message, *args, exc_info=True, **kwargs)

    # Compatibility helpers for legacy loguru usage
    def add(self, sink: Any, level: str | int | None = None, **_: Any) -> int:
        """Attach a sink similar to loguru's .add().

        Supports callables (for test log capture), file-like objects, and
        filesystem paths. Callables receive the formatted message string.
        """

        handler: logging.Handler
        if callable(sink):
            class _CallableHandler(logging.Handler):
                def emit(self, record: logging.LogRecord) -> None:  # type: ignore[override]
                    try:
                        message = self.format(record)
                    except Exception:
                        try:
                            message = record.getMessage()
                        except Exception:
                            message = ""
                    try:
                        sink(message)
                    except Exception:
                        # Swallow sink errors to mirror loguru's permissive behavior
                        pass

            handler = _CallableHandler()
            handler.setFormatter(logging.Formatter("%(message)s"))
        else:
            try:
                handler = logging.StreamHandler(sink)
            except Exception:
                handler = logging.FileHandler(str(sink))
            handler.setFormatter(logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s"))

        handler.setLevel(_level_to_int(level))
        self._base.addHandler(handler)
        handler_id = next(_handler_ids)
        _handlers[handler_id] = handler
        return handler_id

    def remove(self, handler_id: int | None = None) -> None:
        if handler_id is None:
            ids = list(_handlers.keys())
        else:
            ids = [handler_id]
        for hid in ids:
            handler = _handlers.pop(hid, None)
            if handler:
                try:
                    self._base.removeHandler(handler)
                except Exception:
                    pass

    def addFilter(self, filt: logging.Filter) -> None:  # type: ignore[override]
        try:
            self._base.addFilter(filt)
        except Exception:
            pass

    def removeFilter(self, filt: logging.Filter) -> None:  # type: ignore[override]
        try:
            self._base.removeFilter(filt)
        except Exception:
            pass


class _JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:  # type: ignore[override]
        ts = datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat()
        payload: dict[str, Any] = {
            "ts": ts,
            "level": record.levelname,
            "message": record.getMessage(),
        }

        context = getattr(record, "context", None)
        if isinstance(context, dict) and context:
            payload.update(context)

        normalized_tag = _resolve_tag(record, context)
        if normalized_tag:
            payload["tag"] = normalized_tag
            if not payload["message"].startswith(normalized_tag):
                payload["message"] = f"{normalized_tag} {payload['message']}"

        return _serialize_payload(payload, ts, record, context)


def _resolve_tag(record: logging.LogRecord, context: dict[str, Any] | None) -> str | None:
    if isinstance(context, dict):
        tag = context.get("tag") or context.get("logger")
        if tag:
            return _normalize_tag(tag)
    return _normalize_tag(_derive_tag_from_name(getattr(record, "name", None)))


def _serialize_payload(payload: dict[str, Any], ts: str, record: logging.LogRecord, context: Any) -> str:
    try:
        return json.dumps(payload, separators=(",", ":"))
    except Exception:
        # Fall back to plain text if serialization fails
        return f"{ts} {record.levelname} {record.getMessage()} context={context}"


def _base_logger() -> logging.Logger:
    logger = logging.getLogger("pipecat")
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(_JSONFormatter())
        # Drop frame-level chatter unless explicitly enabled
        if not _frame_logging_enabled():
            handler.addFilter(lambda record: "Frame#" not in record.getMessage())
        logger.addHandler(handler)
    logger.setLevel(_resolve_default_level())
    logger.propagate = False
    _configure_noisy_subloggers()
    return logger


# Module-level logger compatible with existing imports
logger = StructuredLogger(_base_logger())


def get_logger(name: str | None = None, *, tag: str | None = None, **context: Any) -> StructuredLogger:
    """Return a StructuredLogger with a normalized tag for consistency.

    Tags are derived from the provided tag or the logger name (last segment).
    The tag is injected into the context so formatters can surface it even when
    callers do not prefix messages themselves.
    """
    derived_tag = _normalize_tag(tag or _derive_tag_from_name(name))
    base_context: dict[str, Any] = {}
    if derived_tag:
        base_context["tag"] = derived_tag
    if name:
        base_context["logger"] = name
    for key, value in context.items():
        if value is not None:
            base_context[key] = value
    return StructuredLogger(_base_logger(), base_context)

def set_base_level(level: str | int) -> None:
    """Update the base logger + handlers to the given level."""
    numeric_level = _level_to_int(level)
    base = _base_logger()
    base.setLevel(numeric_level)
    for handler in base.handlers:
        try:
            handler.setLevel(numeric_level)
        except Exception:
            # Keep other handlers untouched if updating fails
            pass


__all__ = ["logger", "StructuredLogger", "set_base_level", "get_logger"]
