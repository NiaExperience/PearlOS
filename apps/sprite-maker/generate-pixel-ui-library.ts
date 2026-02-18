#!/usr/bin/env npx tsx
/**
 * Batch generator for PearlOS Pixel Art UI Library
 * Generates a starter set of pixel art icons via ComfyUI
 * 
 * Usage: npx tsx generate-pixel-ui-library.ts [--base-url http://localhost:8188]
 */

import * as fs from 'fs';
import * as path from 'path';

const COMFYUI_BASE = process.argv.includes('--base-url')
  ? process.argv[process.argv.indexOf('--base-url') + 1]
  : process.env.COMFYUI_ORIGIN_BASE_URL || 'http://localhost:8188';

const OUTPUT_DIR = path.resolve(__dirname, '../interface/public/pixel-ui');
const WORKFLOW_PATH = path.resolve(__dirname, 'pixel-art-icon_API.json');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface IconDef {
  category: string;
  name: string;
  prompt: string;
}

const ICON_LIBRARY: IconDef[] = [
  // Navigation
  { category: 'icons', name: 'home', prompt: 'a pixel art house home icon, simple geometric, warm colors' },
  { category: 'icons', name: 'settings', prompt: 'a pixel art gear cog settings icon, metallic silver' },
  { category: 'icons', name: 'back', prompt: 'a pixel art left arrow back navigation icon, bold shape' },
  { category: 'icons', name: 'forward', prompt: 'a pixel art right arrow forward navigation icon, bold shape' },
  { category: 'icons', name: 'menu', prompt: 'a pixel art hamburger menu icon, three horizontal lines' },
  { category: 'icons', name: 'close', prompt: 'a pixel art X close button icon, bold red' },
  { category: 'icons', name: 'search', prompt: 'a pixel art magnifying glass search icon, purple tint' },

  // Status
  { category: 'icons', name: 'online', prompt: 'a pixel art glowing green circle online status indicator' },
  { category: 'icons', name: 'offline', prompt: 'a pixel art gray circle offline status indicator' },
  { category: 'icons', name: 'busy', prompt: 'a pixel art red circle with minus sign busy status indicator' },
  { category: 'icons', name: 'away', prompt: 'a pixel art yellow crescent moon away status indicator' },

  // Actions
  { category: 'icons', name: 'play', prompt: 'a pixel art play triangle button icon, green glow' },
  { category: 'icons', name: 'pause', prompt: 'a pixel art pause button with two vertical bars' },
  { category: 'icons', name: 'stop', prompt: 'a pixel art stop square button icon, red' },
  { category: 'icons', name: 'record', prompt: 'a pixel art red circle record button icon, glowing' },
  { category: 'icons', name: 'send', prompt: 'a pixel art paper airplane send message icon, indigo purple' },
  { category: 'icons', name: 'attach', prompt: 'a pixel art paperclip attachment icon, metallic' },
  { category: 'icons', name: 'mic', prompt: 'a pixel art microphone icon for voice recording, purple' },
  { category: 'icons', name: 'camera', prompt: 'a pixel art camera icon for photo capture, retro style' },

  // Decorative
  { category: 'frames', name: 'corner-tl', prompt: 'a pixel art ornate top-left corner piece, RPG golden frame decoration' },
  { category: 'frames', name: 'corner-tr', prompt: 'a pixel art ornate top-right corner piece, RPG golden frame decoration' },
  { category: 'frames', name: 'corner-bl', prompt: 'a pixel art ornate bottom-left corner piece, RPG golden frame decoration' },
  { category: 'frames', name: 'corner-br', prompt: 'a pixel art ornate bottom-right corner piece, RPG golden frame decoration' },
  { category: 'dividers', name: 'divider-gem', prompt: 'a pixel art horizontal divider line with a gem in the center, fantasy RPG style' },
  { category: 'dividers', name: 'divider-vine', prompt: 'a pixel art horizontal divider line with vine and leaf decorations' },
  { category: 'icons', name: 'sparkle', prompt: 'a pixel art golden sparkle star particle effect, magical glow' },
  { category: 'icons', name: 'treasure', prompt: 'a pixel art treasure chest slightly open with golden glow, RPG item' },
];

async function generateIcon(def: IconDef): Promise<Buffer | null> {
  const workflowRaw = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  const workflow = JSON.parse(workflowRaw);

  // Configure
  workflow['970'].inputs.string = def.prompt;
  workflow['813'].inputs.seed = Math.floor(Math.random() * 2147483647);
  workflow['1017'].inputs.filename_prefix = `pixel-art/${def.category}/${def.name}`;

  // Submit
  const res = await fetch(`${COMFYUI_BASE}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });

  if (!res.ok) {
    console.error(`  ❌ Failed to submit: ${await res.text()}`);
    return null;
  }

  const { prompt_id } = await res.json();
  if (!prompt_id) {
    console.error('  ❌ No prompt_id returned');
    return null;
  }

  // Poll
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const histRes = await fetch(`${COMFYUI_BASE}/history/${prompt_id}`);
    if (!histRes.ok) continue;
    const history = await histRes.json();
    const entry = history[prompt_id];
    if (!entry?.outputs) continue;

    // Find image
    for (const output of Object.values(entry.outputs) as any[]) {
      if (output?.images?.length) {
        const img = output.images[0];
        const viewUrl = `${COMFYUI_BASE}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`;
        const imgRes = await fetch(viewUrl);
        if (imgRes.ok) {
          return Buffer.from(await imgRes.arrayBuffer());
        }
      }
    }
  }

  console.error('  ❌ Timed out');
  return null;
}

async function main() {
  console.log('🎨 PearlOS Pixel Art UI Library Generator');
  console.log(`   ComfyUI: ${COMFYUI_BASE}`);
  console.log(`   Output:  ${OUTPUT_DIR}`);
  console.log(`   Icons:   ${ICON_LIBRARY.length}\n`);

  // Ensure directories
  for (const dir of ['icons', 'buttons', 'badges', 'frames', 'dividers']) {
    fs.mkdirSync(path.join(OUTPUT_DIR, dir), { recursive: true });
  }

  let success = 0;
  let failed = 0;

  for (const def of ICON_LIBRARY) {
    const outPath = path.join(OUTPUT_DIR, def.category, `${def.name}.png`);
    
    // Skip if already exists
    if (fs.existsSync(outPath)) {
      console.log(`⏭️  ${def.category}/${def.name} — already exists`);
      success++;
      continue;
    }

    console.log(`🔨 Generating ${def.category}/${def.name}...`);
    console.log(`   "${def.prompt}"`);

    const buffer = await generateIcon(def);
    if (buffer) {
      fs.writeFileSync(outPath, buffer);
      console.log(`   ✅ Saved to ${outPath} (${(buffer.length / 1024).toFixed(1)}KB)`);
      success++;
    } else {
      failed++;
    }

    // Small delay between generations
    await sleep(200);
  }

  console.log(`\n✨ Done! ${success} generated, ${failed} failed out of ${ICON_LIBRARY.length} total`);
}

main().catch(console.error);
