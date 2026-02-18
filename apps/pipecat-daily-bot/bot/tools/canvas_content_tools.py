"""PearlOS Universal Canvas tools — display charts, articles, and images.

These tools emit canvas render events to the frontend via the existing
event forwarding system. The frontend's UniversalCanvas component listens
for `canvas.render` events and renders the appropriate content type.

Requires feature flag: openclawBridge
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger

logger = logging.getLogger(__name__)

CANVAS_RENDER_EVENT = "canvas.render"
CANVAS_CLEAR_EVENT = "canvas.clear"


async def _emit_canvas_event(
    params: FunctionCallParams,
    event_type: str,
    payload: dict[str, Any],
    log_tag: str = "[canvas_content]",
) -> bool:
    """Emit a canvas event through the forwarder."""
    log = bind_tool_logger(params, tag=log_tag)
    forwarder = params.forwarder
    if not forwarder:
        log.warning(f"{log_tag} No forwarder available")
        return False
    try:
        await forwarder.emit_tool_event(event_type, {
            **payload,
            "timestamp": int(time.time() * 1000),
        })
        log.info(f"{log_tag} Emitted {event_type}")
        return True
    except Exception as e:
        log.error(f"{log_tag} Failed to emit {event_type}: {e}")
        return False


# ---------------------------------------------------------------------------
# Tool: Show Chart
# ---------------------------------------------------------------------------

@bot_tool(
    name="bot_canvas_show_chart",
    description=(
        "Display a chart/graph on the user's screen. Supports line charts (time series), "
        "bar charts (categorical data), and pie charts (proportional data). "
        "Pass chart data as JSON. The chart renders natively in PearlOS."
    ),
    feature_flag="openclawBridge",
    parameters={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Title displayed above the chart",
            },
            "chart_type": {
                "type": "string",
                "enum": ["line", "bar", "pie"],
                "description": "Type of chart to render",
            },
            "chart_data": {
                "type": "string",
                "description": (
                    "JSON string with chart data. "
                    "For line: {\"series\": [{\"name\": \"Sales\", \"data\": [{\"time\": \"Jan\", \"value\": 100}]}]}. "
                    "For bar: {\"categories\": [\"A\", \"B\"], \"series\": [{\"name\": \"Count\", \"data\": [10, 20]}]}. "
                    "For pie: {\"segments\": [{\"label\": \"Chrome\", \"value\": 65}]}."
                ),
            },
        },
        "required": ["chart_type", "chart_data"],
    },
)
async def canvas_show_chart_handler(params: FunctionCallParams):
    """Display a chart on the canvas."""
    log = bind_tool_logger(params, tag="[canvas_chart]")
    args = params.arguments

    title = args.get("title", "Chart")
    chart_type = args.get("chart_type", "bar")

    try:
        chart_data = json.loads(args.get("chart_data", "{}"))
    except json.JSONDecodeError as e:
        result = {
            "success": False,
            "error": f"Invalid JSON: {e}",
            "user_message": "The chart data wasn't valid JSON.",
        }
        await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))
        return

    # Build the CanvasContent payload
    content = {
        "type": "chart",
        "title": title,
        "data": {
            "chartType": chart_type,
            **chart_data,
        },
    }

    success = await _emit_canvas_event(params, CANVAS_RENDER_EVENT, {
        "content": content,
        "transition": "fade",
    })

    result = {
        "success": success,
        "user_message": f"Here's the {chart_type} chart — '{title}' is on your screen." if success
        else "I had trouble displaying the chart.",
    }
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


# ---------------------------------------------------------------------------
# Tool: Show Article
# ---------------------------------------------------------------------------

@bot_tool(
    name="bot_canvas_show_article",
    description=(
        "Display a news article or web page on the user's screen in a clean, readable format. "
        "Pass a URL to scrape, or pass article data directly (headline, body, etc.)."
    ),
    feature_flag="openclawBridge",
    parameters={
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "URL of the article to scrape and display",
            },
            "headline": {
                "type": "string",
                "description": "Article headline (used if providing data directly instead of URL)",
            },
            "body": {
                "type": "string",
                "description": "Article body in markdown (used if providing data directly)",
            },
            "source": {
                "type": "string",
                "description": "Source name (e.g., 'The New York Times')",
            },
            "author": {
                "type": "string",
                "description": "Author name",
            },
            "hero_image": {
                "type": "string",
                "description": "URL of the hero/header image",
            },
        },
        "required": [],
    },
)
async def canvas_show_article_handler(params: FunctionCallParams):
    """Display an article on the canvas."""
    log = bind_tool_logger(params, tag="[canvas_article]")
    args = params.arguments

    url = args.get("url")
    headline = args.get("headline")
    body = args.get("body")

    if not url and not (headline and body):
        result = {
            "success": False,
            "error": "Provide either a URL or headline+body",
            "user_message": "I need either an article URL or the article content to display.",
        }
        await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))
        return

    article_data: dict[str, Any]

    if headline and body:
        # Direct article data
        article_data = {
            "headline": headline,
            "body": body,
            "source": args.get("source", ""),
            "author": args.get("author"),
            "heroImage": args.get("hero_image"),
            "url": url,
        }
    else:
        # URL scraping — emit with URL; frontend or a server action will handle scraping
        # For now, create a placeholder that tells the frontend to fetch
        article_data = {
            "headline": f"Loading article...",
            "body": f"Fetching content from {url}...",
            "source": url,
            "url": url,
        }
        # In production, you'd scrape server-side here. For the MVP,
        # we pass what we can and let the agent provide the content.

    content = {
        "type": "article",
        "title": article_data.get("headline", "Article"),
        "data": article_data,
    }

    success = await _emit_canvas_event(params, CANVAS_RENDER_EVENT, {
        "content": content,
        "transition": "fade",
    })

    result = {
        "success": success,
        "user_message": f"The article is on your screen." if success
        else "I had trouble displaying the article.",
    }
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


# ---------------------------------------------------------------------------
# Tool: Show Image
# ---------------------------------------------------------------------------

@bot_tool(
    name="bot_canvas_show_image",
    description=(
        "Display an image on the user's screen with zoom and pan controls. "
        "Supports any image URL (jpg, png, gif, webp). "
        "Use pixel_art=true for pixel art (renders with crisp/nearest-neighbor scaling)."
    ),
    feature_flag="openclawBridge",
    parameters={
        "type": "object",
        "properties": {
            "image_url": {
                "type": "string",
                "description": "URL of the image to display",
            },
            "title": {
                "type": "string",
                "description": "Title/caption for the image",
            },
            "caption": {
                "type": "string",
                "description": "Caption text shown below the image",
            },
            "pixel_art": {
                "type": "boolean",
                "description": "Render with nearest-neighbor scaling (for pixel art)",
            },
        },
        "required": ["image_url"],
    },
)
async def canvas_show_image_handler(params: FunctionCallParams):
    """Display an image on the canvas."""
    args = params.arguments

    content = {
        "type": "image",
        "title": args.get("title"),
        "data": {
            "src": args.get("image_url", ""),
            "alt": args.get("title", "Image"),
            "caption": args.get("caption"),
            "pixelArt": args.get("pixel_art", False),
        },
    }

    success = await _emit_canvas_event(params, CANVAS_RENDER_EVENT, {
        "content": content,
        "transition": "fade",
    })

    result = {
        "success": success,
        "user_message": "The image is on your screen." if success
        else "I had trouble displaying the image.",
    }
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


# ---------------------------------------------------------------------------
# Tool: Show Table
# ---------------------------------------------------------------------------

@bot_tool(
    name="bot_canvas_show_table",
    description=(
        "Display a data table on the user's screen with sortable columns. "
        "Pass column definitions and row data as JSON."
    ),
    feature_flag="openclawBridge",
    parameters={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Title for the table",
            },
            "columns": {
                "type": "string",
                "description": 'JSON array of column defs: [{"key": "name", "label": "Name"}, {"key": "price", "label": "Price"}]',
            },
            "rows": {
                "type": "string",
                "description": 'JSON array of row objects: [{"name": "Apple", "price": 1.50}]',
            },
        },
        "required": ["columns", "rows"],
    },
)
async def canvas_show_table_handler(params: FunctionCallParams):
    """Display a table on the canvas."""
    args = params.arguments

    try:
        columns = json.loads(args.get("columns", "[]"))
        rows = json.loads(args.get("rows", "[]"))
    except json.JSONDecodeError as e:
        result = {
            "success": False,
            "error": f"Invalid JSON: {e}",
            "user_message": "The table data wasn't valid JSON.",
        }
        await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))
        return

    content = {
        "type": "table",
        "title": args.get("title", "Data"),
        "data": {
            "columns": columns,
            "rows": rows,
        },
    }

    success = await _emit_canvas_event(params, CANVAS_RENDER_EVENT, {
        "content": content,
        "transition": "fade",
    })

    result = {
        "success": success,
        "user_message": "The table is on your screen." if success
        else "I had trouble displaying the table.",
    }
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


# ---------------------------------------------------------------------------
# Tool: Clear Canvas
# ---------------------------------------------------------------------------

@bot_tool(
    name="bot_canvas_clear",
    description="Clear/dismiss the current canvas content from the user's screen.",
    feature_flag="openclawBridge",
    parameters={
        "type": "object",
        "properties": {},
        "required": [],
    },
)
async def canvas_clear_handler(params: FunctionCallParams):
    """Clear the canvas."""
    success = await _emit_canvas_event(params, CANVAS_CLEAR_EVENT, {})
    result = {
        "success": success,
        "user_message": "Canvas cleared." if success else "Had trouble clearing the canvas.",
    }
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))
