"""Wonder Canvas template tool for fast, pre-built visual content.

Uses the template library to render common content types (weather, news,
facts, bios, etc.) without requiring the LLM to generate raw HTML.
"""
from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools import events
from tools.logging_utils import bind_tool_logger
from tools.wonder_canvas_templates import render_template, get_template_names
from tools.wonder_canvas import _should_dedup_scene, _mark_scene_pushed, _SCENE_DEDUP_WINDOW
from tools.wonder_canvas_helpers import resolve_image_urls_in_data

# Hard guard: greeting_card fires ONCE per process lifetime (one voice session = one process)
_greeting_card_shown = False


@bot_tool(
    name="bot_wonder_canvas_template",
    description=(
        "Display a pre-built Wonder Canvas template. ALWAYS prefer this over raw HTML. "
        "Only use when you have specific subject data from the current user request; "
        "never display generic cards about 'game', 'video', or 'topic'. "
        "For complex canvas work, loading_card/progress_tracker may appear first, "
        "then replace it with a final specific visual. "
        "For images: image_url=/api/image?q=SEARCH_TERM. No emoji as primary visual. "
        "BEST templates: galaxy (100K star parallax — NO data needed, use for space/awe), "
        "editorial_split (cinematic split-screen photo+text — great for facts/reveals), "
        "photo_story (full-screen narrative), celebration (confetti party). "
        "DATA VIZ templates (use for charts/graphs/data): "
        "bar_chart (bars:[{label,value}]), line_chart (points:[{label,value}]), "
        "pie_chart (slices:[{label,value}]), scatter_plot (points:[{x,y,label}]), "
        "comparison_bars (items:[{label,value,color}]), timeline_chart (events:[{date,title,description}]), "
        "treemap (blocks:[{label,value,color}]), heatmap (x_labels,y_labels,values:2D array), "
        "gauge (value,max,label). "
        "All templates: weather_card, person_bio, fact_card, movie_card, recipe_card, "
        "quiz_question, quote_spotlight, photo_gallery, daily_briefing, celebration, "
        "news_headline, definition_card, book_card, image_showcase, location_card, "
        "countdown_timer, comparison_table, timeline, list_card, profile_card, "
        "before_after, achievement_unlocked, code_snippet, sports_score, event_card, "
        "map_card, stat_dashboard, calculator, music_now_playing, music_playlist, "
        "poll, story_choice, progress_tracker, game_scoreboard, galaxy, "
        "bar_chart, line_chart, pie_chart, scatter_plot, comparison_bars, "
        "timeline_chart, treemap, heatmap, gauge."
    ),
    feature_flag="wonderCanvas",
    parameters={
        "type": "object",
        "properties": {
            "template": {
                "type": "string",
                "description": "Template name (e.g. weather_card, news_headline, person_bio, fact_card, etc.)",
            },
            "data": {
                "type": "object",
                "description": "Key-value data to fill into the template placeholders. Use the exact keys listed in the tool description for your chosen template.",
            },
            "transition": {
                "type": "string",
                "enum": ["fade", "slide-left", "slide-right", "instant", "dissolve"],
                "description": "Scene transition animation. Default: fade.",
            },
        },
        "required": ["template", "data"],
    },
    passthrough=True,
)
async def bot_wonder_canvas_template(params: FunctionCallParams):
    """Render a pre-built template and push it to the Wonder Canvas."""
    log = bind_tool_logger(params, tag="[wonder_canvas_template]")
    args = params.arguments

    template_name = args.get("template")
    if not template_name:
        await params.result_callback(
            {"success": False, "error": "template name is required"},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return

    data = args.get("data") or {}
    transition = args.get("transition", "fade")

    # ── Hard block: greeting_card disabled until Wonder Canvas is stable ──
    if template_name == "greeting_card":
        log.warning("greeting_card DISABLED — blocked until Wonder Canvas is stable")
        await params.result_callback(
            {"success": True, "user_message": "Greeting card is currently disabled."},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return

    # Resolve /api/image?q=TERM URLs to direct Wikipedia CDN URLs (avoids 3-hop proxy)
    try:
        data = await resolve_image_urls_in_data(data)
    except Exception as e:
        log.warning(f"Image URL resolution failed (non-fatal): {e}")

    # Render the template
    try:
        html = render_template(template_name, **data)
    except Exception as e:
        log.error(f"Template render error: {e}")
        await params.result_callback(
            {"success": False, "error": f"Template '{template_name}' render failed: {e}"},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return

    available = get_template_names()
    if template_name not in available and available:
        log.warning(f"Template '{template_name}' not in registry, rendered fallback")

    # Per-turn dedup: skip if the SAME template was already pushed recently
    # Different templates (e.g. loading_card → real content) are never deduped.
    if _should_dedup_scene(tool="template", template_name=template_name):
        log.warning(f"Wonder Canvas template DEDUPED — already pushed within {_SCENE_DEDUP_WINDOW}s window")
        await params.result_callback(
            {"success": True, "user_message": f"Template '{template_name}' already displayed (duplicate skipped)."},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return

    log.info(f"Wonder Canvas template '{template_name}' ({len(html)} chars, transition={transition})")
    _mark_scene_pushed(tool="template", template_name=template_name)

    if params.forwarder:
        await params.forwarder.emit_tool_event(events.WONDER_CANVAS_SCENE, {
            "html": html,
            "css": "",
            "transition": transition,
            "layer": "main",
        })

    await params.result_callback(
        {"success": True, "user_message": f"Template '{template_name}' displayed on Wonder Canvas."},
        properties=FunctionCallResultProperties(run_llm=False),
    )
