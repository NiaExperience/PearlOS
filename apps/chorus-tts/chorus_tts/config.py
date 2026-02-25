# SPDX-License-Identifier: MIT
"""Configuration helpers for the chorus_tts package.

This module intentionally keeps runtime dependencies minimal while still
providing structured validation via Pydantic. Settings are sourced from:

1. An optional `.env` file (defaults to project root) parsed in dotenv style.
2. Environment variables, which override `.env` entries.

Required keys:
    - KOKORO_MODEL_PATH: filesystem path to the Kokoro ONNX model.
    - KOKORO_VOICES_PATH: numpy `.npy` file containing voice embeddings.

Authentication:
    - API_KEYS: comma-separated list of API keys.
    - API_KEYS_FILE: path to a file containing one API key per line.

Optional keys:
    - API_KEYS: as above (can be combined with API_KEYS_FILE).
    - API_KEYS_FILE: as above.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .voices import SUPPORTED_VOICES


class Settings(BaseModel):
    """Validated runtime configuration for the websocket service."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    model_path: Path
    voices_path: Path
    api_keys: tuple[str, ...] = ()
    chunk_length_schedule: tuple[int, ...] = Field(
        default=(80, 120, 180),
        description="Character thresholds for buffered generation.",
    )
    default_voice_id: str = Field(
        default="af_alloy",
        description="Fallback voice id when mapping entry is not found.",
    )
    server_host: str = Field(
        default="0.0.0.0",  # noqa: S104 - service listens on all interfaces by default
        alias="SERVER_HOST",
    )
    server_port: int = Field(default=8000, ge=1, le=65535, alias="SERVER_PORT")
    log_level: str = Field(default="info", alias="LOG_LEVEL")
    inactivity_timeout: int = Field(
        default=20,
        ge=5,
        le=180,
        alias="INACTIVITY_TIMEOUT",
    )
    ort_providers: tuple[str, ...] = Field(
        default=(),
        description=(
            "Preferred ONNX Runtime execution providers, highest priority first. "
            "Leave empty to defer to onnxruntime defaults."
        ),
    )
    ort_intra_op_num_threads: int | None = Field(
        default=None,
        ge=1,
        description="Override for ONNX Runtime intra-op thread pool size.",
    )
    ort_inter_op_num_threads: int | None = Field(
        default=None,
        ge=1,
        description="Override for ONNX Runtime inter-op thread pool size.",
    )
    ort_graph_optimization_level: str | None = Field(
        default=None,
        description="Graph optimisation level: DISABLE, BASIC, EXTENDED, or ALL.",
    )
    ort_execution_mode: str | None = Field(
        default=None,
        description="Execution mode: SEQUENTIAL or PARALLEL.",
    )
    ort_enable_mem_pattern: bool | None = Field(
        default=None,
        description=(
            "Explicitly enable or disable ONNX Runtime memory pattern optimisations."
        ),
    )
    session_pool_size: int = Field(
        default=1,
        ge=1,
        alias="KOKORO_SESSION_POOL_SIZE",
        description=(
            "Number of Kokoro inference sessions to keep pooled for concurrent "
            "requests."
        ),
    )

    @field_validator("model_path", "voices_path", mode="after")
    @classmethod
    def _expand_paths(cls, value: Path) -> Path:
        return value.expanduser().resolve()

    @field_validator("api_keys", mode="after")
    @classmethod
    def _strip_keys(cls, value: Iterable[str]) -> tuple[str, ...]:
        keys = tuple(key.strip() for key in value if key.strip())
        if not keys:
            message = "At least one API key must be configured."
            raise ValueError(message)
        return keys

    @model_validator(mode="after")
    def _validate_paths(self) -> Settings:
        for attr in ("model_path", "voices_path"):
            path = getattr(self, attr)
            if not path.exists():
                message = f"{attr} does not exist: {path}"
                raise FileNotFoundError(message)
        if self.default_voice_id not in SUPPORTED_VOICES:
            allowed = ", ".join(SUPPORTED_VOICES)
            message = f"DEFAULT_VOICE_ID must be one of {allowed}"
            raise ValueError(message)
        if self.ort_graph_optimization_level is not None:
            self.ort_graph_optimization_level = _normalize_graph_level(
                self.ort_graph_optimization_level,
            )
        if self.ort_execution_mode is not None:
            self.ort_execution_mode = _normalize_execution_mode(self.ort_execution_mode)
        if self.ort_providers:
            self.ort_providers = _normalise_providers(self.ort_providers)
        return self


def load_settings(
    env: Mapping[str, str] | None = None,
    env_file: str | os.PathLike[str] | None = None,
) -> Settings:
    """Load Settings from the environment (and optional `.env` file).

    Args:
        env: Optional mapping overriding os.environ (useful for tests).
        env_file: Explicit path to a dotenv-style file. Defaults to `.env`
            in the current working directory when present.

    Returns:
        An instance of Settings.

    Raises:
        ValidationError: when mandatory values are missing or invalid.

    """
    env_mapping = _merge_env_sources(env, env_file)
    parameters = _build_settings_parameters(env_mapping)
    return Settings(**parameters)


def _merge_env_sources(
    env: Mapping[str, str] | None,
    env_file: str | os.PathLike[str] | None,
) -> dict[str, str]:
    merged = dict(_load_env_file(env_file))
    source_env = dict(os.environ) if env is None else dict(env)
    merged.update(source_env)
    return merged


def _build_settings_parameters(env_mapping: Mapping[str, str]) -> dict[str, Any]:
    parameters: dict[str, Any] = {
        "model_path": _require(
            "KOKORO_MODEL_PATH",
            env_mapping.get("KOKORO_MODEL_PATH"),
        ),
        "voices_path": _require(
            "KOKORO_VOICES_PATH",
            env_mapping.get("KOKORO_VOICES_PATH"),
        ),
        "api_keys": tuple(_collect_api_keys(env_mapping)),
    }

    _set_optional(
        parameters,
        env_mapping,
        env_key="CHUNK_LENGTH_SCHEDULE",
        parameter_key="chunk_length_schedule",
        transform=_parse_chunk_schedule,
    )
    _set_optional(
        parameters,
        env_mapping,
        env_key="DEFAULT_VOICE_ID",
        parameter_key="default_voice_id",
        transform=lambda value: value.strip(),
    )
    _set_optional(
        parameters,
        env_mapping,
        env_key="SERVER_HOST",
        parameter_key="server_host",
        transform=lambda value: value.strip(),
    )
    _set_optional(
        parameters,
        env_mapping,
        env_key="SERVER_PORT",
        parameter_key="server_port",
        transform=int,
    )
    _set_optional(
        parameters,
        env_mapping,
        env_key="LOG_LEVEL",
        parameter_key="log_level",
        transform=lambda value: value.strip().lower(),
    )
    _set_optional(
        parameters,
        env_mapping,
        env_key="INACTIVITY_TIMEOUT",
        parameter_key="inactivity_timeout",
        transform=int,
    )
    _set_optional(
        parameters,
        env_mapping,
        env_key="ORT_PROVIDERS",
        parameter_key="ort_providers",
        transform=lambda raw: tuple(_parse_providers(raw)),
    )
    _set_optional(
        parameters,
        env_mapping,
        env_key="ORT_INTRA_OP_NUM_THREADS",
        parameter_key="ort_intra_op_num_threads",
        transform=int,
    )
    _set_optional(
        parameters,
        env_mapping,
        env_key="ORT_INTER_OP_NUM_THREADS",
        parameter_key="ort_inter_op_num_threads",
        transform=int,
    )
    _set_optional(
        parameters,
        env_mapping,
        env_key="ORT_GRAPH_OPTIMIZATION_LEVEL",
        parameter_key="ort_graph_optimization_level",
        transform=lambda value: value.strip(),
    )
    _set_optional(
        parameters,
        env_mapping,
        env_key="ORT_EXECUTION_MODE",
        parameter_key="ort_execution_mode",
        transform=lambda value: value.strip(),
    )
    _set_optional(
        parameters,
        env_mapping,
        env_key="ORT_ENABLE_MEM_PATTERN",
        parameter_key="ort_enable_mem_pattern",
        transform=_parse_bool,
    )
    _set_optional(
        parameters,
        env_mapping,
        env_key="KOKORO_SESSION_POOL_SIZE",
        parameter_key="session_pool_size",
        transform=int,
    )
    return parameters


def _set_optional(
    parameters: dict[str, Any],
    env_mapping: Mapping[str, str],
    *,
    env_key: str,
    parameter_key: str,
    transform: Callable[[str], Any],
) -> None:
    value = env_mapping.get(env_key)
    if not value:
        return
    parameters[parameter_key] = transform(value)


def _load_env_file(env_file: str | os.PathLike[str] | None) -> dict[str, str]:
    """Parse a dotenv-style file into a mapping."""
    if env_file is None:
        candidate = Path.cwd() / ".env"
        if not candidate.exists():
            return {}
        env_path = candidate
    else:
        env_path = Path(env_file)
        if not env_path.exists():
            return {}

    result: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        result[key.strip()] = _unquote(value.strip())
    return result


def _collect_api_keys(env: Mapping[str, str]) -> list[str]:
    keys: list[str] = []

    inline = env.get("API_KEYS")
    if inline:
        keys.extend(part.strip() for part in inline.split(","))

    file_path = env.get("API_KEYS_FILE")
    if file_path:
        path = Path(file_path).expanduser().resolve()
        if not path.exists():
            message = f"API_KEYS_FILE does not exist: {path}"
            raise FileNotFoundError(message)
        keys.extend(
            line.strip()
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.strip().startswith("#")
        )
    return [key for key in keys if key]


def _parse_chunk_schedule(raw: str) -> tuple[int, ...]:
    try:
        parts = [int(value.strip()) for value in raw.split(",") if value.strip()]
    except ValueError as exc:
        message = "CHUNK_LENGTH_SCHEDULE must be a comma separated list of integers."
        raise ValueError(message) from exc
    if not parts:
        message = "CHUNK_LENGTH_SCHEDULE must contain at least one integer."
        raise ValueError(message)
    if not all(50 <= value <= 500 for value in parts):
        message = "Each chunk length must be between 50 and 500 characters."
        raise ValueError(message)
    return tuple(parts)


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def _require(key: str, value: str | None) -> str:
    if not value:
        message = f"{key} is required."
        raise ValueError(message)
    return value


def _parse_providers(raw: str) -> list[str]:
    providers = [piece.strip() for piece in raw.split(",") if piece.strip()]
    if not providers:
        message = "ORT_PROVIDERS must contain at least one provider name."
        raise ValueError(message)
    return providers


def _parse_bool(raw: str) -> bool:
    truthy = {"1", "true", "yes", "y", "on"}
    falsy = {"0", "false", "no", "n", "off"}
    value = raw.strip().lower()
    if value in truthy:
        return True
    if value in falsy:
        return False
    message = f"Could not parse boolean value from {raw!r}."
    raise ValueError(message)


def _normalize_graph_level(raw: str) -> str:
    lookup = {
        "disable": "DISABLE",
        "disabled": "DISABLE",
        "basic": "BASIC",
        "extended": "EXTENDED",
        "all": "ALL",
        "enable_all": "ALL",
    }
    key = raw.strip().lower()
    if key not in lookup:
        message = (
            "ORT_GRAPH_OPTIMIZATION_LEVEL must be one of DISABLE, BASIC, EXTENDED, ALL."
        )
        raise ValueError(message)
    return lookup[key]


def _normalize_execution_mode(raw: str) -> str:
    lookup = {
        "sequential": "SEQUENTIAL",
        "ort_sequential": "SEQUENTIAL",
        "parallel": "PARALLEL",
        "ort_parallel": "PARALLEL",
    }
    key = raw.strip().lower()
    if key not in lookup:
        message = "ORT_EXECUTION_MODE must be SEQUENTIAL or PARALLEL."
        raise ValueError(message)
    return lookup[key]


def _normalise_providers(providers: Sequence[str]) -> tuple[str, ...]:
    normalised = tuple(provider.strip() for provider in providers if provider.strip())
    if not normalised:
        message = "ORT_PROVIDERS must contain at least one provider name."
        raise ValueError(message)
    return normalised
