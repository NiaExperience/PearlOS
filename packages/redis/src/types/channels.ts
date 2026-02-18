/**
 * Channel definitions and types for Redis pub/sub
 */

import type { BaseMessage } from './messages';

/**
 * Channel names for different message types
 */
export const ChannelNames = {
  ADMIN_MESSAGES: 'admin:messages',
  CHAT_GLOBAL: 'chat:global',
  HEARTBEAT_STATUS: 'heartbeat:status',
  EVENTS_SYSTEM: 'events:system',
  NOTIFICATIONS_USER: 'notifications:user'
} as const;

/**
 * Type for channel names
 */
export type ChannelName = typeof ChannelNames[keyof typeof ChannelNames];

// MessageHandler is exported from messages.ts to avoid duplication

import type { MessageHandler } from './messages';

/**
 * Channel subscription information
 */
export interface ChannelSubscription {
  channel: string;
  handler: MessageHandler;
  subscribed: boolean;
  subscribedAt?: Date;
  pattern?: string;
  options?: Record<string, unknown>;
}

/**
 * Channel statistics
 */
export interface ChannelStats {
  channel: string;
  messageCount: number;
  subscriberCount: number;
  lastMessage?: Date;
  errorCount: number;
  // Additional properties used in implementation
  subscribers: number;
  messages_sent: number;
  messages_received: number;
  last_activity: number;
  error_count: number;
}

/**
 * Channel message wrapper
 */
export interface ChannelMessage<T extends BaseMessage = BaseMessage> {
  channel: string;
  message: T;
  timestamp: Date;
}