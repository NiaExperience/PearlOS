#!/usr/bin/env node
/**
 * Starts the Interface (Next.js) production build or dev build if no build exists.
 * Exits only on SIGINT/SIGTERM. Designed to be wrapped by Clinic which will
 * attach to this process. We intentionally avoid enabling PERF_FN_METRICS here
 * to reduce profiler distortion.
 */

const { spawn } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'apps', 'interface');
const nextDir = path.join(appDir, '.next');

const isBuilt = existsSync(nextDir);
const cmd = 'npm';
const args = ['run', isBuilt ? 'start' : 'dev'];
const env = { ...process.env, PORT: process.env.PORT || '3000' };

console.log(`[run-interface-next] Launching interface on port ${env.PORT} using ${isBuilt ? 'next start' : 'next dev'}...`);
if (!isBuilt) {
  console.log('[run-interface-next] No .next build found; using dev mode (slightly slower, includes hot reload). Consider running `npm -w apps/interface run build` for production profile.');
}

const proc = spawn(cmd, args, { cwd: appDir, stdio: 'inherit', env });

proc.on('exit', (code, signal) => {
  console.log(`[run-interface-next] Exited with code=${code} signal=${signal}`);
  process.exit(code || (signal ? 1 : 0));
});

// Keep process alive so Clinic can attach until underlying process exits.
process.on('SIGINT', () => proc.kill('SIGINT'));
process.on('SIGTERM', () => proc.kill('SIGTERM'));
