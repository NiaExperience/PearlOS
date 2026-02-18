"use client";
import React, { useEffect, useState } from 'react';
import { useAdminContext } from '../../contexts/AdminContext';

interface OrgSummary { _id: string; name: string; }

export const OrganizationSelector: React.FC = () => {
  const { selectedTenantId, selectedOrganizationId, setSelectedOrganizationId } = useAdminContext();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!selectedTenantId) { setOrgs([]); return; }
    let cancelled = false;
    const run = async () => {
      setLoading(true); setError(undefined);
      try {
        const res = await fetch(`/api/organizations?tenantId=${selectedTenantId}`);
        if (!res.ok) throw new Error('Failed to load organizations');
        const data = await res.json();
        if (!cancelled) setOrgs((data.organizations || []).map((o: any) => ({ _id: o._id, name: o.name })));
      } catch (e:any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [selectedTenantId]);

  if (!selectedTenantId) return null;

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium">Organization:</label>
      {loading && <span className="text-xs text-muted-foreground">Loading...</span>}
      {error && <span className="text-xs text-red-500">{error}</span>}
      <select
        className="border rounded px-2 py-1 text-sm"
        value={selectedOrganizationId || ''}
        onChange={e => setSelectedOrganizationId(e.target.value || undefined)}
      >
        <option value="">All</option>
        {orgs.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
      </select>
    </div>
  );
};
