# Google sign-in allowlist

This document describes the **server-side allowlist** for **Sign in with Google** in Nia Universal. It complements, but does not replace, the [Google Cloud OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent) (including **Test users** when the app is in **Testing**).

## Why this exists

- Google Cloud **Test users** are enforced by **Google** during the OAuth flow. Your app cannot read that list from an API.
- In practice, teams often use a **different** OAuth client ID in each environment, or a project in **In production** status, so anyone with a Google account can still complete OAuth.
- This feature adds an **application-level** gate: only listed email addresses may complete Google sign-in in Nia, regardless of Google's console settings.

If neither the database allowlist nor the env allowlist is set, behavior is unchanged from before: any user who passes Google OAuth (and is not on the global **deny list**) can sign in with Google.

## Where the allowlist is stored

The allowlist is now **Postgres-backed**. It lives on the `GlobalSettings` singleton (a single `notion_blocks` row with `type = 'GlobalSettings'` and `indexer->>'singletonKey' = 'platform'`) under the field `allowListEmails: string[]`.

This is the same singleton that stores the global email **deny list** (`denyListEmails`).

### Precedence at sign-in

At sign-in time, `processSignIn` computes the effective allowlist as the **union** of two sources:

1. **Postgres `GlobalSettings.allowListEmails`** — authoritative; managed from the dashboard and the `allowlist:*` CLI scripts.
2. **`GOOGLE_SIGNIN_ALLOWLIST` env var** — legacy, comma- or newline-separated. Still honored for backward compatibility.

If the union is non-empty **and** the OAuth `account.provider === 'google'`, the caller's email must appear in the union. Otherwise sign-in is rejected with `AccessDenied`.

**Scope:** The allowlist applies only to the **Google** OAuth provider. It does **not** apply to email/password (`credentials`) or anonymous sign-in.

## Managing the allowlist

### CLI scripts

All scripts talk to Postgres directly and do **not** require the mesh server to be running. They read connection settings from `.env.local` (`POSTGRES_*`).

```bash
# View the current allowlist
npm run allowlist:list

# Add one or more emails (merges with existing)
npm run allowlist:add -- user@example.com other@example.com

# Remove one or more emails
npm run allowlist:remove -- user@example.com

# Rename (edit) an existing entry
npm run allowlist:edit -- old@example.com new@example.com

# Remove every entry (prompts for confirmation; pass -- --yes to skip)
npm run allowlist:clear

# Any of the above accept --json for machine-readable output
npm run allowlist:list -- --json
```

### Seed / import scripts

`npm run allowlist:seed` populates the allowlist from up to three sources:

- The `GOOGLE_SIGNIN_ALLOWLIST` env var (comma- or newline-separated)
- Every `User` email already stored in the local DB (type `User` in `notion_blocks`)
- One or more plain-text files (one email per line, blank lines and `#` comments ignored, commas also accepted on a line)

By default the seeder performs a **merge** (union) with whatever is already in the DB. If you pass any `--from-*` flag (or a bare file path), only those sources are used.

```bash
# Default: pull from env + users, merge with current allowlist
npm run allowlist:seed

# Only seed from the env var
npm run allowlist:seed -- --from-env

# Only seed from User records, restricted to a corporate domain
npm run allowlist:seed -- --from-users --domain niaxp.com

# Overwrite the allowlist instead of merging
npm run allowlist:seed -- --replace --from-users

# Preview changes without writing
npm run allowlist:seed -- --dry-run
```

#### Import from a txt file (bulk add)

Use `allowlist:import` (a shortcut that passes `--from-file` to the seeder) to add many emails at once. The file can contain comments and blank lines; one email per line is the cleanest format:

```text
# emails.txt
# Engineering team
alice@example.com
bob@example.com

# Comma-separated is also fine:
carol@example.com, dave@example.com
```

```bash
# Merge the file into the current allowlist
npm run allowlist:import -- ./emails.txt

# Multiple files are supported; both merge in
npm run allowlist:import -- ./eng.txt ./ops.txt

# Preview only (no write)
npm run allowlist:import -- ./emails.txt --dry-run

# Replace the allowlist with the contents of the file
npm run allowlist:seed -- --replace --from-file ./emails.txt

# Combine with env + users + file in one pass
npm run allowlist:seed -- --from-env --from-users --from-file ./emails.txt
```

Invalid lines (anything that doesn't look like an email) are reported with their line number and skipped; the script still writes the valid entries. A sample file lives at `apps/interface/.env.google-signin-allowlist.example.txt`.

### Dashboard API

The dashboard `PATCH /dashboard/api/global-settings` endpoint now accepts an `allowListEmails: string[]` field alongside `interfaceLogin` and `denyListEmails`, guarded by the existing superadmin check.

## Environment variable (legacy fallback)

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_SIGNIN_ALLOWLIST` | No | Comma- or newline-separated email addresses. Merged with the DB allowlist at sign-in. Comparison is **case-insensitive**. |

- **Server-only:** do **not** use `NEXT_PUBLIC_*`. The value is read in `auth-config` on the server.
- **Preferred** storage is the DB. Use the env var only for bootstrap or transient overrides.

## Code locations

| Area | Path |
|------|------|
| Sign-in enforcement | `packages/prism/src/core/auth/authOptions.ts` (`processSignIn`) |
| DB helpers (getters / CRUD) | `packages/prism/src/core/actions/globalSettings-actions.ts` |
| Block schema | `packages/prism/src/core/blocks/globalSettings.block.ts` |
| Platform definition | `packages/prism/src/core/platform-definitions/GlobalSettings.definition.ts` |
| Env parsing helper | `parseGoogleSignInAllowlistEnv()` in `authOptions.ts` |
| CLI | `scripts/google-allowlist.ts`, `scripts/seed-google-allowlist.ts` |
| Interface config wiring | `apps/interface/src/lib/auth-config.ts` |
| Dashboard config wiring | `apps/dashboard/src/lib/auth-config.ts` |
| Dashboard API route | `apps/dashboard/src/app/api/global-settings/route.ts` |
| Unit tests | `apps/interface/__tests__/auth-google-allowlist.test.ts` |

### Order of checks in `processSignIn`

1. **Global deny list** (`denyListEmails`). If the email is denied, sign-in returns `AccessDenied`.
2. **Google allowlist** (this feature). If `union(DB.allowListEmails, env)` is non-empty and `account.provider === 'google'`, the email must appear in that union. Otherwise sign-in returns `AccessDenied`.
3. Existing user linking or new user creation for Google, credentials, or anonymous flows as before.

## User-visible behavior

When a user is blocked by the allowlist, NextAuth redirects to the login page with `?error=AccessDenied` (for example `http://localhost:3000/login?error=AccessDenied` on the interface).

## How to test

1. Add a single email to the allowlist: `npm run allowlist:add -- you@example.com`. Sign in with Google using a **different** account — you should get `AccessDenied`.
2. Sign in with the listed email. Sign-in should succeed.
3. Clear with `npm run allowlist:clear -- --yes`, confirm the restriction is gone.
4. Automated tests:

   ```bash
   npm run test:js -- --runTestsByPath apps/interface/__tests__/auth-google-allowlist.test.ts
   ```

## Keeping Google Cloud and Nia in sync

If you rely on **Testing** + **Test users** in Google Cloud, maintain the **same** email set in the DB allowlist so your product policy matches what you expect in the console. There is no automatic sync.

## Related documentation

- `docs/gmail-integration-setup.md` (Google OAuth credentials and scopes)
- Global email deny list behavior is implemented in the same `processSignIn` path; see global settings / `denyListEmails` in the codebase.
