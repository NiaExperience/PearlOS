/* eslint-disable @typescript-eslint/no-explicit-any */
import { createOrganization, getOrganizationsForTenant, updateOrganization, deleteOrganization, assignUserToOrganization } from '@nia/prism/core/actions/organization-actions';
import { getSessionSafely, requireAuth } from '@nia/prism/core/auth';
import { requireOrgAdminOrTenantAdmin } from '@nia/prism/core/auth/auth.middleware';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { NextRequest, NextResponse } from 'next/server';

import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export const dynamic = 'force-dynamic';

// GET /api/organizations?tenantId=...
export async function GET(req: NextRequest) {
  const authErr = await requireAuth(req, dashboardAuthOptions);
  if (authErr) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
    const organizations = await getOrganizationsForTenant(tenantId) || [];
    return NextResponse.json({ organizations });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to list organizations' }, { status: 500 });
  }
}

// POST /api/organizations { tenantId, name, description? }
export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req, dashboardAuthOptions);
  if (authErr) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });
  try {
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const { tenantId, name, description } = body;
    if (!tenantId || !name) return NextResponse.json({ error: 'tenantId and name required' }, { status: 400 });
    const organization = await createOrganization({ tenantId, name, description } as any);
    // Auto-assign creator as OWNER
    try {
      await assignUserToOrganization(session.user.id, (organization as any)._id, tenantId, OrganizationRole.OWNER);
    } catch (e) {
      // Non-fatal; log and continue
      console.warn('ORG OWNER ASSIGN failed', e);
    }
    return NextResponse.json({ organization }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to create organization' }, { status: 400 });
  }
}

// PATCH /api/organizations { id, tenantId, name?, description? }
export async function PATCH(req: NextRequest) {
  const authErr = await requireAuth(req, dashboardAuthOptions);
  if (authErr) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });
  try {
    const body = await req.json();
    const { id, tenantId, name, description } = body;
    if (!id || !tenantId) return NextResponse.json({ error: 'id and tenantId required' }, { status: 400 });
    // Permission: need org admin or tenant admin (organization id = id)
    const permErr = await requireOrgAdminOrTenantAdmin(id, tenantId, req, dashboardAuthOptions);
    if (permErr) return permErr as NextResponse;
    const organization = await updateOrganization(id, tenantId, { name, description } as any);
    return NextResponse.json({ organization });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to update organization' }, { status: 400 });
  }
}

// DELETE /api/organizations { id, tenantId }
export async function DELETE(req: NextRequest) {
  const authErr = await requireAuth(req, dashboardAuthOptions);
  if (authErr) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });
  try {
    const body = await req.json();
    const { id, tenantId } = body;
    if (!id || !tenantId) return NextResponse.json({ error: 'id and tenantId required' }, { status: 400 });
    const permErr = await requireOrgAdminOrTenantAdmin(id, tenantId, req, dashboardAuthOptions);
    if (permErr) return permErr as NextResponse;
    const organization = await deleteOrganization(id, tenantId);
    return NextResponse.json({ organization });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to delete organization' }, { status: 400 });
  }
}
