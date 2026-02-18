"""Experience rendering tools for the Stage system.

Provides tools for Pearl to render interactive HTML experiences on the Stage
and dismiss them when done. Experiences are sandboxed iframes rendered by
ExperienceRenderer.tsx, triggered via Daily app-messages.
"""
from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools import events
from tools.logging_utils import bind_tool_logger


@bot_tool(
    name="bot_render_experience",
    description=(
        "Render an interactive HTML experience on the Stage. "
        "Use this to display visual content like clocks, greeting cards, "
        "data visualizations, mini-games, or any interactive HTML content. "
        "The experience appears full-screen behind Pearl's avatar. "
        "Provide complete, self-contained HTML. Optional CSS and JS are "
        "injected into the sandboxed iframe. Transition can be 'fade', "
        "'slide', or 'instant'."
    ),
    feature_flag="experiences",
    parameters={
        "html": {
            "type": "string",
            "description": "The HTML content to render. Should be a complete HTML fragment."
        },
        "css": {
            "type": "string",
            "description": "Optional CSS styles to inject into the experience."
        },
        "js": {
            "type": "string",
            "description": "Optional JavaScript to execute within the sandboxed experience."
        },
        "transition": {
            "type": "string",
            "enum": ["fade", "slide", "instant"],
            "description": "Transition animation when the experience appears. Defaults to 'fade'."
        }
    },
    passthrough=True
)
async def bot_render_experience(params: FunctionCallParams):
    """Render an HTML experience on the Stage."""
    log = bind_tool_logger(params, tag="[experience_tools]")
    forwarder = params.forwarder
    arguments = params.arguments

    html = arguments.get("html")
    if not html:
        await params.result_callback({
            "success": False,
            "error": "html parameter is required",
            "user_message": "I need HTML content to render an experience."
        }, properties=FunctionCallResultProperties(run_llm=False))
        return

    css = arguments.get("css", "")
    js = arguments.get("js", "")
    transition = arguments.get("transition", "fade")

    log.info(f"Rendering experience (transition={transition}, html={len(html)}chars)")

    if forwarder:
        await forwarder.emit_tool_event(events.EXPERIENCE_RENDER, {
            "html": html,
            "css": css,
            "js": js,
            "transition": transition,
        })

    await params.result_callback({
        "success": True,
        "user_message": "Experience rendered on the Stage."
    }, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_dismiss_experience",
    description=(
        "Dismiss the currently displayed experience from the Stage. "
        "Use this when the user is done viewing an experience or wants "
        "to return to the default void background."
    ),
    feature_flag="experiences",
    parameters={},
    passthrough=True
)
async def bot_dismiss_experience(params: FunctionCallParams):
    """Dismiss the current Stage experience."""
    log = bind_tool_logger(params, tag="[experience_tools]")
    forwarder = params.forwarder

    log.info("Dismissing experience")

    if forwarder:
        await forwarder.emit_tool_event(events.EXPERIENCE_DISMISS, {})

    await params.result_callback({
        "success": True,
        "user_message": "Experience dismissed."
    }, properties=FunctionCallResultProperties(run_llm=False))
