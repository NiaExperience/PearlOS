/**
 * Event messaging service for Redis pub/sub
 * Handles system events and notifications
 */

import { RedisPublisher } from '../pubsub/publisher';
import { RedisSubscriber } from '../pubsub/subscriber';
import { ChannelNames } from '../types/channels';
import { EventMessage } from '../types/messages';
import { trackOperation } from '../utils/metrics';
import { validateEventMessage, sanitizeMessage } from '../utils/validation';

/**
 * Event message handler callback
 */
export type EventMessageHandler = (message: EventMessage) => Promise<void> | void;

/**
 * Event service configuration
 */
export interface EventServiceConfig {
  publisherId?: string;
  enableLogging?: boolean;
  validateMessages?: boolean;
  eventFilters?: string[];
}

/**
 * Event messaging service
 */
export class EventMessagingService {
  private publisher: RedisPublisher;
  private subscriber: RedisSubscriber;
  private handlers = new Map<string, EventMessageHandler>();
  private isListening = false;
  
  constructor(
    publisher: RedisPublisher,
    subscriber: RedisSubscriber,
    private config: EventServiceConfig = {}
  ) {
    this.publisher = publisher;
    this.subscriber = subscriber;
  }
  
  /**
   * Publish a system event
   */
  async publishEvent(event: Omit<EventMessage, 'id' | 'timestamp'>): Promise<void> {
    const fullMessage: EventMessage = {
      ...event,
      id: this.generateMessageId(),
      timestamp: new Date().toISOString(),
      type: 'event'
    };
    
    // Validate message if enabled
    if (this.config.validateMessages !== false) {
      const validation = validateEventMessage(fullMessage);
      if (!validation.valid) {
        throw new Error(`Invalid event message: ${validation.errors?.join(', ') || 'Unknown validation error'}`);
      }
    }
    
    // Sanitize message
    const sanitizedMessage = sanitizeMessage(fullMessage);
    
    await this.publisher.publish(ChannelNames.EVENTS_SYSTEM, sanitizedMessage);
    
    if (this.config.enableLogging) {
      // eslint-disable-next-line no-console
      console.log(`[EventService] Published event: ${event.eventType}`, { event: sanitizedMessage });
    }
  }
  
  /**
   * Publish user-related events
   */
  async publishUserEvent(eventType: string, userId: string, data?: Record<string, unknown>): Promise<void> {
    await this.publishEvent({
      type: 'event',
      eventType: `user.${eventType}`,
      data: {
        userId,
        ...data
      }
    });
  }
  
  /**
   * Publish room-related events
   */
  async publishRoomEvent(eventType: string, roomId: string, data?: Record<string, unknown>): Promise<void> {
    await this.publishEvent({
      type: 'event',
      eventType: `room.${eventType}`,
      data: {
        roomId,
        ...data
      }
    });
  }
  
  /**
   * Publish system events
   */
  async publishSystemEvent(eventType: string, data?: Record<string, unknown>): Promise<void> {
    await this.publishEvent({
      type: 'event',
      eventType: `system.${eventType}`,
      data
    });
  }
  
  /**
   * Publish error events
   */
  async publishErrorEvent(error: Error, context?: Record<string, unknown>): Promise<void> {
    await this.publishEvent({
      type: 'event',
      eventType: 'system.error',
      data: {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        },
        context
      }
    });
  }
  
  /**
   * Listen for all events
   */
  async startListening(handler?: EventMessageHandler): Promise<void> {
    if (this.isListening) {
      return;
    }
    
    await this.subscriber.subscribe(ChannelNames.EVENTS_SYSTEM, (message: EventMessage) => {
      this.handleEventMessage(message, handler);
    });
    
    this.isListening = true;
    
    if (this.config.enableLogging) {
      // eslint-disable-next-line no-console
      console.log('[EventService] Started listening for events');
    }
  }
  
  /**
   * Stop listening for events
   */
  @trackOperation('events')
  async stopListening(): Promise<void> {
    if (!this.isListening) {
      return;
    }
    
    await this.subscriber.unsubscribe(ChannelNames.EVENTS_SYSTEM);
    this.isListening = false;
    
    if (this.config.enableLogging) {
      // eslint-disable-next-line no-console
      console.log('[EventService] Stopped listening for events');
    }
  }
  
  /**
   * Register handler for specific event type
   */
  onEvent(eventType: string, handler: EventMessageHandler): void {
    this.handlers.set(eventType, handler);
    
    if (!this.isListening) {
      this.startListening();
    }
  }
  
  /**
   * Register handler for user events
   */
  onUserEvent(handler: EventMessageHandler): void {
    this.handlers.set('user.*', handler);
    
    if (!this.isListening) {
      this.startListening();
    }
  }
  
  /**
   * Register handler for room events
   */
  onRoomEvent(handler: EventMessageHandler): void {
    this.handlers.set('room.*', handler);
    
    if (!this.isListening) {
      this.startListening();
    }
  }
  
  /**
   * Register handler for system events
   */
  onSystemEvent(handler: EventMessageHandler): void {
    this.handlers.set('system.*', handler);
    
    if (!this.isListening) {
      this.startListening();
    }
  }
  
  /**
   * Register handler for error events
   */
  onErrorEvent(handler: EventMessageHandler): void {
    this.handlers.set('system.error', handler);
    
    if (!this.isListening) {
      this.startListening();
    }
  }
  
  /**
   * Register handler for all events
   */
  onAnyEvent(handler: EventMessageHandler): void {
    this.handlers.set('*', handler);
    
    if (!this.isListening) {
      this.startListening();
    }
  }
  
  /**
   * Remove event handler
   */
  removeHandler(eventType: string): void {
    this.handlers.delete(eventType);
    
    if (this.handlers.size === 0) {
      this.stopListening();
    }
  }
  
  /**
   * Handle incoming event message
   */
  private async handleEventMessage(message: EventMessage, defaultHandler?: EventMessageHandler): Promise<void> {
    try {
      // Validate message if enabled
      if (this.config.validateMessages !== false) {
        const validation = validateEventMessage(message);
        if (!validation.valid) {
          // eslint-disable-next-line no-console
          console.error('[EventService] Invalid event message:', validation.errors);
          return;
        }
      }
      
      // Check event filters
      if (this.config.eventFilters && this.config.eventFilters.length > 0) {
        const matches = this.config.eventFilters.some(filter => {
          return message.eventType.includes(filter) || this.matchesPattern(message.eventType, filter);
        });
        
        if (!matches) {
          return; // Skip filtered events
        }
      }
      
      // Find matching handlers
      const matchingHandlers = new Set<EventMessageHandler>();
      
      // Exact match
      const exactHandler = this.handlers.get(message.eventType);
      if (exactHandler) {
        matchingHandlers.add(exactHandler);
      }
      
      // Pattern matches
      for (const [pattern, handler] of this.handlers.entries()) {
        if (pattern !== message.eventType && this.matchesPattern(message.eventType, pattern)) {
          matchingHandlers.add(handler);
        }
      }
      
      // Wildcard handler
      const wildcardHandler = this.handlers.get('*');
      if (wildcardHandler) {
        matchingHandlers.add(wildcardHandler);
      }
      
      // Default handler
      if (defaultHandler) {
        matchingHandlers.add(defaultHandler);
      }
      
      // Call all matching handlers
      for (const handler of matchingHandlers) {
        await handler(message);
      }
      
      if (this.config.enableLogging && matchingHandlers.size > 0) {
        // eslint-disable-next-line no-console
        console.log(`[EventService] Handled event: ${message.eventType} (${matchingHandlers.size} handlers)`);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[EventService] Error handling event:', error, { message });
    }
  }
  
  /**
   * Check if event type matches pattern
   */
  private matchesPattern(eventType: string, pattern: string): boolean {
    if (pattern === '*') {
      return true;
    }
    
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return eventType.startsWith(prefix);
    }
    
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      return eventType.endsWith(suffix);
    }
    
    return eventType === pattern;
  }
  
  /**
   * Generate a unique message ID
   */
  private generateMessageId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    const publisherId = this.config.publisherId || 'unknown';
    return `event_${publisherId}_${timestamp}_${random}`;
  }
  
  /**
   * Get service status
   */
  getStatus(): {
    isListening: boolean;
    handlerCount: number;
    handlers: string[];
    filters: string[];
  } {
    return {
      isListening: this.isListening,
      handlerCount: this.handlers.size,
      handlers: Array.from(this.handlers.keys()),
      filters: this.config.eventFilters || []
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