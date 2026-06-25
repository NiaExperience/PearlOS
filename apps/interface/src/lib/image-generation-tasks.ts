import type { NextRequest } from 'next/server';

import { getLogger } from './logger';
import {
  resolveInterfaceActorContext,
  type InterfaceActorContext,
} from './tenant-actor';

const log = getLogger('[image_generation_tasks]');

const BOT_GATEWAY = (process.env.BOT_GATEWAY_URL || 'http://localhost:4444').replace(/\/$/, '');
const SHARED_SECRET = process.env.BOT_CONTROL_SHARED_SECRET || '';

export interface ImageGenerationTaskHandle {
  id: string;
  actor: InterfaceActorContext;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (SHARED_SECRET) {
    headers['X-Bot-Secret'] = SHARED_SECRET;
    headers.Authorization = `Bearer ${SHARED_SECRET}`;
  }
  return headers;
}

async function readUpstreamText(response: Response): Promise<string> {
  return (await response.text().catch(() => '')).slice(0, 500);
}

export async function startImageGenerationTask(
  request: NextRequest,
  params: {
    title: string;
    task: string;
    requestedTenantId?: unknown;
    note?: string;
  },
): Promise<ImageGenerationTaskHandle | null> {
  if (process.env.NODE_ENV === 'test') {
    return null;
  }

  const actorResult = await resolveInterfaceActorContext({
    request,
    requestedTenantId: params.requestedTenantId,
    allowServiceClaims: true,
  });
  if (!actorResult.ok) {
    throw new Error('Image generation requires authenticated Agency task tracking');
  }

  const actor = actorResult.actor;
  const createResp = await fetch(`${BOT_GATEWAY}/api/tasks`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      task: params.task,
      title: params.title,
      source: 'web_chat',
      created_by: 'system',
      assignee: 'pearl',
      urgency: 'normal',
      requester_email: actor.userEmail,
      requester_user_id: actor.userId,
      requester_tenant_id: actor.tenantId,
      requester_tenant_role: actor.tenantRole,
      max_retries: 0,
    }),
  });

  if (!createResp.ok) {
    throw new Error(
      `Agency task list rejected image generation tracking: ${await readUpstreamText(createResp)}`,
    );
  }

  const created = await createResp.json().catch(() => ({}));
  const rawTask = created?.task as Record<string, unknown> | undefined;
  const id = String(rawTask?.id || rawTask?.taskId || '');
  if (!id) {
    throw new Error('Agency task list returned an invalid image generation task');
  }

  const started = await updateImageGenerationTask(
    { id, actor },
    {
      status: 'in_progress',
      note: params.note || 'Image generation started.',
    },
  );
  if (!started) {
    throw new Error('Agency task list could not mark image generation in progress');
  }

  return { id, actor };
}

export async function updateImageGenerationTask(
  handle: ImageGenerationTaskHandle | null,
  patch: {
    status?: 'in_progress' | 'completed' | 'failed';
    note?: string;
    result?: string;
    noRetry?: boolean;
  },
): Promise<boolean> {
  if (!handle) return false;
  const response = await fetch(`${BOT_GATEWAY}/api/tasks/${encodeURIComponent(handle.id)}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.note ? { note: patch.note } : {}),
      ...(patch.result ? { result: patch.result } : {}),
      ...(patch.noRetry ? { no_retry: true } : {}),
    }),
  });
  if (!response.ok) {
    log.warn('Agency image generation task update failed', {
      status: response.status,
      detail: await readUpstreamText(response),
    });
    return false;
  }
  return true;
}

export async function completeImageGenerationTask(
  handle: ImageGenerationTaskHandle | null,
  note: string,
): Promise<void> {
  await updateImageGenerationTask(handle, {
    status: 'completed',
    note,
  }).catch((error) => {
    log.warn('Could not complete Agency image generation task', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function failImageGenerationTask(
  handle: ImageGenerationTaskHandle | null,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  await updateImageGenerationTask(handle, {
    status: 'failed',
    result: message.slice(0, 1000),
    note: `Image generation failed: ${message.slice(0, 300)}`,
    noRetry: true,
  }).catch((taskError) => {
    log.warn('Could not fail Agency image generation task', {
      error: taskError instanceof Error ? taskError.message : String(taskError),
    });
  });
}
