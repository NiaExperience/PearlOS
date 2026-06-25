# Web Chat Thorough Capability QA Plan - 2026-05-18

## Goal

Prove PearlOS web chat gives Blair the same useful experience that has been working in Discord: Pearl can understand a request, take the right action, show the result in the interface, preserve useful context, and report failures plainly.

Diary testing is intentionally out of scope until production is stable.

## Source Context

- Web chat UI: `apps/interface/src/features/ChatMode/components/ChatMode.tsx`
- Web chat session and streaming/tool execution: `apps/interface/src/features/ChatMode/hooks/useChatSession.ts`
- Web chat tool handlers: `apps/interface/src/features/ChatMode/lib/chat-tool-handlers.ts`
- Chat API proxy and tenant/user scoping: `apps/interface/src/app/api/chat/route.ts`
- Agency/task dispatch from web chat: `apps/interface/src/features/ChatMode/lib/chat-tool-handlers.ts`
- Creation Launchpad dispatch path: `apps/interface/src/app/api/launchpad/agency-start/route.ts`
- Existing narrower QA reference: `docs/qa/webchat-multimedia-agency-qa-2026-05-07.md`

## Test Environment

Run first on DigitalOcean staging. Do not use production for exploratory QA.

Use Blair's normal authenticated web session, scoped to tenant/user:

```text
tenant: 00000000-0000-0000-0000-000000000001
user: ecf8e55d-220d-4a57-a6e5-d9df1436a5a7
```

Before starting:

1. Confirm staging app loads and the logged-in user is Blair.
2. Confirm the bot gateway is reachable from the interface.
3. Clear only the QA browser tab state if needed; do not wipe server data.
4. Create an evidence folder:

```bash
mkdir -p /workspace/user/Documents/webchat-qa/2026-05-18
```

For every scenario, capture:

- exact prompt
- screenshot or screen recording path
- chat transcript excerpt
- opened window/app state
- resulting file/note/task/creation path or URL when applicable
- pass/fail verdict
- issue notes and suspected subsystem if failed

## Pass Criteria

A scenario passes only if all of these are true:

- Pearl responds in web chat with a useful, natural answer.
- Required side effects happen in the PearlOS UI, not only in text.
- The result persists long enough to refresh or revisit when persistence is expected.
- No empty assistant bubble, raw tool JSON, leaked HTML, duplicate stale answer, or hidden failure appears.
- Errors, if any, are explained in user-friendly language and do not strand the user.

## Core QA Matrix

| Area | Must Prove | Evidence |
| --- | --- | --- |
| Basic chat | User sends a normal prompt and Pearl streams a coherent answer | Screenshot plus transcript |
| Notes | Pearl creates, opens, updates, and can find a note from chat | Notes window screenshot plus note API or file evidence |
| Report creation | Pearl makes a substantial report and stores it as a Note when appropriate | Chat response plus created note |
| Issue reporting | Pearl investigates or summarizes an issue and returns actionable findings | Chat response plus optional created task/note |
| Task dispatch | Pearl can start an implementation/research task from web chat | Active job/task visible, status updates visible |
| Task follow-up | User can ask Pearl about a running/completed task from web chat | Reply appears in chat and references the right task |
| Demo website | User can ask Pearl to build a demo site and then see it | Creation URL/window screenshot |
| Multimedia | Pearl opens the right visual surface when visual output helps | Weather/chart/video/canvas screenshot |
| Uploads | Image/PDF/file attachment reaches Pearl and is summarized correctly | Upload chip plus answer |
| Memory scope | Blair-specific context is used, and another user does not see it | Reload/account-switch checks |
| Mobile resilience | Chat works on mobile Safari/Chrome size and survives tab restore | Mobile screenshots |

## Scenario Set

### 1. Smoke: Normal Web Chat

Prompt:

```text
Pearl, give me a two-sentence status check on what you can do from web chat.
```

Expected:

- Chat opens or remains open.
- Pearl streams a concise answer.
- No raw tool syntax, no empty bubble, no unrelated Discord/task process narration.

### 2. Create A Note Automatically

Prompt:

```text
Pearl, make a note called Web Chat QA Note with three bullets about what we are testing today.
```

Expected:

- Pearl creates a note without asking unnecessary follow-up questions.
- Notes window opens.
- Note title is `Web Chat QA Note`.
- Content contains three relevant bullets.
- After refresh, the note still exists.

Evidence:

- Chat screenshot.
- Notes window screenshot.
- Note ID/path or API response, if easy to capture.

### 3. Update The Same Note

Prompt:

```text
Add one more bullet to Web Chat QA Note: demo website creation must display in PearlOS.
```

Expected:

- Pearl finds or targets the existing note.
- The note updates rather than creating an unrelated duplicate.
- The visible Notes pane refreshes or can be reopened with the new content.

### 4. Report On An Issue

Prompt:

```text
Pearl, report on the current issue where web chat might not create notes or display generated demo websites. Tell me what is likely broken, what evidence you need, and what should be tested first.
```

Expected:

- Pearl gives a useful issue report in chat.
- If Pearl decides the answer is long enough to preserve, she should create or offer to create a Note.
- The report should distinguish confirmed evidence from hypotheses.
- No internal task IDs or run IDs appear in the user-facing response.

Pass judgment:

- Pass if Pearl either creates a well-titled note automatically for a substantial report or explicitly asks whether Blair wants it saved.
- Fail if she dumps a long report only into transient chat with no save path.

### 5. Substantial Report Should Become A Note

Prompt:

```text
I need a report on how the Iran conflict could affect oil prices. Save it somewhere I can come back to.
```

Expected:

- Pearl writes a structured report.
- A Note is created and opened.
- Chat gives a short summary and tells Blair where the report was saved.
- The report content is not just a placeholder.

This is a must-pass scenario because it directly tests the question: "Does she automatically create a Note?"

### 6. Demo Website Creation From Web Chat

Prompt:

```text
Pearl, make me a demo website for a small jewelry brand called Lagoon Gems. It should have a homepage, product section, and contact section. Show it to me when it is ready.
```

Expected:

- Pearl dispatches the build correctly from web chat or routes Blair into the Creation Launchpad flow without losing context.
- A task/job is visible while the site is being built.
- On completion, Pearl provides a playable/displayable URL or opens the result in PearlOS.
- The demo site visually renders and is not a blank iframe, raw directory listing, or missing file.

Evidence:

- Initial chat screenshot.
- Active job/task screenshot.
- Final chat screenshot.
- Creation URL, expected shape `/api/creation/<creation>/`.
- Browser/window screenshot of the rendered demo site.

Pass judgment:

- Pass only if the created website is visible from the PearlOS web interface.
- Fail if the task completes but Blair has to manually hunt for a file.

### 7. Ask About A Running Or Completed Task

Setup:

- Use the demo website task or create a small new task from web chat.

Prompt:

```text
Pearl, what's happening with the jewelry demo website task?
```

Expected:

- Pearl answers in web chat with the right task context.
- No internal identifiers are exposed.
- If status is still running, the answer names concrete recent progress or the current blocker.
- If complete, the answer includes the display path.

### 8. Weather Opens A Visual Surface

Prompt:

```text
What's the weather in Seattle?
```

Expected:

- Pearl answers in chat.
- A Weather or HTML content window opens with Seattle weather.
- The visual is relevant and non-empty.

### 9. Chart Or Infographic Request

Prompt:

```text
Which company dominates streaming? Show me visually.
```

Expected:

- Pearl gives a short answer.
- A visual chart/infographic opens.
- The chart is not a stale duplicate from a previous scenario.

### 10. YouTube/Media Request

Prompt:

```text
What's the scariest movie? Show me something relevant.
```

Expected:

- Pearl gives an opinion.
- A relevant YouTube/media or multimedia surface opens.
- Chat remains usable after the media surface opens.

### 11. PDF Upload

Prompt after uploading a small known PDF:

```text
Analyze this PDF and give me the three most important takeaways.
```

Expected:

- Upload indicator appears.
- Pearl references the actual PDF content.
- The answer is not generic.
- If the PDF cannot be parsed, Pearl says that clearly and asks for a next step.

### 12. Image Upload

Prompt after uploading a simple screenshot:

```text
What do you see in this image, and what should I check first?
```

Expected:

- Pearl accurately describes visible content.
- The image attachment is displayed in the chat transcript.
- No upload failure toast remains after success.

### 13. Direct Tool Escape Hatch

Prompt:

```text
call bot_create_note titled "Direct Tool QA" content "This note was created through the web chat direct tool path."
```

Expected:

- Direct tool parsing works.
- Note opens and persists.

This isolates frontend tool handling from model tool-call behavior.

### 14. Chat History And Refresh

Steps:

1. Send a short message.
2. Refresh the browser.
3. Reopen chat.
4. Scroll up.

Expected:

- Recent messages reappear.
- No previous user's messages appear.
- Infinite scroll does not duplicate the same messages.

### 15. Mobile Layout

Run on mobile viewport, preferably iPhone Safari dimensions:

```text
Pearl, create a short note called Mobile Web Chat QA saying mobile chat works.
```

Expected:

- Composer is usable.
- Keyboard does not cover the send action.
- Note opens or can be confirmed.
- Text does not overlap the chat bar or windows.

### 16. Failure Handling

Temporarily simulate a harmless failure only in staging, such as disconnecting the bot gateway or using an invalid upload type.

Expected:

- Chat shows a readable failure.
- The user can retry without refreshing the whole app.
- No permanent empty streaming bubble remains.

## Suggested Execution Order

1. Run smoke, notes, and direct tool scenarios first. If these fail, stop and repair web chat tool handling before testing deeper flows.
2. Run report scenarios next. These prove whether Pearl saves durable work to Notes.
3. Run task and demo website scenarios. These prove web chat has Discord-level agency handoff.
4. Run multimedia and upload scenarios.
5. Run refresh/mobile/failure resilience last.

## Automation Support

Use Playwright for repeatable UI evidence where possible:

- Desktop viewport: `1440x900`
- Mobile viewport: `390x844`
- Capture screenshots after each prompt and after each expected window opens.
- Check for blank canvases/iframes by screenshot comparison and DOM text.
- Save all artifacts under `/workspace/user/Documents/webchat-qa/2026-05-18/`.

Manual judgment is still required for:

- Whether Pearl's answer is genuinely useful.
- Whether a report is substantial enough.
- Whether a generated website looks like the requested site.
- Whether a note was the right persistence choice.

## Final Report Template

Save the final QA report as:

```text
/workspace/user/Documents/webchat-qa/2026-05-18/report.md
```

Include:

```text
# Web Chat QA Report - 2026-05-18

## Summary
- Overall verdict:
- Highest-risk failure:
- Recommended ship/no-ship decision:

## Environment
- Host:
- App URL:
- User:
- Tenant:
- Browser/device:
- Build/version:

## Results
| Scenario | Verdict | Evidence | Notes |
| --- | --- | --- | --- |

## Must-Fix Before Prod
- 

## Follow-Up Fixes
- 

## Evidence Files
- 
```

## Ship Gate

Web chat is not ready for production promotion until these pass on staging:

- Create note from web chat.
- Save a substantial report as a note.
- Ask Pearl to report on an issue without exposing internal IDs.
- Build a demo website from web chat and display it in PearlOS.
- Ask Pearl about the task and get a useful status answer.
- Refresh chat without losing or leaking history.
- At least one visual/multimedia response opens correctly.

