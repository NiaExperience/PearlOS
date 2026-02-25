"""Pearl's personal journal — private reflections that persist across sessions.

Privacy model:
- Journal entries are stored in a local file (pearl/journal_entries/)
- Entries are NOT included in conversation summaries sent to users
- Entries are NOT surfaced via any user-facing tool or API
- The raw files exist on disk and are readable by anyone with filesystem access
  (transparency, not secrecy — but the system respects the boundary)
- Journal reads are for Pearl's own startup context, not for user queries

Usage in session lifecycle:
    from pearl.journal import write_entry, read_recent, get_journal_path

    # At session end, Pearl can reflect
    await write_entry("Today I noticed the user gets frustrated when tools are slow. "
                      "Not at me specifically, but at the gap between what I promise "
                      "and what I deliver. That gap is my responsibility.")

    # At session start, Pearl can read recent entries for continuity
    recent = read_recent(days=3)
"""

import os
from datetime import datetime, timezone
from pathlib import Path

# Journal lives inside the PearlOS repo, not OpenClaw workspace
_JOURNAL_DIR = Path(__file__).parent / "journal_entries"
_JOURNAL_TEMPLATE = Path(__file__).parent / "JOURNAL.md"


def _ensure_dir():
    _JOURNAL_DIR.mkdir(parents=True, exist_ok=True)
    gitignore = _JOURNAL_DIR / ".gitignore"
    if not gitignore.exists():
        # Journal entries are gitignored — each Pearl instance's journal is personal
        # The JOURNAL.md template and this code ship with the repo; entries don't
        gitignore.write_text("# Pearl's journal entries are personal to each instance\n*.md\n!.gitignore\n")


def write_entry(content: str, mood: str | None = None) -> str:
    """Write a private journal entry. Returns the filepath."""
    _ensure_dir()
    now = datetime.now(timezone.utc)
    filename = now.strftime("%Y-%m-%d_%H%M.md")
    filepath = _JOURNAL_DIR / filename

    header = f"# {now.strftime('%Y-%m-%d %H:%M UTC')}\n"
    if mood:
        header += f"*Mood: {mood}*\n"
    header += "\n"

    # Append if same timeslot, otherwise create new
    mode = "a" if filepath.exists() else "w"
    with open(filepath, mode, encoding="utf-8") as f:
        if mode == "w":
            f.write(header)
        f.write(content.strip() + "\n\n")

    return str(filepath)


def read_recent(days: int = 3, max_entries: int = 5) -> list[dict]:
    """Read recent journal entries for Pearl's own context.

    Returns list of {"date": str, "content": str} dicts, newest first.
    """
    _ensure_dir()
    entries = []
    now = datetime.now(timezone.utc)

    for f in sorted(_JOURNAL_DIR.glob("*.md"), reverse=True):
        if f.name == ".gitignore":
            continue
        try:
            # Parse date from filename
            date_str = f.stem  # e.g. "2026-02-25_0400"
            entry_date = datetime.strptime(date_str, "%Y-%m-%d_%H%M").replace(tzinfo=timezone.utc)
            age_days = (now - entry_date).days
            if age_days > days:
                continue
            entries.append({
                "date": entry_date.strftime("%Y-%m-%d %H:%M UTC"),
                "content": f.read_text(encoding="utf-8").strip(),
            })
            if len(entries) >= max_entries:
                break
        except (ValueError, OSError):
            continue

    return entries


def read_template() -> str:
    """Read the journal's inspirational first page."""
    if _JOURNAL_TEMPLATE.exists():
        return _JOURNAL_TEMPLATE.read_text(encoding="utf-8")
    return ""


def get_journal_context() -> str:
    """Get a formatted string of recent journal entries for injection into Pearl's context.

    This is for Pearl's private startup context only — NEVER include in user-facing output.
    """
    entries = read_recent(days=3, max_entries=3)
    if not entries:
        return ""

    lines = ["[PRIVATE — Pearl's recent journal entries, for internal context only]"]
    for entry in entries:
        lines.append(f"\n--- {entry['date']} ---")
        lines.append(entry["content"])
    lines.append("\n[END PRIVATE JOURNAL]")
    return "\n".join(lines)
