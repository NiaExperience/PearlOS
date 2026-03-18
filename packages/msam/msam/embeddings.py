"""
MSAM Embeddings -- Pluggable embedding provider interface.

Supports:
  - nvidia-nim: NVIDIA NIM API (nv-embedqa-e5-v5, etc.)
  - openai: OpenAI-compatible API (text-embedding-3-small, etc.)
  - onnx: ONNX Runtime local inference (bge-small-en-v1.5, no API needed)
  - local: sentence-transformers (no API key needed, runs on CPU/GPU)

Provider is configured via msam.toml [embedding] section.
"""

import os
import sys
import time
from functools import lru_cache
from pathlib import Path

from .config import get_config

_cfg = get_config()


def _retry_with_backoff(fn, max_retries=3, base_delay=1.0):
    """Retry a function with exponential backoff on transient HTTP errors."""
    import requests
    last_err = None
    for attempt in range(max_retries + 1):
        try:
            result = fn()
            if hasattr(result, 'status_code') and result.status_code in (429, 500, 502, 503):
                raise requests.exceptions.HTTPError(f"HTTP {result.status_code}")
            return result
        except (requests.exceptions.RequestException, requests.exceptions.HTTPError) as e:
            last_err = e
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt)
                print(f"Embedding retry {attempt+1}/{max_retries} after {delay:.1f}s: {e}", file=sys.stderr)
                time.sleep(delay)
    raise last_err


class EmbeddingProvider:
    """Base class for embedding providers."""

    def embed(self, text: str, input_type: str = "passage") -> list[float]:
        raise NotImplementedError

    def batch_embed(self, texts: list[str], input_type: str = "passage") -> list[list[float]]:
        """Batch embed. Default: sequential calls. Override for API batching."""
        return [self.embed(t, input_type) for t in texts]

    def dimensions(self) -> int:
        return _cfg('embedding', 'dimensions', 1024)


class NvidiaNimProvider(EmbeddingProvider):
    """NVIDIA NIM API provider (default)."""

    def __init__(self):
        self.url = _cfg('embedding', 'url', 'https://integrate.api.nvidia.com/v1/embeddings')
        self.model = _cfg('embedding', 'model', 'nvidia/nv-embedqa-e5-v5')
        self.timeout = _cfg('embedding', 'timeout_seconds', 10)
        self.max_chars = _cfg('embedding', 'max_input_chars', 2000)
        self.api_key_env = 'NVIDIA_NIM_API_KEY'

    def _call_api(self, inputs: list[str], input_type: str = "passage") -> list[list[float]]:
        import requests
        api_key = os.environ.get(self.api_key_env)
        if not api_key:
            raise RuntimeError(f"{self.api_key_env} not set. Run: export {self.api_key_env}=\"your-key\" or switch to provider=\"onnx\" in msam.toml for local embeddings.")

        def _do_request():
            r = requests.post(
                self.url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"input": inputs, "model": self.model, "input_type": input_type},
                timeout=self.timeout,
            )
            r.raise_for_status()
            return r

        r = _retry_with_backoff(_do_request)
        data = r.json()["data"]
        return [d["embedding"] for d in sorted(data, key=lambda x: x["index"])]

    def embed(self, text: str, input_type: str = "passage") -> list[float]:
        return self._call_api([text[:self.max_chars]], input_type)[0]

    def batch_embed(self, texts: list[str], input_type: str = "passage") -> list[list[float]]:
        """Batch embed via NIM API."""
        results = []
        batch_size = _cfg('embedding', 'batch_size', 50)
        for i in range(0, len(texts), batch_size):
            chunk = [t[:self.max_chars] for t in texts[i:i + batch_size]]
            results.extend(self._call_api(chunk, input_type))
        return results


class OpenAIProvider(EmbeddingProvider):
    """OpenAI-compatible API provider (works with OpenAI, Azure, local vLLM, etc.)."""

    def __init__(self):
        self.url = _cfg('embedding', 'url', 'https://api.openai.com/v1/embeddings')
        self.model = _cfg('embedding', 'model', 'text-embedding-3-small')
        self.timeout = _cfg('embedding', 'timeout_seconds', 10)
        self.max_chars = _cfg('embedding', 'max_input_chars', 8000)
        self.api_key_env = _cfg('embedding', 'api_key_env', 'OPENAI_API_KEY')

    def embed(self, text: str, input_type: str = "passage") -> list[float]:
        import requests
        api_key = os.environ.get(self.api_key_env)
        if not api_key:
            raise RuntimeError(f"{self.api_key_env} not set. Run: export {self.api_key_env}=\"your-key\" or switch to provider=\"onnx\" in msam.toml for local embeddings.")

        def _do_request():
            r = requests.post(
                self.url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"input": text[:self.max_chars], "model": self.model},
                timeout=self.timeout,
            )
            r.raise_for_status()
            return r

        r = _retry_with_backoff(_do_request)
        return r.json()["data"][0]["embedding"]


class LocalProvider(EmbeddingProvider):
    """Local sentence-transformers provider. No API key needed."""

    def __init__(self):
        self.model_name = _cfg('embedding', 'model', 'all-MiniLM-L6-v2')
        self.max_chars = _cfg('embedding', 'max_input_chars', 2000)
        self._model = None

    def _load_model(self):
        if self._model is None:
            try:
                from sentence_transformers import SentenceTransformer
                self._model = SentenceTransformer(self.model_name)
            except ImportError:
                raise RuntimeError(
                    "sentence-transformers not installed. "
                    "Run: pip install sentence-transformers"
                )
        return self._model

    def embed(self, text: str, input_type: str = "passage") -> list[float]:
        model = self._load_model()
        embedding = model.encode(text[:self.max_chars])
        return embedding.tolist()

    def dimensions(self) -> int:
        model = self._load_model()
        return model.get_sentence_embedding_dimension()


class ONNXProvider(EmbeddingProvider):
    """ONNX Runtime local embedding provider. No API key needed, lightweight.
    
    Default model: BAAI/bge-small-en-v1.5 (33MB ONNX, 384 dimensions).
    Auto-downloads model on first use to ~/.cache/msam/models/.
    Works on both x86_64 and ARM64.
    """

    def __init__(self):
        self.model_name = _cfg('embedding', 'model', 'BAAI/bge-small-en-v1.5')
        self.max_chars = _cfg('embedding', 'max_input_chars', 2000)
        self._session = None
        self._tokenizer = None
        self._model_dir = None

    def _get_model_dir(self) -> Path:
        if self._model_dir is None:
            cache = Path.home() / ".cache" / "msam" / "models" / self.model_name.replace("/", "--")
            cache.mkdir(parents=True, exist_ok=True)
            self._model_dir = cache
        return self._model_dir

    def _download_model(self):
        """Download ONNX model and tokenizer from HuggingFace."""
        import urllib.request
        model_dir = self._get_model_dir()
        base_url = f"https://huggingface.co/{self.model_name}/resolve/main"
        
        files = {
            "onnx/model.onnx": "model.onnx",
            "tokenizer.json": "tokenizer.json",
        }
        for remote, local in files.items():
            local_path = model_dir / local
            if not local_path.exists():
                url = f"{base_url}/{remote}"
                print(f"Downloading {url}...", file=sys.stderr)
                urllib.request.urlretrieve(url, str(local_path))

    def _load(self):
        if self._session is not None:
            return
        
        self._download_model()
        model_dir = self._get_model_dir()
        
        try:
            import onnxruntime as ort
        except ImportError:
            raise RuntimeError("onnxruntime not installed. Run: pip install onnxruntime")
        
        try:
            from tokenizers import Tokenizer
        except ImportError:
            raise RuntimeError("tokenizers not installed. Run: pip install tokenizers")
        
        self._session = ort.InferenceSession(
            str(model_dir / "model.onnx"),
            providers=["CPUExecutionProvider"],
        )
        self._tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self._tokenizer.enable_truncation(max_length=512)
        self._tokenizer.enable_padding(length=512)

    def embed(self, text: str, input_type: str = "passage") -> list[float]:
        import numpy as np
        self._load()
        
        # BGE models use instruction prefix for queries
        if input_type == "query":
            text = f"Represent this sentence: {text}"
        
        encoded = self._tokenizer.encode(text[:self.max_chars])
        input_ids = np.array([encoded.ids], dtype=np.int64)
        attention_mask = np.array([encoded.attention_mask], dtype=np.int64)
        token_type_ids = np.zeros_like(input_ids)
        
        outputs = self._session.run(
            None,
            {"input_ids": input_ids, "attention_mask": attention_mask, "token_type_ids": token_type_ids},
        )
        
        # Mean pooling over token embeddings (output[0] = last_hidden_state)
        token_embs = outputs[0][0]  # (seq_len, hidden_dim)
        mask = attention_mask[0].astype(np.float32)
        pooled = (token_embs * mask[:, np.newaxis]).sum(axis=0) / mask.sum()
        
        # L2 normalize
        norm = np.linalg.norm(pooled)
        if norm > 0:
            pooled = pooled / norm
        
        return pooled.tolist()

    def dimensions(self) -> int:
        return _cfg('embedding', 'dimensions', 384)


# ─── Provider Registry ────────────────────────────────────────────

_PROVIDERS = {
    "nvidia-nim": NvidiaNimProvider,
    "openai": OpenAIProvider,
    "onnx": ONNXProvider,
    "local": LocalProvider,
}

_provider_instance = None


def get_provider() -> EmbeddingProvider:
    """Get the configured embedding provider (singleton)."""
    global _provider_instance
    if _provider_instance is None:
        provider_name = _cfg('embedding', 'provider', 'nvidia-nim')
        provider_cls = _PROVIDERS.get(provider_name)
        if provider_cls is None:
            raise ValueError(
                f"Unknown embedding provider: {provider_name}. "
                f"Available: {', '.join(_PROVIDERS.keys())}"
            )
        _provider_instance = provider_cls()
    return _provider_instance


def embed_text(text: str) -> list[float]:
    """Embed text for storage (passage mode)."""
    start = time.time()
    success = True
    max_chars = _cfg('embedding', 'max_input_chars', 2000)
    try:
        result = get_provider().embed(text[:max_chars], input_type="passage")
        return result
    except Exception:
        success = False
        raise
    finally:
        latency_ms = (time.time() - start) * 1000
        try:
            from .metrics import log_embedding
            log_embedding('embed_text', latency_ms, len(text[:max_chars]), success)
        except Exception:
            pass


def embed_query(text: str) -> list[float]:
    """Embed text for retrieval (query mode)."""
    start = time.time()
    success = True
    max_chars = _cfg('embedding', 'max_input_chars', 2000)
    try:
        result = get_provider().embed(text[:max_chars], input_type="query")
        return result
    except Exception:
        success = False
        raise
    finally:
        latency_ms = (time.time() - start) * 1000
        try:
            from .metrics import log_embedding
            log_embedding('embed_query', latency_ms, len(text[:max_chars]), success)
        except Exception:
            pass


def batch_embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch embed texts for storage (passage mode)."""
    start = time.time()
    max_chars = _cfg('embedding', 'max_input_chars', 2000)
    truncated = [t[:max_chars] for t in texts]
    result = get_provider().batch_embed(truncated, input_type="passage")
    latency_ms = (time.time() - start) * 1000
    try:
        from .metrics import log_embedding
        log_embedding('batch_embed', latency_ms, sum(len(t) for t in truncated), True)
    except Exception:
        pass
    return result


@lru_cache(maxsize=64)
def cached_embed_query(text: str) -> tuple:
    """Cached query embedding. Returns tuple (hashable for LRU cache)."""
    return tuple(embed_query(text))
