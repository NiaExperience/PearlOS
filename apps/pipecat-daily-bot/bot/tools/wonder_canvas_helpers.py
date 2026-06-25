"""Helper utilities for Wonder Canvas, including the inline icon library."""

import re
import logging
from pathlib import Path
from urllib.parse import unquote, urlparse, parse_qs

logger = logging.getLogger(__name__)

# Load the icon library JavaScript
_ICON_LIB_PATH = Path(__file__).parent / "wonder_canvas_icons.js"
_ICON_LIBRARY_JS = _ICON_LIB_PATH.read_text() if _ICON_LIB_PATH.exists() else ""


def get_icon_library_inline() -> str:
    """
    Get the Wonder Canvas icon library as an inline <script> tag.
    
    Include this in Wonder Canvas HTML to enable icon usage:
        WonderIcons.get('tree')    → returns SVG for a tree icon
        WonderIcons.get('sword')   → returns SVG for a sword icon
        WonderIcons.getCSS()       → returns CSS for icon styling
    
    Returns:
        str: Complete <script> tag with icon library
    """
    return f"<script>\n{_ICON_LIBRARY_JS}\n</script>"


def get_icon_library_css() -> str:
    """
    Get just the CSS portion for Wonder Canvas icons.
    
    Returns:
        str: CSS string for icon styling
    """
    return """
.w-icon {
  display: inline-block;
  width: 1.25em;
  height: 1.25em;
  vertical-align: -0.25em;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.w-icon--sm { width: 1em; height: 1em; }
.w-icon--md { width: 1.5em; height: 1.5em; }
.w-icon--lg { width: 2em; height: 2em; }
.w-icon--xl { width: 3em; height: 3em; }
.w-icon--glow { filter: drop-shadow(0 0 8px currentColor); }
.w-icon--spin { animation: wIconSpin 2s linear infinite; }
.w-icon--pulse { animation: wIconPulse 2s ease infinite; }
@keyframes wIconSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes wIconPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    """.strip()


# Icon reference for use in bot prompts/descriptions
ICON_REFERENCE = """
Available Wonder Canvas Icons (use with WonderIcons.get('name')):

Navigation & Places:
  tree, cave, tower, mountain, castle

Actions:
  sparkle, run, sword, shield, bow, wand

Items & Objects:
  crystal, gem, potion, scroll, key, chest

Stats & UI:
  heart, star, zap, flame, trophy, coin

Creatures:
  dragon, wolf

Weather & Nature:
  sun, moon, cloud

Directions:
  arrowUp, arrowDown, arrowLeft, arrowRight

Utility:
  check, x, plus, minus

Usage Example (use {{icon:name}} placeholders — auto-resolved by the canvas runtime):
  <button class="wonder-choice">{{icon:tree}} Enter Forest</button>
  <div style="color:#ffd700">{{icon:star:w-icon--lg w-icon--glow}} You Win!</div>
  
Size classes: w-icon--sm, w-icon--md, w-icon--lg, w-icon--xl
Effect classes: w-icon--glow, w-icon--spin, w-icon--pulse

DO NOT use emoji characters — they render as boxes in the canvas.
"""


# ---------------------------------------------------------------------------
# Server-side image URL resolution
# ---------------------------------------------------------------------------
# When the LLM provides /api/image?q=TERM, we resolve it at tool-call time
# to the direct Wikipedia CDN URL so the client doesn't need to go through
# a 3-hop proxy chain (client → Next.js → bot gateway → Wikipedia CDN).

_IMAGE_PROXY_RE = re.compile(r'/api/image(?:-proxy)?\?(?:q|url)=([^&"\'>\s]+)')


async def resolve_image_urls_in_data(data: dict) -> dict:
    """Resolve /api/image?q=TERM URLs anywhere in template data.

    Template payloads often nest images in arrays such as
    ``photo_gallery.images[].url``. Walk the whole JSON-like structure so those
    values are resolved before the canvas renders.
    """

    async def _resolve_value(value):
        if isinstance(value, str):
            if "/api/image" not in value:
                return value
            match = _IMAGE_PROXY_RE.search(value)
            if not match:
                return value
            query = unquote(match.group(1))
            cdn_url = await _resolve_wikipedia_image(query)
            if cdn_url:
                logger.info(f"[wonder-helpers] Resolved image '{query}' → {cdn_url}")
                return _IMAGE_PROXY_RE.sub(cdn_url, value)
            return value
        if isinstance(value, list):
            return [await _resolve_value(item) for item in value]
        if isinstance(value, dict):
            return {key: await _resolve_value(item) for key, item in value.items()}
        return value

    if not isinstance(data, dict):
        return data
    return await _resolve_value(data)


async def resolve_image_urls_in_html(html: str) -> str:
    """Resolve /api/image?q=TERM URLs found in rendered HTML to direct CDN URLs."""
    import aiohttp

    matches = list(_IMAGE_PROXY_RE.finditer(html))
    if not matches:
        return html

    # Deduplicate queries
    queries = {}
    for m in matches:
        q = unquote(m.group(1))
        if q not in queries:
            queries[q] = m.group(0)  # full matched path

    for q, original_path in queries.items():
        cdn_url = await _resolve_wikipedia_image(q)
        if cdn_url:
            html = html.replace(original_path, cdn_url)
            logger.info(f"[wonder-helpers] Resolved image in HTML '{q}' → {cdn_url}")

    return html


# Shared cache across calls within the same process
_wiki_image_cache: dict[str, str | None] = {}

_WIKI_UA = "PearlOS/1.0 (https://niaxp.com; pearl@niaxp.com)"


async def _resolve_wikipedia_image(query: str) -> str | None:
    """Resolve a search query to a direct Wikipedia CDN image URL."""
    import aiohttp

    q_lower = query.lower().strip()
    if q_lower in _wiki_image_cache:
        return _wiki_image_cache[q_lower]

    try:
        async with aiohttp.ClientSession() as session:
            # Search for the wiki title
            search_url = (
                f"https://en.wikipedia.org/w/api.php?action=query&list=search"
                f"&srsearch={query}&srlimit=1&format=json"
            )
            async with session.get(search_url, timeout=aiohttp.ClientTimeout(total=5),
                                   headers={"User-Agent": _WIKI_UA}) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    results = data.get("query", {}).get("search", [])
                    slug = results[0]["title"].replace(" ", "_") if results else query.replace(" ", "_").title()
                else:
                    slug = query.replace(" ", "_").title()

            # Get page summary with image
            summary_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}"
            async with session.get(summary_url, timeout=aiohttp.ClientTimeout(total=5),
                                   headers={"User-Agent": _WIKI_UA}) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    for key in ("thumbnail", "originalimage"):
                        src = (data.get(key) or {}).get("source")
                        if src:
                            # Upscale thumbnail to 800px
                            img_url = re.sub(r"/\d+px-", "/800px-", src)
                            _wiki_image_cache[q_lower] = img_url
                            return img_url

        _wiki_image_cache[q_lower] = None
        return None
    except Exception as e:
        logger.warning(f"[wonder-helpers] Wikipedia image resolution failed for '{query}': {e}")
        _wiki_image_cache[q_lower] = None
        return None
