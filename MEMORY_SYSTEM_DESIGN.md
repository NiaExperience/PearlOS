# Pearl Unified Memory System — Architecture Design

**Author:** Pearl (Opus sub-agent)  
**Date:** 2026-02-16  
**Status:** Design Complete — Ready for Implementation

---

## Executive Summary

Pearl currently operates across three channels (PearlOS Voice, Discord, Telegram) with fragmented memory. Voice sessions lose all conversation history when they end. Discord/Telegram sessions share workspace files but can't see what was said in voice. The activity log is a good first step but is append-only text — not queryable, not structured, and not accessible programmatically from the voice pipeline.

This document designs a **unified memory layer** that gives every Pearl session instant access to:
1. What was said in other sessions (conversation summaries)
2. User preferences and learned context
3. Recent actions and decisions
4. Active tasks, reminders, and pending items

---

## Current Architecture Analysis

### What Exists Today

| Component | Location | Access From Voice | Access From OpenClaw |
|-----------|----------|-------------------|----------------------|
| `MEMORY.md` | `/root/.openclaw/workspace/MEMORY.md` | ✅ Read via `load_workspace_context()` | ✅ Native file access |
| `activity-log.md` | `/root/.openclaw/workspace/memory/activity-log.md` | ✅ Last 10 entries loaded into system prompt | ✅ Native file access |
| Daily memory files | `/root/.openclaw/workspace/memory/YYYY-MM-DD.md` | ❌ Not loaded | ✅ Native file access |
| Mesh DB (Postgres) | `localhost:2000` (GraphQL/REST) | ✅ Via Mesh API | ✅ Via Mesh API |
| Redis | `localhost:6379` | ✅ Room state (when enabled) | ❌ Not used |
| Voice conversation context | In-memory `OpenAILLMContext` | ✅ Current session only | ❌ Lost when session ends |
| OpenClaw session history | OpenClaw internal DB | ❌ No access | ✅ Via `sessions_history` |

### Key Gaps

1. **Voice conversations vanish** — When a Pipecat voice session ends, the entire `OpenAILLMContext` (all messages) is garbage collected. No persistence.
2. **No structured query** — `activity-log.md` is human-readable but not machine-queryable. You can't ask "what did Friend say about the demo timeline?"
3. **One-way file bridge** — Voice reads workspace files at boot, but never writes back. Discoveries made in voice sessions don't reach Discord.
4. **No conversation summaries** — Discord Pearl can `sessions_history` other OpenClaw sessions, but voice sessions don't create OpenClaw sessions — they're Pipecat-native.
5. **Redis underutilized** — Currently only stores room state (active note/applet). Could hold ephemeral cross-session data.

---

## Architecture Design

### Design Principles

1. **Mesh DB is the source of truth** for persistent structured memory (already has Postgres, REST API, auth)
2. **Workspace files remain the human-readable layer** (MEMORY.md, activity-log.md, daily notes)
3. **Redis is the real-time ephemeral layer** for session presence, active conversations, quick lookups
4. **Every session writes; every session reads** — bidirectional memory flow
5. **Summaries over transcripts** — Store conversation *summaries*, not raw transcripts (privacy + token efficiency)

### Three-Layer Memory Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     PEARL UNIFIED MEMORY                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 1: EPHEMERAL (Redis)          TTL: minutes-hours          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ • Active session registry (who's online, which channel)  │    │
│  │ • Current conversation topics per session                │    │
│  │ • Recent message buffer (last 5 msgs per channel)        │    │
│  │ • Session handoff signals ("user switching to Discord")  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Layer 2: STRUCTURED (Mesh DB / Postgres)   TTL: permanent      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ • Conversation summaries (per session, timestamped)      │    │
│  │ • User preferences (learned from interactions)           │    │
│  │ • Active tasks/reminders (with deadlines)                │    │
│  │ • Decision log (what was decided and why)                │    │
│  │ • Entity memory (people, projects, things mentioned)     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Layer 3: NARRATIVE (Workspace Files)       TTL: permanent      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ • MEMORY.md (curated long-term memory)                   │    │
│  │ • activity-log.md (human-readable event stream)          │    │
│  │ • Daily notes (detailed daily context)                   │    │
│  │ • cross-session-context.md (coordination notes)          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Ephemeral Memory (Redis)

### Purpose
Real-time session awareness. "Who is talking to Pearl right now, and about what?"

### Data Structures

```
# Session registry — which Pearl sessions are active
pearl:sessions:{channel}    → Hash { session_id, started_at, user_id, last_active }
                             TTL: 1 hour (refreshed on activity)

# Current conversation topic per channel  
pearl:topic:{channel}       → String "discussing demo timeline for Wednesday"
                             TTL: 30 minutes

# Recent message buffer — last N messages per channel (for quick context)
pearl:recent:{channel}      → List of JSON { role, content_summary, timestamp }
                             Max length: 10, TTL: 2 hours

# Handoff signal — "user is switching channels"
pearl:handoff:{user_id}     → Hash { from_channel, to_channel, context_summary, timestamp }
                             TTL: 10 minutes
```

### Who Reads/Writes

| Actor | Reads | Writes |
|-------|-------|--------|
| Pipecat Voice | session registry, recent messages from other channels | own session, own topic, own recent messages |
| OpenClaw Discord | session registry, recent messages from other channels | own session, own topic, own recent messages |
| OpenClaw Telegram | session registry, recent messages from other channels | own session, own topic, own recent messages |

### Why Redis (not just Mesh DB)
- Sub-millisecond reads (vs 5-50ms for Postgres)
- Natural TTL expiration for ephemeral data
- Pub/sub for real-time session handoff signals
- Already in the stack (used by room state.py)

---

## Layer 2: Structured Memory (Mesh DB)

### New Content Types

We'll register three new Prism content types in the Mesh DB:

#### 2a. `ConversationMemory`

```json
{
  "name": "ConversationMemory",
  "dataModel": {
    "block": "conversation_memory",
    "jsonSchema": {
      "type": "object",
      "properties": {
        "session_id": { "type": "string" },
        "channel": { "type": "string", "enum": ["voice", "discord", "telegram", "webchat"] },
        "user_id": { "type": "string" },
        "started_at": { "type": "string", "format": "date-time" },
        "ended_at": { "type": "string", "format": "date-time" },
        "summary": { "type": "string" },
        "topics": { "type": "array", "items": { "type": "string" } },
        "key_decisions": { "type": "array", "items": { "type": "string" } },
        "action_items": { "type": "array", "items": { "type": "string" } },
        "sentiment": { "type": "string", "enum": ["positive", "neutral", "frustrated", "urgent"] },
        "message_count": { "type": "integer" }
      },
      "required": ["session_id", "channel", "summary", "started_at"]
    },
    "indexer": {
      "fields": ["channel", "user_id", "started_at"]
    }
  }
}
```

#### 2b. `UserPreference`

```json
{
  "name": "UserPreference",
  "dataModel": {
    "block": "user_preference",
    "jsonSchema": {
      "type": "object",
      "properties": {
        "user_id": { "type": "string" },
        "category": { "type": "string" },
        "key": { "type": "string" },
        "value": { "type": "string" },
        "learned_from": { "type": "string" },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "last_confirmed": { "type": "string", "format": "date-time" }
      },
      "required": ["user_id", "key", "value"]
    },
    "indexer": {
      "fields": ["user_id", "category", "key"]
    }
  }
}
```

#### 2c. `ActiveTask`

```json
{
  "name": "ActiveTask",
  "dataModel": {
    "block": "active_task",
    "jsonSchema": {
      "type": "object",
      "properties": {
        "task_id": { "type": "string" },
        "user_id": { "type": "string" },
        "title": { "type": "string" },
        "description": { "type": "string" },
        "status": { "type": "string", "enum": ["pending", "in_progress", "blocked", "done", "cancelled"] },
        "created_channel": { "type": "string" },
        "created_at": { "type": "string", "format": "date-time" },
        "due_at": { "type": "string", "format": "date-time" },
        "completed_at": { "type": "string", "format": "date-time" },
        "tags": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["task_id", "user_id", "title", "status", "created_at"]
    },
    "indexer": {
      "fields": ["user_id", "status", "created_at"]
    }
  }
}
```

### Why Mesh DB (not workspace files)
- Queryable: "Show me all conversations about the demo from the last 24h"
- Structured: JSON schema validation, indexing
- API accessible from anywhere (voice bot, OpenClaw, future services)
- Already has REST + GraphQL endpoints
- Prism content types = zero schema migration headaches

---

## Layer 3: Narrative Memory (Workspace Files)

### No Changes Required

The existing file-based memory system (`MEMORY.md`, `activity-log.md`, daily notes) continues as-is. It serves a different purpose:

- **Human-readable context** that gets loaded into system prompts
- **Cross-session coordination** notes (what other sessions have been doing)
- **Curated long-term memory** (MEMORY.md — distilled insights, not raw data)

The structured memory in Mesh DB *complements* the files — it doesn't replace them. Think of it as:
- **Mesh DB** = Pearl's queryable database memory (like a personal knowledge graph)
- **Workspace files** = Pearl's narrative memory (like a journal)

### New Convention: Auto-Update Activity Log

Currently, only OpenClaw sessions write to `activity-log.md`. Voice sessions should too. This is addressed in the implementation plan (voice session writes a summary on disconnect).

---

## Integration Points

### 1. Voice Session → Memory (Write Path)

**Current gap:** Voice conversation context is lost when session ends.

**Solution:** Add a session teardown hook in `runner_main.py` that:

```python
# Pseudocode for runner_main.py session cleanup
async def on_session_end(room_url, context, session_info):
    """Called when voice session disconnects."""
    
    messages = context.get_messages_for_logging()
    
    # 1. Generate conversation summary (use the LLM itself, or a cheap model)
    summary = await generate_conversation_summary(messages)
    
    # 2. Write to Mesh DB (ConversationMemory)
    await mesh_client.create_conversation_memory(
        session_id=session_info.session_id,
        channel="voice",
        user_id=session_info.user_id,
        started_at=session_info.started_at,
        ended_at=datetime.utcnow().isoformat(),
        summary=summary.text,
        topics=summary.topics,
        key_decisions=summary.decisions,
        action_items=summary.action_items,
    )
    
    # 3. Update activity log (workspace file)
    append_to_activity_log(
        f"[voice] — Session ended. {summary.one_liner}"
    )
    
    # 4. Update Redis recent messages (flush buffer)
    await redis_client.delete(f"pearl:recent:voice")
```

### 2. Voice Session → Memory (Read Path on Boot)

**Current state:** `load_workspace_context()` in `builder.py` reads identity files + last 10 activity log entries.

**Enhancement:** Also load recent conversation summaries from Mesh DB:

```python
# Addition to load_workspace_context() in builder.py
async def load_cross_session_context() -> str:
    """Load recent conversation summaries from Mesh DB."""
    
    # Get last 5 conversation summaries across all channels
    summaries = await mesh_client.query_conversation_memories(
        limit=5,
        order_by="started_at DESC"
    )
    
    if not summaries:
        return ""
    
    parts = ["## Recent Conversations Across All Channels\n"]
    for s in summaries:
        parts.append(
            f"**[{s.channel}] {s.started_at}** — {s.summary}\n"
            f"  Topics: {', '.join(s.topics)}\n"
            f"  Decisions: {', '.join(s.key_decisions) if s.key_decisions else 'None'}\n"
        )
    
    return "\n".join(parts)
```

### 3. OpenClaw Session → Memory (Write Path)

**Current state:** OpenClaw sessions implicitly persist conversation in their internal DB. Activity log is manually updated.

**Enhancement:** Add a periodic memory flush (during heartbeats or at session boundaries):

```python
# In heartbeat handler or session cleanup
async def flush_session_to_memory():
    """Summarize current OpenClaw session and persist to Mesh DB."""
    
    # Get recent conversation from OpenClaw session
    recent_messages = get_recent_session_messages(limit=50)
    
    # Generate summary
    summary = await generate_summary(recent_messages)
    
    # Write to Mesh DB
    await mesh_client.create_conversation_memory(
        session_id=current_session_id,
        channel="discord",  # or "telegram"
        summary=summary,
        ...
    )
```

### 4. OpenClaw Session → Memory (Read Path)

**Current state:** `sessions_history` can pull history from other OpenClaw sessions. But can't see voice sessions.

**Enhancement:** Query Mesh DB for voice session summaries:

```python
# Available as a tool or auto-loaded on session start
async def get_cross_channel_context():
    """Get recent conversation summaries from all channels."""
    
    # Query Mesh DB for recent ConversationMemory entries
    result = await mesh_api.get(
        "/api/content/ConversationMemory",
        params={"limit": 10, "where": json.dumps({"started_at": {"gt": "2026-02-15T00:00:00Z"}})}
    )
    
    return result
```

### 5. Real-Time Session Handoff

**Scenario:** Friend is in a voice session, says "I'm going to continue this on Discord."

**Flow:**
1. Voice Pearl writes handoff signal to Redis: `pearl:handoff:Friend → { from: "voice", to: "discord", context: "discussing demo timeline, decided on MiniMax M2.5, need to fix iOS Safari title bug" }`
2. Discord Pearl checks handoff on next message arrival
3. Discord Pearl seamlessly continues: "I see you were discussing the demo timeline in voice — you decided on MiniMax M2.5. What about that iOS title bug?"

### 6. Preference Learning

**Scenario:** Friend says "I like the volume at 75%" in voice. Later asks Discord Pearl to play soundtrack.

**Flow:**
1. Voice Pearl detects preference signal, writes to Mesh DB:
   ```json
   { "key": "soundtrack_volume", "value": "75", "category": "audio", "confidence": 0.9, "learned_from": "voice session 2026-02-15" }
   ```
2. Discord Pearl queries preferences before setting volume
3. Sets volume to 75% without asking

---

## New Service: `memory_service.py`

A shared Python module used by both the Pipecat bot and (via CLI/API) by OpenClaw.

### File Location
`/workspace/nia-universal/apps/pipecat-daily-bot/bot/services/memory_service.py`

### API Surface

```python
class MemoryService:
    """Unified memory service for Pearl cross-session context."""
    
    def __init__(self, mesh_base_url: str, mesh_secret: str, redis_url: str = None):
        ...
    
    # --- Conversation Memory ---
    async def save_conversation(self, channel: str, session_id: str, 
                                 messages: list[dict], user_id: str = None) -> dict:
        """Summarize and persist a conversation."""
    
    async def get_recent_conversations(self, limit: int = 5, 
                                        channel: str = None,
                                        since: str = None) -> list[dict]:
        """Get recent conversation summaries, optionally filtered by channel."""
    
    # --- User Preferences ---
    async def learn_preference(self, user_id: str, key: str, value: str,
                                category: str = "general", confidence: float = 0.8) -> dict:
        """Record a learned user preference."""
    
    async def get_preferences(self, user_id: str, category: str = None) -> list[dict]:
        """Get user preferences, optionally filtered by category."""
    
    async def get_preference(self, user_id: str, key: str) -> str | None:
        """Get a specific preference value."""
    
    # --- Active Tasks ---
    async def create_task(self, user_id: str, title: str, 
                           description: str = "", channel: str = None) -> dict:
        """Create a tracked task."""
    
    async def get_active_tasks(self, user_id: str) -> list[dict]:
        """Get all non-completed tasks for a user."""
    
    async def complete_task(self, task_id: str) -> dict:
        """Mark a task as done."""
    
    # --- Session Awareness (Redis) ---
    async def register_session(self, channel: str, session_id: str, user_id: str = None):
        """Register an active session in Redis."""
    
    async def get_active_sessions(self) -> list[dict]:
        """Get all currently active Pearl sessions."""
    
    async def set_current_topic(self, channel: str, topic: str):
        """Set the current conversation topic for a channel."""
    
    async def get_current_topics(self) -> dict[str, str]:
        """Get current topics across all active channels."""
    
    async def signal_handoff(self, user_id: str, from_channel: str, 
                              to_channel: str, context_summary: str):
        """Signal that user is switching channels."""
    
    async def check_handoff(self, user_id: str, channel: str) -> dict | None:
        """Check if there's a pending handoff for this user/channel."""
    
    # --- Convenience ---
    async def build_cross_session_context(self, current_channel: str) -> str:
        """Build a text block of cross-session context for system prompt injection."""
    
    async def append_activity_log(self, channel: str, summary: str):
        """Append an entry to the workspace activity log file."""
```

### CLI Wrapper (for OpenClaw `exec` access)

`/workspace/nia-universal/apps/pipecat-daily-bot/bot/services/memory_cli.py`

```python
#!/usr/bin/env python3
"""CLI wrapper for Pearl memory service — callable from OpenClaw via exec."""

import asyncio
import sys
import json
from memory_service import MemoryService

async def main():
    cmd = sys.argv[1]
    svc = MemoryService(...)
    
    if cmd == "recent-conversations":
        result = await svc.get_recent_conversations(limit=int(sys.argv[2] if len(sys.argv) > 2 else 5))
        print(json.dumps(result, indent=2))
    
    elif cmd == "save-conversation":
        data = json.loads(sys.stdin.read())
        result = await svc.save_conversation(**data)
        print(json.dumps(result))
    
    elif cmd == "get-preferences":
        user_id = sys.argv[2]
        result = await svc.get_preferences(user_id)
        print(json.dumps(result, indent=2))
    
    elif cmd == "active-tasks":
        user_id = sys.argv[2]
        result = await svc.get_active_tasks(user_id)
        print(json.dumps(result, indent=2))
    
    elif cmd == "context":
        channel = sys.argv[2] if len(sys.argv) > 2 else "discord"
        result = await svc.build_cross_session_context(channel)
        print(result)

asyncio.run(main())
```

Symlinked to `/usr/local/bin/pearl-memory` for easy OpenClaw access.

---

## Example Flow: Voice → Discord (10 min later)

### Scenario
Friend asks voice Pearl: "What's the status of the Wednesday demo?" Pearl answers with details about MiniMax M2.5, iOS bugs, etc. Friend then goes to Discord 10 minutes later and asks: "What did we decide about the demo?"

### Step-by-Step

```
T=0:00  Friend joins voice session
        → Pipecat bot starts
        → load_workspace_context() runs:
          - Reads SOUL.md, USER.md, IDENTITY.md
          - Reads last 10 entries from activity-log.md
          - NEW: Calls memory_service.get_recent_conversations(limit=5)
          - NEW: Calls memory_service.check_handoff("Friend", "voice")
          - Injects all context into system prompt
        → NEW: memory_service.register_session("voice", session_id, "Friend")

T=0:01  Friend: "What's the status of the Wednesday demo?"
        Pearl: "Here's where we stand..." (discusses MiniMax, iOS bugs, etc.)
        → NEW: memory_service.set_current_topic("voice", "Wednesday demo status")
        → NEW: Redis buffer updated with message summaries

T=0:05  Friend: "OK let's go with MiniMax M2.5 for the demo"
        Pearl: "Got it, MiniMax M2.5 it is."
        → NEW: Key decision detected → queued for conversation summary

T=0:08  Friend disconnects from voice
        → NEW: on_session_end() fires:
          1. Generates conversation summary from OpenAILLMContext messages
          2. Writes ConversationMemory to Mesh DB:
             { channel: "voice", summary: "Reviewed Wednesday demo status. 
               Decided to use MiniMax M2.5 for voice pipeline. Discussed 
               remaining iOS Safari bugs (title visibility, scroll).",
               topics: ["demo", "MiniMax M2.5", "iOS bugs"],
               key_decisions: ["Use MiniMax M2.5 for Wednesday demo"],
               action_items: ["Fix iOS title visibility", "Test on real device"] }
          3. Appends to activity-log.md:
             "[2026-02-16 00:15] [voice] — Demo review session. Decided on 
              MiniMax M2.5. iOS bugs still need fixing."
          4. Clears Redis session entry

T=0:18  Friend messages Discord Pearl: "What did we decide about the demo?"
        → OpenClaw session starts (or continues)
        → AGENTS.md instructs: read activity-log.md on startup ✅ (already happens)
        → NEW: Pearl also runs memory_service.get_recent_conversations(limit=5)
        → Sees the voice session summary from T=0:08
        → Responds: "In your voice session about 10 minutes ago, you decided 
           to go with MiniMax M2.5 for the Wednesday demo. You also noted 
           iOS Safari bugs still need fixing — title visibility and scroll issues."
```

### What Made This Work
1. **Voice session persisted its summary** to Mesh DB on disconnect
2. **Activity log got updated** so even without Mesh DB query, Discord sees the entry
3. **Conversation summary includes structured data** (topics, decisions, action items) — not just a blob of text
4. **Discord Pearl queried Mesh DB** for recent conversations, found the voice session

---

## Implementation Plan

### Phase 1: Foundation (Day 1 — ~4 hours)

**Goal:** Memory service + Mesh content types + basic read/write

1. **Register Prism content types** in Mesh DB
   - `ConversationMemory`, `UserPreference`, `ActiveTask`
   - Script: `scripts/register-memory-content-types.ts` (or via REST API calls)

2. **Create `memory_service.py`**
   - Location: `/workspace/nia-universal/apps/pipecat-daily-bot/bot/services/memory_service.py`
   - Depends on: `aiohttp` (already in deps), Mesh REST API
   - Implements: `save_conversation`, `get_recent_conversations`, `build_cross_session_context`

3. **Create `memory_cli.py`**
   - CLI wrapper for OpenClaw exec access
   - Symlink to `/usr/local/bin/pearl-memory`

4. **Create OpenClaw skill**
   - `/root/.openclaw/workspace/skills/pearl-memory/SKILL.md`
   - Teaches OpenClaw agent to use `pearl-memory` CLI

**Files changed:** 3 new files, 0 existing files modified

### Phase 2: Voice Write-Back (Day 1-2 — ~3 hours)

**Goal:** Voice sessions persist conversation summaries on disconnect

1. **Add session teardown hook** in `runner_main.py`
   - Hook into existing session cleanup flow
   - Call `memory_service.save_conversation()` with message history
   - Append summary to `activity-log.md`

2. **Add conversation summarizer**
   - Simple approach: Use the session's LLM to generate a summary before teardown
   - Or: Cheap model (GPT-4o-mini direct) for summary generation
   - Extracts: summary text, topics, decisions, action items

3. **Update `load_workspace_context()`** in `builder.py`
   - Add call to `memory_service.get_recent_conversations()`
   - Inject cross-channel summaries into voice system prompt

**Files changed:** `runner_main.py` (teardown hook), `builder.py` (context loading), 1 new summarizer module

### Phase 3: Redis Session Awareness (Day 2 — ~2 hours)

**Goal:** Real-time session presence and topic tracking

1. **Enable Redis** for memory operations (separate from USE_REDIS queue flag)
   - New env var: `MEMORY_REDIS_ENABLED=true`
   - Uses existing Redis infrastructure

2. **Session registration** on voice connect/disconnect
   - Register in `runner_main.py` session start
   - Deregister on session end

3. **Topic tracking** — update current topic after significant exchanges
   - Lightweight: Extract topic from last few messages periodically
   - Write to `pearl:topic:{channel}`

4. **OpenClaw session registration**
   - Register on session start (via heartbeat or session init)
   - Update topic periodically

**Files changed:** `memory_service.py` (Redis methods), `runner_main.py`, OpenClaw heartbeat config

### Phase 4: Preferences & Tasks (Day 2-3 — ~3 hours)

**Goal:** Structured preference learning and task tracking

1. **Preference extraction** — detect preference signals in conversation
   - Pattern matching: "I like X", "set Y to Z", "always do W"
   - Write to Mesh DB via `memory_service.learn_preference()`

2. **Preference loading** — query preferences on session start
   - Inject relevant preferences into system prompt
   - Or: query on-demand when needed

3. **Task tracking** — create/complete/query tasks
   - "Remind me to..." → `memory_service.create_task()`
   - "What am I working on?" → `memory_service.get_active_tasks()`
   - Tasks visible across all channels

**Files changed:** `memory_service.py` (preference/task methods), voice tools, OpenClaw skill

### Phase 5: Session Handoff (Day 3 — ~2 hours)

**Goal:** Seamless channel switching

1. **Handoff detection** — recognize when user says "I'll continue on Discord"
2. **Handoff signal** — write context summary to Redis with TTL
3. **Handoff reception** — check for pending handoff on session start
4. **Context injection** — seamlessly continue conversation with handoff context

**Files changed:** `memory_service.py`, voice tools (handoff trigger), OpenClaw session init

---

## Environment Variables

```bash
# Memory service configuration
MEMORY_REDIS_ENABLED=true        # Enable Redis for session awareness (independent of USE_REDIS)
MEMORY_REDIS_URL=redis://localhost:6379
MEMORY_MESH_URL=http://localhost:2000/api
MEMORY_MESH_SECRET=${MESH_SHARED_SECRET}

# Conversation summary
MEMORY_SUMMARY_MODEL=gpt-4o-mini  # Model for generating summaries (cheap + fast)
MEMORY_SUMMARY_MAX_MESSAGES=100   # Max messages to include in summary input
MEMORY_AUTO_SAVE=true             # Auto-save conversation on session end
```

---

## Data Flow Diagram

```
                    ┌──────────────────────┐
                    │    Friend (Human)      │
                    └──────┬───┬───┬───────┘
                           │   │   │
                    Voice  │   │   │  Telegram
                   ┌───────┘   │   └────────┐
                   │       Discord           │
                   ▼           ▼             ▼
            ┌──────────┐ ┌──────────┐ ┌──────────┐
            │ Pipecat  │ │ OpenClaw │ │ OpenClaw │
            │ Voice Bot│ │ Discord  │ │ Telegram │
            └────┬─────┘ └────┬─────┘ └────┬─────┘
                 │             │             │
                 │  ┌──────────┴──────────┐  │
                 │  │                     │  │
                 ▼  ▼                     ▼  ▼
            ┌─────────────────────────────────────┐
            │        memory_service.py             │
            │  (shared library + CLI wrapper)      │
            └───┬─────────────┬───────────────┬───┘
                │             │               │
                ▼             ▼               ▼
          ┌──────────┐  ┌──────────┐  ┌──────────────┐
          │  Redis   │  │ Mesh DB  │  │ Workspace    │
          │(ephemeral│  │(Postgres)│  │ Files        │
          │ sessions)│  │(memories)│  │(MEMORY.md,   │
          └──────────┘  └──────────┘  │ activity-log)│
                                      └──────────────┘
```

---

## Security Considerations

1. **Mesh API auth** — All memory operations go through Mesh REST API with `x-mesh-secret` header (already implemented)
2. **No raw transcripts** — Only summaries stored in DB, not verbatim conversations
3. **MEMORY.md stays private** — Only loaded in "main sessions" (per AGENTS.md rules), never in group chats
4. **Redis TTLs** — Ephemeral data auto-expires; no stale session data lingering
5. **User ID scoping** — All queries scoped to user_id to prevent cross-user data leakage (relevant for future multi-user)

---

## Migration Path

This system is **additive** — nothing existing breaks. It layers on top of the current workspace file system.

1. **Day 1:** Memory service + content types. Voice sessions start persisting. OpenClaw can query.
2. **Day 2:** Redis session awareness. Real-time cross-channel presence.
3. **Day 3:** Preferences + tasks + handoff. Full-featured memory system.

After stabilization (week 2+), consider:
- **Automatic MEMORY.md updates** — Memory service periodically distills conversation summaries into MEMORY.md
- **Semantic search** — Embed conversation summaries for "what did we talk about regarding X?" queries
- **Memory pruning** — Archive old conversation summaries (>30 days) to cold storage

---

## Open Questions / Future Work

1. **Summary model cost** — Generating summaries on session end adds LLM cost. GPT-4o-mini is ~$0.001 per summary. Acceptable.
2. **Summary quality** — Should summaries be generated by the session's LLM (which has full context) or a separate call? Session LLM is better but requires summary before context teardown.
3. **Real-time streaming** — Should Discord Pearl get notified *during* a voice session (not just after)? Redis pub/sub could enable this but adds complexity.
4. **Multi-user future** — Current design assumes single user (Friend). Mesh DB queries will need user_id scoping for multi-user.
5. **Conversation continuity** — Should a Discord conversation be able to "resume" a voice conversation (same ConversationMemory, different channel)? Or always create new entries?

---

## Summary

| What | Where | How |
|------|-------|-----|
| "What was said in voice?" | Mesh DB (ConversationMemory) | Summarized on session end, queried on session start |
| "What's Friend's preferred volume?" | Mesh DB (UserPreference) | Detected in conversation, queried on demand |
| "What tasks are active?" | Mesh DB (ActiveTask) | Created via conversation, queried cross-channel |
| "Is Friend in a voice session right now?" | Redis (pearl:sessions:*) | Set on connect, TTL expiry on disconnect |
| "What's the current topic?" | Redis (pearl:topic:*) | Updated periodically during conversation |
| "Friend just switched from voice to Discord" | Redis (pearl:handoff:*) | Signal on channel switch, consumed on arrival |
| "What happened today?" | Workspace (activity-log.md) | Appended after significant events, read on startup |
| "What does Pearl remember long-term?" | Workspace (MEMORY.md) | Curated by Pearl during heartbeats, loaded in main sessions |

**Total estimated implementation time: 2-3 days**  
**No breaking changes to existing systems**  
**Leverages existing infrastructure (Mesh DB, Redis, workspace files)**
