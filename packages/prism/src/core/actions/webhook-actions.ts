import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';

import { Prism } from '../../prism';
import {
  BlockType_WebhookDelivery,
  IWebhookDelivery,
} from '../blocks/webhookDelivery.block';
import {
  BlockType_WebhookSubscription,
  IWebhookSubscription,
  WebhookEvent,
} from '../blocks/webhookSubscription.block';
import { ResourceType } from '../blocks/resourceShareToken.block';
import { PrismContentQuery } from '../types';

export interface WebhookPayload {
  event: WebhookEvent;
  tenantId: string;
  resourceId: string;
  resourceType: ResourceType;
  actorUserId?: string;
  recipientUserId?: string;
  organizationId?: string;
  role?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Task lifecycle webhooks use the same envelope as share webhooks.
 * For task.* events, pass task identifiers in resourceId and include task
 * fields such as title, status, workspace path, result, or failure reason in
 * metadata. dispatchWebhookEvent intentionally preserves any metadata shape.
 */

export async function createWebhookSubscription(
  input: Omit<IWebhookSubscription, 'isActive' | 'createdAt' | 'updatedAt'> & Partial<Pick<IWebhookSubscription, 'isActive'>>
): Promise<IWebhookSubscription> {
  const prism = await Prism.getInstance();
  const now = new Date().toISOString();
  const subscription: IWebhookSubscription = {
    ...input,
    isActive: input.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  };

  const result = await prism.create(BlockType_WebhookSubscription, subscription, input.tenantId);
  if (!result || result.items.length === 0) {
    throw new Error('Failed to create webhook subscription');
  }
  return result.items[0] as IWebhookSubscription;
}

export async function listWebhookSubscriptions(tenantId: string): Promise<IWebhookSubscription[]> {
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_WebhookSubscription,
    tenantId: 'any',
    where: { parent_id: tenantId },
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  return (result.items || []) as IWebhookSubscription[];
}

export async function updateWebhookSubscription(
  subscriptionId: string,
  tenantId: string,
  updates: Partial<IWebhookSubscription>
): Promise<IWebhookSubscription> {
  const prism = await Prism.getInstance();
  const result = await prism.update(
    BlockType_WebhookSubscription,
    subscriptionId,
    { ...updates, updatedAt: new Date().toISOString() },
    tenantId
  );
  if (!result || result.items.length === 0) {
    throw new Error('Failed to update webhook subscription');
  }
  return result.items[0] as IWebhookSubscription;
}

export async function deleteWebhookSubscription(
  subscriptionId: string,
  tenantId: string
): Promise<boolean> {
  const prism = await Prism.getInstance();
  return prism.delete(BlockType_WebhookSubscription, subscriptionId, tenantId);
}

export async function listWebhookDeliveries(params: {
  tenantId: string;
  subscriptionId?: string;
  limit?: number;
}): Promise<IWebhookDelivery[]> {
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_WebhookDelivery,
    tenantId: 'any',
    where: { parent_id: params.tenantId },
    orderBy: { createdAt: 'desc' as const },
    limit: params.limit ?? 50,
  };
  const result = await prism.query(query);
  const deliveries = (result.items || []) as IWebhookDelivery[];
  return params.subscriptionId
    ? deliveries.filter((delivery) => delivery.subscriptionId === params.subscriptionId)
    : deliveries;
}

function signatureFor(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    return isPrivateIPv4(normalized.slice('::ffff:'.length));
  }
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('2001:db8')
  );
}

function isUnsafeAddress(address: string): boolean {
  const kind = net.isIP(address);
  if (kind === 4) return isPrivateIPv4(address);
  if (kind === 6) return isPrivateIPv6(address);
  return true;
}

export async function validateWebhookTargetUrl(rawUrl: string): Promise<string> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Webhook URL must not include credentials');
  }
  const host = parsed.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Webhook URL host is not allowed');
  }
  if (net.isIP(host)) {
    if (isUnsafeAddress(host)) throw new Error('Webhook URL IP is not allowed');
    return parsed.toString();
  }
  const records = await dns.lookup(host, { all: true, verbatim: false });
  if (!records.length || records.some((record) => isUnsafeAddress(record.address))) {
    throw new Error('Webhook URL resolves to a private address');
  }
  return parsed.toString();
}

async function createDelivery(
  delivery: Omit<IWebhookDelivery, 'status' | 'attemptCount' | 'createdAt'> & Partial<Pick<IWebhookDelivery, 'status' | 'attemptCount'>>
): Promise<IWebhookDelivery> {
  const prism = await Prism.getInstance();
  const result = await prism.create(
    BlockType_WebhookDelivery,
    {
      ...delivery,
      status: delivery.status ?? 'pending',
      attemptCount: delivery.attemptCount ?? 0,
      createdAt: new Date().toISOString(),
    },
    delivery.tenantId
  );
  if (!result || result.items.length === 0) {
    throw new Error('Failed to create webhook delivery');
  }
  return result.items[0] as IWebhookDelivery;
}

async function updateDelivery(
  delivery: IWebhookDelivery,
  updates: Partial<IWebhookDelivery>
): Promise<IWebhookDelivery> {
  const prism = await Prism.getInstance();
  if (!delivery._id) {
    throw new Error('Webhook delivery missing id');
  }
  const merged: IWebhookDelivery = {
    ...delivery,
    ...updates,
    _id: delivery._id,
    tenantId: delivery.tenantId,
  };
  const result = await prism.update(BlockType_WebhookDelivery, delivery._id, merged, delivery.tenantId);
  return (result.items?.[0] as IWebhookDelivery | undefined) || merged;
}

export async function dispatchWebhookEvent(payload: WebhookPayload): Promise<IWebhookDelivery[]> {
  const subscriptions = await listWebhookSubscriptions(payload.tenantId);
  const matching = subscriptions.filter((subscription) => {
    if (!subscription.isActive) return false;
    if (!subscription.events.includes(payload.event)) return false;
    if (subscription.resourceTypes?.length && !subscription.resourceTypes.includes(payload.resourceType)) return false;
    return true;
  });

  const occurredAt = payload.occurredAt ?? new Date().toISOString();
  const requestBody = { ...payload, occurredAt };

  return Promise.all(
    matching.map(async (subscription) => {
      const delivery = await createDelivery({
        tenantId: payload.tenantId,
        subscriptionId: subscription._id!,
        event: payload.event,
        resourceId: payload.resourceId,
        resourceType: payload.resourceType,
        requestBody,
      });

      try {
        const targetUrl = await validateWebhookTargetUrl(subscription.url);
        const body = JSON.stringify(requestBody);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'PearlOS-Webhooks/1.0',
          'X-PearlOS-Event': payload.event,
          'X-PearlOS-Delivery': delivery._id || '',
        };
        if (subscription.secret) {
          headers['X-PearlOS-Signature-256'] = `sha256=${signatureFor(subscription.secret, body)}`;
        }

        const response = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body,
          redirect: 'manual',
          signal: AbortSignal.timeout(8000),
        });
        const updatedDelivery = await updateDelivery(delivery, {
          status: response.ok ? 'success' : 'failed',
          attemptCount: 1,
          responseStatus: response.status,
          ...(!response.ok ? { error: `HTTP ${response.status}` } : {}),
          deliveredAt: new Date().toISOString(),
        });
        return { ...delivery, ...updatedDelivery, status: response.ok ? 'success' : 'failed', attemptCount: 1, responseStatus: response.status };
      } catch (error) {
        const updatedDelivery = await updateDelivery(delivery, {
          status: 'failed',
          attemptCount: 1,
          error: error instanceof Error ? error.message : 'Webhook delivery failed',
          deliveredAt: new Date().toISOString(),
        });
        return { ...delivery, ...updatedDelivery, status: 'failed', attemptCount: 1, error: error instanceof Error ? error.message : 'Webhook delivery failed' };
      }
    })
  );
}
