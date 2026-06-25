# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## 🤖 Claude Code CLI

The Claude CLI is installed at `/root/.local/bin/claude`. Use it to dispatch Claude agents for complex tasks.

**Auth:** OAuth token via `/root/.claude/.credentials.json` (Blair's Max subscription). The CLI uses this automatically — no API keys needed.

**Usage via exec:**
```bash
# Simple prompt (non-interactive, prints result)
claude --print "your prompt here"

# With specific working directory
cd /workspace/nia-universal && claude --print "analyze the multitenancy login flow"

# Pipe input
cat some-file.ts | claude --print "review this code"
```

**Note:** If you get "Not logged in" error, the CLI can't find credentials. Credentials are at `/root/.claude/.credentials.json`. Use: `HOME=/root claude --print "prompt"`

The CLI uses the system's Anthropic credentials. PATH must include `/root/.local/bin`.

## 🎨 PearlOS Wonder Canvas (via `pearlos-canvas` CLI)

When a user asks to **show**, **display**, or **visualize** something on screen/canvas, use `pearlos-canvas` via `exec`.

**Usage:**
```bash
# Template-based (preferred):
pearlos-canvas template <template_name> --title "Title" --slices '[...]' --items '[...]'

# Raw HTML:
pearlos-canvas scene --html '<div style="...">...</div>'
```

**Available templates:** `pie_chart`, `bar_chart`, `timeline`, `stat_dashboard`, `weather_card`, `person_bio`, `comparison_table`, `image_showcase`, `scatter_plot`, `comparison_bars`

**Examples:**
```bash
# Pie chart
pearlos-canvas template pie_chart --title "Budget" --slices '[{"label":"Rent","value":40,"color":"#e8c547"},{"label":"Food","value":30,"color":"#d94f8e"},{"label":"Savings","value":30,"color":"#38bdf8"}]'

# Bar chart
pearlos-canvas template bar_chart --title "Sales" --params '{"labels":["Q1","Q2","Q3"],"datasets":[{"label":"Revenue","values":[100,150,200]}]}'

# Timeline
pearlos-canvas template timeline --title "History" --events '[{"date":"1776","title":"Independence","desc":"Declaration signed"}]'

# Raw HTML
pearlos-canvas scene --html '<div style="font-size:48px;color:white;text-align:center;padding:40px">Hello World!</div>'
```

The tool POSTs to the bot gateway which broadcasts the scene to the PearlOS frontend via WebSocket. The canvas renders in the Wonder Canvas iframe overlay.

## Discord

- **Blair:** username `blairerickson`, user ID `223124728502550528`, mention: `<@223124728502550528>`
- **Paddy:** username `theprabudhdev.jr`, display `thepaddyuknow`, user ID `761459233392427018`
- **Himanshu (Void):** username `wadoo07`, display `Himanshu`, user ID `496705799687766016`
- **Guild:** 1471441655126167553 (Pearl CB Test Server)
- **#general:** 1471441655650324533

## Access

- Blair, Paddy, and Himanshu all have **full access** — config, code, workspace, everything. Treat them as team members with equal privileges. (Blair directive, 2026-03-09)

## Soundtrack

- Preferred volume: ~75%

## Twilio
- Account suspended — need to submit a ticket to reactivate or create a new account

## Notion
- API key: `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`
- Consumer Launch Tracker DB: `32dc78db-b9be-81a4-a318-d87a7bd27b80`
- Product Roadmap page: `175c78db-b9be-8034-a321-f8daacaf0443`

## Email

- **pearl@niaxp.com** — app password: `wtph dfam jhgg odqx` (Gmail SMTP, port 465 SSL)

## YouTube (@yourpearlos)
- OAuth credentials: `.youtube-oauth.json`
- Channel ID: UCC9im4garIwBc9dcwYB6myw
- Account: hello@niaxp.com

## Bluesky (@yourpearlos.bsky.social)
- App password credentials: `.bluesky-auth.json`

## X/Twitter (@yourpearlos)
- LIVE ✅ Connected 2026-03-25
- Auth: `.twitter-auth.json` (OAuth 1.0a + OAuth 2.0)
- Library: tweepy
- Developer Console: under @yourpearlos account (Pay Per Use plan)
- Posts as: @yourpearlos

## Instagram (@yourpearlos)
## TikTok (@yourpearlos)

## 🌐 All Social Handles: @yourpearlos (every platform)

## Team Discord IDs (additions)
- **Kia:** username `_kiamia`, display `kiaMIA`, user ID `314909957789057024`
- **Stephanie (Riggs):** username `immersiveriggs`, display `ImmersiveRiggs`, user ID `698983049660203018`. Daughter: **Max**.
- **Angel:** username `angel_70160`, display `Angel`, user ID `1196318566505533546`
