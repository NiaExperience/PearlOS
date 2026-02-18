/**
 * API route placeholder for sprite generation.
 * Ready for ComfyUI integration.
 *
 * POST /api/sprites/generate
 * Body: { prompt: string, type?: SpriteType }
 * Response: SpriteData
 */

import type { SpriteData, SpriteType } from '../types';

export interface GenerateSpriteRequest {
  prompt: string;
  type?: SpriteType;
}

export interface GenerateSpriteResponse {
  success: boolean;
  sprite?: SpriteData;
  error?: string;
}

/** Placeholder — will be replaced with ComfyUI integration */
export async function generateSprite(req: GenerateSpriteRequest): Promise<GenerateSpriteResponse> {
  // TODO: POST to ComfyUI backend
  // const res = await fetch('/api/sprites/generate', { method: 'POST', body: JSON.stringify(req) });
  return {
    success: false,
    error: 'Not implemented — ComfyUI backend not connected',
  };
}
