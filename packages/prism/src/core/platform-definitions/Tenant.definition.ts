import { IDynamicContent } from '../blocks/dynamicContent.block';

// Platform Content Definition: Tenant
export const TenantDefinition: IDynamicContent = {
  access: {},
  dataModel: {
    block: 'Tenant',
    indexer: [
      'name',
      'domain'
    ],
    jsonSchema: {
      additionalProperties: false,
      properties: {
        _id: {
          format: 'uuid',
          type: 'string'
        },
        domain: {
          type: 'string'
        },
        name: {
          type: 'string'
        },
        planTier: {
          type: 'string'
        },
        settings: {
          type: 'object',
          additionalProperties: true
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
  description: 'Dynamic Tenant content type',
  name: 'Tenant',
  uiConfig: {
    card: {
      descriptionField: 'domain',
      tagField: 'planTier',
      titleField: 'name'
    },
    detailView: {
      displayFields: [
        'name',
        'domain',
        'planTier',
        'settings'
      ]
    },
    listView: {
      displayFields: [
        'name'
      ]
    }
  }
};