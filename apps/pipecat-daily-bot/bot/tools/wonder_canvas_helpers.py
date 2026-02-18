"""Helper utilities for Wonder Canvas, including the inline icon library."""

from pathlib import Path

# Load the icon library JavaScript
_ICON_LIB_PATH = Path(__file__).parent / "wonder_canvas_icons.js"
_ICON_LIBRARY_JS = _ICON_LIB_PATH.read_text() if _ICON_LIB_PATH.exists() else ""


def get_icon_library_inline() -> str:
    """
    Get the Wonder Canvas icon library as an inline <script> tag.
    
    Include this in Wonder Canvas HTML to enable icon usage:
        WonderIcons.get('tree')    → returns SVG for a tree icon
        WonderIcons.get('sword')   → returns SVG for a sword icon
        WonderIcons.getCSS()       → returns CSS for icon styling
    
    Returns:
        str: Complete <script> tag with icon library
    """
    return f"<script>\n{_ICON_LIBRARY_JS}\n</script>"


def get_icon_library_css() -> str:
    """
    Get just the CSS portion for Wonder Canvas icons.
    
    Returns:
        str: CSS string for icon styling
    """
    return """
.w-icon {
  display: inline-block;
  width: 1.25em;
  height: 1.25em;
  vertical-align: -0.25em;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.w-icon--sm { width: 1em; height: 1em; }
.w-icon--md { width: 1.5em; height: 1.5em; }
.w-icon--lg { width: 2em; height: 2em; }
.w-icon--xl { width: 3em; height: 3em; }
.w-icon--glow { filter: drop-shadow(0 0 8px currentColor); }
.w-icon--spin { animation: wIconSpin 2s linear infinite; }
.w-icon--pulse { animation: wIconPulse 2s ease infinite; }
@keyframes wIconSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes wIconPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    """.strip()


# Icon reference for use in bot prompts/descriptions
ICON_REFERENCE = """
Available Wonder Canvas Icons (use with WonderIcons.get('name')):

Navigation & Places:
  tree, cave, tower, mountain, castle

Actions:
  sparkle, run, sword, shield, bow, wand

Items & Objects:
  crystal, gem, potion, scroll, key, chest

Stats & UI:
  heart, star, zap, flame, trophy, coin

Creatures:
  dragon, wolf

Weather & Nature:
  sun, moon, cloud

Directions:
  arrowUp, arrowDown, arrowLeft, arrowRight

Utility:
  check, x, plus, minus

Usage Example (use {{icon:name}} placeholders — auto-resolved by the canvas runtime):
  <button class="wonder-choice">{{icon:tree}} Enter Forest</button>
  <div style="color:#ffd700">{{icon:star:w-icon--lg w-icon--glow}} You Win!</div>
  
Size classes: w-icon--sm, w-icon--md, w-icon--lg, w-icon--xl
Effect classes: w-icon--glow, w-icon--spin, w-icon--pulse

DO NOT use emoji characters — they render as boxes in the canvas.
"""
