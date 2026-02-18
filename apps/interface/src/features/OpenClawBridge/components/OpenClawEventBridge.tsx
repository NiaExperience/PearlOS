'use client';

/**
 * OpenClawEventBridge
 *
 * Listens for nia.event envelopes carrying `openclaw.task.trigger` and
 * dispatches the task through the bridge client. This wires the pipecat
 * bot's tool call into the client-side streaming pipeline.
 *
 * Mount this component once (e.g. in the desktop layout) — it renders nothing.
 */

import { useEffect } from 'react';

import { NIA_EVENT_OPENCLAW_TASK } from '@interface/features/DailyCall/events/niaEventRouter';

import { triggerOpenClawTask } from '../triggerOpenClawTask';
import { OPENCLAW_BRIDGE_EVENTS } from '../events';

export function OpenClawEventBridge() {
  useEffect(() => {
    function handleOpenClawTask(e: Event) {
      const detail = (e as CustomEvent).detail;
      const prompt: string | undefined =
        detail?.payload?.prompt ?? detail?.payload?.task ?? detail?.prompt ?? detail?.task;

      if (!prompt) return;

      const assistantId: string | undefined =
        detail?.payload?.assistantId ?? detail?.assistantId;
      const conversationId: string | undefined =
        detail?.payload?.conversationId ?? detail?.conversationId;

      // Fire-and-forget: stream the task and dispatch completion/failure events
      triggerOpenClawTask({ prompt, assistantId, conversationId }).then(
        (result) => {
          if (result.success) {
            window.dispatchEvent(
              new CustomEvent(OPENCLAW_BRIDGE_EVENTS.TASK_COMPLETED, {
                detail: { response: result.response },
              })
            );
          } else {
            window.dispatchEvent(
              new CustomEvent(OPENCLAW_BRIDGE_EVENTS.TASK_FAILED, {
                detail: { error: result.error },
              })
            );
          }
        },
        (err) => {
          window.dispatchEvent(
            new CustomEvent(OPENCLAW_BRIDGE_EVENTS.TASK_FAILED, {
              detail: { error: String(err) },
            })
          );
        }
      );
    }

    window.addEventListener(NIA_EVENT_OPENCLAW_TASK, handleOpenClawTask);
    return () =>
      window.removeEventListener(NIA_EVENT_OPENCLAW_TASK, handleOpenClawTask);
  }, []);

  return null;
}
