/**
 * Semantic Applet Search API Route
 * 
 * Provides natural language search capabilities for HTML applets
 * Supports fuzzy matching, content type filtering, and temporal search
 */

import { NextRequest, NextResponse } from 'next/server';
import { searchEnhancedApplets } from '../../actions/enhanced-applet-actions';
import { SearchAppletsRequest } from '../../types/html-generation-types';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger, setLogContext } from '@interface/lib/logger';
import { getSessionSafely } from '@nia/prism/core/auth';

const log = getLogger('[html-generation][search-applets-route]');
const LOG_PREFIX = '[sprite-test] ';

export async function GET(request: NextRequest): Promise<NextResponse> {
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
        tag: '[html-generation.search-applets-route]',
      });
    }
    const { searchParams } = new URL(request.url);
    
    const searchRequest: SearchAppletsRequest = {
      query: searchParams.get('query') || '',
      userId: searchParams.get('userId') || '',
      assistantName: searchParams.get('assistantName') || undefined,
      contentType: searchParams.get('contentType') as any || undefined,
      limit: parseInt(searchParams.get('limit') || '10'),
      includeArchived: searchParams.get('includeArchived') === 'true'
    };

    log.info(`${LOG_PREFIX}GET search-applets called`, {
      query: searchRequest.query,
      userId: searchRequest.userId,
      assistantName: searchRequest.assistantName
    });

    // Validate required parameters
    if (!searchRequest.query.trim()) {
      log.warn(`${LOG_PREFIX}GET search-applets: empty query`);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Search query is required',
          results: [],
          totalCount: 0,
          searchMetadata: {
            queryProcessed: '',
            searchMethod: 'semantic' as const,
            filters: {}
          }
        },
        { status: 400 }
      );
    }

    const response = await searchEnhancedApplets(searchRequest);
    log.info(`${LOG_PREFIX}GET search-applets completed`, { 
      success: response.success, 
      totalCount: response.totalCount 
    });
    
    return NextResponse.json(response);

  } catch (error) {
    log.error(`${LOG_PREFIX}Search applets API error`, { err: error });
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return NextResponse.json(
      { 
        success: false, 
        error: errorMessage,
        results: [],
        totalCount: 0,
        searchMetadata: {
          queryProcessed: '',
          searchMethod: 'semantic' as const,
          filters: {}
        }
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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
        tag: '[html-generation.search-applets-route]',
      });
    }
    const body = await request.json();
    
    const searchRequest: SearchAppletsRequest = {
      query: body.query || '',
      userId: body.userId || '',
      assistantName: body.assistantName,
      contentType: body.contentType,
      limit: body.limit || 10,
      includeArchived: body.includeArchived || false
    };

    log.info(`${LOG_PREFIX}POST search-applets called`, {
      query: searchRequest.query,
      userId: searchRequest.userId,
      assistantName: searchRequest.assistantName
    });

    // Validate required parameters
    if (!searchRequest.query.trim()) {
      log.warn(`${LOG_PREFIX}POST search-applets: empty query`);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Search query is required',
          results: [],
          totalCount: 0,
          searchMetadata: {
            queryProcessed: '',
            searchMethod: 'semantic' as const,
            filters: {}
          }
        },
        { status: 400 }
      );
    }

    const response = await searchEnhancedApplets(searchRequest);
    log.info(`${LOG_PREFIX}POST search-applets completed`, { 
      success: response.success, 
      totalCount: response.totalCount 
    });
    
    return NextResponse.json(response);

  } catch (error) {
    log.error(`${LOG_PREFIX}Search applets API error`, { err: error });
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return NextResponse.json(
      { 
        success: false, 
        error: errorMessage,
        results: [],
        totalCount: 0,
        searchMetadata: {
          queryProcessed: '',
          searchMethod: 'semantic' as const,
          filters: {}
        }
      },
      { status: 500 }
    );
  }
}
