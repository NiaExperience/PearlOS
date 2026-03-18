# Sign-out Regression Plan

## Objective
Stop the interface sign-out flow from immediately re-authenticating users; ensure a hard logout that lands on the login page and stays logged out after refresh.

## Scope
- Interface app sign-out flows (UI triggers and `/api/auth/signout`).
- Auth cookie clearing and middleware redirects impacting logout.
- Client behaviors that may auto-log users back in.
- Out of scope: new auth providers or dashboard app.

## Files/Areas
- `apps/interface/src/app/api/auth/signout/route.ts`
- `apps/interface/src/components/*sign-out*` and `user-menu-dropdown.tsx`
- `apps/interface/src/middleware.ts` (login redirects/cookie clearing)
- `apps/interface/src/components/auth.tsx` (auto anonymous sign-in guard)

## Approach & Checkpoints
1) Reproduce via logs/browser traces; confirm cookies/session tokens after sign-out.
2) Harden sign-out: ensure server clears all auth cookies; client calls use server route before navigating; add skip-auto-login sentinel.
3) Verify middleware/login do not auto-init new sessions post-logout.
4) Validate with manual sign-out (expect login page) and targeted checks.

## Test Strategy
- Manual: click each sign-out entry (profile dropdown, sign-out button, user menu) → expect redirect to `/login` (or provided callback) without re-auth on refresh.
- Manual: after logout, reload protected assistant route → should stay on `/login`.
- Automated: run existing targeted tests impacted (`npm run test:js -- --runTestsByPath apps/interface/src/features/HtmlGeneration/__tests__/html-generation-components.test.tsx apps/interface/src/features/Notes/__tests__/notes-view.test.tsx`), since they stub sessions and rely on auth utilities.

## Risks & Mitigations
- Cookie deletion mismatch across domains/paths → delete with explicit paths/prefixes and chunk handling.
- Auto-guest sign-in still firing → gate on logout sentinel and login page context.
- Redirect loops if callback rejected → fall back to `/login` with safe absolute base.

## Success Criteria
- Sign-out clears cookies and does not auto-authenticate.
- Login page is shown after sign-out and persists on refresh until explicit login.
- No regressions in existing auth-dependent components/tests.
