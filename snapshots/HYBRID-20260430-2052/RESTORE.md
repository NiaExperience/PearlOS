SILVER-GOLD HYBRID CANDIDATE — 2026-04-30 20:52 UTC

## What this snapshot represents
First "good" build after the lane-bypass + narration scrub + tool wiring sweep. Confirmed working in a Blair voice session: weather, news (with one extra-window glitch), bot_switch_desktop_mode, news search by Pearl. Confirmed broken: agent dispatch path (Pearl could not dispatch a sub-agent). That regression is to be audited by the A-Team after this snapshot.

## What's in this snapshot
- `pm2.dump.json` + `pm2-jlist.json` + `pm2-list.txt` — exact PM2 process roster, env, and ecosystem
- `build-state.txt` — interface BUILD_ID, BUILD_KEYWORD, source git rev/branch, openclaw md5
- `openclaw-pi-embedded-runner.js` — patched runner with global-lane bypass at lines 7148/8344 (commit 88cd84f7)
- `openclaw-main-system-prompt.md` — Pearl's main agent prompt
- `openclaw-agents-dir/` — full agent definitions tree
- `*.env.scrubbed` — env files with secrets redacted (look up secrets in original locations)

## Restore procedure (if HYBRID gets broken)
1. `cd /workspace/nia-universal && git checkout <hybrid-commit-sha>` — git log this snapshot for the SHA
2. Rebuild interface: `npm run build --workspace=interface` then rsync `.next` + `src` to `/opt/pearlos/apps/interface/`
3. Restore openclaw runner: `cp openclaw-pi-embedded-runner.js /usr/lib/node_modules/openclaw/dist/pi-embedded-runner-DN0VbqlW.js`
4. Restore openclaw agents: `rsync -a --delete openclaw-agents-dir/ /root/.openclaw/agents/`
5. PM2 restore: `pm2 resurrect` (after copying `pm2.dump.json` to `~/.pm2/dump.pm2`)
6. Restart: `/opt/pearlos/scripts/announce-restart.sh interface "restore HYBRID" && pm2 restart interface pipecat-runner pipecat-gateway pearl-worker`
7. Verify: `BUILD_KEYWORD` in UI should read HYBRID; `/api/tools/invoke` for `bot_open_note` returns `execution: direct`

## Known issues at snapshot time
- **Agent dispatch broken**: Pearl couldn't fire a sub-agent during the Blair session — A-Team to audit
- **News opens an extra window**: minor UX glitch when news loads
- All other tested paths (weather, desktop switch, news search) confirmed working
