# SPDX-License-Identifier: MIT
"""AsyncAPI documentation helpers tied to the websocket implementation.

The decorator defined here allows the websocket handler to register the
metadata required for generating the AsyncAPI specification. It keeps the
documentation close to the request handler so future behaviour changes are
captured automatically.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass

from pydantic import BaseModel


@dataclass(frozen=True, slots=True)
class AsyncAPIMessageDoc:
    """Describe a message exchanged over the websocket channel."""

    name: str
    model: type[BaseModel]
    summary: str | None = None
    message_id: str | None = None


@dataclass(frozen=True, slots=True)
class AsyncAPIParameterDoc:
    """Describe a path or channel parameter."""

    name: str
    description: str | None
    schema: dict[str, object]


@dataclass(frozen=True, slots=True)
class AsyncAPIChannelDoc:
    """Metadata captured for a single AsyncAPI channel."""

    channel: str
    summary: str
    description: str
    publish_messages: tuple[AsyncAPIMessageDoc, ...]
    subscribe_messages: tuple[AsyncAPIMessageDoc, ...]
    operation_id_publish: str
    operation_id_subscribe: str
    tags: tuple[str, ...]
    handshake_model: type[BaseModel] | None
    path_parameters: tuple[AsyncAPIParameterDoc, ...]
    security: tuple[str, ...]
    servers: tuple[str, ...]


_CHANNEL_REGISTRY: dict[str, AsyncAPIChannelDoc] = {}


def register_channel(doc: AsyncAPIChannelDoc) -> None:
    """Persist a channel document in the registry (idempotent)."""
    _CHANNEL_REGISTRY.setdefault(doc.channel, doc)


def attach_asyncapi_doc(
    doc: AsyncAPIChannelDoc,
) -> Callable[[Callable[..., object]], Callable[..., object]]:
    """Attach a registered doc to a websocket handler."""
    register_channel(doc)

    def decorator(func: Callable[..., object]) -> Callable[..., object]:
        return func

    return decorator


def iter_channels() -> Iterable[AsyncAPIChannelDoc]:
    """Return the AsyncAPI channel metadata captured so far."""
    return _CHANNEL_REGISTRY.values()
