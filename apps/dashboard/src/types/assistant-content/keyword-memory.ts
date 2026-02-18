import { z } from 'zod';

export type MemoryKeywordCategory = 'GENERAL' | 'SPECIAL' | 'CUSTOM';

export interface KeywordMemory {
  _id?: string;
  assistant_id: string;
  keyword: string;
  description: string;
  category: MemoryKeywordCategory;
}

export const KeywordMemorySchema = z.object({
  _id: z.string().optional(),
  assistant_id: z.string(),
  keyword: z.string(),
  description: z.string(),
  category: z.enum(['GENERAL', 'SPECIAL', 'CUSTOM']),
}); 

export enum KeywordMemoryCategory {
  GENERAL = 'GENERAL',
  SPECIAL = 'SPECIAL',
  CUSTOM = 'CUSTOM',
}
