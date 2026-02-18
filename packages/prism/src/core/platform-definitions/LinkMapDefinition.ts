import { IDynamicContent } from "@nia/prism/core/blocks/dynamicContent.block";

export const LinkMapDefinition: IDynamicContent = {
    access: {
        tenantRole: 'viewer',
        allowAnonymous: true
    },
    dataModel: {
        block: 'LinkMap',
        indexer: ['key'],
        jsonSchema: {
            additionalProperties: false,
            properties: {
                
                _id: { format: 'uuid', type: 'string' },
                json: { type: 'string' },
                key: { type: 'string' },
                createdAt: { type: 'string' },
                expiresAt: { type: 'string' },
                tenantId: { type: 'string' }
            },
            required: ['key', 'json']
        },
        parent: { type: 'field', field: 'tenantId' }
    },
    description: 'URL Shortener Map',
    name: 'LinkMap',
    uiConfig: {}
};
