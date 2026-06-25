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
                onboardingState: {
                    type: 'object',
                    optional: true,
                    additionalProperties: false,
                    properties: {
                        currentBeat: { type: 'number', optional: true },
                        completedBeats: {
                            type: 'array',
                            optional: true,
                            items: { type: 'string' }
                        },
                        requiredActions: {
                            type: 'object',
                            optional: true,
                            additionalProperties: false,
                            properties: {
                                profileUpdated: { type: 'boolean', optional: true },
                                welcomeNoteCreated: { type: 'boolean', optional: true }
                            }
                        },
                        source: { type: 'string', optional: true },
                        promptFeatureKey: { type: 'string', optional: true },
                        updatedAt: { type: 'string', format: 'date-time', optional: true }
                    }
                },
                overlayDismissed: { type: 'boolean', optional: true },
                createdAt: { type: 'string', format: 'date-time', optional: true },
                publicPersona: {
                    type: 'object',
                    optional: true,
                    additionalProperties: false,
                    properties: {
                        displayName: { type: 'string', optional: true },
                        bio: { type: 'string', optional: true },
                        interests: {
                            type: 'array',
                            optional: true,
                            items: { type: 'string' }
                        },
                        socialLinks: {
                            type: 'object',
                            optional: true,
                            additionalProperties: false,
                            properties: {
                                twitter: { type: 'string', optional: true },
                                bluesky: { type: 'string', optional: true },
                                github: { type: 'string', optional: true },
                                website: { type: 'string', optional: true }
                            }
                        },
                        avatarUrl: { type: 'string', optional: true },
                        location: { type: 'string', optional: true },
                        profession: { type: 'string', optional: true },
                        isPublic: { type: 'boolean', optional: true, default: false }
                    }
                },
                privateMemory: {
                    type: 'object',
                    optional: true,
                    additionalProperties: false,
                    properties: {
                        personalNotes: { type: 'string', optional: true },
                        preferences: { type: 'object', additionalProperties: true, optional: true },
                        reminders: {
                            type: 'array',
                            optional: true,
                            items: {
                                type: 'object',
                                properties: {
                                    text: { type: 'string' },
                                    createdAt: { type: 'string', format: 'date-time' },
                                    dueDate: { type: 'string', format: 'date-time', optional: true }
                                },
                                required: ['text', 'createdAt']
                            }
                        },
                        sensitiveData: { type: 'object', additionalProperties: true, optional: true },
                        relationshipContext: { type: 'string', optional: true }
                    }
                },
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
        detailView: { displayFields: ['first_name', 'email', 'publicPersona', 'privateMemory', 'sessionHistory', 'personalityVoiceConfig', 'lastConversationSummary'] },
        listView: { displayFields: ['first_name', 'email'] }
    }
};
