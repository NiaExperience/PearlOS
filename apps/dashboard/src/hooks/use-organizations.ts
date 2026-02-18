/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useCallback, useEffect, useState } from 'react';

import { useToast } from '@dashboard/hooks/use-toast';

export interface OrgRecord { 
  _id: string; 
  name: string;
  sharedResources?: Record<string, 'Notes' | 'HtmlGeneration'>;
}

export function useOrganizations(tenantId?: string) {
  const { toast } = useToast();
  const [orgs, setOrgs] = useState<OrgRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenantId) { setOrgs([]); return; }
    setLoading(true); setError(undefined);
    try {
      const res = await fetch(`/api/organizations?tenantId=${tenantId}`);
      if (!res.ok) throw new Error('Failed to load organizations');
      const data = await res.json();
      setOrgs((data.organizations || []).map((o: any) => ({ 
        _id: o._id, 
        name: o.name,
        sharedResources: o.sharedResources 
      })));
    } catch (e:any) {
      setError(e.message);
    } finally { setLoading(false); }
  }, [tenantId]);

  useEffect(() => { refresh(); }, [refresh]);

  const createOrg = useCallback(async (name: string, opts?: { onOptimistic?: (tempId: string) => void; onCommitted?: (realId: string, tempId: string) => void; onError?: (tempId: string, error: Error) => void; }) => {
    if (!tenantId) return;
    setSubmitting(true);
    const tempId = `temp-org-${Date.now()}`;
    const optimistic = { _id: tempId, name: name.trim() };
    // Insert at top
    setOrgs(prev => [optimistic, ...prev]);
    if (opts?.onOptimistic) {
      opts.onOptimistic(tempId);
    }
    try {
      const res = await fetch('/api/organizations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, name: name.trim() }) });
      if (!res.ok) throw new Error('Create failed');
      const data = await res.json();
      const real = data.organization;
      setOrgs(prev => prev.map(o => o._id === tempId ? { _id: real._id, name: real.name } : o));
      toast({ title: 'Organization created', description: real.name });
      if (opts?.onCommitted) {
        opts.onCommitted(real._id, tempId);
      }
    } catch (e:any) {
      setOrgs(prev => prev.filter(o => o._id !== tempId));
      toast({ title: 'Org create failed', description: e.message, variant: 'destructive' });
      if (opts?.onError) {
        opts.onError(tempId, e instanceof Error ? e : new Error(String(e)));
      }
    } finally { setSubmitting(false); }
  }, [tenantId, toast]);

  const updateOrg = useCallback(async (id: string, attrs: { name?: string }) => {
    if (!tenantId) return;
    const snapshot = orgs;
    setOrgs(prev => prev.map(o => o._id === id ? { ...o, ...attrs } : o));
    try {
      const res = await fetch('/api/organizations', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, tenantId, ...attrs }) });
      if (!res.ok) throw new Error('Update failed');
      const data = await res.json(); const updated = data.organization;
      setOrgs(prev => prev.map(o => o._id === id ? { _id: updated._id, name: updated.name } : o));
      toast({ title: 'Organization updated', description: updated.name });
    } catch (e:any) {
      setOrgs(snapshot); // rollback
      toast({ title: 'Org update failed', description: e.message, variant: 'destructive' });
      refresh();
    }
  }, [tenantId, orgs, toast, refresh]);

  const deleteOrg = useCallback(async (id: string) => {
    if (!tenantId) return;
    const snap = orgs;
    // Optimistically remove from list
    setOrgs(prev => prev.filter(o => o._id !== id));
    try {
      const res = await fetch('/api/organizations', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, tenantId }) });
      if (!res.ok) throw new Error('Delete failed');
      const data = await res.json();
      toast({ title: 'Organization deleted', description: data.organization?.name || 'Organization' });
    } catch (e:any) {
      setOrgs(snap); // rollback on error
      toast({ title: 'Org delete failed', description: e.message, variant: 'destructive' });
      refresh();
    }
  }, [tenantId, orgs, toast, refresh]);

  return { orgs, loading, error, submitting, createOrg, updateOrg, deleteOrg, refresh };
}
