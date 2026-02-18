/**
 * Context-Aware Applet Modification API Route
 * 
 * Provides AI-powered modification of existing HTML applets with full context restoration
 * Supports direct context, appendix method, and summary-based modifications
 */

import { NextRequest, NextResponse } from 'next/server';

import { modifyEnhancedApplet } from '../../actions/enhanced-applet-actions';
import { ModifyAppletRequest } from '../../types/html-generation-types';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger, setLogContext } from '@interface/lib/logger';
import { getSessionSafely } from '@nia/prism/core/auth';

const log = getLogger('[html-generation.modify-applet-route]');

export async function POST_impl(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSessionSafely(request, interfaceAuthOptions);
    if (session?.user) {
      const sessionId = typeof (session.user as any)?.sessionId === 'string' ? (session.user as any).sessionId : session.user.id;
      setLogContext({
        sessionId: sessionId ?? undefined,
        userId: session.user.id ?? undefined,
        userName:
          'name' in session.user && typeof session.user.name === 'string'
            ? session.user.name
            : 'email' in session.user && typeof session.user.email === 'string'
              ? session.user.email
              : undefined,
        tag: '[html-generation.modify-applet-route]',
      });
    }
    const body = await request.json();
    
    // Extract room URL from headers
    const roomUrl = request.headers.get('x-room-url') || request.headers.get('x-daily-room-url') || undefined;
    
    const modifyRequest: ModifyAppletRequest = {
      appletId: body.appletId,
      modificationRequest: body.modificationRequest,
      aiProvider: body.aiProvider || 'openai',
      aiModel: body.aiModel || 'gpt-5',
      assistantName: body.assistantName,
      versioningPreference: body.versioningPreference || 'modify_existing',
      saveChoice: body.saveChoice || 'original',
      sourceNoteId: body.sourceNoteId,
      sourceNoteTitle: body.sourceNoteTitle,
      roomUrl,
    };

    // Validate required parameters
    if (!modifyRequest.appletId) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Applet ID is required',
          data: null,
          contextMethod: 'direct' as const,
          changesDescription: '',
          modificationId: ''
        },
        { status: 400 }
      );
    }

    if (!modifyRequest.modificationRequest?.trim()) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Modification request is required',
          data: null,
          contextMethod: 'direct' as const,
          changesDescription: '',
          modificationId: ''
        },
        { status: 400 }
      );
    }

    // Validate applet ID format (UUID, MongoDB ObjectId, or simple alphanumeric for tests)
    const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(modifyRequest.appletId);
    const isValidObjectId = /^[0-9a-f]{24}$/i.test(modifyRequest.appletId);
    const isValidSimpleId = /^[a-zA-Z0-9_-]{3,50}$/.test(modifyRequest.appletId);
    
    if (!isValidUUID && !isValidObjectId && !isValidSimpleId) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid applet ID format',
          data: null,
          contextMethod: 'direct' as const,
          changesDescription: '',
          modificationId: ''
        },
        { status: 400 }
      );
    }

    const response = await modifyEnhancedApplet(modifyRequest);
    
    return NextResponse.json(response);

    } catch (error) {
      log.error('Modify applet API error', { err: error });
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    // Handle specific error types
    let statusCode = 500;
    if (errorMessage.includes('Unauthorized')) {
      statusCode = 403;
    } else if (errorMessage.includes('not found')) {
      statusCode = 404;
    } else if (errorMessage.includes('Invalid')) {
      statusCode = 400;
    }
    
    return NextResponse.json(
      { 
        success: false, 
        error: errorMessage,
        data: null,
        contextMethod: 'direct' as const,
        changesDescription: '',
        modificationId: ''
      },
      { status: statusCode }
    );
  }
}

export async function PUT_impl(request: NextRequest): Promise<NextResponse> {
  // Alias for POST - both handle modification requests
  return POST_impl(request);
}
