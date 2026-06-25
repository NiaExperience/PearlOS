/**
 * Shared sprite-summon types pulled out so the module-level generation
 * store can describe its result shape without circularly importing
 * `SummonSpritePrompt`.
 */

export interface ImageResult {
  url: string;
  filename?: string;
  subfolder?: string;
  type?: string;
}

/**
 * Successful payload returned from `/api/summon-ai-sprite` after the
 * stream resolves. Mirrors the inline shape used inside
 * `SummonSpritePrompt`.
 */
export interface ApiResultData {
  promptId: string;
  animationPromptId?: string;
  sourceImage?: ImageResult;
  gif?: ImageResult;
  images?: ImageResult[];
  spriteId?: string;
  spriteName?: string;
  voiceProvider?: string;
  voiceId?: string;
}
