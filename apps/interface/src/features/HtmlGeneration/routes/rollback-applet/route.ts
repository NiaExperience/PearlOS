/**
 * Applet Rollback API Route
 * 
 * Reverts an applet to a previous version using its modification history
 */

import { NextRequest, NextResponse } from 'next/server';

import { rollbackEnhancedApplet } from '../../actions/enhanced-applet-actions';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger, setLogContext } from '@interface/lib/logger';
import { getSessionSafely } from '@nia/prism/core/auth';

const log = getLogger('[html-generation][rollback-applet-route]');
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
        tag: '[html-generation.rollback-applet-route]',
      });
    }
    const body = await request.json();
    
    const appletId = body.appletId;
    const steps = body.steps || 1;

    // Validate required parameters
    if (!appletId) {
      log.warn(`${LOG_PREFIX}Rollback: missing appletId`);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Applet ID is required',
          data: null,
          message: 'Applet ID is required'
        },
        { status: 400 }
      );
    }

    log.info(`${LOG_PREFIX}Rollback requested`, { appletId, steps });

    const result = await rollbackEnhancedApplet(appletId, steps);

    return NextResponse.json(result);

  } catch (error) {
    log.error(`${LOG_PREFIX}Rollback failed`, { err: error });
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { 
        success: false, 
        error: errorMessage,
        data: null,
        message: errorMessage
      },
      { status: 500 }
    );
  }
}

// Export standard POST handler
export const POST = POST_impl;
