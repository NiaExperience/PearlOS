import { IDynamicContent } from '../blocks/dynamicContent.block';

// Platform Content Definition: UserOrganizationRole
export const UserOrganizationRoleDefinition: IDynamicContent = {
    access: {},
    dataModel: {
        block: 'UserOrganizationRole',
        indexer: [
            'userId',
            'organizationId',
            'role',
        ],
        jsonSchema: {
            additionalProperties: false,
            properties: {
                _id: { format: 'uuid', type: 'string' },
                userId: { type: 'string' },
                organizationId: { type: 'string' },
                role: { type: 'string' },
            },
            required: ['userId', 'organizationId', 'role'],
            type: 'object'
        },
        parent: { type: 'field', field: 'userId' }
    },
    description: 'Dynamic UserOrganizationRole content type',
    name: 'UserOrganizationRole'
};