<!-- Banner: The Prism Lab -->
<p align="center">
  <img src="../resources/data-prism-lab.png" alt="Prism Refractory" width="75%" style="max-width:900px; border-radius: 12px; box-shadow: 0 4px 32px rgba(0,0,0,0.18);" />
  <br/>
  <em style="color: #888; font-size: 1.1em;">Prism Refractory – Reveal the Hidden Spectrum of Your Data</em>
</p>

# Prism Refractory: Schema Introspection & Discovery Design Intent

## The Prism Refractory

The **Prism Refractory** is the introspection and schema discovery engine of the Nia Data Prism. Just as a physical prism refracts light to reveal its hidden spectrum, the Prism Refractory performs **schema refraction**—transforming and revealing the structure of data sources as they pass through the Prism layer.

## Overview

To streamline onboarding of new data sources and enable dynamic schema mapping for the Nia Data Prism, we will leverage **GraphQL Mesh** as the primary engine for schema refraction and discovery. This approach will support SQL databases, NoSQL databases (including MongoDB), and API-based sources (OpenAPI/Swagger, GraphQL, etc.).

---

```mermaid
flowchart TD
    subgraph "Applications (existing)"
        I["Interface App"]
        D["Dashboard App"]
    end
    
    subgraph "Nia Data Prism (planned)"
        subgraph "Prism Core (Business Logic)"
            CA["Content Actions"]
            DC["Dynamic Content Definitions"]
            AC["Access Control"]
            BL["Business Logic"]
        end
        ORCH["Prism Orchestrator"]
        DBRIDGE["Prism Data Bridge"]
        RF["Prism Refractory"]
    end
    
    subgraph "Data Sources (target)"
        PG["PostgreSQL"]
        MG["MongoDB"]
        YT["YouTube API"]
        EXT["External APIs"]
    end

    I --> CA
    D --> CA
    
    CA --> ORCH
    CA --> DC
    DC --> ORCH
    AC --> ORCH
    BL --> ORCH
    
    ORCH --> DBRIDGE
    DBRIDGE --> PG
    DBRIDGE --> MG
    DBRIDGE --> YT
    DBRIDGE --> EXT

    RF -. "registration-time: schema refraction & mapping" .-> DBRIDGE
```

---

## Status Note (June 2024)

> Provider-based routing in content actions is the next major milestone. The current implementation is still Notion/Postgres-specific, but the codebase is ready for dynamic provider selection.

## Proof of Concept: MongoDB Schema Refraction

As our applications originated with MongoDB and later migrated to Postgres, we have a well-defined, production-ready data model for our legacy MongoDB data. This provides a clear reference for validating the effectiveness of schema refraction in the Prism Refractory.

**POC Approach:**
1. **Extract the Reference Model:**
   - Use the data models in `apps/interface/src/migration` as the "answer key" for the correct MongoDB schema mapping (entities, fields, types, relationships).
2. **Run MongoDB Introspection:**
   - Use GraphQL Mesh (via the Prism Refractory) to introspect a MongoDB instance containing the legacy data.
3. **Compare & Map:**
   - Compare the refracted schema output to the reference model.
   - Identify mismatches, edge cases, or required user tweaks.
4. **Refine the Refraction Process:**
   - Adjust the introspection/mapping logic to better match the reference.
   - Document any manual steps or user interventions needed.
5. **Demo & Document:**
   - Present a before/after: legacy MongoDB → Prism Refractory → mapped schema (matching the Postgres model).
   - Use this as a case study for onboarding and validating other data sources.

**Benefits:**
- Provides a concrete, testable goal for the POC.
- Surfaces real-world mapping challenges and edge cases.
- Demonstrates the Prism Refractory’s ability to handle non-SQL sources and legacy migrations.

## Planned Structure: IDynamicContent with provider, dataModel, and uiConfig

To support a modular and extensible data architecture, each `DynamicContent` record will include:

- **provider**: Details about the data source provider (type, connection/configuration, credentials, sync settings, etc.).
- **dataModel**: The logical schema as mapped for use in DynamicContent (entities, fields, types, relationships).
- **uiConfig**: User-controlled configuration for how the data is displayed in the UI (columns, formatting, widgets, etc.).

**Flow:**
1. **Auto-discovery/inspection** (via Prism Refractory) proposes a `dataModel` and a `provider`.
2. **User review and mapping**: User tweaks the `dataModel` and/or `provider` as needed.
3. **DynamicContent record** is created with both structures populated.
4. **uiConfig** can be edited later to control the visual display.

### Example: Conceptual Targets

#### SQL Data Source
```json
{
  "provider": {
    "type": "sql",
    "engine": "postgres",
    "connection": "postgres://user:pass@host:5432/db",
    "schema": "public"
  },
  "dataModel": {
    "entities": [
      { "name": "User", "fields": [ { "name": "id", "type": "uuid" }, { "name": "email", "type": "string" } ] }
    ]
  },
  "uiConfig": {
    "defaultView": "table",
    "columns": ["id", "email"]
  }
}
```

#### MongoDB Data Source
```json
{
  "provider": {
    "type": "mongodb",
    "connection": "mongodb://user:pass@host:27017/db",
    "collection": "users"
  },
  "dataModel": {
    "entities": [
      { "name": "User", "fields": [ { "name": "_id", "type": "ObjectId" }, { "name": "email", "type": "string" } ] }
    ]
  },
  "uiConfig": {
    "defaultView": "table",
    "columns": ["_id", "email"]
  }
}
```

#### API Data Source (OpenAPI/REST)
```json
{
  "provider": {
    "type": "openapi",
    "specUrl": "https://api.example.com/openapi.json",
    "basePath": "/v1"
  },
  "dataModel": {
    "entities": [
      { "name": "User", "fields": [ { "name": "id", "type": "string" }, { "name": "email", "type": "string" } ] }
    ]
  },
  "uiConfig": {
    "defaultView": "list",
    "fields": ["id", "email"]
  }
}
```

**Benefits:**
- Clear separation of concerns: source, schema, and display.
- Extensible for new provider types and UI features.
- User-friendly and audit-friendly.

## Design Intent

- **Prism Refractory as the Schema Refraction Engine:**
  - The Refractory will use GraphQL Mesh to refract and unify schemas from a variety of data sources:
    - **SQL databases** (Postgres, MySQL, etc.)
    - **NoSQL databases** (MongoDB, etc.)
    - **APIs** (OpenAPI/Swagger, GraphQL, gRPC, etc.)
  - Mesh handlers/plugins will be configured for each data source type to extract schema metadata.

- **Prism Layer Responsibilities:**
  - Provide utilities and APIs to:
    - Accept data source registration (connection string, API spec, etc.)
    - Trigger schema refraction via the Prism Refractory
    - Return a normalized, generic schema representation (entities, fields, types, relationships)
    - Accept user tweaks/mappings and finalize schema for use with DynamicContent

## Why GraphQL Mesh?

- **Unified abstraction**: Mesh supports a wide range of data sources and exposes them as a single GraphQL schema.
- **Introspection support**: Mesh can refract both database and API schemas, including MongoDB and other non-SQL sources.
- **Extensibility**: New data source types can be added via Mesh plugins/handlers.
- **Ecosystem**: Mesh is actively maintained and widely used for schema stitching and federation.

## Implementation Notes

- Start with Mesh handlers for SQL, MongoDB, and OpenAPI.
- Expose a Prism Refractory API endpoint for schema refraction and mapping.
- Iterate to support additional data source types as needed.

## Next Steps

1. Prototype Mesh-based schema refraction for SQL, MongoDB, and OpenAPI sources.
2. Design and implement Prism Refractory API endpoints for schema discovery.
3. Expand support and refine user experience based on feedback.
