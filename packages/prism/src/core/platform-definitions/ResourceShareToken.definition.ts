import { IDynamicContent } from '../blocks/dynamicContent.block';

// Platform Content Definition: ResourceShareToken
export const ResourceShareTokenDefinition: IDynamicContent = {
    access: {},
    dataModel: {
      block: 'ResourceShareToken',
      indexer: [
        'token',
        'resourceId',
        'resourceType',
        'createdBy',
        'tenantId',
        'isActive'
      ],
      jsonSchema: {
        additionalProperties: false,
        properties: {
          _id: { format: 'uuid', type: 'string' },
          token: { type: 'string' },
          assistantName: { type: 'string' },
          resourceId: { type: 'string' },
          resourceType: { type: 'string', enum: ['HtmlGeneration', 'Notes'] },
          role: { type: 'string', enum: ['viewer', 'member'] },
          createdBy: { type: 'string' },
          tenantId: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time' },
          redeemedBy: { 
            type: 'array',
            items: { type: 'string' }
          },
          maxRedemptions: { type: 'number' },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' }
        },
        required: ['token', 'resourceId', 'resourceType', 'role', 'createdBy', 'expiresAt', 'isActive'],
        type: 'object'
      },
      parent: { type: 'field', field: 'createdBy' }
    },
    description: 'Time-limited token for sharing resources',
    name: 'ResourceShareToken'
  };
