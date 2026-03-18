# Complete Setup Guide - From Scratch

> **Step-by-step instructions to get Nia Universal running perfectly on a fresh machine**

---

## Prerequisites Check

Before starting, verify you have these installed:

```bash
# Check Node.js (required: ≥20.0.0)
node --version

# Check npm (required: ≥10.0.0)
npm --version

# Check PostgreSQL (required: ≥14) OR Docker
psql --version
# OR
docker --version
```

**Install missing prerequisites:**
- **Node.js**: https://nodejs.org/ (LTS version)
- **Docker**: https://docs.docker.com/get-docker/ (for PostgreSQL)
- **PostgreSQL**: https://www.postgresql.org/download/ (if not using Docker)

---

## Step 1: Clone the Repository

```bash
# Clone the repository
git clone <repository-url>
cd nia-universal

# Initialize git submodules (required for Chorus TTS)
git submodule update --init --recursive
```

**Note:** The `apps/chorus-tts/` directory is a git submodule. If it's empty, the submodule wasn't initialized.

---

## Step 2: Install Dependencies

```bash
# Install all npm packages (this also runs setup-env.mjs)
npm install
```

This will:
- Install all Node.js dependencies
- Set up TypeScript paths
- Initialize Python environments (if needed)

**Expected time:** 2-5 minutes depending on your connection.

---

## Step 3: Set Up Environment Variables

### Option A: Minimal Setup (Recommended for First Run)

```bash
# Copy the minimal standalone config
cp config/env.minimal.example .env.local

# Generate required secrets
openssl rand -base64 32  # Copy this for NEXTAUTH_SECRET
openssl rand -base64 32  # Copy this for MESH_SHARED_SECRET
openssl rand -base64 32  # Copy this for TOKEN_ENCRYPTION_KEY
```

Edit `.env.local` and replace the placeholder values:

```bash
nano .env.local
# or
code .env.local
```

**Required values to set:**
```bash
# === DATABASE ===
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
POSTGRES_DB=testdb

# === AUTH (use the generated secrets) ===
NEXTAUTH_SECRET=<paste-generated-secret-1>
NEXTAUTH_INTERFACE_URL=http://localhost:3000
NEXTAUTH_DASHBOARD_URL=http://localhost:4000

# === DATA LAYER ===
MESH_ENDPOINT=http://localhost:2000/graphql
MESH_SHARED_SECRET=<paste-generated-secret-2>

# === TOKEN ENCRYPTION ===
TOKEN_ENCRYPTION_KEY=<paste-generated-secret-3>
FORCE_ENCRYPTION=true

# === DISABLE OPTIONAL SERVICES ===
USE_REDIS=false
EMAIL_REQUIRE_SES=false
```

### Option B: Full Setup (With Voice Features)

If you want voice conversations, add these to `.env.local`:

```bash
# === VOICE FEATURES ===
DAILY_API_KEY=your-daily-api-key
OPENAI_API_KEY=sk-your-openai-key
DEEPGRAM_API_KEY=your-deepgram-key
BOT_CONTROL_SHARED_SECRET=<generate-with-openssl-rand-base64-32>

# === TTS PROVIDER (default: Kokoro - local, free) ===
# Kokoro is the default. To use it, ensure Chorus server is running (see Step 5)
KOKORO_TTS_BASE_URL=ws://127.0.0.1:8000
KOKORO_TTS_API_KEY=test-key
KOKORO_TTS_VOICE_ID=am_fenrir

# To use ElevenLabs (cloud, paid) instead, set:
# USE_ELEVENLABS=true
# ELEVENLABS_API_KEY=your-elevenlabs-key
```

---

## Step 4: Set Up PostgreSQL Database

### Option A: Using Docker (Recommended)

```bash
# Start PostgreSQL container
docker run -d \
  --name nia-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=testdb \
  -p 5432:5432 \
  postgres:15

# Verify it's running
docker ps | grep nia-postgres
```

### Option B: Using Local PostgreSQL

```bash
# Create database
createdb testdb

# Or using psql
psql -U postgres -c "CREATE DATABASE testdb;"
```

**Verify connection:**
```bash
# Test connection
psql -h localhost -U postgres -d testdb -c "SELECT version();"
```

---

## Step 5: Set Up Kokoro TTS for Local Voice

**Kokoro is the default TTS provider (local, free). This step is required for voice features unless you set `USE_ELEVENLABS=true`.**

```bash
# 1. Download Kokoro model files (~550MB)
npm run chorus:download-assets

# This downloads:
# - apps/chorus-tts/kokoro-v1.0.onnx (~500MB)
# - apps/chorus-tts/voices-v1.0.bin (~50MB)

# 2. Verify files exist
ls -lh apps/chorus-tts/kokoro-v1.0.onnx
ls -lh apps/chorus-tts/voices-v1.0.bin

# 3. Start Chorus TTS server (in a separate terminal)
npm run chorus:start

# Server will run on ws://127.0.0.1:8000
# Keep this terminal open while using voice features
```

**Note:** If you prefer to use ElevenLabs (cloud, paid) instead, set `USE_ELEVENLABS=true` in `.env.local` and you can skip this step.

---

## Step 6: Start the Platform

### First Time (Fresh Database)

```bash
# This will start all services:
# - Interface (http://localhost:3000)
# - Dashboard (http://localhost:4000)
# - Mesh GraphQL (http://localhost:2000/graphql)
npm run start:all
```

**What happens:**
1. All apps build and start
2. Mesh connects to PostgreSQL
3. Database schema is created automatically
4. Services become available

### Subsequent Runs

```bash
# If PostgreSQL is already running
npm run start:all
```

---

## Step 7: Verify Everything Works

### Check Services

Open these URLs in your browser:

| Service | URL | What to Expect |
|---------|-----|----------------|
| **Interface** | http://localhost:3000 | Login page or main app |
| **Dashboard** | http://localhost:4000 | Admin login page |
| **Mesh GraphQL** | http://localhost:2000/graphql | GraphQL playground |

### Test Database Connection

```bash
# In a new terminal
psql -h localhost -U postgres -d testdb -c "SELECT COUNT(*) FROM information_schema.tables;"
```

Should return a number > 0 (tables exist).

### Test GraphQL

Visit http://localhost:2000/graphql and try:

```graphql
query {
  __typename
}
```

Should return `{"data": {"__typename": "Query"}}`.

---

## Step 8: (Optional) Clone Production Data

**Only if you need real data from staging/production:**

```bash
# This requires AWS credentials configured
npm run pg:db-clone-aws
```

**Note:** This is optional. You can start with an empty database.

---

## Troubleshooting

### "Cannot connect to database"

```bash
# Check if PostgreSQL is running
docker ps | grep postgres
# OR
pg_isready -h localhost -p 5432

# If using Docker and it's not running:
docker start nia-postgres
```

### "Port already in use"

```bash
# Find what's using the port
lsof -i :3000  # For interface
lsof -i :4000  # For dashboard
lsof -i :2000  # For mesh

# Kill the process
kill -9 <PID>
```

### "NEXTAUTH_SECRET is not set"

```bash
# Generate a new secret
openssl rand -base64 32

# Add to .env.local
echo "NEXTAUTH_SECRET=<paste-secret>" >> .env.local
```

### "Chorus TTS not found" (if using Kokoro)

```bash
# Re-download assets
npm run chorus:download-assets

# Check if submodule is initialized
git submodule status apps/chorus-tts

# If it shows "-", initialize it:
git submodule update --init apps/chorus-tts
```

### "Module not found" errors

```bash
# Clean and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Voice features not working

1. **Check API keys are set:**
   ```bash
   grep -E "DAILY_API_KEY|OPENAI_API_KEY|DEEPGRAM_API_KEY" .env.local
   ```

2. **Check TTS provider:**
   ```bash
   grep BOT_TTS_PROVIDER .env.local
   ```

3. **If using Kokoro, ensure Chorus server is running:**
   ```bash
   curl http://127.0.0.1:8000/health
   ```

4. **Check bot logs:**
   ```bash
   # Look for TTS-related errors in the terminal running npm run start:all
   ```

---

## Quick Reference: Common Commands

```bash
# Start all services
npm run start:all

# Start only Interface
npm run --workspace=interface dev

# Start only Dashboard
npm run --workspace=dashboard dev

# Start only Mesh
npm run --workspace=@nia/mesh-server dev

# Start Chorus TTS (for Kokoro)
npm run chorus:start

# Run tests
npm test

# Build for production
npm run build

# Type check
npm run type-check

# Lint
npm run lint
```

---

## Environment Variables Quick Reference

### Required (Minimum)

```bash
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
POSTGRES_DB=testdb
NEXTAUTH_SECRET=<32+ char random string>
MESH_ENDPOINT=http://localhost:2000/graphql
MESH_SHARED_SECRET=<32+ char random string>
TOKEN_ENCRYPTION_KEY=<32+ char random string>
```

### Optional (Voice Features)

```bash
DAILY_API_KEY=...
OPENAI_API_KEY=...
DEEPGRAM_API_KEY=...
BOT_CONTROL_SHARED_SECRET=...
BOT_TTS_PROVIDER=elevenlabs  # or "kokoro"
ELEVENLABS_API_KEY=...  # if using ElevenLabs
```

### Optional (Other Features)

```bash
USE_REDIS=false  # Set to true if you want Redis caching
GOOGLE_INTERFACE_CLIENT_ID=...  # For Gmail/Drive features
GOOGLE_DASHBOARD_CLIENT_ID=...  # For admin OAuth
```

---

## Next Steps

Once everything is running:

1. **Access the Interface**: http://localhost:3000
2. **Access the Dashboard**: http://localhost:4000
3. **Explore GraphQL API**: http://localhost:2000/graphql
4. **Read the docs**: `DEVELOPER_GUIDE.md` for feature development
5. **Check features**: `apps/interface/src/features/` for available features

---

## Summary Checklist

- [ ] Prerequisites installed (Node.js, npm, PostgreSQL/Docker)
- [ ] Repository cloned and submodules initialized
- [ ] Dependencies installed (`npm install`)
- [ ] Environment file created (`.env.local`)
- [ ] Secrets generated and set (NEXTAUTH_SECRET, MESH_SHARED_SECRET, TOKEN_ENCRYPTION_KEY)
- [ ] PostgreSQL running (Docker or local)
- [ ] (Optional) Kokoro models downloaded (`npm run chorus:download-assets`)
- [ ] (Optional) Chorus TTS server started (`npm run chorus:start`)
- [ ] Platform started (`npm run start:all`)
- [ ] Services accessible (Interface, Dashboard, Mesh)
- [ ] (Optional) Voice API keys configured (if using voice features)

---

**You're all set!** 🎉

If you encounter any issues, check the troubleshooting section or review the logs in the terminal where you ran `npm run start:all`.

