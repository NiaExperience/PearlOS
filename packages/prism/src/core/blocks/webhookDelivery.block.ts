import { z } from 'zod';

import { ResourceType } from './resourceShareToken.block';
import { WEBHOOK_EVENTS, type WebhookEvent } from './webhookSubscription.block';

export const BlockType_WebhookDelivery = 'WebhookDelivery';

export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed';

export interface IWebhookDelivery {
  _id?: string;
  tenantId: string;
  subscriptionId: string;
  event: WebhookEvent;
  resourceId: string;
  resourceType: ResourceType;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  requestBody: Record<string, unknown>;
  responseStatus?: number;
  responseBody?: string;
  error?: string;
  createdAt?: string;
  deliveredAt?: string;
}

export const WebhookDeliverySchema = z.object({
  _id: z.string().uuid().optional(),
  tenantId: z.string().uuid(),
  subscriptionId: z.string().uuid(),
  event: z.enum(WEBHOOK_EVENTS),
  resourceId: z.string().min(1),
  resourceType: z.nativeEnum(ResourceType),
  status: z.enum(['pending', 'success', 'failed']),
  attemptCount: z.number(),
  requestBody: z.record(z.unknown()),
  responseStatus: z.number().optional(),
  responseBody: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string().optional(),
  deliveredAt: z.string().optional(),
});
