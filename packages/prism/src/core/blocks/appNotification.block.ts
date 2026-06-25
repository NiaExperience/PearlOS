import { z } from 'zod';

import { ResourceType } from './resourceShareToken.block';

export const BlockType_AppNotification = 'AppNotification';

export type AppNotificationEvent =
  | 'share.created'
  | 'share.redeemed'
  | 'share.revoked'
  | 'share.role_updated';

export interface IAppNotification {
  _id?: string;
  tenantId: string;
  recipientUserId: string;
  actorUserId?: string;
  event: AppNotificationEvent;
  resourceId: string;
  resourceType: ResourceType;
  title: string;
  body?: string;
  isRead: boolean;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  readAt?: string;
}

export const AppNotificationSchema = z.object({
  _id: z.string().uuid().optional(),
  tenantId: z.string().uuid(),
  recipientUserId: z.string().uuid(),
  actorUserId: z.string().uuid().optional(),
  event: z.enum(['share.created', 'share.redeemed', 'share.revoked', 'share.role_updated']),
  resourceId: z.string().min(1),
  resourceType: z.nativeEnum(ResourceType),
  title: z.string().min(1),
  body: z.string().optional(),
  isRead: z.boolean(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().optional(),
  readAt: z.string().optional(),
});
