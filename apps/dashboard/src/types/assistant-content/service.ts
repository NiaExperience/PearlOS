import { z } from 'zod';

export interface Service {
  _id?: string;
  assistant_id: string;
  item_name: string;
  price: number;
  photo_url: string;
  description: string;
  category: string;
  available: boolean;
  prep_time_minutes: number;
  client_code: string;
  customFields?: string;
}

export const ServiceSchema = z.object({
  _id: z.string().optional(),
  assistant_id: z.string(),
  item_name: z.string(),
  price: z.number(),
  photo_url: z.string().url(),
  description: z.string(),
  category: z.string(),
  available: z.boolean(),
  prep_time_minutes: z.number(),
  client_code: z.string(),
  customFields: z.string().optional(),
}); 