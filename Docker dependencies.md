# Docker Dependencies in Nia Universal

## Current Status: Docker is Optional

**Docker is NOT required** for local development. The project now uses **local PostgreSQL** by default.

---

## Current Docker Dependencies

### 1. Dockerfiles (Build Images Only)

These are for **production deployment**, not local development:

- `apps/interface/Dockerfile` - Interface app container
- `apps/dashboard/Dockerfile` - Dashboard app container
- `apps/mesh/Dockerfile` - Mesh GraphQL server container
- `apps/pipecat-daily-bot/Dockerfile` - Bot container
- `apps/chorus-tts/Dockerfile` - Chorus TTS server container
- `apps/web-base/Dockerfile` - Base image for web apps

**Usage:** Only used when building production images or testing container builds.

---

### 2. Docker Compose Files (Optional/Archived)

- `apps/mesh/docker-compose.yml` - Mesh + PostgreSQL (legacy, not used)
- `scripts/docker-compose.yml` - Test PostgreSQL container (optional fallback)

**Status:** Present but not required. Setup scripts prefer local PostgreSQL.

---

### 3. Package.json Scripts (Docker-Related)

#### Build Scripts (Production Only)
- `docker:build:dashboard` - Build dashboard image
- `docker:build:interface` - Build interface image
- `docker:build:mesh` - Build mesh image
- `docker:build:pipecat-daily-bot` - Build bot image
- `docker:build:web-base` - Build base image
- `docker:build:all` - Build all images

#### Run Scripts (Testing Only)
- `docker:run:dashboard` - Run dashboard container
- `docker:run:interface` - Run interface container
- `docker:run:mesh` - Run mesh container

#### Test Scripts (Optional)
- `test:interface:health:docker` - Test interface health in Docker
- `test:dashboard:health:docker` - Test dashboard health in Docker
- `test:mesh:health:docker` - Test mesh health in Docker
- `test:pipecat-daily-bot:health:docker` - Test bot health in Docker
- `test:build-deployment:docker` - Test builds with Docker

**Status:** All optional. Used only for container testing/deployment validation.

---

### 4. PostgreSQL Fallback (Optional)

#### Scripts with Docker Fallback
- `scripts/ensure-postgres.ts` - Auto-starts PostgreSQL (tries Docker as last resort)
- `scripts/start-db.ts` - Legacy script (references Docker)
- `apps/mesh/src/resolvers/db.ts` - Database connection (tries Docker if local PG not found)

**Current Behavior:**
1. ✅ Prefers local PostgreSQL (`psql` command)
2. ✅ Tries system service (systemctl/brew/services)
3. ⚠️ Falls back to Docker container `nia-postgres` (if exists)
4. ❌ Fails if none found

**Package.json:**
- `pg:db-stop` - Stops Docker container `nia-postgres` (if running)

---

### 5. Redis Scripts (Optional)

Redis scripts reference Docker but Redis is **disabled by default**:

- `scripts/redis/install-redis.sh` - May use Docker
- `scripts/redis/stop-redis.sh` - Stops Docker Redis container
- `scripts/start-redis-dev.sh` - Starts Redis (Docker or local)

**Status:** Redis is optional (`USE_REDIS=false` by default). Docker is only used if no local Redis found.

---

### 6. Test Scripts (Optional)

- `scripts/test-build-deployment.mjs` - Can test Docker builds (with `--docker` flag)
- `scripts/test-app-health.mjs` - Can test apps in Docker (with `--docker` flag)
- `scripts/ci-validate-container.mjs` - Validates container builds
- `scripts/ci-validate-deployment.mjs` - Validates deployment (may use Docker)

**Status:** All optional. Used for CI/CD validation.

---

## What Changed (Recent History)

### Before (10-12 Commits Ago)

**Docker was more integrated:**
- Setup scripts had Docker as primary PostgreSQL option
- `pg:start` and `pg:stop` scripts primarily used Docker
- Docker was recommended for local development
- Setup scripts would install Docker if missing

### Now (Current)

**Docker is optional/fallback:**
- ✅ Setup scripts prefer local PostgreSQL installation
- ✅ Docker only used as fallback if local PostgreSQL not found
- ✅ All Docker references are optional
- ✅ Production Dockerfiles remain (for deployment)
- ✅ Test scripts can use Docker (optional flag)

---

## Summary

### Required for Local Development
- ❌ **Docker is NOT required**
- ✅ **Local PostgreSQL is required** (installed directly on system)

### Optional Docker Usage
- 🐳 **Production builds** - Dockerfiles for containerized deployment
- 🐳 **Testing** - Optional Docker-based testing scripts
- 🐳 **Fallback** - Docker PostgreSQL container as last resort

### Files That Reference Docker

**Build/Deploy (Production):**
- 6 Dockerfiles (apps)
- 2 docker-compose files (optional)

**Scripts (Optional):**
- `scripts/ensure-postgres.ts` - Docker fallback
- `scripts/start-db.ts` - Legacy Docker reference
- `apps/mesh/src/resolvers/db.ts` - Docker fallback
- `scripts/redis/*.sh` - Docker Redis (optional)
- `scripts/test-*.mjs` - Docker testing (optional)

**Package.json:**
- 15+ Docker-related npm scripts (all optional)

---

## Recommendation

**For Local Development:**
- ✅ Install PostgreSQL directly (no Docker needed)
- ✅ Use `npm run start:all` (no Docker required)
- ❌ Ignore Docker-related scripts unless testing containers

**For Production:**
- 🐳 Use Dockerfiles to build production images
- 🐳 Deploy using container orchestration (K8s, etc.)

---

## Removing Docker Completely

If you want to remove all Docker dependencies:

1. **Keep:** Dockerfiles (needed for production)
2. **Remove:** Docker fallback logic in `ensure-postgres.ts` and `db.ts`
3. **Remove:** Docker-related npm scripts (or mark as deprecated)
4. **Remove:** `docker-compose.yml` files (if not needed)

**Note:** Keeping Docker as optional fallback is recommended for flexibility.