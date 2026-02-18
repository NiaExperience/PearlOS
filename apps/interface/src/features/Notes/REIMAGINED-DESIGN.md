# Notes Reimagined — Design Document

## Aesthetic Direction: "Obsidian Editorial"

A dark, warm editorial aesthetic — like a luxury magazine printed on obsidian paper. The interface feels like a creative atelier where Pearl (the AI) is your ever-present creative partner.

### Core Principles

1. **Warmth in darkness** — Rich charcoal (#0a0a0b) base with amber (#e8a849) and warm cream (#f0e6d3) accents. Not cold-tech-dark, but gallery-at-night dark.

2. **Typography as identity** — Playfair Display for titles (serif gravitas), DM Sans for body (modern clarity). Notes titles are set large, cinematic. The typography alone should make this feel premium.

3. **Pearl's ambient presence** — A softly breathing amber orb in the corner. Not a chatbot bubble — more like a candle flame indicating creative energy. It pulses gently when "listening," glows steady when idle.

4. **The sidebar as gallery wall** — Notes appear as cards with generous spacing, subtle hover lift, and a thin amber accent line on the selected item. Feels like browsing a curated collection.

5. **Canvas over textarea** — The editing area uses a centered, narrow column (like a book page) with generous margins. Content has typographic weight. Markdown renders inline.

6. **Document mode ribbon** — A minimal horizontal selector at the top of the canvas: Note · Outline · Document · Presentation. Each mode subtly shifts the canvas feel.

7. **Motion philosophy** — Fade-up on entry, smooth crossfade between notes, typewriter cursor blink on the title. Restraint over spectacle — every animation serves the feeling of "content materializing."

### Color Tokens

| Token | Value | Use |
|-------|-------|-----|
| `--obsidian` | `#0a0a0b` | Base background |
| `--charcoal` | `#141416` | Card/panel background |
| `--graphite` | `#1e1e22` | Elevated surfaces |
| `--smoke` | `#2a2a30` | Borders, dividers |
| `--ash` | `#6b6b76` | Secondary text |
| `--cream` | `#f0e6d3` | Primary text |
| `--amber` | `#e8a849` | Accent, Pearl indicator |
| `--amber-dim` | `#e8a84933` | Subtle highlights |
| `--rose` | `#c45c5c` | Destructive actions |

### What's Different from the Original

The original `notes-view.tsx` is a 3000-line workhorse — full offline queue, PDF processing, sharing controls, fuzzy search. This reimagined version focuses on the *experience layer*: how it feels to browse, create, and edit. It uses the same API surface but strips back to core flows, betting on aesthetics and Pearl's presence as the differentiator.

The vision: eventually, you don't type at all. You speak, Pearl listens, and beautiful documents materialize on the canvas.
