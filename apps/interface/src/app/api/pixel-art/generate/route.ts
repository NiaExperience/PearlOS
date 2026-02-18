import { promises as fs } from 'fs';
import path from 'path';

import { NextRequest, NextResponse } from 'next/server';

const WORKFLOW_FILE = 'pixel-art-icon_API.json';
const PROMPT_NODE_ID = '970';
const STYLE_NODE_ID = '1003';
const LATENT_NODE_ID = '712';
const SAVE_NODE_ID = '1017';
const SEED_NODE_ID = '813';
const POLL_INTERVAL_MS = 500;
const MAX_POLLS = 120; // 60 seconds max

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ComfyImage = {
  filename: string;
  subfolder?: string;
  type?: string;
};

type ComfyOutput = {
  images?: ComfyImage[];
};

type HistoryEntry = {
  outputs?: Record<string, ComfyOutput>;
};

// Style guidance per element type
const STYLE_PROMPTS: Record<string, string> = {
  icon: 'Classic 90s PC adventure game pixel art style. Richly detailed sprite icon with vibrant retro colors and gorgeous depth. Sprite cutout on clear background #FFFFFF ONLY. Bold pixel shapes with shading like Monkey Island, Day of the Tentacle. 16-bit era color palette. Centered composition. Single object icon.\n\n',
  button:
    'Classic 90s PC adventure game pixel art style. Richly detailed UI button element with vibrant retro colors. Sprite cutout on clear background #FFFFFF ONLY. Rounded rectangle with pixel-perfect edges and depth shading. 16-bit RPG menu button.\n\n',
  badge:
    'Classic 90s PC adventure game pixel art style. Richly detailed badge collectible with vibrant retro colors. Sprite cutout on clear background #FFFFFF ONLY. Small shield or circular badge with bold details. 16-bit era achievement icon.\n\n',
  frame:
    'Classic 90s PC adventure game pixel art style. Richly detailed decorative frame border with vibrant retro colors. Sprite cutout on clear background #FFFFFF ONLY. Ornate corner and edge RPG menu frame. 16-bit fantasy UI border.\n\n',
  divider:
    'Classic 90s PC adventure game pixel art style. Richly detailed horizontal divider separator with vibrant retro colors. Sprite cutout on clear background #FFFFFF ONLY. Decorative line with pixel flourishes. 16-bit fantasy UI element.\n\n',
};

function normalizeBaseUrl(base: string): string {
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

async function resolveWorkflowPath(filename: string): Promise<string> {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, '..', 'sprite-maker', filename),
    path.resolve(cwd, '..', '..', 'apps', 'sprite-maker', filename),
    path.join(cwd, 'apps', 'sprite-maker', filename),
    path.resolve(cwd, '..', 'apps', 'sprite-maker', filename),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  throw new Error(`Workflow file "${filename}" not found`);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const {
      type = 'icon',
      description,
      size = 32,
      palette,
    } = body as {
      type?: string;
      description?: string;
      size?: number;
      palette?: string;
    };

    if (!description || typeof description !== 'string') {
      return NextResponse.json({ error: 'description is required' }, { status: 400 });
    }

    const validTypes = ['icon', 'button', 'badge', 'frame', 'divider'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `type must be one of: ${validTypes.join(', ')}` },
        { status: 400 },
      );
    }

    const validSizes = [16, 32, 48, 64];
    if (!validSizes.includes(size)) {
      return NextResponse.json(
        { error: `size must be one of: ${validSizes.join(', ')}` },
        { status: 400 },
      );
    }

    const baseUrl = normalizeBaseUrl(
      process.env.COMFYUI_ORIGIN_BASE_URL || 'http://localhost:8188',
    );

    // Load and configure workflow
    const workflowPath = await resolveWorkflowPath(WORKFLOW_FILE);
    const workflowRaw = await fs.readFile(workflowPath, 'utf8');
    const workflow = JSON.parse(workflowRaw);

    // Set prompt
    let prompt = description;
    if (palette) {
      prompt += `. Color palette: ${palette}`;
    }
    workflow[PROMPT_NODE_ID].inputs.string = prompt;

    // Set style guidance per type
    workflow[STYLE_NODE_ID].inputs.string = STYLE_PROMPTS[type] || STYLE_PROMPTS.icon;

    // Generate at 256x256 for true pixel art (matches object-maker workflow)
    workflow[LATENT_NODE_ID].inputs.width = 256;
    workflow[LATENT_NODE_ID].inputs.height = 256;

    // Set filename prefix based on type
    workflow[SAVE_NODE_ID].inputs.filename_prefix = `pixel-art/${type}`;

    // Random seed
    workflow[SEED_NODE_ID].inputs.seed = Math.floor(Math.random() * 2147483647);

    // Submit to ComfyUI
    const promptRes = await fetch(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!promptRes.ok) {
      const text = await promptRes.text().catch(() => '');
      return NextResponse.json(
        { error: 'Failed to submit to ComfyUI', details: text },
        { status: 502 },
      );
    }

    const promptData = await promptRes.json();
    const promptId = promptData?.prompt_id;
    if (!promptId) {
      return NextResponse.json({ error: 'No prompt_id from ComfyUI' }, { status: 502 });
    }

    // Poll for completion
    let historyEntry: HistoryEntry | null = null;
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_INTERVAL_MS);
      const histRes = await fetch(`${baseUrl}/history/${promptId}`, { cache: 'no-store' });
      if (!histRes.ok) continue;
      const history = await histRes.json();
      const entry = history?.[promptId];
      if (entry?.outputs) {
        historyEntry = entry;
        break;
      }
    }

    if (!historyEntry?.outputs) {
      return NextResponse.json({ error: 'Generation timed out' }, { status: 504 });
    }

    // Find output image
    let outputImage: ComfyImage | null = null;
    for (const output of Object.values(historyEntry.outputs)) {
      const images = (output as ComfyOutput).images;
      if (images?.length) {
        outputImage = images[0];
        break;
      }
    }

    if (!outputImage) {
      return NextResponse.json({ error: 'No image generated' }, { status: 500 });
    }

    // Fetch the image from ComfyUI
    const viewUrl = `${baseUrl}/view?filename=${encodeURIComponent(outputImage.filename)}&subfolder=${encodeURIComponent(outputImage.subfolder || '')}&type=${encodeURIComponent(outputImage.type || 'output')}`;
    const imageRes = await fetch(viewUrl, { cache: 'no-store' });

    if (!imageRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch generated image' }, { status: 500 });
    }

    const imageBuffer = await imageRes.arrayBuffer();

    // Return image directly as PNG
    return new NextResponse(Buffer.from(imageBuffer), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="pixel-${type}-${size}.png"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Pixel-Art-Type': type,
        'X-Pixel-Art-Size': String(size),
        'X-Prompt-Id': promptId,
        'X-ComfyUI-Filename': outputImage.filename,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET endpoint to list existing generated pixel art
export async function GET() {
  const outputDir = process.env.COMFYUI_OUTPUT_DIR || '/workspace/runpod-slim/ComfyUI/output';
  const pixelArtDir = path.join(outputDir, 'pixel-art');

  try {
    const types = ['icon', 'button', 'badge', 'frame', 'divider'];
    const assets: Record<string, string[]> = {};

    for (const type of types) {
      const typeDir = path.join(pixelArtDir, type);
      try {
        const files = await fs.readdir(typeDir);
        assets[type] = files.filter((f) => f.endsWith('.png'));
      } catch {
        assets[type] = [];
      }
    }

    // Also check flat pixel-art directory
    try {
      const flatFiles = await fs.readdir(pixelArtDir);
      const flatPngs = flatFiles.filter((f) => f.endsWith('.png'));
      if (flatPngs.length > 0) {
        assets['uncategorized'] = flatPngs;
      }
    } catch {
      // directory may not exist yet
    }

    return NextResponse.json({ assets });
  } catch {
    return NextResponse.json({ assets: {} });
  }
}
