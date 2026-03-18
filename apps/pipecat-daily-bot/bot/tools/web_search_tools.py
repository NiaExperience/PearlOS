"""Web search and fetch tools for Pearl voice sessions.

Provides bot_web_search (Brave Search API) and bot_web_fetch (URL content extraction)
so Pearl can look things up and read web pages during voice conversations.
"""

from __future__ import annotations

import ipaddress
import os
import re
import socket
from urllib.parse import urlparse

try:
    import aiohttp
except ImportError:
    aiohttp = None  # type: ignore

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger

BRAVE_API_KEY = os.environ.get("BRAVE_API_KEY", "")
BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"


def _validate_url(url: str) -> str | None:
    """Validate URL for safety. Returns error message if invalid, None if OK."""
    try:
        parsed = urlparse(url)
    except Exception:
        return "Invalid URL format."

    # Only allow http and https schemes
    if parsed.scheme not in ("http", "https"):
        return f"Unsupported URL scheme: {parsed.scheme}. Only http/https allowed."

    if not parsed.hostname:
        return "URL has no hostname."

    hostname = parsed.hostname.lower()

    # Block obvious internal/metadata hostnames
    _blocked_hosts = {
        "localhost", "127.0.0.1", "0.0.0.0", "::1",
        "metadata.google.internal", "metadata.google",
        "169.254.169.254",  # Cloud metadata endpoint
    }
    if hostname in _blocked_hosts:
        return "Access to internal/metadata hosts is not allowed."

    # Resolve hostname and check for private/reserved IPs
    try:
        resolved = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
        for family, _, _, _, sockaddr in resolved:
            ip_str = sockaddr[0]
            ip = ipaddress.ip_address(ip_str)
            if ip.is_private or ip.is_reserved or ip.is_loopback or ip.is_link_local:
                return "Access to private/internal network addresses is not allowed."
    except socket.gaierror:
        return f"Could not resolve hostname: {hostname}"

    return None


@bot_tool(
    name="bot_web_search",
    description=(
        "Search the web for current information. Use when the user asks about recent events, "
        "news, facts, products, people, or anything that requires up-to-date knowledge. "
        "Returns titles, URLs, and snippets from web search results."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query (e.g., 'latest iPhone release date', 'weather in Tokyo')",
            },
            "count": {
                "type": "integer",
                "description": "Number of results to return (1-10, default 5)",
            },
        },
        "required": ["query"],
    },
)
async def bot_web_search(params: FunctionCallParams):
    """Search the web using Brave Search API."""
    log = bind_tool_logger(params, tag="[bot_web_search]")
    arguments = params.arguments

    query = (arguments.get("query") or "").strip()
    count = min(max(int(arguments.get("count", 5)), 1), 10)

    if not query:
        await params.result_callback(
            {"success": False, "error": "A search query is required."},
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    if aiohttp is None:
        await params.result_callback(
            {"success": False, "error": "aiohttp not available"},
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    log.info("bot_web_search invoked", query=query, count=count)

    try:
        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": BRAVE_API_KEY,
        }
        params_qs = {"q": query, "count": str(count)}

        async with aiohttp.ClientSession() as session:
            async with session.get(BRAVE_SEARCH_URL, headers=headers, params=params_qs, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    log.error("Brave search failed", status=resp.status, body=text[:200])
                    await params.result_callback(
                        {"success": False, "error": f"Search API returned status {resp.status}"},
                        properties=FunctionCallResultProperties(run_llm=True),
                    )
                    return

                data = await resp.json()

        web_results = data.get("web", {}).get("results", [])
        results = []
        for r in web_results[:count]:
            results.append({
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "snippet": r.get("description", ""),
            })

        log.info("bot_web_search results", num_results=len(results))

        await params.result_callback(
            {
                "success": True,
                "query": query,
                "num_results": len(results),
                "results": results,
            },
            properties=FunctionCallResultProperties(run_llm=True),
        )

    except Exception as e:
        log.error("bot_web_search error", error=str(e))
        await params.result_callback(
            {"success": False, "error": f"Search failed: {str(e)}"},
            properties=FunctionCallResultProperties(run_llm=True),
        )


def _strip_html(html: str) -> str:
    """Basic HTML tag stripping to extract readable text."""
    # Remove script and style blocks
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    # Remove tags
    text = re.sub(r"<[^>]+>", " ", html)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


@bot_tool(
    name="bot_web_fetch",
    description=(
        "Fetch and read the content of a web page. Use after bot_web_search to read the full "
        "content of a specific search result, or when the user provides a URL to read. "
        "Returns the extracted text content (up to ~4000 characters)."
    ),
    parameters={
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL to fetch and extract text from",
            },
        },
        "required": ["url"],
    },
)
async def bot_web_fetch(params: FunctionCallParams):
    """Fetch and extract readable text from a URL."""
    log = bind_tool_logger(params, tag="[bot_web_fetch]")
    arguments = params.arguments

    url = (arguments.get("url") or "").strip()

    if not url:
        await params.result_callback(
            {"success": False, "error": "A URL is required."},
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    if aiohttp is None:
        await params.result_callback(
            {"success": False, "error": "aiohttp not available"},
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    # Validate URL to prevent SSRF
    url_error = _validate_url(url)
    if url_error:
        log.warning("bot_web_fetch URL rejected", url=url, reason=url_error)
        await params.result_callback(
            {"success": False, "error": url_error},
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    log.info("bot_web_fetch invoked", url=url)

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; PearlOS/1.0)",
        }

        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=15), allow_redirects=True) as resp:
                if resp.status != 200:
                    await params.result_callback(
                        {"success": False, "error": f"Failed to fetch URL (status {resp.status})"},
                        properties=FunctionCallResultProperties(run_llm=True),
                    )
                    return

                html = await resp.text(errors="replace")

        text = _strip_html(html)
        # Limit to ~4000 chars
        if len(text) > 4000:
            text = text[:4000] + "... [truncated]"

        log.info("bot_web_fetch success", url=url, text_len=len(text))

        await params.result_callback(
            {
                "success": True,
                "url": url,
                "content": text,
            },
            properties=FunctionCallResultProperties(run_llm=True),
        )

    except Exception as e:
        log.error("bot_web_fetch error", error=str(e))
        await params.result_callback(
            {"success": False, "error": f"Fetch failed: {str(e)}"},
            properties=FunctionCallResultProperties(run_llm=True),
        )
