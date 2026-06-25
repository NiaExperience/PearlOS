import { IDynamicContent } from '../blocks/dynamicContent.block';

export const TelegramDmVerificationDefinition: IDynamicContent = {
  access: {},
  dataModel: {
    block: 'TelegramDmVerification',
    indexer: [
      'userId',
      'phoneNumber',
      'telegramUserId',
      'telegramChatId',
      'startTokenHash',
      'codeHash',
      'claimedAt',
      'expiresAt',
      'consumedAt',
      'attempts',
    ],
    jsonSchema: {
      additionalProperties: false,
      properties: {
        _id: { format: 'uuid', type: 'string' },
        userId: { type: 'string' },
        phoneNumber: { type: 'string' },
        telegramUserId: { type: 'string' },
        telegramChatId: { type: 'string' },
        telegramUsername: { type: 'string' },
        startTokenHash: { type: 'string' },
        startTokenIssuedAt: { type: 'string', format: 'date-time' },
        claimedAt: { type: 'string', format: 'date-time' },
        codeHash: { type: 'string' },
        issuedAt: { type: 'string', format: 'date-time' },
        expiresAt: { type: 'string', format: 'date-time' },
        consumedAt: { type: 'string', format: 'date-time' },
        attempts: { type: 'number' },
      },
      required: ['userId', 'startTokenHash', 'expiresAt'],
      type: 'object',
    },
    parent: { type: 'field', field: 'userId' },
  },
  description: 'Telegram DM verification code (hashed, expiring, single-use)',
  name: 'TelegramDmVerification',
  uiConfig: {
    card: {
      descriptionField: 'telegramUserId',
      tagField: 'expiresAt',
      titleField: 'userId',
    },
    detailView: {
      displayFields: [
        'telegramUserId',
        'telegramChatId',
        'startTokenIssuedAt',
        'claimedAt',
        'issuedAt',
        'expiresAt',
        'consumedAt',
        'attempts',
      ],
    },
    listView: {
      displayFields: ['telegramUserId', 'claimedAt', 'expiresAt', 'consumedAt', 'attempts'],
    },
  },
};
