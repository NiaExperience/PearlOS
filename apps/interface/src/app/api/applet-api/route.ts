export const dynamic = "force-dynamic";

import { AssistantActions, TenantActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { isValidUUID } from '@nia/prism/core/utils';
import { NextRequest, NextResponse } from 'next/server';

import { 
  createAppletStorage, 
  findAppletStorage, 
  updateAppletStorage, 
  deleteAppletStorage 
} from '@interface/features/HtmlGeneration';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_applet_api]');

/**
 * API endpoint specifically designed for JavaScript applets running in sandboxed environments.
 * Provides secure, authenticated access to AppletStorage for data persistence.
 * 
 * This endpoint is hardcoded to use AppletStorage content type and ensures:
 * 1. Proper authentication and authorization (tenant member access)
 * 2. Tenant and user scoping
 * 3. Simplified API surface (no contentType parameter needed)
 */

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handleAppletApiRequest(req, 'GET');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleAppletApiRequest(req, 'POST');
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  return handleAppletApiRequest(req, 'PUT');
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  return handleAppletApiRequest(req, 'DELETE');
}

async function handleAppletApiRequest(req: NextRequest, method: string): Promise<NextResponse> {
  try {
    log.info('Handling applet API request', { method, url: req.url });
    // Authenticate user
    const session = await getSessionSafely(req, interfaceAuthOptions);
    if (!session || !session.user) {
      log.warn('Unauthorized applet API access attempt', { method, url: req.url });
      return NextResponse.json({ 
        error: 'Unauthorized', 
        message: 'Valid session required for applet API access' 
      }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const operation = searchParams.get('operation'); // 'list', 'get', 'create', 'update', 'delete'
    const dataId = searchParams.get('dataId'); // Changed from contentId to dataId
    let tenantId = searchParams.get('tenantId');
    const assistantName = searchParams.get('agent') || searchParams.get('assistantName');

    // Validate required parameters
    if (!operation) {
      log.warn('Missing operation parameter');
      return NextResponse.json({ error: 'Missing operation parameter' }, { status: 400 });
    }

    // Resolve tenant ID from assistant name if not provided directly
    if (!tenantId && assistantName) {
      const assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
      if (assistant && assistant.tenantId) {
        tenantId = assistant.tenantId;
      }
    }

    if (!tenantId) {
      log.warn('Missing tenant identification', { method, operation });
      return NextResponse.json({
        error: 'Missing tenant identification',
        message: 'Either tenantId or assistantName must be provided'
      }, { status: 400 });
    }

    if (!isValidUUID(tenantId)) {
      log.warn('Invalid tenant ID format', { tenantId });
      return NextResponse.json({ error: 'Invalid tenant ID format' }, { status: 400 });
    }

    // Verify tenant exists
    const tenant = await TenantActions.getTenantById(tenantId);
    if (!tenant) {
      log.warn('Tenant not found', { tenantId });
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Check if user has tenant member access
    const userHasRole = await TenantActions.userHasAccess(session.user.id, tenantId);
    if (!userHasRole) {
      log.warn('User missing required tenant role', { userId: session.user.id, tenantId });
      return NextResponse.json({
        error: 'Forbidden',
        message: 'Tenant member access required'
      }, { status: 403 });
    }

    // Handle different operations
    switch (operation) {
      case 'list':
        return await handleListOperation(tenantId, req);
      
      case 'get':
        if (!dataId) {
          log.warn('Data ID required for get operation');
          return NextResponse.json({ error: 'Data ID required for get operation' }, { status: 400 });
        }
        return await handleGetOperation(tenantId, dataId);
      
      case 'create':
        if (method !== 'POST') {
          log.warn('POST method required for create operation');
          return NextResponse.json({ error: 'POST method required for create operation' }, { status: 405 });
        }
        return await handleCreateOperation(tenantId, req, session.user.id);
      
      case 'update':
        if (method !== 'PUT') {
          log.warn('PUT method required for update operation');
          return NextResponse.json({ error: 'PUT method required for update operation' }, { status: 405 });
        }
        if (!dataId) {
          log.warn('Data ID required for update operation');
          return NextResponse.json({ error: 'Data ID required for update operation' }, { status: 400 });
        }
        return await handleUpdateOperation(tenantId, dataId, req, session.user.id);
      
      case 'delete':
        if (method !== 'DELETE') {
          log.warn('DELETE method required for delete operation');
          return NextResponse.json({ error: 'DELETE method required for delete operation' }, { status: 405 });
        }
        if (!dataId) {
          log.warn('Data ID required for delete operation');
          return NextResponse.json({ error: 'Data ID required for delete operation' }, { status: 400 });
        }
        return await handleDeleteOperation(tenantId, dataId, session.user.id);
      
      default:
        log.warn('Invalid operation', { operation });
        return NextResponse.json({
          error: 'Invalid operation',
          message: 'Supported operations: list, get, create, update, delete'
        }, { status: 400 });
    }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    log.error('Applet API error', { error });
    return NextResponse.json({
      error: 'Internal server error',
      message: error.message || 'An unexpected error occurred'
    }, { status: 500 });
  }
}

async function handleListOperation(tenantId: string, req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const encodedQuery = searchParams.get('query');
  const appletId = searchParams.get('appletId');
  
  // Phase 1: Soft warning for missing appletId (non-breaking)
  if (!appletId) {
    log.warn('LIST operation missing appletId - may return unscoped data', {
      tenantId,
      timestamp: new Date().toISOString()
    });
  } else if (!isValidUUID(appletId)) {
    log.warn('LIST operation has invalid appletId format', { appletId });
  } else {
    log.info('LIST operation with appletId', { appletId });
  }
  
  let queryParam = {};
  if (encodedQuery) {
    try {
      queryParam = JSON.parse(decodeURIComponent(encodedQuery));
    } catch (error) {
      log.warn('Failed to parse query parameter', { error });
    }
  }

  // Support legacy `key` filter (e.g., high score lookups) by applying it client-side after the
  // scoped fetch, since the GraphQL NotionModelFilter schema does not include `key`.
  const filterKey = (queryParam as any)?.key;
  if (filterKey) {
    // Remove the unsupported key field before hitting GraphQL
    const { key, ...rest } = queryParam as Record<string, unknown>;
    queryParam = rest;
  }
  
  // Add appletId to query if present - use Prism's indexer query syntax
  if (appletId && isValidUUID(appletId)) {
    queryParam = { ...queryParam, indexer: { path: 'appletId', equals: appletId } };
  }

  const result = await findAppletStorage(queryParam, tenantId);
  const items = (result?.items || []).filter(item => {
    if (!filterKey) return true;
    return (item as any)?.data?.key === filterKey;
  });
  
  return NextResponse.json({
    success: true,
    items,
    total: items.length
  });
}

async function handleGetOperation(tenantId: string, dataId: string) {
  if (!isValidUUID(dataId)) {
    return NextResponse.json({ error: 'Invalid data ID format' }, { status: 400 });
  }

  const query = { page_id: { eq: dataId } };
  const result = await findAppletStorage(query, tenantId);
  
  if (!result || result.total === 0) {
    return NextResponse.json({ error: 'Data not found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    item: result.items[0]
  });
}

async function handleCreateOperation(tenantId: string, req: NextRequest, userId: string) {
  try {
    const body = await req.json();
    const { data, appletId } = body;

    if (!data) {
      return NextResponse.json({ error: 'Data required' }, { status: 400 });
    }

    // Phase 1: Soft warning for missing appletId (non-breaking)
    if (!appletId) {
      log.warn('CREATE operation missing appletId - storage will not be properly scoped', {
        userId,
        tenantId,
        timestamp: new Date().toISOString()
      });
    } else if (!isValidUUID(appletId)) {
      log.warn('CREATE operation has invalid appletId format', { appletId });
    } else {
      log.info('CREATE operation with appletId', { appletId });
    }

    const result = await createAppletStorage(data, userId, tenantId, appletId);
    
    if (!result) {
      return NextResponse.json({ error: 'Failed to create data' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      item: result
    });

  } catch (error) {
    log.error('Create operation error', { error });
    return NextResponse.json({ error: 'Failed to create data' }, { status: 500 });
  }
}

async function handleUpdateOperation(tenantId: string, dataId: string, req: NextRequest, userId: string) {
  try {
    log.info('UPDATE start', { dataId, tenantId, userId });
    
    if (!isValidUUID(dataId)) {
      return NextResponse.json({ error: 'Invalid data ID format' }, { status: 400 });
    }

    // First verify the data exists and user owns it
    const existingQuery = { page_id: { eq: dataId } };
    log.info('UPDATE querying for existing data', { query: existingQuery });
    const existingResult = await findAppletStorage(existingQuery, tenantId);
    log.info('UPDATE query result', { total: existingResult?.total, items: existingResult?.items?.length });
    
    if (!existingResult || existingResult.total === 0) {
      log.info('UPDATE data not found');
      return NextResponse.json({ error: 'Data not found' }, { status: 404 });
    }

    const existingData = existingResult.items[0];
    log.info('UPDATE ownership check', { ownerId: existingData.userId, requesterId: userId });
    if (existingData.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden: Can only update your own data' }, { status: 403 });
    }

    const body = await req.json();
    const { data, appletId } = body;
    log.info('UPDATE payload received', { hasData: Boolean(data), payloadKeys: data ? Object.keys(data) : [] });

    // Phase 1: Soft warning for missing appletId (non-breaking)
    if (!appletId) {
      log.warn('UPDATE operation missing appletId - storage may not be properly scoped', {
        dataId,
        userId,
        tenantId,
        timestamp: new Date().toISOString()
      });
    } else if (!isValidUUID(appletId)) {
      log.warn('UPDATE operation has invalid appletId format', { appletId });
    }

    if (!data) {
      return NextResponse.json({ error: 'Data required' }, { status: 400 });
    }

    log.info('UPDATE calling updateAppletStorage');
    const result = await updateAppletStorage(dataId, data, tenantId, userId);
    log.info('UPDATE updateAppletStorage result', { success: Boolean(result) });
    
    if (!result) {
      return NextResponse.json({ error: 'Failed to update data' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      item: result
    });

  } catch (error) {
    log.error('Update operation error', { error });
    return NextResponse.json({ error: 'Failed to update data' }, { status: 500 });
  }
}

async function handleDeleteOperation(tenantId: string, dataId: string, userId: string) {
  try {
    if (!isValidUUID(dataId)) {
      return NextResponse.json({ error: 'Invalid data ID format' }, { status: 400 });
    }

    // First verify the data exists and user owns it
    const existingQuery = { page_id: { eq: dataId } };
    const existingResult = await findAppletStorage(existingQuery, tenantId);
    
    if (!existingResult || existingResult.total === 0) {
      return NextResponse.json({ error: 'Data not found' }, { status: 404 });
    }

    const existingData = existingResult.items[0];
    if (existingData.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden: Can only delete your own data' }, { status: 403 });
    }

    const result = await deleteAppletStorage(dataId, tenantId);
    
    if (!result) {
      return NextResponse.json({ error: 'Failed to delete data' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Data deleted successfully'
    });

  } catch (error) {
    log.error('Delete operation error', { error });
    return NextResponse.json({ error: 'Failed to delete data' }, { status: 500 });
  }
}

