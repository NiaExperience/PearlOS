import { z } from 'zod';

export interface Activity {
  _id?: string;
  tenantId: string;
  category: string;
  client_code: string;
  description: string;
  excursion_name: string;
  is_active?: boolean;
  location: string;
  photo_url?: string;
  time: string;
}

export const ActivitySchema = z.object({
  _id: z.string().optional(),
  tenantId: z.string(),
  category: z.string(),
  client_code: z.string(),
  description: z.string(),
  excursion_name: z.string(),
  is_active: z.boolean().optional(),
  location: z.string(),
  photo_url: z.string().url().optional(),
  time: z.string(),
}); 