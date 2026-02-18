# Pearl-OS Setup Flow - Fresh macOS Installation

This document describes the complete setup flow for Pearl-OS on a **completely fresh macOS system** that doesn't have Xcode, Homebrew, or any development tools installed.

## Prerequisites

- macOS (Intel or Apple Silicon)
- Terminal access
- Internet connection
- Administrator password (for installing system packages)

## Step-by-Step Flow

### 1. Initial Launch

```bash
bash new-setup.sh
```

**What happens:**
- Script detects macOS operating system
- Checks if Node.js and `inquirer` are available for TUI
- If TUI is available, shows interactive menu; otherwise falls back to simple prompts

### 2. TUI Preset Selection (if TUI available)

**Prompt appears:**
```
Choose a setup preset:
  ❯ Full setup (all steps)
    Minimal setup (essential steps only)
    Custom (choose individual steps)
```

**User selects:** Minimal (recommended for first-time setup)

### 3. Step Selection

**Shows checkbox list:**
```
Select setup steps (↑↓ to navigate, Space to toggle, Enter to confirm):
  [x] Permissions / consent
  [x] Assess prerequisites (check what's missing, offer to install)
  [x] Check prerequisites (verify all tools are available)
  [x] Install Node.js (if missing)
  [x] Install Poetry
  [x] Install uv
  [x] Initialize git submodules (chorus-tts)
  [x] Install npm dependencies
  [ ] Install bot Python dependencies (pipecat)
  [ ] Download Chorus assets (Kokoro TTS)
  [x] Setup environment files (.env.local + app envs + bot .env)
  [x] Credentials (API keys → .env.local)
  [x] Setup PostgreSQL (includes seeding)
  [x] Build project (npm run build)
  [x] Start development server (npm run dev)
  [x] Functional prompts (verify project is running)
```

**User confirms:** Press Enter

### 4. Permissions / Consent

**Prompt appears:**
```
This setup will:
  • Install system packages (may require sudo/admin)
  • Create/modify .env files
  • Configure PostgreSQL database
  • Run npm install and other package managers

Proceed? (y/N)
```

**User selects:** Yes

### 5. Assess Prerequisites

**System assessment begins:**

```
Assessing system prerequisites...

  ! Homebrew not found
    Homebrew is recommended for installing Node.js, Python, and PostgreSQL on macOS

  ! git not found
  ! curl not found
  ! Node.js not found
  ! Python 3.11+ not found
  ! PostgreSQL not found
  ! Poetry not found
  ! uv not found
```

**Prompt appears:**
```
Missing prerequisites detected:
  • Package managers: Homebrew
  • Basic tools: git, curl
  • Development tools: Node.js, Python 3.11+, PostgreSQL, Poetry, uv

Options:
  1. Install all missing items (recommended)
  2. Install package manager only (Homebrew/apt/etc)
  3. Install tools only (git, Node.js, Python, etc.)
  4. Skip installation (you can install manually later)

Choose option [1-4] (default: 1):
```

**User selects:** 1 (Install all)

### 6. Installing Homebrew

**Prompt appears:**
```
Installing Homebrew...
  This may take a few minutes and may prompt for your password.
```

**User enters:** Administrator password when prompted

**What happens:**
- Downloads and installs Homebrew via official installer script
- Installs to `/opt/homebrew/bin/brew` (Apple Silicon) or `/usr/local/bin/brew` (Intel)
- Automatically adds Homebrew to PATH
- Updates shell profile (`~/.zshrc` or `~/.bash_profile`) for persistence

**Output:**
```
  ✓ Homebrew installed and PATH updated
```

### 7. Installing Missing Tools via Homebrew

**Progress shown:**
```
Installing missing tools...

  Installing git via Homebrew...
  ✓ git installed

  Installing curl via Homebrew...
  ✓ curl installed

  Installing Node.js via Homebrew...
  ✓ Node.js installed

  Installing Python 3.11+ via Homebrew...
  ✓ Python 3.11 installed

  Installing PostgreSQL via Homebrew...
  ✓ PostgreSQL installed

  Installing Poetry...
  ✓ Poetry installed

  Installing uv...
  ✓ uv installed

  ✓ PATH refreshed - Node.js and npm are available
```

### 8. Check Prerequisites

**Verification:**
```
Checking prerequisites...

  ✓ git found
  ✓ curl found
  ✓ Node.js found (v20.x.x)
  ✓ npm found (v10.x.x)
  ✓ Python 3.11+ found
  ✓ PostgreSQL found
  ✓ Poetry found
  ✓ uv found

  ✓ All prerequisites satisfied
```

### 9. Initialize Git Submodules

**Progress:**
```
Initializing git submodules (chorus-tts)...
  ✓ Submodules initialized
```

### 10. Install npm Dependencies

**Progress:**
```
Installing npm dependencies...
  [This may take several minutes]

  ✓ npm dependencies installed
```

### 11. Setup Environment Files

**If .env.local exists:**
```
Existing environment files detected:
    • .env.local (root)

What would you like to do?
  ❯ Keep all existing env files (just sync secrets)
    Recreate root .env.local only (recommended - apps will sync from root)
    Clear ALL and recreate from scratch
```

**If no .env.local exists:**
```
Creating root .env.local from template...
  Generating secure secrets...
  ✓ Root .env.local created with generated secrets
  Syncing secrets to app env files...
  ✓ All env files configured
```

### 12. Credentials (API Keys)

**Prompt appears:**
```
Would you like to enter API keys now? (Daily.co, OpenAI, Deepgram) (Y/n)
```

**User selects:** Yes

**TTS Provider Selection:**
```
Which TTS (Text-to-Speech) provider would you like to use?
  ❯ Chorus TTS (local, open-source)
    ElevenLabs (cloud, requires API key)
```

**User selects:** Chorus TTS (or ElevenLabs)

**For each API key (Daily, OpenAI, Deepgram, and ElevenLabs if selected):**

**If key exists in .env.local:**
```
DAILY_API_KEY exists: sk-....abcd
  ❯ Use existing key (sk-....abcd)
    Update the API key
    Skip
```

**If key doesn't exist:**
```
DAILY_API_KEY (get from https://dashboard.daily.co):
[Password input, masked with *]
```

**After all keys collected:**
```
  ✓ API keys saved to .env.local
  ✓ Environment files synced
```

### 13. Setup PostgreSQL

**Progress:**
```
Setting up PostgreSQL...

  Using local PostgreSQL installation...
  Starting PostgreSQL service...
  ✓ PostgreSQL service is running
  Setting PostgreSQL password to 'password' (default for local development)...
  ✓ PostgreSQL password verified/set to: password
  Ensuring database 'testdb' exists...
  ✓ Database 'testdb' created
  Verifying PostgreSQL connection...
  ✓ PostgreSQL connection verified
  Saving PostgreSQL credentials to .env.local...
  ✓ PostgreSQL password saved to .env.local: password
  Syncing PostgreSQL credentials to all app env files...
  ✓ Credentials synced
```

**Database Seeding:**
```
Seeding database with initial data...
  This will create:
    • Pearl assistant (configured for local development)
    • Demo user for Interface (demo@local.dev / password123)
    • Admin user for Dashboard (admin@local.dev / admin123)
    • Sample notes and content

Options:
  ❯ Skip (keep existing data)
    Add seed data alongside existing
    Clear all and reseed (destructive!)

[If adding/reseeding:]
  ✓ Database seeded successfully
```

**Note:** Functional prompts seeding happens later (after dev server starts)

### 14. Build Project

**Progress:**
```
Building Pearl-OS project...

  Running: npm run build
  [Building... This may take a few minutes]
  ⠋ Building...
  ⠙ Building...
  ...
  ✓ Build process completed
  ✓ Build completed successfully
```

**If build fails:**
```
  ✗ Build failed with exit code 1

  Build error output:
  ──────────────────────────────────────────────────────────
  [Error details shown]
  ──────────────────────────────────────────────────────────

  Would you like to:
    1) Try to fix common build issues automatically
    2) Show full build log
    3) Skip build and continue
    4) Abort setup

  Choose option [1-4] (default: 3):
```

### 15. Start Development Server

**Progress:**
```
Starting Pearl-OS development server...

  Starting: npm run dev
  Note: This will run in the background.

  Waiting for server to start...
  ✓ Development server started successfully

  Server is running at:
    • http://localhost:3000 (Interface)
    • http://localhost:4000 (Dashboard)
    • http://localhost:2000/graphql (Mesh GraphQL)

  Dev server PID: 12345
  Logs: /tmp/pearl-os-dev.log
  To stop: kill $(cat /tmp/pearl-os-dev.pid)
```

### 16. Functional Prompts

**Progress:**
```
Functional verification prompts

  ✓ Development server is running

  Waiting for server to be fully ready...
  Waiting... 1s
  Waiting... 2s
  ...
  ✓ Server is ready

  Seeding functional prompts...
  This will create functional prompt definitions for bot tools

  [Processing prompts...]
  ✓ Functional prompts seeded successfully
```

**Verification prompts:**
```
Let's verify the project is working correctly:

Please verify the following:
  1) Open http://localhost:3000 in your browser
  2) Check if the interface loads correctly
  3) Try navigating to different pages

Is the interface working correctly? (y/N):
```

**User verifies and responds:** Yes

```
Additional checks:
  4) Check http://localhost:2000/graphql (GraphQL Playground)
  5) Check http://localhost:4000 (Dashboard, if available)

Are all services working? (y/N):
```

**User verifies and responds:** Yes

```
  ✓ All services verified

  Next steps:
    • Keep the dev server running for development
    • View logs: tail -f /tmp/pearl-os-dev.log
    • Stop server: kill $(cat /tmp/pearl-os-dev.pid)
    • Restart: npm run dev
```

### 17. Setup Complete

**Final message:**
```
═══════════════════════════════════════════════════════════════
  ✓ All selected steps completed.
═══════════════════════════════════════════════════════════════
```

## What Gets Installed

### System Packages (via Homebrew)
- **Homebrew** - Package manager
- **git** - Version control
- **curl** - HTTP client
- **Node.js** (LTS version) - JavaScript runtime
- **Python 3.11+** - Python interpreter
- **PostgreSQL** - Database server

### Development Tools
- **Poetry** - Python dependency manager
- **uv** - Fast Python package installer

### Project Dependencies
- **npm packages** - All Node.js dependencies from `package.json`
- **Python packages** - Bot dependencies (if selected)
- **Chorus TTS models** - Voice synthesis models (if selected)

## What Gets Created

### Environment Files
- `.env.local` (root) - Main environment configuration
- `apps/interface/.env.local` - Interface app config
- `apps/dashboard/.env.local` - Dashboard app config
- `apps/mesh/.env.local` - Mesh GraphQL config
- `apps/pipecat-daily-bot/.env` - Bot configuration

### Database
- PostgreSQL database: `testdb`
- Seeded with:
  - Pearl assistant
  - Demo users (demo@local.dev, admin@local.dev)
  - Sample content

### Build Artifacts
- Compiled Next.js applications
- TypeScript compiled to JavaScript
- Optimized production builds

## Access Information

### Web Interfaces
- **Interface:** http://localhost:3000
- **Dashboard:** http://localhost:4000
- **GraphQL Playground:** http://localhost:2000/graphql

### Login Credentials
- **Interface:** demo@local.dev / password123
- **Dashboard:** admin@local.dev / admin123

### Database
- **Host:** localhost
- **Port:** 5432
- **Database:** testdb
- **User:** postgres
- **Password:** password

## Troubleshooting

### If Homebrew Installation Fails
- Check internet connection
- Ensure you have administrator privileges
- Try manual installation: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`

### If PostgreSQL Won't Start
```bash
brew services start postgresql@15
# or
brew services start postgresql
```

### If Build Fails
- Check Node.js version: `node --version` (should be LTS)
- Clear cache: `rm -rf .next node_modules/.cache`
- Reinstall dependencies: `npm install`

### If Dev Server Won't Start
- Check if ports are in use: `lsof -ti:3000`
- Check logs: `tail -f /tmp/pearl-os-dev.log`
- Restart: `npm run dev`

## Next Steps After Setup

1. **Keep dev server running** for development
2. **Access the interface** at http://localhost:3000
3. **Configure additional features** as needed
4. **Start TTS service** (if using Chorus): `npm run chorus:start`
5. **Join voice calls** to test bot functionality

## Notes

- All installations are done via Homebrew (no Xcode Command Line Tools required upfront)
- Homebrew installation automatically handles PATH updates
- PostgreSQL password is set to `password` by default (change for production)
- Dev server runs in background; logs are at `/tmp/pearl-os-dev.log`
- Functional prompts seeding requires the dev server to be running

