# Plan: LinkMap URL Shortener

## Objective
Replace long, scary base64-encoded share URLs with short, friendly URLs using a new `LinkMap` dynamic content block.

## Scope
- **Definitions**: Create `LinkMapDefinition` in `packages/features`.
- **Actions**: Create `linkmap-actions.ts` with `ensure` wrappers.
- **API**: Update `api/share/generate` to store `LinkMap` records and return short URLs.
- **Frontend**: Update `app/share/[payload]` to resolve short IDs.
- **Dashboard**: Add "Link Map" admin page.

## Checklist

### 1. Definition
- [ ] Create `packages/features/src/definitions/LinkMapDefinition.ts`.
    - [ ] Block name: `LinkMap`.
    - [ ] Fields:
        - `page_id` (string, unique, indexed) - The short code.
        - `token` (string) - The encrypted resource share token.
        - `resourceId` (string) - For reference/admin.
        - `contentType` (string) - For reference/admin.
        - `assistantName` (string) - For reference/admin.
        - `mode` (string) - For reference/admin.
        - `createdAt` (string).
        - `expiresAt` (string).
    - [ ] Indexer: `['page_id', 'resourceId']`.
- [ ] Export in `packages/features/src/definitions/index.ts`.

### 2. Actions
- [ ] Create `apps/interface/src/features/ResourceSharing/actions/linkmap-actions.ts`.
    - [ ] Implement `createLinkMapDefinition(tenantId)`.
    - [ ] Implement `ensureLinkMapDefinition(operation, tenantId)`.
    - [ ] Implement `createLinkMap(data, tenantId)`.
        - [ ] Generate `page_id` (e.g., base64url of a UUID or a nanoid).
        - [ ] Use `ensureLinkMapDefinition`.
    - [ ] Implement `getLinkMapByPageId(pageId)`.
        - [ ] Use `ensureLinkMapDefinition`.
    - [ ] Implement `deleteLinkMap(id)`.
    - [ ] Implement `listLinkMaps(tenantId, limit, offset)`.

### 3. API Updates
- [ ] Modify `apps/interface/src/app/api/share/generate/route.ts`.
    - [ ] Instead of returning the long payload, call `createLinkMap`.
    - [ ] Return the short URL: `${baseUrl}/share/${pageId}`.
    - [ ] Ensure `tenantId` is handled correctly (likely 'any' or the user's tenant).

### 4. Frontend Resolution
- [ ] Modify `apps/interface/src/app/share/[payload]/page.tsx`.
    - [ ] Check if `payload` is a short ID (e.g., length check or lookup).
    - [ ] If short ID:
        - [ ] Call `getLinkMapByPageId`.
        - [ ] If found, reconstruct the `sharePayload` object from the `LinkMap` data.
    - [ ] If long ID (legacy):
        - [ ] Decode as before.
    - [ ] Pass the resolved payload to the client component.

### 5. Dashboard
- [ ] Create `apps/dashboard/src/app/dashboard/admin/link-map/page.tsx`.
    - [ ] Table listing `LinkMap` entries.
    - [ ] Columns: `Page ID`, `Resource ID`, `Type`, `Created At`, `Actions`.
    - [ ] Delete action.

## Implementation Details

### LinkMapDefinition.ts
```typescript
import { IDynamicContent } from "@nia/prism/core/blocks/dynamicContent.block";

export const LinkMapDefinition: IDynamicContent = {
    access: {
        tenantRole: 'viewer', // Allow read access for resolution
        allowAnonymous: true  // Allow anonymous resolution
    },
    dataModel: {
        block: 'LinkMap',
        indexer: ['page_id', 'resourceId'],
        jsonSchema: {
            additionalProperties: false,
            properties: {
                _id: { format: 'uuid', type: 'string' },
                page_id: { type: 'string' },
                token: { type: 'string' },
                resourceId: { type: 'string' },
                contentType: { type: 'string' },
                assistantName: { type: 'string' },
                mode: { type: 'string' },
                createdAt: { type: 'string' },
                expiresAt: { type: 'string' },
                tenantId: { type: 'string' }
            },
            required: ['page_id', 'token', 'resourceId']
        },
        parent: { type: 'field', field: 'tenantId' } // Or 'none' if global?
    },
    description: 'URL Shortener Map',
    name: 'LinkMap',
    uiConfig: {
        card: { titleField: 'page_id', descriptionField: 'resourceId' },
        detailView: { displayFields: ['page_id', 'resourceId', 'createdAt'] }
    }
};
```

### linkmap-actions.ts
Follow the pattern in `notes-actions.ts`:
```typescript
export async function createLinkMap(data: LinkMapInput, tenantId: string) {
    return ensureLinkMapDefinition(async () => {
        const prism = await Prism.getInstance();
        // ... create logic
    }, tenantId);
}
```

## Verification
- [ ] Verify `LinkMap` definition is created on first use.
- [ ] Verify short link generation.
- [ ] Verify short link resolution and redirection/loading.
- [ ] Verify legacy long links still work.
- [ ] Verify Admin Dashboard visibility.
