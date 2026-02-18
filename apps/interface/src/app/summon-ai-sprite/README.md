# Summon AI Sprite – Feature Notes

## What this does
- Generates a base sprite from a user prompt (e.g., "cat doctor") via ComfyUI.
- Animates the sprite with subtle mouth movement and transparent background.
- Shows the sprite + chat bubble UI in the bottom-right only after generation succeeds.
- Optional in-character chat replies via Ollama.

## Key flows
1) **Bot → Frontend event**
   - Tool `bot_summon_sprite` emits `sprite.summon { prompt }` (feature flag `summonSpriteTool`).
   - `browser-window.tsx` listens to NIA events and dispatches `spriteSummonRequest` with the prompt.

2) **Summon API call**
   - `POST /api/summon-ai-sprite`:
     - Runs origin workflow `origin-sprite-creator_API.json` on the origin ComfyUI (prompt -> node 970).
     - Uploads the origin output to the animation ComfyUI for animation.
     - Runs animation workflow `SingleAnimationfromPic_ClearGifOutput.json`:
       - Prompt -> node 970 (`<prompt> subtle mouth movement`)
       - LoadImage -> node 1405 (uploaded filename)
       - Dimensions -> nodes 1385/1384 set to 256x256
       - Frames -> node 827 set to 24
     - Returns GIF + media URLs. Logs timing and prompts.

3) **UI render**
   - `SummonSpritePrompt` listens for `spriteSummonRequest`, calls the API, and on success shows the bottom-right widget (bubble, avatar, chat input) and emits `sprite.ready { prompt }`.

4) **Chat replies (optional)**
   - `POST /api/summon-ai-sprite/chat` calls Ollama with a persona system prompt based on the user’s sprite prompt.

## Files involved
- UI surface:
- `apps/interface/src/components/summon-sprite/SummonSpritePrompt.tsx` (widget, summon handler, chat input)
  - `apps/interface/src/components/browser-window.tsx` (listens for `sprite.summon`, emits `spriteSummonRequest`)
  - `apps/interface/src/app/summon-ai-sprite/Client.tsx`, `page.tsx` (standalone demo page)
- API:
  - `apps/interface/src/app/api/summon-ai-sprite/route.ts` (origin → upload → animation)
  - `apps/interface/src/app/api/summon-ai-sprite/chat/route.ts` (Ollama replies)
- Workflows (not served publicly; read from disk):
  - `apps/sprite-maker/origin-sprite-creator_API.json` (origin/base image)
  - `apps/sprite-maker/SingleAnimationfromPic_ClearGifOutput.json` (animation, frames=24, 256x256)
- Bot/tool:
  - `apps/pipecat-daily-bot/bot/tools/sprite_tools.py` (`bot_summon_sprite`, feature flag `summonSpriteTool`)
  - Generated manifest: `packages/features/generated/bot-tools-manifest.json`
- Feature flag:
  - `packages/features/src/feature-flags.ts` (`summonSpriteTool`, env keys below)

## Env / flags required
- ComfyUI (two URLs):
  - Origin/base image: `COMFYUI_ORIGIN_BASE_URL`
  - Animation/GIF: `COMFYUI_ANIMATION_BASE_URL`
- Ollama (chat replies): `OLLAMA_BASE_URL` or `NEXT_PUBLIC_OLLAMA_BASE_URL` (e.g., https://.../api/chat)
- Feature flag (bot/UI):
  - `FEATURE_SUMMON_SPRITE_TOOL=true`
  - `NEXT_PUBLIC_FEATURE_SUMMON_SPRITE_TOOL=true` (if you want UI visible)

## Events
- Bot tool emits: `sprite.summon { prompt }`
- Frontend internal: `spriteSummonRequest { prompt }`
- Frontend ready signal: `sprite.ready { prompt }` (CustomEvent; can be forwarded back to bot if desired)

## Notes
- Sprite widget stays hidden until a summon completes.
- "Recall" restores the last summoned sprite (prompt + gif/source) from an in-memory, same-tab cache. It survives mode switches but is cleared on full page reload.
- Dockerfile for interface copies `apps/sprite-maker/` so workflows are available in container builds.

