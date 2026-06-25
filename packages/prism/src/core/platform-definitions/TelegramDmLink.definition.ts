import { IDynamicContent } from '../blocks/dynamicContent.block';

export const TelegramDmLinkDefinition: IDynamicContent = {
  access: {},
  dataModel: {
    block: 'TelegramDmLink',
    indexer: ['userId', 'phoneNumber', 'telegramUserId', 'telegramChatId', 'verifiedAt', 'revokedAt'],
    jsonSchema: {
      additionalProperties: false,
      properties: {
        _id: { format: 'uuid', type: 'string' },
        userId: { type: 'string' },
        phoneNumber: { type: 'string' },
        telegramUserId: { type: 'string' },
        telegramChatId: { type: 'string' },
        telegramUsername: { type: 'string' },
        verifiedAt: { type: 'string', format: 'date-time' },
        revokedAt: { type: 'string', format: 'date-time' },
      },
      required: ['userId', 'telegramUserId', 'telegramChatId', 'verifiedAt'],
      type: 'object',
    },
    parent: { type: 'field', field: 'userId' },
  },
  description: 'Verified Telegram DM link for Pearl direct messages',
  name: 'TelegramDmLink',
  uiConfig: {
    card: {
      descriptionField: 'telegramUserId',
      tagField: 'verifiedAt',
      titleField: 'userId',
    },
    detailView: {
      displayFields: ['telegramUserId', 'telegramChatId', 'telegramUsername', 'verifiedAt', 'revokedAt'],
    },
    listView: {
      displayFields: ['telegramUserId', 'verifiedAt', 'revokedAt'],
    },
  },
};
