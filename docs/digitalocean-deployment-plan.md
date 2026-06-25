# PearlOS DigitalOcean Deployment Runbook (Repo Specific)

Last updated: 2026-04-03

This runbook is specific to the current `nia-universal` repository layout and runtime behavior. Use it instead of generic deployment notes.

## 1) Target Outcome

- Stable HTTPS URLs:
  - `https://pearlos.app` (interface)
  - `https://dashboard.pearlos.app` (dashboard)
- Single-host production deployment for about 20 to 50 concurrent users.
- Services supervised with PM2 and fronted by Nginx.
- Rollback-ready DNS cutover.

## 2) Service Topology

All services run on one Droplet and bind to localhost except Nginx:

- Nginx: `:80` and `:443`
- Interface (Next.js): `127.0.0.1:3000`
- Dashboard (Next.js): `127.0.0.1:4000`
- Mesh API (Node): `127.0.0.1:2000`
- Pipecat Bot Gateway (FastAPI): `127.0.0.1:4444`
- Chorus TTS (FastAPI): `127.0.0.1:8766`

## 3) Build and Runtime Commands (Exact)

From `/home/deploy/pearlos`:

```bash
npm install

# Build apps that run in production
cd apps/interface && npm run build && cd ../..
cd apps/dashboard && npm run build && cd ../..
cd apps/mesh && npm run build && cd ../..

# Install bot Python dependencies
cd apps/pipecat-daily-bot
node scripts/poetry-run.js install --no-root --only main --no-interaction
cd ../..

# Install Chorus dependencies
cd apps/chorus-tts
uv sync --no-dev
cd ../..
```

Notes:
- Do not use `next dev` for production traffic.
- The Pipecat gateway entrypoint is `bot_gateway:app`, not `app.main:app`.
- The Mesh runtime entrypoint after build is `apps/mesh/dist/server.js`.

## 4) Nginx Route Ownership (Critical)

Use this ownership model to avoid breaking Next API routes.

- Interface app owns:
  - `/`
  - `/_next/*`
  - `/api/*` (default for interface app)

- Mesh owns:
  - `/graphql`
  - Optional: `/mesh-api/*` mapped to Mesh `/api/*` only if you need it externally

- Pipecat owns:
  - `/bot/*` (proxy to `:4444`, strip `/bot` prefix)
  - `/ws/events` (websocket endpoint used by interface)

- Chorus owns:
  - `/tts/*` (proxy to `:8766`, strip `/tts` prefix)
  - health endpoint from proxy path: `/tts/healthz`

Do not proxy all `/api/*` to Mesh. This repo has many interface routes under `/api/*` that must remain on the interface app.

## 5) Nginx Config Template (Safe Defaults)

```nginx
upstream interface_app {
  server 127.0.0.1:3000;
  keepalive 32;
}

upstream dashboard_app {
  server 127.0.0.1:4000;
  keepalive 16;
}

upstream mesh_api {
  server 127.0.0.1:2000;
  keepalive 16;
}

upstream bot_gateway {
  server 127.0.0.1:4444;
  keepalive 16;
}

upstream chorus_tts {
  server 127.0.0.1:8766;
  keepalive 8;
}

server {
  listen 80;
  listen [::]:80;
  server_name pearlos.app www.pearlos.app dashboard.pearlos.app;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name pearlos.app www.pearlos.app;

  # certbot-managed cert paths go here

  location /_next/static/ {
    proxy_pass http://interface_app;
    expires 365d;
    add_header Cache-Control "public, immutable";
  }

  # Mesh GraphQL
  location = /graphql {
    proxy_pass http://mesh_api/graphql;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Optional external mesh API namespace
  location /mesh-api/ {
    proxy_pass http://mesh_api/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Bot websocket consumed by interface
  location /ws/events {
    proxy_pass http://bot_gateway/ws/events;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
  }

  # Bot API namespace
  location /bot/ {
    proxy_pass http://bot_gateway/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Chorus namespace
  location /tts/ {
    proxy_pass http://chorus_tts/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Interface owns everything else, including /api/*
  location / {
    proxy_pass http://interface_app;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}

server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name dashboard.pearlos.app;

  # certbot-managed cert paths go here

  location /_next/static/ {
    proxy_pass http://dashboard_app;
    expires 365d;
    add_header Cache-Control "public, immutable";
  }

  location / {
    proxy_pass http://dashboard_app;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

## 6) PM2 Ecosystem (Repo Accurate)

Create `/home/deploy/pearlos/ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [
    {
      name: 'interface',
      cwd: '/home/deploy/pearlos/apps/interface',
      script: 'node_modules/.bin/next',
      args: 'start --port 3000',
      env: {
        NODE_ENV: 'production',
        PORT: '3000'
      },
      max_memory_restart: '1G',
      instances: 1,
      exec_mode: 'fork',
    },
    {
      name: 'dashboard',
      cwd: '/home/deploy/pearlos/apps/dashboard',
      script: 'node_modules/.bin/next',
      args: 'start --port 4000',
      env: {
        NODE_ENV: 'production',
        PORT: '4000'
      },
      max_memory_restart: '1G',
      instances: 1,
      exec_mode: 'fork',
    },
    {
      name: 'mesh',
      cwd: '/home/deploy/pearlos/apps/mesh',
      script: 'node',
      args: 'dist/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: '2000'
      },
      max_memory_restart: '2G',
      instances: 1,
      exec_mode: 'fork',
    },
    {
      name: 'pipecat-gateway',
      cwd: '/home/deploy/pearlos/apps/pipecat-daily-bot',
      script: 'node',
      args: 'scripts/poetry-run.js run uvicorn bot_gateway:app --host 0.0.0.0 --port 4444 --workers 2',
      env: {
        PYTHONUNBUFFERED: '1'
      },
      max_memory_restart: '2G',
      instances: 1,
      exec_mode: 'fork',
    },
    {
      name: 'chorus-tts',
      cwd: '/home/deploy/pearlos/apps/chorus-tts',
      script: 'uv',
      args: 'run python main.py',
      env: {
        PYTHONUNBUFFERED: '1',
        SERVER_PORT: '8766',
        SERVER_HOST: '127.0.0.1'
      },
      max_memory_restart: '3G',
      instances: 1,
      exec_mode: 'fork',
    },
  ],
};
```

Start and persist:

```bash
pm2 start /home/deploy/pearlos/ecosystem.config.cjs
pm2 save
pm2 startup systemd -u deploy --hp /home/deploy
```

## 7) Environment Variables (Minimum Required)

Store in `/home/deploy/pearlos/.env` (or per-service env files loaded consistently).

### Core
- `NODE_ENV=production`
- `NEXTAUTH_SECRET=<strong-random-secret>`
- `MESH_SHARED_SECRET=<strong-random-secret>`
- `BOT_CONTROL_SHARED_SECRET=<strong-random-secret>`
- `BOT_CONTROL_CLAIMS_SECRET=<strong-random-secret>`

### URLs and auth callbacks
- `NEXTAUTH_INTERFACE_URL=https://pearlos.app`
- `NEXT_PUBLIC_INTERFACE_URL=https://pearlos.app`
- `NEXTAUTH_DASHBOARD_URL=https://dashboard.pearlos.app`
- `NEXT_PUBLIC_DASHBOARD_URL=https://dashboard.pearlos.app`
- `NEXTAUTH_URL=https://pearlos.app`

### Database and cache
- `POSTGRES_HOST=<managed-pg-host>` (from DO)
- `POSTGRES_PORT=25060`
- `POSTGRES_USER=<user>`
- `POSTGRES_PASSWORD=<password>`
- `POSTGRES_DB=<db-name>`
- `DATABASE_URL=postgresql://...`
- `REDIS_URL=redis://127.0.0.1:6379` (self-hosted on Droplet)
- `USE_REDIS=true`

### Mesh and Prism wiring
- `MESH_ENDPOINT=http://127.0.0.1:2000/graphql`
- `NEXT_PUBLIC_MESH_ENDPOINT=https://pearlos.app/graphql`

### Interface and dashboard providers
- `GOOGLE_INTERFACE_CLIENT_ID=<...>`
- `GOOGLE_INTERFACE_CLIENT_SECRET=<...>`
- `GOOGLE_DASHBOARD_CLIENT_ID=<...>`
- `GOOGLE_DASHBOARD_CLIENT_SECRET=<...>`

### Voice stack
- `DAILY_API_KEY=<...>`
- `DAILY_API_URL=https://api.daily.co/v1`
- `DAILY_DOMAIN=<your-daily-subdomain>`
- `BOT_CORS_ORIGINS=https://pearlos.app,https://dashboard.pearlos.app`
- `BOT_CONTROL_BASE_URL=http://127.0.0.1:4444`
- `NEXT_PUBLIC_BOT_CONTROL_BASE_URL=https://pearlos.app/bot`

### Chorus TTS
- `SERVER_HOST=127.0.0.1`
- `SERVER_PORT=8766`
- `CHORUS_TTS_URL=http://127.0.0.1:8766`

### LLM and speech
- `ANTHROPIC_API_KEY=<...>`
- `DEEPGRAM_API_KEY=<...>`

## 8) Health Endpoints (Use These)

- Interface deep health: `https://pearlos.app/health/deep`
- Dashboard basic health: `https://dashboard.pearlos.app/health`
- Dashboard deep health: `https://dashboard.pearlos.app/health/deep`
- Mesh health: `http://127.0.0.1:2000/health`
- Pipecat health: `https://pearlos.app/bot/health`
- Chorus health: `https://pearlos.app/tts/healthz` (note: `/healthz`, not `/health`)

## 9) Deployment Sequence

1. Provision Droplet, Managed Postgres, DNS records, firewall.
2. Install system deps (Node, PM2, Python, Poetry, uv, Nginx, Certbot, Redis).
3. Clone repo and install dependencies.
4. Build interface, dashboard, mesh.
5. Install Python dependencies for pipecat and chorus.
6. Write env file and verify secrets are present.
7. Apply Nginx config and validate with `sudo nginx -t`.
8. Obtain certificates with certbot.
9. Start PM2 ecosystem and run smoke checks.
10. Run user flow checks and then load tests.

## 10) Smoke Test Commands

```bash
# Interface and dashboard
curl -i https://pearlos.app/health/deep
curl -i https://dashboard.pearlos.app/health

# Bot and TTS
curl -i https://pearlos.app/bot/health
curl -i https://pearlos.app/tts/healthz

# Mesh health
curl -i http://127.0.0.1:2000/health

# GraphQL probe with mesh secret
curl -sS https://pearlos.app/graphql \
  -H 'content-type: application/json' \
  -H "x-mesh-secret: $MESH_SHARED_SECRET" \
  --data '{"query":"{ __typename }"}'
```

## 11) Load and Capacity Validation

From repo root:

```bash
# Existing harness defaults to 50 virtual users
npm run test:load:light
npm run test:load:medium
```

Run progressive ramps (10 -> 20 -> 30 -> 50), and track:
- PM2 restarts
- CPU and RAM
- Postgres connection count
- P95 latency and websocket stability

## 12) Data and Migration Guidance

Do not rely on a generic Prisma command for this repo. Use one of these project-native paths:
- Restore existing production dump into managed Postgres, then validate.
- If migrations are needed in this codebase, use repository scripts (for example root `pg:*` workflows and mesh migration scripts) that match current schema ownership.

Always run migration/restore in staging first and verify auth + tenant flows before DNS cutover.

## 13) Cutover and Rollback

### Cutover
- Lower DNS TTL to 300 at least 24h before switch.
- Keep old environment running during first 48h.
- Switch A records to new droplet IP.
- Monitor logs and health continuously for first few hours.

### Rollback triggers
- Login failures
- Frequent websocket disconnects
- PM2 crash loops
- Sustained 5xx spikes

### Rollback action
- Repoint DNS back to previous host.
- Keep database writes controlled during rollback window.
- Re-verify old environment health before announcing rollback complete.

## 14) Known Pitfalls to Avoid

