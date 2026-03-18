"""
Wonder Canvas Design System Prompt
===================================
System prompt snippet that teaches the LLM how to generate beautiful
canvas HTML when no pre-built template fits. Include this in the agent's
system prompt when canvas generation is needed.
"""

CANVAS_DESIGN_SYSTEM_PROMPT = """
## Wonder Canvas Design System

When generating HTML for the Wonder Canvas, follow these design principles exactly.
The canvas renders in a dark-themed mobile webview (max 420px wide).

### Required Font Import (ALWAYS include first)
```html
<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');</style>
```

### Font Roles
- **Playfair Display** — Display/hero text, large titles, editorial headlines. Serif warmth.
- **Space Grotesk** — Labels, metadata, stats, UI text. Clean geometric sans.
- **Inter** — Body text, descriptions, paragraphs. Neutral readability.
- **JetBrains Mono** — Code, data, timestamps, technical values.

### Color Palette
```
--bg-deep: #0d0d1a          (page background)
--bg-card: rgba(18,18,35,0.92)  (card surfaces)
--bg-glass: rgba(255,255,255,0.04) (glass panels)
--c-gold: #e8c547            (highlights, achievements, warm accents)
--c-rose: #d94f8e            (labels, categories, active states)
--c-violet: #8b5cf6          (primary accent, interactive elements)
--c-sky: #38bdf8             (secondary accent, data, cool tones)
--c-emerald: #34d399         (success, positive values)
--c-amber: #fbbf24           (ratings, stars, warnings)
--c-text: #f0ece4            (primary text — warm off-white, NOT pure #fff)
--c-muted: rgba(240,236,228,0.4) (secondary/tertiary text)
```

### Design Principles
1. **NO generic AI slop** — Every layout should have editorial intent. No cookie-cutter cards.
2. **Breathing space** — Generous padding (clamp(20px,5vw,32px)), intentional whitespace.
3. **Visual hierarchy** — One hero element per view. Use font size contrast (3:1 ratio minimum between hero and body).
4. **Staggered animations** — Elements fade in sequentially using animation-delay (0.1s, 0.25s, 0.4s, 0.55s).
5. **Layered depth** — Subtle box-shadows, glass panels with backdrop-filter:blur(20px), border highlights.
6. **Content-aware** — A weather card should FEEL atmospheric. A bio should feel editorial. Match the mood.

### Animation Classes (use these or define inline)
```css
@keyframes fade-up { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
@keyframes scale-in { from{opacity:0;transform:scale(0.92)} to{opacity:1;transform:scale(1)} }
@keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
@keyframes glow { 0%,100%{filter:brightness(1)} 50%{filter:brightness(1.3)} }
@keyframes line-grow { from{width:0} to{width:40px} }
```
Apply with: `animation: fade-up 0.6s 0.2s cubic-bezier(0.22,1,0.36,1) both;`

### Layout Patterns

**Full-bleed image with text overlay:**
```html
<div style="position:relative;width:100%;min-height:100vh">
  <img style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
  <div style="position:absolute;inset:0;background:linear-gradient(0deg,rgba(10,10,26,0.9) 0%,transparent 60%)"></div>
  <div style="position:relative;z-index:2;padding:32px"><!-- content --></div>
</div>
```

**Centered content page (no card frame):**
```html
<div style="width:100%;min-height:100vh;display:flex;align-items:center;justify-content:center;
flex-direction:column;padding:clamp(24px,6vw,48px);text-align:center">
  <!-- content flows vertically -->
</div>
```

**Card with glass panels:**
```html
<div style="max-width:420px;background:rgba(18,18,35,0.92);border-radius:16px;
padding:clamp(20px,5vw,32px);backdrop-filter:blur(20px);
border:1px solid rgba(255,255,255,0.06);box-shadow:0 8px 32px rgba(0,0,0,0.3)">
  <!-- card content -->
</div>
```

### Component Patterns

**Label/category badge:**
```html
<div style="font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:500;
text-transform:uppercase;letter-spacing:0.14em;color:#d94f8e">CATEGORY</div>
```

**Decorative divider line:**
```html
<div style="width:40px;height:2px;background:linear-gradient(90deg,#d94f8e,#8b5cf6);
border-radius:1px;margin:14px 0"></div>
```

**Glass panel:**
```html
<div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:14px;
border:1px solid rgba(255,255,255,0.05)">
```

### Rules
- Use `clamp()` for ALL font sizes and padding (responsive).
- Use `{{icon:name}}` for icons (auto-resolved). Available: star, heart, flame, zap, sun, moon, cloud, trophy, check, x, arrowRight, sparkle.
- NO emoji characters (render as boxes).
- All HTML must be self-contained — inline `<style>` tags, no external CSS except the Google Fonts @import.
- Images: `object-fit:cover`, always include `onerror="this.style.display='none'"` or `this.parentElement.style.display='none'`.
- Background: ALWAYS `#0d0d1a` or similar deep dark. This renders in a dark UI.
- Max width: 420px for card-based layouts. Full-bleed layouts use 100%.

### BAD vs GOOD Examples

**BAD (generic AI slop):**
```html
<div style="background:#333;padding:20px;border-radius:10px">
  <h1 style="color:white">Title</h1>
  <p style="color:#ccc">Description text here</p>
</div>
```

**GOOD (editorial design):**
```html
<style>@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400&display=swap');</style>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;padding:clamp(20px,5vw,32px)}
@keyframes fade-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
</style>
<div style="max-width:420px;width:100%;text-align:center">
  <div style="font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:500;
  text-transform:uppercase;letter-spacing:0.14em;color:#d94f8e;margin-bottom:12px;
  animation:fade-up 0.6s 0.1s both">Category</div>
  <div style="font-family:'Playfair Display',serif;font-size:clamp(24px,7vw,36px);
  font-weight:700;color:#fff;line-height:1.2;margin-bottom:16px;
  animation:fade-up 0.6s 0.25s both">Beautiful Title</div>
  <div style="width:40px;height:2px;background:linear-gradient(90deg,#d94f8e,#8b5cf6);
  border-radius:1px;margin:0 auto 20px;animation:fade-up 0.6s 0.35s both"></div>
  <div style="font-size:clamp(14px,3.5vw,16px);line-height:1.8;color:rgba(240,236,228,0.65);
  animation:fade-up 0.6s 0.45s both">Rich body text with warm off-white color and generous line height.</div>
</div>
```

The GOOD example has: editorial typography, staggered animations, a decorative accent line, warm color palette, breathing space, and responsive sizing. The BAD example has none of these.
"""
