"""Functional prompt retrieval helpers for bot tooling.

These helpers wrap ``mesh_client.request`` to fetch FunctionalPrompt content
records that describe LLM tool behaviors.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Dict, List

from loguru import logger

# Ensure mesh_client import works when running inside actions package
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import mesh as mesh_client


async def fetch_functional_prompt(tool_key: str) -> str | None:
    """Fetch a single functional prompt by tool key (aka feature key)."""
    where = {"indexer": {"path": "featureKey", "equals": tool_key}}
    params = {
        "where": json.dumps(where, separators=(",", ":")),
        "limit": "1",
    }

    response = await mesh_client.request("GET", "/content/FunctionalPrompt", params=params)

    if not response.get("success"):
        logger.warning(
            f"[functional_prompt_actions] Failed to fetch prompt for {tool_key}: {response.get('error')}"
        )
        return None

    data = response.get("data")
    if isinstance(data, list) and data:
        prompt = data[0]
    elif isinstance(data, dict) and data:
        prompt = data
    else:
        logger.warning(
            f"[functional_prompt_actions] No functional prompt found for {tool_key}"
        )
        return None

    prompt_content = prompt.get("promptContent")
    if prompt_content:
        logger.info(
            f"[functional_prompt_actions] Loaded functional prompt for {tool_key} (len={len(prompt_content)})"
        )
        return prompt_content

    logger.warning(
        f"[functional_prompt_actions] Functional prompt for {tool_key} missing promptContent"
    )
    return None


async def fetch_functional_prompts(tool_keys: List[str]) -> Dict[str, str]:
    """Fetch functional prompts for the provided tool keys (aka feature keys) in a single request."""
    results: Dict[str, str] = {}
    if not tool_keys:
        return results

    # Deduplicate while preserving order
    deduped_keys = [k for k in dict.fromkeys(tool_keys) if k]

    # Build OR array with individual indexer conditions (Mesh API format)
    where = {
        "OR": [{"indexer": {"path": "featureKey", "equals": k}} for k in deduped_keys]
    }
    params = {
        "where": json.dumps(where, separators=(",", ":")),
        "limit": str(len(deduped_keys)),
    }

    try:
        response = await mesh_client.request("GET", "/content/FunctionalPrompt", params=params)

        if not response.get("success"):
            logger.warning(
                f"[functional_prompt_actions] Failed to fetch prompts: {response.get('error')}"
            )
            return results

        data = response.get("data") or []
        if isinstance(data, dict):
            data = [data]

        for prompt in data:
            if not isinstance(prompt, dict):
                continue

            prompt_content = prompt.get("promptContent")
            key = prompt.get("featureKey") or (prompt.get("indexer") or {}).get("featureKey")

            if key and prompt_content:
                results[key] = prompt_content
            else:
                reason = "missing featureKey" if not key else "missing promptContent"
                logger.warning(
                    f"[functional_prompt_actions] Skipping prompt record ({reason})"
                )

        logger.info(
            f"[functional_prompt_actions] Loaded {len(results)}/{len(deduped_keys)} functional prompts"
        )
        return results

    except Exception as exc:  # noqa: BLE001 - log unexpected errors
        logger.error(f"[functional_prompt_actions] Error fetching prompts: {exc}")
        raise


__all__ = [
    "fetch_functional_prompt",
    "fetch_functional_prompts",
]
