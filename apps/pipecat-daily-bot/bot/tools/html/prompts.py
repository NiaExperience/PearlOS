"""Prompts for HTML tools."""

import sys
from pathlib import Path

from tools.logging_utils import bind_context_logger

log = bind_context_logger(tag="[html_prompts]")

# Import auto-generated library template guidance
LIBRARY_TEMPLATE_GUIDANCE = ""

# Ensure repo codegen path is on sys.path before attempting import to avoid noisy warning
repo_root = Path(__file__).resolve().parents[5]
fallback_path = repo_root / "packages" / "features" / "python"
if fallback_path.exists() and str(fallback_path) not in sys.path:
    sys.path.insert(0, str(fallback_path))

try:
    from nia_library_templates import build_prompt_guidance  # type: ignore

    LIBRARY_TEMPLATE_GUIDANCE = build_prompt_guidance()
except Exception as e:  # broad to log import/runtime issues
    log.warning(
        "Failed to load nia_library_templates guidance",
        error=str(e),
        sysPath=sys.path,
    )

if LIBRARY_TEMPLATE_GUIDANCE:
    log.debug("Library template guidance loaded", guidance=LIBRARY_TEMPLATE_GUIDANCE)
else:
    log.warning("Library template guidance NOT loaded; using empty string.")

DEFAULT_HTML_TOOL_PROMPTS: dict[str, str] = {
    'bot_create_app_from_description': (
        "Request AI generation of an HTML applet/game/tool based on a description. "
        "DO NOT use for sprite/character requests - use bot_summon_sprite instead for those. "
        "The design, theme, gameplay and characters should be based on and informed by your "
        "conversation with the user, but their answers should not be directly used in the experience. "
        "Make a simple, turn-based, no-sound, 80s arcade style game that is genuinely fun, social, "
        "and endlessly generative without feeling like a quiz or therapy. The user should be able to "
        "make one move and then send it to someone else to complete or compete. "
        "Examples: if the user answers artistically, generate a physics-defying graffiti wall; if the "
        "users answers are collaborative, generate a magical wishing tree where others can post and "
        "you affirm their wish with a Gen Z phrase; if they answer competitively, generate a hot-seat "
        "arcade game where players take turns placing a single token on a glowing board, flipping nearby "
        "enemy tiles to their color and instantly changing the score. "
        "Think of it like the user is Player 1 who boots a strange arcade machine and sets its internal "
        "logic (unknowingly) and when they send it to multiple Player 2s, those players briefly get the "
        "joystick and interact with the system before it locks. Player 2s can send with their updates "
        "back to Player 1 or forward on to multiple Player 3s. There should be no instructions or text in "
        "the gameplay, the interaction must be obvious by the visual design affordance. The payoff for "
        "each player must be hilarious to Gen Z audiences and deliver a gorgeous screenshot-able final "
        "visual. All visuals must fit on a single standard mobile screen and not require any scrolling. "
        "Use this when the user asks you to CREATE a new app, game, or interactive tool. "
        "You only need to provide a title and description - the AI will generate the full HTML. "
        "This is the PRIMARY tool for creating new HTML content from user requests."
        + LIBRARY_TEMPLATE_GUIDANCE
    ),
    'bot_create_html_content': (
        "Create a new HTML applet or interactive widget using the provided title and full HTML. "
        "Use this ONLY when you already have complete, valid HTML code to provide."
    ),
    'bot_create_app_from_note': (
        "Create an HTML app/game directly from a note's content. Provide either note_id or title "
        "(fuzzy search will find the note). The note's content will be used to generate the HTML app. "
        "This is a single-step operation that finds the note and creates the app in one tool call."
    ),
    'bot_load_html_applet': (
        "Load an existing HTML applet by ID or search for one by title. Can also search for applets "
        "by their source note - provide note_id or note_title to find applets created from that note. "
        "Search priority: 1) applet_id, 2) applet title, 3) note_id, 4) note_title (fuzzy match). "
        "In multi-user sessions, this will also share the applet with all participants. Use this when "
        "the user wants to open or view an existing HTML applet."
    ),
    'bot_update_html_applet': (
        "Update an existing HTML applet's metadata or HTML content, identified by its applet_id. "
        "If the user wants to update using a note (e.g. 'update with my Space War Tweaks note'), "
        "you MUST provide the 'note_title' or 'note_id' parameter so the system can fetch the full content. "
        "Do NOT try to summarize the note yourself in the modification_request."
    ),
    'bot_rollback_app': (
        "Revert the currently active applet to its previous version. "
        "Use this when the user says 'undo changes', 'rollback', or 'go back to the previous version'. "
        "This will restore the HTML content and title from the most recent history entry."
    ),
}
