# PearlOS Deep Link Reference

Deep links open PearlOS UI surfaces directly from a URL — settings tabs, work desktop mode, built-in apps, and specific notes.

**Production base URL**

```text
https://app.pearlos.org/pearlos
```

**Local development**

```text
http://localhost:3000/pearlos
```

Query parameters are stripped from the address bar after handling (clean URL in the browser).

---

## Quick reference

| Goal | Example URL |
|------|-------------|
| Open Settings → Connection | `https://app.pearlos.org/pearlos?settingsPanel=connections` |
| Switch to work desktop | `https://app.pearlos.org/pearlos?desktopMode=work` |
| Open Notes on work desktop | `https://app.pearlos.org/pearlos?desktopMode=work&openApp=notes` |
| Open Weather | `https://app.pearlos.org/pearlos?desktopMode=work&openApp=weather` |
| Open Studio (Creation Launchpad) | `https://app.pearlos.org/pearlos?desktopMode=work&openApp=studio` |
| Open a note by title | `https://app.pearlos.org/pearlos?noteTitle=My%20Note` |
| Open a note by ID | `https://app.pearlos.org/pearlos?noteId=<note-uuid>` |

---

## 1. Settings modal deep links

Opens the **Settings modal** (gear icon overlay), not the full `/settings` page.

**Parameter:** `settingsPanel=<panel-key>`

**Alternate entry:** `/settings?panel=<panel-key>` redirects to `/pearlos?settingsPanel=<panel-key>`.

### Visible settings tabs (sidebar)

| UI label | Panel key | Production URL |
|----------|-----------|----------------|
| Profile | `profile` | https://app.pearlos.org/pearlos?settingsPanel=profile |
| Connection | `connections` | https://app.pearlos.org/pearlos?settingsPanel=connections |
| Launch Mode | `launch-mode` | https://app.pearlos.org/pearlos?settingsPanel=launch-mode |
| Agency Boss | `agency-boss` | https://app.pearlos.org/pearlos?settingsPanel=agency-boss |
| Audio | `audio-preferences` | https://app.pearlos.org/pearlos?settingsPanel=audio-preferences |
| Webhooks | `webhooks` | https://app.pearlos.org/pearlos?settingsPanel=webhooks |
| Stored Information | `stored-information` | https://app.pearlos.org/pearlos?settingsPanel=stored-information |

### Supported but hidden in sidebar (still valid)

| Panel key | Production URL |
|-----------|----------------|
| `model-config` | https://app.pearlos.org/pearlos?settingsPanel=model-config |
| `channel-models` | https://app.pearlos.org/pearlos?settingsPanel=channel-models |
| `notifications` | https://app.pearlos.org/pearlos?settingsPanel=notifications |
| `appearance` | https://app.pearlos.org/pearlos?settingsPanel=appearance |
| `privacy` | https://app.pearlos.org/pearlos?settingsPanel=privacy |
| `contact` | https://app.pearlos.org/pearlos?settingsPanel=contact |

### Via `/settings` redirect

| Goal | URL (redirects to assistant modal) |
|------|-------------------------------------|
| Connection | https://app.pearlos.org/settings?panel=connections |
| Profile | https://app.pearlos.org/settings?panel=profile |

---

## 2. Desktop mode deep links

Switches PearlOS desktop surface (home vs work forest desktop).

**Parameters (either works):**

- `desktopMode=<mode>`
- `openDesktop=<mode>` (alias)

| Mode | Meaning | Production URL |
|------|---------|----------------|
| `work` | Work desktop (forest + app icons) | https://app.pearlos.org/pearlos?desktopMode=work |
| `desktop` | Same as `work` | https://app.pearlos.org/pearlos?desktopMode=desktop |
| `home` | Home / Stage screen | https://app.pearlos.org/pearlos?desktopMode=home |
| `creative` | Creative desktop mode | https://app.pearlos.org/pearlos?desktopMode=creative |
| `focus` | Focus mode | https://app.pearlos.org/pearlos?desktopMode=focus |
| `quiet` | Quiet mode | https://app.pearlos.org/pearlos?desktopMode=quiet |
| `relax` / `relaxation` | Relaxation mode | https://app.pearlos.org/pearlos?desktopMode=relax |
| `gaming` | Gaming mode | https://app.pearlos.org/pearlos?desktopMode=gaming |

> **Note:** Use `desktopMode` / `openDesktop`, not bare `?mode=`. The bare `mode` query param is reserved for applet session overrides (`resourceId` + creative applet flows).

---

## 3. App deep links (`openApp`)

Opens a built-in PearlOS app the same way (or as close as possible) to clicking its work-desktop icon.

**Parameters (either works):**

- `openApp=<slug>`
- `app=<slug>` (alias)

**Recommended:** combine with work desktop for Wonder Canvas apps (weather, news, Pearl Village):

```text
https://app.pearlos.org/pearlos?desktopMode=work&openApp=<slug>
```

If `desktopMode` is omitted, known apps auto-switch to work desktop so the handler can mount.

### Fully working apps (opens real UI)

| Desktop icon | `openApp` slug(s) | Production URL |
|--------------|-------------------|----------------|
| Notes | `notes`, `notepad`, `text` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=notes |
| Studio | `studio`, `launchpad`, `creation-launchpad` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=studio |
| YouTube | `youtube`, `video` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=youtube |
| Terminal | `terminal`, `cmd`, `command` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=terminal |
| Web Browser | `browser`, `chrome`, `web` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=browser |
| The News | `news`, `the-news`, `thenews` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=news |
| Weather | `weather` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=weather |
| Pearl Village (Discord) | `discord`, `pearl-village`, `village` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=discord |
| Creation Engine | `creation-engine`, `creation`, `creationengine` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=creation-engine |
| Photo Magic | `photo-magic`, `photomagic` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=photo-magic |
| Google Drive | `drive`, `google-drive`, `googledrive` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=drive |
| Gmail | `gmail`, `email` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=gmail |
| Daily Call | `dailycall`, `daily-call`, `call`, `meeting` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=dailycall |
| Sprites | `sprites`, `sprite` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=sprites |

### Browser with custom URL

| Goal | Production URL |
|------|----------------|
| Open browser at URL | `https://app.pearlos.org/pearlos?desktopMode=work&openApp=browser&browserUrl=https%3A%2F%2Fexample.com` |

**Example (Google):**

https://app.pearlos.org/pearlos?desktopMode=work&openApp=browser&browserUrl=https%3A%2F%2Fwww.google.com

### Coming soon apps (modal only — same as icon click)

These URLs show the **coming soon** placeholder modal. They do **not** open the live app.

| Desktop icon | `openApp` slug(s) | Production URL |
|--------------|-------------------|----------------|
| The Agency | `agency`, `the-agency`, `theagency`, `tasks`, `tasklist`, `task-list`, `rooms` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=agency |
| Pearl Vision | `pearl-vision`, `pearlvision`, `vision` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=pearl-vision |
| FileSpace | `filespace`, `files` | https://app.pearlos.org/pearlos?desktopMode=work&openApp=filespace |

---

## 4. Note deep links

Opens Notes and navigates to a specific note.

**Parameters (use one):**

| Param | Description |
|-------|-------------|
| `noteId` or `note_id` | Note UUID |
| `noteTitle` | Fuzzy title search |
| `note` | Alias for title search |

| Goal | Production URL |
|------|----------------|
| Open note by title | `https://app.pearlos.org/pearlos?noteTitle=Shopping%20List` |
| Open note by ID | `https://app.pearlos.org/pearlos?noteId=00000000-0000-0000-0000-000000000001` |
| Title alias | `https://app.pearlos.org/pearlos?note=Meeting%20Notes` |

### Combine with work desktop + Notes app

https://app.pearlos.org/pearlos?desktopMode=work&openApp=notes&noteTitle=Shopping%20List

Requires the `notes` feature flag enabled for the assistant.

---

## 5. Combined examples (common campaigns)

| Use case | Production URL |
|----------|----------------|
| Onboarding → connect accounts | https://app.pearlos.org/pearlos?settingsPanel=connections |
| Land on work desktop | https://app.pearlos.org/pearlos?desktopMode=work |
| Open Notes immediately | https://app.pearlos.org/pearlos?desktopMode=work&openApp=notes |
| Open Terminal for devs | https://app.pearlos.org/pearlos?desktopMode=work&openApp=terminal |
| Open Studio / Launchpad | https://app.pearlos.org/pearlos?desktopMode=work&openApp=studio |
| Weather at a glance | https://app.pearlos.org/pearlos?desktopMode=work&openApp=weather |
| News reader | https://app.pearlos.org/pearlos?desktopMode=work&openApp=news |
| Pearl Village / Discord connect | https://app.pearlos.org/pearlos?desktopMode=work&openApp=discord |
| Specific note in Notes | https://app.pearlos.org/pearlos?desktopMode=work&openApp=notes&noteTitle=My%20Note |
| Audio settings | https://app.pearlos.org/pearlos?settingsPanel=audio-preferences |
| Launch mode preference | https://app.pearlos.org/pearlos?settingsPanel=launch-mode |

---

## 6. Parameter reference

### Pearl app / desktop params (stripped after handle)

| Parameter | Alias | Purpose |
|-----------|-------|---------|
| `desktopMode` | `openDesktop` | Switch desktop mode |
| `openApp` | `app` | Open built-in app |
| `browserUrl` | — | URL for browser app |
| `noteId` | `note_id` | Open note by ID |
| `noteTitle` | `note` | Open note by title |

### Settings params (separate handler)

| Parameter | Alias | Purpose |
|-----------|-------|---------|
| `settingsPanel` | — | Open settings modal tab (on `/pearlos`) |
| `panel` | `settingsPanel` | On `/settings` only; redirects to assistant URL |

### Not handled by Pearl deep link handler

| Parameter | Used for |
|-----------|----------|
| `mode` | Applet session override (with `resourceId`) |
| `resourceId` | Load specific applet / creative session |
| `contentType` | Applet content type |
| `locked` | Lock session to resource |

---

## 7. Behavior notes

### URL cleanup

After the deep link runs, query params listed in section 6 are removed via client-side navigation (`router.replace`). The user sees a clean URL like `https://app.pearlos.org/pearlos`.

### Authentication

User must be logged in (same as normal PearlOS). Unsigned users follow the existing auth flow.

### Work desktop requirement

- **Wonder Canvas apps** (weather, news, discord) need the work desktop listener mounted. Use `desktopMode=work` or rely on auto-switch.
- **Avoid** `desktopMode=home&openApp=weather` — the app may not open because the work desktop is not active.

### Feature flags

Some apps respect assistant feature flags (e.g. `notes`, `youtube`, `dailyCall`, `vision`). If disabled for an assistant, the app may not appear or may no-op.

### Settings vs `openApp=settings`

Use `?settingsPanel=profile` (or another panel key). Do **not** use `?openApp=settings` — it does not open the settings modal correctly.

### Repeat visits in same tab

The same deep link URL may only fire once per SPA session until a full page reload (by design, to prevent duplicate opens).

---

## 8. Implementation map (for developers)

| Concern | File |
|---------|------|
| URL handler component | `apps/interface/src/components/AssistantPearlDeepLink.tsx` |
| Param parsing | `apps/interface/src/lib/assistant-deeplink.ts` |
| Desktop icon parity + queues | `apps/interface/src/lib/desktop-app-open.ts` |
| Window open queue | `apps/interface/src/features/ManeuverableWindow/lib/windowLifecycleController.ts` |
| Settings modal deep links | `apps/interface/src/components/PersistentNavButtons.tsx` |
| Settings panel keys | `apps/interface/src/components/settings-panels/SettingsPanels.tsx` |
| Work desktop + `openDesktopApp` | `apps/interface/src/components/desktop-background-work.tsx` |
| Mounted on assistant page | `apps/interface/src/app/[assistantId]/page.tsx` |

---

## 9. Staging vs production

Replace the host for staging testing:

```text
https://<your-staging-host>/pearlos?desktopMode=work&openApp=notes
```

Production:

```text
https://app.pearlos.org/pearlos?desktopMode=work&openApp=notes
```

Local:

```text
http://localhost:3000/pearlos?desktopMode=work&openApp=notes
```

---

## 10. Smoke test checklist (before/after deploy)

- [ ] `?settingsPanel=connections` → Settings modal, Connection tab
- [ ] `?desktopMode=work` → Forest work desktop
- [ ] `?desktopMode=work&openApp=notes` → Notes window
- [ ] `?desktopMode=work&openApp=weather` → Weather Wonder Canvas
- [ ] `?desktopMode=work&openApp=studio` → Creation Launchpad
- [ ] `?desktopMode=work&openApp=agency` → Coming soon modal (not live Agency)
- [ ] `?desktopMode=work&openApp=pearl-vision` → Coming soon modal
- [ ] `?desktopMode=work&openApp=filespace` → Coming soon modal
- [ ] `?noteTitle=…` → Opens that note in Notes
- [ ] Normal `/pearlos` (no params) → unchanged behavior
- [ ] Desktop icon clicks still work after visiting a deep link

---

*Last updated: 2026-06-09 — reflects PearlOS deep link handler, desktop-app-open queue, and coming-soon parity for Agency / Pearl Vision / FileSpace.*
