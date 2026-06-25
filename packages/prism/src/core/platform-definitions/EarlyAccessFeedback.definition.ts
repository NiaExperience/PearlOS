import { IDynamicContent } from '../blocks/dynamicContent.block';

export const EarlyAccessFeedbackDefinition: IDynamicContent = {
  access: {},
  dataModel: {
    block: 'EarlyAccessFeedback',
    indexer: ['userId', 'createdAt'],
    jsonSchema: {
      additionalProperties: false,
      properties: {
        _id: { format: 'uuid', type: 'string' },
        userId: { type: 'string' },
        userEmail: { type: 'string' },
        userName: { type: 'string' },
        message: { type: 'string' },
        pageUrl: { type: 'string' },
        createdAt: { type: 'string' },
      },
      required: ['userId', 'message', 'createdAt'],
      type: 'object',
    },
    parent: { type: 'field', field: 'userId' },
  },
  description: 'Early access user feedback messages for Pearl',
  name: 'EarlyAccessFeedback',
};
