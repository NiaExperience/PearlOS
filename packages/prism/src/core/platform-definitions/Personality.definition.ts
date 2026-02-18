import { IDynamicContent } from '../blocks/dynamicContent.block';

// Platform Content Definition: Personality
export const PersonalityDefinition: IDynamicContent = {
  name: 'Personality',
  description: 'Configurable assistant personality with primary and event-based prompts',
  dataModel: {
    block: 'Personality',
    indexer: ['name', 'tenantId'],
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        _id: { type: 'string', format: 'uuid' },
        key: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        primaryPrompt: { type: 'string' },
        variables: {
          type: 'array',
          items: { type: 'string', enum: ['username', 'roomName', 'topic'] }
        },
        beats: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              message: { type: 'string' },
              start_time: { type: 'number', minimum: 0 }
            },
            required: ['message', 'start_time']
          }
        },
        tenantId: { type: 'string' },
        version: { type: 'number' },
        lastModifiedByUserId: { type: 'string' },
        history: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              userId: { type: 'string' },
              delta: { type: 'string' },
              modifiedAt: { type: 'string', format: 'date-time' }
            },
            required: ['userId', 'delta', 'modifiedAt']
          }
        },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' }
      },
      required: ['key', 'primaryPrompt', 'tenantId']
    },
    parent: { type: 'field', field: 'tenantId' }
  },
  uiConfig: {
    card: { titleField: 'name', descriptionField: 'description', tagField: 'key' },
    listView: { displayFields: ['key', 'name'] },
    detailView: { displayFields: ['key', 'name', 'primaryPrompt', 'variables', 'beats'] }
  },
  access: {}
};
