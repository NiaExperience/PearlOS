"""Notes tools package."""

from .crud import (
    create_note_handler,
    read_current_note_handler,
    replace_note_handler,
    save_note_handler,
    delete_note_handler,
    # Implementations
    bot_create_note,
    bot_read_current_note,
    bot_replace_note,
    bot_save_note,
    bot_delete_note,
)
from .content import (
    replace_note_content_handler,
    add_note_content_handler,
    remove_note_content_handler,
    # Aliases for handlers (since content tools are implemented as handlers)
    replace_note_content_handler as bot_replace_note_content,
    add_note_content_handler as bot_add_note_content,
    remove_note_content_handler as bot_remove_note_content,
)
from .navigation import (
    list_notes_handler,
    open_note_handler,
    switch_note_mode_handler,
    back_to_notes_handler,
    download_note_handler,
    # Implementations
    bot_list_notes,
    bot_open_note,
    bot_switch_note_mode,
    bot_back_to_notes,
    bot_download_note,
)

__all__ = [
    # CRUD Handlers
    "create_note_handler",
    "read_current_note_handler",
    "replace_note_handler",
    "save_note_handler",
    "delete_note_handler",
    # CRUD Implementations
    "bot_create_note",
    "bot_read_current_note",
    "bot_replace_note",
    "bot_save_note",
    "bot_delete_note",
    
    # Content Handlers
    "replace_note_content_handler",
    "add_note_content_handler",
    "remove_note_content_handler",
    # Content Aliases
    "bot_replace_note_content",
    "bot_add_note_content",
    "bot_remove_note_content",
    
    # Navigation Handlers
    "list_notes_handler",
    "open_note_handler",
    "switch_note_mode_handler",
    "back_to_notes_handler",
    "download_note_handler",
    # Navigation Implementations
    "bot_list_notes",
    "bot_open_note",
    "bot_switch_note_mode",
    "bot_back_to_notes",
    "bot_download_note",
]
