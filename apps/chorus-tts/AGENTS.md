# Repository Guidelines

## Project Structure & Module Organization
The repository is deliberately small: `main.py` is the executable entry point, `pyproject.toml` declares metadata and runtime dependencies, and `uv.lock` pins the exact resolution produced by the `uv` tool. As functionality grows, place importable code under a `chorus_tts/` package whose submodules group related features, and mirror that layout inside `tests/` for unit coverage. Keep generated assets (models, prompts, fixtures) out of source control unless they are lightweight and reproducible; stash larger artifacts under `assets/` and document how to rebuild them.

## Build, Test, and Development Commands
Install dependencies with `uv sync` (or `uv sync --extra dev` when you need optional tooling). Run the service locally with `uv run python main.py`; add flags within `main()` so they can be passed through that command. Use `uv run python -m pip install -e .` when you need an editable install in another environment. Execute automated checks with `uv run --extra dev pytest`, and prefer `uv run --extra dev pytest -k <pattern>` for focused runs. The websocket endpoint is available at `ws://<host>:<port>/v1/text-to-speech/{voice_id}/stream-input` while the server is running; clients must include an `xi-api-key` header matching the configured API keys. As milestones land, introduce service entry points inside `chorus_tts/` and keep `main.py` limited to wiring and configuration bootstrap.

Before committing, run:

- `uv run ruff check .`
- `uv run mypy .`
- `PYTHONPATH=. uv run --extra dev pytest`
- `PYTHONPATH=. uv run --extra dev pytest --cov=chorus_tts --cov-report=term-missing`

The `dev` extra contains `httpx`, `pytest-asyncio`, `pytest-cov`, etc.; remember to include `--extra dev` when invoking tools that rely on them.

## Configuration & Secrets
Provide runtime settings through environment variables or a `.env` file read at startup. Required keys: `KOKORO_MODEL_PATH`, `KOKORO_VOICES_PATH`, and either `API_KEYS` (comma-separated) or `API_KEYS_FILE` (one key per line). Optional overrides include `SERVER_HOST`, `SERVER_PORT`, `LOG_LEVEL`, `INACTIVITY_TIMEOUT`, `CHUNK_LENGTH_SCHEDULE`, and `DEFAULT_VOICE_ID` (must be one of the documented Kokoro voices such as `af_alloy`). Treat API keys like ElevenLabs’ `xi-api-key`: never commit them, and prefer storing them in a local `.env` that is `.gitignore`d. Only PCM 22050 output is currently supported; websocket clients should request that format in their handshake. Large artifacts (voices/model blobs) should live outside the repo; document their filesystem locations in the PRD or README.

## Coding Style & Naming Conventions
Target Python 3.10+ and follow PEP 8 defaults: four-space indentation, 88-character lines, and snake_case for modules, functions, and variables. Classes use PascalCase, and constants stay UPPER_SNAKE_CASE. Annotate public functions and methods with type hints and add concise docstrings that describe side effects. Add a `[project.optional-dependencies.dev]` table for tools such as `ruff` and format with `uv run ruff format .` followed by `uv run ruff check .` before pushing.

## Testing Guidelines
Tests belong in `tests/` and should mirror the package tree (`tests/test_module.py` exercises `chorus_tts/module.py`). Name tests descriptively (`test_generates_session_id`) and use pytest fixtures for setup over ad-hoc helpers. Aim for coverage on new logic and any regression paths touched by a change; add regression tests before fixing bugs. Run `uv run pytest --maxfail=1 --disable-warnings -q` in CI scripts to surface failures quickly.
- New code should maintain **very high coverage (≈95%+)**. If coverage drops, add tests or refactor so the new paths are exercised before committing.
- Prefer exercising public interfaces in tests; avoid reaching into private helpers (`_method`) unless there is no public path that covers the scenario.

## Commit & Pull Request Guidelines
There is no historical precedent yet, so adopt Conventional Commits (`feat:`, `fix:`, `chore:`, etc.) with scopes that match the affected module (`feat(main): add streaming response`). Keep commits focused and ensure `uv.lock` is updated when dependencies change. PRs must include a short problem statement, the solution summary, test evidence (command output or screenshots), and any follow-up tasks. Cross-link issues with `Fixes #<id>` when applicable and request review once CI passes.

## Agent Workflow
- Commit newly implemented features rather than leaving them uncommitted.
- Do not amend existing commits; add follow-up commits instead.
- Ask the user to review changes before creating commits.
