import * as SpriteActions from '@nia/prism/core/actions/sprite-actions';
import { NextRequest, NextResponse } from 'next/server';

import {
  completeImageGenerationTask,
  failImageGenerationTask,
  startImageGenerationTask,
  type ImageGenerationTaskHandle,
} from '@interface/lib/image-generation-tasks';
import { getLogger } from '@interface/lib/logger';
import {
  generateSpriteImage,
  getModelRankingFor,
  type SpriteKind,
  wrapPromptForKind,
} from '@interface/lib/openrouter-image';
import { cleanSpriteBackground } from '@interface/lib/sprite-postprocess';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';
import { createJob, updateJob } from './jobStore';

const log = getLogger('[api_summon_ai_sprite]');

// Default voice configuration for Sprites (PocketTTS)
const DEFAULT_SPRITE_VOICE_PROVIDER = 'pocket' as const;
const DEFAULT_SPRITE_VOICE_SPEED = 1.0;

// PocketTTS built-in voices (Les Misérables themed)
const POCKET_FEMALE_VOICES = [
  'alba', 'fantine', 'cosette', 'eponine', 'azelma'
] as const;

const POCKET_MALE_VOICES = [
  'marius', 'javert', 'jean'
] as const;

// Keywords that suggest female character
const FEMALE_KEYWORDS = [
  // Pronouns & basics
  'she', 'her', 'hers', 'woman', 'women', 'girl', 'girls', 'lady', 'ladies', 'female', 'feminine',
  // Royalty & mythology
  'queen', 'princess', 'empress', 'goddess', 'priestess', 'enchantress', 'sorceress', 'heroine',
  // Family - formal
  'mom', 'mother', 'grandmother', 'grandma', 'aunt', 'auntie', 'sister', 'wife', 'daughter', 'niece',
  // Family - informal/slang
  'mama', 'mommy', 'momma', 'nana', 'granny', 'nanny', 'mum', 'mummy', 'meemaw', 'gigi', 'gammy', 'memaw',
  'sis', 'sissy', 'big sis', 'lil sis', 'stepmom', 'stepmum',
  // Occupations/roles (traditionally feminine terms)
  'witch', 'fairy', 'mermaid', 'ballerina', 'nurse', 'waitress', 'actress', 'hostess', 'stewardess',
  'cheerleader', 'showgirl', 'cowgirl', 'schoolgirl', 'fangirl',
  // Titles
  'mrs', 'miss', 'ms', 'madame', 'dame', 'madam', 'mademoiselle', 'senorita', 'senora', 'frau', 'fraulein',
  // Slang & colloquial
  'girlie', 'girly', 'gal', 'gals', 'chick', 'chicks', 'babe', 'babe', 'dudette', 'shawty', 'shorty',
  'bitch', 'bitchy', 'queen bee', 'diva', 'vixen', 'hottie', 'cutie', 'sweetie', 'honey', 'hun',
  'bestie', 'bff', 'girlfriend', 'wifey', 'hubby', 'missy', 'lassie', 'lass', 'broad', 'dame',
  'ma', 'mamasita', 'mami', 'chica', 'mamacita', 'senorita',
  // Endearments often for females
  'princess', 'angel', 'baby girl', 'babygirl', 'sugar', 'cupcake', 'buttercup', 'pumpkin',
  // Female names (common)
  'alice', 'emma', 'sophia', 'olivia', 'ava', 'isabella', 'mia', 'charlotte',
  'amelia', 'harper', 'evelyn', 'luna', 'lily', 'rose', 'violet', 'daisy',
  'sarah', 'jessica', 'nicole', 'bella', 'aurora', 'ariel', 'elsa', 'anna',
  'emily', 'grace', 'chloe', 'zoey', 'nora', 'hannah', 'ella', 'scarlett', 'victoria', 'aria',
  'karen', 'susan', 'linda', 'barbara', 'elizabeth', 'jennifer', 'maria', 'nancy', 'betty', 'dorothy'
];

// Keywords that suggest male character
const MALE_KEYWORDS = [
  // Pronouns & basics
  'he', 'him', 'his', 'man', 'men', 'boy', 'boys', 'guy', 'guys', 'male', 'masculine',
  // Royalty & mythology
  'king', 'prince', 'emperor', 'god', 'priest', 'sorcerer', 'hero', 'villain',
  // Family - formal
  'dad', 'father', 'grandfather', 'grandpa', 'uncle', 'brother', 'husband', 'son', 'nephew',
  // Family - informal/slang
  'papa', 'daddy', 'pops', 'pappy', 'gramps', 'pawpaw', 'papi', 'poppa', 'pop', 'pa',
  'bro', 'broseph', 'broski', 'big bro', 'lil bro', 'stepdad', 'stepfather',
  // Occupations/roles (traditionally masculine terms)
  'wizard', 'knight', 'warrior', 'soldier', 'pirate', 'cowboy', 'astronaut', 'fireman', 'policeman',
  'mailman', 'businessman', 'gentleman', 'sportsman', 'craftsman', 'clergyman', 'caveman',
  'schoolboy', 'fanboy', 'playboy', 'homeboy',
  // Titles
  'mr', 'sir', 'lord', 'duke', 'baron', 'count', 'earl', 'viscount', 'master', 'mister',
  'senor', 'herr', 'monsieur',
  // Slang & colloquial
  'dude', 'dudes', 'bro', 'bros', 'bruh', 'bruv', 'fella', 'fellas', 'fellow', 'bloke', 'blokes',
  'chap', 'lad', 'lads', 'laddie', 'mate', 'homie', 'homeboy', 'dawg', 'dog', 'dawgs',
  'playa', 'player', 'pimp', 'gangsta', 'gangster', 'thug', 'og', 'boss', 'chief', 'king',
  'stud', 'hunk', 'jock', 'chad', 'alpha', 'sigma', 'daddy', 'zaddy', 'dilf', 'himbo',
  'boyfriend', 'hubby', 'wifey', 'mister', 'sonny', 'sonny boy', 'junior', 'jr',
  'pa', 'papito', 'ese', 'vato', 'hombre', 'amigo', 'compadre', 'cabron',
  // Endearments often for males
  'champ', 'sport', 'buddy', 'bud', 'pal', 'tiger', 'slugger', 'ace', 'scout', 'skipper',
  // Male names (common)
  'adam', 'michael', 'james', 'john', 'robert', 'david', 'william', 'richard',
  'charles', 'thomas', 'daniel', 'matthew', 'anthony', 'mark', 'steven', 'andrew',
  'fenrir', 'thor', 'odin', 'zeus', 'hercules', 'bob', 'joe', 'max', 'jack',
  'chris', 'jason', 'brian', 'kevin', 'eric', 'ryan', 'jacob', 'ethan', 'noah', 'liam',
  'george', 'donald', 'ronald', 'gary', 'larry', 'jerry', 'frank', 'scott', 'tony', 'greg'
];

type InferredGender = 'female' | 'male' | 'unknown';

function inferGenderFromPrompt(prompt: string): InferredGender {
  const lowerPrompt = prompt.toLowerCase();
  const words = lowerPrompt.split(/\s+/);

  let femaleScore = 0;
  let maleScore = 0;

  for (const word of words) {
    const cleanWord = word.replace(/[^a-z]/g, '');
    if (FEMALE_KEYWORDS.includes(cleanWord)) femaleScore++;
    if (MALE_KEYWORDS.includes(cleanWord)) maleScore++;
  }

  for (const keyword of FEMALE_KEYWORDS) {
    if (keyword.includes(' ') && lowerPrompt.includes(keyword)) femaleScore++;
  }
  for (const keyword of MALE_KEYWORDS) {
    if (keyword.includes(' ') && lowerPrompt.includes(keyword)) maleScore++;
  }

  if (femaleScore > maleScore) return 'female';
  if (maleScore > femaleScore) return 'male';
  return 'unknown';
}

/**
 * Pearl uses "azelma" — exclude it from the pool so summoned sprites sound distinct.
 */
function selectSpriteVoice(prompt: string): string {
  const gender = inferGenderFromPrompt(prompt);
  const femalePool = POCKET_FEMALE_VOICES.filter(v => v !== 'azelma');
  const malePool = [...POCKET_MALE_VOICES];

  let voicePool: string[];
  if (gender === 'female') {
    voicePool = femalePool;
  } else if (gender === 'male') {
    voicePool = malePool;
  } else {
    voicePool = Math.random() < 0.6 ? femalePool : malePool;
  }

  const selectedVoice = voicePool[Math.floor(Math.random() * voicePool.length)];
  log.info('Selected sprite voice (PocketTTS)', { prompt: prompt.slice(0, 50), gender, selectedVoice });
  return selectedVoice;
}

function generateSpritePersonalityPrompt(originalPrompt: string): string {
  return `You are a helpful AI sprite companion. Your appearance is described as: "${originalPrompt}".
Act according to this persona. Keep your responses concise and helpful.`;
}

function generateSpriteName(prompt: string): string {
  const words = prompt.split(' ');
  const name = words.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return name.replace(/[.,;!?]+$/, '') || 'Sprite';
}

type WorkflowStatus =
  | { type: 'log'; message: string }
  | { type: 'result'; data: Record<string, unknown> }
  | { type: 'error'; error: string; details?: string }
  | { type: 'job'; jobId: string };

function encodeStreamData(data: WorkflowStatus): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(data) + '\n');
}

/**
 * Heuristic: an already-detailed prompt does not benefit much from a Sonnet
 * enhancement round-trip and the 1–3 s latency is the dominant complaint.
 * Skip enhancement once the user has typed enough detail on their own.
 */
function promptNeedsEnhancement(userPrompt: string): boolean {
  const trimmed = userPrompt.trim();
  if (trimmed.length >= 60) return false;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 8) return false;
  return true;
}

async function enhancePromptWithLLM(userPrompt: string): Promise<string> {
  const apiKey = process.env.OPENCLAW_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  let baseUrl: string;
  let model: string;
  if (process.env.OPENCLAW_API_KEY) {
    baseUrl = process.env.OPENCLAW_API_URL || 'http://localhost:18789/v1';
    model = 'anthropic/claude-sonnet-4-5';
  } else if (process.env.OPENROUTER_API_KEY) {
    baseUrl = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    model = 'anthropic/claude-sonnet-4-5';
  } else {
    baseUrl = 'https://api.openai.com/v1';
    model = 'gpt-4o-mini';
  }

  if (!apiKey) {
    log.warn('No LLM API key configured, skipping prompt enhancement');
    return userPrompt;
  }

  const systemPrompt = `You're a pixel sprite character creator. Transform a brief character description into a fully fleshed-out visual prompt for an image-generation model. The sprite will be rendered at 256x256 to 512x512, single character on a clear white #FFFFFF background. Make sure to fill the character description with rich, colorful detail. Describe body parts, accessories, colors, textures, posture, and any important visual traits. DO NOT DESCRIBE ANY BACKGROUND OBJECTS OR SCENERY. CLEAR HEX #FFFFFF BACKGROUND only. Write only the raw character description, no preamble.`;

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.9,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      log.error('Prompt-enhance LLM call failed', { status: response.status });
      return userPrompt;
    }

    const data = await response.json();
    const enhanced = data.choices?.[0]?.message?.content?.trim();
    if (enhanced) {
      log.info('Prompt enhanced', { original: userPrompt.slice(0, 50), enhanced: enhanced.slice(0, 50) });
      return enhanced;
    }
    return userPrompt;
  } catch (error) {
    log.error('Failed to enhance prompt', { error });
    return userPrompt;
  }
}

interface QAResult {
  passed: boolean;
  score: number;
  reason: string;
  suggestion?: string;
}

/**
 * Vision QA gate against the produced PNG (passed in as base64).
 */
async function evaluateSpriteQuality(
  imageBase64: string,
  mimeType: string,
  originalPrompt: string,
): Promise<QAResult> {
  const apiKey = process.env.OPENCLAW_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  let baseUrl: string;
  let model: string;
  if (process.env.OPENCLAW_API_KEY) {
    baseUrl = process.env.OPENCLAW_API_URL || 'http://localhost:18789/v1';
    model = 'anthropic/claude-sonnet-4-5';
  } else if (process.env.OPENROUTER_API_KEY) {
    baseUrl = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    model = 'anthropic/claude-sonnet-4-5';
  } else {
    baseUrl = 'https://api.openai.com/v1';
    model = 'gpt-4o';
  }

  if (!apiKey) {
    return { passed: true, score: 0, reason: 'No API key — skipped' };
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a pixel art quality inspector. Score 1-10 on prompt adherence, visual quality, pixel-art style, character clarity, and absence of artifacts. Pass threshold: score >= 6. Respond with ONLY a JSON object: {"passed": true/false, "score": 1-10, "reason": "...", "suggestion": "..."|null}`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `User requested: "${originalPrompt}"\n\nEvaluate this generated sprite:` },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
        temperature: 0.3,
        max_tokens: 256,
      }),
    });

    if (!response.ok) {
      return { passed: true, score: 0, reason: 'API error — skipped' };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return { passed: true, score: 0, reason: 'Empty response — skipped' };

    const jsonStr = content.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const qa = JSON.parse(jsonStr) as QAResult;
    log.info('Sprite QA result', { score: qa.score, passed: qa.passed, reason: qa.reason });
    return qa;
  } catch (err) {
    log.error('Sprite QA evaluation failed', { error: err });
    return { passed: true, score: 0, reason: 'Evaluation error — skipped' };
  }
}

// Allowed character sprite output sizes (square). 256 stays the default for
// back-compat with the existing UI; 512 is opt-in via the new size field.
const CHARACTER_SIZES = [256, 512] as const;
type CharacterSize = (typeof CHARACTER_SIZES)[number];

// Background scene presets the summon flow accepts directly. For arbitrary
// dimensions callers should hit /api/pixel-art/generate with type=background.
const BACKGROUND_PRESETS: Record<string, { width: number; height: number }> = {
  '1024x576': { width: 1024, height: 576 },
  '1280x720': { width: 1280, height: 720 },
  '1920x1080': { width: 1920, height: 1080 },
  '1024x1024': { width: 1024, height: 1024 },
};

interface SpriteSizing {
  kind: SpriteKind;
  width: number;
  height: number;
  aspectRatio: string;
  imageSize: '1K' | '2K';
}

function aspectRatioStringFor(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(width, height);
  return `${width / g}:${height / g}`;
}

function resolveSizing(body: Record<string, unknown> | null): SpriteSizing | { error: string } {
  const rawKind = typeof body?.kind === 'string' ? body.kind : 'character';
  const kind: SpriteKind =
    rawKind === 'icon' || rawKind === 'character' || rawKind === 'background'
      ? (rawKind as SpriteKind)
      : 'character';

  if (kind === 'background') {
    const preset = typeof body?.preset === 'string' ? body.preset : undefined;
    const widthIn = typeof body?.width === 'number' ? body.width : undefined;
    const heightIn = typeof body?.height === 'number' ? body.height : undefined;
    let width: number;
    let height: number;
    if (preset && BACKGROUND_PRESETS[preset]) {
      ({ width, height } = BACKGROUND_PRESETS[preset]);
    } else if (
      typeof widthIn === 'number' && typeof heightIn === 'number' &&
      widthIn >= 256 && widthIn <= 4096 && heightIn >= 256 && heightIn <= 4096
    ) {
      width = Math.round(widthIn);
      height = Math.round(heightIn);
    } else {
      return {
        error: `For kind=background supply preset (${Object.keys(BACKGROUND_PRESETS).join(', ')}) or width+height in [256, 4096]`,
      };
    }
    return {
      kind,
      width,
      height,
      aspectRatio: aspectRatioStringFor(width, height),
      imageSize: '2K',
    };
  }

  if (kind === 'icon') {
    const allowed = [16, 32, 48, 64];
    const sizeIn = typeof body?.size === 'number' ? body.size : 32;
    if (!allowed.includes(sizeIn)) {
      return { error: `For kind=icon size must be one of: ${allowed.join(', ')}` };
    }
    return { kind, width: sizeIn, height: sizeIn, aspectRatio: '1:1', imageSize: '1K' };
  }

  // character (default)
  const sizeIn = typeof body?.size === 'number' ? body.size : 256;
  if (!(CHARACTER_SIZES as readonly number[]).includes(sizeIn)) {
    return { error: `For kind=character size must be one of: ${CHARACTER_SIZES.join(', ')}` };
  }
  const size = sizeIn as CharacterSize;
  return {
    kind,
    width: size,
    height: size,
    aspectRatio: '1:1',
    imageSize: size === 512 ? '2K' : '1K',
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const rawPrompt = typeof body?.prompt === 'string' ? body.prompt : '';
  const prompt = rawPrompt.trim();
  const requestedTenantId =
    typeof body?.tenantId === 'string' ? body.tenantId :
    typeof body?.tenant_id === 'string' ? body.tenant_id :
    undefined;

  if (!prompt) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  const sizing = resolveSizing(body);
  if ('error' in sizing) {
    return NextResponse.json({ error: sizing.error }, { status: 400 });
  }

  const actorResult = await resolveInterfaceActorContext({ requestedTenantId });
  if (!actorResult.ok) return actorResult.response;
  const { tenantId, userId } = actorResult.actor;
  let imageTask: ImageGenerationTaskHandle | null = null;
  try {
    imageTask = await startImageGenerationTask(request, {
      title: `Summon sprite - ${sizing.kind} ${sizing.width}x${sizing.height}`,
      task: [
        `Summon a PearlOS ${sizing.kind} sprite/image at ${sizing.width}x${sizing.height}.`,
        '',
        prompt,
      ].join('\n'),
      requestedTenantId,
      note: `Sprite ${sizing.kind} generation started.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Agency task tracking failed';
    log.error('Summon AI Sprite task tracking failed', { message });
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Register the job BEFORE creating the stream so the client always
  // gets a jobId on the very first chunk it reads — even if the stream
  // controller is closed early. The lifecycle is updated as we progress
  // and persists for ~10 min so a remounted client can poll
  // /api/summon-ai-sprite/job/:id and pick up a finished sprite that
  // streamed past a closed panel/tab. See SPECTRUM bug #4.
  const job = createJob(prompt);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: WorkflowStatus) => {
        try {
          if (!controller.desiredSize || controller.desiredSize <= 0) return;
          controller.enqueue(encodeStreamData(data));
        } catch (err) {
          log.warn('Stream controller error, client may have disconnected', { error: err });
        }
      };
      const sendLog = (message: string) => {
        send({ type: 'log', message });
        updateJob(job.jobId, { status: 'generating', bubbleLine: message });
      };

      try {
        const t0 = Date.now();
        // Always announce the jobId as the very first event so the client
        // can persist it before any await points where it could lose the
        // connection.
        send({ type: 'job', jobId: job.jobId });
        sendLog(`Summoning sprite from "${prompt}"...`);

        if (!process.env.OPENROUTER_API_KEY) {
          const errMsg = 'OpenRouter image credentials are not configured';
          await failImageGenerationTask(imageTask, new Error(errMsg));
          send({
            type: 'error',
            error: errMsg,
            details: 'Configure the OpenRouter image credential in the interface environment to enable sprite generation.',
          });
          updateJob(job.jobId, { status: 'error', error: errMsg });
          controller.close();
          return;
        }

        log.info('Summoning sprite', { prompt, userId, tenantId });

        // 1) Enhance terse prompts with Sonnet so the image model gets enough
        //    detail. Detailed user prompts skip this step — the LLM round-trip
        //    was adding 1–3 s of perceived latency for little quality lift.
        const tEnhanceStart = Date.now();
        let enhancedPrompt = prompt;
        if (promptNeedsEnhancement(prompt)) {
          sendLog('Calling forth the essence...');
          enhancedPrompt = await enhancePromptWithLLM(prompt);
        }
        const tEnhanceDone = Date.now();

        // 2) Generate the base sprite via OpenRouter
        sendLog('Weaving the magic (this may take a moment)...');
        const tGenStart = Date.now();
        const wrappedPrompt = wrapPromptForKind(sizing.kind, enhancedPrompt);

        const generation = await generateSpriteImage(wrappedPrompt, {
          models: getModelRankingFor(sizing.kind),
          aspectRatio: sizing.aspectRatio,
          imageSize: sizing.imageSize,
        });
        const tGenDone = Date.now();
        sendLog(`Form taking shape... (${generation.model.split('/').pop()})`);

        // 3) Vision QA observability — fire-and-forget so the user doesn't
        //    wait on a Sonnet vision round-trip in the critical path. The
        //    retry-on-fail loop was removed: it added 3–15s of latency for a
        //    quality bump that was rarely visible to users. Set
        //    SPRITE_QA_BLOCKING=1 to re-enable the synchronous gate.
        const qaBlocking = process.env.SPRITE_QA_BLOCKING === '1';
        let qaResultForResponse: QAResult | null = null;
        if (qaBlocking) {
          qaResultForResponse = await evaluateSpriteQuality(
            generation.png.toString('base64'),
            generation.mimeType,
            prompt,
          );
        } else {
          // Don't await — log only.
          evaluateSpriteQuality(
            generation.png.toString('base64'),
            generation.mimeType,
            prompt,
          ).then((qa) => {
            log.info('Sprite QA (async)', { score: qa.score, passed: qa.passed, reason: qa.reason });
          }).catch((err) => {
            log.warn('Sprite QA (async) errored', { error: err instanceof Error ? err.message : err });
          });
        }

        // 4) Background removal + cleanup pass — params follow the chosen kind.
        //    Pipeline order: rembg/isnet-anime matting on the full-res buffer,
        //    THEN resize to target. The 128 short-side floor applies to the
        //    character and background tiers (icon stays at its UI-tier size).
        sendLog('Polishing the form...');
        const cleanedPng = await cleanSpriteBackground(generation.png, {
          resizeTo:
            sizing.kind === 'background'
              ? { width: sizing.width, height: sizing.height }
              : sizing.width,
          minShortSide: sizing.kind === 'icon' ? undefined : 128,
          addOutline: sizing.kind !== 'background',
          chromaKey: sizing.kind !== 'background',
          erodeAlpha: sizing.kind === 'icon',
          quantize:
            sizing.kind === 'icon' ? 32 :
            sizing.kind === 'character' ? 64 :
            128,
        });

        const tEnd = Date.now();
        log.info('Sprite generation timings (ms)', {
          total: tEnd - t0,
          enhancement: tEnhanceDone - tEnhanceStart,
          enhancementSkipped: !promptNeedsEnhancement(prompt),
          generation: tGenDone - tGenStart,
          model: generation.model,
        });

        const cleanedBase64 = cleanedPng.toString('base64');
        const sourceImageDataUrl = `data:image/png;base64,${cleanedBase64}`;

        // 5) Kick off Prism persistence in parallel with the response send so
        //    the user sees the sprite without waiting on a DB round-trip. The
        //    spriteId is filled in on the client's next /list rehydrate; until
        //    then it falls back to a local UUID, which is fine for the active
        //    pad render. Saves 200–500ms of perceived latency per summon.
        let persistPromise: Promise<void> = Promise.resolve();
        if (sizing.kind !== 'background') {
          const selectedVoiceId = selectSpriteVoice(prompt);
          persistPromise = SpriteActions.create({
            parent_id: userId,
            tenantId,
            name: generateSpriteName(prompt),
            description: `Sprite summoned from: "${prompt}"`,
            originalRequest: prompt,
            // Reuse the gif* fields for the static PNG so the existing list/detail
            // routes keep working without a schema change.
            gifData: cleanedBase64,
            gifMimeType: 'image/png',
            primaryPrompt: generateSpritePersonalityPrompt(prompt),
            voiceProvider: DEFAULT_SPRITE_VOICE_PROVIDER,
            voiceId: selectedVoiceId,
            voiceParameters: { speed: DEFAULT_SPRITE_VOICE_SPEED },
          }).then((sprite) => {
            log.info('Sprite record created', { spriteId: sprite._id, name: sprite.name, model: generation.model });
          }).catch((spriteError) => {
            log.error('Failed to persist Sprite record', {
              message: spriteError instanceof Error ? spriteError.message : String(spriteError),
              stack: spriteError instanceof Error ? spriteError.stack : undefined,
            });
          });
        }

        const resultData = {
          sourceImage: { url: sourceImageDataUrl, filename: `${sizing.kind}-${sizing.width}x${sizing.height}.png` },
          // No animation step in the OpenRouter pipeline — keep the field shape
          // so the frontend's gif?.url || sourceImage?.url fallback still works.
          gif: undefined,
          images: [],
          // spriteId omitted on first render — the gallery rehydrates from
          // /api/summon-ai-sprite/list on next mount and picks up the real id.
          spriteId: undefined,
          spriteName: sizing.kind === 'background' ? `Scene: ${prompt.slice(0, 40)}` : generateSpriteName(prompt),
          kind: sizing.kind,
          width: sizing.width,
          height: sizing.height,
          model: generation.model,
          qaScore: qaResultForResponse?.score,
          agencyTracked: Boolean(imageTask),
        };
        send({ type: 'result', data: resultData });
        // Park the result on the job so a remounted client that missed
        // the streaming `result` event can still pick the sprite up via
        // /job/:id polling. See SPECTRUM bug #4.
        updateJob(job.jobId, { status: 'complete', result: resultData });
        await completeImageGenerationTask(
          imageTask,
          `Sprite ${sizing.kind} generated at ${sizing.width}x${sizing.height} with ${generation.model}.`,
        );

        // Hold the response open until persistence finishes so the request
        // lifecycle doesn't get killed mid-write. The user already has the
        // sprite — this just makes sure the DB record completes.
        await persistPromise;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error('Summon AI Sprite error', { message, error: err });
        await failImageGenerationTask(imageTask, err);
        send({ type: 'error', error: 'Unexpected error', details: message });
        updateJob(job.jobId, { status: 'error', error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
