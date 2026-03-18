"""News tool — fetch live news headlines for Pearl to discuss or display.

Uses Google News RSS feeds (no API key needed) with fallback to configured
RSS sources from the existing /api/news/feed backend.
"""

from __future__ import annotations

import html
import re
from xml.etree import ElementTree as ET

from urllib.parse import quote as url_quote

import aiohttp
from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger
from tools import events

# ── Category → Google News RSS topic IDs ─────────────────────────────

GOOGLE_NEWS_TOPICS = {
    "top": "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
    "top stories": "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
    "tech": "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en",
    "technology": "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en",
    "sports": "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en",
    "entertainment": "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en",
    "science": "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en",
    "business": "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en",
    "health": "https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtVnVLQUFQAQ?hl=en-US&gl=US&ceid=US:en",
    "world": "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en",
}

SEARCH_URL_TEMPLATE = "https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"

USER_AGENT = "Mozilla/5.0 (compatible; PearlOS/1.0)"


def _strip_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    if not text:
        return ""
    text = html.unescape(text)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


def _extract_source(item_title: str) -> tuple[str, str]:
    """Google News titles end with ' - Source Name'. Split them."""
    # Unescape HTML entities first
    item_title = html.unescape(item_title)
    if " - " in item_title:
        parts = item_title.rsplit(" - ", 1)
        return parts[0].strip(), parts[1].strip()
    return item_title, "Unknown"


async def _fetch_rss(url: str, max_items: int = 8) -> list[dict]:
    """Fetch and parse an RSS feed, returning structured items."""
    items = []
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                headers={"User-Agent": USER_AGENT},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status != 200:
                    return []
                xml_text = await resp.text()

        root = ET.fromstring(xml_text)

        # RSS 2.0: channel/item
        ns = {"media": "http://search.yahoo.com/mrss/", "dc": "http://purl.org/dc/elements/1.1/"}
        for item_el in root.iter("item"):
            if len(items) >= max_items:
                break

            raw_title = item_el.findtext("title", "").strip()
            title, source = _extract_source(raw_title)
            link = item_el.findtext("link", "").strip()
            description = _strip_html(item_el.findtext("description", ""))
            pub_date = item_el.findtext("pubDate", "") or item_el.findtext("dc:date", default="", namespaces=ns)

            # Try to get source from <source> element too
            source_el = item_el.find("source")
            if source_el is not None and source_el.text:
                source = html.unescape(source_el.text.strip())

            items.append({
                "headline": title,
                "source": source,
                "summary": description[:250] if description else "",
                "url": link,
                "published": pub_date,
            })

        # Atom fallback: entry
        if not items:
            for entry_el in root.iter("{http://www.w3.org/2005/Atom}entry"):
                if len(items) >= max_items:
                    break
                title = _strip_html(entry_el.findtext("{http://www.w3.org/2005/Atom}title", ""))
                link_el = entry_el.find("{http://www.w3.org/2005/Atom}link")
                link = link_el.get("href", "") if link_el is not None else ""
                summary = _strip_html(
                    entry_el.findtext("{http://www.w3.org/2005/Atom}summary", "")
                    or entry_el.findtext("{http://www.w3.org/2005/Atom}content", "")
                )
                pub_date = (
                    entry_el.findtext("{http://www.w3.org/2005/Atom}published", "")
                    or entry_el.findtext("{http://www.w3.org/2005/Atom}updated", "")
                )
                items.append({
                    "headline": title,
                    "source": "Unknown",
                    "summary": summary[:250],
                    "url": link,
                    "published": pub_date,
                })

    except Exception:
        pass

    return items


def _build_news_card_html(items: list[dict], category: str) -> str:
    """Build elegant news card HTML for Wonder Canvas display."""
    cat_label = category.replace("_", " ").title() if category else "Latest"

    cards_html = ""
    for i, item in enumerate(items[:6]):
        esc_title = html.escape(item["headline"])
        esc_source = html.escape(item["source"])
        esc_summary = html.escape(item.get("summary", "")[:120])
        esc_url = html.escape(item.get("url", ""))
        delay = f"{i * 0.06:.2f}"

        cards_html += f"""
        <a href="{esc_url}" target="_blank" rel="noopener"
           style="display:block;padding:16px 20px;background:rgba(255,255,255,0.03);
                  border-bottom:1px solid rgba(255,255,255,0.04);text-decoration:none;color:inherit;
                  transition:background 0.2s;animation:cardIn 0.5s cubic-bezier(.4,0,.2,1) both;
                  animation-delay:{delay}s;"
           onmouseover="this.style.background='rgba(255,255,255,0.06)'"
           onmouseout="this.style.background='rgba(255,255,255,0.03)'">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;
                      color:rgba(180,140,255,0.7);margin-bottom:4px;">{esc_source}</div>
          <div style="font-size:15px;font-weight:700;line-height:1.35;color:#f0f0f5;margin-bottom:4px;">{esc_title}</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.35);line-height:1.4;">{esc_summary}</div>
        </a>"""

    return f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
*{{box-sizing:border-box;margin:0;padding:0;}}
html,body{{width:100%;height:100%;overflow-y:auto;background:#08080d;color:#f0f0f5;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;}}
@keyframes cardIn{{from{{opacity:0;transform:translateY(24px)}}to{{opacity:1;transform:translateY(0)}}}}
@keyframes fadeIn{{from{{opacity:0}}to{{opacity:1}}}}
@media (min-width:768px){{
  .news-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:0;}}
  .news-grid > a{{border-bottom:none;border:1px solid rgba(255,255,255,0.04);border-radius:12px;margin:4px;}}
}}
</style>
</head><body>
<div style="max-width:600px;margin:0 auto;padding:48px 16px 80px;">
  <div style="margin-bottom:24px;animation:fadeIn 0.4s ease;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;
                color:rgba(255,211,51,0.6);margin-bottom:6px;">📰 {html.escape(cat_label)} News</div>
    <div style="font-size:26px;font-weight:800;letter-spacing:-0.03em;">Headlines</div>
  </div>
  <div class="news-grid" style="border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);
              background:rgba(255,255,255,0.01);">
    {cards_html}
  </div>
  <div style="text-align:center;margin-top:20px;font-size:10px;color:rgba(255,255,255,0.15);">
    Pearl News · Live headlines
  </div>
</div>
<button class="wonder-close-btn"
  onclick="window.parent.postMessage({{type:'wonder.interaction',action:'close',label:'Close scene'}},'*')"
  aria-label="Close">✕</button>
</body></html>"""


# ── The bot tool ─────────────────────────────────────────────────────

@bot_tool(
    name="bot_get_news",
    description=(
        "Fetch live news headlines by category or search topic. Returns structured headline data "
        "that you can summarize and discuss. Categories: top stories, tech, sports, "
        "entertainment, science, business, health, world. You can also search any topic. "
        "IMPORTANT: To SHOW news on screen, use bot_open_news instead (it opens the full news app). "
        "Use bot_get_news only when you need raw headline data for discussion without opening the app."
    ),
    feature_flag="news",
    parameters={
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "description": (
                    "News category: 'top', 'tech', 'sports', 'entertainment', "
                    "'science', 'business', 'health', 'world'. Leave empty if using topic search."
                ),
            },
            "topic": {
                "type": "string",
                "description": "Free-text search topic (e.g. 'AI', 'SpaceX launch', 'climate change'). Overrides category.",
            },
            "count": {
                "type": "number",
                "description": "Number of headlines to return (1-8, default 6).",
            },
        },
        "required": [],
    },
)
async def bot_get_news(params: FunctionCallParams):
    """Fetch live news headlines from Google News RSS."""
    args = params.arguments
    forwarder = params.forwarder
    log = bind_tool_logger(params, tag="[news_tools]")

    category = (args.get("category") or "top").lower().strip()
    topic = (args.get("topic") or "").strip()
    count = min(max(int(args.get("count", 6)), 1), 8)
    log.info("Fetching news", category=category, topic=topic, count=count)

    # Determine URL
    if topic:
        url = SEARCH_URL_TEMPLATE.format(query=url_quote(topic, safe=""))
        label = topic
    elif category in GOOGLE_NEWS_TOPICS:
        url = GOOGLE_NEWS_TOPICS[category]
        label = category
    else:
        # Try as search query
        url = SEARCH_URL_TEMPLATE.format(query=url_quote(category, safe=""))
        label = category

    items = await _fetch_rss(url, max_items=count)

    if not items:
        await params.result_callback(
            {
                "success": False,
                "error": "no_results",
                "user_message": f"I couldn't fetch news headlines right now. Try again in a moment.",
            },
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    # Tag items with category
    for item in items:
        item["category"] = label

    await params.result_callback(
        {
            "success": True,
            "category": label,
            "count": len(items),
            "headlines": items,
            "user_message": f"Here are {len(items)} {label} headlines.",
        },
        properties=FunctionCallResultProperties(run_llm=True),
    )
