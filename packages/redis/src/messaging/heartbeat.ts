/**
 * Heartbeat messaging service for Redis pub/sub
 * Handles process health monitoring and status updates
 */

import { RedisPublisher } from '../pubsub/publisher';
import { RedisSubscriber } from '../pubsub/subscriber';
import { ChannelNames } from '../types/channels';
import { HeartbeatMessage } from '../types/messages';
import { trackOperation } from '../utils/metrics';
import { validateHeartbeatMessage, sanitizeMessage } from '../utils/validation';

/**
 * Heartbeat message handler callback
 */
export type HeartbeatMessageHandler = (message: HeartbeatMessage) => Promise<void> | void;

/**
 * Heartbeat service configuration
 */
export interface HeartbeatServiceConfig {
  processId?: string;
  intervalMs?: number;
  enableLogging?: boolean;
  validateMessages?: boolean;
  timeoutMs?: number;
}

/**
 * Process status tracking
 */
interface ProcessStatus {
  processId: string;
  status: string;
  lastSeen: number;
  metadata?: Record<string, unknown>;
}

/**
 * Heartbeat messaging service
 */
export class HeartbeatMessagingService {
  private publisher: RedisPublisher;
  private subscriber: RedisSubscriber;
  private handlers = new Map<string, HeartbeatMessageHandler>();
  private isListening = false;
  private intervalHandle?: NodeJS.Timeout;
  private processStatuses = new Map<string, ProcessStatus>();
  
  constructor(
    publisher: RedisPublisher,
    subscriber: RedisSubscriber,
    private config: HeartbeatServiceConfig = {}
  ) {
    this.publisher = publisher;
    this.subscriber = subscriber;
  }
  
  /**
   * Send a heartbeat message
   */
  async sendHeartbeat(status: string, metadata?: Record<string, unknown>): Promise<void> {
    const processId = this.config.processId || this.generateProcessId();
    
    const message: HeartbeatMessage = {
      id: this.generateMessageId(),
      type: 'heartbeat',
      timestamp: new Date().toISOString(),
      processId,
      status,
      metadata
    };
    
    // Validate message if enabled
    if (this.config.validateMessages !== false) {
      const validation = validateHeartbeatMessage(message);
      if (!validation.valid) {
        throw new Error(`Invalid heartbeat message: ${validation.errors?.join(', ') || 'Unknown validation error'}`);
      }
    }
    
    // Sanitize message
    const sanitizedMessage = sanitizeMessage(message);
    
    await this.publisher.publish(ChannelNames.HEARTBEAT_STATUS, sanitizedMessage);
    
    if (this.config.enableLogging) {
      // eslint-disable-next-line no-console
      console.log(`[HeartbeatService] Sent heartbeat: ${processId} - ${status}`);
    }
  }
  
  /**
   * Start automatic heartbeat publishing
   */
  startHeartbeat(status = 'healthy', metadata?: Record<string, unknown>): void {
    if (this.intervalHandle) {
      this.stopHeartbeat();
    }
    
    const intervalMs = this.config.intervalMs || 30000; // 30 seconds default
    
    // Send initial heartbeat
    this.sendHeartbeat(status, metadata).catch(error => {
      // eslint-disable-next-line no-console
      console.error('[HeartbeatService] Error sending initial heartbeat:', error);
    });
    
    // Set up interval
    this.intervalHandle = setInterval(() => {
      this.sendHeartbeat(status, metadata).catch(error => {
        // eslint-disable-next-line no-console
        console.error('[HeartbeatService] Error sending heartbeat:', error);
      });
    }, intervalMs);
    
    if (this.config.enableLogging) {
      // eslint-disable-next-line no-console
      console.log(`[HeartbeatService] Started heartbeat with ${intervalMs}ms interval`);
    }
  }
  
  /**
   * Stop automatic heartbeat publishing
   */
  stopHeartbeat(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
      
      // Send final heartbeat
      this.sendHeartbeat('stopped').catch(error => {
        // eslint-disable-next-line no-console
        console.error('[HeartbeatService] Error sending stop heartbeat:', error);
      });
      
      if (this.config.enableLogging) {
        // eslint-disable-next-line no-console
        console.log('[HeartbeatService] Stopped heartbeat');
      }
    }
  }
  
  /**
   * Listen for heartbeat messages
   */
  async startListening(handler?: HeartbeatMessageHandler): Promise<void> {
    if (this.isListening) {
      return;
    }
    
    await this.subscriber.subscribe(ChannelNames.HEARTBEAT_STATUS, (message: HeartbeatMessage) => {
      this.handleHeartbeatMessage(message, handler);
    });
    
    this.isListening = true;
    
    // Start cleanup timer for stale processes
    this.startCleanupTimer();
    
    if (this.config.enableLogging) {
      // eslint-disable-next-line no-console
      console.log('[HeartbeatService] Started listening for heartbeats');
    }
  }
  
  /**
   * Stop listening for heartbeat messages
   */
  @trackOperation('heartbeat')
  async stopListening(): Promise<void> {
    if (!this.isListening) {
      return;
    }
    
    await this.subscriber.unsubscribe(ChannelNames.HEARTBEAT_STATUS);
    this.isListening = false;
    
    if (this.config.enableLogging) {
      // eslint-disable-next-line no-console
      console.log('[HeartbeatService] Stopped listening for heartbeats');
    }
  }
  
  /**
   * Register a handler for specific process
   */
  onProcessHeartbeat(processId: string, handler: HeartbeatMessageHandler): void {
    this.handlers.set(processId, handler);
    
    if (!this.isListening) {
      this.startListening();
    }
  }
  
  /**
   * Register a handler for all heartbeats
   */
  onAnyHeartbeat(handler: HeartbeatMessageHandler): void {
    this.handlers.set('*', handler);
    
    if (!this.isListening) {
      this.startListening();
    }
  }
  
  /**
   * Remove a process handler
   */
  removeHandler(processId: string): void {
    this.handlers.delete(processId);
  }
  
  /**
   * Get all active processes
   */
  getActiveProcesses(): ProcessStatus[] {
    return Array.from(this.processStatuses.values());
  }
  
  /**
   * Get process status
   */
  getProcessStatus(processId: string): ProcessStatus | null {
    return this.processStatuses.get(processId) || null;
  }
  
  /**
   * Check if process is healthy
   */
  isProcessHealthy(processId: string): boolean {
    const process = this.processStatuses.get(processId);
    if (!process) {
      return false;
    }
    
    const timeoutMs = this.config.timeoutMs || 60000; // 1 minute default
    const now = Date.now();
    
    return (now - process.lastSeen) < timeoutMs && process.status !== 'stopped';
  }
  
  /**
   * Handle incoming heartbeat message
   */
  private async handleHeartbeatMessage(message: HeartbeatMessage, defaultHandler?: HeartbeatMessageHandler): Promise<void> {
    try {
      // Validate message if enabled
      if (this.config.validateMessages !== false) {
        const validation = validateHeartbeatMessage(message);
        if (!validation.valid) {
          // eslint-disable-next-line no-console
          console.error('[HeartbeatService] Invalid heartbeat message:', validation.errors);
          return;
        }
      }
      
      // Update process status
      this.updateProcessStatus(message);
      
      // Call specific handler
      const handler = this.handlers.get(message.processId);
      if (handler) {
        await handler(message);
      }
      
      // Call wildcard handler
      const wildcardHandler = this.handlers.get('*');
      if (wildcardHandler && wildcardHandler !== handler) {
        await wildcardHandler(message);
      }
      
      // Call default handler if provided
      if (defaultHandler && defaultHandler !== handler && defaultHandler !== wildcardHandler) {
        await defaultHandler(message);
      }
      
      if (this.config.enableLogging) {
        // eslint-disable-next-line no-console
        console.log(`[HeartbeatService] Received heartbeat: ${message.processId} - ${message.status}`);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[HeartbeatService] Error handling heartbeat:', error, { message });
    }
  }
  
  /**
   * Update process status tracking
   */
  private updateProcessStatus(message: HeartbeatMessage): void {
    const status: ProcessStatus = {
      processId: message.processId,
      status: message.status,
      lastSeen: Date.now(),
      metadata: message.metadata
    };
    
    this.processStatuses.set(message.processId, status);
  }
  
  /**
   * Start cleanup timer for stale processes
   */
  private startCleanupTimer(): void {
    const cleanupInterval = (this.config.timeoutMs || 60000) * 2; // 2x timeout
    
    setInterval(() => {
      this.cleanupStaleProcesses();
    }, cleanupInterval);
  }
  
  /**
   * Remove stale processes from tracking
   */
  private cleanupStaleProcesses(): void {
    const timeoutMs = this.config.timeoutMs || 60000;
    const now = Date.now();
    
    for (const [processId, status] of this.processStatuses.entries()) {
      if (now - status.lastSeen > timeoutMs * 3) { // 3x timeout for cleanup
        this.processStatuses.delete(processId);
        
        if (this.config.enableLogging) {
          // eslint-disable-next-line no-console
          console.log(`[HeartbeatService] Cleaned up stale process: ${processId}`);
        }
      }
    }
  }
  
  /**
   * Generate process ID
   */
  private generateProcessId(): string {
    const hostname = process.env.HOSTNAME || 'unknown';
    const pid = process.pid;
    const timestamp = Date.now();
    return `${hostname}-${pid}-${timestamp}`;
  }
  
  /**
   * Generate a unique message ID
   */
  private generateMessageId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    const processId = this.config.processId || 'unknown';
    return `heartbeat_${processId}_${timestamp}_${random}`;
  }
  
  /**
   * Get service status
   */
  getStatus(): {
    isListening: boolean;
    isPublishing: boolean;
    processCount: number;
    healthyProcesses: number;
    handlerCount: number;
  } {
    const activeProcesses = this.getActiveProcesses();
    const healthyCount = activeProcesses.filter(p => this.isProcessHealthy(p.processId)).length;
    
    return {
      isListening: this.isListening,
      isPublishing: this.intervalHandle !== undefined,
      processCount: this.processStatuses.size,
      healthyProcesses: healthyCount,
      handlerCount: this.handlers.size
    };
  }
  
  /**
   * Clean up service
   */
  async destroy(): Promise<void> {
    this.stopHeartbeat();
    await this.stopListening();
    this.handlers.clear();
    this.processStatuses.clear();
  }
}