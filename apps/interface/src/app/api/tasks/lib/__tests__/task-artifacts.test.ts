import fs from 'fs';
import os from 'os';
import path from 'path';

describe('taskArtifactUrl', () => {
  const originalRoot = process.env.PEARL_PUBLIC_TASK_ROOT;

  afterEach(() => {
    process.env.PEARL_PUBLIC_TASK_ROOT = originalRoot;
    jest.resetModules();
  });

  function load(root: string) {
    process.env.PEARL_PUBLIC_TASK_ROOT = root;
    jest.resetModules();
    return require('../task-artifacts') as typeof import('../task-artifacts');
  }

  it('returns a task artifact URL only when the html file exists in the workspace', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-artifacts-'));
    const workspace = path.join(root, 'tenant-a', 'user-1', 'task-1');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'index.html'), '<html></html>');
    const { taskArtifactUrl } = load(root);

    expect(taskArtifactUrl({
      id: 'task-1',
      workspace_path: workspace,
      result: `Built ${workspace}/index.html`,
    })).toBe('/api/tasks/artifact/task-1/index.html');
  });

  it('returns the default index artifact when the worker result omits the filename', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-artifacts-'));
    const workspace = path.join(root, 'tenant-a', 'user-1', 'task-1');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'index.html'), '<html></html>');
    const { taskArtifactUrl } = load(root);

    expect(taskArtifactUrl({
      id: 'task-1',
      workspace_path: workspace,
      result: 'Done.',
    })).toBe('/api/tasks/artifact/task-1/index.html');
  });

  it('returns a relative nested html artifact mentioned by the worker result', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-artifacts-'));
    const workspace = path.join(root, 'tenant-a', 'user-1', 'task-1');
    fs.mkdirSync(path.join(workspace, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'dist', 'index.html'), '<html></html>');
    const { taskArtifactUrl } = load(root);

    expect(taskArtifactUrl({
      id: 'task-1',
      workspace_path: workspace,
      result: 'Built the app at dist/index.html',
    })).toBe('/api/tasks/artifact/task-1/dist/index.html');
  });

  it('does not return a dead link when result text mentions html but no file exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-artifacts-'));
    const workspace = path.join(root, 'tenant-a', 'user-1', 'task-1');
    fs.mkdirSync(workspace, { recursive: true });
    const { taskArtifactUrl } = load(root);

    expect(taskArtifactUrl({
      id: 'task-1',
      workspace_path: workspace,
      result: `Built ${workspace}/index.html`,
    })).toBeNull();
  });

  it('rejects symlinked html artifacts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-artifacts-'));
    const workspace = path.join(root, 'tenant-a', 'user-1', 'task-1');
    fs.mkdirSync(workspace, { recursive: true });
    const target = path.join(root, 'outside.html');
    fs.writeFileSync(target, '<html></html>');
    fs.symlinkSync(target, path.join(workspace, 'index.html'));
    const { taskArtifactUrl } = load(root);

    expect(taskArtifactUrl({
      id: 'task-1',
      workspace_path: workspace,
      result: `Built ${workspace}/index.html`,
    })).toBeNull();
  });
});
