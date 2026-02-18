# Feature Modularization Plan (Option A Confirmed for HtmlContent)

Date: 2025-08-11

## Philosophy

Anything optional that can be turned off without breaking the core platform is a feature. Features live under `apps/interface/src/features/<Feature>` with thin integration points (UI wiring in `browser-window` and minimal API surface). This enables selective deployments and rapid POC spins.

## Decided Approach

HtmlContentViewer will be integrated into the existing `HtmlGeneration` feature (Option A). We will not create a separate `HtmlContent` feature at this time; instead we co-locate the viewer and its hook inside `features/HtmlGeneration` to reduce surface area.

## High-Level Phases

1. Inventory & Decision (DONE)
2. Extract thin UI features (MiniBrowser, Calculator, Terminal) (DONE)
3. Consolidate HtmlContentViewer into HtmlGeneration (DONE)
4. Relocate examples/docs into feature folders (PARTIAL: Html + Calculator done)
5. Add lightweight feature registry & toggles (DONE)
6. Optional smoke tests for each feature (PENDING / NICE TO HAVE)
7. Build, test, docs update, cleanup (IN PROGRESS)

## Checklist

- [x] Confirm HtmlContent strategy (Option A)
- [x] Confirm HtmlContent strategy (Option A)
- [x] Move `mini-browser-view.tsx` → `features/MiniBrowser`
- [x] Move `calculator-view.tsx` → `features/Calculator`
- [x] Move `terminal-view.tsx` → `features/Terminal`
- [x] Update `browser-window.tsx` imports to new feature paths
- [x] Remove legacy component files after import updates
- [x] Move `html-content-viewer.tsx` into `features/HtmlGeneration/components/` + adjust imports
- [x] Move related example files: html-content integration example, calculator example
- [x] Introduce feature registry & env toggles (`features/index.ts`)
- [x] Integrate toggles in `browser-window.tsx`
- [ ] Add minimal render tests (gmail, drive, miniBrowser, calculator, terminal, htmlGeneration)
- [ ] Full build & test pass (current builds green; add explicit checklist after tests)
- [ ] Update README / add FEATURES section referencing registry
- [ ] Final cleanup & report

<!-- Moved Admin Panel & Organization Roles Hardening and Password Reset Token Persistence sections to `admin-panel-plan.md` (2025-08-19) to consolidate planning docs. -->


## Notes

- Legacy component files (mini-browser, calculator, terminal, html-content-viewer shim) removed.
- Examples relocated into feature folders (HtmlGeneration + Calculator); remaining legacy examples can move later if needed.
- Feature flags default-enabled; naming: FEATURE_<UPPER_CAMEL_CASE> env override with off/false/0/disabled.
- Future enhancement: dynamic `import()` for disabled features to enable code splitting.
