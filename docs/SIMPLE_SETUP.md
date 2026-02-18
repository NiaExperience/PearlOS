# Nia Universal - Simple Setup Guide

> **Quick start for local development without Kubernetes complexity**

This guide gets you running in **under 5 minutes** with just npm and PostgreSQL.

---

## Prerequisites 

| Requirement | Version | Check Command |
|-------------|---------|---------------|
| Node.js | ≥20.0.0 | `node --version` |
| npm | ≥10.0.0 | `npm --version` |
| PostgreSQL | ≥14 | `psql --version` |

### Optional (for voice features)
- Daily.co account (for voice calls)
- OpenAI API key (for AI responses)
- Deepgram API key (for speech-to-text)

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment

```bash
# Option A (recommended): Minimal standalone config (NO AWS required)
cp config/env.minimal.example .env.local

# Option B (optional): Legacy full template (SANITIZED; you fill values locally)
# cp .example.env.local .env.local

# Edit with your values
nano .env.local
```

### 3. Start PostgreSQL

**Option A: Use Docker (recommended)**
```bash
docker run -d \
  --name nia-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=testdb \
  -p 5432:5432 \
  postgres:15
```

**Option B: Use local PostgreSQL**
```bash
# Create database
createdb testdb
```

### 4. Start the Platform

```bash
# Start apps (Interface, Dashboard, Mesh)
npm run start:all
```

### 5. Access the Apps

| App | URL | Purpose |
|-----|-----|---------|
| Interface | http://localhost:3000 | Main user app |
| Dashboard | http://localhost:4000 | Admin panel |
| Mesh GraphQL | http://localhost:2000/graphql | API playground |

---

## Minimal Environment Configuration

Create `.env.local` with these essential variables:

```bash
# === DATABASE (Required) ===
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
POSTGRES_DB=testdb

# === AUTH (Required) ===
NEXTAUTH_SECRET=your-random-secret-string-at-least-32-chars
NEXTAUTH_INTERFACE_URL=http://localhost:3000
NEXTAUTH_DASHBOARD_URL=http://localhost:4000

# === DATA LAYER (Required) ===
MESH_ENDPOINT=http://localhost:2000/graphql
MESH_SHARED_SECRET=your-mesh-secret-string

# === DISABLE OPTIONAL SERVICES ===
USE_REDIS=false
```

### For Voice Features (Optional)

Add these if you want voice conversations:

```bash
# === VOICE (Optional) ===
DAILY_API_KEY=your-daily-api-key
OPENAI_API_KEY=sk-your-openai-key
DEEPGRAM_API_KEY=your-deepgram-key
BOT_CONTROL_SHARED_SECRET=your-bot-secret
BOT_TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your-elevenlabs-key
```

---

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run start:all` | Start all services (Interface, Dashboard, Mesh) |
| `npm run dev` | Start with hot reload + Chorus TTS |
| `npm run --workspace=interface dev` | Start only Interface |
| `npm run --workspace=dashboard dev` | Start only Dashboard |
| `npm run --workspace=@nia/mesh-server dev` | Start only Mesh |
| `npm test` | Run all tests |
| `npm run build` | Production build |
| `npm run lint` | Lint check |

---

## Service Ports

| Service | Port | Protocol |
|---------|------|----------|
| Interface | 3000 | HTTP |
| Dashboard | 4000 | HTTP |
| Mesh GraphQL | 2000 | HTTP |
| PostgreSQL | 5432 | TCP |
| Redis (if enabled) | 6379 | TCP |
| Pipecat Bot (if running) | 4444 | HTTP |

---

## Troubleshooting

### "Cannot connect to database"
```bash
# Check if PostgreSQL is running
docker ps | grep postgres
# or
pg_isready -h localhost -p 5432
```

### "NEXTAUTH_SECRET is not set"
```bash
# Generate a random secret
openssl rand -base64 32
# Add to .env.local
```

### "Port already in use"
```bash
# Find what's using the port
lsof -i :3000
# Kill it
kill -9 <PID>
```

### Voice features not working
1. Check all API keys are set in `.env.local`
2. Ensure `BOT_CONTROL_SHARED_SECRET` matches between interface and bot
3. Verify Daily.co account has available rooms

---

## Architecture (Simplified)

```
┌─────────────────────────────────────────────────────────────┐
│                    Simplified Nia Stack                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
│   │  Interface   │    │  Dashboard   │    │    Mesh      │ │
│   │  (Next.js)   │───▶│  (Next.js)   │───▶│  (GraphQL)   │ │
│   │  :3000       │    │  :4000       │    │  :2000       │ │
│   └──────────────┘    └──────────────┘    └──────────────┘ │
│                                                  │          │
│                                          ┌──────▼──────┐   │
│                                          │  PostgreSQL │   │
│                                          │  :5432      │   │
│                                          └─────────────┘   │
│                                                             │
│   Optional:                                                 │
│   ┌──────────────┐    ┌──────────────┐                     │
│   │  Pipecat Bot │    │    Redis     │                     │
│   │  (Voice)     │    │   (Cache)    │                     │
│   └──────────────┘    └──────────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

---

## What's Not Included

This simplified setup **does not include**:

- ❌ Kubernetes deployment (Helm charts)
- ❌ GitOps (Flux CD)
- ❌ AWS infrastructure (Terraform)
- ❌ Container orchestration (Tilt)

These are archived in `archive/infrastructure/` if you need them later.

---

## AWS Dependencies (Optional)

The platform can run **100% locally** without AWS. However, some features require AWS:

| Feature | AWS Service | Required? | Fallback |
|---------|-------------|-----------|----------|
| Email sending | SES | ❌ No | Ethereal.email (dev preview) or SMTP |
| File uploads (Dashboard) | S3 | ❌ No | Feature disabled without config |
| Database seeding | RDS | ❌ No | Empty local database |
| Container images | ECR | ❌ No | Local Docker builds |

### Running Without AWS

Use the minimal config:

```bash
cp config/env.minimal.example .env.local
npm run local:start
```

This sets:
- `EMAIL_REQUIRE_SES=false` - Uses Ethereal.email for dev
- `USE_REDIS=false` - Disables Redis caching
- No S3/RDS configuration - Local-only operation

### With AWS (Optional)

If you have AWS credentials and want full features:

```bash
cp config/env.minimal.example .env.local
# Edit with your AWS credentials
npm run pg:start  # Clones data from AWS staging
```

---

## Restoring Full Infrastructure

If you need Kubernetes deployment later:

```bash
# Restore from archive
mv archive/infrastructure/charts ./
mv archive/infrastructure/infra ./
mv archive/infrastructure/Tiltfile ./
mv archive/infrastructure/Tiltfile.minimal ./

# Restore deployment manifests
for app in interface dashboard mesh pipecat-daily-bot; do
  mv archive/infrastructure/deployments/$app-deployment apps/$app/deployment
done
```

---

## Next Steps

1. **Read the docs:** `DEVELOPER_GUIDE.md` for feature development
2. **Explore features:** Check `apps/interface/src/features/`
3. **API playground:** Visit http://localhost:2000/graphql
4. **Add a feature:** Follow the guide in `docs/ai-assistant-protocol.md`

Happy building! 🚀

