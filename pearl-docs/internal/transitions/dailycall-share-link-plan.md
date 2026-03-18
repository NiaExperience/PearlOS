# DailyCall Shared Link Workflow Plan

## Objective
Design a workflow that lets a participant in a multi-user DailyCall generate and share a link that, upon redemption, opens the interface, loads the associated DailyCall, and connects the recipient to the correct room URL with appropriate permissions and context.

## Context & Motivation
- We already generate links for applets/notes; we need parity for live DailyCall rooms that are multi-user.
- Logs show room URLs (e.g., `https://pearlos.daily.co/voice-<id>`) flowing through bot control and interface; we need a user-facing, shareable entry point.
- Current report shows session timelines but no explicit share mechanics.

## Scope (In)
- UI affordance to generate a "share" link from an active DailyCall session.
- Tokenized link format, redemption flow, and routing to the room URL.
- Permission and feature-flag gating for shareable calls.
- Handling for multi-tenant context (assistant, workspace, persona/voice defaults, applet linking).
- Observability (events/metrics) for link issuance and redemption.

## Out of Scope (for this phase)
- New DailyCall creation mechanics.
- Changes to Daily backend media/connectivity behavior.
- Long-term token storage/management UI.
- Invitee identity verification beyond existing auth stack (use existing auth/login flows).

## Assumptions
- Daily rooms remain the source of truth; link encodes roomUrl and minimal metadata.
- Recipients may be unauthenticated; redemption flow must route through existing auth + tenant resolution.
- Feature flags will gate share UI; use the existing `dailyCall` flag (no additional sharing flag).
- Links can expire (TTL) and should be single-use or limited-use; align with existing resource sharing TTL (current default 24h / 86400s) so behavior matches applet/note links.
- Token issued server-side (signed, tamper-proof) and stored minimally (or stateless JWT with HMAC/issuer + nonce).

## Requirements
- R1: Share control visible only in multi-user DailyCall sessions with feature flag enabled.
- R2: Generating a share link produces a copyable URL containing a redemption token; do not expose raw roomUrl.
- R3: Token encodes roomUrl, tenant/assistant id, creator userId, issue time, expiry, optional note/applet id, and allowed actions (join/view).
- R4: Redemption URL deep-links to interface route, validates token, enforces expiry, and joins the Daily room (opens call UI with correct persona/voice defaults if provided).
- R5: Observability: emit events for link_issued, link_redeemed, link_failed (reason), join_success/join_fail; include redaction paths.
- R6: Security: token signed server-side; prevent replay (nonce + single-use, or short TTL + server cache of redeemed nonces).
- R7: UX: Clear copy affordance, expiry notice, and failure states (expired/invalid token) with retry guidance.
- R8: Multi-tenant correctness: redemption resolves assistant + workspace to apply correct branding and entitlements.

## Proposed Flow (Happy Path)
1) Active DailyCall view renders "Share" (flag-gated) when multiple participants or host role present.
2) User clicks "Share" → client calls server action/route `POST /api/daily/share-link` with current room context (roomUrl, assistantId, persona/voice ids, optional applet/note link, expiresIn defaulting to 24h / 86400s to match resource sharing links).
3) Server validates caller, feature flag, and room state → issues signed token (JWT or HMAC blob) + persistence of nonce (optional cache).
4) Server returns share URL (e.g., `/daily/share/<token>`). Client surfaces copy button and expiry notice.
5) Recipient opens share URL → redemption route verifies token (signature, exp, nonce) → resolves tenant/assistant → stores session context → redirects/loads DailyCall UI bound to roomUrl and joins.
6) UI emits link_redeemed, then join_success or join_fail.

## Token Shape (illustrative)
- Fields: `roomUrl`, `assistantId`, `tenantId`, `issuerUserId`, `personaId?`, `voiceId?`, `appletId?`, `noteId?`, `iat`, `exp` (default 24h / 86400s), `nonce`, `scopes` (e.g., `["join"]`).
- Signed with server secret; optionally store nonce in Redis with exp for replay prevention.

## UX Notes
- Placement: Call controls tray or side panel; label "Share call" with tooltip clarifying access.
- States: issuing (spinner), issued (copy + expiry text), error (retry), copied (toast).
- Redemption: loading screen while validating; clear errors for expired/invalid; option to request new link from inviter.

## Backend/Infra Considerations
- Add server action/route under interface feature boundary; keep packages/* free of app-layer deps.
- Use existing Redis for nonce tracking (TTL set to token exp) if single-use required.
- Daily join flow must tolerate pre-join validation redirect; ensure auth cookie/redirect chaining works.
- Rate-limit link issuance per user/session to mitigate spam.
- Feature flag alignment: `dailyCall` is the sole gate for DailyCall features, including share links (no dependency on `resourceSharing`).

## Observability & Events (to define in packages/events)
- `daily.share_link.issued`: { tenantId, assistantId, issuerUserId, roomUrl_redacted, expiresAt, scopes }
- `daily.share_link.redeemed`: { tenantId, assistantId, redeemerUserId?, roomUrl_redacted, nonce }
- `daily.share_link.failed`: { reason (expired|invalid|replayed|flag_disabled), nonce?, roomUrl_redacted }
- `daily.call.join`: reuse existing or add detail for token-based entry.

## Risks & Mitigations
- Replay/forwarding of links → Use nonce + short TTL; optional single-use cache.
- Cross-tenant leakage → Encode tenant/assistant in token and validate against caller + domain.
- User opens before auth → Redirect to login preserving redemption path.
- Room already closed → Show friendly error and guidance to request new link.
- Bot/PII leakage via roomUrl in logs → Redact roomUrl in events/logs; store only hashed/obfuscated value.

## Testing Strategy (plan)
- Unit: token encoder/decoder, expiry/nonce validation, flag checks.
- Integration: end-to-end issuance → redemption → join success; expired token; invalid signature; replayed nonce; wrong tenant.
- UI: share button visibility under flags; copy interactions; error banners on redemption failures.
- Load/Rate-limit: burst issuance attempts; ensure throttling + UX messaging.

## Rollout Plan
- Feature flag off by default; enable for internal testers, then specific tenants.
- Add logging/metrics dashboards for issued vs redeemed vs failed.
- Provide manual rollback: disable flag; invalidate active nonces via cache flush.

## Open Questions
- Should links be strictly single-use or limited-use? Default to single-use unless product prefers short-lived multi-use.
- Should we bind to specific user identity (invitee email) or allow generic links? Initial: generic; optional future binding.
- Need support for calendar/email share flows, or just copy link? Initial: copy-only.

## Integration Checklist
- [ ] Feature flag: ensure `dailyCall` gates share links (no additional sharing flag required).
- [ ] Server action/route to issue tokenized share link (validates room/tenant/flag).
- [ ] Token format documented (fields, signing, TTL=24h/86400s to match existing shares, scopes) and redaction rules set.
- [ ] Nonce storage + replay protection (Redis) with TTL aligned to token exp.
- [ ] Redemption route: validates token, handles auth redirect, resolves tenant/assistant, routes to call UI.
- [ ] UI share affordance (visibility rules: multi-user DailyCall + flag on); copy + status states.
- [ ] Error UX for redemption (expired, invalid, replayed, closed room).
- [ ] Events added to packages/events with redaction paths; codegen + tests updated.
- [ ] Metrics/dashboards for issuance vs redemption vs failure.
- [ ] Tests: unit (token, validation), integration (issue→redeem→join), UI (visibility + copy), rate-limit cases.
- [ ] Security review: secret handling, token scope, roomUrl redaction, auth flow checks.
- [ ] Rollout plan documented; rollback steps (flag off, nonce cache flush).
