export type WizardSectionKey = 'personality' | 'toneVoice' | 'rules' | 'sequenceLogic' | 'primaryObjective';

/**
 * Directive markers for structured beat content.
 * These replace the legacy '//' comment style for clearer LLM parsing.
 */
export type DirectiveMarker = 
  | '[SPEAK]'           // Spoken text to deliver
  | '[WAIT FOR RESPONSE]' // Pause and wait for user input
  | '[THEN]'            // Conditional or sequential action
  | '[TOOL CALL]'       // Tool invocation directive
  | '[IF]'              // Conditional branch start
  | '[ELSE]'            // Alternative branch
  | '[CHECK]'           // State/condition check
  | '[GOAL]';           // Beat goal statement

export const DIRECTIVE_MARKERS: DirectiveMarker[] = [
  '[SPEAK]',
  '[WAIT FOR RESPONSE]',
  '[THEN]',
  '[TOOL CALL]',
  '[IF]',
  '[ELSE]',
  '[CHECK]',
  '[GOAL]',
];

export interface WizardBeat {
  id: string;
  title: string;
  body: string;
  goal?: string;
}

export interface WizardState {
  personality: string;
  toneVoice: string;        // Separated tone/voice guidance
  rules: string;
  sequenceLogic: string;
  primaryObjective: string;
  beats: WizardBeat[];
}

export interface WizardParseResult {
  state: WizardState;
  errors: string[];
}

export interface NormalizedPrompt {
  text: string;
  state: WizardState;
}

function isLikelyJsonString(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.length) return false;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return true;
  return trimmed.includes('"PERSONALITY"') || trimmed.includes('"BEAT') || trimmed.includes('"RULES"');
}

const defaultState: WizardState = {
  personality: '',
  toneVoice: '',
  rules: '',
  sequenceLogic: '',
  primaryObjective: '',
  beats: [],
};

function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `beat-${Math.random().toString(36).slice(2, 10)}`;
}

function makeBeat(title: string, body: string, goal?: string): WizardBeat {
  return {
    id: makeId(),
    title,
    body,
    goal,
  };
}

function cleanGoal(goal: string | undefined): string | undefined {
  if (!goal) return goal;
  return goal.replace(/^GOAL\s*:\s*/i, '').trim();
}

function joinLines(values: Array<string>): string {
  return values.filter(Boolean).join('\n');
}

function coerceLines(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(coerceLines).filter(Boolean).join('\n');
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function coerceString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(coerceString).filter(Boolean).join('\n');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Transform legacy '//' directive comments to structured [MARKER] format.
 * This provides backward compatibility while outputting the new format.
 */
export function transformLegacyDirectives(line: string): string {
  // Transform legacy comment directives to new marker format
  const trimmed = line.trim();
  
  // Already has new marker format
  if (DIRECTIVE_MARKERS.some(m => trimmed.startsWith(m))) {
    return line;
  }
  
  // Legacy: // TOOL CALL: ... -> [TOOL CALL] ...
  const toolCallMatch = trimmed.match(/^\/\/\s*TOOL\s*CALL\s*:\s*(.*)$/i);
  if (toolCallMatch) {
    return `[TOOL CALL] ${toolCallMatch[1]}`;
  }
  
  // Legacy: // wait for response/reply -> [WAIT FOR RESPONSE]
  if (/^\/\/\s*wait\s+(for\s+)?(a\s+)?(response|reply|user|input|them)/i.test(trimmed)) {
    return '[WAIT FOR RESPONSE]';
  }
  
  // Legacy: // then ... / proceed to / continue to -> [THEN] ...
  const thenMatch = trimmed.match(/^\/\/\s*(then|proceed\s+to|continue\s+to|go\s+(immediately\s+)?to)\s*(.*)$/i);
  if (thenMatch) {
    return `[THEN] ${thenMatch[3] || ''}`;
  }
  
  // Legacy: // if ... -> [IF] ...
  const ifMatch = trimmed.match(/^\/\/\s*if\s+(.*)$/i);
  if (ifMatch) {
    return `[IF] ${ifMatch[1]}`;
  }
  
  // Legacy: // check if / determine if -> [CHECK] ...
  const checkMatch = trimmed.match(/^\/\/\s*(check|determine|first,?\s*determine)\s+(.*)$/i);
  if (checkMatch) {
    return `[CHECK] ${checkMatch[2]}`;
  }
  
  // Legacy: // BEAT N GOAL: ... -> [GOAL] ...
  const goalMatch = trimmed.match(/^\/\/\s*BEAT\s+\d+\s*GOAL\s*:\s*(.*)$/i);
  if (goalMatch) {
    return `[GOAL] ${goalMatch[1]}`;
  }
  
  // Generic stage direction comments that aren't markers stay as-is for now
  // but we wrap spoken text that doesn't start with // or [
  if (!trimmed.startsWith('//') && !trimmed.startsWith('[') && trimmed.length > 0) {
    // This could be spoken text - leave as-is, serializer will handle
    return line;
  }
  
  return line;
}

export function parseWizardPrompt(raw: string | undefined | null): WizardParseResult {
  if (!raw) {
    return { state: { ...defaultState }, errors: [] };
  }

  const lines = raw.split(/\r?\n/);
  const buffers: Record<WizardSectionKey, string[]> = {
    personality: [],
    toneVoice: [],
    rules: [],
    sequenceLogic: [],
    primaryObjective: [],
  };
  let activeBeat: WizardBeat | null = null;
  const beats: WizardBeat[] = [];
  let currentSection: WizardSectionKey = 'personality';
  const errors: string[] = [];

  const commitBeat = () => {
    if (activeBeat) {
      activeBeat.body = activeBeat.body.trimEnd();
      beats.push(activeBeat);
      activeBeat = null;
    }
  };

  for (const line of lines) {
    // Check for section headers - support both "=== SECTION ===" and "SECTION:" formats
    // Also capture any inline content after the header
    const sectionHeaderMatch = line.match(/^(?:===\s*)?(PERSONALITY|TONE\s*(?:\/|AND)?\s*VOICE|RULES|SEQUENCE\s*LOGIC|PRIMARY\s*OBJECTIVE|BEAT\s+(\d+))(?:\s*===)?(?:\s*:\s*|\s+)?(.*)$/i);
    
    if (sectionHeaderMatch) {
      commitBeat();
      const key = sectionHeaderMatch[1];
      const inlineContent = (sectionHeaderMatch[3] || '').trim();
      
      if (key.toUpperCase().startsWith('BEAT')) {
        const idx = Number(sectionHeaderMatch[2] || beats.length + 1);
        const label = Number.isFinite(idx) ? `BEAT ${idx}` : `BEAT ${beats.length + 1}`;
        activeBeat = makeBeat(label, inlineContent);
        currentSection = 'personality';
        continue;
      }
      const upperKey = key.toUpperCase();
      if (upperKey.includes('TONE') || upperKey.includes('VOICE')) {
        currentSection = 'toneVoice';
      } else {
        switch (upperKey) {
          case 'PERSONALITY':
            currentSection = 'personality';
            break;
          case 'RULES':
            currentSection = 'rules';
            break;
          case 'SEQUENCE LOGIC':
            currentSection = 'sequenceLogic';
            break;
          case 'PRIMARY OBJECTIVE':
            currentSection = 'primaryObjective';
            break;
          default:
            currentSection = 'personality';
            break;
        }
      }
      // Preserve inline content after section header
      if (inlineContent) {
        buffers[currentSection].push(inlineContent);
      }
      continue;
    }

    if (activeBeat) {
      // Check for goal markers (legacy and new format)
      const legacyGoalMatch = line.match(/^\s*\/\/\s*BEAT\s+\d+\s*(GOAL\s*:)?\s*(.*)$/i);
      const newGoalMatch = line.match(/^\s*\[GOAL\]\s*(.*)$/i);
      const inlineGoalMatch = line.match(/^\s*Goal\s*:\s*(.*)$/i);
      
      if (!activeBeat.goal && legacyGoalMatch) {
        const captured = legacyGoalMatch[2] ?? legacyGoalMatch[1];
        activeBeat.goal = cleanGoal(captured?.trim());
        continue;
      }
      if (!activeBeat.goal && newGoalMatch) {
        activeBeat.goal = cleanGoal(newGoalMatch[1]?.trim());
        continue;
      }
      if (!activeBeat.goal && inlineGoalMatch) {
        activeBeat.goal = cleanGoal(inlineGoalMatch[1]?.trim());
        continue;
      }
      
      // Transform legacy directives to new format
      const transformedLine = transformLegacyDirectives(line);
      activeBeat.body += (activeBeat.body ? '\n' : '') + transformedLine;
    } else {
      buffers[currentSection].push(line);
    }
  }

  commitBeat();

  const state: WizardState = {
    personality: buffers.personality.join('\n').trim(),
    toneVoice: buffers.toneVoice.join('\n').trim(),
    rules: buffers.rules.join('\n').trim(),
    sequenceLogic: buffers.sequenceLogic.join('\n').trim(),
    primaryObjective: buffers.primaryObjective.join('\n').trim(),
    beats,
  };

  // If no sections found, default to personality
  const hasContent = state.personality || state.toneVoice || 
                     state.rules || state.sequenceLogic || state.primaryObjective || state.beats.length;
  if (!hasContent) {
    errors.push('Prompt did not contain recognized sections; defaulted everything to PERSONALITY.');
    state.personality = raw.trim();
  }

  return { state, errors };
}

/**
 * Serialize wizard state to the optimized LLM prompt format.
 * 
 * Section ordering (optimized for LLM consumption):
 * 1. PERSONALITY - Identity and role (who the assistant is)
 * 2. TONE / VOICE - How to communicate (style guidance)
 * 3. RULES - Behavioral constraints
 * 4. SEQUENCE LOGIC - Flow control rules  
 * 5. PRIMARY OBJECTIVE - The main goal
 * 6. BEATS - Ordered interaction steps
 * 
 * Note: Tool definitions are sent automatically to the LLM and not included here.
 */
export function serializeWizardState(state: WizardState): string {
  const parts: string[] = [];
  
  // 1. Personality - identity first so LLM anchors on it
  parts.push('=== PERSONALITY ===', state.personality.trim());
  
  // 2. Tone/Voice - communication style (if populated)
  if (state.toneVoice?.trim()) {
    parts.push('');
    parts.push('=== TONE / VOICE ===', state.toneVoice.trim());
  }
  
  // 3. Rules - constraints
  parts.push('');
  parts.push('=== RULES ===', state.rules.trim());
  
  // 5. Sequence Logic - flow control
  parts.push('');
  parts.push('=== SEQUENCE LOGIC ===', state.sequenceLogic.trim());
  
  // 6. Primary Objective - the main goal
  parts.push('');
  parts.push('=== PRIMARY OBJECTIVE ===', state.primaryObjective.trim());

  // 7. Beats - ordered interaction steps
  state.beats.forEach((beat, idx) => {
    parts.push('');
    const heading = beat.title || `BEAT ${idx + 1}`;
    parts.push(`=== ${heading} ===`);
    const body = beat.body ? beat.body.trim() : '';
    const goalLine = beat.goal?.trim();
    const sectionLines = [] as string[];
    if (goalLine) {
      // Use new directive format for goals
      sectionLines.push(`[GOAL] ${goalLine}`);
    }
    if (body) {
      sectionLines.push(body);
    }
    parts.push(sectionLines.join('\n').trim());
  });

  return parts.join('\n').trim();
}

export function normalizeRevisedPrompt(input: unknown): NormalizedPrompt {
  // eslint-disable-next-line no-console
  console.info('[wizard logic] normalizeRevisedPrompt input', {
    inputType: typeof input,
    hasKeys: input && typeof input === 'object' ? Object.keys(input as Record<string, unknown>).length : 0,
  });

  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    if (record.revisedPrompt !== undefined) {
      return normalizeRevisedPrompt(record.revisedPrompt);
    }
    if (record.prompt !== undefined && record.PERSONALITY === undefined && record.personality === undefined) {
      return normalizeRevisedPrompt(record.prompt);
    }
  }
  // If already a string, treat as serialized prompt
  if (typeof input === 'string') {
    if (isLikelyJsonString(input)) {
      try {
        const parsed = JSON.parse(input);
        return normalizeRevisedPrompt(parsed);
      } catch {
        // fall through to string handling
      }
    }
    const parsed = buildWizardState(input).state;
    return { text: serializeWizardState(parsed), state: parsed };
  }

  if (!input || typeof input !== 'object') {
    const parsed = buildWizardState('').state;
    return { text: serializeWizardState(parsed), state: parsed };
  }

  const record = input as Record<string, unknown>;

  const personality = coerceString(record.PERSONALITY || record.personality || '');
  const toneVoice = coerceString(record['TONE / VOICE'] || record['TONE/VOICE'] || record.toneVoice || record.tone || '');
  const rulesRaw = record.RULES || record.rules || [];
  const sequenceRaw = record['SEQUENCE LOGIC'] || record.sequenceLogic || record.sequence || [];
  const objective = coerceString(record['PRIMARY OBJECTIVE'] || record.primaryObjective || '');

  const rules = Array.isArray(rulesRaw) ? rulesRaw.map(coerceString).join('\n') : coerceString(rulesRaw);
  const sequenceLogic = Array.isArray(sequenceRaw)
    ? sequenceRaw.map(coerceString).join('\n')
    : coerceString(sequenceRaw);

  const beatEntries = Object.entries(record)
    .map(([key, value]) => {
      const match = key.match(/^BEAT[-_ ]*(\d+)/i);
      if (!match) return null;
      const idx = Number(match[1]);
      if (!Number.isFinite(idx)) return null;
      return { index: idx, value };
    })
    .filter(Boolean) as Array<{ index: number; value: unknown }>;

  beatEntries.sort((a, b) => a.index - b.index);

  const beats: WizardBeat[] = beatEntries.map(entry => {
    const val = entry.value as Record<string, unknown> | string;
    if (typeof val === 'string') {
      return makeBeat(`BEAT ${entry.index}`, val, undefined);
    }
    const description = coerceLines(val?.description);
    const action = coerceLines(val?.action);
    const bodyText = coerceLines((val as Record<string, unknown>)?.BODY || (val as Record<string, unknown>)?.body);
    const directive = coerceLines((val as Record<string, unknown>)?.DIRECTIVE || (val as Record<string, unknown>)?.directive);
    const directivesArray: unknown[] = Array.isArray((val as Record<string, unknown>)?.directives)
      ? ((val as Record<string, unknown>)?.directives as unknown[])
      : Array.isArray((val as Record<string, unknown>)?.DIRECTIVES)
        ? ((val as Record<string, unknown>)?.DIRECTIVES as unknown[])
        : [];
    const directiveList = directivesArray.map(coerceLines).filter(Boolean).join('\n');
    const stepsArray: unknown[] = Array.isArray((val as Record<string, unknown>)?.STEPS)
      ? ((val as Record<string, unknown>)?.STEPS as unknown[])
      : Array.isArray((val as Record<string, unknown>)?.steps)
        ? ((val as Record<string, unknown>)?.steps as unknown[])
        : [];
    const stepsLines = stepsArray.map(coerceLines).filter(Boolean).join('\n');
    const questionsArray: unknown[] = Array.isArray((val as Record<string, unknown>)?.QUESTIONS)
      ? ((val as Record<string, unknown>)?.QUESTIONS as unknown[])
      : Array.isArray((val as Record<string, unknown>)?.questions)
        ? ((val as Record<string, unknown>)?.questions as unknown[])
        : [];
    const questionLines = questionsArray.map(q => `Question: ${coerceLines(q)}`).join('\n');
    const miscValues = Object.entries(val || {})
      .filter(([k]) => !['GOAL', 'Goal', 'goal', 'description', 'action', 'BODY', 'body', 'DIRECTIVE', 'directive', 'DIRECTIVES', 'directives', 'QUESTIONS', 'questions', 'STEPS', 'steps', '//'].includes(k))
      .map(([, v]) => coerceLines(v))
      .filter(Boolean)
      .join('\n');
    const goal = cleanGoal(coerceString(val?.goal || val?.Goal || (val as Record<string, unknown>)?.GOAL || ''));
    const inline = coerceLines((val as Record<string, unknown>)?.['//']);
    const body = joinLines([bodyText, stepsLines, description, action, directive, directiveList, questionLines, inline, miscValues]);
    return makeBeat(`BEAT ${entry.index}`, body, goal || undefined);
  });

  const state: WizardState = {
    personality,
    toneVoice,
    rules,
    sequenceLogic,
    primaryObjective: objective,
    beats,
  };

  return { text: serializeWizardState(state), state };
}

export function buildWizardState(primaryPrompt?: string | null): WizardParseResult {
  const parsed = parseWizardPrompt(primaryPrompt);
  return parsed;
}

export function reorderBeat(list: WizardBeat[], from: number, to: number): WizardBeat[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next.map((beat, idx) => ({ ...beat, title: `BEAT ${idx + 1}` }));
}
