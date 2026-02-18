import { IDynamicContent } from '../blocks/dynamicContent.block';

// Platform Content Definition: Organization
export const OrganizationDefinition: IDynamicContent = {
    access: {},
    dataModel: {
      block: 'Organization',
      indexer: [
        'name',
        'tenantId',
        'sharedResources',
        'sharedToAllReadOnly'
      ],
      jsonSchema: {
        additionalProperties: false,
        properties: {
          _id: { format: 'uuid', type: 'string' },
          name: { type: 'string' },
          tenantId: { type: 'string' },
          description: { type: 'string' },
          sharedToAllReadOnly: { type: 'boolean' },
          metadata: { 
            type: 'object', 
            additionalProperties: true
          },
          settings: {
            type: 'object',
            additionalProperties: true
          },
          sharedResources: {
            type: 'object',
            additionalProperties: {
              type: 'string',
              enum: ['Notes', 'HtmlGeneration']
            }
          }
        },
        required: ['name', 'tenantId'],
        type: 'object'
      },
      parent: { type: 'field', field: 'tenantId' }
    },
    description: 'Dynamic Organization content type',
    name: 'Organization'
  };