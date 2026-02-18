# Bot Tools Manifest

This directory contains the generated manifest of all bot tools available in the pipecat-daily-bot application.

## Purpose

The manifest provides a **single source of truth** for bot tool names and metadata across the entire platform, eliminating hardcoded tool lists in multiple locations.

## Files

- **`bot-tools-manifest.json`** - Generated manifest with all tool metadata
- **`.gitignore`** - Tracks the manifest, ignores temporary files

## Usage

### Python (Prism/Mesh/Actions)

```python
from nia_bot_tools import get_tool_names, get_tools_by_category, is_valid_tool_name

# Get all tool names for FunctionalPrompt featureKey validation
tool_names = get_tool_names()

# Get tools by category
notes_tools = get_tools_by_category("notes")

# Validate a tool name
if is_valid_tool_name("bot_create_note"):
    print("Valid tool!")
```

### TypeScript (Interface/Dashboard)

```typescript
import manifest from '@nia/features/generated/bot-tools-manifest.json';

// Get all tool names
const toolNames = manifest.tool_names;

// Get tools by category
const notesTools = manifest.by_category.notes;

// Check if tool exists
const isValid = manifest.tool_names.includes('bot_create_note');
```

## Regenerating the Manifest

The manifest should be regenerated whenever:

- New tools are added with `@bot_tool` decorator
- Tool metadata changes (name, description, parameters)
- Tool categories change

### Manual Generation

```bash
cd apps/pipecat-daily-bot/bot
poetry run python ../scripts/generate_tool_manifest.py
```

### Automatic Generation (TODO)

Add to CI/CD pipeline:

1. Run on every commit to `staging-functional-tools` branch
2. Run as pre-commit hook
3. Run as part of bot build process

## Manifest Structure

```json
{
  "generated_at": "2025-10-24T16:21:09.539527+00:00",
  "version": "1.0.0",
  "tool_count": 41,
  "category_count": 6,
  "tool_names": [...],  // Sorted list of all tool names
  "categories": [...],   // Sorted list of categories
  "tools": {             // Full metadata per tool
    "bot_create_note": {
      "name": "bot_create_note",
      "description": "Create a new note",
      "category": "notes",
      "parameters": {...},
      "passthrough": true
    }
  },
  "by_category": {       // Tools grouped by category
    "notes": ["bot_create_note", "bot_update_note", ...]
  }
}
```

## Benefits

1. **No Hardcoding** - Tool names are never hardcoded across the codebase
2. **Single Source of Truth** - Decorator metadata is the only place to define tools
3. **Type Safety** - Generated manifest can be imported with types
4. **Validation** - FunctionalPrompt records can validate featureKey against manifest
5. **Discovery** - New tools automatically appear in manifest on next generation

## Integration Points

- **FunctionalPrompt Schema** - Use `manifest.tool_names` for featureKey enum validation
- **Prism Actions** - Import `nia_bot_tools` to validate tool names
- **Interface/Dashboard** - Import JSON directly for frontend validation
- **API Documentation** - Generate API docs from manifest metadata
