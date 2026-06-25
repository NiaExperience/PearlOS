"""Default prompts for note tools."""

DEFAULT_NOTE_TOOL_PROMPTS: dict[str, str] = {
    'bot_read_current_note': (
        "Reads the current active note's content. Use this to read the note currently open in the session."
    ),
    'bot_replace_note': (
        "Replace the ENTIRE contents of the note with new markdown. Use this when surgical bot_add_note_content/bot_replace_note_content/bot_remove_note_content is impractical. Ensure you preserve any content that should remain in the note."
    ),
    'bot_create_note': (
        "Create a brand-new note with the provided title and content. "
        "When the user has dictated or spoken content to save, ALWAYS include it in the 'content' parameter. "
        "Only omit content if the user explicitly asked for a blank note. "
        "If you need to add content to an existing note, use bot_add_note_content instead."
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
        "Save the current note to a file on disk. Notes are already saved to the database; use this when the user explicitly asks to save/export to a file."
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
    'bot_scroll_note': (
        "Scroll the currently open note to a position: 'top', 'bottom', or to a specific heading. "
        "Use heading parameter for heading-based scroll. User: 'scroll to the top', 'go to the ingredients section'."
    ),
    'bot_highlight_note_text': (
        "Highlight/emphasize a specific text passage in the currently open note so the user can see it visually. "
        "Set clear=true to remove all highlights. User: 'highlight the part about deadlines', 'show me where it mentions budget'."
    ),
    'bot_navigate_note_heading': (
        "Navigate to a specific heading or section in the currently open note, or move to the next/previous heading. "
        "User: 'go to the summary section', 'next section', 'previous heading'."
    ),
}
