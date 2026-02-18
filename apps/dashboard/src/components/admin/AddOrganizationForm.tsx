"use client";
import React, { useState } from 'react';
import { useToast } from '@dashboard/hooks/use-toast';

interface Props { tenantId: string }

export default function AddOrganizationForm({ tenantId }: Props) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, name, description })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      toast({ title: 'Organization created', description: name });
      setName(''); setDescription('');
    } catch (e: any) {
      toast({ title: 'Error', description: e.message || 'Failed to create' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 text-sm max-w-md">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium">Name</label>
        <input className="border rounded px-2 py-1 text-sm bg-background" value={name} required onChange={e => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium">Description</label>
        <textarea className="border rounded px-2 py-1 text-sm bg-background" value={description} rows={2} onChange={e => setDescription(e.target.value)} />
      </div>
      <button type="submit" disabled={pending} className="inline-flex items-center gap-1 px-3 py-1 rounded bg-blue-600 text-white text-xs disabled:opacity-50">
        {pending ? 'Creating…' : 'Create'}
      </button>
    </form>
  );
}
