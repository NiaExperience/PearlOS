/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useRouter } from 'next/navigation';
import React, { useState } from 'react';

import { useToast } from '@dashboard/hooks/use-toast';

interface Props {
  tenantId: string;
  onSuccess?: (info: { email: string; role: string; operation?: string }) => void;
  defaultEmail?: string;
}

const roles = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
  { value: 'owner', label: 'Owner' },
];

export default function AddTenantUserForm({ tenantId, onSuccess, defaultEmail }: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const [email, setEmail] = useState(defaultEmail || '');
  const [role, setRole] = useState('member');
  const [assistant, setAssistant] = useState('');
  const [assistants, setAssistants] = useState<{ _id: string; name: string; subDomain?: string }[]>([]);
  const [pending, setPending] = useState(false);

  React.useEffect(() => {
    // Fetch assistants for the tenant to populate dropdown
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/assistants?tenantId=${tenantId}`);
        const data = await res.json();
        if (!cancelled && res.ok && Array.isArray(data.assistants)) {
          setAssistants(data.assistants);
        }
      } catch { 
        // ignore
      }
    }
    load();
    return () => { cancelled = true; };
  }, [tenantId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      if (!assistant) {
        throw new Error('Please select an assistant');
      }
      const res = await fetch(`/api/tenants/${tenantId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role, assistantSubDomain: assistant })
      });
  const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
      const op = data.operation || data.role?.operation;
      let title = 'User assigned';
      switch (op) {
        case 'noop': title = 'User already had role'; break;
        case 'updated': title = 'Role updated'; break;
        case 'created': title = 'User added to tenant'; break;
      }
  const inviteNote = data.invited ? ' (invite sent)' : '';
  toast({ title, description: `${email} → ${role}${inviteNote}` });
  try { onSuccess?.({ email, role, operation: op }); } catch { /* ignore */ }
  setEmail('');
  setAssistant('');
  // Trigger revalidation of the server component listing roles
  try { router.refresh(); } catch { /* ignore */ }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message || 'Failed to add user' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 text-sm max-w-md">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium">Email</label>
        <input
          type="email"
          required
            value={email}
          onChange={e => setEmail(e.target.value)}
          className="border rounded px-2 py-1 text-sm bg-background"
          placeholder="user@example.com"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium">Role</label>
        <select
          value={role}
          onChange={e => setRole(e.target.value)}
          className="border rounded px-2 py-1 text-sm bg-background"
        >
          {roles.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium">Assistant</label>
        <select
          value={assistant}
          onChange={e => setAssistant(e.target.value)}
          className="border rounded px-2 py-1 text-sm bg-background"
          required
        >
          <option value="" disabled>— Select an assistant —</option>
          {assistants.map(a => (
            <option key={a._id} value={a.subDomain || ''}>{a.name}{a.subDomain ? ` (${a.subDomain})` : ''}</option>
          ))}
        </select>
        <span className="text-[10px] text-muted-foreground">The invite link will open this assistant after activation.</span>
      </div>
      <div className="flex gap-3 items-center">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1 px-3 py-1 rounded bg-blue-600 text-white text-xs disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add User'}
        </button>
        <span className="text-xs text-muted-foreground">Creates user if email not found.</span>
      </div>
    </form>
  );
}
