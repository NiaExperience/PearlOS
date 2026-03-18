#!/bin/bash
set -e

echo "=== PearlOS QA Suite ==="
echo ""

echo "--- Phase 1: Unit Tests ---"
cd /workspace/nia-universal && python3 -m pytest tests/test_templates.py tests/test_events.py tests/test_router.py tests/test_news.py tests/test_tools.py -v --tb=short
echo ""

echo "--- Phase 2: Visual Tests ---"
python3 -m pytest tests/test_visual.py -v --tb=short
echo ""

echo "--- Phase 2: Integration Tests ---"
python3 -m pytest tests/test_gateway.py tests/test_news_api.py -v --tb=short -m integration || echo "(some integration tests may skip if services aren't running)"
echo ""

echo "--- Self-Test ---"
python3 tests/pearl_self_test.py
echo ""

echo "--- Log Monitor ---"
python3 tests/log_monitor.py
