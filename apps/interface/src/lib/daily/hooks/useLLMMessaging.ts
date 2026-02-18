/**
 * LLM Messaging Hook
 * 
 * React hook for sending messages to the Pipecat bot's LLM context.
 * Integrates with the existing Daily infrastructure.
 * 
 * @example
 * ```typescript
 * import { useLLMMessaging } from '@interface/lib/daily/hooks/useLLMMessaging';
 * 
 * const MyComponent = () => {
 *   const { sendMessage, isReady } = useLLMMessaging();
 *   
 *   const notifyBot = async (message: string) => {
 *     if (isReady) {
 *       await sendMessage({
 *         content: message,
 *         role: 'system',
 *         mode: 'queued'
 *       });
 *     }
 *   };
 * };
 * ```
 */

import { useSession } from 'next-auth/react';
import { useCallback } from 'react';

import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { sendLLMMessage, type SendLLMMessageOptions } from '@interface/lib/daily/llm-messaging';

import { getClientLogger } from '../../client-logger';

const log = getClientLogger('[daily_llm_hook]');

/**
 * Hook for sending messages to the bot's LLM context via Daily.
 * 
 * @returns Object with sendMessage function and isReady status
 */
export function useLLMMessaging() {
  const { getCallObject, roomUrl } = useVoiceSessionContext();
  const { data: session } = useSession();
  const resolvedSessionId = (session as any)?.sessionId ?? (session?.user as any)?.sessionId;
  const resolvedUserId = (session as any)?.userId ?? session?.user?.id;
  const resolvedUserName = (session as any)?.userName ?? session?.user?.name;

  const sendMessage = useCallback(async (options: SendLLMMessageOptions) => {
    try {
      const daily = getCallObject();
      await sendLLMMessage(
        daily,
        {
          ...options,
          sessionId: resolvedSessionId,
          senderId: options.senderId || resolvedUserId,
          senderName: options.senderName || resolvedUserName,
        },
        roomUrl
      );
    } catch (error) {
      log.error('Failed to send message', { error, roomUrl });
      // Don't throw - allow caller to handle gracefully
    }
  }, [getCallObject, resolvedSessionId, resolvedUserId, resolvedUserName, roomUrl]);

  const isReady = useCallback(() => {
    try {
      const daily = getCallObject();
      return daily !== null && roomUrl !== null;
    } catch {
      return false;
    }
  }, [getCallObject, roomUrl]);

  return {
    sendMessage,
    isReady: isReady()
  };
}
