/**
 * Tests for the exec task registry.
 *
 * Uses a temporary HOME so the registry writes into an isolated directory
 * and we can assert on the on-disk session store without touching real state.
 */

import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const originalHome = process.env.HOME;
let tmpHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'exec-registry-test-'));
  process.env.HOME = tmpHome;
  // Bust the module cache so SESSION_STORE resolves against the new HOME.
  jest.resetModules();
  const { __internal } = await loadModule();
  await __internal.writeStore({});
});

afterAll(async () => {
  process.env.HOME = originalHome;
});

async function loadModule() {
  return await import('../lib/exec-task-registry');
}

describe('isClaudeCliCommand', () => {
  it('detects bare claude invocations', async () => {
    const { isClaudeCliCommand } = await loadModule();
    expect(isClaudeCliCommand('claude --print "hi"')).toBe(true);
    expect(isClaudeCliCommand('claude-code --run')).toBe(true);
  });

  it('detects env-prefixed and chained invocations', async () => {
    const { isClaudeCliCommand } = await loadModule();
    expect(isClaudeCliCommand('HOME=/root claude --print "x"')).toBe(true);
    expect(isClaudeCliCommand('cd /tmp && claude')).toBe(true);
    expect(isClaudeCliCommand('echo x | claude')).toBe(true);
  });

  it('does not match unrelated commands or false positives', async () => {
    const { isClaudeCliCommand } = await loadModule();
    expect(isClaudeCliCommand('ls -la')).toBe(false);
    expect(isClaudeCliCommand('cat claude.log')).toBe(false);
    expect(isClaudeCliCommand('echo claudette')).toBe(false);
    expect(isClaudeCliCommand('')).toBe(false);
  });
});

describe('deriveLabel', () => {
  it('strips env-var prefixes and truncates long commands', async () => {
    const { deriveLabel } = await loadModule();
    expect(deriveLabel('HOME=/root FOO=bar claude --print "hi"')).toBe('claude --print "hi"');

    const long = 'claude --print "' + 'x'.repeat(200) + '"';
    const label = deriveLabel(long);
    expect(label.length).toBeLessThanOrEqual(80);
    expect(label.endsWith('...')).toBe(true);
  });

  it('cuts at the first redirection or pipe', async () => {
    const { deriveLabel } = await loadModule();
    expect(deriveLabel('claude --print "hi" | tee out.log')).toBe('claude --print "hi"');
    expect(deriveLabel('claude --print "hi" > out.log')).toBe('claude --print "hi"');
  });
});

describe('registerClaudeExecTask + completeClaudeExecTask', () => {
  it('returns null for non-claude commands and writes nothing', async () => {
    const { registerClaudeExecTask, __internal } = await loadModule();
    const result = await registerClaudeExecTask({ command: 'ls -la' });
    expect(result).toBeNull();
    const store = await __internal.readStore();
    expect(store).toEqual({});
  });

  it('writes a running session record with expected shape', async () => {
    const { registerClaudeExecTask, __internal } = await loadModule();
    const result = await registerClaudeExecTask({
      command: 'claude --print "hello world"',
      spawnedBy: 'test',
    });
    expect(result).not.toBeNull();
    expect(result!.sessionKey).toMatch(/^agent:claude-code:pearl-exec:/);

    const store = await __internal.readStore();
    const record = store[result!.sessionKey];
    expect(record).toBeDefined();
    expect(record.status).toBe('running');
    expect(record.label).toBe('claude --print "hello world"');
    expect(record.spawnedBy).toBe('test');
    expect(record.createdAt).toBe(record.updatedAt);
    expect(record.task).toContain('claude --print');
  });

  it('marks the session complete on success and failed on nonzero exit', async () => {
    const { registerClaudeExecTask, completeClaudeExecTask, __internal } = await loadModule();
    const ok = await registerClaudeExecTask({ command: 'claude --print "a"' });
    const bad = await registerClaudeExecTask({ command: 'claude --print "b"' });

    await completeClaudeExecTask(ok!.sessionKey, { exitCode: 0 });
    await completeClaudeExecTask(bad!.sessionKey, { exitCode: 2, stderr: 'boom' });

    const store = await __internal.readStore();
    expect(store[ok!.sessionKey].status).toBe('complete');
    expect(store[ok!.sessionKey].exitCode).toBe(0);
    expect(store[bad!.sessionKey].status).toBe('failed');
    expect(store[bad!.sessionKey].exitCode).toBe(2);
    expect(store[bad!.sessionKey].updatedAt).toBeGreaterThanOrEqual(store[bad!.sessionKey].createdAt);
  });

  it('is a no-op when completing an unknown session key', async () => {
    const { completeClaudeExecTask, __internal } = await loadModule();
    await completeClaudeExecTask('agent:claude-code:pearl-exec:does-not-exist', { exitCode: 0 });
    const store = await __internal.readStore();
    expect(store).toEqual({});
  });

  it('preserves other records when concurrent registrations interleave', async () => {
    const { registerClaudeExecTask, __internal } = await loadModule();
    const results = await Promise.all([
      registerClaudeExecTask({ command: 'claude --print "one"' }),
      registerClaudeExecTask({ command: 'claude --print "two"' }),
      registerClaudeExecTask({ command: 'claude --print "three"' }),
    ]);
    const store = await __internal.readStore();
    for (const r of results) {
      expect(store[r!.sessionKey]).toBeDefined();
    }
    expect(Object.keys(store)).toHaveLength(3);
  });
});
