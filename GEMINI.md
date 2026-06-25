# Nia Universal - Agent Context

## Project Overview
Nia Universal is a feature-first, multi-tenant intelligent workspace platform. It emphasizes a small, stable core (identity, unified data access via Prism + Mesh, content models) with optional capabilities implemented as isolated "features".

**Core Architecture Chain:**
`User → Interface Feature → Prism Client → Mesh GraphQL → Providers → Storage`

### Key Directories
- `apps/interface`: Main Next.js user-facing application (port 3000).
- `apps/dashboard`: Admin/Analytics dashboard (port 4000).
- `apps/mesh`: Unified GraphQL API server (port 2000).
- `apps/pipecat-daily-bot`: Python-based voice bot (port 4444).
- `packages/prism`: Data abstraction layer (core).
- `packages/features`: Shared feature flag logic.
- `packages/events`: Event definitions and schemas.

## Primary Workflows

### 1. Build & Run
- **Install Dependencies:** `npm install`
- **Start All Apps:** `npm run start:all` (Interface: 3000, Dashboard: 4000, Mesh: 2000)
- **Focused Dev (Interface):** `npm run --workspace=interface dev`
- **Database Helpers:** `npm run pg:start` / `npm run pg:stop`

### 2. Testing & Quality
- **Unit/Integration:** `npm test` (Runs full suite).
    - **CRITICAL:** NEVER use `--workspaces` with Jest.
    - **Targeted:** `npm run test:js -- --runTestsByPath <path/to/file.test.tsx>`
- **E2E:** `npm run test:e2e` (Cypress).
- **Type Check:** `npm run type-check`
- **Lint:** `npm run lint`

### 3. Kubernetes & Tilt
For a full local Kubernetes development experience using Tilt:

**Prerequisites:**
1. Install Tilt: `brew install tilt`
2. Install Colima (or similar k8s provider): `brew install colima`
3. Start Cluster: `colima start nia-dev --kubernetes --cpu 4 --memory 8`
4. Start Registry:
   ```bash
   docker run -d -p 5000:5000 --restart=always \
     -v $HOME/.local-registry:/var/lib/registry \
     --name registry registry:2
   ```

**Usage:**
- **Full Stack:** `tilt up` (Interface, Dashboard, Mesh, Bot, Redis, Postgres, Chorus TTS)
- **Backend Only:** `tilt up -f Tiltfile.minimal` (Mesh, Bot, Redis, Postgres)

### 4. Feature Development
Features live in `apps/interface/src/features/<FeatureName>/` and must follow the canonical structure:
- `components/`: UI components.
- `actions/`: Server actions.
- `services/`: Long-lived orchestration.
- `index.ts`: Barrel export (defines public API).
- `__tests__/`: Unit & Integration tests.

**Feature Flags:**
- Managed via `@nia/features`.
- Check availability: `isFeatureEnabled('featureKey', assistant.supportedFeatures)`.

## Agent Guidelines & Conventions

### Critical Directives
- **Verification First:** You must review and test your code *before* creating a git commit. A task is only "done" when functionality is validated.
- **Verification Rigor:** Prefer code execution (e.g., `terraform plan`, `kubectl apply --dry-run=client`, `npm test`) over simple code review. Static analysis is the bare minimum; runtime/execution analysis is the goal.
- **E2E Preference:** ALWAYS prefer end-to-end (E2E) testing performed by the AI agent whenever possible (e.g., using `kubectl`, `aws` CLI, or browser automation) to verify real-world functionality.
- **Dependency Validation:** Never assume a library version or feature exists. ALWAYS perform a web search to confirm:
  1. The correct package name and latest stable version.
  2. The existence of the specific features/APIs you intend to use.
  3. The proper usage patterns (don't hallucinate APIs).
- **Deprecation Checks:** Before using a new service or API (especially Cloud infrastructure), verify it is active and available for new customers.
- **User Validation:** If a task requires manual validation (UI/UX, hardware interaction, etc.) or user approval, explicitly ask the user to test and wait for their feedback before committing or marking the task as complete. **NEVER autonomously mark a manual verification task as complete.**

### Coding Standards
- **Isolation:** Packages (`packages/*`) must NEVER import from apps (`apps/*`).
- **Boundaries:** Features communicate via events or core helpers, never deep imports into other features.
- **Data Access:** Always use **Prism** APIs. Never write raw SQL or access storage directly from features.
- **Events:** Must be registered in `packages/events` with a descriptor and redaction rules.

### Environment Interaction
- **Check, Don't Assume:** Do not assume CLI tools (e.g., `flux`, `kustomize`, `aws`, `kubectl`) are missing or present. Verify availability with `which <tool>` or `<tool> --version` before choosing a strategy.
- **Pre-Flight Checks:** Before attempting complex deployments or verifications (especially involving Kubernetes controllers), verify the health of the underlying components (e.g., `kubectl get pods -n flux-system`) to avoid debugging pre-existing failures.
- **Git Safety:** NEVER use `git add .`. Always stage specific files (e.g., `git add path/to/file`) to avoid accidental commits of untracked files or unintended changes.
- **State Verification:** After performing git operations (reset, checkout, revert), explicitly verify the content of critical configuration files (e.g., `cat infra-repo.yaml`) before applying them to the cluster. Do not assume the file state matches your mental model.
- **GitOps Context:** If the project uses GitOps (Flux/Argo), local application of manifests is insufficient. You MUST update the Git repository and verify cluster reconciliation.

### Safety & Security
- **Secrets:** Never commit secrets. Use `.env.local`.
- **PII:** Redact sensitive fields in events/logs.
- **Sanitization:** Validate tool inputs server-side.

### Git Workflow
- **Commits:** Only commit when explicitly asked. Follow conventional commits.
- **PRs:** Update `PR_DOC.md` (ephemeral) with detailed stats and risk analysis before requesting a PR.

### Documentation References
- **Architecture:** `ARCHITECTURE.md` (Deep dive into layers).
- **Protocol:** `docs/ai-assistant-protocol.md` (Mandatory rules).
- **Workflow:** `CLAUDE.md` (Quick reference for AI agents).
- **Agent Specifics:** `AGENTS.md`.

## Common Commands Reference
| Action | Command | Note |
| :--- | :--- | :--- |
| **Start** | `npm run start:all` | Starts Interface, Dashboard, Mesh |
| **Test (All)** | `npm test` | **Do not** use `--workspaces` |
| **Test (File)** | `npm run test:js -- <args>` | e.g. `--runTestsByPath ...` |
| **Lint** | `npm run lint` | |
| **Type Check** | `npm run type-check` | |
| **Sync Protocol**| `npm run sync:ai-protocol` | Run after editing protocol docs |

## Troubleshooting
- **Jest Errors:** Ensure you are NOT using `--workspaces`.
- **Missing Feature:** Check feature flags in `.env.local` and `assistant.supportedFeatures`.
- **Mesh Connection:** Verify Mesh server is running on port 2000 (`http://localhost:2000/graphql`).
