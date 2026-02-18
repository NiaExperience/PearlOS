import { IDynamicContent } from '../blocks/dynamicContent.block';

/**
 * Platform Content Definition: Sprite
 * 
 * User-owned AI companion with embedded personality, voice configuration,
 * and GIF visual stored as base64. Sprites can engage in voice conversations
 * using personality switching in the pipecat bot.
 */
export const SpriteDefinition: IDynamicContent = {
  name: 'Sprite',
  description: 'User-owned AI companion with embedded personality and voice',
  dataModel: {
    block: 'Sprite',
    indexer: ['name', 'tenantId', 'parent_id'],
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        _id: { type: 'string', format: 'uuid' },
        parent_id: { type: 'string', description: 'userId (owner)' },
        tenantId: { type: 'string' },
        
        // Identity
        name: { type: 'string' },
        description: { type: 'string' },
        originalRequest: { type: 'string', description: 'User original summon prompt' },
        
        // Visual — GIF stored as base64
        gifData: { type: 'string', description: 'Base64-encoded GIF binary' },
        gifMimeType: { type: 'string', description: 'MIME type (image/gif)' },
        
        // Personality
        primaryPrompt: { type: 'string' },
        
        // Voice (Kokoro for POC)
        voiceProvider: { type: 'string', enum: ['kokoro'] },
        voiceId: { type: 'string' },
        voiceParameters: { 
          type: 'object',
          additionalProperties: true,
          description: 'Provider-specific voice parameters'
        },
        
        // Memory
        lastConversationSummary: { type: 'string' },
        lastConversationAt: { type: 'string', format: 'date-time' },
        
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' }
      },
      required: ['parent_id', 'tenantId', 'name', 'description', 'originalRequest', 'gifData', 'gifMimeType', 'primaryPrompt', 'voiceProvider', 'voiceId']
    },
    parent: { type: 'field', field: 'parent_id' }
  },
  uiConfig: {
    card: { titleField: 'name', descriptionField: 'description' },
    listView: { displayFields: ['name', 'description'] },
    detailView: { displayFields: ['name', 'description', 'primaryPrompt', 'voiceProvider', 'voiceId'] }
  },
  access: {}
};
