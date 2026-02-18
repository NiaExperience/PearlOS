from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from dotenv import dotenv_values


PACKAGE_DIR = Path(__file__).resolve().parent
SCRIPT_ROOT = PACKAGE_DIR.parent
REPO_ROOT = SCRIPT_ROOT.parent.parent
DEFAULT_INPUT_DIR = (REPO_ROOT / "daily-recordings" / "transcribe").resolve()
DEFAULT_OUTPUT_DIR = (DEFAULT_INPUT_DIR / "transcripts").resolve()
DEFAULT_ENV_PATH = (REPO_ROOT / "apps" / "pipecat-daily-bot" / ".env").resolve()


@dataclass(frozen=True)
class PathConfig:
    """Filesystem configuration for the transcription run."""

    input_dir: Path = DEFAULT_INPUT_DIR
    output_dir: Path = DEFAULT_OUTPUT_DIR
    env_path: Path = DEFAULT_ENV_PATH


def expand_path(value: str | Path) -> Path:
    """Return an absolute, expanded Path."""
    return Path(value).expanduser().resolve()


def resolve_paths(
    input_dir: str | Path | None,
    output_dir: str | Path | None,
    env_path: str | Path | None,
) -> PathConfig:
    """Build a PathConfig from CLI overrides."""
    resolved_input = expand_path(input_dir) if input_dir else DEFAULT_INPUT_DIR
    resolved_output = expand_path(output_dir) if output_dir else DEFAULT_OUTPUT_DIR
    resolved_env = expand_path(env_path) if env_path else DEFAULT_ENV_PATH
    return PathConfig(
        input_dir=resolved_input,
        output_dir=resolved_output,
        env_path=resolved_env,
    )


def load_api_key(env_path: Path) -> str:
    """Load the Deepgram API key with environment overrides."""
    env_key = os.getenv("DEEPGRAM_API_KEY") or os.getenv("DEEPGRAM_TOKEN")
    if env_key:
        return env_key

    if env_path.exists():
        values = dotenv_values(env_path)
        file_key = values.get("DEEPGRAM_API_KEY") or values.get("DEEPGRAM_TOKEN")
        if file_key:
            return str(file_key)

    raise RuntimeError(
        "Deepgram API key not found. "
        "Set DEEPGRAM_API_KEY or add it to apps/pipecat-daily-bot/.env."
    )


def ensure_output_dir(path: Path) -> None:
    """Create the output directory tree if it does not already exist."""
    path.mkdir(parents=True, exist_ok=True)
