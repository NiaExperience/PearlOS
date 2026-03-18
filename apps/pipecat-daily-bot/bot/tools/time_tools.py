"""Current time/date tool so Pearl can tell the user what time it is."""

from datetime import datetime
from zoneinfo import ZoneInfo

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger


@bot_tool(
    name="bot_get_current_time",
    description=(
        "Get the current date, time, and day of week. "
        "Use when the user asks what time or date it is."
    ),
    parameters={
        "type": "object",
        "properties": {
            "timezone": {
                "type": "string",
                "description": (
                    "IANA timezone name (e.g. 'America/New_York', 'Europe/London'). "
                    "Defaults to America/New_York."
                ),
            }
        },
        "required": [],
    },
)
async def bot_get_current_time(params: FunctionCallParams):
    """Return the current date/time in both human-readable and ISO formats."""
    log = bind_tool_logger(params, tag="[bot_get_current_time]")
    arguments = params.arguments

    tz_name = (arguments.get("timezone") or "America/New_York").strip()
    log.info("bot_get_current_time invoked", timezone=tz_name)

    try:
        tz = ZoneInfo(tz_name)
    except (KeyError, Exception):
        log.warning("Invalid timezone requested", timezone=tz_name)
        await params.result_callback(
            {"success": False, "error": f"Unknown timezone: {tz_name}"},
            properties=FunctionCallResultProperties(run_llm=True),
        )
        return

    now = datetime.now(tz)

    result = {
        "success": True,
        "timezone": tz_name,
        "date": now.strftime("%A, %B %d, %Y"),
        "time": now.strftime("%I:%M %p"),
        "day_of_week": now.strftime("%A"),
        "iso": now.isoformat(),
    }

    log.info("Returning current time", **result)
    await params.result_callback(
        result,
        properties=FunctionCallResultProperties(run_llm=True),
    )
