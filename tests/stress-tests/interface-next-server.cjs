#!/usr/bin/env node
/**
 * Programmatic Next.js production server launcher for Clinic profiling.
 * Key differences from prior version:
 *  - Uses Next.js programmatic API instead of `next start` so we control `server.listen(0)`.
 *  - Listening on port 0 lets Clinic detect the chosen port and substitute $PORT in --on-port cmd.
 *  - Ensures production build exists (creates it if missing via `npm run build`).
 */
const { spawnSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');
const http = require('http');
const next = require('next');
// Optional runtime function metrics (no-op unless PERF_FN_METRICS=true)
require('./runtime-fn-instrumentation.cjs');

// Decide dev vs prod mode early
const root = path.resolve(__dirname, '../..');
const appDir = path.join(root, 'apps', 'interface');
const nextDir = path.join(appDir, '.next');
const buildIdFile = path.join(nextDir, 'BUILD_ID');

// Ensure children (jest-worker, etc.) don't inherit invalid NODE_OPTIONS
delete process.env.NODE_OPTIONS;
delete process.env.NPM_CONFIG_NODE_OPTIONS;
delete process.env.npm_config_node_options;

// Only honor explicit PROFILE_DEV. If production is desired and the build is missing,
// we'll trigger a build instead of silently falling back to dev mode.
const profileDev = process.env.PROFILE_DEV === 'true';
process.env.NODE_ENV = profileDev ? 'development' : 'production';

if (!profileDev) {
  if (!existsSync(buildIdFile)) {
    console.log('[interface-next-server] Production build missing (no BUILD_ID). Running build...');
    const build = spawnSync('npm', ['run', 'build'], { cwd: appDir, stdio: 'inherit' });
    if (build.status !== 0) {
      console.error('[interface-next-server] Build failed; aborting');
      process.exit(build.status || 1);
    }
  } else {
    console.log('[interface-next-server] Found production build (BUILD_ID present).');
  }
} else {
  console.log('[interface-next-server] PROFILE_DEV enabled or build missing; starting Next in DEV mode (no production build).');
}

const app = next({ dir: appDir, dev: profileDev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    handle(req, res);
  });
  const desiredPort = process.env.PORT && !isNaN(Number(process.env.PORT)) ? Number(process.env.PORT) : 0;
  server.listen(desiredPort, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : address;
    console.log(`[interface-next-server] Next.js ready on port ${actualPort} (requested ${desiredPort || 'random'})`);
    // Ensure NextAuth sees the correct external URL for this ephemeral port
    const nextauthUrl = `http://localhost:${actualPort}`;
    process.env.NEXTAUTH_URL = nextauthUrl;
    process.env.NEXTAUTH_URL_INTERNAL = nextauthUrl;
    console.log(`[interface-next-server] Set NEXTAUTH_URL=${nextauthUrl}`);
  });

  const shutdown = (sig) => {
    console.log(`[interface-next-server] Received ${sig}, shutting down.`);
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}).catch(err => {
  console.error('[interface-next-server] Failed to start Next.js programmatically:', err);
  process.exit(1);
});
