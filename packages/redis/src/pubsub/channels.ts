/**
 * Redis channel management and routing
 */

import { ChannelNames, ChannelPatterns, parseChannelName, validateChannelName } from '../config/channels';
import type { ChannelStats } from '../types/channels';

export class ChannelManager {
  private channelStats: Map<string, ChannelStats> = new Map();
  
  /**
   * Get admin channel for room
   */
  getAdminChannel(roomUrl: string): string {
    return ChannelNames.Admin.room(roomUrl);
  }

  /**
   * Get chat channel for room
   */
  getChatChannel(roomUrl: string): string {
    return ChannelNames.Chat.room(roomUrl);
  }

  /**
   * Get events channel for room
   */
  getEventsChannel(roomUrl: string): string {
    return ChannelNames.Events.room(roomUrl);
  }

  /**
   * Get all channels for a room
   */
  getRoomChannels(roomUrl: string): {
    admin: string;
    chat: string;
    events: string;
  } {
    return {
      admin: this.getAdminChannel(roomUrl),
      chat: this.getChatChannel(roomUrl),
      events: this.getEventsChannel(roomUrl)
    };
  }

  /**
   * Get global channels
   */
  getGlobalChannels(): {
    adminBroadcast: string;
    chatGlobal: string;
    botHeartbeat: string;
    systemEvents: string;
    healthCheck: string;
  } {
    return {
      adminBroadcast: ChannelNames.Admin.broadcast,
      chatGlobal: ChannelNames.Chat.global,
      botHeartbeat: ChannelNames.Heartbeat.global,
      systemEvents: ChannelNames.Events.system,
      healthCheck: ChannelNames.Monitoring.health
    };
  }

  /**
   * Validate channel name
   */
  validateChannel(channelName: string): { valid: boolean; error?: string } {
    return validateChannelName(channelName);
  }

  /**
   * Parse channel to extract information
   */
  parseChannel(channelName: string) {
    return parseChannelName(channelName);
  }

  /**
   * Get channel pattern for subscription
   */
  getChannelPattern(type: keyof typeof ChannelPatterns): string {
    return ChannelPatterns[type];
  }

  /**
   * Record channel statistics
   */
  recordChannelActivity(
    channel: string,
    type: 'message_sent' | 'message_received' | 'subscriber_added' | 'subscriber_removed' | 'error'
  ): void {
    let stats = this.channelStats.get(channel);
    
    if (!stats) {
      stats = {
        channel,
        messageCount: 0,
        subscriberCount: 0,
        errorCount: 0,
        subscribers: 0,
        messages_sent: 0,
        messages_received: 0,
        last_activity: Date.now(),
        error_count: 0
      };
      this.channelStats.set(channel, stats);
    }

    if (!stats) {
      return; // Safety check
    }

    stats.last_activity = Date.now();

    switch (type) {
      case 'message_sent':
        stats.messages_sent++;
        stats.messageCount = stats.messages_sent;
        break;
      case 'message_received':
        stats.messages_received++;
        stats.messageCount = stats.messages_received;
        break;
      case 'subscriber_added':
        stats.subscribers++;
        stats.subscriberCount = stats.subscribers;
        break;
      case 'subscriber_removed':
        stats.subscribers = Math.max(0, stats.subscribers - 1);
        stats.subscriberCount = stats.subscribers;
        break;
      case 'error':
        stats.error_count++;
        stats.errorCount = stats.error_count;
        break;
    }
  }

  /**
   * Get channel statistics
   */
  getChannelStats(channel?: string): ChannelStats | ChannelStats[] {
    if (channel) {
      const stats = this.channelStats.get(channel);
      if (stats) {
        return stats;
      }
      return {
        channel,
        messageCount: 0,
        subscriberCount: 0,
        errorCount: 0,
        subscribers: 0,
        messages_sent: 0,
        messages_received: 0,
        last_activity: 0,
        error_count: 0
      };
    }
    
    return Array.from(this.channelStats.values());
  }

  /**
   * Get active channels (with recent activity)
   */
  getActiveChannels(maxAgeMs = 300000): ChannelStats[] { // Default 5 minutes
    const now = Date.now();
    
    return Array.from(this.channelStats.values()).filter(
      stats => now - stats.last_activity < maxAgeMs
    );
  }

  /**
   * Get top channels by activity
   */
  getTopChannels(metric: 'messages_sent' | 'messages_received' | 'subscribers' = 'messages_sent', limit = 10): ChannelStats[] {
    return Array.from(this.channelStats.values())
      .sort((a, b) => b[metric] - a[metric])
      .slice(0, limit);
  }

  /**
   * Clean up old channel statistics
   */
  cleanupStats(maxAgeMs = 86400000): void { // Default 24 hours
    const now = Date.now();
    const toRemove: string[] = [];
    
    for (const [channel, stats] of this.channelStats.entries()) {
      if (now - stats.last_activity > maxAgeMs) {
        toRemove.push(channel);
      }
    }
    
    for (const channel of toRemove) {
      this.channelStats.delete(channel);
    }
    
    if (toRemove.length > 0) {
      console.log(`🧹 Cleaned up ${toRemove.length} old channel statistics`);
    }
  }

  /**
   * Get channel health summary
   */
  getHealthSummary(): {
    totalChannels: number;
    activeChannels: number;
    totalMessages: number;
    totalErrors: number;
    errorRate: number;
  } {
    const allStats = Array.from(this.channelStats.values());
    const activeStats = this.getActiveChannels();
    
    const totalMessages = allStats.reduce((sum, stats) => sum + stats.messages_sent + stats.messages_received, 0);
    const totalErrors = allStats.reduce((sum, stats) => sum + stats.error_count, 0);
    
    return {
      totalChannels: allStats.length,
      activeChannels: activeStats.length,
      totalMessages,
      totalErrors,
      errorRate: totalMessages > 0 ? (totalErrors / totalMessages) * 100 : 0
    };
  }

  /**
   * Reset all statistics
   */
  resetStats(): void {
    this.channelStats.clear();
    console.log('📊 Channel statistics reset');
  }
}