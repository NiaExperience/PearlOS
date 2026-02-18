"use client";
import React, { useState } from 'react';
import { useToast } from '@dashboard/hooks/use-toast';

interface Props {
  tenantId: string;
  organizations: { id: string; name: string }[];
}

const roles = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
  { value: 'owner', label: 'Owner' },
];

export default function AssignOrgUserForm({ tenantId, organizations }: Props) {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id || '');
  const [role, setRole] = useState('member');
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      if (!organizationId) throw new Error('No organization selected');
      // Use existing organizations API patch to assign by organization creation? We'll call org roles endpoint if exists later; fallback to organizations PATCH not implemented so reuse organizations route (not suitable). TODO: implement dedicated endpoint.
      const res = await fetch('/api/organization-roles', { // hypothetical endpoint
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, organizationId, email, role })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
      toast({ title: 'User assigned', description: `${email} → ${role}` });
      setEmail('');
    } catch (e: any) {
      toast({ title: 'Error', description: e.message || 'Failed to assign user' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 text-sm max-w-md">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium">User Email</label>
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium">Organization</label>
        <select value={organizationId} onChange={e => setOrganizationId(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background">
          {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium">Role</label>
        <select value={role} onChange={e => setRole(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background">
          {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      <button type="submit" disabled={pending} className="inline-flex items-center gap-1 px-3 py-1 rounded bg-blue-600 text-white text-xs disabled:opacity-50">
        {pending ? 'Assigning…' : 'Assign User'}
      </button>
      <p className="text-xs text-muted-foreground">(Note: backend endpoint /api/organization-roles not yet implemented)</p>
    </form>
  );
}
