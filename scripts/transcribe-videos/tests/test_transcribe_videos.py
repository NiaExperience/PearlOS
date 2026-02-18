from __future__ import annotations

import json
from pathlib import Path

import pytest

from transcribe_videos.config import PathConfig
from transcribe_videos.formatters import (
    extract_utterances,
    format_srt,
    format_text_transcript,
    summarize,
)
from transcribe_videos.runner import (
    TranscriptFormat,
    TranscribeRunner,
    TranscriptionJob,
    TranscriptionResult,
    discover_jobs,
    write_manifest,
)


SAMPLE_PAYLOAD = {
    "metadata": {"duration": 5.2},
    "results": {
        "utterances": [
            {"speaker": 0, "start": 0.0, "end": 1.5, "transcript": "hello there"},
            {"speaker": 1, "start": 1.6, "end": 2.5, "transcript": "hi back"},
            {"speaker": 0, "start": 2.6, "end": 4.0, "transcript": "great to meet you"},
        ]
    },
    "channels": [],
}


@pytest.fixture()
def tmp_paths(tmp_path: Path) -> PathConfig:
    recordings = tmp_path / "daily-recordings" / "transcribe"
    transcripts = recordings / "transcripts"
    env_path = tmp_path / ".env"
    env_path.write_text("DEEPGRAM_API_KEY=fake\n", encoding="utf-8")
    transcripts.mkdir(parents=True)
    for name in ("a.mp4", "b.mp4"):
        (recordings / name).parent.mkdir(parents=True, exist_ok=True)
        (recordings / name).write_bytes(b"fake")
    # Add artifact inside transcripts to ensure it is ignored.
    (transcripts / "a.deepgram.json").write_text("{}", encoding="utf-8")
    return PathConfig(input_dir=recordings, output_dir=transcripts, env_path=env_path)


def test_discover_jobs_skips_transcripts_folder(tmp_paths: PathConfig) -> None:
    jobs = discover_jobs(tmp_paths)
    assert len(jobs) == 2
    assert all(job.target_dir == tmp_paths.output_dir for job in jobs)
    assert {job.source_path.name for job in jobs} == {"a.mp4", "b.mp4"}


def test_transcript_formatting_round_trip() -> None:
    utterances = extract_utterances(SAMPLE_PAYLOAD)
    assert len(utterances) == 3
    text = format_text_transcript(utterances)
    assert "Speaker 0: hello there" in text
    assert "Speaker 1: hi back" in text
    assert text.count("Speaker 0:") == 2
    srt = format_srt(utterances)
    assert "1" in srt and "Speaker 0:" in srt
    summary = summarize(SAMPLE_PAYLOAD, utterances)
    assert summary.duration == pytest.approx(5.2)
    assert summary.speaker_count == 2


def test_manifest_writes_jsonl(tmp_path: Path) -> None:
    job = TranscriptionJob(
        source_path=tmp_path / "file.mp4",
        relative_dir=Path("."),
        output_root=tmp_path,
    )
    result = TranscriptionResult(
        job=job,
        status="success",
        outputs={"json": str(tmp_path / "file.deepgram.json")},
        message="done",
        summary=None,
    )
    manifest_path = tmp_path / "manifest.jsonl"
    write_manifest(manifest_path, [result])
    contents = manifest_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(contents) == 1
    parsed = json.loads(contents[0])
    assert parsed["status"] == "success"


def test_transcript_format_parser_handles_csv() -> None:
    parsed = TranscriptFormat.from_csv("text,srt")
    assert parsed == [TranscriptFormat.TEXT, TranscriptFormat.SRT]
    parsed = TranscriptFormat.from_csv(None)
    assert parsed == [TranscriptFormat.TEXT, TranscriptFormat.SRT]
    with pytest.raises(ValueError):
        TranscriptFormat.from_csv("foo")


def test_runner_skip_logic(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Patch DeepgramClient to avoid initializing the real SDK.
    class _Media:
        @staticmethod
        def transcribe_file(*_a, **_kw):
            return SAMPLE_PAYLOAD

    class _V1:
        def __init__(self) -> None:
            self.media = _Media()

    class _Listen:
        def __init__(self) -> None:
            self.v1 = _V1()

    class _StubClient:
        def __init__(self, *_args, **_kwargs):
            self.listen = _Listen()

    monkeypatch.setattr("transcribe_videos.runner.DeepgramClient", _StubClient)

    recordings = tmp_path / "input"
    outputs = tmp_path / "output"
    recordings.mkdir()
    outputs.mkdir()
    media = recordings / "clip.mp4"
    media.write_bytes(b"fake")
    job = TranscriptionJob(media, Path("."), outputs)

    runner = TranscribeRunner(api_key="test", formats=[TranscriptFormat.TEXT])
    outputs_expected = runner._expected_outputs(job)
    outputs_expected["json"].write_text("{}", encoding="utf-8")
    outputs_expected["text"].write_text("hi", encoding="utf-8")
    assert runner._should_skip(job, outputs_expected)
