'use client';
import { RefreshCcw } from 'lucide-react';
import React, { useEffect, useState, useMemo } from 'react';

import { useToast } from '@dashboard/hooks/use-toast';

import { RoleBadge } from '../../../../components/admin/RoleBadge';
import { useAdminContext } from '../../../../contexts/AdminContext';

// TODO: Debounce identical error toasts within short window to prevent spam.
// TODO: Provide retry action button on fetch failure to re-trigger loads.
// TODO(pagination): Implement limit + cursor on users list & roles endpoints.

interface User {
  _id: string;
  name: string;
  email?: string;
}
interface TenantRole {
  userId: string;
  tenantId: string;
  role: string;
}
interface OrgRole {
  userId: string;
  organizationId: string;
  role: string;
}

export default function AdminUsersRolesPage() {
  const { selectedTenantId, selectedOrganizationId } = useAdminContext();
  const [users, setUsers] = useState<User[]>([]);
  const [rolesMap, setRolesMap] = useState<Record<string, TenantRole | undefined>>({});
  const [orgRolesMap, setOrgRolesMap] = useState<Record<string, OrgRole | undefined>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { toast } = useToast();
  const [sortKey, setSortKey] = useState<'name' | 'email' | 'tenantRole' | 'orgRole'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSortClick = (key: 'name' | 'email' | 'tenantRole' | 'orgRole') => {
    setSortKey(prev => {
      if (prev === key) {
        // toggle direction
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      // new key defaults to ascending
      setSortDir('asc');
      return key;
    });
  };

  const sortedUsers = useMemo(() => {
    const arr = [...users];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = compareNullable(a.name, b.name);
          break;
        case 'email':
          cmp = compareNullable(a.email, b.email);
          break;
        case 'tenantRole':
          cmp = compareNullable(rolesMap[a._id]?.role, rolesMap[b._id]?.role);
          break;
        case 'orgRole':
          cmp = compareNullable(orgRolesMap[a._id]?.role, orgRolesMap[b._id]?.role);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [users, sortKey, sortDir, rolesMap, orgRolesMap]);

  // Read-only: no selection, no editing

  // Removed editing / bulk role logic for read-only view.

  useEffect(() => {
    if (!selectedTenantId) {
      setUsers([]);
      setRolesMap({});
      setOrgRolesMap({});
      return;
    }
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(undefined);
      try {
        const resUsers = await fetch(`/api/users?tenantId=${selectedTenantId}`);
        if (!resUsers.ok) {
          toast({
            title: 'Load failed',
            description: 'Unable to load users',
            variant: 'destructive',
          });
          throw new Error('Failed to load users');
        }
        const usersData = await resUsers.json();
        if (cancelled) return;
        // De-duplicate by _id (defensive – backend may occasionally return duplicates)
        const deduped = Array.isArray(usersData)
          ? Array.from(new Map(usersData.map((u: any) => [u._id, u])).values())
          : [];
        setUsers(deduped);
        // fetch all roles in one call
        const resRoles = await fetch(`/api/tenant-roles?tenantId=${selectedTenantId}`);
        if (resRoles.ok) {
          const data = await resRoles.json();
          const map: Record<string, TenantRole | undefined> = {};
          (data.roles || [])
            .forEach((r: TenantRole) => {
              map[r.userId] = r;
            });
          if (!cancelled) setRolesMap(map);
        } else {
          toast({
            title: 'Load failed',
            description: 'Unable to load tenant roles',
            variant: 'destructive',
          });
        }
        // fetch org roles if org selected
        if (selectedOrganizationId) {
          const resOrgRoles = await fetch(
            `/api/organization-roles?tenantId=${selectedTenantId}&organizationId=${selectedOrganizationId}`
          );
          if (resOrgRoles.ok) {
            const data = await resOrgRoles.json();
            const map: Record<string, OrgRole | undefined> = {};
            (data.roles || []).forEach((r: OrgRole) => {
              map[r.userId] = r;
            });
            if (!cancelled) setOrgRolesMap(map);
          } else if (!cancelled) {
            setOrgRolesMap({});
            toast({
              title: 'Load failed',
              description: 'Unable to load organization roles',
              variant: 'destructive',
            });
          }
        } else if (!cancelled) {
          setOrgRolesMap({});
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message);
          toast({ title: 'Error', description: e.message, variant: 'destructive' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [selectedTenantId, selectedOrganizationId]);

  return (
    <div className="space-y-4">
  <h1 className="text-xl font-semibold flex items-center gap-2">User Status
        {selectedTenantId && (
          <button
            type="button"
            title="Refresh users & roles"
            onClick={async () => {
              if (!selectedTenantId) return;
              setLoading(true); setError(undefined);
              try {
                const resUsers = await fetch(`/api/users?tenantId=${selectedTenantId}`);
                if (!resUsers.ok) throw new Error('Failed to load users');
                const usersData = await resUsers.json();
                const deduped = Array.isArray(usersData) ? Array.from(new Map(usersData.map((u: any) => [u._id, u])).values()) : [];
                setUsers(deduped);
                const resRoles = await fetch(`/api/tenant-roles?tenantId=${selectedTenantId}`);
                if (resRoles.ok) {
                  const data = await resRoles.json();
                  const map: Record<string, TenantRole | undefined> = {};
                  (data.roles || []).forEach((r: TenantRole) => { map[r.userId] = r; });
                  setRolesMap(map);
                }
                if (selectedOrganizationId) {
                  const resOrg = await fetch(`/api/organization-roles?tenantId=${selectedTenantId}&organizationId=${selectedOrganizationId}`);
                  if (resOrg.ok) {
                    const data = await resOrg.json();
                    const omap: Record<string, OrgRole | undefined> = {};
                    (data.roles || []).forEach((r: OrgRole) => { omap[r.userId] = r; });
                    setOrgRolesMap(omap);
                  } else { setOrgRolesMap({}); }
                } else { setOrgRolesMap({}); }
              } catch (e:any) {
                setError(e.message);
                toast({ title: 'Refresh failed', description: e.message, variant: 'destructive' });
              } finally { setLoading(false); }
            }}
            className="ml-2 h-8 w-8 inline-flex items-center justify-center rounded border text-muted-foreground hover:text-foreground hover:bg-accent"
          ><RefreshCcw className="h-4 w-4" /></button>
        )}
      </h1>
      {selectedTenantId && (
        <div className="border rounded p-3 bg-muted/20 flex flex-wrap items-center gap-4 text-xs">
          {(() => {
            const counts: Record<string, number> = {};
            Object.values(rolesMap).forEach(r => { if (r?.role) counts[r.role] = (counts[r.role]||0)+1; });
            const none = users.length - Object.keys(rolesMap).length;
            return (
              <div className="flex flex-col gap-1">
                <span className="font-medium text-[11px] uppercase tracking-wide">Tenant Roles</span>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(counts).map(([role,c]) => (
                    <span key={role} className="px-2 py-0.5 rounded border bg-background/50 text-[11px]">{role}: {c}</span>
                  ))}
                  {none > 0 && <span className="px-2 py-0.5 rounded border bg-background/50 text-[11px]">none: {none}</span>}
                  {Object.keys(counts).length===0 && none===0 && <span className="text-muted-foreground">None</span>}
                </div>
              </div>
            );
          })()}
          {selectedOrganizationId && (() => {
            const counts: Record<string, number> = {};
            Object.values(orgRolesMap).forEach(r => { if (r?.role) counts[r.role] = (counts[r.role]||0)+1; });
            const none = users.length - Object.keys(orgRolesMap).length;
            return (
              <div className="flex flex-col gap-1">
                <span className="font-medium text-[11px] uppercase tracking-wide">Org Roles</span>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(counts).map(([role,c]) => (
                    <span key={role} className="px-2 py-0.5 rounded border bg-background/50 text-[11px]">{role}: {c}</span>
                  ))}
                  {none > 0 && <span className="px-2 py-0.5 rounded border bg-background/50 text-[11px]">none: {none}</span>}
                  {Object.keys(counts).length===0 && none===0 && <span className="text-muted-foreground">None</span>}
                </div>
              </div>
            );
          })()}
          <div className="flex flex-col gap-1">
            <span className="font-medium text-[11px] uppercase tracking-wide">Totals</span>
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-0.5 rounded border bg-background/50 text-[11px]">users: {users.length}</span>
            </div>
          </div>
        </div>
      )}
      {!selectedTenantId && (
        <p className="text-sm text-muted-foreground">Select a tenant to manage user roles.</p>
      )}
      {selectedTenantId && (
        <div className="space-y-2">
          {/* Read-only table */}
          {loading && <div className="text-xs text-muted-foreground">Loading...</div>}
          {error && <div className="text-xs text-red-500">{error}</div>}
          <table className="w-full text-sm border">
            <thead>
              <tr className="bg-muted/30 text-left text-xs uppercase tracking-wide">
                <SortableHeader
                  label="Name"
                  active={sortKey === 'name'}
                  dir={sortDir}
                  onClick={() => handleSortClick('name')}
                />
                <SortableHeader
                  label="Email"
                  active={sortKey === 'email'}
                  dir={sortDir}
                  onClick={() => handleSortClick('email')}
                />
                <SortableHeader
                  label="Tenant Role"
                  active={sortKey === 'tenantRole'}
                  dir={sortDir}
                  onClick={() => handleSortClick('tenantRole')}
                />
                {selectedOrganizationId && (
                  <SortableHeader
                    label="Org Role"
                    active={sortKey === 'orgRole'}
                    dir={sortDir}
                    onClick={() => handleSortClick('orgRole')}
                  />
                )}
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((u: User) => (
                <tr key={u._id} className="border-t hover:bg-accent/30">
                  <td className="p-2">{u.name}</td>
                  <td className="p-2 text-muted-foreground">{u.email || '—'}</td>
                  <td className="p-2"><RoleBadge role={rolesMap[u._id]?.role} /></td>
                  {selectedOrganizationId && (
                    <td className="p-2"><RoleBadge role={orgRolesMap[u._id]?.role} /></td>
                  )}
                </tr>
              ))}
              {!loading && users.length === 0 && (
                <tr>
                  <td
                    className="p-2 text-muted-foreground"
                    colSpan={selectedOrganizationId ? 4 : 3}
                  >
                    No users
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {/* No bulk selection footer in read-only view */}
        </div>
      )}
    </div>
  );
}

// Sorting helpers
function compareNullable(a?: string, b?: string) {
  if (!a && !b) return 0;
  if (!a) return 1; // put undefined/null at end
  if (!b) return -1;
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

// Provide table header cell with click-to-toggle sorting
const SortableHeader: React.FC<{
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
}> = ({ label, active, dir, onClick }) => {
  const ariaSort = active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th className="p-0" aria-sort={ariaSort as any}>
      <button
        type="button"
        onClick={onClick}
        className={`w-full text-left px-2 py-2 cursor-pointer select-none flex items-center gap-1 hover:bg-accent/40 focus:outline-none focus:ring-1 focus:ring-primary ${active ? 'font-medium' : ''}`}
        aria-label={`${label} column, ${active ? (dir === 'asc' ? 'ascending' : 'descending') : 'no sort'}, activate to sort ${active && dir === 'asc' ? 'descending' : 'ascending'}`}
      >
        <span>{label}</span>
        {active && (
          <span aria-hidden className="text-[10px]">
            {dir === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </button>
    </th>
  );
};

// Removed interactive role editor, selection, and invite components for read-only status view.
