# Mesh Content API Plan

Date: 2025-08-13

## Goal

Expose a lightweight REST API on the Mesh server that wraps Prism content and definition operations for:

* Content CRUD: create, read (single & query), update, delete
* Definition limited CRUD: create and find (no update/delete via this API)

This supplements the existing GraphQL endpoint with simpler programmatic endpoints for operational scripting and integrations.

## Scope

In-scope (Phase 1 now updated):

* REST endpoints under `/api` namespace (definitions + content CRUD)
* Shared-secret + JWT auth (fallback to `NEXTAUTH_SECRET` if `AUTH_SIGNING_KEY` absent)
* JSON request/response format with normalized envelopes
* Tenant scoping derived from authenticated user (fallback `any`)
* Advanced filtering: accept a JSON `where` query parameter allowing nested operators on indexed / stored fields (e.g. `?where={"page_id":{"eq":"abc"},"status":{"in":["active","paused"]}}`). Operators supported: `eq`, `ne`, `in`, `nin`, `contains`, `lt`, `lte`, `gt`, `gte`, `between` (array length 2), and logical `and` / `or` arrays.
* Indexer path queries: use explicit `indexer` object syntax matching Prism tests: `{"indexer":{"path":"title","equals":"Test"}}` optionally combined with other predicates: `{"parent_id":"<id>","indexer":{"path":"name","equals":"Alice"}}`. The special `indexer` object bypasses normal operator validation and must include `path` and one of `equals` or `eq` (aliases). Invalid structure -> 400.
* **Interactive Swagger UI**: Beautiful, professional API documentation interface at `/docs` with:
  * 🎨 **Enhanced Visual Design**: Modern glass morphism styling with gradient backgrounds and smooth animations
  * 🧪 **Try It Out Functionality**: Test all endpoints directly in the browser with real requests
  * 📖 **Comprehensive Documentation**: Auto-generated examples for all request/response schemas
  * 🔍 **Advanced Filtering Examples**: Interactive documentation for complex where clauses and indexer queries
  * 🎯 **Brain Integration Examples**: Ready-to-use code samples for Brain service integration
  * 📱 **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices
  * 🌈 **Color-Coded Methods**: Visual distinction between GET, POST, PUT, DELETE operations
* **Raw OpenAPI Specification**: Machine-readable JSON spec at `/docs/docs.json` for programmatic consumption
* JWT issuance utility script (`scripts/issue-jwt.ts`) for local/service token minting using `AUTH_SIGNING_KEY || NEXTAUTH_SECRET`.

![Swagger UI Interface](./swagger-ui-screenshot.png)
*Interactive Swagger UI with enhanced styling and comprehensive API documentation*

Out of scope (future phases):

* Bulk operations (bulk create/update/delete)
* Definition update or delete
* Pagination styles beyond limit/offset + total (cursor, keyset)
* PATCH partial document updates
* Role-based field-level authorization & masking
* Ed25519 / asymmetric signing keys
* Impersonation headers (admin controlled)
* Rate limiting & quotas
* OpenAPI auto-generation & CI validation (manual spec only in Phase 1)

## Endpoints

Definitions:

* GET `/api/definition/:type?tenant=` → find definition
* POST `/api/definition` (body: `{ definition: IDynamicContent, tenant?: string }`) → create definition

Content:

* GET `/api/content/:type/:id` → fetch single content by page_id
* GET `/api/content/:type?limit=&offset=&page_id=&where=` → query content. `where` is URL-encoded JSON object of filter predicates (see Filtering section). `page_id` is a shorthand eq filter.
* POST `/api/content/:type` (body: `{ content: ContentData }`) → create content
* PUT `/api/content/:type/:id` (body: `{ content: ContentData }`) → update content
* DELETE `/api/content/:type/:id` → delete content

## Request / Response Shapes

Success envelope:

```json
{ "success": true, "data": {}, "total": 0, "hasMore": false }
```

Error envelope:

```json
{ "success": false, "error": { "message": "...", "code": "...", "details": {} } }
```

## Filtering & Validation Rules

Filtering:

* `where` (optional) must be valid JSON object.
* Allowed operator keys (case-sensitive): `eq|ne|in|nin|contains|lt|lte|gt|gte|between|and|or`. (Within `indexer` objects, `path` and `equals|eq` are allowed.)
* Values for `between` must be an array of length 2.
* `and` / `or` must be arrays of predicate objects.
* Any disallowed operator → 400 error.
* Dot-path keys permitted (e.g. `profile.details.age`).

General validation:

* `:type` required and non-empty.
* IDs treated as `page_id` (string).
* Definition creation must return at least one item or 500 error.
* Update/delete return 404 if target not found.
* JWT (if provided) must not be expired; else 401.

## Auth

Authentication / authorization layers (current implementation):

1. **Service authentication**: `x-mesh-secret` for trusted in‑cluster services (Interface server, Brain service). Browser clients should never possess this secret.
2. **User authentication**: `Authorization: Bearer <JWT>` where the JWT carries claims: `sub` (userId), `tenant`, `roles`, `iat`, `exp`. Mesh derives user/tenant context exclusively from this token. Uses HS256 signing with configurable key hierarchy.
3. **Impersonation** (OPTIONAL / deferred): headers `x-impersonate-user`, `x-impersonate-tenant` only honored in a future phase when both a valid service secret and an admin role are present. (Not implemented in Phase 1.)

**JWT Implementation Details:**

* **Current Status**: Fully implemented with HS256 signature verification
* **Signing Key Hierarchy**: `AUTH_SIGNING_KEY` → `NEXTAUTH_SECRET` → `MESH_SHARED_SECRET` (fallback chain)
* **Token Validation**: Includes expiration checking, proper error handling for malformed/expired tokens
* **User Context**: Extracts user ID, tenant, and roles from JWT claims for request scoping
* **Testing Support**: JWT issuance utility script available for development/testing

**Environment Variables:**
**Environment Variables:**
 
* `MESH_SHARED_SECRET` – existing service secret for service-to-service authentication
* `AUTH_SIGNING_KEY` – primary JWT signing key (HS256)
* `NEXTAUTH_SECRET` – fallback JWT signing key (also used by NextAuth in Interface app)

**Token Issuance:**

* Utility script `scripts/issue-jwt.ts` available for development/testing token generation
* Interface app will eventually mint short‑lived JWTs for production Brain & Mesh calls
* Current implementation supports both service secrets and user JWT tokens simultaneously

## Implementation Steps (Updated)

1. (DONE) Add dependency on `@nia/prism` to mesh server package.json.
2. (DONE) Implement `src/api/contentApi.ts` endpoints.
3. (DONE) Auth middleware with service secret + JWT (HS256) verification.
4. (DONE) Mount middleware & router.
5. (DONE) Tenant scoping from JWT token.
6. (DONE) Advanced filtering: parse & validate `where` parameter, pass through to Prism.
7. (DONE) Add OpenAPI spec module `src/api/openapiSpec.ts` and route `GET /api/docs.json` serving spec.
8. (DONE) Add JWT issuance utility script `scripts/issue-jwt.ts` using signing key hierarchy.
9. (DONE) Document JWT authentication implementation and usage patterns.
10. (Deferred) Impersonation & role-based enforcement.

## Error Handling Strategy

* Wrap each handler in try/catch
* Log server-side errors with context
* Map not-found to 404
* All other failures → 500

## Future Enhancements (Not Implemented Now)

* Bulk endpoints (bulk create/delete)
* More expressive filter operators (`regex`, full-text search)
* Partial updates (PATCH)
* Automated OpenAPI generation & publishing pipeline
* CORS fine-tuning per route
* Rate limiting & quota per tenant
* Asymmetric (Ed25519) signing & key rotation
* Impersonation + admin override paths
* OpenAPI examples & test harness auto-sync

## JWT Issuance Utility (Currently Available)

Script: `scripts/issue-jwt.ts`

Purpose: Mint HS256 JWTs for testing and development of Mesh API calls. Supports the current authentication implementation.

Signing key precedence: `AUTH_SIGNING_KEY || NEXTAUTH_SECRET || MESH_SHARED_SECRET`

Example:

```bash
AUTH_SIGNING_KEY=dev-local-secret npx ts-node scripts/issue-jwt.ts --sub user123 --tenant tenantA --roles user,editor --exp 600
```

Output: raw JWT string (print). Use in requests:

`Authorization: Bearer <token>`

Claims:

* `sub`: user id
* `tenant`: tenant id
* `roles`: optional array
* `iat` / `exp`: issued-at & expiration (seconds)

Validation: Middleware rejects expired tokens; tenant derived from token.

---
Prepared by: Automated assistant
