"""
MSAM Config -- Central configuration loader.

Config search order:
  1. $MSAM_CONFIG (explicit path to msam.toml)
  2. $MSAM_DATA_DIR/msam.toml (explicit data directory)
  3. ~/.msam/msam.toml (user-level config)
  4. <package_dir>/msam.toml (legacy, in-place development)

Data directory (for DB, caches) uses:
  1. $MSAM_DATA_DIR (explicit)
  2. ~/.msam/ (default)

Singleton: loads once on first import.

Usage:
    from msam.config import get_config
    cfg = get_config()
    value = cfg('section', 'key', default=fallback)
    # or:
    value = cfg('section', 'key')  # raises KeyError if not found
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

# Python 3.11+ has tomllib in stdlib
try:
    import tomllib
except ImportError:
    try:
        import tomli as tomllib  # fallback: pip install tomli
    except ImportError:
        tomllib = None

# ─── Hardcoded Defaults (current production values) ──────────────
# These mirror msam.toml exactly. Update both if you change a dial.

_DEFAULTS = {
    "embedding": {
        "provider": "nvidia-nim",
        "url": "https://integrate.api.nvidia.com/v1/embeddings",
        "model": "nvidia/nv-embedqa-e5-v5",
        "dimensions": 1024,
        "max_input_chars": 2000,
        "timeout_seconds": 10,
        "api_key": None,
        "api_key_env": "OPENAI_API_KEY",
        "batch_size": 50,
    },
    "storage": {
        "db_path": "msam.db",
        "metrics_db_path": "msam_metrics.db",
        "token_budget_ceiling": 40000,
        "auto_compact_threshold_pct": 85,
        "db_busy_timeout_ms": 5000,
        "refuse_threshold_pct": 95,
    },
    "retrieval": {
        "default_top_k": 12,
        "semantic_weight": 0.7,
        "similarity_threshold": 0.2,
        "sigmoid_midpoint": 0.35,
        "sigmoid_steepness": 15.0,
        "base_activation_cap": 3.0,
        "quality_threshold": 2.0,
        "context_quality_floor": 0.15,
        "mmr_lambda": 0.7,
        "keyword_top_k": 10,
        "spreading_activation_enabled": True,
        "max_spread_hops": 2,
        "spread_decay_factor": 0.3,
        "confidence_sim_high": 0.45,
        "confidence_sim_medium": 0.30,
        "confidence_sim_low": 0.15,
        "confidence_score_high": 40.0,
        "confidence_score_medium": 10.0,
        "temporal_recency_hours": 24,
        # Felt Consequence (outcome attribution)
        "outcome_weight": 0.15,
        "outcome_decay": 0.95,
        "min_outcomes_for_effect": 3,
    },
    "decay": {
        "active_to_fading_threshold": 0.3,
        "fading_to_dormant_threshold": 0.1,
        "confidence_decay_rate": 0.01,
        "confidence_decay_grace_days": 7,
        "confidence_floor": 0.1,
        "stability_dampen_factor": 0.9,
        "stability_boost_factor": 1.1,
        "max_stability": 10.0,
        "intentional_forgetting_enabled": False,
        "intentional_forgetting_mode": "flag",  # "flag" | "auto"
        "forgetting_contribution_threshold": 0.15,
        "forgetting_min_retrievals": 5,
        "forgetting_contradiction_threshold": 0.85,
        "forgetting_confidence_floor": 0.1,
        "forgetting_grace_days": 14,
        "protection_days": 7,
        "compaction_full_min_age_days": 7,
        "compaction_full_max_access": 3,
        "compaction_standard_min_age_days": 14,
        "compaction_standard_max_access": 2,
        "compaction_trigger_ratio": 1.5,
        "profile_target_lightweight_chars": 90,
        "profile_target_standard_chars": 240,
    },
    "working_memory": {
        "default_ttl_minutes": 120,
        "promotion_threshold": 3,
        "default_profile": "lightweight",
    },
    "atoms": {
        "default_profile": "standard",
        "default_encoding_confidence": 0.7,
        "default_arousal": 0.5,
        "default_valence": 0.0,
        "profile_lightweight_max_words": 20,
        "profile_full_min_words": 80,
    },
    "merge": {
        "similarity_threshold": 0.85,
        "max_candidates": 20,
    },
    "vector_index": {
        "approx_threshold": 50000,
    },
    "consolidation": {
        "similarity_threshold": 0.80,
        "min_cluster_size": 3,
        "max_clusters_per_run": 50,
        "stability_reduction_factor": 0.5,
    },
    "negative_knowledge": {
        "default_ttl_hours": 168,
    },
    "annotation": {
        "llm_url": "https://integrate.api.nvidia.com/v1/chat/completions",
        "llm_model": "mistralai/mistral-large-3-675b-instruct-2512",
        "timeout_seconds": 15,
    },
    "emotional_context": {
        "urgency_recency_bonus": 1.0,
        "negative_valence_support_bonus": 0.5,
        "low_arousal_depth_bonus": 0.5,
        "high_arousal_recent_bonus": 0.3,
    },
    "relations": {
        "supersedes_demotion": 2.0,
        "supports_bonus": 0.5,
    },
    "entity_resolution": {
        "aliases": {
            "user_nick": "user",
            
            "agent_nick": "agent",
            
            
        },
    },
    "query_expansion": {
        "synonyms": {
            "profession": ["job", "career", "work", "occupation"],
            "show": ["performance", "tour", "concert"],
            "anime": ["manga", "japanese animation"],
            "music": ["songs", "playlist", "listening"],
            "schedule": ["routine", "calendar", "plan", "timetable"],
            "home": ["hometown", "residence", "where lives", "based"],
            "family": ["parents", "siblings", "relatives"],
            "feelings": ["emotions", "mood", "emotional state"],
            "memory": ["remember", "recall", "memories", "msam"],
        },
    },
    "retrieval_v2": {
        "enabled": True,
        # Beam search control:
        # "auto" = dynamic gate based on atom count (default, recommended)
        # True   = always on (manual override)
        # False  = always off (manual override)
        "enable_beam_search": "auto",
        "beam_search_atom_threshold": 10000,  # dynamic gate: beam search activates above this
        "beam_width": 3,  # number of retrieval beams when active
        "enable_rewrite": True,
        "enable_query_expansion": True,
        "enable_triple_augment": True,
        "enable_entity_roles": True,
        "enable_quality_filter": True,
        "enable_temporal": True,
        "enable_rerank": False,  # LLM rerank off by default (latency)
        "enable_feedback": True,
        "max_expansion_terms": 5,
        "rerank_model": "mistralai/mistral-large-3-675b-instruct-2512",
        "entity_mappings": None,
    },
    "predictive_retrieval": {
        "user_active": True,
    },
    "prediction": {
        "temporal_weight": 0.4,
        "coretrieval_weight": 0.4,
        "momentum_weight": 0.2,
        "lookback_days": 30,
        "min_confidence": 0.3,
        # Predictive Context Assembly
        "enabled": True,
        "temporal_window_hours": 2,
        "min_pattern_count": 5,
        "co_retrieval_threshold": 3,
        "max_predicted_atoms": 8,
        "warmup_sessions": 50,
    },
    "context": {
        "default_token_budget": 500,
        "default_top_k": 10,
        "probe_token_budget": 200,
        "probe_top_k": 5,
        "startup_identity_query": "agent identity core traits personality",
        "startup_user_query": "user preferences relationship current situation",
        "startup_recent_query": "what happened today recent activity",
        "startup_emotional_query": "emotional state mood current feeling",
        "probe_queries": ["user current situation schedule", "agent identity personality traits"],
        "probe_atom_queries": ["What is the user's profession?", "Who is the agent?"],
        "emotional_state_file": "memory/context/emotional-state.md",
    },
    "agents": {
        "default_agent_id": "default",
        "enable_sharing": True,
    },
    "compression": {
        "enable_subatom": True,
        "enable_fact_dedup": True,
        "enable_synthesis": False,
        "subatom_token_budget": 120,
        "subatom_section_budget": 30,
        "sentence_similarity_threshold": 0.25,
        "dedup_similarity_threshold": 0.85,
        "synthesis_max_tokens": 30,
        "synthesis_model": "mistralai/mistral-large-3-675b-instruct-2512",
    },
    "comparison": {
        "startup_files": [],
        "query_files": [],
    },
    "triples": {
        "llm_url": "https://integrate.api.nvidia.com/v1/chat/completions",
        "llm_model": "mistralai/mistral-large-3-675b-instruct-2512",
    },
    "api": {
        "port": 3001,
        "host": "127.0.0.1",
        "allowed_origins": ["http://127.0.0.1:3000", "http://localhost:3000"],
        "api_key": None,
    },
    "metrics": {
        "enabled": True,
        "log_access_events": True,
        "log_emotional_state": True,
        "hybrid_probe_on_snapshot": True,
        "default_emotional_intensity": 0.5,
        "default_emotional_warmth": 0.5,
        "continuity_history_limit": 100,
        "retrieval_history_limit": 100,
    },
    "world_model": {
        "enabled": True,
        "auto_close_on_conflict": True,
        "temporal_extraction": True,
        "default_confidence": 1.0,
    },
    "sycophancy": {
        "tracking_enabled": True,
        "warning_threshold": 0.85,
        "window_size": 20,
    },
}


# ─── Singleton State ──────────────────────────────────────────────

_config = None
_config_loaded = False


def _deep_merge(base: dict, override: dict) -> dict:
    """Merge override into base, recursively for nested dicts."""
    result = dict(base)
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result


def get_data_dir() -> Path:
    """Return the MSAM data directory, creating it if needed.

    Resolution order:
      1. $MSAM_DATA_DIR (explicit override)
      2. ~/.msam/ (default user-level directory)
    """
    env = os.environ.get("MSAM_DATA_DIR")
    if env:
        data_dir = Path(env)
    else:
        data_dir = Path.home() / ".msam"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def _find_toml() -> Optional[Path]:
    """Locate msam.toml using the search order.

    1. $MSAM_CONFIG (explicit path)
    2. $MSAM_DATA_DIR/msam.toml
    3. ~/.msam/msam.toml
    4. <package_dir>/msam.toml (legacy / development)
    """
    # 1. Explicit config path
    env_config = os.environ.get("MSAM_CONFIG")
    if env_config:
        p = Path(env_config)
        if p.exists():
            return p

    # 2. Explicit data dir
    env_data = os.environ.get("MSAM_DATA_DIR")
    if env_data:
        p = Path(env_data) / "msam.toml"
        if p.exists():
            return p

    # 3. User-level config
    p = Path.home() / ".msam" / "msam.toml"
    if p.exists():
        return p

    # 4. Legacy in-package config (development mode)
    p = Path(__file__).parent / "msam.toml"
    if p.exists():
        return p

    return None


def _load_config() -> dict:
    """Load configuration from msam.toml, falling back to defaults."""
    global _config, _config_loaded

    if _config_loaded:
        return _config

    config = dict(_DEFAULTS)

    toml_path = _find_toml()

    if toml_path is None:
        import logging
        logging.getLogger("msam.config").info(
            "No msam.toml found. Searched: $MSAM_CONFIG, $MSAM_DATA_DIR, "
            "~/.msam/msam.toml, <package>/msam.toml. Using defaults. "
            "Copy msam.example.toml to ~/.msam/msam.toml to configure."
        )

    if toml_path is not None and tomllib is not None:
        try:
            with open(toml_path, "rb") as f:
                toml_data = tomllib.load(f)
            config = _deep_merge(config, toml_data)
        except Exception as e:
            import logging
            logging.getLogger("msam.config").warning(
                f"Failed to load {toml_path}: {e}. Using defaults."
            )
    elif toml_path is not None and tomllib is None:
        import logging
        logging.getLogger("msam.config").warning(
            "msam.toml found but tomllib unavailable (Python < 3.11 and no tomli installed). "
            "Using defaults."
        )

    _config = config
    _config_loaded = True
    return _config


def get_config():
    """Return the config accessor function.

    The returned callable accepts (section, key, default=_SENTINEL):
        cfg = get_config()
        val = cfg('embedding', 'url')              # raises if missing
        val = cfg('embedding', 'url', 'fallback')  # returns fallback if missing

    For nested sections (entity_resolution.aliases, etc.) use:
        aliases = cfg('entity_resolution', 'aliases', {})
    """
    config = _load_config()

    _SENTINEL = object()

    def accessor(section, key, default=_SENTINEL):
        sec = config.get(section, {})
        if key in sec:
            return sec[key]
        if default is not _SENTINEL:
            return default
        raise KeyError(f"Config key not found: [{section}] {key}")

    return accessor


def reload_config():
    """Force reload config from disk (useful for testing)."""
    global _config, _config_loaded
    _config = None
    _config_loaded = False
    return get_config()


def get_raw_config() -> dict:
    """Return the full config dict (for debugging)."""
    return _load_config()


# ─── Convenience: direct attribute access ────────────────────────

if __name__ == "__main__":
    import json
    cfg = get_config()
    raw = get_raw_config()
    print(json.dumps(raw, indent=2, default=str))
