# Setup Script (Chocolatey) – Edge Cases & Behavior Matrix

This document analyzes **what gets installed** and **when the Choco-first setup can break**, for every combination of “what the user already has.” Use it to decide one-liner wording, script logic, and docs.

---

## 1. Why not hardcode PostgreSQL 16?

**Problem with `choco install postgresql16` only:**

- A user who **already has PostgreSQL 17** (or 15, 18) from Choco, EDB installer, or manual install has `psql` on PATH. The script should **use that** and do **no** PostgreSQL install.
- If the script **always** runs `choco install postgresql16` when `psql` is missing:
  - **Fresh machine:** Works (installs 16).
  - **User has 17 or 18:** They don’t have `psql` on PATH (e.g. only installed server, or PATH not set). Running `choco install postgresql16` can:
    - Install a **second** PostgreSQL (16) alongside 17/18 → two versions, two ports or one overwriting the other, confusion.
    - Or Choco may upgrade/downgrade depending on package logic.
- So the script should **never assume “install 16”**. It should be **version-agnostic**.

**Recommended strategy:**

| Scenario | Script behavior |
|----------|-----------------|
| `psql` already on PATH (any version) | **Do not install** PostgreSQL. Use existing `psql`/`createdb`. App only needs host/port/user/password/db; PG 12+ is fine. |
| `psql` missing and we install via Choco | Use **`postgresql`** (Choco’s “latest” meta package, e.g. 18.x) so we don’t force 16 and conflict with existing 17/18. |
| One-liner in README | Prefer: `choco install postgresql -y` (or “install one of: postgresql, postgresql17, postgresql16”). Avoid documenting only `postgresql16` for fresh installs if we want to stay version-agnostic. |

**Summary:** Use **“any existing `psql`”** when present; for **fresh install** use Choco’s **`postgresql`** (latest), not `postgresql16`, so users with 17 or 18 are never forced a second or wrong version.

---

## 2. What the user has → What gets installed (matrix)

Assumption: script uses **Chocolatey** for git, nodejs, python, uv, postgresql (latest). **Poetry is not on Chocolatey** (0 community packages); the script installs it via **pip** after Choco.

```text
choco install git nodejs python postgresql uv -y
pip install --user poetry
```

| User already has | What Choco does | Result / Risk |
|------------------|-----------------|---------------|
| **Nothing** | Installs all. | Works. Best case. |
| **Only Git** | Installs nodejs, python, postgresql, poetry, uv. | Works. |
| **Only Node** | Installs git, python, postgresql, poetry, uv. | Works. Node version might be upgraded if Choco’s is newer. |
| **Only Python** | Installs git, nodejs, postgresql, poetry, uv. | Works. Python may be upgraded; see “Multiple Pythons” below. |
| **Only PostgreSQL (17)** | Installs git, nodejs, python, poetry, uv. **Does not install postgresql** if we **only run Choco for missing tools** (see below). If we always run full line: Choco may install `postgresql` (18) → **two PG versions**. | **Edge case:** Prefer “install only missing” so we never run `choco install postgresql` when `psql` already exists. |
| **Only Poetry** | Installs git, nodejs, python, postgresql, uv. | Works. |
| **Only uv** | Installs git, nodejs, python, postgresql, poetry. | Works. |
| **Chocolatey only** (no other tools) | Installs all packages. | Works. |
| **All tools** | Choco reports “already installed” for each. No change. | Works. |

**Important:** To avoid “user has PG 17, script installs PG 18,” the script should **check for `psql` first**. If `psql` is on PATH, **do not** add `postgresql` to the list of packages to install. Same idea for other tools: only install what’s missing (or run one full line and rely on Choco idempotency, but then we must not add postgresql when psql exists).

---

## 3. Edge cases that can break the approach

### 3.1 PostgreSQL

| Edge case | What breaks | Mitigation |
|-----------|-------------|------------|
| User has **PostgreSQL 17** (or 18), but `psql` **not on PATH** (e.g. EDB installer, or only server installed). | Script thinks “no PostgreSQL” and runs `choco install postgresql` → second instance or version conflict. | Check for `psql` in PATH **and** optionally scan `C:\Program Files\PostgreSQL` for existing install; if found, add that `bin` to PATH for the session and **do not** install via Choco. |
| User has **two major versions** (e.g. 16 and 17). | PATH might point to one; script or app might expect the other. | Script uses whatever `psql` resolves to; ensure .env points to that instance (localhost:5432). Document “use one PostgreSQL instance for Nia.” |
| User has **PostgreSQL from WSL or Docker**. | `psql` not on Windows PATH; script tries to install Windows PostgreSQL. | Acceptable: script installs Windows PG for Windows-native runs. Document that “local” means Windows PG unless using WSL/Docker explicitly. |
| Choco package **postgresql** = “latest” (e.g. 18). | Enterprise policy might require 16 or 17. | Document: for version pinning use `postgresql16` or `postgresql17` manually; script uses `postgresql` (latest) when it installs. |

### 3.2 Python

| Edge case | What breaks | Mitigation |
|-----------|-------------|------------|
| User has **Python 3.10** (or 3.9). App needs **3.11+**. | Bot/Poetry may fail. | Script checks `python --version` (or `py -3.11`) and warns or fails with “Need Python 3.11+; run choco install python or upgrade.” |
| **Windows Store Python** vs **Choco Python**. | Two Pythons; `python` may point to Store; Choco installs to Program Files. | After Choco, PATH order may put Choco’s Python first. Document “if you use Store Python, ensure 3.11+ or switch to Choco Python.” |
| **py launcher** only (e.g. `py -3.11` works but `python` doesn’t). | Script that only checks `python` thinks Python is missing. | Optional: check `py -3.11 --version` as fallback and use `py -3.11` for Poetry/uv in script. |
| **Multiple Pythons** (3.10, 3.11, 3.12). | Choco might upgrade or add another; Poetry/uv might pick wrong one. | Rely on PATH; recommend “one system Python for this project” or use project venv. |

### 3.3 Node

| Edge case | What breaks | Mitigation |
|-----------|-------------|------------|
| User has **nvm-windows** or **fnm**. | Choco installs Node to Program Files; nvm/fnm may override in shell. | After Choco, `node` might be from nvm in new shells. Script runs in same session after refreshenv; document “if using nvm, ensure Node 18+ and run setup.ps1 in that environment.” |
| **LTS vs Current**. | Choco’s `nodejs` might be Current; project might expect LTS. | Document required Node version (e.g. 18+); script can check `node --version` and warn. |
| **Corporate Node** (signed, custom path). | Choco install could conflict or be blocked. | Allow “skip system install” mode; script only checks and fails if missing. |

### 3.4 Chocolatey

| Edge case | What breaks | Mitigation |
|-----------|-------------|------------|
| **Choco not installed.** | Script can’t install anything. | Bootstrap: install Choco (Admin), then ask user to **close and reopen PowerShell** and re-run script. Document clearly. |
| **Not running as Administrator.** | Choco installs (e.g. to Program Files) may fail. | Detect elevation; warn “Run PowerShell as Administrator for system installs” or “Install Chocolatey and run choco install … in an elevated window.” |
| **ExecutionPolicy** restricts script. | `setup.ps1` won’t run. | Document: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` or `Bypass` for process. |
| **Corporate policy** blocks Choco or script execution. | No automated install. | Provide “project-only” path: assume tools exist; only run submodules, npm, env, DB setup. Document manual install steps. |
| **Old Chocolatey.** | Some packages might fail or behave differently. | Optional: check `choco --version` and suggest upgrade: `choco upgrade chocolatey -y`. |

### 3.5 PATH and environment

| Edge case | What breaks | Mitigation |
|-----------|-------------|------------|
| **PATH not refreshed** after Choco in same session. | `node`, `python`, `psql` not found in same run. | Call `refreshenv` (Choco) or custom `Refresh-Environment` after installs so script sees new PATH. |
| **Very long PATH.** | Choco appends; some systems truncate. | Rare; document “if commands not found after install, restart terminal.” |
| **User PATH** vs **Machine PATH.** | Choco usually writes Machine; User can override. | Script refreshes both (Machine + User) when reloading PATH. |

### 3.6 Git

| Edge case | What breaks | Mitigation |
|-----------|-------------|------------|
| **Git from WSL** (e.g. `git` in PATH from WSL). | Script may run Git for Windows; submodules might have line-ending or path quirks. | Prefer Git for Windows on Windows for consistency; document “for Windows setup use Choco Git.” |
| **No Git.** | Submodule init fails. | Choco installs git; then re-run or continue. |

### 3.7 Poetry / uv

| Edge case | What breaks | Mitigation |
|-----------|-------------|------------|
| **Poetry installed via pip** (user Scripts). | Choco installs Poetry to Chocolatey bin; two Poetrys. | PATH after Choco typically has Choco first; script uses whichever is first. Optional: uninstall pip Poetry first. |
| **uv only via pip.** | Same as above. | Prefer Choco’s uv for consistency. |
| **Project requires specific Poetry or uv version.** | Choco gives latest. | If needed, document “use `poetry self update` or install specific version manually.” |

### 3.8 Network and proxies

| Edge case | What breaks | Mitigation |
|-----------|-------------|------------|
| **Corporate proxy / no internet.** | Choco and npm/Poetry fail to download. | Document proxy env vars (`HTTP_PROXY`, `HTTPS_PROXY`); or “run on a network where Choco and npm are allowed.” |
| **Firewall blocks Chocolatey or CDNs.** | Install fails. | Document required endpoints or offline install (Choco offline cache). |

### 3.9 Windows version

| Edge case | What breaks | Mitigation |
|-----------|-------------|------------|
| **Windows Server** (e.g. Server 2019/2022). | Same script; some Choco packages might target desktop. | Usually works; test on Server if supported. |
| **Windows 10 vs 11.** | No expected difference for Choco/node/python/postgres. | Document “Windows 10/11.” |

### 3.10 Database seeding and .env

| Edge case | What breaks | Mitigation |
|-----------|-------------|------------|
| **PostgreSQL service not started.** | Script can’t create DB or seed. | Script starts service (e.g. `Start-Service` for `postgresql*`) when possible; document “start PostgreSQL service” if admin required. |
| **Existing DB with different password.** | Script sets `postgres` password to `password`; .env gets `POSTGRES_PASSWORD=password`. If user already set a different password, connection may fail. | Document “script sets postgres password to `password` for local dev”; or detect and reuse existing (complex). |
| **Port 5432 in use** by another app. | PG might use different port or fail. | Script uses default 5432; document “ensure 5432 is free or set POSTGRES_PORT.” |

---

## 4. Summary: script behavior recommendations

1. **PostgreSQL:** Never hardcode “postgresql16”. Use **existing `psql`** if on PATH; if installing via Choco use **`postgresql`** (latest). Optionally detect existing PG in `C:\Program Files\PostgreSQL` and add to PATH instead of installing.
2. **Choco one-liner:** Prefer “install only missing” or a single idempotent line; **exclude `postgresql`** when `psql` is already available.
3. **Refresh:** Always run `refreshenv` or `Refresh-Environment` after Choco so the same script session sees new tools.
4. **Admin:** Document “run as Administrator for system installs” and optionally detect and warn.
5. **Project-only mode:** Support a flag to skip all Choco installs and only run project steps (submodules, npm, env, DB); document for locked-down or “I already have everything” users.
6. **Docs:** In README, recommend `choco install git nodejs python postgresql poetry uv -y` (or “postgresql or postgresql17/postgresql16 if you need a specific version”) and “then run setup.ps1”; list main edge cases (Admin, refreshenv, Python 3.11+, one PostgreSQL instance).

This file should be updated when the script or one-liner changes so the matrix and edge cases stay accurate.
