/**
 * Demo content type definitions for testing applet API integration
 */

import { DynamicContentBlock } from '@nia/prism/core/blocks';

export const DEMO_NOTE_CONTENT_TYPE: DynamicContentBlock.IDynamicContent = {
  name: 'notes',
  description: 'Simple note-taking content type for demos',
  dataModel: {
    block: 'DemoNote',
    jsonSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Note title',
          maxLength: 200
        },
        content: {
          type: 'string',
          description: 'Note content/body',
          maxLength: 5000
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Note tags for organization',
          maxItems: 10
        },
        category: {
          type: 'string',
          description: 'Note category',
          enum: ['personal', 'work', 'ideas', 'todo', 'archive']
        },
        priority: {
          type: 'string',
          description: 'Priority level',
          enum: ['low', 'medium', 'high', 'urgent'],
          default: 'medium'
        },
        isPublic: {
          type: 'boolean',
          description: 'Whether the note is publicly visible',
          default: false
        },
        dueDate: {
          type: 'string',
          format: 'date-time',
          description: 'Optional due date for todo notes'
        },
        createdAt: {
          type: 'string',
          format: 'date-time',
          description: 'Creation timestamp'
        },
        updatedAt: {
          type: 'string',
          format: 'date-time',
          description: 'Last update timestamp'
        },
        createdBy: {
          type: 'string',
          description: 'User ID who created the note'
        },
        updatedBy: {
          type: 'string',
          description: 'User ID who last updated the note'
        }
      },
      required: ['title', 'content', 'createdAt', 'createdBy'],
      additionalProperties: false
    }
  },
  uiConfig: {
    labels: {
      title: 'Title',
      content: 'Content',
      tags: 'Tags',
      category: 'Category',
      priority: 'Priority',
      isPublic: 'Public Note',
      dueDate: 'Due Date'
    },
    listView: {
      displayFields: ['title', 'category', 'priority', 'tags', 'updatedAt']
    },
    detailView: {
      displayFields: ['title', 'content', 'category', 'priority', 'tags', 'isPublic', 'dueDate']
    },
    card: {
      titleField: 'title',
      descriptionField: 'content',
      tagField: 'category',
      imageField: undefined // No image for notes
    }
  },
  access: {
    allowAnonymous: true, // Allow applets to access
    tenantRole: undefined
  }
};

export const DEMO_TASK_CONTENT_TYPE: DynamicContentBlock.IDynamicContent = {
  name: 'tasks',
  description: 'Task management content type for productivity apps',
  dataModel: {
    block: 'DemoTask',
    jsonSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Task title',
          maxLength: 200
        },
        description: {
          type: 'string',
          description: 'Task description',
          maxLength: 2000
        },
        status: {
          type: 'string',
          description: 'Task status',
          enum: ['todo', 'in-progress', 'done', 'cancelled'],
          default: 'todo'
        },
        priority: {
          type: 'string',
          description: 'Task priority',
          enum: ['low', 'medium', 'high', 'urgent'],
          default: 'medium'
        },
        assignedTo: {
          type: 'string',
          description: 'User ID of assigned person'
        },
        dueDate: {
          type: 'string',
          format: 'date-time',
          description: 'Task due date'
        },
        completedAt: {
          type: 'string',
          format: 'date-time',
          description: 'When task was completed'
        },
        estimatedHours: {
          type: 'number',
          description: 'Estimated hours to complete',
          minimum: 0
        },
        actualHours: {
          type: 'number',
          description: 'Actual hours spent',
          minimum: 0
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task tags',
          maxItems: 10
        },
        project: {
          type: 'string',
          description: 'Project name or ID'
        },
        createdAt: {
          type: 'string',
          format: 'date-time',
          description: 'Creation timestamp'
        },
        updatedAt: {
          type: 'string',
          format: 'date-time',
          description: 'Last update timestamp'
        },
        createdBy: {
          type: 'string',
          description: 'User ID who created the task'
        }
      },
      required: ['title', 'status', 'createdAt', 'createdBy'],
      additionalProperties: false
    }
  },
  uiConfig: {
    labels: {
      title: 'Task',
      description: 'Description',
      status: 'Status',
      priority: 'Priority',
      assignedTo: 'Assigned To',
      dueDate: 'Due Date',
      estimatedHours: 'Est. Hours',
      actualHours: 'Actual Hours',
      tags: 'Tags',
      project: 'Project'
    },
    listView: {
      displayFields: ['title', 'status', 'priority', 'dueDate', 'assignedTo', 'project']
    },
    detailView: {
      displayFields: ['title', 'description', 'status', 'priority', 'assignedTo', 'dueDate', 'estimatedHours', 'tags', 'project']
    },
    card: {
      titleField: 'title',
      descriptionField: 'description',
      tagField: 'status'
    }
  },
  access: {
    allowAnonymous: true,
    tenantRole: undefined
  }
};

/**
 * Helper function to create demo content types in a tenant
 */
export async function createDemoContentTypes(tenantId: string) {
  const ContentActions = (await import('@nia/prism/core/actions')).ContentActions;
  const { getLogger } = await import('@interface/lib/logger');
  const log = getLogger('[html-generation.demo-content-types]');
  
  try {
    // Create notes content type
    const noteResult = await ContentActions.createDefinition({
      ...DEMO_NOTE_CONTENT_TYPE,
      tenantId
    });
    
    // Create tasks content type  
    const taskResult = await ContentActions.createDefinition({
      ...DEMO_TASK_CONTENT_TYPE,
      tenantId
    });

    return {
      notes: noteResult,
      tasks: taskResult
    };
  } catch (error) {
    log.error('Failed to create demo content types', { err: error, tenantId });
    throw error;
  }
}

/**
 * Sample data for testing
 */
export const SAMPLE_NOTE_DATA = {
  title: 'Welcome to API-Enabled Notes',
  content: 'This note was created through the applet API! You can create, read, update, and delete notes directly from JavaScript applications.',
  category: 'ideas',
  priority: 'medium',
  tags: ['demo', 'api', 'integration'],
  isPublic: false,
  createdAt: new Date().toISOString()
};

export const SAMPLE_TASK_DATA = {
  title: 'Test API Integration',
  description: 'Verify that the applet can successfully create and manage tasks through the API.',
  status: 'todo',
  priority: 'high',
  estimatedHours: 2,
  tags: ['testing', 'api', 'development'],
  project: 'Applet Integration',
  createdAt: new Date().toISOString()
};
