# GOLDEN MUPPET -- PearlOS Staging Snapshot

> **Codename:** GOLDEN MUPPET
> **Snapshot Date:** 2026-05-05T15:12:46Z
> **Branch:** `Pearl-Staging-Private-Omega`
> **HEAD Commit:** `ca34e049` -- Refresh final GOLD NUGGET build metadata
> **Previous Milestone:** GOLD NUGGET (`87e0c77e`)
> **Repository:** `NiaExperience/nia-universal` (origin)
> **Host:** `pearl-staging-private-omega` (DigitalOcean)
> **Kernel:** Linux 6.8.0-71-generic x86_64

---

## 1. RUNTIME VERSIONS

| Component | Version |
|-----------|---------|
| Node.js | v22.22.2 |
| npm | 10.9.8 |
| Python | 3.12.3 |
| .nvmrc target | 18.19.1 |
| OS | Ubuntu, kernel 6.8.0-71-generic |

---

## 2. WORKSPACE ARCHITECTURE

| Workspace | Path | Port | Role |
|-----------|------|------|------|
| `@nia/interface` | `apps/interface` | 3000 | Next.js desktop frontend |
| `@nia/mesh-server` | `apps/mesh` | 2000 | GraphQL API layer |
| `@nia/dashboard` | `apps/dashboard` | 4000 | Admin dashboard |
| `pipecat-daily-bot` | `apps/pipecat-daily-bot` | 4444 | Python voice bot runtime |
| `@nia/features` | `packages/features` | -- | Feature flags module |
| `@nia/prism` | `packages/prism` | -- | Multi-source data abstraction |
| `@nia/events` | `packages/events` | -- | Event definitions & codegen |
| `@nia/redis` | `packages/redis` | -- | Redis integration |

### Non-workspace apps:
- `apps/chorus-tts` -- Text-to-speech service
- `apps/ncp` -- Network communication protocol
- `apps/pearlos-mcp-server` -- MCP server integration
- `apps/sprite-maker` -- Sprite creation utilities
- `apps/web-base` -- Web base layer

---

## 3. PM2 PROCESS MAP (all online at snapshot time)

| PM2 ID | Process | Port | CWD | Uptime |
|--------|---------|------|-----|--------|
| 9 | interface | 3000 | /workspace/nia-universal/apps/interface | 33m |
| 1 | mesh | 2000 | /home/deploy/pearlos/apps/mesh | 2D |
| 2 | pipecat-gateway | 4444 | /home/deploy/pearlos/apps/pipecat-daily-bot/bot | 11m |
| 3 | pipecat-runner | -- | /home/deploy/pearlos/apps/pipecat-daily-bot/bot | 11m |
| 4 | bot-queue-worker | -- | (deploy) | 2D |
| 5 | openclaw-gateway | 18789 | (deploy) | 2D |
| 6 | openclaw-bridge | -- | (deploy) | 2D |
| 7 | pocket-tts | 8766 | /home/deploy | 2D |
| 8 | pearl-chat-relays-production-repair | -- | (deploy) | 14h |

### Process startup commands:
- **interface:** `NODE_ENV=production PORT=3000 npm start` (sources `apps/interface/.env.local`)
- **mesh:** `NODE_ENV=production PORT=2000 node dist/server.js` (sources root `.env.local` + `apps/mesh/.env`)
- **pipecat-gateway:** `poetry run uvicorn bot_gateway:app --host 127.0.0.1 --port 4444`
- **pocket-tts:** `/home/deploy/pocket-tts-venv/bin/pocket-tts serve --port 8766 --host 127.0.0.1`

---

## 4. VOICE PIPELINE

```
User --> Deepgram STT --> Pipecat Orchestration --> LLM --> PocketTTS (Azelma) --> User
                            |
                      Daily.co WebRTC
```

- **STT:** Deepgram
- **Orchestration:** Pipecat (Python 3.12)
- **TTS:** PocketTTS, voice: Azelma (port 8766)
- **Transport:** Daily.co WebRTC
- **Gateway:** port 4444

### Voice presets (voice-presets.json):
- Default ASR: voxtral-mini:3b-q4
- Default TTS: voxtral-tts:4b-tts
- Default voice: casual_female_en (natural conversational female)

---

## 5. DATA FLOW

```
Interface (3000) --> Mesh GraphQL (2000) --> Prism --> PostgreSQL / External APIs
                                            |
                                        Redis Cache
                                            |
                                       Event System
```

---

## 6. ENVIRONMENT VARIABLE INVENTORY

### Root `.env.local` (17 vars):
DAILY_API_KEY, DAILY_DOMAIN, NEXT_PUBLIC_DAILY_ROOM_URL, VOICE_ROOM_PREFIX,
OPENROUTER_API_KEY, OPENCLAW_API_KEY, GOOGLE_INTERFACE_CLIENT_ID,
GOOGLE_INTERFACE_CLIENT_SECRET, NEXTAUTH_URL, NEXTAUTH_INTERFACE_URL,
NEXTAUTH_SECRET, NEXTAUTH_USE_SECURE_COOKIES, DISCORD_CLIENT_ID,
DISCORD_CLIENT_SECRET, DISCORD_OAUTH_REDIRECT_URI, DISCORD_BOT_TOKEN,
PIPECAT_BOT_ENV_PATH

### Interface `apps/interface/.env.local` (27 vars):
NEXT_PUBLIC_INTERFACE_URL, PEARLOS_ONLY, ENABLE_CREDENTIALS_AUTH,
MESH_ENDPOINT, MESH_SHARED_SECRET, BOT_CONTROL_SHARED_SECRET,
BOT_CONTROL_AUTH_REQUIRED, OPENCLAW_API_URL, BOT_GATEWAY_URL,
NEXT_PUBLIC_BOT_CONTROL_BASE_URL, DAILY_API_KEY, DAILY_DOMAIN,
NEXT_PUBLIC_DAILY_ROOM_URL, VOICE_ROOM_PREFIX, OPENROUTER_API_KEY,
OPENCLAW_API_KEY, GOOGLE_INTERFACE_CLIENT_ID, GOOGLE_INTERFACE_CLIENT_SECRET,
NEXTAUTH_URL, NEXTAUTH_INTERFACE_URL, NEXTAUTH_SECRET,
NEXTAUTH_USE_SECURE_COOKIES, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET,
DISCORD_OAUTH_REDIRECT_URI, DISCORD_BOT_TOKEN, PIPECAT_BOT_ENV_PATH

### Pipecat `apps/pipecat-daily-bot/.env` (57 vars):
USE_REDIS, AUTO_ROOM_ENABLED, DAILY_API_KEY, DAILY_ROOM_URL,
OPENROUTER_API_KEY, OPENROUTER_ENABLED, GROQ_API_KEY, MINIMAX_API_KEY,
MESH_API_ENDPOINT, BOT_TTS_PROVIDER, VOXTRAL_TTS_BASE_URL, VOXTRAL_TTS_API_KEY,
VOXTRAL_TTS_MODEL, VOXTRAL_TTS_VOICE, VOXTRAL_TTS_SPEED,
VOXTRAL_TTS_RESPONSE_FORMAT, KOKORO_TTS_BASE_URL, KOKORO_TTS_VOICE_ID,
BOT_OPENCLAW_AGENT, OPENCLAW_BRIDGE_URL, OPENCLAW_API_URL,
BOT_USE_SONNET_PRIMARY, BOT_SONNET_MODEL, OPENCLAW_API_KEY,
BOT_ESCALATION_MODEL, BOT_ESCALATION_TIMEOUT, POCKET_TTS_SPEED,
YOUTUBE_API_KEY, BOT_EMPTY_INITIAL_SECS, DEFAULT_TENANT_ID,
BOT_SESSION_USER_ID, BOT_LLM_MODEL, BOT_SWARM_MODEL, BOT_THINKING_MODEL,
BOT_VISION_MODEL, BOT_PERSONALITY_RECORD, BRAVE_API_KEY, BOT_HYBRID_MODEL,
BOT_VISION_ENABLED, BOT_HYBRID_BASE_URL, BOT_HYBRID_API_KEY,
BOT_GATEWAY_URL, BOT_CONTROL_SHARED_SECRET, BOT_CONTROL_AUTH_REQUIRED,
OLLAMA_KEEP_ALIVE, DEEPSEEK_BASE_URL, DEEPSEEK_API_KEY,
OPENCLAW_WORKSPACE, PEARL_TASKS_DIR, PEARL_CHAT_INBOX_DIR,
AGENCY_CHAT_DIR, BOT_LLM_MODE, BOT_NON_BLOCKING_TOOLS, BOT_FAST_API_KEY,
BOT_TOOLS_MODEL, BOT_SUBCONSCIOUS_MODEL, BOT_SUBCONSCIOUS_BASE_URL,
BOT_VOICE_COMPACT_TOOLS, BOT_FAST_MODEL, BOT_FAST_API_URL

---

## 7. FEATURE MODULES (apps/interface/src/features/)

| # | Feature | Description |
|---|---------|-------------|
| 1 | ActiveJobs | Job management display |
| 2 | BrowserAutomation | Browser control tools |
| 3 | ChatMode | Chat UI mode |
| 4 | CreationLaunchpad | Content creation launcher |
| 5 | DailyCall | Daily.co voice call integration |
| 6 | Files | File management |
| 7 | Gmail | Google Gmail integration |
| 8 | GoogleDrive | Google Drive integration |
| 9 | HtmlGeneration | HTML content creation |
| 10 | InviteViaEmail | Email invitation system |
| 11 | ManeuverableWindow | Window management controls |
| 12 | MiniBrowser | Embedded browser |
| 13 | Notes | Note-taking system |
| 14 | OpenClawBridge | OpenClaw integration |
| 15 | PearlMultiMenu | Multi-menu system |
| 16 | PhotoMagic | Photo editing / AI generation |
| 17 | ResourceSharing | Content sharing |
| 18 | RiveAvatar | Rive animation framework |
| 19 | Soundtrack | Music system |
| 20 | Sprites | Animated sprite overlays |
| 21 | Stage | Stage display system |
| 22 | Terminal | Terminal emulator |
| 23 | UserProfile | User profile management |
| 24 | VoiceInput | Voice input handling |
| 25 | Wikipedia | Wikipedia integration |
| 26 | YouTube | YouTube integration |

---

## 8. TECHNOLOGY STACK

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 13+, React, TypeScript |
| API | GraphQL Mesh |
| Database | PostgreSQL |
| Cache | Redis |
| Voice | Pipecat, Daily.co, Deepgram, PocketTTS |
| Build | Turbo (daemon=false), npm workspaces |
| Testing | Jest, Cypress (E2E) |
| CI/CD | GitHub Actions (20 workflow files) |
| Infra | Docker, DigitalOcean, Cloudflare Tunnels |
| Node | >=20.0.0 (engine requirement) |
| Python | >=3.11 (voice bot) |

---

## 9. CI/CD PIPELINES

| Workflow | Purpose |
|----------|---------|
| ci.yml | Main CI |
| build-app.yml | App build pipeline |
| build-web-base.yml | Web base layer build |
| deploy-interface.yml | Production interface deploy |
| deploy-interface-stg.yml | Staging interface deploy |
| deploy-interface-pearl.yml | Pearl environment deploy |
| deploy-mesh.yml | Production mesh deploy |
| deploy-mesh-stg.yml | Staging mesh deploy |
| deploy-mesh-pearl.yml | Pearl mesh deploy |
| deploy-dashboard.yml | Production dashboard deploy |
| deploy-dashboard-stg.yml | Staging dashboard deploy |
| deploy-dashboard-pearl.yml | Pearl dashboard deploy |
| deploy-pipecat-daily-bot-base.yml | Pipecat base image |
| deploy-pipecat-daily-bot-stg.yml | Staging pipecat deploy |
| deploy-pipecat-daily-bot-pearl.yml | Pearl pipecat deploy |
| deploy-kokoro-tts-stg.yml | Staging Kokoro TTS deploy |
| deploy-app.yml | Generic app deploy |
| deploy-web-app.yml | Web app deploy |
| daily-image-scan.yml | Security scanning |
| qa-screenshot.yml | QA screenshot automation |

---

## 10. CONFIGURATION FILES INDEX

### Build & Package:
- `package.json` -- root workspace (8 workspaces, engines >=20.0.0)
- `turbo.json` -- build/dev/lint/test/clean tasks, daemon=false
- `tsconfig.json` + `tsconfig-paths.json` -- root TypeScript
- `jest.config.mjs` + `jest.performance.config.mjs` -- test config
- `.eslintrc.js` + `.prettierrc` -- code quality
- `.npmrc` + `.nvmrc` -- npm + Node version pins
- `.editorconfig` -- editor settings

### App-specific configs:
- `apps/interface/next.config.mjs` -- Next.js config
- `apps/interface/tailwind.config.ts` + `postcss.config.mjs`
- `apps/interface/tsconfig.json` + `tsconfig.server.json`
- `apps/dashboard/next.config.mjs` -- Dashboard Next.js
- `apps/dashboard/tailwind.config.ts` + `postcss.config.mjs`
- `apps/mesh/tsconfig.json` -- Mesh TypeScript
- `apps/mesh/docker-compose.yml` -- Mesh Docker

### Docker:
- `Dockerfile.pearlos` -- main production Dockerfile
- `apps/interface/Dockerfile`
- `apps/dashboard/Dockerfile`
- `apps/mesh/Dockerfile`
- `apps/pipecat-daily-bot/Dockerfile`
- `apps/web-base/Dockerfile`
- `.dockerignore`

### Environment templates:
- `.example.env.local` -- comprehensive sanitized template
- `.env.production.template` -- production env template
- `apps/mesh/.env.example` + `.env.cache.example`
- `apps/interface/.env.google-signin-allowlist.example`

### Tunnel:
- `.tunnel/pm2.config.cjs` -- Cloudflare Quick Tunnel PM2 wrapper
- `.tunnel/current-url` -- live tunnel URL

---

## 11. DOCUMENTATION FILES

### Core agent guides:
- `PEARL.md` -- canonical PearlOS operating guide (source of truth rules)
- `AGENTS.md` -- Pearl role, dispatch, voice guidelines
- `CLAUDE.md` -- compatibility shim -> PEARL.md
- `MEMORY.md` -- long-term memory and staging context
- `USER_FACTS.md` -- durable user preferences
- `IDENTITY.md` -- Pearl identity
- `SOUL.md` -- Pearl character/values
- `HEARTBEAT.md` -- heartbeat/status reference
- `TOOLS.md` -- available tools
- `USER.md` -- user context

### Setup guides:
- `SETUP_INSTRUCTIONS.md`
- `SETUP_FROM_SCRATCH.md`
- `SIMPLE_SETUP.md`
- `README_SETUP.md`
- `BOOTSTRAP.md`
- `LINUX_SETUP.md` / `MACOS_SETUP.md` / `WINDOWS_SETUP.md`
- `docs/environment-setup.md`
- `docs/getting-started.md`

### Build manifests:
- `BUILD_MANIFEST_OMEGA.md` -- Omega stage snapshot (2026-04-19)
- `BUILD_GOLDEN_MUPPET.md` -- this file

### Reference:
- `reference/AGENTS.full.md` + `AGENTS.slim.md`
- `reference/TOOLS.full.md` + `TOOLS.slim.md`
- `conductor/` -- product guidelines and workflow docs

---

## 12. SCRIPTS DIRECTORY (key operational scripts)

### Startup & Development:
- `scripts/run-apps-in-new-terminals.sh`
- `scripts/run-servers-for-debugger.sh`
- `scripts/start-redis-dev.sh`
- `scripts/start-chorus-tts.sh`
- `scripts/validate-env.ts`
- `scripts/sync-local-env.ts`

### Deploy & Sync:
- `scripts/deploy-staging.sh`
- `scripts/sync-deploy-to-source.sh` -- deploy -> source drift fix
- `scripts/source-deploy-drift-check.sh` -- drift detection
- `scripts/verify-build.sh`

### QA & Testing:
- `scripts/qa-gate.sh`
- `scripts/qa-smoke-test.sh`
- `scripts/qa-screenshot-audit.sh`
- `scripts/test-app-health.mjs`
- `scripts/voice-e2e-test.py`
- `scripts/voice-qa-test.py`
- `scripts/validate-voice-config.sh`

### Monitoring:
- `scripts/stack-health-monitor.sh`
- `scripts/health-loop.sh`
- `scripts/cron-watchdog.sh`

### Database:
- `scripts/seed-db.ts`
- `scripts/backup-db.sh`
- `scripts/restore-db.ts`

### Pearl Agency:
- `scripts/pearl-worker.py`
- `scripts/pearl-task`
- `scripts/pearl-claude`
- `scripts/pearl-worker-watchdog.sh`
- `scripts/agency-chat-tick.py`

---

## 13. SOURCE OF TRUTH RULES

1. `/workspace/nia-universal` is canonical source. `/opt/pearlos` is deploy target only.
2. Edit workflow: edit source -> `cp` to deploy -> rebuild/restart PM2.
3. Never edit .ts/.tsx/.js/.py/.sh directly inside /opt/pearlos.
4. Build .next from /workspace/nia-universal source, never from /opt/pearlos.
5. Verify files exist in BOTH locations before declaring task done.
6. Run `scripts/sync-deploy-to-source.sh` if drift is detected.

---

## 14. STAGING DOMAINS & ACCESS

- **Staging tunnel:** Cloudflare Quick Tunnel (URL in `.tunnel/current-url`)
- **Current tunnel:** `pattern-ranks-lists-particular.trycloudflare.com`
- **Staging app domain:** `134-209-76-227.sslip.io`
- **Production domain:** `app.pearlos.org`

---

## 15. NEXT.JS BUILD

- **BUILD_ID:** `build-87e0c77e-1777991772900`
- **Build location:** `apps/interface/.next/`
- **Startup:** `NODE_ENV=production PORT=3000 npm start`

---

## 16. RECENT COMMIT HISTORY (at snapshot)

| Commit | Message |
|--------|---------|
| `ca34e049` | Refresh final GOLD NUGGET build metadata |
| `87e0c77e` | Refresh GOLD NUGGET build metadata |
| `d222abd9` | GOLD NUGGET staging voice recovery |
| `baba3cf9` | Stamp restored staging deploy build |
| `9f549f8b` | Restore interface build info generator |
| `bb5e1a0f` | Stamp restored staging build metadata |
| `4c6d0802` | Protect Pearl voice click from chat opener |
| `7246b831` | Fix staging voice startup |
| `8aa1d93d` | Repair Glass Box agency chat |
| `d78da9c8` | GOLD CANDIDATE ARCTIC |

---

## 17. RESTORE PROCEDURE

To restore this exact state:

```bash
git checkout Pearl-Staging-Private-Omega
git reset --hard ca34e049

# Install deps
cd /workspace/nia-universal
npm install

# Build interface
cd apps/interface
npm run build

# Sync to deploy target
cp -r /workspace/nia-universal/apps/interface/.next /opt/pearlos/apps/interface/

# Restart services (requires Blair approval)
pm2 restart interface
pm2 restart mesh
pm2 restart pipecat-gateway
pm2 restart pipecat-runner
```

---

*GOLDEN MUPPET: a complete staging snapshot preserving all configuration,
environment layout, process topology, and documentation state at commit
ca34e049 on branch Pearl-Staging-Private-Omega.*
