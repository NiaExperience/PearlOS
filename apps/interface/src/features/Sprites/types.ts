export type SpriteType = 'character' | 'icon' | 'object' | 'background';

export interface SpriteData {
  id: string;
  name: string;
  prompt: string;
  imageUrl: string;
  type: SpriteType;
  createdAt: Date;
  frames?: string[];
  isAnimated?: boolean;
}

export type SummonState = 'idle' | 'summoning' | 'materializing' | 'complete';
