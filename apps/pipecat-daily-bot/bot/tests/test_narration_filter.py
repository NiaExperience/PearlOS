from bot.filters.narration_filter import strip_narration
from bot.processors.openclaw_session import _pick_filler


def test_strip_narration_suppresses_pure_filler_by_default():
    assert strip_narration("Checking now.") == ""
    assert strip_narration("I'm checking the actual state before I say more.") == ""
    assert strip_narration("On it.") == ""
    assert strip_narration("Okay, I'm on it.") == ""


def test_strip_narration_keeps_real_content_after_filler():
    assert strip_narration("Checking now. The report is saved in Notes.") == "The report is saved in Notes."
    assert strip_narration("On it. I found your Jurassic Park theme and applied it.") == "I found your Jurassic Park theme and applied it."


def test_openclaw_session_has_no_default_filler_phrase():
    assert _pick_filler("what is the weather") == ""
