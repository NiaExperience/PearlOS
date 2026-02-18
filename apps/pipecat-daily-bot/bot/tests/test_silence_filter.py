import pytest
try:
    from bot.filters.silence import SilenceTextFilter
except ImportError:
    from filters.silence import SilenceTextFilter

@pytest.mark.asyncio
async def test_silence_filter_pass_through():
    """Test that normal text is passed through unchanged."""
    f = SilenceTextFilter()
    assert await f.filter("Hello world") == "Hello world"
    assert await f.filter("  Spaces  ") == "  Spaces  "

@pytest.mark.asyncio
async def test_silence_filter_block_silence():
    """Test that SILENCE token is filtered out."""
    f = SilenceTextFilter()
    assert await f.filter("SILENCE") == ""
    assert await f.filter("silence") == ""
    assert await f.filter("  SiLeNcE  ") == ""
    # Should not filter if part of another word or sentence (depending on requirements, but current impl is exact match stripped)
    assert await f.filter("Silence is golden") == "Silence is golden"
