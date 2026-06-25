# GOLD JEWEL Staging Configuration

Captured: 2026-05-07
Host: `pearl-staging-private-omega`
Source tree: `/workspace/nia-universal`
Deploy mirror: `/home/deploy/pearlos`
Branch at capture: `Pearl-Staging-Private-Omega`
Pre-commit base SHA: `34275983`

## Build

- Build codename: `GOLD JEWEL`
- Health endpoint: `https://134-209-76-227.sslip.io/api/health/build`
- Interface PM2 cwd: `/workspace/nia-universal/apps/interface`
- Interface start command sources: `/workspace/nia-universal/apps/interface/.env.local`
- Build command: `npm run build --prefix apps/interface`

## PM2 Processes

- `interface`: online, cwd `/workspace/nia-universal/apps/interface`, command `NODE_ENV=production PORT=3000 npm start`
- `pipecat-gateway`: online, cwd `/home/deploy/pearlos/apps/pipecat-daily-bot/bot`, command `poetry run uvicorn bot_gateway:app --host 127.0.0.1 --port 4444`
- `pipecat-runner`: online, cwd `/home/deploy/pearlos/apps/pipecat-daily-bot/bot`, command `poetry run python runner_main.py`
- `pearl-worker`: online, cwd `/workspace/nia-universal`, command `python3 scripts/pearl-worker.py --sse --executor agency --timeout 1200 --concurrency 2`
- `webchat-team`: stopped by design after QA impersonation incident
- `mesh`: online, cwd `/home/deploy/pearlos/apps/mesh`
- `openclaw-gateway`: online, cwd `/home/deploy/OpenClaw`
- `openclaw-bridge`: online, cwd `/home/deploy/OpenClaw/workspace`
- `pocket-tts`: online, local service on `127.0.0.1:8766`
- `pearl-chat-relays-production-repair`: online, cwd `/home/deploy/pearlos`

The deploy PM2 dump is saved at `/home/deploy/.pm2/dump.pm2`.

## Non-Secret Runtime Settings

Source and deploy env files were aligned for these non-secret values:

- `NEXTAUTH_URL=https://134-209-76-227.sslip.io`
- `NEXT_PUBLIC_INTERFACE_URL=https://134-209-76-227.sslip.io`
- `NEXTAUTH_INTERFACE_URL=https://134-209-76-227.sslip.io`
- `DISCORD_CLIENT_ID=1471496033887322144`
- `DISCORD_OAUTH_REDIRECT_URI=https://134-209-76-227.sslip.io/api/discord/callback`
- `GOOGLE_INTERFACE_CLIENT_ID=504226522735-vsn3fq8papcsm59ckirkgd6i09bsto79.apps.googleusercontent.com`
- `PEARL_CLAUDE_BIN=/home/deploy/.local/bin/claude`
- `PEARL_CLAUDE_CWD=/workspace/nia-universal`
- `PEARL_TASKS_DIR=/home/deploy/.openclaw/tasks`
- `PEARLOS_TEST_EMAIL=webchat-qa@pearlos.local`
- `PEARLOS_TEST_USER_ID=webchat-qa-user`
- `PEARL_PRIMARY_USER_EMAIL=blairerickson@gmail.com`
- `WEBCHAT_TEAM_DISCORD_TEXT=0`
- `WEBCHAT_TEAM_DISCORD_SCREENSHOTS=0`

Secret-bearing env keys are intentionally not recorded here. Verified present where needed without capturing values:

- `NEXTAUTH_SECRET`
- `BOT_CONTROL_SHARED_SECRET`
- `GOOGLE_INTERFACE_CLIENT_SECRET`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_BOT_TOKEN`
- `YOUTUBE_API_KEY`

## Security Notes

- `NEXTAUTH_SECRET` was rotated after the WebChat Team QA session-cookie incident, invalidating previously minted QA cookies.
- WebChat Team Discord posting is disabled and the PM2 service remains stopped until explicitly re-enabled.
- WebChat Team screenshots were moved out of `qa/screenshots` into restricted local quarantine and are not part of this commit.
- QA Playwright specs now refuse to run as the primary user and default to the dedicated QA identity.

## Verification Targets

- `/api/health/build` must report `codename: GOLD JEWEL`.
- Discord OAuth authorize URL must use `client_id=1471496033887322144` and redirect URI `https://134-209-76-227.sslip.io/api/discord/callback`.
- `/api/youtube-search?query=lofi%20coding%20music` should return videos.
- Direct weather tool invocation through `/api/tools/invoke` should return `success=true` and Wonder Canvas HTML.
