## Plan: Applet Sharing via Time-Limited Tokens

We will implement a secure sharing workflow for applets (`HtmlGeneration`) using time-limited tokens. This involves creating a new token type, a redemption flow that grants organization-based access, and an admin view for tracking.

### Steps
1.  [x] **Define Token Schema**: Create `AppletShareToken` definition in `packages/prism` with fields for `appletId`, `permission` (VIEWER/MEMBER), `createdBy`, and `expiresAt`.
2.  [x] **Implement Token Actions**: Add `AppletShareTokenActions` in `packages/prism` and service methods to issue/consume tokens, ensuring validation and expiry checks.
3.  [x] **Create Redemption API**: Build `POST /api/share/redeem` in `apps/interface` to consume tokens, create a sharing Organization (if needed), and assign the user to it.
4.  [x] **Build Redemption Page**: Create `apps/interface/src/app/share/[token]/page.tsx` to handle auth redirects and call the redemption API, then forward to the applet viewer.
5.  [x] **Add Share UI**: Update `HtmlGenerationViewer` in `apps/interface` with a "Share" button that calls a new `POST /api/share/generate` endpoint to create read-only/read-write links.
6.  [x] **Create Admin View**: Add `apps/dashboard/src/app/dashboard/admin/applet-shares` to list active tokens, backed by a new API route `apps/dashboard/src/app/api/admin/applet-shares`.

### Further Considerations
1.  **Access Control**: We will leverage the existing `createSharingOrganization` pattern to grant access. Does this align with your expectation for "member" role access?
2.  **Viewer Route**: Since `HtmlGenerationViewer` is embedded, we will redirect redeemed users to a page that renders it (e.g., `/chat?appletId=...` or a new `/applet/[id]` route).
3.  **Cleanup**: We will not modify the existing email invite flow, keeping this new logic isolated as requested.
