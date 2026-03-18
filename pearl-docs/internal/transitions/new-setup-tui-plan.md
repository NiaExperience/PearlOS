# New Setup TUI (`new-setup.sh` + `new-setup.ps1`) — Plan

## Objective
Create **interactive, menu-driven setup scripts** that feel like the OpenClaw onboarding CLI: every setup action is selectable, the flow is step-by-step, and the user can run **full setup** or a **custom subset** with clear progress + summaries.

Deliver two entrypoints:
- `new-setup.sh` (bash, Linux/macOS/WSL/Git Bash)
- `new-setup.ps1` (PowerShell, Windows)

Keep existing `setup.sh` / `setup.ps1` behavior intact for automation and “just run everything”.

## Non-goals
- Rewriting setup logic from scratch.
- Adding new system dependencies (e.g., `dialog`, `whiptail`, `fzf`, `gum`) as hard requirements.
- Starting long-running dev servers automatically by default.

## Key constraints / requirements
- **Works before `npm install`**: the TUI cannot depend on Node packages that are only available after install.
- **Low risk**: avoid duplicating large chunks of setup logic; reuse existing functions where possible.
- **Cross-platform parity**: option names and step ordering should match across `.sh` and `.ps1`.
- **Non-interactive mode**: support CI / scripting with flags (no prompts).

## Proposed approach
### 1) Make existing setup scripts “importable”
Minimal edits so `setup.sh` and `setup.ps1` can be **sourced/dot-sourced** without immediately executing `main/Main`.

- `setup.sh`: gate the final `main` call behind a “executed directly” check.
- `setup.ps1`: only call `Main` when not dot-sourced.

This lets the new TUI scripts reuse the existing functions (install/check/env/postgres/etc.) without copying them.

### 2) Implement TUI wrappers
Create:
- `new-setup.sh`: interactive menu + step runner calling functions from sourced `setup.sh`.
- `new-setup.ps1`: interactive menu + step runner calling functions from dot-sourced `setup.ps1`.

The UI will be “terminal wizard” style:
- Presets: `Full`, `Minimal`, `Custom`
- For `Custom`: toggle steps on/off (checkbox-style via repeated toggling menu)
- After selection: show a “plan summary” and confirm before running
- After each step: show success/warn/fail and continue/abort choice (interactive only)

### 3) CLI flags
Both scripts should support equivalent flags:
- `--help` / `-h`
- `--preset full|minimal`
- `--non-interactive` (no prompts; run preset)
- `--dry-run` (print what would run; exit 0)

`minimal` preset should skip the heavyweight/optional parts by default (bot deps, chorus asset download), while still ensuring a usable “web-only” dev environment.

## Step inventory (options)
Mapped to the existing setup scripts’ function boundaries:
- Check prerequisites
- Install Node.js (if missing) *(bash only; Windows uses Chocolatey path already in `setup.ps1`)*
- Install Poetry
- Install uv
- Initialize git submodules (`apps/chorus-tts`)
- Install npm dependencies
- Install bot Python dependencies (pipecat)
- Download Chorus assets (Kokoro)
- Setup env files (with existing keep/recreate/clear choice)
- Setup PostgreSQL (install/configure)
- Seed database + seed functional prompts *(currently happens within Postgres setup in `setup.sh` / `setup.ps1`)*

## Files to change/add
- Update: `setup.sh` (add “only run main if executed directly” guard)
- Update: `setup.ps1` (add “only run Main if executed directly” guard)
- Add: `new-setup.sh`
- Add: `new-setup.ps1`

## Testing strategy
Because interactive TUI is hard to test automatically, rely on:
- `--dry-run` output tests (script exits 0 and prints selected steps)
- `--help` smoke tests (exit 0, prints usage)

Add a small JS test (Jest) or script-based test that runs:
- `bash new-setup.sh --dry-run --preset minimal`
- `bash new-setup.sh --dry-run --preset full`

(PowerShell tests can be added later if CI supports it; for now, ensure the script parses and `--dry-run` works locally.)

## Risks & mitigations
- **Sourcing side effects**: sourcing `setup.sh` sets globals (colors/OS). Mitigate by keeping wrappers minimal and using the provided functions/vars.
- **Windows dot-sourcing**: ensure the guard doesn’t break direct invocation. Validate both: `.\setup.ps1` and `. .\setup.ps1`.
- **Step coupling**: some steps assume prior steps (e.g., `npm install` before `sync:env`). Mitigate by encoding dependencies (auto-select prerequisites or warn).

## Acceptance criteria
- Running `bash new-setup.sh` opens an interactive wizard where each step is selectable and runs in order with clear status output.
- Running `powershell -ExecutionPolicy Bypass -File new-setup.ps1` provides equivalent options and behavior.
- `--dry-run` and `--non-interactive` behave consistently on both scripts.
- Existing `setup.sh` and `setup.ps1` still run “full setup” exactly as before when invoked directly.


