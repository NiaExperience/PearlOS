"""
MSAM Forgetting Engine -- Intentional identification and retirement of
counterproductive memory atoms.

Four signal detectors identify atoms that should be forgotten:
  1. Over-retrieved but never contributing (noise)
  2. Superseded by newer atoms (stale)
  3. Contradicted by higher-confidence atoms (wrong)
  4. Confidence decayed below floor with no recent access (irrelevant)

The engine deduplicates signals and can either flag candidates for review
or automatically transition them to dormant/tombstone state.

Usage:
    from msam.forgetting import identify_forgetting_candidates

    # Dry run -- just identify candidates
    result = identify_forgetting_candidates(dry_run=True)

    # Auto mode -- transition atoms
    result = identify_forgetting_candidates(dry_run=False)
"""

import logging
from datetime import datetime, timezone, timedelta

from .config import get_config
from .core import get_db, log_forgetting

_cfg = get_config()
logger = logging.getLogger("msam.forgetting")


# ─── Signal Detectors ───────────────────────────────────────────────────────


def _detect_over_retrieved(conn, min_retrievals=5, max_contribution_rate=0.15):
    """Find atoms retrieved many times but rarely contributing to responses.

    An atom that is retrieved >= min_retrievals times but contributes to
    responses less than max_contribution_rate of the time is noise -- it
    matches queries semantically but doesn't help generate useful output.

    Returns list of dicts: {atom_id, total_retrievals, contributed,
                            contribution_rate, signal}
    """
    rows = conn.execute("""
        SELECT
            al.atom_id,
            COUNT(*) AS total,
            SUM(CASE WHEN al.contributed = 1 THEN 1 ELSE 0 END) AS contributed
        FROM access_log al
        JOIN atoms a ON a.id = al.atom_id
        WHERE a.state IN ('active', 'fading')
          AND a.is_pinned = 0
        GROUP BY al.atom_id
        HAVING COUNT(*) >= ?
    """, (min_retrievals,)).fetchall()

    candidates = []
    for row in rows:
        total = row["total"]
        contributed = row["contributed"]
        rate = contributed / total if total > 0 else 0.0
        if rate < max_contribution_rate:
            candidates.append({
                "atom_id": row["atom_id"],
                "total_retrievals": total,
                "contributed": contributed,
                "contribution_rate": round(rate, 4),
                "signal": "over_retrieved",
            })
    return candidates


def _detect_superseded(conn):
    """Find atoms that have been superseded by newer, active atoms.

    Uses the atom_relations table where relation_type = 'supersedes'.
    The target (superseded) atom is the candidate if it is still
    active/fading and not pinned, and the source (superseding) atom
    is active.

    Returns list of dicts: {atom_id, superseded_by, signal}
    """
    rows = conn.execute("""
        SELECT
            ar.target_id AS atom_id,
            ar.source_id AS superseded_by
        FROM atom_relations ar
        JOIN atoms target ON target.id = ar.target_id
        JOIN atoms source ON source.id = ar.source_id
        WHERE ar.relation_type = 'supersedes'
          AND target.state IN ('active', 'fading')
          AND target.is_pinned = 0
          AND source.state = 'active'
    """).fetchall()

    return [
        {
            "atom_id": row["atom_id"],
            "superseded_by": row["superseded_by"],
            "signal": "superseded",
        }
        for row in rows
    ]


def _detect_contradicted(conn, threshold=0.85):
    """Find atoms contradicted by higher-confidence or newer atoms.

    Calls the existing find_semantic_contradictions() detector, then for
    each contradiction pair picks the 'loser':
      - Lower encoding_confidence loses
      - On tie, the older atom loses

    Skips pinned atoms.

    Returns list of dicts: {atom_id, contradicts_with, contradiction_type,
                            signal}
    """
    try:
        from .contradictions import find_semantic_contradictions
    except ImportError:
        return []

    contradictions = find_semantic_contradictions(threshold=threshold)
    candidates = []
    seen = set()

    for c in contradictions:
        a = c["atom_a"]
        b = c["atom_b"]

        # Look up current state and confidence
        row_a = conn.execute(
            "SELECT encoding_confidence, created_at, is_pinned, state FROM atoms WHERE id = ?",
            (a["id"],)
        ).fetchone()
        row_b = conn.execute(
            "SELECT encoding_confidence, created_at, is_pinned, state FROM atoms WHERE id = ?",
            (b["id"],)
        ).fetchone()

        if not row_a or not row_b:
            continue

        # Skip if either is pinned or not in active/fading
        if row_a["is_pinned"] or row_b["is_pinned"]:
            continue
        if row_a["state"] not in ("active", "fading") or row_b["state"] not in ("active", "fading"):
            continue

        # Determine loser
        conf_a = row_a["encoding_confidence"] or 0.0
        conf_b = row_b["encoding_confidence"] or 0.0

        if conf_a < conf_b:
            loser_id, winner_id = a["id"], b["id"]
        elif conf_b < conf_a:
            loser_id, winner_id = b["id"], a["id"]
        else:
            # Tie: older atom loses
            if row_a["created_at"] <= row_b["created_at"]:
                loser_id, winner_id = a["id"], b["id"]
            else:
                loser_id, winner_id = b["id"], a["id"]

        if loser_id not in seen:
            seen.add(loser_id)
            candidates.append({
                "atom_id": loser_id,
                "contradicts_with": winner_id,
                "contradiction_type": c.get("contradiction_type", "unknown"),
                "signal": "contradicted",
            })

    return candidates


def _detect_confidence_below_floor(conn, floor=0.1, grace_days=14):
    """Find atoms whose confidence has decayed below the floor with no
    recent access.

    These atoms have had time to prove themselves (grace_days since last
    access) but their confidence is too low to be useful.

    Returns list of dicts: {atom_id, encoding_confidence, days_since_access,
                            signal}
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=grace_days)).isoformat()

    rows = conn.execute("""
        SELECT id, encoding_confidence,
               COALESCE(last_accessed_at, created_at) AS last_touch
        FROM atoms
        WHERE state IN ('active', 'fading')
          AND is_pinned = 0
          AND encoding_confidence < ?
          AND COALESCE(last_accessed_at, created_at) < ?
    """, (floor, cutoff)).fetchall()

    now = datetime.now(timezone.utc)
    candidates = []
    for row in rows:
        try:
            last_touch = datetime.fromisoformat(row["last_touch"])
            days_since = (now - last_touch).total_seconds() / 86400
        except (ValueError, TypeError):
            days_since = grace_days + 1

        candidates.append({
            "atom_id": row["id"],
            "encoding_confidence": round(row["encoding_confidence"], 4),
            "days_since_access": round(days_since, 1),
            "signal": "low_confidence",
        })

    return candidates


# ─── Main Entry Point ────────────────────────────────────────────────────────


def identify_forgetting_candidates(
    dry_run=True,
    min_retrievals=None,
    contribution_threshold=None,
    contradiction_threshold=None,
    confidence_floor=None,
    grace_days=None,
) -> dict:
    """Identify atoms that should be forgotten, optionally acting on them.

    Runs all four signal detectors, deduplicates by atom_id (combining
    signals), and sorts by signal count (more signals = stronger candidate).

    Args:
        dry_run: If True, only report candidates. If False, transition
                 atoms when config mode is "auto".
        min_retrievals: Override config forgetting_min_retrievals.
        contribution_threshold: Override config forgetting_contribution_threshold.
        contradiction_threshold: Override config forgetting_contradiction_threshold.
        confidence_floor: Override config forgetting_confidence_floor.
        grace_days: Override config forgetting_grace_days.

    Returns:
        {
            "total_candidates": int,
            "signal_counts": {"over_retrieved": N, "superseded": N, ...},
            "candidates": [
                {"atom_id": str, "signals": [str, ...], "details": [dict, ...]},
                ...
            ],
            "actions_taken": int  (0 if dry_run)
        }
    """
    # Read config overrides
    _min_ret = min_retrievals or _cfg('decay', 'forgetting_min_retrievals', 5)
    _contrib = contribution_threshold or _cfg('decay', 'forgetting_contribution_threshold', 0.15)
    _contra = contradiction_threshold or _cfg('decay', 'forgetting_contradiction_threshold', 0.85)
    _floor = confidence_floor or _cfg('decay', 'forgetting_confidence_floor', 0.1)
    _grace = grace_days or _cfg('decay', 'forgetting_grace_days', 14)
    _mode = _cfg('decay', 'intentional_forgetting_mode', 'flag')

    conn = get_db()

    # Run all detectors
    over_retrieved = _detect_over_retrieved(conn, _min_ret, _contrib)
    superseded = _detect_superseded(conn)
    contradicted = _detect_contradicted(conn, _contra)
    low_confidence = _detect_confidence_below_floor(conn, _floor, _grace)

    # Aggregate signal counts
    signal_counts = {
        "over_retrieved": len(over_retrieved),
        "superseded": len(superseded),
        "contradicted": len(contradicted),
        "low_confidence": len(low_confidence),
    }

    # Deduplicate by atom_id, combining signals
    atom_signals = {}  # atom_id -> {"signals": set, "details": list}

    for candidate_list in [over_retrieved, superseded, contradicted, low_confidence]:
        for c in candidate_list:
            aid = c["atom_id"]
            if aid not in atom_signals:
                atom_signals[aid] = {"signals": set(), "details": []}
            atom_signals[aid]["signals"].add(c["signal"])
            atom_signals[aid]["details"].append(c)

    # Sort by signal count (more signals = stronger candidate), then alphabetically
    sorted_candidates = sorted(
        atom_signals.items(),
        key=lambda x: (-len(x[1]["signals"]), x[0]),
    )

    candidates = []
    for atom_id, info in sorted_candidates:
        candidates.append({
            "atom_id": atom_id,
            "signals": sorted(info["signals"]),
            "signal_count": len(info["signals"]),
            "details": info["details"],
        })

    # Apply transitions if not dry_run and mode is "auto"
    actions_taken = 0
    if not dry_run and _mode == "auto":
        for c in candidates:
            atom_id = c["atom_id"]
            signals = c["signals"]

            # Look up current state
            row = conn.execute(
                "SELECT state FROM atoms WHERE id = ?", (atom_id,)
            ).fetchone()
            if not row or row["state"] not in ("active", "fading"):
                continue

            previous_state = row["state"]

            # Multiple signals or contradicted -> tombstone
            # Single signal -> dormant
            if len(signals) > 1 or "contradicted" in signals:
                new_state = "tombstone"
            else:
                new_state = "dormant"

            conn.execute(
                "UPDATE atoms SET state = ? WHERE id = ?",
                (new_state, atom_id),
            )
            log_forgetting(
                conn, atom_id, previous_state, new_state,
                f"intentional_forgetting: {', '.join(signals)}",
                {"signals": signals, "triggered_by": "forgetting_engine"},
            )
            actions_taken += 1

        conn.commit()

    conn.close()

    logger.info(
        f"forgetting_engine: {len(candidates)} candidates, "
        f"{actions_taken} actions taken (dry_run={dry_run}, mode={_mode})"
    )

    return {
        "total_candidates": len(candidates),
        "signal_counts": signal_counts,
        "candidates": candidates,
        "actions_taken": actions_taken,
    }
