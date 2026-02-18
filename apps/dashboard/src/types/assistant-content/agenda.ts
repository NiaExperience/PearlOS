import { z } from 'zod';

export interface Agenda {
  _id?: string;
  assistant_id: string;
  categories: string[];
  dayTime?: string;
  description?: string;
  location?: string;
  speaker?: string;
  tellMeMore?: string;
  title?: string;
  track?: string;
  type?: string;
} 

export const AgendaSchema = z.object({
  assistant_id: z.string(),
  track: z.string(),
  title: z.string(),
  dayTime: z.string(),
  location: z.string(),
  type: z.string(),
  description: z.string(),
  speaker: z.string(),
  categories: z.array(z.string()),
  tellMeMore: z.string(),
}); 