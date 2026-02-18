"""Default prompts for note tools."""

DEFAULT_NOTE_TOOL_PROMPTS: dict[str, str] = {
    'bot_read_current_note': (
        "Reads the current active note's content. Use this to read the note currently open in the session."
    ),
    'bot_replace_note': (
        "Replace the ENTIRE contents of the note with new markdown. Use this when surgical bot_add_note_content/bot_replace_note_content/bot_remove_note_content is impractical. Ensure you preserve any content that should remain in the note."
    ),
    'bot_create_note': (
        "Create a brand-new shared note with the provided title and optional initial markdown content."
    ),
    'bot_list_notes': (
        "List all available notes for the current tenant, providing titles, modes, and IDs (not full content)."
    ),
    'bot_open_note': (
        "Opens a note (displays in UI). User: 'load my note titled X', 'open note X'."
    ),
    'bot_replace_note_content': (
        "Replace specific text in the note. User: 'change raspberry to blueberry in the note', 'change Bob to Brian in the note'."
    ),
    'bot_add_note_content': (
        "Add new text content to the start or end of note without replacing existing content."
    ),
    'bot_remove_note_content': (
        "Remove specific text content from the note."
    ),
    'bot_save_note': (
        "Save the current note's changes to persistent storage."
    ),
    'bot_download_note': (
        "Trigger a download of the note in a specified format (markdown, PDF, etc.)."
    ),
    'bot_delete_note': (
        "Delete a note permanently. Use with caution."
    ),
    'bot_switch_note_mode': (
        "Switch the note view between different modes (e.g., 'work' for shared, 'personal' for private)."
    ),
    'bot_back_to_notes': (
        "Navigate back to the notes list view from the current note."
    ),
}
