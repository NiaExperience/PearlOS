'use client';

/**
 * Conversation Client
 * 
 * Client-side handler for conversational HTML generation flow.
 * Integrates with Pipecat bot events and manages conversation state.
 */

import { ConversationContext, ModificationDetectionResult } from '../types/html-generation-types';

/**
 * Conversation Client Class
 */
export class ConversationClient {
  private sessionId: string;
  private apiBaseUrl: string = '/api/html-generation/conversation';
  private onStateChange?: (context: ConversationContext) => void;
  private nameTimeoutId?: NodeJS.Timeout;
  private suggestionTimeoutId?: NodeJS.Timeout;
  
  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }
  
  /**
   * Register state change callback
   */
  onConversationStateChange(callback: (context: ConversationContext) => void) {
    this.onStateChange = callback;
  }
  
  /**
   * Start new conversation flow
   */
  async startFlow(
    userRequest: string,
    currentAppletId?: string,
    assistantName?: string
  ): Promise<{
    success: boolean;
    flowState: string;
    aiResponse: {
      message: string;
      requiresNameInput?: boolean;
      requiresConfirmation?: boolean;
      requiresVersionSelection?: boolean;
      action?: string;
      timeout?: {
        duration: number;
        action: string;
      };
    };
    context?: ConversationContext;
  }> {
    try {
      const response = await fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          action: 'start',
          userRequest,
          currentAppletId,
          assistantName
        })
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const data = await response.json();
      
      // Notify state change
      if (this.onStateChange && data.context) {
        this.onStateChange(data.context);
      }
      
      // Handle timeout for name response
      if (data.aiResponse?.timeout && data.aiResponse?.requiresNameInput) {
        this.startNameResponseTimeout(
          data.aiResponse.timeout.duration,
          assistantName
        );
      }
      
      return data;
    } catch (error) {
      console.error('Error starting conversation flow:', error);
      throw error;
    }
  }
  
  /**
   * Provide name for applet
   */
  async provideName(
    name: string,
    assistantName?: string
  ): Promise<{
    success: boolean;
    flowState: string;
    aiResponse: {
      message: string;
      action?: string;
      showProgress?: boolean;
    };
  }> {
    try {
      // Clear any pending timeouts
      this.clearTimeouts();
      
      const response = await fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          action: 'provide_name',
          name,
          assistantName
        })
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const data = await response.json();
      
      // Notify state change
      if (this.onStateChange && data.context) {
        this.onStateChange(data.context);
      }
      
      return data;
    } catch (error) {
      console.error('Error providing name:', error);
      throw error;
    }
  }
  
  /**
   * Confirm or reject suggested name
   */
  async confirmSuggestion(
    confirmed: boolean,
    assistantName?: string
  ): Promise<any> {
    try {
      // Clear any pending timeouts
      this.clearTimeouts();
      
      const response = await fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          action: 'confirm_suggestion',
          confirmed,
          assistantName
        })
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const data = await response.json();
      
      // Notify state change
      if (this.onStateChange && data.context) {
        this.onStateChange(data.context);
      }
      
      return data;
    } catch (error) {
      console.error('Error confirming suggestion:', error);
      throw error;
    }
  }
  
  /**
   * Make version decision for modification
   */
  async makeVersionDecision(
    choice: 'original' | 'new_version',
    assistantName?: string
  ): Promise<any> {
    try {
      const response = await fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          action: 'version_decision',
          choice,
          assistantName
        })
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const data = await response.json();
      
      // Notify state change
      if (this.onStateChange && data.context) {
        this.onStateChange(data.context);
      }
      
      return data;
    } catch (error) {
      console.error('Error making version decision:', error);
      throw error;
    }
  }
  
  /**
   * Select specific version from search results
   */
  async selectVersion(
    versionId: string,
    assistantName?: string
  ): Promise<any> {
    try {
      const response = await fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          action: 'select_version',
          versionId,
          assistantName
        })
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const data = await response.json();
      
      // Notify state change
      if (this.onStateChange && data.context) {
        this.onStateChange(data.context);
      }
      
      return data;
    } catch (error) {
      console.error('Error selecting version:', error);
      throw error;
    }
  }
  
  /**
   * Get current conversation state
   */
  async getState(): Promise<ConversationContext | null> {
    try {
      const response = await fetch(`${this.apiBaseUrl}?sessionId=${this.sessionId}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`API returned ${response.status}`);
      }
      
      const data = await response.json();
      return data.context;
    } catch (error) {
      console.error('Error getting conversation state:', error);
      return null;
    }
  }
  
  /**
   * Start name response timeout (10 seconds)
   */
  private startNameResponseTimeout(duration: number, assistantName?: string) {
    this.nameTimeoutId = setTimeout(async () => {
      console.log('⏰ Name response timeout - showing suggestion');
      
      // Get current context to generate suggestion
      const context = await this.getState();
      if (context) {
        // The backend will handle generating the suggestion
        // We just need to trigger the suggestion phase
        this.startSuggestionTimeout(assistantName);
      }
    }, duration);
  }
  
  /**
   * Start suggestion confirmation timeout (5 seconds)
   */
  private startSuggestionTimeout(assistantName?: string) {
    this.suggestionTimeoutId = setTimeout(async () => {
      console.log('⏰ Suggestion timeout - auto-proceeding with suggested name');
      
      // Auto-confirm the suggestion
      await this.confirmSuggestion(true, assistantName);
    }, 5000);
  }
  
  /**
   * Clear all timeouts
   */
  private clearTimeouts() {
    if (this.nameTimeoutId) {
      clearTimeout(this.nameTimeoutId);
      this.nameTimeoutId = undefined;
    }
    
    if (this.suggestionTimeoutId) {
      clearTimeout(this.suggestionTimeoutId);
      this.suggestionTimeoutId = undefined;
    }
  }
  
  /**
   * Cleanup
   */
  destroy() {
    this.clearTimeouts();
    this.onStateChange = undefined;
  }
}

/**
 * Global conversation client instance manager
 */
const conversationClients = new Map<string, ConversationClient>();

/**
 * Get or create conversation client for session
 */
export function getConversationClient(sessionId: string): ConversationClient {
  let client = conversationClients.get(sessionId);
  
  if (!client) {
    client = new ConversationClient(sessionId);
    conversationClients.set(sessionId, client);
  }
  
  return client;
}

/**
 * Destroy conversation client
 */
export function destroyConversationClient(sessionId: string) {
  const client = conversationClients.get(sessionId);
  if (client) {
    client.destroy();
    conversationClients.delete(sessionId);
  }
}

