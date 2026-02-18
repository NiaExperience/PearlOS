/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { OrganizationRole as OrganizationRoleEnum } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { TenantRole as TenantRoleEnum } from '@nia/prism/core/blocks/userTenantRole.block';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import { useToast } from '@dashboard/hooks/use-toast';

import { useAdminContext } from '../../contexts/AdminContext';
import { useCurrentRoles } from '../../hooks/use-current-roles';

import { RoleBadge } from './RoleBadge';



// TODO(pagination): Consider loading paginated role history if roles expand beyond single active record.

interface User {
  _id: string;
  name: string;
  email?: string;
}
interface TenantRole {
  userId: string;
  tenantId: string;
  role: string;
  _id?: string;
}
interface OrgRole {
  userId: string;
  organizationId: string;
  role: string;
  _id?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  user: User | null;
  onTenantRoleChange?: (role: TenantRole | null) => void;
  onOrgRoleChange?: (role: OrgRole | null) => void;
}

// Use enums from core blocks to avoid hardcoded strings and ensure consistency
const tenantRoleOptions: string[] = [
  TenantRoleEnum.OWNER,
  TenantRoleEnum.ADMIN,
  TenantRoleEnum.MEMBER,
];
const orgRoleOptions: string[] = [
  OrganizationRoleEnum.OWNER,
  OrganizationRoleEnum.ADMIN,
  OrganizationRoleEnum.MEMBER,
  OrganizationRoleEnum.VIEWER,
];

export const RoleManagementModal: React.FC<Props> = ({ open, onClose, user, onTenantRoleChange, onOrgRoleChange }) => {
  const router = useRouter();
  const { selectedTenantId, selectedOrganizationId } = useAdminContext();
  // Use current roles hook solely for its refresh mechanism to update current-user UI after mutations
  const { refresh: refreshCurrentUserRoles } = useCurrentRoles();
  const { toast } = useToast();
  const [loadingTenantRoles, setLoadingTenantRoles] = useState(false);
  const [tenantRoles, setTenantRoles] = useState<TenantRole[]>([]);
  const [savingTenant, setSavingTenant] = useState(false);
  const [tenantError, setTenantError] = useState<string | undefined>();

  const [loadingOrgRoles, setLoadingOrgRoles] = useState(false);
  const [orgRoles, setOrgRoles] = useState<OrgRole[]>([]);
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgError, setOrgError] = useState<string | undefined>();

  useEffect(() => {
    if (!open || !user || !selectedTenantId) return;
    let cancelled = false;
    const fetchTenantRoles = async () => {
      setLoadingTenantRoles(true);
      setTenantError(undefined);
      try {
        const res = await fetch(
          `/api/tenant-roles?tenantId=${selectedTenantId}&userId=${user._id}`
        );
        if (!res.ok) throw new Error('Failed to load tenant roles');
        const data = await res.json();
        if (!cancelled) setTenantRoles(data.roles || []);
      } catch (e: any) {
        if (!cancelled) setTenantError(e.message);
      } finally {
        if (!cancelled) setLoadingTenantRoles(false);
      }
    };
    fetchTenantRoles();
    return () => {
      cancelled = true;
    };
  }, [open, user, selectedTenantId]);

  useEffect(() => {
    if (!open || !user || !selectedTenantId || !selectedOrganizationId) {
      setOrgRoles([]);
      return;
    }
    let cancelled = false;
    const fetchOrgRoles = async () => {
      setLoadingOrgRoles(true);
      setOrgError(undefined);
      try {
        const res = await fetch(
          `/api/organization-roles?tenantId=${selectedTenantId}&organizationId=${selectedOrganizationId}&userId=${user._id}`
        );
        if (!res.ok) throw new Error('Failed to load org roles');
        const data = await res.json();
        if (!cancelled) setOrgRoles(data.roles || []);
      } catch (e: any) {
        if (!cancelled) setOrgError(e.message);
      } finally {
        if (!cancelled) setLoadingOrgRoles(false);
      }
    };
    fetchOrgRoles();
    return () => {
      cancelled = true;
    };
  }, [open, user, selectedTenantId, selectedOrganizationId]);

  if (!open || !user) return null;

  const currentTenantRole = tenantRoles.find(r => r.tenantId === selectedTenantId);
  const currentOrgRole = orgRoles.find(r => r.organizationId === selectedOrganizationId);

  const assignTenantRole = async (role: string) => {
    if (!user || !selectedTenantId) return;
    setSavingTenant(true);
    setTenantError(undefined);
    try {
      const method = currentTenantRole ? 'PATCH' : 'POST';
      const body = currentTenantRole
        ? { tenantId: selectedTenantId, userId: user._id, role }
        : { tenantId: selectedTenantId, userId: user._id, role };
      const res = await fetch('/api/tenant-roles', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to save tenant role');
      refreshCurrentUserRoles();
      toast({
        title: 'Tenant role saved',
        description: `${user.name} is now ${role}`,
        variant: 'default',
      });
      // refetch (modal-local) & refresh page (server data -> tables)
      const ref = await fetch(`/api/tenant-roles?tenantId=${selectedTenantId}&userId=${user._id}`);
      if (ref.ok) {
        const data = await ref.json();
        const nextRoles = data.roles || [];
        setTenantRoles(nextRoles);
        onTenantRoleChange?.(nextRoles);
      }
      router.refresh();
    } catch (e: any) {
      setTenantError(e.message);
    } finally {
      setSavingTenant(false);
    }
  };

  const removeTenantRole = async () => {
    if (!user || !selectedTenantId || !currentTenantRole) return;
    setSavingTenant(true);
    setTenantError(undefined);
    try {
      const res = await fetch('/api/tenant-roles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: selectedTenantId, userId: user._id }),
      });
      if (!res.ok) throw new Error('Failed to delete tenant role');
      refreshCurrentUserRoles();
  setTenantRoles([]);
      toast({
        title: 'Tenant role removed',
        description: `${user.name} no longer has a tenant role`,
        variant: 'default',
      });
  onTenantRoleChange?.(null);
      router.refresh();
    } catch (e: any) {
      setTenantError(e.message);
    } finally {
      setSavingTenant(false);
    }
  };

  const assignOrgRole = async (role: string) => {
    if (!user || !selectedTenantId || !selectedOrganizationId) return;
    setSavingOrg(true);
    setOrgError(undefined);
    try {
      const method = currentOrgRole ? 'PATCH' : 'POST';
      const body = currentOrgRole
        ? { tenantId: selectedTenantId, userOrganizationRoleId: currentOrgRole._id, role }
        : {
            tenantId: selectedTenantId,
            organizationId: selectedOrganizationId,
            email: user.email,
            role,
          };
      const endpoint = '/api/organization-roles';
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to save organization role');
      refreshCurrentUserRoles();
      toast({
        title: 'Org role saved',
        description: `${user.name} is now ${role}`,
        variant: 'default',
      });
      // refetch (modal-local) & refresh page (server data -> tables)
      const ref = await fetch(
        `/api/organization-roles?tenantId=${selectedTenantId}&organizationId=${selectedOrganizationId}&userId=${user._id}`
      );
      if (ref.ok) {
        const data = await ref.json();
        const nextRoles = data.roles || [];
        setOrgRoles(nextRoles);
        onOrgRoleChange?.(nextRoles);
      }
      router.refresh();
    } catch (e: any) {
      setOrgError(e.message);
    } finally {
      setSavingOrg(false);
    }
  };

  const removeOrgRole = async () => {
    if (!user || !selectedTenantId || !selectedOrganizationId || !currentOrgRole) return;
    setSavingOrg(true);
    setOrgError(undefined);
    try {
      const res = await fetch('/api/organization-roles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: selectedTenantId,
          userOrganizationRoleId: currentOrgRole._id,
        }),
      });
      if (!res.ok) throw new Error('Failed to delete organization role');
      refreshCurrentUserRoles();
  setOrgRoles([]);
      toast({
        title: 'Org role removed',
        description: `${user.name} no longer has an organization role`,
        variant: 'default',
      });
  onOrgRoleChange?.(null);
      router.refresh();
    } catch (e: any) {
      setOrgError(e.message);
    } finally {
      setSavingOrg(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6">
      <div className="bg-white dark:bg-neutral-900 rounded shadow w-full max-w-lg p-4 space-y-5">
        <div className="flex justify-between items-center">
          <h2 className="text-sm font-semibold">Manage Roles – {user.name}</h2>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded border">
            Close
          </button>
        </div>
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide">Tenant Role</h3>
          {loadingTenantRoles && <div className="text-xs text-muted-foreground">Loading...</div>}
          {tenantError && <div className="text-xs text-red-500">{tenantError}</div>}
          <div className="flex flex-wrap gap-2 items-center">
            {tenantRoleOptions.map(r => (
              <button
                key={r}
                disabled={savingTenant}
                onClick={() => assignTenantRole(r)}
                className={`text-xs px-2 py-1 rounded border ${currentTenantRole?.role === r ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
              >
                {r}
              </button>
            ))}
            {currentTenantRole && (
              <button
                disabled={savingTenant}
                onClick={removeTenantRole}
                className="text-xs px-2 py-1 rounded border hover:bg-destructive/20"
              >
                Remove
              </button>
            )}
            <RoleBadge role={currentTenantRole?.role} />
          </div>
        </section>
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide">Organization Role</h3>
          {!selectedOrganizationId && (
            <div className="text-xs text-muted-foreground">
              Select an organization to manage org role.
            </div>
          )}
          {selectedOrganizationId && (
            <>
              {loadingOrgRoles && <div className="text-xs text-muted-foreground">Loading...</div>}
              {orgError && <div className="text-xs text-red-500">{orgError}</div>}
              <div className="flex flex-wrap gap-2 items-center">
                {orgRoleOptions.map(r => (
                  <button
                    key={r}
                    disabled={savingOrg}
                    onClick={() => assignOrgRole(r)}
                    className={`text-xs px-2 py-1 rounded border ${currentOrgRole?.role === r ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                  >
                    {r}
                  </button>
                ))}
                {currentOrgRole && (
                  <button
                    disabled={savingOrg}
                    onClick={removeOrgRole}
                    className="text-xs px-2 py-1 rounded border hover:bg-destructive/20"
                  >
                    Remove
                  </button>
                )}
                <RoleBadge role={currentOrgRole?.role} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};
