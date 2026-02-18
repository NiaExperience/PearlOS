/**
 * Message serialization utilities for Redis pub/sub
 * Handles JSON serialization with type safety and error handling
 */

import type { BaseMessage } from '../types/messages';

/**
 * Serialization result with error handling
 */
export interface SerializationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Serialize a message to JSON string for Redis
 */
export function serializeMessage<T extends BaseMessage>(message: T): SerializationResult<string> {
  try {
    // Add metadata
    const enrichedMessage = {
      ...message,
      serializedAt: new Date().toISOString(),
      version: '1.0'
    };
    
    const serialized = JSON.stringify(enrichedMessage);
    
    return {
      success: true,
      data: serialized
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Serialization failed'
    };
  }
}

/**
 * Deserialize a JSON string to a typed message
 */
export function deserializeMessage<T extends BaseMessage>(data: string): SerializationResult<T> {
  try {
    const parsed = JSON.parse(data) as T;
    
    // Basic validation
    if (!parsed.type || !parsed.timestamp) {
      return {
        success: false,
        error: 'Invalid message format: missing required fields'
      };
    }
    
    return {
      success: true,
      data: parsed
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Deserialization failed'
    };
  }
}

/**
 * Safely serialize any data for Redis storage
 */
export function safeSerialize(data: unknown): string {
  try {
    if (typeof data === 'string') {
      return data;
    }
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

/**
 * Message serializer class wrapper
 */
export class MessageSerializer {
  async serialize<T>(message: T, options?: { compress?: boolean }): Promise<string> {
    const result = serializeMessage(message as any);
    if (result.success && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Serialization failed');
  }

  deserialize<T extends BaseMessage>(data: string): T {
    const result = deserializeMessage<T>(data);
    if (result.success && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Deserialization failed');
  }
}

/**
 * Safely deserialize Redis data
 */
export function safeDeserialize<T = unknown>(data: string): T | string {
  try {
    return JSON.parse(data) as T;
  } catch {
    return data as T;
  }
}