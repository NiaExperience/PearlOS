# Nia Universal - Setup Instructions

Complete step-by-step guide for setting up Nia Universal from a zip file.

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Extracting the Project](#extracting-the-project)
3. [Platform-Specific Setup](#platform-specific-setup)
4. [Running the Setup Script](#running-the-setup-script)
5. [Adding API Keys](#adding-api-keys)
6. [Starting the Platform](#starting-the-platform)
7. [Verifying Everything Works](#verifying-everything-works)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting, ensure you have:

- **Node.js** (v20 or higher) - [Download](https://nodejs.org/)
- **Git** - [Download](https://git-scm.com/downloads)
- **Python 3.11+** - [Download](https://www.python.org/downloads/)
- **PostgreSQL** (will be installed automatically if missing)
- **Internet connection** (for downloading dependencies and API keys)

### Quick Check

Open a terminal/command prompt and verify:

```bash
node --version    # Should be v20 or higher
npm --version     # Should be v9 or higher
git --version     # Any recent version
python --version  # Should be 3.11 or higher
```

---

## Extracting the Project

1. **Extract the zip file** to a location of your choice
   - Example: `C:\Projects\nia-universal` (Windows) or `~/Projects/nia-universal` (macOS/Linux)

2. **Open a terminal/command prompt** in the extracted folder
   - **Windows**: Right-click in the folder → "Open in Terminal" or "Open PowerShell here"
   - **macOS/Linux**: Open Terminal and `cd` to the folder

3. **Verify you're in the right place** - you should see files like:
   - `package.json`
   - `setup.sh` (Linux/macOS/Git Bash)
   - `setup.ps1` (Windows PowerShell)
   - `README.md`

---

## Platform-Specific Setup

### 🪟 Windows

**Recommended: Use PowerShell** (not Command Prompt)

1. **Open PowerShell** in the project folder
   - Right-click in the folder → "Open in Terminal" or "Open PowerShell here"
   - Or open PowerShell and navigate: `cd C:\path\to\nia-universal`

2. **Run the setup script:**
   ```powershell
   .\setup.ps1
   ```

3. **If you see a security error**, run:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```
   Then try `.\setup.ps1` again.

**Alternative: Git Bash** (if you have Git installed)

1. Open Git Bash in the project folder
2. Run:
   ```bash
   ./setup.sh
   ```

---

### 🍎 macOS

1. **Open Terminal** in the project folder
   - Right-click in the folder → "Services" → "New Terminal at Folder"
   - Or open Terminal and navigate: `cd ~/path/to/nia-universal`

2. **Make the script executable** (first time only):
   ```bash
   chmod +x setup.sh
   ```

3. **Run the setup script:**
   ```bash
   ./setup.sh
   ```

---

### 🐧 Linux

1. **Open Terminal** in the project folder
   - Or navigate: `cd ~/path/to/nia-universal`

2. **Make the script executable** (first time only):
   ```bash
   chmod +x setup.sh
   ```

3. **Run the setup script:**
   ```bash
   ./setup.sh
   ```

---

## Running the Setup Script

The setup script will automatically:

1. ✅ Check prerequisites (Node.js, npm, Python, PostgreSQL)
2. ✅ Install missing dependencies (Poetry, uv, PostgreSQL if needed)
3. ✅ Initialize git submodules (Chorus TTS)
4. ✅ Install Node.js packages (`npm install`)
5. ✅ Install Python dependencies for the bot
6. ✅ Download Kokoro TTS model files (for voice features)
7. ✅ Create environment files (`.env.local` and app-specific files)
8. ✅ Set up PostgreSQL database (`testdb`)
9. ✅ Seed the database with demo data

### During Setup

- **Progress indicators** will show what's happening
- **You may be prompted** to choose options:
  - **Environment files**: Choose option `1` (Keep existing) if files already exist, or `2` (Recreate root) for a fresh start
- **Installation may take 5-15 minutes** depending on your internet speed

### What to Expect

```
[1/12] Checking prerequisites...
[OK] Node.js: v22.20.0
[OK] npm: 10.9.3
[OK] git installed
[OK] PostgreSQL found

[2/12] Checking Poetry...
[OK] Poetry already installed

[3/12] Checking uv...
[OK] uv already installed

[4/12] Installing npm dependencies...
[Progress] Installing packages...
[OK] Dependencies installed

...

[OK] SETUP COMPLETE!
```

---

## Adding API Keys

After setup completes, you need to add your API keys to use the platform features.

### Required API Keys (Minimum)

1. **OpenAI API Key** (for AI features)
   - Get it at: https://platform.openai.com/api-keys
   - Create an account if needed

2. **Daily.co API Key** (for voice features)
   - Get it at: https://dashboard.daily.co
   - Create a free account

3. **Deepgram API Key** (for speech-to-text)
   - Get it at: https://console.deepgram.com/
   - Create a free account

### How to Add API Keys

1. **Open the `.env.local` file** in the project root folder
   - Use any text editor (VS Code, Notepad, TextEdit, etc.)

2. **Find the placeholder lines** and replace them with your actual keys:

   ```bash
   # Before:
   OPENAI_API_KEY=__OPENAI_API_KEY_PLACEHOLDER__
   DAILY_API_KEY=__DAILY_API_KEY_PLACEHOLDER__
   DEEPGRAM_API_KEY=__DEEPGRAM_API_KEY_PLACEHOLDER__

   # After:
   OPENAI_API_KEY=sk-proj-abc123...your-actual-key
   DAILY_API_KEY=eb5b09b8b1cc82ef...your-actual-key
   DEEPGRAM_API_KEY=8531ba5e60c4e616...your-actual-key
   ```

3. **Save the file**

4. **The setup script automatically syncs** these keys to app-specific `.env` files, so you only need to edit the root `.env.local`

### Optional API Keys

- **ElevenLabs API Key**: For cloud-based text-to-speech (if you prefer over local Kokoro)
- **Google OAuth**: For Google sign-in features
- **YouTube API Key**: For video features

---

## Starting the Platform

Once setup is complete and API keys are added:

### Start Everything

```bash
npm run start:all
```

This will start:
- **Interface** (frontend) at http://localhost:3000
- **Dashboard** (admin) at http://localhost:4000
- **Mesh GraphQL** (API) at http://localhost:2000/graphql
- **Bot Gateway** (voice bot) at http://localhost:4444

### First Time Startup

The first time you run `npm run start:all`, it may take 1-2 minutes to:
- Compile TypeScript
- Build packages
- Start all services

You'll see output like:

```
✓ Loaded environment from /path/to/.env.local
✓ Starting...
✓ Ready in 2.6s
```

### Access the Platform

1. **Interface** (Main app): http://localhost:3000/pearlos
   - Login: `demo@local.dev` / `password123`

2. **Dashboard** (Admin): http://localhost:4000
   - Login: `admin@local.dev` / `admin123`

3. **GraphQL Playground**: http://localhost:2000/graphql

---

## Verifying Everything Works

### 1. Check All Services Are Running

Look for these messages in the terminal:

```
✓ Interface running on http://localhost:3000
✓ Dashboard running on http://localhost:4000
✓ Mesh GraphQL running on http://localhost:2000/graphql
✓ Bot gateway running on http://localhost:4444
```

### 2. Test the Interface

1. Open http://localhost:3000/pearlos in your browser
2. You should see the Pearl assistant interface
3. Try typing a message or clicking the voice button

### 3. Test Voice Features (Optional)

If you want to test voice features:

1. **Start Chorus TTS** (in a separate terminal):
   ```bash
   npm run chorus:start
   ```

2. **In the Interface**, click the voice/call button
3. The bot should join the call and respond to your voice

### 4. Check Database

The database should be seeded with:
- Demo tenant ("Local Development")
- Pearl assistant
- Demo user (`demo@local.dev`)
- Admin user (`admin@local.dev`)
- Sample notes

---

## Troubleshooting

### Setup Script Issues

#### "Permission denied" (Linux/macOS)

```bash
chmod +x setup.sh
./setup.sh
```

#### "Execution policy" error (Windows PowerShell)

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\setup.ps1
```

#### "Poetry not found" after installation

- **Windows**: Restart your terminal/PowerShell window
- **macOS/Linux**: Run `source ~/.bashrc` or `source ~/.zshrc`

#### "PostgreSQL not found"

The setup script should install PostgreSQL automatically. If it doesn't:

- **Windows**: Install manually from https://www.postgresql.org/download/windows/
- **macOS**: `brew install postgresql@16`
- **Linux**: `sudo apt install postgresql` (Ubuntu/Debian) or `sudo yum install postgresql` (RHEL/CentOS)

#### "Database already exists" error

This is normal if you've run setup before. The script will use the existing database.

### Runtime Issues

#### "Port already in use"

If you see errors about ports 3000, 4000, or 2000 being in use:

1. **Find what's using the port:**
   - **Windows**: `netstat -ano | findstr :3000`
   - **macOS/Linux**: `lsof -i :3000`

2. **Stop the process** or change the port in `.env.local`

#### "Cannot connect to database"

1. **Check PostgreSQL is running:**
   - **Windows**: Check Services (search "Services" in Start menu, look for "postgresql")
   - **macOS**: `brew services list | grep postgresql`
   - **Linux**: `sudo systemctl status postgresql`

2. **Verify credentials** in `.env.local`:
   ```bash
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=password
   POSTGRES_DB=testdb
   ```

3. **Test connection:**
   ```bash
   psql -h localhost -U postgres -d testdb
   ```

#### "API key not working"

1. **Verify the key is correct** in `.env.local` (no extra spaces, quotes, etc.)
2. **Check the key is active** on the provider's dashboard
3. **Restart the platform** after changing API keys:
   ```bash
   # Stop with Ctrl+C, then:
   npm run start:all
   ```

#### "Bot not responding" (Voice features)

1. **Check Chorus TTS is running:**
   ```bash
   npm run chorus:start
   ```

2. **Verify API keys** are set:
   - `OPENAI_API_KEY`
   - `DAILY_API_KEY`
   - `DEEPGRAM_API_KEY`

3. **Check bot logs** in the terminal running `npm run start:all`

#### "Module not found" errors

1. **Reinstall dependencies:**
   ```bash
   npm install
   ```

2. **Clear cache and reinstall:**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

### Getting Help

If you're stuck:

1. **Check the logs** - Look for error messages in the terminal
2. **Review this guide** - Make sure you followed all steps
3. **Check the README.md** - For more detailed information
4. **Check ARCHITECTURE.md** - For technical details

---

## Quick Reference

### Common Commands

```bash
# Start everything
npm run start:all

# Start individual services
npm run --workspace=interface dev      # Interface only
npm run --workspace=dashboard dev      # Dashboard only
npm run --workspace=mesh dev           # Mesh GraphQL only

# Database operations
npm run pg:seed                        # Seed database with demo data
npm run pg:start                       # Start PostgreSQL (if using Docker helper)
npm run pg:stop                        # Stop PostgreSQL (if using Docker helper)

# Voice features
npm run chorus:start                   # Start Chorus TTS server
npm run chorus:download-assets         # Download Kokoro TTS models

# Development
npm test                               # Run tests
npm run build                          # Build all packages
npm run lint                           # Check code quality
```

### Important Files

- `.env.local` - Main environment file (add your API keys here)
- `setup.sh` / `setup.ps1` - Setup scripts
- `package.json` - Project dependencies and scripts

### Important URLs

- Interface: http://localhost:3000/pearlos
- Dashboard: http://localhost:4000
- GraphQL: http://localhost:2000/graphql
- API Docs: http://localhost:2000/docs

### Default Login Credentials

- **Interface**: `demo@local.dev` / `password123`
- **Dashboard**: `admin@local.dev` / `admin123`

---

## Next Steps

Once everything is working:

1. **Explore the Interface** - Try different features
2. **Read the Developer Guide** - `DEVELOPER_GUIDE.md` for building features
3. **Check the Architecture** - `ARCHITECTURE.md` for system design
4. **Review Features** - `apps/interface/src/features/` to see available features

---

## Summary Checklist

- [ ] Prerequisites installed (Node.js, Python, Git)
- [ ] Project extracted from zip
- [ ] Setup script run successfully
- [ ] API keys added to `.env.local`
- [ ] Platform started (`npm run start:all`)
- [ ] Interface accessible at http://localhost:3000/pearlos
- [ ] Dashboard accessible at http://localhost:4000
- [ ] Can log in with demo credentials
- [ ] (Optional) Voice features working

**You're all set!** 🎉

Enjoy exploring Nia Universal!

