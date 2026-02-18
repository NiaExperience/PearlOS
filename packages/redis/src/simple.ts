/**
 * @nia/redis - Simplified Redis client for NIA Universal
 * 
 * A working Redis integration for cross-process messaging
 * Focus on immediate admin messaging migration from file-based system
 */

// Core Redis connection
import Redis from 'ioredis';

/**
 * Simple Redis configuration
 */
export interface SimpleRedisConfig {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
}

/**
 * Admin message for cross-process communication
 */
export interface AdminMessage {
  id: string;
  type: 'admin';
  timestamp: string;
  action: string;
  fromAdmin: string;
  data?: Record<string, unknown>;
}

/**
 * Simple Redis client for admin messaging
 */
export class RedisAdminMessaging {
  private redis: Redis;
  private subscriber?: Redis;
  
  constructor(config: SimpleRedisConfig = {}) {
    const redisConfig = {
      host: config.host || process.env.REDIS_HOST || 'localhost',
      port: config.port || parseInt(process.env.REDIS_PORT || '6379'),
      password: config.password || process.env.REDIS_PASSWORD,
      db: config.db || parseInt(process.env.REDIS_DB || '0'),
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    };
    
    this.redis = new Redis(redisConfig);
  }
  
  /**
   * Send admin message to bot processes
   */
  async sendAdminMessage(message: {
    action: string;
    fromAdmin: string;
    roomUrl?: string;
    botPid?: number;
    data?: Record<string, unknown>;
  }): Promise<void> {
    const adminMessage: AdminMessage = {
      id: `admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'admin',
      timestamp: new Date().toISOString(),
      action: message.action,
      fromAdmin: message.fromAdmin,
      data: {
        roomUrl: message.roomUrl,
        botPid: message.botPid,
        ...message.data
      }
    };
    
    // Use both pub/sub for real-time and queue for persistence
    const channel = message.botPid ? `admin:bot:${message.botPid}` : 'admin:broadcast';
    await this.redis.publish(channel, JSON.stringify(adminMessage));
    
    // Also queue the message for polling-based retrieval
    if (message.botPid) {
      const queueKey = `admin:queue:${message.botPid}`;
      await this.redis.rpush(queueKey, JSON.stringify(adminMessage));
      // Set expiration on the queue key to prevent accumulation
      await this.redis.expire(queueKey, 3600); // 1 hour TTL
    }
  }
  
  /**
   * Subscribe to admin messages (generic handler)
   */
  async subscribeToAdminMessages(handler: (message: AdminMessage) => void): Promise<() => void>;
  /**
   * Subscribe to admin messages for this bot process
   */
  async subscribeToAdminMessages(botPid: number, handler: (message: AdminMessage) => void): Promise<() => void>;
  async subscribeToAdminMessages(
    handlerOrBotPid: ((message: AdminMessage) => void) | number, 
    handler?: (message: AdminMessage) => void
  ): Promise<() => void> {
    let botPid: number | undefined;
    let messageHandler: (message: AdminMessage) => void;

    if (typeof handlerOrBotPid === 'function') {
      messageHandler = handlerOrBotPid;
      botPid = undefined;
    } else {
      botPid = handlerOrBotPid;
      messageHandler = handler!;
    }
    if (!this.subscriber) {
      this.subscriber = this.redis.duplicate();
    }

    // Determine channel based on whether botPid is specified
    const channel = botPid !== undefined ? `admin:bot:${botPid}` : 'admin:*';
    
    if (botPid !== undefined) {
      await this.subscriber.subscribe(channel);
    } else {
      await this.subscriber.psubscribe('admin:*');
    }
    
    const redisMessageHandler = (receivedChannel: string, message: string) => {
      const targetChannel = botPid !== undefined ? channel : receivedChannel;
      if (receivedChannel === targetChannel || (botPid === undefined && receivedChannel.startsWith('admin:'))) {
        try {
          const parsedMessage = JSON.parse(message) as AdminMessage;
          messageHandler(parsedMessage);
        } catch (error) {
          console.error('Failed to parse admin message:', error);
        }
      }
    };

    if (botPid !== undefined) {
      this.subscriber.on('message', redisMessageHandler);
    } else {
      this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
        redisMessageHandler(channel, message);
      });
    }

    // Return unsubscribe function
    return () => {
      if (this.subscriber) {
        if (botPid !== undefined) {
          this.subscriber.unsubscribe(channel);
          this.subscriber.removeListener('message', redisMessageHandler);
        } else {
          this.subscriber.punsubscribe('admin:*');
          this.subscriber.removeListener('pmessage', redisMessageHandler);
        }
      }
    };
  }  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
  
  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
    if (this.subscriber) {
      await this.subscriber.quit();
    }
  }
}

/**
 * Create Redis admin messaging instance
 */
export function createRedisAdminMessaging(config?: SimpleRedisConfig): RedisAdminMessaging {
  return new RedisAdminMessaging(config);
}

// Export for backward compatibility
export default RedisAdminMessaging;