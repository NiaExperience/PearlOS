# Nia Universal - Open Source Isolation Plan

> **Created:** January 29, 2026  
> **Updated:** January 29, 2026  
> **Objective:** Make the project run completely locally, isolated from cloud dependencies  
> **Status:** ✅ IMPLEMENTED - See "Implementation Summary" below

---

## Executive Summary

Transform Nia Universal into a fully self-contained, locally-runnable platform that a developer can clone and run without any external cloud dependencies.

### Core Principles
1. **Local-first**: Everything runs on the developer's machine
2. **Zero cloud dependency**: No AWS, no cloud databases, no external services required
3. **Voice features via Kokoro/Chorus**: Local TTS using the Chorus submodule
4. **Graceful degradation**: Features requiring API keys (Daily.co, OpenAI, Deepgram) are optional
5. **Simple setup**: `setup.sh` → `npm run start:all` → working platform

---

## ✅ Implementation Summary (January 29, 2026)

### Completed Tasks

| Task | Status | Files Changed |
|------|--------|---------------|
| Enhanced seed-db.ts | ✅ Done | `scripts/seed-db.ts` |
| Pearl assistant with auth users | ✅ Done | Seeded via `npm run pg:seed` |
| Updated setup.sh with secrets | ✅ Done | `setup.sh` |
| Better .env.local template | ✅ Done | `config/env.minimal.example` |
| Archived AWS/K8s scripts | ✅ Done | 35+ scripts → `archive/scripts/` |
| Updated package.json | ✅ Done | `package.json` |
| Added start modes | ✅ Done | `start:simple`, `start:minimal` |
| Feature availability utility | ✅ Done | `packages/prism/src/core/utils/feature-availability.ts` |

### Key Changes

**1. Database Seeding (`npm run pg:seed`)**
- Creates Pearl assistant configured for Kokoro TTS
- Creates interface user: `demo@local.dev` / `password123`
- Creates dashboard user: `admin@local.dev` / `admin123`
- Creates sample note with welcome instructions

**2. Setup Script (`./setup.sh`)**
- Auto-generates secure secrets (NEXTAUTH_SECRET, MESH_SHARED_SECRET, TOKEN_ENCRYPTION_KEY)
- Detects PostgreSQL or offers Docker fallback
- Downloads Kokoro model files
- Offers to seed database at end

**3. New Start Modes**
```bash
npm run start:all      # Full platform (default)
npm run start:simple   # Without Pipecat bot
npm run start:minimal  # Mesh API only
```

**4. Archived Scripts** (see `archive/scripts/README.md`)
- All AWS database cloning scripts
- All K8s secret/configmap scripts
- All staging/prod scripts
- Reporting scripts (CloudWatch dependent)

---

## Previous State (For Reference)

### What Was Already Done ✅
- Setup scripts (`setup.sh`, `setup.ps1`) - cross-platform
- Minimal env template (`config/env.minimal.example`)
- K8s infrastructure archived (`archive/infrastructure/`)
- Database seeding script (`npm run pg:seed`)
- Dashboard auth bypassed for local dev
- PostgreSQL handling (local preferred, Docker fallback)

### What Was Done in This Implementation 🔧
1. ✅ **Clean up AWS scripts** from `scripts/` → Moved to `archive/scripts/`
2. ✅ **Enhance seed data** with proper "pearlos" assistant + auth users
3. ⏳ **Scrub internal references** (AWS account IDs) - Deferred
4. ✅ **Ensure graceful feature degradation** - Added `feature-availability.ts`
5. ✅ **Add start modes** (`start:simple`, `start:minimal`)

---

## Phase 1: Script Cleanup

### AWS Scripts to Archive/Remove

| Script | Purpose | Action | Reason |
|--------|---------|--------|--------|
| `scripts/clone-aws-db.ts` | Clone prod data from AWS | ARCHIVE | AWS dependent |
| `scripts/clone-aws-prod-db.ts` | Clone prod specifically | ARCHIVE | AWS dependent |
| `scripts/bootstrap-prod-db-from-dev.ts` | Bootstrap prod DB | ARCHIVE | AWS dependent |
| `scripts/staging-db-add-my-ip.sh` | Add IP to staging whitelist | ARCHIVE | AWS dependent |
| `scripts/staging-db-clone-via-tunnel.sh` | Clone via SSH tunnel | ARCHIVE | AWS dependent |
| `scripts/staging-db-remove-my-ip.sh` | Remove IP from whitelist | ARCHIVE | AWS dependent |
| `scripts/staging-db-test.sh` | Test staging connection | ARCHIVE | AWS dependent |
| `scripts/staging-db-tunnel.sh` | SSH tunnel to staging | ARCHIVE | AWS dependent |
| `scripts/delete-tenant-aws.ts` | Delete tenant from AWS | ARCHIVE | AWS dependent |
| `scripts/copy-content-to-aws.ts` | Copy content to AWS | ARCHIVE | AWS dependent |
| `scripts/copy-local-data-to-aws.sh` | Copy local data to AWS | ARCHIVE | AWS dependent |
| `scripts/get-secrets.sh` | Retrieve K8s secrets | ARCHIVE | K8s dependent |
| `scripts/sync_secrets.py` | Sync secrets | ARCHIVE | AWS dependent |
| `scripts/set-kube-secrets.sh` | Set K8s secrets | ARCHIVE | K8s dependent |
| `scripts/generate-k8s-secrets.sh` | Generate K8s secrets | ARCHIVE | K8s dependent |
| `scripts/get-configmaps.sh` | Get K8s configmaps | ARCHIVE | K8s dependent |
| `scripts/get-logs.sh` | Get K8s logs | ARCHIVE | K8s dependent |
| `scripts/get-*-logs.sh` | Various K8s log scripts | ARCHIVE | K8s dependent |
| `scripts/setup-aws-*.sh` | AWS setup scripts | ARCHIVE | AWS dependent |
| `scripts/add-pipecat-bot-route53.sh` | Route53 setup | ARCHIVE | AWS dependent |
| `scripts/update-k8s-deployments.sh` | Update K8s | ARCHIVE | K8s dependent |
| `scripts/validate-helm-charts.sh` | Validate Helm | ARCHIVE | K8s dependent |
| `scripts/setup-cluster.ts` | Setup K8s cluster | ARCHIVE | K8s dependent |

### Scripts to KEEP

| Script | Purpose | Why Keep |
|--------|---------|----------|
| `scripts/seed-db.ts` | Seed local database | Essential for local dev |
| `scripts/start-db.ts` | Start local PostgreSQL | Essential for local dev |
| `scripts/stop-all.ts` | Stop local services | Essential for local dev |
| `scripts/ensure-postgres.ts` | Ensure PostgreSQL running | Essential for setup |
| `scripts/setup-env.mjs` | Setup environment | Essential for setup |
| `scripts/download-chorus-assets.sh` | Download Kokoro models | Essential for voice |
| `scripts/start-chorus-tts.sh` | Start Chorus TTS | Essential for voice |
| `scripts/chorus-uv-sync.sh` | Sync Python deps | Essential for voice |
| `scripts/run-cypress.sh` | Run E2E tests | Testing |
| `scripts/run-with-mesh.sh` | Run with Mesh server | Development |
| `scripts/wait-for-graphql.ts` | Wait for server | Development |

---

## Phase 2: Enhanced Database Seeding

### Current Seed Data Issues
- Demo assistant doesn't have all the fields needed to work properly
- Missing personality configuration
- Missing voice configuration for Kokoro

### Enhanced "pearlos" Assistant Seed

```typescript
// Complete pearlos assistant configuration
{
  type: 'Assistant',
  page_id: PEARLOS_PAGE_ID,
  content: {
    _id: PEARLOS_ASSISTANT_ID,
    name: 'Pearl',
    subDomain: 'pearlos',
    tenantId: 'local-dev',
    
    // Identity
    description: 'Pearl is a friendly AI assistant for local development',
    firstMessage: "Hey there! I'm Pearl, your AI companion. How can I help you today?",
    
    // Model configuration
    model: {
      provider: 'openai',
      model: 'gpt-4o-mini',  // or gpt-4 if available
      temperature: 0.7,
      systemPrompt: 'You are Pearl, a helpful and friendly AI assistant...'
    },
    
    // Voice configuration (Kokoro/Chorus local TTS)
    voiceProvider: 'pipecat',
    modePersonalityVoiceConfig: {
      home: {
        personalityId: PEARL_PERSONALITY_ID,
        personalityName: 'Pearl',
        personaName: 'Pearl',
        room_name: 'local-pearl-home',
        voice: {
          provider: 'kokoro',
          voiceId: 'af_heart',  // or 'am_fenrir'
          speed: 1.0,
          model: 'kokoro-v1'
        }
      },
      // ... other modes as needed
    },
    
    // Features
    supportedFeatures: [
      'notes',
      'htmlGeneration',
      'youtube',
      'miniBrowser',
      'dailyCall',
      'chat'
    ],
    
    // Access control (allow local access)
    allowAnonymousLogin: true,
    startFullScreen: false,
    
    // Desktop mode default
    desktopMode: 'home',
    
    // Transcription (for voice input)
    transcriber: {
      provider: 'deepgram',
      model: 'nova-2',
      language: 'en-US'
    },
    
    createdAt: now,
    updatedAt: now
  },
  indexer: {
    name: 'Pearl',
    subDomain: 'pearlos',
    tenantId: 'local-dev',
    allowAnonymousLogin: true
  }
}
```

### Seed Data Additions
1. **Pearl Assistant** - Complete working assistant
2. **Pearl Personality** - Linked personality block
3. **Default User** - Local development user
4. **Sample Notes** - Example content
5. **Welcome Instructions** - Guide for developers

---

## Phase 3: Internal Reference Cleanup

### References to Scrub

| Pattern | Files Affected | Action |
|---------|---------------|--------|
| `577124901432` (AWS Account ID) | ~108 files | Remove/replace with placeholder |
| `cjiyu8c46p5t` (RDS identifier) | Few files | Remove |
| `niaxp.com` | Documentation, configs | Replace with `example.com` |
| `nxops.net` | Configs | Replace with `example.com` |
| `pearlos.daily.co` | Daily config | Make configurable via env |

### "pearlos" References - Keep or Update?

The name "pearlos" is used throughout the codebase as:
1. Assistant subdomain identifier
2. Test fixture names
3. Default fallback values

**Decision needed**: Keep "pearlos" as the default demo assistant name, or rename to something generic?

**Recommendation**: Keep "pearlos" - it's the product identity and removing it would be extensive. Just ensure it works locally.

---

## Phase 4: Graceful Feature Degradation

### Feature Matrix

| Feature | Required API Keys | Fallback Behavior |
|---------|------------------|-------------------|
| **Chat (text)** | OpenAI API Key | Display message: "Add OPENAI_API_KEY for AI chat" |
| **Voice Calls** | Daily.co, Deepgram, OpenAI | Hide voice button, show setup guide |
| **TTS (Voice Output)** | None (Kokoro local) | ✅ Works locally with Chorus |
| **Notes** | None | ✅ Works fully locally |
| **HTML Generation** | OpenAI | Disable AI generation, allow manual HTML |
| **YouTube** | YouTube API Key (optional) | Basic embedding still works |
| **Gmail/Drive** | Google OAuth | Hide Google features |
| **Mini Browser** | None | ✅ Works fully locally |

### Implementation

```typescript
// Example: Check for voice feature availability
function isVoiceAvailable(): boolean {
  const hasDaily = !!process.env.DAILY_API_KEY;
  const hasDeepgram = !!process.env.DEEPGRAM_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  
  return hasDaily && hasDeepgram && hasOpenAI;
}

// Example: UI component
function VoiceCallButton() {
  if (!isVoiceAvailable()) {
    return <SetupVoiceGuide />;  // Show helpful setup instructions
  }
  return <ActualCallButton />;
}
```

---

## Phase 5: Start Script Modes

### Add to `package.json`

```json
{
  "scripts": {
    "start:all": "turbo run dev",
    "start:simple": "turbo run dev --filter=!pipecat-daily-bot",
    "start:minimal": "npm run dev -w @nia/mesh-server",
    "start:interface": "npm run dev -w interface",
    "start:dashboard": "npm run dev -w dashboard"
  }
}
```

### Or Create `start.sh` with Modes

```bash
#!/bin/bash
case "$1" in
  --minimal)
    echo "Starting minimal mode (Mesh API only)..."
    npm run dev -w @nia/mesh-server
    ;;
  --simple)
    echo "Starting simple mode (no voice bot)..."
    npm run start:simple
    ;;
  *)
    echo "Starting full platform..."
    npm run start:all
    ;;
esac
```

---

## Phase 6: Documentation Updates

### Files to Update

1. **README.md** - Simplify quick start, emphasize local-first
2. **SETUP_FROM_SCRATCH.md** - Already good, minor tweaks
3. **SIMPLE_SETUP.md** - Update for new seed data
4. **config/env.minimal.example** - Ensure all placeholders documented

### New Files to Create

1. **CONTRIBUTING.md** - Contribution guidelines
2. **CODE_OF_CONDUCT.md** - Community standards
3. **docs/LOCAL_DEVELOPMENT.md** - Deep dive on local setup

---

## Implementation Order

### Step 1: Enhance Seed Script (Priority: HIGH)
- Update `scripts/seed-db.ts` with proper pearlos assistant
- Add personality block
- Add welcome note
- Test that seeded data works with interface

### Step 2: Archive AWS Scripts (Priority: MEDIUM)
- Create `archive/scripts/` directory
- Move all AWS-dependent scripts
- Update any references in `package.json`

### Step 3: Internal Reference Cleanup (Priority: MEDIUM)
- Run grep for AWS account IDs
- Replace with placeholders or remove
- Make Daily domain configurable

### Step 4: Graceful Degradation (Priority: MEDIUM)
- Add env checks for optional features
- Create helpful UI messages when features unavailable
- Ensure nothing crashes without API keys

### Step 5: Add Start Modes (Priority: LOW)
- Add `--simple` and `--minimal` options
- Update documentation

### Step 6: Documentation (Priority: LOW)
- Create CONTRIBUTING.md
- Create CODE_OF_CONDUCT.md
- Update README.md

---

## Testing Plan

### Local Development Test Matrix

| Scenario | Expected Result |
|----------|-----------------|
| Fresh clone, run setup.sh | All dependencies installed |
| npm run pg:seed | Database seeded with pearlos |
| npm run start:all | All services start |
| Visit http://localhost:3000 | Interface loads |
| Visit http://localhost:3000/pearlos | Pearl assistant loads |
| Visit http://localhost:4000 | Dashboard loads (no auth) |
| http://localhost:2000/graphql | GraphQL playground works |
| Voice without API keys | Graceful message shown |
| Voice with API keys + Chorus | Full voice conversation |

### Platforms to Test
- [ ] Linux (Ubuntu 22.04+)
- [ ] macOS (Apple Silicon + Intel)
- [ ] Windows (WSL2 / Git Bash)

---

## Files to Ignore for Now

As per your request, these will be addressed later:
- Git history cleanup (potential BFG usage)
- `conductor/` directory decision
- License selection
- Full internal domain scrubbing

---

## Questions Resolved ✓

| Question | Answer |
|----------|--------|
| Git history strategy | Defer to later |
| Archive vs Delete | Archive, keep list of deletables |
| AWS scripts | Remove unless needed locally |
| Internal references | Remove AWS account ID, defer domains |
| Conductor directory | Defer decision |
| Voice features | Kokoro/Chorus default, ElevenLabs fallback, graceful degradation |
| Target audience | Developers learning + self-hosters |
| Historical reference | Current setup is good, focus on isolation |
| Chorus submodule | Keep as submodule |

---

## Next Steps

1. **Approve this plan** - Review and confirm approach
2. **Start with seed script** - Most impactful for immediate usability
3. **Iterate** - Test locally after each phase

---

*Document created for open-source preparation planning. Ready for implementation upon approval.*

