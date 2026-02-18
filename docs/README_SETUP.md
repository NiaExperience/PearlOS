# One-Command Setup

Run **one script** to set up the entire Nia Universal project automatically.

## Quick Start

### Linux / macOS

```bash
./setup.sh
```

Or if you prefer Node.js (works everywhere):

```bash
node setup.js
```

### Windows

**Option 1: Chocolatey + PowerShell (Recommended)**

The script uses [Chocolatey](https://chocolatey.org/) to install system tools (Node, Python, Git, PostgreSQL, Poetry, uv) and refreshes the environment automatically.

1. **Install Chocolatey** (if you don’t have it), in **elevated PowerShell (Run as Administrator)**:
   ```powershell
   Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
   ```
   Then **close and reopen PowerShell**.

2. **Install system dependencies** (in elevated PowerShell):
   ```powershell
   choco install git nodejs python postgresql uv -y
   pip install --user poetry
   ```
   *(Poetry is not on Chocolatey; install it with pip.)* Then **close and reopen PowerShell** (or run `refreshenv`) so `node`, `python`, `psql`, `poetry`, etc. are on PATH.

3. **Run the setup script** (from the repo root):
   ```powershell
   powershell -ExecutionPolicy Bypass -File setup.ps1
   ```
   The script can also install Chocolatey and run the Choco install for you if you run it as Administrator.

**Option 2: PowerShell only (you already have tools)**
```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1 -SkipSystemInstall
```
Use `-SkipSystemInstall` if Node, Python, Git, PostgreSQL, Poetry, and uv are already installed and on PATH.

**Option 3: Git Bash / WSL**
```bash
./setup.sh
```

**Option 4: Node.js**
```cmd
node setup.js
```

---

## What the Script Does

The setup script automatically:

1. ✅ **Ensures Chocolatey** (if not `-SkipSystemInstall`) and installs **git, nodejs, python, postgresql, poetry, uv** via Choco (version-agnostic: uses existing `psql` or Choco’s latest PostgreSQL)
2. ✅ **Checks prerequisites** (Node.js, npm, git, Python 3.11+, PostgreSQL, Poetry, uv)
3. ✅ **Initializes git submodules** (Chorus TTS server code)
4. ✅ **Installs npm dependencies** (all Node.js packages)
5. ✅ **Installs bot Python dependencies** (Poetry)
6. ✅ **Downloads Kokoro model files** (~550MB - neural TTS models)
7. ✅ **Creates `.env.local`** with auto-generated secrets
8. ✅ **Sets up PostgreSQL** (service, password, database `testdb`, seed)

---

## After Setup

Once the script completes, you need to start services in **two terminals**:

### Terminal 1: Chorus TTS Server
```bash
npm run chorus:start
```

### Terminal 2: Main Platform
```bash
npm run start:all
```

Then access:
- **Interface**: http://localhost:3000
- **Dashboard**: http://localhost:4000
- **Mesh GraphQL**: http://localhost:2000/graphql

---

## Manual Setup

If you prefer to set up manually, see `SETUP_FROM_SCRATCH.md` for step-by-step instructions.

---

## Troubleshooting

### "Permission denied" (Linux/macOS)
```bash
chmod +x setup.sh
./setup.sh
```

### "ExecutionPolicy" error (Windows PowerShell)
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
powershell -File setup.ps1
```

### "Missing: node, npm, git, Python 3.11+, psql, poetry, uv" (Windows)
Run in **elevated PowerShell**, then close and reopen the terminal and run `setup.ps1` again:
```powershell
choco install git nodejs python postgresql uv -y
pip install --user poetry
```
(Poetry is not on Chocolatey; use pip.) See `SETUP_CHOCO_EDGE_CASES.md` for edge cases and troubleshooting.

### Script fails at a specific step
Check the error message and see `SETUP_FROM_SCRATCH.md` for manual instructions for that step.

---

## Script Files

- `setup.sh` - Bash script (Linux/macOS/Git Bash/WSL)
- `setup.ps1` - PowerShell script (Windows; uses Chocolatey; supports `-SkipSystemInstall`)
- `setup.js` - Node.js script (cross-platform, works everywhere)

All scripts do the same thing - use whichever is most convenient for your system.

