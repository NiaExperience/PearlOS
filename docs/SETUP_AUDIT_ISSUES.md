# Setup & Runtime Issues Audit

This document identifies all potential issues that could cause errors during setup and operation of the Nia Universal platform.

## 🔴 Critical Issues (Will Break Setup)
 
### 1. Non-UUID Strings Used Where UUIDs Expected

**Problem**: Several places use `'local-dev-admin'` as a user ID, but database queries expect valid UUIDs.

**Locations**:
- `apps/dashboard/src/app/dashboard/assistants/page.tsx:30` - Uses `'local-dev-admin'` as userId
- `apps/dashboard/src/app/dashboard/assistants/layout.tsx:27` - Uses `'local-dev-admin'` as userId  
- `apps/dashboard/src/app/api/assistant/route.ts:48` - Calls `getAllAssistantsForUser('local-dev-admin')`
- `apps/dashboard/src/app/api/assistants/route.ts:28` - Uses `'local-dev-admin'` as userId
- `apps/dashboard/src/app/api/users/me/route.ts:18-19` - Returns `'local-dev-admin'` as user ID

**Impact**: 
- Database queries fail with `"invalid input syntax for type uuid: \"local-dev-admin\""`
- `getUserTenantRoles()` fails because it queries with `parent_id = 'local-dev-admin'` (UUID column)
- `getTenantsForUser()` fails for the same reason

**Fix**: 
- ✅ Already fixed in `assistants/layout.tsx` and `assistants/page.tsx` - they now query all assistants directly
- ⚠️ Still needs fix: `apps/dashboard/src/app/api/assistant/route.ts:48` - calls `getAllAssistantsForUser('local-dev-admin')`
- ⚠️ Still needs fix: `apps/dashboard/src/app/api/assistants/route.ts` - uses `'local-dev-admin'` but should bypass user lookup

### 2. Redis Connection Failures in Local Dev

**Problem**: Redis is optional for local dev (`USE_REDIS=false`), but some code paths don't handle Redis being unavailable gracefully.

**Locations**:
- `apps/interface/src/lib/redis.ts` - ✅ Good: Has `USE_REDIS` check and lazy connection
- `apps/interface/src/features/HtmlGeneration/routes/status/route.ts` - ✅ Good: Checks `if (!redis)` and returns empty array
- `apps/pipecat-daily-bot/bot/bot_gateway.py` - ✅ Good: Has `USE_REDIS` checks and `TEST_BYPASS_REDIS`
- `apps/mesh/src/services/cache.service.ts` - ⚠️ May fail if Redis URL is invalid but `USE_REDIS=true`

**Impact**: 
- If `USE_REDIS=true` but Redis isn't running, some features may fail
- Cache service may throw errors instead of falling back to memory cache

**Fix**: Ensure all Redis usage checks `USE_REDIS` and has fallbacks.

### 3. Environment Variable Dependencies

**Problem**: Some environment variables are required but may be missing, causing silent failures or crashes.

**Critical Variables**:
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` - ✅ Handled by `ensure-postgres.ts`
- `MESH_SHARED_SECRET` - ✅ Handled by `sync-local-env.ts`
- `DISABLE_DASHBOARD_AUTH` - ✅ Handled by `sync-local-env.ts`
- `MESH_ENDPOINT` - ⚠️ May default to staging URL if not set
- `NEXTAUTH_URL` - ⚠️ May cause auth redirects if not set correctly
- `NEXTAUTH_SECRET` - ⚠️ Required for NextAuth but may be missing

**Impact**: 
- Auth may fail silently
- GraphQL requests may go to wrong endpoint
- NextAuth sessions may be invalid

**Fix**: Add validation script that checks all required env vars before startup.

### 4. Authentication Bypass Inconsistencies

**Problem**: Different parts of the codebase check `DISABLE_DASHBOARD_AUTH` differently, causing inconsistent behavior.

**Inconsistencies**:
- `apps/dashboard/src/middleware.ts` - Checks `DISABLE_DASHBOARD_AUTH === 'true'` OR localhost
- `apps/dashboard/src/app/dashboard/layout.tsx` - Checks `DISABLE_DASHBOARD_AUTH === 'true'` OR localhost  
- `apps/dashboard/src/app/dashboard/assistants/layout.tsx` - Checks `DISABLE_DASHBOARD_AUTH === 'true'` AND localhost (different logic!)
- `apps/dashboard/src/app/api/users/me/route.ts` - Checks `DISABLE_DASHBOARD_AUTH === 'true'` AND localhost
- `apps/dashboard/src/app/api/assistants/route.ts` - Checks `DISABLE_DASHBOARD_AUTH === 'true'` OR localhost

**Impact**: 
- Some pages work without auth, others don't
- Confusing developer experience
- Hard to debug why some routes work and others don't

**Fix**: Create a shared utility function `shouldDisableAuth(req)` that all code uses consistently.

## 🟡 Medium Issues (May Cause Confusion)

### 5. Database Table Creation

**Problem**: Setup scripts assume tables exist, but they may not be created automatically.

**Locations**:
- `scripts/seed-db.ts` - ✅ Good: Checks if table exists and creates it
- `apps/mesh/src/resolvers/db.ts` - ⚠️ May not create tables on first run
- `setup.sh` - ⚠️ Doesn't explicitly create database tables

**Impact**: 
- First-time setup may fail with "relation does not exist" errors
- Users need to manually run migrations or seed script

**Fix**: Ensure `setup.sh` or `npm run start:all` creates tables automatically.

### 6. Port Conflicts

**Problem**: Ports 3000, 4000, 2000, 4444, 8000 may already be in use.

**Current Handling**:
- ✅ `scripts/check-ports.sh` - Checks and offers to kill processes
- ✅ Runs automatically in `npm run start:all`

**Potential Issues**:
- Script may not work on all OS
- May kill wrong process if multiple apps use same port

**Fix**: Improve port detection and add better error messages.

### 7. File Watcher Limits (Linux)

**Problem**: `ENOSPC` error on Linux when file watcher limit is too low.

**Current Handling**:
- ✅ `scripts/fix-file-watchers.sh` - Increases inotify limit
- ✅ Runs automatically in `npm run start:all` with `--auto` flag

**Potential Issues**:
- Requires sudo for permanent fix
- Temporary fix is lost on reboot

**Fix**: Document permanent fix in setup instructions.

### 8. Missing Error Messages

**Problem**: Some errors don't provide helpful messages for debugging.

**Examples**:
- "Assistant creation returned no data" - doesn't say why
- "Unauthorized" - doesn't say what's missing
- Database connection errors - don't show connection details

**Fix**: Add more descriptive error messages with actionable guidance.

## 🟢 Low Issues (Minor Inconveniences)

### 9. Type Mismatches

**Problem**: Some TypeScript types don't match runtime data.

**Examples**:
- `NotionModel.content` is typed as `string` but database stores `JSONB` (object)
- Some API responses don't match TypeScript interfaces

**Impact**: 
- Type errors during development
- Runtime errors if types are wrong

**Fix**: Align TypeScript types with actual database schema.

### 10. Inconsistent Error Handling

**Problem**: Some functions throw errors, others return error objects, others return null.

**Impact**: 
- Hard to know how to handle errors
- Inconsistent error messages

**Fix**: Standardize error handling pattern across codebase.

## 📋 Recommended Fixes Priority

### Immediate (Block Setup)
1. ✅ Fix UUID validation in `assistants/layout.tsx` and `assistants/page.tsx` - DONE
2. ⚠️ Fix `apps/dashboard/src/app/api/assistant/route.ts` - Remove `getAllAssistantsForUser('local-dev-admin')` call
3. ⚠️ Fix `apps/dashboard/src/app/api/assistants/route.ts` - Ensure it doesn't use non-UUID user ID
4. ⚠️ Create shared `shouldDisableAuth()` utility function
5. ⚠️ Add environment variable validation script

### High Priority (Cause Confusion)
6. Ensure database tables are created automatically on first run
7. Improve port conflict detection and error messages
8. Document file watcher fix in setup instructions
9. Add better error messages throughout

### Medium Priority (Polish)
10. Standardize error handling patterns
11. Fix TypeScript type mismatches
12. Add comprehensive setup validation script

## ✅ Fixes Applied

### Fix 1: Removed Non-UUID User ID Usage ✅
- ✅ Fixed `apps/dashboard/src/app/api/assistant/route.ts` - Now queries assistants directly via Prism instead of using `getAllAssistantsForUser('local-dev-admin')`
- ✅ Fixed `apps/dashboard/src/app/api/assistants/route.ts` - Now queries assistants directly in local dev mode instead of using non-UUID user ID
- ✅ Fixed `apps/dashboard/src/app/dashboard/assistants/layout.tsx` - Already queries all assistants directly
- ✅ Fixed `apps/dashboard/src/app/dashboard/assistants/page.tsx` - Already queries all assistants directly

### Fix 2: Created Shared Auth Bypass Utility ✅
- ✅ Created `packages/prism/src/core/utils/auth-bypass.ts` with `shouldDisableAuth()` function
- ⚠️ **TODO**: Migrate all dashboard files to use this shared utility instead of inline checks

### Fix 3: Environment Variable Validation ⚠️
- ⚠️ **TODO**: Create `scripts/validate-env.ts` to check all required env vars before startup

## 📝 Testing Checklist

After fixes, verify:
- [ ] Dashboard loads without auth on localhost
- [ ] Interface `/demo` works without login
- [ ] Assistant creation works in local dev
- [ ] No UUID validation errors in logs
- [ ] Redis optional (works with `USE_REDIS=false`)
- [ ] Database tables created automatically
- [ ] Port conflicts handled gracefully
- [ ] File watcher limits handled on Linux
- [ ] Clear error messages for all failure cases

