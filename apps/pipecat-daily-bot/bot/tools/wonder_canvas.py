"""Wonder Canvas tools for real-time interactive HTML display.

Provides tools for Pearl to push lightweight HTML scenes to the Wonder Canvas,
manage layers, trigger animations, and clear content. Interactions from the
user (via data-action attributes) flow back as context events.
"""
from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools import events
from tools.logging_utils import bind_tool_logger


@bot_tool(
    name="bot_wonder_canvas_scene",
    description=(
        "Display an interactive HTML micro-experience on the Wonder Canvas. "
        "Push HTML directly — no AI generation round-trip. Great for stories, "
        "choices, quizzes, visual moments, reveals. "
        "Add data-action='action_id' to any clickable element; when the user "
        "taps it you receive the action_id as a context event. "
        "Use the wonder-choice class for styled interactive buttons. "
        "Built-in CSS: wonder-fadeIn, wonder-slideUp, wonder-bounce, wonder-shake, "
        "wonder-pulse, wonder-glow, wonder-typewriter, wonder-particles-sparkle, "
        "wonder-particles-snow, wonder-particles-fireflies. "
        "ICONS: Use {{icon:name}} placeholders for inline SVG icons — they are auto-resolved. "
        "Available: tree, cave, tower, mountain, castle, sparkle, run, sword, shield, bow, wand, "
        "crystal, gem, potion, scroll, key, chest, heart, star, zap, flame, trophy, coin, "
        "dragon, wolf, sun, moon, cloud, arrowUp, arrowDown, arrowLeft, arrowRight, check, x, plus, minus. "
        "Add CSS classes: {{icon:star:w-icon--lg w-icon--glow}}. Sizes: w-icon--sm/md/lg/xl. "
        "Effects: w-icon--glow, w-icon--spin, w-icon--pulse. "
        "Example: <button class='wonder-choice'>{{icon:tree}} Enter Forest</button>. "
        "DO NOT use emoji characters — they render as boxes in the canvas."
    ),
    feature_flag="wonderCanvas",
    parameters={
        "html": {
            "type": "string",
            "description": (
                "HTML content to display. Use data-action='id' on interactive elements. "
                "Use {{icon:name}} placeholders for inline SVG icons instead of emoji."
            ),
        },
        "css": {
            "type": "string",
            "description": "Optional extra CSS styles for this scene.",
        },
        "transition": {
            "type": "string",
            "enum": ["fade", "slide-left", "slide-right", "instant", "dissolve"],
            "description": "Scene transition animation. Default: fade.",
        },
        "layer": {
            "type": "string",
            "enum": ["bg", "main", "overlay"],
            "description": "Which layer to render on. Default: main.",
        },
    },
    passthrough=True,
)
async def bot_wonder_canvas_scene(params: FunctionCallParams):
    """Push a complete scene to the Wonder Canvas."""
    log = bind_tool_logger(params, tag="[wonder_canvas]")
    args = params.arguments

    html = args.get("html")
    if not html:
        await params.result_callback(
            {"success": False, "error": "html is required"},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return

    layer = args.get("layer", "main")
    transition = args.get("transition", "fade")
    log.info(f"Wonder Canvas scene ({len(html)} chars, layer={layer}, transition={transition})")

    if params.forwarder:
        await params.forwarder.emit_tool_event(events.WONDER_CANVAS_SCENE, {
            "html": html,
            "css": args.get("css", ""),
            "transition": transition,
            "layer": layer,
        })

    await params.result_callback(
        {"success": True, "user_message": "Scene displayed on Wonder Canvas."},
        properties=FunctionCallResultProperties(run_llm=False),
    )


@bot_tool(
    name="bot_wonder_canvas_clear",
    description=(
        "Clear the Wonder Canvas. Specify a layer to clear just that layer, "
        "or omit to clear everything."
    ),
    feature_flag="wonderCanvas",
    parameters={
        "layer": {
            "type": "string",
            "enum": ["bg", "main", "overlay"],
            "description": "Layer to clear. Omit to clear all layers.",
        },
    },
    passthrough=True,
)
async def bot_wonder_canvas_clear(params: FunctionCallParams):
    """Clear the Wonder Canvas."""
    log = bind_tool_logger(params, tag="[wonder_canvas]")
    layer = params.arguments.get("layer")
    log.info(f"Wonder Canvas clear (layer={layer or 'all'})")

    if params.forwarder:
        await params.forwarder.emit_tool_event(events.WONDER_CANVAS_CLEAR, {
            "layer": layer,
        })

    await params.result_callback(
        {"success": True, "user_message": "Wonder Canvas cleared."},
        properties=FunctionCallResultProperties(run_llm=False),
    )


@bot_tool(
    name="bot_wonder_canvas_add",
    description=(
        "Add HTML content to a Wonder Canvas layer without replacing existing content."
    ),
    feature_flag="wonderCanvas",
    parameters={
        "html": {
            "type": "string",
            "description": "HTML to add.",
        },
        "layer": {
            "type": "string",
            "enum": ["bg", "main", "overlay"],
            "description": "Target layer. Default: main.",
        },
        "position": {
            "type": "string",
            "enum": ["append", "prepend"],
            "description": "Where to insert. Default: append.",
        },
    },
    passthrough=True,
)
async def bot_wonder_canvas_add(params: FunctionCallParams):
    """Add content to a Wonder Canvas layer."""
    log = bind_tool_logger(params, tag="[wonder_canvas]")
    args = params.arguments

    html = args.get("html")
    if not html:
        await params.result_callback(
            {"success": False, "error": "html is required"},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return

    layer = args.get("layer", "main")
    position = args.get("position", "append")
    log.info(f"Wonder Canvas add ({len(html)} chars, layer={layer}, position={position})")

    if params.forwarder:
        await params.forwarder.emit_tool_event(events.WONDER_CANVAS_ADD, {
            "html": html,
            "layer": layer,
            "position": position,
        })

    await params.result_callback(
        {"success": True, "user_message": "Content added to Wonder Canvas."},
        properties=FunctionCallResultProperties(run_llm=False),
    )


@bot_tool(
    name="bot_wonder_canvas_animate",
    description=(
        "Trigger a CSS animation on an element in the Wonder Canvas. "
        "Reference elements by CSS selector or element id."
    ),
    feature_flag="wonderCanvas",
    parameters={
        "selector": {
            "type": "string",
            "description": "CSS selector or element id (prefixed with #) to animate.",
        },
        "animation": {
            "type": "string",
            "enum": ["fadeIn", "fadeOut", "slideUp", "bounce", "shake", "pulse"],
            "description": "Animation to trigger.",
        },
    },
    passthrough=True,
)
async def bot_wonder_canvas_animate(params: FunctionCallParams):
    """Animate an element on the Wonder Canvas."""
    log = bind_tool_logger(params, tag="[wonder_canvas]")
    args = params.arguments

    selector = args.get("selector")
    animation = args.get("animation")
    if not selector or not animation:
        await params.result_callback(
            {"success": False, "error": "selector and animation are required"},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return

    log.info(f"Wonder Canvas animate ({selector} → {animation})")

    if params.forwarder:
        await params.forwarder.emit_tool_event(events.WONDER_CANVAS_ANIMATE, {
            "selector": selector,
            "animation": animation,
        })

    await params.result_callback(
        {"success": True, "user_message": "Animation triggered."},
        properties=FunctionCallResultProperties(run_llm=False),
    )


@bot_tool(
    name="bot_wonder_canvas_avatar_hint",
    description=(
        "Send a mood hint to Pearl's avatar so her visual expression matches "
        "the Wonder Canvas scene. Use this to coordinate avatar emotion with "
        "what's on screen — e.g., 'dramatic' for a spooky story, 'excited' "
        "for a reveal, 'curious' for a mystery."
    ),
    feature_flag="wonderCanvas",
    parameters={
        "hint": {
            "type": "string",
            "enum": ["excited", "curious", "dramatic", "calm"],
            "description": "Mood hint for the avatar expression.",
        },
    },
    passthrough=True,
)
async def bot_wonder_canvas_avatar_hint(params: FunctionCallParams):
    """Send an avatar mood hint to the frontend."""
    log = bind_tool_logger(params, tag="[wonder_canvas]")
    hint = params.arguments.get("hint")

    if not hint:
        await params.result_callback(
            {"success": False, "error": "hint is required"},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return

    log.info(f"Wonder Canvas avatar hint: {hint}")

    if params.forwarder:
        await params.forwarder.emit_tool_event(events.WONDER_CANVAS_AVATAR_HINT, {
            "hint": hint,
        })

    await params.result_callback(
        {"success": True, "user_message": f"Avatar mood set to {hint}."},
        properties=FunctionCallResultProperties(run_llm=False),
    )
