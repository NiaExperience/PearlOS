import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';

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
const BLOCKED_COMMANDS = ['rm -rf /', 'mkfs', ':(){:|:&};:', 'dd if=/dev/zero'];

function isBlocked(command: string): boolean {
  const lower = command.toLowerCase().trim();
  return BLOCKED_COMMANDS.some((blocked) => lower.includes(blocked));
}

export async function POST(req: NextRequest) {
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
  const workDir = cwd && isAllowedPath(cwd) ? path.resolve(cwd) : os.homedir();

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
      newDir = os.homedir();
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
