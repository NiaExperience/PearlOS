'use client';

import { Bot, History, MessageSquareCode, Play, Sparkles, Terminal } from 'lucide-react';
import { MobileCliWorkspacePicker } from './MobileCliWorkspacePicker';
import {
  sessionKindFromId,
  sessionTitle,
  type MobileCliSessionKind,
  type TerminalSession,
  type TerminalWorkspaceEntitlements,
  type TerminalWorkspaceMode,
} from './MobileCliTypes';

type Props = {
  busy: boolean;
  entitlements: TerminalWorkspaceEntitlements | null;
  error: string;
  githubForkUrl: string;
  mode: TerminalWorkspaceMode;
  sessions: TerminalSession[];
  onForkUrlChange: (value: string) => void;
  onModeChange: (mode: TerminalWorkspaceMode) => void;
  onResume: (id: string) => void;
  onStart: (kind: MobileCliSessionKind, modeOverride?: TerminalWorkspaceMode) => void;
};

const startOptions: Array<{
  kind: MobileCliSessionKind;
  title: string;
  detail: string;
  icon: typeof Bot;
}> = [
  { kind: 'pearl', title: 'Pearl', detail: 'Open Pearl through the OpenClaw TUI.', icon: Sparkles },
  { kind: 'codex', title: 'Codex', detail: 'Start a Codex coding session.', icon: Bot },
  { kind: 'claude', title: 'Claude', detail: 'Start a Claude coding session.', icon: MessageSquareCode },
  { kind: 'cli', title: 'CLI', detail: 'Start a plain shell session.', icon: Terminal },
];

const operatorOptions: Array<{
  kind: MobileCliSessionKind;
  title: string;
  detail: string;
  icon: typeof Bot;
}> = [
  { kind: 'pearl', title: 'STAGING ONLY - Host OpenClaw', detail: 'Open Pearl Omega OpenClaw on the staging host.', icon: Sparkles },
  { kind: 'codex', title: 'STAGING ONLY - Host Codex', detail: 'Open Codex CLI on the staging source tree.', icon: Bot },
  { kind: 'claude', title: 'STAGING ONLY - Host Claude', detail: 'Open Claude CLI on the staging source tree.', icon: MessageSquareCode },
  { kind: 'cli', title: 'STAGING ONLY - Host Shell', detail: 'Open a plain operator shell on staging.', icon: Terminal },
];

export function MobileCliLauncher({
  busy,
  entitlements,
  error,
  githubForkUrl,
  mode,
  sessions,
  onForkUrlChange,
  onModeChange,
  onResume,
  onStart,
}: Props) {
  return (
    <div className="flex h-full flex-col bg-[var(--pearl-window-content-bg)] text-[var(--pearl-text)]">
      <div className="flex-1 overflow-auto px-3 py-3">
        <MobileCliWorkspacePicker
          entitlements={entitlements}
          githubForkUrl={githubForkUrl}
          mode={mode}
          onForkUrlChange={onForkUrlChange}
          onModeChange={onModeChange}
        />

        {error && (
          <div className="mt-3 rounded-md border border-[var(--pearl-window-border)] bg-[var(--pearl-window-bg)] px-3 py-2 text-xs text-[var(--pearl-text)]">
            {error}
          </div>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {startOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                className="min-h-24 rounded-md border border-[var(--pearl-window-border)] bg-[var(--pearl-window-bg)] p-3 text-left shadow-sm transition hover:border-[var(--pearl-accent)] hover:bg-[var(--pearl-window-control-hover-bg)] disabled:opacity-55"
                disabled={busy}
                key={option.kind}
                onClick={() => onStart(option.kind)}
                type="button"
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-[var(--pearl-accent)]" />
                  <span className="text-sm font-semibold">{option.title}</span>
                  <Play className="ml-auto h-3.5 w-3.5 text-[var(--pearl-muted)]" />
                </div>
                <div className="mt-2 text-xs leading-5 text-[var(--pearl-muted)]">{option.detail}</div>
              </button>
            );
          })}
        </div>

        {entitlements?.operatorStagingSourceAvailable && (
          <div className="mt-3">
            <div className="mb-2 text-xs font-semibold text-[var(--pearl-muted)]">Blair Staging Operator</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {operatorOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    className="min-h-20 rounded-md border border-[var(--pearl-window-border)] bg-[var(--pearl-window-bg)] p-3 text-left shadow-sm transition hover:border-[var(--pearl-accent)] hover:bg-[var(--pearl-window-control-hover-bg)] disabled:opacity-55"
                    disabled={busy}
                    key={option.title}
                    onClick={() => onStart(option.kind, 'operator_staging_source')}
                    type="button"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-[var(--pearl-accent)]" />
                      <span className="text-sm font-semibold">{option.title}</span>
                      <Play className="ml-auto h-3.5 w-3.5 text-[var(--pearl-muted)]" />
                    </div>
                    <div className="mt-2 text-xs leading-5 text-[var(--pearl-muted)]">{option.detail}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {sessions.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--pearl-muted)]">
              <History className="h-4 w-4" />
              Continue
            </div>
            <div className="grid gap-2">
              {sessions.map((session) => (
                <button
                  className="flex h-11 items-center gap-3 rounded-md border border-[var(--pearl-window-border)] bg-[var(--pearl-window-bg)] px-3 text-left text-sm hover:border-[var(--pearl-accent)]"
                  key={session.id}
                  onClick={() => onResume(session.id)}
                  type="button"
                >
                  <Terminal className="h-4 w-4 text-[var(--pearl-accent)]" />
                  <span className="font-medium">{sessionTitle(sessionKindFromId(session.id))}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-[var(--pearl-muted)]">{session.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
