import { IDynamicContent } from '../blocks/dynamicContent.block';

export const AppNotificationDefinition: IDynamicContent = {
  access: {},
  dataModel: {
    block: 'AppNotification',
    indexer: ['tenantId', 'recipientUserId', 'event', 'resourceId', 'resourceType', 'isRead'],
    jsonSchema: {
      additionalProperties: false,
      properties: {
        _id: { format: 'uuid', type: 'string' },
        tenantId: { type: 'string' },
        recipientUserId: { type: 'string' },
        actorUserId: { type: 'string' },
        event: { type: 'string', enum: ['share.created', 'share.redeemed', 'share.revoked', 'share.role_updated'] },
        resourceId: { type: 'string' },
        resourceType: { type: 'string', enum: ['HtmlGeneration', 'Apps', 'Notes', 'DailyCallRoom', 'Sprite'] },
        title: { type: 'string' },
        body: { type: 'string' },
        isRead: { type: 'boolean' },
        metadata: { type: 'object', additionalProperties: true },
        createdAt: { type: 'string' },
        readAt: { type: 'string' },
      },
      required: ['tenantId', 'recipientUserId', 'event', 'resourceId', 'resourceType', 'title', 'isRead'],
      type: 'object',
    },
    parent: { type: 'field', field: 'recipientUserId' },
  },
  description: 'In-app notification records',
  name: 'AppNotification',
};
