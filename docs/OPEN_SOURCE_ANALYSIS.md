# Nia Universal - Open Source Preparation Analysis

> **Generated:** January 28, 2026  
> **Purpose:** Compare current approach vs early_plan.md and clarify questions for optimal open-source preparation  
> **Status:** ANALYSIS DOCUMENT - NO CHANGES YET

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Comparison: Current Approach vs Early Plan](#3-comparison-current-approach-vs-early-plan)
4. [Questions for Clarification](#4-questions-for-clarification)
5. [Historical Reference Points](#5-historical-reference-points)
6. [Recommendations](#6-recommendations)

---

## 1. Executive Summary

### What Has Already Been Done (Recent Commits)

| Commit | Date | Summary |
|--------|------|---------|
| `8d273060` | Jan 28 | Database seeding script, dashboard auth bypass for local dev |
| `04535b35` | Jan 27 | Setup scripts enhancement, PostgreSQL handling (prefer local over Docker) |
| `6e03d6d5` | Jan 26 | Setup scripts (`setup.sh`, `setup.ps1`), SETUP_FROM_SCRATCH.md, Kokoro docs |
| `25d6291c` | Jan 23 | **MAJOR SCRUB**: Moved all K8s/cloud infra to `archive/infrastructure/`, created `SIMPLE_SETUP.md`, `config/env.minimal.example` |

### Current Approach Summary

The recent commits have already:
- ✅ Archived Kubernetes infrastructure (Helm charts, Tiltfiles, Flux/GitOps)
- ✅ Created simplified setup scripts (`setup.sh`, `setup.ps1`)
- ✅ Created minimal environment template (`config/env.minimal.example`)
- ✅ Added database seeding (`npm run pg:seed`)
- ✅ Created comprehensive documentation (SETUP_FROM_SCRATCH.md, SIMPLE_SETUP.md)
- ✅ Disabled dashboard auth for local development
- ✅ Prefer local PostgreSQL over Docker

### Early Plan (from `early_plan.md`) Summary

The early plan proposes:
- 🔴 **DELETE** sensitive files (secrets, AWS scripts, Terraform)
- 🔄 **SANITIZE** files with internal references
- 📦 **REMOVE** Kubernetes/cloud-specific files entirely
- 📜 **CREATE** setup scripts (`scripts/setup.sh`, `scripts/start.sh`)
- 📝 **UPDATE** .gitignore
- 🔄 **UPDATE** `.example.env.local`

---

## 2. Current State Analysis

### What's Already Archived (Commit `25d6291c`)

```
archive/infrastructure/
├── charts/                 # Helm charts (dashboard, interface, mesh, bot, redis, kokoro-tts)
├── infra/                  # Flux GitOps + Terraform
├── deployments/            # K8s staging manifests
├── Tiltfile                # K8s local dev orchestration
└── Tiltfile.minimal        # Minimal Tilt config
```

**Impact:** These are **not deleted**, just moved. Git history preserved.

### What's Currently in Root (Still Sensitive)

Files that the early plan suggests DELETING but are still present:

| File/Path | Current State | Early Plan Action |
|-----------|---------------|-------------------|
| `archive/infrastructure/charts/*/secrets.*.yaml` | ✅ Moved to archive | DELETE |
| `scripts/get-secrets.sh` | ⚠️ Still exists | DELETE |
| `scripts/sync_secrets.py` | ⚠️ Still exists | DELETE |
| `scripts/set-kube-secrets.sh` | ⚠️ Still exists | DELETE |
| `scripts/generate-k8s-secrets.sh` | ⚠️ Still exists | DELETE |
| `scripts/clone-aws-db.ts` | ⚠️ Still exists | DELETE |
| `scripts/clone-aws-prod-db.ts` | ⚠️ Still exists | DELETE |
| `scripts/bootstrap-prod-db-from-dev.ts` | ⚠️ Still exists | DELETE |
| `scripts/staging-db-*.sh` | ⚠️ Still exists | DELETE |
| `scripts/delete-tenant-aws.ts` | ⚠️ Still exists | DELETE |
| `scripts/copy-content-to-aws.ts` | ⚠️ Still exists | DELETE |

### Current Setup Scripts

**Created:** `setup.sh`, `setup.ps1` at root level
**Early Plan Location:** `scripts/setup.sh`, `scripts/start.sh`

Current scripts provide:
- Cross-platform support (Linux, macOS, Windows)
- Automatic dependency checking (Node, npm, PostgreSQL)
- uv installation for Python dependencies
- Git submodule initialization (Chorus TTS)
- Environment file setup with auto-generated secrets
- PostgreSQL setup (prefers local, falls back to Docker)

---

## 3. Comparison: Current Approach vs Early Plan

### Architecture Diagram Comparison

**Early Plan Proposed:**
```
┌─────────────────────────────────────────────────────────────┐
│  Developer Machine                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Interface   │  │  Dashboard   │  │   Mesh API   │      │
│  │  :3000       │  │  :4000       │  │   :2000      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                           │                                 │
│  ┌────────────────────────┴─────────────────────────┐      │
│  │              Docker Compose                       │      │
│  │  ┌──────────────┐         ┌──────────────┐       │      │
│  │  │  PostgreSQL  │         │    Redis     │       │      │
│  │  └──────────────┘         └──────────────┘       │      │
│  └───────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

**Current Approach (Implemented):**
```
┌─────────────────────────────────────────────────────────────┐
│  Developer Machine                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Interface   │  │  Dashboard   │  │   Mesh API   │      │
│  │  :3000       │  │  :4000       │  │   :2000      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                           │                                 │
│  LOCAL PostgreSQL (preferred) OR Docker (fallback)          │
│  ┌──────────────┐                                           │
│  │  PostgreSQL  │   Redis: OPTIONAL (USE_REDIS=false)      │
│  │  :5432       │   Chorus TTS: For voice features         │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
```

### Feature Comparison

| Aspect | Early Plan | Current Implementation | Better? |
|--------|------------|----------------------|---------|
| K8s infrastructure | DELETE entirely | ARCHIVE (preserves history) | ✅ Current |
| Secrets files | DELETE | Archived but still accessible | ⚠️ Depends |
| AWS scripts | DELETE | Still in `scripts/` | ⚠️ Need to address |
| Setup scripts | `scripts/setup.sh` | Root `setup.sh` | Equal |
| Start scripts | `scripts/start.sh` with modes | `npm run start:all` | ✅ Current (simpler) |
| PostgreSQL | Docker only | Local preferred, Docker fallback | ✅ Current |
| Redis | Docker | Optional (`USE_REDIS=false`) | ✅ Current |
| Database seeding | Not mentioned | `npm run pg:seed` added | ✅ Current |
| Dashboard auth | Not mentioned | Disabled for local dev | ✅ Current |
| Documentation | Not detailed | Comprehensive (3+ setup docs) | ✅ Current |

### What Early Plan Has That Current Doesn't

1. **`scripts/start.sh` with modes:**
   ```bash
   ./scripts/start.sh           # Full platform
   ./scripts/start.sh --simple  # No voice bot
   ./scripts/start.sh --minimal # API only
   ```
   
2. **Explicit sensitive file deletion** (vs archiving)

3. **Internal domain scrubbing instructions:**
   ```bash
   grep -rn "pearlos" --include="*.ts" ...
   grep -rn "niaxp.com" --include="*.ts" ...
   grep -rn "577124901432" ...  # AWS Account ID
   ```

4. **Recommended documentation files:**
   - CONTRIBUTING.md
   - CODE_OF_CONDUCT.md
   - LICENSE file review

5. **Git history consideration:**
   > "Review git history for sensitive data (consider `git filter-branch`)"
   > "Create fresh repository if history contains secrets"

---

## 4. Questions for Clarification

### Critical Questions

**Q1: Git History Strategy**
> Are we planning to keep git history or create a fresh repository?

- **Option A:** Keep history, use `git filter-branch` or BFG Repo Cleaner to remove sensitive data
- **Option B:** Create a fresh repository with a clean commit history
- **Impact:** If keeping history, we need to scrub ALL sensitive data from history, not just current files

**Q2: Archive vs Delete**
> Should archived infrastructure files be included in open source or completely removed?

- **Option A:** Keep `archive/infrastructure/` for reference (someone might want K8s deployment)
- **Option B:** Delete entirely (cleaner, smaller repo, less confusion)
- **Option C:** Move to a separate repository (`nia-universal-infrastructure`)

**Q3: AWS Scripts**
> What should happen to AWS-specific scripts that are still in `scripts/`?

| Script | Purpose | Keep/Delete/Archive |
|--------|---------|---------------------|
| `clone-aws-db.ts` | Clone production data | ? |
| `clone-aws-prod-db.ts` | Clone prod specifically | ? |
| `bootstrap-prod-db-from-dev.ts` | Bootstrap prod | ? |
| `staging-db-*.sh` (4 scripts) | Staging database ops | ? |
| `delete-tenant-aws.ts` | Delete tenant from AWS | ? |
| `copy-content-to-aws.ts` | Copy data to AWS | ? |
| `get-secrets.sh` | Retrieve K8s secrets | ? |
| `sync_secrets.py` | Sync secrets | ? |
| `set-kube-secrets.sh` | Set K8s secrets | ? |
| `generate-k8s-secrets.sh` | Generate K8s secrets | ? |

**Q4: Internal References**
> Are there any internal domain names, account IDs, or identifying information that should be scrubbed?

The early plan mentions:
- `pearlos` references
- `niaxp.com` domain
- `nxops.net` domain
- `577124901432` (AWS Account ID)
- `cjiyu8c46p5t` (RDS cluster identifier)

**Q5: Conductor Directory**
> Should `conductor/` be included? It contains:
- Product roadmap
- Guidelines
- Tech stack documentation
- Code style guides

**Q6: Voice Features**
> For open source, should voice features be:

- **Option A:** Fully enabled (requires Daily.co, Deepgram, OpenAI keys)
- **Option B:** Gracefully disabled by default (platform works without them)
- **Option C:** Documented as optional with clear setup instructions

**Q7: Target Audience**
> Who is the target user for the open source version?

- Developers who want to learn from the codebase?
- Developers who want to build similar products?
- Developers who want to contribute back?
- Potential customers who want to self-host?

### Technical Questions

**Q8: Historical Reference Point**
> You mentioned "take reference of that code checkout" - which specific commit/state did `npm run start:all` work perfectly with minimal setup?

Looking at git history, the project has always been designed around K8s/Tilt development. The "simple" path (`npm run start:all` via Turbo) was always available but the focus was cloud deployment.

**Q9: Chorus TTS Submodule**
> Should `apps/chorus-tts/` remain a git submodule or be inlined?

- **Submodule:** Separate repo, cleaner boundaries
- **Inline:** Simpler setup, no `git submodule update` needed

**Q10: License**
> What license should be used?

- MIT (very permissive)
- Apache 2.0 (patent protection)
- AGPL (copyleft, requires source disclosure)
- Proprietary with source available

---

## 5. Historical Reference Points

### Early Simple State

Looking at early commits (June-July 2025):
- `35f00bc8` - Pipecat daily bot added (August 2025)
- Before this, the platform was simpler

### When `npm run start:all` Was Cleanest

The `start:all` script has been `turbo run dev` since early on. The complexity wasn't in this command but in:
1. Environment setup
2. Database availability
3. Python dependencies (Pipecat bot)
4. Redis requirements

### Current State Works Well

The recent commits (`6e03d6d5`, `04535b35`, `8d273060`) have made the setup much cleaner:
- `setup.sh` handles everything automatically
- `npm run start:all` just works
- Database seeding available via `npm run pg:seed`
- Dashboard auth bypassed for local dev

---

## 6. Recommendations

### Recommendation 1: Build on Current Approach (Not Start Over)

The current implementation is **better** than the early plan in several ways:
- Archiving vs deleting preserves optionality
- Database seeding provides better developer experience
- Documentation is comprehensive
- PostgreSQL flexibility (local vs Docker) is practical

### Recommendation 2: Complete the Cleanup

What still needs to be done:

```bash
# 1. Delete or archive remaining AWS scripts
scripts/clone-aws-db.ts
scripts/clone-aws-prod-db.ts
scripts/bootstrap-prod-db-from-dev.ts
scripts/staging-db-*.sh
scripts/delete-tenant-aws.ts
scripts/copy-content-to-aws.ts
scripts/get-secrets.sh
scripts/sync_secrets.py
scripts/set-kube-secrets.sh
scripts/generate-k8s-secrets.sh

# 2. Scrub internal references (if any)
# Run searches for internal domains/IDs

# 3. Add missing documentation
# CONTRIBUTING.md
# CODE_OF_CONDUCT.md
# Review LICENSE
```

### Recommendation 3: Address Git History

If the git history contains:
- AWS account IDs
- Internal domain names
- API keys (even expired ones)
- Production database credentials

Then you should either:
1. Use BFG Repo Cleaner to remove sensitive strings
2. Create a fresh repository

### Recommendation 4: Optional Mode Scripts

Add the `--simple` and `--minimal` modes from early plan:

```bash
# In setup.sh or as new start.sh
npm run start:all              # Full platform with voice
npm run start:simple           # Without Pipecat bot
npm run start:minimal          # Only Mesh API
```

### Recommendation 5: Final Checklist

Before open source release:

- [ ] AWS scripts cleaned (deleted or moved to archive)
- [ ] Internal domain references scrubbed
- [ ] Git history reviewed (or fresh repo created)
- [ ] CONTRIBUTING.md created
- [ ] CODE_OF_CONDUCT.md created
- [ ] LICENSE finalized
- [ ] All environment variables documented
- [ ] Voice features gracefully optional
- [ ] `conductor/` directory decision made
- [ ] Fresh machine test (Linux, macOS, Windows)

---

## Summary Table

| Topic | Status | Action Needed |
|-------|--------|---------------|
| K8s infrastructure | ✅ Archived | Consider full delete? |
| Setup scripts | ✅ Done | Maybe add start modes |
| Env template | ✅ Done | None |
| Database seeding | ✅ Done | None |
| Documentation | ✅ Done | Add CONTRIBUTING, CODE_OF_CONDUCT |
| AWS scripts | ⚠️ Still present | Delete or archive |
| Internal references | ⚠️ Unknown | Need to search |
| Git history | ⚠️ Unknown | Need review |
| License | ⚠️ Not addressed | Need decision |

---

## Next Steps

Once you answer the clarification questions above, I can:

1. Create a detailed implementation plan
2. Write specific scripts to clean sensitive data
3. Generate CONTRIBUTING.md and CODE_OF_CONDUCT.md
4. Create a pre-release checklist script
5. Help with git history cleanup if needed

---

*Document generated for open-source preparation analysis. No changes have been made to the codebase.*

