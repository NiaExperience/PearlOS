import { z } from 'zod';

import { ResourceType } from './resourceShareToken.block';

export const BlockType_WebhookSubscription = 'WebhookSubscription';

export type WebhookEvent =
  | 'share.created'
  | 'share.redeemed'
  | 'share.revoked'
  | 'share.role_updated'
  | 'task.created'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled';

export const WEBHOOK_EVENTS = [
  'share.created',
  'share.redeemed',
  'share.revoked',
  'share.role_updated',
  'task.created',
  'task.started',
  'task.completed',
  'task.failed',
  'task.cancelled',
] as const satisfies readonly WebhookEvent[];

export interface IWebhookSubscription {
  _id?: string;
  tenantId: string;
  createdBy: string;
  url: string;
  secret?: string;
  events: WebhookEvent[];
  resourceTypes?: ResourceType[];
  isActive: boolean;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const WebhookSubscriptionSchema = z.object({
  _id: z.string().uuid().optional(),
  tenantId: z.string().uuid(),
  createdBy: z.string().uuid(),
  url: z.string().url(),
  secret: z.string().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)),
  resourceTypes: z.array(z.nativeEnum(ResourceType)).optional(),
  isActive: z.boolean(),
  description: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
