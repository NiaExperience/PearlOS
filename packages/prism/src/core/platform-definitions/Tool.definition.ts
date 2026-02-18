import { IDynamicContent } from '../blocks/dynamicContent.block';

// Platform Content Definition: Tool
export const ToolDefinition: IDynamicContent = {
  access: {},
  dataModel: {
    block: 'Tool',
    indexer: [
      'userId',
      'type',
      'baseType'
    ],
    jsonSchema: {
      additionalProperties: false,
      properties: {
        _id: {
          format: 'uuid',
          type: 'string'
        },
        async: {
          type: 'boolean'
        },
        baseType: {
          type: 'string'
        },
        description: {
          type: 'string'
        },
        function: {
          additionalProperties: false,
          properties: {
            description: {
              type: 'string'
            },
            name: {
              type: 'string'
            },
            parameters: {
              additionalProperties: false,
              properties: {
                properties: {
                  additionalProperties: {
                    additionalProperties: false,
                    properties: {
                      description: {
                        type: 'string'
                      },
                      type: {
                        type: 'string'
                      }
                    },
                    type: 'object'
                  },
                  type: 'object'
                },
                required: {
                  items: {
                    type: 'string'
                  },
                  type: 'array'
                },
                type: {
                  type: 'string'
                }
              },
              type: 'object'
            },
            strict: {
              type: 'boolean'
            }
          },
          type: 'object'
        },
        name: {
          type: 'string'
        },
        requestMessages: {
          additionalProperties: false,
          properties: {
            completed: {
              additionalProperties: false,
              properties: {
                content: {
                  type: 'string'
                },
                role: {
                  type: 'string'
                },
                type: {
                  type: 'string'
                }
              },
              type: 'object'
            },
            delayed: {
              additionalProperties: false,
              properties: {
                content: {
                  type: 'string'
                },
                role: {
                  type: 'string'
                },
                timingMilliseconds: {
                  type: 'number'
                },
                type: {
                  type: 'string'
                }
              },
              type: 'object'
            },
            failed: {
              additionalProperties: false,
              properties: {
                content: {
                  type: 'string'
                },
                role: {
                  type: 'string'
                },
                type: {
                  type: 'string'
                }
              },
              type: 'object'
            },
            start: {
              additionalProperties: false,
              properties: {
                content: {
                  type: 'string'
                },
                role: {
                  type: 'string'
                },
                type: {
                  type: 'string'
                }
              },
              type: 'object'
            }
          },
          type: 'object'
        },
        server: {
          additionalProperties: false,
          properties: {
            headers: {
              additionalProperties: {
                type: 'string'
              },
              type: 'object'
            },
            secret: {
              type: 'string'
            },
            timeoutSeconds: {
              type: 'string'
            },
            url: {
              type: 'string'
            }
          },
          type: 'object'
        },
        type: {
          type: 'string'
        },
        userId: {
          type: 'string'
        }
      },
      required: [
        'type'
      ],
      type: 'object'
    },
    parent: {
      field: 'userId',
      type: 'field'
    }
  },
  description: 'Dynamic Tool content type',
  name: 'Tool',
  uiConfig: {
    card: {
      descriptionField: 'description',
      tagField: 'type',
      titleField: 'name'
    },
    detailView: {
      displayFields: [
        'baseType'
      ]
    },
    listView: {
      displayFields: [
        'baseType'
      ]
    }
  }
};