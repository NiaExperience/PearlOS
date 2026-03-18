"""
MSAM -- Multi-Stream Adaptive Memory

Cognitive memory system for AI agents. Stores knowledge as atoms across
semantic, episodic, and procedural streams with ACT-R-inspired activation
scoring, hybrid retrieval (atoms + knowledge graph triples), and adaptive
decay with contribution-based feedback.

Usage:
    from msam import store_atom, retrieve, hybrid_retrieve

    store_atom("User prefers dark mode")       # store an atom
    results = retrieve("preferences")          # semantic + keyword retrieval
    stats = get_stats()                        # database statistics
"""

__version__ = "2026.02.24"

from msam.core import (
    store_atom,
    retrieve,
    hybrid_retrieve,
    batch_cosine_similarity,
    get_stats,
    metamemory_query,
    store_working,
    expire_working_memory,
    dry_retrieve,
    retrieve_with_rewrite,
    retrieve_with_emotion,
    retrieve_diverse,
    score_context_quality,
    find_merge_candidates,
    merge_atoms,
    estimate_importance,
    detect_knowledge_gaps,
    predict_needed_atoms,
    store_session_boundary,
    get_associations,
    emotional_drift,
    episodic_replay,
    record_outcome,
    get_outcome_history,
)

from msam.triples import (
    extract_and_store as extract_triples,
    hybrid_retrieve_with_triples,
    retrieve_triples,
    graph_traverse,
    graph_path,
    detect_contradictions,
    get_triple_stats,
    query_world,
    update_world,
    world_history,
)

from msam.decay import run_decay_cycle
from msam.config import get_config, reload_config
from msam.annotate import smart_annotate, llm_annotate
from msam.contradictions import find_semantic_contradictions, check_before_store
from msam.prediction import PredictiveEngine
from msam.agents import register_agent, list_agents, share_atom, agent_stats
from msam.forgetting import identify_forgetting_candidates
from msam.calibration import calibrate, re_embed
from msam.metrics import record_agreement, get_agreement_rate
from msam.prediction import track_temporal_pattern, track_co_retrievals

__all__ = [
    "store_atom",
    "retrieve",
    "hybrid_retrieve",
    "batch_cosine_similarity",
    "get_stats",
    "metamemory_query",
    "store_working",
    "expire_working_memory",
    "dry_retrieve",
    "retrieve_with_rewrite",
    "retrieve_with_emotion",
    "retrieve_diverse",
    "score_context_quality",
    "find_merge_candidates",
    "merge_atoms",
    "estimate_importance",
    "detect_knowledge_gaps",
    "predict_needed_atoms",
    "store_session_boundary",
    "get_associations",
    "emotional_drift",
    "episodic_replay",
    "extract_triples",
    "hybrid_retrieve_with_triples",
    "retrieve_triples",
    "graph_traverse",
    "graph_path",
    "detect_contradictions",
    "get_triple_stats",
    "run_decay_cycle",
    "get_config",
    "reload_config",
    "smart_annotate",
    "llm_annotate",
    "find_semantic_contradictions",
    "check_before_store",
    "PredictiveEngine",
    "register_agent",
    "list_agents",
    "share_atom",
    "agent_stats",
    "identify_forgetting_candidates",
    "calibrate",
    "re_embed",
    "record_outcome",
    "get_outcome_history",
    "query_world",
    "update_world",
    "world_history",
    "record_agreement",
    "get_agreement_rate",
    "track_temporal_pattern",
    "track_co_retrievals",
]
