# syntax=docker/dockerfile:1.7
ARG CUDA_IMAGE_TAG=12.8.0-cudnn-runtime-ubuntu22.04
ARG KOKORO_MODEL_URL=https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx
ARG KOKORO_VOICES_URL=https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin

FROM nvidia/cuda:${CUDA_IMAGE_TAG} AS runtime
ARG KOKORO_MODEL_URL
ARG KOKORO_VOICES_URL
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_CACHE_DIR=/root/.cache/uv \
    VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:/root/.local/bin:${PATH}" \
    KOKORO_MODEL_PATH=/app/assets/kokoro-v1.0.onnx \
    KOKORO_VOICES_PATH=/app/assets/voices-v1.0.bin \
    LD_LIBRARY_PATH="/usr/local/cuda/lib64:${LD_LIBRARY_PATH}"

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    python3 \
    python3-venv \
    python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv "${VIRTUAL_ENV}"

RUN "${VIRTUAL_ENV}"/bin/pip install --no-cache-dir uv

WORKDIR /app

COPY pyproject.toml uv.lock README.md ./

ARG USE_GPU=true

RUN --mount=type=cache,target=/root/.cache/uv \
    if [ "$USE_GPU" = "true" ]; then \
        uv sync --extra gpu --frozen --no-install-project; \
    else \
        uv sync --frozen --no-install-project; \
    fi

COPY chorus_tts ./chorus_tts
COPY main.py ./
COPY scripts ./scripts

RUN --mount=type=cache,target=/root/.cache/uv \
    if [ "$USE_GPU" = "true" ]; then \
        uv sync --extra gpu --frozen \
        && GPU_VERSION="$("${VIRTUAL_ENV}"/bin/python -c "import importlib.metadata; print(importlib.metadata.version('onnxruntime-gpu'))")" \
        && uv pip install --python "${VIRTUAL_ENV}"/bin/python --no-deps --force-reinstall "onnxruntime-gpu==${GPU_VERSION}"; \
    else \
        uv sync --frozen; \
    fi

RUN python - <<'PY'
import os
from pathlib import Path

venv = Path(os.environ["VIRTUAL_ENV"])
site_packages_dirs = sorted((venv / "lib").glob("python*/site-packages"))
if not site_packages_dirs:
    raise RuntimeError("Could not locate site-packages inside the virtual environment.")
site_packages = site_packages_dirs[0]
nvidia_root = site_packages / "nvidia"
onnxruntime_root = site_packages / "onnxruntime"
lib_dirs = set()

if nvidia_root.exists():
    for path in nvidia_root.rglob("*"):
        if path.is_dir() and path.name in {"lib", "lib64"}:
            lib_dirs.add(str(path))

if onnxruntime_root.exists():
    for so_file in onnxruntime_root.rglob("*.so*"):
        lib_dirs.add(str(so_file.parent))

if lib_dirs:
    conf_path = Path("/etc/ld.so.conf.d/nvidia-venv.conf")
    conf_path.write_text("\n".join(sorted(lib_dirs)) + "\n")
PY

RUN ldconfig

RUN mkdir -p /app/assets \
    && curl -L --retry 3 --fail --output "${KOKORO_VOICES_PATH}" "${KOKORO_VOICES_URL}" \
    && curl -L --retry 3 --fail --output "${KOKORO_MODEL_PATH}" "${KOKORO_MODEL_URL}"

EXPOSE 8000
ENV SERVER_HOST=0.0.0.0 \
    SERVER_PORT=8000

CMD ["uvicorn", "main:build_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
