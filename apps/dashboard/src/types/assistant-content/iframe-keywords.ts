import { z } from 'zod';

export interface IframeKeyword {
  _id?: string;
  assistant_id: string;
  name: string;
  url: string;
  description?: string;
  keywords: string[];
}

export const IframeKeywordSchema = z.object({
  _id: z.string().optional(),
  assistant_id: z.string(),
  name: z.string(),
  url: z.string(),
  description: z.string().optional(),
  keywords: z.array(z.string()),
}); 