import { TenantActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import React from 'react';

import { useToast } from '@dashboard/hooks/use-toast';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export const dynamic = 'force-dynamic';

export default async function TenantDetailPage({ params }: { params: { tenantId: string } }) {
  const session = await getSessionSafely(undefined, dashboardAuthOptions);
  if (!session?.user || session.user.is_anonymous) redirect('/login');
  const { tenantId } = params;
  const tenant = await TenantActions.getTenantById(tenantId);
  if (!tenant) return notFound();
  const roles = await TenantActions.getTenantRolesForTenant(tenantId) as any[];
  const isAdmin = roles.some(r => r.userId === session.user.id && (r.role === TenantRole.ADMIN || r.role === TenantRole.OWNER));
  if (!isAdmin) redirect('/login');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tenant: {tenant.name}</h1>
        <Link href={`/dashboard/tenants/${tenantId}/users`} className="text-sm text-blue-600 hover:underline">Manage Users →</Link>
      </div>
      <div className="rounded-lg border p-4 text-sm grid gap-2 md:grid-cols-2">
        <div><span className="font-medium">ID:</span> {tenant._id}</div>
        <div><span className="font-medium">Plan Tier:</span> {tenant.planTier}</div>
        <div><span className="font-medium">Created:</span> {tenant.createdAt ? String(tenant.createdAt) : '—'}</div>
      </div>
      <TenantEditForm tenant={tenant} />
      <div className="rounded-lg border p-4">
        <h2 className="font-semibold mb-3">Roles</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-4">User</th>
              <th className="py-2 pr-4">Role</th>
            </tr>
          </thead>
          <tbody>
            {roles.map(r => (
              <tr key={r._id} className="border-b last:border-b-0">
                <td className="py-2 pr-4 text-xs font-mono">{r.userId}</td>
                <td className="py-2 pr-4 capitalize">{r.role}</td>
              </tr>
            ))}
            {roles.length === 0 && (
              <tr><td colSpan={2} className="py-6 text-center text-muted-foreground">No roles yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Link href="/dashboard/users" className="text-xs text-muted-foreground hover:text-foreground">← Back to Admin Panel</Link>
    </div>
  );
}

// Simple inline edit form (server component -> posts back via fetch in client subcomponent)
function TenantEditForm({ tenant }: { tenant: any }) {
  return (
    <div className="rounded-lg border p-4 space-y-4">
      <h2 className="font-semibold">Edit Tenant</h2>
      <TenantEditClient initialTenant={{ id: tenant._id, name: tenant.name, description: tenant.description }} />
    </div>
  );
}

// Client component for editing
function TenantEditClient({ initialTenant }: { initialTenant: { id: string; name: string; description?: string } }) {
  const { toast } = useToast();
  const [name, setName] = React.useState(initialTenant.name);
  const [description, setDescription] = React.useState(initialTenant.description || '');
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  function markDirty() { if (!dirty) setDirty(true); }

  async function onSave() {
    if (!name.trim()) return;
    const optimisticName = name.trim();
    const optimisticDescription = description.trim();
    setSaving(true);
    toast({ title: 'Saving tenant…', description: 'Applying changes', duration: 1500 });
    try {
      const res = await fetch('/api/tenants', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: initialTenant.id, name: optimisticName, description: optimisticDescription }) });
      if (!res.ok) throw new Error(await res.text() || 'Save failed');
      toast({ title: 'Tenant updated', description: 'Changes saved successfully' });
      setDirty(false);
    } catch (e:any) {
      toast({ title: 'Update failed', description: e.message || 'Error saving tenant', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium uppercase tracking-wide">Name</label>
        <input className="border rounded px-2 py-1 text-sm" value={name} onChange={e => { setName(e.target.value); markDirty(); }} disabled={saving} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium uppercase tracking-wide">Description</label>
        <textarea className="border rounded px-2 py-1 text-sm min-h-[80px]" value={description} onChange={e => { setDescription(e.target.value); markDirty(); }} disabled={saving} />
        {(!description || !description.trim()) && <span className="text-[10px] text-muted-foreground">Add a short summary for internal reference.</span>}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={onSave} disabled={saving || !name.trim() || !dirty} className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50">{saving ? 'Saving…' : 'Save Changes'}</button>
        {dirty && !saving && <span className="text-[10px] text-amber-600">Unsaved changes</span>}
      </div>
    </div>
  );
}
