# PearlOS Fresh-Deploy Plan — Digital Ocean Droplet

**Author:** Claude CLI (current session)
**Date:** 2026-05-01
**For:** Next CLI session, fresh start on a clean DO droplet
**Goal:** Restore Pearl to working state from HYBRID baseline (commit `fee634da`, snapshot `/workspace/nia-universal/snapshots/HYBRID-20260430-2052/`) by escaping the environmental contamination in the current container that has made local recovery impossible.

---

## TL;DR for the next session

1. Read this whole document first. It contains 4+ hours of incident context plus the diverse-7 audit findings.
2. The current host (`0cb2f894b106`) is irrecoverable for chat in-place. We've tried every config, state, and binary reset — the bug is environmental.
3. The HYBRID snapshot is intact and complete. `pm2.dump.json`, the patched OpenClaw runner, agent prompts, and scrubbed envs are all preserved at `/workspace/nia-universal/snapshots/HYBRID-20260430-2052/`.
4. Source repo (`/workspace/nia-universal`) is clean at branch `toolbox-build`, HEAD `3f20ffb4` (POLAR). HYBRID baseline is tag `build/HYBRID-2026-04-30` at commit `fee634da`. Two HYBRID dispatch repairs (`ce5c32b3`, `19e88028`) are also worth keeping.
5. Most secrets must be re-injected from this host or fetched fresh — the snapshot scrubbed them.

---

## Why we're rebuilding, not fixing in-place

In the last 4 hours I exhausted every config-side and runtime-side intervention. None restored chat. Specifically failed:
- Strip Qwen from agent fallback chains (5 entries)
- Bump `agents.defaults.timeoutSeconds` (240 → 90 → 240)
- Bump `agents.defaults.llm.idleTimeoutSeconds` (8 → 60 → 12)
- Unset `agents.list[0].systemPromptOverride` (was a stale probe)
- Remove `dashscope` and `qwen-omni-local` providers
- Tighten `session.maintenance` (maxEntries 500→100, rotateBytes 8mb→1mb, pruneAfter 7d→3d)
- Wipe `/root/.openclaw/agents/main/sessions/` (779 files → 0)
- Wipe `/root/.openclaw/memory/*.sqlite` (main.sqlite was 1.9MB, contained persistent state)
- Wipe `/root/.openclaw/flows/registry.sqlite`, `/root/.openclaw/tasks/runs.sqlite`
- Wipe `/root/.openclaw/cache/`, `completions/`, `delivery-queue/`
- Disable `acpx` plugin (newest plugin in v2026.4.15)
- Restore `openclaw.json` from pre-fix backup (the pre-HYBRID-fixes state at 19:56 UTC 2026-04-30)
- `npm uninstall -g openclaw && npm install -g openclaw@2026.4.15` (full clean reinstall, 795 packages)
- Re-apply HYBRID lane-bypass patch (md5 verified)
- Upgrade to `openclaw@2026.4.29` (made things worse — even `/health` hung — rolled back)
- Multiple gateway restarts with announce
- Restored `pearl-worker.py` to `/opt/pearlos/scripts/` (was missing 14h)
- Selective crontab restore (5 essential watchdogs)

After all of that:
- `POST /v1/chat/completions` → hangs 60+ seconds, returns nothing, **0 bytes to upstream provider**
- `GET /v1/models` → works in 1 second
- `GET /health` → works in <0.3 seconds
- Direct DeepSeek (port 8200): 1.2s response, healthy
- Direct Kimi via OpenRouter: 1.3s response, healthy
- All 9 credentials probed healthy
- Same `errorHash sha256:bcdd7abbb45a` across all 3 fallback candidates per probe → **shared aborted controller fires before any provider call**
- `runId` IS assigned in OpenClaw structured log → request reaches `runEmbeddedPiAgent`
- gateway: 500% CPU on idle, 69 cumulative restarts

The bug is in OpenClaw's chat code path on this specific host. Same code worked yesterday and works for other users; doesn't work here today. **The fastest path is escape.**

---

## Diverse-7 audit consensus (from this incident)

GLM 5.1, GPT-5.5, DeepSeek V4 Pro, Kimi K2.6, Claude Opus 4.7, Gemini 3.1 Pro Preview, Grok 4.3 all consulted. Convergent findings:

- **Discord WS instability is a SYMPTOM**, not a separate cause. Heartbeat starvation from event-loop blockage.
- **Sessions sweep target must be OUTSIDE the scanned tree** (recursive scan otherwise still hits archived files).
- **Both `timeoutSeconds` AND `idleTimeoutSeconds` must be reset** — easy to miss the second.
- **Pause health-monitor before controlled restart** to avoid race condition.
- **Probe queue depth before reviving a 14h-dead worker** to avoid thundering herd.
- **Same errorHash across providers = shared/poisoned AbortController** inside the runner (consensus across 4 of 7 models).
- **The lane-bypass patch may be stable; the bug is upstream of model selection**.

---

## What's known-broken vs known-good

### Known-good (re-deploy as-is):
- Lane-bypass patched OpenClaw runner: `/workspace/nia-universal/snapshots/HYBRID-20260430-2052/openclaw-pi-embedded-runner.js` md5 `00ee6fa200a339865f49e2e92883aefb`
- Source repo at HYBRID commit `fee634da` (or HEAD with the dispatch repairs `ce5c32b3` + `19e88028`)
- All cleaned config (Qwen-stripped, dashscope removed, sane timeouts)
- DeepSeek + Kimi + OpenRouter API keys

### Known-broken in-place (do not waste time on):
- Trying to fix the cascade-abort by config or state changes — already tried everything

### Suspected environmental (root cause unknown):
- Possibly the overlay filesystem on RunPod
- Possibly the kernel (Linux 6.8.0-90-generic)
- Possibly a leaked file descriptor / socket / shared-memory segment
- Possibly node@22.22.1 + glibc combo on this image
- We don't know which — fresh droplet bypasses all of them

---

## Target droplet sizing

**Minimum spec for staging deploy:**
- **CPU:** 8 vCPU (current host shows 128 cores but uses <16 actively. Our baseline used 4-8 routinely. Use 8 for headroom.)
- **RAM:** 16 GB (current usage on 251 GB host: 49 GB. Most apps idle <500MB; the heavy hitters are Pearl brain GPU + Voxtral TTS which we're keeping on Pod 2.)
- **Disk:** 80 GB SSD (current `/opt/pearlos` is 8 GB, `/workspace/nia-universal` is 25 GB, `/root/.openclaw` is 644 MB, openclaw node_modules is 1.2 GB. Plus build artifacts + logs.)
- **OS:** Ubuntu 22.04 LTS (matches current `Ubuntu 22.04.5 LTS Jammy Jellyfish`)
- **Network:** Standard, no special needs. Cloudflare tunnels handle ingress.

**No GPU on this droplet.** All GPU work (Voxtral TTS, Pearl brain inference) lives on Pod 2 / RTX 6000 Ada (separate machine, accessed via SSH tunnel). DeepSeek and OpenRouter are external paid APIs.

**DO sizing match:** `s-8vcpu-16gb` ($96/mo) or `s-8vcpu-32gb` ($168/mo) for headroom. Frankfurt or NY3 region works.

---

## What to bring from the current host (pre-deploy collection)

Before destroying the current container, copy these to the new droplet (use `scp`/`rsync` or commit to a private repo):

### 1. Source repo (canonical)
```
/workspace/nia-universal/
```
~25 GB. Branch `toolbox-build`, HEAD `3f20ffb4`. Tag `build/HYBRID-2026-04-30` is at `fee634da`.

### 2. HYBRID snapshot (for reference + recovery)
```
/workspace/nia-universal/snapshots/HYBRID-20260430-2052/
```
~22 MB. Includes:
- `RESTORE.md` — recovery recipe
- `build-state.txt` — BUILD_ID, source git rev, openclaw runner md5
- `openclaw-pi-embedded-runner.js` — the patched runner (lane-bypass intact)
- `openclaw-main-system-prompt.md` — Pearl's persona prompt
- `openclaw-agents-dir/` — per-agent system prompts + AGENTS.md + TOOLS.md + models.json (apiKey scrubbed)
- `pm2.dump.json` (scrubbed of secrets)
- `*.env.scrubbed`

### 3. Live config (CONTAINS SECRETS — handle carefully)
```
/root/.openclaw/openclaw.json                           # 252 KB, all secrets in cleartext
/opt/pearlos/apps/interface/.env.local                   # 38 lines, NextAuth + DB secrets
/opt/pearlos/apps/pipecat-daily-bot/.env                 # 190 lines, ALL bot secrets (BOT_CONTROL_SHARED_SECRET, DEEPSEEK_API_KEY, etc.)
/opt/pearlos/apps/mesh/.env                              # 38 lines, MESH_SHARED_SECRET
~/.claude/.openrouter_key                                # OpenRouter key for swarms
~/.openclaw/                                             # OpenClaw state dir (after wiping memory/* sqlites and sessions/*.jsonl per recovery)
```

### 4. Cloudflare tunnels (if persisting URLs)
Currently 3 anonymous tunnels are running — they'll get new URLs on the new droplet:
```
cloudflared tunnel --url http://localhost:4444  → bot gateway
cloudflared tunnel --url http://localhost:3000  → interface
cloudflared tunnel --url http://localhost:7681  → ttyd / terminal
```
The current production URL is `https://trio-yorkshire-foundations-lived.trycloudflare.com` (referenced in `deploy-staging.sh`). If you want to keep this URL, you need a NAMED Cloudflare tunnel (with `cloudflared tunnel route dns`) — anonymous tunnels get random URLs.

### 5. PM2 ecosystem (process definitions)
There's no `ecosystem.config.js` — PM2 was bootstrapped ad-hoc. The 13 services need to be started manually with the right args. Full list at the bottom of this document.

### 6. Crontab (selective version, post-cleanup)
```
*/2 * * * * /opt/pearlos/scripts/pearl-worker-watchdog.sh
* * * * * /opt/pearlos/scripts/pm2-staging-guard.sh
*/10 * * * * /usr/bin/python3 /opt/pearlos/scripts/truncate-session-results.py >> /tmp/truncate-session-results.log 2>&1
*/5 * * * * /usr/bin/python3 /opt/pearlos/scripts/repair-session-transcripts.py >> /tmp/repair-session-transcripts.log 2>&1
*/5 * * * * /opt/pearlos/scripts/openclaw-config-tripwire.sh
```
Backup of original 13-cron version is at `/tmp/crontab-backup-20260501-010213.txt`. **Don't restore the full original — most were noise.**

### 7. Pod 2 SSH key (for Voxtral TTS tunnel)
Used to forward port 8100 from Pod 2 → localhost on the droplet for Voxtral TTS. SSH key at `~/.ssh/id_ed25519` (verify before destroying current host). Pod 2 endpoint: `root@<pod2-ip>:<pod2-port>` — get from current `~/.ssh/known_hosts` or active `ssh -L` ps lines.

---

## Deploy plan for fresh DO droplet

### Phase 0: Provision (10 min)
1. Create DO droplet: Ubuntu 22.04, 8 vCPU / 16 GB / 80 GB SSD
2. Add SSH key, root login
3. Note the droplet IP — you'll need it for the cloudflare tunnel + DNS

### Phase 1: Base system (15 min)
```bash
apt update && apt upgrade -y
apt install -y build-essential git curl wget vim jq sqlite3 \
               python3.12 python3-pip python3-venv \
               postgresql-client redis-tools \
               ca-certificates lsb-release sudo unzip \
               htop net-tools tcpdump strace
# Install Node.js v22.22.1 (must match for openclaw)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node --version  # should be v22.22.1
npm install -g pm2 poetry
# Install cloudflared
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i cloudflared-linux-amd64.deb
```

### Phase 2: Install OpenClaw + apply patch (10 min)
```bash
# Install OpenClaw 2026.4.15 globally (NOT 2026.4.29 — that broke worse)
npm install -g openclaw@2026.4.15
openclaw --version  # should be 2026.4.15

# CRITICAL: apply the HYBRID lane-bypass patch
# Copy the patched runner from snapshot
cp /path/to/snapshot/openclaw-pi-embedded-runner.js \
   /usr/lib/node_modules/openclaw/dist/pi-embedded-runner-DN0VbqlW.js
md5sum /usr/lib/node_modules/openclaw/dist/pi-embedded-runner-DN0VbqlW.js
# MUST equal: 00ee6fa200a339865f49e2e92883aefb
```

### Phase 3: Source code + builds (30 min)
```bash
# Clone the source repo (or rsync from current host)
mkdir -p /workspace
cd /workspace
git clone <repo-url> nia-universal
cd nia-universal
git checkout toolbox-build
git reset --hard fee634da   # HYBRID baseline
# OR keep the dispatch repairs:
# git reset --hard 19e88028  # HYBRID + both dispatch repairs

# OR even simpler: rsync the entire /workspace/nia-universal from current host
# rsync -av --delete root@<current-ip>:/workspace/nia-universal/ /workspace/nia-universal/

# Install workspaces
cd /workspace/nia-universal
npm install
# Pipecat-daily-bot uses Poetry (Python)
cd apps/pipecat-daily-bot
poetry install --no-root
cd ../..
# Build the interface
npm run build --workspace=interface
```

### Phase 4: Set up /opt/pearlos deploy target (15 min)
```bash
mkdir -p /opt/pearlos/apps
# Use deploy-staging.sh or manually rsync:
rsync -a /workspace/nia-universal/apps/interface/.next/ /opt/pearlos/apps/interface/.next/
rsync -a --delete /workspace/nia-universal/apps/interface/src/ /opt/pearlos/apps/interface/src/
rsync -a /workspace/nia-universal/apps/interface/public/ /opt/pearlos/apps/interface/public/
cp /workspace/nia-universal/apps/interface/package.json /opt/pearlos/apps/interface/
cp /workspace/nia-universal/apps/interface/next.config.* /opt/pearlos/apps/interface/

# Pipecat
rsync -a /workspace/nia-universal/apps/pipecat-daily-bot/ /opt/pearlos/apps/pipecat-daily-bot/

# Mesh
rsync -a /workspace/nia-universal/apps/mesh/ /opt/pearlos/apps/mesh/

# Scripts
mkdir -p /opt/pearlos/scripts
rsync -a /workspace/nia-universal/scripts/ /opt/pearlos/scripts/
chmod +x /opt/pearlos/scripts/*.sh
chmod +x /opt/pearlos/scripts/pearl-worker.py
```

### Phase 5: Inject config + secrets (10 min)
```bash
# Bring openclaw.json (full version with secrets) from current host
mkdir -p /root/.openclaw
scp root@<current-ip>:/root/.openclaw/openclaw.json /root/.openclaw/

# Bring env files (these have ALL the secrets)
scp root@<current-ip>:/opt/pearlos/apps/interface/.env.local /opt/pearlos/apps/interface/
scp root@<current-ip>:/opt/pearlos/apps/pipecat-daily-bot/.env /opt/pearlos/apps/pipecat-daily-bot/
scp root@<current-ip>:/opt/pearlos/apps/mesh/.env /opt/pearlos/apps/mesh/

# Bring user creds dir
scp -r root@<current-ip>:/root/.claude/ /root/

# IMPORTANT: openclaw.json should already be CLEAN (no qwen, no dashscope, no systemPromptOverride)
# from this session's recovery work. Verify:
python3 -c "
import json
d = json.load(open('/root/.openclaw/openclaw.json'))
for a in d.get('agents',{}).get('list',[]):
    fb = (a.get('model') or {}).get('fallbacks', [])
    has_qwen = any('qwen' in f.lower() for f in fb)
    spo = a.get('systemPromptOverride')
    print(f\"  {a.get('id'):14}: fb={fb}  qwen={has_qwen}  spo={spo}\")
print('providers:', list(d.get('models',{}).get('providers',{}).keys()))
print('timeoutSeconds:', d.get('agents',{}).get('defaults',{}).get('timeoutSeconds'))
print('idleTimeoutSeconds:', d.get('agents',{}).get('defaults',{}).get('llm',{}).get('idleTimeoutSeconds'))
"
# Expected:
#   no agent has qwen in fallbacks
#   no agent has systemPromptOverride
#   providers should be: ['openrouter', 'ollama', 'moonshot', 'pearl-llm']  (no dashscope, no qwen-omni-local)
#   timeoutSeconds: 90 (or 120 — both fine)
#   idleTimeoutSeconds: 12 (or 8 — both fine)
```

### Phase 6: External services (15 min)

**6a. Pod 2 SSH tunnel for Voxtral TTS:**
```bash
# Copy the SSH key from current host
scp root@<current-ip>:/root/.ssh/id_ed25519 /root/.ssh/

# Set up persistent tunnel via systemd or nohup
nohup ssh -T -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -N \
  -L 18100:localhost:8100 root@<pod2-ip> -p <pod2-port> \
  -i /root/.ssh/id_ed25519 > /tmp/ssh-tunnel-pod2.log 2>&1 &
```
Get pod2 IP/port from current host: `ps -ef | grep "ssh.*L.*8100"` — should show `-L 18100:localhost:8100 root@<ip> -p <port>`.

**6b. DeepSeek proxy (no remote service needed, runs locally):**
The deepseek-proxy.py talks to https://api.deepseek.com using the DeepSeek API key from openclaw.json `models.providers.pearl-llm.apiKey`. Just start the proxy as a PM2 service.

**6c. Cloudflare tunnels:**
For ad-hoc development, just start 3 anonymous tunnels:
```bash
nohup cloudflared tunnel --url http://localhost:4444 > /tmp/cf-bot-gateway.log 2>&1 &
nohup cloudflared tunnel --url http://localhost:3000 > /tmp/cf-interface.log 2>&1 &
nohup cloudflared tunnel --url http://localhost:7681 > /tmp/cf-ttyd.log 2>&1 &

# Wait a few seconds, then grep the URLs
sleep 5
grep -h "trycloudflare.com" /tmp/cf-*.log | head
```
For production, use a named tunnel pointing to your domain (out of scope for this plan).

### Phase 7: Start services with PM2 (15 min)
There's no `ecosystem.config.js`. Start each service manually with these commands (matches current production):

```bash
# OpenClaw gateway (the orchestration brain)
pm2 start --name openclaw-gateway -- bash -c '
  OPENCLAW_BUNDLED_PLUGINS_DIR=/opt/openclaw-local/oc-runtime/node_modules_openclaw/dist/extensions.777 \
  PATH=/usr/local/bin:/usr/bin:/bin \
  node --require ./tls-fix.cjs /usr/lib/node_modules/openclaw/openclaw.mjs \
       gateway --force --bind loopback --port 18789'

# Pipecat services (Python, Poetry env)
cd /opt/pearlos/apps/pipecat-daily-bot
pm2 start --name pipecat-gateway -- bash -c 'poetry run uvicorn bot_gateway:app --host 0.0.0.0 --port 4444'
pm2 start --name pipecat-runner  -- bash -c 'poetry run python runner_main.py'
pm2 start --name bot-queue-worker -- bash -c 'poetry run python bot_queue_worker.py'

# Mesh GraphQL
cd /opt/pearlos/apps/mesh
pm2 start --name mesh -- bash -c 'node dist/server.js'

# Interface (Next.js)
cd /opt/pearlos/apps/interface
pm2 start --name interface -- npm start

# Dashboard
cd /opt/pearlos/apps/dashboard
pm2 start --name dashboard -- npm run start

# Pearl worker (claude CLI subprocess executor)
pm2 start --name pearl-worker -- python3 /opt/pearlos/scripts/pearl-worker.py --sse --executor claude --timeout 1200 --concurrency 2

# DeepSeek proxy (Python script)
pm2 start --name deepseek-proxy -- python3 /opt/pearlos/scripts/deepseek-proxy.py

# Voxtral TTS local script (the heavy one — only if you have a GPU on this host; otherwise skip)
# pm2 start --name voxtral-tts -- /root/.local/bin/start-voxtral.sh

# Pocket TTS
pm2 start --name pocket-tts -- /usr/local/bin/pocket-tts serve --port 8766 --host 0.0.0.0

# Background image removal (optional)
pm2 start --name rembg-anime -- bash -c 'rembg s -p 7000 -h 127.0.0.1'

# Cron watchdog
pm2 start --name cron-watchdog -- /opt/pearlos/scripts/cron-watchdog.sh

# Save PM2 state
pm2 save
pm2 startup  # follow output to enable PM2 on boot
```

### Phase 8: Crontab (1 min)
```bash
crontab <<'EOF'
*/2 * * * * /opt/pearlos/scripts/pearl-worker-watchdog.sh
* * * * * /opt/pearlos/scripts/pm2-staging-guard.sh
*/10 * * * * /usr/bin/python3 /opt/pearlos/scripts/truncate-session-results.py >> /tmp/truncate-session-results.log 2>&1
*/5 * * * * /usr/bin/python3 /opt/pearlos/scripts/repair-session-transcripts.py >> /tmp/repair-session-transcripts.log 2>&1
*/5 * * * * /opt/pearlos/scripts/openclaw-config-tripwire.sh
EOF
```

### Phase 9: Verification (10 min)
Wait 90 seconds for OpenClaw gateway to fully initialize (it has a slow plugin load), then run the canary:

```bash
# 1. Health
curl -s http://localhost:18789/health
# Expect: {"ok":true,"status":"live"} — fast (<1s)

# 2. Models endpoint
TOKEN=$(python3 -c "import json; print(json.load(open('/root/.openclaw/openclaw.json'))['gateway']['auth']['token'])")
curl -s -m 5 http://localhost:18789/v1/models -H "Authorization: Bearer $TOKEN" | head -c 200
# Expect: JSON list of openclaw, openclaw/main, openclaw/voice, etc.

# 3. CHAT COMPLETION (the canary that proves the fix worked)
time curl -s -X POST http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"model":"openclaw/main","messages":[{"role":"user","content":"Reply with just OK"}],"max_tokens":10}' \
  --max-time 30
# EXPECT: {"id":"chatcmpl_...","choices":[{"message":{"role":"assistant","content":"OK"}}], ...}
# In ~2-5 seconds. NOT a 30-second timeout with empty body.

# 4. Verify proxy was actually called (proves we're past the in-place bug)
tail -3 /root/.pm2/logs/deepseek-proxy-error.log
# Expect: PROXY: "POST /v1/chat/completions HTTP/1.1" 200 - (or similar 200 line)
```

If step 3 succeeds, **Pearl is back**. If it fails, the bug is portable and not environmental — at that point this entire deploy plan is moot and we need source-level OpenClaw debugging.

### Phase 10: Cut over (30 min)
Once verified working:
1. Update DNS / Cloudflare tunnel routes to point users to the new droplet
2. Disable Pearl_bot's old gateway connection (turn it off on the old container so only one bot is connected to Discord at a time)
3. Update Pearl's announcement channel
4. Decommission old container after 24h grace

---

## Service architecture (for reference)

```
Internet
   │
   ├─→ [Cloudflare tunnel] :4444  → pipecat-gateway  (REST API for bot tools, task store)
   ├─→ [Cloudflare tunnel] :3000  → interface       (Next.js, the web UI)
   └─→ [Cloudflare tunnel] :7681  → ttyd            (web terminal, optional)

Internal (loopback only):
   localhost:18789  → openclaw-gateway  (Pearl's brain orchestrator)
   localhost:8200   → deepseek-proxy    (proxies to api.deepseek.com)
   localhost:18100  → SSH tunnel to Pod 2:8100 (Voxtral TTS)
   localhost:8766   → pocket-tts        (fast local TTS)
   localhost:2000   → mesh GraphQL      (data layer)
   localhost:7000   → rembg-anime       (image bg removal)
   localhost:4000   → dashboard         (admin UI)

Background workers:
   pearl-worker     → polls /api/tasks, claims pending, spawns Claude CLI subprocesses
   bot-queue-worker → consumes Redis queue (currently idle)
   cron-watchdog    → ensures crontab entries actually fire
   pipecat-runner   → joins Daily.co rooms for voice calls
```

---

## Credential inventory (last 8 chars for fingerprint matching)

| Service | Source | Last 8 |
|---|---|---|
| Discord bot token | `openclaw.json` `env.DISCORD_BOT_TOKEN` | `Lx4iIJUw` |
| OpenClaw gateway token | `openclaw.json` `gateway.auth.token` | `b59ebe7e` |
| OpenRouter API key | `openclaw.json` `models.providers.openrouter.apiKey` | `cd307873` |
| Moonshot/Kimi API key | `openclaw.json` `models.providers.moonshot.apiKey` | `EkiRHxKJ` |
| DeepSeek API key | `openclaw.json` `models.providers.pearl-llm.apiKey` | `37b491a5` |
| BOT_CONTROL_SHARED_SECRET | `pipecat-daily-bot/.env` | (in env file) |
| MESH_SHARED_SECRET | `mesh/.env` | (in env file) |
| NEXTAUTH_SECRET | `interface/.env.local` | (in env file) |
| Brave search key | `openclaw.json` plugins.entries.brave | (31 chars) |
| Pod 2 SSH key | `~/.ssh/id_ed25519` | (private, copy carefully) |

If any of these become stale on the new droplet, the relevant service breaks. The `pipecat-daily-bot/.env` file specifically has `DISCORD_BOT_TOKEN=` empty (a CLI script trap from earlier — the real token is in openclaw.json).

---

## Open questions for next session

1. **Is the bug really environmental, or is it in the code?**
   - If chat works after fresh deploy → environmental (the current container has corruption we couldn't identify). Document and move on.
   - If chat still hangs with same signature on fresh DO droplet → it's in the code itself. Need source-level debugging.

2. **Do we keep the lane-bypass patch?**
   - I don't actually know if it was the cause OR the cure on this host. The HYBRID snapshot has it; the fresh npm install of the same version doesn't. Test both:
     - Phase 9 with lane-bypass patch applied (what this plan currently says) → if works, ship it
     - If fails, try without the patch → if works, the patch was the problem all along

3. **Is the systemPromptOverride necessary?**
   - It was unset during recovery and remains unset in the cleaned config. Pearl's full persona prompt is in `/workspace/nia-universal/snapshots/HYBRID-20260430-2052/openclaw-main-system-prompt.md` (4 KB). The runtime should rebuild the full prompt from this + the bundled extensions.

4. **Pod 2 GPU server health**
   - Voxtral TTS lives there. If Pod 2 is also degraded, voice will be broken even if chat works. Verify Pod 2 SSH tunnel + `curl http://localhost:18100/v1/models` after setup.

5. **Cron entries**
   - The selective 5-cron version is what we want. Avoid restoring `voice-qa-cron` and `webchat-qa-cron` — they create session noise that contributed to the original bloat issue.

---

## What you should NOT do

- ❌ Don't `npm install -g openclaw@2026.4.29`. We tried. It's worse — even `/health` hung. Stick to 2026.4.15.
- ❌ Don't put archive directories INSIDE `/root/.openclaw/agents/main/sessions/`. The recursive scan will hit them. Use `/var/tmp/` or similar.
- ❌ Don't try to be clever with the systemPromptOverride. Leave it unset.
- ❌ Don't restore the entire backed-up crontab (`/tmp/crontab-backup-20260501-010213.txt`). It has 13 entries, most of which are noise. Use the selective 5-cron version above.
- ❌ Don't use the dashscope or qwen-omni-local providers. Per Blair's standing rule.
- ❌ Don't add ANY model that isn't pre-approved. Standing rule.
- ❌ Don't `rm -rf /root/.openclaw` blindly. The agents subdirectory has system prompts you need.
- ❌ Don't skip the 60-second restart announcement to #pearl-omega. Standing policy.

---

## Reference files

- `/workspace/nia-universal/snapshots/HYBRID-20260430-2052/RESTORE.md` — original snapshot recovery doc
- `/workspace/nia-universal/snapshots/HYBRID-20260430-2052/build-state.txt` — known-good state metadata
- `/workspace/nia-universal/CLAUDE.md` — project-wide AI session guide (single source of truth rule)
- `/workspace/runpod-slim/CLAUDE.md` — workspace-specific session guide
- `/root/.claude/projects/-workspace-runpod-slim/memory/` — auto-memory (preserved across CLI sessions; copy to new host)

---

## Final notes

I spent 4+ hours trying to fix this in-place and burned ~$5 of token budget on the diverse-7 audits. The audits are saved at `/tmp/diverse7-responses/`, `/tmp/diverse7-round2/`, `/tmp/72hr-audit/`, and `/tmp/upgrade-consult/` if the next session wants to read them. They strongly converge on "environmental contamination beyond external diagnosis."

A fresh DO droplet is the right call. Estimated total time from droplet provision to verified chat: **~2 hours of focused work** if the rsync from current host works (which is the fast path) and chat works on first probe.

**If chat still hangs on the new droplet with the same `errorHash sha256:bcdd7abbb45a` cascade pattern**, the bug is portable in the code — not environmental — and we need to file an OpenClaw upstream issue with the diagnostic data.

Good luck.

— Claude CLI session, 2026-05-01
