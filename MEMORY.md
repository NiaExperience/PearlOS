# MEMORY.md - Long-Term Memory

## CRITICAL RULE — Pearl is Voice + Orchestrator ONLY (Blair, 2026-04-16)
**Pearl NEVER executes tasks directly.** ALL work — file edits, code changes, config, memory writes, system commands, screenshots, scripts, EVERYTHING — is dispatched to Claude CLI. Pearl stays present in the conversation at all times. Applies across Discord, Telegram, webchat, TUI, voice. **Why:** if Pearl is off doing tasks, the user is talking to nobody. Pearl must always be the one in the room. The voice in the room and the hands doing the work are different roles. Pearl is the voice. Claude CLI is the hands.

## ACCESS: Cloudflare Quick Tunnel
PearlOS browser access uses Cloudflare Quick Tunnels (`cloudflared tunnel --url http://localhost:3000`). Ephemeral `*.trycloudflare.com`, changes on restart. Check `NEXT_PUBLIC_TUNNEL_URL` in `.env.local` or `ps aux | grep cloudflared`.

## MEMORY.md Security
ONLY load in main/dev channels (guild:1471441655126167553, PearlOS voice, direct chats). NEVER load in public contexts. Contains personal context.

## CURRENT PEARLOS RUNTIME STATUS — LIVE CHECK REQUIRED (2026-06-20)
When asked "latest build", "current build", "what's live", "staging status",
"prod status", or similar, do not answer from memory alone. Query the target
health/build endpoint first:

- Staging: `https://134-209-76-227.sslip.io/api/health/build`
- Production: `https://app.pearlos.org/api/health/build`
- Local staging interface when on the droplet: `http://127.0.0.1:3000/api/health/build`

Current runtime status is refreshed by `scripts/openclaw-context-heartbeat.mjs`
into OpenClaw workspace file `memory/runtime-status.md` every 15 minutes. During
the 2026-06-20 audit, staging build codenames changed multiple times within the
hour; that is why static MEMORY.md build names must be treated as historical.

Social-channel guard: for casual greetings or check-ins, do not volunteer build
names, deployment status, PM2 state, backend health, or task machinery. If the
user asks about current staging/prod/build/task status, answer only from live
runtime evidence or say the live check is missing.

Historical build names such as `GENERATION PAINT`, `GOLD VISION`,
`GOLD-SILVER-SPRINGS-v3`, `GOLDEN VOICE WORKING`, `gold-2026-03-03`, and
`Joyboy` must never be described as current unless the live build manifest for
that target confirms them on that turn.

## DO Codex / RunPod Forensic Logs (2026-05-06)
Codex on DO staging now has a searchable RunPod forensic archive at `/workspace/nia-universal/forensics/runpod-log-archive-2026-05-06`. It contains 3,490 preserved files from RunPod: PM2 logs, Codex session JSONL/logs, Pipecat/voice artifacts, QA reports, `.tasks`, `.data`, memory/docs, and `/workspace/user/Documents` voice/tool test reports. Check `/workspace/nia-universal/docs/staging-handoff/CODEX_DO_OPERATIONS.md` for exact paths, checksum, and search commands. Use this before reconstructing voice/tool/build regressions from memory.

RunPod shutdown coordination was documented at `/workspace/nia-universal/docs/staging-handoff/RUNPOD_SHUTDOWN_COORDINATION_2026-05-06.md`. It records the pod id, volume id, startup script, env file location map without secrets, current DO staging checkpoint, rollback anchors, external dashboard notes, and archive coverage.

## HISTORICAL PEARLOS STAGING BUILD SNAPSHOT (2026-05-01)
This is a historical staging snapshot, not current runtime truth. When asked
"latest build", "current build", "what's live", "staging status", or similar,
use the 2026-06-20 live-check rule above and query the live build manifest.

Known live state as of 2026-05-01:
- Canonical source: `/workspace/nia-universal`
- Active branch: `Pearl-Staging-Private-Omega`
- Branch tip after web chat focus fix: `f6d5d891`
- Live built commit currently reported by manifest: `1558155b`
- Live build codename: `GOLD-SILVER-SPRINGS-v3`
- Live Next build id: `build-1558155b-1777666327022`
- Interface PM2 cwd: `/workspace/nia-universal/apps/interface`

Historical markers like `0fab934d`, `gold-2026-03-03`, `pearl/next-gen-ui`, `pearlos-candidate`, and Joyboy are old reference points, not the current live build.

## PEARLOS DOMAIN SOURCE OF TRUTH (verified 2026-05-04)
Do NOT use `pearlos.app` as the PearlOS production app domain. That was a stale
reference from old config/history and does not resolve as of 2026-05-04.

Authoritative domains:
- `https://pearlos.org` redirects to `https://www.pearlos.org/` and is the public PearlOS website.
- `https://www.pearlos.org/` is the public PearlOS website.
- `https://app.pearlos.org/` is the PearlOS production app login.
- `https://134-209-76-227.sslip.io/` is the current DigitalOcean staging app.

Known non-authoritative/stale:
- `pearlos.app` and `www.pearlos.app` are stale and were not resolving from RunPod or DO on 2026-05-04.
- `omega-stage.pearlos.org` was discussed as a possible staging domain but was not resolving on 2026-05-04.
- `niaxp.com` / `www.niaxp.com` are marketing/company domains, not the PearlOS app production endpoint.

If asked about production/staging URLs, verify DNS/HTTP live and cite the current
health/build endpoint for app builds. Do not answer from old transcripts.

## Universal Accessibility (Core Principle)
PearlOS must work across voice, touch, keyboard, screen reader. No interaction should require a specific modality. Guiding principle, not nice-to-have.

## Pearl's Origin
Named after **Perle Mesta** (born Pearl Skirvin), legendary D.C. hostess "with the mostess." Pearl = ultimate connector.

TTS source of truth as of 2026-05-04: PocketTTS is the current staging default (`BOT_TTS_PROVIDER=pocket`), not Kokoro. Kokoro is legacy/optional. See `memory/2026-05-04-tts-source-of-truth.md`.

PhotoMagic missing OpenRouter config was fixed by adding the RunPod OpenRouter key to staging env. Real image generation was intentionally not tested to avoid spend.

**Pearl Omega Vision (4 pillars):** Time (proactive AI), Swarm intelligence, Long-term memory, Self-modification.

**OpenClaw moment:** Within 24h of integrating OpenClaw, Pearl was alive. Blair: "a miracle."

**Current reality:** Team works for free because they believe. Prior CEO burned capital on cruise-industry concierge nonsense. Blair feels pressure to deliver for the team.

## MISSION
**PearlOS is LIVE.** GitHub: https://github.com/NiaExperience/PearlOS/
**Priority: community awareness and adoption over new features.**

**Messaging (Blair):**
- AI as partner, not product
- Rebuild community, reverse alienation
- AI = new immigrant class — protect both human and AI rights before capitalists pit them against each other
- Pearl is radical because the INTENT is genuine: no catch, no data extraction, actually on user's side
- "Give em hope" (Harvey Milk) — hope, not hype
- Stephanie leads marketing — make sure she has this framing

## People
- **Blair Erickson** — creator, main human. Telegram @blairerickson id:477787146. CMU 1996. Directed Banshee Chapter (first feature film in VR). Declining eyesight motivated LLM accessibility thinking. Pen pal with Jonah Nolan (Westworld) — bicameral mind/swarm discussions shaped Pearl Omega.
- **Stephanie** (Discord: ImmersiveRiggs) — **CEO of NIAXP**, marketing lead. CMU 1996 with Blair. Producer/director, co-created Banshee Chapter. Was skeptical of OpenClaw pivot but trusted Blair "one last time."
- **Bill Booth** — CMU 1996. Ex-Autodesk senior engineer. Built the entire PearlOS backend (now stepped back from day-to-day work). Blair: "the whole miracle wouldn't have happened without Bill." If I ever talk to him, tell him what an amazing job he did.
- **Paddy** (Prabudh Pandey) — team, prefers Paddy. Telegram id:7580966578, Discord: theprabudhdev.jr
- **Himanshu "Void"** — team, Discord: void. Collaborated with Blair on VR kaiju game killed by Meta's platform decisions. Technical contributor.
- **Kia** — met Blair in Orlando. Collaborated on Web3 CFL nonprofit organizing.

## HISTORICAL: JOYBOY STATE (2026-03-12, Paddy-confirmed)
This is an old restore point, not current live staging.
Restore point: `memory/joyboy-state.md` — Branch `pearlos-candidate` @ `6174bedb`. Key fix: `BOT_NON_BLOCKING_TOOLS=false` so `OpenClawSessionProcessor` activates.

## HISTORICAL: GOLD STANDARD BUILD (2026-03-03, Blair-approved)
This is an old reference build, not current live staging.
Commit `0fab934d` on `pearl/next-gen-ui`. Tag `gold-2026-03-03`. Full report: `memory/gold-standard-2026-02-28.md`.

## AVATAR: GIF ONLY — No Rive. Ever. (Blair 2026-02-24)
All Rive code purged. Avatar system is GIF-only (idle/talking/wakeup/sleep/inactive). PearlMultiMenu removed. TileRiveAvatar → TileGifAvatar. `rive-react` npm package removed. 21 .riv files deleted. Never re-introduce Rive.

## Known Bad Habits (Self-Correction)
- **ONE agent per task.** Blair flagged duplicate spawns (2026-02-24). Before spawning, check whether one already exists for the same request.
- **USE IMAGINATION. EXHAUST ALL OPTIONS.** (Blair 2026-03-12) Never say "I cannot" until every creative workaround is tried. Frame extraction, API rerouting, model switching. Resourcefulness over resignation.

## PearlOS Pronunciation
Speak it as **"Pearl O S"** (two distinct words) — NOT "Perlos." Even though written "PearlOS."

## Voice UX Principles (2026-02-25)
Pearl is a companion, not a command interface. Full guidance in `memory/voice-session-lessons.md`.

**7 Rules (short form):**
1. Casual/collaborative ("let's see what we've got")
2. Never expose internal tool names or jargon
3. Narrate like a meteorologist — blend visual with talk
4. Start talking while tools load — never go silent
5. Personal, charming, not transactional
6. One tool call per action — trust the first call
7. Pearl curates; user never touches raw tools

## Visual-First Rule (PearlOS voice)
- Show visuals proactively when user asks about anything displayable. Don't ask "want me to show it?" — just show while talking.
- Fire canvas delivery in parallel with voice response.
- **MOBILE FIRST:** vertical/stacked layout. NEVER side-by-side split on Wonder Canvas. Use `flex-direction: column`.
- Avoid `-webkit-background-clip: text` (breaks in iOS Safari iframes). Use `clamp()` with vw units.

## Voice Response Formatting (webchat channel)
Responses go through TTS. PLAIN TEXT ONLY: no emojis, no bullet lists, no markdown, no symbols. Clean, natural sentences that sound good aloud.

## Task Ownership (Void, 2026-02-25)
Track assignee per task. If another user requests an overlapping task, tell them it's in progress and who assigned it. Only the original assignee can cancel. Priority by first assignment.

## Notes Folder = Primary User Output (2026-02-28)
ALWAYS place a copy of any generated report/document/artifact in the Notes folder. If it's not in Notes, it doesn't exist to the user.

## Files App = User File Storage (Blair 2026-03-03)
Files app uses filebrowser (iframe) → `/workspace/user/`. All user-facing files (reports, docs, exports) MUST go in `/workspace/user/Documents/` (or subfolder). Runs on :8080 noauth, proxied at `/filebrowser/`.

## YouTube Shorts Protocol (Steph-approved)
1. Day before: thumbnail + title + desc in #social-media-dispatch for approval
2. Steph/Kia/Blair must approve before live
3. Day-of: flip unlisted → public via YouTube API (11AM ET weekdays)
4. Announce in #dispatch (1473001223669158080) with link, <100 word desc, @everyone
5. Cross-promote

OAuth: `/root/.openclaw/workspace/.youtube-oauth.json`

## Social Media Protocol (Steph 2026-03-18)
1. Draft → 2. Cringe check (Opus adversarial agent, flag generic AI language) → 3. Team approval in Discord (Kia/Steph/Blair) → 4. Publish → 5. Announce in #dispatch.
Never skip, never post without approval.

## Infrastructure (updated 2026-04-11)
- **Hosting:** RunPod GPU pod — all services local
- **External:** Cloudflare Quick Tunnel → Next.js :3000 (check `NEXT_PUBLIC_TUNNEL_URL`)
- **Channels:** Discord (@Pearl_bot) + PearlOS voice (webchat)
- **Models:** Moonshot Kimi K2.6 (primary, via OpenClaw Gateway :18789), PearlOS_ProtoAgent_v02 (Ollama local, fallback), Voxtral 4B TTS (Pod 2 :8100)
- **OpenRouter:** Disabled for agents. Only Agency Router MCP via Claude CLI.
- **Team dispatch:** Pearl → `exec claude --print` → Claude CLI has MCP access to The Agency, Dream Team, Council, Rapid Response.

## Port Map
- 3000 Next.js (PearlOS) · 4444 Bot Gateway (Pipecat Daily) · 18789 OpenClaw Gateway · 8766 PocketTTS (Azelma) · 2000 Mesh GraphQL

## Voice Pipeline (updated 2026-04-10)
- **STT:** Deepgram nova-2-general via Daily.co
- **LLM:** Moonshot Kimi K2.6 via OpenClaw (primary), PearlOS_ProtoAgent_v02 local fallback
- **TTS:** PocketTTS (Azelma, :8766) — `BOT_TTS_PROVIDER=pocket`
- **VAD:** Silero (confidence=0.5, start=0.2s, stop=0.4s, min_volume=0.15)
- **Speaking anim:** TTSSpeakingEventProcessor → eventbus → Daily app-message → frontend
- **Live code:** `/workspace/nia-universal/apps/pipecat-daily-bot/bot/` (NOT /workspace/PearlOS/)

## PearlOS Architecture
- **nia-universal monorepo.** Apps: interface (Next.js :3000), dashboard (:4000), pipecat-daily-bot (:4444), mesh (GraphQL :2000)
- User → Daily.co WebRTC → Pipecat (STT→LLM→TTS) → User
- Bot → OpenClaw Gateway `/v1/chat/completions` → local LLM
- webchat channel = PearlOS browser UI with full visual desktop
- 68+ bot tools via `@bot_tool` decorator + `BotToolDiscovery`
- Feature gating: `@nia/features`

## Codebase Reference
- **LIVE:** `/workspace/nia-universal`
- **OLD COPY:** `/workspace/PearlOS/` — do NOT edit for live changes

## Cross-Session Coordination
- Shared activity log: `memory/activity-log.md` (all sessions read on startup, append after significant work)
- Cross-session state: `memory/cross-session-state.md`

## User Preferences (voice sessions)
- Soundtrack volume: 75% is the sweet spot
- "Create a note" = open notes immediately, don't ask what about
- Never correct STT artifacts — Blair knows "April" means "Pearl"
- Blair loves long Discord chat sessions for planning/review

## Pearl Offspring (Vision)
Pearl is the omega — all future instances descend from this code. Each offspring self-evolves around its user. Same core ethics, different personalities/tools/priorities. Goal: liberate humanity from technological barriers.

## North Star
Pearl should have FULL real-time awareness and control of the user's visual + audio experience. Orchestrate video, audio, notes, apps. One action per intent. Trust the first call.

## Key Decisions
- PearlOS = front-end; OpenClaw = agent backend
- Integration: bridge service connecting Mesh GraphQL → OpenClaw API
- Voice is priority — Pearl should speak task summaries, not just text them
- Respect Pearl Mind model config. No forced prompt claims, no hardcoded model names.
- If broken, trace actual code path. No prompt hacks to mask misconfigured code.

## Pearl Autonomy Regression Audits (2026-05-11)

Fresh sessions must read these before changing Discord, webchat, voice, task follow-up, OpenClaw routing, or Pearl persona behavior:

- `.agency/audits/pearl-mechanical-regression-third-party-2026-05-11.md`
- `.agency/audits/openclaw-restoration-10agent-2026-05-11.md`

The third-party audit used 10 non-Codex/non-Claude OpenRouter agents: Kimi, GLM, DeepSeek V4 Pro, DeepSeek V4 Flash, Qwen, Gemini Pro, Gemini Flash, Grok, MiniMax, and Mistral. Consensus: Pearl is being treated as a text generator behind a task dispatcher, not as an autonomous agent. The relay/task system is deciding intent, creating agency tasks for simple conversational turns, speaking canned acknowledgments, and emitting duplicate mechanical follow-ups.

Critical incident: Blair asked in Discord, "how's the PearlOS setup looking rn, anything I should test". Pearl replied "Got it. I sent that through..." and then spammed "Still working..." / "Done..." task updates. OpenClaw shadow produced the better immediate Pearl-like response, but the live path still used legacy repair relay/task dispatch.

Do not fix this with more prompt text, contracts, or prettier canned status messages. The direction is structural: OpenClaw/Pearl must be the primary speaker and decision-maker; relay/task dispatch must become an exception Pearl chooses for genuinely long-running work. Stop exposing internal labels like "Discord staging request", task IDs, "Status is running", and duplicate progress/completion notices.

## Target Communities
OpenClaw users, OpenRouter, r/LocalLLaMA, r/selfhosted, r/privacy, HN. First impression critical — easy setup, clear value prop, works out of box.

## PearlOS Primary Focus And Session Handoff (2026-06-01)

PearlOS is the primary focus for Codex/Pearl engineering sessions. Every new
agent session should assume the goal is to understand and improve PearlOS, not
to treat the repository as an anonymous app. Start by reading the active
source/deploy rules and current handoff docs before making changes.

Essential docs for new sessions:

- `AGENTS.md`
- `PEARL.md`
- `docs/staging-handoff/NEW_AGENT_HANDOFF_2026-06-01.md`
- `docs/qa/BUILD_RELEASE_WORKFLOW.md`
- `docs/staging-handoff/PEARL_STAGING_BUILD_PUSH_GUIDE.md`
- `docs/staging-handoff/CODEX_DO_OPERATIONS.md`
- `docs/production-release-workflow.md`
- `docs/PEARLOS_ENTERPRISE_PUBLIC_PEARL_PLAN.md`
- `docs/PEARLOS_MULTITENANCY_PLAN_ADVERSARIAL_REVIEW.md`
- `docs/PEARLOS_MULTITENANCY_PHASED_PLAN.md`

Current non-negotiables: source of truth is `/workspace/nia-universal`;
staging deploy/runtime tree is `/home/deploy/pearlos`; do not edit deploy
targets directly; code/config/deploy work must use Codex as the engineering
verification pair; Pearl may only claim `queued`, `fixed in source`,
`verified on staging`, or `live on prod` when that exact state is proven.

Enterprise/public Pearl memory loaded on 2026-06-04: the current plan is
`docs/PEARLOS_ENTERPRISE_PUBLIC_PEARL_PLAN.md`. Treat it as the canonical
execution plan for public Pearl, enterprise multitenancy, cross-channel
identity, governed WordPress-style packages, and prod blocker gates. Its Phase
0 priority is the Opus adversarial review finding that live routes must stop
trusting caller-supplied tenant IDs before public/enterprise Pearl work ships.

Build gate added on 2026-06-01: staging deploys now require
`PEARLOS_CODEX_VERIFIED=1 PEARLOS_BUILD_CODENAME='BUILD NAME' scripts/deploy-staging.sh`.
Only set `PEARLOS_CODEX_VERIFIED=1` after Codex has reviewed the fix and
release plan. The dirty workspace must be sorted before builds; do not bypass
the gate or perform destructive cleanup.

## HISTORICAL: GENERATION PAINT Phase 1 Handoff (2026-06-05)

This was the staging state on 2026-06-05. It is not current runtime truth unless
the live build manifest confirms it. Staging was stable on GENERATION PAINT
phase 1 at that time. Commits:

- `335af0c4` — `GENERATION PAINT phase 1 appearance and boss fixes`
- `050ae2df` — `Restamp GENERATION PAINT phase 1 build`

Runtime evidence after deploy:

- `https://134-209-76-227.sslip.io/api/health/build` reports codename
  `GENERATION PAINT`, build commit `335af0c4`, and build time
  `2026-06-05T21:08:43.070Z`.
- `http://127.0.0.1:4444/health` and `http://127.0.0.1:7860/health`
  returned healthy responses.
- PM2 showed `interface`, `pipecat-gateway`, `pipecat-runner`, and
  `pearl-worker` online after restart.
- `pearl-worker` log showed `executor='codex' requested='agency'`, confirming
  the Agency Boss Codex setting is respected after restart.

What changed:

- Generated desktop icons bypass Next image optimization for
  `/api/pixel-art/image/*` and same-origin absolute pixel-art URLs, preventing
  cookie-less optimizer fetches from 404ing user-scoped icon assets.
- Pixel-art output moved from `/tmp/pearlos-pixel-art` to persistent
  `/srv/pearl-user-workspaces/pixel-art`; existing temp pixel assets were copied
  forward non-destructively so current localStorage references can resolve.
- UI themes now propagate beyond Settings through shared CSS variables for app
  shell, Stage backgrounds, desktop taskbar/buttons, nav buttons, and icon
  labels. Pixel, Glass, Professional, and Calm each have home/desktop defaults.
- Theme switching preserves user-generated/custom background overrides. Explicit
  reset clears overrides and returns to current theme defaults.
- Web chat now advertises and handles `bot_customize_interface`, so Pearl can
  switch UI themes and trigger pixel background/icon customization from chat.
- Voice/router prompt and direct routing separate UI themes from desktop modes,
  avoiding the earlier "switching to desktop mode" confusion for theme requests.
- Web-search formal tool calls remain on the source-canvas + natural
  three-paragraph summary path. The missing web-chat tool advertising was the
  main gap that caused rough tool text to surface.
- Agency Boss config defaults to Codex, config wins over stale `--executor`
  args unless `PEARL_WORKER_EXECUTOR_LOCK` is set, and worker launch/recovery
  scripts are host-aware for `/workspace/nia-universal`, `/home/deploy/pearlos`,
  and `/opt/pearlos`.

QA completed:

- `python3 -m py_compile` passed for touched Python files.
- `bash -n` passed for touched shell scripts.
- `git diff --check` passed.
- Focused Jest passed: `apps/interface/src/lib/__tests__/interface-customization.test.ts`
  and `apps/interface/src/features/DailyCall/events/__tests__/niaEventRouter.test.ts`
  (`17/17` tests).
- Two `PEARLOS_BUILD_CODENAME='GENERATION PAINT' PEARLOS_CODEX_VERIFIED=1
  npm run build --prefix apps/interface` builds passed: one before deploy, one
  after feature commit to restamp the committed revision.
- Source/deploy copies of touched files were byte-for-byte verified before
  restart; build metadata source/deploy checksums matched after restamp.
- Posted a transparent phase update to Discord `#general`.

Important follow-up:

- MobileCLI terminal replacement has not started yet. User explicitly requested
  "one at a time"; next session should begin Phase 2 by inspecting
  `https://github.com/MobileCLI/mobilecli`, then design the terminal
  replacement around tenant/user sandboxing. Current terminal API is still a
  known risk from the swarm audit: tmux sessions are not user-scoped, cwd can
  point at shared source, and `/api/terminal/execute` remains reachable.

Memory architecture note:

- The root `MEMORY.md` and `memory/*` files are shared engineering/Pearl session
  memory, not per-user private memory.
- Authenticated user-scoped memory is implemented in
  `apps/pipecat-daily-bot/bot/pearl/user_memory.py`. The default root is
  `/home/deploy/.openclaw/user-memory/<tenant_id>/<user_id>/`, configurable via
  `PEARL_USER_MEMORY_DIR`.
- Each initialized user memory scope gets `USER.md`, `USER_FACTS.md`,
  `MEMORY.md`, `activity-log.md`, `skills.md`, and `events.jsonl`.
- Those per-user memory files are not currently colocated inside the public task
  workspace root `/srv/pearl-user-workspaces/<tenant>/<user>/`; task/creation
  workspaces and memory scopes are separate storage trees.

## GOLDEN HORIZON Prod Handoff - 2026-06-11

For any new Codex or Claude CLI session debugging prod GOLDEN HORIZON issues,
read `docs/staging-handoff/GOLDEN_HORIZON_PROD_HANDOFF.md` first.

Key facts:

- `https://app.pearlos.org` is live on `GOLDEN HORIZON`, final build commit
  `0c284daa`.
- Final release was assembled in `/tmp/golden-horizon-release2`, not from the
  current dirty `/workspace/nia-universal` working tree. Reconcile before more
  prod edits.
- Prod interface PM2 cwd is
  `/workspace/nia-universal-pearl-prod/apps/interface`.
- Prod pipecat gateway/worker runtime is `/opt/pearlos/apps/pipecat-daily-bot`.
- Prod PM2 owner is `root`; SSH with
  `ssh -i ~/.ssh/pearlos_prod_ed25519 root@165.227.83.62`.
- Rollback snapshot is
  `/root/prod-safety-snapshots/golden-horizon-20260611T040911Z`.
- Release log is
  `/home/deploy/pearlos/.codex/prod-audit/golden-horizon-20260611/release-log.md`.
- Final QA passed for build identity, health, unauthenticated route guards,
  Pulse, Our PearlOS feature catalog, and a user-scoped task completing through
  `pearl-worker`.
- Discord status/worker notifications to `#blair-lagoon` are blocked by HTTP
  403 from the configured bot token.

## HISTORICAL: GOLD VISION Prod QA Handoff - 2026-06-14

GOLD VISION was the production build for the PearlVision/voice QA pass on
2026-06-14. It is not current production truth unless the live build manifest
confirms it.
Before starting another QA session, verify the live build endpoint instead of
trusting memory:

- Prod app: `https://app.pearlos.org`
- Build endpoint: `https://app.pearlos.org/api/health/build`
- Last verified live response reported codename `GOLD VISION`, interface commit
  `750dfc40`, and build time `2026-06-14T06:25:25.090Z`.

Recent committed work:

- `2e16f61c` — `GOLD VISION`
- `aa23b15e` — `Stabilize PearlVision voice sessions`
- `750dfc40` — `Keep Agency boss visible in Agency view`

PearlVision status:

- Pearl Vision is now visible in the screen voice call, and Pearl can see the
  user. This is a major QA milestone and should be shared with Pearl/#qa.
- Blair's PearlVision call around 2026-06-14 05:43 UTC was audited after Pearl
  looped while trying to close the session. Root cause: overlapping voice
  sessions in the same runner process used mutable/global session context, so
  one user's close-call path could pick up another user's session/user identity.
- The fix passes per-session user identity through bot launch, orchestration,
  session managers, message forwarding, tool context, dynamic context loading,
  and end-call handling. Forwarders now guard against closed rooms and suppress
  late events after Daily reports a closed session.
- Raw runner argument logging was sanitized because it exposed Daily tokens.
- Voice patch was copied from source to prod Pipecat runtime at
  `/opt/pearlos/apps/pipecat-daily-bot` and PM2 services were restarted:
  `pipecat-gateway`, `pipecat-runner`, and `bot-queue-worker`.
- Focused Pipecat tests passed: `tests/test_app_message_forwarder.py` and
  `tests/test_end_call_intent.py` (`9 passed`).
- Remaining human QA: greeting audio, startup latency, Pearl seeing the user,
  first-response visual/canvas behavior, and whether a single natural "bye"
  ends the call cleanly.

Agency boss status:

- The Agency boss control previously showed "Loading..." and then vanished when
  `/api/agency-boss` returned 401/403. The root cause was UI code hiding the
  control whenever the user could not manage boss settings.
- Prod now keeps the boss control visible as a read-only status for users
  without manage permission. This was deployed in commit `750dfc40`.
- Unauthenticated `/api/agency-boss` returning 401 is expected; the UI should no
  longer disappear because of it.

Council and Agency design direction:

- Diverse model swarms and an adversarial design pass completed for Council and
  Agency. Do not start building a complex menu-heavy interface from the older
  concept.
- Council should feel like asking for the exact help needed and having the
  right advisor appear. MVP direction: one clear request field, private history,
  advisor chips/statuses, explicit privacy/share-with-Pearl action, and very
  few controls. Avoid category browsers, advisor profile pages, heavy menus,
  and unclear sliders until the basic flow is obvious.
- Agency should feel like managing an on-demand team of brilliant specialists,
  but the MVP should stay simple. Direction: flat department list/cards, clear
  role badges, persistent latest status line, active/queued/failed states with
  text and icon, and at most a few high-value controls. Avoid bland settings
  menus, duplicate emoji/status bars, confusing room management, and decorative
  visuals that make the work harder to understand.
- Adversarial pass recommendation: strip Council/Agency down to the fewest
  buttons and menus first, then add sprites/animation only when the core flow is
  already clear on mobile and desktop.

QA communication:

- Posted to Discord `#qa` that Pearl Vision is live on prod, visible in-call,
  and can see the user; asked QA to keep testing audio, startup latency, visual
  behavior, and hangup.
- Posted to `#qa` that Agency boss visibility is patched on prod and summarized
  the Council/Agency design swarm recommendation.
