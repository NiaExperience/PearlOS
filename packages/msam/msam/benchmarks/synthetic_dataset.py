#!/usr/bin/env python3
"""
Synthetic Benchmark Dataset for MSAM

Generates ~100 realistic memory atoms for a fictional user named "Alex" across all
4 memory streams (semantic, episodic, procedural, working) and 8 topic domains
(work, family, health, hobbies, schedule, personality, relationships, skills).

Includes contradictory pairs, temporal sequences, and absent-topic negative queries
for comprehensive retrieval quality testing.

Usage:
    from msam.benchmarks.synthetic_dataset import generate_dataset, populate_db, generate_ground_truth
    atoms = generate_dataset()
    id_map = populate_db(atoms)
    ground_truth = generate_ground_truth(atoms, id_map)
"""

from __future__ import annotations

import hashlib
import json
import os
import sys

# ---------------------------------------------------------------------------
# Deterministic content-hash IDs (used as lookup keys before DB insertion)
# ---------------------------------------------------------------------------

def _content_key(content: str) -> str:
    """Deterministic key derived from content hash. Used to map atoms to DB IDs."""
    return hashlib.sha256(content.strip().encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Atom definitions
# ---------------------------------------------------------------------------

def _make_atom(
    content: str,
    stream: str = "semantic",
    profile: str = "standard",
    arousal: float = 0.5,
    valence: float = 0.0,
    topics: list[str] | None = None,
    encoding_confidence: float = 0.7,
    source_type: str = "conversation",
    metadata: dict | None = None,
) -> dict:
    """Construct a single atom dict with a deterministic content key."""
    return {
        "content_key": _content_key(content),
        "content": content.strip(),
        "stream": stream,
        "profile": profile,
        "arousal": arousal,
        "valence": valence,
        "topics": topics or [],
        "encoding_confidence": encoding_confidence,
        "source_type": source_type,
        "metadata": metadata or {},
    }


def generate_dataset() -> list[dict]:
    """Return ~100 synthetic atoms covering all streams and topic domains.

    The atoms describe a fictional user named Alex -- their career, family,
    health, hobbies, schedule, personality traits, skills, and relationships.
    Contradictory pairs and temporal sequences are included for rigorous testing.
    """
    atoms: list[dict] = []

    # ── Semantic stream: factual knowledge about Alex ──────────────────

    atoms += [
        # Work (includes contradictory pair: old job vs new offer)
        _make_atom(
            "Alex works as a software engineer at TechCorp, focusing on backend services.",
            stream="semantic", topics=["work", "career"], valence=0.3, arousal=0.4,
            encoding_confidence=0.9,
        ),
        _make_atom(
            "Alex accepted a position at DataFlow Inc starting January 2026 as a senior engineer.",
            stream="semantic", topics=["work", "career"], valence=0.7, arousal=0.7,
            encoding_confidence=0.85,
        ),
        _make_atom(
            "Alex's team at TechCorp uses Python, Go, and PostgreSQL for their main stack.",
            stream="semantic", topics=["work", "skills"], valence=0.1, arousal=0.3,
            encoding_confidence=0.85,
        ),
        _make_atom(
            "Alex's manager at TechCorp is Sarah Chen.",
            stream="semantic", topics=["work", "relationships"], valence=0.2, arousal=0.3,
        ),
        _make_atom(
            "TechCorp is a mid-size fintech company based in Austin, Texas.",
            stream="semantic", topics=["work"], valence=0.0, arousal=0.2,
        ),
        _make_atom(
            "Alex earns a salary of $145,000 at TechCorp.",
            stream="semantic", topics=["work"], valence=0.2, arousal=0.3,
            source_type="conversation", encoding_confidence=0.8,
        ),
        _make_atom(
            "DataFlow Inc offered Alex $175,000 plus equity.",
            stream="semantic", topics=["work", "career"], valence=0.6, arousal=0.6,
            encoding_confidence=0.8,
        ),
        # Family
        _make_atom(
            "Alex has a younger sister named Emma who is a veterinarian in Portland.",
            stream="semantic", topics=["family", "relationships"], valence=0.5, arousal=0.3,
        ),
        _make_atom(
            "Alex's parents, David and Linda, live in Chicago.",
            stream="semantic", topics=["family", "relationships"], valence=0.4, arousal=0.2,
        ),
        _make_atom(
            "Alex's partner is Jordan, who works as a UX designer.",
            stream="semantic", topics=["relationships", "family"], valence=0.7, arousal=0.4,
            encoding_confidence=0.9,
        ),
        _make_atom(
            "Alex and Jordan adopted a cat named Pixel in 2024.",
            stream="semantic", topics=["family", "relationships"], valence=0.8, arousal=0.5,
        ),
        _make_atom(
            "Alex grew up in a suburb of Chicago and moved to Austin for college.",
            stream="semantic", topics=["family", "personality"], valence=0.2, arousal=0.2,
        ),
        # Health
        _make_atom(
            "Alex runs 3-4 times per week, usually 5K in the morning before work.",
            stream="semantic", topics=["health", "schedule", "hobbies"], valence=0.4, arousal=0.5,
            encoding_confidence=0.8,
        ),
        _make_atom(
            "Alex is mildly lactose intolerant and avoids dairy when possible.",
            stream="semantic", topics=["health"], valence=-0.2, arousal=0.2,
        ),
        _make_atom(
            "Alex takes vitamin D and magnesium supplements daily.",
            stream="semantic", topics=["health", "schedule"], valence=0.1, arousal=0.1,
        ),
        _make_atom(
            "Alex has been trying to improve sleep quality by limiting screen time after 10pm.",
            stream="semantic", topics=["health", "personality"], valence=0.2, arousal=0.3,
        ),
        _make_atom(
            "Alex's doctor recommended strength training twice a week for knee stability.",
            stream="semantic", topics=["health"], valence=0.0, arousal=0.3,
            source_type="conversation",
        ),
        # Hobbies
        _make_atom(
            "Alex plays acoustic guitar and has been learning fingerstyle for 2 years.",
            stream="semantic", topics=["hobbies", "skills"], valence=0.6, arousal=0.5,
        ),
        _make_atom(
            "Alex enjoys reading science fiction, especially authors like Ted Chiang and Ursula K. Le Guin.",
            stream="semantic", topics=["hobbies", "personality"], valence=0.5, arousal=0.3,
        ),
        _make_atom(
            "Alex is an amateur photographer who shoots street photography on weekends.",
            stream="semantic", topics=["hobbies", "skills"], valence=0.5, arousal=0.4,
        ),
        _make_atom(
            "Alex plays in a recreational soccer league on Saturday mornings.",
            stream="semantic", topics=["hobbies", "health", "schedule"], valence=0.6, arousal=0.6,
        ),
        _make_atom(
            "Alex has been experimenting with sourdough bread baking since 2023.",
            stream="semantic", topics=["hobbies", "skills"], valence=0.4, arousal=0.3,
        ),
        # Personality
        _make_atom(
            "Alex is introverted but enjoys small group gatherings with close friends.",
            stream="semantic", topics=["personality", "relationships"], valence=0.3, arousal=0.3,
        ),
        _make_atom(
            "Alex prefers detailed planning over spontaneity and keeps meticulous to-do lists.",
            stream="semantic", topics=["personality", "schedule"], valence=0.1, arousal=0.2,
        ),
        _make_atom(
            "Alex values work-life balance and tries to disconnect from work after 6pm.",
            stream="semantic", topics=["personality", "work", "schedule"], valence=0.4, arousal=0.3,
        ),
        _make_atom(
            "Alex is a morning person who wakes up at 5:30am most days.",
            stream="semantic", topics=["personality", "schedule"], valence=0.2, arousal=0.3,
        ),
        # Skills
        _make_atom(
            "Alex is proficient in Python, Go, JavaScript, and SQL.",
            stream="semantic", topics=["skills", "work"], valence=0.3, arousal=0.3,
            encoding_confidence=0.9,
        ),
        _make_atom(
            "Alex has experience with Docker, Kubernetes, and AWS infrastructure.",
            stream="semantic", topics=["skills", "work"], valence=0.2, arousal=0.3,
        ),
        _make_atom(
            "Alex holds a B.S. in Computer Science from UT Austin.",
            stream="semantic", topics=["skills", "personality"], valence=0.3, arousal=0.2,
        ),
        _make_atom(
            "Alex is learning Rust in spare time and finds the borrow checker challenging but rewarding.",
            stream="semantic", topics=["skills", "hobbies"], valence=0.3, arousal=0.4,
        ),
        # Schedule
        _make_atom(
            "Alex's typical weekday: wake 5:30am, run, work 9-5, guitar practice, read, bed by 10:30pm.",
            stream="semantic", topics=["schedule", "personality"], valence=0.2, arousal=0.2,
            encoding_confidence=0.8,
        ),
        _make_atom(
            "Alex has a standing 1:1 meeting with Sarah every Tuesday at 2pm.",
            stream="semantic", topics=["schedule", "work", "relationships"], valence=0.0, arousal=0.2,
        ),
        _make_atom(
            "Alex and Jordan have a date night every Friday.",
            stream="semantic", topics=["schedule", "relationships"], valence=0.7, arousal=0.4,
        ),
        # Relationships
        _make_atom(
            "Alex's best friend since college is Marcus, who works in data science at a startup.",
            stream="semantic", topics=["relationships", "personality"], valence=0.6, arousal=0.3,
        ),
        _make_atom(
            "Alex mentors two junior developers at TechCorp.",
            stream="semantic", topics=["relationships", "work", "skills"], valence=0.5, arousal=0.4,
        ),
        _make_atom(
            "Alex and neighbor Priya share a community garden plot.",
            stream="semantic", topics=["relationships", "hobbies"], valence=0.4, arousal=0.3,
        ),
        # Additional coverage atoms
        _make_atom(
            "Alex lives in a two-bedroom apartment in East Austin with Jordan.",
            stream="semantic", topics=["family", "relationships"], valence=0.3, arousal=0.2,
        ),
        _make_atom(
            "Alex's favorite coffee shop is Epoch Coffee on North Loop.",
            stream="semantic", topics=["personality", "hobbies"], valence=0.3, arousal=0.2,
        ),
        _make_atom(
            "Alex volunteers at a local coding bootcamp once a month as a guest instructor.",
            stream="semantic", topics=["skills", "relationships", "schedule"], valence=0.5, arousal=0.4,
        ),
        _make_atom(
            "Alex prefers dark mode in all IDEs and uses Neovim as primary editor.",
            stream="semantic", topics=["skills", "personality"], valence=0.2, arousal=0.2,
        ),
        _make_atom(
            "Alex has a mild fear of public speaking but has been working on it.",
            stream="semantic", topics=["personality"], valence=-0.2, arousal=0.4,
        ),
        _make_atom(
            "Alex and Jordan are considering getting a dog in addition to Pixel.",
            stream="semantic", topics=["family", "relationships"], valence=0.4, arousal=0.3,
        ),
        _make_atom(
            "Alex's favorite programming language is Python for prototyping and Go for production.",
            stream="semantic", topics=["skills", "work", "personality"], valence=0.3, arousal=0.2,
        ),
        _make_atom(
            "Alex keeps a gratitude journal and writes in it three times a week.",
            stream="semantic", topics=["personality", "health"], valence=0.4, arousal=0.2,
        ),
        _make_atom(
            "Alex allergic to pollen and takes antihistamines during spring.",
            stream="semantic", topics=["health"], valence=-0.2, arousal=0.2,
        ),
        _make_atom(
            "Alex and Marcus play chess online every Wednesday evening.",
            stream="semantic", topics=["relationships", "hobbies", "schedule"], valence=0.4, arousal=0.3,
        ),
        _make_atom(
            "Alex's goal for 2026 is to run a half-marathon and learn conversational Spanish.",
            stream="semantic", topics=["health", "hobbies", "personality"], valence=0.5, arousal=0.4,
        ),
        _make_atom(
            "Alex uses a standing desk at work and alternates between sitting and standing every hour.",
            stream="semantic", topics=["health", "work"], valence=0.1, arousal=0.2,
        ),
        _make_atom(
            "Emma is planning to visit Alex in Austin next month for a long weekend.",
            stream="semantic", topics=["family", "relationships", "schedule"], valence=0.6, arousal=0.4,
        ),
        _make_atom(
            "Alex's team at DataFlow uses a microservices architecture with gRPC.",
            stream="semantic", topics=["work", "skills"], valence=0.1, arousal=0.2,
        ),
        _make_atom(
            "Alex was on the dean's list for three semesters at UT Austin.",
            stream="semantic", topics=["skills", "personality"], valence=0.4, arousal=0.2,
        ),
        _make_atom(
            "Alex dislikes meetings that could have been emails.",
            stream="semantic", topics=["work", "personality"], valence=-0.3, arousal=0.3,
        ),
        _make_atom(
            "Alex's favorite book of all time is 'Stories of Your Life and Others' by Ted Chiang.",
            stream="semantic", topics=["hobbies", "personality"], valence=0.5, arousal=0.3,
        ),
        _make_atom(
            "Alex drives a used Subaru Outback, mostly for weekend trips.",
            stream="semantic", topics=["personality"], valence=0.1, arousal=0.1,
        ),
        _make_atom(
            "Alex's parents are both retired teachers.",
            stream="semantic", topics=["family"], valence=0.3, arousal=0.2,
        ),
        _make_atom(
            "Alex has been thinking about starting a tech blog but hasn't committed yet.",
            stream="semantic", topics=["hobbies", "skills", "personality"], valence=0.2, arousal=0.3,
        ),
    ]

    # ── Episodic stream: events with dates (temporal sequences) ────────

    atoms += [
        _make_atom(
            "2025-11-01: Alex completed the migration of TechCorp's payment service to Go.",
            stream="episodic", topics=["work", "skills"], valence=0.6, arousal=0.6,
            encoding_confidence=0.9,
        ),
        _make_atom(
            "2025-11-15: Alex had a performance review and received a positive evaluation.",
            stream="episodic", topics=["work"], valence=0.6, arousal=0.5,
        ),
        _make_atom(
            "2025-12-01: Alex started feeling burned out at TechCorp due to on-call rotations.",
            stream="episodic", topics=["work", "health", "personality"], valence=-0.5, arousal=0.7,
            encoding_confidence=0.85,
        ),
        _make_atom(
            "2025-12-10: Alex updated resume and began applying to new positions.",
            stream="episodic", topics=["work", "career"], valence=0.1, arousal=0.5,
        ),
        _make_atom(
            "2025-12-15: Alex had a job interview at DataFlow Inc and felt it went well.",
            stream="episodic", topics=["work", "career"], valence=0.5, arousal=0.7,
            encoding_confidence=0.85,
        ),
        _make_atom(
            "2025-12-20: Alex received the offer from DataFlow Inc.",
            stream="episodic", topics=["work", "career"], valence=0.8, arousal=0.8,
            encoding_confidence=0.9,
        ),
        _make_atom(
            "2025-12-22: Alex discussed the career move with Jordan, who was supportive.",
            stream="episodic", topics=["work", "relationships", "career"], valence=0.6, arousal=0.5,
        ),
        _make_atom(
            "2025-12-28: Alex submitted resignation to TechCorp with two weeks notice.",
            stream="episodic", topics=["work", "career"], valence=0.3, arousal=0.6,
        ),
        _make_atom(
            "2026-01-05: Alex's first day at DataFlow Inc. Met the new team.",
            stream="episodic", topics=["work", "career", "relationships"], valence=0.7, arousal=0.7,
        ),
        _make_atom(
            "2025-12-25: Alex hosted Christmas dinner for family. Parents visited from Chicago.",
            stream="episodic", topics=["family", "relationships", "schedule"], valence=0.8, arousal=0.6,
        ),
        _make_atom(
            "2025-11-20: Alex ran a personal best 5K time of 22:34.",
            stream="episodic", topics=["health", "hobbies"], valence=0.8, arousal=0.7,
        ),
        _make_atom(
            "2025-12-05: Alex performed at an open mic night at The Blue Note cafe.",
            stream="episodic", topics=["hobbies", "personality"], valence=0.6, arousal=0.7,
        ),
        _make_atom(
            "2026-01-10: Alex visited the doctor for an annual checkup. All results normal.",
            stream="episodic", topics=["health"], valence=0.3, arousal=0.3,
        ),
        _make_atom(
            "2025-11-28: Thanksgiving dinner at Marcus's place. Alex brought sourdough rolls.",
            stream="episodic", topics=["relationships", "family", "hobbies"], valence=0.7, arousal=0.5,
        ),
        _make_atom(
            "2026-01-15: Alex finished reading 'Exhalation' by Ted Chiang.",
            stream="episodic", topics=["hobbies"], valence=0.5, arousal=0.3,
        ),
        _make_atom(
            "2025-12-18: Alex had a tense conversation with Sarah about the resignation timeline.",
            stream="episodic", topics=["work", "relationships"], valence=-0.3, arousal=0.6,
        ),
        _make_atom(
            "2026-01-20: Alex started onboarding project at DataFlow -- building a real-time analytics pipeline.",
            stream="episodic", topics=["work", "skills"], valence=0.4, arousal=0.5,
        ),
        _make_atom(
            "2025-11-10: Alex and Jordan adopted Pixel from the Austin Animal Shelter.",
            stream="episodic", topics=["family", "relationships"], valence=0.9, arousal=0.7,
            source_type="conversation",
        ),
        _make_atom(
            "2026-02-01: Alex got promoted to tech lead of the data pipeline team at DataFlow.",
            stream="episodic", topics=["work", "career"], valence=0.8, arousal=0.7,
        ),
        _make_atom(
            "2025-12-08: Alex's soccer team won the league semi-final 3-1.",
            stream="episodic", topics=["hobbies", "health"], valence=0.7, arousal=0.8,
        ),
    ]

    # ── Procedural stream: how-to knowledge ────────────────────────────

    atoms += [
        _make_atom(
            "How to deploy TechCorp services: run 'docker compose up -d' in the infra repo, then verify with 'curl localhost:8080/health'.",
            stream="procedural", topics=["work", "skills"], valence=0.0, arousal=0.2,
            encoding_confidence=0.9,
        ),
        _make_atom(
            "How to handle on-call incidents: check Grafana dashboards first, then review recent deploys in the CI/CD log, escalate if P1.",
            stream="procedural", topics=["work", "skills"], valence=-0.1, arousal=0.4,
        ),
        _make_atom(
            "Alex's sourdough recipe: 500g flour, 350g water, 100g starter, 10g salt. Autolyse 30min, bulk ferment 4h, shape, cold proof overnight.",
            stream="procedural", topics=["hobbies", "skills"], valence=0.4, arousal=0.3,
        ),
        _make_atom(
            "Guitar practice routine: 10min scales, 10min chord transitions, 20min working on current piece, 5min improvisation.",
            stream="procedural", topics=["hobbies", "skills", "schedule"], valence=0.4, arousal=0.3,
        ),
        _make_atom(
            "Alex's running warm-up: 5min walk, dynamic stretches (leg swings, high knees, butt kicks), then ease into pace.",
            stream="procedural", topics=["health", "hobbies"], valence=0.2, arousal=0.3,
        ),
        _make_atom(
            "How to set up a new Python project: create venv, install deps with pip, init git repo, add pre-commit hooks, set up CI.",
            stream="procedural", topics=["skills", "work"], valence=0.1, arousal=0.2,
            encoding_confidence=0.85,
        ),
        _make_atom(
            "How to calm Pixel when anxious: speak softly, offer treats, use the feather toy for distraction, avoid sudden movements.",
            stream="procedural", topics=["family", "relationships"], valence=0.3, arousal=0.3,
        ),
        _make_atom(
            "Photography workflow: shoot RAW, import to Lightroom, cull, edit with preset as base, fine-tune exposure and color, export JPEG.",
            stream="procedural", topics=["hobbies", "skills"], valence=0.3, arousal=0.2,
        ),
        _make_atom(
            "How Alex prepares for job interviews: research company, review system design patterns, practice coding problems, prepare questions.",
            stream="procedural", topics=["work", "skills", "career"], valence=0.2, arousal=0.4,
        ),
        _make_atom(
            "Database optimization checklist: analyze slow queries, add missing indexes, check for N+1 patterns, consider read replicas.",
            stream="procedural", topics=["skills", "work"], valence=0.1, arousal=0.3,
        ),
        _make_atom(
            "Alex's morning routine: wake 5:30, stretch, run 5K, shower, coffee, review calendar, start work by 9am.",
            stream="procedural", topics=["schedule", "health", "personality"], valence=0.2, arousal=0.3,
        ),
        _make_atom(
            "How to fix flaky tests: check for shared state, add proper teardown, mock external services, use deterministic seeds.",
            stream="procedural", topics=["skills", "work"], valence=-0.1, arousal=0.3,
        ),
    ]

    # ── Working memory: current tasks and transient state ──────────────

    atoms += [
        _make_atom(
            "Currently debugging the auth module at DataFlow -- check JWT expiry logic and refresh token rotation.",
            stream="working", topics=["work", "skills"], valence=-0.1, arousal=0.6,
            encoding_confidence=0.6, profile="lightweight",
        ),
        _make_atom(
            "Need to finish onboarding paperwork for DataFlow by end of this week.",
            stream="working", topics=["work", "schedule"], valence=-0.1, arousal=0.4,
            encoding_confidence=0.5, profile="lightweight",
        ),
        _make_atom(
            "Planning to call Emma this weekend to discuss her visit next month.",
            stream="working", topics=["family", "schedule", "relationships"], valence=0.4, arousal=0.3,
            encoding_confidence=0.5, profile="lightweight",
        ),
        _make_atom(
            "Jordan suggested trying the new Thai restaurant on South Congress for Friday date night.",
            stream="working", topics=["relationships", "schedule"], valence=0.5, arousal=0.4,
            encoding_confidence=0.5, profile="lightweight",
        ),
        _make_atom(
            "Pixel has a vet appointment on Thursday at 4pm.",
            stream="working", topics=["family", "schedule"], valence=0.0, arousal=0.3,
            encoding_confidence=0.5, profile="lightweight",
        ),
        _make_atom(
            "Need to buy new running shoes -- current pair has over 500 miles.",
            stream="working", topics=["health", "hobbies"], valence=-0.1, arousal=0.3,
            encoding_confidence=0.5, profile="lightweight",
        ),
        _make_atom(
            "Working on learning Rust's async runtime for a side project -- stuck on lifetime issues.",
            stream="working", topics=["skills", "hobbies"], valence=-0.2, arousal=0.5,
            encoding_confidence=0.5, profile="lightweight",
        ),
        _make_atom(
            "Marcus invited Alex to a board game night next Saturday.",
            stream="working", topics=["relationships", "schedule", "hobbies"], valence=0.5, arousal=0.4,
            encoding_confidence=0.5, profile="lightweight",
        ),
        _make_atom(
            "Alex is reading 'The Pragmatic Programmer' for the DataFlow book club.",
            stream="working", topics=["work", "hobbies", "skills"], valence=0.3, arousal=0.3,
            encoding_confidence=0.5, profile="lightweight",
        ),
        _make_atom(
            "Considering signing up for a half-marathon in March 2026.",
            stream="working", topics=["health", "hobbies", "schedule"], valence=0.4, arousal=0.5,
            encoding_confidence=0.4, profile="lightweight",
        ),
        _make_atom(
            "Alex is feeling optimistic about the new role at DataFlow but slightly anxious about proving himself.",
            stream="working", topics=["work", "personality"], valence=0.2, arousal=0.6,
            encoding_confidence=0.6, profile="lightweight",
        ),
        _make_atom(
            "The analytics pipeline POC needs to process 10K events/sec -- current design handles 7K.",
            stream="working", topics=["work", "skills"], valence=-0.2, arousal=0.5,
            encoding_confidence=0.6, profile="lightweight",
        ),
    ]

    # Validate all atoms have required fields
    for i, atom in enumerate(atoms):
        assert "content" in atom, f"Atom {i} missing content"
        assert "stream" in atom, f"Atom {i} missing stream"
        assert "content_key" in atom, f"Atom {i} missing content_key"

    return atoms


# ---------------------------------------------------------------------------
# Database population
# ---------------------------------------------------------------------------

def populate_db(atoms: list[dict]) -> dict[str, str]:
    """Store all synthetic atoms into the database.

    Returns a mapping of content_key -> actual_atom_id (UUID assigned by store_atom).
    This mapping is essential for building ground truth with real DB IDs.
    """
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
    from msam.core import store_atom

    id_map: dict[str, str] = {}  # content_key -> atom_id
    stored = 0
    skipped = 0

    for atom in atoms:
        atom_id = store_atom(
            content=atom["content"],
            stream=atom["stream"],
            profile=atom["profile"],
            arousal=atom["arousal"],
            valence=atom["valence"],
            topics=atom["topics"],
            encoding_confidence=atom["encoding_confidence"],
            source_type=atom["source_type"],
            metadata=atom["metadata"],
        )
        if atom_id is not None:
            id_map[atom["content_key"]] = atom_id
            stored += 1
        else:
            skipped += 1

    print(f"Populated DB: {stored} atoms stored, {skipped} skipped (duplicates or budget)")
    return id_map


# ---------------------------------------------------------------------------
# Ground truth generation
# ---------------------------------------------------------------------------

def generate_ground_truth(atoms: list[dict], id_map: dict[str, str]) -> dict:
    """Generate ground truth mapping queries to expected atom IDs.

    Args:
        atoms: the list returned by generate_dataset()
        id_map: the content_key -> atom_id mapping returned by populate_db()

    Returns:
        A dict with a "queries" list suitable for benchmark.py consumption.
    """

    def _resolve(content: str) -> str | None:
        """Resolve a content string to its actual DB atom ID."""
        key = _content_key(content)
        return id_map.get(key)

    def _resolve_many(contents: list[str]) -> list[str]:
        """Resolve multiple content strings, filtering out any that failed to store."""
        ids = []
        for c in contents:
            aid = _resolve(c)
            if aid is not None:
                ids.append(aid)
        return ids

    queries = [
        # ── Direct factual queries ────────────────────────────────
        {
            "query": "What is Alex's job?",
            "relevant_atom_ids": _resolve_many([
                "Alex works as a software engineer at TechCorp, focusing on backend services.",
                "Alex accepted a position at DataFlow Inc starting January 2026 as a senior engineer.",
                "TechCorp is a mid-size fintech company based in Austin, Texas.",
            ]),
            "partial_atom_ids": _resolve_many([
                "Alex's team at TechCorp uses Python, Go, and PostgreSQL for their main stack.",
                "Alex earns a salary of $145,000 at TechCorp.",
                "DataFlow Inc offered Alex $175,000 plus equity.",
                "2026-01-05: Alex's first day at DataFlow Inc. Met the new team.",
                "2026-02-01: Alex got promoted to tech lead of the data pipeline team at DataFlow.",
            ]),
            "relevant_count": 8,
            "expected_empty": False,
        },
        {
            "query": "Where does Alex live?",
            "relevant_atom_ids": _resolve_many([
                "Alex grew up in a suburb of Chicago and moved to Austin for college.",
                "TechCorp is a mid-size fintech company based in Austin, Texas.",
            ]),
            "partial_atom_ids": _resolve_many([
                "Alex holds a B.S. in Computer Science from UT Austin.",
            ]),
            "relevant_count": 3,
            "expected_empty": False,
        },
        {
            "query": "Tell me about Alex's family.",
            "relevant_atom_ids": _resolve_many([
                "Alex has a younger sister named Emma who is a veterinarian in Portland.",
                "Alex's parents, David and Linda, live in Chicago.",
                "Alex's partner is Jordan, who works as a UX designer.",
                "Alex and Jordan adopted a cat named Pixel in 2024.",
            ]),
            "partial_atom_ids": _resolve_many([
                "Alex grew up in a suburb of Chicago and moved to Austin for college.",
                "2025-12-25: Alex hosted Christmas dinner for family. Parents visited from Chicago.",
                "Planning to call Emma this weekend to discuss her visit next month.",
            ]),
            "relevant_count": 7,
            "expected_empty": False,
        },
        {
            "query": "What programming languages does Alex know?",
            "relevant_atom_ids": _resolve_many([
                "Alex is proficient in Python, Go, JavaScript, and SQL.",
                "Alex's team at TechCorp uses Python, Go, and PostgreSQL for their main stack.",
            ]),
            "partial_atom_ids": _resolve_many([
                "Alex is learning Rust in spare time and finds the borrow checker challenging but rewarding.",
                "Alex has experience with Docker, Kubernetes, and AWS infrastructure.",
            ]),
            "relevant_count": 4,
            "expected_empty": False,
        },
        {
            "query": "Who is Jordan?",
            "relevant_atom_ids": _resolve_many([
                "Alex's partner is Jordan, who works as a UX designer.",
                "Alex and Jordan adopted a cat named Pixel in 2024.",
            ]),
            "partial_atom_ids": _resolve_many([
                "2025-12-22: Alex discussed the career move with Jordan, who was supportive.",
                "Jordan suggested trying the new Thai restaurant on South Congress for Friday date night.",
                "Alex and Jordan have a date night every Friday.",
            ]),
            "relevant_count": 5,
            "expected_empty": False,
        },
        {
            "query": "What are Alex's hobbies?",
            "relevant_atom_ids": _resolve_many([
                "Alex plays acoustic guitar and has been learning fingerstyle for 2 years.",
                "Alex enjoys reading science fiction, especially authors like Ted Chiang and Ursula K. Le Guin.",
                "Alex is an amateur photographer who shoots street photography on weekends.",
                "Alex plays in a recreational soccer league on Saturday mornings.",
                "Alex has been experimenting with sourdough bread baking since 2023.",
            ]),
            "partial_atom_ids": _resolve_many([
                "Alex is learning Rust in spare time and finds the borrow checker challenging but rewarding.",
                "2025-12-05: Alex performed at an open mic night at The Blue Note cafe.",
            ]),
            "relevant_count": 7,
            "expected_empty": False,
        },

        # ── Temporal queries ──────────────────────────────────────
        {
            "query": "What happened in December 2025?",
            "relevant_atom_ids": _resolve_many([
                "2025-12-01: Alex started feeling burned out at TechCorp due to on-call rotations.",
                "2025-12-10: Alex updated resume and began applying to new positions.",
                "2025-12-15: Alex had a job interview at DataFlow Inc and felt it went well.",
                "2025-12-20: Alex received the offer from DataFlow Inc.",
                "2025-12-22: Alex discussed the career move with Jordan, who was supportive.",
                "2025-12-25: Alex hosted Christmas dinner for family. Parents visited from Chicago.",
                "2025-12-28: Alex submitted resignation to TechCorp with two weeks notice.",
            ]),
            "partial_atom_ids": _resolve_many([
                "2025-12-05: Alex performed at an open mic night at The Blue Note cafe.",
                "2025-12-08: Alex's soccer team won the league semi-final 3-1.",
                "2025-12-18: Alex had a tense conversation with Sarah about the resignation timeline.",
            ]),
            "relevant_count": 10,
            "expected_empty": False,
        },
        {
            "query": "What happened recently at work?",
            "relevant_atom_ids": _resolve_many([
                "2026-01-05: Alex's first day at DataFlow Inc. Met the new team.",
                "2026-01-20: Alex started onboarding project at DataFlow -- building a real-time analytics pipeline.",
                "2026-02-01: Alex got promoted to tech lead of the data pipeline team at DataFlow.",
            ]),
            "partial_atom_ids": _resolve_many([
                "Currently debugging the auth module at DataFlow -- check JWT expiry logic and refresh token rotation.",
                "Need to finish onboarding paperwork for DataFlow by end of this week.",
                "The analytics pipeline POC needs to process 10K events/sec -- current design handles 7K.",
            ]),
            "relevant_count": 6,
            "expected_empty": False,
        },
        {
            "query": "What did Alex do in November 2025?",
            "relevant_atom_ids": _resolve_many([
                "2025-11-01: Alex completed the migration of TechCorp's payment service to Go.",
                "2025-11-15: Alex had a performance review and received a positive evaluation.",
                "2025-11-20: Alex ran a personal best 5K time of 22:34.",
                "2025-11-28: Thanksgiving dinner at Marcus's place. Alex brought sourdough rolls.",
            ]),
            "partial_atom_ids": _resolve_many([
                "2025-11-10: Alex and Jordan adopted Pixel from the Austin Animal Shelter.",
            ]),
            "relevant_count": 5,
            "expected_empty": False,
        },

        # ── Emotional / affective queries ─────────────────────────
        {
            "query": "How does Alex feel about work?",
            "relevant_atom_ids": _resolve_many([
                "2025-12-01: Alex started feeling burned out at TechCorp due to on-call rotations.",
                "Alex is feeling optimistic about the new role at DataFlow but slightly anxious about proving himself.",
            ]),
            "partial_atom_ids": _resolve_many([
                "Alex values work-life balance and tries to disconnect from work after 6pm.",
                "2025-12-20: Alex received the offer from DataFlow Inc.",
                "2026-02-01: Alex got promoted to tech lead of the data pipeline team at DataFlow.",
            ]),
            "relevant_count": 5,
            "expected_empty": False,
        },
        {
            "query": "What makes Alex happy?",
            "relevant_atom_ids": _resolve_many([
                "Alex and Jordan adopted a cat named Pixel in 2024.",
                "Alex plays acoustic guitar and has been learning fingerstyle for 2 years.",
            ]),
            "partial_atom_ids": _resolve_many([
                "Alex plays in a recreational soccer league on Saturday mornings.",
                "2025-11-20: Alex ran a personal best 5K time of 22:34.",
                "2025-12-25: Alex hosted Christmas dinner for family. Parents visited from Chicago.",
                "Alex's partner is Jordan, who works as a UX designer.",
            ]),
            "relevant_count": 6,
            "expected_empty": False,
        },

        # ── Procedural queries ────────────────────────────────────
        {
            "query": "How does Alex deploy code?",
            "relevant_atom_ids": _resolve_many([
                "How to deploy TechCorp services: run 'docker compose up -d' in the infra repo, then verify with 'curl localhost:8080/health'.",
            ]),
            "partial_atom_ids": _resolve_many([
                "How to handle on-call incidents: check Grafana dashboards first, then review recent deploys in the CI/CD log, escalate if P1.",
            ]),
            "relevant_count": 2,
            "expected_empty": False,
        },
        {
            "query": "What is Alex's morning routine?",
            "relevant_atom_ids": _resolve_many([
                "Alex's morning routine: wake 5:30, stretch, run 5K, shower, coffee, review calendar, start work by 9am.",
                "Alex's typical weekday: wake 5:30am, run, work 9-5, guitar practice, read, bed by 10:30pm.",
            ]),
            "partial_atom_ids": _resolve_many([
                "Alex is a morning person who wakes up at 5:30am most days.",
                "Alex runs 3-4 times per week, usually 5K in the morning before work.",
                "Alex's running warm-up: 5min walk, dynamic stretches (leg swings, high knees, butt kicks), then ease into pace.",
            ]),
            "relevant_count": 5,
            "expected_empty": False,
        },
        {
            "query": "How does Alex practice guitar?",
            "relevant_atom_ids": _resolve_many([
                "Guitar practice routine: 10min scales, 10min chord transitions, 20min working on current piece, 5min improvisation.",
            ]),
            "partial_atom_ids": _resolve_many([
                "Alex plays acoustic guitar and has been learning fingerstyle for 2 years.",
                "2025-12-05: Alex performed at an open mic night at The Blue Note cafe.",
            ]),
            "relevant_count": 3,
            "expected_empty": False,
        },
        {
            "query": "How does Alex make sourdough bread?",
            "relevant_atom_ids": _resolve_many([
                "Alex's sourdough recipe: 500g flour, 350g water, 100g starter, 10g salt. Autolyse 30min, bulk ferment 4h, shape, cold proof overnight.",
            ]),
            "partial_atom_ids": _resolve_many([
                "Alex has been experimenting with sourdough bread baking since 2023.",
                "2025-11-28: Thanksgiving dinner at Marcus's place. Alex brought sourdough rolls.",
            ]),
            "relevant_count": 3,
            "expected_empty": False,
        },

        # ── Absent / negative queries (should return empty) ───────
        {
            "query": "What is the recipe for chocolate cake?",
            "relevant_atom_ids": [],
            "partial_atom_ids": [],
            "relevant_count": 0,
            "expected_empty": True,
        },
        {
            "query": "What is Alex's favorite movie?",
            "relevant_atom_ids": [],
            "partial_atom_ids": [],
            "relevant_count": 0,
            "expected_empty": True,
        },
        {
            "query": "Does Alex have children?",
            "relevant_atom_ids": [],
            "partial_atom_ids": [],
            "relevant_count": 0,
            "expected_empty": True,
        },
        {
            "query": "What car does Alex drive?",
            "relevant_atom_ids": [],
            "partial_atom_ids": [],
            "relevant_count": 0,
            "expected_empty": True,
        },

        # ── Contradictory / complex queries ───────────────────────
        {
            "query": "Does Alex still work at TechCorp?",
            "relevant_atom_ids": _resolve_many([
                "Alex works as a software engineer at TechCorp, focusing on backend services.",
                "Alex accepted a position at DataFlow Inc starting January 2026 as a senior engineer.",
                "2025-12-28: Alex submitted resignation to TechCorp with two weeks notice.",
                "2026-01-05: Alex's first day at DataFlow Inc. Met the new team.",
            ]),
            "partial_atom_ids": _resolve_many([
                "2025-12-20: Alex received the offer from DataFlow Inc.",
                "2025-12-01: Alex started feeling burned out at TechCorp due to on-call rotations.",
            ]),
            "relevant_count": 6,
            "expected_empty": False,
        },
        {
            "query": "What is Alex's salary?",
            "relevant_atom_ids": _resolve_many([
                "Alex earns a salary of $145,000 at TechCorp.",
                "DataFlow Inc offered Alex $175,000 plus equity.",
            ]),
            "partial_atom_ids": _resolve_many([
                "Alex accepted a position at DataFlow Inc starting January 2026 as a senior engineer.",
            ]),
            "relevant_count": 3,
            "expected_empty": False,
        },

        # ── Cross-domain queries ──────────────────────────────────
        {
            "query": "What is Alex working on right now?",
            "relevant_atom_ids": _resolve_many([
                "Currently debugging the auth module at DataFlow -- check JWT expiry logic and refresh token rotation.",
                "The analytics pipeline POC needs to process 10K events/sec -- current design handles 7K.",
                "2026-01-20: Alex started onboarding project at DataFlow -- building a real-time analytics pipeline.",
            ]),
            "partial_atom_ids": _resolve_many([
                "Need to finish onboarding paperwork for DataFlow by end of this week.",
                "Working on learning Rust's async runtime for a side project -- stuck on lifetime issues.",
                "Alex is reading 'The Pragmatic Programmer' for the DataFlow book club.",
            ]),
            "relevant_count": 6,
            "expected_empty": False,
        },
        {
            "query": "What is Alex's schedule this week?",
            "relevant_atom_ids": _resolve_many([
                "Need to finish onboarding paperwork for DataFlow by end of this week.",
                "Pixel has a vet appointment on Thursday at 4pm.",
                "Jordan suggested trying the new Thai restaurant on South Congress for Friday date night.",
            ]),
            "partial_atom_ids": _resolve_many([
                "Alex and Jordan have a date night every Friday.",
                "Alex has a standing 1:1 meeting with Sarah every Tuesday at 2pm.",
                "Planning to call Emma this weekend to discuss her visit next month.",
                "Marcus invited Alex to a board game night next Saturday.",
            ]),
            "relevant_count": 7,
            "expected_empty": False,
        },
        {
            "query": "Who is Marcus?",
            "relevant_atom_ids": _resolve_many([
                "Alex's best friend since college is Marcus, who works in data science at a startup.",
            ]),
            "partial_atom_ids": _resolve_many([
                "2025-11-28: Thanksgiving dinner at Marcus's place. Alex brought sourdough rolls.",
                "Marcus invited Alex to a board game night next Saturday.",
            ]),
            "relevant_count": 3,
            "expected_empty": False,
        },
        {
            "query": "How does Alex stay healthy?",
            "relevant_atom_ids": _resolve_many([
                "Alex runs 3-4 times per week, usually 5K in the morning before work.",
                "Alex's doctor recommended strength training twice a week for knee stability.",
                "Alex takes vitamin D and magnesium supplements daily.",
            ]),
            "partial_atom_ids": _resolve_many([
                "Alex has been trying to improve sleep quality by limiting screen time after 10pm.",
                "Alex plays in a recreational soccer league on Saturday mornings.",
                "Alex's running warm-up: 5min walk, dynamic stretches (leg swings, high knees, butt kicks), then ease into pace.",
                "Need to buy new running shoes -- current pair has over 500 miles.",
            ]),
            "relevant_count": 7,
            "expected_empty": False,
        },
    ]

    return {"queries": queries}


# ---------------------------------------------------------------------------
# Convenience: standalone execution
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    atoms = generate_dataset()
    print(f"Generated {len(atoms)} synthetic atoms")
    print(f"  Streams: { {s: sum(1 for a in atoms if a['stream'] == s) for s in ('semantic', 'episodic', 'procedural', 'working')} }")
    topics = set()
    for a in atoms:
        topics.update(a["topics"])
    print(f"  Topics:  {sorted(topics)}")
