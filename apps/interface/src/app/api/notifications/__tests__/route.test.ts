import { NextResponse } from 'next/server';

import { GET, PATCH } from '../route';

const mockListAppNotifications = jest.fn();
const mockMarkAllAppNotificationsRead = jest.fn();
const mockMarkAppNotificationRead = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@nia/prism/core/actions/appNotification-actions', () => ({
  listAppNotifications: (...args: unknown[]) => mockListAppNotifications(...args),
  markAllAppNotificationsRead: (...args: unknown[]) => mockMarkAllAppNotificationsRead(...args),
  markAppNotificationRead: (...args: unknown[]) => mockMarkAppNotificationRead(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

describe('/api/notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveInterfaceActorContext.mockResolvedValue({
      ok: true,
      actor: {
        userId: 'user-1',
        userEmail: 'sam@example.com',
        userName: 'Sam',
        tenantId: 'tenant-a',
        tenantRole: 'member',
      },
    });
    mockListAppNotifications.mockResolvedValue([]);
    mockMarkAllAppNotificationsRead.mockResolvedValue(2);
    mockMarkAppNotificationRead.mockResolvedValue({ _id: 'notif-1', isRead: true });
  });

  it('lists notifications for the resolved actor tenant and user', async () => {
    const response = await GET({
      url: 'https://app.example.com/api/notifications?tenantId=tenant-spoof&unreadOnly=true',
    } as any);

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-spoof' });
    expect(mockListAppNotifications).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      recipientUserId: 'user-1',
      unreadOnly: true,
    }));
  });

  it('does not list notifications when the requested tenant is forbidden', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await GET({
      url: 'https://app.example.com/api/notifications?tenantId=tenant-b',
    } as any);

    expect(response.status).toBe(403);
    expect(mockListAppNotifications).not.toHaveBeenCalled();
  });

  it('marks all notifications read only for the resolved actor scope', async () => {
    const response = await PATCH({
      json: async () => ({ tenantId: 'tenant-spoof', markAllRead: true }),
    } as any);

    expect(response.status).toBe(200);
    expect(mockMarkAllAppNotificationsRead).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      recipientUserId: 'user-1',
    });
  });

  it('checks recipient ownership before marking one notification read', async () => {
    mockListAppNotifications.mockResolvedValueOnce([{ _id: 'notif-1', recipientUserId: 'user-1' }]);

    const response = await PATCH({
      json: async () => ({ tenantId: 'tenant-spoof', notificationId: 'notif-1' }),
    } as any);

    expect(response.status).toBe(200);
    expect(mockListAppNotifications).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      recipientUserId: 'user-1',
      limit: 500,
    });
    expect(mockMarkAppNotificationRead).toHaveBeenCalledWith('notif-1', 'tenant-a');
  });

  it('does not mutate a notification outside the resolved recipient list', async () => {
    mockListAppNotifications.mockResolvedValueOnce([{ _id: 'notif-owned' }]);

    const response = await PATCH({
      json: async () => ({ tenantId: 'tenant-spoof', notificationId: 'notif-other' }),
    } as any);

    expect(response.status).toBe(404);
    expect(mockMarkAppNotificationRead).not.toHaveBeenCalled();
  });
});
