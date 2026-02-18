import { z } from 'zod';

export interface EventMap {
  _id?: string;
  assistant_id: string;
  eventName: string;
  description: string;
  url: string;
  // Add other fields as needed
}

export const EventMapSchema = z.object({
  _id: z.string().optional(),
  assistant_id: z.string(),
  eventName: z.string(),
  description: z.string(),
  url: z.string().url(),
}); 