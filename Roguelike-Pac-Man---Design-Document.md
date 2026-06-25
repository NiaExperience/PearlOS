# Roguelike Pac-Man - Design Document

## Concept

**Title:** NEON CHOMP  
**Genre:** Roguelike Arcade / Meta-Progression Maze Runner  
**Aesthetic:** 80s neon pixel arcade -- glowing CRT scanlines, hot pink and electric blue palettes, pulsing grid floors, and a synthwave soundtrack that escalates with each floor.

NEON CHOMP takes the universally understood language of Pac-Man -- eat pellets, avoid ghosts, grab power-ups -- and layers roguelike depth on top of it. Every run is a fresh procedural maze with permadeath stakes, but every pellet you eat feeds a persistent meta-progression system that makes your next run slightly more powerful. The ghosts start brainless and gradually evolve predatory intelligence across floors, forcing you to adapt your route planning in real time. The result is a game that feels immediately familiar on the first quarter but reveals strategic depth over dozens of hours.

The visual hook is an arcade cabinet that never existed in 1983 -- neon wireframe mazes humming with particle effects, ghosts that leave phosphor trails, and power-ups that detonate in chromatic pixel explosions. It looks like Tron ate Pac-Man.

---

## Core Loop

### Single Run Structure

1. **Floor Entry.** The player spawns in a procedurally generated maze. Each floor has a fixed pellet count, a set of ghost spawners, and 1-3 bonus item spawns.
2. **Pellet Collection.** The primary objective is clearing all pellets (or reaching a score threshold on timed floors). Each pellet eaten contributes to in-run score AND persistent Chomp XP.
3. **Ghost Evasion / Hunting.** Ghosts roam the maze using AI that scales per floor. Power Pellets temporarily flip the script, letting the player eat ghosts for bonus score.
4. **Floor Cleared.** Clearing the pellet threshold opens the exit warp. The player may continue collecting bonus items or leave immediately.
5. **Between Floors.** A brief shop/upgrade screen lets the player spend in-run currency (bonus pellets, ghost bounties) on temporary run buffs.
6. **Death = Run Over.** A single ghost touch kills the player. All in-run buffs are lost. Chomp XP and any unlock progress are banked permanently.

### Run Duration Target

- Early runs (new player): 3-5 floors, ~5 minutes.
- Mid-game runs (some unlocks): 8-12 floors, ~15 minutes.
- Late-game runs (deep meta): 15-25+ floors, ~30 minutes.

---

## Progression Systems

### Chomp XP (Persistent Meta-Currency)

Every pellet eaten across every run contributes to a single lifetime counter: **Chomp XP**. This is the backbone of meta-progression.

| Chomp XP Milestone | Unlock |
|---|---|
| 500 | Speed Pellet (power-up slot 1) |
| 1,500 | Ghost Scanner (UI upgrade -- shows ghost patrol routes) |
| 3,000 | Double Chomp (2x pellet value for first 30 seconds of each floor) |
| 6,000 | Warp Tunnel Reroute (new maze feature -- one-way shortcuts) |
| 10,000 | Phase Shift (power-up slot 2) |
| 18,000 | Neon Armor (survive one ghost hit per run) |
| 30,000 | Maze Architect (choose from 3 procedural seeds per floor) |
| 50,000 | Ghost Whisperer (convert one ghost to ally per run) |
| 80,000 | Chromatic Overload (ultimate power-up slot) |
| 100,000+ | Prestige ranks -- cosmetic skins, leaderboard badges, challenge modifiers |

### Power-Up Loadout

As players unlock power-ups through Chomp XP, they gain access to a **loadout screen** at run start. Initially the player has zero power-up slots. Slots unlock at XP milestones, and the player fills them from their unlocked pool.

- **Slot 1** unlocks at 500 XP.
- **Slot 2** unlocks at 10,000 XP.
- **Slot 3** unlocks at 50,000 XP.

This creates meaningful pre-run decisions: do you bring defensive tools (Neon Armor, Phase Shift) or aggressive ones (Ghost Magnet, Chromatic Overload)?

### Run Currency: Bonus Pellets

Distinct from Chomp XP, **Bonus Pellets** are earned within a run from ghost bounties, secret rooms, and streak bonuses. They are spent at the between-floor shop on temporary buffs:

- Speed boost (current floor only)
- Extended power pellet duration
- Ghost slow field
- Pellet magnet radius
- Extra life token (consumed on death, resumes current floor)

Bonus Pellets do NOT persist across runs. This keeps the in-run economy feeling high-stakes.

---

## Enemy AI Evolution

The ghost AI is the heart of NEON CHOMP's difficulty curve. Each ghost type starts with a simple behavior pattern and gains new capabilities as the run progresses.

### Ghost Types

**BLINKY (Red) -- The Hunter**
- Floors 1-3: Random wandering with occasional drift toward the player.
- Floors 4-6: Direct chase -- pathfinds to the player's current tile.
- Floors 7-10: Predictive chase -- pathfinds to where the player will be in 3 seconds based on current heading.
- Floors 11+: Pack signaling -- coordinates with other Blinkys to cut off escape routes.

**PINKY (Pink) -- The Ambusher**
- Floors 1-3: Patrols a fixed route near the maze center.
- Floors 4-6: Targets 4 tiles ahead of the player (classic Pinky behavior).
- Floors 7-10: Learns from player deaths -- prioritizes corridors where the player has previously died.
- Floors 11+: Sets traps -- parks at tunnel exits and intersection chokepoints.

**INKY (Cyan) -- The Erratic**
- Floors 1-3: Pure random movement.
- Floors 4-6: Flanking behavior -- tries to mirror Blinky's position relative to the player.
- Floors 7-10: Feint behavior -- charges toward the player then veers away, herding them toward other ghosts.
- Floors 11+: Learns the player's preferred escape routes and blocks them.

**CLYDE (Orange) -- The Coward / Berserker**
- Floors 1-3: Retreats when within 8 tiles of the player.
- Floors 4-6: Alternates between retreat and sudden charge (unpredictable).
- Floors 7-10: Berserker mode -- charges at 1.5x speed when player is on a pellet streak.
- Floors 11+: Becomes a "mini-boss" with a larger hitbox and shockwave attack that blocks adjacent corridors temporarily.

### Adaptation Mechanics

Beyond floor-based escalation, ghosts adapt within a single run based on player behavior:

- **Route Memory.** Ghosts track the corridors the player uses most frequently and begin to pre-position there.
- **Power Pellet Anticipation.** After the player eats 2+ power pellets on a floor, ghosts on subsequent floors start retreating BEFORE the player reaches the power pellet.
- **Death Learning.** If the player dies in a specific corridor pattern (e.g., always cornered in T-junctions), ghosts will prioritize herding the player toward those patterns in the next run's later floors.
- **Difficulty Spike Events.** Every 5 floors, a "Glitch Wave" event spawns an extra ghost with behaviors from 3 floors ahead of the current AI tier.

---

## Power-Up Catalog

### Loadout Power-Ups (Persistent, Chosen Pre-Run)

| Power-Up | Unlock | Effect |
|---|---|---|
| **Speed Pellet** | 500 XP | +20% movement speed for 5 seconds after eating any pellet. Stacks duration. |
| **Phase Shift** | 10,000 XP | Activate to pass through walls for 2 seconds. 1 use per floor. |
| **Neon Armor** | 18,000 XP | Survive one ghost hit per run. Hit triggers a 1-second invincibility burst. |
| **Ghost Magnet** | 25,000 XP | During Power Pellet mode, ghosts are pulled toward you instead of fleeing. Easier chain-eating. |
| **Maze Architect** | 30,000 XP | At floor start, choose from 3 procedural maze layouts. See a minimap preview. |
| **Ghost Whisperer** | 50,000 XP | Once per run, convert a ghost to an ally that chases other ghosts for 30 seconds. |
| **Chromatic Overload** | 80,000 XP | Nuclear power pellet. All ghosts become edible for 15 seconds. Screen floods with neon particle effects. 1 use per run. |

### In-Maze Pickups (Found During Runs)

| Pickup | Effect |
|---|---|
| **Cherry Bomb** | Clears all ghosts on screen (they respawn after 5 seconds). |
| **Freeze Frame** | All ghosts freeze for 4 seconds. Player moves at 1.5x speed. |
| **Pellet Doubler** | Next 20 pellets eaten count double for Chomp XP and score. |
| **Tunnel Key** | Opens a secret shortcut tunnel on the current floor. |
| **Ghost Lens** | Reveals ghost patrol paths for 10 seconds. |
| **Streak Shield** | Protects your pellet eating streak from resetting on the next near-miss. |
| **Warp Star** | Instantly teleports to a random uncollected pellet cluster. |

---

## Procedural Maze Generation

### Generation Rules

Mazes are built from a library of hand-designed **chunks** (5x5 tile segments) that are assembled procedurally. This ensures every maze feels navigable and fair while still surprising.

- **Connectivity guarantee.** Every pellet must be reachable. Dead ends exist but are limited to 15% of corridors.
- **Escape routes.** Every corridor segment must have at least 2 exits (no single-entry traps except marked dead ends).
- **Ghost spawn distance.** Ghost spawners are always placed at least 12 tiles from the player start.
- **Power pellet placement.** Power pellets are placed at strategic choke points, never in wide-open areas. Each floor has 2-4 power pellets depending on ghost count.
- **Scaling.** Mazes grow from 15x15 on floor 1 to a max of 31x31 by floor 15. Beyond floor 15, size stays fixed but internal density increases.

### Special Floor Types (Every 5 Floors)

- **Floor 5: The Gauntlet.** A long, narrow maze with minimal branching. High ghost density. Pure twitch skill test.
- **Floor 10: The Labyrinth.** Massive maze (35x35) with low ghost count but complex dead-end patterns. Rewards exploration.
- **Floor 15: The Arcade.** Classic fixed Pac-Man layout recreated in neon. Nostalgic but with evolved ghost AI.
- **Floor 20: The Void.** Invisible walls revealed only by proximity. Player must navigate by memory and ghost reactions.
- **Floor 25: The Showdown.** Boss floor -- a single oversized ghost with unique attack patterns in an arena-style maze.

---

## Visual and Audio Direction

### Visual Style

- **CRT Filter.** Subtle scanlines, slight screen curvature, phosphor bloom on bright elements. Toggleable for accessibility.
- **Color Palette.** Dominated by hot pink (#FF1493), electric cyan (#00FFFF), neon green (#39FF14), and deep purple (#1A0033) backgrounds.
- **Particle Systems.** Pellets emit small glow particles when eaten. Power pellets detonate in expanding rings. Ghost deaths produce pixel-burst explosions.
- **Ghost Trails.** Each ghost leaves a fading phosphor trail in its color, letting players read patrol patterns visually.
- **Maze Walls.** Rendered as glowing wireframe edges with subtle pulse animations. Different floor types have distinct wall styles (circuit board, laser grid, pixel brick).
- **Screen Effects.** Power Pellet mode inverts ghost colors and adds chromatic aberration. Glitch Wave events corrupt the screen with brief VHS-style artifacts.

### UI Design

- **HUD.** Minimal -- score counter (top left), Chomp XP bar (top right), lives/armor indicator (bottom left), floor number (bottom right). All rendered in pixel font with neon glow.
- **Between-Floor Shop.** Styled as an arcade cabinet select screen with scanline overlay. Items displayed on a rotating grid.
- **Death Screen.** Slow-motion ghost collision, screen static burst, then a clean stats readout showing pellets eaten, floors cleared, Chomp XP earned.
- **Loadout Screen.** Neon-lit locker room aesthetic. Power-ups displayed as glowing chips slotted into a circuit board.

### Audio Direction

- **Soundtrack.** Synthwave / chiptune hybrid. Each floor has a procedurally layered track that adds instruments as the pellet count decreases (building tension). Boss floors get distinct composed tracks.
- **SFX.** Crunchy 8-bit pellet chomp sounds. Analog synth stings for ghost encounters. Reverb-heavy death sound. Satisfying cascading chime for ghost chain-eats.
- **Dynamic Audio.** Music tempo increases when ghosts are within 5 tiles. Power Pellet mode triggers a bass-heavy remix of the current floor's track. Low health (no armor) adds a heartbeat sub-bass.

---

## Technical Considerations

### Platform Targets

- **Primary:** Web (HTML5 Canvas / WebGL). Instant play, no install friction.
- **Secondary:** Desktop (Electron or native) and mobile (touch controls with swipe-to-steer).

### Performance

- Target 60fps on mid-range hardware. Particle effects and CRT filter are the main GPU costs -- both should degrade gracefully.
- Maze generation runs at floor transition (budget: <200ms). Pre-generate next floor while current floor is in play.
- Ghost AI pathfinding uses A* with cached path segments. Recalculate only when player changes corridor or ghost enters a new zone.

### State Management

- **Run state** is ephemeral -- held in memory, discarded on death.
- **Meta state** (Chomp XP, unlocks, loadouts) persists to local storage with optional cloud sync.
- **Ghost adaptation data** (route memory, death patterns) persists within a run only. Resets on death.
- **Leaderboards** require server-side validation of run replays to prevent cheating. Replays are compact (sequence of directional inputs + seed).

### Procedural Generation

- Maze chunks are stored as small tile arrays. Assembly uses wave function collapse constrained by connectivity rules.
- Seed-based generation ensures reproducibility for challenge modes and leaderboard verification.
- Ghost behavior parameters are deterministic given the floor number and adaptation state, making replays exact.

### Accessibility

- Full keyboard, controller, and touch support.
- CRT filter, screen shake, and chromatic aberration are toggleable.
- Ghost color-blind mode adds distinct shape overlays to each ghost type.
- Adjustable game speed (0.5x to 2x) for practice mode (disables leaderboard).

---

## Monetization Philosophy (If Applicable)

- **No pay-to-win.** Chomp XP cannot be purchased. All unlocks are earned through play.
- **Cosmetics only.** Alternate neon color themes, ghost skins, maze tile sets, and custom death animations.
- **Starter pack.** One-time purchase that includes a handful of cosmetics and a permanent +10% Chomp XP earning rate (convenience, not power).
- **Challenge packs.** Curated sets of modifier rules (e.g., "all ghosts are Blinkys," "maze is dark," "reversed controls") with unique cosmetic rewards.

---

## Summary

NEON CHOMP is Pac-Man rebuilt for the roguelike era. The immediate accessibility of pellet-eating and ghost-dodging hooks players in seconds. The meta-progression and adaptive AI keep them coming back for dozens of hours. The 80s neon aesthetic gives it a striking visual identity that stands out in both screenshots and streams. Every run teaches you something new about the ghosts. Every pellet brings you closer to the next unlock. Every death makes you hungrier for one more quarter.
