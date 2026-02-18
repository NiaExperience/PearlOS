import { IDynamicContent } from '../blocks/dynamicContent.block';

// To avoid a hard dependency on @nia/features during global teardown or non-Jest contexts,
// resolve feature keys dynamically with a safe fallback. This prevents module resolution
// errors when the alias/mappers are not active (e.g., in Jest globalTeardown).
const FALLBACK_FEATURE_KEYS: string[] = [
  'avatar',
  'avatarLipsync',
  'googleAuth',
  'guestLogin',
  'browserAutomation',
  'dailyCall',
  'assistantSelfClose',
  'gmail',
  'googleDrive',
  'htmlContent',
  'maneuverableWindow',
  'miniBrowser',
  'passwordLogin',
  'notes',
  'terminal',
  'userProfile',
  'wikipedia',
  'youtube',
];

let FeatureKeysEnum: string[] = FALLBACK_FEATURE_KEYS;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const features = require('@nia/features');
  if (features && Array.isArray(features.FeatureKeys)) {
    FeatureKeysEnum = features.FeatureKeys as string[];
  }
} catch {
  // Fallback to local list if @nia/features is unavailable
}

// Platform Content Definition: Assistant
export const AssistantDefinition: IDynamicContent = {
  access: {},
  dataModel: {
    block: 'Assistant',
    indexer: [
      'name',
      'tenantId',
      'subDomain'
    ],
    jsonSchema: {
      additionalProperties: false,
      properties: {
        _id: {
          format: 'uuid',
          type: 'string'
        },
        assistantPhoneNumber: {
          type: 'string'
        },
        backchannelingEnabled: {
          type: 'boolean'
        },
        backgroundDenoisingEnabled: {
          type: 'boolean'
        },
        backgroundSound: {
          type: 'string'
        },
        clientMessages: {
          items: {
            type: 'string'
          },
          type: 'array'
        },
        contentTypes: {
          items: {
            type: 'string'
          },
          type: 'array'
        },
        createdAt: {
          format: 'date-time',
          type: 'string'
        },
        credentialIds: {
          items: {
            type: 'string'
          },
          type: 'array'
        },
        emotionRecognitionEnabled: {
          type: 'boolean'
        },
        endCall: {
          type: 'boolean'
        },
        endCallMessage: {
          type: 'string'
        },
        endCallPhrases: {
          items: {
            type: 'string'
          },
          type: 'array'
        },
        firstMessage: {
          type: 'string'
        },
        firstMessageMode: {
          type: 'string'
        },
        hipaaEnabled: {
          type: 'boolean'
        },
        is_template: {
          type: 'boolean'
        },
        generationModelConfig: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              model: { type: 'string' },
              provider: { type: 'string' }
            },
            required: ['model', 'provider'],
            additionalProperties: false
          }
        },
        knowledgeBase: {
          additionalProperties: false,
          properties: {},
          type: 'object'
        },
        knowledgeBaseId: {
          type: 'string'
        },
        maxDurationSeconds: {
          type: 'number'
        },
        messages: {
          items: {
            type: 'object'
          },
          type: 'array'
        },
        metadata: {
          additionalProperties: true,
          properties: {},
          type: 'object'
        },
        model: {
          additionalProperties: false,
          properties: {
            emotionRecognitionEnabled: {
              type: 'boolean'
            },
            functions: {
              items: {
                type: 'object'
              },
              type: 'array'
            },
            knowledgeBase: {
              additionalProperties: false,
              properties: {
                server: {
                  additionalProperties: false,
                  properties: {
                    headers: {
                      additionalProperties: false,
                      properties: {},
                      type: 'object'
                    },
                    secret: {
                      type: 'string'
                    },
                    timeoutSeconds: {
                      type: 'number'
                    },
                    url: {
                      type: 'string'
                    }
                  },
                  type: 'object'
                }
              },
              type: 'object'
            },
            knowledgeBaseId: {
              type: 'string'
            },
            maxTokens: {
              type: 'number'
            },
            messages: {
              items: {
                additionalProperties: false,
                properties: {
                  content: {
                    type: 'string'
                  },
                  role: {
                    type: 'string'
                  }
                },
                type: 'object'
              },
              type: 'array'
            },
            model: {
              type: 'string'
            },
            numFastTurns: {
              type: 'number'
            },
            provider: {
              type: 'string'
            },
            systemPrompt: {
              type: 'string'
            },
            temperature: {
              type: 'number'
            },
            tools: {
              items: {
                type: 'string'
              },
              type: 'array'
            }
          },
          type: 'object'
        },
        modelOutputInMessagesEnabled: {
          type: 'boolean'
        },
        name: {
          type: 'string'
        },
        openAITools: {
          items: {
            type: 'string'
          },
          type: 'array'
        },
        // Configuration for personality and voice per desktop mode
        modePersonalityVoiceConfig: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            required: ['personalityId', 'personalityName', 'personaName', 'voice'],
            properties: {
              personalityId: {
                type: 'string'
              },
              personalityName: {
                type: 'string'
              },
              personaName: {
                type: 'string'
              },
              room_name: {
                type: 'string'
              },
              voice: {
                additionalProperties: false,
                properties: {
                  applyGreenscreen: { type: 'boolean' },
                  awsAssumeRoleArn: { type: 'string' },
                  callbackUrl: { type: 'string' },
                  conversationName: { type: 'string' },
                  conversationalContext: { type: 'string' },
                  customGreeting: { type: 'string' },
                  enableRecording: { type: 'boolean' },
                  enableTranscription: { type: 'boolean' },
                  fallbackPlan: {
                    additionalProperties: false,
                    properties: {
                      voices: {
                        items: {
                          additionalProperties: false,
                          properties: {
                            provider: { type: 'string' },
                            voiceId: { type: 'string' }
                          },
                          type: 'object'
                        },
                        type: 'array'
                      }
                    },
                    type: 'object'
                  },
                  language: { type: 'string' },
                  maxCallDuration: { type: 'number' },
                  model: { type: 'string' },
                  optimizeStreamingLatency: { type: 'number' },
                  participantAbsentTimeout: { type: 'number' },
                  participantLeftTimeout: { type: 'number' },
                  personaId: { type: 'string' },
                  provider: { type: 'string' },
                  recordingS3BucketName: { type: 'string' },
                  recordingS3BucketRegion: { type: 'string' },
                  similarityBoost: { type: 'number' },
                  speed: { type: 'number' },
                  stability: { type: 'number' },
                  style: { type: 'number' },
                  voiceId: { type: 'string' }
                },
                type: 'object'
              }
            }
          }
        },
        // Configuration for personality and voice per DailyCall/Social context
        dailyCallPersonalityVoiceConfig: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            required: ['personalityId', 'personalityName', 'personaName', 'voice'],
            properties: {
              personalityId: {
                type: 'string'
              },
              personalityName: {
                type: 'string'
              },
              personaName: {
                type: 'string'
              },
              room_name: {
                type: 'string'
              },
              voice: {
                additionalProperties: false,
                properties: {
                  applyGreenscreen: { type: 'boolean' },
                  awsAssumeRoleArn: { type: 'string' },
                  callbackUrl: { type: 'string' },
                  conversationName: { type: 'string' },
                  conversationalContext: { type: 'string' },
                  customGreeting: { type: 'string' },
                  enableRecording: { type: 'boolean' },
                  enableTranscription: { type: 'boolean' },
                  fallbackPlan: {
                    additionalProperties: false,
                    properties: {
                      voices: {
                        items: {
                          additionalProperties: false,
                          properties: {
                            provider: { type: 'string' },
                            voiceId: { type: 'string' }
                          },
                          type: 'object'
                        },
                        type: 'array'
                      }
                    },
                    type: 'object'
                  },
                  language: { type: 'string' },
                  maxCallDuration: { type: 'number' },
                  model: { type: 'string' },
                  optimizeStreamingLatency: { type: 'number' },
                  participantAbsentTimeout: { type: 'number' },
                  participantLeftTimeout: { type: 'number' },
                  personaId: { type: 'string' },
                  provider: { type: 'string' },
                  recordingS3BucketName: { type: 'string' },
                  recordingS3BucketRegion: { type: 'string' },
                  similarityBoost: { type: 'number' },
                  speed: { type: 'number' },
                  stability: { type: 'number' },
                  style: { type: 'number' },
                  voiceId: { type: 'string' }
                },
                type: 'object'
              }
            }
          }
        },
        // Map of user-selectable personalities with their voice configurations
        allowedPersonalities: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            required: ['personalityId', 'personalityName', 'personaName', 'voice'],
            properties: {
              personalityId: {
                type: 'string'
              },
              personalityName: {
                type: 'string'
              },
              personaName: {
                type: 'string'
              },
              voice: {
                additionalProperties: false,
                properties: {
                  applyGreenscreen: { type: 'boolean' },
                  awsAssumeRoleArn: { type: 'string' },
                  callbackUrl: { type: 'string' },
                  conversationName: { type: 'string' },
                  conversationalContext: { type: 'string' },
                  customGreeting: { type: 'string' },
                  enableRecording: { type: 'boolean' },
                  enableTranscription: { type: 'boolean' },
                  fallbackPlan: {
                    additionalProperties: false,
                    properties: {
                      voices: {
                        items: {
                          additionalProperties: false,
                          properties: {
                            provider: { type: 'string' },
                            voiceId: { type: 'string' }
                          },
                          type: 'object'
                        },
                        type: 'array'
                      }
                    },
                    type: 'object'
                  },
                  language: { type: 'string' },
                  maxCallDuration: { type: 'number' },
                  model: { type: 'string' },
                  optimizeStreamingLatency: { type: 'number' },
                  participantAbsentTimeout: { type: 'number' },
                  participantLeftTimeout: { type: 'number' },
                  personaId: { type: 'string' },
                  provider: { type: 'string' },
                  recordingS3BucketName: { type: 'string' },
                  recordingS3BucketRegion: { type: 'string' },
                  similarityBoost: { type: 'number' },
                  speed: { type: 'number' },
                  stability: { type: 'number' },
                  style: { type: 'number' },
                  voiceId: { type: 'string' }
                },
                type: 'object'
              }
            }
          }
        },
        serverHeaders: {
          additionalProperties: false,
          properties: {},
          type: 'object'
        },
        serverMessages: {
          items: {
            type: 'object'
          },
          type: 'array'
        },
        serverSecret: {
          type: 'string'
        },
        serverTimeoutSeconds: {
          type: 'number'
        },
        serverUrl: {
          type: 'string'
        },
        silenceTimeoutSeconds: {
          type: 'number'
        },
        special_instructions: {
          type: 'string'
        },
        allowAnonymousLogin: {
          type: 'boolean',
          default: false,
          description: 'Controls whether anonymous guest sessions are allowed for this Assistant.'
        },
        startFullScreen: {
          type: 'boolean',
          default: false,
          description: 'Transition to full-screen browser mode when the assistant button is clicked.'
        },
        desktopMode: {
          type: 'string',
          enum: ['default', 'home', 'work', 'creative', 'gaming', 'focus', 'relaxation', 'quiet'],
          default: 'home',
          description: 'Initial desktop mode for the Interface background.'
        },
        supportedFeatures: {
          type: 'array',
          items: {
            type: 'string',
            enum: FeatureKeysEnum
          },
          description: 'List of features this Assistant supports; if provided, features not listed are disabled.'
        },
        subDomain: {
          type: 'string'
        },
        template_category: {
          type: 'number'
        },
        template_description: {
          type: 'string'
        },
        template_display_name: {
          type: 'string'
        },
        template_icon_url: {
          type: 'string'
        },
        tenantId: {
          type: 'string'
        },
        transcriber: {
          additionalProperties: false,
          properties: {
            backgroundDenoising: {
              type: 'boolean'
            },
            endCall: {
              type: 'boolean'
            },
            language: {
              type: 'string'
            },
            model: {
              type: 'string'
            },
            provider: {
              type: 'string'
            },
            stopSpeakingPlan: {
              additionalProperties: false,
              properties: {
                backoffSeconds: {
                  type: 'number'
                },
                numWords: {
                  type: 'number'
                },
                voiceSeconds: {
                  type: 'number'
                }
              },
              type: 'object'
            }
          },
          type: 'object'
        },
        updatedAt: {
          format: 'date-time',
          type: 'string'
        },
        user: {
          type: 'string'
        },
        voiceProvider: {
          type: 'string',
          enum: ['pipecat'],
          default: 'pipecat'
        }
      },
      required: [
        'tenantId',
        'name'
      ],
      type: 'object'
    },
    parent: {
      field: 'tenantId',
      type: 'field'
    }
  },
  description: 'Dynamic Assistant content type',
  name: 'Assistant',
  uiConfig: {
    card: {
      descriptionField: 'template_description',
      imageField: 'template_icon_url',
      tagField: 'template_category',
      titleField: 'name'
    },
    detailView: {
      displayFields: [
        'subDomain',
        'template_icon_url',
        'model'
      ]
    },
    listView: {
      displayFields: [
        'subDomain'
      ]
    }
  }
};