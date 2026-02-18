# Bot Tools Manifest Integration - Complete

## ✅ Implementation Complete

Successfully integrated bot tools codegen into the build pipeline with proper dependency management.

## Architecture

```
Build Order (enforced by package dependencies):
  1. apps/pipecat-daily-bot (prebuild generates manifest)
  2. packages/features (imports manifest, builds with tool registry)
  3. apps/* (depend on @nia/features)
```

## Key Files

### Generated Artifact
- **`packages/features/generated/bot-tools-manifest.json`**
  - Auto-generated from @bot_tool decorators
  - 41 tools across 6 categories
  - Single source of truth for bot tool metadata

### Codegen Script
- **`apps/pipecat-daily-bot/scripts/generate_tool_manifest.py`**
  - Scans all @bot_tool decorated functions
  - Extracts metadata (name, description, category, parameters)
  - Outputs JSON manifest

### TypeScript Integration
- **`packages/features/src/botToolsRegistry.ts`**
  - Imports manifest JSON
  - Exports type-safe API
  - Combines interface tools + bot tools

### Python Integration
- **`packages/features/python/nia_bot_tools/__init__.py`**
  - Python package for manifest access
  - Validation helpers
  - Category filtering

## Build Integration

### 1. Pipecat-Daily-Bot Package

**`apps/pipecat-daily-bot/package.json`:**
```json
{
  "scripts": {
    "generate:tool-manifest": "cd bot && poetry run python ../scripts/generate_tool_manifest.py",
    "prebuild": "npm run generate:tool-manifest",
    "build": "npm run build:ui && cd bot && poetry install..."
  }
}
```

**Effect:** Manifest is auto-generated before every build

### 2. Features Package

**`packages/features/package.json`:**
```json
{
  "dependencies": {
    "@nia/prism": "*",
    "pipecat-daily-bot": "*"  // ← Added dependency
  }
}
```

**`packages/features/tsconfig.json`:**
```json
{
  "compilerOptions": {
    "resolveJsonModule": true  // ← Enable JSON imports
  },
  "include": ["src/**/*.ts", "generated/**/*.json"]  // ← Include manifest
}
```

**Effect:** Features package depends on pipecat-daily-bot, ensuring manifest exists before build

### 3. Turbo Build Order

Turbo automatically respects package dependencies:
1. `pipecat-daily-bot` builds first (generates manifest)
2. `@nia/features` builds second (imports manifest)
3. Apps build third (use @nia/features)

## Usage Examples

### TypeScript (Interface/Dashboard/NCP)

```typescript
import { 
  getBotToolNames, 
  getBotToolsByCategory,
  isBotTool,
  getAllRegisteredTools 
} from '@nia/features';

// Get all bot tools (41 tools)
const botTools = getBotToolNames();

// Get tools by category
const notesTools = getBotToolsByCategory('notes'); // 16 tools

// Check if tool is from bot
if (isBotTool('bot_create_note')) {
  console.log('This is a bot tool');
}

// Get ALL tools (interface + bot)
const allTools = getAllRegisteredTools(); // ~85 tools
```

### Python (Mesh/Prism/Actions)

```python
from nia_bot_tools import (
    get_tool_names,
    get_tools_by_category,
    is_valid_tool_name
)

# Get all bot tools
bot_tools = get_tool_names()  # 41 tools

# Validate FunctionalPrompt featureKey
if is_valid_tool_name('bot_create_note'):
    print('Valid tool!')

# Get tools by category
notes_tools = get_tools_by_category('notes')  # 16 tools
```

## Manifest Structure

```json
{
  "generated_at": "2025-10-24T16:21:09.539527+00:00",
  "version": "1.0.0",
  "tool_count": 41,
  "category_count": 6,
  "tool_names": ["bot_create_note", ...],
  "categories": ["notes", "view", "window", "youtube", "profile", "misc"],
  "tools": {
    "bot_create_note": {
      "name": "bot_create_note",
      "description": "Create a new note",
      "category": "notes",
      "parameters": {...},
      "passthrough": true
    }
  },
  "by_category": {
    "notes": ["bot_create_note", "bot_update_note", ...]
  }
}
```

## Build Commands

### Manual Manifest Generation
```bash
cd apps/pipecat-daily-bot
npm run generate:tool-manifest
```

### Build Features Package
```bash
npm run build -w packages/features
```

### Build All (Respects Dependencies)
```bash
turbo build
```

## Benefits

✅ **No Hardcoding** - Tool names defined once in @bot_tool decorators
✅ **Build-Time Generation** - Manifest auto-updates on every build
✅ **Type Safety** - TypeScript types generated from manifest
✅ **Cross-Language** - Works in Python and TypeScript
✅ **Dependency Management** - Turbo ensures correct build order
✅ **Single Source of Truth** - Decorators are the only definition point

## Migration Path

### Before (Hardcoded)
```typescript
// packages/features/src/featurePrompts.ts
export const ALL_REGISTERED_TOOLS = [
  'bot_create_note',
  'bot_update_note',
  // ... 39 more hardcoded tools
];
```

### After (Auto-Generated)
```typescript
// packages/features/src/botToolsRegistry.ts
import manifest from '../generated/bot-tools-manifest.json';
export const BOT_TOOL_NAMES = manifest.tool_names; // Auto-generated!
```

## Verification

Test the integration:

```bash
# 1. Build pipecat (generates manifest)
cd apps/pipecat-daily-bot
npm run build

# 2. Verify manifest exists
ls -l ../../packages/features/generated/bot-tools-manifest.json

# 3. Build features (imports manifest)
cd ../../packages/features
npm run build

# 4. Test the module
node -e "const {getBotToolNames} = require('./dist/packages/features/src/botToolsRegistry.js'); console.log(getBotToolNames().length)"
# Expected: 41
```

## Next Steps

1. ✅ **Manifest Generation** - Complete
2. ✅ **Build Integration** - Complete
3. ✅ **TypeScript Module** - Complete
4. ✅ **Python Module** - Complete
5. ✅ **Dependency Chain** - Complete
6. ⏸️ **FunctionalPrompt Validation** - Use manifest for featureKey validation
7. ⏸️ **CI/CD Integration** - Add checks for manifest staleness
8. ⏸️ **Pre-commit Hook** - Warn if manifest out of date

## Troubleshooting

### Manifest Not Found Error
**Problem:** TypeScript can't find manifest.json
**Solution:** Run `npm run build -w apps/pipecat-daily-bot` first

### Stale Manifest
**Problem:** New tools added but not in manifest
**Solution:** Run `npm run generate:tool-manifest -w apps/pipecat-daily-bot`

### Build Order Issues
**Problem:** Features builds before pipecat
**Solution:** Check package.json dependencies include `"pipecat-daily-bot": "*"`

## Files Modified

### Created
- `/apps/pipecat-daily-bot/scripts/generate_tool_manifest.py`
- `/packages/features/generated/bot-tools-manifest.json`
- `/packages/features/generated/README.md`
- `/packages/features/python/nia_bot_tools/__init__.py`
- `/packages/features/src/botToolsRegistry.ts`
- `/packages/features/examples/bot-tools-usage.ts`
- `/packages/features/python/example_bot_tools_usage.py`

### Modified
- `/apps/pipecat-daily-bot/package.json` - Added prebuild, generate:tool-manifest
- `/packages/features/package.json` - Added pipecat-daily-bot dependency
- `/packages/features/tsconfig.json` - Added resolveJsonModule, included generated/
- `/packages/features/src/featurePrompts.ts` - Refactored to use botToolsRegistry
- `/packages/features/src/index.ts` - Exported bot tools functions

## Success Metrics

- ✅ 41 bot tools auto-discovered from decorators
- ✅ 0 hardcoded tool lists remaining
- ✅ Build order enforced via package dependencies
- ✅ Type-safe imports in TypeScript
- ✅ Python package validates tool names
- ✅ Manifest updates automatically on build
- ✅ Cross-platform compatibility (Python + TypeScript)
