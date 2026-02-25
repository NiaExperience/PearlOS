"""Unit tests for configuration loading utilities."""

from __future__ import annotations

from pathlib import Path

import pytest
from chorus_tts.config import Settings, load_settings


def create_fake_assets(tmp_path: Path) -> tuple[Path, Path]:
    """Create minimal Kokoro model and voice files for tests."""
    model = tmp_path / "model.onnx"
    voices = tmp_path / "voices.npy"
    model.write_bytes(b"onnx")
    voices.write_bytes(b"voices")
    return model, voices


def test_load_settings_from_env(tmp_path: Path) -> None:
    """Load settings directly from an environment mapping."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "key-one,key-two",
        "CHUNK_LENGTH_SCHEDULE": "90, 140, 200",
        "DEFAULT_VOICE_ID": "af_sarah",
        "SERVER_HOST": "127.0.0.1",
        "SERVER_PORT": "9000",
        "LOG_LEVEL": "DEBUG",
        "INACTIVITY_TIMEOUT": "60",
        "KOKORO_SESSION_POOL_SIZE": "4",
    }

    settings = load_settings(env=env)

    assert settings.model_path == model.resolve()
    assert settings.voices_path == voices.resolve()
    assert settings.api_keys == ("key-one", "key-two")
    assert settings.chunk_length_schedule == (90, 140, 200)
    assert settings.default_voice_id == "af_sarah"
    assert settings.server_host == "127.0.0.1"
    assert settings.server_port == 9000
    assert settings.log_level == "debug"
    assert settings.inactivity_timeout == 60
    assert settings.session_pool_size == 4


def test_load_settings_reads_env_file(tmp_path: Path) -> None:
    """Read configuration values from a dotenv file."""
    model, voices = create_fake_assets(tmp_path)
    env_file = tmp_path / ".env"
    env_file.write_text(
        f"KOKORO_MODEL_PATH={model}\n"
        f"KOKORO_VOICES_PATH={voices}\n"
        "API_KEYS=in-file-key\n",
        encoding="utf-8",
    )

    settings = load_settings(env={}, env_file=env_file)
    assert settings.api_keys == ("in-file-key",)


def test_load_settings_combines_api_key_sources(tmp_path: Path) -> None:
    """Merge API keys provided via env var and file."""
    model, voices = create_fake_assets(tmp_path)
    key_file = tmp_path / "keys.txt"
    key_file.write_text("file-key\n", encoding="utf-8")

    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "env-key",
        "API_KEYS_FILE": str(key_file),
    }

    settings = load_settings(env=env)
    assert settings.api_keys == ("env-key", "file-key")


def test_load_settings_requires_api_keys(tmp_path: Path) -> None:
    """Require at least one API key to be configured."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
    }

    with pytest.raises(ValueError, match="At least one API key must be configured"):
        load_settings(env=env)


def test_chunk_length_schedule_validation(tmp_path: Path) -> None:
    """Validate that chunk length schedule respects minimum values."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "valid",
        "CHUNK_LENGTH_SCHEDULE": "40",  # below minimum allowed
    }

    with pytest.raises(
        ValueError,
        match="Each chunk length must be between 50 and 500 characters",
    ):
        load_settings(env=env)


def test_load_settings_missing_assets(tmp_path: Path) -> None:
    """Raise when required asset files are missing."""
    model = tmp_path / "missing.onnx"
    voices = tmp_path / "missing.npy"
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "test",
    }

    with pytest.raises(FileNotFoundError):
        load_settings(env=env)


def test_load_settings_unknown_default_voice(tmp_path: Path) -> None:
    """Reject default voices not present in the registry."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "test",
        "DEFAULT_VOICE_ID": "does_not_exist",
    }

    with pytest.raises(ValueError, match="DEFAULT_VOICE_ID must be one of"):
        load_settings(env=env)


def test_load_settings_thread_counts(tmp_path: Path) -> None:
    """Parse ONNX Runtime thread counts from environment values."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "test",
        "ORT_INTRA_OP_NUM_THREADS": "3",
        "ORT_INTER_OP_NUM_THREADS": "2",
        "KOKORO_SESSION_POOL_SIZE": "5",
    }

    settings = load_settings(env=env)
    assert settings.ort_intra_op_num_threads == 3
    assert settings.ort_inter_op_num_threads == 2
    assert settings.session_pool_size == 5


def test_load_settings_normalizes_execution_mode(tmp_path: Path) -> None:
    """Normalise execution mode casing."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "test",
        "ORT_EXECUTION_MODE": "parallel",
    }

    settings = load_settings(env=env)
    assert settings.ort_execution_mode == "PARALLEL"


def test_load_settings_invalid_execution_mode(tmp_path: Path) -> None:
    """Reject unsupported execution mode values."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "test",
        "ORT_EXECUTION_MODE": "invalid-mode",
    }

    with pytest.raises(
        ValueError,
        match="ORT_EXECUTION_MODE must be SEQUENTIAL or PARALLEL",
    ):
        load_settings(env=env)


def test_load_settings_missing_key_file(tmp_path: Path) -> None:
    """Raise when referenced API key file is absent."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS_FILE": str(tmp_path / "missing.txt"),
    }

    with pytest.raises(FileNotFoundError):
        load_settings(env=env)


def test_load_settings_missing_env_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ignore missing env files and rely on provided env mapping."""
    model, voices = create_fake_assets(tmp_path)
    missing_env = tmp_path / "missing.env"
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "test",
    }

    settings = load_settings(env=env, env_file=missing_env)
    assert settings.api_keys == ("test",)


def test_load_settings_env_file_ignores_comments(tmp_path: Path) -> None:
    """Skip comments and blank lines when parsing dotenv files."""
    model, voices = create_fake_assets(tmp_path)
    env_file = tmp_path / ".env"
    env_file.write_text(
        "# comment line\n"
        "\n"
        f"KOKORO_MODEL_PATH={model}\n"
        f"KOKORO_VOICES_PATH={voices}\n"
        'API_KEYS="quoted"\n',
        encoding="utf-8",
    )

    settings = load_settings(env={}, env_file=env_file)
    assert settings.api_keys == ("quoted",)


def test_parse_chunk_schedule_non_numeric(tmp_path: Path) -> None:
    """Reject schedules containing non-numeric entries."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "test",
        "CHUNK_LENGTH_SCHEDULE": "abc,80",
    }

    with pytest.raises(
        ValueError,
        match="CHUNK_LENGTH_SCHEDULE must be a comma separated",
    ):
        load_settings(env=env)


def test_parse_chunk_schedule_empty_list(tmp_path: Path) -> None:
    """Reject schedules that resolve to an empty list."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "test",
        "CHUNK_LENGTH_SCHEDULE": " , , ",
    }

    with pytest.raises(
        ValueError,
        match="CHUNK_LENGTH_SCHEDULE must contain at least one integer",
    ):
        load_settings(env=env)


def test_require_fields_missing(tmp_path: Path) -> None:
    """Require mandatory settings when loading configuration."""
    voices = tmp_path / "voices.npy"
    voices.write_text("voices")
    env = {
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "test",
    }

    with pytest.raises(ValueError, match="KOKORO_MODEL_PATH is required"):
        load_settings(env=env)


def test_normalise_providers_invalid(tmp_path: Path) -> None:
    """Validate provider names when constructing Settings."""
    model, voices = create_fake_assets(tmp_path)
    with pytest.raises(
        ValueError,
        match="ORT_PROVIDERS must contain at least one provider name",
    ):
        Settings(
            model_path=model,
            voices_path=voices,
            api_keys=("test",),
            ort_providers=(" ",),
        )


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("true", True),
        ("FALSE", False),
        ("Yes", True),
        ("0", False),
    ],
)
def test_bool_parsing(tmp_path: Path, raw: str, expected) -> None:
    """Parse boolean-like strings from environment variables."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "test",
        "ORT_ENABLE_MEM_PATTERN": raw,
    }

    settings = load_settings(env=env)
    assert settings.ort_enable_mem_pattern is expected


def test_bool_parsing_invalid(tmp_path: Path) -> None:
    """Reject values that cannot be interpreted as booleans."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "test",
        "ORT_ENABLE_MEM_PATTERN": "not-a-bool",
    }

    with pytest.raises(
        ValueError,
        match="Could not parse boolean value from 'not-a-bool'",
    ):
        load_settings(env=env)


@pytest.mark.parametrize(
    ("level", "normalized"),
    [
        ("disable", "DISABLE"),
        ("BASIC", "BASIC"),
        ("extended", "EXTENDED"),
        ("ALL", "ALL"),
    ],
)
def test_graph_level_normalization(tmp_path: Path, level: str, normalized: str) -> None:
    """Normalise graph optimisation levels regardless of casing."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "test",
        "ORT_GRAPH_OPTIMIZATION_LEVEL": level,
    }

    settings = load_settings(env=env)
    assert settings.ort_graph_optimization_level == normalized


def test_graph_level_invalid(tmp_path: Path) -> None:
    """Reject invalid graph optimisation level strings."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "test",
        "ORT_GRAPH_OPTIMIZATION_LEVEL": "invalid",
    }

    with pytest.raises(
        ValueError,
        match="ORT_GRAPH_OPTIMIZATION_LEVEL must be one of",
    ):
        load_settings(env=env)


@pytest.mark.parametrize(
    ("providers", "expected"),
    [
        (
            "CUDAExecutionProvider,CPUExecutionProvider",
            ("CUDAExecutionProvider", "CPUExecutionProvider"),
        ),
        ("TRT,  CUDA", ("TRT", "CUDA")),
    ],
)
def test_provider_parsing(
    tmp_path: Path,
    providers: str,
    expected: tuple[str, ...],
) -> None:
    """Parse provider lists into a normalised tuple."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "test",
        "ORT_PROVIDERS": providers,
    }

    settings = load_settings(env=env)
    assert settings.ort_providers == expected


def test_provider_parsing_invalid(tmp_path: Path) -> None:
    """Reject provider entries that contain no identifiers."""
    model, voices = create_fake_assets(tmp_path)
    env = {
        "KOKORO_MODEL_PATH": str(model),
        "KOKORO_VOICES_PATH": str(voices),
        "API_KEYS": "test",
        "ORT_PROVIDERS": ",",
    }

    with pytest.raises(
        ValueError,
        match="ORT_PROVIDERS must contain at least one provider name",
    ):
        load_settings(env=env)
