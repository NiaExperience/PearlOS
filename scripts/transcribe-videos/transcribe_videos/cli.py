from __future__ import annotations

import argparse
import asyncio
import logging
from pathlib import Path
from typing import Sequence

from .config import PathConfig, ensure_output_dir, load_api_key, resolve_paths
from .runner import TranscriptFormat, TranscribeRunner, TranscriptionResult, discover_jobs, write_manifest

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s - %(message)s"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Batch transcribe Daily recordings with Deepgram.",
    )
    parser.add_argument(
        "--input-dir",
        help="Directory containing .mp4 recordings (default: daily-recordings/transcribe).",
    )
    parser.add_argument(
        "--output-dir",
        help="Directory for transcript artifacts (default: daily-recordings/transcribe/transcripts).",
    )
    parser.add_argument(
        "--env-file",
        help="Path to .env file with DEEPGRAM_API_KEY (default: apps/pipecat-daily-bot/.env).",
    )
    parser.add_argument(
        "--formats",
        help="Comma-separated formats to emit (text,srt). Defaults to both.",
    )
    parser.add_argument(
        "--max-concurrency",
        type=int,
        default=1,
        help="Maximum simultaneous Deepgram requests. Default: 1.",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=3,
        help="Number of times to retry a failed Deepgram upload before giving up (default: 3).",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Re-run transcription even if outputs exist.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List planned work without calling Deepgram.",
    )
    parser.add_argument(
        "--language",
        default="en",
        help="Language code passed to Deepgram (default: en).",
    )
    parser.add_argument(
        "--summaries",
        action="store_true",
        help="Request Deepgram v2 summaries in the response.",
    )
    parser.add_argument(
        "--manifest",
        help="Custom manifest path (default: <output-dir>/manifest.jsonl).",
    )
    return parser


def summarize_run(results: Sequence[TranscriptionResult]) -> str:
    successes = sum(1 for r in results if r.status == "success")
    failures = sum(1 for r in results if r.status == "failed")
    skipped = sum(1 for r in results if r.status == "skipped")
    return f"{successes} succeeded, {skipped} skipped, {failures} failed."


def main(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
    parser = build_parser()
    args = parser.parse_args(argv)

    paths: PathConfig = resolve_paths(args.input_dir, args.output_dir, args.env_file)
    ensure_output_dir(paths.output_dir)

    if not paths.input_dir.exists():
        parser.error(f"Input directory {paths.input_dir} does not exist.")

    api_key = load_api_key(paths.env_path)
    formats = TranscriptFormat.from_csv(args.formats)
    runner = TranscribeRunner(
        api_key=api_key,
        formats=formats,
        overwrite=args.overwrite,
        dry_run=args.dry_run,
        max_concurrency=args.max_concurrency,
        language=args.language,
        summaries=args.summaries,
        max_retries=args.max_retries,
    )

    jobs = discover_jobs(paths)
    logging.info("Discovered %s recording(s).", len(jobs))
    results = asyncio.run(runner.run(jobs))

    manifest_path = Path(args.manifest).expanduser().resolve() if args.manifest else paths.output_dir / "manifest.jsonl"
    write_manifest(manifest_path, results)
    logging.info("Manifest written to %s", manifest_path)

    summary = summarize_run(results)
    logging.info(summary)
    failures = any(result.status == "failed" for result in results)
    return 1 if failures else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
