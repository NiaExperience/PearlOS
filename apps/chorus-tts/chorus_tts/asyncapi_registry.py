# SPDX-License-Identifier: MIT
"""AsyncAPI metadata for Chorus TTS websocket channels."""

from __future__ import annotations

from .asyncapi_docs import (
    AsyncAPIChannelDoc,
    AsyncAPIMessageDoc,
    AsyncAPIParameterDoc,
    register_channel,
)
from .auth import APIKeyAuth
from .schemas import (
    AudioOutputEvent,
    CloseConnectionMessage,
    ConnectedEvent,
    ErrorEvent,
    FinalOutputEvent,
    HandshakeParams,
    InitializeConnectionMessage,
    SendTextMessage,
)
from .voices import SUPPORTED_VOICES

_PUBLISH_MESSAGES: tuple[AsyncAPIMessageDoc, ...] = (
    AsyncAPIMessageDoc(
        name="InitializeConnection",
        model=InitializeConnectionMessage,
        summary="Start a session by sending the sentinel space payload.",
        message_id="client.initializeConnection",
    ),
    AsyncAPIMessageDoc(
        name="SendText",
        model=SendTextMessage,
        summary="Stream buffered text or flush instructions during the session.",
        message_id="client.sendText",
    ),
    AsyncAPIMessageDoc(
        name="CloseConnection",
        model=CloseConnectionMessage,
        summary="Request the server to finish synthesis and close the session.",
        message_id="client.closeConnection",
    ),
)

_SUBSCRIBE_MESSAGES: tuple[AsyncAPIMessageDoc, ...] = (
    AsyncAPIMessageDoc(
        name="ConnectedEvent",
        model=ConnectedEvent,
        summary="Server acknowledgement after accepting the websocket handshake.",
        message_id="server.connected",
    ),
    AsyncAPIMessageDoc(
        name="AudioOutputEvent",
        model=AudioOutputEvent,
        summary="Streamed chunk of PCM audio generated from buffered text.",
        message_id="server.audioOutput",
    ),
    AsyncAPIMessageDoc(
        name="FinalOutputEvent",
        model=FinalOutputEvent,
        summary="Summary emitted when the session finishes successfully.",
        message_id="server.finalOutput",
    ),
    AsyncAPIMessageDoc(
        name="ErrorEvent",
        model=ErrorEvent,
        summary="Non-fatal or fatal error emitted by the server.",
        message_id="server.error",
    ),
)

_VOICE_PARAMETER = AsyncAPIParameterDoc(
    name="voice_id",
    description="Requested Chorus TTS voice identifier.",
    schema={"type": "string", "enum": sorted(SUPPORTED_VOICES.keys())},
)

STREAM_INPUT_CHANNEL = AsyncAPIChannelDoc(
    channel="v1/text-to-speech/{voice_id}/stream-input",
    summary="Client text messages streamed into Chorus TTS.",
    description=(
        "Bidirectional websocket channel used to stream Chorus TTS audio. "
        "Clients authenticate via API key, pass optional query parameters to tune "
        "synthesis, then alternate between text payloads and flush markers while "
        "receiving PCM audio chunks."
    ),
    publish_messages=_PUBLISH_MESSAGES,
    subscribe_messages=_SUBSCRIBE_MESSAGES,
    operation_id_publish="publishTextInputs",
    operation_id_subscribe="streamAudioOutputs",
    tags=("tts",),
    handshake_model=HandshakeParams,
    path_parameters=(_VOICE_PARAMETER,),
    security=APIKeyAuth.supported_schemes(),
    servers=("development",),
)

register_channel(STREAM_INPUT_CHANNEL)

__all__ = ["STREAM_INPUT_CHANNEL"]
