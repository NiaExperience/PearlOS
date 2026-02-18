/**
 * Redis subscriber with pattern matching and error handling
 */

import type { Redis } from 'ioredis';

import type { ChannelSubscription } from '../types/channels';
import type { RedisMessage, MessageHandler } from '../types/messages';
import { deserializeMessage, MessageSerializer } from '../utils/serialization';
import { validateMessage, MessageValidator } from '../utils/validation';

export interface SubscriptionOptions {
  /** Pattern matching for wildcard subscriptions */
  pattern?: boolean;
  /** Auto-reconnect on failure */
  autoReconnect?: boolean;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Retry delay in milliseconds */
  retryDelay?: number;
  /** Validate messages before handling */
  validate?: boolean;
  /** Dead letter channel for failed messages */
  deadLetterChannel?: string;
}

export interface Subscription {
  id: string;
  channel: string;
  pattern: boolean;
  handler: MessageHandler;
  options: SubscriptionOptions;
  active: boolean;
  createdAt: number;
  messageCount: number;
  errorCount: number;
  lastActivity?: number;
}

export class RedisSubscriber {
  private subscriptions: Map<string, Subscription> = new Map();
  private subscriber: Redis;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(
    private redis: Redis,
    private serializer: MessageSerializer = new MessageSerializer(),
    private validator: MessageValidator = new MessageValidator()
  ) {
    this.subscriber = redis.duplicate();
    this.setupSubscriberEvents();
  }

  /**
   * Subscribe to channel
   */
  async subscribe<T extends RedisMessage>(
    channel: string,
    handler: MessageHandler<T>,
    options: SubscriptionOptions = {}
  ): Promise<Subscription> {
    const opts = {
      pattern: false,
      autoReconnect: true,
      maxRetries: 3,
      retryDelay: 1000,
      validate: true,
      ...options
    };

    const subscription: Subscription = {
      id: this.generateSubscriptionId(),
      channel,
      pattern: opts.pattern || false,
      handler: handler as MessageHandler,
      options: opts,
      active: false,
      createdAt: Date.now(),
      messageCount: 0,
      errorCount: 0
    };

    // Store subscription
    this.subscriptions.set(subscription.id, subscription);

    // Subscribe to Redis channel
    try {
      if (opts.pattern) {
        await this.subscriber.psubscribe(channel);
      } else {
        await this.subscriber.subscribe(channel);
      }

      subscription.active = true;
      console.log(`✓ Subscribed to ${opts.pattern ? 'pattern' : 'channel'}: ${channel}`);
    } catch (error) {
      subscription.active = false;
      subscription.errorCount++;
      
      console.error(`✗ Failed to subscribe to ${channel}:`, error);
      
      if (opts.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        setTimeout(() => {
          this.retrySubscription(subscription);
        }, opts.retryDelay);
      }
    }

    return subscription;
  }

  /**
   * Subscribe to multiple channels
   */
  async subscribeMultiple(
    subscriptions: ChannelSubscription[]
  ): Promise<Subscription[]> {
    const results: Subscription[] = [];
    
    for (const sub of subscriptions) {
      try {
        const subscription = await this.subscribe(
          sub.channel,
          sub.handler,
          {
            pattern: !!sub.pattern, // Convert string to boolean
            ...sub.options
          }
        );
        results.push(subscription);
      } catch (error) {
        console.error(`Failed to subscribe to ${sub.channel}:`, error);
        // Continue with other subscriptions
      }
    }
    
    return results;
  }

  /**
   * Unsubscribe from channel
   */
  async unsubscribe(subscription: Subscription | string): Promise<boolean> {
    const sub = typeof subscription === 'string' 
      ? this.subscriptions.get(subscription)
      : subscription;

    if (!sub) {
      return false;
    }

    try {
      if (sub.pattern) {
        await this.subscriber.punsubscribe(sub.channel);
      } else {
        await this.subscriber.unsubscribe(sub.channel);
      }

      sub.active = false;
      this.subscriptions.delete(sub.id);
      
      console.log(`✓ Unsubscribed from ${sub.channel}`);
      return true;
    } catch (error) {
      console.error(`✗ Failed to unsubscribe from ${sub.channel}:`, error);
      return false;
    }
  }

  /**
   * Unsubscribe from all channels
   */
  async unsubscribeAll(): Promise<void> {
    const subscriptions = Array.from(this.subscriptions.values());
    
    await Promise.all(
      subscriptions.map(sub => this.unsubscribe(sub))
    );
    
    this.subscriptions.clear();
    console.log('✓ Unsubscribed from all channels');
  }

  /**
   * Get subscription by ID
   */
  getSubscription(id: string): Subscription | undefined {
    return this.subscriptions.get(id);
  }

  /**
   * Get all active subscriptions
   */
  getActiveSubscriptions(): Subscription[] {
    return Array.from(this.subscriptions.values()).filter(sub => sub.active);
  }

  /**
   * Get subscription statistics
   */
  getStats(): {
    totalSubscriptions: number;
    activeSubscriptions: number;
    totalMessages: number;
    totalErrors: number;
  } {
    const subscriptions = Array.from(this.subscriptions.values());
    
    return {
      totalSubscriptions: subscriptions.length,
      activeSubscriptions: subscriptions.filter(sub => sub.active).length,
      totalMessages: subscriptions.reduce((sum, sub) => sum + sub.messageCount, 0),
      totalErrors: subscriptions.reduce((sum, sub) => sum + sub.errorCount, 0)
    };
  }

  /**
   * Close subscriber connection
   */
  async close(): Promise<void> {
    await this.unsubscribeAll();
    await this.subscriber.disconnect();
    console.log('✓ Redis subscriber closed');
  }

  /**
   * Setup subscriber event handlers
   */
  private setupSubscriberEvents(): void {
    // Handle regular messages
    this.subscriber.on('message', (channel: string, message: string) => {
      this.handleMessage(channel, message, false);
    });

    // Handle pattern messages
    this.subscriber.on('pmessage', (pattern: string, channel: string, message: string) => {
      this.handleMessage(channel, message, true, pattern);
    });

    // Handle connection events
    this.subscriber.on('connect', () => {
      console.log('✓ Redis subscriber connected');
      this.reconnectAttempts = 0;
    });

    this.subscriber.on('error', (error: Error) => {
      console.error('✗ Redis subscriber error:', error.message);
      this.handleConnectionError(error);
    });

    this.subscriber.on('reconnecting', () => {
      console.log('🔄 Redis subscriber reconnecting...');
      this.reconnectAttempts++;
    });
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(
    channel: string,
    message: string,
    isPattern: boolean,
    pattern?: string
  ): Promise<void> {
    // Find matching subscriptions
    const matchingSubscriptions = Array.from(this.subscriptions.values()).filter(sub => {
      if (isPattern) {
        return sub.pattern && sub.channel === pattern;
      } else {
        return !sub.pattern && sub.channel === channel;
      }
    });

    for (const subscription of matchingSubscriptions) {
      try {
        // Deserialize message
        const deserializedMessage = await this.serializer.deserialize(message);
        
        // Validate if requested
        if (subscription.options.validate) {
          const validation = this.validator.validate(deserializedMessage);
          if (!validation.valid) {
            console.warn(`Invalid message on ${channel}:`, validation.errors);
            subscription.errorCount++;
            
            // Send to dead letter channel if configured
            if (subscription.options.deadLetterChannel) {
              await this.sendToDeadLetter(
                subscription.options.deadLetterChannel,
                channel,
                message,
                'Validation failed'
              );
            }
            continue;
          }
        }

        // Call handler
        await subscription.handler(deserializedMessage as RedisMessage);
        
        // Update statistics
        subscription.messageCount++;
        subscription.lastActivity = Date.now();
      } catch (error) {
        subscription.errorCount++;
        
        console.error(`Error handling message on ${channel}:`, error);
        
        // Retry logic
        if (subscription.options.maxRetries && subscription.errorCount <= subscription.options.maxRetries) {
          setTimeout(() => {
            this.handleMessage(channel, message, isPattern, pattern);
          }, subscription.options.retryDelay || 1000);
        } else {
          // Send to dead letter channel
          if (subscription.options.deadLetterChannel) {
            await this.sendToDeadLetter(
              subscription.options.deadLetterChannel,
              channel,
              message,
              error instanceof Error ? error.message : 'Handler error'
            );
          }
        }
      }
    }
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(error: Error): void {
    // Mark all subscriptions as inactive
    for (const subscription of this.subscriptions.values()) {
      subscription.active = false;
      subscription.errorCount++;
    }

    // Auto-reconnect if enabled
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      setTimeout(() => {
        this.reconnectAllSubscriptions();
      }, 5000); // Wait 5 seconds before reconnect
    }
  }

  /**
   * Retry single subscription
   */
  private async retrySubscription(subscription: Subscription): Promise<void> {
    if (subscription.errorCount >= (subscription.options.maxRetries || 3)) {
      console.error(`Max retries reached for subscription ${subscription.id}`);
      return;
    }

    try {
      if (subscription.pattern) {
        await this.subscriber.psubscribe(subscription.channel);
      } else {
        await this.subscriber.subscribe(subscription.channel);
      }

      subscription.active = true;
      console.log(`✓ Retried subscription to ${subscription.channel}`);
    } catch (error) {
      subscription.errorCount++;
      console.error(`Retry failed for ${subscription.channel}:`, error);
    }
  }

  /**
   * Reconnect all subscriptions
   */
  private async reconnectAllSubscriptions(): Promise<void> {
    const subscriptions = Array.from(this.subscriptions.values());
    
    for (const subscription of subscriptions) {
      if (subscription.options.autoReconnect) {
        await this.retrySubscription(subscription);
      }
    }
  }

  /**
   * Send failed message to dead letter channel
   */
  private async sendToDeadLetter(
    deadLetterChannel: string,
    originalChannel: string,
    message: string,
    reason: string
  ): Promise<void> {
    try {
      const deadLetterMessage = {
        originalChannel,
        originalMessage: message,
        failureReason: reason,
        timestamp: Date.now()
      };
      
      await this.redis.publish(deadLetterChannel, JSON.stringify(deadLetterMessage));
    } catch (error) {
      console.error('Failed to send to dead letter channel:', error);
    }
  }

  /**
   * Generate unique subscription ID
   */
  private generateSubscriptionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}