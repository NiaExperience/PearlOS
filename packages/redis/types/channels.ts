/**
 * Redis channel type definitions and naming conventions
 */

/** Base channel names */
export const CHANNEL_NAMES = {
  /** Admin messaging channels */
  ADMIN: 'admin_messages',
  ADMIN_BROADCAST: 'admin_broadcast',
  
  /** Chat messaging channels */
  CHAT: 'chat',
  CHAT_GLOBAL: 'chat_global',
  
  /** Bot heartbeat channels */
  BOT_HEARTBEAT: 'bot_heartbeat',
  BOT_STATUS: 'bot_status',
  
  /** Event channels */
  EVENTS: 'events',
  SYSTEM_EVENTS: 'system_events',
  
  /** Monitoring channels */
  METRICS: 'metrics',
  HEALTH_CHECK: 'health_check'
} as const;

/** Channel name type */
export type ChannelName = typeof CHANNEL_NAMES[keyof typeof CHANNEL_NAMES];

/** Room-specific channel builder */
export interface RoomChannel {
  /** Admin messages for specific room */
  admin: (roomUrl: string) => string;
  /** Chat messages for specific room */
  chat: (roomUrl: string) => string;
  /** Events for specific room */
  events: (roomUrl: string) => string;
}

/** Channel subscription configuration */
export interface ChannelSubscription {
  /** Channel name or pattern */
  channel: string;
  /** Pattern matching (for wildcards) */
  pattern?: boolean;
  /** Message handler */
  handler: (message: unknown, channel: string) => Promise<void> | void;
  /** Subscription options */
  options?: {
    /** Auto-reconnect on failure */
    autoReconnect?: boolean;
    /** Maximum retry attempts */
    maxRetries?: number;
    /** Retry delay in milliseconds */
    retryDelay?: number;
  };
}

/** Channel message wrapper */
export interface ChannelMessage<T = unknown> {
  channel: string;
  message: T;
  timestamp?: number;
  messageId?: string;
}

/** Channel statistics */
export interface ChannelStats {
  channel: string;
  subscribers: number;
  messages_sent: number;
  messages_received: number;
  last_activity: number;
  error_count: number;
}