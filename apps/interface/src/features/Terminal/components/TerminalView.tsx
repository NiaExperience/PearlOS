'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MobileCliComposer, type MobileCliControlKey } from './MobileCliComposer';
import { MobileCliLauncher } from './MobileCliLauncher';
import { MobileCliOutputPane } from './MobileCliOutputPane';
import { MobileCliSessionHeader } from './MobileCliSessionHeader';
import {
  sessionKindFromId,
  type MobileCliSessionKind,
  type TerminalSession,
  type TerminalWorkspaceEntitlements,
  type TerminalWorkspaceMode,
} from './MobileCliTypes';

const POLL_MS = 1200;

type TerminalViewMode = 'launcher' | 'session';

class TerminalRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message || code || `Terminal request failed (${status})`);
    this.name = 'TerminalRequestError';
    this.status = status;
    this.code = code;
  }
}

function cleanOutput(output: string): string {
  return output
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\r/g, '')
    .replace(/\s+$/g, '');
}

function sessionCommand(kind: MobileCliSessionKind, mode: TerminalWorkspaceMode): string | null {
  if (mode === 'operator_staging_source') {
    if (kind === 'pearl') return 'openclaw tui';
    if (kind === 'codex') return 'codex';
    if (kind === 'claude') return 'claude';
    return null;
  }
  if (kind === 'pearl') return 'pearl-openclaw-sandbox';
  if (kind === 'codex') return 'pearl-codex-sandbox';
  if (kind === 'claude') return 'pearl-claude-sandbox';
  return null;
}

function newSessionId(kind: MobileCliSessionKind): string {
  return `${kind}-${Date.now().toString(36)}`;
}

function pathFromOutput(output: string): string {
  const lines = cleanOutput(output).split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(/@[\w.-]+:(.+?)[#$]\s*$/);
    if (match?.[1]) {
      return match[1].replace(/^\/home\/[^/]+/, '~').replace(/^\/root/, '~');
    }
  }
  return '~';
}

function friendlyError(value: unknown): string {
  const messages: Record<string, string> = {
    personal_instance_only: "Pearl changes only the requester's PearlOS instance. Core PearlOS integration is managed separately.",
    staging_source_requires_blair: "Pearl changes only the requester's PearlOS instance. Core PearlOS integration is managed separately.",
    staging_source_edits_disabled: "Pearl changes only the requester's PearlOS instance. Core PearlOS integration is managed separately.",
    protected_workspace_forbidden: 'Protected source paths are blocked. Use a sandbox or allowed fork workspace.',
    github_fork_requires_advanced_access: 'GitHub fork workspaces require advanced workspace access.',
    github_fork_workspace_outside_scope: 'That fork workspace is outside your allowed workspace.',
    sandbox_workspace_outside_scope: 'That sandbox path is outside your PearlOS workspace.',
    workspace_symlink_forbidden: 'That workspace path follows a symlink outside the allowed sandbox.',
    terminal_session_limit_reached: 'Too many Terminal sessions are already open. Continue an existing session first.',
    origin_forbidden: 'Terminal requests must come from this PearlOS session.',
    terminal_session_exited: 'Terminal exited before it was ready. Start a new session.',
    terminal_runtime_unavailable: 'Terminal is missing a required runtime on the server.',
    terminal_sandbox_unavailable: 'Terminal sandboxing is unavailable on this server. The server needs bwrap/user namespaces fixed.',
    terminal_runtime_timeout: 'Terminal timed out before it was ready.',
    terminal_runtime_forbidden: 'Terminal does not have permission to start a session.',
    terminal_workspace_unavailable: 'Terminal workspace is not available on this server.',
    terminal_session_failed: 'Terminal failed before it was ready. Try again.',
  };
  if (value instanceof TerminalRequestError && value.code) {
    return messages[value.code] || value.message || 'Terminal session failed.';
  }
  const raw = value instanceof Error ? value.message : String(value || '');
  const code = raw.replace(/^Terminal API returned \d+:\s*/, '');
  return messages[code] || raw || 'Terminal session failed.';
}

const TerminalView: React.FC = () => {
  const [viewMode, setViewMode] = useState<TerminalViewMode>('launcher');
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState('');
  const [output, setOutput] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [workspaceEntitlements, setWorkspaceEntitlements] = useState<TerminalWorkspaceEntitlements | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<TerminalWorkspaceMode>('sandbox');
  const [activeWorkspaceMode, setActiveWorkspaceMode] = useState<TerminalWorkspaceMode>('sandbox');
  const [sessionModes, setSessionModes] = useState<Record<string, TerminalWorkspaceMode>>({});
  const [githubForkUrl, setGithubForkUrl] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [composerFocused, setComposerFocused] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeKind = useMemo<MobileCliSessionKind>(
    () => sessionKindFromId(activeId),
    [activeId],
  );
  const effectiveWorkspaceMode: TerminalWorkspaceMode = workspaceMode;
  const currentSessionWorkspaceMode = activeId
    ? sessionModes[activeId] || activeWorkspaceMode
    : effectiveWorkspaceMode;

  const request = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, {
      ...init,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (!response.ok) {
      const code = typeof data.error === 'string' ? data.error : '';
      const detail = typeof data.message === 'string' ? data.message : code || response.statusText;
      throw new TerminalRequestError(response.status, code, detail);
    }
    return data as T;
  }, []);

  const workspacePayload = useCallback((modeOverride?: TerminalWorkspaceMode) => {
    const modeForRequest = modeOverride || currentSessionWorkspaceMode;
    return {
      workspaceMode: modeForRequest,
      ...(modeForRequest === 'github_fork' && githubForkUrl.trim()
      ? { githubForkUrl: githubForkUrl.trim() }
      : {}),
    };
  }, [currentSessionWorkspaceMode, githubForkUrl]);

  const workspaceQuery = useCallback((id?: string, listOnly = false, modeOverride?: TerminalWorkspaceMode) => {
    const modeForRequest = modeOverride || (id ? sessionModes[id] || activeWorkspaceMode : effectiveWorkspaceMode);
    const params = new URLSearchParams();
    if (id) params.set('id', id);
    if (listOnly) params.set('listOnly', '1');
    params.set('workspaceMode', modeForRequest);
    if (modeForRequest === 'github_fork' && githubForkUrl.trim()) {
      params.set('githubForkUrl', githubForkUrl.trim());
    }
    return params.toString();
  }, [activeWorkspaceMode, effectiveWorkspaceMode, githubForkUrl, sessionModes]);

  const refreshSessions = useCallback(async () => {
    const modes: TerminalWorkspaceMode[] = [effectiveWorkspaceMode];
    if (workspaceEntitlements?.operatorStagingSourceAvailable && !modes.includes('operator_staging_source')) {
      modes.push('operator_staging_source');
    }
    const results = await Promise.all(
      modes.map(async (mode) => {
        const data = await request<{ sessions: TerminalSession[] }>(
          `/api/terminal/sessions?${workspaceQuery(undefined, true, mode)}`,
        );
        return { mode, sessions: data.sessions || [] };
      }),
    );
    const nextModes: Record<string, TerminalWorkspaceMode> = {};
    const seen = new Set<string>();
    const nextSessions: TerminalSession[] = [];
    for (const result of results) {
      for (const session of result.sessions) {
        if (!/^(pearl|codex|claude|cli)-/.test(session.id) || seen.has(session.id)) continue;
        seen.add(session.id);
        nextModes[session.id] = result.mode;
        nextSessions.push(session);
      }
    }
    setSessionModes((current) => ({ ...current, ...nextModes }));
    setSessions(nextSessions);
  }, [effectiveWorkspaceMode, request, workspaceEntitlements?.operatorStagingSourceAvailable, workspaceQuery]);

  const refreshOutput = useCallback(async (id = activeId) => {
    if (!id) return;
    const data = await request<{ output: string }>(`/api/terminal/sessions?${workspaceQuery(id)}`);
    setOutput(cleanOutput(data.output || ''));
    setError('');
  }, [activeId, request, workspaceQuery]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/workspace-entitlements', { cache: 'no-store', credentials: 'same-origin' });
        const data = (await res.json()) as TerminalWorkspaceEntitlements;
        if (cancelled || !res.ok) return;
        setWorkspaceEntitlements(data);
      } catch {
        // Keep the default sandbox mode.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refreshSessions().catch((err) => setError(friendlyError(err)));
  }, [refreshSessions]);

  useEffect(() => {
    if (viewMode !== 'session' || !activeId) return undefined;
    const timer = window.setInterval(() => {
      refreshOutput(activeId).catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeId, refreshOutput, viewMode]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const startSession = useCallback(async (kind: MobileCliSessionKind, modeOverride?: TerminalWorkspaceMode) => {
    const id = newSessionId(kind);
    const launchMode = modeOverride || effectiveWorkspaceMode;
    const payload = workspacePayload(launchMode);
    setBusy(true);
    setError('');
    setOutput('');
    setActiveId(id);
    setActiveWorkspaceMode(launchMode);
    setSessionModes((current) => ({ ...current, [id]: launchMode }));
    setViewMode('session');
    try {
      const created = await request<{ output: string }>('/api/terminal/sessions', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', id, ...payload }),
      });
      setOutput(cleanOutput(created.output || ''));
      const command = sessionCommand(kind, launchMode);
      if (command) {
        const started = await request<{ output: string }>('/api/terminal/sessions', {
          method: 'POST',
          body: JSON.stringify({ action: 'send', id, input: command, launcher: kind, ...payload }),
        });
        setOutput(cleanOutput(started.output || ''));
      }
      await refreshSessions();
      window.setTimeout(() => inputRef.current?.focus(), 50);
    } catch (err) {
      setError(friendlyError(err));
      setActiveId('');
      setActiveWorkspaceMode(effectiveWorkspaceMode);
      setSessionModes((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setOutput('');
      setViewMode('launcher');
      refreshSessions().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }, [effectiveWorkspaceMode, refreshSessions, request, workspacePayload]);

  const resumeSession = useCallback((id: string) => {
    const mode = sessionModes[id] || effectiveWorkspaceMode;
    setActiveId(id);
    setActiveWorkspaceMode(mode);
    setViewMode('session');
    setError('');
    refreshOutput(id).catch((err) => setError(friendlyError(err)));
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [effectiveWorkspaceMode, refreshOutput, sessionModes]);

  const sendRawKey = useCallback(async (key: string, pendingInput = '') => {
    if (!activeId) return;
    setBusy(true);
    if (pendingInput) setInput('');
    try {
      const data = await request<{ output: string }>('/api/terminal/sessions', {
        method: 'POST',
        body: JSON.stringify({ action: 'raw', id: activeId, data: pendingInput, key, ...workspacePayload() }),
      });
      setOutput(cleanOutput(data.output || ''));
      setError('');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [activeId, request, workspacePayload]);

  const stopSession = useCallback(async () => {
    if (!activeId) return;
    setBusy(true);
    try {
      await request('/api/terminal/sessions', {
        method: 'POST',
        body: JSON.stringify({ action: 'kill', id: activeId, ...workspacePayload() }),
      });
      setActiveId('');
      setActiveWorkspaceMode(effectiveWorkspaceMode);
      setSessionModes((current) => {
        const next = { ...current };
        delete next[activeId];
        return next;
      });
      setInput('');
      setOutput('');
      setViewMode('launcher');
      await refreshSessions();
      setError('');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }, [activeId, effectiveWorkspaceMode, refreshSessions, request, workspacePayload]);

  const sendInput = useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!activeId || busy) return;
    const commandText = input.replace(/\n+$/g, '');
    setInput('');
    setBusy(true);
    try {
      const data = await request<{ output: string }>('/api/terminal/sessions', {
        method: 'POST',
        body: JSON.stringify({ action: 'raw', id: activeId, data: commandText, key: 'Enter', ...workspacePayload() }),
      });
      if (commandText.trim()) {
        setHistory((current) => [...current, commandText]);
        setHistoryIndex(-1);
      }
      setOutput(cleanOutput(data.output || ''));
      setError('');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 25);
    }
  }, [activeId, busy, input, request, workspacePayload]);

  const showPreviousCommand = useCallback(() => {
    const nextIndex = Math.min(historyIndex + 1, history.length - 1);
    if (nextIndex >= 0) {
      setHistoryIndex(nextIndex);
      setInput(history[history.length - 1 - nextIndex] || '');
    }
  }, [history, historyIndex]);

  const showNextCommand = useCallback(() => {
    const nextIndex = historyIndex - 1;
    if (nextIndex >= 0) {
      setHistoryIndex(nextIndex);
      setInput(history[history.length - 1 - nextIndex] || '');
    } else {
      setHistoryIndex(-1);
      setInput('');
    }
  }, [history, historyIndex]);

  const sendControlKey = useCallback((key: MobileCliControlKey) => {
    if (key === 'Up' && input.length > 0) {
      showPreviousCommand();
      return;
    }
    if (key === 'Down' && input.length > 0) {
      showNextCommand();
      return;
    }
    void sendRawKey(key, input);
  }, [input, sendRawKey, showNextCommand, showPreviousCommand]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendInput();
      return;
    }

    if (event.ctrlKey) {
      const controlKeys: Record<string, string> = {
        c: 'C-c',
        d: 'C-d',
        l: 'C-l',
        z: 'C-z',
      };
      const mapped = controlKeys[event.key.toLowerCase()];
      if (mapped) {
        event.preventDefault();
        void sendRawKey(mapped, '');
      }
      return;
    }

    if (event.key === 'Tab' || event.key === 'Escape') {
      event.preventDefault();
      void sendRawKey(event.key === 'Tab' ? 'Tab' : 'Escape', input);
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (input.length === 0) {
        event.preventDefault();
        void sendRawKey(event.key === 'ArrowLeft' ? 'Left' : 'Right');
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (input.length === 0) {
        void sendRawKey('Up');
      } else {
        showPreviousCommand();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (input.length === 0) {
        void sendRawKey('Down');
      } else {
        showNextCommand();
      }
    }
  }, [input, sendInput, sendRawKey, showNextCommand, showPreviousCommand]);

  if (viewMode === 'launcher') {
    return (
      <div className="h-full w-full" data-pearl-terminal="true" onKeyDown={(event) => event.stopPropagation()}>
        <MobileCliLauncher
          busy={busy}
          entitlements={workspaceEntitlements}
          error={error}
          githubForkUrl={githubForkUrl}
          mode={effectiveWorkspaceMode}
          sessions={sessions}
          onForkUrlChange={setGithubForkUrl}
          onModeChange={setWorkspaceMode}
          onResume={resumeSession}
          onStart={startSession}
        />
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-full min-h-0 flex-col bg-[var(--pearl-window-content-bg)] text-[var(--pearl-text)]"
      data-pearl-terminal="true"
      onClick={() => inputRef.current?.focus()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <MobileCliSessionHeader
        busy={busy}
        kind={activeKind}
        pathLabel={pathFromOutput(output)}
        onBack={() => {
          setViewMode('launcher');
          setActiveId('');
          setActiveWorkspaceMode(effectiveWorkspaceMode);
          setInput('');
          void refreshSessions();
        }}
        onStop={stopSession}
      />

      {error && (
        <div className="shrink-0 border-b border-[var(--pearl-window-border)] bg-[var(--pearl-window-bg)] px-3 py-2 text-xs text-[var(--pearl-text)]">
          {error}
        </div>
      )}

      <MobileCliOutputPane output={output} outputRef={outputRef} />
      <MobileCliComposer
        busy={busy}
        input={input}
        inputRef={inputRef}
        showControls={composerFocused}
        onChange={setInput}
        onControlKey={sendControlKey}
        onFocusChange={setComposerFocused}
        onKeyDown={onKeyDown}
        onSubmit={sendInput}
      />
    </div>
  );
};

export default TerminalView;
