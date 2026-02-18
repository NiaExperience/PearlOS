import { IDynamicContent } from '../blocks/dynamicContent.block';

// Platform Content Definition: ResetPasswordToken
export const ResetPasswordTokenDefinition: IDynamicContent = {
    access: {},
    dataModel: {
      block: 'ResetPasswordToken',
      indexer: [
        'tokenHash',
        'userId',
        'expiresAt'
      ],
      jsonSchema: {
        additionalProperties: false,
        properties: {
          _id: { format: 'uuid', type: 'string' },
          tokenHash: { type: 'string' },
          userId: { type: 'string' },
          email: { type: 'string', format: 'email' },
          issuedAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time' },
          consumedAt: { type: 'string', format: 'date-time' },
          purpose: { type: 'string', enum: ['password_reset', 'invite_activation'] },
          attempts: { type: 'number' },
          ipIssued: { type: 'string' },
          uaIssued: { type: 'string' }
        },
        required: [
          'tokenHash',
          'userId',
          'expiresAt',
          'purpose'
        ],
        type: 'object'
      },
      parent: { type: 'field', field: 'userId' }
    },
    description: 'Password reset & invite activation token (hashed, single-use, expiring)',
    name: 'ResetPasswordToken',
    uiConfig: {
      card: {
        descriptionField: 'email',
        tagField: 'purpose',
        titleField: 'userId'
      },
      detailView: {
        displayFields: [
          'email',
          'purpose',
          'issuedAt',
          'expiresAt',
          'consumedAt',
          'attempts',
          'ipIssued',
          'uaIssued'
        ]
      },
      listView: {
        displayFields: [
          'purpose',
          'expiresAt',
          'consumedAt'
        ]
      }
    }
  }