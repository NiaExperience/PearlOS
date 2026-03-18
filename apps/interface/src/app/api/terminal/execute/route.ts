import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import { requireAuth } from '@interface/lib/api-auth';

const execAsync = promisify(exec);

// Security: allow these root paths only
const ALLOWED_ROOTS = [os.homedir(), '/workspace', '/root', '/home', '/tmp'];

function isAllowedPath(dir: string): boolean {
  const resolved = path.resolve(dir);
  return ALLOWED_ROOTS.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );
}

// Commands that are blocked for safety
const BLOCKED_PATTERNS: RegExp[] = [
  // Destructive file operations
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|-[a-zA-Z]*r[a-zA-Z]*\s+)*\s*\/($|\s)/,  // rm -rf /
  /rm\s+.*--no-preserve-root/,
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+-[a-zA-Z]*f/,  // rm -rf variants
  /rm\s+-[a-zA-Z]*f[a-zA-Z]*\s+-[a-zA-Z]*r/,  // rm -fr variants
  // Filesystem format/destroy
  /mkfs/,
  /mkswap\s+\/dev/,
  /dd\s+.*of=\/dev/,
  /wipefs/,
  /shred\s+/,
  // Fork bomb
  /:\(\)\{.*\|.*&.*\};/,
  /\.{0}:\(\)/,
  // Permission destruction
  /chmod\s+000\s/,
  /chmod\s+-R\s+000/,
  /chmod\s+.*\/etc/,
  /chown\s+-R\s+.*\//,
  // System file tampering
  />\s*\/etc\//,
  /tee\s+\/etc\//,
  /cp\s+.*\/etc\/(passwd|shadow|sudoers)/,
  /echo\s+.*>\s*\/etc\//,
  // Remote code execution patterns
  /curl\s+.*\|\s*(ba)?sh/,
  /wget\s+.*\|\s*(ba)?sh/,
  /curl\s+.*\|\s*python/,
  /wget\s+.*\|\s*python/,
  /bash\s+-c\s+.*\$\(curl/,
  // Kill system processes
  /kill\s+-9\s+1\b/,
  /killall\s+-9/,
  // Dangerous system commands
  /shutdown/,
  /reboot/,
  /init\s+0/,
  /halt\b/,
  /poweroff/,
  // iptables flush (lock yourself out)
  /iptables\s+-F/,
  // Overwrite MBR
  /dd\s+.*of=.*sda/,
  // Python/perl reverse shells
  /python.*socket.*connect/,
  /perl.*socket.*INET/,
  // nohup + background evasion for blocked commands
  /nohup\s+rm\s/,
];

function isBlocked(command: string): boolean {
  const lower = command.toLowerCase().trim();
  // Also block simple exact matches
  const exactBlocks = ['rm -rf /', 'rm -rf /*', ':(){:|:&};:'];
  if (exactBlocks.some((b) => lower.includes(b))) return true;
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(lower));
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  let body: { command?: string; cwd?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { command, cwd } = body;

  if (!command || typeof command !== 'string') {
    return NextResponse.json({ error: 'Missing command' }, { status: 400 });
  }

  // Validate working directory
  const workDir = cwd && isAllowedPath(cwd) ? path.resolve(cwd) : '/workspace/nia-universal/';

  if (isBlocked(command)) {
    return NextResponse.json(
      { stdout: '', stderr: 'Command blocked for safety.', exitCode: 1, cwd: workDir },
      { status: 200 }
    );
  }

  // Handle `cd` specially since it affects the working directory for the response
  const cdMatch = command.trim().match(/^cd(?:\s+(.+))?$/);
  if (cdMatch) {
    const target = cdMatch[1]?.trim();
    let newDir: string;
    if (!target || target === '~') {
      newDir = '/workspace/nia-universal/';
    } else if (target === '-') {
      newDir = workDir; // can't track OLDPWD easily; stay put
    } else {
      newDir = path.resolve(workDir, target);
    }

    if (!isAllowedPath(newDir)) {
      return NextResponse.json(
        { stdout: '', stderr: `cd: ${target}: Permission denied`, exitCode: 1, cwd: workDir },
        { status: 200 }
      );
    }

    try {
      // Check if directory exists
      const { execSync } = await import('child_process');
      execSync(`test -d "${newDir}"`);
      return NextResponse.json({ stdout: '', stderr: '', exitCode: 0, cwd: newDir });
    } catch {
      return NextResponse.json(
        { stdout: '', stderr: `cd: ${target}: No such file or directory`, exitCode: 1, cwd: workDir },
        { status: 200 }
      );
    }
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout: 15000, // 15 second timeout
      maxBuffer: 1024 * 1024, // 1MB output limit
      env: {
        ...process.env,
        HOME: os.homedir(),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    return NextResponse.json({
      stdout: stdout,
      stderr: stderr,
      exitCode: 0,
      cwd: workDir,
    });
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean; signal?: string };
    if (error.killed) {
      return NextResponse.json({
        stdout: error.stdout ?? '',
        stderr: 'Command timed out after 15 seconds.',
        exitCode: 1,
        cwd: workDir,
      });
    }
    return NextResponse.json({
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? String(err),
      exitCode: error.code ?? 1,
      cwd: workDir,
    });
  }
}
