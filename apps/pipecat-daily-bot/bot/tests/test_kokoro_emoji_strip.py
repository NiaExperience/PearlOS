"""Tests for Kokoro TTS emoji stripping functionality."""

from providers.kokoro import _strip_emojis


class TestStripEmojis:
    """Test emoji stripping for Kokoro TTS."""

    def test_strips_basic_emojis(self):
        """Basic emoji characters should be removed."""
        assert _strip_emojis("Hello 😀 world!") == "Hello world!"
        assert _strip_emojis("Great job! 👍") == "Great job!"
        assert _strip_emojis("🎉 Congratulations! 🎊") == "Congratulations!"

    def test_strips_multiple_emojis(self):
        """Multiple consecutive emojis should be removed."""
        assert _strip_emojis("Hello 😀😁😂 world") == "Hello world"
        assert _strip_emojis("Test 🔥🔥🔥 fire") == "Test fire"

    def test_preserves_text_only(self):
        """Text without emojis should remain unchanged."""
        assert _strip_emojis("Hello world!") == "Hello world!"
        assert _strip_emojis("No emojis here.") == "No emojis here."

    def test_handles_emoji_only_text(self):
        """Text with only emojis should return empty string."""
        assert _strip_emojis("😀😁😂") == ""
        assert _strip_emojis("🎉🎊🎁") == ""

    def test_handles_zwj_sequences(self):
        """Zero-width joiner emoji sequences should be removed."""
        # Family emoji (👨‍👩‍👧‍👦) is a ZWJ sequence
        assert _strip_emojis("My family 👨‍👩‍👧‍👦 is great") == "My family is great"

    def test_handles_skin_tone_modifiers(self):
        """Emoji with skin tone modifiers should be removed."""
        assert _strip_emojis("Thumbs up 👍🏻👍🏿") == "Thumbs up"

    def test_handles_flag_emojis(self):
        """Flag emojis (regional indicators) should be removed."""
        assert _strip_emojis("Hello from 🇺🇸") == "Hello from"

    def test_handles_weather_symbols(self):
        """Weather and misc symbols should be removed."""
        assert _strip_emojis("Sunny ☀️ today") == "Sunny today"
        assert _strip_emojis("It's raining ☔") == "It's raining"

    def test_cleans_up_double_spaces(self):
        """Double spaces from emoji removal should be collapsed."""
        assert _strip_emojis("Hello 😀 😁 world") == "Hello world"
        assert _strip_emojis("A 🔥 B 🔥 C") == "A B C"

    def test_strips_leading_trailing_whitespace(self):
        """Leading/trailing whitespace from emoji removal should be stripped."""
        assert _strip_emojis("😀 Hello") == "Hello"
        assert _strip_emojis("Hello 😀") == "Hello"
        assert _strip_emojis("😀 Hello 😀") == "Hello"

    def test_handles_empty_string(self):
        """Empty string should return empty string."""
        assert _strip_emojis("") == ""

    def test_preserves_special_characters(self):
        """Non-emoji special characters should be preserved."""
        assert _strip_emojis("Hello! @user #tag $100") == "Hello! @user #tag $100"
        assert _strip_emojis("Test: a-b, c.d") == "Test: a-b, c.d"

    def test_preserves_unicode_text(self):
        """Non-emoji unicode (accents, CJK, etc.) should be preserved."""
        assert _strip_emojis("Café résumé") == "Café résumé"
        assert _strip_emojis("こんにちは 😀") == "こんにちは"
        assert _strip_emojis("Привет 👋") == "Привет"
