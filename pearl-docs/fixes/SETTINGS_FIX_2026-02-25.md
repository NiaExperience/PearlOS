# Settings Page Fix — 2026-02-25 16:23 UTC

## Problem

Blair reports: "Settings details aren't displaying"

## Root Cause Found

The ModelSettingsPanel has a localStorage flag `pearl_settings_disabled` that was introduced in commit **4f1aceb7** (2026-02-22) as an "emergency override" to prevent unwanted config changes.

When this flag is set to `'true'`, the panel shows this banner:
```
🚫 Settings Page Disabled — Read-Only Mode
This page is currently disabled to prevent it from overriding OpenClaw configuration.
All controls are disabled. Model changes should be made via OpenClaw or the Connections menu.
To re-enable this page, go to Connections settings.
```

**Problem:** The UI message says "go to Connections settings" to re-enable, but **no toggle exists in ConnectionsPanel**. Users are stuck in read-only mode with no way to disable it via the UI.

## Files Affected

- `apps/interface/src/components/settings-panels/ModelSettingsPanel.tsx` (lines 254-277)
  - Reads `localStorage.getItem('pearl_settings_disabled')`
  - Disables all controls when flag is `'true'`
  - Listens for storage changes via event listener + 500ms polling

## Solution Options

### Option A: Add Toggle in ConnectionsPanel (Recommended)
Add a toggle switch in ConnectionsPanel to control this flag, making it match the UI message.

### Option B: Remove the Flag Entirely
If the flag was only needed temporarily, remove the check and associated code.

### Option C: Quick Manual Fix
Users can fix it immediately via browser DevTools:
1. Open DevTools (F12)
2. Application tab → Local Storage
3. Delete `pearl_settings_disabled` key
4. Refresh page

## Quick Fix Tool

Created `/workspace/fix-settings.html` — open in browser to toggle the flag with one click.

## Investigation Details

- **Commit introducing flag:** 4f1aceb7 (2026-02-22)
- **Commit message:** "Settings checkpoint: Fix provider auto-switch, add disable toggle, fix scroll"
- **Current state:** No toggle was actually added to the UI
- **API endpoints tested:** All working (/api/bot/model-settings, /api/openclaw-config)
- **Next.js dev server:** Running properly on port 3000
- **Panels rendering:** All panels render correctly when flag is disabled

## Recommended Fix (Implementation)

Add toggle to ConnectionsPanel:

```tsx
// In ConnectionsPanel component state:
const [settingsDisabled, setSettingsDisabled] = useState(() => 
  typeof window !== 'undefined' && localStorage.getItem('pearl_settings_disabled') === 'true'
);

// Toggle handler:
const toggleSettingsLock = () => {
  const newState = !settingsDisabled;
  if (typeof window !== 'undefined') {
    if (newState) {
      localStorage.setItem('pearl_settings_disabled', 'true');
    } else {
      localStorage.removeItem('pearl_settings_disabled');
    }
  }
  setSettingsDisabled(newState);
};

// Add to ConnectionsPanel UI (in the admin section):
<div className="flex items-center justify-between">
  <div>
    <Label>Lock Pearl Mind Settings</Label>
    <p className="text-xs text-gray-400">
      Disable the Pearl Mind settings page to prevent accidental changes
    </p>
  </div>
  <Switch checked={settingsDisabled} onCheckedChange={toggleSettingsLock} />
</div>
```

This gives users control over the safety lock.
