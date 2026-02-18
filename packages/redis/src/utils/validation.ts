/**
 * Validation utilities for Redis operations
 * Ensures data integrity and type safety
 */

import { BaseMessage, AdminMessage, ChatMessage, HeartbeatMessage, EventMessage } from '../types/messages';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Message validator class wrapper
 */
export class MessageValidator {
  validate(message: unknown): ValidationResult {
    return validateMessage(message);
  }
}

/**
 * Validate base message structure
 */
export function validateBaseMessage(data: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Message must be an object'] };
  }
  
  const message = data as Record<string, unknown>;
  
  // Check required fields
  if (!message.type || typeof message.type !== 'string') {
    errors.push('Message must have a valid type field');
  }
  
  if (!message.timestamp || typeof message.timestamp !== 'string') {
    errors.push('Message must have a valid timestamp field');
  } else {
    // Validate timestamp format
    const date = new Date(message.timestamp);
    if (isNaN(date.getTime())) {
      errors.push('Timestamp must be a valid ISO date string');
    }
  }
  
  if (!message.id || typeof message.id !== 'string') {
    errors.push('Message must have a valid id field');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate admin message
 */
export function validateAdminMessage(data: unknown): ValidationResult {
  const baseResult = validateBaseMessage(data);
  if (!baseResult.valid) {
    return baseResult;
  }
  
  const message = data as Record<string, unknown>;
  const errors: string[] = [];
  
  if (message.type !== 'admin') {
    errors.push('Admin message must have type "admin"');
  }
  
  if (!message.action || typeof message.action !== 'string') {
    errors.push('Admin message must have a valid action field');
  }
  
  if (!message.fromAdmin || typeof message.fromAdmin !== 'string') {
    errors.push('Admin message must have a valid fromAdmin field');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate chat message
 */
export function validateChatMessage(data: unknown): ValidationResult {
  const baseResult = validateBaseMessage(data);
  if (!baseResult.valid) {
    return baseResult;
  }
  
  const message = data as Record<string, unknown>;
  const errors: string[] = [];
  
  if (message.type !== 'chat') {
    errors.push('Chat message must have type "chat"');
  }
  
  if (!message.roomId || typeof message.roomId !== 'string') {
    errors.push('Chat message must have a valid roomId field');
  }
  
  if (!message.content || typeof message.content !== 'string') {
    errors.push('Chat message must have a valid content field');
  }
  
  if (!message.userId || typeof message.userId !== 'string') {
    errors.push('Chat message must have a valid userId field');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate heartbeat message
 */
export function validateHeartbeatMessage(data: unknown): ValidationResult {
  const baseResult = validateBaseMessage(data);
  if (!baseResult.valid) {
    return baseResult;
  }
  
  const message = data as Record<string, unknown>;
  const errors: string[] = [];
  
  if (message.type !== 'heartbeat') {
    errors.push('Heartbeat message must have type "heartbeat"');
  }
  
  if (!message.processId || typeof message.processId !== 'string') {
    errors.push('Heartbeat message must have a valid processId field');
  }
  
  if (typeof message.status !== 'string') {
    errors.push('Heartbeat message must have a valid status field');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate event message
 */
export function validateEventMessage(data: unknown): ValidationResult {
  const baseResult = validateBaseMessage(data);
  if (!baseResult.valid) {
    return baseResult;
  }
  
  const message = data as Record<string, unknown>;
  const errors: string[] = [];
  
  if (message.type !== 'event') {
    errors.push('Event message must have type "event"');
  }
  
  if (!message.eventType || typeof message.eventType !== 'string') {
    errors.push('Event message must have a valid eventType field');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate message by type
 */
export function validateMessage(data: unknown): ValidationResult {
  const baseResult = validateBaseMessage(data);
  if (!baseResult.valid) {
    return baseResult;
  }
  
  const message = data as BaseMessage;
  
  switch (message.type) {
    case 'admin':
      return validateAdminMessage(data);
    case 'chat':
      return validateChatMessage(data);
    case 'heartbeat':
      return validateHeartbeatMessage(data);
    case 'event':
      return validateEventMessage(data);
    default:
      return {
        valid: false,
        errors: [`Unknown message type: ${message.type}`]
      };
  }
}

/**
 * Validate channel name
 */
export function validateChannelName(channel: string): ValidationResult {
  const errors: string[] = [];
  
  if (!channel || typeof channel !== 'string') {
    return { valid: false, errors: ['Channel name must be a non-empty string'] };
  }
  
  // Check if it's a valid channel pattern
  const validChannels: string[] = [
    'admin:messages',
    'chat:global',
    'heartbeat:status',
    'events:system',
    'notifications:user'
  ];
  
  const isValidPattern = validChannels.some(pattern => {
    if (pattern.includes(':')) {
      const [prefix] = pattern.split(':');
      return channel.startsWith(`${prefix}:`);
    }
    return channel === pattern;
  });
  
  if (!isValidPattern) {
    errors.push(`Invalid channel name format: ${channel}`);
  }
  
  // Additional format validation
  if (!/^[a-z][a-z0-9]*:[a-z][a-z0-9]*$/i.test(channel) && !/^[a-z][a-z0-9]*$/.test(channel)) {
    errors.push('Channel name must follow format: category:name or just name');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate connection configuration
 */
export function validateConnectionConfig(config: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Configuration must be an object'] };
  }
  
  const cfg = config as Record<string, unknown>;
  
  if (cfg.host && typeof cfg.host !== 'string') {
    errors.push('Host must be a string');
  }
  
  if (cfg.port && (typeof cfg.port !== 'number' || cfg.port < 1 || cfg.port > 65535)) {
    errors.push('Port must be a number between 1 and 65535');
  }
  
  if (cfg.password && typeof cfg.password !== 'string') {
    errors.push('Password must be a string');
  }
  
  if (cfg.db && (typeof cfg.db !== 'number' || cfg.db < 0 || cfg.db > 15)) {
    errors.push('Database must be a number between 0 and 15');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Sanitize message content
 */
export function sanitizeMessage<T extends BaseMessage>(message: T): T {
  const sanitized = { ...message };
  
  // Remove any potential XSS or injection content
  if ('content' in sanitized && typeof sanitized.content === 'string') {
    sanitized.content = sanitized.content
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<[^>]*>/g, '')
      .trim();
  }
  
  // Ensure timestamp is current if missing
  if (!sanitized.timestamp) {
    sanitized.timestamp = new Date().toISOString();
  }
  
  return sanitized;
}

/**
 * Type guard for base message
 */
export function isBaseMessage(data: unknown): data is BaseMessage {
  return validateBaseMessage(data).valid;
}

/**
 * Type guard for admin message
 */
export function isAdminMessage(data: unknown): data is AdminMessage {
  return validateAdminMessage(data).valid;
}

/**
 * Type guard for chat message
 */
export function isChatMessage(data: unknown): data is ChatMessage {
  return validateChatMessage(data).valid;
}

/**
 * Type guard for heartbeat message
 */
export function isHeartbeatMessage(data: unknown): data is HeartbeatMessage {
  return validateHeartbeatMessage(data).valid;
}

/**
 * Type guard for event message
 */
export function isEventMessage(data: unknown): data is EventMessage {
  return validateEventMessage(data).valid;
}