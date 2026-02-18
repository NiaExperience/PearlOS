# Experience Rendering System

## Overview
The Experience system lets Pearl render interactive HTML content on the Stage during voice sessions.

## Flow
```
Voice command → LLM calls bot_render_experience tool
  → Bot emits Daily app-message (event: "experience.render")
    → niaEventRouter dispatches CustomEvent "nia:experience.render"
      → Stage.tsx catches it → ExperienceRenderer renders in sandboxed iframe
```

## Bot Tools
- `bot_render_experience(html, css?, js?, transition?)` — Render HTML on the Stage
- `bot_dismiss_experience()` — Clear the Stage

## Test Experience: Valentine's Clock
To test manually via the bot gateway:

```bash
curl -X POST http://localhost:4444/api/emit-event \
  -H "Content-Type: application/json" \
  -d '{
    "event": "experience.render",
    "data": {
      "html": "<div id=\"clock\" style=\"font-family: system-ui; color: white; text-align: center; padding-top: 30vh;\"><h1 style=\"font-size: 4rem;\">💝 Happy Valentine'\''s Day</h1><p id=\"time\" style=\"font-size: 6rem; font-variant-numeric: tabular-nums;\"></p></div>",
      "css": "body { margin: 0; background: linear-gradient(135deg, #1a0011, #2d0a1f, #0a001a); min-height: 100vh; }",
      "js": "function tick() { document.getElementById(\"time\").textContent = new Date().toLocaleTimeString(); } tick(); setInterval(tick, 1000);",
      "transition": "fade"
    }
  }'
```

To dismiss:
```bash
curl -X POST http://localhost:4444/api/emit-event \
  -H "Content-Type: application/json" \
  -d '{"event": "experience.dismiss", "data": {}}'
```

## Architecture
- **experience_tools.py** — Bot tool definitions (emit Daily app-messages)
- **niaEventRouter.ts** — Routes `experience.render` / `experience.dismiss` to CustomEvents
- **Stage.tsx** — Listens for `nia:experience.render` / `nia:experience.dismiss` CustomEvents
- **ExperienceRenderer.tsx** — Renders content in sandboxed iframe
- **PearlBridgeProvider.tsx** — Injects `pearl.*` SDK into iframe via postMessage
