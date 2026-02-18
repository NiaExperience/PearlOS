import { IDynamicContent } from "@nia/prism/core/blocks/dynamicContent.block";

export const UserProfileDefinition: IDynamicContent = {
    access: { allowAnonymous: true },
    dataModel: {
        block: 'UserProfile',
        indexer: ['first_name', 'email', 'userId'],
        jsonSchema: {
            additionalProperties: false,
            properties: {
                _id: { format: 'uuid', type: 'string' },
                first_name: { type: 'string' },
                email: { type: 'string' },
                userId: { type: 'string', optional: true },
                onboardingComplete: { type: 'boolean', optional: true },
                overlayDismissed: { type: 'boolean', optional: true },
                createdAt: { type: 'string', format: 'date-time', optional: true },
                metadata: { type: 'object', additionalProperties: true, optional: true },
                sessionHistory: {
                    type: 'array',
                    optional: true,
                    items: {
                        type: 'object',
                        properties: {
                            time: { type: 'string', format: 'date-time' },
                            action: { type: 'string' },
                            sessionId: { type: 'string' },
                            refIds: {
                                type: 'array',
                                optional: true,
                                items: {
                                    type: 'object',
                                    properties: {
                                        type: { type: 'string' },
                                        id: { type: 'string' },
                                        description: { type: 'string', optional: true }
                                    },
                                    required: ['type', 'id']
                                }
                            }
                        },
                        required: ['time', 'action', 'sessionId']
                    }
                },
                personalityVoiceConfig: {
                    type: 'object',
                    optional: true,
                    properties: {
                        personalityId: { type: 'string' },
                        name: { type: 'string' },
                        voiceId: { type: 'string' },
                        voiceProvider: { type: 'string' },
                        voiceParameters: { type: 'object', additionalProperties: true, optional: true },
                        lastUpdated: { type: 'string', format: 'date-time' }
                    },
                    required: ['personalityId', 'name', 'voiceId', 'voiceProvider']
                },
                lastConversationSummary: {
                    type: 'object',
                    optional: true,
                    properties: {
                        summary: { type: 'string' },
                        sessionId: { type: 'string' },
                        timestamp: { type: 'string', format: 'date-time' },
                        assistantName: { type: 'string' },
                        participantCount: { type: 'number', optional: true },
                        durationSeconds: { type: 'number', optional: true }
                    },
                    required: ['summary', 'sessionId', 'timestamp', 'assistantName']
                }
            },
            required: ['first_name', 'email']
        },
        // No parent - platform-level record
    },
    description: 'User profile information',
    name: 'UserProfile',
    uiConfig: {
        card: { titleField: 'first_name', descriptionField: 'email' },
        detailView: { displayFields: ['first_name', 'email', 'metadata', 'sessionHistory', 'personalityVoiceConfig', 'lastConversationSummary'] },
        listView: { displayFields: ['first_name', 'email'] }
    }
};
