import { z } from 'zod';

export interface Exhibitor {
  _id?: string;
  assistant_id: string;
  category?: string;
  description?: string;
  exTags: string[];
  location?: string;
  logo?: string;
  tellMeMore?: string;
  title: string;
}

export const ExhibitorSchema = z.object({
  _id: z.string().optional(),
  assistant_id: z.string(),
  category: z.string().optional(),
  description: z.string().optional(),
  exTags: z.array(z.string()),
  location: z.string().optional(),
  logo: z.string().optional(),
  tellMeMore: z.string().optional(),
  title: z.string(),
}); 