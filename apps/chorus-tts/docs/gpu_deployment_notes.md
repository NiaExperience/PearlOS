# GPU Deployment Notes

Guidelines for running the Chorus TTS websocket server on GPU-backed hosts while keeping latency and concurrency in check.

## 1. Install GPU Runtime
- Ensure the host has the appropriate driver/toolkit (e.g., CUDA ≥ 12.x for NVIDIA, ROCm for AMD).
- Install the GPU dependency group, which bundles `onnxruntime-gpu` plus NVIDIA's CUDA runtime, cuBLAS, cuDNN, cuRAND, and cuFFT wheels:
  ```bash
  uv sync --extra gpu
  ```
- Verify GPU providers:
  ```bash
  uv run --no-sync python - <<'PY'
import onnxruntime as ort

print(ort.get_available_providers())  # should include 'CUDAExecutionProvider'
PY
  ```

## 2. Configure the Engine
- Prefer the GPU by exporting ONNX Runtime environment variables (only set the ones you need):
  ```bash
  export ORT_PROVIDERS="CUDAExecutionProvider,CPUExecutionProvider"
  export ORT_ENABLE_MEM_PATTERN=1
  export ORT_GRAPH_OPTIMIZATION_LEVEL=ALL
  export ORT_EXECUTION_MODE=SEQUENTIAL
  export ORT_INTRA_OP_NUM_THREADS=1
  export ORT_INTER_OP_NUM_THREADS=1
  ```
- The server picks these up via `Settings` and builds a custom `InferenceSession`, falling back to the standard Kokoro defaults when unset.
- Leverage the existing warmup hook so the first real request doesn’t pay the CUDA initialization cost. Consider warming multiple short sentences if you care about additional kernels.

## 3. Library Path Management
- Populate `LD_LIBRARY_PATH` from the virtual environment so ONNX Runtime can discover the CUDA shared libraries provided by the wheels:
  ```bash
  export LD_LIBRARY_PATH="$(uv run --no-sync python - <<'PY'
import sys
from pathlib import Path

prefix = Path(sys.prefix) / f"lib/python{sys.version_info.major}.{sys.version_info.minor}/site-packages"
paths = [
    prefix / "nvidia" / "cuda_runtime" / "lib",
    prefix / "nvidia" / "cuda_runtime" / "lib64",
    prefix / "nvidia" / "cublas" / "lib",
    prefix / "nvidia" / "cublas" / "lib64",
    prefix / "nvidia" / "cudnn" / "lib",
    prefix / "nvidia" / "cudnn" / "lib64",
    prefix / "nvidia" / "curand" / "lib",
    prefix / "nvidia" / "curand" / "lib64",
    prefix / "nvidia" / "cufft" / "lib",
    prefix / "nvidia" / "cufft" / "lib64",
    prefix / "onnxruntime" / "capi",
]
print(":".join(str(path) for path in paths if path.exists()), end="")
PY
)":${LD_LIBRARY_PATH:-}"
  ```
- Container builds that rely on the provided Dockerfile run a similar discovery step automatically, so no additional configuration is required inside the image.

## 4. Session Optimizations
- Supply custom `SessionOptions` to reduce CPU contention:
  ```python
  opts = ort.SessionOptions()
  opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
  opts.enable_mem_pattern = True
  opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
  opts.intra_op_num_threads = opts.inter_op_num_threads = 1
  ```
- Build a pool of `InferenceSession` instances when you expect concurrent users; lease sessions via an async queue so each request has its own CUDA stream.

## 5. Chunking & Queuing
- Keep request chunks small (sentence/comma flushing already helps). Large single calls still lead to high TTFB even on GPU.
- If requests arrive faster than the GPU can process them, add an async queue for Kokoro synthesis workers; adjust queue depth to avoid overwhelming GPU memory.

## 6. Host–Device Efficiency
- Reuse inputs when possible. If you see large tensors being reallocated per call, look into ONNX Runtime I/O binding to keep buffers on device.
- Offload phonemization or cache results so CPU preprocessing doesn’t become the new bottleneck once inference speeds up.

## 7. Monitoring & Profiling
- Track TTFB, chunk timing, session queue length, and GPU util (`nvidia-smi`, NVML) to spot bottlenecks.
- ONNX Runtime profiling (`session.enable_profiling=True`) can highlight expensive kernels if needed.

## 8. Operational Considerations
- Ensure GPU drivers are initialized before the service starts; otherwise the warmup will fail and the engine may fall back to CPU.
- Document GPU-specific env vars (`CUDA_VISIBLE_DEVICES`, `ORT_DUMP_GRAPH`) for operators.
- Validate container images include the CUDA runtime and necessary libraries if you ship Docker builds.
