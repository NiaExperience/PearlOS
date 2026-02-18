from __future__ import annotations

from flows.summary_tap import (
    _record_summary_metadata,
    get_last_summary,
    get_summary_version,
)


class DummyFlowManager:
    def __init__(self):
        self.state: dict[str, object] = {}
        self.current_node = "conversation"


def test_record_summary_metadata_tracks_history_and_copies():
    manager = DummyFlowManager()

    entry = _record_summary_metadata(
        manager,
        "First summary",
        {"role": "system", "content": "Here's a summary of the conversation:\nFirst summary"},
    )

    assert entry is not None
    assert entry["version"] == 1
    assert get_summary_version(manager) == 1

    # Mutate returned entry to confirm stored state uses a deep copy.
    entry["summary_text"] = "Mutated"  # type: ignore[index]
    stored = get_last_summary(manager)
    assert stored is not None
    assert stored["summary_text"] == "First summary"
    assert stored["formatted_message"] == {
        "role": "system",
        "content": "Here's a summary of the conversation:\nFirst summary",
    }

    _record_summary_metadata(manager, "Second summary", None)
    assert get_summary_version(manager) == 2

    history = manager.state["_summary_tap"]["history"]  # type: ignore[index]
    assert [item["summary_text"] for item in history] == ["First summary", "Second summary"]


def test_record_summary_metadata_trims_history():
    manager = DummyFlowManager()

    for index in range(30):
        _record_summary_metadata(manager, f"Summary {index}", None)

    history = manager.state["_summary_tap"]["history"]  # type: ignore[index]
    assert len(history) == 25
    # History should retain the most recent entries in order.
    assert history[0]["summary_text"] == "Summary 5"
    assert history[-1]["summary_text"] == "Summary 29"
    assert get_summary_version(manager) == 30
