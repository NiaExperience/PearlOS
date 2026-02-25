# GPU Concurrency Upgrade Plan

Plan to introduce inference-session pooling and CUDA stream management so the Chorus TTS server can sustain higher concurrent websocket sessions on a single GPU while keeping latency low.

## Objectives
- Remove serialized access to a single `onnxruntime.InferenceSession`.
- Enable overlapping CUDA kernels across requests.
- Maintain or improve TTFB and total latency under high concurrency.

## Phase 1 – Session Pooling
1. **Design**
   - Create a pool manager (async-safe) that pre-creates *N* `onnxruntime.InferenceSession` instances.
   - Define heuristics for pool size (GPU memory, target concurrency).
   - Ensure pooled sessions carry pre-loaded resources (voices, vocab).
2. **Implementation**
   - Extend `KokoroEngine` to lease sessions from the pool instead of maintaining a single instance.
   - Provide async acquire/release semantics (`asyncio.Queue` or context manager) so each request gets a dedicated session.
3. **Warmup**
   - Run short warmup phrases through every pooled session at startup to compile kernels and load weights onto the GPU.
4. **Fallback & Metrics**
   - Decide behavior when the pool is exhausted (queue, reject, or spin up temp sessions).
   - Emit telemetry: current pool use, wait durations, pool exhaustion count.

## Phase 2 – CUDA Stream Management
1. **Research**
   - Identify ONNX Runtime hooks for binding custom CUDA streams (`OrtCUDAProviderOptions`, I/O binding).
   - Determine whether streams must be assigned at session creation or per inference run.
2. **Implementation**
   - Introduce a CUDA stream pool and bind a stream when leasing a session.
   - Use I/O binding to keep inputs/outputs on device and associate them with the acquired stream.
   - Ensure synchronization on release (`cudaStreamSynchronize`) to avoid cross-request contamination.
3. **Warmup & Compatibility**
   - Update warmup routine to exercise each stream.
   - Validate behavior both with and without pooling (feature flag or configuration switch).

## Phase 3 – Testing & Tuning
1. **Automated Tests**
   - Add unit tests covering pool acquisition/release, exhaustion handling, and error paths.
   - Mock ONNX Runtime objects to verify stream assignment logic.
2. **Load Testing**
   - Use the Locust harness to compare pre/post latency and throughput (TTFB, total duration).
   - Collect GPU telemetry (utilisation, SM occupancy, memory) to confirm increased parallelism.
3. **Tuning**
   - Experiment with pool size vs. stream count to find sweet spots for a 5090.
   - Adjust ONNX Runtime threading options, chunk schedule, and batching thresholds based on results.

## Documentation & Rollout
- Document new configuration knobs (pool size, stream count, warmup options) in README/docs.
- Offer operational guidance (monitoring metrics, recommended defaults per GPU class).
- Stage rollout with toggles or environment flags for safe experimentation in production.
