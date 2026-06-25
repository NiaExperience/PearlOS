# PearlOS Omega Stage — Build Manifest

> **Snapshot Date:** 2026-04-19
> **Branch:** `PearlOS_OmegaStage`
> **HEAD Commit:** `c8afcbe6` — feat(interface): convert Creation Launchpad to native React component
> **Previous Milestone:** `b751b675` — build(bronze): stable bronze snapshot

---

## 1. WORKSPACE ARCHITECTURE

| Workspace | Path | Port | Role |
|-----------|------|------|------|
| `@nia/interface` | `apps/interface` | 3000 | Next.js desktop frontend |
| `@nia/mesh-server` | `apps/mesh` | 2000 | GraphQL API layer |
| `@nia/dashboard` | `apps/dashboard` | 4000 | Admin dashboard |
| `pipecat-daily-bot` | `apps/pipecat-daily-bot` | 4444 | Python voice bot runtime |
| `@nia/features` | `packages/features` | — | Feature flags module |
| `@nia/prism` | `packages/prism` | — | Multi-source data abstraction |
| `@nia/events` | `packages/events` | — | Event definitions & codegen |
| `@nia/redis` | `packages/redis` | — | Redis integration |

### Non-workspace apps (present but not in root workspaces):
- `apps/chorus-tts` — Text-to-speech service
- `apps/ncp` — Network communication protocol
- `apps/pearlos-mcp-server` — MCP server integration
- `apps/sidescroller` — Side-scroller game feature
- `apps/sprite-maker` — Sprite creation utilities
- `apps/web-base` — Web base layer

---

## 2. FEATURE MODULES (apps/interface/src/features/)

| # | Feature | Description |
|---|---------|-------------|
| 1 | `ActiveJobs` | Job management display |
| 2 | `BrowserAutomation` | Browser control tools |
| 3 | `ChatMode` | Chat UI mode |
| 4 | `CreationLaunchpad` | Content creation launcher (native React — latest commit) |
| 5 | `DailyCall` | Daily.co voice call integration |
| 6 | `Files` | File management |
| 7 | `Gmail` | Google Gmail integration |
| 8 | `GoogleDrive` | Google Drive integration |
| 9 | `HtmlGeneration` | HTML content creation |
| 10 | `InviteViaEmail` | Email invitation system |
| 11 | `ManeuverableWindow` | Window management controls |
| 12 | `MiniBrowser` | Embedded browser |
| 13 | `Notes` | Note-taking system |
| 14 | `OpenClawBridge` | OpenClaw integration |
| 15 | `PearlMultiMenu` | Multi-menu system |
| 16 | `PhotoMagic` | Photo editing / AI generation |
| 17 | `ResourceSharing` | Content sharing |
| 18 | `RiveAvatar` | Rive animation framework |
| 19 | `Soundtrack` | Music system |
| 20 | `Sprites` | Animated sprite overlays |
| 21 | `Stage` | Stage display system |
| 22 | `Terminal` | Terminal emulator |
| 23 | `UserProfile` | User profile management |
| 24 | `VoiceInput` | Voice input handling |
| 25 | `Wikipedia` | Wikipedia integration |
| 26 | `YouTube` | YouTube integration |

---

## 3. VOICE PIPELINE

```
User → Deepgram STT → Pipecat Orchestration → LLM → PocketTTS (Azelma) → User
                          ↕
                    Daily.co WebRTC
```

- **STT:** Deepgram
- **Orchestration:** Pipecat (Python 3.11+)
- **TTS:** PocketTTS, voice: Azelma
- **Transport:** Daily.co WebRTC
- **Port:** 4444

---

## 4. DATA FLOW

```
Interface (3000) → Mesh GraphQL (2000) → Prism → PostgreSQL / External APIs
                                        ↕
                                    Redis Cache
                                        ↕
                                   Event System
```

---

## 5. RECENT COMMIT HISTORY (Omega Stage)

| Commit | Message |
|--------|---------|
| `c8afcbe6` | feat(interface): convert Creation Launchpad to native React component |
| `b751b675` | build(bronze): stable bronze snapshot — Launchpad, ActiveJobs, backgrounds, recovery |
| `d0435e61` | fix: persist isChatMode=true default (stops reverting on checkout) |
| `135ed6c8` | doc: add comprehensive PearlOS Omega config reference |
| `c6783dbb` | PearlOS Omega Stage — restored staging with critical fixes |
| `ed1418bc` | fix(interface): prevent accidental zoom on home screen and desktop modes |
| `3daf8665` | config snapshot 2026-04-17 |
| `cfcdf17d` | fix(interface): iOS Safari URL-bar — switch to 100dvh + box-sizing border-box |

---

## 6. TECHNOLOGY STACK

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 13+, React, TypeScript |
| API | GraphQL Mesh |
| Database | PostgreSQL |
| Cache | Redis |
| Voice | Pipecat, Daily.co, Deepgram, PocketTTS |
| Build | Turbo, npm workspaces |
| Testing | Jest, Cypress (E2E) |
| CI/CD | GitHub Actions (17 workflow files) |
| Infra | Docker, DigitalOcean, Cloudflare Tunnels |
| Node | ≥ 20.0.0 |
| Python | ≥ 3.11 (voice bot) |

---

## 7. CI/CD PIPELINES

- `ci.yml` — Main CI
- `build-app.yml` / `build-web-base.yml` — Build pipelines
- `deploy-interface.yml` / `deploy-mesh.yml` / `deploy-dashboard.yml` — Production deploys
- `deploy-*-stg.yml` — Staging deploys
- `deploy-*-pearl.yml` — Pearl environment deploys
- `daily-image-scan.yml` — Security scanning

---

## 8. KEY CONFIGURATION FILES

- `turbo.json` — Build orchestration (daemon=false)
- `tsconfig.json` — Root TypeScript config
- `jest.config.mjs` — Test runner config
- `.eslintrc.js` / `.prettierrc` — Code quality
- `.env.local` — Active environment (2145 bytes)
- `.env.production.template` — Production template
- `.sops.yaml` — Secrets management
- `CLAUDE.md` — AI assistant bootstrap (18.4 KB)

---

## 9. BRANCH STATUS

- **Current:** `PearlOS_OmegaStage` (active development)
- **Base:** `staging` (main merge target)
- **Production:** `pearlos-production`
- **Candidate:** `pearlos-candidate`
- **Feature branches:** 150+ remote branches

---

## 10. NON-NEGOTIABLES (from CLAUDE.md)

1. Plan before code
2. Explicit requirement checklists
3. Event safety (descriptors, schemas, redaction)
4. Test coverage (happy + edge)
5. No reformatting beyond scope
6. No deep cross-feature imports
7. No secrets/PII in logs
8. NEVER use `--workspaces` with Jest
9. Respond with FOCUS if scope drifts
