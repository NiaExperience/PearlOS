# Wonder Canvas Icon System

## Problem

Emojis (🌲 ✨ 🏃 etc.) render inconsistently across devices:
- Show as boxes/tofu in headless Chromium
- Render differently on iOS vs Android vs desktop
- Don't support color customization
- Can't be animated with CSS

## Solution

Inline SVG icon library that works inside the sandboxed Wonder Canvas iframe.

## Usage for LLMs generating Wonder Canvas HTML

### Quick Start

Always include the WonderIcons library at the top of your HTML:

```html
<script>
const WonderIcons = {
  tree: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L8 8h8l-4-6zm0 6L7 14h10l-5-6zm0 6v6m-2 0h4"/></svg>',
  // ... (include all icons you'll use)
  get: function(name, cls) { 
    const icon = this[name]; 
    if (!icon) return ''; 
    return cls ? icon.replace('w-icon', 'w-icon ' + cls) : icon; 
  }
};
</script>
<style>
.w-icon { display:inline-block; width:1.25em; height:1.25em; vertical-align:-0.25em; stroke-linecap:round; stroke-linejoin:round; }
.w-icon--sm { width:1em; height:1em; }
.w-icon--lg { width:2em; height:2em; }
.w-icon--xl { width:3em; height:3em; }
.w-icon--glow { filter:drop-shadow(0 0 8px currentColor); }
.w-icon--spin { animation:wIconSpin 2s linear infinite; }
@keyframes wIconSpin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
</style>
```

### In Buttons

```html
<button class="wonder-choice" data-action="forest">
  ${WonderIcons.get('tree')} Enter the Forest
</button>
```

### In Headings with Effects

```html
<h1 style="color:#ffd700">
  ${WonderIcons.get('crystal', 'w-icon--lg w-icon--glow')} You Win!
</h1>
```

### In HUD/Stats

```html
<div>
  ${WonderIcons.get('heart')} HP: 100
  ${WonderIcons.get('zap')} XP: 420
</div>
```

## Complete Icon Reference

### Navigation & Places
- `tree` - Forest, nature
- `cave` - Caves, underground
- `tower` - Buildings, towers
- `mountain` - Mountains, peaks
- `castle` - Castles, fortresses

### Actions
- `sparkle` - Magic, glow, discovery
- `run` - Running, fleeing, movement
- `sword` - Attack, combat
- `shield` - Defend, protection
- `bow` - Ranged attack
- `wand` - Magic, spells

### Items & Objects
- `crystal` - Crystals, gems
- `gem` - Jewels, treasures
- `potion` - Potions, drinks
- `scroll` - Scrolls, documents
- `key` - Keys, unlocking
- `chest` - Treasure chests

### Stats & UI
- `heart` - Health, HP, love
- `star` - XP, rating, favorite
- `zap` - Energy, power, lightning
- `flame` - Fire, heat, damage
- `trophy` - Victory, achievement
- `coin` - Currency, money

### Creatures
- `dragon` - Dragons, monsters
- `wolf` - Wolves, beasts

### Weather & Nature
- `sun` - Day, light, brightness
- `moon` - Night, darkness
- `cloud` - Weather, sky

### Directions
- `arrowUp`, `arrowDown`, `arrowLeft`, `arrowRight` - Navigation

### Utility
- `check` - Confirm, success
- `x` - Close, cancel
- `plus` - Add, increase
- `minus` - Remove, decrease

## Size Classes

- `w-icon--sm` - Small (1em)
- `w-icon--md` - Default (1.25em)
- `w-icon--lg` - Large (2em)
- `w-icon--xl` - Extra large (3em)

## Effect Classes

- `w-icon--glow` - Glowing effect with drop shadow
- `w-icon--spin` - Continuous rotation animation

## Examples

### Choice Menu
```html
<div style="display:flex;flex-direction:column;gap:10px">
  <button class="wonder-choice" data-action="forest">
    ${WonderIcons.get('tree')} Enter the Forest
  </button>
  <button class="wonder-choice" data-action="cave">
    ${WonderIcons.get('cave')} Explore the Cave
  </button>
  <button class="wonder-choice" data-action="tower">
    ${WonderIcons.get('tower')} Climb the Tower
  </button>
</div>
```

### Battle HUD
```html
<div style="position:absolute;top:20px;right:20px;background:rgba(0,0,0,0.7);padding:12px;border-radius:8px">
  ${WonderIcons.get('heart')} HP: 100 | ${WonderIcons.get('star')} XP: 420
</div>
<div style="display:flex;gap:12px">
  <button class="wonder-choice" data-action="attack">
    ${WonderIcons.get('sword')} Attack
  </button>
  <button class="wonder-choice" data-action="defend">
    ${WonderIcons.get('shield')} Defend
  </button>
  <button class="wonder-choice" data-action="flee">
    ${WonderIcons.get('run')} Flee
  </button>
</div>
```

### Victory Screen
```html
<div style="text-align:center">
  <h1 style="color:#ffd700;font-size:48px">
    ${WonderIcons.get('trophy', 'w-icon--xl w-icon--glow')}
  </h1>
  <h2>Victory!</h2>
  <p>
    ${WonderIcons.get('star')} ${WonderIcons.get('star')} ${WonderIcons.get('star')}
  </p>
</div>
```

## Full Icon Library (Copy/Paste for Wonder Canvas HTML)

```javascript
const WonderIcons = {
  tree: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L8 8h8l-4-6zm0 6L7 14h10l-5-6zm0 6v6m-2 0h4"/></svg>',
  cave: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20h18v-4c0-2-1-4-3-5 1-2 0-4-2-5-1-1-3-1-4 0-1-1-3-1-4 0-2 1-3 3-2 5-2 1-3 3-3 5v4z"/></svg>',
  tower: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="2" width="12" height="20" rx="1"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><rect x="10" y="18" width="4" height="4"/></svg>',
  mountain: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20l5-8 4 4 5-8 4 4v8H3z"/></svg>',
  castle: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20h18V10l-2-2V4h-2v2h-2V4h-2v2h-2V4H9v2H7V4H5v4L3 10v10z"/><rect x="10" y="14" width="4" height="6"/></svg>',
  sparkle: '<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z"/><path d="M19 15l.5 2.5L22 18l-2.5.5L19 21l-.5-2.5L16 18l2.5-.5z"/><path d="M5 3l.5 1.5L7 5l-1.5.5L5 7l-.5-1.5L3 5l1.5-.5z"/></svg>',
  run: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="5" r="2"/><path d="M13 8l-4 4m0 0l-3 3m3-3l2 6m-6-4l2-2"/><path d="M20 12l-3-3"/></svg>',
  sword: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 3L5 17m0 0l-2 2 2 2 2-2m-2-2l2-2"/><path d="M17.5 6.5L19 5"/></svg>',
  shield: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L4 6v6c0 5 3 9 8 10 5-1 8-5 8-10V6l-8-4z"/></svg>',
  bow: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4c2 0 4 1 4 4M20 20c-2 0-4-1-4-4m0 0L4 4m16 16L4 4"/><line x1="12" y1="12" x2="18" y2="6"/></svg>',
  wand: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="18" x2="18" y2="6"/><path d="M17 4l1 1-1 1-1-1zm2 2l1 1-1 1-1-1zm-4 4l1 1-1 1-1-1z"/></svg>',
  crystal: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L6 8h12l-6-6zm0 0v6m-6 0L4 22h16l-2-14H6z"/><line x1="12" y1="8" x2="12" y2="22"/></svg>',
  gem: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 5l-2 4 8 10 8-10-2-4H6z"/><line x1="6" y1="9" x2="18" y2="9"/><line x1="12" y1="5" x2="12" y2="19"/></svg>',
  potion: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 2h6v4l2 2v10a4 4 0 01-8 0V8l2-2V2z"/><line x1="9" y1="14" x2="15" y2="14"/></svg>',
  scroll: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2h8a2 2 0 012 2v16a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2z"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="12" y2="15"/></svg>',
  key: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7" cy="7" r="4"/><path d="M10 10l10 10m-4-4l2-2m-4-4l2-2"/></svg>',
  chest: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="10" rx="1"/><path d="M4 10V6a8 8 0 0116 0v4"/><circle cx="12" cy="15" r="1"/></svg>',
  heart: '<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
  star: '<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  zap: '<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z"/></svg>',
  flame: '<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c-1 3-2 4-4 6-2 2-3 5-3 7 0 4.42 3.58 8 8 8s8-3.58 8-8c0-2-1-5-3-7-2-2-3-3-4-6h-2z"/></svg>',
  trophy: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3h8v5a4 4 0 01-8 0V3z"/><path d="M6 4H4a2 2 0 00-2 2v2a2 2 0 002 2h2m8 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2"/><path d="M12 12v5m-3 0h6m-3 0v4"/></svg>',
  coin: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M14.5 8.5c-1-1-2.5-1-3.5 0s-1 2.5 0 3.5 2.5 1 3.5 0"/><line x1="12" y1="7" x2="12" y2="17"/></svg>',
  dragon: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5c-3 0-5 2-6 4l-2 4c0 2 1 3 2 3h12c1 0 2-1 2-3l-2-4c-1-2-3-4-6-4z"/><circle cx="9" cy="9" r="1"/><path d="M18 8l3-2m-3 6l3 1"/></svg>',
  wolf: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8l2-4 3 2m6 0l3-2 2 4m-16 4c0 4 2 8 7 8s7-4 7-8"/><circle cx="9" cy="11" r="1"/><circle cx="15" cy="11" r="1"/></svg>',
  sun: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>',
  moon: '<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>',
  cloud: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg>',
  arrowUp: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
  arrowDown: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>',
  arrowLeft: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  arrowRight: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  check: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
  x: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  plus: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  minus: '<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  get: function(name, cls) { 
    const icon = this[name]; 
    if (!icon) return ''; 
    return cls ? icon.replace('w-icon', 'w-icon ' + cls) : icon; 
  }
};
```

## CSS (Required)

```css
.w-icon {
  display: inline-block;
  width: 1.25em;
  height: 1.25em;
  vertical-align: -0.25em;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.w-icon--sm { width: 1em; height: 1em; }
.w-icon--lg { width: 2em; height: 2em; }
.w-icon--xl { width: 3em; height: 3em; }
.w-icon--glow { filter: drop-shadow(0 0 8px currentColor); }
.w-icon--spin { animation: wIconSpin 2s linear infinite; }
@keyframes wIconSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
```

## Notes for Bot

- **Always use icons instead of emojis** in Wonder Canvas HTML
- Icons inherit text color via `currentColor`
- Icons scale with font size (em-based sizing)
- Template literals with `${WonderIcons.get('name')}` work in Wonder Canvas HTML generation
- The full icon library and CSS must be included in every scene that uses icons
- Icons can be colored by setting the parent element's `color` style
