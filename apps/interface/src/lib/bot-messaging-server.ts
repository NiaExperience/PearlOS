
/**
 * Server-side utility for sending admin messages to the bot control server.
 * Shared by API routes and Server Actions.
 */

// Use same configuration logic as joinImpl.ts to ensure consistency
const BOT_CONTROL_BASE_URL = (process.env.BOT_CONTROL_BASE_URL || process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || '').replace(/\/$/, '');

import { getLogger } from './logger';

export interface SendBotMessageParams {
  roomUrl: string;
  message: string;
  mode?: 'queued' | 'immediate';
  senderId?: string;
  senderName?: string;
  tenantId?: string;
  sessionId?: string;
  /** Optional context for message attribution (e.g., sourceType: 'user-text') */
  context?: Record<string, unknown>;
}

/**
 * Sends a message to the bot control server.
 * 
 * @param params - The message parameters
 * @returns Promise resolving to the response from the bot server
 */
export async function sendBotMessage(params: SendBotMessageParams): Promise<Response> {
  const log = getLogger('[bot-messaging]');
  const {
    roomUrl,
    message,
    mode = 'queued',
    senderId = 'system',
    senderName = 'System',
    tenantId,
    sessionId,
    context,
  } = params;

  if (!BOT_CONTROL_BASE_URL) {
    log.error('BOT_CONTROL_BASE_URL is not configured');
    throw new Error('Bot control URL is not configured');
  }

  if (!roomUrl) {
    log.warn('No room URL provided, skipping message send');
    // Return a mock response to avoid breaking the flow if room URL is missing
    return new Response(JSON.stringify({ skipped: true, reason: 'no_room_url' }), { status: 200 });
  }

  const payload: Record<string, unknown> = {
    room_url: roomUrl,
    message: message.trim(),
    mode,
    sender_id: senderId,
    sender_name: senderName,
    tenant_id: tenantId,
    sessionId,
    timestamp: Date.now()
  };
  
  // Add context if provided (for user text attribution, etc.)
  if (context) {
    payload.context = context;
  }

  log.info('Forwarding admin message to bot server', {
    mode,
    roomUrl,
    sender: senderName,
    messageLength: message.trim().length,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (process.env.BOT_CONTROL_SHARED_SECRET) {
    headers['X-Bot-Secret'] = process.env.BOT_CONTROL_SHARED_SECRET;
  }

  try {
    const response = await fetch(`${BOT_CONTROL_BASE_URL}/admin`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('Bot server error response', {
        status: response.status,
        bodyLength: errorText?.length ?? 0,
      });
      // We don't throw here to allow the caller to handle the response object
    }

    return response;
  } catch (error) {
    log.error('Fetch failed when sending admin message', { error });
    throw error;
  }
}
