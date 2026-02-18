# Phased Refactoring Plan: Option 2 (DDD)

**Goal:** Refactor `bot.py` (3,300 lines) into a Domain-Driven Design structure.
**Strategy:** Aggressive modularization with strict domain boundaries.
**Estimated Duration:** 5-7 days

## Target Structure

```text
bot/
├── bot.py                          # Entry point only (~200 lines)
├── core/                           # Core domain types & logic
│   ├── __init__.py
│   ├── config.py                   # Configuration & Env vars
│   ├── exceptions.py               # Custom exceptions
│   └── types.py                    # Shared type definitions
├── session/                        # Session domain
│   ├── __init__.py
│   ├── lifecycle.py                # Session start/stop/join logic
│   ├── state.py                    # Session-scoped state
│   ├── participants.py             # Participant tracking
│   └── identity.py                 # Identity reconciliation
├── room/                           # Room domain
│   ├── __init__.py
│   ├── state.py                    # Room-level state (notes, applets)
│   ├── tenant.py                   # Tenant mapping
│   └── forwarder.py                # AppMessageForwarder registry
├── monitoring/                     # Observability domain
│   ├── __init__.py
│   ├── heartbeat.py                # Heartbeat file writing
│   ├── logging.py                  # Log config + filters
│   └── events.py                   # TTS speaking events
├── providers/                      # External service adapters
│   ├── __init__.py
│   ├── daily.py                    # Daily API integration
│   ├── tts.py                      # TTS provider factory
│   └── llm.py                      # LLM service setup
└── orchestration/                  # High-level workflows
    ├── __init__.py
    ├── pipeline.py                 # Pipeline construction (formerly build_pipeline)
    ├── session_manager.py          # High-level session orchestration
    └── shutdown_manager.py         # Empty-room shutdown
```

## Execution Phases

### Phase 0: Preparation & Scaffolding (Day 1)

- [ ] Create directory structure
- [ ] Create `__init__.py` files
- [ ] Set up `core/` module with shared types to prevent circular imports
- [ ] Verify test suite passes before starting

### Phase 1: Leaf Node Extraction (Day 1-2)

*Extract independent modules that don't depend on the core session loop.*

- [ ] **Monitoring**: Extract `logging.py` (log configuration) and `events.py` (TTS monitoring).
- [ ] **Room State**: Extract global dictionaries and state accessors to `room/state.py`.
- [ ] **Providers**: Extract `daily.py` (token generation) and `tts.py` (provider selection).
- [ ] **Core**: Move configuration and environment parsing to `core/config.py`.

### Phase 2: Pipeline Extraction (Day 2-3)

*Move the 430-line `build_pipeline` function.*

- [ ] Extract `build_pipeline` to `orchestration/pipeline.py`.
- [ ] Move helper functions for LLM/TTS setup to `providers/`.
- [ ] Update `bot.py` to import and use the new pipeline builder.
- [ ] **Checkpoint**: Run integration tests to verify pipeline construction still works.

### Phase 3: Session Logic Decomposition (Day 3-5)

*Break down the 1,900-line `run_pipeline_session` monster.*

- [ ] **Participants**: Extract participant tracking logic to `session/participants.py`.
- [ ] **Identity**: Extract identity reconciliation and polling to `session/identity.py`.
- [ ] **Heartbeat**: Extract heartbeat writing to `monitoring/heartbeat.py`.
- [ ] **Lifecycle**: Move the main loop logic to `session/lifecycle.py` or `orchestration/session_manager.py`.

### Phase 4: Entry Point Cleanup (Day 5)

*Final assembly and cleanup.*

- [ ] Reduce `bot.py` to a thin wrapper around `orchestration`.
- [ ] Ensure `bot()` and `main()` functions are minimal.
- [ ] Remove unused imports and dead code.

### Phase 5: Verification & Polish (Day 6)

- [ ] Run full integration test suite.
- [ ] Verify tool call tracking (using new test infrastructure).
- [ ] Check for circular dependencies.
- [ ] Add docstrings and type hints to new modules.

## Risk Management

- **Circular Imports**: We will strictly enforce `core` -> `domain` -> `orchestration` dependency flow.
- **State Management**: Global state will be encapsulated in `room.state` and `session.state` modules, making it explicit rather than implicit.
- **Testing**: We will run the integration tests (especially `test_conversation.py` and `test_notepad.py`) after each major extraction.
