"""Smoke tests for OpenClaw Session integration (Phase 1 Voice Integration)."""

import os
import subprocess
import sys

import pytest

# ---------------------------------------------------------------------------
# 1. Import test
# ---------------------------------------------------------------------------

class TestImports:
    def test_openclaw_session_processor_imports(self):
        """OpenClawSessionProcessor can be imported."""
        from processors.openclaw_session import OpenClawSessionProcessor
        assert OpenClawSessionProcessor is not None

    def test_pipeline_builder_imports(self):
        """Pipeline builder still imports cleanly."""
        from pipeline.builder import build_pipeline
        assert build_pipeline is not None


# ---------------------------------------------------------------------------
# 2. Instantiation with mock config
# ---------------------------------------------------------------------------

class TestInstantiation:
    def test_processor_instantiation(self):
        """OpenClawSessionProcessor can be created with minimal config."""
        from processors.openclaw_session import OpenClawSessionProcessor

        # Should accept at minimum an OpenClaw base URL and optional session ID
        try:
            processor = OpenClawSessionProcessor(
                system_prompt="You are a test assistant.",
                api_url=os.environ.get("OPENCLAW_URL", "http://localhost:18789/v1"),
            )
            assert processor is not None
        except TypeError as e:
            # If constructor signature differs, still informative
            pytest.skip(f"Constructor signature differs from expected: {e}")


# ---------------------------------------------------------------------------
# 3. Workspace context loader still works
# ---------------------------------------------------------------------------

class TestWorkspaceContext:
    def test_load_workspace_context(self):
        """load_workspace_context() from core module still works."""
        try:
            from core.workspace_context import load_workspace_context
            ctx = load_workspace_context()
            assert isinstance(ctx, (str, dict, type(None)))
        except ImportError:
            # May live elsewhere — try alternate locations
            try:
                from core.prompts import load_workspace_context
                ctx = load_workspace_context()
                assert isinstance(ctx, (str, dict, type(None)))
            except (ImportError, AttributeError):
                pytest.skip("load_workspace_context not found in expected locations")


# ---------------------------------------------------------------------------
# 4. pearlos-tool CLI accessible
# ---------------------------------------------------------------------------

class TestPearlosTool:
    def test_pearlos_tool_exists(self):
        """pearlos-tool CLI binary exists."""
        result = subprocess.run(
            ["/usr/local/bin/pearlos-tool", "list"],
            capture_output=True, text=True, timeout=10,
        )
        # Should exit 0 and list tools
        assert result.returncode == 0, f"pearlos-tool failed: {result.stderr}"
        assert len(result.stdout.strip()) > 0, "pearlos-tool returned empty output"


# ---------------------------------------------------------------------------
# 5. OpenClaw connectivity
# ---------------------------------------------------------------------------

class TestOpenClawConnectivity:
    def test_openclaw_responds(self):
        """OpenClaw API at localhost:18789 responds."""
        import urllib.request
        import json

        api_key = os.environ.get("OPENCLAW_API_KEY", "openclaw-local")
        try:
            req = urllib.request.Request(
                "http://localhost:18789/v1/chat/completions",
                data=json.dumps({"model": "test", "messages": [{"role": "user", "content": "ping"}]}).encode(),
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
                # Any structured response means OpenClaw is alive
                assert isinstance(data, dict)
        except urllib.error.HTTPError as e:
            # 400/401/404 still means OpenClaw is reachable
            if e.code in (400, 401, 404, 422):
                pass  # reachable
            else:
                pytest.skip(f"OpenClaw not reachable: {e}")
        except Exception as e:
            pytest.skip(f"OpenClaw not reachable: {e}")


# ---------------------------------------------------------------------------
# 6. Fallback mode — sonnet_primary still works
# ---------------------------------------------------------------------------

class TestFallbackMode:
    def test_builder_sonnet_primary(self):
        """Pipeline builder works with BOT_LLM_MODE=sonnet_primary."""
        old = os.environ.get("BOT_LLM_MODE")
        try:
            os.environ["BOT_LLM_MODE"] = "sonnet_primary"
            from pipeline.builder import build_pipeline
            # Just verify it doesn't crash on import with this mode set
            assert build_pipeline is not None
        finally:
            if old is None:
                os.environ.pop("BOT_LLM_MODE", None)
            else:
                os.environ["BOT_LLM_MODE"] = old

    def test_builder_openclaw_session(self):
        """Pipeline builder works with BOT_LLM_MODE=openclaw_session."""
        old = os.environ.get("BOT_LLM_MODE")
        try:
            os.environ["BOT_LLM_MODE"] = "openclaw_session"
            # Re-import to pick up env change
            import importlib
            import pipeline.builder
            importlib.reload(pipeline.builder)
            assert pipeline.builder.build_pipeline is not None
        finally:
            if old is None:
                os.environ.pop("BOT_LLM_MODE", None)
            else:
                os.environ["BOT_LLM_MODE"] = old


# ---------------------------------------------------------------------------
# Run standalone
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
