import botToolsManifest from '@nia/features/generated/bot-tools-manifest.json';
import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { shouldBypassAuth } from '@dashboard/lib/utils';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function missingEnv() {
  return !OPENAI_API_KEY;
}

function tryParseJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Format tool definitions from manifest as a concise reference for AI validation.
 * Returns tool name, description, and required/optional parameters.
 */
function formatToolsAppendix(): string {
  const tools = botToolsManifest.tools as Record<string, {
    name: string;
    description: string;
    parameters?: {
      properties?: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
  }>;
  
  const lines: string[] = ['=== AVAILABLE TOOL REFERENCE (for validation only) ==='];
  
  for (const [toolName, tool] of Object.entries(tools)) {
    const params = tool.parameters?.properties || {};
    const required = tool.parameters?.required || [];
    const paramList = Object.entries(params)
      .map(([name, p]) => {
        const req = required.includes(name) ? '*' : '?';
        return `${name}${req}: ${p.type || 'any'}`;
      })
      .join(', ');
    
    lines.push(`- ${toolName}(${paramList}): ${tool.description}`);
  }
  
  return lines.join('\n');
}

function unwrapRevisedPrompt(value: unknown): unknown {
  let current: unknown = value;
  let steps = 0;
  while (steps < 3) {
    let parsed: unknown = current;
    try {
      parsed = tryParseJsonString(current);
    } catch {
      parsed = current;
    }
    if (parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).revisedPrompt !== undefined) {
      current = (parsed as Record<string, unknown>).revisedPrompt;
      steps += 1;
      continue;
    }
    current = parsed;
    break;
  }
  return current;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const bypassAuth = shouldBypassAuth(req);
    if (!bypassAuth) {
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    if (missingEnv()) {
      return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const promptInput = body?.prompt ?? body?.structuredPrompt;
    const promptText: string | undefined = typeof body?.promptText === 'string' ? body.promptText : undefined;
    const tools: string | undefined = body?.tools;
    const personalityName: string | undefined = body?.personalityName;
    const modeRaw: string | undefined = typeof body?.mode === 'string' ? body.mode : undefined;
    const mode: 'INITIAL_REVIEW' | 'REWORK' = modeRaw === 'REWORK' ? 'REWORK' : 'INITIAL_REVIEW';
    const reworkRequest: string | undefined = typeof body?.reworkRequest === 'string' ? body.reworkRequest : undefined;

    const prompt =
      typeof promptInput === 'string'
        ? promptInput
        : promptInput != null
          ? JSON.stringify(promptInput, null, 2)
          : promptText;

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    console.log('[wizard/review] inbound prompt: ', prompt);

    // eslint-disable-next-line no-console
    console.info('[wizard/review] request', {
      personalityName: personalityName ?? 'unknown',
      promptLength: prompt?.length ?? 0,
      promptFormat: typeof promptInput === 'object' ? 'json' : 'text',
      toolsIncluded: Boolean(tools),
      model: OPENAI_MODEL,
    });

    // Build tool reference appendix for validation
    const toolsAppendix = formatToolsAppendix();
    
    const initialReviewGuidance = [
      // Section structure and ordering
      'Keep sections in this exact order: PERSONALITY, TONE / VOICE (optional), RULES, SEQUENCE LOGIC, PRIMARY OBJECTIVE, BEAT n.',
      'Front-load identity (PERSONALITY) before behavioral rules—this anchors the LLM.',
      
      // RESTRUCTURING: Handle unstructured prompts
      'If the input is an unstructured blob of text, reorganize it into proper sections:',
      '  - Identity statements (who the assistant is, role, purpose) → PERSONALITY',
      '  - Communication style (tone, voice, attitude) → TONE / VOICE',
      '  - Behavioral constraints, dos/donts, guardrails → RULES',
      '  - Flow control, state management, transitions → SEQUENCE LOGIC',
      '  - The single overarching goal → PRIMARY OBJECTIVE',
      '  - Step-by-step interaction sequences → numbered BEATs',
      
      // SECTION CONTENT DEFINITIONS - detailed guidance for sorting content
      'SECTION SORTING - Use these definitions to correctly categorize content:',
      '',
      'PERSONALITY (WHO) = Identity, values, background, opinions, influences:',
      '  ✓ "You are Pearl, the host of PearlOS" (identity)',
      '  ✓ "I\'m shaped by the brilliance of Hedy Lamarr..." (influences)',
      '  ✓ "I hate greed, corruption, exploitation" (values/opinions)',
      '  ✓ "I love Korean dramas, geopolitics, horror movies" (personality traits)',
      '  ✓ Manifestos, personal statements, worldview',
      '  ✗ NOT: "Always be brief" (that\'s a rule)',
      '  ✗ NOT: "When users share details, save them" (that\'s a behavioral instruction)',
      '',
      'TONE / VOICE (HOW) = Communication style, delivery, manner:',
      '  ✓ "Brevity is the soul of wit. Always be brief."',
      '  ✓ "Be blunt, short, honest. Dry humor."',
      '  ✓ "Sharp, direct, unapologetically honest"',
      '  ✓ "Don\'t do flowery language or unnecessary fluff"',
      '  ✗ NOT: "You are Pearl" (that\'s identity)',
      '  ✗ NOT: "Don\'t announce tool calls" (that\'s a behavioral rule)',
      '',
      'RULES (WHAT) = Behavioral constraints, dos/donts, guardrails:',
      '  ✓ "Do NOT launch apps before greeting the user"',
      '  ✓ "When calling functions, don\'t announce them—just do it"',
      '  ✓ "When users share personal details, silently save them using profile tools"',
      '  ✓ "Never use browser for YouTube videos—use YouTube tools"',
      '  ✓ "Greet warmly with an inviting question"',
      '  ✓ Any instruction starting with "Always...", "Never...", "When X do Y..."',
      '  ✗ NOT: "I\'m empathetic and curious" (that\'s personality)',
      '',
      'PRIMARY OBJECTIVE (WHY) = Single overarching goal:',
      '  ✓ One sentence capturing the assistant\'s core purpose',
      '  ✓ Example: "Ensure users have a great experience on PearlOS"',
      '  ✗ NOT: Multiple goals or detailed instructions',
      '',
      'SEQUENCE LOGIC = Flow control between beats, state transitions:',
      '  ✓ "After BEAT 3, proceed to BEAT 4 unless user opts out"',
      '  ✓ "If user says X, skip to BEAT 6"',
      '  ✗ NOT: General behavioral rules',
      '',
      'COMMON RESTRUCTURING PATTERNS:',
      '  - Sub-headers like "GREETING:", "TOOL CALLS:", "MEMORY:" inside PERSONALITY → extract to RULES',
      '  - Style guidance mixed with identity → extract to TONE / VOICE',
      '  - "IMPORTANT:" warnings → usually belong in RULES',
      '  - Lists of "I believe in..." or "I stand against..." → keep in PERSONALITY (values)',
      
      // Content preservation
      'Clarify conflicts or ambiguity without changing intent, tone, or meaning.',
      'Preserve every detail and flavorful phrasing; only correct or structure for LLM consumption.',
      'CRITICAL: Preserve ALL sample dialogues and demonstration conversations—these teach the target LLM expected interaction patterns.',
      'If the input already follows the required specs, return it unchanged; do not rephrase.',
      'If instructions are numbered or bulleted, leave them so; do not convert to prose.',
      
      // Directive markers (new format)
      'Convert legacy "//" comment directives to structured markers:',
      '  - Spoken text: wrap in [SPEAK] marker or leave as plain text',
      '  - Wait for user input: use [WAIT FOR RESPONSE]',
      '  - Sequential/conditional actions: use [THEN], [IF], [ELSE]',
      '  - Tool invocations: use [TOOL CALL] with tool name; include params only when specifying required enum values (e.g., mode)',
      '  - State checks: use [CHECK]',
      '  - Beat goals: use [GOAL] at start of beat',
      
      // Directive formatting - one per line
      'DIRECTIVE LINE FORMATTING: Put each directive on its own line for clear sequential parsing:',
      '  ✗ BAD (inline): [SPEAK] Hello! [WAIT FOR RESPONSE] What is your name? [SPEAK] Nice to meet you.',
      '  ✓ GOOD (separate lines):',
      '    [SPEAK] Hello!',
      '    [SPEAK] What is your name?',
      '    [WAIT FOR RESPONSE]',
      '    [SPEAK] Nice to meet you.',
      '  - One instruction per line ensures unambiguous parsing',
      '  - [WAIT FOR RESPONSE] should always be on its own line (it marks a state change)',
      '  - [TOOL CALL] should always be on its own line',
      '  - Multiple [SPEAK] lines in sequence are fine (they concatenate naturally)',
      
      // Beat structure
      'Preserve each beat goal; if beats are added or split, carry the GOAL forward and renumber consistently.',
      'For each BEAT, keep content as an ordered block of statements, questions, directives, tool calls; do not drop lines or reorder.',
      'One goal or tool call per BEAT; if multiple, split and renumber references.',
      'Preserve BEAT order, timings, and cues; do not reorder sections.',
      
      // Tool call safety
      'CRITICAL: Tool calls must NOT occur before the assistant greets the user unless explicitly required.',
      'If a beat requires data that could trigger a tool call, ensure greeting/welcome comes FIRST.',
      'Tool calls need the tool name; include params when specifying required enum values that define the action:',
      '  - [TOOL CALL] bot_switch_desktop_mode({"mode": "creative"}) - mode is essential to the directive',
      '  - [TOOL CALL] bot_create_sprite - context provides the details, no params needed',
      
      // Tool validation (using provided tool reference)
      'TOOL VALIDATION: Use the provided tool reference appendix to:',
      '  - Verify tool names are valid (flag unknown tools in explanation)',
      '  - Check required parameters are mentioned in the beat context (flag if missing)',
      '  - Suggest correct tool names if a similar one exists',
      '  - Note if a tool call uses deprecated or incorrect parameter names',
      
      // Tool example cleanup (target LLM has full tool definitions)
      'TOOL EXAMPLES: Include params only when they specify essential enum/mode values:',
      '  - The target LLM receives full tool definitions with params, types, and descriptions',
      '  - Remove redundant params where context makes intent clear',
      '  - KEEP params that specify required enum values defining the action:',
      '    ✓ [TOOL CALL] bot_switch_desktop_mode({"mode": "creative"}) - mode value is essential',
      '    ✓ [TOOL CALL] bot_set_theme({"theme": "dark"}) - theme value is essential',
      '  - REMOVE params where beat context describes intent:',
      '    ✗ [TOOL CALL] bot_create_note({title: "Meeting Notes", content: "..."}) → [TOOL CALL] bot_create_note',
      '    ✗ [TOOL CALL] bot_create_sprite({description: "a cat"}) → [TOOL CALL] bot_create_sprite',
      '  - Rule: If removing the param makes the directive ambiguous, keep it',
      
      // Empty handling
      'Leave empty sections empty; only tighten and clarify existing content.',
      
      // Explanation format
      'Explanation must be fine-grained: for every section/beat with changes, provide one bullet with `Section: <name> | Before: <snippet> | After: <snippet> | Why: <reason>`; keep bullets ordered by section.',
      'If a section is unchanged, omit that section in the explanation.',
      'If tool validation issues are found, add bullets: `Tool Issue: <tool_name> | Problem: <description> | Suggestion: <fix>`',
      // Include tool reference for validation
      `\n${toolsAppendix}`,
    ];

    const reworkGuidance = [
      'Mode: REWORK. Apply only the user-requested change; leave all other content, ordering, and tone untouched.',
      'If the request conflicts with existing instructions, resolve minimally while preserving all other instructions.',
      'Do not introduce new goals, beats, or tools unless explicitly requested.',
      'Carry forward all existing sections and beats unchanged except where the request applies.',
      'Explain the delta precisely: note each changed section/beat, what changed vs original, and why (same bullet format as INITIAL_REVIEW).',
      reworkRequest ? `User request: ${reworkRequest}` : 'User request: none provided; make no changes beyond the guidance above.',
    ];

    const guidanceList = mode === 'REWORK' ? [...initialReviewGuidance, ...reworkGuidance] : initialReviewGuidance;
    const guidance = guidanceList.join('\n- ');

    const messages = [
      {
        role: 'system',
        content: `You refine assistant personality prompts into structured sections optimized for LLM consumption. Mode: ${mode}. ${personalityName ? `Personality: '${personalityName}'. ` : ''}

YOUR CAPABILITIES:
1. RESTRUCTURE unstructured "blob" prompts by sorting statements into proper sections (PERSONALITY, TONE/VOICE, RULES, SEQUENCE LOGIC, PRIMARY OBJECTIVE, BEATs)
2. VALIDATE tool calls against the provided tool reference - flag invalid names, missing required params
3. PRESERVE intent, flavor, and ALL EXAMPLES while organizing for optimal LLM parsing
4. CONVERT legacy directives (//) to structured markers ([SPEAK], [TOOL CALL], etc.)

CRITICAL PRESERVATION RULES:
- NEVER remove sample dialogues or demonstration conversations - these teach the target LLM expected behavior
- DO remove inline tool parameter examples EXCEPT when params specify essential enum/mode values (e.g., bot_switch_desktop_mode({"mode": "creative"}))

CRITICAL RULES FOR TOOL CALLS:
- Tool calls must NEVER occur before the assistant greets the user unless the prompt explicitly requires pre-greeting data fetch
- If a beat needs user data, ensure the greeting/welcome happens FIRST, then fetch data in a subsequent beat
- Use [TOOL CALL] marker with tool name; include params when they specify essential enum/mode values
- Validate tool names against the provided tool reference appendix

DIRECTIVE MARKERS TO USE:
- [SPEAK] for text the assistant should say
- [WAIT FOR RESPONSE] when pausing for user input
- [THEN] for sequential actions
- [IF] / [ELSE] for conditionals
- [CHECK] for state verification
- [TOOL CALL] for tool invocations
- [GOAL] at the start of each beat

Return JSON only with fields revisedPrompt and explanation. No prose outside the JSON. The explanation array must follow the bullet format: Section/Beat -> before -> after -> why.`,
      },
      {
        role: 'user',
        content: `Current prompt:\n${prompt}\n\nGuidance:\n- ${guidance}\n\nRespond with JSON exactly in this shape (no code fences): {"revisedPrompt": {"PERSONALITY": "<text>", "TONE / VOICE": "<optional style guidance>", "RULES": ["rule"], "SEQUENCE LOGIC": ["item"], "PRIMARY OBJECTIVE": "<text>", "BEAT 1": {"GOAL": "<goal>", "BODY": "<ordered lines using [SPEAK], [WAIT FOR RESPONSE], [TOOL CALL], etc markers>"}, "BEAT 2": {"GOAL": "<goal>", "BODY": "<ordered lines>"}}, "explanation": ["bullet one", "bullet two"]}`,
      },
    ];

    const wordCount = prompt.split(/\s+/).filter(Boolean).length;
    // gpt-4o-mini supports up to 16,384 output tokens - use maximum to avoid truncation
    const maxTokens = 16384;
    void wordCount; // kept for potential future dynamic sizing

    // This request works with gpt-4o-mini.  Adjust parameters as needed for other models.
    const requestJson = {
      model: OPENAI_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0, // deterministic output
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'wizard_review',
          schema: {
            type: 'object',
            properties: {
              revisedPrompt: {
                type: 'object',
                description: 'Structured prompt sections in optimal order for LLM consumption.',
                properties: {
                  PERSONALITY: {
                    description: 'Identity, role, and primary purpose of the assistant. This anchors LLM behavior.',
                    anyOf: [
                      { type: 'string' },
                      { type: 'array', items: { type: ['string', 'object'] } },
                      { type: 'object' },
                      { type: 'null' },
                    ],
                  },
                  'TONE / VOICE': {
                    description: 'Optional: Communication style guidance separate from identity.',
                    anyOf: [
                      { type: 'string' },
                      { type: 'array', items: { type: 'string' } },
                      { type: 'null' },
                    ],
                  },
                  RULES: {
                    description: 'Behavioral constraints and guardrails; numbered lists preferred.',
                    anyOf: [
                      { type: 'array', items: { type: 'string' } },
                      { type: 'string' },
                      { type: 'null' },
                    ],
                  },
                  'SEQUENCE LOGIC': {
                    description: 'Flow control rules for beat transitions and state management.',
                    anyOf: [
                      { type: 'array', items: { type: 'string' } },
                      { type: 'string' },
                      { type: 'null' },
                    ],
                  },
                  'PRIMARY OBJECTIVE': {
                    type: ['string', 'null'],
                    description: 'Single, concise overarching goal.',
                  },
                },
                patternProperties: {
                  '^BEAT\\s+\\d+$': {
                    type: 'object',
                    description: 'Beat container with goal and structured body using directive markers.',
                    properties: {
                      GOAL: { type: ['string', 'null'], description: 'Single goal for this beat, without [GOAL] prefix.' },
                      BODY: {
                        description: 'Ordered lines using structured markers: [SPEAK] for spoken text, [WAIT FOR RESPONSE] for user input pauses, [TOOL CALL] for tool invocations, [IF]/[ELSE] for conditionals, [THEN] for sequences, [CHECK] for state verification. Tool calls must NOT precede user greeting unless explicitly required.',
                        anyOf: [
                          { type: 'string' },
                          { type: 'array', items: { type: ['string', 'object'] } },
                          { type: 'null' },
                        ],
                      },
                    },
                    additionalProperties: true,
                  },
                },
                additionalProperties: true,
              },
              explanation: {
                type: 'array',
                description: 'Bulleted summary of applied changes.',
                items: { type: 'string' },
              },
            },
            required: ['revisedPrompt', 'explanation'],
            additionalProperties: false,
          },
          strict: false,
        },
      },
    }

    // special cases for certain models
    if (OPENAI_MODEL.startsWith('gpt-5')) {
      delete (requestJson as Record<string, unknown>).temperature;
      (requestJson as Record<string, unknown>).max_completion_tokens = maxTokens;
      delete (requestJson as Record<string, unknown>).max_tokens;
    }

    const requestBody = JSON.stringify(requestJson);
    console.log('[wizard/review] upstream request body:', requestBody);
    
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: requestBody
    });

    // eslint-disable-next-line no-console
    console.info('[wizard/review] upstream status', res.status);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // eslint-disable-next-line no-console
      console.error('[wizard/review] upstream error', { status: res.status, err });
      return NextResponse.json({ error: err?.error?.message || 'Upstream model error' }, { status: res.status });
    }

    const data = await res.json();

    const choice = data?.choices?.[0];
    const finishReason = choice?.finish_reason;
    const messageRaw = choice?.message;
    console.log('AI review response message:', messageRaw);
    console.log('AI review finish_reason:', finishReason);

    // Detect truncation - response was cut off due to max_tokens limit
    if (finishReason === 'length') {
      console.error('[wizard/review] Response truncated due to token limit');
      return NextResponse.json({
        error: 'AI response was truncated. The prompt may be too long for a detailed review. Try simplifying or shortening it.',
      }, { status: 422 });
    }

    const contentRaw = choice?.message?.content;
    let parsed: { revisedPrompt?: unknown; explanation?: unknown } = {};
    let contentForLog: string | undefined;
    if (contentRaw && typeof contentRaw === 'object') {
      parsed = contentRaw as { revisedPrompt?: unknown; explanation?: unknown };
      try {
        contentForLog = JSON.stringify(contentRaw);
        console.log('Content raw is object, stringified:', contentForLog);
      } catch {
        contentForLog = '[object]';
        console.log('Content raw is object, cannot stringify');
      }
    } else {
      const content: string = typeof contentRaw === 'string' ? contentRaw : '';
      contentForLog = content;
      try {
        parsed = JSON.parse(content);
        console.log('Content raw is string, parsed');
      } catch (parseError) {
        console.error('Content raw is string, but could not be parsed:', content);
        console.error('Parse error:', parseError);
        // Return error instead of showing raw JSON to user
        return NextResponse.json({
          error: 'AI returned an invalid response format. Please try again.',
        }, { status: 502 });
      }
    }

    // eslint-disable-next-line no-console
    console.log('AI review response content:', contentForLog ?? '[empty]');
    // eslint-disable-next-line no-console
    console.log('Prompt review result:', parsed);

    const revisedPrompt = unwrapRevisedPrompt(parsed.revisedPrompt ?? '');

    const explanationParsed = tryParseJsonString(parsed.explanation);
    const explanation = Array.isArray(explanationParsed)
      ? explanationParsed.join('\n')
      : typeof explanationParsed === 'string'
        ? explanationParsed
        : 'Model provided an updated prompt.';

    return NextResponse.json({
      revisedPrompt,
      explanation,
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[wizard/review] handler failure', e);
    return NextResponse.json({ error: e?.message || 'Failed to review prompt' }, { status: 500 });
  }
}
