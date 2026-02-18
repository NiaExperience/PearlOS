import { NextRequest, NextResponse } from 'next/server';

import { sendBotMessage } from '@interface/lib/bot-messaging-server';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_bot_admin]');

interface AdminMessageRequest {
  message: string;
  mode?: 'queued' | 'immediate';
  tenantId: string;
  sessionId?: string;
  /** Optional context for message attribution (e.g., sourceType: 'user-text', userName) */
  context?: Record<string, unknown>;
}

interface AdminMessageResponse {
  status: string;
  message: string;
  mode: string;
  room_url: string;
  delivery_time: number;
}

/**
 * Extract room URL from request context (headers, session, etc.)
 */
async function extractRoomContext(request: NextRequest): Promise<string> {
  // Try to get room URL from various sources
  
  // 1. Check request headers (room context might be passed from frontend)
  const roomHeader = request.headers.get('x-room-url') || request.headers.get('x-daily-room-url');
  if (roomHeader) {
    return roomHeader;
  }
  
  // 2. Check URL search params
  const url = new URL(request.url);
  const roomParam = url.searchParams.get('room_url') || url.searchParams.get('roomUrl');
  if (roomParam) {
    return roomParam;
  }
  
  // 3. For now, we'll require the frontend to pass room URL in request body or headers
  // In a more sophisticated setup, we could extract from user session or call context
  throw new Error('Room URL not found in request context. Please include x-room-url header or room_url query parameter.');
}

/**
 * Send admin message to bot server
 * NOTE: Open endpoint for simplicity - no authentication required
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { message, mode = 'queued', tenantId, sessionId, roomUrl: bodyRoomUrl, context }: AdminMessageRequest & { roomUrl?: string } = body;
    
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message is required and must be non-empty' },
        { status: 400 }
      );
    }
    
    if (!tenantId || typeof tenantId !== 'string') {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      );
    }
    
    if (mode !== 'queued' && mode !== 'immediate') {
      return NextResponse.json(
        { error: 'Mode must be either "queued" or "immediate"' },
        { status: 400 }
      );
    }
    
    // Extract room context (from body if internal, from headers/query if external)
    let roomUrl: string;
    if (bodyRoomUrl && typeof bodyRoomUrl === 'string') {
      // Internal requests provide roomUrl in body
      roomUrl = bodyRoomUrl;
    } else {
      // External requests use headers or query params
      try {
        roomUrl = await extractRoomContext(request);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
          { error: `Failed to extract room context: ${errorMessage}` },
          { status: 400 }
        );
      }
    }
    
    try {
      const botServerResponse = await sendBotMessage({
        roomUrl,
        message,
        mode,
        senderId: 'system',
        senderName: 'System',
        tenantId,
        sessionId,
        context,
      });
      
      if (!botServerResponse.ok) {
        const errorText = await botServerResponse.text();
        // Log bot server error (structured logger)
        log.error('Bot server error', { status: botServerResponse.status, body: errorText, roomUrl });
        
        // Return appropriate error based on bot server response
        if (botServerResponse.status === 404) {
          return NextResponse.json(
            { error: 'No active bot session found for this room' },
            { status: 404 }
          );
        } else if (botServerResponse.status === 401 || botServerResponse.status === 403) {
          return NextResponse.json(
            { error: 'Bot server authentication failed' },
            { status: 500 }
          );
        } else {
          return NextResponse.json(
            { error: `Bot server communication failed: ${botServerResponse.status} ${errorText}` },
            { status: 500 }
          );
        }
      }
      
      // Parse bot server response
      let botResponse: AdminMessageResponse;
      try {
        botResponse = await botServerResponse.json();
      } catch (parseError) {
        log.error('Failed to parse bot response', { error: parseError });
        return NextResponse.json(
          { error: 'Invalid response from bot server' },
          { status: 502 }
        );
      }
      
      // Log bot server response (structured logger)
      log.info('Bot server responded', {
        status: botResponse.status,
        mode: botResponse.mode,
        deliveryTime: botResponse.delivery_time,
        roomUrl,
      });
      
      // Return success response to frontend
      return NextResponse.json({
        success: true,
        status: botResponse.status,
        message: botResponse.message,
        mode: botResponse.mode,
        delivery_time: botResponse.delivery_time,
        room_url: roomUrl
      });
    } catch (fetchError) {
      log.error('Fetch to bot server failed', { error: fetchError, roomUrl, tenantId });
      const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
      return NextResponse.json(
        { error: `Bot server connection failed: ${errorMessage}` },
        { status: 502 }
      );
    }
    
  } catch (error) {
    // Log unexpected error (structured logger)
    log.error('Unexpected admin API error', { error });
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: `Internal server error: ${errorMessage}` },
      { status: 500 }
    );
  }
}