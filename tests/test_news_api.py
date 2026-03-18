"""Phase 2D: News API integration tests."""
import pytest
import httpx

BASE_URL = "http://localhost:3000"

EXPECTED_CATEGORIES = {"tech", "science", "world", "politics", "entertainment", "health"}


def _api_reachable() -> bool:
    try:
        r = httpx.get(f"{BASE_URL}/api/news/feed", timeout=3)
        return r.status_code == 200
    except Exception:
        return False


api_up = pytest.mark.skipif(
    not _api_reachable(), reason="News API not reachable on :3000"
)


@pytest.mark.integration
class TestNewsFeed:
    @api_up
    def test_feed_returns_items(self):
        r = httpx.get(f"{BASE_URL}/api/news/feed", timeout=10)
        assert r.status_code == 200
        data = r.json()
        items = data if isinstance(data, list) else data.get("items", data.get("articles", []))
        assert len(items) > 0, "Feed returned no items"

    @api_up
    def test_items_have_required_fields(self):
        r = httpx.get(f"{BASE_URL}/api/news/feed", timeout=10)
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", r.json().get("articles", []))
        for item in items[:10]:
            assert "title" in item, f"Item missing title: {item}"
            assert "category" in item or "categories" in item, f"Item missing category: {item}"

    @api_up
    def test_categories_coverage(self):
        r = httpx.get(f"{BASE_URL}/api/news/feed", timeout=10)
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", r.json().get("articles", []))
        found_cats = set()
        for item in items:
            cat = item.get("category") or item.get("categories", "")
            if isinstance(cat, list):
                found_cats.update(c.lower() for c in cat)
            else:
                found_cats.add(str(cat).lower())
        missing = EXPECTED_CATEGORIES - found_cats
        assert len(missing) <= 2, f"Missing too many categories: {missing}"

    @api_up
    def test_items_have_images_and_descriptions(self):
        r = httpx.get(f"{BASE_URL}/api/news/feed", timeout=10)
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", r.json().get("articles", []))
        with_image = sum(1 for i in items if i.get("image") or i.get("imageUrl") or i.get("urlToImage"))
        with_desc = sum(1 for i in items if i.get("description") or i.get("summary") or i.get("content"))
        assert with_image > 0, "No items have images"
        assert with_desc > 0, "No items have descriptions"
