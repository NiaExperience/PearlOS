"""Configuration helpers for structlog-based logging."""

from __future__ import annotations

import logging
import sys

import structlog

_ConfigLevel = int | str

_CONFIGURED = False


def _to_numeric_level(level: _ConfigLevel) -> int:
    if isinstance(level, int):
        return level
    if isinstance(level, str):
        numeric = logging.getLevelName(level.upper())
        if isinstance(numeric, int):
            return numeric
    message = f"Unsupported log level: {level!r}"
    raise ValueError(message)


def configure_logging(level: _ConfigLevel = logging.INFO) -> None:
    """Configure structlog and stdlib logging once."""
    numeric_level = _to_numeric_level(level)

    global _CONFIGURED
    root_logger = logging.getLogger()
    root_logger.setLevel(numeric_level)

    if _CONFIGURED:
        return

    logging.basicConfig(stream=sys.stdout, level=numeric_level, format="%(message)s")

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.filter_by_level,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    _CONFIGURED = True


__all__ = ["configure_logging"]
