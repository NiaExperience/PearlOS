import { IDynamicContent } from '../blocks/dynamicContent.block';

// Platform Content Definition: AnonymousUser
export const AnonymousUserDefinition: IDynamicContent = {
    access: {},
    dataModel: {
        block: 'AnonymousUser',
        indexer: [
            'sessionId'
        ],
        jsonSchema: {
            additionalProperties: false,
            properties: {
                _id: { format: 'uuid', type: 'string' },
                sessionId: { type: 'string' },
                messages: {
                    items: {
                        additionalProperties: false,
                        properties: {
                            content: {
                                type: 'string'
                            },
                            timestamp: {
                                format: 'date-time',
                                type: 'string'
                            },
                            type: {
                                type: 'string'
                            }
                        },
                        required: [
                            'content'
                        ],
                        type: 'object'
                    },
                    type: 'array'
                },
                eventHistory: {
                    items: {
                        additionalProperties: false,
                        properties: {
                            details: {
                                items: {
                                    type: 'string'
                                },
                                type: 'array'
                            },
                            eventType: {
                                type: 'string'
                            },
                            timestamp: {
                                format: 'date-time',
                                type: 'string'
                            }
                        },
                        required: [
                            'eventType'
                        ],
                        type: 'object'
                    },
                    type: 'array'
                },
                chatHistory: {
                    items: {
                        additionalProperties: false,
                        properties: {
                            message: {
                                type: 'string'
                            },
                            metadata: {
                                additionalProperties: true,
                                properties: {},
                                type: 'object'
                            },
                            sender: {
                                type: 'string'
                            },
                            timestamp: {
                                format: 'date-time',
                                type: 'string'
                            }
                        },
                        required: [
                            'message',
                            'sender'
                        ],
                        type: 'object'
                    },
                    type: 'array'
                },
                metadata: {
                    type: 'object',
                    additionalProperties: true
                }
            },
            required: ['sessionId'],
            type: 'object'
        },
        parent: { type: 'field', field: 'sessionId' }
    },
    description: 'Dynamic AnonymousUser content type',
    name: 'AnonymousUser',
    uiConfig: {
        card: {
            descriptionField: 'sessionId',
            titleField: 'sessionId'
        },
        detailView: {
            displayFields: [
                'sessionId',
                'messages',
                'eventHistory',
                'chatHistory',
                'metadata'
            ]
        },
        listView: {
            displayFields: [
                'sessionId'
            ]
        }
    }
};