/**
 * OpenClaw Bridge Adapter
 *
 * Connects PearlOS (nia-universal) to OpenClaw's agent execution engine.
 * MVP flow: user message → bridge → OpenClaw API → streamed response → PearlOS UI
 */

export { OpenClawBridgeClient } from './client';
export { OPENCLAW_BRIDGE_EVENTS } from './events';
export { triggerOpenClawTask, dispatchOpenClawTask } from './triggerOpenClawTask';
export type {
  OpenClawTaskRequest,
  OpenClawTaskResponse,
  OpenClawStreamChunk,
  OpenClawBridgeConfig,
} from './types';
export type { TriggerOpenClawTaskParams, TriggerOpenClawTaskResult } from './triggerOpenClawTask';

// UI Components
export { OpenClawStatus } from './components/OpenClawStatus';
export { OpenClawResponse } from './components/OpenClawResponse';
export { OpenClawEventBridge } from './components/OpenClawEventBridge';
