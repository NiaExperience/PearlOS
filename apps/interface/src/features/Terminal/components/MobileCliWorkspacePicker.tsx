'use client';

import { GitBranch, Shield } from 'lucide-react';
import type { TerminalWorkspaceEntitlements, TerminalWorkspaceMode } from './MobileCliTypes';

type Props = {
  entitlements: TerminalWorkspaceEntitlements | null;
  githubForkUrl: string;
  mode: TerminalWorkspaceMode;
  onForkUrlChange: (value: string) => void;
  onModeChange: (mode: TerminalWorkspaceMode) => void;
};

export function MobileCliWorkspacePicker({
  entitlements,
  githubForkUrl,
  mode,
  onForkUrlChange,
  onModeChange,
}: Props) {
  const canUseFork = Boolean(entitlements?.canUseForkWorkspaces);
  if (!canUseFork) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-[var(--pearl-window-border)] bg-[var(--pearl-window-bg)] px-3 py-2 text-xs text-[var(--pearl-muted)]">
        <Shield className="h-4 w-4 text-[var(--pearl-accent)]" />
        <span>Sandbox workspace</span>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--pearl-window-border)] bg-[var(--pearl-window-bg)] p-2">
      <label className="flex items-center gap-2 text-xs text-[var(--pearl-muted)]">
        <Shield className="h-4 w-4 text-[var(--pearl-accent)]" />
        <select
          aria-label="Workspace mode"
          className="h-8 min-w-0 flex-1 rounded-md border border-[var(--pearl-window-border)] bg-[var(--pearl-window-content-bg)] px-2 text-[var(--pearl-text)] outline-none"
          onChange={(event) => onModeChange(event.target.value as TerminalWorkspaceMode)}
          value={mode}
        >
          <option value="sandbox">Sandbox</option>
          {canUseFork && <option value="github_fork">GitHub fork</option>}
        </select>
      </label>

      {mode === 'github_fork' && canUseFork && (
        <label className="mt-2 flex items-center gap-2">
          <GitBranch className="h-4 w-4 shrink-0 text-[var(--pearl-muted)]" />
          <input
            className="h-8 min-w-0 flex-1 rounded-md border border-[var(--pearl-window-border)] bg-[var(--pearl-window-content-bg)] px-2 text-xs text-[var(--pearl-text)] outline-none placeholder:text-[var(--pearl-muted)]"
            onChange={(event) => onForkUrlChange(event.target.value)}
            placeholder="https://github.com/owner/fork.git"
            type="url"
            value={githubForkUrl}
          />
        </label>
      )}
    </div>
  );
}
