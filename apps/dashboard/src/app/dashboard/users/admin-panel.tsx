import { TenantActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { SUPERADMIN_USER_ID } from '@nia/prism/core/auth/auth.middleware';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { Users, Shield, UserCheck, UserX, RefreshCcw } from 'lucide-react';
import Link from 'next/link';

import TenantRolesTableClient from '@dashboard/components/admin/TenantRolesTableClient';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export const dynamic = 'force-dynamic';

interface AdminPanelProps {
  // future props (filters, etc.)
}

async function fetchTenantsAndRoles() {
  const session = await getSessionSafely(undefined, dashboardAuthOptions);
  if (!session || !session.user) {
    return { tenants: [], roles: [] };
  }
  const roles = await TenantActions.getUserTenantRoles(session.user.id) as any[];
  const tenantIds = roles.map(r => r.tenantId);
  const uniqueTenantIds = Array.from(new Set(tenantIds));
  const tenants = [] as any[];
  for (const tId of uniqueTenantIds) {
    const tenant = await TenantActions.getTenantById(tId);
    if (tenant) tenants.push(tenant);
  }
  return { tenants, roles };
}

export default async function AdminPanel(_props: AdminPanelProps) {
  const { tenants, roles } = await fetchTenantsAndRoles();
  const session = await getSessionSafely(undefined, dashboardAuthOptions);
  const isSuperAdmin = !!session?.user?.id && session.user.id === SUPERADMIN_USER_ID;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border p-4 bg-card">
          <div className="flex items-center gap-2 mb-2"><Users className="h-4 w-4" /><h3 className="font-semibold">Tenants</h3></div>
          <p className="text-2xl font-bold">{tenants.length}</p>
          <p className="text-xs text-muted-foreground">Total tenants you have any role on</p>
        </div>
        <div className="rounded-lg border p-4 bg-card">
          <div className="flex items-center gap-2 mb-2"><Shield className="h-4 w-4" /><h3 className="font-semibold">Admin / Owner Roles</h3></div>
          <p className="text-2xl font-bold">{roles.filter(r => r.role === TenantRole.ADMIN || r.role === TenantRole.OWNER).length}</p>
          <p className="text-xs text-muted-foreground">Elevated access assignments</p>
        </div>
        <div className="rounded-lg border p-4 bg-card">
          <div className="flex items-center gap-2 mb-2"><UserCheck className="h-4 w-4" /><h3 className="font-semibold">Active Roles</h3></div>
          <p className="text-2xl font-bold">{roles.length}</p>
          <p className="text-xs text-muted-foreground">Currently active memberships</p>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2"><Users className="h-4 w-4" /> Your Tenant Roles</h3>
          <form action="/dashboard/users" method="get">
            <button type="submit" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><RefreshCcw className="h-3 w-3" />Refresh</button>
          </form>
        </div>
        <TenantRolesTableClient tenants={tenants} roles={roles} isSuperAdmin={isSuperAdmin} />
      </div>
    </div>
  );
}
