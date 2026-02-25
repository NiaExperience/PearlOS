# Locust Load Test Plan

## Objectives
- Measure end-to-end latency (first audio chunk/TTFB and total stream duration) while exercising concurrent websocket synthesis sessions.
- Determine the concurrency ceiling that maintains acceptable latency and observe when GPU saturation or queueing occurs.
- Capture supporting telemetry (GPU/CPU/memory) during load to correlate resource usage with latency changes.

## Prerequisites
- Chorus TTS server running with GPU execution enabled (`CUDAExecutionProvider`, cuDNN/ CUDA libraries on the path).
- Sample prompt corpus covering short, medium, and long texts.
- Python environment with `locust`, `websockets`, `numpy`, and optional telemetry helpers (`pynvml`, `psutil`).

## Repository Artifacts
- `loadtest/locustfile.py` – Locust entry point implementing the websocket user flow.
- `loadtest/prompts.txt` – Default prompt corpus; override via `KOKORO_LOADTEST_PROMPTS`.
- Optional extra dependencies: `uv sync --extra load` installs Locust and related tooling.
- Telemetry helpers remain manual (e.g., `nvidia-smi dmon`); add scripts here as follow-up if automation is needed.
- Configure `KOKORO_SESSION_POOL_SIZE` to prebuild enough inference sessions before running sustained load.

## Harness Design
- Implement a `WebsocketUser`:
  - Connect to `/v1/text-to-speech/{voice_id}/stream-input`.
  - Send the blank initialization payload, stream sentence chunks (mirroring `scripts/ws_e2e_client.py`), and close with an empty text payload.
  - Record timestamps for connect, first `audioOutput`, all chunk deliveries, and `finalOutput`.
  - Emit custom metrics through `self.environment.events.request.fire`.
- Support configuration for voice ID, payload text, chunking strategy, and optional speed/language settings.
- Allow users to send one prompt per session or loop through a prompt set for longer scenarios.

## Load Profiles
- **Baseline:** Ramp 1→10 concurrent users with short prompts; hold each plateau to observe steady-state latency.
- **Stress:** Increase concurrency (e.g., 20–40 users) using medium-length prompts to detect GPU saturation or queue buildup.
- **Spike:** Instant burst (0→N users) to gauge warmup behavior and resilience to sudden load.

## Telemetry & Metrics
- Locust built-ins: request rate, median/p95 latency, failures.
- Custom events:
  - TTFB (time to first `audioOutput` chunk).
  - Total stream duration per session.
  - Bytes streamed / chunk count.
- External telemetry:
  - GPU util and memory via `nvidia-smi dmon` or a `pynvml` poller.
  - CPU/memory via `psutil` or container metrics when available.
  - Server logs for warnings/errors (e.g., CUDA fallbacks or queue notices).

## Execution Workflow
1. Launch the Chorus TTS server with GPU settings (document env vars for repeatability).
2. Start telemetry collectors (NVML poller, CPU monitor).
3. Run Locust headless with desired user count, spawn rate, runtime, and prompt configuration, e.g.:
   ```bash
   locust -f loadtest/locustfile.py --headless -u 10 -r 2 -t 10m --host ws://localhost:8000
   ```
4. Repeat runs for each load profile; optionally leverage the Locust UI for ad-hoc tuning.
5. Archive Locust CSV summaries, telemetry logs, and server logs after each scenario.

## Reporting
- Plot TTFB and total duration versus concurrent users to identify inflection points.
- Correlate latency changes with GPU/CPU utilization spikes.
- Document failure modes (timeouts, websocket errors) and recommended mitigations.
- Summarize recommended concurrency limits and configuration tweaks (chunk schedule, session pooling, warmup strategy).

## Next Steps
- Scaffold `loadtest/locustfile.py` and helper config files.
- Add a telemetry utility (NVML poller or shell script) to gather GPU stats during tests.
- Integrate run instructions into documentation/CI so operators can reproduce the load tests. 
