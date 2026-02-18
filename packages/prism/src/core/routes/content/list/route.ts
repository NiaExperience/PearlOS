import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth';
import { AssistantActions, ContentActions, TenantActions } from '@nia/prism/core/actions';
import { UserTenantRoleBlock } from '@nia/prism/core/blocks';
import { NextAuthOptions } from 'next-auth';
import { getLogger } from '../../../logger';

const log = getLogger('prism:routes:content');

/**
 * API route to handle content list retrieval
 * GET /api/contentList
 * 
 * @param req - The Next.js request object
 * @param authOptions - The app-specific NextAuth options
 * @returns A Next.js response with the content list
 */
export async function GET_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  try {
    const searchParams = req.nextUrl.searchParams;
    
    // Log API call with params for debugging
    if (process.env.DEBUG_PRISM === 'true') {
      log.info('Content List API Called', { params: searchParams.toString() });
    }

    // Extract common query parameters
    let tenantId = searchParams.get('tenantId');
    const type = searchParams.get('type');
    const assistantName = searchParams.get('agent') || searchParams.get('subDomain');

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
        }
      }
    }

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

    if (!type) {
      return NextResponse.json({ error: 'Dynamic content type is required' }, { status: 400 });
    }

    // Authenticate user
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if the tenant exists
    const tenant = await TenantActions.getTenantById(tenantId);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Step 1: Find the dynamic content definition for this tenant and type
    const definitionResult = await ContentActions.findDefinition(type, tenantId);
    if (!definitionResult || !definitionResult.items || definitionResult.items.length === 0) {
      return NextResponse.json({ error: 'Content definition not found' }, { status: 404 });
    }
    
    const definition = definitionResult.items[0];
    
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

    // Step 2: Use definition.dataModel.block to query the actual structured data entries    
    const query = {
      tenantId,
      contentType: definition.dataModel.block,
      where: queryParam || {},
    };

    if (process.env.DEBUG_PRISM === 'true') {
      log.info('Executing content query', { query });
    }
    const result = await ContentActions.findContent(query);
    
    if (!result || !result.total) {
      return NextResponse.json({ error: 'No content found' }, { status: 404 });
    }

    return NextResponse.json({ definition, items: result.items });
  } catch (error: any) {
    log.error('Error in content list API', { error });
    return NextResponse.json(
      { error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
