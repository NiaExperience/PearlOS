# Reset Password Token Store Plan

Status: Implemented (feature-flagged persistence path merged; memory fallback retained; invite activation purpose live)
Owner: Auth / Platform Team
Related Scope: Dashboard Admin Panel (password reset + invite flows)

 
## Summary

Durable platform data object `ResetPasswordToken` persists hashed, single-use, expiring tokens for password reset (and future invite activation) flows. Persistence is now ON by default (opt-out). Set `RESET_TOKEN_PERSISTENCE=disabled` to force the legacy in-memory Map path (also used transparently on persistence failure). Implementation includes self-healing creation of the platform definition if missing at runtime.

## Goals

1. Security: Store only a hash of issued tokens; enforce single-use and expiry.
2. Observability: Provide admin visibility (list, status, attempts, consumption timeline) via platform content framework.
3. Abuse Mitigation: Facilitate rate limiting + anomaly detection (excess attempts / IP clustering).
4. Reliability: Survive process restarts & scale across instances.
5. Extensibility: Support multiple purposes (password reset, invite activation) without schema churn.

## Non-Goals (Now)

- Full audit trail of every validation attempt (we store aggregate attempts count now; detailed event log could be separate later).
- General-purpose token framework for all ephemeral flows (keep scope to reset / invite until validated).
- Cryptographic redesign (use existing AES-GCM + HMAC envelope for delivered token value; only hash at rest).

## Data Model (`ResetPasswordToken`)

Defined in `packages/prism/src/core/content/platform-definitions-jsonSchema.ts` (added).

Fields (key):

- `_id` (uuid): Internal record id (Notion page id) – auto managed by platform.
- `tokenHash` (string, required, indexed): SHA-256 (or stronger) hash of canonical token payload (post-HMAC envelope; never store plaintext).
- `userId` (string, required, indexed): Owning user (camelCase per convention).
- `email` (string, optional): Snapshot of delivery email (assist debugging if email changed later).
- `issuedAt` (date-time): Generation timestamp.
- `expiresAt` (date-time, required, indexed): Expiration boundary.
- `consumedAt` (date-time, nullable): Set when successfully redeemed.
- `purpose` (enum: `password_reset` | `invite_activation`, required): Flow discriminator.
- `attempts` (number): Count of validation attempts (increment on failed consume with matching hash? or attempted reuse). Initially increment only on invalid/reuse attempts referencing this record.
- `ipIssued` (string): IP at issuance for anomaly clustering.
- `uaIssued` (string): User agent at issuance.

Rationale: Minimal operational + security metadata without overfitting future rate-limiting dimensions.

## Token Lifecycle

1. Issue:
   - Generate random token (>= 128 bits entropy) + wrap in existing encryption/HMAC scheme (unchanged outward API).
   - Compute `tokenHash = SHA-256(canonicalTokenString)` (pre-encryption OR choose stable canonical form). Simpler: hash the exact opaque token returned to user.
   - Persist record with `consumedAt = null`, `attempts = 0`.
   - Email link includes opaque token (no DB id).
2. Consume:
   - Hash presented token; lookup by `tokenHash`.
   - Reject if not found, expired, purpose mismatch, or `consumedAt` already set.
   - (Optional anti-replay window: short atomic update using compare-and-set to set `consumedAt`.)
   - Proceed with password / invite logic; then mark consumed.
3. Reuse Attempt:
   - If `consumedAt` already set or expired, increment `attempts` (bounded) for signals.
4. Cleanup:
   - Background job (cron / interval) deletes expired & consumed tokens beyond retention window (e.g., 24h after `expiresAt`).

## Indexing & Query Patterns

Indexer fields: `tokenHash`, `userId`, `expiresAt`.
Query Use Cases:

- Consume path: primary lookup by `tokenHash` (exact match, must be indexed).
- Admin panel: list active tokens for a user ordered by `expiresAt DESC`.
- Cleanup: find expired (where `expiresAt < now`).
- Security analytics (future): count unconsumed tokens per user/time bucket.

Potential Additional Index (future): compound `(userId, expiresAt)` for efficient user-level enumeration if store grows large.

## API / Service Abstraction

Introduce `ResetPasswordTokenStore` service module:
Methods:

- `create({ userId, email, purpose, expiresAt, tokenHash, ipIssued, uaIssued }): Promise<Record>`
- `consume({ tokenHash, purpose }): Promise<{ userId, email }>` (throws typed errors: NotFound, Expired, AlreadyUsed)
- `incrementAttempt(tokenHash)` (internal; throttle increments)
- `prune({ before })`

Error Codes (internal enum):

- `TOKEN_NOT_FOUND`
- `TOKEN_EXPIRED`
- `TOKEN_ALREADY_USED`

## Integration Points

Implemented in `packages/prism/src/core/email/index.ts`:

- `issueResetToken` & `consumeResetToken` now async and feature-flag aware.
- On flag enabled: create & query via `ResetPasswordTokenActions` (`reset-password-token-actions.ts`).
- On create failure (e.g., definition not yet initialized), code attempts a self-heal by instantiating the `ResetPasswordToken` definition dynamically and retrying once, else falls back to memory Map.
- On flag disabled (or fallback), original in-memory hashed token Map is used.

Deferred (not yet implemented): dedicated `ResetPasswordTokenStore` abstraction — actions layer suffices for current scope.

## Migration Plan (Executed & Adjusted)

1. Add platform definition (DONE).
2. Add actions layer (`reset-password-token-actions.ts`) with CRUD + lookup (DONE).
3. Integrate feature flag path inside existing email issuance/consume functions (DONE).
4. Skip formal dual-write; choose single-path (DB when enabled, otherwise memory) with transparent fallback (ADJUSTED).
5. Add persistence feature test validating both disabled and enabled paths (`password-flow-persistence.test.ts`) (DONE).
6. Add self-healing definition creation on first persistence attempt (ADDED).
7. Keep memory path indefinitely as safe fallback (DECIDED) — revisit removal after operational confidence.

## Security Considerations

- Only store hash; compromise yields unusable data (unless brute-forced; ensure high entropy tokens).
- Consider pepper: global secret appended prior to hashing (env-driven) for defense-in-depth.
- TTL: Keep short (e.g., 30 min) for password reset; invite activation may allow longer (configurable per purpose).
- Rate limiting external endpoints still required (not covered by store alone).
- Avoid leaking existence: issuance endpoint returns generic message; consume endpoint same for invalid vs. not found (tests ensure generic errors?).

## Observability & Admin UI

Fields exposed allow:

- Distinguish active vs. consumed.
- Spot anomalies (multiple active tokens for one user, high attempts).

Add simple dashboard view: filter by `userId`, highlight tokens expiring soon.

## Testing Strategy

Implemented:

- Existing `password-flow.test.ts` covers memory path (flag off).
- New `password-flow-persistence.test.ts` covers both flag disabled (memory) and enabled (persistence) scenarios.
- Test uses a UUID-form user id for persistence path to satisfy underlying `parent_id` UUID constraint (platform definition maps `parent` to `userId`).

Pending / Future:

- Add negative tests for: expired token cleanup, reuse attempt increments attempt counter (increment not yet wired), and self-heal fallback path logging.

## Future Enhancements

- Wire reusable pruning job (interval or cron) invoking `pruneExpiredResetPasswordTokens` (currently manual-only).
- Increment and persist `attempts` on reuse / invalid consume attempts (function exists but not called yet).
- Detailed attempt log (separate collection) for forensics.
- Soft delete / archival instead of hard delete for compliance.
- Add `lastAttemptAt` timestamp and per-IP attempt counters.
- Support additional purposes (email verification, MFA) after validation.
- Admin dashboard view: filters by userId, highlight soon-expiring tokens, manual invalidate.

## Current Implementation Delta vs Original Plan

| Aspect | Planned | Implemented | Notes |
|--------|---------|-------------|-------|
| Abstraction | Dedicated `ResetPasswordTokenStore` | Direct actions layer + email integration | Simpler; may wrap later if interface broadens |
| Dual-write | Optional phase | Skipped | Complexity not justified; fallback covers reliability |
| Self-heal | Not specified | Added dynamic definition creation | Reduces test/order dependency |
| Attempts tracking | Increment on reuse | Placeholder function only | Needs wiring into consume failure path |
| Pruning | Background job | Manual function only | Schedule later |
| Admin UI | Future | Not yet | Requires listing & filters |
| Fallback strategy | Memory only when flag off | Also used on persistence failure | Ensures resilience |

## Next Steps (Recommended)

1. Wire `incrementResetPasswordTokenAttempts` for reuse / expired consume attempts.
2. Add scheduled pruning (e.g., hourly) invoking `pruneExpiredResetPasswordTokens`.
3. Build admin list view with filters (userId, purpose, state: active/consumed/expired).
4. Add negative & stress tests (high volume issuance, rapid reuse attempts).
5. Decide retention window & implement post-consumption purge policy.
6. Consider adding a secret pepper for hashing (env-provided) before broad rollout.

---
Implementation complete under feature flag; document now reflects shipped behavior and pending incremental improvements.

## Invitation Workflow Integration

Implemented 2025-08-19:

- Added `invite_activation` purpose with default TTL 72h (vs 30m for `password_reset`).
- Endpoints: `/api/users/invite` issues token (admin protected) and emails link; `/api/users/accept-invite` consumes token and sets initial password.
- Test mode (NODE_ENV=test) returns issued token JSON for deterministic API tests (no email parsing needed).
- Tokens are single-use; reuse attempt rejected (test enforced).
- CAPTCHA / rate limiting: TODO marker placed in `accept-invite` route for future abuse mitigation (invite acceptance is a potential brute target if email leaked).

## Open Questions

- Retention period post-consumption: 24h vs. configurable? (Default 24h until need drives change.)
- Should we embed tenantId for multi-tenant sharding? (Add later if needed; can derive via user reference now.)

---
Initial definition landed with this document; next step is implementing persistence adapter & feature flag gating.
