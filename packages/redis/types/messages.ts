/**
 * Message type definitions for Redis messaging system
 */

export interface BaseMessage {
  /** Unique message identifier */
  id?: string;
  /** Message timestamp */
  timestamp: number;
  /** Message sender information */
  sender_id: string;
  sender_name?: string;
  /** Target room URL */
  room_url?: string;
}

export interface AdminMessage extends BaseMessage {
  /** Admin command or message */
  message: string;
  /** Delivery mode */
  mode: 'immediate' | 'queued';
  /** Bot process ID for targeting */
  bot_pid?: number;
  /** Priority level */
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface ChatMessage extends BaseMessage {
  /** Chat message content */
  message: string;
  /** Message type */
  type?: 'text' | 'system' | 'notification';
  /** Reply to message ID */
  reply_to?: string;
  /** Message metadata */
  metadata?: Record<string, unknown>;
}

export interface HeartbeatMessage extends BaseMessage {
  /** Bot process ID */
  bot_pid: number;
  /** Bot health status */
  status: 'healthy' | 'warning' | 'error';
  /** Current participants */
  participants: string[];
  /** Performance metrics */
  metrics?: {
    memory_usage?: string;
    cpu_usage?: number;
    uptime?: number;
    message_count?: number;
  };
}

export interface EventMessage extends BaseMessage {
  /** Event type from @nia/events */
  event_type: string;
  /** Event payload */
  payload: Record<string, unknown>;
  /** Event version */
  version?: string;
  /** Correlation ID for tracing */
  correlation_id?: string;
}

/** Union type for all message types */
export type RedisMessage = AdminMessage | ChatMessage | HeartbeatMessage | EventMessage;

/** Message delivery status */
export interface MessageDeliveryStatus {
  message_id: string;
  status: 'pending' | 'delivered' | 'failed' | 'expired';
  delivered_at?: number;
  error?: string;
  retry_count?: number;
}

/** Subscription callback function */
export type MessageHandler<T extends RedisMessage = RedisMessage> = (
  message: T,
  channel: string
) => Promise<void> | void;

/** Message validation result */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}