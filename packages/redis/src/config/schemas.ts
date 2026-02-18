/**
 * Message validation schemas for Redis messaging
 */

import type { AdminMessage, ChatMessage, HeartbeatMessage, EventMessage } from '../types/messages';

export interface ValidationSchema {
  type: string;
  required: string[];
  optional: string[];
  validators: Record<string, (value: unknown) => boolean>;
}

export const MessageSchemas = {
  /**
   * Admin message schema
   */
  admin: {
    type: 'AdminMessage',
    required: ['message', 'mode', 'sender_id', 'timestamp'],
    optional: ['sender_name', 'room_url', 'bot_pid', 'priority'],
    validators: {
      message: (value: unknown): boolean => 
        typeof value === 'string' && value.length > 0 && value.length <= 1000,
      mode: (value: unknown): boolean => 
        value === 'immediate' || value === 'queued',
      sender_id: (value: unknown): boolean => 
        typeof value === 'string' && value.length > 0,
      timestamp: (value: unknown): boolean => 
        typeof value === 'number' && value > 0,
      priority: (value: unknown): boolean => 
        ['low', 'normal', 'high', 'urgent'].includes(value as string),
      bot_pid: (value: unknown): boolean => 
        typeof value === 'number' && value > 0
    }
  } satisfies ValidationSchema,

  /**
   * Chat message schema
   */
  chat: {
    type: 'ChatMessage',
    required: ['message', 'sender_id', 'room_url', 'timestamp'],
    optional: ['sender_name', 'type', 'reply_to', 'metadata'],
    validators: {
      message: (value: unknown): boolean => 
        typeof value === 'string' && value.length > 0 && value.length <= 2000,
      sender_id: (value: unknown): boolean => 
        typeof value === 'string' && value.length > 0,
      room_url: (value: unknown): boolean => 
        typeof value === 'string' && value.startsWith('https://'),
      timestamp: (value: unknown): boolean => 
        typeof value === 'number' && value > 0,
      type: (value: unknown): boolean => 
        ['text', 'system', 'notification'].includes(value as string),
      reply_to: (value: unknown): boolean => 
        typeof value === 'string' && value.length > 0
    }
  } satisfies ValidationSchema,

  /**
   * Heartbeat message schema
   */
  heartbeat: {
    type: 'HeartbeatMessage',
    required: ['bot_pid', 'status', 'sender_id', 'timestamp'],
    optional: ['room_url', 'participants', 'metrics'],
    validators: {
      bot_pid: (value: unknown): boolean => 
        typeof value === 'number' && value > 0,
      status: (value: unknown): boolean => 
        ['healthy', 'warning', 'error'].includes(value as string),
      sender_id: (value: unknown): boolean => 
        typeof value === 'string' && value.length > 0,
      timestamp: (value: unknown): boolean => 
        typeof value === 'number' && value > 0,
      participants: (value: unknown): boolean => 
        Array.isArray(value) && value.every(p => typeof p === 'string'),
      room_url: (value: unknown): boolean => 
        typeof value === 'string' && value.startsWith('https://')
    }
  } satisfies ValidationSchema,

  /**
   * Event message schema
   */
  event: {
    type: 'EventMessage',
    required: ['event_type', 'payload', 'sender_id', 'timestamp'],
    optional: ['room_url', 'version', 'correlation_id'],
    validators: {
      event_type: (value: unknown): boolean => 
        typeof value === 'string' && value.length > 0,
      payload: (value: unknown): boolean => 
        typeof value === 'object' && value !== null,
      sender_id: (value: unknown): boolean => 
        typeof value === 'string' && value.length > 0,
      timestamp: (value: unknown): boolean => 
        typeof value === 'number' && value > 0,
      version: (value: unknown): boolean => 
        typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value as string),
      correlation_id: (value: unknown): boolean => 
        typeof value === 'string' && value.length > 0
    }
  } satisfies ValidationSchema
};

/**
 * Validate message against schema
 */
export function validateMessage<T extends Record<string, unknown>>(
  message: T, 
  schema: ValidationSchema
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Check required fields
  for (const field of schema.required) {
    if (!(field in message) || message[field] === undefined || message[field] === null) {
      errors.push(`Missing required field: ${field}`);
      continue;
    }
    
    // Validate field if validator exists
    const validator = schema.validators[field];
    if (validator && !validator(message[field])) {
      errors.push(`Invalid value for field: ${field}`);
    }
  }
  
  // Validate optional fields if present
  for (const field of schema.optional) {
    if (field in message && message[field] !== undefined && message[field] !== null) {
      const validator = schema.validators[field];
      if (validator && !validator(message[field])) {
        errors.push(`Invalid value for optional field: ${field}`);
      }
    }
  }
  
  // Check for unexpected fields
  const allowedFields = [...schema.required, ...schema.optional];
  for (const field of Object.keys(message)) {
    if (!allowedFields.includes(field)) {
      errors.push(`Unexpected field: ${field}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get schema by message type
 */
export function getSchemaByType(type: 'admin' | 'chat' | 'heartbeat' | 'event'): ValidationSchema {
  const schema = MessageSchemas[type];
  if (!schema) {
    throw new Error(`Unknown message type: ${type}`);
  }
  return schema;
}

/**
 * Validate admin message
 */
export function validateAdminMessage(message: unknown): message is AdminMessage {
  const result = validateMessage(message as Record<string, unknown>, MessageSchemas.admin);
  return result.valid;
}

/**
 * Validate chat message
 */
export function validateChatMessage(message: unknown): message is ChatMessage {
  const result = validateMessage(message as Record<string, unknown>, MessageSchemas.chat);
  return result.valid;
}

/**
 * Validate heartbeat message
 */
export function validateHeartbeatMessage(message: unknown): message is HeartbeatMessage {
  const result = validateMessage(message as Record<string, unknown>, MessageSchemas.heartbeat);
  return result.valid;
}

/**
 * Validate event message
 */
export function validateEventMessage(message: unknown): message is EventMessage {
  const result = validateMessage(message as Record<string, unknown>, MessageSchemas.event);
  return result.valid;
}