import { IDynamicContent } from "@nia/prism/core/blocks/dynamicContent.block";

export const AppletStorageDefinition: IDynamicContent = {
    access: {
        tenantRole: 'member',
        allowAnonymous: false
    },
    dataModel: {
        block: 'AppletStorage',
        indexer: [
            'appletId', 'userId'
        ],
        jsonSchema: {
            additionalProperties: false,
            properties: {
                _id: { format: 'uuid', type: 'string' },
                data: { 
                    type: 'object',
                    description: 'Free-form JSON data storage for applet',
                    additionalProperties: true
                },
                appletId: { 
                    type: 'string',
                    format: 'uuid',
                    description: 'Reference to HtmlGeneration record ID'
                },
                userId: { 
                    type: 'string',
                    description: 'User ID who owns the parent applet'
                },
                createdAt: { type: 'string', format: 'date-time' },
                updatedAt: { type: 'string', format: 'date-time' }
            },
            required: ['data', 'appletId', 'userId'],
        },
        parent: { type: 'field', field: 'userId' },
    },
    description: 'Data storage for HTML applets',
    name: 'AppletStorage',
    uiConfig: {
        card: {
            titleField: 'appletId',
            descriptionField: 'data'
        },
        detailView: {
            displayFields: [
                'appletId',
                'userId',
                'data',
                'createdAt'
            ]
        },
        listView: {
            displayFields: [
                'appletId',
                'createdAt'
            ]
        }
    }
};

export const HtmlGenerationDefinition: IDynamicContent = {
    access: {
        tenantRole: 'member',
        allowAnonymous: false
    },
    dataModel: {
        block: 'HtmlGeneration',
        indexer: [
            'title', 'contentType', 'tenantId', 'createdBy', 'tags', 'sourceNoteId'
        ],
        jsonSchema: {
            additionalProperties: false,
            properties: {
                _id: { format: 'uuid', type: 'string' },
                title: { type: 'string' },
                contentType: { 
                    type: 'string', 
                    enum: ['game', 'app', 'tool', 'interactive'] 
                },
                htmlContent: { type: 'string' },
                userRequest: { type: 'string' },
                isAiGenerated: { type: 'boolean', default: true },
                createdAt: { type: 'string', format: 'date-time' },
                updatedAt: { type: 'string', format: 'date-time' },
                createdBy: { type: 'string' }, // User ID
                tenantId: { type: 'string' },
                // Cross-reference to Note record if HTML was created from a note
                sourceNoteId: { 
                    type: 'string',
                    format: 'uuid',
                    description: 'Reference to Note record ID that was used as source material'
                },
                tags: { 
                    type: 'array',
                    items: { type: 'string' }
                },
                metadata: { 
                    type: 'object',
                    additionalProperties: true
                }
            },
            required: ['title', 'contentType', 'htmlContent', 'userRequest', 'tenantId', 'createdBy'],
        },
        parent: { type: 'field', field: 'createdBy' },
    },
    description: 'AI-Generated HTML Content (Games, Apps, Tools)',
    name: 'HtmlGeneration',
    uiConfig: {
        card: {
            titleField: 'title',
            descriptionField: 'userRequest'
        },
        detailView: {
            displayFields: [
                'title',
                'contentType',
                'userRequest', 
                'htmlContent',
                'tags',
                'metadata'
            ]
        },
        listView: {
            displayFields: [
                'title',
                'contentType',
                'createdAt'
            ]
        }
    }
};
