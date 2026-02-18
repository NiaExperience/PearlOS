/* eslint-disable @typescript-eslint/no-explicit-any */
import { TenantActions } from "@nia/prism/core/actions";
import { getAllTenants } from "@nia/prism/core/actions/tenant-actions";
import { updateTenant, deleteTenant } from '@nia/prism/core/actions/tenant-actions';
import { requireAuth, getSessionSafely } from "@nia/prism/core/auth";
import { SUPERADMIN_USER_ID } from '@nia/prism/core/auth/auth.middleware';
import { requireTenantAdmin } from '@nia/prism/core/auth/auth.middleware';
import { TenantBlock, UserTenantRoleBlock } from "@nia/prism/core/blocks";
import { BlockType_Assistant } from "@nia/prism/core/blocks/assistant.block";
import { Prism } from "@nia/prism/prism";
import { NextRequest, NextResponse } from "next/server";
import { NextAuthOptions } from "next-auth";
import { getLogger } from "../../logger";

const log = getLogger('prism:routes:tenants');

/**
 * API route to fetch tenants for the authenticated user
 * GET /api/tenants
 * 
 * @param req - The Next.js request object
 * @param authOptions - The app-specific NextAuth options
 * @returns A Next.js response with the user's tenants
 */
export async function GET_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  log.info('GET /api/tenants - Fetching tenants');
  
  // Check authentication
  const authError = await requireAuth(req, authOptions);
  if (authError) {
    log.warn('GET /api/tenants - Authentication failed');
    return NextResponse.json({ error: "Access Denied" }, { status: 403 });
  }
  const session = await getSessionSafely(req, authOptions);
  if (!session || !session.user) {
    log.warn('GET /api/tenants - No valid session found');
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  try {
    log.info('GET /api/tenants - User authenticated', { userId: session.user.id });

    const url = new URL(req.url);
    const includeAssistantCounts = url.searchParams.get('includeAssistantCounts') === '1' || url.searchParams.get('includeAssistantCounts') === 'true';
    const scopeAllRequested = url.searchParams.get('all') === '1' || url.searchParams.get('scope') === 'all';
    const isSuperAdmin = session.user.id === SUPERADMIN_USER_ID;

    // For superadmins, allow fetching ALL tenants to inspect duplicates; otherwise, fetch user-scoped tenants.
    const tenants = isSuperAdmin && scopeAllRequested
      ? await getAllTenants()
      : await TenantActions.getTenantsForUser(session.user.id);

    log.info('GET /api/tenants - Retrieved tenants', {
      count: tenants.length,
      scope: isSuperAdmin && scopeAllRequested ? 'all' : 'user-scoped',
      userId: session.user.id,
      includeAssistantCounts,
    });

    // Optionally include counts of assistants per tenantId
    if (includeAssistantCounts) {
      const tenantIds = (tenants || []).map((t: any) => t._id).filter(Boolean);
      const counts: Record<string, number> = {};
      if (tenantIds.length > 0) {
        try {
          const prism = await Prism.getInstance();
          const res = await prism.query({
            contentType: BlockType_Assistant,
            tenantId: 'any',
            where: { parent_id: { in: tenantIds } },
            orderBy: { createdAt: 'desc' },
          } as any);
          for (const item of res.items || []) {
            const tid = (item as any).tenantId;
            if (!tid) continue;
            counts[tid] = (counts[tid] || 0) + 1;
          }
        } catch (e) {
          log.warn('GET /api/tenants - Failed to aggregate assistant counts', { error: e });
        }
      }
      return NextResponse.json({ tenants, assistantCounts: counts });
    }

    return NextResponse.json({ tenants });
  } catch (error) {
    log.error('GET /api/tenants - Error fetching tenants', { error });
    return NextResponse.json({ error: "Failed to fetch tenants" }, { status: 500 });
  }
}

/**
 * API route to create a new tenant
 * POST /api/tenants
 * 
 * @param req - The Next.js request object
 * @param authOptions - The app-specific NextAuth options
 * @returns A Next.js response with the created tenant
 */
export async function POST_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  log.info('POST /api/tenants - Creating new tenant');
  
  // Check authentication
  const authError = await requireAuth(req, authOptions);
  if (authError) {
    log.warn('POST /api/tenants - Authentication failed');
    return NextResponse.json({ error: "Access Denied" }, { status: 403 });
  }
  
  try {
    // Safe body parse with diagnostics
    let raw = '';
    try {
      raw = await req.text();
    } catch (e) {
      log.warn('POST /api/tenants - Failed reading raw body', { error: (e as any)?.message });
    }
    const rawLen = raw ? raw.length : 0;
    let body: any = {};
    if (rawLen === 0) {
      log.warn('POST /api/tenants - Empty request body received');
    } else {
      try {
        body = JSON.parse(raw);
      } catch (e:any) {
        log.error('POST /api/tenants - JSON parse error', { error: e.message, rawSnippet: raw.slice(0,200) });
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
      }
    }
    
    if (!body.name) {
      log.warn('POST /api/tenants - Missing required name field');
      return NextResponse.json({ error: "Tenant name is required" }, { status: 400 });
    }
    
    // Secondary auth check to ensure we have a valid session
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user) {
      log.warn('POST /api/tenants - No valid session found');
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    log.info('POST /api/tenants - User authenticated', { userId: session.user.id });
    log.info('POST /api/tenants - Creating tenant', { name: body.name });
    
    // Create the new tenant
    const tenantData: TenantBlock.ITenant = {
      name: body.name,
      domain: body.domain,
      description: body.description,
      settings: body.settings || {},
      planTier: body.planTier || 'free'
    };
    
    let tenant;
    try {
      tenant = await TenantActions.createTenant(tenantData);
    } catch (e:any) {
      if (e?.message === 'Tenant already exists') {
        log.warn('POST /api/tenants - Duplicate tenant name', { name: tenantData.name });
        return NextResponse.json({ error: 'Tenant already exists' }, { status: 409 });
      }
      throw e;
    }
    if (!tenant || !tenant._id) {
      log.error('POST /api/tenants - Failed to create tenant');
      return NextResponse.json({ error: "Failed to create tenant" }, { status: 500 });
    }
    
    log.info('POST /api/tenants - Tenant created', { tenantId: tenant._id });
    log.info('POST /api/tenants - Assigning owner role', { userId: session.user.id, tenantId: tenant._id });

    // Assign the super admin as a tenant owner
    let ownerAssigned = false;
    if (session.user.id !== SUPERADMIN_USER_ID) {
      try {
        await TenantActions.assignUserToTenant(session.user.id, tenant._id, UserTenantRoleBlock.TenantRole.OWNER);
      } catch (e:any) {
        log.warn('POST /api/tenants - Failed assigning owner role to admin', { error: e.message });
      }
    } 
    // Assign the creator as tenant owner
    try {
      await TenantActions.assignUserToTenant(session.user.id, tenant._id, UserTenantRoleBlock.TenantRole.OWNER);
      ownerAssigned = true;
    } catch (e:any) {
      log.warn('POST /api/tenants - Failed assigning owner role', { error: e.message });
    }
  
    log.info('POST /api/tenants - Tenant creation completed', { ownerAssigned, tenantId: tenant._id, userId: session.user.id });
    return NextResponse.json({ tenant, ownerAssigned }, { status: 201 });
  } catch (error) {
    log.error('POST /api/tenants - Error creating tenant', { error });
    return NextResponse.json({ error: "Failed to create tenant" }, { status: 400 });
  }
}

// PATCH /api/tenants { id, name?, domain?, planTier?, settings? }
export async function PATCH_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  const authError = await requireAuth(req, authOptions);
  if (authError) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });
  try {
    const body = await req.json();
  const { id, name, domain, description, planTier, settings } = body;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    // Permission: tenant admin required for updates/reactivation
    const adminError = await requireTenantAdmin(id, req, authOptions);
    if (adminError) return adminError as NextResponse;
  const updated = await updateTenant(id, { name, domain, description, planTier, settings });
  return NextResponse.json({ tenant: updated });
  } catch (e:any) {
    log.error('PATCH /api/tenants error', { error: e });
    return NextResponse.json({ error: e.message || 'Failed to update tenant' }, { status: 400 });
  }
}

// DELETE /api/tenants { id }
export async function DELETE_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  const authError = await requireAuth(req, authOptions);
  if (authError) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });
  try {
    const body = await req.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    // Permission: tenant admin required for deactivation
    const adminError = await requireTenantAdmin(id, req, authOptions);
    if (adminError) return adminError as NextResponse;
    const deleted = await deleteTenant(id);
    return NextResponse.json({ tenant: deleted });
  } catch (e:any) {
    log.error('DELETE /api/tenants error', { error: e });
    return NextResponse.json({ error: e.message || 'Failed to delete tenant' }, { status: 400 });
  }
}
