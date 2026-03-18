"""MSAM Embeddings Tests -- provider interface, ONNX, retry, batch."""

import sys
import os
import pytest



class TestProviderRegistry:
    def test_all_providers_registered(self):
        from msam.embeddings import _PROVIDERS
        assert "nvidia-nim" in _PROVIDERS
        assert "openai" in _PROVIDERS
        assert "onnx" in _PROVIDERS
        assert "local" in _PROVIDERS

    def test_provider_classes_instantiate(self):
        from msam.embeddings import NvidiaNimProvider, OpenAIProvider, ONNXProvider, LocalProvider
        # Just test they can be created (no API calls)
        nim = NvidiaNimProvider()
        assert nim.model == "nvidia/nv-embedqa-e5-v5"
        oai = OpenAIProvider()
        assert oai.url is not None  # URL comes from config
        onnx = ONNXProvider()
        assert onnx.model_name is not None  # model name comes from config

    def test_base_class_batch_default(self):
        from msam.embeddings import EmbeddingProvider
        provider = EmbeddingProvider()
        with pytest.raises(NotImplementedError):
            provider.batch_embed(["test"])


class TestRetry:
    def test_retry_succeeds_on_first_try(self):
        from msam.embeddings import _retry_with_backoff
        result = _retry_with_backoff(lambda: "ok")
        assert result == "ok"

    def test_retry_retries_on_failure(self):
        import requests
        from msam.embeddings import _retry_with_backoff
        call_count = [0]
        
        def flaky():
            call_count[0] += 1
            if call_count[0] < 3:
                raise requests.exceptions.ConnectionError("transient")
            return "recovered"
        
        result = _retry_with_backoff(flaky, max_retries=3, base_delay=0.01)
        assert result == "recovered"
        assert call_count[0] == 3

    def test_retry_gives_up(self):
        import requests
        from msam.embeddings import _retry_with_backoff
        
        def always_fail():
            raise requests.exceptions.ConnectionError("permanent")
        
        with pytest.raises(requests.exceptions.ConnectionError):
            _retry_with_backoff(always_fail, max_retries=2, base_delay=0.01)


class TestONNXProvider:
    def test_onnx_import(self):
        from msam.embeddings import ONNXProvider
        provider = ONNXProvider()
        # dimensions() reads from config; default may be 1024 if config has nvidia-nim
        assert provider.dimensions() > 0

    def test_onnx_model_dir(self):
        from msam.embeddings import ONNXProvider
        provider = ONNXProvider()
        model_dir = provider._get_model_dir()
        assert model_dir.exists()
