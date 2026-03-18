#!/usr/bin/env python3
"""
MSAM Agent Integration -- How to wire MSAM into an AI agent loop.

Shows the three integration points:
  1. Session startup (load context)
  2. During conversation (store + retrieve)
  3. Between sessions (decay + consolidation)
"""

from msam.core import (
    store_atom, hybrid_retrieve, store_working, expire_working_memory,
    metamemory_query, score_context_quality, store_session_boundary,
    predict_needed_atoms, mark_contributions,
)
from msam.triples import hybrid_retrieve_with_triples
from msam.decay import run_decay_cycle


# ─── 1. Session Startup ──────────────────────────────────────────

def on_session_start():
    """Load context at the beginning of each agent session."""

    # Check what the agent knows about the current user
    context = {"atoms": [], "triples": [], "total_tokens": 0}
    mm = metamemory_query("user preferences")
    if mm['recommendation'] == 'retrieve':
        # Enough knowledge -- retrieve it
        context = hybrid_retrieve_with_triples(
            "user preferences and current situation",
            mode="companion",
            token_budget=500,
        )
        print(f"Loaded {len(context['atoms'])} atoms, {len(context['triples'])} triples")
    elif mm['recommendation'] == 'search':
        print("Limited knowledge about user -- consider asking questions")
    else:
        print("No knowledge about user -- fresh start")

    # Predictive pre-retrieval: anticipate what the agent will need
    predicted = predict_needed_atoms(context={
        "time_of_day": "morning",
        "day_type": "weekday",
        "topics": ["work", "schedule"],
    })
    for atom in predicted:
        store_working(atom['content'], ttl_minutes=30)

    return context


# ─── 2. During Conversation ──────────────────────────────────────

def on_user_message(message: str):
    """Process a user message: retrieve context, store new facts."""

    # Retrieve relevant memories
    results = hybrid_retrieve_with_triples(message, mode="task", token_budget=300)

    # Score quality before injecting into prompt
    atoms = results.get('_raw_atoms', results.get('atoms', []))
    scored = score_context_quality(atoms, query=message)
    inject = [a for a in scored if a.get('_include', False)]
    print(f"Injecting {len(inject)}/{len(atoms)} atoms into prompt")

    # Store the user's message as working memory (session-scoped)
    store_working(f"User said: {message}", ttl_minutes=120)

    return inject


def on_agent_response(response: str, atoms_used: list):
    """After generating a response, mark which atoms contributed."""

    # Mark contributions (feedback loop)
    mark_contributions(atoms_used, response)

    # Store any new facts learned
    # (Your agent should extract facts from the conversation)
    # store_atom("User mentioned they're moving to Seattle next month")


# ─── 3. Between Sessions ─────────────────────────────────────────

def on_session_end(topics: list, decisions: list):
    """Clean up at session end: decay, expire working memory, log boundary."""

    # Store session boundary for continuity
    store_session_boundary(
        session_id="demo-session",
        summary="Discussed schedule and planning",
        topics_discussed=topics,
        decisions_made=decisions,
        unfinished=["Review the project proposal"],
        emotional_state="engaged",
    )

    # Expire working memory (promote high-access atoms, tombstone the rest)
    expired = expire_working_memory()
    print(f"Working memory: {expired.get('promoted', 0)} promoted, "
          f"{expired.get('tombstoned', 0)} tombstoned")

    # Run decay cycle (retrievability, state transitions, feedback adjustments)
    decay_result = run_decay_cycle()
    print(f"Decay cycle: {decay_result}")


# ─── Demo ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== Session Start ===")
    ctx = on_session_start()

    print("\n=== User Message ===")
    atoms = on_user_message("What's my schedule for today?")

    print("\n=== Session End ===")
    on_session_end(
        topics=["schedule", "planning"],
        decisions=["Moved standup to 10am"],
    )
