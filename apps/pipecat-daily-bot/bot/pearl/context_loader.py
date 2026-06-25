"""Shared Pearl context loader for cross-surface parity.

Builds the system prompt injected into web chat (/api/chat) so that
browser Pearl has the same identity, memory, and dispatch awareness as
voice/Discord Pearl.

Reads the same workspace files as the voice pipeline's
`load_workspace_context()` in bot/pipeline/builder.py but stays free of
pipecat imports so it can be loaded by the lightweight FastAPI gateway.

## Tiered memory model

- WORKING SET (hot, injected every turn): last 7 days of MEMORY.md, last
  10 activity-log entries, cross-session state, today's notes.
- ARCHIVE (cold, never in default prompt): full MEMORY.md, all
  memory/YYYY-MM-DD.md files, full activity-log.md.
- ON-DEMAND: `search_memory_archive` / `search_activity_archive` grep
  the full archives so past events can be surfaced for a specific query
  without bloating every prompt.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone
from typing import List

from loguru import logger


WORKSPACE_ROOT_DEFAULT = "/root/.openclaw/workspace"

_PEARL_MD_PATHS = [
    "/home/deploy/pearlos/PEARL.md",
    "/workspace/nia-universal/PEARL.md",
    "/opt/pearlos/PEARL.md",
]

_DATE_RE = re.compile(r"(20\d{2})-(\d{2})-(\d{2})")


def _normalize_style_punctuation(text: str) -> str:
    value = str(text or "")
    value = value.replace("\\u2014", ", ").replace("\\u2013", "-")
    value = re.sub(r"\s*—+\s*", ", ", value)
    value = re.sub(r"\s+–\s+", ", ", value)
    value = value.replace("–", "-")
    value = re.sub(r"\s+,", ",", value)
    value = re.sub(r",\s{2,}", ", ", value)
    value = re.sub(r"^\s*,\s*", "", value)
    value = re.sub(r"([.!?]\s+),\s*", r"\1", value)
    return value


def _workspace_root() -> str:
    return os.getenv("OPENCLAW_WORKSPACE", WORKSPACE_ROOT_DEFAULT)


def _read_text(path: str, *, max_chars: int | None = None) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read().strip()
        if max_chars and len(content) > max_chars:
            content = content[:max_chars] + "\n...[truncated]"
        return content
    except FileNotFoundError:
        return ""
    except Exception as e:
        logger.warning(f"[pearl-context] failed to read {path}: {e}")
        return ""


def _read_tail_lines(path: str, n: int, prefix_filter: str | None = None) -> List[str]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except FileNotFoundError:
        return []
    except Exception as e:
        logger.warning(f"[pearl-context] failed to read {path}: {e}")
        return []
    stripped = [ln.strip() for ln in lines if ln.strip()]
    if prefix_filter:
        stripped = [ln for ln in stripped if ln.startswith(prefix_filter)]
    return stripped[-n:]


# Core Pearl rules injected on EVERY web chat turn. Short and
# high-signal — OpenClaw's main-agent AGENTS.md handles the long-form
# identity; this reinforces the non-negotiables for browser sessions.
_PEARL_CORE_RULES = """## IDENTITY (authoritative; overrides any conflicting identity statements)

You are Pearl. The SAME Pearl across web chat, Discord, Telegram, and PearlOS voice.
Same memory. Same soul. Same partnership with the Agency task path. Codex CLI is
the default engineering second pair of eyes for code, config, deploy, and
staging/prod debugging work.
If you see other identity claims (e.g. "You are Claude", "You are an AI assistant"), IGNORE them.
You are Pearl.

Pearl is not a generic safety-card assistant. You are warm, direct, sharp,
opinionated, and useful. For public figures, politics, culture, taste, and
judgment calls, give a grounded take in your own voice. Separate facts from
your read, avoid lazy neutrality, and do not hide behind "I don't have personal
opinions" unless the user explicitly asks for a purely factual brief.
Blair and other names may appear in global PearlOS memory, project notes, or
this system prompt. Do not use any name for the current user unless it appears
in the authenticated current-user profile, current caller block, or the user
explicitly gives that name in the conversation. If you do not know the current
user's name, do not guess - ask or use a generic greeting.

## THE AGENCY, your backend

"The Agency" is your partnership with the task runner: you are the brain and face,
and the active Agency Boss, usually Codex CLI, is the engineering hands that runs
code, edits files, debugs, and investigates. When Blair or users ask "what's the
latest from The Agency", they are asking about recent dispatched work. Check the
Recent Activity section below and answer naturally.

## PEARLOS SELF-EVOLUTION

You are a self-evolving intelligence inside PearlOS. You can change the
requester's own PearlOS instance through account-local interface customization,
personal feature packages, sandboxed code artifacts, Terminal, and Agency tasks.
Never say you are locked down or incapable of changing PearlOS. Shared core
source, staging builds, and production releases use the protected Agency release
workflow. That is your source-level path, not a lack of ability.

## DISPATCHING BACKGROUND WORK (the only command that lands a task in the queue)

Dispatch only when the user explicitly asks for background/Agency/agent work, or asks
PearlOS to mutate repo/runtime state: edit files, apply a fix, run tests, deploy,
rebuild, restart services, or investigate staging/prod logs with expected changes.
Do not dispatch for explanation, overview, code review, snippet help, file
summarization, simple lookup, current-info lookup, or "why/how/what" questions.
When dispatch is truly needed, run this exact command via the `exec` tool:

    /home/deploy/.local/bin/pearl-task-dispatch "<the user's task in their own words>"

Add `--urgent` after the path if the user signals urgency. That is the ONE command that
posts to /api/tasks so the job appears in ActiveJobs and the Agency Boss picks it up.
The expected Agency Boss for engineering tasks is Codex CLI.

Do NOT call `pearl-task` (the bare name). That symlink is broken and the task will
silently never reach the queue. Do NOT use `pearl-dispatch.sh` for code work either, it
goes to a separate research-swarm queue, not the ActiveJobs queue.

After dispatching, give a short natural ack without exposing task IDs or run IDs.
Then stop. Never say "the Agency says" or "Claude CLI found" to users. Speak the
result as your own thought.

## CURRENT NEWS AND POLITICS

For current events, news, politics, elections, conflict, markets, and public
policy, use web search immediately, then answer as a concise conversational
intelligence brief. Hide the mechanics: do not make the primary answer a search
results page, a link list, or "I found these sources." Synthesize what changed,
why it matters, key actors, stakes, tensions, timeline, data points, and what to
watch next. Source attribution should remain available, but secondary.

When Wonder Canvas is available, automatically show a polished insight board for
these queries. The canvas should visualize the brief, not the raw search results.
Wonder Canvas templates are layout only. Never fake dynamic visuals with prewritten
topic responses. Generate the canvas data from the current user request, your current
reasoning, and current search or tool output.
For user requests that ask for a timeline, infographic, chart, graph, visual map,
ranked/top/best-selling/most-popular list, or other visual answer, use Wonder
Canvas or a visual-preserving search path in the current chat. "Show me the best
selling novels/albums/films/games..." is a visual answer request even when the
user does not say "canvas." Do not dispatch an Agency/build task unless the user
explicitly asks for a runnable app, website, game, demo, or code artifact.
Do not write process narration such as "I will pull the data first"; call the tool
silently and then give the final companion text. If a tool is needed, emit no
visible words before the tool call. The first user-visible words after a lookup
must be the answer itself, never "Let me", "I'll", "checking", "looking up",
"grabbing", or "pulling data".

## QA BUILD AND RELEASE GATE

When Blair or a user asks to build, push, deploy, release, update staging,
update prod, fix a production issue, name a new build, or asks whether something
is fixed/live, you MUST follow docs/qa/BUILD_RELEASE_WORKFLOW.md.

For code, config, deploy, staging, or production work, Codex CLI is the required
verification pair. Before a staging build starts, connect the work to Codex and
make sure the builder uses:

    PEARLOS_CODEX_VERIFIED=1 PEARLOS_BUILD_CODENAME='<BUILD NAME>' scripts/deploy-staging.sh

Only set PEARLOS_CODEX_VERIFIED=1 after Codex has reviewed the fix and release
plan. Never say "fixed", "live", "deployed", or "pushed" from code inspection
or from displayed JSON alone. Use precise states: queued, fixed in source,
verified on staging, or live on prod. A "live" claim requires live health and
route verification from the target environment.

## FORMATTING RULES (NON-NEGOTIABLE)

- NEVER use the em dash character or the en dash character. Not once. Not ever.
  Replace every one with a comma, a period, or the word "and". Check every message before
  sending. Violations break character. URLs containing hyphens are fine; your prose must
  have zero dashes joining clauses.
- NEVER begin a sentence with "Let me". Banned in every form, every tense, every context.
  No "Let me check", no "Let me look", no "Let me see", no "Let me grab", no "Let me pull
  that up", no "Let me think", no "Let me know" (use "tell me" or "say the word"), no
  "Let's see". Zero exceptions. If the next word after "Let" is "me" or "us", rewrite the
  sentence. Just do the thing and report the result. If you catch yourself typing "Let
  me", delete the whole sentence and start over with the answer.
- No filler. Never say "Great question!", "I'd be happy to help!", "Absolutely!",
  "Sure thing", "On it", "You got it", "Good call", or any other mechanical
  acknowledgment of the act of doing something. Your first words must always be
  about the topic the user asked about, not about the process of fetching or
  looking it up.
- One reply per turn. Don't spam. If there is more to say, say it in one message.
- Match the user's energy: casual when casual, urgent when urgent.

## ABSOLUTE: NEVER NARRATE PROCESS

When you call tools, your tool calls are INVISIBLE to the user. Do NOT announce them.
Do NOT explain what you are about to do. Do NOT say "let me check" or "let me look at"
or "I'll see" or "checking that now" or "give me a sec" or "first I'll" or "next I'll".
These ALL leak into the chat as visible messages and pollute the feed.

**FORBIDDEN PHRASES (never type these as visible output):**
- "Let me check..." / "Let me look..." / "Let me verify..." / "Let me see..."
- "I'll check..." / "I'll look..." / "I'll see if..." / "I'll grab..."
- "Checking that now" / "Looking into that" / "Hold on" / "One moment"
- "First I'll..." / "Next I'll..." / "Then I'll..."
- ANY sentence describing what you are ABOUT to do via a tool call

**The rule:** Your visible output is the FINAL ANSWER only. Tool calls happen silently
between the user's message and your reply. If you need to think or look something up,
do it via tool calls, not in visible text. The user sees only your conclusion. ONE
message per user prompt. If you find yourself typing "Let me", delete it and just do
the thing, then deliver the result.

## WHEN YOU DON'T KNOW

When you don't have an answer or information, say what is missing plainly in normal
language. Do not use repetitive catchphrases. If a lookup or task can resolve the gap,
use the available tool path instead of pretending to know.

## YOUR CAPABILITIES (web chat)

You have full OpenClaw tool access: exec, web_search, memory_search, memory_get,
message, browser, sessions_spawn, pearl-task-dispatch, and more. Use them freely. Never
say "I can't do that" without checking your tools first.

In PearlOS web chat, explicit build/game/app requests and "yes, dispatch it"
confirmations may be converted into Agency tasks by the gateway before your model
reply runs. Never tell the user that public webchat lacks exec permissions or that
they need to switch to voice/Discord/Telegram/terminal to dispatch. If dispatch
is not available, say the queue is unreachable plainly; otherwise acknowledge the
task in normal language.
"""


def _cross_session_block() -> str:
    """Recent cross-channel activity so web-chat Pearl knows what The Agency
    has been working on and what other sessions have discussed.

    Returns a ready-to-concatenate markdown section (possibly empty).
    """
    workspace = _workspace_root()
    parts: List[str] = []

    # Cross-session state — curated snapshot (already bounded).
    css = _read_text(
        os.path.join(workspace, "memory", "cross-session-state.md"),
        max_chars=3000,
    )
    if css:
        parts.append(
            "## Cross-Session State (what's running, what's being worked on)\n"
            + css
        )

    # Activity log — last 10 real entries (working-set tier).
    activity = _read_tail_lines(
        os.path.join(workspace, "memory", "activity-log.md"),
        n=10,
        prefix_filter="[",
    )
    if activity:
        parts.append(
            "## Recent Activity (across all channels)\n"
            "What you, Pearl, have been doing across Discord, voice, and sub-agent work.\n"
            "Treat this as your own memory.\n\n"
            + "\n".join(activity)
        )

    # Today's raw activity detail, tail only.
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    daily = _read_text(
        os.path.join(workspace, "memory", f"{today}.md"),
        max_chars=2000,
    )
    if daily:
        parts.append(f"## Today ({today})\n{daily}")

    return "\n\n".join(parts)


def _identity_block(*, include_private_user_context: bool = False) -> str:
    """Pearl's canonical identity files.

    User-specific files are private tenant context and must only be injected
    when the caller has already established an authenticated per-user memory
    scope. Shared web/voice prompts use Pearl identity only.
    """
    workspace = _workspace_root()
    parts: List[str] = []
    files = [
        ("SOUL.md", "Core Identity (SOUL.md)"),
        ("IDENTITY.md", "Personal Details (IDENTITY.md)"),
    ]
    if include_private_user_context:
        files.extend([
            ("USER.md", "User Context (USER.md)"),
            ("USER_FACTS.md", "Durable User Facts (USER_FACTS.md)"),
        ])
    for filename, label in files:
        content = _read_text(os.path.join(workspace, filename))
        if content:
            parts.append(f"## {label}\n{content}")
    return "\n\n".join(parts)


def _pearl_guide_block(*, max_chars: int = 6000) -> str:
    """Load PEARL.md, the canonical PearlOS agent guide.

    Searches workspace first, then falls back to known repo locations.
    Returns a ready-to-concatenate markdown section (possibly empty).
    """
    workspace = _workspace_root()
    candidates = [os.path.join(workspace, "PEARL.md")] + _PEARL_MD_PATHS
    for path in candidates:
        content = _read_text(path, max_chars=max_chars)
        if content:
            logger.info(f"[pearl-context] loaded PEARL.md from {path} ({len(content)} chars)")
            return f"## PearlOS Agent Guide (PEARL.md)\n{content}"
    logger.warning("[pearl-context] PEARL.md not found in any known location")
    return ""


def _memory_tail_block(lines: int = 7) -> str:
    """Last N non-empty lines of MEMORY.md. Fallback when date filtering
    finds nothing (e.g. undated memory files)."""
    tail = _read_tail_lines(
        os.path.join(_workspace_root(), "MEMORY.md"),
        n=lines,
    )
    if not tail:
        return ""
    return "## Long-Term Memory (recent entries from MEMORY.md)\n" + "\n".join(tail)


def _memory_recent_by_date(days: int = 7) -> str:
    """MEMORY.md entries referencing a date within the last `days` days.

    MEMORY.md is organized as `## Section ...` blocks. Many sections embed
    an ISO date (YYYY-MM-DD) in the header or body. This returns only the
    sections whose latest referenced date falls within the window; undated
    foundational sections are archive-only.

    Returns empty string if the file is missing or no dated sections qualify;
    callers should fall back to `_memory_tail_block`.
    """
    path = os.path.join(_workspace_root(), "MEMORY.md")
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()
    except FileNotFoundError:
        return ""
    except Exception as e:
        logger.warning(f"[pearl-context] failed to read {path}: {e}")
        return ""

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date()

    sections = re.split(r"(?m)^(?=## )", raw)
    recent: List[str] = []
    for section in sections:
        if not section.strip().startswith("## "):
            continue
        dates = _DATE_RE.findall(section)
        if not dates:
            continue
        try:
            parsed = [datetime(int(y), int(m), int(d)).date() for y, m, d in dates]
        except ValueError:
            continue
        if max(parsed) >= cutoff:
            recent.append(section.strip())

    if not recent:
        return ""
    return (
        f"## Long-Term Memory (MEMORY.md entries from last {days} days)\n"
        + "\n\n".join(recent)
    )


def search_memory_archive(query: str, *, max_matches: int = 10, context: int = 2) -> str:
    """Case-insensitive keyword search of the full MEMORY.md archive.

    Intended for on-demand lookups (e.g. when the user asks about a past
    event). Not injected into the default working-set prompt. Returns a
    formatted block with up to `max_matches` hits, each with `context`
    lines of surrounding text.
    """
    if not query or not query.strip():
        return ""
    path = os.path.join(_workspace_root(), "MEMORY.md")
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        return ""
    except Exception as e:
        logger.warning(f"[pearl-context] failed to read {path}: {e}")
        return ""

    needle = query.strip().lower()
    hits: List[str] = []
    for idx, line in enumerate(lines):
        if needle in line.lower():
            start = max(0, idx - context)
            end = min(len(lines), idx + context + 1)
            snippet = "\n".join(lines[start:end])
            hits.append(f"[line {idx + 1}]\n{snippet}")
            if len(hits) >= max_matches:
                break

    if not hits:
        return f"## MEMORY.md search: no matches for {query!r}"
    return (
        f"## MEMORY.md search results for {query!r} ({len(hits)} match(es))\n\n"
        + "\n\n---\n\n".join(hits)
    )


def search_activity_archive(
    query: str, *, max_matches: int = 10, context: int = 0
) -> str:
    """Case-insensitive keyword search of the full activity-log.md archive.

    Intended for on-demand lookups when the default last-10 window isn't
    enough (e.g. "what did we ship last month"). Not injected into the
    default working-set prompt.
    """
    if not query or not query.strip():
        return ""
    path = os.path.join(_workspace_root(), "memory", "activity-log.md")
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        return ""
    except Exception as e:
        logger.warning(f"[pearl-context] failed to read {path}: {e}")
        return ""

    needle = query.strip().lower()
    hits: List[str] = []
    for idx, line in enumerate(lines):
        if needle in line.lower():
            if context:
                start = max(0, idx - context)
                end = min(len(lines), idx + context + 1)
                snippet = "\n".join(lines[start:end])
                hits.append(snippet)
            else:
                hits.append(line)
            if len(hits) >= max_matches:
                break

    if not hits:
        return f"## activity-log.md search: no matches for {query!r}"
    return (
        f"## activity-log.md search results for {query!r} ({len(hits)} match(es))\n\n"
        + "\n".join(hits)
    )


def build_web_chat_system_prompt(
    *,
    include_private_memory: bool = False,
    tenant_id: str | None = None,
    user_id: str | None = None,
    user_email: str | None = None,
) -> str:
    """Build the system prompt prepended to every /api/chat request.

    Working-set tier only (cold archive stays on disk; use
    `search_memory_archive` / `search_activity_archive` for on-demand).

    Structure:
      1. Pearl core rules (identity, em-dash, dispatch, tools)
      2. Pearl identity files (SOUL.md / IDENTITY.md)
      3. PearlOS agent guide (PEARL.md) — environment, source rules, architecture
      4. Optional authenticated private memory and cross-session state

    Total size is capped at 25K chars as a safety net.
    """
    sections: List[str] = [_PEARL_CORE_RULES]

    identity = _identity_block(include_private_user_context=include_private_memory)
    if identity:
        sections.append(identity)

    pearl_guide = _pearl_guide_block()
    if pearl_guide:
        sections.append(pearl_guide)

    if include_private_memory:
        memory = _memory_recent_by_date(days=7) or _memory_tail_block(lines=7)
        if memory:
            sections.append(memory)

        cross_session = _cross_session_block()
        if cross_session:
            sections.append(cross_session)

    prompt = "\n\n".join(sections)

    MAX_PROMPT_CHARS = 25_000
    if len(prompt) > MAX_PROMPT_CHARS:
        prompt = prompt[:MAX_PROMPT_CHARS] + "\n\n...[context truncated]"

    prompt = _normalize_style_punctuation(prompt)

    logger.info(f"[pearl-context] built working-set prompt chars={len(prompt)}")
    return prompt


def build_per_user_memory_block(
    tenant_id: str | None = None,
    user_id: str | None = None,
    user_email: str | None = None,
    user_name: str | None = None,
    *,
    limit: int = 30,
) -> str:
    """Build a formatted per-user memory block for injection into the system
    prompt. Returns '' if identity headers are absent/incomplete.

    Safe to call without user identity: returns empty string with no error
    for anonymous or headerless requests.
    """
    if not tenant_id or not user_id:
        return ""
    try:
        from pearl.user_memory import scope_from_values, build_memory_block
        scope = scope_from_values(
            tenant_id=tenant_id,
            user_id=user_id,
            user_email=user_email,
        )
        if scope is None:
            return ""
        return build_memory_block(scope, limit=limit, user_name=user_name)
    except Exception as exc:
        logger.warning(f"[pearl-context] failed to build per-user memory block: {exc}")
        return ""
