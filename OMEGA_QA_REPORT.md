# PearlOS Omega Stage — Full QA Report

> **Date:** 2026-04-19
> **Branch:** `PearlOS_OmegaStage` @ `c8afcbe6`
> **Agents Deployed:** 35 (25 review + 10 adversarial)
> **Phases:** 5 (Interface, Voice, Data, Features, Infrastructure)

---

## EXECUTIVE SUMMARY

35 agents crawled the entire PearlOS codebase across 5 phases. The system is **architecturally sound** — routing is clean, provider hierarchy is acyclic, event system is well-structured. However, adversarial agents uncovered **significant security vulnerabilities** that need immediate attention before any production deployment.

### Severity Breakdown (All Phases Combined)

| Severity | Count | Trend |
|----------|:-----:|-------|
| **CRITICAL** | 9 | Needs immediate fix |
| **HIGH** | 18 | Fix before next release |
| **MEDIUM** | 28 | Address in sprint |
| **LOW** | 22 | Track in backlog |
| **PASS** | 40+ | Areas with no issues |

---

## CRITICAL FINDINGS (Fix Immediately)

### C1. Twilio Auth Token Exposed to Browser
- **Phase:** P1 (Interface Config)
- **File:** `apps/interface/next.config.mjs:33`, `src/config/env.config.ts:11`
- **Issue:** `NEXT_PUBLIC_TWILIO_AUTH_TOKEN` sends the auth token to every browser client
- **Impact:** Anyone can impersonate the Twilio account
- **Fix:** Remove `NEXT_PUBLIC_` prefix; handle auth server-side only

### C2. SQL Injection in NotionModelResolver
- **Phase:** P3 (Data Layer)
- **File:** `apps/mesh` — NotionModelResolver using `Sequelize.literal()` with unsanitized input
- **Impact:** Full database compromise via crafted input
- **Fix:** Use parameterized queries / Sequelize `Op` operators

### C3. XSS via dangerouslySetInnerHTML in Notes
- **Phase:** P1 (Adversarial)
- **File:** `features/Notes/components/notes-view.tsx`
- **Issue:** Note content rendered without DOMPurify sanitization (contrast: `notes-view-next.tsx` correctly uses DOMPurify)
- **Impact:** Stored XSS — malicious note content executes in all viewers
- **Fix:** Apply `DOMPurify.sanitize()` consistently

### C4. LinkMap Actions — Zero Authentication
- **Phase:** P1 (Config & Actions)
- **File:** `features/ResourceSharing/actions/linkmap-actions.ts`
- **Issue:** No session check, `tenantId='any'` — anyone can create/list/delete short URLs
- **Impact:** Data leakage, resource abuse
- **Fix:** Add `getSessionSafely()` check and tenantId validation

### C5. OpenClaw API Key Exposed to Client
- **Phase:** P1 (Adversarial)
- **Issue:** OpenClaw API key available in browser context
- **Fix:** Move to server-side only

### C6. SSRF via Enhanced Proxy
- **Phase:** P1 (Adversarial)
- **File:** `features/MiniBrowser/routes/enhanced-proxy/[...url]/route.ts`
- **Issue:** Proxy fetches arbitrary URLs without sufficient origin/target validation
- **Impact:** Internal network scanning, cloud metadata access
- **Fix:** Allowlist target domains or block RFC1918/link-local ranges

### C7. GraphQL Mutations Missing Authentication
- **Phase:** P3 (Data Layer Adversarial)
- **Issue:** No authorization guards on GraphQL mutations in Mesh
- **Impact:** Unauthenticated data modification
- **Fix:** Add auth middleware to all mutation resolvers

### C8. Hardcoded Secrets in Environment Files
- **Phase:** P3 (Adversarial)
- **Issue:** Multiple `.env` backup files with real credentials tracked or accessible
- **Fix:** Ensure all `.env*` files are in `.gitignore`; rotate exposed credentials

### C9. AES-256-CBC Without HMAC
- **Phase:** P3 (Data Layer)
- **File:** `packages/prism/src/core/utils/encryption.ts`
- **Issue:** Claims authenticated encryption but lacks HMAC — vulnerable to padding oracle attacks
- **Fix:** Add HMAC verification or switch to AES-256-GCM

### C10. Redis No Maxmemory Policy — OOM Risk
- **Phase:** P3 (Data Layer)
- **File:** `packages/redis/src/config/environments.ts`
- **Issue:** No `maxmemory` or eviction policy configured — Redis will consume unlimited memory until OOM kill
- **Fix:** Set `maxmemory` with `volatile-lru` or `allkeys-lru` eviction

### C11. Prism Connection Pooling — No Pooling, Fragile Cleanup
- **Phase:** P3 (Data Layer)
- **File:** `packages/prism/src/data-bridge/PrismGraphQLClient.ts`
- **Issue:** Single GraphQL client instance, 10ms hardcoded cleanup timeout, `global.gc()` dependency, process cleanup only in test env
- **Fix:** Implement proper connection pooling with configurable limits

---

## HIGH FINDINGS (Fix Before Release)

### H1. 19 postMessage Handlers Without Origin Validation
- **Phase:** P1 (Adversarial)
- **Files:** `useDesktopModeSwitchListener.ts`, `FilesView.tsx`, `HtmlContentViewer.tsx`, `desktop-background-switcher.tsx`, `desktop-taskbar.tsx`, and 14 more
- **Impact:** Any page that can iframe the app can send arbitrary commands
- **Fix:** Add `event.origin` checks to all `window.addEventListener('message', ...)` handlers

### H2. Test Mode Auth Bypass in Production
- **Phase:** P1 (Adversarial)
- **File:** `middleware.ts:36-51`, `lib/api-auth.ts:14-21`
- **Issue:** `NEXT_PUBLIC_TEST_ANONYMOUS_USER=true` bypasses ALL auth; uses `NEXT_PUBLIC_` prefix
- **Fix:** Remove `NEXT_PUBLIC_` prefix from test flags; add production guard

### H3. No Content-Security-Policy Headers
- **Phase:** P1 (Adversarial)
- **File:** `next.config.mjs`
- **Issue:** No CSP, no X-Frame-Options — app can be iframed (clickjacking)
- **Fix:** Add CSP and frame-ancestors headers

### H4. GraphQL Introspection Enabled in Production
- **Phase:** P3 (Adversarial)
- **Issue:** Schema discovery available to attackers
- **Fix:** Disable introspection when `NODE_ENV=production`

### H5. CORS Wildcard on Mesh API
- **Phase:** P3 (Adversarial)
- **Issue:** Overly permissive CORS allowing any origin
- **Fix:** Restrict to known frontend origins

### H6. Token Cache Missing TTL (DailyCall)
- **Phase:** P2 (DailyCall)
- **File:** `features/DailyCall/lib/tokenClient.ts`
- **Issue:** In-memory token cache never expires — stale tokens reused after expiry
- **Fix:** Add TTL-based cache eviction

### H7. Rive Canvas Memory Leak
- **Phase:** P2 (Avatar Adversarial)
- **Issue:** Rive canvas instances not cleaned up on unmount in PearlMultiMenu
- **Fix:** Call `rive.cleanup()` in useEffect return

### H8. VoiceSessionProvider Context Not Memoized
- **Phase:** P1 (Adversarial)
- **File:** `hooks/useVoiceSession.ts`
- **Issue:** Context value object recreated every render → cascading re-renders across entire app tree
- **Fix:** Wrap context value in `useMemo`

### H9. innerHTML Usage in Desktop Background Worker
- **Phase:** P1 (Adversarial)
- **File:** `components/desktop-background-work.tsx:647,709,785,846,854,877`
- **Issue:** External data rendered via `.innerHTML` without sanitization
- **Fix:** Use DOMPurify or textContent

### H10. Infinite Effect Loop in use-toast.ts
- **Phase:** P1 (Hooks)
- **File:** `hooks/use-toast.ts:174`
- **Issue:** `[state]` dependency triggers effect that modifies state
- **Fix:** Change dependency array to `[]`

### H11. Fake `fs` Polyfill in Production Dependencies
- **Phase:** P1 (Config)
- **File:** `apps/interface/package.json:116`
- **Issue:** `"fs": "^0.0.1-security"` — fake package that will break at runtime
- **Fix:** Remove from dependencies

### H12. iframe Sandbox Nullified
- **Phase:** P1 (Adversarial)
- **File:** `features/MiniBrowser/components/EnhancedMiniBrowserView.tsx:352`
- **Issue:** `allow-scripts allow-same-origin` together nullifies sandbox
- **Fix:** Remove `allow-same-origin` or implement proper CSP

### H13-H18. Additional High Findings
- Bot speaking detection one-way gate (avatar freeze on WS drop)
- Blob URL memory leak in PhotoMagic (never revoked)
- Missing abort controllers in sprite fetch
- Database TLS bypass option in connection config
- Timing attack on shared secret comparison
- Enhanced proxy strips upstream security headers

---

## MEDIUM FINDINGS (Address in Sprint)

| # | Finding | Phase | File/Area |
|---|---------|-------|-----------|
| M1 | Duplicate global CSS files | P1 | `styles/global.css` vs `app/globals.css` |
| M2 | No dark mode toggle UI | P1 | Theme system |
| M3 | Scattered breakpoint definitions | P1 | 375px, 768px, 1024px across files |
| M4 | `any` types in key component props | P1 | `assistant-button.tsx`, `assistant-canvas.tsx` |
| M5 | VoiceSessionContext too large (100+ line interface) | P1 | Should split |
| M6 | Duplicated AudioContext loading logic | P1 | `assistant-button.tsx` / `assistant-sound-effects.tsx` |
| M7 | TypeScript errors ignored at build | P1 | `next.config.mjs:22` |
| M8 | ESLint disabled at build | P1 | `next.config.mjs:195` |
| M9 | Build tools in production deps | P1 | webpack, jest, ts-node, sqlite3 |
| M10 | Bot join silent failure | P2 | DailyCall — no fallback personality |
| M11 | No WebRTC reconnection layer | P2 | Relies entirely on Daily SDK |
| M12 | GIF cache memory growth during speaking | P2 | PearlAvatar cache busting |
| M13 | Avatar waking transition race condition | P2 | PearlAvatar stale closure |
| M14 | Event spoofing — no message signing | P3 | Redis messaging services |
| M15 | Redis channel name injection | P3 | `chat.ts` raw roomId |
| M16 | Error messages expose stack traces | P3 | `contentApi.ts:155,376` |
| M17 | Stale closure in useIncrementalFetch | P1 | `onComplete(items)` captures empty |
| M18 | Module-level shared state in useVoiceSession | P1 | Race condition on multi-mount |
| M19 | postMessage wildcard origin `'*'` | P1 | PearlBridgeProvider, WonderCanvas |
| M20-28 | Additional medium findings | All | See agent reports |

---

## LOW FINDINGS (Backlog)

| # | Finding | Phase |
|---|---------|-------|
| L1 | Deprecated `.deprecated` file in repo (36.4 KB) | P1 |
| L2 | Patch file left in settings-panels | P1 |
| L3 | HTML template files in components dir | P1 |
| L4 | `moment.js` + `date-fns` both installed | P1 |
| L5 | Low contrast: `--scg-navy` (#0d374a) | P1 |
| L6 | Missing background image preload (WORK/CREATIVE modes) | P1 |
| L7 | 13 suppressed `exhaustive-deps` lint rules | P1 |
| L8 | Dead Rive config code (system migrated to GIF) | P2 |
| L9 | Unused `audioLevelRef` prop in TileGifAvatar | P2 |
| L10 | Integration test file misplaced in RiveAvatar | P2 |
| L11 | Weak message ID generation (`Math.random()`) | P3 |
| L12 | Incomplete XSS sanitization in Redis validation | P3 |
| L13 | JWT verification doesn't validate algorithm | P3 |
| L14 | Role guard logic: misleading `!== false` | P3 |
| L15-22 | Additional low findings | All |

---

## CLEAN AREAS (No Issues Found)

| Area | Agent | Verdict |
|------|-------|---------|
| **Next.js Routing** | P1-A1 | Production-ready, zero issues |
| **Middleware Auth** | P1-A1 | Robust, proper public route whitelist |
| **SSR/Client Boundaries** | P1-A1 | All correct, no violations |
| **Dynamic Route Params** | P1-A1 | Proper Next.js 15 async pattern |
| **Provider Hierarchy** | P1-A2 | Acyclic, well-organized |
| **Error Boundaries** | P1-A2 | Properly placed |
| **Feature Flag Module** | P3-A5 | Clean implementation |
| **Notes CRUD Actions** | P1-A5 | Session + UUID validation |
| **Enhanced Applet Actions** | P1-A5 | Strict tenantId, ownership checks |
| **iOS Safari Viewport Fix** | P1-A4 | 3-tier cascade correctly implemented |
| **Reduced Motion A11y** | P1-A4 | Properly implemented |
| **Touch Target Sizing** | P1-A4 | WCAG AAA compliant (44px) |
| **Safe Area Handling** | P1-A4 | Consistent env(safe-area-inset-*) |
| **Event Dedup Ring Buffer** | P1-A3 | Correct FIFO implementation |
| **WebSocket Reconnection** | P1-A3 | Proper exponential backoff |

---

## PRIORITY REMEDIATION PLAN

### Immediate (Block Release)
1. Remove `NEXT_PUBLIC_TWILIO_AUTH_TOKEN` — server-side only
2. Remove `NEXT_PUBLIC_` prefix from OpenClaw API key
3. Fix SQL injection in NotionModelResolver (parameterize)
4. Add auth to LinkMap actions
5. Sanitize Notes dangerouslySetInnerHTML with DOMPurify
6. Add auth guards to GraphQL mutations
7. Fix SSRF in enhanced proxy (allowlist/blocklist)
8. Fix AES-256-CBC → add HMAC or switch to GCM

### Next Sprint
9. Add `event.origin` checks to all postMessage handlers
10. Add CSP and X-Frame-Options headers
11. Disable GraphQL introspection in production
12. Fix token cache TTL in DailyCall
13. Fix use-toast.ts infinite loop
14. Memoize VoiceSessionProvider context value
15. Remove fake `fs` polyfill
16. Restrict CORS origins

### Backlog
17. Consolidate duplicate global CSS
18. Add dark mode toggle
19. Clean up deprecated files
20. Remove `moment.js` (use date-fns)
21. Complete Rive→GIF migration cleanup
22. Move build tools to devDependencies

---

## AGENT MANIFEST

| ID | Phase | Scope | Key Finding |
|----|-------|-------|-------------|
| P1-A1 | Interface | Routing & Pages | CLEAN |
| P1-A2 | Interface | Components | `any` types, deprecated files |
| P1-A3 | Interface | Hooks & Utils | use-toast loop, module state race |
| P1-A4 | Interface | Styles & Theme | Duplicate CSS, no dark toggle |
| P1-A5 | Interface | Config & Actions | Twilio leak, LinkMap no auth |
| P1-ADV1 | Interface | Security | XSS, postMessage, SSRF |
| P1-ADV2 | Interface | Stability | 3 critical, 6 high, 9 medium |
| P2-A1 | Voice | Pipecat Bot | Pipeline architecture review |
| P2-A2 | Voice | RiveAvatar | Rive→GIF migration state |
| P2-A3 | Voice | DailyCall | Token TTL, silent bot failure |
| P2-A4 | Voice | VoiceInput & TTS | Audio context management |
| P2-A5 | Voice | Soundtrack | Audio mixing review |
| P2-ADV1 | Voice | Security | API key exposure, WS auth |
| P2-ADV2 | Voice | Crashes | Rive leak, state machine desync |
| P3-A1 | Data | Mesh GraphQL | Schema review |
| P3-A2 | Data | Prism | Data abstraction audit |
| P3-A3 | Data | Events | Event system review |
| P3-A4 | Data | Redis | Cache patterns |
| P3-A5 | Data | Feature Flags | Clean implementation |
| P3-ADV1 | Data | Security | SQL injection, no mutation auth |
| P3-ADV2 | Data | Reliability | Race conditions, cache stampede |
| P4-A1 | Features | Launchpad/Jobs | Component review |
| P4-A2 | Features | Browser/HTML | Sandbox analysis |
| P4-A3 | Features | Communication | OAuth flow review |
| P4-A4 | Features | Media/Content | Photo/Sprite/YouTube review |
| P4-A5 | Features | UI System | Window management review |
| P4-ADV1 | Features | Security | Terminal/browser injection |
| P4-ADV2 | Features | Crashes | Missing error handling |
| P5-A1 | Infra | CI/CD Workflows | Pipeline review |
| P5-A2 | Infra | Docker/Deploy | Container audit |
| P5-A3 | Infra | Build System | Turbo config review |
| P5-A4 | Infra | Scripts/Tools | Setup script review |
| P5-A5 | Infra | Env/Secrets | Secret exposure check |
| P5-ADV1 | Infra | Security | Supply chain, misconfig |
| P5-ADV2 | Infra | Reliability | Build reproducibility |

---

## INDIE QA SWARM — INDEPENDENT VERIFICATION

> 5 independent agents deployed to cross-check phase findings without trusting prior agents.

### IQ-1: Critical Finding Verification

All 5 critical findings independently verified against actual source code:

| Finding | Phase Claim | Indie Verdict | Evidence |
|---------|------------|---------------|----------|
| C1. Twilio Auth Token | Exposed via `NEXT_PUBLIC_` | **VERIFIED** | `next.config.mjs` + `env.config.ts` confirm client-side exposure |
| C3. XSS in Notes | `dangerouslySetInnerHTML` unsanitized | **VERIFIED** | `notes-view.tsx` lacks DOMPurify; `notes-view-next.tsx` has it |
| C4. LinkMap No Auth | Zero session checks | **VERIFIED** | 4 exported server actions, 0 auth calls |
| H1. postMessage Origins | 19 handlers, no origin checks | **VERIFIED (WORSE)** | Actually **21 listeners, 0 origin checks** — 2 more than reported |
| C6. SSRF Proxy | No IP restriction | **VERIFIED** | Only blocks non-HTTP schemes; all RFC1918, link-local, metadata IPs reachable |

**Indie QA-1 conclusion:** Phase agents were accurate — and conservative. The postMessage count was actually *under*-reported.

### IQ-2: Cross-Feature Integration Issues (NEW)

Issues the phase agents missed because they audited features in isolation:

| Severity | Finding |
|----------|---------|
| **HIGH** | **Shadowed DailyCallStateProvider**: `client-providers.tsx:104` wraps GatewaySocketBridge in an outer DailyCallStateProvider, but `ClientManager.tsx:126` creates a second inner one. GatewaySocketBridge reads `joined` from the outer (always false) — gateway WebSocket **never connects** via this path |
| **MEDIUM** | **Dual `isDailyCallActive` tracking**: UIContext sets it from window events AND BrowserWindow sets it from component state — potential race condition |
| **MEDIUM** | **DailyCall as import hub**: 8 features depend on DailyCall's event constants. Should be extracted to shared module |
| **LOW** | **ChatMode Pearl avatar visual inconsistency**: Avatar shows voice-active state while DailyCall has muted voice bot |

### IQ-3: Build & Type-Check Verification (NEW)

The build succeeds but **masks significant issues**:

| Check | Result |
|-------|--------|
| TypeScript (`tsc --noEmit`) | **46 errors** in `apps/interface` (0 in mesh, 0 in prism) |
| ESLint (`next lint`) | **370 errors**, 158 warnings |
| Build config masking | `ignoreBuildErrors: true` + `ignoreDuringBuilds: true` hides all of the above |
| Circular dependencies | 1 type-level cycle in prism barrel exports |

**Critical runtime bug discovered:** `SummonSpritePrompt.tsx` has **20 `react-hooks/rules-of-hooks` violations** — hooks called after early return. This causes actual runtime crashes, not just lint noise.

**`WindowManagerContext.tsx`** has 20 TS errors — the `WindowOpenRequest` type is completely out of sync with actual usage across the app.

### IQ-4: Test Coverage Assessment (NEW)

| Metric | Value |
|--------|-------|
| Total test files | **227** |
| Feature modules with tests | 16 / 26 (62%) |
| Feature modules with ZERO tests | **10 / 26 (38%)** |
| Packages with zero tests | events, redis, msam |
| E2E specs | 3 Cypress + 1 Playwright |
| Test isolation | None — all require live database |

**Untested critical features:** ChatMode, VoiceInput, PhotoMagic, CreationLaunchpad, Stage, OpenClawBridge, ManeuverableWindow, Files, PearlMultiMenu, Sprites

**Well-tested areas:** Prism (48 tests), DailyCall (20 tests), HtmlGeneration (19 tests), Dashboard (29 tests)

### IQ-5: Dependency & Supply Chain Audit (NEW)

| Finding | Severity |
|---------|----------|
| **70 npm vulnerabilities** (6 critical, 27 high) | HIGH |
| `fs`, `child_process`, `path` shim packages in deps (security holder packages that do nothing) | HIGH |
| GitHub Actions use floating version tags (e.g., `@v4`) not pinned SHAs | HIGH |
| `@nia` npm scope not claimed — **dependency confusion risk** | MEDIUM |
| 7,684 packages in dependency tree | INFO |
| `moment` + `date-fns` both installed | LOW |

---

## UPDATED SEVERITY BREAKDOWN (Post-Indie QA)

| Severity | Phase Agents | Indie QA Additions | Final Count |
|----------|:------------:|:------------------:|:-----------:|
| **CRITICAL** | 11 | +1 (SummonSprite hooks crash) | **12** |
| **HIGH** | 18 | +4 (shadowed provider, npm vulns, GH Actions, shim pkgs) | **22** |
| **MEDIUM** | 28 | +4 (dual state tracking, DailyCall hub, dep confusion, WindowManager type drift) | **32** |
| **LOW** | 22 | +3 | **25** |

### Updated Priority Remediation (Indie QA additions in **bold**)

#### Immediate (Block Release)
1–8. (unchanged — see original list above)
9. **Fix `SummonSpritePrompt.tsx` — 20 hooks-rules-of-hooks violations causing runtime crashes**

#### Next Sprint
10–16. (unchanged — see original list above)
17. **Fix shadowed DailyCallStateProvider (remove inner re-provision in ClientManager)**
18. **Run `npm audit fix` — 70 vulnerabilities (6 critical)**
19. **Pin GitHub Actions to commit SHAs**
20. **Remove `fs`, `child_process`, `path` shim packages from deps**
21. **Re-enable TypeScript and ESLint checks in build config**

#### Backlog
22–27. (unchanged — see original list above)
28. **Claim `@nia` npm scope or add `.npmrc` registry config**
29. **Add tests for 10 untested feature modules**
30. **Extract DailyCall event constants to shared module**
31. **Sync `WindowOpenRequest` type with actual usage**
