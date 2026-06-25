/**
 * Note Seeder — Kitchen Workflow (Step 3)
 *
 * Pre-populates Notes with design doc templates so Pearl can open
 * a note that already has useful structure. Templates are warm and
 * practical — Pearl wrote them, not a committee.
 */

import type { Note } from '@interface/features/Notes/types/notes-types';
import { NIA_EVENT_NOTE_OPEN } from '@interface/features/DailyCall/events/niaEventRouter';
import { requestWindowOpen } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';

export type ProjectType = 'game' | 'app' | 'feature';

// ---------------------------------------------------------------------------
// Template generators
// ---------------------------------------------------------------------------

function gameTemplate(title: string, description: string): string {
  return `# ${title}

${description}

---

## Core Loop
What does the player *do* every 30 seconds? Nail this first — everything else hangs off it.

-

## Mechanics
The verbs: move, shoot, dodge, collect, etc. Keep it to 3-4 core actions.

-

## Enemies & Hazards
What gets in the way? Start with 2-3 enemy types — you can always add more.

-

## Upgrades & Progression
What keeps them coming back? Think: unlocks, power-ups, new abilities.

-

## Systems
Score tracking, save state, difficulty scaling, audio cues — the connective tissue.

-

## Tech Constraints
Platform target, performance budget, asset pipeline notes.

- Browser/canvas, 60fps target
-

## Milestones
Bite-sized chunks. Ship the core loop first, then layer on polish.

1. **Playable core loop** — move + one enemy + one win/lose condition
2. **Content pass** — all enemies, upgrades, levels
3. **Juice pass** — screenshake, particles, sound, UI polish
4. **Ship it** — final QA, deploy, celebrate
`;
}

function appTemplate(title: string, description: string): string {
  return `# ${title}

${description}

---

## Purpose
One sentence: who is this for, and what does it let them do?

>

## Screens
Walk through the app like a user. What do they see, in order?

1. **Home** —
2. **Detail** —
3. **Settings** —

## Data Model
What are the core objects? Keep it simple — you can normalize later.

-

## Integrations
APIs, auth providers, external services this app talks to.

-

## Milestones

1. **Skeleton** — routing, layout, placeholder screens
2. **Core flow** — the main user journey works end-to-end
3. **Polish** — loading states, error handling, responsive tweaks
4. **Ship it** — deploy, test on real devices, done
`;
}

function featureTemplate(title: string, description: string): string {
  return `# ${title}

${description}

---

## User Story
As a [who], I want to [what], so that [why].

> As a _____, I want to _____, so that _____.

## Acceptance Criteria
How do we know it's done? Be specific — these become your test cases.

- [ ]
- [ ]
- [ ]

## Implementation Notes
Rough plan: where does this live in the codebase, what does it touch?

-

## Edge Cases
What could go wrong? Think: empty states, permissions, offline, slow network.

-
`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a pre-filled design doc note for a given project type.
 * Returns a Note object (without _id — the consumer decides persistence).
 */
export function seedDesignDoc(
  title: string,
  description: string,
  projectType: ProjectType,
): Omit<Note, '_id' | 'userId' | 'tenantId'> {
  const generators: Record<ProjectType, (t: string, d: string) => string> = {
    game: gameTemplate,
    app: appTemplate,
    feature: featureTemplate,
  };

  const content = (generators[projectType] ?? featureTemplate)(title, description);

  return {
    title: `Design Doc: ${title}`,
    content,
    mode: 'work',
    isPinned: true,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Dispatch a NIA_EVENT_NOTE_OPEN event with an embedded note object
 * and request the Notes window to open. This mirrors the pattern used
 * by the voice pipeline — the NotesView handler merges the note into
 * its local list and opens it for editing.
 */
export function openSeededNote(note: Note): void {
  if (typeof window === 'undefined') return;

  // Dispatch the note-open event with the full note embedded
  const detail = {
    event: 'note.open',
    envelope: {
      v: 1,
      kind: 'event' as const,
      seq: 0,
      ts: Date.now(),
      event: 'note.open',
      payload: { noteId: note._id, note },
    },
    payload: { noteId: note._id, note },
  };

  window.dispatchEvent(
    new CustomEvent(NIA_EVENT_NOTE_OPEN, { detail }),
  );

  // Also open the Notes window so it's visible
  requestWindowOpen({
    viewType: 'notes',
    options: { resourceId: note._id, resourceTitle: note.title },
    source: 'note-seeder',
  });
}
