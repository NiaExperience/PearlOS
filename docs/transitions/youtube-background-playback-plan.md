# YouTube Background Playback Plan

## Objective
- Keep the YouTube feature playing continuously even when the desktop window is minimized or when the user launches additional apps.
- and if multiple apps show up don't open the youtube b
- Preserve the existing voice controls (`youtube.play`, `youtube.pause`, `youtube.next`, `apps.close youtube`, etc.) so the user can still stop playback via voice while the UI is hidden.

## Requirements / Acceptance Criteria
1. Minimizing the desktop window must not destroy the existing `YouTubeViewWrapper` instance. Audio should continue while the UI is hidden, and the minimized pill should be the only visible affordance.
2. Opening another app (e.g., Gmail) while a YouTube window is already active must not trigger a fresh search or player initialization. The currently playing video should continue uninterrupted inside the YouTube window tile when the grid view appears.
3. Voice commands and manual close actions must still pause/stop the player when the user explicitly closes the YouTube app.
4. No regressions to other window types (Daily Call, HtmlContent, etc.)—multi-window grid behavior and feature flags stay intact.

## Scope
- **In scope**
  - `apps/interface/src/components/browser-window.tsx`: lifecycle controller, window rendering tree, minimize handling.
  - `apps/interface/src/features/YouTube/components/YouTubeViewWrapper.tsx` and `youtube-view.tsx` if we need small adjustments (e.g., optional “headless/hidden” styling hook, avoid reinitializing on prop churn).
- **Out of scope**
  - Prism/Mesh data flows, new feature flags, or server-side YouTube search changes.
  - Adding brand-new UI chrome (e.g., background mini player) beyond the existing minimized pill.

## Proposed Changes
1. **Keep window surfaces mounted**
   - Remove the single-window conditional rendering branch and always render windows via `openWindows.map(...)`.
   - For the 1-window case, render the same surface component positioned full-screen so there is no React re-mount when switching between 1 ↔ 2 windows.
   - Memoize each window surface by `window.id` so content (notably the YouTube player) survives layout transitions.

2. **Minimize without unmounting**
   - Change the `status && showView` gating to always keep the BrowserWindow DOM subtree mounted when there are open windows.
   - When `status` is `false`, collapse the container height/opacity and disable pointer events instead of returning `null`. This keeps the iframe alive while still hiding it visually.
   - Ensure accessibility: mark the hidden region with `aria-hidden`, keep the existing minimized pill for restoration.

3. **Background playback safety**
   - When a YouTube window is closed (via UI or events) dispatch an explicit `youtubeControl` pause command so audio stops immediately.
   - Optionally add a lightweight “wasHidden” prop to `YouTubeViewWrapper` so we can pause rendering-intensive overlays while minimized but keep the player node intact.

4. **Reload mitigations**
   - Guard the YouTube search effect to skip duplicate searches when the same query is reused after layout churn.
   - Ensure `window.viewState.youtubeQuery` only updates when the assistant actually asks for a new search, preventing unnecessary prop changes.

## Testing Strategy
1. **Manual**
   - Launch YouTube via the assistant, then minimize the window. Observe that audio keeps playing and the minimized pill is shown. Restore and confirm playback never stopped.
   - Launch YouTube, then open Gmail (or another app) while the video plays. Verify that audio/video never restart when the layout flips to the grid.
   - Close the YouTube window via voice (`close youtube`) and ensure playback stops immediately, even if minimized.
2. **Automated**
   - Add/regress tests for the BrowserWindow renderer (React Testing Library) that verify a mock window component stays mounted when toggling between single and multi layout states.
   - Keep the existing `computeTargetVolume` tests (if any) passing.

## Risks & Mitigations
- **Large JSX refactor**: The BrowserWindow component is already ~3k lines; restructuring render logic could introduce regressions. Mitigation: isolate the window-surface rendering into a dedicated helper component with unit tests, and rely on TypeScript to catch prop mismatches.
- **Hidden iframe behavior**: Some browsers throttle hidden iframes. We will prefer `visibility: hidden` / zero-height rather than `display: none` to avoid suspending playback, and validate manually in Chrome.
- **Event leakage**: Keeping hidden components mounted means events/listeners stay attached. We will ensure cleanup still runs when windows truly close to avoid memory leaks.

## Open Questions / Follow-Ups
- Do we need a visual indicator (e.g., taskbar icon) showing that audio is playing while minimized? Out-of-scope for now unless product requests it.
- If future requirements need background playback for other media types, we may want a shared “MediaKeepAlive” abstraction.

