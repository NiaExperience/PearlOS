from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List

JsonDict = Dict[str, Any]


def extract_utterances(payload: JsonDict) -> List[JsonDict]:
    """Return a normalized list of utterances from a Deepgram response."""
    results = payload.get("results") or {}
    utterances = results.get("utterances")
    if isinstance(utterances, list) and utterances:
        return utterances

    channels = results.get("channels") or []
    if channels:
        alternatives = channels[0].get("alternatives") or []
        if alternatives:
            alt = alternatives[0]
            paragraphs = ((alt.get("paragraphs") or {}).get("paragraphs")) or []
            extracted: List[JsonDict] = []
            for paragraph in paragraphs:
                sentences = paragraph.get("sentences") or []
                for sentence in sentences:
                    extracted.append(
                        {
                            "speaker": sentence.get("speaker", paragraph.get("speaker", 0)),
                            "start": sentence.get("start", paragraph.get("start", 0.0)),
                            "end": sentence.get("end", paragraph.get("end", 0.0)),
                            "transcript": sentence.get("text")
                            or sentence.get("transcript")
                            or "",
                            "confidence": sentence.get("confidence", alt.get("confidence")),
                        }
                    )
            if extracted:
                return extracted
            transcript = alt.get("transcript")
            if transcript:
                return [
                    {
                        "speaker": alt.get("speaker", 0),
                        "start": alt.get("start", 0.0),
                        "end": alt.get("end", payload.get("metadata", {}).get("duration", 0.0)),
                        "transcript": transcript,
                        "confidence": alt.get("confidence"),
                    }
                ]
    return []


def utterance_text(utterance: JsonDict) -> str:
    return (
        utterance.get("transcript")
        or utterance.get("text")
        or utterance.get("content")
        or ""
    ).strip()


def speaker_label(value: Any) -> str:
    if value is None or value == "":
        return "Speaker ?"
    return f"Speaker {value}"


def format_text_transcript(utterances: Iterable[JsonDict]) -> str:
    """Group utterances by speaker label for a readable text transcript."""
    lines: List[str] = []
    current_speaker: str | None = None
    buffer: List[str] = []

    def flush() -> None:
        nonlocal buffer
        if current_speaker and buffer:
            lines.append(f"{current_speaker}: {' '.join(buffer).strip()}")
        buffer = []

    for utterance in utterances:
        text = utterance_text(utterance)
        if not text:
            continue
        label = speaker_label(utterance.get("speaker"))
        if label != current_speaker:
            flush()
            current_speaker = label
        buffer.append(text)
    flush()
    return "\n".join(lines).strip()


def _format_timestamp(seconds: float) -> str:
    total_ms = int(round(seconds * 1000))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def format_srt(utterances: Iterable[JsonDict]) -> str:
    """Build an SRT caption file from utterances."""
    lines: List[str] = []
    for idx, utterance in enumerate(utterances, start=1):
        text = utterance_text(utterance)
        if not text:
            continue
        start = float(utterance.get("start", 0.0))
        end = float(utterance.get("end", start + max(len(text.split()) * 0.3, 1)))
        label = speaker_label(utterance.get("speaker"))
        lines.append(str(idx))
        lines.append(f"{_format_timestamp(start)} --> {_format_timestamp(end)}")
        lines.append(f"{label}: {text}")
        lines.append("")
    return "\n".join(lines).strip()


@dataclass(frozen=True)
class TranscriptSummary:
    duration: float | None
    confidence: float | None
    speaker_count: int


def summarize(payload: JsonDict, utterances: Iterable[JsonDict]) -> TranscriptSummary:
    metadata = payload.get("metadata") or {}
    results = payload.get("results") or {}
    channels = results.get("channels") or []
    confidence = None
    if channels:
        alternatives = channels[0].get("alternatives") or []
        if alternatives:
            confidence = alternatives[0].get("confidence")
    speakers = {utterance.get("speaker") for utterance in utterances if utterance.get("speaker") is not None}
    return TranscriptSummary(
        duration=metadata.get("duration"),
        confidence=confidence,
        speaker_count=len(speakers),
    )
