#!/usr/bin/env python3
"""llm-rankings-evaluator.py v3 — Weekly LLM rankings for PearlOS swarm dispatch.

Fetches models from OpenRouter, sends the exact ID list to GPT-5.4 to rank
per category, validates against the catalog. Output: /opt/pearlos/data/llm-rankings.json
"""
import json, os, sys, urllib.request
from datetime import datetime, timezone

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY",
    "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")
OUTPUT_PATH = "/opt/pearlos/data/llm-rankings.json"
CATEGORIES = ["code","creative","marketing","writing","finance","legal","math",
    "roleplay","news","research","science","technology","translation","health",
    "academia","trivia","speed","intelligence","design"]
EXCLUDE_PROVIDERS = ["anthropic"]

def fetch_models():
    req = urllib.request.Request("https://openrouter.ai/api/v1/models",
        headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "User-Agent": "PearlOS/3.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode()).get("data", [])

def filter_models(models):
    out = []
    for m in models:
        mid = m.get("id","")
        provider = mid.split("/")[0] if "/" in mid else ""
        if provider in EXCLUDE_PROVIDERS: continue
        if any(x in mid.lower() for x in [":free","auto","router","dummy","test"]): continue
        out.append(m)
    return out

def build_id_list(models):
    """Build a numbered list of model IDs for the prompt — no ambiguity."""
    lines = []
    for i, m in enumerate(models):
        lines.append(f"{i}: {m['id']}")
    return "\n".join(lines)

def dispatch_ranking(id_list, model_count):
    prompt = f"""You are ranking {model_count} LLMs for a task dispatch system. Below is a numbered list of every available model ID. For each of the 19 categories, pick the 10 best model IDs. Use ONLY IDs from this list — copy them exactly.

CATEGORIES: {', '.join(CATEGORIES)}

RULES:
- Every category MUST have exactly 10 entries
- For niche categories (health, finance, legal), use strong general-purpose models (GPT-5.4, Gemini Pro, DeepSeek R1, Grok, etc.)
- For "speed", pick the cheapest/fastest models (flash, lite, mini, nano, small)
- For "intelligence", pick the most capable frontier models
- Use your knowledge of benchmarks and real-world performance
- Output ONLY valid JSON — no markdown, no explanation

FORMAT:
{{"code": ["model/id", ...], "creative": ["model/id", ...], ...}}

MODEL IDS:
{id_list}"""

    body = json.dumps({"model": "openai/gpt-5.4-mini", "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 8192, "temperature": 0.1}).encode()
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=body,
        headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json",
            "HTTP-Referer": "https://pearlos.org", "X-Title": "PearlOS Rankings v3"})
    print("Dispatching to GPT-5.4-mini for ranking...")
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read().decode())
    content = data["choices"][0]["message"]["content"].strip()
    if content.startswith("```"): content = content.split("\n",1)[1]
    if content.endswith("```"): content = content[:-3]
    return json.loads(content.strip())

def validate(rankings, models):
    available = {m["id"] for m in models}
    lookup = {m["id"]: m for m in models}
    validated = {}
    for cat in CATEGORIES:
        entries = []
        for mid in rankings.get(cat, []):
            if mid in available:
                m = lookup[mid]
                entries.append({"id": mid, "name": m.get("name", mid), "score": 10 - len(entries),
                    "context_length": m.get("context_length", 0),
                    "cost_per_1k_input": round(float(m.get("pricing",{}).get("prompt","0")) * 1000, 6),
                    "cost_per_1k_output": round(float(m.get("pricing",{}).get("completion","0")) * 1000, 6)})
            else:
                print(f"  MISS: {cat} → {mid}")
            if len(entries) >= 10: break
        validated[cat] = entries
        print(f"  {cat}: {len(entries)}/10")
    return validated

def main():
    print("LLM Rankings Evaluator v3")
    models = fetch_models()
    print(f"Fetched {len(models)} models")
    eligible = filter_models(models)
    print(f"Eligible: {len(eligible)}")
    id_list = build_id_list(eligible)
    raw = dispatch_ranking(id_list, len(eligible))
    print(f"Got rankings for {len(raw)} categories")
    rankings = validate(raw, eligible)
    output = {"generated_at": datetime.now(timezone.utc).isoformat(), "model_count": len(models),
        "eligible_count": len(eligible), "method": "gpt-5.4-mini-exact-ids-v3",
        "categories": list(rankings.keys()), "rankings": rankings}
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f: json.dump(output, f, indent=2)
    total = sum(len(v) for v in rankings.values())
    print(f"\nDone: {total} entries across {len(rankings)} categories → {OUTPUT_PATH}")

if __name__ == "__main__": main()
