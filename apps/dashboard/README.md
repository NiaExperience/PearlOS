# Nia Dashboard

The Nia Dashboard is the **authoring and management application** for assistants and assistant content in the Nia-Universal platform. It provides a rich UI for creating, configuring, and managing assistants, dynamic content types, and all related resources. The Dashboard is built on a **provider-agnostic, backend-agnostic architecture** powered by the [Nia Data Prism](../../packages/prism/README.md).

---

## Architecture: Dashboard + Prism

### What is Prism?
[Prism](../../packages/prism/README.md) is a universal data abstraction layer that provides a unified, provider-agnostic API for all content and assistant operations. It enables the dashboard to:
- Query, create, update, and delete any content type (dynamic or static) using generic APIs.
- Remain agnostic to the underlying data provider (Postgres, MongoDB, APIs, etc.).
- Support dynamic content types defined at migration/runtime, not hardcoded in the app.
- Enforce tenant and assistant scoping for all data operations.

### Dashboard’s Role
- **Authoring App:** The dashboard is the primary UI for creating and managing assistants, their content, and dynamic content definitions.
- **Content-Type Agnostic:** All content operations (CRUD) are routed through Prism’s generic APIs, not hardwired to specific types.
- **Tenant-Aware:** Users select a tenant; all queries and mutations are scoped to the selected tenant.
- **Assistant-Aware:** Content and features are filtered by the selected assistant and its supported content types.

---

## How Dashboard Uses Prism

All backend data operations in the dashboard use Prism’s provider-agnostic APIs. Example:

```typescript
import { Prism } from '@nia/prism/prism';

const prism = Prism.getInstance();

// Query dynamic content for a tenant
const result = await prism.query({
  contentType: 'agenda',
  tenantId: selectedTenantId,
  where: { status: 'active' },
  limit: 10,
});

// Create a dynamic content definition
const definition = await prism.createDefinition({
  name: 'Custom Content',
  dataModel: { /* schema definition */ },
  tenantId: selectedTenantId,
});
```

- **No direct DB or Notion calls:** All data access is through Prism.
- **No domain-specific actions:** All CRUD is generic and contentType-driven.
- **Dynamic content:** New types can be defined and managed at runtime.

---

## Migration Rationale & Goals

- **Provider-Agnostic:** Decouple dashboard from any specific backend (Postgres, MongoDB, etc.).
- **Content-Type Agnostic:** Support arbitrary content types defined at runtime, not just hardcoded ones.
- **Centralized Logic:** Move all business logic, validation, and access control to Prism.
- **Tenant & Assistant Awareness:** All data is scoped to the current tenant and assistant.
- **Future-Proof:** Enable new features and integrations without rewriting dashboard logic.

---

## Testing & Shared Code

- **Test Utilities:** All tests use the shared testlib and helpers from `@nia/prism/testing`.
- **Integration-Style:** Tests prefer real data flows and direct API handler invocation, with minimal mocking.
- **UI Testing:** Uses `@testing-library/react` for component tests.
- **Shared Code:** Business logic, types, and utilities are imported from `@nia/prism`.

---

## Design Decisions & Migration Log

- **2024-06:** Dashboard fully migrated to provider-agnostic Prism APIs and shared test patterns.
- Domain-specific logic is isolated to the UI/components layer; all backend and data access is genericized.
- All new features and endpoints are covered by integration-style tests.
- Folder structure and code organization are aligned for future integration with other Nia apps.
- See [root README](../../README.md) and [Prism README](../../packages/prism/README.md) for additional design rationale and technical details.

---

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:4000](http://localhost:4000) in your browser.

3. **Environment:**
   - Configuration is loaded from the root `.env.local` file. See the [root README](../../README.md) for setup instructions.

4. **Run tests:**
   ```bash
   npm run test
   ```

---

## Project Structure

- `app/` - Main application code (Next.js app directory)
- `components/` - Reusable React components
- `lib/` - Utility functions and shared code
- `public/` - Static assets
- `styles/` - Global styles and CSS modules
- `__tests__/` - Integration and unit tests
- `migration/` - Legacy migration scripts and models (not used in main app logic)

---

## Further Reading
- [Root README](../../README.md): Monorepo architecture, migration plan, and shared code overview
- [Prism README](../../packages/prism/README.md): Data abstraction, provider-agnostic APIs, and technical details
- [Prism Testing](../../packages/prism/src/testing/README.md): Test utilities and patterns

---

**The Nia Dashboard is the central authoring tool for assistants and dynamic content in the Nia-Universal platform, powered by the provider-agnostic Nia Data Prism.**
