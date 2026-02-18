import { NextRequest, NextResponse } from 'next/server';
import { Prism } from '@nia/prism';
import { NextAuthOptions } from 'next-auth';
import { getSessionSafely } from '@nia/prism/core/auth';
import { AssistantActions, TenantActions, ContentActions } from '@nia/prism/core/actions';
import { DynamicContentBlock, UserTenantRoleBlock } from '@nia/prism/core/blocks';
import { getLogger } from '../../../logger';

const log = getLogger('prism:routes:content');

/**
 * API route to handle dynamic content definitions retrieval
 * GET /api/dynamicContent or /api/dynamicContent
 * 
 * @param req - The Next.js request object
 * @param authOptions - The app-specific NextAuth options
 * @returns A Next.js response with the content definitions
 */
export async function GET_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  try {
    // Authenticate user
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    let tenantId = searchParams.get('tenantId');
    const assistantId = searchParams.get('assistantId');
    const agent = searchParams.get('agent') || searchParams.get('subDomain');

    // Handle assistant-based tenant resolution
    if (!tenantId && (assistantId || agent)) {
      // Fetch the assistant object to get the tenantId
      let assistant = null;
      if (assistantId) {
        assistant = await AssistantActions.getAssistantById(assistantId);
      } else if (agent) {
        assistant = await AssistantActions.getAssistantBySubDomain(agent);
      }

      if (!assistant) {
        return NextResponse.json({ error: 'Assistant not found' }, { status: 404 });
      }

      if (assistant && assistant.tenantId) {
        tenantId = assistant.tenantId;
      } else {
        return NextResponse.json({ error: 'Assistant has no tenant ID' }, { status: 400 });
      }
    }
    
    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
    }

    // Use the provider-agnostic Prism API to list dynamic content definitions
    const prism = await Prism.getInstance();
    const result = await prism.listDefinitions(tenantId);
    
    return NextResponse.json({ items: result.items || [] }, { status: 200 });
  } catch (error: any) {
    log.error('Error fetching dynamic content definitions', { error });
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * API route to create a new dynamic content definition
 * POST /api/contentDetail
 */
export async function POST_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  try {
    // Check session
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Parse JSON body
    const body = await req.json();
    if (!body) {
      return NextResponse.json({ error: 'Missing content definition block in request body' }, { status: 400 });
    }
    // Validate and create the new dynamic content definition page
    // Use DynamicContentBlock.ActivitySchema or similar schema for validation
    const validatedDefinition = DynamicContentBlock.DynamicContentSchema.parse(body);
    // Validate tenantId
    if (!validatedDefinition.tenantId) {
      return NextResponse.json({ error: 'Missing tenantId in definition' }, { status: 400 });
    }
    // Check if the tenant exists and user has admin access
    const tenant = await TenantActions.getTenantById(validatedDefinition.tenantId);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    if (!await TenantActions.userHasAccess(session.user.id, validatedDefinition.tenantId, UserTenantRoleBlock.TenantRole.ADMIN)) {
      return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });
    }
    // Create the definition page using Prism actions
    const createdDefinition = await ContentActions.createDefinition(validatedDefinition, validatedDefinition.tenantId);
    return NextResponse.json({ success: true, definition: createdDefinition });
  } catch (error) {
    const errorMessage =
      typeof error === 'object' && error !== null && 'message' in error
        ? (error as any).message
        : String(error);
    log.error('Error creating dynamic content definition', { error: errorMessage });
    return NextResponse.json(
      { error: 'Internal Server Error while creating dynamic content definition', details: errorMessage },
      { status: 500 }
    );
  }
}
