/**
 * buildTaskPrompt — generate the single intent-rich brief sent to the
 * picking-up agent for a Studio dispatch (CREATE or EDIT mode).
 *
 * Spec source: /workspace/user/Documents/studio-dispatch-flow.md §3
 * plus Blair's per-creation-id output target refinement (2026-04-30).
 *
 * Contract:
 *   - One project => one task => one agent. The agent self-allocates time.
 *   - Output is written to a tenant/user-scoped Studio creations folder so the
 *     /api/creation/<id>/ static route can serve it back.
 *   - EDIT mode reuses the existing creationId so the play URL is stable.
 */

export type CreationKind = 'APP' | 'GAME' | 'PEARLOS';

export interface AttachedNote {
  id: string;
  title: string;
  content: string;
}

export interface SelectedSprite {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
}

export interface BuildTaskPromptInput {
  /** Raw user input from the Studio textarea. */
  userPrompt: string;
  /** Toggle from the Studio UI. */
  creationType: CreationKind;
  /** Optional notes the user attached for context. */
  attachedNotes?: AttachedNote[];
  /** Optional sprites the user pulled into the project. */
  selectedSprites?: SelectedSprite[];
  /** Assigned by the create-project route — destination dir name. */
  creationId: string;
  /** Absolute tenant/user-scoped destination path for this creation. */
  outputPath: string;
  /** When set, we're editing an existing creation; output overwrites in place. */
  editingCreationId?: string;
  /** When editing, the user's edit instructions. */
  editNotes?: string;
}

export interface BuildTaskPromptOutput {
  title: string;
  prompt: string;
}

const KIND_NOUN: Record<CreationKind, string> = {
  APP: 'app',
  GAME: 'game',
  PEARLOS: 'PearlOS module',
};

const KIND_ARTICLE: Record<CreationKind, string> = {
  APP: 'an',
  GAME: 'a',
  PEARLOS: 'a',
};

/**
 * Strip a leading "make a/an/the/some" (or "build/create" variants) so the
 * template "They're looking to make a {userPrompt}" doesn't double up.
 * For input "Make a CRM" -> "CRM"; for "build an inventory app" -> "inventory app";
 * for plain "CRM" -> "CRM" (untouched). Case-insensitive on the verb, but the
 * remaining body keeps its original casing.
 */
function normalizeUserPromptForBuildPhrase(userPrompt: string): string {
  const trimmed = (userPrompt ?? '').trim();
  if (!trimmed) return trimmed;
  // Match: optional "(I want to|I'd like to|let's) " then make/build/create
  // optionally followed by " a/an/the/some".
  const pattern =
    /^(?:(?:i\s+want\s+to|i'?d\s+like\s+to|i\s+would\s+like\s+to|let'?s|please)\s+)?(?:make|build|create|design|develop)(?:\s+(?:a|an|the|some))?\s+/i;
  const stripped = trimmed.replace(pattern, '');
  return stripped.length > 0 ? stripped : trimmed;
}

function formatNotesSection(notes: AttachedNote[] | undefined): string {
  if (!notes || notes.length === 0) return '';
  const lines = notes.map((n) => {
    const trimmed = (n.content ?? '').slice(0, 500);
    return `  - ${n.title}: ${trimmed}`;
  });
  return `Attached notes context:\n${lines.join('\n')}\n`;
}

function formatSpritesSection(sprites: SelectedSprite[] | undefined): string {
  if (!sprites || sprites.length === 0) return '';
  const lines = sprites.map((s) => {
    const details = [
      s.description ? s.description : '(no description)',
      s.imageUrl ? `asset URL: ${s.imageUrl}` : '',
    ].filter(Boolean).join('; ');
    return `  - ${s.name}: ${details}`;
  });
  return `Selected visual assets to include:\n${lines.join('\n')}\n`;
}

function normalizeOutputPath(outputPath: string): string {
  const trimmed = outputPath.trim();
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function complexPearlOSAppGuidance(userPrompt: string, kind: CreationKind): string {
  if (kind !== 'APP') return '';
  const text = userPrompt.toLowerCase();
  const looksComplex =
    /\b(pearlos|desktop app|native app|map|globe|social|api|data|live|translate|translation|swarm|deepseek|share|desktop icon|studio)\b/.test(text);
  if (!looksComplex) return '';
  return `
COMPLEX PEARLOS APP RULE:
- If the user is asking for a PearlOS desktop/native app, data-backed app, map/globe, social signals, translation, sharing, desktop icon, Studio integration, or swarm/DeepSeek leverage, do not stop at a crude static mock.
- Build the best runnable first pass at the output target, but also write pearlos-app.json with title, icon, entrypoint, capabilities, dataSourcePlan, desktopShortcut=true, shareEligible=true, and integrationNotes.
- If live provider/API access is not available, use clearly labeled public/fallback/sample data and explain the exact backend provider/API work needed. Do not claim exhaustive scraping or full live social-network coverage.
- Requested visual structures such as maps/globes/top lists/search/detail panes must exist in the runnable artifact, even if backed by fallback data.`;
}

function buildInstructions(targetCreationId: string, kind: CreationKind, outputPath: string, userPrompt: string): string {
  const normalizedOutputPath = normalizeOutputPath(outputPath);
  const outputTargetLine =
    kind === 'GAME'
      ? `   - For GAME: build HTML5 canvas + vanilla JS first. Use Godot only if the user explicitly requested Godot and it still fits the selected timebox.`
      : kind === 'PEARLOS'
      ? `   - For PEARLOS: build a self-contained prototype at ${normalizedOutputPath}index.html. Do not modify PearlOS source unless the task explicitly asks for a production code change.`
      : `   - For APP: at minimum, ${normalizedOutputPath}index.html (single-page is fine, multi-file is welcome).`;

  const complexGuidance = complexPearlOSAppGuidance(userPrompt, kind);

  return `Build instructions for the picking-up agent:
1. TIMEBOX: ship a playable first pass in 5-15 minutes. Scope down instead of expanding the schedule:
   - 5 minutes for trivial requests.
   - 10 minutes for normal apps/games.
   - 15 minutes max for complex requests, with obvious follow-ups left for later.
   Post one first note with the chosen timebox and the one thing you are building.
2. OUTPUT TARGET: write your build to ${normalizedOutputPath}
${outputTargetLine}
3. FAST BUILD RULE: for simple apps, a dependency-free index.html with inline CSS/JS is fine. For complex PearlOS/data/native requests, still keep the artifact runnable, but include the expected UI, data strategy, and registration metadata instead of a bare placeholder.
4. POST PROGRESS: if the build takes more than 5 minutes, post a one-line note with what is working.
5. ON SUCCESS: post a final note "Build complete. Output at ${normalizedOutputPath}index.html. PLAY URL: /api/creation/${targetCreationId}/" then mark task complete.
6. DIRECT RESULT RULE: generated apps and games must link directly to /api/creation/${targetCreationId}/. Do not point the user to an intermediate note unless the user explicitly asked for a note.
7. VERIFY BEFORE COMPLETE: before marking success, confirm ${normalizedOutputPath}index.html exists and the direct play URL is the result link.
8. ON FAILURE: post a clear failure note explaining what blocked you, then mark task failed.

Use HTML5 + vanilla JS + CSS unless the request specifically requires a framework. Keep file count minimal. Make it visually polished within the time budget.${complexGuidance}`;
}

function buildTitle(input: BuildTaskPromptInput): string {
  const raw = (input.userPrompt ?? '').trim();
  const truncated = raw.length <= 60 ? raw : `${raw.slice(0, 60)}...`;
  if (input.editingCreationId) {
    // Prefix with "Edit: " — keep total under 60 chars since tasks_api.py
    // truncates titles to 60. Reserve 6 for the prefix.
    const prefix = 'Edit: ';
    const room = 60 - prefix.length;
    const body =
      raw.length <= room ? raw : `${raw.slice(0, room - 3)}...`;
    return `${prefix}${body}`;
  }
  return truncated;
}

export function buildTaskPrompt(
  input: BuildTaskPromptInput
): BuildTaskPromptOutput {
  const kind = input.creationType;
  const noun = KIND_NOUN[kind];
  const article = KIND_ARTICLE[kind];

  const notesSection = formatNotesSection(input.attachedNotes);
  const spritesSection = formatSpritesSection(input.selectedSprites);
  const optionalSections = [notesSection, spritesSection]
    .filter(Boolean)
    .join('\n');

  let header: string;
  let targetCreationId: string;

  if (input.editingCreationId) {
    targetCreationId = input.editingCreationId;
    const editNotes = (input.editNotes ?? '').trim() || '(no edit notes provided — infer from the user prompt)';
    const normalizedOutputPath = normalizeOutputPath(input.outputPath);
    header = `User wants to EDIT their existing ${noun} (creationId: ${input.editingCreationId}).
Their edit notes: ${editNotes}

Read the existing build at ${normalizedOutputPath} and modify it per the user's notes.
PRESERVE the existing icon and name unless the user explicitly asked to change them.
Write your updated output back to the same path. The PLAY URL stays /api/creation/${input.editingCreationId}/.`;
  } else {
    targetCreationId = input.creationId;
    const normalized = normalizeUserPromptForBuildPhrase(input.userPrompt);
    header = `User wants to build ${article} ${noun}. They're looking to make a ${normalized}. Godot can be used to make it more visually interesting and dynamic.`;
  }

  const instructions = buildInstructions(targetCreationId, kind, input.outputPath, input.userPrompt);

  const parts: string[] = [header];
  if (optionalSections) {
    parts.push(optionalSections.trimEnd());
  }
  parts.push('---');
  parts.push(instructions);

  const prompt = parts.join('\n\n');
  const title = buildTitle(input);

  return { title, prompt };
}
