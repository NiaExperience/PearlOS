"""Wonder Canvas tools for real-time interactive HTML display.

Provides tools for Pearl to push lightweight HTML scenes to the Wonder Canvas,
manage layers, trigger animations, and clear content. Interactions from the
user (via data-action attributes) flow back as context events.
"""
import time as _time

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools import events
from tools.logging_utils import bind_tool_logger
from tools.wonder_canvas_helpers import resolve_image_urls_in_html


# ---------------------------------------------------------------------------
# Per-turn dedup for Wonder Canvas scene pushes
# Prevents duplicate pushes of the SAME tool within a short window.
# Each tool (scene vs template) tracks independently so they don't block each other.
# ---------------------------------------------------------------------------
_last_scene_push_ts: float = 0.0
_last_template_push_ts: float = 0.0
_last_template_name: str = ""
_SCENE_DEDUP_WINDOW: float = 2.0  # seconds — prevent rapid duplicate pushes

# Templates exempt from dedup tracking (they never block a subsequent push)
_DEDUP_EXEMPT_TEMPLATES = frozenset({"loading_card", "error_card"})


_CROSS_TOOL_DEDUP_WINDOW: float = 15.0  # seconds — for cross-tool dedup (e.g. bot_get_weather → weather_card)


def _should_dedup_scene(tool: str = "scene", template_name: str = "") -> bool:
    """Return True if the same tool was already pushed within the dedup window.

    For templates: only dedup when the SAME template name is pushed twice.
    Different template names (e.g. loading_card → weather_card) are never deduped.
    Templates in _DEDUP_EXEMPT_TEMPLATES never trigger dedup on subsequent calls.

    Cross-tool dedup: if a scene tool (like bot_get_weather) marked a template name,
    a subsequent template call with the same name within 15s is deduped.
    """
    global _last_template_name
    if tool == "template":
        ts = _last_template_push_ts
        # Use the longer cross-tool window when checking — this covers the case
        # where bot_get_weather pushed a weather card and then the LLM
        # also calls bot_wonder_canvas_template("weather_card") a few seconds later
        window = _CROSS_TOOL_DEDUP_WINDOW if template_name else _SCENE_DEDUP_WINDOW
        if (_time.time() - ts) >= window:
            return False
        # Within the window: only dedup if same template name AND previous wasn't exempt
        if _last_template_name in _DEDUP_EXEMPT_TEMPLATES:
            return False
        if template_name and template_name != _last_template_name:
            return False
        return True
    else:
        ts = _last_scene_push_ts
        return (_time.time() - ts) < _SCENE_DEDUP_WINDOW


def _mark_scene_pushed(tool: str = "scene", template_name: str = "") -> None:
    """Record that a scene/template was just pushed.

    When template_name is provided with tool="scene", also marks the template
    dedup tracker so a subsequent bot_wonder_canvas_template call with the same
    template name will be deduped (prevents bot_get_weather's auto-card from
    being overwritten by a redundant bot_wonder_canvas_template weather_card call).
    """
    global _last_scene_push_ts, _last_template_push_ts, _last_template_name
    if tool == "template":
        _last_template_push_ts = _time.time()
        _last_template_name = template_name
    else:
        _last_scene_push_ts = _time.time()
        # Cross-tool dedup: if a scene push specifies a template name,
        # also mark the template tracker so the same template won't overwrite it
        if template_name:
            _last_template_push_ts = _time.time()
            _last_template_name = template_name


@bot_tool(
    name="bot_wonder_canvas_scene",
    description=(
        "Display raw HTML on Wonder Canvas. ONLY for custom interactive experiences "
        "(PixiJS games, Three.js 3D, p5.js). For charts, bios, facts, news, weather, "
        "or any standard visual, use bot_wonder_canvas_template instead — it is faster "
        "and higher quality. This tool supports "
        "PixiJS games, Three.js 3D scenes, p5.js sketches, Canvas2D animations, "
        "CSS animations, SVG, and any web technology via CDN script tags. "
        "Use data-action='id' for clickable elements. "
        "CSS helpers: wonder-fadeIn, wonder-slideUp, wonder-bounce, wonder-pulse, wonder-glow. "
        "Icons: {{icon:name}} (tree, castle, star, heart, etc). No emoji. "
        "For complex scenes, include CDN scripts inline (e.g. pixi.js, three.js). "
        "For multi-file projects (games, complex apps), write files to "
        "/workspace/user/canvas-apps/{name}/ and pass the url parameter instead of html."
    ),
    feature_flag="wonderCanvas",
    parameters={
        "html": {
            "type": "string",
            "description": (
                "HTML content to display. Use data-action='id' on interactive elements. "
                "Use {{icon:name}} placeholders for inline SVG icons instead of emoji. "
                "Mutually exclusive with 'url'."
            ),
        },
        "url": {
            "type": "string",
            "description": (
                "URL to load in the canvas iframe (e.g. /canvas-apps/my-game/index.html). "
                "Use for multi-file projects written to /workspace/user/canvas-apps/{name}/. "
                "Mutually exclusive with 'html'."
            ),
        },
        "css": {
            "type": "string",
            "description": "Optional extra CSS styles for this scene (html mode only).",
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
    url = args.get("url")

    if not html and not url:
        await params.result_callback(
            {"success": False, "error": "Either html or url is required"},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return

    # Reject effectively empty HTML (e.g. <div></div>) — prevents canvas flash + close cascade
    if html and not url:
        import re as _re_wc
        stripped = _re_wc.sub(r'<[^>]*>', '', html).strip()
        if not stripped and len(html) < 100:
            log.warning(f"Wonder Canvas scene rejected — HTML is effectively empty: {html!r}")
            await params.result_callback(
                {"success": False, "error": "HTML has no visible content. Use bot_wonder_canvas_template for charts, bios, facts, etc."},
                properties=FunctionCallResultProperties(run_llm=True),
            )
            return

    layer = args.get("layer", "main")
    transition = args.get("transition", "fade")

    # Per-turn dedup: skip if a scene was already pushed recently
    if _should_dedup_scene():
        log.warning(f"Wonder Canvas scene DEDUPED — already pushed within {_SCENE_DEDUP_WINDOW}s window")
        await params.result_callback(
            {"success": True, "user_message": "Scene already displayed on Wonder Canvas (duplicate skipped)."},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return

    if url:
        # URL mode — navigate iframe directly to a project URL
        log.info(f"Wonder Canvas scene URL mode ({url})")
        _mark_scene_pushed()

        if params.forwarder:
            await params.forwarder.emit_tool_event(events.WONDER_CANVAS_SCENE, {
                "url": url,
                "transition": transition,
                "layer": layer,
            })

        await params.result_callback(
            {"success": True, "user_message": f"Canvas app loaded: {url}"},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return

    # HTML mode — inline content via postMessage
    # Resolve /api/image?q=TERM URLs to direct Wikipedia CDN URLs (avoids 3-hop proxy)
    try:
        html = await resolve_image_urls_in_html(html)
    except Exception as e:
        log.warning(f"Image URL resolution failed (non-fatal): {e}")

    log.info(f"Wonder Canvas scene ({len(html)} chars, layer={layer}, transition={transition})")
    _mark_scene_pushed()

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
