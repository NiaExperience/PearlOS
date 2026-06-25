# PearlOS Bug Tracker

Last updated: 2026-06-18

## How to Use

Add new bugs at the top of the table. Each row must include:
- **Date** (UTC)
- **Time** (UTC)
- **User** who reported it
- **Status**: Open, Investigating, Fix In Progress, Resolved, Won't Fix
- **Priority**: P0 (blocker), P1 (high), P2 (medium), P3 (low)
- **Environment**: Staging or Production
- **Discord Link**: Permalink to the #qa message where it was reported

---

## Active Bugs

| # | Date | Time | User | Bug | Status | Priority | Env | Discord Link |
|---|------|------|------|-----|--------|----------|-----|--------------|
| 34 | 2026-06-18 | 10:18 UTC | Blair | Prod voice could not find a user-created Jurassic Park theme and repeated mechanical "on it" style progress speech | Fix In Progress | P1 | Production | Reported in voice |
| 33 | 2026-06-12 | 13:15 UTC | Blair | Webchat visual/ranked-list prompts can degrade into slow search-result summaries with no canvas, source/process-flavored wording, and weak companion text | Fix In Progress | P1 | Production | Reported in webchat |
| 32 | 2026-06-12 | 04:45 UTC | Blair | Webchat all-time games infographic prompt returned a plain 2024 search summary and no canvas instead of a visual all-time infographic | Resolved on Prod; QA Retest Requested | P1 | Production | Reported in webchat |
| 31 | 2026-06-12 | 04:18 UTC | Blair | Webchat/canvas v3 retest failed: console-wars timeline canvas appeared underneath webchat, Pearl replied only "Done.", and attempted recovery cleared the canvas instead of presenting split view with companion text | Resolved on Prod; QA Retest Requested | P1 | Production | Reported in webchat |
| 30 | 2026-06-12 | 03:15 UTC | Blair | Webchat/canvas v3 cluster: duplicate canvas windows, canvas covering chat, hard-wired timeline acknowledgement, lost first typed characters, compact Pearl message visibility, and emoji reaction tap behavior | Resolved on Prod; QA Retest Requested | P1 | Production | Reported in webchat |
| 29 | 2026-06-12 | 02:44 UTC | Blair | Webchat "show me a timeline..." canvas requests could be misclassified as stale visual follow-ups, causing acknowledgement/status text to appear on canvas instead of the requested visual | Resolved on Prod; QA Retest Requested | P1 | Production | Reported in webchat |
| 28 | 2026-06-11 | 22:59 UTC | QA Audit | Notes residual persistence edges: DB notes could fail writes, file notes could lose mode/title metadata, welcome notes could duplicate across stores, and diary entries could not update/delete | Resolved on Prod; QA Retest Requested | P1 | Production | #qa |
| 27 | 2026-06-11 | 13:12 UTC | ImmersiveRiggs | In-app Browser Google/search-box submissions returned to a blank page because proxied searches dropped the typed query | Resolved on Prod; QA Retest Requested | P1 | Production | #qa |
| 26 | 2026-06-11 | 13:15 UTC | ImmersiveRiggs | News article reader returned unformatted/raw article text instead of preserving article paragraphs and structure | Resolved on Prod; QA Retest Requested | P2 | Production | #qa |
| 25 | 2026-06-11 | 13:16 UTC | ImmersiveRiggs | Pearl Village Connect took over the Pearl tab instead of opening Discord OAuth separately | Resolved on Prod; QA Retest Requested | P2 | Production | #qa |
| 24 | 2026-06-11 | 22:34 UTC | QA | Web-chat/onboarding note creation used the bare Notes file endpoint, and welcome-note duplicate checks missed notes indexed by userId | Resolved on Prod; QA Retest Requested | P1 | Production | #qa |
| 23 | 2026-06-11 | 22:22 UTC | ImmersiveRiggs | Image generation returned auth errors or bizarre pixel-art artifacts because voice requests could miss the intended Photo Magic route | Resolved on Prod; QA Retest Requested | P1 | Production | #qa |
| 22 | 2026-06-11 | 22:10 UTC | QA | Pearl VJ/YouTube search returned weak movie/comedy results for specific requests and the navigation controls were hidden/missing | Resolved on Prod; QA Retest Requested | P1 | Production | #qa |
| 21 | 2026-06-11 | 13:25 UTC | ImmersiveRiggs | Notes no longer shows archived Pearl chats in Chat History, and chat archive success could hide failed Notes writes | Resolved on Prod; QA Retest Requested | P1 | Production | #qa |
| 20 | 2026-06-11 | 13:39 UTC | ImmersiveRiggs | Our Pearl +Add/Remove buttons do not persist installed feature state, so added community features can look non-functional or drift across reloads/devices | Resolved on Prod; QA Retest Requested | P1 | Production | #qa |
| 19 | 2026-06-11 | 13:26 UTC | ImmersiveRiggs | Styles close leaves a blank blurred overlay that has to be closed again; Styles should show previews before theme selection | Resolved on Prod; QA Retest Requested | P2 | Production | #qa |
| 18 | 2026-06-11 | 20:43 UTC | Blair | Settings/Profile layout makes account email look public; Public/Private profile data needs clearer separation and raw private memory cleanup | Resolved on Prod; QA Retest Requested | P1 | Production | #qa |
| 17 | 2026-06-11 | 19:47 UTC | ImmersiveRiggs | Telegram Pearl leaks raw function/tool calls such as `memory_search` into user-facing messages | Resolved on Prod; QA Retest Requested | P1 | Production | #qa |
| 16 | 2026-06-11 | 15:09 UTC | ImmersiveRiggs | Filespace PDF open looked like nothing happened and could hit Chrome popup blocking without guidance | Resolved on Prod; QA Retest Requested | P1 | Production | #qa |
| 15 | 2026-06-11 | 13:36 UTC | ImmersiveRiggs | Weather defaulted to North Bergen/server geo-IP when browser location was disabled, with no manual location input | Resolved on Prod; QA Retest Requested | P2 | Production | #qa |
| 14 | 2026-06-11 | 13:35 UTC | ImmersiveRiggs | Studio Samples/legacy creation playback returned `{"error":"Not found"}` after a build completed | Resolved on Prod; QA Retest Requested | P1 | Production | #qa |
| 13 | 2026-06-11 | 19:06 UTC | QA | Sprite Summoner starts summoning, then resets without delivering saved sprites because the Sprite list query sends lowercase `and` to GraphQL | Resolved on Prod; QA Retest Requested | P1 | Production | #qa |
| 12 | 2026-06-07 | 21:39 UTC | Blair | Staging global error page felt alarming and linked to recovery/settings instead of a safer operator path | Verified on Staging | P2 | Staging | N/A |
| 11 | 2026-06-07 | 21:22 UTC | Blair | Discord assistant messages leaked raw tool-call markup instead of keeping tool execution internal | Resolved on Prod; QA Retest Requested | P1 | Production | N/A |
| 10 | 2026-06-03 | 02:18 UTC | Blair | Prod public Pearl voice used the wrong user name ("Stephanie") and must read the authenticated UserProfile while storing user chat data under per-user folders | Verified on Prod; QA Retest Requested | P1 | Production | N/A |
| 9 | 2026-06-03 | 01:55 UTC | Blair | Public Pearl web chat search/tool recovery after crashed session: restore web search execution, leaked JSON tool-call handling, and public profile lookup | Resolved | P1 | Staging | N/A |
| 8 | 2026-05-26 | ~20:40 UTC | ImmersiveRiggs | Port 4444 (Pipecat Bot Gateway) publicly exposed on prod — returns full task data with user emails, no auth required | Resolved | P0 | Production | [link] |
| 7 | 2026-05-26 | ~20:40 UTC | ImmersiveRiggs | Prod preflight audit blocked by feedback.jsonl runtime artifact in tracked files — RESOLVED: committed fix d0095d5d | Resolved | P1 | Staging | [link] |
| 6 | 2026-05-26 | ~20:25 UTC | ImmersiveRiggs | Prod Pearl voice addressed Steph as "Angel" — possible session/identity mix-up between concurrent users | Covered by #10 Prod Fix; QA Retest Requested | P1 | Production | [link] |
| 5 | 2026-05-26 | ~20:25 UTC | angel_70160 | Mic contention: having staging + prod tabs open simultaneously causes one Pearl to go to sleep (browser mic lock) | Resolved on Prod; QA Retest Requested | P2 | Both | [link] |
| 4 | 2026-05-26 | 20:21 UTC | ImmersiveRiggs | Prod onboarding flow not completing for Steph | Runtime State Reset; QA Retest Requested | P1 | Production | [link] |
| 3 | 2026-05-26 | 20:17 UTC | angel_70160 | Voice Pearl on Prod shut down, won't wake on click — RESOLVED: caused by mic contention with staging tab | Resolved | P1 | Production | [link] |
| 2 | 2026-05-26 | 12:53 UTC | ImmersiveRiggs | Social Connections description has extra sentence that no longer matches; trim to "You can chat w Pearl in places you already use!" | Resolved | P2 | Production | [link] |
| 1 | 2026-05-26 | 12:47 UTC | ImmersiveRiggs | Telegram not responding to messages (Steph sent /start and "Hi Pearl!" with no reply) | Investigating | P1 | Staging | [link] |

---

## Bug Details

### Bug #34: Voice custom theme lookup and robotic progress loops

- **Reported**: 2026-06-18 by Blair after a production voice session around 06:18 Eastern / 10:18 UTC.
- **Status**: Fix in progress.
- **Impact**: Pearl could fail to find an already-created account-local custom theme when the user named it naturally, then repeat generic progress phrases such as "on it" instead of staying conversational or giving concrete findings.
- **Root cause**: The voice tool schema and compact system tool did not carry a named sandbox-asset query, custom theme application paths accepted only built-in or exact generated theme IDs, and the bot-side sandbox inventory request could hit the bot gateway rather than the interface API. The non-blocking voice router also still had hardcoded fallback/status phrases that could become spoken filler during tool delays or errors.
- **Resolution**: In progress. Add query-aware sandbox inventory search, resolve custom themes by id/label/prompt before applying them, make the bot inventory client prefer the interface API, update voice prompts/tool schemas to require inventory lookup for user-created assets, and strip/suppress generic progress acknowledgements before TTS.
- **Runtime proof required**: Production voice/tool logs must show the inventory route is reachable from the bot service, "Jurassic Park" returns a custom theme match for the requester, no bare "on it" filler is emitted through TTS, and the build/bot services are restarted from the reviewed source patch.

### Bug #33: Webchat visual/ranked-list prompts degrade into bland search output

- **Reported**: 2026-06-12 by Blair from webchat as `blair@niaxp.com`
- **Status**: Fix in progress.
- **Impact**: Requests in the same class as "best selling novels of the 20th century" could return a slow, bland search-result digest instead of opening Wonder Canvas and giving a natural companion answer. The visible text could include source/process phrasing such as "clearest signal came from..." and could sound like a mediocre search engine rather than an intelligent Pearl response.
- **Root cause**: The dynamic ranked-list/visual path was still routing some companion-ready tool results through a second model finalizer because the hidden `[[pearl:companion-ready]]` marker was sanitized before classification. That added latency and made visual/search prompts more likely to expose weak fallback phrasing.
- **Resolution**: In progress. Preserve raw companion-ready tool results through classification, keep final sanitization at display time, and verify with randomized Playwright prompts that canvas opens once, companion text is natural, source/tool/process wording stays hidden, and latency stays within the QA threshold.
- **Runtime proof required**: A randomized visual QA run must pass and post PNG screenshots to `#blair-lagoon`.

### Bug #32: Webchat all-time games infographic did not open canvas — INVALIDATED AFTER HARDCODE AUDIT

- **Reported**: 2026-06-12 by Blair from webchat as `blair@niaxp.com`
- **Status**: Reopened. The previous `GOLDEN HORIZON v5` resolution is invalid because it used a prompt-specific deterministic answer path.
- **Impact**: Asking "He Pearl can you show me an infographic of the most popular games of all time" produced a plain search summary about 2024 games and did not open Wonder Canvas. The request also drifted from "all time" to "2024," making the answer both visually wrong and semantically wrong.
- **Root cause**: The agent/tool path was bypassed by local prompt-specific code instead of being repaired to produce dynamic canvas output.
- **Resolution**: In progress. Prompt-specific local multimedia handlers are being removed; model-facing tool instructions and QA gates now require content generated from the current request or current search/tool output.
- **Runtime proof required**: Randomized visual QA must show live model/tool output, companion chat text, and a visible canvas pane without relying on exact canned prompt text.

### Bug #31: Webchat/canvas v4 retest repair — PARTIALLY INVALIDATED AFTER HARDCODE AUDIT

- **Reported**: 2026-06-12 by Blair from webchat as `blair@niaxp.com`
- **Status**: Reopened for the visual-content path. Split-pane/window-manager fixes may remain valid, but the deterministic console-wars timeline resolution is invalid.
- **Impact**: The v3 split-canvas fix was incomplete. A prompt such as "Show me timeline of the console wars from 70s to today" could still open a canvas underneath the webchat, leave the user unable to see the visual, and show a bare assistant reply of "Done." A follow-up repair attempt could clear the canvas even though the user was reporting a display bug rather than asking Pearl to clear it.
- **Root cause**: The WindowManager open path still treated any `meta.wonder === true` window as content-only, overriding the intended `wonderLayout: "split"` metadata. `wonderCanvas` was not classified as a native managed view for generic close/open routing. Webchat canvas tools returned bare `Done.` results, so the chat finalizer had no useful visible context to write companion text. The local deterministic timeline registry did not include console-wars prompts, so that launch-critical request fell into the general model/tool path.
- **Resolution**: Keep the split-pane/tool-result fixes under verification, but remove deterministic topic content and retest with randomized prompts.
- **Runtime proof required**: Dynamic prompts must produce one visible split canvas pane plus non-bare companion chat text, with no unsolicited canvas clear.

### Bug #30: Webchat/canvas v3 cluster — PARTIALLY INVALIDATED AFTER HARDCODE AUDIT

- **Reported**: 2026-06-12 by Blair from webchat as `blair@niaxp.com`
- **Status**: Reopened for local visual generation. UI behavior fixes remain under verification, but the deterministic topic registry is invalid.
- **Impact**: Canvas requests could create duplicate visual surfaces or cover the chat instead of giving a dual-pane view. Timeline prompts beyond the single mass-extinction hardcode could return a false canvas acknowledgement. Desktop typing into the home/desktop surface could drop the first typed character while chat opened. Pearl-pushed webchat messages could be hard to notice when chat was closed, and emoji reaction UI opened too broadly on message taps.
- **Root cause**: Wonder Canvas had two competing render consumers: the Stage iframe and a managed window path. The managed window was treated as content-only/fullscreen instead of split. The local timeline handler was one-off instead of registry-based. The global keydown opener focused the uncontrolled textarea asynchronously without inserting the triggering key. Inbox messages were drained as soon as the compact bar opened. Reaction controls were assistant-message-only and touch opened from the whole bubble.
- **Resolution**: Preserve the UI/event fixes for retest, remove the deterministic topic registry, and require model/tool-generated visual content for every new topic.
- **Runtime proof required**: Random prompt QA must verify no duplicate canvas windows, no covered canvas, and no prewritten topic response.

### Bug #29: Webchat canvas follow-up misclassified new visual requests — PARTIALLY INVALIDATED AFTER HARDCODE AUDIT

- **Reported**: 2026-06-12 by Blair from webchat as `blair@niaxp.com`
- **Status**: Reopened for the mass-extinction deterministic response. The follow-up classifier fix remains under verification.
- **Impact**: A new-topic prompt like "show me a timeline of all mass extinction events throughout geological history" could be intercepted client-side as if it were a follow-up to the previous answer. Pearl then claimed "I put the visual breakdown on the canvas," while the canvas displayed stale acknowledgement/status text such as "Key points from the last answer" instead of a real timeline. No Agency task should have been started for this request.
- **Root cause**: The webchat local canvas follow-up detector matched any prompt containing broad visual language such as "show me", even when the user supplied a full new topic. The follow-up renderer then built a generic visual breakdown from `previousAssistantText`, including prior canvas acknowledgements.
- **Resolution**: Keep the stricter follow-up detector, but remove the exact-topic local Wonder Canvas answer. New-topic visual requests must be handled by the dynamic model/tool path.
- **Runtime proof required**: Unit coverage must show fresh visual prompts fall through to the model/tool path, and randomized runtime QA must prove the model can generate the visual response.

### Bug #28: DB-backed Notes writes and file note metadata consistency - PROD DEPLOYED

- **Reported**: 2026-06-11 from post-fix Notes persistence audit
- **Status**: Resolved on production in `GOLDEN HORIZON v2` (`f98a02b4`); QA retest requested
- **Impact**: DB-backed notes, including welcome/onboarding notes, could appear in the Notes app and open correctly, but autosave/update/delete through `/api/notes/files` failed because those write paths only resolved markdown files. File-backed notes could keep an old markdown `# heading` after a title edit, causing the title to revert on reload, and newly created Work notes could come back as Personal after refresh because filesystem note mode was not persisted. Welcome-note seeding could still create a hidden DB duplicate if a welcome note already existed only as a markdown file. Pearl Diary entries were shown as editable notes, but PATCH/DELETE looked for top-level `Documents/diary--*.md` instead of `Documents/pearl-diary/*.md`.
- **Root cause**: The unified Notes endpoint represented DB notes as synthetic `db-<block_id>` IDs for read paths but did not handle that ID family in PATCH/DELETE. File-note reads derive title from the first H1 heading, while title edits previously only renamed the file. The Notes client sent only title/content on create, and filesystem notes had no durable metadata source for Work/Personal mode. Welcome duplicate checks only consulted DB indexes. Diary reads had a dedicated resolver, but diary writes/deletes fell through to the normal file-note resolver.
- **Resolution**: PATCH and DELETE now recognize DB-backed note IDs, update/delete only rows owned by the authenticated user and tenant, and return the same unified note shape as reads. File-note PATCH keeps the first markdown H1 aligned with the edited title before renaming the file. Filesystem-backed notes now store lightweight sidecar metadata for mode, preserve that metadata across create/update/rename/delete, and the Notes client sends the selected mode when creating file-backed notes. Welcome-note duplicate checks now cover both DB and the same Documents folder the Notes app reads. Diary PATCH/DELETE now resolve `diary--<basename>` into `Documents/pearl-diary/<basename>.md`, keep renames inside `pearl-diary`, and trash diary deletes under `.trash/pearl-diary`.
- **Runtime proof**: Focused `/api/notes/files` route coverage passes for DB-backed PATCH, DB-backed DELETE, file-backed title/H1 alignment, file-backed Work mode persistence, diary PATCH/rename, diary DELETE, and invalid diary IDs. Focused welcome route coverage passes for DB duplicate detection and filesystem welcome duplicate detection. Focused Notes client coverage passes for sending the selected mode on create. Local and production interface builds passed. Production was rebuilt and restarted as `GOLDEN HORIZON v2` at `f98a02b4`; `/api/health/build` reports the deployed build, unauthenticated `/api/tasks` and `/api/notes/files` return 401, source/prod hashes match for the changed files, and PM2 reports core services online with zero unstable restarts.

### Bug #27: In-app Browser search box loses query — PROD DEPLOYED

- **Reported**: 2026-06-11 13:12-13:19 UTC by ImmersiveRiggs in #qa
- **Status**: Resolved on production in `GOLDEN HORIZON v2` (`5c25b152`); QA retest requested
- **Impact**: Typing into Google's own search box inside the in-app Browser could bounce back to a blank Google page, making the Browser feel unusable for ordinary search.
- **Root cause**: The Browser proxy path could drop the user-entered query when handling in-page search submissions, so Google received an empty request.
- **Resolution**: The enhanced proxy now preserves submitted search query parameters through the proxied navigation path.
- **Runtime proof**: The production interface batch at `5c25b152` included the in-browser Google/search-box fix. `/api/health/build` reported `GOLDEN HORIZON v2` at that build, unauthenticated `/api/tasks` returned 401, and PM2 core services were stable.

### Bug #26: News article formatting — PROD DEPLOYED

- **Reported**: 2026-06-11 13:15 UTC by ImmersiveRiggs in #qa
- **Status**: Resolved on production in `GOLDEN HORIZON v2` (`5c25b152`); QA retest requested
- **Impact**: News stories, including BBC articles, could render as unformatted blocks of text instead of readable article sections.
- **Root cause**: The article reader was discarding parsed article structure and re-chunking extracted text heuristically.
- **Resolution**: The readability/news rendering path now preserves parsed paragraphs and article structure, with fallback behavior retained for pages that do not parse cleanly.
- **Runtime proof**: The production interface batch at `5c25b152` included News article paragraph formatting. `/api/health/build` reported `GOLDEN HORIZON v2` at that build, unauthenticated `/api/tasks` returned 401, and PM2 core services were stable.

### Bug #25: Pearl Village Connect takes over Pearl tab — PROD DEPLOYED

- **Reported**: 2026-06-11 13:16 UTC by ImmersiveRiggs in #qa
- **Status**: Resolved on production in `GOLDEN HORIZON v2` (`5c25b152`); QA retest requested
- **Impact**: Clicking Connect in Pearl Village sent the whole Pearl tab to Discord OAuth, interrupting the active Pearl session.
- **Root cause**: The Pearl Village connect action navigated the current app window instead of using a separate OAuth popup flow.
- **Resolution**: Pearl Village Connect now opens Discord sign-in in a small popup, keeps Pearl in place, closes the popup on success, and refreshes Pearl's linked Discord state. Popup-blocked browsers fall back safely.
- **Runtime proof**: The production interface batch at `5c25b152` included the Pearl Village popup flow. `/api/health/build` reported `GOLDEN HORIZON v2` at that build, unauthenticated `/api/tasks` returned 401, and PM2 core services were stable.

### Bug #24: Web-chat/onboarding note scope and open race - PROD DEPLOYED

- **Reported**: 2026-06-11 from the Notes persistence audit in #qa
- **Status**: Resolved on production in `GOLDEN HORIZON v2` (`0f790920`); QA retest requested
- **Impact**: Web-chat Pearl could create a note through `/api/notes/files` without the same assistant scope the Notes app uses to read notes. In multi-tenant cases, that let notes land under a fallback tenant while the Notes app read Pearl's assistant tenant, making the canvas look blank after reload. The one-shot `note.open` event could also fire before Notes finished mounting. Welcome-note creation could also duplicate a note when the existing note was indexed by `userId` instead of `parent_id`.
- **Root cause**: `bot_create_note`, `bot_open_note`, and `bot_update_note` used the bare Notes file endpoint while the Notes view reads with `agent=pearlos`. The chat handler also dispatched the open event once, shortly after requesting the Notes window. The welcome-note duplicate check only queried `parent_id + title`, while the reader supports both `parent_id` and `indexer.userId`, plus newer `normalizedTitle`.
- **Resolution**: Web-chat note create/open/update now use `/api/notes/files?agent=pearlos`, matching the Notes app reader scope. Note-open events are replayed briefly after opening the Notes window so the newly mounted Notes view can receive the selected note. Welcome-note duplicate detection now checks both owner index paths and both title index paths before creating a new note.
- **Runtime proof**: Focused ChatMode handler coverage passes for Pearl-scoped create/open/update and note-open replay. Focused welcome route coverage passes for duplicate detection by `indexer.userId` and `normalizedTitle`. Local and production interface builds passed. Production was rebuilt and restarted as `GOLDEN HORIZON v2` at `0f790920`; `/api/health/build` reports the deployed build, unauthenticated `/api/tasks` and `/api/notes/files` return 401, source/prod hashes match for the changed files, and PM2 reports core services online with zero unstable restarts.

### Bug #23: Image generation voice routing and Photo Magic display - PROD DEPLOYED

- **Reported**: 2026-06-11 13:31-13:32 UTC by ImmersiveRiggs in #qa
- **Status**: Resolved on production Pipecat runtime (`9459d3ee`); QA retest requested
- **Impact**: Voice-triggered image generation could fail as unauthenticated or fall back into Pixel Art/interface-customization style output, which produced abstract artifacts instead of the requested general image.
- **Root cause**: The signed bot-claims auth bridge fixed the interface auth failure, but the voice fast-router still declared `bot_photo_magic_generate` without allowing it through the Phase 1 direct passthrough whitelist. The gateway also had a direct Photo Magic handler but no UI mapping to display the generated image on Wonder Canvas.
- **Resolution**: `bot_photo_magic_generate` now executes through the direct voice gateway path, is treated as a data-rich result for the spoken follow-up, and broadcasts a Wonder Canvas `image_showcase` scene using the returned Photo Magic image URL/model. This keeps general image requests on Photo Magic instead of drifting into Pixel Art.
- **Runtime proof**: Focused Pipecat tests pass for Phase 1 Photo Magic direct execution and gateway Wonder Canvas broadcast. Prod preflight passed for the source slice, source/prod hashes match for the changed router/gateway files, `pipecat-gateway` and `pipecat-runner` restarted cleanly, loopback gateway health is OK, external `:4444` remains closed, app health still reports `GOLDEN HORIZON v2`, and PM2 core services are online with zero unstable restarts.

### Bug #22: Pearl VJ YouTube search and navigation controls - PROD DEPLOYED

- **Reported**: 2026-06-11 from #qa
- **Status**: Resolved on production in `GOLDEN HORIZON v2` (`9ed31ba7`); QA retest requested
- **Impact**: Specific Pearl VJ requests such as "kids on a school bus" could drift into weak movie/comedy results, and the VJ navigation UI was effectively missing because native YouTube controls are disabled in the embedded player while Pearl's overlay controls started hidden.
- **Root cause**: The curator fallback padded user requests with broad terms like "documentary", "live session", and "interview", which diluted precise searches. The YouTube search route accepted the first five upstream results with no local ranking. The VJ chrome only exposed a skip action and hid the overlay by default.
- **Resolution**: The curator fallback now preserves the user's compact request, YouTube search fetches a larger relevance set with strict/embeddable filters and locally reranks direct title/description/channel matches above weak movie/comedy matches, and Pearl VJ now shows Previous, Play/Pause, Next, and queue-count controls by default.
- **Runtime proof**: Focused YouTube route and volume tests pass. Local and production interface builds passed. Production was rebuilt and restarted as `GOLDEN HORIZON v2` at `9ed31ba7`; `/api/health/build` reports the deployed build, unauthenticated `/api/tasks` returns 401, PM2 reports core services online with zero unstable restarts, and a live `/api/youtube-search?query=kids%20on%20a%20school%20bus` probe returned "Handyman Hal learns about School Bus | School Bus for Kids" as the current video with a five-item queue.

### Bug #21: Notes archived chats visibility — PROD DEPLOYED

- **Reported**: 2026-06-11 13:25 UTC by ImmersiveRiggs in #qa
- **Status**: Resolved on production; QA retest requested
- **Impact**: Archived chats with Pearl could disappear from the Notes app, even though the chat UI stored a local archive copy. The archive button could also clear the current chat after the gateway archive succeeded while the Notes write had failed silently.
- **Root cause**: Chat archives were written to browser localStorage and then posted to `/api/notes` as a fire-and-forget best-effort request. The Notes app only rendered server-backed notes, so local-only archives were invisible. Archive note content also lacked the existing chat-history marker, and "Chat archive" titles were not treated as archived-chat notes by the stricter helper.
- **Resolution**: Chat archive now awaits the Notes write and includes the existing Pearl chat-history marker before rotating/clearing the active chat. Notes now classifies `Chat archive` titles as Chat History, strips archive markers from previews, and merges recoverable local `pearl-chat-archives-v1` entries into the Chat History folder as read-only local notes so older browser-local archives are visible again.
- **Runtime proof**: Focused Notes component coverage passes for autosave paths and local chat archive recovery. Local and production interface builds passed as `GOLDEN HORIZON v2`; production was rebuilt and restarted at `994a3aa5`; `/api/health/build` reports the deployed build, unauthenticated `/api/tasks` and `/api/notes/files` return 401, source/prod hashes match for the changed files, and PM2 reports core services online with zero unstable restarts.

### Bug #20: Our Pearl Add/Remove durable installed state — PROD DEPLOYED

- **Reported**: 2026-06-11 13:39 UTC by ImmersiveRiggs in #qa
- **Status**: Resolved on production; QA retest requested
- **Impact**: Our Pearl community feature Add/Remove could look like it did nothing or only work in one browser because installed state lived only in local browser storage. The earlier visible shortcut fix made Add show an icon, but the account-level installed state was still not durable.
- **Root cause**: The Our Pearl vote path persisted per-user preferences, but Add/Remove only updated localStorage and local desktop shortcuts. The catalog response had no server-installed feature set, and there was no authenticated install/remove endpoint.
- **Resolution**: Added a per-user `installedCommunityFeatures` preference, a guarded `/api/our-pearlos/install` endpoint, server `installedFeatureIds` in the catalog response, and client reconciliation that recreates desktop shortcuts from the durable account state on load. Local storage remains only as a signed-out fallback/cache.
- **Runtime proof**: Focused catalog, install API, vote API, and Our Pearl view Jest coverage passes. Local and production interface builds passed. Production was rebuilt and restarted as `GOLDEN HORIZON v2` at `11e5afc7`; `/api/health/build` reports the deployed build, unauthenticated `/api/tasks` and `/api/our-pearlos/install` return 401, and PM2 reports core services online with zero unstable restarts.

### Bug #19: Styles close overlay and theme previews — PROD DEPLOYED

- **Reported**: 2026-06-11 13:26 UTC by ImmersiveRiggs in #qa
- **Status**: Resolved on production; QA retest requested
- **Impact**: Closing the Styles screen could leave a blank blurred layer that needed a second close action. The Styles panel also committed theme changes from text-only buttons without showing visual previews first.
- **Root cause**: Native PearlOS app windows closed through the local window id only. If duplicate or stranded native app state existed across window manager layers, the close action could remove the visible content while leaving the blurred content-only shell behind. The Appearance panel rendered immediate theme buttons with no preview surface.
- **Resolution**: Native app chrome now broadcasts close requests by `viewType`, so closing Styles clears any matching native app state instead of only one local window id. The Styles panel now shows visual preview thumbnails for base and custom themes before selection.
- **Runtime proof**: Focused window-manager and Styles preview Jest coverage passes, production preflight passed for the source slice, the production interface build passed as `GOLDEN HORIZON v2` at `704766d9`, `/api/health/build` reports the deployed build, unauthenticated `/api/tasks` returns 401, and PM2 reports core services online with zero unstable restarts.

### Bug #18: Settings/Profile public/private layout — PROD DEPLOYED

- **Reported**: 2026-06-11 20:43 UTC by Blair in #qa
- **Status**: Resolved on production; QA retest requested
- **Impact**: The account name/email appeared directly under public/private explanatory copy, making a personal email look like it might be part of the public profile. The private profile editor could also fall back to raw `privateMemory.personalNotes`, which risks surfacing raw memory/tool/platform/timestamp text.
- **Root cause**: The Settings/Profile panel mixed account identity, public profile visibility, public profile text, and private profile text in one vertical stack. The private text accessor used `privateMemory.personalNotes` as a legacy fallback instead of an explicit user-editable private profile field.
- **Resolution**: Moved account name/email and Sign Out into the Profile header. Replaced the redundant public visibility switch with a single Public/Private segmented control. Gave Public and Private separate color-coded containers, kept one Save action, and limited private profile display to the explicit `sensitiveData.privateProfileText` field.
- **Runtime proof**: Focused component coverage passes for the account header placement, single Public/Private control, private raw-memory suppression, and save payload preservation. Production preflight passed for the source slice, source/prod hashes match for the changed files, the production interface build passed as `GOLDEN HORIZON v2`, `/api/health/build` reports the deployed build, unauthenticated `/api/tasks` returns 401, and PM2 reports core services online with zero unstable restarts.

### Bug #17: Telegram raw function calls — PROD DEPLOYED

- **Reported**: 2026-06-11 19:47 UTC by ImmersiveRiggs in #qa
- **Status**: Resolved on production; QA retest requested
- **Impact**: Telegram users could see hidden tool/function call text, including `memory_search`, instead of only Pearl's natural-language response.
- **Root cause**: The OpenClaw runtime patch sanitized Discord outbound sends and model completion payloads, but did not sanitize Telegram Bot API outbound payloads before `sendMessage`/caption delivery.
- **Resolution**: Added Telegram Bot API outbound body normalization in the OpenClaw runtime fetch patch, covering Telegram text and captions for message/media sends and edit calls. Broadened the public outbound sanitizer to strip any raw `memory_search` line, not only `memory_search ... query=...`.
- **Runtime proof**: Local and production Node tests pass for Telegram Bot API detection, raw `memory_search` stripping, and safe fallback text when the entire outbound body is a hidden tool call. The patched runtime files were copied to the live OpenClaw import path and prod source mirror, root's user-level `openclaw-gateway` service was restarted, and `http://127.0.0.1:18789/health` returns `{"ok":true,"status":"live"}`.

### Bug #16: Filespace PDF viewer opens behind window / blocked by Chrome — PROD DEPLOYED

- **Reported**: 2026-06-11 15:09 UTC by ImmersiveRiggs in #qa
- **Status**: Resolved on production in `GOLDEN HORIZON v2` (`bcdd88ed`); QA retest requested
- **Impact**: Opening an uploaded PDF from Filespace could appear to do nothing because an applet opened behind the current Pearl window. Chrome popup blocking could also block the viewer without giving the user a clear correction path.
- **Root cause**: PDF open used the applet/HTML viewer wrapper instead of opening the PDF content directly through the file content route.
- **Resolution**: PDFs now open directly through the file content route in a new browser tab, and Filespace shows explicit popup-unblock guidance if Chrome blocks that tab.
- **Runtime proof**: Focused Files view coverage passed. Production was rebuilt and restarted as `GOLDEN HORIZON v2` at `bcdd88ed`; `/api/health/build` reported the deployed build and PM2 core services were stable.

### Bug #15: Weather manual location input — PROD DEPLOYED

- **Reported**: 2026-06-11 13:36 UTC by ImmersiveRiggs in #qa
- **Status**: Resolved on production in `GOLDEN HORIZON v2` (`62f8ebc3`); QA retest requested
- **Impact**: With browser location disabled, Weather could default to the PearlOS server/IP location, showing North Bergen, NJ, with no way to change it manually.
- **Root cause**: The Weather app and API fell back to server-side location instead of requiring user-provided location when client geolocation was unavailable.
- **Resolution**: Weather now asks for a city or ZIP code when browser location is disabled and stores the manual location for later. The weather API rejects bare requests with `location_required` instead of geolocating the server.
- **Runtime proof**: Focused Weather API coverage passed. Production was rebuilt and restarted as `GOLDEN HORIZON v2` at `62f8ebc3`; `/api/health/build` reported the deployed build, unauthenticated `/api/tasks` returned 401, and PM2 core services were stable.

### Bug #14: Studio legacy creation playback returns Not Found — PROD DEPLOYED

- **Reported**: 2026-06-11 13:35 UTC by ImmersiveRiggs in #qa
- **Status**: Resolved on production in `GOLDEN HORIZON v2` (`732ef1be`); QA retest requested
- **Impact**: Studio Samples could report that an agency-built app completed, but clicking Play returned `{"error":"Not found"}` instead of loading the generated app.
- **Root cause**: Legacy requester-owned creation artifacts were not accepted by the playback route's ownership/path resolution, so older valid creations could miss the expected artifact path.
- **Resolution**: Studio creation playback now loads old requester-owned creations while keeping unauthenticated access blocked.
- **Runtime proof**: Focused creation playback route coverage passed. Production was updated as `GOLDEN HORIZON v2` at `732ef1be`, and #qa verification confirmed older Studio creations could load while unauthenticated access remained blocked.

### Bug #13: Sprite Summoner resets without delivery — PROD DEPLOYED

- **Reported**: 2026-06-11 from #qa
- **Status**: Resolved on production in `GOLDEN HORIZON v2` (`56654c36`); QA retest requested
- **Impact**: Sprite Summoner could appear to start normally, then reset/blank because the saved Sprite list endpoint failed against GraphQL.
- **Root cause**: `sprite-actions.ts` built Prism filters with lowercase `and`, but the Mesh `NotionModelFilter` schema accepts uppercase `AND`.
- **Resolution**: Updated Sprite name lookup and tenant-scoped list filters to use uppercase `AND`, and added action-level regression coverage for the exact GraphQL filter shape.
- **Runtime proof**: Focused Jest coverage passed for Sprite action filters, Sprite list route, and Sprite `[id]` route. Local and production interface builds passed. Production was rebuilt and restarted with `PEARLOS_BUILD_CODENAME=GOLDEN HORIZON v2` and `PEARLOS_BUILD_ID=56654c36`; `/api/health/build` reports `GOLDEN HORIZON v2` at `56654c36`. Unauthenticated `/api/tasks` and `/api/summon-ai-sprite/list` return 401, PM2 reports interface and voice services online, and source/prod file hashes match for the Sprite action and regression test.

### Bug #12: Calmer staging error page and terminal handoff

- **Reported**: 2026-06-07 21:29 UTC by Blair
- **Status**: Verified on DO staging
- **Fix**: Replaced the global app error boundary copy and styling with a single Terminal action. Added isolated terminal-only pages at `/terminal` and `/[assistantId]/terminal`, and bypassed the voice/soundtrack provider stack plus active-jobs widget on terminal-only routes.
- **Safety**: Terminal is not embedded on a public page. The `/terminal` route still requires PearlOS auth, and the existing terminal API still enforces login, same-origin write checks, per-actor sessions, session limits, and workspace entitlements.
- **Runtime proof**: Staging build `TERMINAL RECOVERY LIVE` is live and verified at `https://134-209-76-227.sslip.io`. Public unauthenticated `/terminal` redirects to login with the callback preserved. PM2 `interface` is online after restart. Current and previous app-error chunk filenames all serve the one-link Terminal fallback so stale tabs do not keep the retry/home version. Source and deploy copies match for the touched source and build stamp files.

### Bug #11: Discord tool-call markup leaked into chat - PROD DEPLOYED

- **Reported**: 2026-06-07 21:11 UTC by Blair
- **Status**: Resolved on production in `GOLDEN HORIZON v2` (`f98a02b4`); QA retest requested
- **Impact**: Discord-visible assistant replies included raw `<exec ... />` tool-call markup, including malformed XML when shell redirection appeared inside an attribute.
- **Fix in source**: Added line-level and self-closing XML tool-call stripping for `<exec ...>` and related tool envelopes in the OpenClaw outbound sanitizer, native Discord fallback sanitizer, Pearl relay sanitizer, agent runtime sanitizer, worker public Discord sanitizer, and the interface `/api/discord/send` fallback route. Added a regression case for malformed `<exec command="pm2 status 2>&1" />` content.
- **Runtime proof**: Source and production hashes now match for the interface Discord send route, shared Discord sanitizer, and Discord DM helper. The production interface was rebuilt and restarted as `GOLDEN HORIZON v2`; `/api/health/build` reports build `f98a02b4`, unauthenticated `/api/tasks` and `/api/discord/send` return 401, PM2 reports core services online with zero unstable restarts, and a direct prod-source sanitizer smoke test strips `Checking now.\n<exec command="pm2 status 2>&1" />\nStill here.\n{"tool_call":{"name":"memory_search"}}` to `Checking now.\nStill here.`.

### Bug #10: Public Pearl voice/profile identity and per-user data segregation — PROD DEPLOYED

- **Reported**: 2026-06-03 02:18 UTC by Blair
- **Status**: Verified on production runtime; QA voice retest requested
- **Impact**: Prod public Pearl addressed Blair as Stephanie in voice chat, indicating the voice launch/session prompt could trust stale Daily/session/global context over the authenticated PearlOS UserProfile.
- **Fix in source**: Voice launch identity now lets authenticated claims/headers replace stale body names before `BOT_SESSION_USER_*` is seeded. Voice participant context, flow prompt payloads, identity reconciliation, rejoin greetings, and startup context now prefer the loaded `UserProfile` name/public persona over Daily/session display names. Voice startup also fetches the current UserProfile and scoped per-user memory. Public web chat still loads the authenticated UserProfile and stores new chat logs under `/users/<tenant>/<user>/chat/messages.jsonl` with legacy flat-file fallback reads.
- **Runtime proof**: Focused Poetry tests pass for profile-over-session participant naming, prompt context naming, and authenticated profile prompt context. Prod deploy copied the missing identity prompt and participant runtime files into `/opt/pearlos`, restarted and saved `pipecat-gateway` and `pipecat-runner`, and verified both PM2 services online with `unstable_restarts=0`. On-box gateway health returns `{"status":"ok"}`, gateway remains loopback-only on `127.0.0.1:4444`, external `:4444` does not connect, and source/prod file hashes match for `flows/sanitization.py` and `session/participant_data.py`.
- **QA note**: Needs a real prod voice retest from Steph/Blair to confirm Pearl now uses the authenticated UserProfile name during conversation.

### Bug #9: Public Pearl web chat search/profile tool recovery — RESOLVED

- **Reported**: 2026-06-03 01:55 UTC by Blair
- **Status**: Resolved on staging
- **Resolution**: Restored public web chat tool capability by keeping web search/fetch in the advertised tool schema, adding a direct signed-in public-profile lookup tool, fixing nested text-body tool-call JSON detection, and appending fallback tool results into chat instead of dropping them.
- **Runtime proof**: Staging build `PUBLIC PEARL SEARCH PROFILE RESTORE` is live. Direct gateway proof showed `bot_web_search` executed with results and `bot_get_public_profile` executed through the direct tool path.

### Bug #8 (P0): Port 4444 publicly exposed — CRITICAL

- **Reported**: 2026-05-26 ~20:40 UTC by ImmersiveRiggs (flagged from prod preflight audit)
- **Status**: Resolved on production in `GOLDEN HORIZON v2` (`482f09ff`)
- **Priority**: P0 (BLOCKER)
- **Details**: Production Pipecat Bot Gateway on port 4444 is publicly accessible with NO authentication. Returns full task data including:
  - User emails (stephanie@niaxp.com, blairerickson@gmail.com, kssheetz@gmail.com)
  - Task descriptions, results, operational details
  - Internal system metadata
- **Root cause**: Production uvicorn listening on `0.0.0.0:4444` instead of `127.0.0.1:4444`. Staging correctly binds to loopback only.
- **Resolution**: Pipecat host startup now defaults to `127.0.0.1` via `start-gateway.sh`, while container/dev entrypoints support an explicit bind-host override. The interface fallback restart route now defaults to loopback and rejects unsafe public bind hosts.
- **Runtime proof**: Production `pipecat-gateway` was restarted under PM2 and now listens on `127.0.0.1:4444`. On-box `http://127.0.0.1:4444/health` returns `{"status":"ok"}`. External `http://165.227.83.62:4444/health` no longer connects. `https://app.pearlos.org/api/health/build` reports `GOLDEN HORIZON v2` at `482f09ff`; unauthenticated app task and notes endpoints return 401. Source and prod deploy file hashes match for the gateway startup script, container entrypoint, dev runner, and interface restart route.

### Bug #7: Prod preflight audit blocked — RESOLVED

- **Reported**: 2026-05-26 ~20:40 UTC by ImmersiveRiggs
- **Status**: Resolved
- **Resolution**: Removed `apps/interface/.data/task-feedback/feedback.jsonl` from git tracking and added `.data/task-feedback/` to `.gitignore`. Preflight audit now passes. Commit `d0095d5d`.

### Bug #1: Telegram not responding (Staging)

- **Reported**: 2026-05-26 12:47 UTC by ImmersiveRiggs
- **Status**: Investigating
- **Root cause found**: Relay service (`pearl-chat-relays-production-repair`) uses bot token `8949720571:AAH5lpsa...` (bot: `PearlOS_bot`) but gets HTTP 409 "another Telegram poller is already active". The conflict is NOT from staging's OpenClaw gateway (which uses a different token `8389175210...`). Likely production's equivalent relay service is holding the same bot token. Two machines cannot poll the same Telegram bot simultaneously.
- **Potential fixes**:
  - Create a separate Telegram bot token for staging (recommended)
  - Or stop production relay during staging testing windows
  - Or implement webhook-based delivery instead of polling

### Bug #2: Social Connections description text (Production)

- **Reported**: 2026-05-26 12:53 UTC by ImmersiveRiggs
- **Status**: Resolved on production in `GOLDEN HORIZON v2` (`2b8e1e44`)
- **Details**: The Social Connections panel description has a second sentence that no longer matches the overall feature. Steph requests deleting it so it only reads: "You can chat w Pearl in places you already use!"
- **Location**: Social Connections settings panel on `app.pearlos.org`
- **Resolution**: Removed the old "Bring Pearl to You." and "Discord / Telegram." helper copy from the Social Connections settings panel and replaced it with the requested single sentence.
- **Runtime proof**: Focused Jest coverage for the Social Connections panel passes for the rendered copy. The production interface was rebuilt and restarted with `PEARLOS_BUILD_CODENAME=GOLDEN HORIZON v2` and `PEARLOS_BUILD_ID=2b8e1e44`; `/api/health/build` reports `GOLDEN HORIZON v2` at `2b8e1e44`. Source and production file hashes match for the settings panel and focused test file, and PM2 reports `interface`, `pipecat-gateway`, `pipecat-runner`, and `bot-queue-worker` online with zero unstable restarts.

### Bug #3: Voice Pearl won't wake on Prod — RESOLVED

- **Reported**: 2026-05-26 20:17 UTC by angel_70160
- **Status**: Resolved
- **Resolution**: Root cause was browser microphone contention. Angel had both staging and production tabs open. The tab that couldn't acquire the microphone showed Pearl as asleep. Once identified, Pearl woke up normally in the tab that held mic access.
- **Follow-up**: See Bug #5 for the UX improvement needed (show a message instead of silent sleep).

### Bug #4: Prod onboarding not completing

- **Reported**: 2026-05-26 20:21 UTC by ImmersiveRiggs
- **Status**: Runtime state reset on production; QA retest requested
- **Details**: Steph reports "onboarding is not happening for me" on production (`app.pearlos.org`). Onboarding flow did not trigger or complete for her account.
- **Environment**: Production, build `AGENCY-WEBHOOKS` (commit `f7d91b08`)
- **Root cause found**: The production UserProfile for the affected account was already marked `onboardingComplete=true`, so the onboarding prompt injection correctly skipped that account. The stored state looked like legacy completion state, not the current deterministic required-action flow.
- **Resolution**: Reset only that account's onboarding fields in production: `onboardingComplete=false`, onboarding beat count zero, `promptFeatureKey=onboarding`, and empty `requiredActions` for the current flow to repopulate.
- **Runtime proof**: A production runtime check after the reset reports the profile as found, `onboardingComplete=false`, and `_web_chat_onboarding_note(...)` returns a nonempty onboarding note for that account. This should make the next prod web/voice onboarding session start instead of being skipped.

---

## Resolved

| # | Date | Time | User | Bug | Resolution | Resolved |
|---|------|------|------|-----|------------|----------|
| - | - | - | - | None yet | - | - |

---

### Bug #5: Mic contention between staging and prod tabs

- **Reported**: 2026-05-26 ~20:25 UTC by angel_70160
- **Status**: Resolved on production in `GOLDEN HORIZON v2` (`698fb63c`); QA retest requested
- **Priority**: P2
- **Details**: Opening both staging and production Pearl tabs simultaneously causes one Pearl to go to sleep. Root cause is browser-level microphone contention — only one tab can hold the WebRTC mic at a time. The tab that loses mic access shows Pearl as asleep/non-responsive.
- **Resolution**: Voice session startup now treats microphone acquisition failures as fatal, cleans up the room/context, surfaces a visible alert with a retry action, and lets the assistant button retry from `UNAVAILABLE` instead of staying asleep.
- **Runtime proof**: Production was rebuilt and restarted with `PEARLOS_BUILD_CODENAME=GOLDEN HORIZON v2` and `PEARLOS_BUILD_ID=698fb63c`; `/api/health/build` reported the deployed build, PM2 stayed online, and unauthenticated task access still returned 401.

### Bug #6: Voice Pearl addressed wrong user (Prod)

- **Reported**: 2026-05-26 ~20:25 UTC by ImmersiveRiggs
- **Status**: Covered by Bug #10 production fix; QA voice retest requested
- **Priority**: P1
- **Details**: Steph was using prod Pearl voice and Pearl called her "Angel" — addressing her by another user's name. This suggests the voice session is carrying over context from a previous user's session, or there's a shared login/token state. Identity mix-up in production is a serious issue.
- **Resolution note**: The Bug #10 production deploy makes UserProfile identity authoritative over stale Daily/session names in gateway launch, participant context, and prompt context. Keep this item open only if QA can still reproduce a cross-user name after the June 11 prod deploy.

---

## Notes

- **Notion integration**: If this tracker moves to Notion, link the Notion database here and archive this file.
- **GitHub Issues**: Alternative — enable Issues on `github.com/NiaExperience/PearlOS` and link bugs there for community visibility.
- **Discord permalinks**: Right-click any message in Discord → Copy Message Link to get a permalink for the Discord Link column.
