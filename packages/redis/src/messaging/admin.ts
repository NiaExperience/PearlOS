/**
 * Admin messaging service for Redis pub/sub
 * Handles administrative communication between services
 */

import { RedisPublisher } from '../pubsub/publisher';
import { RedisSubscriber } from '../pubsub/subscriber';
import { ChannelNames } from '../types/channels';
import { AdminMessage } from '../types/messages';
import { trackOperation } from '../utils/metrics';
import { validateAdminMessage, sanitizeMessage } from '../utils/validation';

/**
 * Admin message handler callback
 */
export type AdminMessageHandler = (message: AdminMessage) => Promise<void> | void;

/**
 * Admin messaging service configuration
 */
export interface AdminServiceConfig {
  publisherId?: string;
  enableLogging?: boolean;
  validateMessages?: boolean;
}

/**
 * Admin messaging service
 */
export class AdminMessagingService {
  private publisher: RedisPublisher;
  private subscriber: RedisSubscriber;
  private handlers = new Map<string, AdminMessageHandler>();
  private isListening = false;
  
  constructor(
    publisher: RedisPublisher,
    subscriber: RedisSubscriber,
    private config: AdminServiceConfig = {}
  ) {
    this.publisher = publisher;
    this.subscriber = subscriber;
  }
  
  /**
   * Send an admin message
   */
  async sendMessage(message: Omit<AdminMessage, 'id' | 'timestamp'>): Promise<void> {
    const fullMessage: AdminMessage = {
      ...message,
      id: this.generateMessageId(),
      timestamp: new Date().toISOString(),
      type: 'admin'
    };
    
    // Validate message if enabled
    if (this.config.validateMessages !== false) {
      const validation = validateAdminMessage(fullMessage);
      if (!validation.valid) {
        throw new Error(`Invalid admin message: ${validation.errors?.join(', ') || 'Unknown validation error'}`);
      }
    }
    
    // Sanitize message
    const sanitizedMessage = sanitizeMessage(fullMessage);
    
    await this.publisher.publish(ChannelNames.ADMIN_MESSAGES, sanitizedMessage);
    
    if (this.config.enableLogging) {
      console.log(`[AdminService] Sent message: ${message.action}`, { message: sanitizedMessage });
    }
  }
  
  /**
   * Send a server control message
   */
  async sendServerControl(action: 'start' | 'stop' | 'restart', fromAdmin: string, data?: Record<string, unknown>): Promise<void> {
    await this.sendMessage({
      type: 'admin',
      action,
      fromAdmin,
      data: {
        target: 'server',
        ...data
      }
    });
  }
  
  /**
   * Send a room management message
   */
  async sendRoomManagement(action: 'create' | 'close' | 'moderate', roomId: string, fromAdmin: string, data?: Record<string, unknown>): Promise<void> {
    await this.sendMessage({
      type: 'admin',
      action: `room_${action}`,
      fromAdmin,
      data: {
        roomId,
        ...data
      }
    });
  }
  
  /**
   * Send a user management message
   */
  async sendUserManagement(action: 'kick' | 'ban' | 'mute' | 'promote', userId: string, fromAdmin: string, data?: Record<string, unknown>): Promise<void> {
    await this.sendMessage({
      type: 'admin',
      action: `user_${action}`,
      fromAdmin,
      data: {
        userId,
        ...data
      }
    });
  }
  
  /**
   * Register a message handler
   */
  onMessage(action: string, handler: AdminMessageHandler): void {
    this.handlers.set(action, handler);
    
    // Start listening if not already
    if (!this.isListening) {
      this.startListening();
    }
  }
  
  /**
   * Register a handler for all messages
   */
  onAnyMessage(handler: AdminMessageHandler): void {
    this.handlers.set('*', handler);
    
    if (!this.isListening) {
      this.startListening();
    }
  }
  
  /**
   * Remove a message handler
   */
  removeHandler(action: string): void {
    this.handlers.delete(action);
    
    // Stop listening if no handlers remain
    if (this.handlers.size === 0) {
      this.stopListening();
    }
  }
  
  /**
   * Start listening for admin messages
   */
  private async startListening(): Promise<void> {
    if (this.isListening) {
      return;
    }
    
    await this.subscriber.subscribe(ChannelNames.ADMIN_MESSAGES, (message: AdminMessage) => {
      this.handleMessage(message);
    });
    
    this.isListening = true;
    
    if (this.config.enableLogging) {
      console.log('[AdminService] Started listening for admin messages');
    }
  }
  
  /**
   * Stop listening for admin messages
   */
  private async stopListening(): Promise<void> {
    if (!this.isListening) {
      return;
    }
    
    await this.subscriber.unsubscribe(ChannelNames.ADMIN_MESSAGES);
    this.isListening = false;
    
    if (this.config.enableLogging) {
      console.log('[AdminService] Stopped listening for admin messages');
    }
  }
  
  /**
   * Handle incoming admin message
   */
  private async handleMessage(message: AdminMessage): Promise<void> {
    try {
      // Validate message if enabled
      if (this.config.validateMessages !== false) {
        const validation = validateAdminMessage(message);
        if (!validation.valid) {
          console.error('[AdminService] Received invalid message:', validation.errors);
          return;
        }
      }
      
      // Call specific handler
      const handler = this.handlers.get(message.action);
      if (handler) {
        await handler(message);
      }
      
      // Call wildcard handler
      const wildcardHandler = this.handlers.get('*');
      if (wildcardHandler && wildcardHandler !== handler) {
        await wildcardHandler(message);
      }
      
      if (this.config.enableLogging) {
        console.log(`[AdminService] Handled message: ${message.action}`, { message });
      }
    } catch (error) {
      console.error('[AdminService] Error handling message:', error, { message });
    }
  }
  
  /**
   * Generate a unique message ID
   */
  private generateMessageId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    const publisherId = this.config.publisherId || 'unknown';
    return `admin_${publisherId}_${timestamp}_${random}`;
  }
  
  /**
   * Get service status
   */
  getStatus(): {
    isListening: boolean;
    handlerCount: number;
    handlers: string[];
  } {
    return {
      isListening: this.isListening,
      handlerCount: this.handlers.size,
      handlers: Array.from(this.handlers.keys())
    };
  }
  
  /**
   * Clean up service
   */
  async destroy(): Promise<void> {
    await this.stopListening();
    this.handlers.clear();
  }
}