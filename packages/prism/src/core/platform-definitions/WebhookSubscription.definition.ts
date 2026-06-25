import { IDynamicContent } from '../blocks/dynamicContent.block';

export const WebhookSubscriptionDefinition: IDynamicContent = {
  access: {},
  dataModel: {
    block: 'WebhookSubscription',
    indexer: ['tenantId', 'createdBy', 'isActive', 'events', 'resourceTypes'],
    jsonSchema: {
      additionalProperties: false,
      properties: {
        _id: { format: 'uuid', type: 'string' },
        tenantId: { type: 'string' },
        createdBy: { type: 'string' },
        url: { type: 'string' },
        secret: { type: 'string' },
        events: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'share.created',
              'share.redeemed',
              'share.revoked',
              'share.role_updated',
              'task.created',
              'task.started',
              'task.completed',
              'task.failed',
              'task.cancelled',
            ],
          },
        },
        resourceTypes: {
          type: 'array',
          items: { type: 'string', enum: ['HtmlGeneration', 'Apps', 'Notes', 'DailyCallRoom', 'Sprite', 'Task'] },
        },
        isActive: { type: 'boolean' },
        description: { type: 'string' },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
      },
      required: ['tenantId', 'createdBy', 'url', 'events', 'isActive'],
      type: 'object',
    },
    parent: { type: 'field', field: 'tenantId' },
  },
  description: 'Tenant webhook subscriptions',
  name: 'WebhookSubscription',
};
