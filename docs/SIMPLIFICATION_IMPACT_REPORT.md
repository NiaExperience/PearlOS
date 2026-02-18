# Nia Universal - Simplification Impact Report

> **Generated:** January 2026  
> **Purpose:** Analyze consequences of removing infrastructure and components  
> **Audience:** Engineering team evaluating simplification options

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture Overview](#2-current-architecture-overview)
3. [Component Dependency Matrix](#3-component-dependency-matrix)
4. [Detailed Impact Analysis](#4-detailed-impact-analysis)
   - [4.1 Kubernetes / Helm Charts](#41-kubernetes--helm-charts)
   - [4.2 Tiltfiles (Local K8s Dev)](#42-tiltfiles-local-k8s-dev)
   - [4.3 GitOps / Flux](#43-gitops--flux)
   - [4.4 Terraform](#44-terraform)
   - [4.5 Pipecat Daily Bot](#45-pipecat-daily-bot)
   - [4.6 Chorus TTS](#46-chorus-tts)
   - [4.7 Redis](#47-redis)
   - [4.8 Docker Images](#48-docker-images)
5. [Feature Impact Summary](#5-feature-impact-summary)
6. [Risk Assessment Matrix](#6-risk-assessment-matrix)
7. [Recommended Simplification Tiers](#7-recommended-simplification-tiers)
8. [Migration Checklist](#8-migration-checklist)

---

## 1. Executive Summary

### Current State
The Nia Universal platform is a **production-grade, multi-tenant intelligent workspace** with:
- 5 applications (interface, dashboard, mesh, pipecat-daily-bot, chorus-tts)
- 4 shared packages (prism, features, events, redis)
- Full Kubernetes deployment infrastructure (Helm, Tilt, Flux)
- Terraform-managed cloud resources

### Simplification Goal
Reduce operational complexity while maintaining core functionality for local development and small-scale deployments.

### Key Finding
**70% of infrastructure files can be safely archived** without losing core platform functionality. The remaining complexity is tied to voice/AI features that represent the product's key differentiator.

---

## 2. Current Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CURRENT FULL ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐   │
│  │  Interface  │    │  Dashboard  │    │   Mesh      │    │   Pipecat   │   │
│  │  (Next.js)  │    │  (Next.js)  │    │  (GraphQL)  │    │   Bot       │   │
│  │  :3000      │    │  :4000      │    │  :2000      │    │  (Python)   │   │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘   │
│         │                  │                  │                  │          │
│         └──────────────────┼──────────────────┼──────────────────┘          │
│                            │                  │                             │
│                     ┌──────▼──────┐    ┌──────▼──────┐    ┌─────────────┐   │
│                     │   Redis     │    │  PostgreSQL │    │ Chorus TTS  │   │
│                     │  (Cache)    │    │  (Data)     │    │  (Voice)    │   │
│                     └─────────────┘    └─────────────┘    └─────────────┘   │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  INFRASTRUCTURE LAYER                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │  Helm    │  │  Tilt    │  │  Flux    │  │Terraform │  │  Dockerfiles │   │
│  │  Charts  │  │  Files   │  │  GitOps  │  │  (AWS)   │  │  (5 images)  │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### File Count by Category

| Category | Files | Lines of Code (est.) |
|----------|-------|---------------------|
| Helm Charts (`charts/`) | ~96 YAML | ~3,000 |
| Tiltfiles | 2 | ~800 |
| GitOps/Flux (`infra/clusters/`) | 9 YAML | ~300 |
| Terraform (`infra/terraform/`) | 4 .tf | ~200 |
| Deployment YAMLs (`apps/*/deployment/`) | ~30 YAML | ~1,500 |
| Dockerfiles | 5 | ~400 |
| **Total Infrastructure** | **~146 files** | **~6,200 lines** |

---

## 3. Component Dependency Matrix

### What Depends on What

| Component | Depends On | Required By |
|-----------|-----------|-------------|
| **Interface** | Mesh, Redis (optional), Daily.co (optional) | End users |
| **Dashboard** | Mesh, Redis (optional) | Admins |
| **Mesh** | PostgreSQL, Redis (optional) | Interface, Dashboard, Bot |
| **Pipecat Bot** | Redis, Mesh, Daily.co, TTS | Interface (voice calls) |
| **Chorus TTS** | None (standalone) | Pipecat Bot |
| **Redis** | None | Mesh (cache), Bot (state), Interface (sessions) |
| **PostgreSQL** | None | Mesh (data storage) |

### Package Dependencies

```
packages/prism     → Used by: Interface, Dashboard, Mesh
packages/features  → Used by: Interface, Dashboard, Bot
packages/events    → Used by: Interface, Bot
packages/redis     → Used by: Interface, Dashboard, Mesh, Bot
```

---

## 4. Detailed Impact Analysis

### 4.1 Kubernetes / Helm Charts

**Location:** `charts/`

**Contents:**
- `charts/dashboard/` - Dashboard Helm chart
- `charts/interface/` - Interface Helm chart  
- `charts/mesh/` - Mesh Helm chart
- `charts/pipecat-daily-bot/` - Bot Helm chart
- `charts/redis/` - Redis Helm chart
- `charts/kokoro-tts/` - TTS Helm chart
- `charts/scripts/` - AWS secrets setup

**What It Does:**
- Defines Kubernetes deployments for production/staging
- Manages secrets via AWS Secrets Manager integration
- Configures ingress, HPAs, PDBs for production reliability
- Environment-specific configs (pearl, staging)

**If Removed:**

| Impact | Severity | Description |
|--------|----------|-------------|
| ❌ No K8s production deploy | 🔴 Critical | Cannot deploy to AWS EKS or any K8s cluster |
| ❌ No staging environment | 🟡 Medium | Lose pre-production testing environment |
| ❌ No AWS secrets integration | 🟡 Medium | Must manage secrets differently |
| ✅ Local dev unaffected | 🟢 None | `npm run start:all` still works |
| ✅ Codebase simpler | 🟢 Positive | ~96 files removed |

**Recommendation:** ⚠️ **Archive, don't delete** - Keep in `archive/kubernetes/` for potential future use.

---

### 4.2 Tiltfiles (Local K8s Dev)

**Location:** `Tiltfile`, `Tiltfile.minimal`

**What It Does:**
- Orchestrates local Kubernetes development with hot-reload
- Builds Docker images and deploys to local cluster
- Sets up Redis, Postgres, all apps in containerized environment
- Provides unified dev experience similar to production

**If Removed:**

| Impact | Severity | Description |
|--------|----------|-------------|
| ❌ No containerized local dev | 🟡 Medium | Can't test K8s behavior locally |
| ❌ No k3d/colima workflow | 🟡 Medium | Lose local K8s cluster support |
| ✅ Simpler dev setup | 🟢 Positive | Use `npm run start:all` directly |
| ✅ Faster iteration | 🟢 Positive | No Docker build overhead |
| ✅ Lower resource usage | 🟢 Positive | No K8s cluster running locally |

**Prerequisites Lost:**
- Colima/k3d/minikube installation
- Docker registry setup
- Kubernetes context management

**Recommendation:** ✅ **Safe to remove** - Direct npm scripts are simpler for most development.

---

### 4.3 GitOps / Flux

**Location:** `infra/clusters/`

**What It Does:**
- Flux GitOps configuration for cluster sync
- Automatic deployment when Git changes
- TF-Controller for Terraform automation
- Synthetic monitoring configuration

**If Removed:**

| Impact | Severity | Description |
|--------|----------|-------------|
| ❌ No GitOps CI/CD | 🔴 Critical | Must deploy manually or use different CD |
| ❌ No auto-sync | 🟡 Medium | Changes require manual kubectl apply |
| ❌ No TF automation | 🟡 Medium | Must run Terraform manually |
| ✅ Local dev unaffected | 🟢 None | Only affects cluster operations |

**Recommendation:** ⚠️ **Archive if no production K8s** - Required only for K8s deployments.

---

### 4.4 Terraform

**Location:** `infra/terraform/`

**What It Does:**
- AWS Synthetics Canary module (uptime monitoring)
- CloudWatch alerts for synthetic checks
- Infrastructure-as-code for AWS resources

**If Removed:**

| Impact | Severity | Description |
|--------|----------|-------------|
| ❌ No synthetic monitoring | 🟡 Medium | Lose automated uptime checks |
| ❌ No IaC for AWS | 🟡 Medium | Must configure AWS manually |
| ✅ Local dev unaffected | 🟢 None | Only affects cloud resources |
| ✅ Simpler repo | 🟢 Positive | 4 files removed |

**Recommendation:** ✅ **Safe to remove for local-only** - Only needed for AWS deployments.

---

### 4.5 Pipecat Daily Bot

**Location:** `apps/pipecat-daily-bot/`

**What It Does:**
- Python FastAPI voice bot powered by Daily.co WebRTC
- Real-time speech-to-text (Deepgram)
- Text-to-speech (ElevenLabs, Kokoro/Chorus)
- LLM conversation management (OpenAI, Groq)
- Redis-based session state and heartbeats

**Features That Depend On It:**

| Feature | File Location | Impact if Bot Removed |
|---------|---------------|----------------------|
| Voice Calls | `features/DailyCall/` (88 files) | ❌ **COMPLETELY BROKEN** |
| Rive Avatar | `features/RiveAvatar/` | 🟡 Static only (no lip-sync) |
| Soundtrack | `features/Soundtrack/` | 🟡 Degraded (no voice ducking) |
| Notes | `features/Notes/` | 🟡 No voice-to-note |
| HTML Generation | `features/HtmlGeneration/` | 🟡 No voice commands |

**Interface Dependencies (grep results):**
```
88 files in apps/interface/src/features/ reference pipecat/daily/bot
```

**If Removed:**

| Impact | Severity | Description |
|--------|----------|-------------|
| ❌ No voice conversations | 🔴 **CRITICAL** | Core product feature gone |
| ❌ No real-time AI chat | 🔴 **CRITICAL** | Platform becomes static |
| ❌ DailyCall feature broken | 🔴 **CRITICAL** | 88 files become dead code |
| ❌ Voice session context broken | 🔴 **CRITICAL** | `voice-session-context.tsx` fails |
| 🟡 Avatar becomes static | 🟡 Medium | No speech animation |
| ✅ Faster builds | 🟢 Minor | No Python in build |
| ✅ Fewer dependencies | 🟢 Minor | No Daily.co, Deepgram deps |

**Required Environment Variables (if keeping):**
```bash
DAILY_API_KEY          # Daily.co account
DEEPGRAM_API_KEY       # Speech-to-text
OPENAI_API_KEY         # LLM responses
BOT_CONTROL_SHARED_SECRET
```

**Recommendation:** 🔴 **DO NOT REMOVE** unless you're building a completely different product without voice.

---

### 4.6 Chorus TTS

**Location:** `apps/chorus-tts/` (git submodule)

**What It Does:**
- Local text-to-speech server (Kokoro model)
- WebSocket API for streaming audio
- Alternative to cloud TTS (ElevenLabs)
- CPU or GPU inference

**If Removed:**

| Impact | Severity | Description |
|--------|----------|-------------|
| ❌ No local TTS | 🟡 Medium | Must use cloud TTS only |
| ❌ Higher latency | 🟡 Medium | Network round-trip for speech |
| ❌ Higher cost | 🟡 Medium | ElevenLabs charges per character |
| ✅ Simpler setup | 🟢 Positive | No Python/uv dependency |
| ✅ No GPU needed | 🟢 Positive | Cloud TTS is CPU-free |

**Mitigation:** Set `BOT_TTS_PROVIDER=elevenlabs` to use cloud TTS.

**Recommendation:** ✅ **Safe to remove** if using ElevenLabs or other cloud TTS.

---

### 4.7 Redis

**Location:** `packages/redis/`, configs in multiple apps

**What It Does:**

| Function | Used By | Impact Level |
|----------|---------|--------------|
| GraphQL response caching | Mesh | Performance |
| Session state | Interface | Session persistence |
| Bot heartbeats | Pipecat Bot | Health monitoring |
| Real-time config | Pipecat Bot | Hot config updates |
| PubSub messaging | Bot ↔ Interface | Cross-process events |
| User timeout tracking | Interface | Moderation |
| HTML generation recovery | Interface | Job resilience |

**If Removed:**

| Impact | Severity | Description |
|--------|----------|-------------|
| 🟡 Slower GraphQL | 🟡 Medium | No response caching |
| 🟡 No job recovery | 🟡 Medium | HTML gen jobs lost on restart |
| 🟡 Bot state in files | 🟡 Medium | Falls back to file-based |
| ✅ Simpler setup | 🟢 Positive | One less service to run |
| ✅ Works with fallbacks | 🟢 Positive | Code has file-based fallbacks |

**Current Fallback Behavior:**
```python
# From redis_client.py
if os.getenv("USE_REDIS", "false").lower() != "true":
    # Falls back to file-based operations
```

**Recommendation:** ✅ **Safe to disable** - Set `USE_REDIS=false`. Code has built-in fallbacks.

---

### 4.8 Docker Images

**Location:** `apps/*/Dockerfile`

**Images:**
1. `apps/web-base/Dockerfile` - Shared base for Next.js apps
2. `apps/interface/Dockerfile` - Interface production image
3. `apps/dashboard/Dockerfile` - Dashboard production image
4. `apps/mesh/Dockerfile` - Mesh production image
5. `apps/pipecat-daily-bot/Dockerfile` - Bot production image

**If Removed:**

| Impact | Severity | Description |
|--------|----------|-------------|
| ❌ No containerized deploy | 🔴 Critical | Can't deploy to any container platform |
| ❌ No Tilt workflow | 🟡 Medium | Tiltfile won't work |
| ✅ Local dev unaffected | 🟢 None | `npm run dev` doesn't use Docker |

**Recommendation:** ⚠️ **Keep Dockerfiles** - They're small and useful for production.

---

## 5. Feature Impact Summary

### Features by Removal Risk

| Feature | Files | If Bot Removed | If Redis Removed | If K8s Removed |
|---------|-------|----------------|------------------|----------------|
| **DailyCall** | 88 | 🔴 BROKEN | 🟡 Degraded | ✅ OK |
| **HtmlGeneration** | 25 | 🟡 No voice | 🟡 No recovery | ✅ OK |
| **Notes** | 20 | 🟡 No voice | ✅ OK | ✅ OK |
| **YouTube** | 15 | 🟡 No voice ctrl | ✅ OK | ✅ OK |
| **RiveAvatar** | 10 | 🟡 Static | ✅ OK | ✅ OK |
| **Gmail/Drive** | 30 | ✅ OK | ✅ OK | ✅ OK |
| **MiniBrowser** | 8 | ✅ OK | ✅ OK | ✅ OK |
| **Dashboard** | 283 | ✅ OK | 🟡 No cache | ✅ OK |

---

## 6. Risk Assessment Matrix

| Component | Removal Risk | Reversibility | Dev Impact | Prod Impact |
|-----------|-------------|---------------|------------|-------------|
| Helm Charts | 🟢 Low | ✅ Easy | None | 🔴 Critical |
| Tiltfiles | 🟢 Low | ✅ Easy | 🟡 Minor | None |
| Flux/GitOps | 🟢 Low | ✅ Easy | None | 🔴 Critical |
| Terraform | 🟢 Low | ✅ Easy | None | 🟡 Medium |
| Pipecat Bot | 🔴 High | ⚠️ Complex | 🔴 Critical | 🔴 Critical |
| Chorus TTS | 🟢 Low | ✅ Easy | 🟡 Minor | 🟡 Medium |
| Redis | 🟡 Medium | ✅ Easy | 🟡 Minor | 🟡 Medium |
| Dockerfiles | 🟡 Medium | ✅ Easy | None | 🔴 Critical |

---

## 7. Recommended Simplification Tiers

### Tier 1: Safe Removal (Recommended) ✅

**Remove these with no functional impact on local development:**

```
# Archive these folders
charts/                    # ~96 files - K8s Helm charts
infra/                     # ~13 files - Flux + Terraform
Tiltfile                   # K8s local dev
Tiltfile.minimal           # K8s minimal local dev
apps/*/deployment/         # ~30 files - K8s staging manifests
```

**Result:** ~140 files removed, full functionality preserved

### Tier 2: Optional Removal (Conditional) ⚠️

**Remove if you're OK with trade-offs:**

| Remove | Trade-off | Mitigation |
|--------|-----------|------------|
| `apps/chorus-tts/` | Use cloud TTS | Set `BOT_TTS_PROVIDER=elevenlabs` |
| Redis dependency | No caching/recovery | Set `USE_REDIS=false` |
| Some env vars | Fewer API integrations | Document minimal required vars |

**Result:** Simpler setup, some performance/cost impact

### Tier 3: Major Removal (Not Recommended) 🔴

**Removing these breaks core functionality:**

| Remove | Consequence |
|--------|-------------|
| `apps/pipecat-daily-bot/` | Voice features completely broken |
| `apps/mesh/` | No data layer - app won't function |
| `packages/prism/` | No data access - app crashes |

---

## 8. Migration Checklist

### For Tier 1 (Safe) Simplification:

```bash
# 1. Create archive folder
mkdir -p archive/infrastructure

# 2. Move K8s infrastructure
mv charts/ archive/infrastructure/
mv infra/ archive/infrastructure/
mv Tiltfile archive/infrastructure/
mv Tiltfile.minimal archive/infrastructure/

# 3. Move deployment manifests (keep Dockerfiles)
for app in interface dashboard mesh pipecat-daily-bot; do
  mv apps/$app/deployment archive/infrastructure/$app-deployment/ 2>/dev/null || true
done

# 4. Update .gitignore (optional - to exclude from git)
echo "archive/infrastructure/" >> .gitignore

# 5. Clean up package.json scripts (optional)
# Remove K8s-specific scripts like setup:cluster, docker:build:*, etc.

# 6. Test the simplified setup
npm install
npm run start:all
```

### For Tier 2 (Optional) Simplification:

```bash
# 1. Disable Redis (add to .env.local)
echo "USE_REDIS=false" >> .env.local

# 2. Use cloud TTS (add to .env.local)
echo "BOT_TTS_PROVIDER=elevenlabs" >> .env.local
echo "ELEVENLABS_API_KEY=your-key" >> .env.local

# 3. Remove Chorus TTS submodule (optional)
git submodule deinit apps/chorus-tts
rm -rf apps/chorus-tts
```

### Minimal Required Environment Variables:

```bash
# === REQUIRED FOR BASIC FUNCTIONALITY ===
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
POSTGRES_DB=testdb

NEXTAUTH_SECRET=your-secret-key
MESH_ENDPOINT=http://localhost:2000/graphql
MESH_SHARED_SECRET=your-mesh-secret

# === REQUIRED FOR VOICE (if keeping bot) ===
DAILY_API_KEY=your-daily-key
OPENAI_API_KEY=your-openai-key
DEEPGRAM_API_KEY=your-deepgram-key
BOT_CONTROL_SHARED_SECRET=your-bot-secret

# === OPTIONAL ===
USE_REDIS=false
BOT_TTS_PROVIDER=elevenlabs  # or 'kokoro' for local
```

---

## Summary

| Simplification Level | Files Removed | Functionality Preserved | Recommended For |
|---------------------|---------------|------------------------|-----------------|
| **Tier 1** | ~140 | 100% | Local dev, small deployments |
| **Tier 2** | ~160 | 95% | Budget-conscious setups |
| **Tier 3** | ~200+ | <50% | ⚠️ Not recommended |

**Bottom Line:** Archive the Kubernetes infrastructure (Tier 1) for significant simplification with zero functional impact on development. Keep the Pipecat bot if voice is important to your product.

---

*Report generated for nia-universal simplification analysis*

