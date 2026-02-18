import { z } from 'zod';

export interface Speaker {
  _id?: string;
  assistant_id: string;
  bio?: string;
  categories: string[];
  company?: string;
  dayTime?: string;
  name: string;
  photo?: string;
  session?: string;
  title: string;
}

export const SpeakerSchema = z.object({
  _id: z.string().optional(),
  assistant_id: z.string(),
  bio: z.string().optional(),
  categories: z.array(z.string()),
  company: z.string().optional(),
  dayTime: z.string().optional(),
  name: z.string(),
  photo: z.string().optional(),
  session: z.string().optional(),
  title: z.string(),
}); 