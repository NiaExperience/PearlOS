"""PearlOS Canvas Content tools — REROUTED to Wonder Canvas.

These tools previously emitted `canvas.render` events to the now-removed
UniversalCanvas component. They have been rerouted to emit `wonder.scene`
events using Wonder Canvas templates, fixing the white overlay bug.

History: UniversalCanvas was removed in commit 9e117abe. These tools now
render their content through WonderCanvas using the template library.
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
from tools import events
from tools.wonder_canvas_templates import render_template

logger = logging.getLogger(__name__)


async def _emit_wonder_scene(
    params: FunctionCallParams,
    html: str,
    log_tag: str = "[canvas_content]",
) -> bool:
    """Emit a wonder.scene event through the forwarder (rerouted from canvas.render)."""
    log = bind_tool_logger(params, tag=log_tag)
    forwarder = params.forwarder
    if not forwarder:
        log.warning(f"{log_tag} No forwarder available")
        return False
    try:
        await forwarder.emit_tool_event(events.WONDER_CANVAS_SCENE, {
            "html": html,
            "css": "",
            "transition": "fade",
            "layer": "main",
        })
        log.info(f"{log_tag} Emitted wonder.scene (rerouted from canvas.render)")
        return True
    except Exception as e:
        log.error(f"{log_tag} Failed to emit wonder.scene: {e}")
        return False


# ---------------------------------------------------------------------------
# Tool: Show Image — REROUTED to image_showcase template
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
    """Display an image via Wonder Canvas image_showcase template."""
    args = params.arguments

    html = render_template(
        "image_showcase",
        image_url=args.get("image_url", ""),
        title=args.get("title", ""),
        caption=args.get("caption", ""),
        description=args.get("caption", ""),
    )

    success = await _emit_wonder_scene(params, html, log_tag="[canvas_image→wonder]")

    result = {
        "success": success,
        "user_message": "The image is on your screen." if success
        else "I had trouble displaying the image.",
    }
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


# ---------------------------------------------------------------------------
# Tool: Show Chart — REROUTED to Wonder Canvas
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
    """Display a chart via Wonder Canvas fact_card template (fallback)."""
    log = bind_tool_logger(params, tag="[canvas_chart→wonder]")
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

    # Route to proper chart templates
    template_name = {
        "bar": "bar_chart",
        "line": "line_chart",
        "pie": "pie_chart",
        "scatter": "scatter_plot",
        "donut": "pie_chart",
        "doughnut": "pie_chart",
    }.get(chart_type, "bar_chart")

    template_kwargs = {"title": title}

    if chart_type == "bar":
        # Expected: {"categories": [...], "series": [{"name": "X", "data": [1,2,3]}]}
        categories = chart_data.get("categories", chart_data.get("labels", []))
        series = chart_data.get("series", [])
        values = series[0].get("data", []) if series else chart_data.get("values", [])
        template_kwargs["labels"] = categories
        template_kwargs["values"] = values
    elif chart_type == "line":
        labels = chart_data.get("labels", [])
        series = chart_data.get("series", [])
        if series and not labels:
            # Extract labels from time series: [{time, value}]
            first = series[0].get("data", [])
            if first and isinstance(first[0], dict):
                labels = [p.get("time", p.get("x", "")) for p in first]
                series = [{"label": s.get("name", ""), "values": [p.get("value", p.get("y", 0)) for p in s.get("data", [])]} for s in series]
            else:
                series = [{"label": s.get("name", ""), "values": s.get("data", [])} for s in series]
        template_kwargs["labels"] = labels
        template_kwargs["datasets"] = series
    elif chart_type in ("pie", "donut", "doughnut"):
        segments = chart_data.get("segments", chart_data.get("slices", []))
        if segments:
            template_kwargs["labels"] = [s.get("label", "") for s in segments]
            template_kwargs["values"] = [s.get("value", 0) for s in segments]
        else:
            template_kwargs["labels"] = chart_data.get("labels", [])
            template_kwargs["values"] = chart_data.get("values", [])
    elif chart_type == "scatter":
        template_kwargs["points"] = chart_data.get("points", chart_data.get("data", []))
        template_kwargs["x_label"] = chart_data.get("x_label", "X")
        template_kwargs["y_label"] = chart_data.get("y_label", "Y")

    html = render_template(template_name, **template_kwargs)

    success = await _emit_wonder_scene(params, html, log_tag="[canvas_chart→wonder]")

    result = {
        "success": success,
        "user_message": f"Here's the {chart_type} chart — '{title}' is on your screen." if success
        else "I had trouble displaying the chart.",
    }
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


# ---------------------------------------------------------------------------
# Tool: Show Article — REROUTED to Wonder Canvas
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
    """Display an article via Wonder Canvas news_headline template."""
    args = params.arguments

    headline = args.get("headline", "Article")
    body = args.get("body", "")
    source = args.get("source", "")
    image_url = args.get("hero_image", "")

    if not args.get("url") and not (args.get("headline") and args.get("body")):
        result = {
            "success": False,
            "error": "Provide either a URL or headline+body",
            "user_message": "I need either an article URL or the article content to display.",
        }
        await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))
        return

    html = render_template(
        "news_headline",
        headline=headline,
        source=source or "Article",
        summary=body[:1000] if body else "",
        image_url=image_url,
        timestamp="",
    )

    success = await _emit_wonder_scene(params, html, log_tag="[canvas_article→wonder]")

    result = {
        "success": success,
        "user_message": "The article is on your screen." if success
        else "I had trouble displaying the article.",
    }
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


# ---------------------------------------------------------------------------
# Tool: Show Table — REROUTED to Wonder Canvas
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
    """Display a table via Wonder Canvas fact_card template (fallback)."""
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

    # Build simple HTML table for wonder canvas
    title = args.get("title", "Data")
    table_html = f"<table style='width:100%;border-collapse:collapse;color:#f0ece4;font-size:14px'>"
    table_html += "<tr>" + "".join(
        f"<th style='text-align:left;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.1);color:#e8c547;font-size:12px;text-transform:uppercase;letter-spacing:0.06em'>{c.get('label', c.get('key', ''))}</th>"
        for c in columns
    ) + "</tr>"
    for row in rows[:20]:  # cap at 20 rows
        table_html += "<tr>" + "".join(
            f"<td style='padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.04)'>{row.get(c.get('key', ''), '')}</td>"
            for c in columns
        ) + "</tr>"
    table_html += "</table>"

    html = render_template(
        "fact_card",
        title=title,
        category="Data Table",
        fact_text=table_html,
        icon="📋",
    )

    success = await _emit_wonder_scene(params, html, log_tag="[canvas_table→wonder]")

    result = {
        "success": success,
        "user_message": "The table is on your screen." if success
        else "I had trouble displaying the table.",
    }
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=True))


# ---------------------------------------------------------------------------
# Tool: Clear Canvas — DISABLED (duplicate of bot_wonder_canvas_clear)
# ---------------------------------------------------------------------------

# DISABLED per Blair directive 2026-02-26 — duplicate of bot_wonder_canvas_clear
async def _disabled_canvas_clear_handler(params: FunctionCallParams):
    """Clear the canvas — disabled, use bot_wonder_canvas_clear instead."""
    pass
