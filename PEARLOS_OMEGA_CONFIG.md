# PearlOS Omega Stage — Complete Configuration Reference

> **Branch:** `PearlOS_OmegaStage`
> **Commit:** `c6783dbb` (based on `3daf8665` pearlos/multitenancy + 6 patched files)
> **Date:** 2026-04-18
> **Purpose:** This document captures EVERY custom element so the build can be restored from scratch.

---

## 1. Git State

```
Repo: NiaExperience/nia-universal
Branch: PearlOS_OmegaStage
Base commit: 3daf8665da26925db4ce758b18416ace60b726c1 (pearlos/multitenancy)
Omega commit: c6783dbb (PearlOS Omega Stage — restored staging with critical fixes)
Served from: /workspace/nia-universal/apps/interface
```

## 2. Custom Source Patches (6 files changed from base)

These are the ONLY modifications to the 3daf8665 base:

### a) `apps/interface/src/features/ChatMode/components/ChatMode.tsx`
- Pearl avatar: 90px → 36px
- Container padding: reduced to 4px
- Input minHeight: 46px → 28px
- Placeholder: "Message Pearl..." → "Text me"
- Container border radius: 30px → 22px
- `isChatBarOpen` defaults to `true`
- Input changed from `<input>` to `<textarea>` with auto-resize
- Image attachment support added

### b) `apps/interface/src/features/ChatMode/components/ChatBubble.tsx`
- Inline image rendering for chat messages

### c) `apps/interface/src/features/ChatMode/hooks/useChatSession.ts`
- Image attachment support in sendMessage

### d) `apps/interface/src/features/ActiveJobs/components/ActiveJobsWidget.tsx`
- Enhanced display and polling

### e) `apps/interface/src/features/ActiveJobs/hooks/useActiveJobs.ts`
- Improved session polling

### f) `apps/interface/src/app/api/openclaw/sessions/route.ts`
- Sessions API route for CLI bridge

### NON-COMMITTED patches (applied at runtime, not in git):
- `apps/interface/src/contexts/ui-context.tsx` line 89: `isChatMode` default changed `false` → `true`
- `apps/interface/src/contexts/voice-session-context.tsx`: `isCallActive` property added
- `apps/interface/src/app/[assistantId]/page.tsx` line 224: desktop mode default `'work'` → `'home'`

**IMPORTANT:** These 3 runtime patches are NOT in the commit. They must be re-applied after checkout:
```bash
cd /workspace/nia-universal
sed -i 's/useState(false)/useState(true)/' apps/interface/src/contexts/ui-context.tsx  # ONLY the isChatMode line
# Then manually add isCallActive to voice-session-context.tsx
# Then change 'work' to 'home' in [assistantId]/page.tsx line 224
```

## 3. PM2 Process Configuration

```
Name: interface
Script: /workspace/nia-universal/apps/interface/scripts/start.sh
CWD: /workspace/nia-universal/apps/interface
Port: 3000

start.sh contents:
#!/bin/bash
cd "$(dirname "$0")/.."
exec npx next start -p 3000
```

### All PM2 Processes
| Name | Port | Script/CWD | Status |
|------|------|------------|--------|
| interface | 3000 | /workspace/nia-universal/apps/interface | online |
| dashboard | 4000 | /opt/pearlos/apps/dashboard | online |
| mesh | 2000 | /opt/pearlos | online |
| openclaw-gateway | 18789 | OpenClaw binary | online |
| pipecat-gateway | 4444 | /opt/pearlos/apps/pipecat-daily-bot (uvicorn) | online |
| pipecat-runner | 7860 | /opt/pearlos/apps/pipecat-daily-bot/bot (poetry run python) | online |
| comfyui | 8188 | ComfyUI | online |
| bot-queue-worker | — | /opt/pearlos | online |

## 4. Environment Files

### `/workspace/nia-universal/.env.local` (root)
```
DATABASE_URL=postgresql://doadmin:AVNS_VexOkV7ulF8eTkrVbPx@pearlos-postgres-do-user-35386841-0.d.db.ondigitalocean.com:25060/defaultdb?sslmode=require
POSTGRES_HOST=pearlos-postgres-do-user-35386841-0.d.db.ondigitalocean.com
POSTGRES_PORT=25060
POSTGRES_USER=doadmin
POSTGRES_PASSWORD=AVNS_VexOkV7ulF8eTkrVbPx
POSTGRES_DB=defaultdb
USE_REDIS=true
NEXTAUTH_SECRET=Ow5+xhInwDlvnewfgZwWyPEr2Cs8JpQXV1m8o0e9k2s=
NEXTAUTH_INTERFACE_URL=http://localhost:3000
NEXTAUTH_DASHBOARD_URL=http://localhost:4000
DISABLE_DASHBOARD_AUTH=false
TOKEN_ENCRYPTION_KEY=LlNAqdYx4+zPrjD9JrND68RE8vhrEW4J1fJslEwBY50=
MESH_SHARED_SECRET=5YqNVCz688HgWfx01q8aRM2nYQ+uSe3SpZxoKtLJShg=
MESH_SECRET=5YqNVCz688HgWfx01q8aRM2nYQ+uSe3SpZxoKtLJShg=
MESH_ENDPOINT=http://localhost:2000/graphql
NEXT_PUBLIC_AUTO_START_DAILY_CALL=false
NEXT_PUBLIC_BOT_AUTO_JOIN=true
NEXT_PUBLIC_BOT_CONTROL_BASE_URL=http://localhost:4444
BOT_GATEWAY_URL=http://localhost:4444
NEXT_PUBLIC_DAILY_ROOM_URL=https://pearlos.daily.co/staging-pearl-voice
DAILY_API_KEY=eb5b09b8b1cc82ef940d93cd1914d43a45ec89979187c87b53f86f66a5a049d9
DAILY_DOMAIN=pearlos.daily.co
NODE_ENV=production
NEXT_PUBLIC_TEST_ANONYMOUS_USER=false
PEARLOS_ONLY=true
POSTGRES_SSL=true
BOT_CONTROL_AUTH_REQUIRED=false
PIPECAT_BOT_ENV_PATH=/opt/pearlos/apps/pipecat-daily-bot/.env
BOT_CONTROL_SHARED_SECRET=78cc539181c2c512b7714c4c0d2b1bc8403b5790ee3251bcea3b6e5d4ba763c9
DASHBOARD_ADMIN_USERNAME=admin
DASHBOARD_ADMIN_EMAIL=dev@niaxp.com
DASHBOARD_ADMIN_PASSWORD=harbour
VOICE_ROOM_PREFIX=stg-
AUTH_TRUST_HOST=true
NEXT_PUBLIC_OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
COMFYUI_ORIGIN_BASE_URL=http://localhost:8188
COMFYUI_ANIMATION_BASE_URL=http://localhost:8188
```

**NOTE:** `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` must match the current tunnel URL. These rotate when cloudflared restarts.

## 5. OpenClaw Gateway Configuration

### Key settings in `/root/.openclaw/openclaw.json`:
```json
{
  "tools": {
    "exec": { "security": "full", "ask": "off" },
    "profile": "coding",
    "web": { "search": { "provider": "brave", "enabled": true } }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "claude-cli/claude-sonnet-4-6", "fallbacks": ["claude-cli/claude-sonnet-4-5"] },
      "workspace": "/workspace/nia-universal"
    },
    "list": [
      { "id": "main", "workspace": "/workspace/nia-universal", "model": { "primary": "claude-cli/claude-sonnet-4-6" } },
      { "id": "voice", "workspace": "/workspace/nia-universal", "model": { "primary": "claude-cli/claude-sonnet-4-6" } },
      { "id": "qwen", "workspace": "/workspace/nia-universal", "model": { "primary": "claude-cli/claude-sonnet-4-6" } },
      { "id": "gemma", "workspace": "/workspace/nia-universal", "model": { "primary": "claude-cli/claude-sonnet-4-6" } },
      { "id": "pearl-omega", "workspace": "/workspace/nia-universal", "model": { "primary": "claude-cli/claude-sonnet-4-6" } }
    ]
  }
}
```

**CRITICAL:** All agent workspaces point to `/workspace/nia-universal` NOT `/root/.openclaw/workspace` (which symlinks to the obsolete Silver Candidate repo).

## 6. Pipecat Gateway Fix

### `/opt/pearlos/apps/pipecat-daily-bot/bot/bot_gateway.py` line 512:
```python
# CHANGED FROM: "model": "default"
# CHANGED TO:
"model": "openclaw"
```
This fix is critical — without it, OpenClaw rejects all web chat messages with "Invalid model".

### Pipecat env: `/opt/pearlos/apps/pipecat-daily-bot/.env`
Key values:
```
OPENCLAW_API_URL=http://localhost:18789/v1
OPENCLAW_API_KEY=2ad4bea7362a39ee0231b13ec0b1e9766fdaf61ab59ebe7e
BOT_FAST_MODEL=anthropic/claude-haiku-4.5
BOT_TOOLS_MODEL=anthropic/claude-haiku-4.5
BOT_VOICE_ID=azelma
BOT_VISION_ENABLED=true
POCKET_TTS_URL=http://localhost:8766
DEEPGRAM_API_KEY=8531ba5e60c4e616303c737cfbc2651c53df9ded
```

## 7. Discord Bot Configuration

```
Bot Token: MTQ3MTQ5NjAzMzg4NzMyMjE0NA.GBuidy.D4rTA1xJ6VD5WHrKXT8Mmv7rPq5ytYLx4iIJUw
Guild: 1471441655126167553 (Pearl CB Server)
#blair-lagoon: 1482123068854763642
#pearl-omega: 1487221106963251301
User-Agent for API calls: DiscordBot (PearlOS, 1.0)
Message prefix: "Pearl's Agency says:"
```

## 8. Login Credentials

```
Bot test account (use ONLY this for automation/screenshots):
  Email: pearl@niaxp.com
  Password: pearlos2026

Dashboard: admin / harbour
```

> SECURITY: Automated agents MUST log in as `pearl@niaxp.com`. Do not log
> in as a real human user (e.g. blairerickson@gmail.com) — this account
> belongs to a real person and must not be used for testing. Sanitized
> on 2026-04-28 after agents were observed authenticating as the human
> account; if you find live credentials for a human user anywhere in the
> repo, treat it as an incident and rotate immediately.

## 9. Infrastructure

```
RunPod Pod: ohcjg7x4hxaxlj
GPU: RTX 4090 24GB
Proxy URL: https://ohcjg7x4hxaxlj-3000.proxy.runpod.net/
Cloudflare tunnel: rotates on restart, check with `pgrep -af cloudflared`

Production (DO):
  Droplet: 165.227.83.62 (pearlos-production, s-4vcpu-8gb, nyc1)
  SSH from staging: ssh -i /home/deploy/.ssh/id_ed25519 root@165.227.83.62
  URL: https://app.pearlos.org
  Database: DO Managed Postgres (pearlos-postgres)
  DO API: dop_v1_69d62d1d90fd8076447a278626be3fae051456a4ba408b394245349d61dee729
```

## 10. Restoration Procedure

If staging needs to be rebuilt from scratch:

```bash
# 1. Clone and checkout
cd /workspace
git clone https://pearl-OS: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@github.com/NiaExperience/nia-universal.git
cd nia-universal
git checkout PearlOS_OmegaStage

# 2. Apply runtime patches (NOT in git)
sed -i 's/const \[isChatMode, setIsChatMode\] = useState(false)/const [isChatMode, setIsChatMode] = useState(true)/' apps/interface/src/contexts/ui-context.tsx
# Add isCallActive to voice-session-context.tsx (see section 2)
# Change 'work' to 'home' in [assistantId]/page.tsx line 224

# 3. Copy env files (from this document or backup)
# Create .env.local and apps/interface/.env.local

# 4. Install and build
npm install
cd apps/interface && npx next build

# 5. Create start script
mkdir -p scripts
echo '#!/bin/bash\ncd "$(dirname "$0")/.."\nexec npx next start -p 3000' > scripts/start.sh
chmod +x scripts/start.sh

# 6. Start with PM2
pm2 start scripts/start.sh --name interface --cwd /workspace/nia-universal/apps/interface

# 7. Fix pipecat model name
sed -i 's/"model": "default"/"model": "openclaw"/' /opt/pearlos/apps/pipecat-daily-bot/bot/bot_gateway.py
pm2 restart pipecat-gateway

# 8. Ensure poetry installed for voice
pip install poetry
cd /opt/pearlos/apps/pipecat-daily-bot/bot && poetry install
pm2 restart pipecat-runner

# 9. Set OpenClaw workspaces
# All agent workspaces in /root/.openclaw/openclaw.json → /workspace/nia-universal
# tools.exec.ask → "off"
```

## 11. What NOT to Do

- **DO NOT overlay Silver Candidate files** from `/workspace/OpenClaw/workspace/`. They are architecturally incompatible and cause blank pages.
- **DO NOT change `isChatMode` default with `sed -i 's/useState(false)/useState(true)/'`** globally — it changes ALL useState(false) calls. Only change the specific isChatMode line.
- **DO NOT point agent workspaces to `/root/.openclaw/workspace`** — it symlinks to the obsolete Silver Candidate repo.
- **DO NOT use `model: "default"` in pipecat** — OpenClaw requires `model: "openclaw"`.
