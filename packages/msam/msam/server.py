"""
MSAM REST API Server -- FastAPI + Uvicorn async HTTP interface.

This is SEPARATE from api.py (which serves Grafana metrics). This server
exposes the full MSAM pipeline (store, query, context, feedback, decay,
triples, contradictions, prediction, consolidation, replay) as a REST API.

Usage:
    msam serve                     # Start on default host/port from config
    msam serve --port 3001         # Override port
    msam serve --host 0.0.0.0      # Override host

    Or programmatically:
        from msam.server import run_server
        run_server(host="0.0.0.0", port=3001)

Auth:
    Set MSAM_API_KEY environment variable to require X-API-Key header.
    If unset, the server runs in open-access mode.

Endpoints:
    GET  /v1/health              Health check
    POST /v1/store               Store a memory atom
    POST /v1/query               Query memories (confidence-gated)
    POST /v1/context             Session startup context (parallel)
    POST /v1/feedback            Mark atom contributions
    POST /v1/decay               Run decay cycle
    GET  /v1/stats               Database statistics
    POST /v1/triples/extract     Extract triples
    GET  /v1/triples/graph/{e}   Graph traversal
    POST /v1/contradictions      Find contradictions
    POST /v1/predict             Predictive pre-retrieval
    POST /v1/consolidate         Sleep-based consolidation
    POST /v1/replay              Episodic replay
    POST /v1/agents/register     Register an agent
    GET  /v1/agents              List agents
    GET  /v1/agents/{id}/stats   Agent statistics
    POST /v1/agents/share        Share atom between agents
    POST /v1/forget              Intentional forgetting engine
    POST /v1/calibrate           Compare embedding providers
    POST /v1/re-embed            Re-embed atoms with new provider
"""

import os
import json
import time
import asyncio
import threading
from typing import Optional

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import get_config

_cfg = get_config()

# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(title="MSAM REST API", version="2026.02.22")

_allowed_origins = _cfg("api", "allowed_origins",
    ["http://127.0.0.1:3000", "http://localhost:3000"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Decay Lock (prevent concurrent decay runs) ──────────────────────────────

_decay_lock = asyncio.Lock()

# ─── Auth Dependency ──────────────────────────────────────────────────────────


async def verify_api_key(request: Request):
    """Optional API key authentication via FastAPI dependency injection."""
    api_key = os.environ.get("MSAM_API_KEY")
    if not api_key:
        return  # No key configured = open access
    provided = request.headers.get("X-API-Key", "")
    if provided != api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")


# ─── Pydantic Models ─────────────────────────────────────────────────────────

class StoreRequest(BaseModel):
    content: str
    stream: Optional[str] = None
    profile: Optional[str] = None
    use_llm_annotate: bool = False
    source_type: str = "api"
    metadata: Optional[dict] = None


class QueryRequest(BaseModel):
    query: str
    mode: str = "task"
    top_k: int = 12
    token_budget: int = 500


class ContextRequest(BaseModel):
    top_k: int = 5


class FeedbackRequest(BaseModel):
    atom_ids: list[str]
    response_text: str
    feedback: Optional[str] = None


class TriplesExtractRequest(BaseModel):
    atom_id: str
    content: str


class ContradictionsRequest(BaseModel):
    mode: str = "triples"
    threshold: float = 0.85


class PredictRequest(BaseModel):
    time_of_day: str = ""
    day_type: str = ""
    recent_topics: list[str] = Field(default_factory=list)
    last_session_topics: list[str] = Field(default_factory=list)
    user_active: bool = False


class ConsolidateRequest(BaseModel):
    dry_run: bool = False
    max_clusters: Optional[int] = None


class ReplayRequest(BaseModel):
    topic: str
    since: Optional[str] = None
    before: Optional[str] = None
    max_events: int = 50


class AgentRegisterRequest(BaseModel):
    agent_id: str
    name: Optional[str] = None
    metadata: Optional[dict] = None


class AgentShareRequest(BaseModel):
    atom_id: str
    from_agent: str
    to_agent: str


class ForgetRequest(BaseModel):
    dry_run: bool = True
    min_retrievals: Optional[int] = None
    contribution_threshold: Optional[float] = None
    contradiction_threshold: Optional[float] = None
    confidence_floor: Optional[float] = None
    grace_days: Optional[int] = None


class CalibrateRequest(BaseModel):
    target_provider: str
    queries: Optional[list[str]] = None
    top_k: int = 10


class ReEmbedRequest(BaseModel):
    target_provider: str
    batch_size: int = 50
    dry_run: bool = True


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_version():
    try:
        from . import __version__
        return __version__
    except (ImportError, AttributeError):
        return "unknown"


# ─── Health Check ─────────────────────────────────────────────────────────────

@app.get("/v1/health")
async def api_health():
    return {"status": "ok", "version": _get_version(), "timestamp": time.time()}


# ─── POST /v1/store ───────────────────────────────────────────────────────────

@app.post("/v1/store", dependencies=[Depends(verify_api_key)])
async def api_store(req: StoreRequest):
    def _store():
        from .annotate import smart_annotate, classify_stream, classify_profile
        from .core import store_atom

        stream = req.stream or classify_stream(req.content)
        profile = req.profile or classify_profile(req.content)
        annotations = smart_annotate(req.content, use_llm=req.use_llm_annotate)

        atom_id = store_atom(
            content=req.content, stream=stream, profile=profile,
            **annotations, source_type=req.source_type, metadata=req.metadata,
        )

        if atom_id is None:
            return {"stored": False, "atom_id": None, "stream": stream,
                    "profile": profile, "annotations": annotations,
                    "triples_extracted": 0, "reason": "duplicate content"}

        triples_extracted = 0
        if stream == "semantic":
            try:
                from .triples import extract_and_store
                triples_extracted = extract_and_store(atom_id, req.content)
            except Exception:
                pass

        return {"stored": True, "atom_id": atom_id, "stream": stream,
                "profile": profile, "annotations": annotations,
                "triples_extracted": triples_extracted}

    return await asyncio.to_thread(_store)


# ─── POST /v1/query ───────────────────────────────────────────────────────────

@app.post("/v1/query", dependencies=[Depends(verify_api_key)])
async def api_query(req: QueryRequest):
    def _query():
        from .triples import hybrid_retrieve_with_triples

        t0 = time.time()
        result = hybrid_retrieve_with_triples(req.query, mode=req.mode,
                                               token_budget=req.token_budget)
        latency_ms = (time.time() - t0) * 1000

        # Determine confidence tier
        raw_atoms = result.get("_raw_atoms", [])
        atom_results = list(raw_atoms)
        _tier_rank = {"none": 0, "low": 1, "medium": 2, "high": 3}

        if not raw_atoms and not result["triples"]:
            confidence_tier = "none"
        elif raw_atoms:
            best_tier = "none"
            for a in raw_atoms:
                t = a.get("_confidence_tier", "low")
                if _tier_rank.get(t, 0) > _tier_rank.get(best_tier, 0):
                    best_tier = t
            top_tier = raw_atoms[0].get("_retrieval_confidence_tier", best_tier)
            confidence_tier = best_tier if _tier_rank.get(best_tier, 0) >= _tier_rank.get(top_tier, 0) else top_tier
        elif result["triples"]:
            _temporal_markers = {'right now', 'today', 'currently', 'this session',
                                 'just now', 'this morning', 'tonight', 'earlier today'}
            is_temporal = any(m in req.query.lower() for m in _temporal_markers)
            confidence_tier = "low" if is_temporal or len(result["triples"]) < 10 else "medium"
        else:
            confidence_tier = "none"

        # Confidence-gated output volume
        gated = True
        gated_reason = None
        if confidence_tier == "none":
            result["triples"] = []
            atom_results = []
            gated_reason = "no data -- output suppressed"
        elif confidence_tier == "low":
            atom_results = atom_results[:1] if atom_results else []
            result["triples"] = []
            gated_reason = "low confidence -- output minimized (1 atom, no triples)"
        elif confidence_tier == "medium":
            _sim_low = _cfg('retrieval', 'confidence_sim_low', 0.15)
            atom_results = [a for a in atom_results if a.get("_similarity", 0) > _sim_low] or atom_results[:2]
            atom_results = atom_results[:3]
            result["triples"] = result["triples"][:8]
            gated_reason = "medium confidence -- pruned zero-sim atoms, capped triples at 8"
        elif confidence_tier == "high":
            good_atoms = [a for a in atom_results if a.get("_similarity", 0) > 0.10]
            if good_atoms:
                atom_results = good_atoms
            result["triples"] = result["triples"][:12]
            gated_reason = "high confidence -- pruned zero-sim atoms, capped triples at 12"

        output_triples = [
            {"subject": t["subject"], "predicate": t["predicate"], "object": t["object"]}
            for t in result["triples"]
        ]

        output_atoms = []
        for a in atom_results:
            topics = a.get("topics", [])
            if isinstance(topics, str):
                try:
                    topics = json.loads(topics)
                except (json.JSONDecodeError, TypeError):
                    topics = []
            output_atoms.append({
                "id": a["id"], "content": a["content"],
                "stream": a.get("stream", "semantic"),
                "similarity": round(a.get("_similarity", 0), 3),
                "score": round(a.get("_combined_score", a.get("_activation", 0)), 3),
                "confidence_tier": a.get("_confidence_tier", "unknown"),
                "topics": topics,
            })

        total_tokens = sum(len(a["content"]) // 4 for a in output_atoms)
        total_tokens += sum(
            len(f'{t["subject"]} {t["predicate"]} {t["object"]}') // 4
            for t in output_triples
        )

        response = {
            "query": req.query, "mode": req.mode,
            "confidence_tier": confidence_tier,
            "triples": output_triples, "atoms": output_atoms,
            "total_tokens": total_tokens,
            "items_returned": len(output_atoms) + len(output_triples),
            "query_type": result.get("query_type", "mixed"),
            "latency_ms": round(latency_ms, 2),
            "gated": gated, "gated_reason": gated_reason,
        }

        if confidence_tier == "none":
            response["confidence_advisory"] = "[NO_DATA] No reliable memory on this topic."
        elif confidence_tier == "low":
            response["confidence_advisory"] = (
                "[LOW_CONFIDENCE] Results exist but confidence is below threshold. "
                "Treat with caution."
            )
        return response

    return await asyncio.to_thread(_query)


# ─── POST /v1/context ─────────────────────────────────────────────────────────

@app.post("/v1/context", dependencies=[Depends(verify_api_key)])
async def api_context(req: ContextRequest = ContextRequest()):
    """Parallel context retrieval using asyncio.gather()."""
    from .core import dry_retrieve

    identity_q = _cfg('context', 'startup_identity_query', 'agent identity')
    user_q = _cfg('context', 'startup_user_query', 'user preferences')
    recent_q = _cfg('context', 'startup_recent_query', 'recent activity')
    emotional_q = _cfg('context', 'startup_emotional_query', 'emotional state')

    async def _retrieve_section(name, query):
        atoms = await asyncio.to_thread(dry_retrieve, query, "task", req.top_k)
        section_atoms = []
        for a in atoms:
            section_atoms.append({
                "id": a["id"], "content": a["content"],
                "stream": a.get("stream", "semantic"),
                "score": round(a.get("_activation", 0), 3),
            })
        return name, section_atoms

    # Run all 4 context queries in parallel
    results = await asyncio.gather(
        _retrieve_section("identity", identity_q),
        _retrieve_section("user", user_q),
        _retrieve_section("recent", recent_q),
        _retrieve_section("emotional", emotional_q),
    )

    sections = {name: atoms for name, atoms in results}
    total_tokens = sum(
        max(1, len(a["content"]) // 4)
        for section in sections.values() for a in section
    )

    return {
        "sections": sections,
        "total_tokens": total_tokens,
        "atom_count": sum(len(v) for v in sections.values()),
    }


# ─── POST /v1/feedback ────────────────────────────────────────────────────────

@app.post("/v1/feedback", dependencies=[Depends(verify_api_key)])
async def api_feedback(req: FeedbackRequest):
    def _feedback():
        from .core import mark_contributions
        return mark_contributions(req.atom_ids, req.response_text)
    return await asyncio.to_thread(_feedback)


# ─── POST /v1/decay ───────────────────────────────────────────────────────────

@app.post("/v1/decay", dependencies=[Depends(verify_api_key)])
async def api_decay():
    """Run decay cycle with lock to prevent concurrent runs."""
    async with _decay_lock:
        def _decay():
            from .decay import run_decay_cycle
            return run_decay_cycle()
        return await asyncio.to_thread(_decay)


# ─── GET /v1/stats ─────────────────────────────────────────────────────────────

@app.get("/v1/stats", dependencies=[Depends(verify_api_key)])
async def api_stats():
    def _stats():
        from .core import get_stats
        return get_stats()
    return await asyncio.to_thread(_stats)


# ─── POST /v1/triples/extract ─────────────────────────────────────────────────

@app.post("/v1/triples/extract", dependencies=[Depends(verify_api_key)])
async def api_triples_extract(req: TriplesExtractRequest):
    def _extract():
        from .triples import extract_and_store
        count = extract_and_store(req.atom_id, req.content)
        return {"atom_id": req.atom_id, "triples_extracted": count}
    return await asyncio.to_thread(_extract)


# ─── GET /v1/triples/graph/{entity} ───────────────────────────────────────────

@app.get("/v1/triples/graph/{entity}", dependencies=[Depends(verify_api_key)])
async def api_triples_graph(entity: str, max_hops: int = 3):
    def _graph():
        from .triples import graph_traverse
        return graph_traverse(entity, max_hops=max_hops)
    return await asyncio.to_thread(_graph)


# ─── POST /v1/contradictions ──────────────────────────────────────────────────

@app.post("/v1/contradictions", dependencies=[Depends(verify_api_key)])
async def api_contradictions(req: ContradictionsRequest = ContradictionsRequest()):
    def _contradictions():
        if req.mode == "semantic":
            from .contradictions import find_semantic_contradictions
            results = find_semantic_contradictions(threshold=req.threshold)
            return {"semantic_contradictions": results, "count": len(results)}
        else:
            from .triples import detect_contradictions
            results = detect_contradictions()
            return {"contradictions": results, "count": len(results)}
    return await asyncio.to_thread(_contradictions)


# ─── POST /v1/predict ─────────────────────────────────────────────────────────

@app.post("/v1/predict", dependencies=[Depends(verify_api_key)])
async def api_predict(req: PredictRequest = PredictRequest()):
    def _predict():
        from .core import predict_needed_atoms
        context = {
            "time_of_day": req.time_of_day, "day_type": req.day_type,
            "recent_topics": req.recent_topics,
            "last_session_topics": req.last_session_topics,
            "user_active": req.user_active,
        }
        predictions = predict_needed_atoms(context)
        return {"predictions": predictions, "count": len(predictions)}
    return await asyncio.to_thread(_predict)


# ─── POST /v1/consolidate ─────────────────────────────────────────────────────

@app.post("/v1/consolidate", dependencies=[Depends(verify_api_key)])
async def api_consolidate(req: ConsolidateRequest = ConsolidateRequest()):
    def _consolidate():
        from .consolidation import ConsolidationEngine
        engine = ConsolidationEngine()
        return engine.consolidate(dry_run=req.dry_run, max_clusters=req.max_clusters)
    return await asyncio.to_thread(_consolidate)


# ─── POST /v1/replay ──────────────────────────────────────────────────────────

@app.post("/v1/replay", dependencies=[Depends(verify_api_key)])
async def api_replay(req: ReplayRequest):
    def _replay():
        from .core import episodic_replay
        return episodic_replay(
            entity_or_topic=req.topic, since=req.since,
            before=req.before, max_events=req.max_events,
        )
    return await asyncio.to_thread(_replay)


# ─── POST /v1/forget ─────────────────────────────────────────────────────────

@app.post("/v1/forget", dependencies=[Depends(verify_api_key)])
async def api_forget(req: ForgetRequest = ForgetRequest()):
    """Identify and optionally act on forgetting candidates."""
    async with _decay_lock:
        def _forget():
            from .forgetting import identify_forgetting_candidates
            return identify_forgetting_candidates(
                dry_run=req.dry_run,
                min_retrievals=req.min_retrievals,
                contribution_threshold=req.contribution_threshold,
                contradiction_threshold=req.contradiction_threshold,
                confidence_floor=req.confidence_floor,
                grace_days=req.grace_days,
            )
        return await asyncio.to_thread(_forget)


# ─── POST /v1/calibrate ─────────────────────────────────────────────────────

@app.post("/v1/calibrate", dependencies=[Depends(verify_api_key)])
async def api_calibrate(req: CalibrateRequest):
    """Compare embedding rankings between current and target provider."""
    def _calibrate():
        from .calibration import calibrate
        return calibrate(
            req.target_provider,
            queries=req.queries,
            top_k=req.top_k,
        )
    return await asyncio.to_thread(_calibrate)


# ─── POST /v1/re-embed ──────────────────────────────────────────────────────

@app.post("/v1/re-embed", dependencies=[Depends(verify_api_key)])
async def api_reembed(req: ReEmbedRequest):
    """Re-embed all active atoms with a new provider."""
    async with _decay_lock:
        def _reembed():
            from .calibration import re_embed
            return re_embed(
                req.target_provider,
                batch_size=req.batch_size,
                dry_run=req.dry_run,
            )
        return await asyncio.to_thread(_reembed)


# ─── Multi-Agent ──────────────────────────────────────────────────────────────

@app.post("/v1/agents/register", dependencies=[Depends(verify_api_key)])
async def api_agents_register(req: AgentRegisterRequest):
    def _register():
        from .agents import register_agent
        return register_agent(agent_id=req.agent_id, name=req.name, metadata=req.metadata)
    return await asyncio.to_thread(_register)


@app.get("/v1/agents", dependencies=[Depends(verify_api_key)])
async def api_agents_list():
    def _list():
        from .agents import list_agents
        agents = list_agents()
        return {"agents": agents, "count": len(agents)}
    return await asyncio.to_thread(_list)


@app.get("/v1/agents/{agent_id}/stats", dependencies=[Depends(verify_api_key)])
async def api_agents_stats(agent_id: str):
    def _stats():
        from .agents import agent_stats
        return agent_stats(agent_id)
    return await asyncio.to_thread(_stats)


@app.post("/v1/agents/share", dependencies=[Depends(verify_api_key)])
async def api_agents_share(req: AgentShareRequest):
    def _share():
        from .agents import share_atom
        success = share_atom(req.atom_id, req.from_agent, req.to_agent)
        return {"shared": success, "atom_id": req.atom_id,
                "from": req.from_agent, "to": req.to_agent}
    return await asyncio.to_thread(_share)


# ─── Run Server ───────────────────────────────────────────────────────────────

def run_server(host=None, port=None):
    """Start the MSAM REST API server with uvicorn.

    Args:
        host: Bind address. Defaults to config [api] host or 127.0.0.1.
        port: Bind port. Defaults to config [api] port or 3001.
    """
    import uvicorn

    _host = host or _cfg('api', 'host', '127.0.0.1')
    _port = port or int(_cfg('api', 'port', 3001))

    print(f"MSAM REST API server starting on {_host}:{_port}")
    print(f"  Health check: http://{_host}:{_port}/v1/health")
    print(f"  API key: {'required' if os.environ.get('MSAM_API_KEY') else 'not required (open access)'}")
    print(f"  Version: {_get_version()}")
    print(f"  Server: uvicorn (async)")
    print()
    print("Endpoints:")
    print(f"  GET  /v1/health              Health check")
    print(f"  POST /v1/store               Store a memory atom")
    print(f"  POST /v1/query               Query memories")
    print(f"  POST /v1/context             Session startup context (parallel)")
    print(f"  POST /v1/feedback            Mark atom contributions")
    print(f"  POST /v1/decay               Run decay cycle")
    print(f"  GET  /v1/stats               Database statistics")
    print(f"  POST /v1/triples/extract     Extract triples")
    print(f"  GET  /v1/triples/graph/{{e}}   Graph traversal")
    print(f"  POST /v1/contradictions      Find contradictions")
    print(f"  POST /v1/predict             Predictive pre-retrieval")
    print(f"  POST /v1/consolidate         Sleep consolidation")
    print(f"  POST /v1/replay              Episodic replay")
    print(f"  POST /v1/agents/register     Register an agent")
    print(f"  GET  /v1/agents              List agents")
    print(f"  GET  /v1/agents/{{id}}/stats   Agent statistics")
    print(f"  POST /v1/agents/share        Share atom between agents")
    print(f"  POST /v1/forget              Intentional forgetting engine")
    print(f"  POST /v1/calibrate           Compare embedding providers")
    print(f"  POST /v1/re-embed            Re-embed atoms with new provider")
    print()

    uvicorn.run(app, host=_host, port=int(_port), log_level="info")


# ─── Direct execution ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    run_server()
