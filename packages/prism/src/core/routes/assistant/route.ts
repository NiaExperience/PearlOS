
import { createAssistant, getAssistantBySubDomain, getAssistantByName, getTemplateAssistants } from '@nia/prism/core/actions/assistant-actions';
import { getTenantsForUser, userHasAccess, getTenantById } from '@nia/prism/core/actions/tenant-actions';
import { getUserById } from '@nia/prism/core/actions/user-actions';
import { getSessionSafely } from '@nia/prism/core/auth/getSessionSafely';
import { IAssistant } from '@nia/prism/core/blocks/assistant.block';
import { NextRequest, NextResponse } from 'next/server';
import { NextAuthOptions } from 'next-auth';
import { getLogger } from '../../logger';

const log = getLogger('prism:routes:assistant');

export async function GET_Templates_impl(req: NextRequest, authOptions: NextAuthOptions) : Promise<NextResponse> {
  try {
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const tenants = await getTenantsForUser(session.user.id);
    if (!tenants || tenants.length === 0) {
      log.warn('No tenants found for user', { userId: session.user.id });
      return NextResponse.json({ error: 'No tenants found' }, { status: 404 });
    }
    let templates : IAssistant[] = [];
    for (const tenant of tenants) {
      if (!await userHasAccess(session.user.id, tenant._id!)) {
        log.warn('User unauthorized for tenant', { userId: session.user.id, tenantId: tenant._id, tenantName: tenant.name });
        continue;
      }
      log.info('User authorized for tenant', { userId: session.user.id, tenantId: tenant._id, tenantName: tenant.name });
      // Use provider-agnostic Prism API for template assistants
      const result = await getTemplateAssistants(tenant._id!, session.user.id);
      if (result) {
        log.info('Template assistants found', { tenantId: tenant._id, count: result.length });
        templates = templates.concat(result);
      }
    }

    return NextResponse.json({ templates });
  } catch (error) {
    log.error('Failed to fetch templates', { error });
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  }
}

export async function POST_impl(req: NextRequest, authOptions: NextAuthOptions) : Promise<NextResponse> {
  try {
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = await getUserById(session.user.id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const body = await req.json();

    // Check if the tenantId was passed in the request or in the body
    let tenantId: string | null = null;
    const { searchParams } = new URL(req.url);
    tenantId = searchParams.get('tenantId') || body.tenantId || null;
    if (tenantId) {
      const tenant = await getTenantById(tenantId);
      if (!tenant) {
        log.warn('Tenant not found while creating assistant template', { tenantId });
        tenantId = null; // Force creation of new tenant
      }
    }
    // Tenant should already be present before we try to create a new assistant.
    if (!tenantId) {
      throw new Error('tenantId is required to create an assistant');
    }

    // Use provider-agnostic Prism API for assistant creation
    const assistantData = {
      name: body.name,
      tenantId: tenantId,
      persona_name: body.persona_name || undefined,
      special_instructions: body.special_instructions || undefined,
      is_template: true, // Always create as a template
    };
    const assistant = await createAssistant(assistantData);
    if (assistant) {
      log.info('Assistant template created', { assistantId: assistant._id, tenantId });
      return NextResponse.json({ assistant });
    } else {
      return NextResponse.json({ error: 'Assistant creation returned no data.' }, { status: 500 });
    }
  } catch (error) {
    log.error('Failed to create assistant template', { error });
    return NextResponse.json({ error: 'Failed to create assistant' }, { status: 500 });
  }
}

export async function GET_impl(req: NextRequest, authOptions: NextAuthOptions) : Promise<NextResponse> {
    try {
        // Check session FIRST
        const session = await getSessionSafely(req, authOptions);
        if (!session || !session.user) {
          log.warn('Assistant GET unauthorized (no session)');
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (session.user.is_anonymous) {
          log.info('Assistant GET anonymous session', { userId: session.user.id });
        }

        let subDomain = null;
        // when no subdomain is given (i.e. '/api/assistant', we should make 
        // sure we have undefined for subDomain via pathname split so it will
        // failover to searchParams)
        const pathSegments = req.nextUrl.pathname.split('/').filter(Boolean);
        const lastSegment = pathSegments[pathSegments.length - 1];
        const pathSubdomain = lastSegment && lastSegment !== 'assistant' ? lastSegment : undefined;
        subDomain = pathSubdomain ?? req.nextUrl.searchParams.get('agent') ?? req.nextUrl.searchParams.get('subDomain') ?? undefined;
        if (process.env.DEBUG_PRISM === 'true') {
          log.info('Assistant lookup by subdomain', { subDomain });
        }
        if (!subDomain || subDomain.length === 0) {
          log.warn('Assistant GET missing subdomain');
            return NextResponse.json({ error: 'Assistant agent is required' }, { status: 400 });
        }

        const normalizedName = subDomain ? subDomain.charAt(0).toUpperCase() + subDomain.slice(1).toLowerCase() : subDomain;
        const assistant = await getAssistantBySubDomain(subDomain) || await getAssistantByName(normalizedName);
        if (!assistant) {
          log.warn('Assistant not found', { subDomain, normalizedName });
            return NextResponse.json({ error: 'Assistant not found' }, { status: 404 });
        }
        return NextResponse.json(assistant);
    } catch (error) {
        log.error('Assistant GET failed', { error });
        return NextResponse.json({ error: 'Failed to fetch assistant data' }, { status: 500 });
    }
}

