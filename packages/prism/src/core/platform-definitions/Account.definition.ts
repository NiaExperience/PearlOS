import { IDynamicContent } from '../blocks/dynamicContent.block';

// Platform Content Definition: Account
export const AccountDefinition: IDynamicContent = {
    access: {},
    dataModel: {
        block: 'Account',
        indexer: [
            'provider',
            'providerAccountId',
            'type',
        ],
        jsonSchema: {
            additionalProperties: false,
            properties: {
                _id: {
                    format: 'uuid',
                    type: 'string'
                },
                userId: {
                    type: 'string'
                },
                provider: {
                    type: 'string'
                },
                providerAccountId: {
                    type: 'string'
                },
                type: {
                    type: 'string'
                },
                refresh_token: {
                    type: 'string'
                },
                expires_at: {
                    type: 'number'
                },
                scope: {
                    type: 'string'
                },
            },
            required: [
                'userId',
                'provider',
                'providerAccountId',
                'type'
            ],
            type: 'object'
        },
        parent: {
            type: 'field',
            field: 'userId'
        }
    },
    description: 'Dynamic Account content type',
    name: 'Account',
    uiConfig: {
        card: {
            descriptionField: 'providerAccountId',
            tagField: 'provider',
            titleField: 'type'
        },
        detailView: {
            displayFields: [
                'userId',
                'provider',
                'providerAccountId',
                'type',
                'session_state'
            ]
        },
        listView: {
            displayFields: [
                'provider',
                'providerAccountId',
                'type'
            ]
        }
    }
};