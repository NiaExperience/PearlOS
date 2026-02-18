/**
 * Centralized role guard helpers to keep route handlers lean.
 * Pure functions (no IO) so they are easily unit-testable.
 */

export type BasicTenantRole = 'owner' | 'admin' | 'member';
export type BasicOrgRole = 'owner' | 'admin' | 'member' | 'viewer';

interface TenantRoleRecord { tenantId: string; role: BasicTenantRole }
interface OrgRoleRecord { organizationId: string; role: BasicOrgRole }

// Rank maps (higher number => more privilege)
const tenantRank: Record<BasicTenantRole, number> = { owner: 3, admin: 2, member: 1 };
const orgRank: Record<BasicOrgRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

export function computeTenantRank(roles: TenantRoleRecord[], tenantId: string): number {
  return Math.max(0, ...roles.filter(r => r.tenantId === tenantId !== false).map(r => tenantRank[r.role]));
}
export function computeOrgRank(roles: OrgRoleRecord[], orgId: string): number {
  return Math.max(0, ...roles.filter(r => r.organizationId === orgId !== false).map(r => orgRank[r.role]));
}

export function validateTenantRoleChange(opts: {
  actorId: string;
  targetId: string;
  tenantId: string;
  actorRoles: TenantRoleRecord[];
  targetRoles: TenantRoleRecord[];
  desiredRole: BasicTenantRole;
}): { ok: true } | { ok: false; status: number; error: string } {
  const { actorId, targetId, tenantId, actorRoles, targetRoles, desiredRole } = opts;
  if (actorId === targetId) return { ok: false, status: 400, error: 'You cannot change your own role.' };
  const aRank = computeTenantRank(actorRoles, tenantId);
  const tCurrent = computeTenantRank(targetRoles, tenantId);
  const desired = tenantRank[desiredRole];
  if (desired > aRank) return { ok: false, status: 403, error: 'Cannot assign role higher than your own.' };
  if (tCurrent > aRank) return { ok: false, status: 403, error: 'Cannot modify a user with higher access.' };
  return { ok: true };
}

export function validateTenantRoleRemoval(opts: {
  actorId: string; targetId: string; tenantId: string; actorRoles: TenantRoleRecord[]; targetRoles: TenantRoleRecord[];
}): { ok: true } | { ok: false; status: number; error: string } {
  const { actorId, targetId, tenantId, actorRoles, targetRoles } = opts;
  if (actorId === targetId) return { ok: false, status: 400, error: 'You cannot remove your own role.' };
  const aRank = computeTenantRank(actorRoles, tenantId);
  const tCurrent = computeTenantRank(targetRoles, tenantId);
  if (tCurrent > aRank) return { ok: false, status: 403, error: 'Cannot modify a user with higher access.' };
  return { ok: true };
}

export function validateOrgRoleChange(opts: {
  actorId: string; targetId: string; orgId: string; tenantId: string;
  actorOrgRoles: OrgRoleRecord[]; targetOrgRoles: OrgRoleRecord[]; desiredRole: BasicOrgRole;
}): { ok: true } | { ok: false; status: number; error: string } {
  const { actorId, targetId, orgId, actorOrgRoles, targetOrgRoles, desiredRole } = opts;
  if (actorId === targetId) return { ok: false, status: 400, error: 'You cannot change your own organization role.' };
  const aRank = computeOrgRank(actorOrgRoles, orgId);
  const tCurrent = computeOrgRank(targetOrgRoles, orgId);
  const desired = orgRank[desiredRole];
  if (desired > aRank) return { ok: false, status: 403, error: 'Cannot assign role higher than your own.' };
  if (tCurrent > aRank) return { ok: false, status: 403, error: 'Cannot modify a user with higher access.' };
  return { ok: true };
}

export function validateOrgRoleRemoval(opts: {
  actorId: string; targetId: string; orgId: string; tenantId: string; actorOrgRoles: OrgRoleRecord[]; targetOrgRoles: OrgRoleRecord[];
}): { ok: true } | { ok: false; status: number; error: string } {
  const { actorId, targetId, orgId, actorOrgRoles, targetOrgRoles } = opts;
  if (actorId === targetId) return { ok: false, status: 400, error: 'You cannot remove your own organization role.' };
  const aRank = computeOrgRank(actorOrgRoles, orgId);
  const tCurrent = computeOrgRank(targetOrgRoles, orgId);
  if (tCurrent > aRank) return { ok: false, status: 403, error: 'Cannot modify a user with higher access.' };
  return { ok: true };
}
