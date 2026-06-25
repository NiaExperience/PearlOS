#!/usr/bin/env python3
"""Refresh PearlOS Agency OpenRouter roster metadata and model radar.

This script does not run benchmarks yet. Its primary job is frontier awareness:
detect new OpenRouter models, identify likely state-of-the-art or free-tier
candidates, and write durable roster/radar artifacts for Codex Agency Boss.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path("/workspace/nia-universal")
CONFIG_PATH = ROOT / "config/agency-swarm.json"
OUT_DIR = ROOT / ".agency/rosters"
REPORTS_DIR = Path("/workspace/user/Documents/Agency")
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"


def load_env_key() -> str:
    if os.getenv("OPENROUTER_API_KEY"):
        return os.environ["OPENROUTER_API_KEY"]
    for path in (
        ROOT / ".env.local",
        ROOT / "apps/interface/.env.local",
        ROOT / "apps/pipecat-daily-bot/.env",
        Path("/home/deploy/pearlos/apps/interface/.env.local"),
        Path("/home/deploy/pearlos/apps/pipecat-daily-bot/.env"),
    ):
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.startswith("OPENROUTER_API_KEY="):
                    continue
                return line.split("=", 1)[1].strip().strip("'\"")
        except OSError:
            continue
    return ""


def fetch_models(api_key: str) -> list[dict[str, Any]]:
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(OPENROUTER_MODELS_URL, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        body = json.loads(response.read().decode("utf-8"))
    return list(body.get("data") or [])


def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError:
        return default
    except json.JSONDecodeError:
        return default


def price_float(model: dict[str, Any], key: str) -> float:
    raw = ((model.get("pricing") or {}).get(key) or "0")
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0


def context_length(model: dict[str, Any]) -> int:
    try:
        return int(model.get("context_length") or 0)
    except (TypeError, ValueError):
        return 0


def family(model_id: str) -> str:
    return model_id.split("/", 1)[0] if "/" in model_id else model_id


def blended_price(model: dict[str, Any]) -> float:
    return price_float(model, "prompt") + price_float(model, "completion")


def is_frontier_candidate(model: dict[str, Any], radar: dict[str, Any]) -> bool:
    model_id = str(model.get("id") or "").lower()
    name = str(model.get("name") or "").lower()
    text = f"{model_id} {name}"
    patterns = [str(p).lower() for p in radar.get("frontierNamePatterns") or []]
    return any(pattern in text for pattern in patterns)


def is_affordable_candidate(model: dict[str, Any], core_price: float) -> bool:
    price = blended_price(model)
    if price <= 0:
        return True
    return price <= max(core_price * 1.25, 0.00000075) and context_length(model) >= 128000


def summarize_model(model: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(model.get("id") or ""),
        "name": str(model.get("name") or ""),
        "family": family(str(model.get("id") or "")),
        "contextLength": context_length(model),
        "promptPrice": price_float(model, "prompt"),
        "completionPrice": price_float(model, "completion"),
        "blendedPrice": blended_price(model),
    }


def role_fit(model: dict[str, Any], role: str) -> float:
    text = " ".join(
        str(model.get(k) or "") for k in ("id", "name", "description")
    ).lower()
    role_terms = {
        "director": r"gpt-5|opus|kimi|glm|gemini.*pro",
        "architect": r"coder|deepseek|qwen|gpt-5|glm",
        "implementer": r"coder|qwen|deepseek|gpt-5",
        "reviewer": r"glm|gpt-5|gemini|opus|sonnet",
        "qa": r"deepseek|qwen|glm|gpt-5",
        "adversary": r"grok|glm|gemini|opus",
        "historian": r"kimi|gemini|gpt-5|long|context",
        "synthesizer": r"gpt-5|kimi|glm|gemini.*pro",
        "researcher": r"kimi|gemini|gpt-5|perplexity|sonar",
        "source_checker": r"gemini|gpt-5|sonar|perplexity",
    }
    pattern = role_terms.get(role, r"gpt-5|kimi|glm|deepseek|qwen")
    return 1.0 if re.search(pattern, text) else 0.0


def score_model(model: dict[str, Any], role: str, preferred: set[str], deny: set[str]) -> float:
    model_id = str(model.get("id") or "")
    if not model_id or model_id in deny:
        return -1.0

    prompt_price = price_float(model, "prompt")
    completion_price = price_float(model, "completion")
    blended_price = prompt_price + completion_price
    ctx = context_length(model)

    score = 0.0
    score += 0.25 if family(model_id) in preferred else 0.0
    score += min(ctx / 200000.0, 0.25)
    score += role_fit(model, role) * 0.35
    if blended_price <= 0:
        score += 0.05
    elif blended_price < 0.000002:
        score += 0.15
    elif blended_price < 0.00001:
        score += 0.08
    else:
        score -= 0.1
    return round(score, 6)


def main() -> int:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    selection = config.get("modelSelection") or {}
    radar_cfg = selection.get("modelRadar") or {}
    core_model_id = ((selection.get("coreModel") or {}).get("id") or "").strip()
    preferred = set(selection.get("preferredFamilies") or [])
    deny = set(selection.get("denylist") or [])
    watched = set(radar_cfg.get("watchFamilies") or preferred)
    roles = sorted((config.get("rolePreferences") or {}).keys())

    previous_inventory = read_json(OUT_DIR / "openrouter-models.json", {})
    previous_models = previous_inventory.get("models") or []
    previous_by_id = {str(m.get("id") or ""): m for m in previous_models}

    models = fetch_models(load_env_key())
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if previous_models:
        (OUT_DIR / "openrouter-models.previous.json").write_text(
            json.dumps(previous_inventory, indent=2),
            encoding="utf-8",
        )

    inventory = {
        "generatedAt": now,
        "source": OPENROUTER_MODELS_URL,
        "modelCount": len(models),
        "models": models,
    }
    (OUT_DIR / "openrouter-models.json").write_text(
        json.dumps(inventory, indent=2),
        encoding="utf-8",
    )

    current_by_id = {str(m.get("id") or ""): m for m in models}
    new_ids = sorted(set(current_by_id) - set(previous_by_id))
    removed_ids = sorted(set(previous_by_id) - set(current_by_id))
    core_model = current_by_id.get(core_model_id, {})
    core_price = blended_price(core_model) if core_model else 0.0000005

    new_models = [current_by_id[mid] for mid in new_ids]
    watched_new = [
        summarize_model(model)
        for model in new_models
        if family(str(model.get("id") or "")) in watched
    ]
    frontier_new = [
        summarize_model(model)
        for model in new_models
        if is_frontier_candidate(model, radar_cfg)
    ]
    affordable_new = [
        summarize_model(model)
        for model in new_models
        if is_affordable_candidate(model, core_price)
    ]
    possible_core_upgrades = [
        item for item in affordable_new
        if item["family"] in {"deepseek", "qwen", "z-ai", "moonshotai", "google", "openai"}
    ][:20]

    radar = {
        "generatedAt": now,
        "source": OPENROUTER_MODELS_URL,
        "currentModelCount": len(models),
        "previousModelCount": len(previous_models),
        "newModelCount": len(new_ids),
        "removedModelCount": len(removed_ids),
        "coreModel": summarize_model(core_model) if core_model else {"id": core_model_id, "missing": True},
        "newModels": [summarize_model(current_by_id[mid]) for mid in new_ids],
        "removedModels": removed_ids,
        "watchedNewModels": watched_new,
        "frontierNewModels": frontier_new,
        "affordableNewModels": affordable_new,
        "possibleCoreUpgrades": possible_core_upgrades,
    }
    (OUT_DIR / "model-radar.json").write_text(
        json.dumps(radar, indent=2),
        encoding="utf-8",
    )

    recommendations: dict[str, Any] = {
        "generatedAt": now,
        "method": "metadata-first scoring; benchmark scores not yet included",
        "roles": {},
    }
    for role in roles:
        ranked = sorted(
            (
                {
                    "id": str(model.get("id") or ""),
                    "name": str(model.get("name") or ""),
                    "contextLength": context_length(model),
                    "promptPrice": price_float(model, "prompt"),
                    "completionPrice": price_float(model, "completion"),
                    "score": score_model(model, role, preferred, deny),
                }
                for model in models
            ),
            key=lambda item: item["score"],
            reverse=True,
        )
        recommendations["roles"][role] = [
            item for item in ranked if item["score"] > 0
        ][:10]

    (OUT_DIR / "recommended-swarms.json").write_text(
        json.dumps(recommendations, indent=2),
        encoding="utf-8",
    )
    report_path = Path(radar_cfg.get("reportPath") or (REPORTS_DIR / "model-radar.md"))
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(render_report(radar), encoding="utf-8")

    print(json.dumps({
        "ok": True,
        "generatedAt": now,
        "modelCount": len(models),
        "newModelCount": len(new_ids),
        "frontierNewModelCount": len(frontier_new),
        "possibleCoreUpgradeCount": len(possible_core_upgrades),
        "roles": roles,
        "outDir": str(OUT_DIR),
        "reportPath": str(report_path),
    }, indent=2))
    return 0


def render_table(items: list[dict[str, Any]], limit: int = 20) -> str:
    if not items:
        return "_None detected._\n"
    lines = ["| Model | Context | Blended price |", "| --- | ---: | ---: |"]
    for item in items[:limit]:
        lines.append(
            f"| `{item['id']}` | {item['contextLength']} | {item['blendedPrice']:.10f} |"
        )
    return "\n".join(lines) + "\n"


def render_report(radar: dict[str, Any]) -> str:
    core = radar.get("coreModel") or {}
    return "\n".join([
        "# PearlOS Agency Model Radar",
        "",
        f"Generated: {radar['generatedAt']}",
        "",
        "## Summary",
        "",
        f"- Current OpenRouter model count: {radar['currentModelCount']}",
        f"- New models since last radar run: {radar['newModelCount']}",
        f"- Removed models since last radar run: {radar['removedModelCount']}",
        f"- Frontier-looking new models: {len(radar['frontierNewModels'])}",
        f"- Possible core/free-tier upgrades: {len(radar['possibleCoreUpgrades'])}",
        "",
        "## Current Core Model",
        "",
        f"- `{core.get('id', 'unknown')}`",
        f"- Context: {core.get('contextLength', 'unknown')}",
        f"- Blended price: {core.get('blendedPrice', 'unknown')}",
        "",
        "## Frontier New Models",
        "",
        render_table(radar["frontierNewModels"]),
        "## Possible Core / Free-Tier Upgrades",
        "",
        render_table(radar["possibleCoreUpgrades"]),
        "## Watched New Models",
        "",
        render_table(radar["watchedNewModels"]),
        "## Removed Models",
        "",
        "\n".join(f"- `{mid}`" for mid in radar["removedModels"][:50]) or "_None detected._",
        "",
        "## Notes",
        "",
        "This radar is discovery-first. It flags model availability and likely role fit before benchmark evidence exists. Important candidates should be tested next, but they should be visible immediately.",
        "",
    ])


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        raise
