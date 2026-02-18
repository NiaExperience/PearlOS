import { z } from 'zod';


export const BlockType_Account = 'Account';

export interface IAccount {
  _id?: string;
  userId: string; // References user page_id
  provider: string;
  providerAccountId: string;
  type: string;
  refresh_token?: string;
  expires_at?: number;
  scope?: string;
}

// Zod schema
export const AccountSchema = z.object({
  _id: z.string().optional(),
  userId: z.string(),
  provider: z.string(),
  providerAccountId: z.string(),
  type: z.string(),
  refresh_token: z.string().optional(),
  expires_at: z.number().optional(),
  scope: z.string().optional(),
});
