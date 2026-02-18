from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Iterable, List, Sequence

from datetime import date, datetime

from deepgram import DeepgramClient
from tqdm import tqdm

from .config import PathConfig, ensure_output_dir
from .formatters import TranscriptSummary, extract_utterances, format_srt, format_text_transcript, summarize

LOGGER = logging.getLogger(__name__)


def _json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()  # type: ignore[return-value]
        except Exception:
            pass
    return str(value)


class TranscriptFormat(str, Enum):
    TEXT = "text"
    SRT = "srt"

    @classmethod
    def from_csv(cls, value: str | None) -> List["TranscriptFormat"]:
        if not value:
            return [cls.TEXT, cls.SRT]
        formats: List["TranscriptFormat"] = []
        for item in value.split(","):
            item = item.strip().lower()
            if not item:
                continue
            try:
                formats.append(cls(item))
            except ValueError as exc:
                raise ValueError(f"Unsupported format '{item}'. Choose from: text,srt.") from exc
        return formats or [cls.TEXT, cls.SRT]


@dataclass(frozen=True)
class TranscriptionJob:
    source_path: Path
    relative_dir: Path
    output_root: Path

    @property
    def stem(self) -> str:
        return self.source_path.stem

    @property
    def target_dir(self) -> Path:
        return (self.output_root / self.relative_dir).resolve()


@dataclass
class TranscriptionResult:
    job: TranscriptionJob
    status: str
    message: str | None = None
    outputs: dict[str, str] = field(default_factory=dict)
    summary: TranscriptSummary | None = None
    error: str | None = None

    def manifest_entry(self) -> dict:
        entry = {
            "source": str(self.job.source_path),
            "status": self.status,
            "message": self.message,
            "outputs": self.outputs or None,
            "duration": self.summary.duration if self.summary else None,
            "confidence": self.summary.confidence if self.summary else None,
            "speakerCount": self.summary.speaker_count if self.summary else None,
        }
        if self.error:
            entry["error"] = self.error
        return entry


def discover_jobs(paths: PathConfig) -> List[TranscriptionJob]:
    """Enumerate mp4 files and produce jobs that mirror the input directory structure."""
    jobs: List[TranscriptionJob] = []
    ensure_output_dir(paths.output_dir)
    for file_path in sorted(paths.input_dir.rglob("*.mp4")):
        try:
            if paths.output_dir in file_path.parents:
                continue
            relative = file_path.relative_to(paths.input_dir).parent
        except ValueError:
            relative = Path(".")
        jobs.append(
            TranscriptionJob(
                source_path=file_path,
                relative_dir=relative,
                output_root=paths.output_dir,
            )
        )
    return jobs


class TranscribeRunner:
    def __init__(
        self,
        api_key: str,
        formats: Sequence[TranscriptFormat],
        overwrite: bool = False,
        dry_run: bool = False,
        max_concurrency: int = 1,
        language: str = "en",
        summaries: bool = False,
        max_retries: int = 3,
    ) -> None:
        self.client = DeepgramClient(api_key=api_key)
        self.formats = list(dict.fromkeys(formats))  # preserve order, remove duplicates
        self.overwrite = overwrite
        self.dry_run = dry_run
        self.max_concurrency = max(1, max_concurrency)
        self.language = language
        self.summaries = summaries
        self.max_retries = max(1, max_retries)

    async def run(self, jobs: Sequence[TranscriptionJob]) -> List[TranscriptionResult]:
        if not jobs:
            LOGGER.info("No .mp4 files found. Nothing to do.")
            return []

        semaphore = asyncio.Semaphore(self.max_concurrency)
        results: List[TranscriptionResult] = []
        progress = tqdm(total=len(jobs), desc="Transcribing", unit="file")
        try:
            tasks = [asyncio.create_task(self._process_job(job, semaphore)) for job in jobs]
            for coro in asyncio.as_completed(tasks):
                result = await coro
                results.append(result)
                progress.update(1)
        finally:
            progress.close()
        return results

    def _expected_outputs(self, job: TranscriptionJob) -> dict[str, Path]:
        directory = job.target_dir
        return {
            "json": directory / f"{job.stem}.deepgram.json",
            "text": directory / f"{job.stem}.transcript.md",
            "srt": directory / f"{job.stem}.srt",
        }

    def _should_skip(self, job: TranscriptionJob, outputs: dict[str, Path]) -> bool:
        if self.overwrite:
            return False
        required = [outputs["json"]]
        if TranscriptFormat.TEXT in self.formats:
            required.append(outputs["text"])
        if TranscriptFormat.SRT in self.formats:
            required.append(outputs["srt"])
        return all(path.exists() for path in required)

    async def _process_job(
        self,
        job: TranscriptionJob,
        semaphore: asyncio.Semaphore,
    ) -> TranscriptionResult:
        outputs = self._expected_outputs(job)
        if self._should_skip(job, outputs):
            return TranscriptionResult(job=job, status="skipped", message="Already transcribed.")

        if self.dry_run:
            return TranscriptionResult(job=job, status="skipped", message="Dry run (no API call).")

        async with semaphore:
            try:
                payload = await asyncio.to_thread(self._transcribe_with_retry, job)
            except Exception as exc:  # pragma: no cover - surfaced to CLI
                LOGGER.exception("Failed to transcribe %s", job.source_path)
                return TranscriptionResult(
                    job=job,
                    status="failed",
                    error=str(exc),
                    message="Deepgram request failed.",
                )

        ensure_output_dir(outputs["json"].parent)
        utterances = extract_utterances(payload)
        summary = summarize(payload, utterances)
        written = self._write_outputs(outputs, payload, utterances)
        return TranscriptionResult(
            job=job,
            status="success",
            outputs={key: str(path) for key, path in written.items()},
            summary=summary,
            message=f"Wrote {len(written)} files.",
        )

    def _transcribe_with_retry(self, job: TranscriptionJob) -> dict:
        delay = 2.0
        for attempt in range(1, self.max_retries + 1):
            try:
                return self._transcribe_sync(job)
            except Exception as exc:
                if attempt >= self.max_retries:
                    raise
                LOGGER.warning(
                    "Retrying %s after error (%s/%s): %s",
                    job.source_path,
                    attempt,
                    self.max_retries,
                    exc,
                )
                time.sleep(delay + random.uniform(0, 0.5))
                delay = min(delay * 2, 30.0)

    def _transcribe_sync(self, job: TranscriptionJob) -> dict:
        with job.source_path.open("rb") as source_file:
            buffer = source_file.read()
        response = self.client.listen.v1.media.transcribe_file(
            request=buffer,
            model="nova-3",
            language=self.language,
            smart_format=True,
            diarize=True,
            utterances=True,
            paragraphs=True,
            summarize="v2" if self.summaries else None,
        )
        if hasattr(response, "to_dict"):
            return response.to_dict()
        if hasattr(response, "model_dump"):
            return response.model_dump()
        if isinstance(response, dict):
            return response
        raise TypeError(f"Unexpected Deepgram response type: {type(response)}")

    def _write_outputs(
        self,
        outputs: dict[str, Path],
        payload: dict,
        utterances: Iterable[dict],
    ) -> dict[str, Path]:
        written: dict[str, Path] = {}
        outputs["json"].write_text(json.dumps(payload, indent=2, default=_json_default), encoding="utf-8")
        written["json"] = outputs["json"]
        if TranscriptFormat.TEXT in self.formats:
            text = format_text_transcript(utterances)
            outputs["text"].write_text(text + "\n", encoding="utf-8")
            written["text"] = outputs["text"]
        if TranscriptFormat.SRT in self.formats:
            srt = format_srt(utterances)
            outputs["srt"].write_text(srt + "\n", encoding="utf-8")
            written["srt"] = outputs["srt"]
        return written


def write_manifest(manifest_path: Path, results: Sequence[TranscriptionResult]) -> None:
    ensure_output_dir(manifest_path.parent)
    with manifest_path.open("w", encoding="utf-8") as manifest:
        for result in results:
            manifest.write(json.dumps(result.manifest_entry()))
            manifest.write("\n")
