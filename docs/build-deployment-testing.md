# Build Deployment Testing

This document describes the build deployment testing scripts designed to catch deployment issues early in the development process, preventing errors like "Cannot find module /app/dist/server.js" that occur during Kubernetes deployments.

## Quick Start

```bash
# Quick check if all build artifacts exist
npm run test:build-artifacts

# Full build and startup verification
npm run test:build-deployment

# Test existing builds only (fast)
npm run test:build-deployment:quick

# Include Docker build testing
npm run test:build-deployment:docker

# Verbose output for debugging
npm run test:build-deployment:verbose
```

## Testing Scripts

### 1. Build Artifacts Verification (`test:build-artifacts`)

**File**: `scripts/test-build-artifacts.mjs`

**Purpose**: Quickly verifies that all expected build artifacts exist in the correct locations.

**What it checks**:
- `apps/mesh/dist/server.js` - Mesh GraphQL server
- `apps/interface/.next/BUILD_ID` - Interface Next.js app  
- `apps/dashboard/.next/BUILD_ID` - Dashboard Next.js app

**Use case**: Run this before deployments or in CI pipelines to ensure builds completed successfully.

### 2. Full Deployment Testing (`test:build-deployment`)

**File**: `scripts/test-build-deployment.mjs`

**Purpose**: Comprehensive testing that builds apps from scratch and verifies they can start successfully.

**Testing process**:
1. **Clean**: Removes existing build artifacts
2. **Build**: Runs `npm run build` for each workspace
3. **Verify**: Checks that build artifacts exist
4. **Startup**: Attempts to start each app and verify it doesn't crash
5. **Docker** (optional): Tests Docker image builds

**Available flags**:
- `--quick`: Skip builds, test existing artifacts
- `--docker`: Include Docker build testing  
- `--verbose`: Show detailed output from builds and startups

## Supported Applications

| App | Workspace | Build Artifact | Default Port |
|-----|-----------|---------------|--------------|
| **mesh** | `@nia/mesh-server` | `dist/server.js` | 2000 |
| **interface** | `interface` | `.next/BUILD_ID` | 3000 |
| **dashboard** | `dashboard` | `.next/BUILD_ID` | 4000 |

## Common Issues and Solutions

### TypeScript Compilation Errors

**Issue**: Build fails with TypeScript errors
```
error TS2339: Property 'auth' does not exist on type 'Request'
```

**Solution**: Check TypeScript configuration and ensure proper type definitions are installed.

### Missing Build Scripts

**Issue**: 
```
npm error Missing script: "clean"
```

**Solution**: Add missing scripts to `package.json`:
```json
{
  "scripts": {
    "clean": "rm -rf .next node_modules dist"
  }
}
```

### Wrong Build Output Directory

**Issue**: 
```
Cannot find module '/app/dist/server.js'
```

**Solution**: Verify TypeScript `outDir` and `rootDir` configuration:
```json
{
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

### Port Conflicts

**Issue**: Tests fail because ports are already in use

**Solution**: The scripts automatically kill processes on test ports before starting.

## Integration with CI/CD

### Pre-deployment Check
```bash
# Add to your deployment pipeline
npm run test:build-artifacts || exit 1
```

### Full Build Verification
```bash
# Add to your CI pipeline  
npm run test:build-deployment || exit 1
```

### GitHub Actions Example
```yaml
- name: Verify Build Artifacts
  run: npm run test:build-artifacts

- name: Test Deployment Readiness
  run: npm run test:build-deployment:quick
```

## Troubleshooting

### Verbose Mode
For detailed debugging information:
```bash
npm run test:build-deployment:verbose
```

### Manual Testing
Test individual apps:
```bash
# Build specific app
npm run build -w @nia/mesh-server

# Check artifacts exist
ls -la apps/mesh/dist/server.js

# Test startup manually
cd apps/mesh && npm start
```

### Docker Testing
Test Docker builds (requires Docker):
```bash
npm run test:build-deployment:docker
```

## Script Output Examples

### Success
```
🔍 Verifying Build Artifacts for Deployment
==================================================
✅ mesh: apps/mesh/dist/server.js
✅ interface: apps/interface/.next/BUILD_ID
✅ dashboard: apps/dashboard/.next/BUILD_ID
==================================================
🎉 All build artifacts present! Apps should deploy successfully.
```

### Failure
```
❌ mesh: Missing apps/mesh/dist/server.js
⚠️ Missing build artifacts detected!

🔧 To fix:
  1. Run: npm run build
  2. Or build individual apps: npm run build -w <workspace-name>
  3. Then re-run this check: npm run test:build-artifacts
```

## Development Workflow

1. **After making changes**: `npm run test:build-artifacts`
2. **Before committing**: `npm run test:build-deployment:quick`  
3. **Before major deployments**: `npm run test:build-deployment`
4. **For Docker deployments**: `npm run test:build-deployment:docker`

This testing strategy helps catch deployment issues early and ensures reliable deployments to Kubernetes and other platforms.
