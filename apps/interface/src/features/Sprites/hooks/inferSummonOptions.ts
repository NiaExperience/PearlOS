import type { SummonOptions } from '../types';

const SCENE_KEYWORDS = [
  'scene', 'background', 'backdrop', 'landscape', 'environment', 'vista',
  'panorama', 'cityscape', 'skyline', 'horizon', 'world', 'world map',
  'forest', 'jungle', 'desert', 'mountain', 'mountains', 'valley', 'canyon',
  'ocean', 'sea', 'beach', 'shore', 'coast', 'river', 'lake', 'waterfall',
  'cave', 'cavern', 'dungeon', 'castle', 'fortress', 'temple', 'cathedral',
  'tavern', 'street', 'alley', 'plaza', 'town', 'village', 'city',
  'meadow', 'field', 'plains', 'tundra', 'glacier', 'volcano',
  'sunset', 'sunrise', 'dusk', 'dawn', 'starscape', 'galaxy', 'nebula',
  'battlefield', 'arena', 'colosseum', 'wasteland', 'ruins', 'graveyard',
  'interior', 'room', 'chamber', 'hall', 'throne room', 'laboratory',
  'spaceship interior', 'bridge of', 'cockpit',
];

const SMALL_ITEM_KEYWORDS = [
  'icon', 'token', 'badge', 'emblem', 'crest', 'sigil', 'sticker', 'pin',
  'coin', 'gem', 'jewel', 'crystal shard', 'pebble', 'trinket',
  'potion', 'vial', 'flask', 'bottle', 'pellet', 'pill',
  'key', 'amulet', 'ring', 'charm', 'rune',
  'tiny', 'small item', 'little ', 'mini ', 'minuscule',
  'pickup', 'powerup', 'collectible',
];

function matchesAny(prompt: string, keywords: string[]): boolean {
  for (const k of keywords) {
    if (k.includes(' ')) {
      if (prompt.includes(k)) return true;
    } else {
      const re = new RegExp(`\\b${k}\\b`, 'i');
      if (re.test(prompt)) return true;
    }
  }
  return false;
}

/**
 * Pick a sensible kind/size from the user's prompt so we can drop the manual
 * mode buttons. Heuristics — not LLM-backed — to keep summon latency low.
 *
 * Defaults to character@512 (the most common ask). Prompts that read like a
 * scene/environment switch to a 16:9 background; prompts that read like a
 * small collectible item drop to character@256.
 */
export function inferSummonOptions(rawPrompt: string): SummonOptions {
  const prompt = rawPrompt.toLowerCase();

  if (matchesAny(prompt, SCENE_KEYWORDS)) {
    return { kind: 'background', preset: '1280x720' };
  }

  if (matchesAny(prompt, SMALL_ITEM_KEYWORDS)) {
    return { kind: 'character', size: 256 };
  }

  return { kind: 'character', size: 512 };
}
