"""Phase 1: News HTML builder tests."""
from tools.news_app_html import build_news_html


class TestNewsHtml:
    def test_returns_html_string(self):
        html = build_news_html()
        assert isinstance(html, str)
        assert len(html) > 1000

    def test_contains_html_structure(self):
        html = build_news_html()
        assert "<html" in html.lower() or "<div" in html.lower()

    def test_category_parameter(self):
        html = build_news_html(initial_category="technology")
        assert isinstance(html, str)
        assert len(html) > 1000

    def test_has_fetch_logic(self):
        html = build_news_html()
        assert "fetch" in html.lower() or "rss" in html.lower()
