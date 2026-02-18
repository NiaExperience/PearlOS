import { IDynamicContent } from "@nia/prism/core/blocks/dynamicContent.block";

export const NotesDefinition: IDynamicContent = {
    access: {
        tenantRole: 'member',
        allowAnonymous: false
    },
    dataModel: {
        block: 'Notes',
        indexer: [
            'title', 'normalizedTitle', 'mode', 'tenantId', 'sourceFile.type',
        ],
        jsonSchema: {
            additionalProperties: false,
            properties: {
                _id: { format: 'uuid', type: 'string' },
                userId: { type: 'string' },
                tenantId: { type: 'string' },
                title: { type: 'string' },
                // Lowercased, trimmed version of title for case-insensitive equality queries
                normalizedTitle: { type: 'string' },
                content: { type: 'string' },
                timestamp: { type: 'string' },
                mode: { type: 'string', enum: ['personal', 'work'] },
                sourceFile: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        size: { type: 'number' },
                        type: { type: 'string', enum: ['pdf', 'text'] },
                        extractedAt: { type: 'string' },
                        pageCount: { type: 'number' }
                    },
                    additionalProperties: false
                },
            },
            required: ['tenantId', 'title', 'mode'],
        },
        parent: { type: 'field', field: 'userId' },
    },
    description: 'User Notes',
    name: 'Notes',
    uiConfig: {
        card: {
            descriptionField: 'content',
            titleField: 'title'
        },
        detailView: {
            displayFields: [
                'title',
                'content',
                'metadata'
            ]
        },
        listView: {
            displayFields: [
                'title'
            ]
        }
    }
};
