# Staging Protection Protocol

## Purpose

Prevent autonomous agents (pearl-worker, swarm, etc.) from hijacking
staging services — e.g., repointing the `interface` PM2 process at the
wrong source tree, overwriting build artifacts, or binding the wrong
app to port 3000.

Incident that motivated this doc: 2026-04-24, task `disp-21cab766d1`
("Rebuild and redeploy pearlos-website") ran `pm2 delete interface &&
pm2 start "npm start" --name interface --cwd /workspace/pearlos-website`,
causing the PearlOS staging URL to serve the marketing site for ~5
minutes. Blair did not verbally approve the change.

## Protected Services

These PM2 processes are the **core staging surface**. Mutating them
requires explicit verbal approval from Blair for the specific task,
unless a **blanket-approval window** is active (set in `pearl-worker.py`
CLAUDE_FOOTER). Accepted approval phrases: "approved by Blair",
"no approval needed", "Blair approved".

| Process           | Port  | Expected cwd                                     |
|-------------------|-------|--------------------------------------------------|
| interface         | 3000  | /opt/pearlos/apps/interface                      |
| mesh              | 2000  | /opt/pearlos/apps/mesh                           |
| pipecat-gateway   | 4444  | /opt/pearlos/apps/pipecat-daily-bot/bot          |
| pipecat-runner    | -     | /opt/pearlos/apps/pipecat-daily-bot/bot          |
| bot-queue-worker  | -     | /opt/pearlos/apps/pipecat-daily-bot/bot          |
| openclaw-gateway  | 18789 | /workspace/OpenClaw                              |
| pearl-worker      | -     | /workspace/runpod-slim                           |

Source of truth: `/opt/pearlos/ecosystem.pearlos.config.js`.

## Rules for Autonomous Tasks

Injected into every pearl-worker Claude prompt via
`pearl-worker.py CLAUDE_FOOTER`:

1. **Never** `pm2 stop/delete/restart/start/save` any process in the
   Protected Services list without "approved by Blair" text in the task
   body.
2. **Never** start a process named `interface` (or `mesh`, `pipecat-*`,
   `openclaw-*`, `bot-queue-worker`) with `--cwd` outside `/opt/pearlos`
   or `/workspace/nia-universal`.
3. **Never** `rm -rf` or overwrite files in `/opt/pearlos/apps/*/. next`
   or `/opt/pearlos/apps/*/build` from any other source tree.
4. **Website tasks** (`pearlos-website`, `pearlos.org`, thoughts posts)
   must stay inside `/workspace/pearlos-website` and must NEVER touch
   `/opt/pearlos/apps/interface` or the `interface` PM2 process.
5. **If staging is already drifted**, STOP. Post Discord alert. Ask for
   human intervention. Do not keep mutating PM2 state.
6. Dev/test servers for the website run on a **different port** (not
   3000) and under a **different PM2 name** (e.g. `pearlos-website-dev`).

If a task appears to require violating these rules, the agent must
refuse with `pearl-task fail ... --error "refused: requires Blair
approval for core staging mutation"` and post to Discord.

## Drift Detection: pm2-staging-guard.sh

`/opt/pearlos/scripts/pm2-staging-guard.sh` runs every minute via cron:

- Reads `pm2 jlist` and compares each Protected Service against the
  expected cwd.
- On drift: writes to `/tmp/pm2-staging-hijack-alert` and posts a
  Discord alert to `#pearl-os`.
- Does **not** auto-restore — a hijack means a human needs to review
  before recovery.

Cron entry:
```
* * * * * /opt/pearlos/scripts/pm2-staging-guard.sh
```

Log: `/tmp/pm2-staging-guard.log`.

## Recovery Playbook

If the guard fires or staging is visibly wrong:

1. Check `/tmp/pm2-staging-guard.log` and `/tmp/pm2-staging-hijack-alert`
   to see which process drifted and where to.
2. `pm2 show <name>` to confirm current cwd.
3. Stop the hijacking task if it is still running (check `pm2 logs
   pearl-worker`).
4. `pm2 delete <name> && pm2 start /opt/pearlos/ecosystem.pearlos.config.js --only <name>`
   to restore from the manifest.
5. Run `pm2 save` to persist the correct state to `/root/.pm2/dump.pm2`.
6. Rebuild if the build artifacts were tampered with:
   `cd /opt/pearlos/apps/<name> && npm run build`.
7. Post a postmortem to Discord `#pearl-os` (what hijacked, scope,
   recovery time).

## When to Change These Rules

- A new core service is added to staging → add to this doc, to
  `ecosystem.pearlos.config.js`, and to the MANIFEST in
  `pm2-staging-guard.sh` (all three must be updated together).
- A port changes → update the prompt footer rules in `pearl-worker.py`.
- A new agent surface is added that can dispatch claude tasks → ensure
  it also injects these rules into its prompt.

## Related Files

- `/opt/pearlos/scripts/pm2-staging-guard.sh` — drift detector
- `/opt/pearlos/ecosystem.pearlos.config.js` — expected state
- `/opt/pearlos/scripts/pearl-worker.py` (CLAUDE_FOOTER) — rules injected
  into autonomous task prompts
- `/opt/pearlos/scripts/pearl-worker-watchdog.sh` — keeps the worker alive
