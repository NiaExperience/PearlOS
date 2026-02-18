# nia-library-templates

Auto-generated library template metadata for Nia Universal HTML generation.

> **Note:** This package is auto-generated from `descriptors/library-templates.json`.
> Do not edit these files directly - run `npm run codegen` instead.

## Usage

```python
from nia_library_templates import (
    LIBRARY_TEMPLATES,
    LIBRARY_TYPES,
    get_template_by_id,
    get_templates_by_type,
    build_prompt_guidance,
)

# Get all templates
print(LIBRARY_TEMPLATES)

# Get templates by type
tool_templates = get_templates_by_type("tool")
game_templates = get_templates_by_type("game")

# Get a specific template by ID
template = get_template_by_id("counter_widget_v1")

# Generate prompt guidance for bot tools
guidance = build_prompt_guidance()
```
