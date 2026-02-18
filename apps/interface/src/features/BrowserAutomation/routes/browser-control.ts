/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Browser Control API Route
 * 
 * Comprehensive browser automation API endpoint.
 * Migrated from Fix-RiveAvatar branch to new features-first architecture.
 */

import { NextRequest, NextResponse } from 'next/server';

import { browserAutomationService } from '@interface/features/BrowserAutomation/services';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('BrowserAutomation');

export async function POST_impl(request: NextRequest) {
  let action: string | undefined;
  let sessionId: string | undefined;
  let params: any;
  
  try {
    const body = await request.json();
    ({ action, sessionId, ...params } = body);

    // Validate required parameters
    if (!action || !sessionId) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Action and sessionId are required'
        },
        { status: 400 }
      );
    }

    let result;

    switch (action) {
      case 'create_session': {
          log.info('Creating browser session', { sessionId });
          const session = await browserAutomationService.initializeBrowserSession(sessionId);
          result = { 
            success: true, 
            sessionId: session.sessionId,
            message: 'Browser session created successfully'
          };
          log.info('Browser session created', { sessionId });
        }
        break;

      case 'navigate':
        if (!params.url) {
          return NextResponse.json(
            { success: false, error: 'URL is required for navigation' },
            { status: 400 }
          );
        }
        result = await browserAutomationService.navigateToUrl(sessionId, params.url);
        break;

      case 'perform_action':
        if (!params.actionData) {
          return NextResponse.json(
            { success: false, error: 'Action data is required' },
            { status: 400 }
          );
        }
        result = await browserAutomationService.performAction(sessionId, params.actionData);
        break;

      case 'get_page_info': {
          const pageInfo = await browserAutomationService.getPageInfo(sessionId);
          result = { 
            success: !!pageInfo, 
            data: pageInfo,
            error: pageInfo ? undefined : 'Could not retrieve page information'
          };
        }
        break;

      case 'close_session': {
          const closed = await browserAutomationService.closeBrowserSession(sessionId);
          result = { 
            success: closed,
            message: closed ? 'Browser session closed' : 'Failed to close session'
          };
        }
        break;

      default:
        return NextResponse.json(
          { 
            success: false, 
            error: `Unknown action: ${action}. Available actions: create_session, navigate, perform_action, get_page_info, close_session`
          },
          { status: 400 }
        );
    }

    return NextResponse.json(result);

  } catch (error) {
    log.error('Error in browser-control API', { error: error instanceof Error ? error.message : error });
    
    // Provide more detailed error information for debugging
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    log.error('Error details', { action, sessionId, error: errorMessage, stack: errorStack });
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process browser control request',
        details: errorMessage,
        action,
        sessionId
      },
      { status: 500 }
    );
  }
}

// GET endpoint for health check and session status
export async function GET_impl(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');

  if (sessionId) {
    // Return session status
    const pageInfo = await browserAutomationService.getPageInfo(sessionId);
    return NextResponse.json({
      sessionActive: !!pageInfo,
      currentPage: pageInfo ? {
        title: pageInfo.title,
        url: pageInfo.url
      } : null
    });
  }

  return NextResponse.json({
    service: 'Browser Automation API',
    status: 'running',
    endpoints: {
      POST: 'Control browser actions',
      GET: 'Check session status'
    }
  });
}
