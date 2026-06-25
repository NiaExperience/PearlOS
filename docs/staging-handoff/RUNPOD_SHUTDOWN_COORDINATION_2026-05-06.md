# RunPod Shutdown Coordination - 2026-05-06

This note closes the remaining RunPod-to-DigitalOcean handoff gaps before the RunPod pod is shut down. It intentionally records locations and procedures, not secret values.

## RunPod Resurrection Note

Known current RunPod/container facts:

- Hostname inside pod: `0cb2f894b106`.
- RunPod pod id: `ohcjg7x4hxaxlj`.
- RunPod pod hostname: `ohcjg7x4hxaxlj-64411e49`.
- RunPod volume id: `emc664hyb8`.
- RunPod datacenter: `US-IL-1`.
- RunPod public IP observed from env: `203.57.40.233`.
- RunPod SSH TCP port observed from env: `10229`.
- GPU: `NVIDIA GeForce RTX 4090`.
- GPU count: `1`.
- Memory: `41 GB`.
- CPU count: `21`.
- Network volume mount: `/workspace`.
- Volume mount type observed: `mfs#us-il-1.runpod.net:9421 on /workspace`.
- Primary repo on the volume: `/workspace/nia-universal`.
- User-facing reports/docs: `/workspace/user/Documents`.
- Historical restore clone: `/workspace/nia-universal-restore`.
- Old deploy/runtime target on RunPod: `/opt/pearlos`.
- Startup script: `/workspace/startup.sh`.
- Startup log: `/workspace/startup.log`.

RunPod startup script behavior from `/workspace/startup.sh`:

- Restores OpenClaw config/workspace from `/workspace/openclaw-config-backup` and `/workspace/OpenClaw/workspace`.
- Ensures Node.js 22 and corepack.
- Restores `/root/.local/bin/openclaw` wrapper.
- Installs basic system deps, Python deps, Redis, and Postgres when missing.
- Starts Ollama, PocketTTS, Mesh, PearlOS interface, Cloudflare quick tunnel, Pipecat bot gateway, and OpenClaw watchdog.
- Uses Cloudflare Quick Tunnel for temporary public access when running from RunPod.

Resurrection caveats:

- The exact RunPod template/image name was not available from inside the container. Preserve pod/template metadata in the RunPod dashboard before deleting anything.
- The network volume is the important durable artifact. Shutting down the pod is acceptable if the volume remains attached/preserved.
- Do not assume RunPod `/opt/pearlos` rules apply to DO staging. DO staging source is `/workspace/nia-universal`; deploy/runtime is `/home/deploy/pearlos`.
- If resurrecting RunPod, check `/workspace/startup.sh` before running it. It starts legacy services including Ollama/Comfy-style dependencies that DO staging intentionally avoided.

## Secrets And Runtime Location Map

No secret values are recorded here. These are the authoritative places to inspect when a feature says a key is missing.

DO staging:

- Source tree: `/workspace/nia-universal`.
- Deploy/runtime tree: `/home/deploy/pearlos`.
- Interface root env: `/workspace/nia-universal/.env.local` and `/home/deploy/pearlos/.env.local`.
- Interface app env: `/workspace/nia-universal/apps/interface/.env.local` and `/home/deploy/pearlos/apps/interface/.env.local`.
- Mesh env: `/home/deploy/pearlos/apps/mesh/.env`.
- Pipecat/voice env: `/workspace/nia-universal/apps/pipecat-daily-bot/.env` and `/home/deploy/pearlos/apps/pipecat-daily-bot/.env`.
- Pipecat backup snapshots: `/workspace/nia-universal/apps/pipecat-daily-bot/.env.backup.*` and `/home/deploy/pearlos/apps/pipecat-daily-bot/.env.backup.*`.
- Jupyter token: `/root/.jupyter/pearl-jupyter-token` on DO staging.
- Root Codex instructions: `/root/.codex/instructions.md`.
- Deploy Codex instructions: `/home/deploy/.codex/instructions.md`.

Critical env variable families to verify by location and PM2 runtime env:

- OpenRouter: `OPENROUTER_API_KEY`, `OPENROUTER_ENABLED`, tool model settings.
- DeepSeek: `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `BOT_LLM_MODEL`, `BOT_FAST_MODEL`.
- Daily/Pipecat: `DAILY_API_KEY`, `BOT_GATEWAY_URL`, room prefix, runner/autostart settings.
- Discord: bot token, OAuth client id/secret, callback/redirect URLs.
- Google OAuth: Google client id/secret, NextAuth URL, allowlist/tenant assignment.
- TTS: `BOT_TTS_PROVIDER`, PocketTTS URL/port, Voxtral URL/model/key, Cartesia provider settings if enabled.
- Auth/session/database: `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, database URL, Redis settings, token encryption key.

Operational rule:

- If a key appears present in a file but the feature still says missing, inspect the live PM2 process env and restart the correct process with `--update-env`.
- On DO staging, app services are owned by `deploy`; root PM2 currently owns `pearl-worker` and `pearl-jupyter`.
- A stale Pipecat env reference was observed in a PM2-expanded env value: `PIPECAT_BOT_ENV_PATH=/opt/pearlos/apps/pipecat-daily-bot/.env`. Treat any `/opt/pearlos` reference on DO staging as suspect and verify before relying on it.

## Current DO Staging Status

Verified from DO staging on 2026-05-06:

- Droplet: `pearl-staging-private-omega`.
- Public URL: `https://134-209-76-227.sslip.io/`.
- Branch: `Pearl-Staging-Private-Omega`.
- Current HEAD: `870c2e69`.
- Current tag: `GOLDEN-VOICE-WORKING-20260506`.
- Live health build:
  - Codename: `GOLDEN VOICE WORKING`.
  - Commit: `870c2e69`.
  - Build id: `build-870c2e69-1778086825388`.
  - Build time: `2026-05-06T17:00:23.101Z`.
- Deploy PM2 online services:
  - `interface`
  - `mesh`
  - `pipecat-gateway`
  - `pipecat-runner`
  - `pocket-tts`
  - `bot-queue-worker`
  - `openclaw-gateway`
  - `openclaw-bridge`
  - `pearl-chat-relays-production-repair`
- Root PM2 online services:
  - `pearl-worker`
  - `pearl-jupyter`

## Known-Good Rollback List

Use the most recent known-good first. Older tags are historical references, not first-line rollback targets.

1. Current DO staging known-good:
   - Branch: `Pearl-Staging-Private-Omega`.
   - Commit/tag: `870c2e69` / `GOLDEN-VOICE-WORKING-20260506`.
   - Build: `GOLDEN VOICE WORKING`.
   - Use for voice, webchat, Jupyter, persistent terminal, and current staging continuity.

2. Immediate restoration lineage:
   - `91055c81` / `GOLDEN-RESTORATION-LIVE-20260506`.
   - `a4269424` / `GOLDEN RESTORATION live staging snapshot`.
   - `156955ab` / `GOLDEN RESTORATION source checkpoint`.

3. Recent staging candidates:
   - `afe483df` / `GOLDEN-PEARL-CANDIDATE`.
   - `872820ec` / `GOLDEN MUPPET -- full staging configuration snapshot`.
   - `d222abd9` / `GOLD NUGGET staging voice recovery`.

4. Older historical fallbacks:
   - `GOLD-SILVER-SPRINGS-v3`.
   - `build/HYBRID-2026-04-30`.
   - `RADIANT`.
   - `voice-stable-2026-04-25-v2`.
   - `gold-2026-03-03`.

Rollback discipline:

- Before any branch switch or merge, record `git rev-parse HEAD`, `git status --short`, `curl -k https://134-209-76-227.sslip.io/api/health/build`, PM2 owner/cwd, and env file timestamps.
- Stash or commit local changes before switching branches.
- Rebuild from `/workspace/nia-universal`, copy changed files to `/home/deploy/pearlos`, restart as `deploy`, and verify `/api/health/build`.
- Do not use build name alone as proof. Confirm commit and build id.

## External Dashboard Ownership Notes

Known control surfaces. No credentials are stored here.

- DigitalOcean droplets, managed database, and firewall/DNS-adjacent setup: controlled through the team DigitalOcean account.
- Google OAuth: controlled through Google Cloud Console for the PearlOS OAuth app. Verify redirect URIs before changing login behavior.
- Discord bot/OAuth: controlled through Discord Developer Portal. Verify bot token, OAuth client id/secret, callback URL, and bot intents.
- Daily: controlled through Daily dashboard. Required for voice room creation and voice media transport.
- OpenRouter: controlled through OpenRouter dashboard. Required for GPT-4o tool-routing and apps using OpenRouter.
- DeepSeek: controlled through DeepSeek dashboard/API console. Required for direct DeepSeek chat path.
- TTS providers:
  - PocketTTS runs as a local service on staging.
  - Voxtral may depend on a model service/host; verify current provider env and health before assuming.
  - Cartesia requires Cartesia dashboard/API key if enabled.
- Domain/DNS:
  - `app.pearlos.org` is production app.
  - `pearlos.org` / `www.pearlos.org` are public website domains.
  - `134-209-76-227.sslip.io` is current DO staging.
  - `pearlos.app` is stale and should not be used as authoritative.

Unknowns to fill later:

- Exact human/account owner for each external dashboard.
- Exact RunPod template/image name.
- Whether the RunPod template metadata should be exported before deleting the pod.

## Archive Coverage

The RunPod forensic archive already exists on DO staging:

```text
/workspace/nia-universal/forensics/runpod-log-archive-2026-05-06
```

Coverage notes:

- Preserved content files: `3490`.
- Archive metadata/wrapper files: manifest, file list, checksum, compressed tar.
- `/workspace/user/Documents` local count was `1960`; preserved count was `1956`.
- The small difference is consistent with deliberate exclusions for paths/names containing env/auth/key/token/secret/credentials.
- The archive was verified and is readable/searchable by `deploy`, not world-readable.

If future Codex sessions claim they do not have the RunPod testing logs, point them to this archive and to `CODEX_DO_OPERATIONS.md`.
