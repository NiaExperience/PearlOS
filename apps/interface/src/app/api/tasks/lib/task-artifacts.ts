import fs from 'fs';
import path from 'path';

function publicTaskRoot(): string {
  return process.env.PEARL_PUBLIC_TASK_ROOT || '/srv/pearl-user-workspaces';
}

function existingArtifactPath(workspaceResolved: string, relativePath: string): string | null {
  const parts = relativePath.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '..' || part.includes('\\'))) {
    return null;
  }
  const filePath = path.resolve(workspaceResolved, ...parts);
  if (!filePath.startsWith(workspaceResolved + path.sep) && filePath !== workspaceResolved) {
    return null;
  }
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    const realWorkspace = fs.realpathSync(workspaceResolved);
    const realFile = fs.realpathSync(filePath);
    if (!realFile.startsWith(realWorkspace + path.sep) && realFile !== realWorkspace) {
      return null;
    }
    return parts.join('/');
  } catch {
    return null;
  }
}

function artifactCandidates(workspacePath: string, workspaceResolved: string, result: string): string[] {
  const candidates: string[] = [];
  const add = (value: string | undefined | null) => {
    const candidate = String(value || '').trim().replace(/^\.\/+/, '');
    if (!candidate || candidates.includes(candidate)) return;
    candidates.push(candidate);
  };

  for (const workspace of [workspacePath, workspaceResolved]) {
    const escaped = workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const explicit = result.match(new RegExp(`${escaped}/([^\\s\`'")]+\\.html)`, 'i'));
    add(explicit?.[1]);
  }

  const relativePattern = /(?:^|[\s`'"(:])((?:[A-Za-z0-9._-]+\/){0,8}[A-Za-z0-9._-]+\.html)\b/g;
  for (const match of result.matchAll(relativePattern)) {
    const candidate = match[1];
    if (!candidate || candidate.includes('..') || candidate.includes('\\')) continue;
    add(candidate);
  }

  add('index.html');
  add('dist/index.html');
  add('build/index.html');
  add('public/index.html');
  return candidates;
}

export function taskArtifactUrl(t: Record<string, unknown>): string | null {
  const id = String(t.id || t.taskId || '');
  if (!id) return null;
  const result = String(t.result || '');
  const workspacePath = typeof t.workspace_path === 'string' ? t.workspace_path : '';
  if (!workspacePath) return null;

  const workspaceResolved = path.resolve(workspacePath);
  const publicRoot = path.resolve(publicTaskRoot());
  if (!workspaceResolved.startsWith(publicRoot + path.sep)) return null;

  let relativePath: string | null = null;
  for (const candidate of artifactCandidates(workspacePath, workspaceResolved, result)) {
    relativePath = existingArtifactPath(workspaceResolved, candidate);
    if (relativePath) break;
  }
  if (!relativePath) return null;
  return `/api/tasks/artifact/${encodeURIComponent(id)}/${relativePath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
}
