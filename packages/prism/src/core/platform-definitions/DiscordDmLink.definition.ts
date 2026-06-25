import { IDynamicContent } from '../blocks/dynamicContent.block';

export const DiscordDmLinkDefinition: IDynamicContent = {
  access: {},
  dataModel: {
    block: 'DiscordDmLink',
    indexer: ['userId', 'discordUserId', 'verifiedAt', 'revokedAt'],
    jsonSchema: {
      additionalProperties: false,
      properties: {
        _id: { format: 'uuid', type: 'string' },
        userId: { type: 'string' },
        discordUserId: { type: 'string' },
        verifiedAt: { type: 'string', format: 'date-time' },
        revokedAt: { type: 'string', format: 'date-time' },
      },
      required: ['userId', 'discordUserId', 'verifiedAt'],
      type: 'object',
    },
    parent: { type: 'field', field: 'userId' },
  },
  description: 'Verified Discord DM link for Pearl direct messages',
  name: 'DiscordDmLink',
  uiConfig: {
    card: {
      descriptionField: 'discordUserId',
      tagField: 'verifiedAt',
      titleField: 'userId',
    },
    detailView: {
      displayFields: ['discordUserId', 'verifiedAt', 'revokedAt'],
    },
    listView: {
      displayFields: ['discordUserId', 'verifiedAt', 'revokedAt'],
    },
  },
};
