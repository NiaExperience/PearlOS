import { IDynamicContent } from '../blocks/dynamicContent.block';

// Platform Content Definition: AssistantTheme
export const AssistantThemeDefinition: IDynamicContent = {
    access: {},
    dataModel: {
      block: 'AssistantTheme',
      indexer: [
        'assistant_id',
        'assistant_name',
        'enabled'
      ],
      jsonSchema: {
        additionalProperties: false,
        properties: {
          _id: {
            format: 'uuid',
            type: 'string'
          },
          assistant_id: {
            type: 'string'
          },
          assistant_name: {
            type: 'string'
          },
          enabled: {
            type: 'boolean'
          },
          theme_config: {
            additionalProperties: false,
            properties: {
              colors: {
                additionalProperties: false,
                properties: {
                  primary: {
                    type: 'string'
                  },
                  secondary: {
                    type: 'string'
                  },
                  accent: {
                    type: 'string'
                  },
                  background: {
                    type: 'string'
                  },
                  surface: {
                    type: 'string'
                  },
                  text: {
                    additionalProperties: false,
                    properties: {
                      primary: {
                        type: 'string'
                      },
                      secondary: {
                        type: 'string'
                      },
                      accent: {
                        type: 'string'
                      }
                    },
                    type: 'object'
                  }
                },
                type: 'object'
              },
              components: {
                additionalProperties: false,
                properties: {
                  button: {
                    additionalProperties: false,
                    properties: {
                      sizes: {
                        additionalProperties: false,
                        properties: {
                          active: {
                            additionalProperties: false,
                            properties: {
                              width: {
                                type: 'string'
                              },
                              height: {
                                type: 'string'
                              }
                            },
                            type: 'object'
                          },
                          inactive: {
                            additionalProperties: false,
                            properties: {
                              width: {
                                type: 'string'
                              },
                              height: {
                                type: 'string'
                              }
                            },
                            type: 'object'
                          }
                        },
                        type: 'object'
                      }
                    },
                    type: 'object'
                  },
                  logo: {
                    additionalProperties: false,
                    properties: {
                      src: {
                        type: 'string'
                      },
                      alt: {
                        type: 'string'
                      }
                    },
                    type: 'object'
                  },
                  branding: {
                    additionalProperties: false,
                    properties: {
                      ringText: {
                        type: 'string'
                      },
                      smsNumbers: {
                        additionalProperties: {
                          type: 'string'
                        },
                        type: 'object'
                      }
                    },
                    type: 'object'
                  }
                },
                type: 'object'
              },
              typography: {
                additionalProperties: false,
                properties: {
                  linkText: {
                    additionalProperties: false,
                    properties: {
                      more: {
                        type: 'string'
                      }
                    },
                    type: 'object'
                  }
                },
                type: 'object'
              }
            },
            type: 'object'
          },
          createdAt: {
            format: 'date-time',
            type: 'string'
          },
          updatedAt: {
            format: 'date-time',
            type: 'string'
          }
        },
        required: [
          'assistant_id',
          'assistant_name',
          'theme_config'
        ],
        type: 'object'
      },
      parent: {
        type: 'field',
        field: 'assistant_id'
      }
    },
    description: 'Dynamic AssistantTheme content type',
    name: 'AssistantTheme',
    uiConfig: {
      card: {
        descriptionField: 'assistant_name',
        tagField: 'enabled',
        titleField: 'assistant_id'
      },
      detailView: {
        displayFields: [
          'assistant_name',
          'enabled',
          'theme_config'
        ]
      },
      listView: {
        displayFields: [
          'assistant_name',
          'enabled'
        ]
      }
    }
  }