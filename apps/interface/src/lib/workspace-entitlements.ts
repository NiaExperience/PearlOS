import { access, mkdir, readFile, realpath, writeFile } from 'fs/promises';
import { hostname } from 'os';
import path from 'path';

import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';

import type { InterfaceActorContext } from '@interface/lib/tenant-actor';

export type WorkspaceMode = 'sandbox' | 'github_fork' | 'staging_source' | 'operator_staging_source';

export type WorkspaceEntitlementsConfig = {
  stagingSourceEditsEnabled: boolean;
  updatedAt?: string;
  updatedBy?: string;
};

export type WorkspaceResolution = {
  mode: WorkspaceMode;
  workspacePath?: string;
  githubForkUrl?: string;
  isBlair: boolean;
  canUseForkWorkspaces: boolean;
  canUseStagingSourceEdits: boolean;
  stagingSourceEditsEnabled: boolean;
  stagingSourceToggleAvailable: boolean;
  operatorStagingSourceAvailable: boolean;
  isolationNotice?: string;
};

export class WorkspaceEntitlementError extends Error {
  status: number;
  code: string;

  constructor(code: string, status = 403) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export const PERSONAL_INSTANCE_WORKSPACE_MESSAGE =
  "Pearl changes only the requester's PearlOS instance. Core PearlOS integration is managed separately.";

const STAGING_SOURCE_ROOT = process.env.PEARLOS_STAGING_SOURCE_ROOT || '/workspace/nia-universal';
const DEFAULT_CONFIG_PATHS = [
  '/workspace/nia-universal/config/workspace-entitlements.json',
  '/home/deploy/pearlos/config/workspace-entitlements.json',
];
const DEFAULT_BLAIR_USER_IDS = [
  '00000000-0000-0000-0003-000000000020',
  '00000000-0000-0000-0003-000000000011',
];
const DEFAULT_BLAIR_EMAILS = ['blair@niaxp.com', 'blairerickson@gmail.com'];
const BLAIR_OPERATOR_EMAIL = 'blairerickson@gmail.com';

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanEmail(value: unknown): string {
  return cleanString(value).toLowerCase();
}

function envList(name: string, defaults: string[] = []): string[] {
  const configured = (process.env[name] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set([...configured, ...defaults].map((value) => value.toLowerCase())));
}

function configPaths(): string[] {
  const configured = [
    process.env.PEARLOS_WORKSPACE_ENTITLEMENTS_CONFIG || '',
    ...(process.env.PEARLOS_WORKSPACE_ENTITLEMENTS_CONFIG_PATHS || '').split(':'),
    ...DEFAULT_CONFIG_PATHS,
  ];
  return Array.from(new Set(configured.map((item) => item.trim()).filter(Boolean)));
}

function writeConfigPaths(): string[] {
  const configured = [
    process.env.PEARLOS_WORKSPACE_ENTITLEMENTS_CONFIG || '',
    ...(process.env.PEARLOS_WORKSPACE_ENTITLEMENTS_WRITE_PATHS || '').split(':'),
    '/workspace/nia-universal/config/workspace-entitlements.json',
  ];
  return Array.from(new Set(configured.map((item) => item.trim()).filter(Boolean)));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function safePathComponent(value: unknown, fallback = 'unknown'): string {
  const raw = String(value || '').trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9._@+-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '');
  return (safe || fallback).slice(0, 160);
}

function publicTaskRoot(): string {
  return process.env.PEARL_PUBLIC_TASK_ROOT || '/srv/pearl-user-workspaces';
}

function isInside(candidate: string, root: string): boolean {
  const resolved = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

async function existingRealpath(candidate: string): Promise<string | null> {
  try {
    return await realpath(candidate);
  } catch {
    return null;
  }
}

async function assertExistingPathIsScoped(candidate: string, root: string, code: string): Promise<void> {
  const realCandidate = await existingRealpath(candidate);
  if (realCandidate && !isInside(realCandidate, root)) {
    throw new WorkspaceEntitlementError(code);
  }
  if (realCandidate && protectedRuntimePath(realCandidate)) {
    throw new WorkspaceEntitlementError('protected_workspace_forbidden');
  }
}

function isStagingSourcePath(candidate: string): boolean {
  return isInside(candidate, STAGING_SOURCE_ROOT);
}

function protectedRuntimePath(candidate: string): boolean {
  return [
    STAGING_SOURCE_ROOT,
    '/workspace/nia-universal',
    '/home/deploy/pearlos',
    '/opt/pearlos',
    '/root/.openclaw',
  ].some((root) => isInside(candidate, root));
}

function scopedUserWorkspaceRoot(actor: InterfaceActorContext): string {
  return path.join(
    publicTaskRoot(),
    safePathComponent(actor.tenantId, 'public'),
    safePathComponent(actor.userId || actor.userEmail, 'anonymous'),
  );
}

function forkWorkspaceRoot(actor: InterfaceActorContext): string {
  return path.join(scopedUserWorkspaceRoot(actor), 'forks');
}

function forkSlug(url: string | undefined, fallback: string): string {
  const raw = cleanString(url);
  if (!raw) return safePathComponent(fallback, 'fork');
  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname
      .replace(/\.git$/i, '')
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      return safePathComponent(`${parts[parts.length - 2]}_${parts[parts.length - 1]}`, 'fork');
    }
  } catch {
    // Fall through to string cleanup.
  }
  return safePathComponent(raw.replace(/\.git$/i, ''), 'fork');
}

function normalizeMode(value: unknown): WorkspaceMode | null {
  if (
    value === 'sandbox' ||
    value === 'github_fork' ||
    value === 'staging_source' ||
    value === 'operator_staging_source'
  ) {
    return value;
  }
  return null;
}

export function isBlairActor(actor: Pick<InterfaceActorContext, 'userId' | 'userEmail'>): boolean {
  const ids = envList('PEARLOS_BLAIR_USER_IDS', DEFAULT_BLAIR_USER_IDS);
  const emails = envList('PEARLOS_BLAIR_EMAILS', DEFAULT_BLAIR_EMAILS);
  const userId = cleanString(actor.userId).toLowerCase();
  const email = cleanEmail(actor.userEmail);
  return Boolean((userId && ids.includes(userId)) || (email && emails.includes(email)));
}

export function actorCanUseForkWorkspaces(actor: InterfaceActorContext): boolean {
  if (isBlairActor(actor)) return true;
  const userId = cleanString(actor.userId).toLowerCase();
  const email = cleanEmail(actor.userEmail);
  const advancedIds = envList('PEARLOS_ADVANCED_WORKSPACE_USER_IDS');
  const advancedEmails = envList('PEARLOS_ADVANCED_WORKSPACE_EMAILS');
  if ((userId && advancedIds.includes(userId)) || (email && advancedEmails.includes(email))) {
    return true;
  }
  return actor.tenantRole === TenantRole.ADMIN || actor.tenantRole === TenantRole.OWNER;
}

export async function readWorkspaceEntitlementsConfig(): Promise<WorkspaceEntitlementsConfig> {
  for (const filePath of configPaths()) {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<WorkspaceEntitlementsConfig>;
      return {
        stagingSourceEditsEnabled: parsed.stagingSourceEditsEnabled === true,
        updatedAt: cleanString(parsed.updatedAt) || undefined,
        updatedBy: cleanString(parsed.updatedBy) || undefined,
      };
    } catch {
      // Try the next config location.
    }
  }
  return { stagingSourceEditsEnabled: false };
}

export async function writeWorkspaceEntitlementsConfig(
  config: WorkspaceEntitlementsConfig,
): Promise<{ written: string[]; warnings: string[] }> {
  const body = `${JSON.stringify(config, null, 2)}\n`;
  const written: string[] = [];
  const warnings: string[] = [];
  for (const filePath of writeConfigPaths()) {
    const fileAlreadyExists = await pathExists(filePath);
    const dirAlreadyExists = await pathExists(path.dirname(filePath));
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, body, 'utf-8');
      written.push(filePath);
    } catch (error) {
      if (fileAlreadyExists || dirAlreadyExists || filePath === process.env.PEARLOS_WORKSPACE_ENTITLEMENTS_CONFIG) {
        warnings.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (!written.length) {
    throw new Error(`Could not write workspace entitlements config: ${warnings.join('; ') || 'no writable config path'}`);
  }
  return { written, warnings };
}

export function stagingSourceToggleAvailable(): boolean {
  return false;
}

function isBlairOperatorActor(actor: Pick<InterfaceActorContext, 'userEmail'>): boolean {
  return cleanEmail(actor.userEmail) === BLAIR_OPERATOR_EMAIL;
}

function isProductionEvidence(): boolean {
  const values = [
    process.env.PEARLOS_ENV,
    process.env.NEXT_PUBLIC_PEARLOS_ENV,
    process.env.VERCEL_ENV,
    process.env.PEARLOS_HOSTNAME,
    process.env.HOSTNAME,
    process.env.NEXTAUTH_URL,
    process.env.PEARLOS_URL,
    process.env.PUBLIC_URL,
  ].map((value) => cleanString(value).toLowerCase());
  return values.some((value) =>
    value === 'production' ||
    value.includes('pearlos-production') ||
    value.includes('app.pearlos.org')
  );
}

function hasStagingHostEvidence(): boolean {
  const currentHostname = hostname().toLowerCase();
  const configuredHostnames = envList('PEARLOS_STAGING_HOSTNAMES', ['pearl-staging-private-omega']);
  const values = [
    process.env.PEARLOS_ENV,
    process.env.NEXT_PUBLIC_PEARLOS_ENV,
    process.env.VERCEL_ENV,
    process.env.PEARLOS_HOSTNAME,
    process.env.HOSTNAME,
    process.env.NEXTAUTH_URL,
    process.env.PEARLOS_URL,
    process.env.PUBLIC_URL,
    currentHostname,
  ].map((value) => cleanString(value).toLowerCase());

  return values.some((value) =>
    value === 'staging' ||
    value.includes('staging') ||
    configuredHostnames.some((allowed) => value === allowed || value.includes(allowed))
  );
}

export function operatorStagingSourceAvailable(actor: Pick<InterfaceActorContext, 'userEmail'>): boolean {
  return (
    isBlairOperatorActor(actor) &&
    process.env.PEARLOS_ENABLE_BLAIR_STAGING_TERMINAL === '1' &&
    hasStagingHostEvidence() &&
    !isProductionEvidence()
  );
}

export async function workspaceEntitlementsForActor(actor: InterfaceActorContext) {
  const config = await readWorkspaceEntitlementsConfig();
  const isBlair = isBlairActor(actor);
  const operatorAvailable = operatorStagingSourceAvailable(actor);
  const canUseForkWorkspaces = actorCanUseForkWorkspaces(actor);
  return {
    isBlair,
    canUseForkWorkspaces,
    stagingSourceToggleAvailable: false,
    operatorStagingSourceAvailable: operatorAvailable,
    stagingSourceEditsEnabled: config.stagingSourceEditsEnabled,
    canUseStagingSourceEdits: false,
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy,
  };
}

export async function resolveWorkspaceForActor(
  actor: InterfaceActorContext,
  options: {
    requestedMode?: unknown;
    requestedPath?: unknown;
    githubForkUrl?: unknown;
    taskId?: unknown;
    purpose?: 'task' | 'terminal';
  } = {},
): Promise<WorkspaceResolution> {
  const entitlements = await workspaceEntitlementsForActor(actor);
  const requestedPath = cleanString(options.requestedPath);
  const requestedMode = normalizeMode(options.requestedMode);
  const githubForkUrl = cleanString(options.githubForkUrl) || undefined;
  const taskId = cleanString(options.taskId) || 'workspace';
  const scopedRoot = scopedUserWorkspaceRoot(actor);

  const wantsStagingSource =
    requestedMode === 'staging_source' ||
    (requestedPath ? isStagingSourcePath(requestedPath) : false);
  if (requestedMode === 'operator_staging_source') {
    if (options.purpose !== 'terminal' || !entitlements.operatorStagingSourceAvailable) {
      throw new WorkspaceEntitlementError('operator_staging_source_forbidden');
    }
    return {
      mode: 'operator_staging_source',
      workspacePath: STAGING_SOURCE_ROOT,
      ...entitlements,
      canUseStagingSourceEdits: true,
    };
  }

  if (wantsStagingSource) {
    throw new WorkspaceEntitlementError('personal_instance_only');
  }

  if (requestedPath && protectedRuntimePath(requestedPath)) {
    throw new WorkspaceEntitlementError('protected_workspace_forbidden');
  }

  const wantsFork = requestedMode === 'github_fork';
  if (wantsFork) {
    if (!entitlements.canUseForkWorkspaces) {
      throw new WorkspaceEntitlementError('github_fork_requires_advanced_access');
    }
    const forkRoot = forkWorkspaceRoot(actor);
    const workspacePath = requestedPath
      ? path.resolve(requestedPath)
      : path.join(forkRoot, forkSlug(githubForkUrl, taskId));
    if (!isInside(workspacePath, forkRoot)) {
      throw new WorkspaceEntitlementError('github_fork_workspace_outside_scope');
    }
    await assertExistingPathIsScoped(workspacePath, forkRoot, 'github_fork_workspace_outside_scope');
    return {
      mode: 'github_fork',
      workspacePath,
      githubForkUrl,
      ...entitlements,
    };
  }

  if (requestedPath) {
    const workspacePath = path.resolve(requestedPath);
    if (!isInside(workspacePath, scopedRoot)) {
      throw new WorkspaceEntitlementError('sandbox_workspace_outside_scope');
    }
    await assertExistingPathIsScoped(workspacePath, scopedRoot, 'sandbox_workspace_outside_scope');
    return {
      mode: 'sandbox',
      workspacePath,
      ...entitlements,
    };
  }

  return {
    mode: 'sandbox',
    workspacePath: options.purpose === 'terminal' ? scopedRoot : undefined,
    isolationNotice:
      PERSONAL_INSTANCE_WORKSPACE_MESSAGE,
    ...entitlements,
  };
}
