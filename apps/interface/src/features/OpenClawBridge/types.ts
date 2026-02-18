/**
 * Types for OpenClaw Bridge communication.
 */

export interface OpenClawTaskRequest {
  /** The user's message or task description */
  prompt: string;
  /** OpenClaw session/channel to target (e.g. discord channel, subagent label) */
  sessionTarget?: string;
  /** Optional workspace path context */
  workspacePath?: string;
  /** Assistant ID from PearlOS for tenant scoping */
  assistantId: string;
  /** Unique conversation/thread ID for continuity */
  conversationId?: string;
}

export interface OpenClawStreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done';
  content: string;
  /** For tool_call/tool_result, the tool name */
  toolName?: string;
  /** Timestamp from OpenClaw */
  timestamp?: string;
}

export interface OpenClawTaskResponse {
  /** Unique task/session ID from OpenClaw */
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** Final assembled text response */
  response?: string;
  /** Structured tool results if any */
  toolResults?: Array<{
    tool: string;
    result: unknown;
  }>;
  /** Error details if failed */
  error?: string;
}

export interface OpenClawBridgeConfig {
  /** OpenClaw Gateway API base URL */
  apiUrl: string;
  /** API key or token for authentication */
  apiKey: string;
  /** Timeout in ms for requests (default 30000) */
  timeoutMs?: number;
}
