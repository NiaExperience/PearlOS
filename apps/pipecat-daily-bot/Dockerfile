# Pipecat Daily Bot Dockerfile
# Multi-stage to install Python deps via Poetry with caching

FROM python:3.11-slim AS base
ENV POETRY_VERSION=2.1.4 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    POETRY_VIRTUALENVS_IN_PROJECT=1

WORKDIR /app

# System build deps (removed later) and curl for Poetry install
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl git procps && rm -rf /var/lib/apt/lists/*

# Install Poetry
RUN curl -sSL https://install.python-poetry.org | python3 - && \
    ln -s $HOME/.local/bin/poetry /usr/local/bin/poetry

# Copy dependency files first for layer caching while preserving monorepo relative path depth
COPY apps/pipecat-daily-bot/bot/pyproject.toml apps/pipecat-daily-bot/bot/poetry.lock ./apps/pipecat-daily-bot/bot/
# Copy the codegen (events and features python packages) so the editable path dependency resolves
COPY packages/events/python ./packages/events/python
COPY packages/features/python ./packages/features/python

# Move into bot working directory matching original repo layout so ../../../ path works
WORKDIR /app/apps/pipecat-daily-bot/bot

# Install only main (runtime) dependencies into an in-project virtualenv (.venv)
RUN poetry install --no-root --only main --no-interaction

# Patch setuptools' vendored jaraco.context metadata/code with the fixed version
# (scanner flags setuptools/_vendor/jaraco.context-5.3.0.dist-info)
RUN poetry run python - <<'PY'
import shutil
import site
from pathlib import Path
import importlib.metadata

import jaraco.context as jaraco_context

site_packages = Path(site.getsitepackages()[0]).resolve()
vendor_dir = site_packages / "setuptools" / "_vendor"

if not vendor_dir.exists():
    raise SystemExit("setuptools vendor dir not found: %s" % (vendor_dir,))

src_path = Path(jaraco_context.__file__).resolve()
try:
    rel_path = src_path.relative_to(site_packages)
except ValueError:
    raise SystemExit("jaraco.context not in site-packages: %s" % (src_path,))

dst_path = (vendor_dir / rel_path).resolve()
if src_path.name == "__init__.py":
    src_dir = src_path.parent
    dst_dir = vendor_dir / src_dir.relative_to(site_packages)
    if dst_dir.exists():
        shutil.rmtree(dst_dir)
    shutil.copytree(src_dir, dst_dir)
else:
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src_path, dst_path)

# Find dist-info (handle name normalization like jaraco_context)
src_dist_infos = sorted(site_packages.glob("jaraco.context-*.dist-info"))
if not src_dist_infos:
    src_dist_infos = sorted(site_packages.glob("jaraco_context-*.dist-info"))

if not src_dist_infos:
    raise SystemExit("jaraco.context dist-info (normalized or not) not found in: %s" % (site_packages,))

src_dist_info = src_dist_infos[-1]
for existing in vendor_dir.glob("jaraco.context-*.dist-info"):
    shutil.rmtree(existing)

dst_dist_info = vendor_dir / src_dist_info.name
if dst_dist_info.exists():
    shutil.rmtree(dst_dist_info)

shutil.copytree(src_dist_info, dst_dist_info)
print("Patched vendored jaraco.context -> %s" % (src_dist_info.name,))
PY

# Pre-download NLTK data (punkt_tab tokenizer) to avoid runtime download failures
RUN poetry run python -c "import nltk; nltk.download('punkt_tab', quiet=True)"

# Copy bot source code (after deps for better layer caching)
COPY apps/pipecat-daily-bot/bot ./

# Final runtime image (slim)
FROM python:3.11-slim AS runtime
ENV PYTHONUNBUFFERED=1
WORKDIR /app/apps/pipecat-daily-bot/bot

# Install runtime dependencies (libasound2 is required for daily-python audio)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libasound2 \
    && rm -rf /var/lib/apt/lists/* \
    && pip uninstall -y setuptools

# Copy bot project including the in-project virtualenv (.venv) and codegen packages for editable paths
COPY --from=base /app/apps/pipecat-daily-bot/bot /app/apps/pipecat-daily-bot/bot
COPY --from=base /app/packages/events/python /app/packages/events/python
COPY --from=base /app/packages/features/python /app/packages/features/python

# Copy entrypoint script
COPY apps/pipecat-daily-bot/bot/entrypoint.sh /app/apps/pipecat-daily-bot/bot/entrypoint.sh
RUN chmod +x /app/apps/pipecat-daily-bot/bot/entrypoint.sh

# Copy pre-downloaded NLTK data from build stage
COPY --from=base /root/nltk_data /root/nltk_data

# Deterministic venv path (created via POETRY_VIRTUALENVS_IN_PROJECT=1)
ENV PATH="/app/apps/pipecat-daily-bot/bot/.venv/bin:${PATH}"

# Runtime mode selection
# MODE=gateway (default) -> runs the API gateway on 4444
# MODE=operator        -> runs the K8s operator
# MODE=runner          -> runs pipecat runner (daily) on 7860
ARG MODE=gateway
ENV MODE=${MODE}

EXPOSE 4444 7860

ENTRYPOINT ["/app/apps/pipecat-daily-bot/bot/entrypoint.sh"]

