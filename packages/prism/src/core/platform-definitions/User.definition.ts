import { IDynamicContent } from '../blocks/dynamicContent.block';

// Platform Content Definition: User
export const UserDefinition: IDynamicContent = {
    access: {},
    dataModel: {
        block: 'User',
        indexer: [
            'name',
            'email',
            'phone_number'
        ],
        jsonSchema: {
            additionalProperties: false,
            properties: {
                _id: {
                    format: 'uuid',
                    type: 'string'
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
                email: {
                    format: 'email',
                    type: 'string'
                },
                emailVerified: {
                    format: 'date-time',
                    type: 'string'
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
                image: {
                    type: 'string'
                },
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
                metadata: {
                    additionalProperties: true,
                    properties: {},
                    type: 'object'
                },
                name: {
                    type: 'string'
                },
                password_hash: {
                    type: 'string'
                },
                phone_number: {
                    type: 'string'
                },
                status: {
                    type: 'string'
                }
            },
            required: [
                'name'
            ],
            type: 'object'
        },
        parent: {
            type: 'none'
        }
    },
    description: 'Dynamic User content type',
    name: 'User',
    uiConfig: {
        card: {
            descriptionField: 'email',
            imageField: 'image',
            tagField: 'phone_number',
            titleField: 'name'
        },
        detailView: {
            displayFields: [
                'interests',
                'social_styles',
                'status',
                'password_hash',
                'emailVerified',
                'metadata',
                'messages',
                'eventHistory',
                'chatHistory'
            ]
        },
        listView: {
            displayFields: []
        }
    }
};