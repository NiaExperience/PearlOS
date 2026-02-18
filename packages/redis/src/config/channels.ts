/**
 * Redis channel naming conventions and utilities
 */

export const ChannelNames = {
  /**
   * Admin messaging channels
   */
  Admin: {
    /** Room-specific admin messages: admin_messages:{room_url} */
    room: (roomUrl: string): string => `admin_messages:${encodeRoomUrl(roomUrl)}`,
    /** Global admin broadcast */
    broadcast: 'admin_broadcast',
    /** Admin status updates */
    status: 'admin_status'
  },

  /**
   * Chat messaging channels
   */
  Chat: {
    /** Room-specific chat: chat:{room_url} */
    room: (roomUrl: string): string => `chat:${encodeRoomUrl(roomUrl)}`,
    /** Global chat announcements */
    global: 'chat_global',
    /** Chat moderation events */
    moderation: 'chat_moderation'
  },

  /**
   * Bot heartbeat channels
   */
  Heartbeat: {
    /** Global bot heartbeats */
    global: 'bot_heartbeat',
    /** Bot status changes */
    status: 'bot_status',
    /** Bot performance metrics */
    metrics: 'bot_metrics'
  },

  /**
   * Event messaging channels
   */
  Events: {
    /** Room-specific events: events:{room_url} */
    room: (roomUrl: string): string => `events:${encodeRoomUrl(roomUrl)}`,
    /** System-wide events */
    system: 'system_events',
    /** Application events */
    application: 'app_events'
  },

  /**
   * Monitoring and health channels
   */
  Monitoring: {
    /** Health check responses */
    health: 'health_check',
    /** Performance metrics */
    metrics: 'metrics',
    /** Error reporting */
    errors: 'error_reports'
  }
} as const;

/**
 * Channel patterns for wildcard subscriptions
 */
export const ChannelPatterns = {
  /** All admin channels */
  allAdmin: 'admin_*',
  /** All chat channels */
  allChat: 'chat:*',
  /** All room-specific channels */
  allRooms: '*:*',
  /** All heartbeat channels */
  allHeartbeat: 'bot_*',
  /** All event channels */
  allEvents: '*_events',
  /** All monitoring channels */
  allMonitoring: 'metrics,health_check,error_reports'
} as const;

/**
 * Room URL encoding for use in channel names
 */
function encodeRoomUrl(roomUrl: string): string {
  // Remove protocol and encode special characters
  return roomUrl
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .toLowerCase();
}

/**
 * Decode room URL from channel name
 */
export function decodeRoomUrl(channelName: string, channelPrefix: string): string {
  const encoded = channelName.replace(`${channelPrefix}:`, '');
  // This is a simple decode - in practice, you might need to store the mapping
  return `https://${encoded.replace(/_/g, '/')}`;
}

/**
 * Validate channel name format
 */
export function validateChannelName(channelName: string): { valid: boolean; error?: string } {
  if (!channelName || typeof channelName !== 'string') {
    return { valid: false, error: 'Channel name must be a non-empty string' };
  }
  
  if (channelName.length > 200) {
    return { valid: false, error: 'Channel name too long (max 200 characters)' };
  }
  
  // Redis channel names should be safe for use as keys
  if (!/^[a-zA-Z0-9._:-]+$/.test(channelName)) {
    return { valid: false, error: 'Channel name contains invalid characters' };
  }
  
  return { valid: true };
}

/**
 * Get all channel names for a room
 */
export function getRoomChannels(roomUrl: string): {
  admin: string;
  chat: string;
  events: string;
} {
  return {
    admin: ChannelNames.Admin.room(roomUrl),
    chat: ChannelNames.Chat.room(roomUrl),
    events: ChannelNames.Events.room(roomUrl)
  };
}

/**
 * Parse channel name to extract room URL and type
 */
export function parseChannelName(channelName: string): {
  type: 'admin' | 'chat' | 'events' | 'heartbeat' | 'monitoring' | 'unknown';
  roomUrl?: string;
  isGlobal: boolean;
} {
  // Admin channels
  if (channelName.startsWith('admin_messages:')) {
    return {
      type: 'admin',
      roomUrl: decodeRoomUrl(channelName, 'admin_messages'),
      isGlobal: false
    };
  }
  
  if (channelName.startsWith('admin_')) {
    return { type: 'admin', isGlobal: true };
  }
  
  // Chat channels
  if (channelName.startsWith('chat:')) {
    return {
      type: 'chat',
      roomUrl: decodeRoomUrl(channelName, 'chat'),
      isGlobal: false
    };
  }
  
  if (channelName.startsWith('chat_')) {
    return { type: 'chat', isGlobal: true };
  }
  
  // Event channels
  if (channelName.startsWith('events:')) {
    return {
      type: 'events',
      roomUrl: decodeRoomUrl(channelName, 'events'),
      isGlobal: false
    };
  }
  
  if (channelName.includes('_events')) {
    return { type: 'events', isGlobal: true };
  }
  
  // Heartbeat channels
  if (channelName.startsWith('bot_')) {
    return { type: 'heartbeat', isGlobal: true };
  }
  
  // Monitoring channels
  if (['health_check', 'metrics', 'error_reports'].includes(channelName)) {
    return { type: 'monitoring', isGlobal: true };
  }
  
  return { type: 'unknown', isGlobal: false };
}