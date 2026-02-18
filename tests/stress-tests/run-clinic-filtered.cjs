#!/usr/bin/env node
/**
 * run-clinic-filtered.cjs
 * Enhanced clinic wrapper with post-processing to filter out Node.js/webpack internals
 * Shows only application code (apps/*, packages/prism/*, packages/*)
 */
const { spawn } = require('child_process');
const { readdirSync, unlinkSync, readFileSync, writeFileSync } = require('fs');
const path = require('path');

const mode = process.argv[2];
if (!mode || !['doctor','flame'].includes(mode)) {
  console.error('Usage: node tests/stress-tests/run-clinic-filtered.cjs <doctor|flame> [extra clinic args...]');
  process.exit(1);
}

// Remove root node_trace.*.log files
try {
  const entries = readdirSync(process.cwd());
  const traces = entries.filter(f => /^node_trace\.\d+\.log$/.test(f));
  if (traces.length) {
    traces.forEach(f => {
      try { unlinkSync(path.join(process.cwd(), f)); } catch (e) {}
    });
  }
} catch (e) {}

// Compose clinic command with --collect-only to post-process
const collectArgs = [mode, '--collect-only', '--on-port', "AC_BASE=http://localhost:$PORT node tests/stress-tests/profile-runner.cjs", '--', 'node', 'tests/stress-tests/interface-next-server.cjs'];
if (process.argv.length > 3) collectArgs.splice(1, 0, ...process.argv.slice(3));

console.log('[run-clinic-filtered] Collecting profile data...');

const profileDev = process.env.PROFILE_DEV === 'true';
const childEnv = { 
  ...process.env, 
  NODE_ENV: profileDev ? 'development' : 'production',
  PERF_FN_METRICS: 'false',
  // Add path filtering hints for profiler
  NODE_HIDE_INTERNALS: '1'
};

// Clear NODE_OPTIONS for stability
delete childEnv.NODE_OPTIONS;
delete childEnv.NPM_CONFIG_NODE_OPTIONS;
delete childEnv.npm_config_node_options;

if (profileDev) childEnv.PROFILE_DEV = 'true';

const collect = spawn('clinic', collectArgs, { stdio: 'inherit', env: childEnv });

collect.on('exit', (code, signal) => {
  if (code !== 0) {
    console.error(`[run-clinic-filtered] Collection failed: ${code || signal}`);
    process.exit(code || 1);
  }

  // Find the generated clinic directory inside .clinic/
  try {
    const clinicBaseDir = path.join(process.cwd(), '.clinic');
    if (!require('fs').existsSync(clinicBaseDir)) {
      console.error('[run-clinic-filtered] No .clinic directory found');
      process.exit(1);
    }

    const entries = readdirSync(clinicBaseDir);
    const clinicDir = entries
      .filter(f => f.endsWith(`.clinic-${mode}`) && !f.endsWith('.html'))
      .sort()
      .pop();

    if (!clinicDir) {
      console.error('[run-clinic-filtered] No clinic data directory found in .clinic/');
      process.exit(1);
    }

    const fullClinicPath = path.join(clinicBaseDir, clinicDir);
    console.log(`[run-clinic-filtered] Processing ${clinicDir}...`);

    // For flamegraph, we can filter the stack traces
    if (mode === 'flame') {
      filterFlamegraph(fullClinicPath);
    }

    // Visualize the filtered data
    console.log('[run-clinic-filtered] Generating visualization...');
    const visualize = spawn('clinic', [mode, '--visualize-only', fullClinicPath], { 
      stdio: 'inherit', 
      env: childEnv 
    });

    visualize.on('exit', (vCode) => {
      console.log(`[run-clinic-filtered] Complete! Filtered to show only application code.`);
      process.exit(vCode || 0);
    });

  } catch (error) {
    console.error('[run-clinic-filtered] Error processing data:', error.message);
    process.exit(1);
  }
});

/**
 * Filter flamegraph data to show only application code
 * Removes node_modules, node internals, webpack runtime
 */
function filterFlamegraph(clinicDir) {
  const stacksFile = path.join(clinicDir, 'profile-1.stacks');
  if (!require('fs').existsSync(stacksFile)) {
    console.warn('[run-clinic-filtered] No stacks file found, skipping filter');
    return;
  }

  try {
    let content = readFileSync(stacksFile, 'utf8');
    const lines = content.split('\n');
    const filtered = [];
    
    for (const line of lines) {
      if (!line.trim()) {
        filtered.push(line);
        continue;
      }

      // Split into stack and count
      const [stack, count] = line.split(' ');
      if (!stack || !count) {
        filtered.push(line);
        continue;
      }

      // Filter frames
      const frames = stack.split(';');
      const appFrames = frames.filter(frame => {
        // Keep application code
        if (frame.includes('/apps/')) return true;
        if (frame.includes('/packages/prism/')) return true;
        if (frame.includes('/packages/features/')) return true;
        if (frame.includes('/packages/events/')) return true;
        
        // Hide everything else
        if (frame.includes('node_modules')) return false;
        if (frame.includes('node:internal')) return false;
        if (frame.includes('webpack')) return false;
        if (frame.includes('[native]')) return false;
        if (frame.includes('next/dist')) return false;
        
        // Keep if it looks like user code (has /src/ or /lib/)
        return frame.includes('/src/') || frame.includes('/lib/');
      });

      // If we have app frames, keep this stack
      if (appFrames.length > 0) {
        filtered.push(`${appFrames.join(';')} ${count}`);
      }
    }

    // Write filtered stacks
    const filteredContent = filtered.join('\n');
    writeFileSync(stacksFile, filteredContent, 'utf8');
    console.log('[run-clinic-filtered] Filtered stack traces to application code');
    
  } catch (error) {
    console.warn('[run-clinic-filtered] Could not filter stacks:', error.message);
  }
}
