import { IDynamicContent } from '../blocks/dynamicContent.block';
import { BlockType_GlobalSettings, GLOBAL_SETTINGS_SINGLETON_KEY } from '../blocks/globalSettings.block';

export const GlobalSettingsDefinition: IDynamicContent = {
  access: {},
  dataModel: {
    block: BlockType_GlobalSettings,
    indexer: ['singletonKey'],
    jsonSchema: {
      additionalProperties: false,
      properties: {
        _id: { type: 'string', format: 'uuid', optional: true },
        denyListEmails: { type: 'array', items: {type: 'string'}, default: []},
        singletonKey: {
          type: 'string',
          enum: [GLOBAL_SETTINGS_SINGLETON_KEY],
          default: GLOBAL_SETTINGS_SINGLETON_KEY,
        },
        interfaceLogin: {
          type: 'object',
          additionalProperties: false,
          properties: {
            googleAuth: { type: 'boolean', default: true },
            guestLogin: { type: 'boolean', default: true },
            passwordLogin: { type: 'boolean', default: true },
          },
          required: ['googleAuth', 'guestLogin', 'passwordLogin'],
        },
        createdAt: { type: 'string', format: 'date-time', optional: true },
        updatedAt: { type: 'string', format: 'date-time', optional: true },
      },
      required: ['singletonKey', 'interfaceLogin'],
    },
  },
  description: 'Platform-wide settings that control application surface behavior.',
  name: BlockType_GlobalSettings,
  uiConfig: {
    card: {
      titleField: 'singletonKey',
      descriptionField: 'interfaceLogin',
    },
    detailView: {
      displayFields: ['interfaceLogin'],
    },
    listView: {
      displayFields: ['singletonKey'],
    },
  },
};
