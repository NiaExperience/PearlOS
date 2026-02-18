/**
 * Dynamic content definition for RiveAvatarLipsync feature
 */

import type { IDynamicContent } from '@nia/prism/core/blocks/dynamicContent.block';

export const definition: IDynamicContent = {
  _id: 'rive-avatar-lipsync',
  name: 'Rive Avatar Lipsync',
  description: 'Sophisticated lip-sync animation system for Rive avatars with voice confusion prevention',
  
  dataModel: {
    block: 'rive-avatar-lipsync',
    jsonSchema: {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean', default: true },
            useRiveAnimations: { type: 'boolean', default: true },
            debugMode: { type: 'boolean', default: false }
          }
        },
        animationState: {
          type: 'object',
          properties: {
            shouldShowTalkingAnimation: { type: 'boolean' },
            forceStopAnimation: { type: 'boolean' },
            animationType: { 
              type: 'string', 
              enum: ['talking', 'listening', 'idle', 'frozen'] 
            },
            intensity: { type: 'number', minimum: 0, maximum: 1 },
            isUserDominant: { type: 'boolean' },
            animationName: { type: 'string' }
          }
        },
        speechDetection: {
          type: 'object',
          properties: {
            assistantSpeechConfidence: { type: 'number', minimum: 0, maximum: 1 },
            transcriptQuality: { 
              type: 'string', 
              enum: ['none', 'partial', 'final'] 
            },
            lastAssistantMessage: { type: 'string' },
            speechTimestamp: { type: 'number' }
          }
        }
      }
    }
  },
  
  uiConfig: {
    labels: {
      config: 'Configuration',
      animationState: 'Animation State',
      speechDetection: 'Speech Detection'
    },
    listView: {
      displayFields: ['name', 'description']
    },
    detailView: {
      displayFields: ['config', 'animationState', 'speechDetection']
    }
  }
};
