import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth';
import { AssistantActions, TenantActions, ContentActions } from '@nia/prism/core/actions';
import { NextAuthOptions } from 'next-auth';
import { isValidUUID } from '@nia/prism/core/utils';
import { DynamicContentBlock, UserTenantRoleBlock } from '@nia/prism/core/blocks';
import { getLogger } from '../../../logger';

const log = getLogger('prism:routes:content');

/**
 * API route to handle content detail retrieval
 * GET /api/contentDetail
 * 
 * @param req - The Next.js request object
 * @param authOptions - The app-specific NextAuth options
 * @returns A Next.js response with the content detail
 */
export async function GET_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  try {
    const searchParams = req.nextUrl.searchParams;
    
    log.info('Content Detail GET', { params: searchParams.toString() });

    // Extract common query parameters
    const type = searchParams.get('type');
    const contentId = searchParams.get('contentId');
    let tenantId = searchParams.get('tenantId');
    const assistantName = searchParams.get('agent') || searchParams.get('subDomain');

    // Validate required parameters
    if (!tenantId) {
      if (!assistantName) {
        return NextResponse.json({ error: 'Tenant ID or assistant name is required' }, { status: 400 });
      }
      // Resolve tenant ID from assistant name if not provided directly
      const assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
      if (!assistant || !assistant.tenantId) {
        return NextResponse.json({ error: 'Assistant not found or does not have a tenant ID' }, { status: 404 });
      }
      if (process.env.DEBUG_PRISM === 'true') {
        log.info('Assistant resolved to tenant', { assistantId: assistant._id, tenantId: assistant.tenantId });
      }
      tenantId = assistant.tenantId;
    }
    if (!isValidUUID(tenantId)) {
      return NextResponse.json({ error: 'Invalid tenant ID' }, { status: 400 });
    }

    if (!type) {
      return NextResponse.json({ error: 'Dynamic content type is required' }, { status: 400 });
    }

    // Authenticate user
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if tenant exists and user has access
    const tenant = await TenantActions.getTenantById(tenantId);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Find content definition
    const definitionResult = await ContentActions.findDefinition(type, tenantId);
    if (!definitionResult || !definitionResult.items || definitionResult.items.length === 0) {
      log.warn('No content definition found', { type, tenantId });
      return NextResponse.json({ error: 'Content definition not found' }, { status: 404 });
    }
    const definition = definitionResult.items[0];
    log.info('Content definition found', { definitionId: definition._id, type, tenantId });

    // Access control
    const access = definition.access || {};
    if (!('allowAnonymous' in access) && !('tenantRole' in access)) {
      log.info('Access default allow (no access properties)');
    } else if (access.allowAnonymous) {
      // Allow
    } else if (access.tenantRole) {
      const rawRequired = String(access.tenantRole).toUpperCase();
      const RoleEnum = UserTenantRoleBlock.TenantRole;
      const requiredEnum = (RoleEnum[rawRequired as keyof typeof RoleEnum]) || RoleEnum.MEMBER;
      const hasAccess = await TenantActions.userHasAccess(session.user.id, tenantId!, requiredEnum);
      if (!hasAccess) {
        log.warn('Forbidden: insufficient tenant role', { requiredRole: access.tenantRole, userId: session.user.id, tenantId });
        return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });
      }
    } else {
      log.warn('Access denied (no access properties)');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse query parameter if provided
    let queryParam = undefined;
    const encodedQuery = searchParams.get('query') || undefined;
    if (encodedQuery) {
      try {
        queryParam = JSON.parse(decodeURIComponent(encodedQuery));
      } catch (error) {
        // If decodeURIComponent fails, try parsing directly (already decoded)
        try {
          queryParam = JSON.parse(encodedQuery);
        } catch (err) {
          log.error('Error decoding query parameter', { error: err });
          return NextResponse.json({ error: 'Invalid query parameter' }, { status: 400 });
        }
      }
    }

    log.info('Content detail request', { tenantId, contentId, type });
    
    // Prepare the where clause for GraphQL query
    let where: any = queryParam || {};

    // If contentId is provided, ensure the where clause targets the specific page_id
    if (contentId) {
      if (!isValidUUID(contentId)) {
        return NextResponse.json({ error: 'Invalid content ID' }, { status: 400 });
      }
      where = {
        ...where,
        page_id: { eq: contentId }
      };
    }
    
    const query = {
      tenantId,
      contentType: definition.dataModel.block,
      where: where,
    };

    const result = await ContentActions.findContent(query);
    if (!result || result.total === 0) {
      return NextResponse.json({ error: 'No content found' }, { status: 404 });
    }
    
    return NextResponse.json({ definition, item: result.items[0] });
  } catch (error: any) {
    log.error('Error in content detail API', { error });
    return NextResponse.json(
      { error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

export async function POST_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  try {
    log.info('Content Detail POST');
    // Check session
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Parse JSON body
    const { blockType, content, tenantId } = await req.json();
    if (!blockType || !content || !tenantId) {
      return NextResponse.json({ error: 'Missing required fields in request body' }, { status: 400 });
    }

    // Check if the tenant exists and user has admin access
    const tenant = await TenantActions.getTenantById(tenantId);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    if (!await TenantActions.userHasAccess(session.user.id, tenantId, UserTenantRoleBlock.TenantRole.ADMIN)) {
      return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });
    }

    // Find content definition
    const definitionResult = await ContentActions.findDefinition(blockType, tenantId);
    if (!definitionResult || !definitionResult.items || definitionResult.items.length === 0) {
      log.warn('No content definition found', { type: blockType, tenantId });
      return NextResponse.json({ error: 'Content definition not found' }, { status: 404 });
    }
    const definition = definitionResult.items[0];
    log.info('Content definition found', { definitionId: definition._id, type: blockType, tenantId });

    // Access control
    const access = definition.access || {};
    if (!('allowAnonymous' in access) && !('tenantRole' in access)) {
      log.info('Access default allow (no access properties)');
    } else if (access.allowAnonymous) {
      // Allow
    } else if (access.tenantRole) {
      const rawRequired = String(access.tenantRole).toUpperCase();
      const RoleEnum = UserTenantRoleBlock.TenantRole;
      const requiredEnum = (RoleEnum[rawRequired as keyof typeof RoleEnum]) || RoleEnum.MEMBER;
      const hasAccess = await TenantActions.userHasAccess(session.user.id, tenantId, requiredEnum);
      if (!hasAccess) {
        log.warn('Forbidden: insufficient tenant role', { requiredRole: access.tenantRole, userId: session.user.id, tenantId });
        return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });
      }
    } else {
      log.warn('Access denied (no access properties)');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    log.info('Content detail create', { tenantId, type: blockType });

    const result = await ContentActions.createContent(blockType, content, tenantId);
    if (!result) {
      return NextResponse.json({ error: 'Content not created' }, { status: 500 });
    }
    
    return NextResponse.json(result);
  } catch (error: any) {
    log.error('Error in content detail API', { error });
    return NextResponse.json(
      { error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

export async function PUT_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  try {
    const searchParams = req.nextUrl.searchParams;
    
    log.info('Content Detail PUT', { params: searchParams.toString() });

    // Extract common query parameters
    const type = searchParams.get('type');
    const contentId = searchParams.get('contentId');
    let tenantId = searchParams.get('tenantId');
    const assistantName = searchParams.get('agent') || searchParams.get('subDomain');

    // Validate required parameters
    if (!contentId) {
      return NextResponse.json({ error: 'Content ID is required for updates' }, { status: 400 });
    }
    if (!isValidUUID(contentId)) {
      return NextResponse.json({ error: 'Invalid content ID' }, { status: 400 });
    }

    if (!tenantId) {
      if (!assistantName) {
        return NextResponse.json({ error: 'Tenant ID or assistant name is required' }, { status: 400 });
      }
      // Resolve tenant ID from assistant name if not provided directly
      const assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
      if (!assistant || !assistant.tenantId) {
        return NextResponse.json({ error: 'Assistant not found or does not have a tenant ID' }, { status: 404 });
      }
      if (process.env.DEBUG_PRISM === 'true') {
        log.info('Assistant resolved to tenant', { assistantId: assistant._id, tenantId: assistant.tenantId });
      }
      tenantId = assistant.tenantId;
    }
    if (!isValidUUID(tenantId)) {
      return NextResponse.json({ error: 'Invalid tenant ID' }, { status: 400 });
    }

    if (!type) {
      return NextResponse.json({ error: 'Dynamic content type is required' }, { status: 400 });
    }

    // Authenticate user
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if tenant exists and user has access
    const tenant = await TenantActions.getTenantById(tenantId);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Check if user has admin access for modifications
    if (!await TenantActions.userHasAccess(session.user.id, tenantId, UserTenantRoleBlock.TenantRole.ADMIN)) {
      return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });
    }

    // Find content definition
    const definitionResult = await ContentActions.findDefinition(type, tenantId);
    if (!definitionResult || !definitionResult.items || definitionResult.items.length === 0) {
      log.warn('No content definition found', { type, tenantId });
      return NextResponse.json({ error: 'Content definition not found' }, { status: 404 });
    }
    const definition = definitionResult.items[0];
    log.info('Content definition found', { definitionId: definition._id, type, tenantId });

    // Parse JSON body
    const { content: updateContent } = await req.json();
    if (!updateContent) {
      return NextResponse.json({ error: 'Content data is required in request body' }, { status: 400 });
    }

    log.info('Content detail update', { tenantId, contentId, type });
    const result = await ContentActions.updateContent(definition.dataModel.block, contentId, updateContent, tenantId);
    if (!result || result.total === 0) {
      return NextResponse.json({ error: 'Content not found or update failed' }, { status: 404 });
    }
    
    return NextResponse.json({ definition, item: result.items[0] });
  } catch (error: any) {
    log.error('Error in content detail PUT API', { error });
    return NextResponse.json(
      { error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

export async function DELETE_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  try {
    const searchParams = req.nextUrl.searchParams;
    
    log.info('Content Detail DELETE', { params: searchParams.toString() });

    // Extract common query parameters
    const type = searchParams.get('type');
    const contentId = searchParams.get('contentId');
    let tenantId = searchParams.get('tenantId');
    const assistantName = searchParams.get('agent') || searchParams.get('subDomain');

    // Validate required parameters
    if (!contentId) {
      return NextResponse.json({ error: 'Content ID is required for deletion' }, { status: 400 });
    }
    if (!isValidUUID(contentId)) {
      return NextResponse.json({ error: 'Invalid content ID' }, { status: 400 });
    }

    if (!tenantId) {
      if (!assistantName) {
        return NextResponse.json({ error: 'Tenant ID or assistant name is required' }, { status: 400 });
      }
      // Resolve tenant ID from assistant name if not provided directly
      const assistant = await AssistantActions.getAssistantBySubDomain(assistantName);
      if (!assistant || !assistant.tenantId) {
        return NextResponse.json({ error: 'Assistant not found or does not have a tenant ID' }, { status: 404 });
      }
      if (process.env.DEBUG_PRISM === 'true') {
        log.info('Assistant resolved to tenant', { assistantId: assistant._id, tenantId: assistant.tenantId });
      }
      tenantId = assistant.tenantId;
    }
    if (!isValidUUID(tenantId)) {
      return NextResponse.json({ error: 'Invalid tenant ID' }, { status: 400 });
    }

    if (!type) {
      return NextResponse.json({ error: 'Dynamic content type is required' }, { status: 400 });
    }

    // Authenticate user
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if tenant exists and user has access
    const tenant = await TenantActions.getTenantById(tenantId);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Check if user has admin access for deletions
    if (!await TenantActions.userHasAccess(session.user.id, tenantId, UserTenantRoleBlock.TenantRole.ADMIN)) {
      return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });
    }

    // Find content definition
    const definitionResult = await ContentActions.findDefinition(type, tenantId);
    if (!definitionResult || !definitionResult.items || definitionResult.items.length === 0) {
      log.warn('No content definition found', { type, tenantId });
      return NextResponse.json({ error: 'Content definition not found' }, { status: 404 });
    }
    const definition = definitionResult.items[0];
    log.info('Content definition found', { definitionId: definition._id, type, tenantId });

    log.info('Content detail delete', { tenantId, contentId, type });

    const result = await ContentActions.deleteContent(definition.dataModel.block, contentId, tenantId);
    if (!result) {
      return NextResponse.json({ error: 'Content not found or deletion failed' }, { status: 404 });
    }
    
    return NextResponse.json({ success: true, message: 'Content deleted successfully' });
  } catch (error: any) {
    log.error('Error in content detail DELETE API', { error });
    return NextResponse.json(
      { error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

