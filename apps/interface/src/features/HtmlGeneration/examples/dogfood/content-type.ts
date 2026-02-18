/**
 * Dog Feeding Tracker content type definition for demo purposes
 * 
 * Creates a user-specific content type to avoid collisions within tenant namespace
 */

import { IDynamicContent } from '@nia/prism/core/blocks/dynamicContent.block';

export function createDogFeedingContentType(userId: string): IDynamicContent {
  return {
    name: `dogfood-${userId}`,
    description: `Log entries for tracking dog feeding events throughout the day (User: ${userId})`,
    dataModel: {
      block: 'DogFeedingEntry',
      jsonSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['food', 'treat', 'water', 'medication'],
            description: 'Type of feeding event',
            default: 'food'
          },
          description: {
            type: 'string',
            description: 'What was given (e.g., "Kibble - 1 cup", "Chicken treat", "Fresh water")',
            maxLength: 200
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'When the feeding occurred'
          },
          notes: {
            type: 'string',
            description: 'Optional notes about the feeding event or pet behavior',
            maxLength: 500
          },
          amount: {
            type: 'string',
            description: 'Amount given (e.g., "1 cup", "2 treats", "full bowl")',
            maxLength: 50
          },
          createdBy: {
            type: 'string',
            description: 'User ID who logged this feeding event'
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'When this record was created'
          }
        },
        required: ['type', 'description', 'timestamp', 'createdBy', 'createdAt'],
        additionalProperties: false
      }
    },
    uiConfig: {
      labels: {
        type: 'Feeding Type',
        description: 'Description',
        timestamp: 'Time',
        notes: 'Notes',
        amount: 'Amount'
      },
      listView: {
        displayFields: ['timestamp', 'type', 'description', 'amount']
      },
      detailView: {
        displayFields: ['type', 'description', 'amount', 'timestamp', 'notes']
      },
      card: {
        titleField: 'description',
        descriptionField: 'notes',
        tagField: 'type',
        imageField: undefined
      }
    },
    access: {
      allowAnonymous: false, // Require authentication for pet care data
      tenantRole: undefined
    }
  };
}

// Legacy export for backward compatibility - uses a default user ID
export const DOG_FEEDING_ENTRY_CONTENT_TYPE: IDynamicContent = createDogFeedingContentType('default-user');

export default createDogFeedingContentType;
