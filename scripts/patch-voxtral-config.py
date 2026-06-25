#!/usr/bin/env python3
"""Idempotent patch for vllm-omni VoxtralTTSConfig __init__ ordering bug.

The shipped vllm-omni 0.18.1 calls super().__init__(**kwargs) BEFORE assigning
self.text_config. With transformers >=5.x, PretrainedConfig.__init__ runs
validate_token_ids -> get_text_config(decoder=True) -> reads self.text_config,
which raises AttributeError because text_config has not been assigned yet.

Fix: move the text_config assignment to happen BEFORE super().__init__.

Re-run after any pip install / pip upgrade that touches vllm-omni.

Usage:
    python3 /opt/pearlos/scripts/patch-voxtral-config.py        # apply
    python3 /opt/pearlos/scripts/patch-voxtral-config.py --check # report only
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

TARGET = Path(
    "/usr/local/lib/python3.12/dist-packages/vllm_omni/"
    "model_executor/models/voxtral_tts/configuration_voxtral_tts.py"
)

OLD = """    def __init__(
        self,
        text_config: PretrainedConfig | dict | None = None,
        audio_config: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)

        if isinstance(text_config, PretrainedConfig):
            self.text_config = text_config
        elif isinstance(text_config, dict):
            self.text_config = PretrainedConfig.from_dict(text_config)
        else:
            self.text_config = PretrainedConfig()

        self.audio_config = audio_config or {}"""

NEW = """    def __init__(
        self,
        text_config: PretrainedConfig | dict | None = None,
        audio_config: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        # Initialize text_config before super().__init__ — transformers >=5.x
        # calls validate_token_ids → get_text_config(decoder=True) inside
        # PretrainedConfig.__init__, which reads self.text_config.
        if isinstance(text_config, PretrainedConfig):
            self.text_config = text_config
        elif isinstance(text_config, dict):
            self.text_config = PretrainedConfig.from_dict(text_config)
        else:
            self.text_config = PretrainedConfig()

        super().__init__(**kwargs)

        self.audio_config = audio_config or {}"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="Report only, don't write")
    args = ap.parse_args()

    if not TARGET.exists():
        print(f"target not found: {TARGET}", file=sys.stderr)
        return 2

    src = TARGET.read_text()
    if NEW in src:
        print("already patched")
        return 0
    if OLD not in src:
        print("neither old nor new pattern found — file has drifted, abort", file=sys.stderr)
        return 3
    if args.check:
        print("patch needed")
        return 1
    TARGET.write_text(src.replace(OLD, NEW))

    pyc = TARGET.parent / "__pycache__"
    if pyc.exists():
        for f in pyc.glob("configuration_voxtral_tts*.pyc"):
            f.unlink(missing_ok=True)
    print("patched")
    return 0


if __name__ == "__main__":
    sys.exit(main())
