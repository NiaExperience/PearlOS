import fs from 'fs';
import os from 'os';
import path from 'path';

function actor(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    userEmail: 'sam@example.com',
    userName: 'Sam',
    tenantId: 'tenant-a',
    tenantRole: 'member',
    authSource: 'next-auth-session',
    actorType: 'user',
    ...overrides,
  } as any;
}

function loadWorkspaceEntitlements(config: Record<string, unknown> = {}) {
  jest.resetModules();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-entitlements-'));
  const configPath = path.join(root, 'workspace-entitlements.json');
  fs.writeFileSync(configPath, JSON.stringify({ stagingSourceEditsEnabled: false, ...config }));
  process.env.PEARL_PUBLIC_TASK_ROOT = path.join(root, 'workspaces');
  process.env.PEARLOS_WORKSPACE_ENTITLEMENTS_CONFIG = configPath;
  process.env.PEARLOS_STAGING_SOURCE_TOGGLE_AVAILABLE = '1';
  process.env.PEARLOS_BLAIR_USER_IDS = 'blair-id';
  process.env.PEARLOS_BLAIR_EMAILS = 'blair@example.com';
  delete process.env.PEARLOS_ADVANCED_WORKSPACE_USER_IDS;
  delete process.env.PEARLOS_ADVANCED_WORKSPACE_EMAILS;
  return {
    root,
    configPath,
    module: require('../workspace-entitlements') as typeof import('../workspace-entitlements'),
  };
}

describe('workspace entitlements', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('routes normal users to sandbox workspace mode', async () => {
    const { module } = loadWorkspaceEntitlements();

    const resolved = await module.resolveWorkspaceForActor(actor(), {
      taskId: 'task-1',
      purpose: 'task',
    });

    expect(resolved.mode).toBe('sandbox');
    expect(resolved.workspacePath).toBeUndefined();
    expect(resolved.canUseForkWorkspaces).toBe(false);
    expect(resolved.canUseStagingSourceEdits).toBe(false);
    expect(resolved.isolationNotice).toContain("Pearl changes only the requester's PearlOS instance");
  });

  it('rejects spoofed staging source paths for normal users', async () => {
    const { module } = loadWorkspaceEntitlements();

    await expect(module.resolveWorkspaceForActor(actor(), {
      requestedPath: '/workspace/nia-universal',
      purpose: 'task',
    })).rejects.toMatchObject({ code: 'personal_instance_only', status: 403 });
  });

  it('rejects Blair staging source requests for user-facing Agency tasks', async () => {
    const { module } = loadWorkspaceEntitlements({ stagingSourceEditsEnabled: false });

    await expect(module.resolveWorkspaceForActor(actor({
      userId: 'blair-id',
      userEmail: 'blair@example.com',
    }), {
      requestedMode: 'staging_source',
      purpose: 'task',
    })).rejects.toMatchObject({ code: 'personal_instance_only', status: 403 });
  });

  it('rejects Blair staging source subpaths for user-facing Agency tasks', async () => {
    const { module } = loadWorkspaceEntitlements({ stagingSourceEditsEnabled: true });

    await expect(module.resolveWorkspaceForActor(actor({
      userId: 'blair-id',
      userEmail: 'blair@example.com',
    }), {
      requestedMode: 'staging_source',
      requestedPath: '/workspace/nia-universal/apps/interface',
      purpose: 'task',
    })).rejects.toMatchObject({ code: 'personal_instance_only', status: 403 });
  });

  it('does not allow Blair staging source requests for terminal sessions', async () => {
    const { module } = loadWorkspaceEntitlements({ stagingSourceEditsEnabled: true });

    await expect(module.resolveWorkspaceForActor(actor({
      userId: 'blair-id',
      userEmail: 'blair@example.com',
    }), {
      requestedMode: 'staging_source',
      purpose: 'terminal',
    })).rejects.toMatchObject({ code: 'personal_instance_only', status: 403 });
  });

  it('never exposes staging source edit entitlement to the app', async () => {
    const { module } = loadWorkspaceEntitlements({ stagingSourceEditsEnabled: true });

    const entitlements = await module.workspaceEntitlementsForActor(actor({
      userId: 'blair-id',
      userEmail: 'blair@example.com',
    }));

    expect(entitlements.isBlair).toBe(true);
    expect(entitlements.stagingSourceToggleAvailable).toBe(false);
    expect(entitlements.canUseStagingSourceEdits).toBe(false);
    expect(entitlements.stagingSourceEditsEnabled).toBe(true);
  });

  it('routes advanced users to scoped GitHub fork workspaces', async () => {
    const { module, root } = loadWorkspaceEntitlements();

    const resolved = await module.resolveWorkspaceForActor(actor({
      userId: 'admin-id',
      tenantRole: 'admin',
    }), {
      requestedMode: 'github_fork',
      githubForkUrl: 'https://github.com/blair/pearlos-fork.git',
      taskId: 'task-1',
      purpose: 'task',
    });

    expect(resolved.mode).toBe('github_fork');
    expect(resolved.githubForkUrl).toBe('https://github.com/blair/pearlos-fork.git');
    expect(resolved.workspacePath).toBe(path.join(
      root,
      'workspaces',
      'tenant-a',
      'admin-id',
      'forks',
      'blair_pearlos-fork',
    ));
  });
});
