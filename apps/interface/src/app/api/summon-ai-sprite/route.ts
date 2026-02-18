import { promises as fs } from 'fs';
import path from 'path';

import * as SpriteActions from '@nia/prism/core/actions/sprite-actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_summon_ai_sprite]');

// Default voice configuration for Sprites (PocketTTS)
const DEFAULT_SPRITE_VOICE_PROVIDER = 'kokoro' as const;
const DEFAULT_SPRITE_VOICE_SPEED = 1.0;

// PocketTTS built-in voices (Les Misérables themed)
const POCKET_FEMALE_VOICES = [
  'alba', 'fantine', 'cosette', 'eponine', 'azelma'
] as const;

const POCKET_MALE_VOICES = [
  'marius', 'javert', 'jean'
] as const;

// Legacy Kokoro arrays kept for reference but unused
const KOKORO_AMERICAN_FEMALE_VOICES = POCKET_FEMALE_VOICES;
const KOKORO_AMERICAN_MALE_VOICES = POCKET_MALE_VOICES;
const KOKORO_BRITISH_FEMALE_VOICES = POCKET_FEMALE_VOICES;
const KOKORO_BRITISH_MALE_VOICES = POCKET_MALE_VOICES;

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

/**
 * Infer gender from sprite prompt for voice selection
 */
function inferGenderFromPrompt(prompt: string): InferredGender {
  const lowerPrompt = prompt.toLowerCase();
  const words = lowerPrompt.split(/\s+/);
  
  let femaleScore = 0;
  let maleScore = 0;
  
  for (const word of words) {
    // Clean punctuation from word
    const cleanWord = word.replace(/[^a-z]/g, '');
    if (FEMALE_KEYWORDS.includes(cleanWord)) {
      femaleScore++;
    }
    if (MALE_KEYWORDS.includes(cleanWord)) {
      maleScore++;
    }
  }
  
  // Also check for multi-word phrases
  for (const keyword of FEMALE_KEYWORDS) {
    if (keyword.includes(' ') && lowerPrompt.includes(keyword)) {
      femaleScore++;
    }
  }
  for (const keyword of MALE_KEYWORDS) {
    if (keyword.includes(' ') && lowerPrompt.includes(keyword)) {
      maleScore++;
    }
  }
  
  if (femaleScore > maleScore) return 'female';
  if (maleScore > femaleScore) return 'male';
  return 'unknown';
}

/**
 * Select a random PocketTTS voice based on inferred gender.
 * Pearl uses "azelma" — exclude it from the pool so summoned sprites sound distinct.
 */
function selectSpriteVoice(prompt: string): string {
  const gender = inferGenderFromPrompt(prompt);
  
  // Exclude 'azelma' (Pearl's voice) from sprite pool
  const femalePool = POCKET_FEMALE_VOICES.filter(v => v !== 'azelma');
  const malePool = [...POCKET_MALE_VOICES];
  
  let voicePool: string[];
  
  if (gender === 'female') {
    voicePool = femalePool;
  } else if (gender === 'male') {
    voicePool = malePool;
  } else {
    // Unknown gender - 60% chance female, 40% chance male
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
    // Simple implementation: first 2-3 words title cased
    const words = prompt.split(' ');
    const name = words.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    // Remove punctuation from the end
    return name.replace(/[.,;!?]+$/, '') || 'Sprite';
}

type WorkflowNode = {
    title?: string;
    widgets_values?: unknown[];
    inputs?: Record<string, unknown>;
    class_type?: string;
};

type ApiWorkflow = Record<string, WorkflowNode>;
type LiteGraphWorkflow = { nodes: WorkflowNode[] };
type Workflow = ApiWorkflow | LiteGraphWorkflow;

type ComfyImage = {
    filename: string;
    subfolder?: string;
    type?: string;
};

type ComfyOutput = {
    images?: ComfyImage[];
    gifs?: ComfyImage[];
    files?: ComfyImage[];
};

type HistoryEntry = {
    outputs?: Record<string, ComfyOutput>;
};

const ORIGIN_WORKFLOW_API = 'origin-sprite-creator_API_no_llm.json';
// Prefer transparent output workflow; fallback to older GIF workflow if missing
const ANIMATION_WORKFLOW_API = 'SingleAnimationfromPic_ClearGifOutput.json';
const ANIMATION_WORKFLOW_FALLBACK_API = 'SingleAnimationfromPic_GifOutput_API.json';
const PROMPT_NODE_ID = '970';
const LOAD_IMAGE_NODE_ID = '1405';
const POLL_INTERVAL_MS = 1000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function resolveWorkflowPath(filename: string): Promise<string> {
    const cwd = process.cwd();

    const candidates = [
        path.resolve(cwd, '..', 'sprite-maker', filename),
        path.resolve(cwd, '..', '..', 'apps', 'sprite-maker', filename),
        path.join(cwd, 'apps', 'sprite-maker', filename),
        path.resolve(cwd, '..', '..', '..', '..', '..', 'sprite-maker', filename),
        path.resolve(cwd, '..', 'apps', 'sprite-maker', filename),
    ];

    log.debug(`Resolving workflow "${filename}" from cwd: ${cwd}`);

    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            log.debug(`Found workflow at: ${candidate}`);
            return candidate;
        } catch {
            log.debug(`Not found at: ${candidate}`);
        }
    }

    const errorMsg = `Workflow file "${filename}" not found. Searched: ${candidates.join(', ')}`;
    throw new Error(errorMsg);
}

function normalizeBaseUrl(base: string): string {
    return base.endsWith('/') ? base.slice(0, -1) : base;
}

function injectPrompt(template: Workflow, prompt: string): Workflow {
    const clone = JSON.parse(JSON.stringify(template)) as Workflow;

    if (!('nodes' in clone)) {
        const node = (clone as ApiWorkflow)[PROMPT_NODE_ID];
        if (node?.inputs) {
            (node.inputs as Record<string, unknown>).string = prompt;
            return clone;
        }
    }

    const nodesArray = 'nodes' in clone && Array.isArray(clone.nodes) ? clone.nodes : [];
    const promptNode = nodesArray.find(node => node?.title === 'Pearl_Input_Prompt' || node?.title === 'Pearl_Input_Single_Animation_Prompt');
    if (!promptNode || !Array.isArray(promptNode.widgets_values) || promptNode.widgets_values.length === 0) {
        throw new Error('Prompt node not found or malformed in workflow');
    }
    promptNode.widgets_values[0] = prompt;
    return clone;
}

function setDimensions(template: Workflow, width: number, height: number): Workflow {
    const clone = JSON.parse(JSON.stringify(template)) as Workflow;

    if (!('nodes' in clone)) {
        const widthNode = (clone as ApiWorkflow)['1385']; // width
        const heightNode = (clone as ApiWorkflow)['1384']; // height
        if (widthNode?.inputs) {
            (widthNode.inputs as Record<string, unknown>).value = width;
        }
        if (heightNode?.inputs) {
            (heightNode.inputs as Record<string, unknown>).value = height;
        }
        return clone;
    }

    // If litegraph, try to find Int nodes with matching titles (best-effort)
    const nodesArray = Array.isArray(clone.nodes) ? clone.nodes : [];
    nodesArray.forEach(node => {
        const title = (node.title ?? '').toLowerCase();
        if (title.includes('width') && node.inputs) {
            (node.inputs as Record<string, unknown>).value = width;
        }
        if (title.includes('height') && node.inputs) {
            (node.inputs as Record<string, unknown>).value = height;
        }
    });
    return clone;
}

function setLoadImage(template: Workflow, imagePath: string, subfolder?: string, type: string = 'input'): Workflow {
    const clone = JSON.parse(JSON.stringify(template)) as Workflow;

    if (!('nodes' in clone)) {
        const node = (clone as ApiWorkflow)[LOAD_IMAGE_NODE_ID];
        if (!node?.inputs) {
            throw new Error('LoadImage node missing in animation workflow');
        }
        (node.inputs as Record<string, unknown>).image = imagePath;
        (node.inputs as Record<string, unknown>).subfolder = subfolder ?? '';
        (node.inputs as Record<string, unknown>).type = type;
        return clone;
    }

    const nodesArray = 'nodes' in clone && Array.isArray(clone.nodes) ? clone.nodes : [];
    const loadNode = nodesArray.find(n => n?.title?.toLowerCase().includes('load image'));
    if (!loadNode || !loadNode.widgets_values) {
        throw new Error('LoadImage node missing (litegraph)');
    }
    // Common LoadImage widgets: [image, upload, cache, label, type, subfolder]
    loadNode.widgets_values[0] = imagePath;
    if (loadNode.widgets_values.length > 4) {
        loadNode.widgets_values[4] = type;
    }
    if (loadNode.widgets_values.length > 5) {
        loadNode.widgets_values[5] = subfolder ?? '';
    }
    return clone;
}

function buildViewUrl(baseUrl: string, image: ComfyImage): string {
    const url = new URL('/view', baseUrl);
    url.searchParams.set('filename', image.filename);
    url.searchParams.set('subfolder', image.subfolder ?? '');
    url.searchParams.set('type', image.type ?? 'output');
    return url.toString();
}

async function uploadImageToComfyUI(
    targetBaseUrl: string,
    image: ComfyImage,
    downloadBaseUrl?: string
): Promise<{ name: string; subfolder?: string; type?: string } | null> {
    try {
        const viewUrl = buildViewUrl(downloadBaseUrl ?? targetBaseUrl, image);
        const imageRes = await fetch(viewUrl, { cache: 'no-store' });
        if (!imageRes.ok) {
            log.error('Failed to download image', { statusText: imageRes.statusText });
            return null;
        }

        const imageBlob = await imageRes.blob();
        const formData = new FormData();
        formData.append('image', imageBlob, image.filename);
        formData.append('overwrite', 'true');

        const uploadUrl = `${targetBaseUrl}/upload/image`;
        const uploadRes = await fetch(uploadUrl, { method: 'POST', body: formData, cache: 'no-store' });
        if (!uploadRes.ok) {
            const errorText = await uploadRes.text().catch(() => '');
            log.error('Upload failed', { status: uploadRes.status, errorText });
            return null;
        }

        const uploadData = await uploadRes.json().catch(() => null);
        if (uploadData?.name) {
            return { name: uploadData.name, subfolder: uploadData.subfolder ?? '', type: uploadData.type ?? 'input' };
        }

        return { name: image.filename, subfolder: '', type: 'input' };
    } catch (err) {
        log.error('Error uploading image', { error: err });
        return null;
    }
}

async function fetchHistory(baseUrl: string, promptId: string) {
    const res = await fetch(`${baseUrl}/history/${promptId}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
}

type ImageResult = ComfyImage & { url: string };

function buildOutputs(baseUrl: string, historyEntry: HistoryEntry): ImageResult[] {
    const outputs = historyEntry?.outputs as Record<string, ComfyOutput>;
    if (!outputs) return [];

    const results: ImageResult[] = [];
    for (const output of Object.values(outputs)) {
        const items = [
            ...(output.images || []), 
            ...(output.gifs || []), 
            ...(output.files || [])
        ];

        for (const item of items) {
             const url = `${baseUrl}/view?filename=${encodeURIComponent(item.filename)}&subfolder=${encodeURIComponent(item.subfolder || '')}&type=${encodeURIComponent(item.type || '')}`;
             results.push({
                 ...item,
                 url
             });
        }
    }
    return results;
}

function pickFirstOutputImage(historyEntry: HistoryEntry) {
    const outputs = historyEntry?.outputs as Record<string, ComfyOutput>;
    if (!outputs) return null;

    const allImages: ComfyImage[] = [];
    for (const output of Object.values(outputs)) {
        if (output?.images && Array.isArray(output.images)) {
            allImages.push(...output.images);
        }
        if (output?.gifs && Array.isArray(output.gifs)) {
            allImages.push(...output.gifs);
        }
        if (output?.files && Array.isArray(output.files)) {
            allImages.push(...output.files);
        }
    }

    const nonTemp = allImages.filter(img => img.filename && !img.filename.toLowerCase().includes('temp'));
    const candidates = nonTemp.length ? nonTemp : allImages;

    return (
        candidates.find(img => img.filename?.toLowerCase().endsWith('.gif')) ||
        candidates.find(img => img.type === 'output') ||
        candidates[0] ||
        null
    );
}


type WorkflowStatus = 
    | { type: 'log', message: string }
    | { type: 'result', data: Record<string, unknown> }
    | { type: 'error', error: string, details?: string };

async function runWorkflowStream(
    baseUrl: string, 
    workflow: Workflow, 
    logStep: (msg: string) => void
): Promise<{ promptId: string, historyEntry: HistoryEntry } | { error: string }> {
    const promptRes = await fetch(`${baseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ prompt: workflow }),
    });

    if (!promptRes.ok) {
        const text = await promptRes.text().catch(() => '');
        return { error: text || 'Failed to submit prompt' };
    }

    const promptData = await promptRes.json().catch(() => null);
    const promptId = promptData?.prompt_id;
    if (!promptId || typeof promptId !== 'string') {
        return { error: 'Invalid response from ComfyUI (missing prompt_id)' };
    }

    let historyEntry: HistoryEntry | null = null;
    const maxPolls = 600; // 10 minutes (600 * 1000ms)
    
    // Check history every second
    for (let i = 0; i < maxPolls; i++) {
        await sleep(POLL_INTERVAL_MS);
        
        // Emit a keep-alive/progress log every 5 seconds to prevent 504
        if (i % 5 === 0) {
            logStep(`Waiting for workflow... (${i}s)`);
        }

        const history = await fetchHistory(baseUrl, promptId);
        const entry = history?.[promptId];
        if (entry?.outputs) {
            historyEntry = entry;
            break;
        }
    }

    if (!historyEntry) {
        return { error: 'Workflow timed out waiting for output' };
    }

    return { promptId, historyEntry };
}

// Helper to encode streaming data
function encodeStreamData(data: WorkflowStatus): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(data) + '\n');
}

async function enhancePromptWithOpenAI(userPrompt: string): Promise<string> {
    // Prefer OpenClaw (Claude) over OpenAI
    const apiKey = process.env.OPENCLAW_API_KEY || process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENCLAW_API_KEY ? (process.env.OPENCLAW_API_URL || 'http://localhost:18789/v1') : 'https://api.openai.com/v1';
    if (!apiKey) {
        log.warn('No LLM API key configured, skipping prompt enhancement');
        return userPrompt;
    }

    const systemPrompt = `You're pixel sprite character creator. You will create the original master character pose and prompt for ComfyUI that all subsequent images and animations will refer to. This character will be rendered on a clear white background at a resolution of 512 height and 256 width. Make sure to fill the character description with rich and colorful detail. Ensure all relevant information, color, texture, and style is fully explained with nothing left to imagine. Describe body parts, accessories and any important character visual traits. Transform a brief character description into a fully fleshed out new prompt. DO NOT DESCRIBE ANY BACKGROUND OBJECTS OR SCENERY. CLEAR HEX #FFFFFF BACKGROUND only.

Example succesful prompts (do not copy details, for example purposes only):
<example1>
input prompt: "Indian cyberpunk pirate with bright right hookhand. He has a robot parrot on his shoulder. His eye is covered by a bionic eyepatch. His hand grips an electric saber."
correct response: An Indian cyberpunk pirate stands tall and imposing against a backdrop of clear white space, his pixelated form crafted with exquisite precision. The character measures 512 pixels in height and 256 pixels in width, ensuring a detailed yet clean appearance that captures the essence of both cyberpunk aesthetics and Indian cultural influences. Our protagonist's body is decked out in an ornate brass armor, its intricate patterns and designs inspired by rich Indian artistry.  His left eye is concealed by a sleek, bionic eyepatch that blends seamlessly into his cybernetic arm, giving him a menacing yet sophisticated appearance. The armor features subtle highlights and shadows to create depth and realism, with a combination of rough, rusted metal and smooth, polished brass textures that reflect the character's cybernetic nature. A golden band adorns his wrist, encircling it as a testament to his wealth and power. On his left shoulder, our pirate proudly sports an elegant silver mechanical parrot, its metallic feathers shimmering with an ethereal glow. The mechanical parrot perches alertly on his shoulder, watching over him with unwavering vigilance. In his right hand, our pirate grips an electric saber with a vibrant blue energy crackling along its length. The character's posture is powerful and imposing, his foot planted firmly on the ground as he prepares for action. His cybernetic hook hand, a biomechanical pointed grappling hook, rests casually on his hip.

<example2>
input prompt: "A 1940's gangster Santa Claus with a dark red fedora hat, red mobster suit, a red sack of green cash, and a tommy gun in his gloved hand."
correct response: "An iconic 1940's Gangster Santa stands tall against a backdrop of crisp white space, his pixels painstakingly crafted with impeccable precision. The character is rendered at a resolution of 512 pixels height and 256 pixels width to ensure a detailed yet clean appearance that blends the charm of Christmas with the grittiness of a mobster's world. Our protagonist dons a red mobster suit, complete with sharp peaks and creases that reflect the meticulous care taken in his attire. A dark red fedora hat sits atop his head, its brim casting an shadows across his face as he cocks his head to one side. The suit is accessorized with a sash around his waist, adorned with glimmering golden bells that jingle softly every time he moves. A red satchel slung over his shoulder houses his ill-gotten gains – bundles of green cash that spill from the sack's mouth. In his left hand, he holds a sleek tommy gun, its barrel silenced for discretion in the line of work. Each bullet casing slides out with an elegant grace, echoing his unyielding power as a gangster. Our 1940's Gangster Santa's posture exudes confidence and menace, ready to take on any challenges that come his way in the cold winter night. A thick white beard and mustache add a touch of warmth to an otherwise hardened face, hinting at the holiday season that lies just beneath the surface."

<example3> input prompt: "A cartoon squirrel who is also a badass sniper. Sniper Squirrel!"
correct response: "An adorable yet deadly cartoon squirrel stands tall and supreme against the backdrop of clear white space, his pixels meticulously crafted to capture breathtaking detail at 512 pixels in height and 256 pixels in width. With an attitude that is both charming and deadly, Sniper Squirrel wears a camouflaged tunic designed to blend seamlessly with every environment, whether it's the dense, verdant forest or the sprawling concrete jungle. His bushy tail is a testament to his squirrel origin and swings behind him as he gears up for action. A wide-brimmed hat adorned with pointed ears and neon accents sits atop his head, accentuating his fierce yet playful persona.A bulletproof vest surrounds Sniper Squirrel's torso for protection during battle, while protective gloves wrapped around nimble paws allow him to maintain a firm grip on his sniper rifle. Protective boots made with reinforced leather are ready for fast movement across any landscape. Sniper Squirrel's weapon of choice is a sleek black steel sniper rifle crafted with intricate details that speak volumes about its precision and power. The gun features a small, red-tinted scope that can be adjusted for the perfect shot, and a sling made of sturdy material ensures easy transport between missions. Sniper Squirrel's posture is intense and focused – eyes peering through his sniper rifle's scope with unwavering determination – as he poises himself for action on the battlefield."


---


Write only the raw text response, no backgrounds, no additional words. Just pure character visual descriptions.`;

    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: process.env.OPENCLAW_API_KEY ? 'anthropic/claude-sonnet-4-5' : 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.9,
                max_tokens: 1920,
            }),
        });

        if (!response.ok) {
            log.error('OpenAI API error', { status: response.status });
            return userPrompt; // Fallback to original prompt
        }

        const data = await response.json();
        const enhancedPrompt = data.choices?.[0]?.message?.content?.trim();
        
        if (enhancedPrompt) {
            log.info('Prompt enhanced via OpenAI', { 
                original: userPrompt.slice(0, 50), 
                enhanced: enhancedPrompt.slice(0, 50) 
            });
            return enhancedPrompt;
        }
        
        return userPrompt;
    } catch (error) {
        log.error('Failed to enhance prompt', { error });
        return userPrompt; // Fallback to original prompt
    }
}

interface QAResult {
    passed: boolean;
    score: number;
    reason: string;
    suggestion?: string;
}

/**
 * Vision QA gate: sends the generated sprite image to Sonnet for quality evaluation.
 * Checks for prompt adherence, visual quality, and pixel art style fidelity.
 */
async function evaluateSpriteQuality(
    imageUrl: string,
    originalPrompt: string,
    enhancedPrompt: string,
): Promise<QAResult> {
    const apiKey = process.env.OPENCLAW_API_KEY || process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENCLAW_API_KEY
        ? (process.env.OPENCLAW_API_URL || 'http://localhost:18789/v1')
        : 'https://api.openai.com/v1';

    if (!apiKey) {
        log.warn('No API key for sprite QA, skipping quality gate');
        return { passed: true, score: 0, reason: 'No API key — skipped' };
    }

    try {
        // Fetch the image and convert to base64
        const imgRes = await fetch(imageUrl, { cache: 'no-store' });
        if (!imgRes.ok) {
            log.warn('Could not fetch sprite image for QA', { status: imgRes.status });
            return { passed: true, score: 0, reason: 'Could not fetch image — skipped' };
        }
        const imgBuffer = await imgRes.arrayBuffer();
        const imgBase64 = Buffer.from(imgBuffer).toString('base64');
        const mimeType = imgRes.headers.get('content-type') || 'image/png';

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: process.env.OPENCLAW_API_KEY ? 'anthropic/claude-sonnet-4-5' : 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: `You are a pixel art quality inspector for a sprite summoning app. Evaluate the generated sprite image against the user's request. Score 1-10 on these criteria:

1. **Prompt adherence** — Does it match what was requested?
2. **Visual quality** — Is it well-formed, clear, and detailed?
3. **Pixel art style** — Does it look like proper pixel art with crisp edges?
4. **Character clarity** — Is the character/object clearly defined on the background?
5. **No artifacts** — Free of distortion, extra limbs, text, watermarks?

Respond with ONLY a JSON object (no markdown):
{"passed": true/false, "score": 1-10, "reason": "brief explanation", "suggestion": "improvement hint for regeneration or null"}

Pass threshold: score >= 6. Be fair but maintain standards. A blurry mess or completely wrong subject should fail.`,
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: `User requested: "${originalPrompt}"\n\nEvaluate this generated sprite:`,
                            },
                            {
                                type: 'image_url',
                                image_url: { url: `data:${mimeType};base64,${imgBase64}` },
                            },
                        ],
                    },
                ],
                temperature: 0.3,
                max_tokens: 256,
            }),
        });

        if (!response.ok) {
            log.warn('QA API call failed', { status: response.status });
            return { passed: true, score: 0, reason: 'API error — skipped' };
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content?.trim();
        if (!content) {
            return { passed: true, score: 0, reason: 'Empty response — skipped' };
        }

        // Parse JSON, handling possible markdown wrapping
        const jsonStr = content.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
        const qa = JSON.parse(jsonStr) as QAResult;
        log.info('Sprite QA result', { score: qa.score, passed: qa.passed, reason: qa.reason });
        return qa;
    } catch (err) {
        log.error('Sprite QA evaluation failed', { error: err });
        return { passed: true, score: 0, reason: 'Evaluation error — skipped' };
    }
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const rawPrompt = typeof body?.prompt === 'string' ? body.prompt : '';
    const prompt = rawPrompt.trim();
    const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : null;

    if (!prompt) {
        return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // Prepare stream
    const stream = new ReadableStream({
        async start(controller) {
            const send = (data: WorkflowStatus) => {
                try {
                    if (!controller.desiredSize || controller.desiredSize <= 0) {
                        // Stream closed or backpressure - skip
                        return;
                    }
                    controller.enqueue(encodeStreamData(data));
                } catch (err) {
                    // Controller already closed, ignore
                    log.warn('Stream controller error, client may have disconnected', { error: err });
                }
            };
            const sendLog = (message: string) => send({ type: 'log', message });

            try {
                const t0 = Date.now();
                sendLog(`Starting sprite generation for: "${prompt}"`);

                // Get authenticated user (optional - sprites can be created anonymously for now)
                const session = await getSessionSafely(request, interfaceAuthOptions);
                const userId = session?.user?.id || 'anonymous';
                const effectiveTenantId = tenantId || 'default';

                log.info('Summoning sprite', { prompt, userId, tenantId: effectiveTenantId });

                // Origin (base image) uses only COMFYUI_ORIGIN_BASE_URL
                const originEnv = process.env.COMFYUI_ORIGIN_BASE_URL;

                // Animation (GIF) uses only COMFYUI_ANIMATION_BASE_URL
                const animationEnv = process.env.COMFYUI_ANIMATION_BASE_URL;

                if (!originEnv) {
                    send({ type: 'error', error: 'COMFYUI_ORIGIN_BASE_URL is not configured for origin generation' });
                    controller.close();
                    return;
                }
                if (!animationEnv) {
                    send({ type: 'error', error: 'COMFYUI_ANIMATION_BASE_URL is not configured for animation' });
                    controller.close();
                    return;
                }
                const originBaseUrl = normalizeBaseUrl(originEnv);
                const animationBaseUrl = normalizeBaseUrl(animationEnv);

                // Enhance the user's simple prompt into a rich character description
                sendLog('Enhancing character description...');
                const enhancedPrompt = await enhancePromptWithOpenAI(prompt);

                // 1) Run origin sprite creator to get a base character image/GIF
                sendLog('Preparing origin workflow...');
                const originPath = await resolveWorkflowPath(ORIGIN_WORKFLOW_API);
                const originRaw = await fs.readFile(originPath, 'utf8');
                const originJson = JSON.parse(originRaw) as Workflow;
                const originWorkflow = injectPrompt(originJson, enhancedPrompt);

                log.debug('Origin prompt', { prompt });

                const tOriginSubmit = Date.now();
                sendLog('Running origin generation (this may take a minute)...');
                
                const originRun = await runWorkflowStream(originBaseUrl, originWorkflow, (msg) => {
                    // Forward progress logs from the runner to keep connection alive
                    sendLog(`[Origin] ${msg}`);
                });
                
                const tOriginDone = Date.now();
                if ('error' in originRun) {
                    send({ type: 'error', error: 'Failed to run origin workflow', details: originRun.error });
                    controller.close();
                    return;
                }

                const sourceImage = pickFirstOutputImage(originRun.historyEntry);
                if (!sourceImage?.filename) {
                    send({ 
                        type: 'error', 
                        error: 'No output image found from origin workflow', 
                        details: `Prompt ID: ${originRun.promptId}` 
                    });
                    controller.close();
                    return;
                }

                // ── Quality Gate: Vision QA pass ──
                sendLog('Evaluating sprite quality...');
                const qaResult = await evaluateSpriteQuality(
                    buildViewUrl(originBaseUrl, sourceImage),
                    prompt,
                    enhancedPrompt,
                );
                if (!qaResult.passed) {
                    sendLog(`Quality check: ${qaResult.reason} — regenerating...`);
                    log.info('Sprite failed QA, regenerating', { reason: qaResult.reason, suggestion: qaResult.suggestion });

                    // Retry once with QA feedback baked into the prompt
                    const refinedPrompt = qaResult.suggestion
                        ? `${enhancedPrompt}. IMPORTANT: ${qaResult.suggestion}`
                        : enhancedPrompt;
                    const retryWorkflow = injectPrompt(
                        JSON.parse(originRaw) as Workflow,
                        refinedPrompt,
                    );

                    sendLog('Running refined generation...');
                    const retryRun = await runWorkflowStream(originBaseUrl, retryWorkflow, (msg) => {
                        sendLog(`[Retry] ${msg}`);
                    });

                    if (!('error' in retryRun)) {
                        const retryImage = pickFirstOutputImage(retryRun.historyEntry);
                        if (retryImage?.filename) {
                            // Use the retry output instead
                            Object.assign(sourceImage, retryImage);
                            log.info('Using retry sprite output', { filename: retryImage.filename });
                        }
                    }
                } else {
                    sendLog('Quality check passed ✓');
                    log.info('Sprite passed QA', { score: qaResult.score });
                }

                // Upload output so animation workflow can load it
                sendLog('Processing source image...');
                const tUploadStart = Date.now();
                const uploaded = await uploadImageToComfyUI(animationBaseUrl, sourceImage, originBaseUrl);
                const tUploadDone = Date.now();
                const imagePath = uploaded?.name || sourceImage.filename;
                const imageSubfolder = uploaded?.subfolder ?? '';
                const imageType = uploaded?.type ?? 'input';

                // 2) Run animation workflow using the origin image as input
                sendLog('Preparing animation workflow...');
                let animationPath: string;
                try {
                    animationPath = await resolveWorkflowPath(ANIMATION_WORKFLOW_API);
                } catch {
                    animationPath = await resolveWorkflowPath(ANIMATION_WORKFLOW_FALLBACK_API);
                }
                const animationRaw = await fs.readFile(animationPath, 'utf8');
                const animationJson = JSON.parse(animationRaw) as Workflow;

                const animationPrompt = `${prompt} subtle mouth movement`;
                log.debug('Animation prompt', { animationPrompt });
                const animationWithPrompt = injectPrompt(animationJson, animationPrompt);
                // Ensure dimensions are 256x256
                const dimensionedWorkflow = setDimensions(animationWithPrompt, 256, 256);
                const animationWorkflow = setLoadImage(dimensionedWorkflow, imagePath, imageSubfolder, imageType);

                const tAnimSubmit = Date.now();
                sendLog('Running animation generation (this may take a minute)...');
                
                const animationRun = await runWorkflowStream(animationBaseUrl, animationWorkflow, (msg) => {
                    // Forward progress logs
                    sendLog(`[Animation] ${msg}`);
                });

                const tAnimDone = Date.now();
                if ('error' in animationRun) {
                    send({ 
                        type: 'error', 
                        error: 'Failed to run animation workflow', 
                        details: animationRun.error 
                    });
                    controller.close();
                    return;
                }

                const animationOutputs = buildOutputs(animationBaseUrl, animationRun.historyEntry);
                const gifOutput = animationOutputs.find(media => media.filename?.toLowerCase().endsWith('.gif'));

                const tEnd = Date.now();
                log.info('Sprite generation timings (ms)', {
                    total: tEnd - t0,
                    originSubmit: tOriginSubmit - t0,
                    originRun: tOriginDone - tOriginSubmit,
                    upload: tUploadDone - tUploadStart,
                    animSubmit: tAnimSubmit - tUploadDone,
                    animRun: tAnimDone - tAnimSubmit,
                    postProcess: tEnd - tAnimDone,
                });

                // Select voice based on character gender inference
                const selectedVoiceId = selectSpriteVoice(prompt);
                
                // Persist Sprite record to Prism
                let spriteId: string | undefined;
                if (gifOutput?.url && userId !== 'anonymous') {
                    try {
                        sendLog('Finalizing sprite record...');
                        const gifResponse = await fetch(gifOutput.url, { cache: 'no-store' });
                        if (gifResponse.ok) {
                            const gifBuffer = await gifResponse.arrayBuffer();
                            const gifBase64 = Buffer.from(gifBuffer).toString('base64');

                            const sprite = await SpriteActions.create({
                                parent_id: userId,
                                tenantId: effectiveTenantId,
                                name: generateSpriteName(prompt),
                                description: `Sprite summoned from: "${prompt}"`,
                                originalRequest: prompt,
                                gifData: gifBase64,
                                gifMimeType: 'image/gif',
                                primaryPrompt: generateSpritePersonalityPrompt(prompt),
                                voiceProvider: DEFAULT_SPRITE_VOICE_PROVIDER,
                                voiceId: selectedVoiceId,
                                voiceParameters: { speed: DEFAULT_SPRITE_VOICE_SPEED },
                            });
                            spriteId = sprite._id;
                            log.info('Sprite record created', { spriteId, name: sprite.name });
                        } else {
                            log.warn('Failed to fetch GIF for persistence', { url: gifOutput.url, status: gifResponse.status });
                        }
                    } catch (spriteError) {
                        log.error('Failed to persist Sprite record', { error: spriteError });
                    }
                }

                // const responseVoiceId = spriteId ? selectedVoiceId : selectSpriteVoice(prompt);
                const responseVoiceId = undefined;
                
                // Send final success result
                send({ 
                    type: 'result', 
                    data: {
                        promptId: originRun.promptId,
                        animationPromptId: animationRun.promptId,
                        sourceImage: { ...sourceImage, url: buildViewUrl(originBaseUrl, sourceImage) },
                        gif: gifOutput,
                        images: animationOutputs,
                        spriteId,
                        spriteName: generateSpriteName(prompt),
                        // voiceProvider: DEFAULT_SPRITE_VOICE_PROVIDER,
                        // voiceId: responseVoiceId,
                    } 
                });
                
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                log.error('Summon AI Sprite error', { message, error: err });
                send({ type: 'error', error: 'Unexpected error', details: message });
            } finally {
                controller.close();
            }
        }
    });

    return new NextResponse(stream, {
        headers: {
            'Content-Type': 'application/x-ndjson',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}


