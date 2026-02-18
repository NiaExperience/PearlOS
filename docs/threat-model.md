# Nia Universal Threat Model

## 1. Overview
- **Platform purpose:** Nia Universal is a feature-first, multi-tenant intelligent workspace with a stable core (identity, unified data access via Prism + Mesh, and content model) and optional feature surfaces delivered through feature flags.【F:README.md†L6-L34】
- **Primary technologies:** Next.js frontend applications, GraphQL Mesh server, Prism data abstraction, PostgreSQL storage, Daily.co voice bot pipeline (Deepgram STT, OpenAI LLM, ElevenLabs/Kokoro TTS), and supporting Node.js/TypeScript packages.【F:ARCHITECTURE.md†L49-L112】【F:apps/pipecat-daily-bot/README.md†L1-L68】
- **Deployment environments:** Local development via `npm run start:all`, Docker Compose for Mesh + Postgres, and runtime services exposed on ports 3000 (Interface), 4000 (Dashboard), 3001 (Databrowser), 2000 (Mesh GraphQL), and 4444 (Pipecat voice bot).【F:README.md†L94-L124】【F:ARCHITECTURE.md†L121-L159】【F:apps/mesh/README.md†L12-L57】

## 2. System Architecture Summary
- **Core components:**
  - Interface/Dashboard/Databrowser (Next.js apps) consume Mesh via Prism client.
  - Mesh GraphQL server federates data from PostgreSQL and external providers.
  - Prism package supplies a data bridge and provider registry abstraction.
  - Pipecat Daily Bot integrates Daily.co transport, STT/LLM/TTS pipeline, and publishes conversation events.
  - Shared packages (`@nia/features`, events, redis) enforce feature flags and messaging contracts.
- **Data flow:** User interactions in the interface trigger feature-specific actions that call Prism, which issues GraphQL operations against Mesh; Mesh resolves data from Postgres or other providers and returns results to the app. Voice sessions flow through Daily transport → event bus → LLM/TTS and optionally synchronize with Mesh via mutations.【F:ARCHITECTURE.md†L67-L159】【F:apps/pipecat-daily-bot/README.md†L1-L68】
- **External integrations:** Google OAuth scopes (Gmail, Drive, Calendar), Daily.co WebRTC, Deepgram STT, OpenAI APIs, ElevenLabs/Kokoro TTS, and potential additional providers registered in Prism.

## 3. Assets and Trust Boundaries
- **Sensitive assets:**
  - OAuth tokens for Google services and other external providers.
  - Access tokens/keys for OpenAI, Deepgram, ElevenLabs/Kokoro.
  - User-generated content and dynamic HTML stored in Postgres via Mesh.
  - Feature flag configurations and assistant capability descriptors.
  - Voice session transcripts, audio streams, and Pipecat event logs.
  - Authentication/session data managed by NextAuth and dashboard access controls.
- **Trust boundaries:**
  - External users ↔ Interface/Dashboard/Databrowser (browser to Next.js).
  - Frontend apps ↔ Mesh GraphQL API.
  - Mesh ↔ PostgreSQL / provider adapters.
  - Pipecat Daily Bot ↔ Daily.co transport and external AI APIs.
  - Internal services ↔ third-party APIs (OpenAI, Deepgram, ElevenLabs, Google).
- **Privilege escalation points:**
  - Feature server actions or tools that mutate data through Prism/Mesh.
  - Mesh resolvers executing provider operations.
  - Pipecat control APIs managing conversation context or administrative prompts.

## 4. Threat Enumeration (STRIDE)
| Component / Flow | STRIDE Category | Threat Description | Likelihood | Impact | Recommended Mitigations |
| --- | --- | --- | --- | --- | --- |
| User ↔ Interface/Dashboard (Next.js) | Spoofing | Session hijacking via stolen cookies or missing MFA for admin dashboards. | Medium | High | Enforce secure/session cookies, consider MFA for privileged dashboards, use short-lived tokens and SameSite policies. |
| User ↔ Interface feature tools | Tampering | Malicious client manipulates feature actions (e.g., HTML generation) to submit unsafe payloads. | Medium | Medium | Validate/sanitize inputs server-side, sandbox dynamic HTML rendering, enforce content security policies. |
| Interface ↔ Mesh GraphQL | Repudiation | Lack of comprehensive request logging makes it hard to audit which feature initiated mutations. | Medium | Medium | Implement structured logging with feature identifiers, correlate requests with user/session IDs. |
| Mesh GraphQL ↔ Postgres | Information Disclosure | Overly broad GraphQL schema exposure or missing row-level scoping leaks tenant data. | Medium | High | Enforce tenant scoping in resolvers, apply schema-level auth checks, minimize exposed fields. |
| Mesh GraphQL ↔ Providers | Denial of Service | External provider outage or slow response cascades to Mesh, exhausting worker threads. | Medium | Medium | Implement timeouts, retries with backoff, circuit breakers, and provider-specific rate limiting. |
| Feature server actions ↔ Mesh | Elevation of Privilege | Server actions called without proper feature flag checks or authorization escalate privileges. | Medium | High | Enforce server-side authorization, verify feature flags, use least-privilege service accounts. |
| Pipecat Daily Bot ↔ Daily.co transport | Spoofing | Unauthorized participant connects to Daily room and impersonates legitimate user. | Low | High | Use Daily room tokens with participant roles, enforce lobby or waiting rooms, monitor roster changes. |
| Pipecat event bus | Tampering | Event handlers or external subscribers mutate event payloads leading to inconsistent bot state. | Medium | Medium | Validate event schemas, enforce versioning, restrict event publisher list, add integrity checks. |
| Pipecat bot control API | Repudiation | Admin actions (context injection, session termination) may lack audit trail. | Medium | Medium | Require authenticated access with signed requests, log all admin actions with timestamps. |
| Voice pipeline (Deepgram/OpenAI/TTS) | Information Disclosure | Transcripts or prompts may leak sensitive conversation data to third-party providers. | Medium | High | Obtain consent, anonymize data, restrict provider access, sign DPAs, and purge logs per policy. |
| Mesh endpoint (public network) | Denial of Service | Unauthenticated GraphQL queries could be abused for volumetric attacks. | Medium | High | Require authentication, enforce rate limiting/throttling, apply query complexity limits. |
| Feature toggle system | Elevation of Privilege | Unauthorized modification of feature flags exposes experimental features or admin tools. | Low | Medium | Protect feature flag configuration storage, audit changes, require approval workflow. |
| Dynamic HTML content viewer | Tampering/Information Disclosure | Stored HTML/JS could execute XSS against other users if not isolated. | Medium | High | Render content in sandboxed iframe with CSP, strip dangerous tags, enforce allowlist. |
| Authentication (NextAuth) | Spoofing | Weak OAuth token storage or redirect validation allows login takeover. | Low | High | Validate OAuth callbacks, store tokens securely (encrypted at rest), rotate secrets. |
| Prism provider adapters | Tampering | Compromised provider adapter could alter data before reaching Mesh. | Low | High | Code review adapters, sign releases, monitor integrity, run automated tests. |

## 5. Attack Surface Analysis
- **External entry points:**
  - Next.js web apps on ports 3000/4000/3001 (HTTP/S endpoints, API routes, server actions).
  - Mesh GraphQL endpoint on port 2000 (GraphQL queries, subscriptions if enabled).
  - Pipecat Daily Bot REST control server and WebRTC signaling (port 4444, Daily rooms).
  - OAuth redirect endpoints for Google incremental auth.
  - Feature-specific API routes (e.g., HTML generation tools, Gmail/Drive integrations).
  - WebSockets/SSE for real-time events (Mesh subscriptions, Pipecat event streams).
- **Authentication mechanisms:** NextAuth for web apps, Daily room tokens for voice sessions, API keys/secrets for third-party providers, feature flag gating via `@nia/features`.
- **Input validation:** Reliant on server actions, GraphQL resolvers, and bot event handlers; dynamic HTML content requires sandboxing and sanitization to mitigate XSS.

## 6. Known Vulnerabilities or Weak Configurations
- Dependencies include high-risk third-party SDKs (OpenAI, Deepgram, Daily) requiring timely security updates; track CVEs for GraphQL Mesh, Prisma-like adapters, and WebRTC libraries.【F:package.json†L45-L186】
- Dynamic HTML generation and viewing introduces risk of stored XSS if sanitization or iframe sandboxing lapses.
- Voice pipeline sends data to external AI providers—requires contractual safeguards and potential regional compliance controls.
- Mesh server default exposure on localhost ports may lack TLS or authentication by default; production deployments must add HTTPS, mTLS, or OAuth proxy.
- Pipecat bot configuration stores API keys via environment variables; ensure secret management and minimal file exposure.

## 7. Mitigation Recommendations
- **Authentication & Authorization:** Enforce strict auth on Mesh and control APIs, adopt MFA for dashboards, and ensure feature flag checks run server-side.
- **Input & Content Security:** Apply consistent validation schemas (e.g., Zod) for server actions, sanitize dynamic HTML, and leverage CSP + sandbox attributes.
- **Data Protection:** Encrypt secrets at rest, rotate OAuth tokens, implement token scopes aligned with least privilege, and purge voice transcripts per retention policy.
- **Network & Availability:** Add rate limiting and query complexity guards to GraphQL, implement load shedding/circuit breakers for external providers, and monitor Daily room usage.
- **Logging & Monitoring:** Capture structured logs with user/feature context, instrument anomaly detection for feature toggles, and centralize audit trails for admin actions.
- **Dependency & Config Hygiene:** Maintain SBOM, automate dependency scanning (npm audit, Snyk), harden Docker/Docker Compose configs, and ensure environment variables are provisioned via secret managers.

## 8. Risk Summary Table
| Risk | Severity | Likelihood | Mitigation Priority | Notes |
| --- | --- | --- | --- | --- |
| Multi-tenant data leak via Mesh resolvers | Critical | Medium | Immediate | Enforce tenant scoping, schema auth, and comprehensive testing. |
| Stored XSS through dynamic HTML content | High | Medium | Immediate | Sandbox rendering, sanitize inputs, add CSP and content validation. |
| Third-party AI provider data exposure | High | Medium | High | Contractual safeguards, anonymization, configurable opt-outs, retention limits. |
| DoS via unauthenticated Mesh queries | High | Medium | High | Require auth, rate limiting, query cost analysis. |
| Unauthorized feature flag changes | Medium | Low | Medium | Secure flag storage, add change approvals and logging. |
| Pipecat control API misuse | Medium | Medium | Medium | Require authenticated admin access and audit logging, sign requests. |
| Compromise of OAuth/third-party tokens | High | Low | High | Store tokens securely, rotate secrets, monitor for abnormal access. |
