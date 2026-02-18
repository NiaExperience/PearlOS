/**
 * Context-Aware Applet Creation API Route
 * 
 * Provides AI-powered creation of new HTML applets with enhanced capabilities
 * Supports user-controlled naming, semantic search optimization, and context management
 */

import { NextRequest, NextResponse } from 'next/server';

import { createEnhancedApplet } from '../../actions/enhanced-applet-actions';
import { CreateHtmlGenerationRequest } from '../../types/html-generation-types';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger, setLogContext } from '@interface/lib/logger';
import { getSessionSafely } from '@nia/prism/core/auth';

const log = getLogger('[html-generation][create-applet-route]');
const LOG_PREFIX = '[sprite-test] ';

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
        tag: '[html-generation.create-applet-route]',
      });
    }
    const body = await request.json();
    
    // Extract room URL from headers
    const roomUrl = request.headers.get('x-room-url') || request.headers.get('x-daily-room-url') || undefined;

    const createRequest: CreateHtmlGenerationRequest = {
      title: body.title,
      description: body.description,
      contentType: body.contentType || 'app',
      userRequest: body.userRequest || body.description,
      features: body.features || [],
      sourceNoteId: body.sourceNoteId,
      assistantName: body.assistantName,
      library_type: body.library_type,
      library_template_id: body.library_template_id,
      includeStorageLibrary: body.includeStorageLibrary,
      userProvidedName: body.userProvidedName || body.title,
      requestNameSuggestion: body.requestNameSuggestion,
      metadata: body.metadata,
      roomUrl,
      aiProvider: body.aiProvider || 'openai',
      aiModel: body.aiModel || 'gpt-5',
    };

    log.info(`${LOG_PREFIX}create-applet: received request`, {
      title: createRequest.title,
      contentType: createRequest.contentType,
      aiProvider: createRequest.aiProvider,
      aiModel: createRequest.aiModel,
      hasDescription: !!createRequest.description,
      hasUserRequest: !!createRequest.userRequest,
      hasRoomUrl: !!roomUrl
    });

    // Validate required parameters
    if (!createRequest.description && !createRequest.userRequest) {
      log.warn(`${LOG_PREFIX}create-applet: missing description and userRequest`);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Description or user request is required',
          data: null
        },
        { status: 400 }
      );
    }

    log.info(`${LOG_PREFIX}create-applet: calling createEnhancedApplet`, { title: createRequest.title });
    const response = await createEnhancedApplet(createRequest);
    log.info(`${LOG_PREFIX}create-applet: createEnhancedApplet completed`, { 
      success: response.success,
      hasData: !!response.data,
      dataId: (response.data as any)?._id,
      dataTitle: (response.data as any)?.title,
      requiresNameConfirmation: response.requiresNameConfirmation,
      requiresLibraryChoice: response.requiresLibraryChoice,
      versionConflictPrompt: !!response.versionConflictPrompt
    });
    
    return NextResponse.json(response);

  } catch (error) {
    log.error(`${LOG_PREFIX}create-applet: API error`, { err: error, stack: error instanceof Error ? error.stack : undefined });
    
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
        data: null
      },
      { status: statusCode }
    );
  }
}
