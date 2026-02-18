import { getUserOrganizationRoles } from '@nia/prism/core/actions/organization-actions';
import { userHasAccess as tenantUserHasAccess } from '@nia/prism/core/actions/tenant-actions';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
// NOTE: getSessionSafely is intentionally required lazily inside each middleware function
// so that Jest module mocking (especially in the performance test environment where
// setup ordering and hoisting can differ) always intercepts the call. A static ESM import
// was causing the original implementation reference to be captured before mocks, leading
// to tests observing zero invocations of the mocked function.
// Similarly, NextResponse.json is now required lazily inside each function to ensure the
// jest.mock('next/server') replacement is always the function whose call count tests assert on.

// Use any as type for now to avoid NextAuthOptions import issues during ts-node
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NextAuthOptions = any;

export const SUPERADMIN_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Middleware to check if a user is authenticated
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requireAuth(req?: any, authOptions?: NextAuthOptions) {
  const { getSessionSafely } = require('./getSessionSafely');
  const { NextResponse } = require('next/server');
  const session = await getSessionSafely(req, authOptions);
  
  if (!session || !session.user || session.user.is_anonymous) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  return null; // No error - proceed
}

/**
 * Middleware to check if a user has access to a specific tenant
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requireTenantAccess(tenantId: string, req?: any, authOptions?: NextAuthOptions) {
  const { getSessionSafely } = require('./getSessionSafely');
  const { NextResponse } = require('next/server');
  const session = await getSessionSafely(req, authOptions);
  if (!session || !session.user || session.user.is_anonymous) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const has = await tenantUserHasAccess(session.user.id, tenantId, TenantRole.MEMBER);
    if (!has) {
      return NextResponse.json({ error: `Forbidden: User has no access to this tenant` }, { status: 403 });
    }
    return null;
  } catch (e) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
}

/**
 * Middleware to check if a user has admin access to a tenant
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requireTenantAdmin(tenantId: string, req?: any, authOptions?: NextAuthOptions) {
  const { getSessionSafely } = require('./getSessionSafely');
  const { NextResponse } = require('next/server');
  const session = await getSessionSafely(req, authOptions);
  if (!session || !session.user || session.user.is_anonymous) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const has = await tenantUserHasAccess(session.user.id, tenantId, TenantRole.ADMIN);
    if (!has) {
      return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
    }
    return null;
  } catch (e) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
}

/**
 * Middleware to check if a user has access to a specific organization
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requireOrgAccess(organizationId: string, tenantId: string, req?: any, authOptions?: NextAuthOptions) {
  const { getSessionSafely } = require('./getSessionSafely');
  const { NextResponse } = require('next/server');
  const session = await getSessionSafely(req, authOptions);
  if (!session || !session.user || session.user.is_anonymous) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Org access if user has org role OR tenant member+ role
    const roles = await getUserOrganizationRoles(session.user.id, tenantId) || [];
    const hasOrgRole = roles.some(r => r.organizationId === organizationId);
    if (hasOrgRole) return null;
    const tenantAccess = await tenantUserHasAccess(session.user.id, tenantId, TenantRole.MEMBER);
    if (!tenantAccess) {
      return NextResponse.json({ error: "Forbidden: No access to this organization" }, { status: 403 });
    }
    return null;
  } catch (e) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
}

export async function requireOrgAdminOrTenantAdmin(organizationId: string, tenantId: string, req?: any, authOptions?: NextAuthOptions) {
  const { getSessionSafely } = require('./getSessionSafely');
  const { NextResponse } = require('next/server');
  const session = await getSessionSafely(req, authOptions);
  if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    // Tenant admin? then allowed
    const tenantAdmin = await tenantUserHasAccess(session.user.id, tenantId, TenantRole.ADMIN);
    if (tenantAdmin) return null;
    const roles = await getUserOrganizationRoles(session.user.id, tenantId) || [];
    const hasOrgAdmin = roles.some(r => r.organizationId === organizationId && (r.role === OrganizationRole.ADMIN || r.role === OrganizationRole.OWNER));
    if (!hasOrgAdmin) return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    return null;
  } catch (e) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
}

export function isSuperAdmin(userId?: string) {
  return !!userId && userId === SUPERADMIN_USER_ID;
}