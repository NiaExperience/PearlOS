"use client";
import React, { useEffect, useState } from 'react';
import { useAdminContext } from '../../contexts/AdminContext';

interface TenantSummary { _id: string; name: string; }

export const TenantSelector: React.FC = () => {
  const { selectedTenantId, setSelectedTenantId, triggerRefresh } = useAdminContext();
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [submitError, setSubmitError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true); setError(undefined);
      try {
        const res = await fetch('/api/tenants');
        if (!res.ok) throw new Error('Failed to load tenants');
        const data = await res.json();
        if (!cancelled) setTenants((data.tenants || []).map((t: any) => ({ _id: t._id, name: t.name })));
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, []);

  const startCreate = () => { setCreating(true); setNewName(''); setSubmitError(undefined); };
  const cancelCreate = () => { setCreating(false); setSubmitError(undefined); };
  const submitCreate = async () => {
    if (!newName.trim()) { setSubmitError('Name required'); return; }
    setSubmitError(undefined);
    // Optimistic placeholder
    const tempId = `temp-${Date.now()}`;
    const optimistic = { _id: tempId, name: newName.trim() };
    setTenants(prev => [...prev, optimistic]);
    setSelectedTenantId(tempId);
    setCreating(false);
    try {
      const res = await fetch('/api/tenants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName.trim() }) });
      if (!res.ok) throw new Error('Create failed');
      const data = await res.json();
      const real = data.tenant;
      setTenants(prev => prev.map(t => t._id === tempId ? { _id: real._id, name: real.name } : t));
      setSelectedTenantId(real._id);
      triggerRefresh();
    } catch (e: any) {
      setSubmitError(e.message);
      // rollback optimistic
      setTenants(prev => prev.filter(t => t._id !== tempId));
      setSelectedTenantId(undefined);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium">Tenant:</label>
      {loading && <span className="text-xs text-muted-foreground">Loading...</span>}
      {error && <span className="text-xs text-red-500">{error}</span>}
      <select
        className="border rounded px-2 py-1 text-sm"
        value={selectedTenantId || ''}
        onChange={e => setSelectedTenantId(e.target.value || undefined)}
      >
        <option value="">Select...</option>
        {tenants.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
      </select>
      {!creating && (
        <button type="button" onClick={startCreate} className="text-xs border rounded px-2 py-1 hover:bg-accent">
          + Tenant
        </button>
      )}
      {creating && (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            className="border rounded px-1 py-0.5 text-xs"
            placeholder="New tenant name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
          <button type="button" onClick={submitCreate} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground">Save</button>
          <button type="button" onClick={cancelCreate} className="text-xs px-2 py-1 rounded border">Cancel</button>
        </div>
      )}
      {submitError && <span className="text-xs text-red-500">{submitError}</span>}
    </div>
  );
};
