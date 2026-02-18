import { z } from 'zod';

export const BlockType_ResourceShareToken = 'ResourceShareToken';

export enum ResourceShareRole {
  VIEWER = 'viewer',
  MEMBER = 'member'
}

export enum ResourceType {
  HtmlGeneration = 'HtmlGeneration',
  Notes = 'Notes',
  DailyCallRoom = 'DailyCallRoom',
  Sprite = 'Sprite'
}

export interface IResourceShareToken {
  _id?: string;
  token: string;
  assistantName: string; // assistant subdomain (for linking purposes)
  resourceId: string;
  resourceType: ResourceType;
  role: ResourceShareRole;
  createdBy: string; // userId
  tenantId: string;
  expiresAt: Date;
  redeemedBy?: string[]; // List of userIds who redeemed it
  maxRedemptions?: number; // Optional limit
  targetMode?: string; // Optional mode to set on redemption (e.g. 'creative')
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export const ResourceShareTokenSchema = z.object({
  _id: z.string().uuid().optional(),
  token: z.string().min(1),
  assistantName: z.string().min(1),
  resourceId: z.string().min(1),
  resourceType: z.nativeEnum(ResourceType),
  role: z.nativeEnum(ResourceShareRole),
  createdBy: z.string().uuid(),
  tenantId: z.string().uuid(),
  expiresAt: z.date(),
  redeemedBy: z.array(z.string().uuid()).optional(),
  maxRedemptions: z.number().optional(),
  targetMode: z.string().optional(),
  isActive: z.boolean(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional()
});
