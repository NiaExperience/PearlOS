import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { dispatchWebhookEvent } from '@nia/prism/core/actions/webhook-actions';
import { ResourceType } from '@nia/prism/core/blocks/resourceShareToken.block';
import type { WebhookEvent } from '@nia/prism/core/blocks/webhookSubscription.block';

import { taskArtifactUrl } from '../lib/task-artifacts';

const BOT_GATEWAY = (process.env.BOT_GATEWAY_URL || 'http://localhost:4444').replace(/\/$/, '');
const TASK_EVENTS = new Set<WebhookEvent>([
  'task.created',
  'task.started',
  'task.completed',
  'task.failed',
  'task.cancelled',
]);

function sharedSecret(): string {
  return process.env.BOT_CONTROL_SHARED_SECRET || process.env.PEARL_TASKS_BOT_SECRET || '';
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validSignature(req: NextRequest, bodyText: string, expected: string): boolean {
  const timestamp = req.headers.get('x-pearlos-timestamp')?.trim() || '';
  const signature = req.headers.get('x-pearlos-signature-256')?.trim() || '';
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 300_000) {
    return false;
  }
  const digest = crypto
    .createHmac('sha256', expected)
    .update(`${timestamp}.${bodyText}`)
    .digest('hex');
  return signature.startsWith('sha256=') && timingSafeEqual(signature, `sha256=${digest}`);
}

function isAuthorized(req: NextRequest, bodyText: string): boolean {
  const expected = sharedSecret();
  if (!expected) return false;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const botSecret = req.headers.get('x-bot-secret')?.trim();
  return (bearer === expected || botSecret === expected) && validSignature(req, bodyText, expected);
}

function gatewayHeaders(): Record<string, string> {
  const secret = sharedSecret();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
    headers['X-Bot-Secret'] = secret;
  }
  return headers;
}

function taskEventForStatus(status: string): WebhookEvent | null {
  if (status === 'pending') return 'task.created';
  if (status === 'in_progress') return 'task.started';
  if (status === 'completed') return 'task.completed';
  if (status === 'failed') return 'task.failed';
  if (status === 'cancelled') return 'task.cancelled';
  return null;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function interfaceBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_INTERFACE_URL ||
    process.env.PEARLOS_INTERFACE_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

function absoluteArtifactUrl(task: Record<string, unknown>): string | null {
  const artifactPath = taskArtifactUrl(task);
  if (!artifactPath) return null;
  try {
    return new URL(artifactPath, interfaceBaseUrl()).toString();
  } catch {
    return artifactPath;
  }
}

function safeResultSummary(value: unknown): string | undefined {
  const result = cleanString(value)
    .replace(/\/srv\/pearl-user-workspaces\/[^\s`'")]+/g, '[task-workspace]')
    .replace(/\/workspace\/nia-universal[^\s`'")]*/g, '[internal-path]')
    .replace(/\/home\/deploy\/pearlos[^\s`'")]*/g, '[internal-path]')
    .replace(/\/opt\/pearlos[^\s`'")]*/g, '[internal-path]')
    .replace(/\/root\/\.openclaw[^\s`'")]*/g, '[internal-path]');
  return result ? result.slice(0, 4000) : undefined;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const bodyText = await req.text();
  if (!isAuthorized(req, bodyText)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const task = body?.task && typeof body.task === 'object' ? body.task as Record<string, unknown> : null;
  if (!task) {
    return NextResponse.json({ error: 'task_required' }, { status: 400 });
  }
  const taskId = cleanString(task.id || task.taskId);
  if (!taskId) {
    return NextResponse.json({ error: 'task_id_required' }, { status: 400 });
  }
  const upstream = await fetch(`${BOT_GATEWAY}/api/tasks/${encodeURIComponent(taskId)}`, {
    headers: gatewayHeaders(),
    cache: 'no-store',
  });
  if (upstream.status === 404) {
    return NextResponse.json({ error: 'task_not_found' }, { status: 404 });
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: 'task_lookup_failed' }, { status: upstream.status });
  }
  const taskData = await upstream.json();
  const currentTask = taskData?.task && typeof taskData.task === 'object'
    ? taskData.task as Record<string, unknown>
    : null;
  if (!currentTask) {
    return NextResponse.json({ error: 'task_not_found' }, { status: 404 });
  }
  if (currentTask.webhook_notified_at || currentTask.webhookNotifiedAt) {
    return NextResponse.json({ ok: true, alreadyNotified: true, deliveryCount: 0 });
  }

  const status = cleanString(currentTask.status);
  const statusEvent = taskEventForStatus(status);
  const requestedEvent = cleanString(body?.event) as WebhookEvent;
  if (requestedEvent && statusEvent && requestedEvent !== statusEvent) {
    return NextResponse.json({ error: 'event_status_mismatch' }, { status: 400 });
  }
  const event = requestedEvent || statusEvent;
  if (!event || !TASK_EVENTS.has(event)) {
    return NextResponse.json({ error: 'invalid_task_event' }, { status: 400 });
  }

  const tenantId = cleanString(currentTask.requester_tenant_id || currentTask.requesterTenantId);
  if (!tenantId || !taskId) {
    return NextResponse.json({ error: 'task_scope_required' }, { status: 400 });
  }

  const artifactUrl = absoluteArtifactUrl(currentTask);
  const resultSummary = safeResultSummary(currentTask.result);
  const deliveries = await dispatchWebhookEvent({
    event,
    tenantId,
    resourceId: taskId,
    resourceType: ResourceType.Task,
    actorUserId: cleanString(currentTask.requester_user_id || currentTask.requesterUserId) || undefined,
    occurredAt: cleanString(currentTask.completed_at || currentTask.timestamp_updated) || undefined,
    metadata: {
      taskId,
      title: cleanString(currentTask.title),
      status,
      source: cleanString(currentTask.source),
      kind: cleanString(currentTask.kind),
      swarmCategory: cleanString(currentTask.swarm_category || currentTask.swarmCategory),
      agents: Array.isArray(currentTask.agents) ? currentTask.agents.map(String).filter(Boolean) : [],
      result: resultSummary,
      noteFilename: cleanString(currentTask.note_filename || currentTask.noteFilename) || undefined,
      artifactUrl: artifactUrl || undefined,
      artifactPath: taskArtifactUrl(currentTask) || undefined,
    },
  });
  const shouldMarkNotified =
    deliveries.length === 0 ||
    deliveries.some((delivery) => delivery.status === 'success');
  if (shouldMarkNotified) {
    await fetch(`${BOT_GATEWAY}/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      headers: gatewayHeaders(),
      body: JSON.stringify({ webhook_notified_at: new Date().toISOString() }),
    }).catch(() => null);
  }

  return NextResponse.json({
    ok: true,
    event,
    deliveryCount: deliveries.length,
    webhookMarkedNotified: shouldMarkNotified,
    deliveries: deliveries.map((delivery) => ({
      id: delivery._id,
      status: delivery.status,
      responseStatus: delivery.responseStatus,
      error: delivery.error,
    })),
  });
}
