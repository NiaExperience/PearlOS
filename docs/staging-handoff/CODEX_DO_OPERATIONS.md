# Codex DO Operations Memory

Last updated: 2026-05-14.

This is the high-signal memory for Codex sessions running on DigitalOcean staging. Read this before touching PearlOS.

Pearl's step-by-step staging build push guide:

```text
/workspace/nia-universal/docs/staging-handoff/PEARL_STAGING_BUILD_PUSH_GUIDE.md
```

Related shutdown handoff:

```text
/workspace/nia-universal/docs/staging-handoff/RUNPOD_SHUTDOWN_COORDINATION_2026-05-06.md
```

## Current Machines

- DigitalOcean staging droplet: `pearl-staging-private-omega`, public IP `134.209.76.227`.
- Staging URL: `https://134-209-76-227.sslip.io/`.
- DigitalOcean production droplet: `pearlos-production`, public IP `165.227.83.62`.
- Do not touch production unless the user explicitly names production and asks for it.
- Do not change database setup unless explicitly asked.

## Source And Deploy Rules

The source of truth on DO staging is:

```text
/workspace/nia-universal
```

The deploy/runtime tree is:

```text
/home/deploy/pearlos
```

Rules:

- Edit source under `/workspace/nia-universal`.
- Copy changed files to `/home/deploy/pearlos/<same-path>` after editing source.
- Build from `/workspace/nia-universal`, never from the deploy tree.
- Restart PM2 as the process owner. On staging, the app PM2 processes usually belong to `deploy`, not root.
- Root PM2 currently owns `pearl-jupyter`; deploy PM2 owns `interface`, `mesh`, `pipecat-*`, `pocket-tts`, OpenClaw, and relays.

Typical staging interface deploy:

```bash
cd /workspace/nia-universal
npm run build --prefix apps/interface
cp apps/interface/<changed-file> /home/deploy/pearlos/apps/interface/<changed-file>
su - deploy -c "pm2 restart interface --update-env && pm2 save"
curl -k -fsS https://134-209-76-227.sslip.io/api/health/build
```

The older `/opt/pearlos` source/deploy rule applies on some RunPod/prod contexts, but not to the current DO staging runtime. Always verify host and PM2 owner first.

## Production Promotion Workflow

The current production workflow is documented in:

```text
/workspace/nia-universal/docs/production-release-workflow.md
```

Prod should be treated as a deploy target, not a development workspace. The goal
is fast staging iteration with boring prod releases that do not leak runtime
state, backup files, logs, uploads, memories, or local audit captures.

Current prod reality as of 2026-05-14:

- Domain: `https://app.pearlos.org/`.
- Host: `pearlos-production`, public IP `165.227.83.62`.
- Interface PM2 process runs from `/workspace/nia-universal/apps/interface`.
- Pipecat gateway, runner, and queue worker run from `/opt/pearlos/apps/pipecat-daily-bot`.
- PM2 owner on prod: `root`.
- Prod source currently has drift. Do not run `git reset --hard`, broad `rsync`, or whole-folder copies while drift exists.

Before pushing any release candidate toward prod, run:

```bash
cd /workspace/nia-universal
scripts/prod-preflight-audit.sh
```

For a release range:

```bash
scripts/prod-preflight-audit.sh <base-commit> <release-commit>
```

The audit blocks runtime/dev artifacts and scans diffs for secret-looking values.
If it fails, fix or explicitly quarantine the blocked artifact before deploying.

Prod deploy rules:

- Promote an approved commit, not an arbitrary dirty workspace.
- Never deploy `.env*`, `.bak*`, `.backup*`, `*.jsonl`, logs, uploads, `memory/.dreams`, `.data`, `.tasks`, `.agency/runs`, or local audit captures.
- For urgent prod edits, edit `/workspace/nia-universal` on prod only, verify, then immediately mirror the patch back into Git.
- For `/opt/pearlos` services, copy only the changed approved source files from `/workspace/nia-universal` to the same path under `/opt/pearlos`, then restart only the affected PM2 process.
- Record deployed commit, codename, services restarted, and smoke tests in the final summary.

Known prod hardening gap:

- Direct `http://165.227.83.62:4444/api/tasks` was still publicly reachable on 2026-05-14. Next hardening step is to bind the bot gateway to loopback behind nginx or enforce gateway auth for direct access.

## Build And Branch Lessons

- The active staging branch is expected to be `Pearl-Staging-Private-Omega`.
- Never infer the live build from memory. Check `/api/health/build`.
- Bad merges previously regressed Google-only login, voice, terminal, PhotoMagic keys, Sprites, and GlassBox. Treat branch changes and deploys as high-risk.
- Do not merge random branches into staging without first recording current HEAD, current build manifest, PM2 cwd, and a rollback point.
- Build names are not cosmetic only. The user uses them to detect whether the correct build is actually live.
- If the build name does not change after build/restart, suspect stale `.next`, wrong cwd, wrong PM2 user, or building the wrong host.

## Codex CLI Sandbox On Staging

Codex runs as `deploy` on staging. The working default for coding agents is:

```bash
cd /workspace/nia-universal/<project>
codex exec --sandbox workspace-write --skip-git-repo-check "<task>"
```

Do not use stale `npx codex exec --full-auto` guidance. If OpenClaw launches a long-running coding agent, use PTY/background mode when available and monitor the process log instead of killing it for being slow.

The staging host requires these OS pieces for Codex sandboxed shell access:

```text
uidmap installed
kernel.unprivileged_userns_clone=1
user.max_user_namespaces > 0
kernel.apparmor_restrict_unprivileged_userns=0
```

Current persistent drop-in:

```text
/etc/sysctl.d/99-pearl-codex-userns.conf
```

Smoke test before dispatching parallel Codex agents:

```bash
su - deploy -c 'bwrap --ro-bind / / --proc /proc --dev /dev --unshare-user --unshare-pid --unshare-net /bin/true'
su - deploy -c 'cd /workspace/nia-universal/apps/pearlos-website && codex exec --sandbox workspace-write --skip-git-repo-check --ephemeral "Run pwd using the shell tool, then print the output."'
```

If Codex reports bubblewrap, uid map, loopback, or `/tmp/codex-bwrap-synthetic-mount-targets` lock errors, clear root-owned Codex temp state and rerun the smoke test. `--sandbox danger-full-access` is allowed only as a trusted staging fallback, not as a production default.

## Current Recent Staging State

As of 2026-05-06, staging was rebuilt after adding:

- JupyterLab on `/jupyter/`, running as root PM2 process `pearl-jupyter`.
- Persistent PearlOS Terminal using server-side `tmux` sessions.
- New terminal API: `apps/interface/src/app/api/terminal/sessions/route.ts`.
- Reworked terminal UI: `apps/interface/src/features/Terminal/components/TerminalView.tsx`.

Current known-good live staging checkpoint from DO:

- Branch: `Pearl-Staging-Private-Omega`.
- Commit/tag: `870c2e69` / `GOLDEN-VOICE-WORKING-20260506`.
- Live build codename: `GOLDEN VOICE WORKING`.
- Live health endpoint: `https://134-209-76-227.sslip.io/api/health/build`.

Jupyter:

- PM2 process: `pearl-jupyter` under root.
- Local service: `127.0.0.1:8888`, base URL `/jupyter`.
- Public URL: `https://134-209-76-227.sslip.io/jupyter/`.
- Token is stored on the droplet at `/root/.jupyter/pearl-jupyter-token`.
- Do not print the token in logs or shared summaries unless the user explicitly asks for credentials.

Terminal design:

- The old terminal was one-command `exec`, not a persistent PTY. It could not reliably run Claude/Codex TUI sessions.
- The new terminal uses `tmux` sessions named `pearl-term-*`.
- Browser reload/window close/focus loss should not kill terminal sessions.
- Terminal key events must stop propagation so typing in Terminal does not trigger web chat expansion.

## Voice And Model Configuration Lessons

Voice is the highest-risk subsystem. Do not “prompt patch” broken behavior. Trace the actual code path.

Known good staging-style voice routing:

- Main conversation: DeepSeek direct.
- Tool/subconscious routing: GPT-4o via OpenRouter.
- TTS can be Voxtral/Pocket/Cartesia depending current env; verify env and logs before claiming.

Important env keys to verify, without printing secrets:

```text
BOT_TOOLS_MODEL
BOT_SUBCONSCIOUS_MODEL
BOT_FAST_MODEL
BOT_LLM_MODEL
DEEPSEEK_BASE_URL
DEEPSEEK_API_KEY
OPENROUTER_API_KEY
OPENROUTER_ENABLED
BOT_TTS_PROVIDER
BOT_GATEWAY_URL
AUTO_ROOM_ENABLED
RUNNER_AUTO_START
USE_REDIS
```

Production warning:

- Turning `USE_REDIS=false` can make direct in-process multi-session voice work for one user but unsafe for concurrent users if events are not room/session scoped.
- A real multitenancy fix must hard-scope every voice/tool/UI event by `room_url` and `session_id`.
- `/ws/events` must not allow unscoped clients to receive every active session's events.
- `AppMessageForwarder` must drop events not matching its own room/session.

Recent production voice bug:

- Pipecat v0.0.97 removed `TTSSettings`; Pocket/Voxtral providers crashed until patched with a compatibility import fallback.
- Files involved: `apps/pipecat-daily-bot/bot/providers/pocket_tts.py` and `voxtral.py`.

## OAuth And Auth Lessons

- Current app production domain is `https://app.pearlos.org/`.
- Staging is `https://134-209-76-227.sslip.io/`.
- `pearlos.app` is stale/non-authoritative.
- `niaxp.com` is marketing/company, not the PearlOS app.
- Google OAuth should be Google-only for staging/prod unless user asks otherwise.
- “Access Denied / deprecated login” means the auth flow or allowlist regressed, not a user education problem.
- Do not touch production OAuth settings while testing staging unless explicitly directed.

## OpenRouter And API Key Lessons

- Missing env propagation has repeatedly broken PhotoMagic, Sprites, GlassBox, and voice tools.
- Always verify both source env and deploy env if both exist.
- Never print raw API keys.
- If an app says `OPENROUTER_API_KEY is not configured`, check the runtime process env, not only the file.
- Restart the correct PM2 process with `--update-env` after env changes.

## RunPod Forensic Archive

Raw RunPod logs and testing artifacts were preserved to DO staging on 2026-05-06 because the first memory migration only brought summaries and selected reports. This archive is the primary place to search when reconstructing why voice, tools, auth, Discord, PhotoMagic, Sprites, GlassBox, or staging builds regressed.

Location on DO staging:

```text
/workspace/nia-universal/forensics/runpod-log-archive-2026-05-06
```

Important files:

```text
pearl-runpod-forensics-2026-05-06.tar.zst
pearl-runpod-forensics-2026-05-06.manifest.txt
pearl-runpod-forensics-2026-05-06.files
pearl-runpod-forensics-2026-05-06.sha256
extracted/
```

Verified checksum:

```text
5b3237201eac14edc5fad4a151a5088063e8d3337d18aee4dc400910651622c5
```

Contents include:

- RunPod PM2 logs from `/root/.pm2/logs`.
- RunPod Codex TUI logs and session JSONL from `/root/.codex/log` and `/root/.codex/sessions`.
- PearlOS memory, docs, QA artifacts, `.tasks`, and `.data`.
- Pipecat Daily bot source, tests, gateway logs, and voice audit docs.
- User-facing reports and test artifacts from `/workspace/user/Documents`, including voice/tool regression reports, webchat QA JSON, Voxtral clone tests, and agency/debug notes.

The archive intentionally excluded obvious env/auth/key files, build caches, `.git`, `node_modules`, `.next`, venvs, and similar generated folders. Raw logs may still contain sensitive operational output, so do not paste large excerpts or secrets into chat. Quote only narrow lines needed for a diagnosis.

Search examples:

```bash
cd /workspace/nia-universal/forensics/runpod-log-archive-2026-05-06/extracted
rg -n "Cartesia|PocketTTS|Voxtral|mute|tool call|OPENROUTER|GlassBox|Sprites|PhotoMagic|Access Denied|GOLDEN" .
rg -n "11:19|7:30|voice|pipecat|daily|tts" root/.pm2/logs workspace/user/Documents workspace/nia-universal/apps/pipecat-daily-bot
```

If Codex says it lacks historical test logs, point it here before asking it to infer from memory.

## Discord, Telegram, OpenClaw Lessons

- Discord/Telegram channels were intended to run from DO after RunPod shutdown.
- Avoid duplicate OpenClaw instances. If both systemctl and PM2 run the same bot, the bot can flap offline or reply inconsistently.
- Pairing/verification should automatically approve OpenClaw access after Discord verification, not require manual `openclaw pairing approve`.
- Do not expose internal task IDs/run IDs in user-facing Pearl responses.

## Pearl Persona / Product Lessons

- Pearl should be warm, direct, emotionally intelligent, and natural.
- Avoid generic AI tells: “let me”, “I’ll dispatch a lookup”, repetitive em dashes, tool-path narration, corporate filler.
- Pearl should own results in conversation. Do not say “Claude found” or “The Agency says” in normal user-facing dialogue.
- Pearl is the conversational presence; CLI/agents are the hands.

## Pearl Autonomy Regression Audit Files

Before changing Pearl's Discord, webchat, voice, task follow-up, OpenClaw routing, or Agency behavior, read:

```text
/workspace/nia-universal/.agency/audits/pearl-mechanical-regression-third-party-2026-05-11.md
/workspace/nia-universal/.agency/audits/openclaw-restoration-10agent-2026-05-11.md
```

The May 11 third-party audit was intentionally non-Codex/non-Claude. Models used: Kimi, GLM, DeepSeek V4 Pro, DeepSeek V4 Flash, Qwen, Gemini Pro, Gemini Flash, Grok, MiniMax, and Mistral.

The key finding is structural, not persona wording: Pearl is currently too often a text generator behind a relay/task dispatcher. The relay classified simple conversational turns as Agency work, returned canned acknowledgments, and multiple follow-up systems emitted duplicate mechanical task updates. OpenClaw shadow produced a better immediate answer for the same turn, but legacy relay/task behavior remained user-visible.

Do not paper over this with contracts, prompt patches, or friendlier canned "Still working" messages. The fix direction is to make OpenClaw/Pearl the primary responder and decision-maker, with task dispatch only for work Pearl chooses to delegate.

## Operational Verification Checklist

Before saying “done”:

1. Identify host, branch, cwd, and PM2 owner.
2. Check `git status --short` and preserve unrelated changes.
3. Verify changed files exist in source and deploy tree.
4. Build from source.
5. Restart the correct PM2 process under the correct user.
6. Check `/api/health/build`.
7. Check relevant health endpoints and recent logs.
8. State what was verified and what still requires browser/user testing.

Useful commands:

```bash
hostname
cd /workspace/nia-universal && git branch --show-current && git status --short
su - deploy -c "pm2 list --no-color"
pm2 list --no-color
curl -k -fsS https://134-209-76-227.sslip.io/api/health/build
```
