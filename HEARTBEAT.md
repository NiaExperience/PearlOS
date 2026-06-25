# Staging Health Monitor

## Every 5 Minutes - Check:
1. PM2 service status (all should be online)
2. Web chat functionality at current tunnel URL (check `ps aux | grep cloudflared`)
3. File upload handling (images, documents)
4. OpenClaw gateway connectivity
5. Any new error logs

## Current Status (Last Updated: 2026-05-19 17:06 UTC)
- Mesh: ONLINE
- Pipecat Gateway: ONLINE
- Pipecat Runner: ONLINE
- Bot Queue Worker: ONLINE
- OpenClaw Gateway: ONLINE
- OpenClaw Bridge: ONLINE
- Interface: ONLINE
- DeepSeek Proxy: ONLINE
- Pearl Worker: ONLINE
- Pearl Agent Runtime: ONLINE
- Pearl Chat Relays (production repair): ONLINE
- Webchat Team: STOPPED (intentionally)
- Dashboard: STOPPED (missing script since Apr 24)

## Issues Requiring Attention:
1. Cloudflare tunnel URL rotated again: `blackberry-profit-speaks-brunswick.trycloudflare.com` (was `mph-amp-creates-partner` which expired). Standard quick tunnel rotation.
2. `updateNotionModel` GraphQL errors in interface logs (INTERNAL_SERVER_ERROR on UserProfile mutations). Non-critical but mesh may need attention.
3. Notes DB queries failing (AggregateError), falling back to filesystem-only notes.

## URLs:
- Web UI: https://blackberry-profit-speaks-brunswick.trycloudflare.com (active tunnel as of 17:06 UTC)
- Previous tunnel (flavor-industries-arbitration-collection): 530 error, killed
- Previous tunnel (mph-amp-creates-partner): EXPIRED
- Old tunnel (added-engine-disclosure-explosion): DEAD
- RunPod App: https://ohcjg7x4hxaxlj-3000.proxy.runpod.net
- ComfyUI: https://ohcjg7x4hxaxlj-8188.proxy.runpod.net
