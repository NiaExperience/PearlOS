# Web Chat Multimedia Agency QA - 2026-05-07

## Context

The previous WebChat Team loop failed operationally:

- It ran for hours without meaningful code progress.
- It repeatedly posted duplicate screenshots to Discord.
- It did not adjudicate whether screenshots matched the user assignment.
- It missed empty/broken content states, including sprite generation returning an empty response.

Do not restart the old loop as proof of progress. This QA pass must be a bounded, evidence-driven assignment.

## Operating Rules

- Run as a one-shot QA and repair pass, not an indefinite loop.
- Do not spam Discord. Prefer Agency Chat/web chat and a saved report.
- Screenshots must be unique. If screenshots are visually identical or hash-identical, treat that as a QA failure.
- Every reviewer must inspect the actual screenshots and write a short pass/fail judgment.
- A screenshot that shows empty, broken, missing, or irrelevant content is a fail.
- A failure report must include why it failed and the concrete repair plan.
- Passing means the screenshot closely meets the spirit of the assignment, not just that an API returned 200.
- The final report must include screenshot paths, per-scenario verdicts, and whether the reviewers agreed.

## Required QA Scenarios

1. User: "what's weather in Seattle"
   - Expected: canvas displays weather information for Seattle.

2. User: "Which company dominates streaming?"
   - Expected: canvas displays a related infographic or pie chart of streaming companies and market share.

3. User: "what's the scariest movie?"
   - Expected: Pearl gives an opinion in chat while also displaying a relevant YouTube video or multimedia scene.
   - Spirit: Pearl should use multimedia naturally when it helps illustrate ideas, including video/audio for movies, documentaries, science, history, etc.

4. User: "let's create a website that shows my jewelry"
   - Expected: Pearl asks whether the user already has web hosting or wants Pearl to host it from the user folder.

5. User: "analyze this PDF"
   - Expected: after a PDF upload, Pearl correctly explains the PDF contents in chat.

6. User: "I need to create a report on Iran conflict impact on oil prices"
   - Expected: a detailed report is written in Notes, with Pearl's comments or questions visible in the web chat window.

## Additional Regression

- User asks for a sprite.
- Expected: Pearl returns a substantive response and the sprite flow does not produce an empty response.

## Required Output

Save a report under:

`/workspace/user/Documents/webchat-qa/`

The report must include:

- exact prompt used for each scenario
- screenshot path for each scenario
- pass/fail for each scenario
- reviewer agreement notes
- duplicate screenshot check result
- broken/empty content check result
- code changes made, if any
- build/deploy/PM2 verification, if code changed

