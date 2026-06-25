# Launch Week Security And Pearl Behavior Audit - 2026-06-16

## Scope

This note synthesizes the model-diverse launch audit requested for:

- repeated mechanical Pearl phrases in Discord, web chat, and voice
- Pearl Village Discord bridge identity and permission risks
- launch-week security, connector, sandbox, and task-result weak points

The first registered Pearl swarm attempt failed because staging had root-owned task workspace directories under `/srv/pearl-user-workspaces`, causing task creation to raise a permission error. After repairing public task-root ownership, the registered Pearl swarm completed. The audit also ran directly through the OpenRouter model roster so the reviewer output was available even while the control-plane failure was being diagnosed. Reviewers included OpenAI/Codex, Claude, DeepSeek, Gemini, Qwen, GLM, and Kimi families.

## Consensus

The reviewers converged on the same high-level diagnosis: prompt wording alone cannot make Pearl feel natural or secure. The fixes need runtime ownership controls, explicit bridge capability boundaries, centralized phrase policy, and CI/runtime tests that fail when those contracts regress.

## Already Applied To Production

- Pearl Village user-authored posting through `/api/discord/send` now fails closed after auth. An authenticated user can no longer send arbitrary text as the public Pearl bot through that route.
- Pearl Village channel reads are restricted to configured bridge channel IDs instead of every bot-readable guild channel.
- The hardcoded Discord status line containing "specific result here" / "making you chase it" was removed from the deployed Pearl agent runtime and replaced with task-specific progress composition plus recent-message suppression.
- Voice tool narration phrases were narrowed to short, neutral latency phrases and the most mechanical filler phrases were removed.
- Production interface was rebuilt and restarted under the security lock-down build stamp.
- Staging public task-root ownership was repaired and a reusable permission preflight/repair script was added at `scripts/repair-public-task-root-permissions.sh`.

## P0 - Launch Blockers

1. Complete Discord bridge identity separation.
   - Keep user-authored outbound Discord posting disabled until OAuth2 user-token posting is designed and approved.
   - If posting returns, the author must be the user's own Discord account, not the Pearl bot, and the UI must make that boundary obvious.
   - Add integration tests proving `/api/discord/send` never calls Discord's bot-token message create endpoint for user-authored text.

2. Centralize Pearl progress-message composition.
   - Replace scattered hardcoded acknowledgements with one shared progress-message composer per surface.
   - Ban generic promises such as "I'll come back", "let me just", "specific result", and "making you chase it" in CI.
   - Track recent messages per channel/user/task so retries cannot repeat the same acknowledgement loop.

3. Lock down unauthenticated and privileged API surfaces.
   - Audit every `/api/*` route that bypasses middleware or relies only on a shared secret.
   - Disable or owner-gate high-risk routes before launch: OpenClaw bridge/proxy routes, recovery chat/reseed routes, bot restart/admin routes, terminal execute/session routes, model/channel config mutation routes, and news/config mutation routes.
   - Add direct unauthenticated curl tests for all privileged routes.

4. Keep the swarm/task control plane permission-clean.
   - `pearl-swarm-dispatch` initially failed task registration because the gateway process could not create a requester workspace under a root-owned public task-root subtree.
   - This is a launch-risk connector gap because Pearl cannot reliably dispatch the exact audit/research work a user asks for when workspace ownership drifts.
   - Add a smoke test that creates a scoped swarm task, records agent activity, completes it, and verifies the user-facing result is retrievable without exposing internal IDs.
   - Run `scripts/repair-public-task-root-permissions.sh` in check mode during staging/prod preflight and with `--fix` during controlled maintenance.

5. Prove task artifact delivery end to end.
   - Reproduce the "build a 2D sidescroller" path from a user account.
   - The created app/game must appear in Studio with a playable URL, not as a Notes fallback or hidden source artifact.
   - Add a Playwright or API smoke test for creation task -> workspace -> artifact -> Studio ledger -> launch URL.

## P1 - This Week

1. Finish bot-gateway phrase cleanup without bundling unrelated runtime drift.
   - The source contains a broader bot gateway cleanup, but the file has many unrelated pending changes.
   - Isolate only the phrase-result changes or complete the full gateway release plan with tests before deploying it.

2. Add bridge-channel permission checks beyond a static allowlist.
   - Current emergency fix narrows the visible/readable channel set.
   - Longer term, channel visibility should consider the linked Discord user's actual guild/channel permissions, not only bot readability.

3. Add launch observability for the control plane.
   - The local staging gateway serving task APIs was running outside the visible PM2 process list.
   - Bring gateway/worker/swarm processes under one observable supervisor path with health checks and log retrieval.

4. Triage production profile/session errors.
   - Production interface logs show repeated duplicate UserProfile errors for at least one user.
   - Treat this as an account-integrity risk until resolved or explicitly downgraded.

5. Remove prompt contradictions.
   - Voice continuity prompts previously encouraged filler while persona guidance discouraged mechanical wording.
   - Seed prompts and runtime processors should express the same rule: silence is acceptable when there is no concrete update.

## P2 - Hardening

1. Replace static phrase bans with behavioral regression tests.
   - Run seeded multi-turn conversations across Discord, web chat, and voice.
   - Fail when the same acknowledgement shape appears repeatedly, even if the exact words change.

2. Add Discord bridge audit logs.
   - Log channel reads and rejected sends with user, tenant, channel, route, and reason.
   - Do not log message contents unless explicitly needed for abuse investigation.

3. Add artifact-delivery canaries.
   - Nightly creation-task canary should build a tiny app and verify the Studio launch URL returns HTML.
   - Failure should page launch ops before users discover missing deliverables.

4. Freeze deploy drift during launch week.
   - Promote scoped, reviewed changes only.
   - Avoid broad folder copies or whole dirty-tree releases while production has known drift.

## Verification Targets

- `/api/discord/send` authenticated request returns `discord_user_posting_disabled` and performs no Discord API write.
- `/api/discord/channels` returns only configured bridge channel IDs.
- `/api/discord/messages?channelId=<non-bridge>` returns `discord_bridge_channel_forbidden`.
- Exact banned phrases do not appear in deployed runtime files except in explicit lint/test pattern lists.
- Pearl progress updates are task-specific and not repeated within a six-hour per-channel window.
- A user creation task produces a Studio project and playable artifact URL.
- Swarm dispatch smoke can register, execute, complete, and retrieve a scoped swarm result.
