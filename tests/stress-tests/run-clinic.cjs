#!/usr/bin/env node
/**
 * run-clinic.cjs
 * Wrapper to:
 *  - Remove stale node_trace.*.log files that block Clinic runs
 *  - Invoke Clinic (doctor|flame|bubbleprof) with consistent arguments
 *  - Pass through additional CLI args
 */
const { readdirSync, unlinkSync } = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const mode = process.argv[2];
if (!mode || !['doctor','flame','bubbleprof'].includes(mode)) {
  console.error('Usage: node tests/stress-tests/run-clinic.cjs <doctor|flame|bubbleprof> [extra clinic args...]');
  process.exit(1);
}

// Remove root node_trace.*.log files
try {
  const entries = readdirSync(process.cwd());
  const traces = entries.filter(f => /^node_trace\.\d+\.log$/.test(f));
  if (traces.length) {
    traces.forEach(f => {
      try { unlinkSync(path.join(process.cwd(), f)); console.log(`[run-clinic] Deleted stale ${f}`); } catch (e) { console.warn(`[run-clinic] Failed to delete ${f}:`, e.message); }
    });
  }
} catch (e) {
  console.warn('[run-clinic] Unable to scan for node_trace logs:', e.message);
}

// Compose clinic command
const clinicArgs = [mode, '--on-port', "AC_BASE=http://localhost:$PORT node tests/stress-tests/profile-runner.cjs", '--', 'node', 'tests/stress-tests/interface-next-server.cjs'];
// Additional user args after mode
if (process.argv.length > 3) clinicArgs.splice(1, 0, ...process.argv.slice(3));

console.log('[run-clinic] Running clinic', clinicArgs.join(' '));

// Prefer prod for flamegraph to avoid dev + 0x stdout redirection issues
const profileDev = process.env.PROFILE_DEV === 'true' ? true : (mode === 'flame' ? false : process.env.PROFILE_DEV === 'false' ? false : false);
if (profileDev) {
  console.log('[run-clinic] PROFILE_DEV=true: running Clinic against a DEV Next server (no production build).');
} else if (mode === 'flame') {
  console.log('[run-clinic] Flamegraph will run against a production build by default. Set PROFILE_DEV=true to override.');
}
// Sanitize NODE_OPTIONS: filter out empty --require forms (e.g., '--r=') that crash Node
function sanitizeNodeOptions(val) {
  if (!val || typeof val !== 'string') return val;
  try {
    const parts = val.split(/\s+/).filter(Boolean);
    const cleaned = parts.filter(p => {
      // drop obviously invalid require flags
      if (p === '--r=' || p === '--require=' || p === '--r' || p === '--require') return false;
      if (p.startsWith('--require=') && p.trim() === '--require=') return false;
      if (p.startsWith('--r=') && p.trim() === '--r=') return false;
      return true;
    });
    return cleaned.join(' ');
  } catch {
    return undefined;
  }
}

const childEnv = { ...process.env, NODE_ENV: profileDev ? 'development' : 'production', PERF_FN_METRICS: 'false' };

// For stability during profiling, hard-clear NODE_OPTIONS unless explicitly disabled
const clearNodeOpts = process.env.FORCE_CLEAR_NODE_OPTIONS !== 'false';
if (clearNodeOpts) {
  delete childEnv.NODE_OPTIONS;
  delete childEnv.NPM_CONFIG_NODE_OPTIONS;
  delete childEnv.npm_config_node_options;
} else {
  const sanitizedNodeOpts = sanitizeNodeOptions(childEnv.NODE_OPTIONS);
  if (sanitizedNodeOpts !== undefined) childEnv.NODE_OPTIONS = sanitizedNodeOpts;
}
if (profileDev) childEnv.PROFILE_DEV = 'true';
const proc = spawn('clinic', clinicArgs, { stdio: 'inherit', env: childEnv });
proc.on('exit', (code, signal) => {
  console.log(`[run-clinic] Clinic finished code=${code} signal=${signal}`);
  process.exit(code || (signal ? 1 : 0));
});
