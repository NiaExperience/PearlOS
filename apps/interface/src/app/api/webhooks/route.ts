export const dynamic = 'force-dynamic';

import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookDeliveries,
  listWebhookSubscriptions,
  updateWebhookSubscription,
  validateWebhookTargetUrl,
} from '@nia/prism/core/actions/webhook-actions';
import { requireAuth } from '@nia/prism/core/auth';
import { ResourceType } from '@nia/prism/core/blocks/resourceShareToken.block';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@nia/prism/core/blocks/webhookSubscription.block';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

const log = getLogger('[api_webhooks]');
const VALID_EVENTS = new Set<WebhookEvent>(WEBHOOK_EVENTS);
const VALID_RESOURCE_TYPES = new Set<string>(Object.values(ResourceType));

function cleanEvents(value: unknown): WebhookEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter((event): event is WebhookEvent => VALID_EVENTS.has(event as WebhookEvent));
}

function cleanResourceTypes(value: unknown): ResourceType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const types = value.filter((type): type is ResourceType => VALID_RESOURCE_TYPES.has(String(type)));
  return types.length ? types : undefined;
}

function redactWebhookSubscription(subscription: any) {
  if (!subscription || typeof subscription !== 'object') return subscription;
  const { secret, ...safeSubscription } = subscription;
  return {
    ...safeSubscription,
    hasSecret: Boolean(secret),
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, interfaceAuthOptions);
  if (authError) return authError as NextResponse;

  const url = new URL(req.url);
  const requestedTenantId = url.searchParams.get('tenantId');
  if (!requestedTenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });

  const actorResult = await resolveInterfaceActorContext({
    requestedTenantId,
    minimumRole: TenantRole.ADMIN,
  });
  if (!actorResult.ok) return actorResult.response;
  const { tenantId } = actorResult.actor;

  try {
    const subscriptions = await listWebhookSubscriptions(tenantId);
    const includeDeliveries = url.searchParams.get('includeDeliveries') === 'true';
    const deliveries = includeDeliveries
      ? await listWebhookDeliveries({ tenantId, limit: 50 })
      : undefined;

    return NextResponse.json({
      success: true,
      subscriptions: subscriptions.map(redactWebhookSubscription),
      deliveries,
    });
  } catch (error) {
    log.error('Failed to list webhooks', { error, tenantId });
    return NextResponse.json({ error: 'Failed to list webhooks' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, interfaceAuthOptions);
  if (authError) return authError as NextResponse;

  try {
    const body = await req.json();
    const { tenantId: requestedTenantId, url, secret, description } = body;
    const events = cleanEvents(body.events);
    const resourceTypes = cleanResourceTypes(body.resourceTypes);

    if (!requestedTenantId || !url || events.length === 0) {
      return NextResponse.json({ error: 'tenantId, url, and at least one valid event are required' }, { status: 400 });
    }
    let safeUrl: string;
    try {
      safeUrl = await validateWebhookTargetUrl(url);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid webhook URL' },
        { status: 400 },
      );
    }

    const actorResult = await resolveInterfaceActorContext({
      requestedTenantId,
      minimumRole: TenantRole.ADMIN,
    });
    if (!actorResult.ok) return actorResult.response;
    const { tenantId, userId } = actorResult.actor;

    const subscription = await createWebhookSubscription({
      tenantId,
      createdBy: userId,
      url: safeUrl,
      secret,
      events,
      resourceTypes,
      description,
    });

    return NextResponse.json({ success: true, subscription: redactWebhookSubscription(subscription) }, { status: 201 });
  } catch (error) {
    log.error('Failed to create webhook', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create webhook' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, interfaceAuthOptions);
  if (authError) return authError as NextResponse;

  try {
    const body = await req.json();
    const { tenantId: requestedTenantId, subscriptionId } = body;
    if (!requestedTenantId || !subscriptionId) {
      return NextResponse.json({ error: 'tenantId and subscriptionId are required' }, { status: 400 });
    }

    const actorResult = await resolveInterfaceActorContext({
      requestedTenantId,
      minimumRole: TenantRole.ADMIN,
    });
    if (!actorResult.ok) return actorResult.response;
    const { tenantId } = actorResult.actor;

    let safeUrl: string | null = null;
    if (typeof body.url === 'string') {
      try {
        safeUrl = await validateWebhookTargetUrl(body.url);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Invalid webhook URL' },
          { status: 400 },
        );
      }
    }
    const updates = {
      ...(safeUrl ? { url: safeUrl } : {}),
      ...(typeof body.secret === 'string' ? { secret: body.secret } : {}),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}),
      ...(Array.isArray(body.events) ? { events: cleanEvents(body.events) } : {}),
      ...(Array.isArray(body.resourceTypes) ? { resourceTypes: cleanResourceTypes(body.resourceTypes) } : {}),
    };

    const subscription = await updateWebhookSubscription(subscriptionId, tenantId, updates);
    return NextResponse.json({ success: true, subscription: redactWebhookSubscription(subscription) });
  } catch (error) {
    log.error('Failed to update webhook', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update webhook' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, interfaceAuthOptions);
  if (authError) return authError as NextResponse;

  try {
    const body = await req.json();
    const requestedTenantId = body?.tenantId ?? body?.tenant_id;
    const subscriptionId = body?.subscriptionId ?? body?.subscription_id;
    if (!requestedTenantId || !subscriptionId) {
      return NextResponse.json({ error: 'tenantId and subscriptionId are required' }, { status: 400 });
    }

    const actorResult = await resolveInterfaceActorContext({
      requestedTenantId,
      minimumRole: TenantRole.ADMIN,
    });
    if (!actorResult.ok) return actorResult.response;
    const { tenantId } = actorResult.actor;

    const deleted = await deleteWebhookSubscription(subscriptionId, tenantId);
    if (!deleted) {
      return NextResponse.json({ error: 'webhook_not_found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('Failed to delete webhook', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete webhook' },
      { status: 500 }
    );
  }
}
