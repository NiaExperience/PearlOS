/**
 * Chat messaging service for Redis pub/sub
 * Handles real-time chat communication between users
 */

import { RedisPublisher } from '../pubsub/publisher';
import { RedisSubscriber } from '../pubsub/subscriber';
import { ChannelNames } from '../types/channels';
import { ChatMessage } from '../types/messages';
import { trackOperation } from '../utils/metrics';
import { validateChatMessage, sanitizeMessage } from '../utils/validation';

/**
 * Chat message handler callback
 */
export type ChatMessageHandler = (message: ChatMessage) => Promise<void> | void;

/**
 * Chat service configuration
 */
export interface ChatServiceConfig {
  userId?: string;
  enableLogging?: boolean;
  validateMessages?: boolean;
  maxMessageLength?: number;
  rateLimitPerMinute?: number;
}

/**
 * Rate limiting tracker
 */
interface RateLimit {
  count: number;
  resetTime: number;
}

/**
 * Chat messaging service
 */
export class ChatMessagingService {
  private publisher: RedisPublisher;
  private subscriber: RedisSubscriber;
  private handlers = new Map<string, ChatMessageHandler>();
  private roomSubscriptions = new Set<string>();
  private rateLimits = new Map<string, RateLimit>();
  
  constructor(
    publisher: RedisPublisher,
    subscriber: RedisSubscriber,
    private config: ChatServiceConfig = {}
  ) {
    this.publisher = publisher;
    this.subscriber = subscriber;
  }
  
  /**
   * Send a chat message to a room
   */
  async sendMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<void> {
    // Check rate limiting
    if (this.config.rateLimitPerMinute && message.userId) {
      if (!this.checkRateLimit(message.userId)) {
        throw new Error('Rate limit exceeded');
      }
    }
    
    // Check message length
    if (this.config.maxMessageLength && message.content.length > this.config.maxMessageLength) {
      throw new Error(`Message too long (max ${this.config.maxMessageLength} characters)`);
    }
    
    const fullMessage: ChatMessage = {
      ...message,
      id: this.generateMessageId(),
      timestamp: new Date().toISOString(),
      type: 'chat'
    };
    
    // Validate message if enabled
    if (this.config.validateMessages !== false) {
      const validation = validateChatMessage(fullMessage);
      if (!validation.valid) {
        throw new Error(`Invalid chat message: ${validation.errors?.join(', ') || 'Unknown validation error'}`);
      }
    }
    
    // Sanitize message
    const sanitizedMessage = sanitizeMessage(fullMessage);
    
    // Publish to room-specific channel
    const channel = this.getRoomChannel(message.roomId);
    await this.publisher.publish(channel, sanitizedMessage);
    
    // Also publish to global chat channel for monitoring
    await this.publisher.publish(ChannelNames.CHAT_GLOBAL, sanitizedMessage);
    
    if (this.config.enableLogging) {
      console.log(`[ChatService] Sent message to room ${message.roomId}`, { message: sanitizedMessage });
    }
  }
  
  /**
   * Send a direct message between users
   */
  async sendDirectMessage(toUserId: string, content: string, fromUserId?: string): Promise<void> {
    const userId = fromUserId || this.config.userId;
    if (!userId) {
      throw new Error('User ID required for direct messages');
    }
    
    await this.sendMessage({
      type: 'chat',
      roomId: this.getDirectMessageRoomId(userId, toUserId),
      content,
      userId,
      metadata: {
        type: 'direct',
        participants: [userId, toUserId]
      }
    });
  }
  
  /**
   * Join a chat room
   */
  async joinRoom(roomId: string, handler: ChatMessageHandler): Promise<void> {
    const channel = this.getRoomChannel(roomId);
    
    await this.subscriber.subscribe(channel, (message: ChatMessage) => {
      this.handleRoomMessage(roomId, message, handler);
    });
    
    this.roomSubscriptions.add(roomId);
    this.handlers.set(roomId, handler);
    
    if (this.config.enableLogging) {
      console.log(`[ChatService] Joined room: ${roomId}`);
    }
  }
  
  /**
   * Leave a chat room
   */
  async leaveRoom(roomId: string): Promise<void> {
    const channel = this.getRoomChannel(roomId);
    
    await this.subscriber.unsubscribe(channel);
    
    this.roomSubscriptions.delete(roomId);
    this.handlers.delete(roomId);
    
    if (this.config.enableLogging) {
      console.log(`[ChatService] Left room: ${roomId}`);
    }
  }
  
  /**
   * Listen for all chat messages (monitoring)
   */
  async monitorAllMessages(handler: ChatMessageHandler): Promise<void> {
    await this.subscriber.subscribe(ChannelNames.CHAT_GLOBAL, (message: ChatMessage) => {
      this.handleMessage(message, handler);
    });
    
    this.handlers.set('*', handler);
    
    if (this.config.enableLogging) {
      console.log('[ChatService] Started monitoring all chat messages');
    }
  }
  
  /**
   * Stop monitoring all messages
   */
  async stopMonitoring(): Promise<void> {
    await this.subscriber.unsubscribe(ChannelNames.CHAT_GLOBAL);
    this.handlers.delete('*');
    
    if (this.config.enableLogging) {
      console.log('[ChatService] Stopped monitoring all chat messages');
    }
  }
  
  /**
   * Handle room-specific message
   */
  private async handleRoomMessage(roomId: string, message: ChatMessage, handler: ChatMessageHandler): Promise<void> {
    try {
      // Validate message if enabled
      if (this.config.validateMessages !== false) {
        const validation = validateChatMessage(message);
        if (!validation.valid) {
          console.error(`[ChatService] Invalid message in room ${roomId}:`, validation.errors);
          return;
        }
      }
      
      // Check if message belongs to this room
      if (message.roomId !== roomId) {
        return;
      }
      
      await handler(message);
      
      if (this.config.enableLogging) {
        console.log(`[ChatService] Handled message in room ${roomId}`, { message });
      }
    } catch (error) {
      console.error(`[ChatService] Error handling message in room ${roomId}:`, error, { message });
    }
  }
  
  /**
   * Handle general message
   */
  private async handleMessage(message: ChatMessage, handler: ChatMessageHandler): Promise<void> {
    try {
      await handler(message);
      
      if (this.config.enableLogging) {
        console.log('[ChatService] Handled monitored message', { message });
      }
    } catch (error) {
      console.error('[ChatService] Error handling monitored message:', error, { message });
    }
  }
  
  /**
   * Check rate limiting for user
   */
  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const limit = this.rateLimits.get(userId);
    
    if (!limit || now > limit.resetTime) {
      // Reset or create new limit
      this.rateLimits.set(userId, {
        count: 1,
        resetTime: now + (60 * 1000) // 1 minute
      });
      return true;
    }
    
    if (limit.count >= (this.config.rateLimitPerMinute || 30)) {
      return false;
    }
    
    limit.count++;
    return true;
  }
  
  /**
   * Get room-specific channel name
   */
  private getRoomChannel(roomId: string): string {
    return `chat:room:${roomId}`;
  }
  
  /**
   * Generate direct message room ID
   */
  private getDirectMessageRoomId(user1: string, user2: string): string {
    const users = [user1, user2].sort();
    return `dm:${users[0]}:${users[1]}`;
  }
  
  /**
   * Generate a unique message ID
   */
  private generateMessageId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    const userId = this.config.userId || 'unknown';
    return `chat_${userId}_${timestamp}_${random}`;
  }
  
  /**
   * Get service status
   */
  getStatus(): {
    roomCount: number;
    rooms: string[];
    isMonitoring: boolean;
    rateLimitEntries: number;
  } {
    return {
      roomCount: this.roomSubscriptions.size,
      rooms: Array.from(this.roomSubscriptions),
      isMonitoring: this.handlers.has('*'),
      rateLimitEntries: this.rateLimits.size
    };
  }
  
  /**
   * Clean up service
   */
  async destroy(): Promise<void> {
    // Leave all rooms
    const rooms = Array.from(this.roomSubscriptions);
    for (const roomId of rooms) {
      await this.leaveRoom(roomId);
    }
    
    // Stop monitoring
    if (this.handlers.has('*')) {
      await this.stopMonitoring();
    }
    
    // Clear rate limits
    this.rateLimits.clear();
    this.handlers.clear();
  }
}