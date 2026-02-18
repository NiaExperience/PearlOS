/**
 * Message type definitions for Redis pub/sub
 */

/**
 * Base message interface that all messages must extend
 */
export interface BaseMessage {
  id: string;
  type: string;
  timestamp: string;
}

/**
 * Administrative message for server control and management
 */
export interface AdminMessage extends BaseMessage {
  type: 'admin';
  action: string;
  fromAdmin: string;
  data?: Record<string, unknown>;
}

/**
 * Chat message for user communication
 */
export interface ChatMessage extends BaseMessage {
  type: 'chat';
  roomId: string;
  userId: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Heartbeat message for process health monitoring
 */
export interface HeartbeatMessage extends BaseMessage {
  type: 'heartbeat';
  processId: string;
  status: string;
  metadata?: Record<string, unknown>;
}

/**
 * Event message for system events and notifications
 */
export interface EventMessage extends BaseMessage {
  type: 'event';
  eventType: string;
  data?: Record<string, unknown>;
}

/**
 * Union type for all message types
 */
export type RedisMessage = AdminMessage | ChatMessage | HeartbeatMessage | EventMessage;

/**
 * Message handler function type
 */
export type MessageHandler<T extends BaseMessage = RedisMessage> = (message: T) => Promise<void> | void;