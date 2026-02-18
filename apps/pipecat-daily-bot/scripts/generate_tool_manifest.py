#!/usr/bin/env python3
"""Generate bot tools manifest for cross-project consumption.

This script runs tool discovery and generates a JSON manifest that can be
imported by other parts of the codebase (mesh, prism, interface, etc.) to
get the authoritative list of bot tool names without hardcoding.

Output: packages/features/generated/bot-tools-manifest.json

Usage:
    python scripts/generate_tool_manifest.py
    
The manifest includes:
- Tool names (for FunctionalPrompt featureKey validation)
- Categories
- Descriptions
- Parameter schemas
- Last generated timestamp
"""
import json
import sys
from pathlib import Path
from loguru import logger as _logger

# Add bot directory to path for imports
bot_dir = Path(__file__).parent.parent / "bot"
sys.path.insert(0, str(bot_dir))

from tools.discovery import get_discovery


logger = _logger.bind(module="tool-manifest")


def generate_manifest() -> dict:
    """Generate tool manifest from discovery system."""
    discovery = get_discovery()
    tools = discovery.discover_tools()
    features = discovery.get_tool_features()
    
    # Build manifest with sorted entries for deterministic output
    manifest = {
        "version": "1.0.0",
        "tool_count": len(tools),
        "feature_count": len(features),
        "tool_names": sorted(tools.keys()),
        "features": sorted(features),
        "tools": {
            name: {
                "name": meta["name"],
                "description": meta["description"],
                "feature_flag": meta["feature_flag"],
                "parameters": meta["parameters"],
                "passthrough": meta.get("passthrough", False)
            }
            for name, meta in sorted(tools.items())  # Sort by tool name
        },
        "by_feature": {
            feature: sorted([
                name for name, meta in tools.items() 
                if meta["feature_flag"] == feature
            ])
            for feature in sorted(features)  # Sort features in by_feature dict
        }
    }
    
    return manifest


def main():
    """Generate and save manifest."""
    logger.info("[tool-manifest] Discovering bot tools...")
    
    try:
        manifest = generate_manifest()
        
        # Determine output path - go up to workspace root, then into packages/features/generated
        # Use absolute path to avoid issues with relative __file__
        script_path = Path(__file__).resolve()
        workspace_root = script_path.parent.parent.parent.parent
        output_dir = workspace_root / "packages" / "features" / "generated"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        output_file = output_dir / "bot-tools-manifest.json"
        
        # Short-circuit if manifest is unchanged to keep builds idempotent
        if output_file.exists():
            try:
                with open(output_file, "r") as existing_file:
                    existing_manifest = json.load(existing_file)
                if existing_manifest == manifest:
                    logger.info("[tool-manifest] ⚖️ Manifest unchanged; skipping write")
                    return 0
            except Exception:
                logger.warning("[tool-manifest] Unable to read existing manifest; regenerating")
        
        # Write manifest when new or changed
        with open(output_file, "w") as f:
            json.dump(manifest, f, indent=2, sort_keys=False)
        
        logger.info("[tool-manifest] ✅ Generated manifest with %s tools" % manifest['tool_count'])
        logger.info("[tool-manifest] 📁 Output: %s" % output_file)
        logger.info("[tool-manifest] 📋 Features: %s" % ', '.join(manifest['features']))
        logger.info(
            "[tool-manifest] 🔧 Tools: %s" % (
                ', '.join(manifest['tool_names'][:5]) + ('...' if len(manifest['tool_names']) > 5 else '')
            )
        )
        
        return 0
        
    except Exception as e:
        logger.exception("[tool-manifest] ❌ Error generating manifest: %s" % e)
        return 1


if __name__ == "__main__":
    sys.exit(main())
