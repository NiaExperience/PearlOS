'use client';

import { useDaily, useDailyEvent, useLocalSessionId } from '@daily-co/daily-react';
import { usePostHog } from 'posthog-js/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { getClientLogger } from '@interface/lib/client-logger';

interface ChatMessage {
  id: string;
  text: string;
  sender: string;
  senderName: string;
  timestamp: Date;
  isLocal: boolean;
}

interface ChatProps {
  isVisible: boolean;
  onClose: () => void;
  roomUrl?: string; // Optional room URL for better storage key generation
  onUnreadCountChange?: (count: number) => void; // Callback to notify parent of unread count changes
  isAdmin?: boolean; // Whether the current user is an admin
  stealth?: boolean; // Whether the call is in stealth mode (affects admin controls)
  tenantId?: string; // Tenant ID for admin access validation
}

// Storage key for chat messages
const CHAT_STORAGE_BASE_KEY = 'daily-chat-messages';
const MAX_STORED_MESSAGES = 100; // Limit stored messages to prevent localStorage bloat

// Content Filter Configuration
const CONTENT_FILTER_CONFIG = {
  enabled: true,
  replacementChar: '*',
  minWordLength: 3, // Only filter words longer than this
  caseSensitive: false,
  // Basic abusive words list - can be expanded or loaded from external source
  abusiveWords: [
    // Profanity and offensive language
    'fuck', 'shit', 'damn', 'bitch', 'asshole', 'bastard',
    'piss', 'crap', 'hell', 'damn', 'bloody',
    // Hate speech and discriminatory terms
    'retard', 'idiot', 'moron', 'stupid', 'dumb',
    // Additional words can be added here or loaded from external API
  ]
};

// Generate storage key based on session to keep messages separate per participant
// Chat history sync will handle sharing messages between participants via app-message
const getStorageKey = (roomUrl?: string, sessionId?: string | null) => {
  // Use session-based key to avoid localStorage conflicts between participants
  const sessionKey = sessionId ? sessionId.slice(-8) : 'default';
  
  // Optionally include room info for organization, but keep session-specific
  if (roomUrl) {
    try {
      const url = new URL(roomUrl);
      const roomName = url.pathname.split('/').pop() || url.hostname;
      return `${CHAT_STORAGE_BASE_KEY}-${roomName}-${sessionKey}`;
    } catch {
      // Fallback to simple room URL hash
      const roomHash = btoa(roomUrl).slice(-8);
      return `${CHAT_STORAGE_BASE_KEY}-${roomHash}-${sessionKey}`;
    }
  }
  
  return `${CHAT_STORAGE_BASE_KEY}-${sessionKey}`;
};

// Check if localStorage is available
const isLocalStorageAvailable = () => {
  try {
    const test = '__localStorage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
};

// Content filtering function
const filterAbusiveContent = (text: string): { filtered: string; wasFiltered: boolean } => {
  if (!CONTENT_FILTER_CONFIG.enabled) {
    return { filtered: text, wasFiltered: false };
  }

  let wasFiltered = false;

  // Normalize text for comparison (remove punctuation, convert to lowercase if case-insensitive)
  const normalizeWord = (word: string) => {
    return CONTENT_FILTER_CONFIG.caseSensitive 
      ? word.replace(/[^\w]/g, '')
      : word.replace(/[^\w]/g, '').toLowerCase();
  };

  // Split text into words while preserving spaces and punctuation
  const words = text.split(/(\s+|[^\w\s])/);
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const normalizedWord = normalizeWord(word);
    
    // Skip if word is too short
    if (normalizedWord.length < CONTENT_FILTER_CONFIG.minWordLength) {
      continue;
    }
    
    // Check if word contains any abusive content
    const isAbusive = CONTENT_FILTER_CONFIG.abusiveWords.some(abusiveWord => {
      const normalizedAbusive = CONTENT_FILTER_CONFIG.caseSensitive 
        ? abusiveWord 
        : abusiveWord.toLowerCase();
      
      return normalizedWord.includes(normalizedAbusive) || 
             normalizedAbusive.includes(normalizedWord);
    });
    
    if (isAbusive) {
      // Replace the word with asterisks
      words[i] = word.replace(/[a-zA-Z]/g, CONTENT_FILTER_CONFIG.replacementChar);
      wasFiltered = true;
    }
  }
  
  return { 
    filtered: words.join(''), 
    wasFiltered 
  };
};

// Generate consistent color for sender based on their session ID
const getSenderColor = (senderId: string, isLocal: boolean) => {
  if (isLocal) return '#3b82f6'; // Blue for local user
  
  // Generate consistent color from session ID
  const colors = [
    '#10b981', // Green
    '#f59e0b', // Orange
    '#8b5cf6', // Purple
    '#ef4444', // Red
    '#06b6d4', // Cyan
    '#84cc16', // Lime
    '#f97316', // Orange-600
    '#ec4899', // Pink
  ];
  
  // Use session ID to pick consistent color
  const hash = senderId.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  
  return colors[Math.abs(hash) % colors.length];
};

/**
 * Chat Component
 * Implements Daily.co chat functionality with message display and sending
 * Messages are persisted in localStorage
 */
const Chat: React.FC<ChatProps> = ({ 
  isVisible, 
  onClose, 
  roomUrl, 
  onUnreadCountChange,
  isAdmin = false,
  stealth = false,
  tenantId
}) => {
  const daily = useDaily();
  const posthog = usePostHog();
  const log = React.useMemo(() => getClientLogger('[daily_call]'), []);
  const localSessionId = useLocalSessionId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastFilteredMessage, setLastFilteredMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Admin messaging states - admin users default to bot mode, non-admin default to room
  const [messagingMode, setMessagingMode] = useState<'room' | 'bot'>(isAdmin ? 'bot' : 'room'); 
  const [adminMessageMode, setAdminMessageMode] = useState<'queued' | 'immediate'>('queued'); // Queued vs immediate delivery
  
  // Sync messaging mode with stealth state changes and admin status
  React.useEffect(() => {
    // Only force bot mode for admin users when in stealth mode
    // Normal admin users can use room mode, but stealth forces bot mode
    if (stealth && messagingMode !== 'bot') {
      setMessagingMode('bot');
    }
  }, [stealth, messagingMode]);
  


  // LocalStorage helper functions
  const loadMessagesFromStorage = useCallback((): ChatMessage[] => {
    if (!isLocalStorageAvailable()) {
      log.warn('chat localStorage unavailable; messages will not persist');
      return [];
    }
    
    try {
      const storageKey = getStorageKey(roomUrl, localSessionId);
      const stored = localStorage.getItem(storageKey);
      if (!stored) {
        return [];
      }
      
      const parsed = JSON.parse(stored);
      // Convert timestamp strings back to Date objects and recalculate isLocal
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages = parsed.map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp),
        isLocal: msg.sender === localSessionId // Recalculate based on current session
      }));
      
      return messages;
    } catch (error) {
      log.warn('failed to load chat messages from localStorage', { error });
      return [];
    }
  }, [localSessionId, log, roomUrl]);

  const saveMessagesToStorage = useCallback((messages: ChatMessage[]) => {
    if (!isLocalStorageAvailable()) {
      return; // Silently skip if localStorage is not available
    }
    
    try {
      // Keep only the most recent messages to prevent localStorage bloat
      const messagesToStore = messages.slice(-MAX_STORED_MESSAGES);
      const storageKey = getStorageKey(roomUrl, localSessionId);
      localStorage.setItem(storageKey, JSON.stringify(messagesToStore));
    } catch (error) {
      log.warn('failed to save chat messages to localStorage', { error });
    }
  }, [localSessionId, log, roomUrl]);

  // Show browser notification for new messages
  const showNotification = useCallback((message: ChatMessage) => {
    // Request permission if not already granted
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          try {
            const notification = new Notification(`New message from ${message.senderName}`, {
              body: message.text.length > 50 ? message.text.substring(0, 50) + '...' : message.text,
              icon: '/favicon.ico',
              tag: 'chat-message',
              requireInteraction: false
            });
            
            // Auto-close after 4 seconds
            setTimeout(() => {
              notification.close();
            }, 4000);
          } catch (error) {
            log.error('notification creation failed', { error });
          }
        }
      });
      return;
    }
    
    if (Notification.permission === 'granted') {
      try {
        const notification = new Notification(`New message from ${message.senderName}`, {
          body: message.text.length > 50 ? message.text.substring(0, 50) + '...' : message.text,
          icon: '/favicon.ico',
          tag: 'chat-message',
          requireInteraction: false
        });
        
        // Auto-close after 4 seconds
        setTimeout(() => {
          notification.close();
        }, 4000);
      } catch (error) {
        log.error('notification creation failed', { error });
      }
    }
  }, [log]);

  // Handle chat history request from another participant
  const handleHistoryRequest = useCallback(async (fromId: string) => {
    if (!daily || !messages.length) return;
    
    try {
      // Send our chat history to the requesting participant
      // Remove isLocal flag to avoid confusion - let receiver recalculate
      await daily.sendAppMessage({
        type: 'chat-history-response',
        messages: messages.map(msg => ({
          id: msg.id,
          text: msg.text,
          sender: msg.sender,
          senderName: msg.senderName,
          timestamp: msg.timestamp.toISOString() // Convert to string for transmission
          // Deliberately omit isLocal - let receiver calculate it
        }))
      }, fromId); // Send only to the requesting participant
      
    } catch (error) {
      log.error('error sending chat history', { error });
    }
  }, [daily, log, messages]);

  // Handle chat history response from another participant
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleHistoryResponse = useCallback((receivedMessages: any[]) => {
    if (!receivedMessages || !Array.isArray(receivedMessages)) return;
    
    try {
      const parsedMessages: ChatMessage[] = receivedMessages.map(msg => {
        // Apply content filter to historical messages
        const { filtered: filteredText } = filterAbusiveContent(msg.text);
        
        return {
          id: msg.id,
          text: filteredText,
          sender: msg.sender,
          senderName: msg.senderName,
          timestamp: new Date(msg.timestamp), // Convert back to Date object
          isLocal: msg.sender === localSessionId // Calculate based on current session
        };
      });
      
      setMessages(prev => {
        // Merge messages and remove duplicates
        const allMessages = [...prev, ...parsedMessages];
        const uniqueMessages = allMessages.filter((msg, index, self) => 
          index === self.findIndex(m => 
            m.text === msg.text && 
            m.sender === msg.sender && 
            Math.abs(new Date(m.timestamp).getTime() - new Date(msg.timestamp).getTime()) < 1000
          )
        );
        
        // Sort by timestamp
        const sortedMessages = uniqueMessages.sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        
        // Ensure all messages have correct isLocal calculation for current session
        const correctedMessages = sortedMessages.map(msg => ({
          ...msg,
          isLocal: msg.sender === localSessionId
        }));
        
        // Save merged messages to localStorage
        saveMessagesToStorage(correctedMessages);
        return correctedMessages;
      });
      
    } catch (error) {
      log.error('error processing chat history response', { error });
    }
  }, [localSessionId, log, saveMessagesToStorage]);

  // Request chat history when chat panel opens (if we have few/no messages)
  const requestChatHistory = useCallback(async () => {
    if (!daily || messages.length > 5) return; // Only request if we have few messages
    
    try {
      // Broadcast request for chat history
      await daily.sendAppMessage({
        type: 'chat-history-request',
        requesterId: localSessionId
      });
    } catch (error) {
      log.error('error requesting chat history', { error });
    }
  }, [daily, log, messages.length, localSessionId]);

  // Load messages from localStorage on component mount
  useEffect(() => {
    const storedMessages = loadMessagesFromStorage();
    if (storedMessages.length > 0) {
      setMessages(storedMessages);
    }
  }, [loadMessagesFromStorage]);

  // Auto-switch to bot mode when in stealth since room messaging is disabled
  useEffect(() => {
    if (stealth && messagingMode === 'room') {
      setMessagingMode('bot');
    }
  }, [stealth, messagingMode]);


  // Handle incoming app-messages
  useDailyEvent(
    'app-message',
    useCallback(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (event: any) => {
        const messageType = event?.data?.type;

        if (messageType === 'chat-message') {
          const senderName = event.data.senderName || 'Unknown';
          
          // SECURITY: Filter out stealth users from chat display  
          if (senderName.startsWith('stealth-user')) {
            return; // Don't display stealth user messages in regular chat
          }
          
          // Apply content filter to incoming messages as a safety net
          const { filtered: filteredText } = filterAbusiveContent(event.data.message);
          
          // If incoming message is abusive, we could either:
          // 1. Block it entirely (don't show it)
          // 2. Show filtered version
          // For now, we'll show the filtered version as a safety net
          
          const message: ChatMessage = {
            id: Date.now() + Math.random().toString(),
            text: filteredText,
            sender: event.fromId,
            senderName,
            timestamp: new Date(),
            isLocal: event.fromId === localSessionId,
          };
          
          setMessages(prev => {
            // Check for duplicate messages
            const isDuplicate = prev.some(msg => 
              msg.text === message.text && 
              msg.sender === message.sender && 
              Math.abs(new Date(msg.timestamp).getTime() - message.timestamp.getTime()) < 1000
            );
            
            if (isDuplicate) {
              return prev;
            }
            
            const updatedMessages = [...prev, message];
            
            // Handle notifications for messages from other participants
            if (!message.isLocal && !isVisible) {
              // Increment unread count
              setUnreadCount(prevCount => {
                const newCount = prevCount + 1;
                onUnreadCountChange?.(newCount);
                return newCount;
              });
              
              // Show browser notification if permission granted
              showNotification(message);
            }
            
            // Automatically save to localStorage when new messages are added
            saveMessagesToStorage(updatedMessages);
            return updatedMessages;
          });
        } else if (messageType === 'chat-history-request') {
          // Someone is requesting chat history - send our stored messages
          handleHistoryRequest(event.fromId);
        } else if (messageType === 'chat-history-response') {
          // Received chat history from another participant
          handleHistoryResponse(event.data.messages);
        }
      },
      [localSessionId, saveMessagesToStorage, handleHistoryRequest, handleHistoryResponse, isVisible, onUnreadCountChange, showNotification]
    )
  );

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Focus input when chat opens and request chat history
  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.focus();
    }
    
    // When chat opens, reset unread count
    if (isVisible) {
      setUnreadCount(0);
      onUnreadCountChange?.(0);
    }
    
    // Request chat history when chat opens (with small delay to ensure we're connected)
    if (isVisible && daily) {
      const timer = setTimeout(() => {
        requestChatHistory();
      }, 500); // Small delay to ensure connection is stable
      
      return () => clearTimeout(timer);
    }
  }, [isVisible, daily, requestChatHistory, onUnreadCountChange]);

  /**
   * Send a chat message (room chat or admin-to-bot message)
   */
  const sendMessage = useCallback(async () => {

    // STEALTH MODE SAFETY: Prevent room messages when user is in stealth mode
    if (stealth && messagingMode === 'room') {
      setMessagingMode('bot');
      setLastFilteredMessage('Room messages are disabled in stealth mode. Switched to bot messaging.');
      setTimeout(() => setLastFilteredMessage(null), 3000);
      return; // Block the message completely
    }
    
    if (!daily || !newMessage.trim()) {
      return;
    }

    const messageText = newMessage.trim();
    setNewMessage('');

    // Apply content filter
    const { filtered: filteredText, wasFiltered } = filterAbusiveContent(messageText);

    // If message contains abusive content, don't send it at all
    if (wasFiltered) {
      setLastFilteredMessage('Message blocked: Contains inappropriate content.');
      setTimeout(() => setLastFilteredMessage(null), 3000);
      return; // Exit early - don't send the message
    }

    // Use filtered text for sending (in case of partial filtering)
    const textToSend = filteredText;

    try {
      if (isAdmin && messagingMode === 'bot') {
        // ADMIN-TO-BOT: Always send admin messages via Redis /api/bot/admin (never Daily.co)

        // Get room URL - prioritize the roomUrl prop which contains the correct Daily.co URL
        const roomInfo = daily.room();
        // Handle both string (older daily-js) and object (newer daily-js) return types
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dailyUrl = typeof roomInfo === 'string' ? roomInfo : (roomInfo as any)?.url;
        const currentRoomUrl = roomUrl || dailyUrl || '';
        const localParticipant = daily?.participants?.()?.local as any;
        const localUserId = localParticipant?.user_id || localParticipant?.userId || localSessionId || '';
        const localUserName = localParticipant?.user_name || localParticipant?.userName || '';

        const adminApiResponse = await fetch('/api/bot/admin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-room-url': currentRoomUrl, // Pass room URL in header
            'x-session-id': localSessionId || '',
            'x-user-id': localUserId,
            'x-user-name': localUserName,
          },
          body: JSON.stringify({
            message: textToSend,
            mode: adminMessageMode, // 'queued' | 'immediate'
            tenantId: tenantId,
            sessionId: localSessionId || undefined,
            userId: localUserId,
            userName: localUserName,
          })
        });
        
        if (!adminApiResponse.ok) {
          const errorData = await adminApiResponse.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(`Admin API error ${adminApiResponse.status}: ${errorData.error || 'Unknown error'}`);
        }
        
        const result = await adminApiResponse.json();
        
        posthog?.capture('chat_message_sent', { mode: 'bot', adminMode: adminMessageMode, length: textToSend.length });

        
        // Show success message to user
        const modeText = result.mode === 'immediate' ? 'immediately' : 'and queued for processing';
        setLastFilteredMessage(`Admin message sent ${modeText}: "${textToSend.length > 50 ? textToSend.substring(0, 50) + '...' : textToSend}"`);
        setTimeout(() => setLastFilteredMessage(null), 5000);
        
      } else if (messagingMode === 'room') {
        // ROOM CHAT: Anyone (admin or regular user) can send room messages via Daily.co
        const messagePayload = {
          type: 'chat-message',
          message: textToSend, // Use filtered text
          senderName: daily.participants().local.user_name || 'You',
        };
        

        
        await daily.sendAppMessage(messagePayload);
        
        posthog?.capture('chat_message_sent', { mode: 'room', length: textToSend.length });

        
      } else {
        // BLOCKED: Invalid messaging combination (non-admin trying to use bot mode)
        log.warn('chat send blocked invalid combination', {
          isAdmin,
          messagingMode,
          reason: 'Non-admin users cannot send bot messages'
        });
        
        setLastFilteredMessage('Only admins can send messages to the bot. Use room mode for regular chat.');
        setTimeout(() => setLastFilteredMessage(null), 5000);
        return; // Don't send the message
      }

      // Add to local messages immediately (only for room chat, NOT for admin bot messages)
      if (messagingMode === 'room') {

        
        const message: ChatMessage = {
          id: Date.now().toString(),
          text: textToSend,
          sender: localSessionId || 'local',
          senderName: daily.participants().local.user_name || 'You',
          timestamp: new Date(),
          isLocal: true,
        };

        setMessages(prev => {
          const updatedMessages = [...prev, message];
          // Automatically save to localStorage when sending messages
          saveMessagesToStorage(updatedMessages);
          return updatedMessages;
        });
      }
      // NOTE: For bot messages (admin messagingMode === 'bot'), we DON'T add to local chat
      // The bot will respond via Redis, and those responses appear through the polling mechanism
      // This prevents double-display of admin messages
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      log.error('chat send error', {
        error,
        errorMessage,
        messagingMode,
        isAdmin,
        messageLength: messageText.length,
        roomUrl: roomUrl || 'unknown',
        participantCount: daily?.participants ? Object.keys(daily.participants()).length : 'unknown'
      });
      
      // Show appropriate error message based on context
      if (isAdmin && messagingMode === 'bot') {
        setLastFilteredMessage(`Failed to send admin message: ${errorMessage}`);
      } else {
        setLastFilteredMessage('Error sending message. Please try again.');
      }
      setTimeout(() => setLastFilteredMessage(null), 5000);
    }
  }, [adminMessageMode, daily, isAdmin, localSessionId, log, messagingMode, newMessage, roomUrl, saveMessagesToStorage, stealth, tenantId]);

  /**
   * Handle key press in input
   */
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  /**
   * Format timestamp for display
   */
  const formatTime = (timestamp: Date) => {
    return timestamp.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Handle backdrop click to close on mobile
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isVisible) return null;

  return (
    <div 
      className={`chat-overlay ${isVisible ? 'visible' : ''}`}
      onClick={handleBackdropClick}
    >
      <div className="chat-container">
        {/* Chat Header */}
        <div className="chat-header">
          <h3>💬 Chat</h3>
          <button className="chat-close-btn" onClick={onClose} title="Close chat">
            ✕
          </button>
        </div>

        {/* Messages Area */}
        <div className="chat-messages">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <p>No messages yet. Start the conversation! 👋</p>
            </div>
          ) : (
            messages.map(message => (
              <div
                key={message.id}
                className={`chat-message ${message.isLocal ? 'local' : 'remote'}`}
              >
                <div className="message-header">
                  <span 
                    className="message-sender"
                    style={{
                      color: getSenderColor(message.sender, message.isLocal),
                      fontWeight: message.isLocal ? '600' : '500'
                    }}
                  >
                    {message.senderName}
                  </span>
                  <span className="message-time">{formatTime(message.timestamp)}</span>
                </div>
                <div className="message-text">{message.text}</div>
              </div>
            ))
          )}
          
          {/* Show filtered message notification */}
          {lastFilteredMessage && (
            <div className="chat-filter-notification">
              <div className="filter-notification-content">
                <span className="filter-icon">⚠️</span>
                <span className="filter-message">{lastFilteredMessage}</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Admin Controls */}
        {isAdmin && (
          <div className="admin-controls">
            <div className="admin-mode-selector">
              <div className="admin-radio-group">
                <span className="admin-group-label">Destination:</span>
                <div className="radio-options">
                  <label className={`radio-option ${stealth ? 'disabled' : ''}`} title={stealth ? 'Room messaging disabled in stealth mode' : ''}>
                    <input
                      type="radio"
                      name="destination"
                      value="room"
                      checked={messagingMode === 'room'}
                      onChange={e => setMessagingMode(e.target.value as 'room' | 'bot')}
                      disabled={stealth}  // Room disabled in stealth mode
                      className="radio-input"
                    />
                    <span className="radio-label">
                      💬 Room
                      {stealth && <span className="disabled-indicator"> (disabled in stealth)</span>}
                    </span>
                  </label>
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="destination"
                      value="bot"
                      checked={messagingMode === 'bot'}
                      onChange={e => setMessagingMode(e.target.value as 'room' | 'bot')}
                      className="radio-input"
                    />
                    <span className="radio-label">🤖 Bot</span>
                  </label>
                </div>
              </div>
              
              <div className="admin-radio-group">
                <span className="admin-group-label">Mode:</span>
                <div className="radio-options">
                  <label className={`radio-option ${messagingMode === 'room' ? 'disabled' : ''}`}>
                    <input
                      type="radio"
                      name="mode"
                      value="queued"
                      checked={adminMessageMode === 'queued'}
                      onChange={e => setAdminMessageMode(e.target.value as 'queued' | 'immediate')}
                      disabled={messagingMode === 'room'}  // Mode disabled if destination is room
                      className="radio-input"
                    />
                    <span className="radio-label">⏱️ Queued</span>
                  </label>
                  <label className={`radio-option ${messagingMode === 'room' ? 'disabled' : ''}`}>
                    <input
                      type="radio"
                      name="mode"
                      value="immediate"
                      checked={adminMessageMode === 'immediate'}
                      onChange={e => setAdminMessageMode(e.target.value as 'queued' | 'immediate')}
                      disabled={messagingMode === 'room'}  // Mode disabled if destination is room
                      className="radio-input"
                    />
                    <span className="radio-label">⚡ Immediate</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Message Input */}
        <div className="chat-input-area">
          <div className="chat-input-container">
            <input
              ref={inputRef}
              type="text"
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={
                isAdmin && messagingMode === 'bot' 
                  ? "Send command to bot..." 
                  : "Type a message..."
              }
              className="chat-input"
              maxLength={500}
            />
            <button
              onClick={sendMessage}
              disabled={!newMessage.trim()}
              className={`chat-send-btn ${isAdmin && messagingMode === 'bot' ? 'admin-mode' : ''}`}
              title={
                isAdmin && messagingMode === 'bot' 
                  ? "Send command to bot" 
                  : "Send message"
              }
            >
              {isAdmin && messagingMode === 'bot' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  <path d="M2 17l10 5 10-5"/>
                  <path d="M2 12l10 5 10-5"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22,2 15,22 11,13 2,9"></polygon>
                </svg>
              )}
            </button>
          </div>
          <div className="chat-input-hint">
            {isAdmin && messagingMode === 'bot' 
              ? `Admin mode: Send ${adminMessageMode} command to bot • Press Enter to send`
              : "Press Enter to send, Shift+Enter for new line"
            }
          </div>
        </div>
      </div>
    </div>
  );
};

export default Chat;
