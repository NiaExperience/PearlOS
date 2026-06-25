"""PearlOS interface customization tools."""

import json
import os
import re

import aiohttp

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools import events
from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger


THEMES = {"pixel", "glass", "professional", "calm"}
ACTIONS = {"background", "icons", "theme", "all"}
TARGETS = {"home", "desktop", "both"}


def _clean(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _safe_id(value: object) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9-]+", "-", _clean(value).lower().replace("_", "-"))).strip("-")


def _usable_identity(value: object) -> str:
    return value.strip() if isinstance(value, str) and value.strip() and value.strip().lower() != "undefined" else ""


def _requester_identity(arguments: dict) -> tuple[str, str]:
    user_id = (
        _usable_identity(arguments.get("requester_user_id"))
        or _usable_identity(arguments.get("requesterUserId"))
        or _usable_identity(os.getenv("BOT_SESSION_USER_ID"))
    )
    email = (
        _usable_identity(arguments.get("requester_email"))
        or _usable_identity(arguments.get("requesterEmail"))
        or _usable_identity(os.getenv("BOT_SESSION_USER_EMAIL"))
    )
    return user_id, email


async def _fetch_sandbox_inventory(params: FunctionCallParams, *, query: str = "", log=None) -> tuple[dict | None, dict | None]:
    arguments = params.arguments or {}
    user_id, email = _requester_identity(arguments)
    if not user_id and not email:
        return None, {
            "success": False,
            "error": "missing_requester",
            "user_message": "I need the current user identity to inspect this PearlOS sandbox.",
        }

    base_candidates = [
        os.getenv("PEARLOS_INTERFACE_INTERNAL_URL"),
        os.getenv("PEARLOS_INTERFACE_BASE_URL"),
        os.getenv("INTERFACE_BASE_URL"),
        "http://127.0.0.1:3000",
        os.getenv("NEXT_PUBLIC_APP_URL"),
        os.getenv("BOT_CONTROL_BASE_URL"),
    ]
    bases: list[str] = []
    for base in base_candidates:
        clean_base = _clean(base).rstrip("/")
        if clean_base and clean_base not in bases:
            bases.append(clean_base)

    token = (
        os.getenv("BOT_CONTROL_SHARED_SECRET")
        or os.getenv("PEARL_TASKS_BOT_SECRET")
        or os.getenv("OPENCLAW_GATEWAY_TOKEN")
        or ""
    )
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["x-bot-secret"] = token
    payload = {
        "requester_user_id": user_id,
        "requester_email": email,
    }
    if query:
        payload["query"] = query

    last_error: dict | None = None
    try:
        async with aiohttp.ClientSession() as session:
            for base in bases:
                try:
                    async with session.post(
                        f"{base}/api/pearl-sandbox/inventory",
                        json=payload,
                        headers=headers,
                        timeout=aiohttp.ClientTimeout(total=10),
                    ) as resp:
                        body = await resp.text()
                        if resp.status >= 300:
                            last_error = {
                                "success": False,
                                "error": f"inventory_http_{resp.status}",
                                "user_message": "I cannot reach the PearlOS sandbox inventory right now.",
                            }
                            if log:
                                log.warning("Sandbox inventory request failed", base=base, status=resp.status, error=body[:200])
                            continue
                        if log:
                            log.info("Sandbox inventory request succeeded", base=base, query=query or None)
                        return json.loads(body), None
                except Exception as exc:
                    last_error = {
                        "success": False,
                        "error": "inventory_unavailable",
                        "user_message": "I cannot inspect the PearlOS sandbox right now.",
                    }
                    if log:
                        log.warning(f"Sandbox inventory request failed for {base}: {exc}")
                    continue
        return None, last_error or {
            "success": False,
            "error": "inventory_unavailable",
            "user_message": "I cannot inspect the PearlOS sandbox right now.",
        }
    except Exception as exc:
        if log:
            log.exception(f"Sandbox inventory error: {exc}")
        return None, {
            "success": False,
            "error": "inventory_unavailable",
            "user_message": "I cannot inspect the PearlOS sandbox right now.",
        }


def _pick_custom_theme_match(query: str, inventory: dict) -> dict | None:
    query_id = _safe_id(query)
    matches = ((inventory.get("matches") or {}).get("customThemes") or [])
    customization = inventory.get("interfaceCustomization") or {}
    custom_themes = customization.get("customThemes") or []
    candidates = [item for item in [*matches, *custom_themes] if isinstance(item, dict)]
    if not query_id:
        return None
    for item in candidates:
        if _safe_id(item.get("id")) == query_id or _safe_id(item.get("label")) == query_id:
            return item
    return matches[0] if len(matches) == 1 and isinstance(matches[0], dict) else None


@bot_tool(
    name="bot_customize_interface",
    description=(
        "Customize the user's PearlOS interface. Use this when the user asks to change the UI theme, "
        "desktop/home background, or desktop icons. Backgrounds and generated icons must use PearlOS "
        "Pixel/Sprite assets only; do not call general image generation tools for this."
    ),
    parameters={
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["background", "icons", "theme", "all"],
                "description": "What to change.",
            },
            "theme": {
                "type": "string",
                "description": (
                    "UI theme to apply when action is theme or all. Built-ins are pixel, glass, "
                    "professional, calm. Custom theme IDs from the user's sandbox inventory are also valid."
                ),
            },
            "description": {
                "type": "string",
                "description": "Shared visual prompt, e.g. 'underwater scene' or 'underwater glass icons'.",
            },
            "backgroundDescription": {
                "type": "string",
                "description": "Prompt for pixel-art home and desktop backgrounds.",
            },
            "iconDescription": {
                "type": "string",
                "description": "Prompt for a pixel-art desktop icon pack.",
            },
            "target": {
                "type": "string",
                "enum": ["home", "desktop", "both"],
                "description": "Target screen for a supplied background image. Generated backgrounds default to both.",
            },
            "app": {
                "type": "string",
                "description": "Optional app icon to change, e.g. notes, browser, agency, terminal.",
            },
            "sourceImageUrl": {
                "type": "string",
                "description": "Optional same-origin user-supplied image URL. Do not use arbitrary external images.",
            },
            "requester_user_id": {"type": "string"},
            "requester_email": {"type": "string"},
        },
        "required": ["action"],
    },
    passthrough=False,
)
async def bot_customize_interface(params: FunctionCallParams):
    """Emit an interface customization event to the browser."""
    log = bind_tool_logger(params, tag="[bot_customize_interface]")
    arguments = params.arguments or {}
    forwarder = params.forwarder

    action = _clean(arguments.get("action")).lower()
    theme = _clean(arguments.get("theme")).lower()
    description = _clean(arguments.get("description"))
    background_description = _clean(arguments.get("backgroundDescription") or arguments.get("background_description"))
    icon_description = _clean(arguments.get("iconDescription") or arguments.get("icon_description"))
    target = _clean(arguments.get("target")).lower() or "both"
    app = _clean(arguments.get("app"))
    source_image_url = _clean(arguments.get("sourceImageUrl") or arguments.get("source_image_url"))

    if action not in ACTIONS:
        await params.result_callback(
            {"success": False, "error": "action must be background, icons, theme, or all"},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return
    if target not in TARGETS:
        target = "both"

    if theme and theme not in THEMES:
        inventory, error = await _fetch_sandbox_inventory(params, query=theme, log=log)
        if error:
            await params.result_callback(error, properties=FunctionCallResultProperties(run_llm=True))
            return
        match = _pick_custom_theme_match(theme, inventory or {})
        if not match:
            matches = ((inventory or {}).get("matches") or {}).get("customThemes") or []
            await params.result_callback(
                {
                    "success": False,
                    "error": "custom_theme_not_found",
                    "query": theme,
                    "matches": matches,
                    "user_message": f"I checked the PearlOS sandbox and did not find a custom theme matching {theme}.",
                },
                properties=FunctionCallResultProperties(run_llm=True),
            )
            return
        resolved_theme = _safe_id(match.get("id"))
        if not resolved_theme:
            await params.result_callback(
                {
                    "success": False,
                    "error": "custom_theme_id_missing",
                    "query": theme,
                    "user_message": "I found a matching custom theme, but it did not have a usable theme id.",
                },
                properties=FunctionCallResultProperties(run_llm=True),
            )
            return
        log.info("Resolved custom theme from sandbox inventory", requested=theme, resolved=resolved_theme)
        theme = resolved_theme

    payload = {
        "action": action,
        "target": target,
    }
    if theme:
        payload["theme"] = theme
    if description:
        payload["description"] = description
    if background_description:
        payload["backgroundDescription"] = background_description
    if icon_description:
        payload["iconDescription"] = icon_description
    if app:
        payload["app"] = app
    if source_image_url:
        payload["sourceImageUrl"] = source_image_url

    if action in {"background", "all"} and not (description or background_description or source_image_url):
        await params.result_callback(
            {"success": False, "error": "background customization needs a description or user image"},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return
    if action in {"icons", "all"} and not (description or icon_description or source_image_url):
        await params.result_callback(
            {"success": False, "error": "icon customization needs a description or user image"},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return
    if action == "theme" and not theme:
        await params.result_callback(
            {"success": False, "error": "theme customization needs a theme"},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return

    log.info("Emitting interface customization event", action=action, theme=theme or None)
    if forwarder:
        await forwarder.emit_tool_event(events.INTERFACE_CUSTOMIZE, payload)
    else:
        log.warning("No forwarder available for interface customization")

    await params.result_callback(
        {
            "success": True,
            "user_message": "Tell the user the interface change was applied or is applying, using the actual theme name if known.",
        },
        properties=FunctionCallResultProperties(run_llm=False),
    )


@bot_tool(
    name="bot_list_sandbox_assets",
    description=(
        "List the requester's account-local PearlOS sandbox assets: active/custom themes, "
        "personal feature packages, installed Our PearlOS features, and the personal change ledger. "
        "Use this before claiming a user's custom theme or personal feature does not exist. "
        "Pass query when the user names a theme or feature, for example query='Jurassic Park'."
    ),
    parameters={
        "type": "object",
        "properties": {
            "requester_user_id": {"type": "string"},
            "requester_email": {"type": "string"},
            "query": {"type": "string", "description": "Optional user-provided asset/theme name to match."},
        },
        "required": [],
    },
    passthrough=False,
)
async def bot_list_sandbox_assets(params: FunctionCallParams):
    """Fetch the requester's visible PearlOS sandbox inventory."""
    log = bind_tool_logger(params, tag="[bot_list_sandbox_assets]")
    arguments = params.arguments or {}
    query = _clean(arguments.get("query") or arguments.get("search") or arguments.get("theme"))
    data, error = await _fetch_sandbox_inventory(params, query=query, log=log)
    if error:
        await params.result_callback(error, properties=FunctionCallResultProperties(run_llm=True))
        return

    data = data or {}
    summary = data.get("summary") or {}
    customization = data.get("interfaceCustomization") or {}
    custom_themes = customization.get("customThemes") or []
    await params.result_callback(
        {
            "success": True,
            "query": data.get("query") or query or None,
            "summary": summary,
            "activeTheme": customization.get("activeTheme"),
            "customThemes": custom_themes,
            "matches": data.get("matches") or {},
            "personalFeaturePackages": data.get("personalFeaturePackages") or [],
            "personalChangeLedger": data.get("personalChangeLedger") or [],
            "installedCommunityFeatures": data.get("installedCommunityFeatures") or {},
            "user_message": "Use this inventory to answer what exists in the user's PearlOS sandbox.",
        },
        properties=FunctionCallResultProperties(run_llm=True),
    )
