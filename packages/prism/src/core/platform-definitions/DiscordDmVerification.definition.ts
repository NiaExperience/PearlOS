import { IDynamicContent } from '../blocks/dynamicContent.block';

export const DiscordDmVerificationDefinition: IDynamicContent = {
  access: {},
  dataModel: {
    block: 'DiscordDmVerification',
    indexer: ['userId', 'discordUserId', 'expiresAt', 'consumedAt', 'attempts'],
    jsonSchema: {
      additionalProperties: false,
      properties: {
        _id: { format: 'uuid', type: 'string' },
        userId: { type: 'string' },
        discordUserId: { type: 'string' },
        codeHash: { type: 'string' },
        issuedAt: { type: 'string', format: 'date-time' },
        expiresAt: { type: 'string', format: 'date-time' },
        consumedAt: { type: 'string', format: 'date-time' },
        attempts: { type: 'number' },
      },
      required: ['userId', 'codeHash', 'expiresAt'],
      type: 'object',
    },
    parent: { type: 'field', field: 'userId' },
  },
  description: 'Discord DM verification code (hashed, expiring, single-use)',
  name: 'DiscordDmVerification',
  uiConfig: {
    card: {
      descriptionField: 'discordUserId',
      tagField: 'expiresAt',
      titleField: 'userId',
    },
    detailView: {
      displayFields: ['discordUserId', 'issuedAt', 'expiresAt', 'consumedAt', 'attempts'],
    },
    listView: {
      displayFields: ['discordUserId', 'expiresAt', 'consumedAt', 'attempts'],
    },
  },
};
