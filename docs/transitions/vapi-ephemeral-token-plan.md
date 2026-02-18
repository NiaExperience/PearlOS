# VAPI secret hardening and client token plan

Last updated: 2025-09-23

## Goals

- Eliminate shipping long‑lived VAPI secrets to the browser or baking them into builds.
- Provide a safe client auth mechanism to start web calls without exposing server credentials.
- Support environment flexibility (staging/prod) without rebuilds (runtime config).
- Keep blast radius low and enable incremental rollout with quick rollback.

## Background (what we have now)

- The interface app references VAPI from the browser, historically via NEXT_PUBLIC_* values.
- NEXT_PUBLIC config is baked at build time, making environment changes harder and risking accidental exposure.
- We also want to centralize client config at runtime to reduce rebuilds and tighten control.

## Options considered

1) Backend-for-frontend (BFF) proxy only
   - The browser never calls VAPI directly. Instead, it calls our Next.js API which proxies to VAPI using server secrets.
   - Pros: No client tokens to manage; server retains full control; easy to rate limit/observe.
   - Cons: Higher server egress and latency; must maintain streaming/websocket support if needed.

2) Short‑lived public JWT tokens for VAPI Web Calls (recommended for /call/web)
   - Vapi supports JWTs with scope tags. “Public” scoped JWTs can be used for the public web endpoint: <https://api.vapi.ai/call/web>.
   - Our server mints a short‑lived, signed JWT using the org’s private key and returns it to the browser.
   - The browser uses this token with the VAPI Web SDK or XHR to start a web call.
   - Pros: No long‑lived secret in the client; tokens expire quickly; reduced proxying for the hot path.
   - Cons: Requires secure token minting and validation discipline; still need BFF for private endpoints.

3) Hybrid (phased)
   - Use public JWT tokens for /call/web; use BFF proxy for any private VAPI endpoints or special credential flows.
   - This allows incremental adoption with minimal user‑visible change.

Recommendation: Start with the Hybrid. It provides the best balance of security and implementation effort.

## Token model (for /call/web)

- JWT signed by our server using VAPI‑provided private key.
- Claims (example):
  - orgId: string (our Vapi org identifier)
  - token.tag: "public"  (public scope; only valid for /call/web)
  - exp: short expiry, e.g., now + 60–300 seconds
  - iat/nbf: optional for tighter windows
- Do not include PII in the token. Attach per‑session metadata through the web call payload if needed.

## API contracts to add (server)

1) GET /api/runtime-config
   - Purpose: Return non‑secret, environment‑specific settings to the browser at runtime.
   - Response shape:
     {
       "vapi": {
         "apiBaseUrl": string,   // e.g., <https://api.vapi.ai>
         "webSdkClientId": string | null, // optional; not a secret; present only if relevant
         "webCall": {
           "usesPublicJwt": boolean
         }
       },
       "features": {
         "botAutoJoin": boolean
       }
     }
   - Caching: Cache briefly at the edge; set ETag. Do not include secrets.

2) POST /api/vapi/token
   - Purpose: Mint a short‑lived public JWT for the web call endpoint.
   - Auth: Requires an authenticated session (or a dedicated CSRF‑protected flow for guest).
   - Request: { purpose: "web-call" }
   - Response: { token: string, expiresInSeconds: number }
   - Semantics:
     - Server validates caller, rate limits, signs JWT with token.tag = "public" and short exp.
     - Optionally bind token to a nonce and return { token, nonce } to correlate in logs.

Note: For any private VAPI endpoints, add BFF proxy routes (e.g., /api/vapi/private/*) that use server‑side credentials and never expose them to the client.

## Client usage

- Fetch /api/runtime-config at app start to get base URLs/flags.
- When starting a web call:
  1) POST /api/vapi/token { purpose: "web-call" }
  2) Initialize VAPI Web SDK with the returned token (or include as Authorization/JWT per SDK guidance).
  3) Start call as today.

## Security considerations

- Secrets never shipped to the client.
- Tokens are short‑lived (≤ 5 minutes; prefer 1–2 minutes).
- Enforce server‑side rate limits on /api/vapi/token (per user/IP/org) and add abuse detection.
- CSRF protection for the token endpoint; require same‑site cookies + anti‑CSRF token if using cookie auth.
- Issue tokens only for authenticated users or vetted guest flows (e.g., invite/session binding).
- Log issuance events with minimal, non‑sensitive metadata (userId, exp, nonce, opId).
- Consider audience (aud) and issuer (iss) claims if supported; otherwise validate on consumption context.

## Rollout plan

Phase 0: Prep

- Add /docs plan (this document).
- Wire NEXT_PUBLIC usage to runtime config fetch (non‑breaking stub), but keep existing path for fallback.

Phase 1: Server endpoints

- Implement /api/runtime-config (non‑secret values only).
- Implement /api/vapi/token issuing public JWT for /call/web.

Phase 2: Client opt‑in

- Behind a feature flag, switch web call flow to request a token and use the token with the VAPI Web SDK.
- Keep legacy path as fallback for a sprint.

Phase 3: Decommission legacy

- Remove NEXT_PUBLIC secrets and any direct client use of long‑lived tokens.
- Lock down CI to avoid baking secrets into builds.

## Testing

- Unit: Token builder (claims, expiry boundary, signature), config endpoint schema.
- Integration: Start a web call using minted token; token expiry rejection after window.
- Security: CSRF tests, rate‑limit, replay attempts with expired token.

## Risks and mitigations

- Token misuse window: keep expirations very short; enforce rate limits.
- SDK changes: verify the current VAPI Web SDK accepts a JWT for /call/web as documented.
- Streaming/WS behavior: ensure token is valid for the duration; if longer sessions are needed, coordinate with VAPI for session handoff or refresh as supported.

## Open questions

- Exact JWT header/claim requirements beyond orgId and token.tag as per latest Vapi docs.
- Whether we should include aud/iss, and recommended acceptable skew values.
- Any constraints for guest usage and agent selection within public tokens.

## Acceptance criteria

- No long‑lived VAPI credentials in browser bundles, environment files, or ConfigMaps as client‑readables.
- /api/runtime-config returns non‑secret values and is consumed by the client.
- /api/vapi/token issues short‑lived public tokens and is required to start browser web calls.
- Staging validated with logs confirming no direct secret exposure and correct token expiry behavior.
