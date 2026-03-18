## Events Package (`packages/events`)

The Events package defines PearlOS’s event catalog and generates strongly‑typed event helpers for both TypeScript and Python.

- **Purpose**: centralize event names, payload schemas, and PII redaction rules so that all producers and consumers agree on a single source of truth.
- **Tech stack**: TypeScript library published as `@nia/events`, plus a Python helper package.
- **Structure**:
  - `descriptors/events.json`: canonical event descriptors (topic, schema, piiLevel, redaction paths).
  - `src/generated/`: TypeScript event helpers produced by the codegen script.
  - `python/nia_events/`: Python helpers that mirror the TypeScript surface.
  - `scripts/codegen.ts`: builds language‑specific bindings from descriptors.
- **Integration**:
  - Emitted by Interface, Dashboard, Mesh, and the Pipecat bot.
  - Imported anywhere events are published or validated, rather than using ad‑hoc string topics.

