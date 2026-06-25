'use client';

export type TerminalWorkspaceMode = 'sandbox' | 'github_fork' | 'operator_staging_source';

export type TerminalWorkspaceEntitlements = {
  isBlair: boolean;
  canUseForkWorkspaces: boolean;
  canUseStagingSourceEdits: boolean;
  stagingSourceEditsEnabled: boolean;
  stagingSourceToggleAvailable?: boolean;
  operatorStagingSourceAvailable?: boolean;
};

export type MobileCliSessionKind = 'pearl' | 'codex' | 'claude' | 'cli';

export type TerminalSession = {
  id: string;
  name: string;
  created: string;
  attached: boolean;
};

export function sessionKindFromId(id: string): MobileCliSessionKind {
  if (id.startsWith('pearl-')) return 'pearl';
  if (id.startsWith('codex-')) return 'codex';
  if (id.startsWith('claude-')) return 'claude';
  return 'cli';
}

export function sessionTitle(kind: MobileCliSessionKind): string {
  if (kind === 'pearl') return 'Pearl';
  if (kind === 'codex') return 'Codex';
  if (kind === 'claude') return 'Claude';
  return 'CLI';
}
