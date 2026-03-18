# PearlOS QA Test Suite

## Quick Start

```bash
cd /workspace/nia-universal

# Unit tests (no dependencies beyond Python)
python -m pytest tests/test_templates.py tests/test_events.py tests/test_router.py tests/test_news.py tests/test_tools.py -v

# Visual tests (requires Playwright + Chromium)
python -m pytest tests/test_visual.py -v

# Integration tests (requires running gateway on :4444)
python -m pytest tests/test_gateway.py tests/test_news_api.py -v

# Everything
python -m pytest tests/ -v

# Self-test (standalone health check + test runner)
python tests/pearl_self_test.py

# Log monitor (scan for regression patterns)
python tests/log_monitor.py
```

## Test Files

| File | What It Tests | Markers | Dependencies |
|------|--------------|---------|-------------|
| `test_templates.py` | All 49 Wonder Canvas templates render without errors, XSS checks, metadata validation | — | None |
| `test_events.py` | Event constant strings match frontend expectations | — | None |
| `test_router.py` | Tool routing: DIRECT_TOOLS mapping, canvas intent keywords | — | None |
| `test_news.py` | `build_news_html()` output structure and parameters | — | None |
| `test_tools.py` | Tool discovery: count, critical tools present | — | None |
| `test_visual.py` | Headless Playwright screenshots of all templates | `visual` | Playwright, Chromium |
| `test_gateway.py` | `/health`, `/emit-event`, WebSocket event delivery | `integration` | Running gateway |
| `test_news_api.py` | News RSS feed API returns valid items | `integration` | Internet |
| `test_selection.py` | Template selection smoke tests (LLM-dependent) | `nightly` | Running gateway + LLM |
| `pearl_self_test.py` | Standalone self-test: services + all test suites + spot checks | — | Running services |
| `log_monitor.py` | Scans bot logs for error patterns and regressions | — | Log files |

## Markers

- **`visual`** — Requires Playwright + headless Chromium. Slower (~30s).
- **`integration`** — Requires running PearlOS services (gateway on :4444).
- **`nightly`** — LLM-dependent, non-deterministic. Run on schedule, not every push.

Run by marker: `python -m pytest -m "not visual and not integration" -v`

## Adding New Template Tests

When a new Wonder Canvas template is added:

1. Add it to `TEMPLATES` dict in `wonder_canvas_templates.py`
2. Add a description in `TEMPLATE_DESCRIPTIONS`
3. Add defaults in `TEMPLATE_DEFAULTS`
4. Add fixture data in `tests/test_templates.py` → `TEMPLATE_FIXTURES` dict
5. Run `python -m pytest tests/test_templates.py -v` — new template auto-discovered via `get_template_names()`

The parametrized tests automatically pick up new templates. If you skip the fixture data, the template still gets tested with its defaults.

## Updating Golden Screenshots

Golden screenshot comparison is not yet enabled. Current visual tests only verify:
- Template renders without JS console errors
- Screenshot file size > 1KB (not blank)
- Screenshots saved to `tests/screenshots/` for manual review

When golden comparison is added:
1. Run `python -m pytest tests/test_visual.py -v` to generate screenshots
2. Review `tests/screenshots/*.png` manually
3. Copy approved screenshots to `tests/baselines/`
4. Enable comparison assertions in `test_visual.py`

## CI/CD

GitHub Actions workflow at `.github/workflows/qa.yml` runs unit tests on every push/PR to `pearlos-candidate`. Visual and integration tests are manual/nightly for now.
