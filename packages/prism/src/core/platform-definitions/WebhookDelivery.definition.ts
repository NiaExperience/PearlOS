import { IDynamicContent } from '../blocks/dynamicContent.block';

export const WebhookDeliveryDefinition: IDynamicContent = {
  access: {},
  dataModel: {
    block: 'WebhookDelivery',
    indexer: ['tenantId', 'subscriptionId', 'event', 'resourceId', 'resourceType', 'status'],
    jsonSchema: {
      additionalProperties: false,
      properties: {
        _id: { format: 'uuid', type: 'string' },
        tenantId: { type: 'string' },
        subscriptionId: { type: 'string' },
        event: {
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
        resourceId: { type: 'string' },
        resourceType: { type: 'string', enum: ['HtmlGeneration', 'Apps', 'Notes', 'DailyCallRoom', 'Sprite', 'Task'] },
        status: { type: 'string', enum: ['pending', 'success', 'failed'] },
        attemptCount: { type: 'number' },
        requestBody: { type: 'object', additionalProperties: true },
        responseStatus: { type: 'number' },
        responseBody: { type: 'string' },
        error: { type: 'string' },
        createdAt: { type: 'string' },
        deliveredAt: { type: 'string' },
      },
      required: ['tenantId', 'subscriptionId', 'event', 'resourceId', 'resourceType', 'status', 'attemptCount', 'requestBody'],
      type: 'object',
    },
    parent: { type: 'field', field: 'tenantId' },
  },
  description: 'Webhook delivery attempts and outcomes',
  name: 'WebhookDelivery',
};
