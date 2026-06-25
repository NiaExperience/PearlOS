import { z } from 'zod';

export const BlockType_EarlyAccessFeedback = 'EarlyAccessFeedback';

export interface IEarlyAccessFeedback {
  _id?: string;
  userId: string;
  userEmail: string;
  userName: string;
  message: string;
  pageUrl?: string;
  createdAt: string;
}

export const EarlyAccessFeedbackSchema = z.object({
  _id: z.string().uuid().optional(),
  userId: z.string().min(1),
  userEmail: z.string(),
  userName: z.string(),
  message: z.string().min(1).max(2000),
  pageUrl: z.string().optional(),
  createdAt: z.string(),
});
