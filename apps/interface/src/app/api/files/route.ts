import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface FSEntry {
  name: string;
  kind: 'folder' | 'file';
  size?: string;
  ext?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getExt(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === 0) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const HOME = os.homedir();
  const requestedPath = searchParams.get('path') ?? HOME;

  // Security: resolve to an absolute path and block traversal outside allowed roots.
  const resolved = path.resolve(requestedPath);
  const ALLOWED_ROOTS = [HOME, '/workspace', '/root', '/home'];
  const isAllowed = ALLOWED_ROOTS.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );

  if (!isAllowed) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return NextResponse.json({ error: 'Path not found' }, { status: 404 });
  }

  if (!stat.isDirectory()) {
    return NextResponse.json({ error: 'Not a directory' }, { status: 400 });
  }

  let names: string[];
  try {
    names = fs.readdirSync(resolved);
  } catch {
    return NextResponse.json({ error: 'Cannot read directory' }, { status: 500 });
  }

  const entries = names
    .map((name): FSEntry | null => {
      try {
        const fullPath = path.join(resolved, name);
        const s = fs.statSync(fullPath);
        if (s.isDirectory()) {
          return { name, kind: 'folder' as const };
        } else {
          return {
            name,
            kind: 'file' as const,
            size: formatSize(s.size),
            ext: getExt(name),
          };
        }
      } catch {
        return null;
      }
    })
    .filter((e): e is FSEntry => e !== null);

  return NextResponse.json({
    path: resolved,
    home: HOME,
    entries,
  });
}
