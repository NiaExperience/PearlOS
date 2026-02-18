/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  computeTenantRank,
  computeOrgRank,
  validateTenantRoleChange,
  validateTenantRoleRemoval,
  validateOrgRoleChange,
  validateOrgRoleRemoval,
} from '../src/core/security/role-guards';

describe('role-guards tenant rank', () => {
  test('computeTenantRank returns 0 when none', () => {
    expect(computeTenantRank([], 'T1')).toBe(0);
  });
  test('computeTenantRank picks highest active', () => {
    const roles = [
      { tenantId: 'T1', role: 'member'},
      { tenantId: 'T1', role: 'admin'},
    ];
    expect(computeTenantRank(roles as any, 'T1')).toBe(2); // admin
  });
});

describe('role-guards org rank', () => {
  test('computeOrgRank returns highest', () => {
    const roles = [
      { organizationId: 'O1', role: 'viewer' },
      { organizationId: 'O1', role: 'member' },
    ];
    expect(computeOrgRank(roles as any, 'O1')).toBe(2);
  });
});

describe('tenant role change validation', () => {
  const tenantId = 'T1';
  test('self change blocked', () => {
    const res = validateTenantRoleChange({
      actorId: 'U1', targetId: 'U1', tenantId, desiredRole: 'admin', actorRoles: [], targetRoles: [],
    } as any);
    expect(res.ok).toBeFalsy();
    if (!res.ok) expect(res.status).toBe(400);
  });
  test('cannot assign higher than actor', () => {
    const res = validateTenantRoleChange({
      actorId: 'A', targetId: 'B', tenantId,
      actorRoles: [{ tenantId, role: 'member' }],
      targetRoles: [],
      desiredRole: 'admin',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });
  test('cannot modify higher target', () => {
    const res = validateTenantRoleChange({
      actorId: 'A', targetId: 'B', tenantId,
      actorRoles: [{ tenantId, role: 'admin' }],
      targetRoles: [{ tenantId, role: 'owner' }],
      desiredRole: 'member',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });
  test('success path', () => {
    const res = validateTenantRoleChange({
      actorId: 'A', targetId: 'B', tenantId,
      actorRoles: [{ tenantId, role: 'owner' }],
      targetRoles: [{ tenantId, role: 'member'}],
      desiredRole: 'admin',
    });
    expect(res.ok).toBe(true);
  });
});

describe('tenant role removal validation', () => {
  const tenantId = 'T1';
  test('self removal blocked', () => {
    const res = validateTenantRoleRemoval({ actorId: 'U1', targetId: 'U1', tenantId, actorRoles: [], targetRoles: [] } as any);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });
  test('cannot remove higher target', () => {
    const res = validateTenantRoleRemoval({
      actorId: 'A', targetId: 'B', tenantId,
      actorRoles: [{ tenantId, role: 'admin' }],
      targetRoles: [{ tenantId, role: 'owner' }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });
  test('removal allowed', () => {
    const res = validateTenantRoleRemoval({
      actorId: 'A', targetId: 'B', tenantId,
      actorRoles: [{ tenantId, role: 'owner' }],
      targetRoles: [{ tenantId, role: 'admin' }],
    });
    expect(res.ok).toBe(true);
  });
});

describe('org role change validation', () => {
  const tenantId = 'T1';
  const orgId = 'O1';
  test('self change blocked', () => {
    const res = validateOrgRoleChange({
      actorId: 'U1', targetId: 'U1', tenantId, orgId,
      actorOrgRoles: [], targetOrgRoles: [], desiredRole: 'member'
    } as any);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });
  test('cannot assign higher than actor', () => {
    const res = validateOrgRoleChange({
      actorId: 'A', targetId: 'B', tenantId, orgId,
      actorOrgRoles: [{ organizationId: orgId, role: 'member' }],
      targetOrgRoles: [], desiredRole: 'admin'
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });
  test('cannot modify higher target', () => {
    const res = validateOrgRoleChange({
      actorId: 'A', targetId: 'B', tenantId, orgId,
      actorOrgRoles: [{ organizationId: orgId, role: 'admin' }],
      targetOrgRoles: [{ organizationId: orgId, role: 'owner' }],
      desiredRole: 'viewer'
    });
    expect(res.ok).toBe(false);
  });
  test('success path', () => {
    const res = validateOrgRoleChange({
      actorId: 'A', targetId: 'B', tenantId, orgId,
      actorOrgRoles: [{ organizationId: orgId, role: 'owner' }],
      targetOrgRoles: [{ organizationId: orgId, role: 'member' }],
      desiredRole: 'admin'
    });
    expect(res.ok).toBe(true);
  });
});

describe('org role removal validation', () => {
  const tenantId = 'T1';
  const orgId = 'O1';
  test('self removal blocked', () => {
    const res = validateOrgRoleRemoval({ actorId: 'U1', targetId: 'U1', tenantId, orgId, actorOrgRoles: [], targetOrgRoles: [] } as any);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });
  test('cannot remove higher target', () => {
    const res = validateOrgRoleRemoval({
      actorId: 'A', targetId: 'B', tenantId, orgId,
      actorOrgRoles: [{ organizationId: orgId, role: 'admin' }],
      targetOrgRoles: [{ organizationId: orgId, role: 'owner' }],
    });
    expect(res.ok).toBe(false);
  });
  test('removal allowed', () => {
    const res = validateOrgRoleRemoval({
      actorId: 'A', targetId: 'B', tenantId, orgId,
      actorOrgRoles: [{ organizationId: orgId, role: 'owner' }],
      targetOrgRoles: [{ organizationId: orgId, role: 'admin' }],
    });
    expect(res.ok).toBe(true);
  });
});
