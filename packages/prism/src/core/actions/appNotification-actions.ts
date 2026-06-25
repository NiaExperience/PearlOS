import { Prism } from '../../prism';
import {
  BlockType_AppNotification,
  IAppNotification,
} from '../blocks/appNotification.block';
import { PrismContentQuery } from '../types';

export async function createAppNotification(
  input: Omit<IAppNotification, 'isRead' | 'createdAt'> & Partial<Pick<IAppNotification, 'isRead' | 'createdAt'>>
): Promise<IAppNotification> {
  const prism = await Prism.getInstance();
  const now = new Date().toISOString();
  const notification: IAppNotification = {
    ...input,
    isRead: input.isRead ?? false,
    createdAt: input.createdAt ?? now,
  };

  const result = await prism.create(BlockType_AppNotification, notification, input.tenantId);
  if (!result || result.items.length === 0) {
    throw new Error('Failed to create notification');
  }
  return result.items[0] as IAppNotification;
}

export async function listAppNotifications(params: {
  tenantId: string;
  recipientUserId: string;
  unreadOnly?: boolean;
  limit?: number;
}): Promise<IAppNotification[]> {
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_AppNotification,
    tenantId: 'any',
    where: { parent_id: params.recipientUserId },
    orderBy: { createdAt: 'desc' as const },
    limit: params.limit ?? 50,
  };

  const result = await prism.query(query);
  const notifications = (result.items || []) as IAppNotification[];
  return notifications.filter((item) => {
    if (item.tenantId !== params.tenantId) return false;
    if (params.unreadOnly && item.isRead) return false;
    return true;
  });
}

export async function markAppNotificationRead(
  notificationId: string,
  tenantId: string
): Promise<IAppNotification> {
  const prism = await Prism.getInstance();
  const result = await prism.update(
    BlockType_AppNotification,
    notificationId,
    { isRead: true, readAt: new Date().toISOString() },
    tenantId
  );
  if (!result || result.items.length === 0) {
    throw new Error('Failed to mark notification read');
  }
  return result.items[0] as IAppNotification;
}

export async function markAllAppNotificationsRead(params: {
  tenantId: string;
  recipientUserId: string;
}): Promise<number> {
  const notifications = await listAppNotifications({
    tenantId: params.tenantId,
    recipientUserId: params.recipientUserId,
    unreadOnly: true,
    limit: 100,
  });

  await Promise.all(
    notifications
      .filter((item) => item._id)
      .map((item) => markAppNotificationRead(item._id!, params.tenantId))
  );

  return notifications.length;
}
