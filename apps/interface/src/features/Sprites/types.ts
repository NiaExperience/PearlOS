export type SpriteType = 'character' | 'icon' | 'object' | 'background';

export interface SpriteData {
  id: string;
  name: string;
  prompt: string;
  imageUrl: string;
  type: SpriteType;
  createdAt: Date;
  /** Pixel dimensions of the produced asset (square for character/icon). */
  width?: number;
  height?: number;
  frames?: string[];
  isAnimated?: boolean;
}

export type SummonState = 'idle' | 'summoning' | 'materializing' | 'complete';

/**
 * Options forwarded from the SummonInput to the API. Mirrors the body shape of
 * /api/summon-ai-sprite — see that route for the canonical schema.
 */
export type SummonOptions =
  | { kind: 'character'; size: 256 | 512 }
  | { kind: 'icon'; size: 16 | 32 | 48 | 64 }
  | { kind: 'background'; preset?: string; width?: number; height?: number };
