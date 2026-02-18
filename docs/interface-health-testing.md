# Interface Health Check Testing

This document describes how to test the health check endpoints we've added to the interface application, both locally and as part of the CI pipeline.

## Overview

We've added two health check endpoints to the interface:
- `/api/health` - Basic health check (fast response)
- `/api/health/deep` - Comprehensive health check (includes dependency checks)

## Local Testing

### Prerequisites
- Node.js 20+ installed
- Interface app built (`npm run build -w interface`)
- Docker installed (for Docker testing)

### Quick Test (Against Running Instance)

If you have the interface app running locally:

```bash
# Start the interface app (in one terminal)
npm run dev -w interface

# Test health endpoints (in another terminal)
npm run test:interface:health

# Verbose output for debugging
npm run test:interface:health:verbose
```

### Docker Container Testing

Test the complete Docker build and health checks:

```bash
# Build Docker image and test health endpoints
npm run test:interface:health:docker

# With verbose logging
npm run test:interface:health:docker -- --verbose
```

### Custom URL Testing

Test against a different URL (e.g., staging environment):

```bash
npm run test:interface:health -- --url=https://interface.stg.nxops.net
```

## Build and Test Workflow

Complete workflow for building and testing the interface container:

```bash
# 1. Build the interface app
npm run build -w interface

# 2. Test build artifacts exist
npm run test:build-artifacts

# 3. Test container startup
npm run test:ci-container:interface

# 4. Test health endpoints
npm run test:interface:health:docker

# OR run comprehensive deployment test (includes all above)
npm run test:build-deployment:docker
```

## CI Integration

The health check tests are now integrated into the CI pipeline:

1. **Container Validation**: `scripts/ci-validate-container.mjs` 
   - Tests container startup
   - Validates health endpoints automatically
   - Generates deployment validation report

2. **Smoke Tests**: `scripts/test-app-health.mjs --app=interface`
   - Comprehensive health endpoint testing
   - Tests both basic and deep health checks
   - Validates response structure and content

## Expected Outputs

### Successful Health Check Test
```
[17:30:15] ℹ️ Interface Health Check Smoke Tests
[17:30:15] ℹ️ Testing against: http://localhost:3000
[17:30:15] ⏳ Waiting for service at http://localhost:3000/api/health...
[17:30:16] ✅ Service is responding at http://localhost:3000/api/health
[17:30:16] 🏥 Running health check tests against http://localhost:3000...
[17:30:16] 🩺 Testing: Basic Health Check
[17:30:16] ✅ Basic Health Check passed
[17:30:16] 🩺 Testing: Deep Health Check
[17:30:17] ✅ Deep Health Check passed

📊 Test Summary:
✅ Passed: 2/2
🎉 All health check tests passed!
```

### What the Tests Check

**Basic Health Check (`/api/health`)**:
- Returns 200 status
- Contains required fields: `status`, `timestamp`, `service`
- `status` field equals "healthy"
- `service` field equals "interface"

**Deep Health Check (`/api/health/deep`)**:
- Returns 200 (healthy) or 503 (degraded/unhealthy) 
- Contains dependency check information
- Tests mesh connectivity if configured
- Provides detailed system status

## Troubleshooting

### "Service did not become available"
- Ensure the interface app is running on the expected port
- Check that health endpoints are accessible
- Verify no firewall blocking the port

### "Unexpected status XXX"
- Check application logs for startup errors
- Verify dependencies (mesh, database) are available
- Run with `--verbose` for detailed response information

### Docker Test Failures
- Ensure Docker is running
- Check that port 3333 is available
- Verify Docker build completes successfully

## Integration with ELB Health Checks

Once deployed, configure your ELB target group to use:
- **Health Check Path**: `/health` (nginx endpoint - fast)
- **Health Check Port**: 8080 (nginx port)
- **Success Codes**: 200

This will eliminate the 307 redirect logs you were seeing from ELB health checks hitting the root endpoint.