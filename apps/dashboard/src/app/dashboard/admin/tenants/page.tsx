/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { SUPERADMIN_USER_ID } from '@nia/prism/core/auth/auth.middleware';
import { Ban, Check, Copy, RefreshCcw, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import React, { useEffect, useMemo, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@dashboard/components/ui/dialog';
import { useToast } from '@dashboard/hooks/use-toast';

import AddTenantUserForm from '../../../../components/admin/AddTenantUserForm';
import { RoleBadge } from '../../../../components/admin/RoleBadge';
import { useAdminContext } from '../../../../contexts/AdminContext';
import { useCurrentRoles } from '../../../../hooks/use-current-roles';
import { useOrganizations } from '../../../../hooks/use-organizations';

interface Tenant {
  _id: string;
  name: string;
  description?: string;
}

// Combined Tenants / Users management page
export default function AdminTenantsPage() {
  const {
    selectedTenantId,
    setSelectedTenantId,
    selectedOrganizationId,
    setSelectedOrganizationId,
  } = useAdminContext();
  const { toast } = useToast();
  const { data: session } = useSession();
  const { isTenantAdmin } = useCurrentRoles();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [assistantCounts, setAssistantCounts] = useState<Record<string, number>>({});
  const {
    orgs,
    loading: orgsLoading,
    error: orgsError,
    createOrg,
    updateOrg,
    deleteOrg,
    submitting: orgSubmitting,
    refresh: orgsRefresh,
  } = useOrganizations(selectedTenantId);
  // Users & Roles state
  interface User {
    _id: string;
    name: string;
    email?: string;
    emailVerified?: string | Date | null;
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
  const [users, setUsers] = useState<User[]>([]);
  const [rolesMap, setRolesMap] = useState<Record<string, TenantRole | undefined>>({});
  const [orgRolesMap, setOrgRolesMap] = useState<Record<string, OrgRole | undefined>>({});
  const [resourceTitles, setResourceTitles] = useState<Record<string, string>>({});
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | undefined>();
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [userSortKey, setUserSortKey] = useState<'name' | 'email' | 'tenantRole' | 'orgRole'>(
    'name'
  );
  const [userSortDir, setUserSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleUserSelect = (id: string) =>
    setSelectedUserIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const clearUserSelection = () => setSelectedUserIds(new Set());
  const allUsersSelected = selectedUserIds.size > 0 && selectedUserIds.size === users.length;
  const anyUsersSelected = selectedUserIds.size > 0 && selectedUserIds.size < users.length;

  // Bulk panel helpers
  const getCommonTenantRole = () => {
    const entries = Array.from(selectedUserIds).map(id => rolesMap[id]);
    return computeCommonRole(entries);
  };
  const getCommonOrgRole = () => {
    const entries = Array.from(selectedUserIds).map(id => orgRolesMap[id]);
    return computeCommonRole(entries);
  };

  // Removed dynamic width logic (was causing runaway growth). Rely on normal layout & horizontal scroll if needed.

  const sortUsers = (arr: User[]) => {
    return [...arr].sort((a, b) => {
      let cmp = 0;
      switch (userSortKey) {
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
      return userSortDir === 'asc' ? cmp : -cmp;
    });
  };
  const sortedUsers = sortUsers(users);

  function compareNullable(a?: string, b?: string) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  }

  const handleUserSort = (key: typeof userSortKey) => {
    if (userSortKey === key) {
      setUserSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setUserSortKey(key);
      setUserSortDir('asc');
    }
  };

  const isSuperAdmin = !!session?.user?.id && session.user.id === SUPERADMIN_USER_ID;

  // Delete user dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [blockedModalOpen, setBlockedModalOpen] = useState(false);
  const [blockedData, setBlockedData] = useState<{ blockingTenants?: { id: string; name: string }[]; blockingOrgs?: { id: string; name: string }[] } | null>(null);
  const [deleteTargetUserId, setDeleteTargetUserId] = useState<string | null>(null);
  const [deleteIncludeData, setDeleteIncludeData] = useState(true);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  // Delete dialog derived values (after state declarations)
  const deleteTargetUser = deleteTargetUserId
    ? users.find(u => u._id === deleteTargetUserId)
    : undefined;
  const deleteTargetIsOwner = deleteTargetUserId
    ? rolesMap[deleteTargetUserId]?.role === 'owner' ||
      orgRolesMap[deleteTargetUserId]?.role === 'owner'
    : false;

  // Bulk delete dialog state
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkDeleteIncludeData, setBulkDeleteIncludeData] = useState(false);
  const [bulkDeleteSubmitting, setBulkDeleteSubmitting] = useState(false);

  // New user create form state (tenant-scoped)
  const [newUserOpen, setNewUserOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState('member');
  const [newUserSaving, setNewUserSaving] = useState(false);
  const [newUserError, setNewUserError] = useState<string | undefined>();
  // Pre-open Add User with inviteEmail if provided in URL (from UserProfile page)
  const prefillInviteEmail = useMemo(() => {
    if (typeof window === 'undefined') return '';
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get('inviteEmail') || '';
    } catch {
      return '';
    }
  }, []);
  useEffect(() => {
    if (prefillInviteEmail) {
      setNewUserOpen(true);
      setNewUserEmail(prefillInviteEmail);
    }
  }, [prefillInviteEmail]);

  // Load full user list for superadmin once; tenant admins load per-tenant
  useEffect(() => {
    let cancelled = false;
    const loadAll = async () => {
      setUsersLoading(true);
      setUsersError(undefined);
      try {
        const res = await fetch('/api/users/all');
        if (!res.ok) throw new Error('Failed to load users');
        const list = await res.json();
        if (cancelled) return;
        const raw = Array.isArray(list) ? list : list.users || [];
        const deduped = Array.from(new Map(raw.map((u: any) => [u._id, u])).values()) as User[];
        setUsers(deduped);
      } catch (e: any) {
        if (!cancelled) setUsersError(e.message);
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    };
    const loadTenant = async () => {
      if (!selectedTenantId) {
        setUsers([]);
        return;
      }
      setUsersLoading(true);
      setUsersError(undefined);
      try {
        const res = await fetch(`/api/users?tenantId=${selectedTenantId}`);
        if (!res.ok) throw new Error('Failed to load users');
        const list = await res.json();
        if (cancelled) return;
        const raw = Array.isArray(list) ? list : list.users || [];
        const deduped = Array.from(new Map(raw.map((u: any) => [u._id, u])).values()) as User[];
        setUsers(deduped);
      } catch (e: any) {
        if (!cancelled) setUsersError(e.message);
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    };
    if (isSuperAdmin) {
      loadAll();
    } else {
      loadTenant();
    }
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  // Load roles when tenant/org changes (user list remains stable for superadmin)
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // Clear maps when no tenant
      if (!selectedTenantId) {
        setRolesMap({});
        setOrgRolesMap({});
        return;
      }
      try {
        const resRoles = await fetch(`/api/tenant-roles?tenantId=${selectedTenantId}`);
        if (resRoles.ok) {
          const data = await resRoles.json();
          const map: Record<string, TenantRole | undefined> = {};
          (data.roles || []).forEach((r: TenantRole) => {
            map[r.userId] = r;
          });
          if (!cancelled) setRolesMap(map);
        } else if (!cancelled) setRolesMap({});
        if (selectedOrganizationId) {
          const resOrg = await fetch(
            `/api/organization-roles?tenantId=${selectedTenantId}&organizationId=${selectedOrganizationId}`
          );
          if (resOrg.ok) {
            const data = await resOrg.json();
            const omap: Record<string, OrgRole | undefined> = {};
            (data.roles || []).forEach((r: OrgRole) => {
              omap[r.userId] = r;
            });
            if (!cancelled) setOrgRolesMap(omap);
          } else if (!cancelled) setOrgRolesMap({});
        } else if (!cancelled) setOrgRolesMap({});
      } catch {
        if (!cancelled) {
          setRolesMap({});
          setOrgRolesMap({});
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [selectedTenantId, selectedOrganizationId]);

  // Fetch resource titles for shared resources in organizations
  useEffect(() => {
    if (!selectedTenantId || orgs.length === 0) {
      setResourceTitles({});
      return;
    }

    let cancelled = false;
    const fetchTitles = async () => {
      const titlesMap: Record<string, string> = {};

      for (const org of orgs) {
        if (!org.sharedResources) continue;

        for (const [resourceId, contentType] of Object.entries(org.sharedResources)) {
          if (cancelled) break;

          try {
            // Fetch resource details via contentDetail API
            const response = await fetch(
              `/api/contentDetail?contentId=${resourceId}&type=${contentType}&tenantId=${selectedTenantId}`
            );

            if (response.ok && !cancelled) {
              const data = await response.json();
              // API returns { definition, item } structure
              const item = data.item || data;
              titlesMap[resourceId] =
                item.title || item.name || item.description || `Untitled ${contentType}`;
            }
          } catch (e) {
            console.error(`Failed to fetch ${contentType} ${resourceId}:`, e);
          }
        }

        if (cancelled) break;
      }

      if (!cancelled) {
        setResourceTitles(titlesMap);
      }
    };

    fetchTitles();
    return () => {
      cancelled = true;
    };
  }, [selectedTenantId, orgs]);

  // Role change handlers (tenant + org)
  const changeTenantRole = async (userId: string, newRole: string | null) => {
    if (!selectedTenantId) return;
    try {
      if (!newRole) {
        const res = await fetch('/api/tenant-roles', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId: selectedTenantId, userId }),
        });
        if (!res.ok) throw new Error('Remove failed');
        setRolesMap(prev => {
          const copy = { ...prev };
          delete copy[userId];
          return copy;
        });
        toast({ title: 'Tenant role removed', description: 'Role cleared' });
      } else {
        const existing = rolesMap[userId];
        const method = existing ? 'PATCH' : 'POST';
        const res = await fetch('/api/tenant-roles', {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId: selectedTenantId, userId, role: newRole }),
        });
        if (!res.ok) throw new Error('Save failed');
        const data = await res.json();
        setRolesMap(prev => ({ ...prev, [userId]: data.role }));
        if (!existing) toast({ title: 'Tenant role assigned', description: newRole.toUpperCase() });
        else if (existing.role !== newRole)
          toast({
            title: 'Tenant role updated',
            description: `${existing.role.toUpperCase()} -> ${newRole.toUpperCase()}`,
          });
        else toast({ title: 'No change', description: newRole.toUpperCase() });
      }
    } catch (e: any) {
      toast({ title: 'Role change failed', description: e.message, variant: 'destructive' });
    }
  };

  const changeOrgRole = async (userId: string, newRole: string | null) => {
    if (!selectedTenantId || !selectedOrganizationId) return;
    try {
      const existing = orgRolesMap[userId];
      if (!newRole) {
        if (!existing) return;
        const res = await fetch('/api/organization-roles', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: selectedTenantId,
            userOrganizationRoleId: (existing as any)._id,
          }),
        });
        if (!res.ok) throw new Error('Remove failed');
        setOrgRolesMap(prev => {
          const copy = { ...prev };
          delete copy[userId];
          return copy;
        });
        toast({ title: 'Org role removed', description: existing.role.toUpperCase() });
      } else if (!existing) {
        const user = users.find(u => u._id === userId);
        if (!user?.email) throw new Error('User email required');
        const res = await fetch('/api/organization-roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: selectedTenantId,
            organizationId: selectedOrganizationId,
            email: user.email,
            role: newRole,
          }),
        });
        if (!res.ok) throw new Error('Assign failed');
        const data = await res.json();
        setOrgRolesMap(prev => ({ ...prev, [userId]: data.role }));
        toast({ title: 'Org role assigned', description: newRole.toUpperCase() });
      } else {
        const res = await fetch('/api/organization-roles', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: selectedTenantId,
            userOrganizationRoleId: (existing as any)._id,
            role: newRole,
          }),
        });
        if (!res.ok) throw new Error('Update failed');
        const data = await res.json();
        setOrgRolesMap(prev => ({ ...prev, [userId]: data.role }));
        if (existing.role !== newRole)
          toast({
            title: 'Org role updated',
            description: `${existing.role.toUpperCase()} -> ${newRole.toUpperCase()}`,
          });
        else toast({ title: 'No change', description: newRole.toUpperCase() });
      }
    } catch (e: any) {
      toast({ title: 'Org role change failed', description: e.message, variant: 'destructive' });
    }
  };

  // Begin delete (open dialog)
  const beginDeleteUser = (userId: string) => {
    if (!selectedTenantId && !isSuperAdmin) return;
    setDeleteTargetUserId(userId);
    setDeleteIncludeData(true);
    setDeleteDialogOpen(true);
  };

  // Confirm delete (with optional purgeAll)
  const confirmDeleteUser = async () => {
    if (!deleteTargetUserId) return;
    const userId = deleteTargetUserId;
    const user = users.find(u => u._id === userId);
    if (!user) {
      setDeleteDialogOpen(false);
      return;
    }
    if (!selectedTenantId && !isSuperAdmin) {
      setDeleteDialogOpen(false);
      return;
    }
    // Owner guard (UI side) – backend will enforce as well
    const tenantRole = rolesMap[userId]?.role;
    const orgRole = orgRolesMap[userId]?.role;
    if (tenantRole === 'owner' || orgRole === 'owner') {
      toast({
        title: 'Cannot delete owner',
        description: 'Demote or transfer ownership first.',
        variant: 'destructive',
      });
      return;
    }
    const snapshotUsers = users;
    const snapshotTenantRole = rolesMap[userId];
    const snapshotOrgRole = orgRolesMap[userId];
    setDeleteSubmitting(true);
    // optimistic removal
    setUsers(prev => prev.filter(u => u._id !== userId));
    setRolesMap(prev => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    setOrgRolesMap(prev => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    try {
      const url = selectedTenantId
        ? `/api/users/${userId}?tenantId=${selectedTenantId}`
        : `/api/users/${userId}`;
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purgeAll: deleteIncludeData }),
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 409) {
          try {
            const data = JSON.parse(text);
            if (data.blockingTenants || data.blockingOrgs) {
              setBlockedData(data);
              setBlockedModalOpen(true);
            } else {
              toast({
                title: 'Deletion blocked (OWNER)',
                description: data.error || 'User is OWNER of a tenant or organization. Transfer/demote ownership then retry.',
                variant: 'destructive',
              });
            }
          } catch {
            toast({
              title: 'Deletion blocked (OWNER)',
              description: 'User is OWNER of a tenant or organization. Transfer/demote ownership then retry.',
              variant: 'destructive',
            });
          }
        } else {
          toast({
            title: 'Delete failed',
            description: text || 'Unknown error',
            variant: 'destructive',
          });
        }
        // rollback
        setUsers(snapshotUsers);
        if (snapshotTenantRole) setRolesMap(prev => ({ ...prev, [userId]: snapshotTenantRole }));
        if (snapshotOrgRole) setOrgRolesMap(prev => ({ ...prev, [userId]: snapshotOrgRole }));
        return;
      }
      const payload = await res.json().catch(() => ({}) as any);
      toast({
        title: 'User deleted',
        description: `${user.email || user.name || userId}${payload?.purged ? ' (all data purged)' : ''}`,
      });
      setSelectedUserIds(sel => {
        const n = new Set(sel);
        n.delete(userId);
        return n;
      });
      setDeleteDialogOpen(false);
      setDeleteTargetUserId(null);
    } catch (e: any) {
      // rollback
      setUsers(snapshotUsers);
      if (snapshotTenantRole) setRolesMap(prev => ({ ...prev, [userId]: snapshotTenantRole }));
      if (snapshotOrgRole) setOrgRolesMap(prev => ({ ...prev, [userId]: snapshotOrgRole }));
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const cancelDeleteUser = () => {
    if (deleteSubmitting) return; // prevent cancel mid-flight
    setDeleteDialogOpen(false);
    setDeleteTargetUserId(null);
    setDeleteIncludeData(true);
  };

  // Bulk delete handler (sequential to simplify rollback granularity)
  const bulkDeleteUsers = async () => {
    if (selectedUserIds.size === 0) return;
    if (!selectedTenantId && !isSuperAdmin) return;
    const userIds = Array.from(selectedUserIds);
    const originalUsers = users;
    const originalRoles = { ...rolesMap };
    const originalOrgRoles = { ...orgRolesMap };
    // optimistic remove all selected
    setUsers(prev => prev.filter(u => !selectedUserIds.has(u._id)));
    setRolesMap(prev => {
      const next = { ...prev };
      userIds.forEach(id => delete next[id]);
      return next;
    });
    setOrgRolesMap(prev => {
      const next = { ...prev };
      userIds.forEach(id => delete next[id]);
      return next;
    });
    setSelectedUserIds(new Set());
    const failures: string[] = [];
    for (const id of userIds) {
      try {
        const url = selectedTenantId
          ? `/api/users/${id}?tenantId=${selectedTenantId}`
          : `/api/users/${id}`;
        const res = await fetch(url, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ purgeAll: bulkDeleteIncludeData }),
        });
        if (!res.ok) failures.push(id);
      } catch {
        failures.push(id);
      }
    }
    if (failures.length) {
      // restore failed ones
      setUsers(prev => {
        const setFail = new Set(failures);
        const failedUsers = originalUsers.filter(u => setFail.has(u._id));
        return [...prev, ...failedUsers];
      });
      setRolesMap(prev => {
        const next = { ...prev };
        failures.forEach(id => {
          if (originalRoles[id]) next[id] = originalRoles[id];
        });
        return next;
      });
      setOrgRolesMap(prev => {
        const next = { ...prev };
        failures.forEach(id => {
          if (originalOrgRoles[id]) next[id] = originalOrgRoles[id];
        });
        return next;
      });
      toast({
        title: 'Bulk delete partial',
        description: `${failures.length} failed`,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Users deleted',
        description: `${userIds.length} removed${bulkDeleteIncludeData ? ' (data purged)' : ''}`,
      });
    }
  };

  const beginBulkDelete = () => {
    if (selectedUserIds.size === 0) return;
    if (!selectedTenantId && !isSuperAdmin) return;
    setBulkDeleteIncludeData(false);
    setBulkDeleteDialogOpen(true);
  };

  const confirmBulkDelete = async () => {
    setBulkDeleteSubmitting(true);
    try {
      await bulkDeleteUsers();
    } finally {
      setBulkDeleteSubmitting(false);
      setBulkDeleteDialogOpen(false);
    }
  };

  const cancelBulkDelete = () => {
    if (bulkDeleteSubmitting) return;
    setBulkDeleteDialogOpen(false);
  };

  // Bulk tenant role handler (mirrors users page implementation)
  const handleBulkTenantRole = async (userIds: string[], role: string | null) => {
    if (!selectedTenantId || userIds.length === 0) return;
    const snapshot: Record<string, TenantRole | undefined> = {};
    userIds.forEach(id => {
      snapshot[id] = rolesMap[id];
    });
    // optimistic apply
    setRolesMap(prev => {
      const next = { ...prev };
      if (role) {
        userIds.forEach(uid => {
          next[uid] = {
            ...(next[uid] || {}),
            userId: uid,
            tenantId: selectedTenantId,
            role,
          } as any;
        });
      } else {
        userIds.forEach(uid => {
          delete next[uid];
        });
      }
      return next;
    });
    try {
      const res = await fetch('/api/tenant-roles/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: selectedTenantId,
          updates: userIds.map(id => ({ userId: id, role })),
        }),
      });
      if (!res.ok) throw new Error('Bulk update failed');
      const data = await res.json();
      const results = data.results || [];
      const stats: Record<string, number> = {};
      const failures: string[] = [];
      results.forEach((r: any) => {
        const key = r.action || r.status;
        stats[key] = (stats[key] || 0) + 1;
        if (r.status === 'error' || key === 'error') failures.push(r.userId);
      });
      if (failures.length) {
        setRolesMap(prev => {
          const next = { ...prev };
          failures.forEach(uid => {
            const original = snapshot[uid];
            if (original) next[uid] = original;
            else delete next[uid];
          });
          return next;
        });
      }
      const parts: string[] = [];
      if (stats.assigned) parts.push(`assigned ${stats.assigned}`);
      if (stats.updated) parts.push(`updated ${stats.updated}`);
      if (stats.removed) parts.push(`removed ${stats.removed}`);
      if (stats.noop) parts.push(`no change ${stats.noop}`);
      if (stats.error || stats.errors) parts.push(`errors ${stats.error || stats.errors}`);
      toast({
        title: 'Tenant roles updated',
        description: parts.join(', '),
        variant: stats.error || stats.errors ? 'destructive' : 'default',
      });
    } catch (e: any) {
      // revert snapshot
      setRolesMap(prev => {
        const next = { ...prev };
        userIds.forEach(uid => {
          const original = snapshot[uid];
          if (original) next[uid] = original;
          else delete next[uid];
        });
        return next;
      });
      toast({ title: 'Bulk tenant update failed', description: e.message, variant: 'destructive' });
    }
  };

  // Bulk org role handler
  const handleBulkOrgRole = async (userIds: string[], role: string | null) => {
    if (!selectedTenantId || !selectedOrganizationId || userIds.length === 0) return;
    const snapshot: Record<string, OrgRole | undefined> = {};
    userIds.forEach(id => {
      snapshot[id] = orgRolesMap[id];
    });
    setOrgRolesMap(prev => {
      const next = { ...prev };
      if (role) {
        userIds.forEach(uid => {
          next[uid] = {
            ...(next[uid] || {}),
            userId: uid,
            organizationId: selectedOrganizationId,
            role,
          } as any;
        });
      } else {
        userIds.forEach(uid => {
          delete next[uid];
        });
      }
      return next;
    });
    try {
      const updates = userIds.map(uid => {
        const user = users.find(u => u._id === uid);
        return { userId: uid, email: user?.email, role };
      });
      const res = await fetch('/api/organization-roles/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: selectedTenantId,
          organizationId: selectedOrganizationId,
          updates,
        }),
      });
      if (!res.ok) throw new Error('Bulk org update failed');
      const data = await res.json();
      const results = data.results || [];
      const stats: Record<string, number> = {};
      const failures: string[] = [];
      results.forEach((r: any) => {
        const key = r.action || r.status;
        stats[key] = (stats[key] || 0) + 1;
        if (r.status === 'error' || key === 'error') failures.push(r.userId);
      });
      if (failures.length) {
        setOrgRolesMap(prev => {
          const next = { ...prev };
          failures.forEach(uid => {
            const original = snapshot[uid];
            if (original) next[uid] = original;
            else delete next[uid];
          });
          return next;
        });
      }
      const parts: string[] = [];
      if (stats.assigned) parts.push(`assigned ${stats.assigned}`);
      if (stats.updated) parts.push(`updated ${stats.updated}`);
      if (stats.removed) parts.push(`removed ${stats.removed}`);
      if (stats.noop) parts.push(`no change ${stats.noop}`);
      if (stats.error || stats.errors) parts.push(`errors ${stats.error || stats.errors}`);
      toast({
        title: 'Org roles updated',
        description: parts.join(', '),
        variant: stats.error || stats.errors ? 'destructive' : 'default',
      });
    } catch (e: any) {
      setOrgRolesMap(prev => {
        const next = { ...prev };
        userIds.forEach(uid => {
          const original = snapshot[uid];
          if (original) next[uid] = original;
          else delete next[uid];
        });
        return next;
      });
      toast({ title: 'Bulk org update failed', description: e.message, variant: 'destructive' });
    }
  };
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [editOrgName, setEditOrgName] = useState('');
  const [editOrgSubmitting, setEditOrgSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [editDirty, setEditDirty] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  // Tenant delete dialog state
  const [deleteTenantDialogOpen, setDeleteTenantDialogOpen] = useState(false);
  const [deleteTenantTargetId, setDeleteTenantTargetId] = useState<string | null>(null);
  const [deleteTenantIncludeData, setDeleteTenantIncludeData] = useState(false);
  const [deleteTenantSubmitting, setDeleteTenantSubmitting] = useState(false);
  // Tenants sort state
  const [tenantSortKey, setTenantSortKey] = useState<'name' | 'id' | 'assistants'>('name');
  const [tenantSortDir, setTenantSortDir] = useState<'asc' | 'desc'>('asc');
  // Freeze tenant ordering during inline edit/create to avoid resort jitter
  const [tenantFrozenOrderIds, setTenantFrozenOrderIds] = useState<string[] | null>(null);
  const handleTenantSort = (key: 'name' | 'id' | 'assistants') => {
    if (tenantSortKey === key) setTenantSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setTenantSortKey(key);
      setTenantSortDir('asc');
    }
  };
  const sortedTenants = React.useMemo(() => {
    const arr = [...tenants];
    const cmpNullable = (a?: string, b?: string) => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    };
    arr.sort((a, b) => {
      let cmp = 0;
      switch (tenantSortKey) {
        case 'name':
          cmp = cmpNullable(a.name, b.name);
          break;
        case 'id':
          cmp = cmpNullable(a._id, b._id);
          break;
        case 'assistants': {
          const av = assistantCounts[a._id] || 0;
          const bv = assistantCounts[b._id] || 0;
          cmp = av - bv;
          break;
        }
      }
      return tenantSortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [tenants, assistantCounts, tenantSortKey, tenantSortDir]);

  // Render-ordered tenants honoring a frozen snapshot if present
  const tenantsOrdered = React.useMemo(() => {
    if (!tenantFrozenOrderIds) return sortedTenants;
    const map = new Map(tenants.map(t => [t._id, t] as const));
    const fromFrozen = tenantFrozenOrderIds.map(id => map.get(id)).filter(Boolean) as Tenant[];
    const frozenSet = new Set(tenantFrozenOrderIds);
    const extras = tenants.filter(t => !frozenSet.has(t._id));
    return [...fromFrozen, ...extras];
  }, [sortedTenants, tenantFrozenOrderIds, tenants]);

  const fetchTenants = async () => {
    setLoading(true);
    setError(undefined);
    try {
      // Ask backend for all tenants (superadmin only) and include assistant counts
      const res = await fetch('/api/tenants?all=1&includeAssistantCounts=1');
      if (!res.ok) throw new Error('Failed to load tenants');
      const data = await res.json();
      setAssistantCounts(data.assistantCounts || {});
      setTenants(
        (data.tenants || []).map((t: any) => ({
          _id: t._id,
          name: t.name,
          description: t.description,
        }))
      );
    } catch (e: any) {
      setError(e.message);
      toast({ title: 'Load failed', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };
  // Determine current user's role for selected tenant to gate admin actions.
  const currentUserId = session?.user?.id; // reserved for future per-tenant role matrix

  useEffect(() => {
    fetchTenants();
  }, []);

  // Organizations now handled by useOrganizations hook

  return (
    <div className="space-y-4 px-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold">Tenants / Users</h1>
      <div className="flex flex-wrap items-start gap-6">
        <div className="max-w-none flex-none basis-[340px] space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            Tenants
            <button
              type="button"
              onClick={fetchTenants}
              title="Refresh tenants"
              className="hover:bg-accent rounded border px-1 py-0.5 text-[10px]"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
            </button>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {!creating && (
              <button
                className="hover:bg-accent rounded border px-2 py-1 text-xs"
                onClick={() => {
                  setCreating(true);
                  setNewName('');
                  setCreateError(undefined);
                }}
              >
                + Tenant
              </button>
            )}
            {creating && (
              <div className="flex items-center gap-1">
                <input
                  className="rounded border px-1 py-0.5 text-xs"
                  placeholder="New tenant name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  disabled={createSubmitting}
                />
                <button
                  className="bg-primary text-primary-foreground rounded px-2 py-1 text-xs disabled:opacity-50"
                  disabled={!newName.trim() || createSubmitting}
                  onClick={async () => {
                    if (!newName.trim()) {
                      setCreateError('Name required');
                      return;
                    }
                    setCreateSubmitting(true);
                    setCreateError(undefined);
                    const tempId = `temp-${Date.now()}`;
                    const optimistic = { _id: tempId, name: newName.trim() };
                    // Freeze current order and show optimistic at top
                    setTenantFrozenOrderIds(prev => prev ?? sortedTenants.map(t => t._id));
                    setTenants(prev => [optimistic, ...prev]);
                    setSelectedTenantId(tempId);
                    // Open rename dialog focused on name
                    setEditingId(tempId);
                    setEditName(newName.trim());
                    setEditDescription('');
                    setEditDirty(false);
                    setEditDialogOpen(true);
                    setCreating(false);
                    try {
                      const res = await fetch('/api/tenants', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: newName.trim() }),
                      });
                      if (!res.ok) throw new Error('Create failed');
                      const data = await res.json();
                      const real = data.tenant;
                      setTenants(prev =>
                        prev.map(t => (t._id === tempId ? { _id: real._id, name: real.name } : t))
                      );
                      setSelectedTenantId(real._id);
                      // Keep editing the real record
                      setEditingId(real._id);
                      setEditName(real.name || newName.trim());
                      setEditDescription(real.description || '');
                      setEditDirty(false);
                      // Update frozen order ids to swap temp for real id
                      setTenantFrozenOrderIds(order =>
                        order ? [real._id, ...order.filter(id => id !== tempId)] : null
                      );
                      toast({ title: 'Tenant created', description: real.name });
                    } catch (e: any) {
                      setCreateError(e.message);
                      setTenants(prev => prev.filter(t => t._id !== tempId));
                      setTenantFrozenOrderIds(null);
                      toast({
                        title: 'Create failed',
                        description: e.message,
                        variant: 'destructive',
                      });
                    } finally {
                      setCreateSubmitting(false);
                    }
                  }}
                >
                  Save
                </button>
                <button
                  className="rounded border px-2 py-1 text-xs"
                  disabled={createSubmitting}
                  onClick={() => {
                    setCreating(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
            {createError && <span className="text-xs text-red-500">{createError}</span>}
          </div>
          {loading && <div className="text-muted-foreground text-xs">Loading...</div>}
          {error && <div className="text-xs text-red-500">{error}</div>}
          <ul className="ml-0 divide-y rounded border text-sm">
            {/* Tenants header row with sortable columns */}
            <li className="bg-muted/30 text-muted-foreground flex items-center text-[10px] uppercase tracking-wide">
              <button
                type="button"
                onClick={() => handleTenantSort('name')}
                className="hover:bg-accent/40 min-w-[260px] flex-[2.7] px-3 py-1.5 text-left"
                title="Sort by name"
              >
                <span className="inline-flex items-center gap-1">
                  Name
                  {tenantSortKey === 'name' && (
                    <span aria-hidden className="text-[9px]">
                      {tenantSortDir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleTenantSort('id')}
                className="hover:bg-accent/40 min-w-[220px] max-w-[320px] flex-[1.2] px-2 py-1.5 text-left"
                title="Sort by Tenant ID"
              >
                <span className="inline-flex items-center gap-1">
                  Tenant ID
                  {tenantSortKey === 'id' && (
                    <span aria-hidden className="text-[9px]">
                      {tenantSortDir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleTenantSort('assistants')}
                className="hover:bg-accent/40 min-w-[90px] flex-[0.6] px-2 py-1.5 text-right"
                title="Sort by # assistants"
              >
                <span className="inline-flex items-center gap-1">
                  # assistants
                  {tenantSortKey === 'assistants' && (
                    <span aria-hidden className="text-[9px]">
                      {tenantSortDir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </span>
              </button>
              <div className="min-w-[120px] flex-[0.7] px-2 py-1.5 text-right">Actions</div>
            </li>
            {tenantsOrdered.map(t => {
              const selected = t._id === selectedTenantId;
              const assistants = assistantCounts[t._id] || 0;
              return (
                <li key={t._id} className={`group flex items-center`}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (!selected) setSelectedTenantId(t._id);
                      else setSelectedTenantId(undefined);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (!selected) setSelectedTenantId(t._id);
                        else setSelectedTenantId(undefined);
                      }
                    }}
                    className={`hover:bg-accent/40 min-w-[260px] flex-[2.7] cursor-pointer px-3 py-2 text-left ${selected ? 'bg-accent/60 font-medium' : ''}`}
                  >
                    <span className={`flex flex-col items-start gap-0.5`}>
                      <span className="flex items-center gap-2">{t.name}</span>
                      {t.description && (
                        <span className="text-muted-foreground line-clamp-1 max-w-[300px] text-[10px]">
                          {t.description}
                        </span>
                      )}
                    </span>
                  </div>
                  {/* Tenant ID column (click to copy) */}
                  <div className="min-w-[220px] max-w-[320px] flex-[1.2] px-2">
                    <button
                      type="button"
                      title="Click to copy Tenant ID"
                      onClick={async e => {
                        e.stopPropagation();
                        try {
                          await navigator.clipboard.writeText(t._id);
                          toast({ title: 'Copied Tenant ID', description: t._id });
                        } catch (err: any) {
                          toast({
                            title: 'Copy failed',
                            description: err?.message || 'Unable to copy ID',
                            variant: 'destructive',
                          });
                        }
                      }}
                      className="hover:bg-accent/40 inline-flex w-full items-center gap-1 rounded border px-1.5 py-0.5 text-left font-mono text-[11px]"
                    >
                      <Copy className="text-muted-foreground h-3.5 w-3.5" />
                      <span className="truncate" title={t._id}>
                        {t._id}
                      </span>
                    </button>
                  </div>
                  <div className="min-w-[90px] flex-[0.6] px-2 text-right">
                    <span
                      className="bg-muted/30 rounded border px-1.5 py-0.5 text-[10px]"
                      title="# assistants"
                    >
                      {assistants}
                    </span>
                  </div>
                  <div className="min-w-[120px] flex-[0.7] px-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        className="hover:bg-accent rounded border px-2 py-1 text-[10px] disabled:opacity-50"
                        disabled={!isTenantAdmin}
                        onClick={() => {
                          setTenantFrozenOrderIds(prev => prev ?? sortedTenants.map(x => x._id));
                          setEditingId(t._id);
                          setEditName(t.name);
                          setEditDescription(t.description || '');
                          setEditDirty(false);
                          setEditDialogOpen(true);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setDeleteTenantTargetId(t._id);
                          setDeleteTenantIncludeData(false);
                          setDeleteTenantDialogOpen(true);
                        }}
                        className="inline-flex h-6 w-6 items-center justify-center rounded border border-transparent text-red-600 hover:border-red-200 hover:bg-red-50 disabled:opacity-50"
                        title="Delete tenant"
                        disabled={!(isTenantAdmin || isSuperAdmin)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
            {!loading && tenants.length === 0 && (
              <li className="text-muted-foreground list-none px-3 py-2">None</li>
            )}
          </ul>
          <Dialog
            open={!!editingId && editDialogOpen}
            onOpenChange={open => {
              if (!open) {
                setEditDialogOpen(false);
                setEditingId(null);
                setEditName('');
                setEditDescription('');
                setEditDirty(false);
                setEditSubmitting(false);
                setTenantFrozenOrderIds(null);
              }
            }}
          >
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="text-sm">Edit Tenant</DialogTitle>
              </DialogHeader>
              {editingId && (
                <div className="space-y-3 text-xs">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium uppercase tracking-wide">Name</label>
                    <input
                      value={editName}
                      maxLength={120}
                      className="rounded border px-2 py-1 text-xs"
                      onChange={e => {
                        setEditName(e.target.value);
                        setEditDirty(true);
                      }}
                      disabled={editSubmitting}
                      autoFocus
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium uppercase tracking-wide">
                      Description
                    </label>
                    <textarea
                      value={editDescription}
                      maxLength={400}
                      className="min-h-[70px] resize-y rounded border px-2 py-1 text-xs"
                      onChange={e => {
                        setEditDescription(e.target.value);
                        setEditDirty(true);
                      }}
                      disabled={editSubmitting}
                    />
                    <span className="text-muted-foreground text-[9px]">
                      {400 - editDescription.length} chars left
                    </span>
                  </div>
                  <DialogFooter className="flex items-center justify-end gap-2 pt-2">
                    <button
                      className="hover:bg-accent rounded border px-2 py-1 text-[10px] disabled:opacity-50"
                      onClick={() => {
                        setEditDialogOpen(false);
                      }}
                      disabled={editSubmitting}
                    >
                      Cancel
                    </button>
                    <button
                      className="bg-primary text-primary-foreground rounded border px-2 py-1 text-[10px] disabled:opacity-50"
                      disabled={editSubmitting || !editName.trim() || !editDirty}
                      onClick={async () => {
                        if (!editingId) return;
                        setEditSubmitting(true);
                        const id = editingId;
                        const newName = editName.trim();
                        const newDesc = editDescription.trim();
                        const snapshot = tenants;
                        setTenants(prev =>
                          prev.map(x =>
                            x._id === id ? { ...x, name: newName, description: newDesc } : x
                          )
                        );
                        try {
                          const res = await fetch('/api/tenants', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id, name: newName, description: newDesc }),
                          });
                          if (!res.ok) throw new Error((await res.text()) || 'Update failed');
                          const data = await res.json();
                          const updated = data.tenant;
                          setTenants(prev =>
                            prev.map(x =>
                              x._id === id
                                ? {
                                    _id: updated._id,
                                    name: updated.name,
                                    description: updated.description,
                                  }
                                : x
                            )
                          );
                          toast({ title: 'Tenant updated', description: updated.name });
                          setEditDialogOpen(false);
                          setTenantFrozenOrderIds(null);
                          setEditingId(null);
                          setEditName('');
                          setEditDescription('');
                          setEditDirty(false);
                        } catch (e: any) {
                          setTenants(snapshot);
                          toast({
                            title: 'Update failed',
                            description: e.message,
                            variant: 'destructive',
                          });
                          await fetchTenants();
                        } finally {
                          setEditSubmitting(false);
                        }
                      }}
                    >
                      Save Changes
                    </button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>

        {/* Users & Roles side panel */}
        <div className="min-w-[600px] flex-[2] basis-[900px] space-y-4">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
            Users & Roles{' '}
            {selectedTenantId && (
              <span className="text-muted-foreground text-xs font-normal">
                {selectedOrganizationId ? 'for selected tenant & org' : 'for selected tenant'}
              </span>
            )}
            {!selectedTenantId && isSuperAdmin && (
              <span
                className="rounded border bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-800"
                title="Viewing all users across all tenants (roles disabled until a tenant is selected)"
              >
                All Users
              </span>
            )}
            {(selectedTenantId || (isSuperAdmin && !selectedTenantId)) && (
              <button
                type="button"
                onClick={() => {
                  // re-run user + roles load logic
                  // replicate effect logic by invoking same sequence
                  (async () => {
                    setUsersLoading(true);
                    setUsersError(undefined);
                    try {
                      let list: any = [];
                      if (isSuperAdmin && !selectedTenantId) {
                        const resUsers = await fetch('/api/users/all');
                        if (!resUsers.ok) throw new Error('Failed to load users');
                        const raw = await resUsers.json();
                        list = Array.isArray(raw) ? raw : raw.users || [];
                      } else if (selectedTenantId) {
                        const resUsers = await fetch(`/api/users?tenantId=${selectedTenantId}`);
                        if (!resUsers.ok) throw new Error('Failed to load users');
                        list = await resUsers.json();
                      }
                      const deduped = Array.isArray(list)
                        ? Array.from(new Map(list.map((u: any) => [u._id, u])).values())
                        : [];
                      setUsers(deduped);
                      if (selectedTenantId) {
                        const resRoles = await fetch(
                          `/api/tenant-roles?tenantId=${selectedTenantId}`
                        );
                        if (resRoles.ok) {
                          const data = await resRoles.json();
                          const map: Record<string, TenantRole | undefined> = {};
                          (data.roles || []).forEach((r: TenantRole) => {
                            map[r.userId] = r;
                          });
                          setRolesMap(map);
                        } else {
                          setRolesMap({});
                        }
                        if (selectedOrganizationId) {
                          const resOrg = await fetch(
                            `/api/organization-roles?tenantId=${selectedTenantId}&organizationId=${selectedOrganizationId}`
                          );
                          if (resOrg.ok) {
                            const data = await resOrg.json();
                            const omap: Record<string, OrgRole | undefined> = {};
                            (data.roles || []).forEach((r: OrgRole) => {
                              omap[r.userId] = r;
                            });
                            setOrgRolesMap(omap);
                          } else {
                            setOrgRolesMap({});
                          }
                        } else {
                          setOrgRolesMap({});
                        }
                      } else {
                        setRolesMap({});
                        setOrgRolesMap({});
                      }
                    } catch (e: any) {
                      setUsersError(e.message);
                    } finally {
                      setUsersLoading(false);
                    }
                  })();
                }}
                title="Refresh users"
                className="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex h-7 w-7 items-center justify-center rounded border"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </h2>
          {(selectedTenantId || isSuperAdmin) && (
            <div className="relative w-full rounded border">
              {selectedTenantId ? (
                <div className="bg-muted/10 flex w-full items-center gap-3 border-b px-3 py-2 text-[11px]">
                  <span className="font-medium">Bulk actions:</span>
                  <div className="flex items-center gap-2">
                    <span className="whitespace-nowrap font-semibold">Tenant Role</span>
                    <BulkRoleSelector
                      disabled={selectedUserIds.size === 0}
                      commonRole={getCommonTenantRole()}
                      onSelect={role =>
                        selectedUserIds.size > 0 &&
                        handleBulkTenantRole(Array.from(selectedUserIds), role)
                      }
                    />
                  </div>
                  {selectedOrganizationId && (
                    <div className="flex items-center gap-2 border-l pl-4">
                      <span className="whitespace-nowrap font-semibold">Organization Role</span>
                      <BulkRoleSelector
                        disabled={selectedUserIds.size === 0}
                        commonRole={getCommonOrgRole()}
                        onSelect={role =>
                          selectedUserIds.size > 0 &&
                          handleBulkOrgRole(Array.from(selectedUserIds), role)
                        }
                      />
                    </div>
                  )}
                  <div className="text-muted-foreground ml-auto flex items-center gap-2 whitespace-nowrap">
                    <span>{selectedUserIds.size} selected</span>
                    <button
                      type="button"
                      disabled={selectedUserIds.size === 0}
                      onClick={beginBulkDelete}
                      className="inline-flex h-6 items-center gap-1 rounded border border-transparent px-2 text-red-600 hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Delete selected users"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Delete</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-muted/10 flex w-full items-center gap-2 border-b px-3 py-2 text-[11px]">
                  <span className="text-muted-foreground">
                    Global view (roles disabled until tenant selected)
                  </span>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full border-0 text-sm" style={{ tableLayout: 'fixed', minWidth: '1100px' }}>
                    <colgroup>
                    <col style={{ width: '32px' }} />
                    <col style={{ width: '180px' }} />
                    <col style={{ width: '220px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '140px' }} />
                    {selectedOrganizationId && <col style={{ width: '140px' }} />}
                    <col style={{ width: '48px' }} />
                    </colgroup>
                    <thead>
                    <tr className="bg-muted/30 text-left text-xs uppercase tracking-wide">
                      <th className="w-[28px] min-w-[28px] max-w-[28px] p-0 text-center align-middle">
                      <input
                        type="checkbox"
                        checked={allUsersSelected}
                        ref={el => {
                        if (el) el.indeterminate = anyUsersSelected;
                        }}
                        onChange={e => {
                        if (e.target.checked)
                          setSelectedUserIds(new Set(users.map(u => u._id)));
                        else clearUserSelection();
                        }}
                        disabled={!selectedTenantId && !isSuperAdmin}
                        title={
                        !selectedTenantId && !isSuperAdmin
                          ? 'Select a tenant to enable selection'
                          : undefined
                        }
                      />
                      </th>
                      <SortableUserHeader
                      label="Name"
                      active={userSortKey === 'name'}
                      dir={userSortDir}
                      onClick={() => handleUserSort('name')}
                      className="px-2 py-2"
                      />
                      <SortableUserHeader
                      label="Email"
                      active={userSortKey === 'email'}
                      dir={userSortDir}
                      onClick={() => handleUserSort('email')}
                      className="px-2 py-2"
                      />
                      <th
                      className="text-muted-foreground whitespace-nowrap px-1 py-2 text-[10px] font-medium uppercase tracking-wide"
                      title="Email verification status"
                      >
                      Verified
                      </th>
                      <SortableUserHeader
                      label="Tenant Role"
                      active={userSortKey === 'tenantRole'}
                      dir={userSortDir}
                      onClick={() => handleUserSort('tenantRole')}
                      className="w-[140px] whitespace-nowrap py-2 pl-1 pr-0"
                      />
                      {selectedOrganizationId && (
                      <SortableUserHeader
                        label="Org Role"
                        active={userSortKey === 'orgRole'}
                        dir={userSortDir}
                        onClick={() => handleUserSort('orgRole')}
                        className="w-[140px] whitespace-nowrap py-2 pl-0 pr-2"
                      />
                      )}
                      <th className="text-muted-foreground px-1 py-2 text-right text-[10px] font-medium uppercase tracking-wide">
                      Del
                      </th>
                    </tr>
                    </thead>
                    <tbody>
                    {usersLoading &&
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr
                          key={`skeleton-${i}`}
                          className="border-border/40 animate-pulse border-t"
                        >
                          <td className="w-[28px] p-0" />
                          <td className="px-2 py-2">
                            <div className="bg-muted h-3 w-24 rounded" />
                          </td>
                          <td className="px-2 py-2">
                            <div className="bg-muted h-3 w-32 rounded" />
                          </td>
                          <td className="px-1 py-2">
                            <div className="bg-muted mx-auto h-2.5 w-2.5 rounded-full" />
                          </td>
                          <td className="py-2 pl-1 pr-0">
                            <div className="bg-muted h-3 w-14 rounded" />
                          </td>
                          {selectedOrganizationId && (
                            <td className="py-2 pl-0 pr-2">
                              <div className="bg-muted h-3 w-12 rounded" />
                            </td>
                          )}
                          <td className="px-1 py-2" />
                        </tr>
                      ))}
                    {!usersLoading &&
                      sortedUsers.map(u => (
                        <tr key={u._id} className="border-border/60 hover:bg-accent/30 border-t">
                          <td className="w-[28px] min-w-[28px] max-w-[28px] p-0 text-center align-middle">
                            <input
                              type="checkbox"
                              checked={selectedUserIds.has(u._id)}
                              onChange={() => toggleUserSelect(u._id)}
                              disabled={!selectedTenantId && !isSuperAdmin}
                              title={
                                !selectedTenantId && !isSuperAdmin
                                  ? 'Select a tenant to enable selection'
                                  : undefined
                              }
                            />
                          </td>
                          <td className="px-2 py-2 pr-2">
                            {u.name ||
                              (u._id === session?.user?.id ? (session.user as any)?.name : '') ||
                              '—'}
                          </td>
                          <td className="text-muted-foreground px-2 py-2 pr-2">
                            {u.email ||
                              (u._id === session?.user?.id ? (session.user as any)?.email : '') ||
                              '—'}
                          </td>
                          <td className="w-[70px] px-1 py-2 text-center">
                            {u.emailVerified ? (
                              <span
                                title={
                                  typeof u.emailVerified === 'string'
                                    ? `Verified: ${u.emailVerified}`
                                    : 'Email verified'
                                }
                              >
                                <Check className="inline-block h-4 w-4 text-green-600" />
                              </span>
                            ) : (
                              <span title="Email not verified">
                                <Ban className="inline-block h-4 w-4 text-red-600" />
                              </span>
                            )}
                          </td>
                          <td className="w-[140px] py-2 pl-1 pr-0">
                            {selectedTenantId ? (
                              <InlineRoleEditor
                                currentRole={rolesMap[u._id]?.role}
                                onChange={r => changeTenantRole(u._id, r)}
                              />
                            ) : (
                              <span className="text-muted-foreground text-[10px]">—</span>
                            )}
                          </td>
                          {selectedOrganizationId && (
                            <td className="w-[140px] py-2 pl-0 pr-2">
                              {selectedTenantId ? (
                                <InlineRoleEditor
                                  currentRole={orgRolesMap[u._id]?.role}
                                  onChange={r => changeOrgRole(u._id, r)}
                                />
                              ) : (
                                <span className="text-muted-foreground text-[10px]">—</span>
                              )}
                            </td>
                          )}
                          <td className="px-1 py-2 text-right">
                            {(selectedTenantId || isSuperAdmin) && (
                              <button
                                onClick={() => beginDeleteUser(u._id)}
                                className="inline-flex h-6 w-6 items-center justify-center rounded border border-transparent text-red-600 hover:border-red-200 hover:bg-red-50"
                                title="Delete user"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    {!usersLoading && users.length === 0 && (
                      <tr>
                        <td
                          className="text-muted-foreground px-2 py-3 text-center"
                          colSpan={selectedOrganizationId ? 7 : 6}
                        >
                          No users
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {(selectedTenantId || isSuperAdmin) && (
                    <tfoot>
                      <tr className="bg-muted/20 border-t">
                        <td colSpan={selectedOrganizationId ? 6 : 5} className="p-0">
                          <div className="flex items-start gap-3 px-3 py-2 text-[11px]">
                            {!newUserOpen && (
                              <button
                                type="button"
                                className="hover:bg-accent rounded border px-2 py-1 text-[11px]"
                                onClick={() => {
                                  setNewUserOpen(true);
                                  setNewUserError(undefined);
                                }}
                              >
                                + Add User
                              </button>
                            )}
                            {newUserOpen && (
                              <div className="flex w-full flex-col gap-2">
                                {selectedTenantId ? (
                                  <AddTenantUserForm
                                    tenantId={selectedTenantId}
                                    defaultEmail={newUserEmail || prefillInviteEmail}
                                    onSuccess={() => {
                                      // auto refresh users & roles
                                      (async () => {
                                        if (!selectedTenantId) return; // safety
                                        setUsersLoading(true);
                                        setUsersError(undefined);
                                        try {
                                          const resUsers = await fetch(
                                            `/api/users?tenantId=${selectedTenantId}`
                                          );
                                          if (resUsers.ok) {
                                            const list = await resUsers.json();
                                            const deduped = Array.isArray(list)
                                              ? Array.from(
                                                  new Map(list.map((u: any) => [u._id, u])).values()
                                                )
                                              : [];
                                            setUsers(deduped);
                                          }
                                          const resRoles = await fetch(
                                            `/api/tenant-roles?tenantId=${selectedTenantId}`
                                          );
                                          if (resRoles.ok) {
                                            const data = await resRoles.json();
                                            const map: Record<string, TenantRole | undefined> = {};
                                            (data.roles || []).forEach((r: TenantRole) => {
                                              map[r.userId] = r;
                                            });
                                            setRolesMap(map);
                                          }
                                        } catch (e: any) {
                                          setUsersError(e.message);
                                        } finally {
                                          setUsersLoading(false);
                                        }
                                      })();
                                    }}
                                  />
                                ) : (
                                  <div className="text-muted-foreground text-[11px]">
                                    Select a tenant to send an invitation (global creation without
                                    tenant disabled here).
                                  </div>
                                )}
                                <div>
                                  <button
                                    type="button"
                                    className="hover:bg-accent rounded border px-2 py-1 text-[11px]"
                                    onClick={() => {
                                      setNewUserOpen(false);
                                    }}
                                  >
                                    Close
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
          {!selectedTenantId && !isSuperAdmin && (
            <div className="text-muted-foreground text-xs">Select a tenant to see users.</div>
          )}
          {/* Bulk action helper text removed for read-only view */}
        </div>
      </div>
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={o => {
          if (!o) cancelDeleteUser();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">
              Delete user {deleteTargetUser?.name || deleteTargetUser?.email || deleteTargetUserId}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            {deleteTargetIsOwner && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 font-medium text-amber-800">
                This user currently has an OWNER role. You must transfer or demote all OWNER roles
                before deleting.
              </div>
            )}
            <p>
              You are about to permanently delete this user account. This will immediately revoke
              access.
            </p>
            <label className="flex items-start gap-2 text-[11px]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={deleteIncludeData}
                onChange={e => setDeleteIncludeData(e.target.checked)}
                disabled={deleteSubmitting}
              />
              <span>
                Also permanently delete ALL associated user data (tools, assistants, themes,
                feedback, dynamic content, role records). This is irreversible.
              </span>
            </label>
            {deleteIncludeData && (
              <div className="rounded border border-red-300 bg-red-50 p-2 text-[11px] text-red-700">
                Full data purge selected. This cannot be undone.
              </div>
            )}
          </div>
          <DialogFooter className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={cancelDeleteUser}
              className="hover:bg-accent rounded border px-3 py-1.5 text-[12px] disabled:opacity-50"
              disabled={deleteSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDeleteUser}
              disabled={deleteSubmitting || deleteTargetIsOwner}
              className="rounded bg-red-600 px-3 py-1.5 text-[12px] text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleteSubmitting
                ? 'Deleting...'
                : deleteTargetIsOwner
                  ? 'Owner'
                  : deleteIncludeData
                    ? 'Delete & Purge'
                    : 'Delete'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={bulkDeleteDialogOpen}
        onOpenChange={o => {
          if (!o) cancelBulkDelete();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">
              Delete {selectedUserIds.size} selected user{selectedUserIds.size === 1 ? '' : 's'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <p>This will permanently remove the selected user accounts. This cannot be undone.</p>
            <label className="flex items-start gap-2 text-[11px]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={bulkDeleteIncludeData}
                onChange={e => setBulkDeleteIncludeData(e.target.checked)}
                disabled={bulkDeleteSubmitting}
              />
              <span>Also purge ALL associated user data for each user (irreversible).</span>
            </label>
            {bulkDeleteIncludeData && (
              <div className="rounded border border-red-300 bg-red-50 p-2 text-[11px] text-red-700">
                Full data purge selected for all users. This cannot be undone.
              </div>
            )}
          </div>
          <DialogFooter className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={cancelBulkDelete}
              className="hover:bg-accent rounded border px-3 py-1.5 text-[12px] disabled:opacity-50"
              disabled={bulkDeleteSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmBulkDelete}
              disabled={bulkDeleteSubmitting}
              className="rounded bg-red-600 px-3 py-1.5 text-[12px] text-white hover:bg-red-700 disabled:opacity-50"
            >
              {bulkDeleteSubmitting
                ? 'Deleting...'
                : bulkDeleteIncludeData
                  ? 'Delete & Purge'
                  : 'Delete'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Tenant delete confirmation dialog */}
      <Dialog
        open={deleteTenantDialogOpen}
        onOpenChange={o => {
          if (!o && !deleteTenantSubmitting) {
            setDeleteTenantDialogOpen(false);
            setDeleteTenantTargetId(null);
            setDeleteTenantIncludeData(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">
              Delete tenant {deleteTenantTargetId}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <p>
              You are about to permanently delete this tenant. This operation is restricted and
              cannot be undone.
            </p>
            <label className="flex items-start gap-2 text-[11px]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={deleteTenantIncludeData}
                onChange={e => setDeleteTenantIncludeData(e.target.checked)}
                disabled={deleteTenantSubmitting}
              />
              <span>
                Also permanently delete ALL associated records where this tenantId is the parent_id
                (assistants, themes, feedback, dynamic content, roles, organizations). This is
                irreversible.
              </span>
            </label>
            {deleteTenantIncludeData && (
              <div className="rounded border border-red-300 bg-red-50 p-2 text-[11px] text-red-700">
                Full data purge selected. This cannot be undone.
              </div>
            )}
          </div>
          <DialogFooter className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                if (!deleteTenantSubmitting) {
                  setDeleteTenantDialogOpen(false);
                  setDeleteTenantTargetId(null);
                  setDeleteTenantIncludeData(false);
                }
              }}
              className="hover:bg-accent rounded border px-3 py-1.5 text-[12px] disabled:opacity-50"
              disabled={deleteTenantSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!deleteTenantTargetId) return;
                setDeleteTenantSubmitting(true);
                const id = deleteTenantTargetId;
                try {
                  const res = await fetch(`/api/tenants/${id}/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ purgeAll: deleteTenantIncludeData }),
                  });
                  if (!res.ok) throw new Error(await res.text());
                  const data = await res.json();
                  // Remove from local list
                  setTenants(prev => prev.filter(x => x._id !== id));
                  if (selectedTenantId === id) setSelectedTenantId(undefined);
                  toast({
                    title: 'Tenant deleted',
                    description: data?.purged ? 'All associated records purged' : 'Basic delete',
                  });
                  setDeleteTenantDialogOpen(false);
                  setDeleteTenantTargetId(null);
                  setDeleteTenantIncludeData(false);
                } catch (e: any) {
                  toast({
                    title: 'Delete failed',
                    description: e.message || 'Unknown error',
                    variant: 'destructive',
                  });
                } finally {
                  setDeleteTenantSubmitting(false);
                }
              }}
              className="rounded bg-red-600 px-3 py-1.5 text-[12px] text-white hover:bg-red-700 disabled:opacity-50"
              disabled={deleteTenantSubmitting}
            >
              {deleteTenantSubmitting
                ? 'Deleting...'
                : deleteTenantIncludeData
                  ? 'Delete & Purge'
                  : 'Delete'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Blocked Deletion Modal */}
      <Dialog open={blockedModalOpen} onOpenChange={setBlockedModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Ban className="h-4 w-4 text-red-500" />
              Deletion Blocked
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-xs">
            <p>
              This user cannot be deleted because they are the <strong>OWNER</strong> of the following:
            </p>
            
            {blockedData?.blockingTenants && blockedData.blockingTenants.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Tenants</h4>
                <div className="flex flex-wrap gap-2">
                  {blockedData.blockingTenants.map(t => (
                    <div key={t.id} className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1">
                      <span className="font-medium">{t.name}</span>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(t.id);
                          toast({ title: 'Copied ID', description: t.id });
                        }}
                        title="Copy ID"
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded bg-background border px-1.5 py-0.5 text-[10px] font-mono"
                      >
                        {t.id.slice(0,8)}... <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {blockedData?.blockingOrgs && blockedData.blockingOrgs.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Organizations</h4>
                <div className="flex flex-wrap gap-2">
                  {blockedData.blockingOrgs.map(o => (
                    <div key={o.id} className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1">
                      <span className="font-medium">{o.name}</span>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(o.id);
                          toast({ title: 'Copied ID', description: o.id });
                        }}
                        title="Copy ID"
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded bg-background border px-1.5 py-0.5 text-[10px] font-mono"
                      >
                        {o.id.slice(0,8)}... <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-muted-foreground">
              You must transfer ownership or demote this user in these contexts before deletion can proceed.
            </p>
          </div>
          <DialogFooter>
            <button
              onClick={() => setBlockedModalOpen(false)}
              className="rounded bg-primary px-4 py-2 text-xs text-primary-foreground hover:bg-primary/90"
            >
              OK
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Delete confirmation dialog UI (mounted within component tree via portal styles of Dialog provider if any)
// NOTE: Placed outside main component return above for clarity after refactor.
// (If the project's Dialog implementation expects children within root component tree, consider moving inside.)

// Reusable inline role editor (simplified)
// Reuse existing roleChoices from earlier scope if declared; if not, declare once.
// (If already defined above, this will be ignored at runtime after bundling.)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const roleChoicesLocal = ['owner', 'admin', 'member', 'viewer'];
const InlineRoleEditor: React.FC<{
  currentRole?: string;
  onChange: (r: string | null) => void;
}> = ({ currentRole, onChange }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="hover:bg-accent/60 rounded border px-1 py-0.5 text-xs"
      >
        <RoleBadge role={currentRole} />
      </button>
      {open && (
        <div className="bg-popover absolute left-0 top-full z-20 mt-1 flex min-w-[120px] flex-col gap-1 rounded border p-2 shadow">
          <button
            className="hover:bg-accent rounded border px-2 py-1 text-[10px]"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            No Role
          </button>
          {roleChoices.map(r => (
            <button
              key={r}
              className={`hover:bg-accent rounded border px-2 py-1 text-[10px] ${r === currentRole ? 'bg-accent' : ''}`}
              onClick={() => {
                onChange(r);
                setOpen(false);
              }}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// Bulk operations (mirrors users page implementation) ---------------------------------
const roleChoices = ['owner', 'admin', 'member', 'viewer'];
// Determine common role among selected users (tenant)
function computeCommonRole<T extends { role: string } | undefined>(
  entries: (T | undefined)[]
): string | null {
  if (entries.length === 0) return null;
  const roles = entries.map(e => e?.role).filter(Boolean) as string[];
  if (roles.length === 0) return null;
  const first = roles[0];
  return roles.every(r => r === first) ? first : null;
}

// These will be defined inside component scope via closures, but helpers here to satisfy usage order.
// Inline popup badge selector: shows current common role (or Mixed / None) and lets user pick a role or clear.
const BulkRoleSelector: React.FC<{
  disabled?: boolean;
  commonRole: string | null;
  onSelect: (role: string | null) => void;
}> = ({ disabled, commonRole, onSelect }) => {
  const [open, setOpen] = React.useState(false);
  const label = commonRole ? commonRole : commonRole === null ? 'Mixed/None' : 'None';
  return (
    <div className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-accent'} ${commonRole === 'owner' ? 'font-semibold' : ''}`}
      >
        {commonRole ? commonRole : 'set role'}
      </button>
      {open && !disabled && (
        <div className="bg-popover absolute z-30 mt-1 flex min-w-[140px] flex-col gap-1 rounded border p-2 shadow">
          <button
            className="hover:bg-accent rounded border px-2 py-1 text-[10px]"
            onClick={() => {
              onSelect(null);
              setOpen(false);
            }}
          >
            No Role
          </button>
          {roleChoices.map(r => (
            <button
              key={r}
              className={`hover:bg-accent rounded border px-2 py-1 text-[10px] ${r === commonRole ? 'bg-accent' : ''}`}
              onClick={() => {
                onSelect(r);
                setOpen(false);
              }}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
const BulkActionBar: React.FC<{
  count: number;
  onApplyTenant: (role: string) => void;
  onRemoveTenant: () => void;
  onApplyOrg?: (role: string) => void;
  onRemoveOrg?: () => void;
}> = ({ count, onApplyTenant, onRemoveTenant, onApplyOrg, onRemoveOrg }) => {
  const [role, setRole] = React.useState('member');
  return (
    <div className="bg-background/95 sticky bottom-2 flex items-center gap-3 rounded border p-3 text-xs shadow backdrop-blur">
      <span className="font-medium">{count} selected</span>
      <select
        className="rounded border px-2 py-1"
        value={role}
        onChange={e => setRole(e.target.value)}
      >
        {(typeof roleChoices !== 'undefined' ? roleChoices : roleChoicesLocal).map(r => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        className="bg-primary text-primary-foreground rounded px-2 py-1"
        onClick={() => onApplyTenant(role)}
      >
        Apply Tenant Role
      </button>
      <button className="rounded border px-2 py-1" onClick={onRemoveTenant}>
        Remove Tenant Role
      </button>
      {onApplyOrg && (
        <button
          className="bg-secondary text-secondary-foreground rounded px-2 py-1"
          onClick={() => onApplyOrg(role)}
        >
          Apply Org Role
        </button>
      )}
      {onRemoveOrg && (
        <button className="rounded border px-2 py-1" onClick={onRemoveOrg}>
          Remove Org Role
        </button>
      )}
    </div>
  );
};

const SortableUserHeader: React.FC<{
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  className?: string;
}> = ({ label, active, dir, onClick, className }) => (
  <th
    className={(className ? className : 'p-2') + ' cursor-pointer select-none'}
    onClick={onClick}
    role="columnheader"
    aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    tabIndex={0}
    onKeyDown={e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    }}
  >
    <span className="inline-flex items-center gap-1">
      {label}
      {active && (
        <span className="text-[10px]" aria-hidden>
          {dir === 'asc' ? '▲' : '▼'}
        </span>
      )}
    </span>
  </th>
);
