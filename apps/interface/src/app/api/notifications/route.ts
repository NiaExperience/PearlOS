export const dynamic = 'force-dynamic';

import {
  listAppNotifications,
  markAllAppNotificationsRead,
  markAppNotificationRead,
} from '@nia/prism/core/actions/appNotification-actions';
import { NextRequest, NextResponse } from 'next/server';

import { getLogger } from '@interface/lib/logger';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

const log = getLogger('[api_notifications]');

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const requestedTenantId = url.searchParams.get('tenantId');
  if (!requestedTenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  const actorResult = await resolveInterfaceActorContext({ requestedTenantId });
  if (!actorResult.ok) return actorResult.response;
  const actor = actorResult.actor;

  try {
    const notifications = await listAppNotifications({
      tenantId: actor.tenantId,
      recipientUserId: actor.userId,
      unreadOnly: url.searchParams.get('unreadOnly') === 'true',
      limit: Number(url.searchParams.get('limit') || 50),
    });
    return NextResponse.json({ success: true, notifications });
  } catch (error) {
    log.error('Failed to list notifications', { error, tenantId: actor.tenantId });
    return NextResponse.json({ error: 'Failed to list notifications' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const parsed = await req.json();
    const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    const requestedTenantId = body.tenantId || body.tenant_id;
    const notificationId = typeof body.notificationId === 'string' ? body.notificationId.trim() : '';
    const markAllRead = body.markAllRead === true;
    if (!requestedTenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    const actorResult = await resolveInterfaceActorContext({ requestedTenantId });
    if (!actorResult.ok) return actorResult.response;
    const actor = actorResult.actor;

    if (markAllRead) {
      const updated = await markAllAppNotificationsRead({ tenantId: actor.tenantId, recipientUserId: actor.userId });
      return NextResponse.json({ success: true, updated });
    }

    if (!notificationId) return NextResponse.json({ error: 'notificationId is required' }, { status: 400 });
    const ownedNotifications = await listAppNotifications({
      tenantId: actor.tenantId,
      recipientUserId: actor.userId,
      limit: 500,
    });
    if (!ownedNotifications.some((notification) => notification._id === notificationId)) {
      return NextResponse.json({ error: 'notification_not_found' }, { status: 404 });
    }
    const notification = await markAppNotificationRead(notificationId, actor.tenantId);
    return NextResponse.json({ success: true, notification });
  } catch (error) {
    log.error('Failed to update notifications', { error });
    return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 });
  }
}
