/**
 * OpenClaw Bridge Client
 *
 * Handles HTTP/SSE communication with the OpenClaw Gateway API.
 * Uses the OpenAI-compatible /v1/chat/completions endpoint that
 * OpenClaw exposes natively.
 */

import type {
  OpenClawBridgeConfig,
  OpenClawStreamChunk,
  OpenClawTaskRequest,
  OpenClawTaskResponse,
} from './types';
import { OPENCLAW_BRIDGE_EVENTS } from './events';

const DEFAULT_TIMEOUT_MS = 60_000;

export class OpenClawBridgeClient {
  private config: Required<OpenClawBridgeConfig>;

  constructor(config: OpenClawBridgeConfig) {
    this.config = {
      ...config,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  /**
   * Submit a task to OpenClaw and receive the full response (non-streaming).
   */
  async submitTask(request: OpenClawTaskRequest): Promise<OpenClawTaskResponse> {
    this.dispatchEvent(OPENCLAW_BRIDGE_EVENTS.TASK_SUBMITTED, request);
    this.dispatchEvent(OPENCLAW_BRIDGE_EVENTS.AVATAR_STATE, { state: 'working' });

    try {
      const response = await this.fetch('/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: request.prompt }],
          stream: false,
        }),
      });

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content ?? '';

      const result: OpenClawTaskResponse = {
        taskId: data?.id ?? 'unknown',
        status: 'completed',
        response: content,
      };

      this.dispatchEvent(OPENCLAW_BRIDGE_EVENTS.TASK_COMPLETED, result);
      this.dispatchEvent(OPENCLAW_BRIDGE_EVENTS.AVATAR_STATE, { state: 'success' });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.dispatchEvent(OPENCLAW_BRIDGE_EVENTS.TASK_FAILED, { error: errorMsg });
      this.dispatchEvent(OPENCLAW_BRIDGE_EVENTS.AVATAR_STATE, { state: 'error' });
      throw error;
    }
  }

  /**
   * Stream a task response from OpenClaw via SSE.
   * Uses the OpenAI-compatible /v1/chat/completions endpoint with stream: true.
   * Yields OpenClawStreamChunk objects as they arrive.
   */
  async *streamTask(request: OpenClawTaskRequest): AsyncGenerator<OpenClawStreamChunk> {
    this.dispatchEvent(OPENCLAW_BRIDGE_EVENTS.TASK_SUBMITTED, request);
    this.dispatchEvent(OPENCLAW_BRIDGE_EVENTS.AVATAR_STATE, { state: 'working' });

    try {
      const response = await this.fetch('/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: request.prompt }],
          stream: true,
        }),
        headers: { Accept: 'text/event-stream' },
      });

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              this.dispatchEvent(OPENCLAW_BRIDGE_EVENTS.AVATAR_STATE, { state: 'success' });
              return;
            }
            try {
              const parsed = JSON.parse(data);
              // OpenAI-compatible SSE format: choices[0].delta.content
              const content = parsed?.choices?.[0]?.delta?.content;
              if (content) {
                const chunk: OpenClawStreamChunk = { type: 'text', content };
                this.dispatchEvent(OPENCLAW_BRIDGE_EVENTS.STREAM_CHUNK, chunk);
                yield chunk;
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }

      this.dispatchEvent(OPENCLAW_BRIDGE_EVENTS.TASK_COMPLETED, {});
      this.dispatchEvent(OPENCLAW_BRIDGE_EVENTS.AVATAR_STATE, { state: 'idle' });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.dispatchEvent(OPENCLAW_BRIDGE_EVENTS.TASK_FAILED, { error: errorMsg });
      this.dispatchEvent(OPENCLAW_BRIDGE_EVENTS.AVATAR_STATE, { state: 'error' });
      throw error;
    }
  }

  /**
   * Health check — verifies OpenClaw gateway is reachable.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetch('/health', { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }

  // --- Internal helpers ---

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.apiUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          ...((init.headers as Record<string, string>) ?? {}),
        },
      });

      if (!response.ok) {
        throw new Error(`OpenClaw API error: ${response.status} ${response.statusText}`);
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private dispatchEvent(name: string, detail: unknown): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    }
  }
}
