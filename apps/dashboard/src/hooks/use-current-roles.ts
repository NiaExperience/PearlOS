"use client";
import { useSession } from 'next-auth/react';
import { useEffect, useState, useCallback } from 'react';

import { useAdminContext } from '../contexts/AdminContext';

interface RoleRecord { role: string; _id?: string; }

interface UseCurrentRolesResult {
  tenantRole?: RoleRecord;
  orgRole?: RoleRecord;
  isTenantOwner: boolean;
  isTenantAdmin: boolean;
  isOrgOwner: boolean;
  isOrgAdmin: boolean; // org admin OR owner OR tenant admin fallback
  loading: boolean;
  refresh: () => void;
  error?: string;
}

/**
 * useCurrentRoles
 * Fetches current user's active tenant role (for selected tenant) and organization role (for selected organization)
 * Provides derived booleans for permission gating.
 * TODO(permissions): Expand to cache roles across multiple tenants for per-row gating in tenant list.
 * TODO(pagination): If role history grows, add query params for role history pagination.
 */
export function useCurrentRoles(): UseCurrentRolesResult {
  let sessionHook: any;
  try {
    sessionHook = useSession();
  } catch {
    // test fallback
    sessionHook = { data: { user: { id: 'test-user', is_anonymous: false } } };
  }
  const { data: session } = sessionHook || {};
  const { selectedTenantId, selectedOrganizationId, refreshVersion } = useAdminContext();
  const userId = session?.user?.id;

  const [tenantRole, setTenantRole] = useState<RoleRecord | undefined>();
  const [orgRole, setOrgRole] = useState<RoleRecord | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    if (!userId || !selectedTenantId) { setTenantRole(undefined); setOrgRole(undefined); return; }
    let cancelled = false;
    const controller = new AbortController();
    const run = async () => {
      setLoading(true); setError(undefined);
      try {
        // Fetch tenant role for user
        const trRes = await fetch(`/api/tenant-roles?tenantId=${selectedTenantId}&userId=${userId}`, { signal: controller.signal });
        if (trRes.ok) {
          const trData = await trRes.json();
          if (!cancelled) setTenantRole(trData.roles[0] || undefined);
        } else if (!cancelled) {
          setTenantRole(undefined);
        }
        // Fetch org role if org selected
        if (selectedOrganizationId) {
          const orRes = await fetch(`/api/organization-roles?tenantId=${selectedTenantId}&organizationId=${selectedOrganizationId}&userId=${userId}`, { signal: controller.signal });
          if (orRes.ok) {
            const orData = await orRes.json();
            const activeOrgRole = orData.roles[0];
            if (!cancelled) setOrgRole(activeOrgRole);
          } else if (!cancelled) {
            setOrgRole(undefined);
          }
        } else {
          setOrgRole(undefined);
        }
      } catch (e: any) {
        if (!cancelled && e.name !== 'AbortError') setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; controller.abort(); };
  }, [userId, selectedTenantId, selectedOrganizationId, nonce, refreshVersion]);

  const roleVal = tenantRole?.role?.toLowerCase();
  const orgRoleVal = orgRole?.role?.toLowerCase();
  const isTenantOwner = roleVal === 'owner';
  const isTenantAdmin = isTenantOwner || roleVal === 'admin';
  const isOrgOwner = orgRoleVal === 'owner';
  const isOrgAdmin = isOrgOwner || orgRoleVal === 'admin' || isTenantAdmin;

  return { tenantRole, orgRole, isTenantOwner, isTenantAdmin, isOrgOwner, isOrgAdmin, loading, refresh, error };
}
