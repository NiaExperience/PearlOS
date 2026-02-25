"""Generate the AsyncAPI specification and optional HTML viewer.

The channel metadata lives alongside the websocket handler and is imported
from ``chorus_tts.app`` to keep documentation in lockstep with the code.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

import chorus_tts.app  # noqa: F401 ensures AsyncAPI docs are registered
from chorus_tts.asyncapi_docs import AsyncAPIMessageDoc, iter_channels
from chorus_tts.auth import SECURITY_SCHEMES, APIKeyAuth
from chorus_tts.logging_config import configure_logging
from pydantic import BaseModel
from pydantic_asyncapi.common import Reference, Schema, Tag
from pydantic_asyncapi.v2 import (
    AsyncAPI,
    ChannelItem,
    Components,
    Info,
    Message,
    OneOf,
    Operation,
    Parameter,
    Server,
    ServerVariable,
)
from structlog.stdlib import get_logger

LOGGER = get_logger("asyncapi.generator")
PROJECT_ROOT = Path(__file__).resolve().parents[1]
GENERATED_DOCS_DIR = PROJECT_ROOT / "var" / "asyncapi"


def _load_project_version() -> str:
    pyproject_file = PROJECT_ROOT / "pyproject.toml"
    try:
        import tomllib

        with pyproject_file.open("rb") as handle:
            data = tomllib.load(handle)
        return data.get("project", {}).get("version", "0.0.0")
    except ModuleNotFoundError:  # pragma: no cover - fallback when tomllib unavailable
        return "0.0.0"


def _rewrite_refs(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "$ref" and isinstance(item, str) and item.startswith("#/$defs/"):
                value[key] = item.replace("#/$defs/", "#/components/schemas/")
            else:
                _rewrite_refs(item)
    elif isinstance(value, list):
        for item in value:
            _rewrite_refs(item)


def _process_schema_dict(
    name: str,
    schema_dict: dict[str, Any],
    schemas: dict[str, dict[str, Any]],
) -> None:
    defs = schema_dict.pop("$defs", {})
    _rewrite_refs(schema_dict)
    schemas.setdefault(name, schema_dict)
    for def_name, def_schema in defs.items():
        _process_schema_dict(def_name, def_schema, schemas)


def _ensure_schema(
    model: type[BaseModel],
    schemas: dict[str, dict[str, Any]],
) -> str:
    json_schema = model.model_json_schema(by_alias=True)
    name = json_schema.get("title", model.__name__)
    _process_schema_dict(name, json_schema, schemas)
    return name


def _ensure_message(
    message_doc: AsyncAPIMessageDoc,
    schemas: dict[str, dict[str, Any]],
    messages: dict[str, dict[str, Any]],
) -> Reference:
    schema_name = _ensure_schema(message_doc.model, schemas)
    if message_doc.name not in messages:
        message = Message(
            name=message_doc.name,
            summary=message_doc.summary,
            messageId=message_doc.message_id,
            payload=Reference(ref=f"#/components/schemas/{schema_name}"),
        )
        messages[message_doc.name] = message.model_dump(
            by_alias=True,
            exclude_none=True,
            exclude_defaults=True,
        )
    return Reference(ref=f"#/components/messages/{message_doc.name}")


def _build_operation(
    *,
    operation_id: str,
    summary: str,
    message_refs: Sequence[Reference],
) -> Operation:
    if not message_refs:
        msg = "Operations must include at least one message reference."
        raise ValueError(msg)
    if len(message_refs) == 1:
        message: Reference | OneOf = message_refs[0]
    else:
        message = OneOf(oneOf=list(message_refs))
    return Operation(operationId=operation_id, summary=summary, message=message)


def _build_asyncapi_document(version: str) -> dict[str, Any]:
    schemas: dict[str, dict[str, Any]] = {}
    messages: dict[str, dict[str, Any]] = {}
    channels: dict[str, ChannelItem] = {}
    handshake_refs: dict[str, str] = {}

    for channel_doc in iter_channels():
        publish_refs = [
            _ensure_message(msg, schemas, messages)
            for msg in channel_doc.publish_messages
        ]
        subscribe_refs = [
            _ensure_message(msg, schemas, messages)
            for msg in channel_doc.subscribe_messages
        ]

        if channel_doc.handshake_model is not None:
            handshake_schema = _ensure_schema(channel_doc.handshake_model, schemas)
            handshake_refs[channel_doc.channel] = (
                f"#/components/schemas/{handshake_schema}"
            )

        parameters = {
            param.name: Parameter(
                description=param.description,
                schema=Schema.model_validate(param.schema),
            )
            for param in channel_doc.path_parameters
        }

        publish_operation = _build_operation(
            operation_id=channel_doc.operation_id_publish,
            summary=channel_doc.summary,
            message_refs=publish_refs,
        )
        subscribe_operation = _build_operation(
            operation_id=channel_doc.operation_id_subscribe,
            summary=channel_doc.summary,
            message_refs=subscribe_refs,
        )

        channels[channel_doc.channel] = ChannelItem(
            description=channel_doc.description,
            servers=list(channel_doc.servers),
            publish=publish_operation,
            subscribe=subscribe_operation,
            parameters=parameters or None,
        )

    components = Components()

    servers = {
        "development": Server(
            url="ws://localhost:8080",
            protocol="ws",
            description=(
                "Local development server. Update the port to match SERVER_PORT."
            ),
            variables={
                "port": ServerVariable(
                    default="8080",
                    description="Matches the SERVER_PORT environment variable.",
                ),
            },
        ),
    }

    tag_descriptions = {
        "tts": "Streaming synthesis endpoints for Chorus TTS.",
    }
    tags = [
        Tag(name=name, description=tag_descriptions.get(name))
        for name in sorted({tag for doc in iter_channels() for tag in doc.tags})
    ] or None

    document = AsyncAPI(
        id="urn:chorus:tts:websocket",
        info=Info(
            title="Chorus TTS Streaming Text-to-Speech",
            version=version,
            description=(
                "Websocket protocol for streaming Chorus TTS (backed by Kokoro). "
                "Authenticate with an ElevenLabs-style API key, stream text payloads, "
                "and receive PCM audio responses in near real-time."
            ),
            contact={
                "name": "Chorus TTS Team",
                "email": "support@chorus-tts.example.com",
                "url": "https://chorus-tts.example.com",
            },
            license={
                "name": "MIT",
                "url": "https://opensource.org/licenses/MIT",
            },
        ),
        servers=servers,
        channels=channels,
        components=components,
        tags=tags,
    )

    payload = document.model_dump(by_alias=True, exclude_none=True)

    payload.setdefault("defaultContentType", "application/json")

    if "development" in payload.get("servers", {}):
        payload["servers"]["development"]["url"] = "ws://localhost:{port}"

    components_section = payload.setdefault("components", {})
    if schemas:
        components_section["schemas"] = schemas
    if messages:
        components_section["messages"] = messages
    components_section.setdefault("securitySchemes", {}).update(
        {
            name: scheme.model_dump(
                by_alias=True,
                exclude_none=True,
                exclude_defaults=True,
            )
            for name, scheme in SECURITY_SCHEMES.items()
        },
    )

    for channel_doc in iter_channels():
        channel_entry = payload["channels"][channel_doc.channel]
        for key in ("publish", "subscribe"):
            if key in channel_entry:
                schemes = (
                    channel_doc.security
                    if channel_doc.security
                    else APIKeyAuth.supported_schemes()
                )
                channel_entry[key]["security"] = [{scheme: []} for scheme in schemes]

        bindings = channel_entry.setdefault("bindings", {}).setdefault("ws", {})
        handshake_ref = handshake_refs.get(channel_doc.channel)
        if handshake_ref:
            bindings["query"] = {"$ref": handshake_ref}
        bindings.setdefault(
            "headers",
            {
                "type": "object",
                "properties": {
                    "xi-api-key": {
                        "type": "string",
                        "description": "Primary authentication header (preferred).",
                    },
                    "authorization": {
                        "type": "string",
                        "description": "Optional Bearer token header.",
                    },
                },
            },
        )

    return payload


def _is_scalar(value: Any) -> bool:
    return not isinstance(value, (dict, list))


def _format_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return json.dumps(value)
    text = str(value)
    special = ":#[]{}&*>!|>'\"%@`\n\r\t"
    numeric_like = text.replace("_", "").replace(".", "").isdigit()
    reserved = {"null", "true", "false", "~"}
    if (
        text == ""
        or any(ch in text for ch in special)
        or text.strip() != text
        or text.lower() in reserved
        or numeric_like
    ):
        return json.dumps(text)
    return text


def _dump_yaml(value: Any, *, indent: int = 0) -> str:
    spacer = " " * indent
    if isinstance(value, dict):
        if not value:
            return f"{spacer}{{}}"
        lines: list[str] = []
        for key, item in value.items():
            formatted_key = str(key)
            if _is_scalar(item):
                lines.append(f"{spacer}{formatted_key}: {_format_scalar(item)}")
            else:
                child = _dump_yaml(item, indent=indent + 2)
                lines.append(f"{spacer}{formatted_key}:\n{child}")
        return "\n".join(lines)
    if isinstance(value, list):
        if not value:
            return f"{spacer}[]"
        lines = []
        for item in value:
            if _is_scalar(item):
                lines.append(f"{spacer}- {_format_scalar(item)}")
            else:
                child = _dump_yaml(item, indent=indent + 2)
                lines.append(f"{spacer}-\n{child}")
        return "\n".join(lines)
    return f"{spacer}{_format_scalar(value)}"


def write_yaml_file(data: Any, path: Path) -> None:
    """Serialise ``data`` as YAML to ``path``."""
    content = _dump_yaml(data)
    path.write_text(f"{content}\n", encoding="utf-8")


def _generate_html(spec_path: Path, output_dir: Path) -> None:
    template_ref = "@asyncapi/html-template@0.28.0"
    command = [
        "npx",
        "@asyncapi/cli@latest",
        "generate",
        "fromTemplate",
        str(spec_path),
        template_ref,
        "--output",
        str(output_dir),
        "--force-write",
    ]
    subprocess.run(command, check=True)  # noqa: S603 - command constructed above


def _parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate the AsyncAPI spec.")
    parser.add_argument(
        "--output",
        default=str(GENERATED_DOCS_DIR / "asyncapi.yaml"),
        help="Location for the generated AsyncAPI document.",
    )
    parser.add_argument(
        "--generate-html",
        action="store_true",
        help="Render the AsyncAPI HTML docs using the official generator.",
    )
    parser.add_argument(
        "--html-output",
        default=str(GENERATED_DOCS_DIR / "html"),
        help="Directory where the HTML output should be written.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose logging for troubleshooting.",
    )
    return parser.parse_args(list(argv))


def main(argv: Iterable[str] | None = None) -> int:
    """Command-line entry point for AsyncAPI generation."""
    args = _parse_args(argv or sys.argv[1:])

    configure_logging("INFO" if args.verbose else "WARNING")

    version = _load_project_version()
    document = _build_asyncapi_document(version)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_yaml_file(document, output_path)
    LOGGER.info("asyncapi_written", path=str(output_path.relative_to(PROJECT_ROOT)))

    if args.generate_html:
        html_dir = Path(args.html_output)
        html_dir.mkdir(parents=True, exist_ok=True)
        try:
            _generate_html(output_path, html_dir)
        except subprocess.CalledProcessError as exc:  # pragma: no cover - CLI errors
            LOGGER.error(
                "asyncapi_cli_failed",
                returncode=exc.returncode,
                command=exc.cmd,
            )
            raise SystemExit(exc.returncode) from exc

    return 0


if __name__ == "__main__":  # pragma: no cover - manual execution helper
    raise SystemExit(main())
