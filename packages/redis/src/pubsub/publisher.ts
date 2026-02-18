/**
 * Redis publisher with type safety and validation
 */

import type { Redis } from 'ioredis';

import type { ChannelMessage } from '../types/channels';
import type { RedisMessage, MessageHandler } from '../types/messages';
import { RetryManager } from '../utils/retry';
import { MessageSerializer } from '../utils/serialization';
import { MessageValidator } from '../utils/validation';

export interface PublishOptions {
  /** Validate message before publishing */
  validate?: boolean;
  /** Retry on failure */
  retry?: boolean;
  /** TTL for message in seconds */
  ttl?: number;
  /** Compress large messages */
  compress?: boolean;
}

export interface PublishResult {
  success: boolean;
  messageId?: string;
  subscriberCount?: number;
  error?: string;
  retries?: number;
}

export class RedisPublisher {
  constructor(
    private redis: Redis,
    private serializer: MessageSerializer = new MessageSerializer(),
    private validator: MessageValidator = new MessageValidator(),
    private retryManager: RetryManager = new RetryManager()
  ) {}

  /**
   * Publish message to channel
   */
  async publish<T extends RedisMessage>(
    channel: string,
    message: T,
    options: PublishOptions = {}
  ): Promise<PublishResult> {
    const opts = {
      validate: true,
      retry: true,
      compress: false,
      ...options
    };

    try {
      // Validate message if requested
      if (opts.validate) {
        const validation = this.validator.validate(message);
        if (!validation.valid) {
          return {
            success: false,
            error: `Validation failed: ${validation.errors?.join(', ')}`
          };
        }
      }

      // Generate message ID
      const messageId = this.generateMessageId();
      const wrappedMessage = {
        ...message,
        id: messageId,
        timestamp: Date.now()
      };

      // Serialize message
      const serialized = await this.serializer.serialize(wrappedMessage, {
        compress: opts.compress
      });

      // Publish with retry logic
      const publishFn = async (): Promise<number> => {
        const subscriberCount = await this.redis.publish(channel, serialized);
        return subscriberCount;
      };

      let subscriberCount: number;
      let retries = 0;

      if (opts.retry) {
        const result = await this.retryManager.execute(publishFn);
        subscriberCount = result.result;
        retries = result.attempts - 1;
      } else {
        subscriberCount = await publishFn();
      }

      // Set TTL if specified
      if (opts.ttl) {
        await this.setMessageTTL(channel, messageId, opts.ttl);
      }

      return {
        success: true,
        messageId,
        subscriberCount,
        retries
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Publish multiple messages in batch
   */
  async publishBatch<T extends RedisMessage>(
    messages: ChannelMessage<T>[],
    options: PublishOptions = {}
  ): Promise<PublishResult[]> {
    const results: PublishResult[] = [];
    
    // Use pipeline for better performance
    const pipeline = this.redis.pipeline();
    const messageData: Array<{ channel: string; message: T; serialized: string }> = [];

    // Prepare all messages
    for (const { channel, message } of messages) {
      try {
        if (options.validate) {
          const validation = this.validator.validate(message);
          if (!validation.valid) {
            results.push({
              success: false,
              error: `Validation failed: ${validation.errors?.join(', ')}`
            });
            continue;
          }
        }

        const messageId = this.generateMessageId();
        const wrappedMessage = {
          ...message,
          id: messageId,
          timestamp: Date.now()
        };

        const serialized = await this.serializer.serialize(wrappedMessage, {
          compress: options.compress
        });

        pipeline.publish(channel, serialized);
        messageData.push({ channel, message, serialized });
      } catch (error) {
        results.push({
          success: false,
          error: error instanceof Error ? error.message : 'Serialization failed'
        });
      }
    }

    // Execute pipeline
    try {
      const pipelineResults = await pipeline.exec();
      
      if (pipelineResults) {
        for (let i = 0; i < pipelineResults.length; i++) {
          const [error, subscriberCount] = pipelineResults[i];
          
          if (error) {
            results.push({
              success: false,
              error: error.message
            });
          } else {
            results.push({
              success: true,
              subscriberCount: subscriberCount as number
            });
          }
        }
      }
    } catch (error) {
      // If pipeline fails, mark all remaining as failed
      const remainingCount = messageData.length - results.length;
      for (let i = 0; i < remainingCount; i++) {
        results.push({
          success: false,
          error: error instanceof Error ? error.message : 'Pipeline execution failed'
        });
      }
    }

    return results;
  }

  /**
   * Publish with delivery confirmation
   */
  async publishWithConfirmation<T extends RedisMessage>(
    channel: string,
    message: T,
    confirmationChannel: string,
    timeoutMs = 5000,
    options: PublishOptions = {}
  ): Promise<PublishResult & { confirmed?: boolean; confirmationTime?: number }> {
    const result = await this.publish(channel, message, options);
    
    if (!result.success) {
      return result;
    }

    // Wait for confirmation
    const confirmationStart = Date.now();
    const confirmed = await this.waitForConfirmation(
      confirmationChannel,
      result.messageId!,
      timeoutMs
    );

    return {
      ...result,
      confirmed,
      confirmationTime: confirmed ? Date.now() - confirmationStart : undefined
    };
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Set TTL for message (using a separate key)
   */
  private async setMessageTTL(channel: string, messageId: string, ttlSeconds: number): Promise<void> {
    const key = `ttl:${channel}:${messageId}`;
    await this.redis.setex(key, ttlSeconds, messageId);
  }

  /**
   * Wait for delivery confirmation
   */
  private async waitForConfirmation(
    confirmationChannel: string,
    messageId: string,
    timeoutMs: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const subscriber = this.redis.duplicate();
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          subscriber.disconnect();
        }
      };

      // Set timeout
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);

      // Listen for confirmation
      subscriber.subscribe(confirmationChannel);
      subscriber.on('message', (channel, data) => {
        if (channel === confirmationChannel) {
          try {
            const confirmation = JSON.parse(data);
            if (confirmation.messageId === messageId) {
              clearTimeout(timeout);
              cleanup();
              resolve(true);
            }
          } catch {
            // Invalid confirmation message, ignore
          }
        }
      });

      // Handle subscriber errors
      subscriber.on('error', () => {
        clearTimeout(timeout);
        cleanup();
        resolve(false);
      });
    });
  }
}