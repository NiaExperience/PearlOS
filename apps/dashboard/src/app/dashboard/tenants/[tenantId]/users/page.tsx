import { TenantActions, UserActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';

import AddTenantUserForm from '@dashboard/components/admin/AddTenantUserForm';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export const dynamic = 'force-dynamic';

export default async function TenantUsersPage({ params, searchParams }: { params: { tenantId: string }, searchParams?: Record<string, undefined | string | string[]> }) {
  const session = await getSessionSafely(undefined, dashboardAuthOptions);
  if (!session?.user || session.user.is_anonymous) redirect('/login');
  const { tenantId } = params;
  const tenant = await TenantActions.getTenantById(tenantId);
  if (!tenant) return notFound();
  const roles = await TenantActions.getTenantRolesForTenant(tenantId) as any[];
  const isAdmin = roles.some(r => r.userId === session.user.id && (r.role === TenantRole.ADMIN || r.role === TenantRole.OWNER));
  if (!isAdmin) redirect('/login');
  // Resolve users
  const userIds = Array.from(new Set(roles.map(r => r.userId)));
  const users = await Promise.all(userIds.map(async uid => ({ uid, user: await UserActions.getUserById(uid) })));

  const inviteEmail = typeof searchParams?.inviteEmail === 'string' ? searchParams?.inviteEmail : undefined;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tenant Users: {tenant.name}</h1>
        <Link href={`/dashboard/tenants/${tenantId}`} className="text-sm text-blue-600 hover:underline">Tenant Overview →</Link>
      </div>
      <div className="rounded-lg border p-4 space-y-6">
        <div>
          <h2 className="font-semibold mb-2">Add User</h2>
          <AddTenantUserForm tenantId={tenantId} defaultEmail={inviteEmail} />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-4">User ID</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Role</th>
            </tr>
          </thead>
          <tbody>
            {roles.map(r => {
              const info = users.find(u => u.uid === r.userId);
              return (
                <tr key={r._id} className="border-b last:border-b-0">
                  <td className="py-2 pr-4 text-xs font-mono">{r.userId}</td>
                  <td className="py-2 pr-4">{info?.user?.email || '—'}</td>
                  <td className="py-2 pr-4 capitalize">{r.role}</td>
                </tr>
              );
            })}
            {roles.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Link href="/dashboard/users" className="text-xs text-muted-foreground hover:text-foreground">← Back to Admin Panel</Link>
    </div>
  );
}
