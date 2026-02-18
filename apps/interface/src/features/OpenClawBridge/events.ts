/**
 * Custom event names for OpenClaw Bridge integration.
 * These events are dispatched on the window/document for cross-feature communication.
 */

export const OPENCLAW_BRIDGE_EVENTS = {
  /** Fired when a task is submitted to OpenClaw */
  TASK_SUBMITTED: 'openclaw:task:submitted',
  /** Fired when streaming chunks arrive */
  STREAM_CHUNK: 'openclaw:stream:chunk',
  /** Fired when a task completes */
  TASK_COMPLETED: 'openclaw:task:completed',
  /** Fired on task failure */
  TASK_FAILED: 'openclaw:task:failed',
  /** Fired to request the avatar state change (working/idle/success/error) */
  AVATAR_STATE: 'openclaw:avatar:state',
} as const;
