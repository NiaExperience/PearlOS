# Dynamic Runtime Forms with JSON Schema in NIA Universal

## Overview

As the NIA Universal platform evolves to support dynamic content types, we are adopting a runtime-driven approach for form generation, validation, and type safety. This document outlines the rationale, benefits, and implementation strategy for using JSON Schema as the source of truth for dynamic forms.

---

## Rationale

- **Dynamic Content:** New content types and fields can be registered, created, and displayed at runtime, without code changes or redeploys.
- **Single Source of Truth:** JSON Schema definitions in `platformDynamicContentDefinitions` describe the structure, validation, and UI hints for all dynamic content types.
- **Runtime Validation:** All user input and API payloads are validated at runtime using the schema, ensuring data integrity and security.
- **Type Safety:** TypeScript types are generated from JSON Schema for developer ergonomics and static analysis.
- **Dynamic UI:** Forms and UIs are generated on-the-fly from the schema, enabling instant support for new content types.

---

## Implementation Outline

### 1. **Schema Registration**

- All dynamic content types are defined in `platformDynamicContentDefinitions` using JSON Schema.
- New schemas can be registered at runtime (e.g., via admin UI or API).

### 2. **Runtime Validation**

- Use [Ajv](https://ajv.js.org/) to validate data against the relevant JSON Schema at runtime.
- Validation occurs on both frontend (form validation) and backend (API payload validation).

### 3. **Type Inference**

- Use [`json-schema-to-typescript`](https://github.com/bcherny/json-schema-to-typescript) to generate TypeScript types from JSON Schema as a build/dev step.
- Types are imported and used throughout the codebase for type safety and autocomplete.

### 4. **Dynamic Form Generation**

- Use a library like [react-jsonschema-form](https://github.com/rjsf-team/react-jsonschema-form) to generate forms from JSON Schema at runtime.
- Forms are rendered dynamically based on the registered schema, supporting new content types instantly.

### 5. **Dynamic UI Rendering**

- List/detail/table views are generated from schema metadata (e.g., `uiConfig` fields).
- UI adapts automatically as schemas evolve.

---

## Benefits

- **Flexibility:** Instantly support new content types and fields.
- **Consistency:** Validation, UI, and types are always in sync.
- **Developer Experience:** Type safety and autocomplete from generated types.
- **User Experience:** Dynamic, schema-driven forms and UIs.

---

## Example Workflow

1. **Register a new content type** with a JSON Schema definition.
2. **Generate TypeScript types** from the schema (build/dev step).
3. **Render forms and UIs** dynamically from the schema.
4. **Validate data** at runtime using Ajv.
5. **Store and display content** using the dynamic schema.

---

## References

- [Ajv JSON Schema Validator](https://ajv.js.org/)
- [json-schema-to-typescript](https://github.com/bcherny/json-schema-to-typescript)
- [react-jsonschema-form](https://github.com/rjsf-team/react-jsonschema-form)
- [NIA Universal platformDynamicContentDefinitions (source reference)](../../../../packages/prism/src/core/content/platform-definitions-jsonSchema.ts)
