# Testing Checklist - Sharing Tools & Organization Cleanup

**Branch:** `staging-sharing-tools`  
**Date:** October 31, 2025

---

## ✅ Completed Automated Tests

### Bot Sharing Actions (`test_sharing_actions.py`)
- ✅ Organization creation for call sharing
- ✅ Organization reuse for existing calls
- ✅ Write permissions: Owner, Member, Viewer roles
- ✅ Delete permissions: Owner, Admin, Member roles
- ✅ Share permissions: Owner, Admin roles
- ✅ Get user role for resource
- ✅ Update user organization role
- **Result:** 12/12 tests passing

### Build Validation
- ✅ Dashboard TypeScript compilation successful
- ✅ No isActive-related type errors
- ✅ Python syntax validation passed

---

## 🧪 Manual Integration Testing Checklist

### 1. Session History Privacy 🔒
**Objective:** Verify session history only appears in private sessions

- [x] **Private Session Test**
  - Start a private bot session (set `private: true` in metadata)
  - Verify participant context includes session history
  - Check logs for session history parsing

- [x] **Public Session Test**
  - Start a public/standard bot session
  - Verify participant context does NOT include session history
  - Confirm no session history in greeting

---

### 2. Applet Tools 📱
**Objective:** Verify applet state management and sharing

- [ ] **Set Applet by ID**
  - Call `bot_load_html_applet` with valid applet ID
  - Verify applet becomes active
  - Check APPLET_OPEN event emitted
  - Confirm auto-sharing with all call participants (in multi-user session)

- [ ] **Set Applet by Title (Fuzzy Search)**
  - Call `bot_load_html_applet` with partial applet title
  - Verify fuzzy search finds correct applet
  - Check applet set successfully
  - Confirm participants have access

- [ ] **Applet State Persistence**
  - Set applet in room A
  - Switch to room B
  - Return to room A
  - Verify applet still active (room-level state)

---

### 3. Role Management Tools 👥
**Objective:** Verify permission upgrades/downgrades work correctly

- [ ] **Upgrade User Access**
  - Create organization and share resource with MEMBER
  - Call `bot_upgrade_user_access` for that user
  - Verify user role changes to ADMIN
  - Check RESOURCE_ACCESS_CHANGED event emitted
  - Confirm user can now perform admin actions

- [ ] **Downgrade User Access**
  - User with ADMIN role on resource
  - Call `bot_downgrade_user_access`
  - Verify user role changes to VIEWER
  - Check RESOURCE_ACCESS_CHANGED event emitted
  - Confirm user can no longer edit/delete

- [ ] **Permission Validation**
  - VIEWER tries to edit resource → blocked
  - MEMBER tries to delete resource → blocked
  - ADMIN tries to delete resource → allowed
  - Only OWNER can share resource → verified

- [ ] **Event Stream Verification**
  - Monitor event stream during role changes
  - Verify RESOURCE_ACCESS_CHANGED contains:
    - `resourceId`, `resourceType`
    - `userId`, `oldRole`, `newRole`
    - Proper PII redaction

---

### 4. Organization Management (isActive Cleanup) 🏢
**Objective:** Verify organizations work without isActive field

- [ ] **Dashboard Admin UI**
  - Navigate to `/dashboard/admin/tenants`
  - Select a tenant
  - Create new organization → success
  - Edit organization name → success
  - Verify no "Inactive" badges shown
  - Verify no Deactivate/Reactivate buttons
  - Check organization list renders cleanly

- [ ] **Bot Organization Operations**
  - Create call sharing organization via bot
  - Add UserOrganizationRole without isActive
  - Share resource with organization
  - Verify resource accessible to org members
  - Check role queries don't filter by isActive

- [ ] **API Endpoints**
  - POST `/api/organizations` → no isActive in payload
  - PATCH `/api/organizations` → no isActive updates
  - GET `/api/organizations` → no isActive in response
  - All operations succeed without field

---

### 5. Permission System End-to-End 🔐
**Objective:** Verify complete permission flow

- [ ] **Owner Permissions**
  - Owner creates note
  - Owner can read, write, delete, share → all allowed
  - Check `check_resource_owner()` returns true

- [ ] **Admin Permissions via Organization**
  - Create organization
  - Add user as ADMIN
  - Share resource with organization
  - Admin can read, write, delete → allowed
  - Admin cannot share → blocked

- [ ] **Member Permissions**
  - Add user as MEMBER to organization
  - Member can read, write → allowed
  - Member cannot delete or share → blocked

- [ ] **Viewer Permissions**
  - Add user as VIEWER to organization
  - Viewer can read → allowed
  - Viewer cannot write, delete, or share → blocked

- [ ] **Cross-Resource Permissions**
  - Test with both Note and HtmlGeneration types
  - Verify permission checks work for both
  - Check get_resource_by_id uses correct plurals

---

### 6. Regression Testing 🔄
**Objective:** Ensure existing functionality still works

- [ ] **Note Management**
  - Create, open, update, delete notes
  - Verify note state persists per room
  - Check NOTE_OPEN events

- [ ] **Call Sharing Organizations**
  - Automatic organization creation on share
  - Organization reuse for same participants
  - Multiple resources in same organization

- [ ] **Event System**
  - All events have proper descriptors
  - PII redaction working
  - Event IDs match enum values

---

## 📊 Verification Commands

```bash
# Run all bot tests
cd apps/pipecat-daily-bot/bot
poetry run pytest tests/test_sharing_actions.py -v

# Build dashboard
npm run build --workspace=dashboard

# Type check all TypeScript
npm run build --workspace=interface

# Check for lingering isActive references
grep -r "isActive" apps/dashboard/src --include="*.ts" --include="*.tsx" | grep -v node_modules

# Verify organization definition
cat packages/prism/src/core/platform-definitions/Organization.definition.ts

# Run full test suite
npm test
```

---

## 🎯 Success Criteria

### Must Pass
- ✅ All 12 automated tests passing
- ✅ Dashboard builds without errors
- ✅ No isActive references in active code
- ⏳ Applet tools work in live session
- ⏳ Role management correctly updates permissions
- ⏳ Organizations function without isActive field

### Nice to Have
- ⏳ Performance tests for permission checks
- ⏳ Stress test with many organization members
- ⏳ UI tests for admin organization panel

---

## 📝 Implementation Summary

### Features Completed
1. **Session History Privacy** - Conditionally includes session history only in private sessions
2. **Applet State Management** - Room-level applet tracking with get/set/clear functions
3. **Applet Tools** - `bot_load_html_applet` with fuzzy search
4. **Role Management** - `bot_upgrade_user_access` and `bot_downgrade_user_access` convenience wrappers
5. **Permission Tests** - 12 comprehensive tests for OWNER/ADMIN/MEMBER/VIEWER roles
6. **Organization Cleanup** - Removed unused `isActive` field from Organization model

### Files Modified
- `apps/pipecat-daily-bot/bot/handlers.py` - Session history privacy
- `apps/pipecat-daily-bot/bot/bot.py` - Applet state management
- `apps/pipecat-daily-bot/bot/tools/sharing_tools.py` - Applet and role management tools
- `apps/pipecat-daily-bot/bot/actions/sharing_actions.py` - Fixed get_resource_by_id, removed isActive
- `apps/pipecat-daily-bot/bot/tests/test_sharing_actions.py` - Permission tests
- `packages/prism/src/core/platform-definitions/Organization.definition.ts` - Removed isActive
- `apps/dashboard/src/hooks/use-organizations.ts` - Removed isActive handling
- `apps/dashboard/src/app/dashboard/admin/tenants/page.tsx` - Removed deactivate/reactivate UI

---

## 🚀 Next Steps

1. Complete manual integration testing (sections 1-6)
2. Verify all checklist items pass
3. Document any issues found
4. Create PR for merge to `staging`
5. Plan deployment strategy
