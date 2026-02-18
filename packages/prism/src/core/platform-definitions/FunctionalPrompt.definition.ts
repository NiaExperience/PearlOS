import { IDynamicContent } from "@nia/prism/core/blocks/dynamicContent.block";

export const FunctionalPromptDefinition: IDynamicContent = {
    access: {}, // Requires authentication for writes
    dataModel: {
        block: 'FunctionalPrompt',
        indexer: ['featureKey'],
        jsonSchema: {
            additionalProperties: false,
            properties: {
                _id: { format: 'uuid', type: 'string' },
                featureKey: { type: 'string' },
                promptContent: { type: 'string' },
                lastModifiedByUserId: { type: 'string', optional: true },
                history: {
                    type: 'array',
                    optional: true,
                    items: {
                        type: 'object',
                        properties: {
                            userId: { type: 'string' },
                            delta: { type: 'string' },
                            modifiedAt: { type: 'string', format: 'date-time' }
                        },
                        required: ['userId', 'delta', 'modifiedAt']
                    }
                },
                createdAt: { type: 'string', format: 'date-time', optional: true },
                updatedAt: { type: 'string', format: 'date-time', optional: true }
            },
            required: ['featureKey', 'promptContent']
        },
    },
    description: 'Feature-specific functional prompts for system composition',
    name: 'FunctionalPrompt',
    uiConfig: {
        card: { titleField: 'featureKey', descriptionField: 'promptContent' },
        detailView: { displayFields: ['featureKey', 'promptContent', 'lastModifiedByUserId'] },
        listView: { displayFields: ['featureKey', 'lastModifiedByUserId'] }
    }
};
