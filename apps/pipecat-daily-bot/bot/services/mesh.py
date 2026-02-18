"""Prism Mesh API client utilities for the Pipecat Daily bot.

Environment variables used:
  MESH_API_ENDPOINT          Base URL to Mesh API root (e.g. http://localhost:3000/api)
                             May also be provided as MESH_API_URL (fallback)
  MESH_SHARED_SECRET         Shared service secret for header x-mesh-secret
  BOT_CONTROL_SHARED_SECRET  Bot control secret for header x-bot-control-secret

Currently implemented helpers focus on Personality content and Note operations.

Example:
>>> from mesh_client import fetch_personalities
>>> items = fetch_personalities(tenant_id="tenant-123")
"""
from __future__ import annotations

import json
import os
from typing import Any

import aiohttp

from tools.logging_utils import bind_context_logger


def _log():
    """Return a context-bound logger on demand to pick up latest env/session context."""
    return bind_context_logger(tag="[mesh]")

_DEFAULT_TIMEOUT_SECS = 10

class MeshClientError(RuntimeError):
    pass


def _base_url() -> str:
    raw = os.getenv("MESH_API_ENDPOINT")
    if not raw:
        raise MeshClientError("Missing MESH_API_ENDPOINT environment variable")
    return raw.strip().rstrip("/")


def _graphql_url() -> str:
    """Get GraphQL endpoint URL (falls back to deriving from MESH_API_ENDPOINT)."""
    # Prefer MESH_ENDPOINT if set (points directly to GraphQL)
    raw = os.getenv("MESH_ENDPOINT")
    if raw:
        return raw.strip().rstrip("/")
    
    # Fallback: derive from MESH_API_ENDPOINT by removing /api and adding /graphql
    base = _base_url()
    if base.endswith("/api"):
        return base[:-4] + "/graphql"
    return base + "/graphql"


def _secret() -> str | None:
    secret = os.getenv("MESH_SHARED_SECRET")
    return secret.strip() if secret else None


def _bot_control_secret() -> str | None:
    secret = os.getenv("BOT_CONTROL_SHARED_SECRET")
    return secret.strip() if secret else None


def _preview(value: Any, max_len: int = 200) -> str | None:
    """Return a compact, stringified preview for logging."""
    if value is None:
        return None
    try:
        text = value if isinstance(value, str) else json.dumps(value)
    except Exception:
        text = str(value)
    if len(text) > max_len:
        return text[: max_len - 3] + "..."
    return text


def _extract_data_summary(parsed: Any) -> dict[str, Any]:
    """Derive lightweight response metadata without logging bulky payloads."""
    summary: dict[str, Any] = {
        "success": None,
        "total": None,
        "has_more": None,
        "data_kind": None,
        "data_count": None,
        "ids_preview": None,
        "error": None,
    }

    if not isinstance(parsed, dict):
        return summary

    summary["success"] = parsed.get("success")
    summary["total"] = parsed.get("total")
    summary["has_more"] = parsed.get("hasMore")
    summary["error"] = parsed.get("error")

    data = parsed.get("data")
    if isinstance(data, list):
        summary["data_kind"] = "list"
        summary["data_count"] = len(data)
        summary["ids_preview"] = _extract_ids(data)
    elif isinstance(data, dict):
        summary["data_kind"] = "dict"
        summary["data_count"] = 1
        summary["ids_preview"] = _extract_ids([data])

    return summary


def _extract_ids(items: list[Any]) -> list[str] | None:
    """Collect up to three identifier fields from list/dict payloads."""
    ids: list[str] = []
    for item in items[:3]:
        if not isinstance(item, dict):
            continue
        candidate = item.get("_id") or item.get("id") or item.get("page_id")
        if candidate:
            ids.append(str(candidate))
    return ids or None


def _headers() -> dict[str, str]:
    """Return headers with dual-secret authentication for service-level access.
    
    Includes both MESH_SHARED_SECRET and BOT_CONTROL_SHARED_SECRET for
    tenant-wide note access without user-specific permission checks.
    """
    h: dict[str, str] = {"Accept": "application/json"}
    
    # MESH_SHARED_SECRET: Service-level auth (existing)
    mesh_secret = _secret()
    if mesh_secret:
        h["x-mesh-secret"] = mesh_secret
    
    # BOT_CONTROL_SHARED_SECRET: Bot service auth (existing, extends to mesh)
    bot_control_secret = _bot_control_secret()
    if bot_control_secret:
        h["x-bot-control-secret"] = bot_control_secret
    
    return h


def _securely_label(headers: dict[str, str]) -> str:
    return "[dual-secret auth]" if (
        "x-mesh-secret" in headers and "x-bot-control-secret" in headers
    ) else "[no-auth]"


async def _handle_response(request_log: Any, method: str, url: str, resp: aiohttp.ClientResponse) -> Any:
    txt = await resp.text()
    content_preview = _preview(txt)

    parsed = None
    parse_error = None
    if txt:
        try:
            parsed = json.loads(txt)
        except json.JSONDecodeError as exc:
            parse_error = str(exc)

    summary = _extract_data_summary(parsed)

    request_log.warning(
        "mesh response",
        method=method,
        url=url,
        status=resp.status,
        success=summary["success"],
        total=summary["total"],
        has_more=summary["has_more"],
        error=summary["error"] or parse_error,
        data_kind=summary["data_kind"],
        data_count=summary["data_count"],
        ids_preview=summary["ids_preview"],
        content_preview=content_preview,
        content_length=len(txt) if txt else 0,
        content_type=resp.headers.get("Content-Type"),
    )

    if resp.status >= 400:
        raise MeshClientError(f"Mesh {method} {url} failed {resp.status}: {txt[:200]}")
    if not txt:
        return None
    if parsed is not None:
        return parsed
    raise MeshClientError(f"Invalid JSON from Mesh: {txt[:120]}")


async def _handle_graphql_response(graphql_url: str, resp: aiohttp.ClientResponse) -> dict[str, Any]:
    txt = await resp.text()
    _log().warning("graphql response", url=graphql_url, status=resp.status)

    if resp.status >= 400:
        raise MeshClientError(f"GraphQL request failed {resp.status}: {txt[:200]}")

    if not txt:
        return {"data": None}

    try:
        return json.loads(txt)
    except json.JSONDecodeError:
        raise MeshClientError(f"Invalid JSON from GraphQL: {txt[:120]}") from None

async def _request_json(
    session: aiohttp.ClientSession, 
    method: str, 
    path: str, 
    *, 
    params: dict[str, str] | None = None,
    json_body: dict[str, Any] | None = None
) -> Any:
    """Make HTTP request to Mesh API and return JSON response.
    
    Args:
        session: aiohttp session
        method: HTTP method (GET, POST, PUT, DELETE, etc.)
        path: API path (relative to base URL)
        params: Optional query parameters
        json_body: Optional JSON body for POST/PUT requests
        
    Returns:
        Parsed JSON response or None if empty
    """
    url = f"{_base_url()}{path}" if path.startswith('/') else f"{_base_url()}/{path}"
    try:
        headers = _headers()
        securely = _securely_label(headers)
        request_log = _log().bind(method=method, url=url)
        request_log.debug(
            "calling mesh",
            auth=securely,
            params=_preview(params),
            body=_preview(json_body),
        )
        
        request_kwargs = {
            "headers": headers,
            "params": params,
            "timeout": _DEFAULT_TIMEOUT_SECS
        }
        
        if json_body is not None:
            request_kwargs["json"] = json_body
            
        async with session.request(method, url, **request_kwargs) as resp:
            return await _handle_response(request_log, method, url, resp)
    except aiohttp.ClientError as e:
        raise MeshClientError(f"Mesh request error: {e}") from e


async def request(
    method: str,
    path: str,
    params: dict[str, str] | None = None,
    json_body: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Execute HTTP request to Mesh API with normalized response.
    
    This is the primary public interface for actions layer to use.
    Returns normalized responses from Mesh content API.
    
    Args:
        method: HTTP method ("GET", "POST", "PUT", "DELETE")
        path: API path (e.g., "/content/Notes", "/content/UserProfile")
        params: Query parameters (e.g., {"tenant": "...", "where": "...", "limit": "100"})
        json_body: Request body for POST/PUT operations
        
    Returns:
        Normalized response dict:
        {
            "success": bool,
            "data": any,           # Response data (list or dict)
            "total": int,          # Optional: total count
            "hasMore": bool,       # Optional: pagination flag
            "error": str           # Optional: error message (if success=False)
        }
        
    Example:
        >>> response = await request("GET", "/content/Notes", params={"tenant": "123", "limit": "10"})
        >>> if response["success"]:
        ...     notes = response["data"]
    """
    request_log = _log().bind(method=method, path=path)
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=_DEFAULT_TIMEOUT_SECS)) as session:
        try:
            result = await _request_json(session, method, path, params=params, json_body=json_body)
            
            # Mesh content API already returns {success, data, total, hasMore}
            # If result is valid, return as-is (already normalized)
            if result and isinstance(result, dict):
                # Ensure "success" field exists (default to True if data returned)
                if "success" not in result:
                    result["success"] = True
                return result
            
            # Fallback for empty/invalid responses
            request_log.debug("invalid mesh response", response=result)
            return {"success": False, "error": "Invalid response from Mesh API"}
            
        except MeshClientError as e:
            request_log.error("mesh request failed", error=str(e))
            return {"success": False, "error": str(e)}
        except Exception as e:
            request_log.error("mesh unexpected error", error=str(e), exc_info=True)
            return {"success": False, "error": f"Unexpected error: {e}"}


async def graphql_request(
    query: str,
    variables: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Execute GraphQL request to Mesh GraphQL endpoint.
    
    This function uses MESH_ENDPOINT (or derives GraphQL URL from MESH_API_ENDPOINT)
    to call the GraphQL server directly, bypassing the REST API path structure.
    
    Args:
        query: GraphQL query or mutation string
        variables: Optional variables for the GraphQL operation
        
    Returns:
        GraphQL response with 'data' and potentially 'errors' fields
        
    Example:
        >>> response = await graphql_request(
        ...     query='query GetUser($id: ID!) { user(where: { _id: { equals: $id } }) { _id name } }',
        ...     variables={'id': 'user-123'}
        ... )
        >>> user = response.get('data', {}).get('user')
    """
    graphql_url = _graphql_url()
    
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=_DEFAULT_TIMEOUT_SECS)) as session:
        try:
            headers = _headers()
            headers["Content-Type"] = "application/json"
            
            securely = _securely_label(headers)
            
            payload = {"query": query}
            if variables:
                payload["variables"] = variables
            
            _log().warning(f"Calling GraphQL {graphql_url} with query: {query[:100]}... {securely}")
            
            async with session.post(
                graphql_url,
                headers=headers,
                json=payload,
                timeout=_DEFAULT_TIMEOUT_SECS
            ) as resp:
                return await _handle_graphql_response(graphql_url, resp)
                    
        except aiohttp.ClientError as e:
            raise MeshClientError(f"GraphQL request error: {e}") from e
        except Exception as e:
            _log().error(f"[mesh_client] Unexpected GraphQL error: {e}", exc_info=True)
            raise MeshClientError(f"Unexpected GraphQL error: {e}") from e


__all__ = [
    'MeshClientError',
    'request',  # ✅ Generic HTTP client for REST API actions layer
    'graphql_request',  # ✅ GraphQL client for sharing_actions layer
]

