# Password Reset & Invite Flow Status (Aug 19 2025)

## Implemented

- mustSetPassword flag propagation in NextAuth JWT & session
- `/api/users/resend-invite` endpoint sending invitation email (dev preview URL when using ethereal)
- `/api/users/reset-password` endpoint issuing encrypted + HMAC-signed reset token (never stored in plaintext)
- `/api/users/complete-reset` endpoint consuming one-time token & updating password
- Email subsystem (`core/email`) with transport auto-fallback to ethereal for local dev
- Token security: AES-256-GCM encryption + HMAC-SHA256 signature + SHA256 hash-at-rest (in-memory) + one-time consumption
- Frontend login forms: Resend Invite + Forgot Password buttons
- New Reset Password UI page (`/reset-password`) with token-based password update (implemented)
- Unit tests: token issue/consume + email send mock
- API integration test: complete reset success, reuse failure, invalid token rejection

## Pending / Next

1. Persist reset tokens (current in-memory map lost on process restart) — move to durable store (e.g. AccountBlock or dedicated collection) with hashed token & expiry index
2. Rate limiting for invite & reset endpoints (IP + user/email) to prevent abuse
3. Password policy: minimum complexity + common/breached password check (e.g. zxcvbn or HaveIBeenPwned range query)
4. Remove `previewUrl` from production JSON responses (retain only in non-production)
5. Audit logging & metrics for security events (token issued, consumed, failures, invalid attempts)
6. Resend-invite: optionally issue dedicated activation token instead of generic login link
7. UI feedback (toast notifications) for resend/reset actions (currently console only)
8. E2E Cypress coverage of full reset journey (simulate email link by extracting preview token) after durable token store & rate limiting
9. Consider background job to prune expired durable tokens (if not TTL-indexed by storage layer)

## Environment Variables

```bash
TOKEN_ENCRYPTION_KEY (base64 32 bytes preferred) – required for token ops
SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS – optional SMTP config
EMAIL_FROM – sender email (default no-reply@example.com)
APP_BASE_URL – used to build links in emails (default http://localhost:3000)
```

## Security Notes

- Tokens are single-use and hashed at rest; compromise of in-memory map does not reveal plaintext tokens.
- Replay is prevented by deletion on successful consume; reuse tested.
- Consider short circuiting brute force with constant-time hash compare + lockouts.

## Testing Summary

| Area | Coverage |
|------|----------|
| Token issue/consume | Jest unit test (`password-flow.test.ts`) |
| Complete reset route | API test (`password-complete-reset.api.test.ts`) |
| Token reuse/invalid | Covered in API test |
| Email dispatch | Mocked in unit test |
| UI form | No dedicated component test yet (manual / future Cypress) |

---
Maintained by authentication feature track. Update this doc as remaining tasks land.
