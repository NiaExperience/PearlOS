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


@bot_tool(
    name="bot_wonder_canvas_template",
    description=(
        "Display a pre-built Wonder Canvas template. FASTER than generating HTML from scratch. "
        "Use this FIRST for common content types (weather, news, facts, people, movies, quizzes, etc.). "
        "Available templates: weather_card, news_headline, person_bio, fact_card, definition_card, "
        "movie_card, music_now_playing, recipe_card, book_card, game_scoreboard, quiz_question, "
        "poll, story_choice, countdown_timer, achievement_unlocked, comparison_table, timeline, "
        "stat_dashboard, progress_tracker, location_card, greeting_card, error_card, loading_card, "
        "list_card, image_showcase. "
        "Pass template name and a data object with the required fields for that template."
    ),
    feature_flag="wonderCanvas",
    parameters={
        "template": {
            "type": "string",
            "description": "Template name (e.g. weather_card, news_headline, person_bio, fact_card, etc.)",
        },
        "data": {
            "type": "object",
            "description": "Key-value data to fill into the template placeholders.",
        },
        "transition": {
            "type": "string",
            "enum": ["fade", "slide-left", "slide-right", "instant", "dissolve"],
            "description": "Scene transition animation. Default: fade.",
        },
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

    log.info(f"Wonder Canvas template '{template_name}' ({len(html)} chars, transition={transition})")

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
