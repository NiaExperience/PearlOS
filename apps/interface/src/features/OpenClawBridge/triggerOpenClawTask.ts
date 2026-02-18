/**
 * Tool handler for `triggerOpenClawTask`
 *
 * Called when the AI decides to delegate a task to OpenClaw.
 * Instantiates the bridge client, streams the response, and
 * dispatches window events so the UI can render results in real-time.
 */

import { OpenClawBridgeClient } from './client';
import { OPENCLAW_BRIDGE_EVENTS } from './events';
import type { OpenClawTaskRequest, OpenClawStreamChunk } from './types';

/** Environment-driven config with sensible defaults */
function getBridgeClient(): OpenClawBridgeClient {
  const apiUrl =
    process.env.NEXT_PUBLIC_OPENCLAW_API_URL ??
    process.env.OPENCLAW_API_URL ??
    'http://localhost:3100';
  const apiKey =
    process.env.NEXT_PUBLIC_OPENCLAW_API_KEY ??
    process.env.OPENCLAW_API_KEY ??
    '';

  return new OpenClawBridgeClient({ apiUrl, apiKey });
}

export interface TriggerOpenClawTaskParams {
  /** The task / prompt to send to OpenClaw */
  prompt: string;
  /** PearlOS assistant ID for scoping */
  assistantId?: string;
  /** Conversation thread ID for continuity */
  conversationId?: string;
}

export interface TriggerOpenClawTaskResult {
  success: boolean;
  /** Accumulated full-text response */
  response?: string;
  error?: string;
}

/**
 * Execute the triggerOpenClawTask tool call.
 *
 * Streams the response from the bridge server and collects it into a
 * single result string that can be returned to the conversation.
 */
export async function triggerOpenClawTask(
  params: TriggerOpenClawTaskParams
): Promise<TriggerOpenClawTaskResult> {
  const { prompt, assistantId = 'default', conversationId } = params;

  if (!prompt?.trim()) {
    return { success: false, error: 'prompt is required' };
  }

  const client = getBridgeClient();

  const request: OpenClawTaskRequest = {
    prompt,
    assistantId,
    conversationId,
  };

  try {
    let accumulated = '';

    for await (const chunk of client.streamTask(request)) {
      if (chunk.type === 'text') {
        accumulated += chunk.content;
      } else if (chunk.type === 'error') {
        return { success: false, error: chunk.content };
      }
    }

    return { success: true, response: accumulated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Dispatch helper — used by the voice/tool pipeline to fire and forget.
 * Dispatches a window event so the UI picks it up; returns the accumulated result.
 */
export function dispatchOpenClawTask(prompt: string, payload?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(OPENCLAW_BRIDGE_EVENTS.TASK_SUBMITTED, {
      detail: { prompt, ...payload },
    })
  );
}
