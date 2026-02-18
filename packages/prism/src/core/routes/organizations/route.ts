/* eslint-disable @typescript-eslint/no-explicit-any */
import { assignUserToOrganization, createOrganization, deleteOrganization, getOrganizationsForTenant, updateOrganization } from '@nia/prism/core/actions/organization-actions';
import { requireAuth } from '@nia/prism/core/auth';
import { requireOrgAdminOrTenantAdmin } from '@nia/prism/core/auth/auth.middleware';
import { getSessionSafely } from '@nia/prism/core/auth/getSessionSafely';
import { IOrganization } from '@nia/prism/core/blocks/organization.block';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { NextRequest, NextResponse } from 'next/server';
import { NextAuthOptions } from 'next-auth';

import { getLogger } from '../../logger';

const log = getLogger('prism:routes:organizations');

// GET /api/organizations?tenantId=...
export async function GET_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId');
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId query param required' }, { status: 400 });
  }
  const authError = await requireAuth(req, authOptions);
  if (authError) return authError as NextResponse;
  const session = await getSessionSafely(req, authOptions);
  try {
    const organizations = await getOrganizationsForTenant(tenantId);
    return NextResponse.json({ organizations });
  } catch (e) {
    log.error('ORG LIST error', { error: e, tenantId });
    return NextResponse.json({ error: 'Failed to list organizations' }, { status: 500 });
  }
}

// POST /api/organizations { tenantId, name, description? }
export async function POST_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  const authError = await requireAuth(req, authOptions);
  if (authError) return authError as NextResponse;
  const session = await getSessionSafely(req, authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const { tenantId, name, description } = body;
    if (!tenantId || !name) return NextResponse.json({ error: 'tenantId and name required' }, { status: 400 });
    const organization = await createOrganization({
      tenantId,
      name,
      description
    } as IOrganization);
    // Auto-assign creator as OWNER
    await assignUserToOrganization(session.user.id, (organization as any)._id, tenantId, OrganizationRole.OWNER);
    return NextResponse.json({ organization }, { status: 201 });
  } catch (e) {
    log.error('ORG CREATE error', { error: e });
    return NextResponse.json({ error: 'Failed to create organization' }, { status: 400 });
  }
}

// PATCH /api/organizations/:id  (Next.js route segment param not directly available here; pattern may require separate file) 
// For simplicity, accept id in body for now: { id, tenantId, ...fields }
export async function PATCH_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  const authError = await requireAuth(req, authOptions);
  if (authError) return authError as NextResponse;
  try {
    const body = await req.json();
    const { id, tenantId, name, description } = body;
    if (!id || !tenantId) return NextResponse.json({ error: 'id and tenantId required' }, { status: 400 });
    const permError = await requireOrgAdminOrTenantAdmin(id, tenantId, req, authOptions);
    if (permError) return permError as NextResponse;
    const organization = await updateOrganization(id, tenantId, { name, description } as any);
    return NextResponse.json({ organization });
  } catch (e) {
    log.error('ORG PATCH error', { error: e });
    return NextResponse.json({ error: 'Failed to update organization' }, { status: 400 });
  }
}

// DELETE /api/organizations  body { id, tenantId }
export async function DELETE_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  const authError = await requireAuth(req, authOptions);
  if (authError) return authError as NextResponse;
  try {
    const body = await req.json();
    const { id, tenantId } = body;
    if (!id || !tenantId) return NextResponse.json({ error: 'id and tenantId required' }, { status: 400 });
    const permError = await requireOrgAdminOrTenantAdmin(id, tenantId, req, authOptions);
    if (permError) return permError as NextResponse;
    const deleted = await deleteOrganization(id, tenantId);
    return NextResponse.json({ organization: deleted });
  } catch (e) {
    log.error('ORG DELETE error', { error: e });
    return NextResponse.json({ error: 'Failed to delete organization' }, { status: 400 });
  }
}
