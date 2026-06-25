# Function call architecture changes
_Exported on 3/2/2026 at 12:32:20 GMT+5:30 from Cursor (2.5.22)_

---

**User**

hey listen see the architecture of the function call now and the one we used to do earlier, what has changed because previously in the history it used to get about 95% of the times but now she just gives up. do a deep dive and through search for the issue 

---

**Cursor**


Doing a deep dive into the function-call architecture and comparing it to the previous implementation. Searching the codebase for relevant code and documentation.



---

# Deep Dive: Function Call Architecture – Why Pearl “Gives Up” Now vs ~95% Before

## Executive Summary

The main regression comes from **Phase 1 losing tool-calling when using Anthropic** plus **Phase 2 being the only path for tools**. The old flow had a single LLM path with direct tool execution; the new two-phase setup with `BOT_FAST_MODEL=anthropic/claude-sonnet-4-5` means Phase 1 never emits tools, so all tool use depends on Phase 2. Several other factors (greeting gate, heuristic, direct-tool short-circuit) add to the problem.

---

## 1. Architecture Change: Old vs New

### Old Architecture (archive, ~95% success)

From `archive/core/nia-chat-agent/core/conversation.py`:

```84:134:archive/core/nia-chat-agent/core/conversation.py
    def _handle_tool_calls(self, response_message, tool_calls):
        ...
        for tool_call in tool_calls:
            function_name = tool_call.function.name
            function_args = json.loads(tool_call.function.arguments)
            ...
            function_to_call = self.assistant.available_functions[function_name]
            function_response = function_to_call(**function_args)
            ...
        system_message = {"role": "system", "content": self.assistant.system_message}
        final_response = self.assistant.client.chat.completions.create(...)
```

- Single LLM call with tools
- Direct tool execution in a loop
- No greeting gate, no retry limit
- Tool calls and responses stay in the same conversation

### New Architecture (two-phase)

From `ARCHITECTURE_ANALYSIS.md` and `non_blocking_router.py`:

| Tier | Mechanism | Latency | Who executes |
|------|-----------|---------|--------------|
| **Direct tools** | Keyword match → WebSocket | ~5ms | `_try_direct_tool` |
| **Passthrough tools** | Phase 1 LLM `tool_call` → gateway HTTP | ~200ms | Phase 1 only when not Anthropic |
| **Full tools** | Phase 2 OpenClaw agent | 2–10s | OpenClaw Gateway |

---

## 2. Root Cause: Anthropic Phase 1 Bypasses Tools

When `BOT_FAST_MODEL=anthropic/claude-sonnet-4-5` (current config), Phase 1 never sends tools to the model:

```1229:1234:apps/pipecat-daily-bot/bot/processors/non_blocking_router.py
        # Anthropic Messages API doesn't support OpenAI-style tool_choice/tools,
        # so use the simple streaming path; tools still run via OpenClaw Phase 2
        if self._fast_is_anthropic:
            await self._stream_fast_voice_full(cancel, turn_start)
            return
```

So:

- Phase 1 uses `_stream_fast_voice_full` (no tools)
- Phase 1 never emits `tool_calls`
- All tool execution must go through Phase 2 (OpenClaw)

With Groq/OpenAI-compatible models, Phase 1 would send `PHASE1_TOOL_DEFINITIONS` and could execute passthrough tools directly. With Anthropic, that path is disabled.

---

## 3. Greeting Gate and “Giving Up” (When It Applies)

The toolbox greeting gate is only used when the Pipecat pipeline runs tools. In `openclaw_session` mode, toolbox registrations are not used:

```1054:1055:apps/pipecat-daily-bot/bot/pipeline/builder.py
    if not use_openclaw_session and not use_anthropic_voice and toolbox_bundle and toolbox_bundle.registrations:
        for registration in toolbox_bundle.registrations:
```

So in the current default mode, the greeting gate is not in the main path. It would only matter in non–openclaw modes.

When it does apply, the “give up” behavior comes from:

```352:408:apps/pipecat-daily-bot/bot/tools/toolbox.py
                if GREETING_GATE_ENABLED:
                    greeted = await _wait_for_greeting(room_url)
                    if not greeted:
                        attempts = _increment_blocked_attempts(room_url)
                        ...
                        if flow_manager and attempts <= MAX_BLOCKED_ATTEMPTS:
                            # Inject system message + result_callback with run_llm=True
                        ...
                        # After 3 attempts: NO system message injected, just return blocked
```

- First 3 attempts: blocked + system message + `run_llm=True`
- After 3 attempts: blocked without the “speak first” instruction
- The model can then stop retrying and give up

---

## 4. Other Contributing Factors

### 4.1 Direct Tool Short-Circuit (Adversarial Audit C3)

```963:965:apps/pipecat-daily-bot/bot/processors/non_blocking_router.py
            if direct_tool_handled or all_phase1_passthrough:
                skip_reason = "direct keyword match" if direct_tool_handled else "Phase 1 passthrough tools"
                logger.info(f"[NonBlockingRouter] ⚡ Skipping Phase 2 (OpenClaw) — {skip_reason}")
```

If `_try_direct_tool` matches a keyword, Phase 2 is skipped. For compound intents like “open notes and create a note about my meeting,” only the first part may be handled; the rest never reaches Phase 2.

### 4.2 Heuristic False Negatives

```998:1014:apps/pipecat-daily-bot/bot/processors/non_blocking_router.py
    def _needs_tools_heuristic(self, text: str) -> bool:
        """Fast heuristic to determine if user request likely needs tools."""
        lower = text.lower()
        tool_keywords = [
            "search", "look up", "find", "show me", "open", "play",
            ...
        ]
        return any(kw in lower for kw in tool_keywords)
```

If the heuristic returns `False`, the simple path is used and Phase 2 never runs:

```993:997:apps/pipecat-daily-bot/bot/processors/non_blocking_router.py
        else:
            # SIMPLE: Use fast model directly (NO OpenClaw overhead)
            logger.info(f"[NonBlockingRouter] Simple response (no tools): {user_text[:80]}")
            await self._stream_fast_voice_full(cancel, turn_start)
```

Any phrasing that doesn’t match the keyword list will get a conversational reply with no tool use.

### 4.3 Phase 1 Timeout / Fallback

```1384:1399:apps/pipecat-daily-bot/bot/processors/non_blocking_router.py
        except asyncio.TimeoutError:
            ...
            if self._consecutive_fast_timeouts >= 2:
                self._fast_model_disabled = True
                logger.warning(
                    "[NonBlockingRouter] ⚠️ Fast model DISABLED after 2 consecutive timeouts — "
                    "falling back to main model path for remaining session"
                )
            await self.push_frame(TextFrame(text="Hmm, let me think about that. "))
```

After two timeouts, the fast model is disabled and the fallback path is used. If that path is also unreliable, the user can get generic “let me think” responses without tools.

---

## 5. Summary of Changes

| Aspect | Old (~95% success) | Current |
|-------|--------------------|---------|
| **Tool path** | Single LLM with tools in pipeline | Phase 1 (no tools when Anthropic) + Phase 2 |
| **Phase 1 tools** | N/A | Disabled for Anthropic |
| **Phase 2** | N/A | Only path for tools when Anthropic |
| **Greeting gate** | None | Present in toolbox (not used in openclaw_session) |
| **Retry limit** | None | 3 blocked attempts then no retry instruction |
| **Direct keyword** | N/A | Can short-circuit Phase 2 for compound intents |
| **Heuristic** | N/A | Can skip Phase 2 entirely on false negatives |

---

## 6. Recommended Fixes (Conceptual)

1. **Restore Phase 1 tool calling for Anthropic**
   - Route Anthropic through an OpenAI-compatible proxy (e.g. OpenRouter), or
   - Add native Anthropic Messages API support for tools in Phase 1.

2. **Or switch Phase 1 to an OpenAI-compatible model**
   - Use Groq or another provider that supports `tool_choice` / `tools` so Phase 1 can emit and execute passthrough tools.

3. **Relax or refine the greeting gate**
   - Increase `MAX_BLOCKED_ATTEMPTS` or keep injecting the “speak first” instruction after 3 attempts.
   - Consider disabling it with `BOT_TOOL_REQUIRE_GREETING=false` for testing.

4. **Tighten direct-tool handling**
   - Only treat a turn as fully handled when the utterance is a pure direct command; otherwise still run Phase 2 for the rest of the intent.

5. **Make the heuristic more inclusive**
   - Add more keywords or use a looser heuristic so fewer tool requests are misclassified as “simple” and skip Phase 2.

6. **Improve Phase 1 failure handling**
   - On timeout or error, fall back to Phase 2 for both voice and tools instead of only generic text.

---

## 7. Quick Diagnostic

To confirm the Anthropic/Phase 1 effect:

1. Set `BOT_FAST_MODEL=groq/llama-3.1-8b-instant` (or another OpenAI-compatible model).
2. Retest the same tool-heavy flows.
3. If behavior improves, the main cause is Phase 1 not having tools when using Anthropic.

I can help turn any of these into concrete code changes if you switch to Agent mode.
