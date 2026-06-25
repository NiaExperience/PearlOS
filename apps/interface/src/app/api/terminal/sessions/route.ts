import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { access, mkdir, realpath, stat } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import {
  resolveInterfaceActorContext,
  type InterfaceActorContext,
} from '@interface/lib/tenant-actor';
import {
  PERSONAL_INSTANCE_WORKSPACE_MESSAGE,
  resolveWorkspaceForActor,
  WorkspaceEntitlementError,
  type WorkspaceMode,
} from '@interface/lib/workspace-entitlements';

const execFileAsync = promisify(execFile);

const SESSION_PREFIX = 'pearl-term-sb-';
const OPERATOR_SESSION_PREFIX = 'pearl-term-op-';
const DEFAULT_TERMINAL_COLUMNS = 160;
const DEFAULT_TERMINAL_ROWS = 48;
const configuredSessionLimit = Number(process.env.PEARLOS_MAX_TERMINAL_SESSIONS_PER_ACTOR || 8);
const MAX_TERMINAL_SESSIONS_PER_ACTOR = Number.isFinite(configuredSessionLimit)
  ? Math.max(1, Math.floor(configuredSessionLimit))
  : 8;
const TERMINAL_PATH = [
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  '/home/deploy/.local/bin',
  '/root/.local/bin',
  '/root/.npm-global/bin',
  process.env.PATH || '',
].filter(Boolean).join(':');
const ALLOWED_RAW_KEYS = new Set([
  'Enter',
  'BSpace',
  'Tab',
  'Escape',
  'Up',
  'Down',
  'Left',
  'Right',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'C-c',
  'C-d',
  'C-l',
  'C-z',
]);
const CLI_LAUNCHERS = new Set(['pearl', 'codex', 'claude', 'cli']);

type TerminalSession = {
  id: string;
  name: string;
  attached: boolean;
  created: string;
};

type CliLauncher = 'pearl' | 'codex' | 'claude' | 'cli';

class TerminalApiError extends Error {
  readonly terminalCode: string;
  readonly status: number;

  constructor(terminalCode: string, status: number, message: string) {
    super(message);
    this.name = 'TerminalApiError';
    this.terminalCode = terminalCode;
    this.status = status;
  }
}

function env() {
  return {
    HOME: process.env.PEARLOS_TERMINAL_HOME || process.env.HOME || '/home/deploy',
    PATH: TERMINAL_PATH,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: process.env.LANG || 'C.UTF-8',
    LC_ALL: process.env.LC_ALL || 'C.UTF-8',
    USER: process.env.PEARLOS_TERMINAL_USER || 'pearl',
    LOGNAME: process.env.PEARLOS_TERMINAL_USER || 'pearl',
    SHELL: '/bin/bash',
    TMPDIR: '/tmp',
    PEARLOS_TERMINAL_SANDBOX: '1',
    NODE_ENV: process.env.NODE_ENV || 'production',
  };
}

function sanitizeId(value: unknown): string {
  const raw = String(value || '').trim();
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48);
  return safe || `tab-${Date.now().toString(36)}`;
}

function safeScopePart(value: unknown, fallback: string): string {
  const safe = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._@+-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return safe || fallback;
}

function actorPrefix(actor: InterfaceActorContext): string {
  return `${SESSION_PREFIX}${safeScopePart(actor.tenantId, 'public')}-${safeScopePart(actor.userId || actor.userEmail, 'anonymous')}-`;
}

function actorPrefixForMode(actor: InterfaceActorContext, mode?: WorkspaceMode): string {
  if (mode === 'operator_staging_source') {
    return `${OPERATOR_SESSION_PREFIX}${safeScopePart(actor.userEmail, 'operator')}-`;
  }
  return actorPrefix(actor);
}

function tmuxName(actor: InterfaceActorContext, id: string, mode?: WorkspaceMode): string {
  return `${actorPrefixForMode(actor, mode)}${sanitizeId(id)}`;
}

function normalizedOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    return null;
  }
}

function requestOriginAllowed(req: NextRequest): boolean {
  const origin = normalizedOrigin(req.headers.get('origin'));
  if (!origin) return true;

  const host = req.headers.get('host');
  const forwardedHost = req.headers.get('x-forwarded-host');
  const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
  const candidates = [
    req.nextUrl.origin,
    host ? `https://${host}` : '',
    host ? `http://${host}` : '',
    forwardedHost ? `${forwardedProto}://${forwardedHost}` : '',
    process.env.NEXTAUTH_URL,
    process.env.PEARLOS_URL,
    process.env.PUBLIC_URL,
  ];

  return candidates
    .map(normalizedOrigin)
    .filter(Boolean)
    .some((candidate) => candidate === origin);
}

async function tmux(args: string[], timeout = 8000): Promise<string> {
  try {
    const { stdout } = await execFileAsync('tmux', args, {
      env: env(),
      timeout,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      throw new TerminalApiError(
        'terminal_runtime_unavailable',
        503,
        'Terminal runtime is missing tmux on this server.',
      );
    }
    throw error;
  }
}

function commandFailureText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error || '');
  const record = error as Record<string, unknown>;
  return [
    typeof record.stderr === 'string' ? record.stderr : '',
    typeof record.stdout === 'string' ? record.stdout : '',
    error instanceof Error ? error.message : '',
  ].filter(Boolean).join('\n').trim();
}

function isTmuxTargetGone(error: unknown): boolean {
  return /can't find (pane|session|window)|no current target|session not found/i.test(commandFailureText(error));
}

function isBubblewrapFailure(text: string): boolean {
  return /\b(bwrap|bubblewrap)\b|user namespace|creating new namespace|namespace setup|operation not permitted.*namespace/i.test(text);
}

function isWorkspaceRuntimeFailure(text: string): boolean {
  return /no such file or directory|cannot access .*cwd|can't change directory|chdir.*failed|working directory/i.test(text);
}

function isTmuxRuntimeFailure(text: string): boolean {
  return /error connecting to|failed to connect to server|server exited unexpectedly|no server running|\/tmp\/tmux/i.test(text);
}

function terminalErrorResponse(error: unknown): NextResponse {
  if (error instanceof WorkspaceEntitlementError) {
    return NextResponse.json(
      { error: error.code, message: PERSONAL_INSTANCE_WORKSPACE_MESSAGE },
      { status: error.status },
    );
  }

  if (error instanceof TerminalApiError) {
    return NextResponse.json(
      { error: error.terminalCode, message: error.message },
      { status: error.status },
    );
  }

  const text = commandFailureText(error);
  let code = 'terminal_session_failed';
  let status = 500;
  let message = 'Terminal session failed before it was ready. Try again.';
  const nodeCode = (error as NodeJS.ErrnoException | undefined)?.code;

  if (isTmuxTargetGone(error)) {
    code = 'terminal_session_exited';
    status = 409;
    message = 'Terminal session exited before it was ready. Start a new session.';
  } else if (nodeCode === 'ENOENT' || /spawn tmux ENOENT/i.test(text)) {
    code = 'terminal_runtime_unavailable';
    status = 503;
    message = 'Terminal runtime is missing tmux on this server.';
  } else if (isBubblewrapFailure(text)) {
    code = 'terminal_sandbox_unavailable';
    status = 503;
    message = 'Terminal sandbox runtime is not available on this server.';
  } else if (nodeCode === 'ETIMEDOUT' || /timed out|timeout/i.test(text)) {
    code = 'terminal_runtime_timeout';
    status = 504;
    message = 'Terminal runtime timed out before it was ready.';
  } else if (isTmuxRuntimeFailure(text)) {
    code = 'terminal_runtime_unavailable';
    status = 503;
    message = 'Terminal runtime could not start a tmux session on this server.';
  } else if (isWorkspaceRuntimeFailure(text)) {
    code = 'terminal_workspace_unavailable';
    status = 503;
    message = 'Terminal workspace is not available on this server.';
  } else if (nodeCode === 'EACCES' || nodeCode === 'EPERM' || /permission denied/i.test(text)) {
    code = 'terminal_runtime_forbidden';
    status = 503;
    message = 'Terminal runtime does not have permission to start a session.';
  }

  console.error('[terminal] session request failed', {
    code,
    detail: text.slice(0, 500),
  });
  return NextResponse.json({ error: code, message }, { status });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function existingReadOnlyBindPaths(candidates: string[]): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const clean = candidate.trim();
    if (!clean || seen.has(clean)) continue;
    try {
      await stat(clean);
      const resolved = await realpath(clean).catch(() => clean);
      for (const item of [clean, resolved]) {
        if (item && !seen.has(item)) {
          seen.add(item);
          out.push(item);
        }
      }
    } catch {
      // Missing optional runtime path.
    }
  }
  return out;
}

async function resolverBindArgs(): Promise<string[]> {
  if (!(await pathExists('/run/systemd/resolve'))) return [];
  return [
    '--dir',
    '/run',
    '--dir',
    '/run/systemd',
    '--ro-bind',
    '/run/systemd/resolve',
    '/run/systemd/resolve',
  ];
}

async function assertNoExistingParentSymlink(target: string): Promise<void> {
  let current = path.resolve(target);
  while (!(await pathExists(current))) {
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
  const realCurrent = await realpath(current);
  if (realCurrent !== current) {
    throw new WorkspaceEntitlementError('workspace_symlink_forbidden');
  }
}

function pathInside(candidate: string, root: string): boolean {
  const resolved = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

async function sessionExists(actor: InterfaceActorContext, id: string, mode?: WorkspaceMode): Promise<boolean> {
  try {
    await tmux(['has-session', '-t', tmuxName(actor, id, mode)]);
    return true;
  } catch {
    return false;
  }
}

async function sessionCurrentPath(actor: InterfaceActorContext, id: string, mode?: WorkspaceMode): Promise<string> {
  return (await tmux(['display-message', '-p', '-t', tmuxName(actor, id, mode), '#{pane_current_path}'])).trim();
}

function terminalSize(cols?: unknown, rows?: unknown): { cols: string; rows: string } {
  const nextCols = Math.min(Math.max(Number(cols) || DEFAULT_TERMINAL_COLUMNS, 80), 240);
  const nextRows = Math.min(Math.max(Number(rows) || DEFAULT_TERMINAL_ROWS, 24), 80);
  return { cols: String(Math.floor(nextCols)), rows: String(Math.floor(nextRows)) };
}

async function resolveCwd(
  actor: InterfaceActorContext,
  body: { id?: unknown; cwd?: unknown; workspaceMode?: unknown; workspace_mode?: unknown; githubForkUrl?: unknown; github_fork_url?: unknown; } = {},
) {
  return resolveWorkspaceForActor(actor, {
    requestedMode: body.workspaceMode ?? body.workspace_mode,
    requestedPath: body.cwd,
    githubForkUrl: body.githubForkUrl ?? body.github_fork_url,
    taskId: body.id || 'terminal',
    purpose: 'terminal',
  });
}

function parentDirsForBind(target: string): string[] {
  const dirs: string[] = [];
  let current = path.dirname(path.resolve(target));
  while (current && current !== path.dirname(current)) {
    dirs.unshift(current);
    current = path.dirname(current);
  }
  return dirs;
}

async function sandboxedShellArgs(cwd: string, mode: WorkspaceMode): Promise<string[]> {
  if (mode === 'staging_source') {
    throw new WorkspaceEntitlementError('personal_instance_only');
  }
  if (mode === 'operator_staging_source') {
    return ['bash', '--noprofile', '--norc'];
  }

  const resolvedCwd = path.resolve(cwd);
  const realCwd = await realpath(resolvedCwd);
  if (realCwd !== resolvedCwd) {
    throw new WorkspaceEntitlementError('workspace_symlink_forbidden');
  }

  const roBinds: string[] = [];
  for (const candidate of ['/usr', '/bin', '/lib', '/lib64', '/etc']) {
    if (await pathExists(candidate)) {
      roBinds.push('--ro-bind', candidate, candidate);
    }
  }
  for (const candidate of await existingReadOnlyBindPaths([
    '/usr/local/lib/pearl-cli',
    '/usr/lib/node_modules',
  ])) {
    roBinds.push('--ro-bind', candidate, candidate);
  }

  const parentDirs = parentDirsForBind(resolvedCwd).flatMap((dir) => ['--dir', dir]);
  const resolverBinds = await resolverBindArgs();

  return [
    'bwrap',
    '--die-with-parent',
    '--share-net',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--clearenv',
    '--tmpfs',
    '/tmp',
    ...roBinds,
    ...resolverBinds,
    ...parentDirs,
    '--bind',
    resolvedCwd,
    resolvedCwd,
    '--chdir',
    resolvedCwd,
    '--setenv',
    'HOME',
    resolvedCwd,
    '--setenv',
    'PATH',
    TERMINAL_PATH,
    '--setenv',
    'TERM',
    'xterm-256color',
    '--setenv',
    'COLORTERM',
    'truecolor',
    '--setenv',
    'LANG',
    process.env.LANG || 'C.UTF-8',
    '--setenv',
    'LC_ALL',
    process.env.LC_ALL || 'C.UTF-8',
    '--setenv',
    'USER',
    'pearl',
    '--setenv',
    'LOGNAME',
    'pearl',
    '--setenv',
    'SHELL',
    '/bin/bash',
    '--setenv',
    'TMPDIR',
    '/tmp',
    '--setenv',
    'PEARLOS_TERMINAL_SANDBOX',
    '1',
    'bash',
    '--noprofile',
    '--norc',
  ];
}

async function ensureSession(
  actor: InterfaceActorContext,
  id: string,
  cwd: string,
  mode: WorkspaceMode,
  cols?: unknown,
  rows?: unknown,
): Promise<void> {
  const size = terminalSize(cols, rows);
  if (await sessionExists(actor, id, mode)) {
    const currentPath = await sessionCurrentPath(actor, id, mode).catch(() => '');
    if (currentPath && !pathInside(currentPath, cwd)) {
      await tmux(['kill-session', '-t', tmuxName(actor, id, mode)]).catch(() => '');
    } else {
      await tmux(['resize-window', '-t', tmuxName(actor, id, mode), '-x', size.cols, '-y', size.rows]).catch(() => '');
      return;
    }
  }
  if (mode === 'staging_source') {
    throw new WorkspaceEntitlementError('personal_instance_only');
  }
  if (mode !== 'operator_staging_source') {
    await assertNoExistingParentSymlink(cwd);
    await mkdir(cwd, { recursive: true });
  }
  const shellArgs = await sandboxedShellArgs(cwd, mode);
  if (await sessionExists(actor, id, mode)) {
    await tmux(['resize-window', '-t', tmuxName(actor, id, mode), '-x', size.cols, '-y', size.rows]).catch(() => '');
    return;
  }
  await tmux([
    'new-session',
    '-d',
    '-x',
    size.cols,
    '-y',
    size.rows,
    '-s',
    tmuxName(actor, id, mode),
    '-c',
    cwd,
    ...shellArgs,
  ]);
  if (!(await sessionExists(actor, id, mode))) {
    throw new TerminalApiError(
      'terminal_session_exited',
      409,
      'Terminal session exited before it was ready. Start a new session.',
    );
  }
}

async function capture(actor: InterfaceActorContext, id: string, cwd: string, mode: WorkspaceMode): Promise<string> {
  await ensureSession(actor, id, cwd, mode);
  try {
    return await tmux(['capture-pane', '-t', tmuxName(actor, id, mode), '-p', '-S', '-4000'], 8000);
  } catch (error) {
    if (!isTmuxTargetGone(error)) throw error;
    await tmux(['kill-session', '-t', tmuxName(actor, id, mode)]).catch(() => '');
    await ensureSession(actor, id, cwd, mode);
    try {
      return await tmux(['capture-pane', '-t', tmuxName(actor, id, mode), '-p', '-S', '-4000'], 8000);
    } catch (retryError) {
      if (isTmuxTargetGone(retryError)) {
        throw new TerminalApiError(
          'terminal_session_exited',
          409,
          'Terminal session exited before it was ready. Start a new session.',
        );
      }
      throw retryError;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function launcherOutputReady(output: string, input: string, launcher: CliLauncher): boolean {
  const clean = output
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\r/g, '');
  const launcherPatterns: Record<CliLauncher, RegExp[]> = {
    pearl: [/openclaw/i, /pearl/i],
    codex: [/codex/i, /openai/i, /login/i, /device/i, /api key/i],
    claude: [/claude/i, /anthropic/i, /login/i],
    cli: [/[#$]\s*$/m],
  };
  if (launcherPatterns[launcher].some((pattern) => pattern.test(clean))) {
    const commandOnly = new RegExp(`${input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
    if (!commandOnly.test(clean.trim())) return true;
  }

  const lines = clean.split('\n');
  let commandLine = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].includes(input)) {
      commandLine = index;
      break;
    }
  }
  if (commandLine < 0) return false;
  return lines.slice(commandLine + 1).some((line) => line.trim().length > 0);
}

async function waitForLauncherOutput(
  actor: InterfaceActorContext,
  id: string,
  cwd: string,
  mode: WorkspaceMode,
  input: string,
  launcher: CliLauncher,
): Promise<string> {
  const deadline = Date.now() + 10_000;
  let latest = await capture(actor, id, cwd, mode);
  while (Date.now() < deadline) {
    if (launcherOutputReady(latest, input, launcher)) return latest;
    await sleep(250);
    latest = await capture(actor, id, cwd, mode);
  }
  return latest;
}

async function listSessions(actor: InterfaceActorContext, mode?: WorkspaceMode): Promise<TerminalSession[]> {
  let output = '';
  const prefix = actorPrefixForMode(actor, mode);
  try {
    output = await tmux([
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_created_string}\t#{session_attached}',
    ]);
  } catch {
    return [];
  }

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, created, attached] = line.split('\t');
      return { name, created, attached: attached === '1' };
    })
    .filter((s) => s.name.startsWith(prefix))
    .map((s) => ({
      id: s.name.slice(prefix.length),
      name: s.name.slice(prefix.length),
      created: s.created || '',
      attached: s.attached,
    }));
}

export async function GET(req: NextRequest) {
  try {
    const actorResult = await resolveInterfaceActorContext({ allowPersonalWorkspaceFallback: true });
    if (!actorResult.ok) return actorResult.response;
    const actor = actorResult.actor;
    const workspace = await resolveCwd(actor, {
      id: req.nextUrl.searchParams.get('id') || 'main',
      cwd: req.nextUrl.searchParams.get('cwd'),
      workspaceMode: req.nextUrl.searchParams.get('workspaceMode') || req.nextUrl.searchParams.get('workspace_mode'),
      githubForkUrl: req.nextUrl.searchParams.get('githubForkUrl') || req.nextUrl.searchParams.get('github_fork_url'),
    });

    const id = req.nextUrl.searchParams.get('id');
    if (id) {
      const safeId = sanitizeId(id);
      return NextResponse.json({
        id: safeId,
        workspace,
        output: await capture(actor, safeId, workspace.workspacePath || process.cwd(), workspace.mode),
      });
    }

    let sessions = await listSessions(actor, workspace.mode);
    const listOnly = req.nextUrl.searchParams.get('listOnly') === '1' ||
      req.nextUrl.searchParams.get('list_only') === '1';
    if (!listOnly && sessions.length === 0) {
      await ensureSession(actor, 'main', workspace.workspacePath || process.cwd(), workspace.mode);
      sessions = await listSessions(actor, workspace.mode);
    }
    return NextResponse.json({ sessions, workspace });
  } catch (error) {
    return terminalErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!requestOriginAllowed(req)) {
      return NextResponse.json({ error: 'origin_forbidden' }, { status: 403 });
    }

    const actorResult = await resolveInterfaceActorContext({ allowPersonalWorkspaceFallback: true });
    if (!actorResult.ok) return actorResult.response;
    const actor = actorResult.actor;

    let body: {
      action?: string;
      id?: string;
      input?: string;
      data?: string;
      key?: string;
      cwd?: string;
      cols?: number;
      rows?: number;
      launcher?: string;
      workspaceMode?: WorkspaceMode;
      workspace_mode?: WorkspaceMode;
      githubForkUrl?: string;
      github_fork_url?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const id = sanitizeId(body.id || 'main');
    const action = body.action || 'send';
    const workspace = await resolveCwd(actor, body);
    const cwd = workspace.workspacePath || process.cwd();

    if (action === 'create') {
      if (!(await sessionExists(actor, id, workspace.mode)) && (await listSessions(actor, workspace.mode)).length >= MAX_TERMINAL_SESSIONS_PER_ACTOR) {
        return NextResponse.json({ error: 'terminal_session_limit_reached' }, { status: 429 });
      }
      await ensureSession(actor, id, cwd, workspace.mode, body.cols, body.rows);
      return NextResponse.json({ id, workspace, output: await capture(actor, id, cwd, workspace.mode) });
    }

    if (action === 'resize') {
      await ensureSession(actor, id, cwd, workspace.mode, body.cols, body.rows);
      return NextResponse.json({ id, workspace, output: await capture(actor, id, cwd, workspace.mode) });
    }

    if (action === 'kill') {
      try {
        await tmux(['kill-session', '-t', tmuxName(actor, id, workspace.mode)]);
      } catch {
        // Already gone.
      }
      return NextResponse.json({ ok: true, sessions: await listSessions(actor, workspace.mode), workspace });
    }

    if (action === 'send') {
      await ensureSession(actor, id, cwd, workspace.mode, body.cols, body.rows);
      const input = String(body.input || '');
      if (input.length > 0) {
        await tmux(['send-keys', '-t', tmuxName(actor, id, workspace.mode), '-l', '--', input]);
      }
      await tmux(['send-keys', '-t', tmuxName(actor, id, workspace.mode), 'Enter']);
      const launcher = String(body.launcher || '');
      const output = input && CLI_LAUNCHERS.has(launcher)
        ? await waitForLauncherOutput(actor, id, cwd, workspace.mode, input, launcher as CliLauncher)
        : await capture(actor, id, cwd, workspace.mode);
      return NextResponse.json({ id, workspace, output });
    }

    if (action === 'raw') {
      await ensureSession(actor, id, cwd, workspace.mode, body.cols, body.rows);
      const key = String(body.key || '');
      const data = String(body.data || '').slice(0, 20000);
      if (data.length > 0) {
        await tmux(['send-keys', '-t', tmuxName(actor, id, workspace.mode), '-l', '--', data]);
      }
      if (key) {
        if (!ALLOWED_RAW_KEYS.has(key)) {
          return NextResponse.json({ error: 'invalid_terminal_key' }, { status: 400 });
        }
        await tmux(['send-keys', '-t', tmuxName(actor, id, workspace.mode), key]);
      }
      return NextResponse.json({ id, workspace, output: await capture(actor, id, cwd, workspace.mode) });
    }

    if (action === 'paste') {
      await ensureSession(actor, id, cwd, workspace.mode, body.cols, body.rows);
      const data = String(body.data || '');
      if (data.length > 0) {
        await tmux(['set-buffer', '-b', `${tmuxName(actor, id, workspace.mode)}-paste`, '--', data]);
        await tmux(['paste-buffer', '-b', `${tmuxName(actor, id, workspace.mode)}-paste`, '-t', tmuxName(actor, id, workspace.mode)]);
      }
      return NextResponse.json({ id, workspace, output: await capture(actor, id, cwd, workspace.mode) });
    }

    if (action === 'interrupt') {
      await ensureSession(actor, id, cwd, workspace.mode);
      await tmux(['send-keys', '-t', tmuxName(actor, id, workspace.mode), 'C-c']);
      return NextResponse.json({ id, workspace, output: await capture(actor, id, cwd, workspace.mode) });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return terminalErrorResponse(error);
  }
}
