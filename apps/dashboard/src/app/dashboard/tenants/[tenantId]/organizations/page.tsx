/* eslint-disable @typescript-eslint/no-explicit-any */
import { TenantActions, OrganizationActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';

import AddOrganizationForm from '@dashboard/components/admin/AddOrganizationForm';
import AssignOrgUserForm from '@dashboard/components/admin/AssignOrgUserForm';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export const dynamic = 'force-dynamic';

export default async function TenantOrganizationsPage({ params }: { params: { tenantId: string } }) {
  const session = await getSessionSafely(undefined, dashboardAuthOptions);
  if (!session?.user || session.user.is_anonymous) redirect('/login');
  const { tenantId } = params;
  const tenant = await TenantActions.getTenantById(tenantId);
  if (!tenant) return notFound();
  const tenantRoles = await TenantActions.getTenantRolesForTenant(tenantId) as any[];
  const isAdmin = tenantRoles.some(r => r.userId === session.user.id && (r.role === TenantRole.ADMIN || r.role === TenantRole.OWNER));
  if (!isAdmin) redirect('/login');
  const orgs = await OrganizationActions.getOrganizationsForTenant(tenantId);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Organizations: {tenant.name}</h1>
        <Link href={`/dashboard/tenants/${tenantId}`} className="text-sm text-blue-600 hover:underline">Tenant Overview →</Link>
      </div>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-4">
          <h2 className="font-semibold">Create Organization</h2>
          <AddOrganizationForm tenantId={tenantId} />
        </div>
        <div className="space-y-4">
          <h2 className="font-semibold">Assign User To Organization</h2>
          <AssignOrgUserForm tenantId={tenantId} organizations={orgs.map(o => ({ id: o._id!, name: (o as any).name }))} />
        </div>
      </div>
      <div className="rounded-lg border p-4">
        <h2 className="font-semibold mb-3">Existing Organizations</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Created</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map(o => (
              <tr key={o._id} className="border-b last:border-b-0">
                <td className="py-2 pr-4">{(o as any).name}</td>
                <td className="py-2 pr-4 text-xs">{String((o as any).createdAt || '—')}</td>
              </tr>
            ))}
            {orgs.length === 0 && (
              <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">None yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Link href={`/dashboard/tenants/${tenantId}/users`} className="text-xs text-muted-foreground hover:text-foreground">← Back to Tenant Users</Link>
    </div>
  );
}
