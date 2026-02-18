import { IDynamicContent } from '../blocks/dynamicContent.block';

// Platform Content Definition: User
export const UserTenantRoleDefinition: IDynamicContent = {
    access: {},
    dataModel: {
        block: 'UserTenantRole',
        indexer: [
            'tenantId',
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
                tenantId: {
                    type: 'string'
                },
                role: {
                    type: 'string',
                    enum: ['owner', 'admin', 'member']
                },
            },
            required: [
                'userId',
                'tenantId',
                'role'
            ],
            type: 'object'
        },
        parent: {
            type: 'field',
            field: 'userId'
        }
    },
    description: 'Dynamic UserTenantRole content type',
    name: 'UserTenantRole',
    uiConfig: {
        card: {
            descriptionField: 'role',
            tagField: 'role',
            titleField: 'userId'
        },
        detailView: {
            displayFields: [
                'userId',
                'tenantId',
                'role'
            ]
        },
        listView: {
            displayFields: [
                'userId',
                'tenantId',
                'role'
            ]
        }
    }
};