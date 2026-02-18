from __future__ import annotations

# Built-in fallback descriptions used when FunctionalPrompt records are missing
DEFAULT_SHARING_TOOL_PROMPTS: dict[str, str] = {
    'bot_upgrade_user_access': (
        "Upgrade a user's access level for the current shared resource (note or applet) to read-write. "
        "Use this when the user asks to give someone more access, make them a writer, editor, collaborator, "
        "upgrade their permissions, or let them edit. Examples: 'upgrade Bill to read-write', "
        "'give Sarah edit access', 'make John a collaborator', 'let Alice write to this note'."
    ),
    'bot_downgrade_user_access': (
        "Downgrade a user's access level for the current shared resource (note or applet) to read-only. "
        "Use this when the user asks to reduce someone's access, make them a viewer, remove edit access, "
        "or restrict their permissions. Examples: 'downgrade Bill to read-only', 'make Sarah a viewer', "
        "'remove John's edit access', 'restrict Alice to view-only'."
    ),
    'bot_set_user_access_level': (
        "Set a user's access level (owner, admin, member, or viewer) for the current shared resource. "
        "Use this for precise control when the user specifies an exact role level. For simpler requests "
        "like 'upgrade' or 'downgrade', prefer using bot_upgrade_user_access or bot_downgrade_user_access instead."
    ),
    'bot_share_note_with_user': (
        "Share ownership/access to a note with another person. Use when user says: 'share my note with NAME', "
        "'give ACCESS to USER', 'let PERSON see/edit my note'. Accepts user name OR email. Permission: 'read' = view only, "
        "'write' = full edit. Example: 'share space war with Jeffrey Klug' or 'share with bill@niaxp.com, write access'."
    ),
    'bot_share_applet_with_user': (
        "Share ownership/access to an HTML applet with another person. Use when user says: 'share my applet with NAME', "
        "'give ACCESS to USER', 'let PERSON see/edit this app'. Accepts user name OR email. Permission: 'read' = view only, "
        "'write' = full edit. Example: 'share notes with Jane' or 'share with jane@example.com, read access'."
    ),
}
