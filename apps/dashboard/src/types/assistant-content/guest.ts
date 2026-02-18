import { z } from 'zod';

export interface Guest {
  _id?: string;
  assistant_id: string;
  chatHistory?: Array<{
    message: string;
    metadata?: Record<string, any>;
    sender: string;
    timestamp?: string;
  }>;
  eventHistory?: Array<{
    details?: string[];
    eventType: string;
    timestamp?: string;
  }>;
  interests?: string[];
  messages?: Array<{
    content: string;
    timestamp?: string;
    type?: string;
  }>;
  name: string;
  passPhrase: string;
  phone_number: string;
}

export const GuestSchema = z.object({
  _id: z.string().optional(),
  assistant_id: z.string(),
  name: z.string(),
  phone_number: z.string(),
  passPhrase: z.string(),
  interests: z.array(z.string()),
}); 