/**
 * LLM Messaging for Pipecat Bot
 * 
 * Utilities for sending messages to the Pipecat bot's LLM context via Daily transport.
 * Drop-in replacement for legacy VAPI vapi.send() calls.
 * 
 * @example
 * ```typescript
 * import { useLLMMessaging } from '@interface/lib/daily/hooks/useLLMMessaging';
 * 
 * const MyComponent = () => {
 *   const { sendMessage } = useLLMMessaging();
 *   
 *   const notify = async () => {
 *     await sendMessage({
 *       content: 'User completed action',
 *       role: 'system',
 *       mode: 'queued'
 *     });
 *   };
 * };
 * ```
 */

import type { DailyCall } from '@daily-co/daily-js';

import { getClientLogger } from '../client-logger';

/**
 * Options for sending a message to the LLM context
 */
export interface SendLLMMessageOptions {
  /**
   * Message content to send to the LLM
   */
  content: string;
  
  /**
   * Role of the message in the conversation
   * @default 'system'
   */
  role?: 'system' | 'assistant';
  
  /**
   * Delivery mode for the message
   * - 'immediate': Interrupt current processing and inject immediately
   * - 'queued': Add to queue for next LLM processing cycle
   * @default 'queued'
   */
  mode?: 'immediate' | 'queued';
  
  /**
   * Identifier of the message sender
   * @default 'system'
   */
  senderId?: string;
  
  /**
   * Display name of the message sender
   * @default 'System'
   */
  senderName?: string;

  /**
   * Session identifier for gateway correlation
   */
  sessionId?: string;
}

/**
 * Internal message payload structure sent through Daily transport
 */
export interface LLMContextMessagePayload {
  type: 'llm-context-message';
  prompt: string;
  role: 'system' | 'assistant';
  mode: 'immediate' | 'queued';
  senderId: string;
  senderName: string;
  timestamp: number;
}

const log = getClientLogger('[daily_llm]');

/**
 * Send a message to the Pipecat LLM context via bot admin API (internal mode).
 * Messages are forwarded through the server to the bot's event bus.
 * Uses shared secret for internal authorization (bypasses admin privilege check).
 * Drop-in replacement for vapi.send({ type: MessageTypeEnum.ADD_MESSAGE, ... })
 * 
 * @param daily - Daily call instance (not used, kept for API compatibility)
 * @param options - Message content and delivery options
 * @param roomUrl - Room URL from voice session context (required)
 * 
 * @example
 * ```typescript
 * const { roomUrl } = useVoiceSessionContext();
 * await sendLLMMessage(daily, {
 *   content: 'Document processed successfully',
 *   role: 'assistant',
 *   mode: 'immediate'
 * }, roomUrl);
 * ```
 */
export async function sendLLMMessage(
  daily: DailyCall | null | undefined,
  options: SendLLMMessageOptions,
  roomUrl?: string | null
): Promise<void> {
  if (!daily) {
    log.warn('No Daily instance available');
    return;
  }

  const {
    content,
    mode = 'queued',
    sessionId,
    senderId,
    senderName,
  } = options;

  // Room URL must be provided from context
  if (!roomUrl) {
    log.warn('No room URL provided from voice session context');
    return;
  }

  // Get tenant ID from URL or session storage
  // In production, this should come from auth context
  const tenantId = sessionStorage.getItem('tenantId') || 'default';

  try {
    const localParticipant = (daily?.participants()?.local as any) || {};
    const derivedSessionId = sessionId || localParticipant.session_id;
    const derivedUserId = senderId || localParticipant.user_id || localParticipant.userId || '';
    const derivedUserName = senderName || localParticipant.user_name || localParticipant.userName || '';
    // Send via admin API endpoint (open, no auth required for simplicity)
    const response = await fetch('/api/bot/admin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-room-url': roomUrl, // Pass room URL in header
        'x-session-id': derivedSessionId || '',
        'x-user-id': derivedUserId,
        'x-user-name': derivedUserName,
      },
      body: JSON.stringify({
        message: content,
        mode: mode,
        tenantId: tenantId,
        roomUrl: roomUrl, // Provide roomUrl in body
        sessionId: derivedSessionId,
        userId: derivedUserId,
        userName: derivedUserName,
      }),
    });

    if (!response.ok) {
      let error;
      try {
        error = await response.json();
      } catch (e) {
        error = { error: `Failed to parse error response: ${response.status} ${response.statusText}` };
      }
      log.error('Admin API error', { status: response.status, error });
      throw new Error(error.error || `Failed to send message: ${response.status}`);
    }

    // eslint-disable-next-line no-console
    log.info('Message sent successfully via admin API', { roomUrl, mode });
  } catch (error) {
    log.error('Failed to send message', { error, roomUrl });
    throw error;
  }
}

/**
 * Create a message dispatcher with a send() method.
 * Useful for gradual migration or creating reusable message senders.
 * 
 * @param daily - Daily call instance
 * @returns Object with send() method that accepts legacy message format
 * 
 * @example
 * ```typescript
 * const dispatcher = createMessageDispatcher(daily);
 * 
 * // Legacy format still works
 * dispatcher.send({
 *   type: 'add-message',
 *   message: {
 *     role: 'system',
 *     content: 'Legacy message'
 *   }
 * });
 * ```
 */
export function createMessageDispatcher(daily: DailyCall | null | undefined) {
  return {
    send: (message: { type: string; message: { role: string; content: string } }) => {
      if (message.type === 'add-message' || message.type === 'ADD_MESSAGE') {
        return sendLLMMessage(daily, {
          content: message.message.content,
          role: message.message.role as 'system' | 'assistant',
          mode: 'queued'
        });
      }
      log.warn('Unsupported message type', { type: message.type });
    }
  };
}
