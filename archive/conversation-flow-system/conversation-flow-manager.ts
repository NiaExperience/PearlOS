/**
 * Conversation Flow Manager
 * 
 * Manages the complete conversational flow for HTML applet creation,
 * modification, and search operations through voice/chat interface.
 * 
 * Key Features:
 * - Multi-step name confirmation with timeouts
 * - Automatic modification detection
 * - Smart versioning decisions
 * - Search with version handling
 * - State persistence across requests
 */

import { 
  ConversationContext, 
  ConversationAction, 
  ConversationFlowState,
  DEFAULT_NAMING_TIMEOUT,
  ModificationDetectionResult,
  HtmlContentType
} from '../types/html-generation-types';
import { generateGenericName } from './naming-system';

/**
 * Conversation Flow Manager Class
 */
export class ConversationFlowManager {
  private contexts: Map<string, ConversationContext> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
  
  /**
   * Create or get existing conversation context
   */
  getOrCreateContext(
    sessionId: string, 
    userId: string, 
    tenantId: string,
    assistantName?: string
  ): ConversationContext {
    let context = this.contexts.get(sessionId);
    
    if (!context) {
      context = {
        flowState: 'idle',
        sessionId,
        userId,
        tenantId,
        assistantName,
        userIntent: 'unknown',
        createdAt: Date.now(),
        lastUpdatedAt: Date.now(),
        expiresAt: Date.now() + (30 * 60 * 1000) // 30 minutes
      };
      
      this.contexts.set(sessionId, context);
      
      // Auto-cleanup after expiration
      setTimeout(() => {
        this.cleanup(sessionId);
      }, 30 * 60 * 1000);
    }
    
    return context;
  }
  
  /**
   * Update conversation context with action
   */
  dispatch(sessionId: string, action: ConversationAction): ConversationContext {
    const context = this.contexts.get(sessionId);
    if (!context) {
      throw new Error(`No context found for session ${sessionId}`);
    }
    
    const updatedContext = this.reducer(context, action);
    updatedContext.lastUpdatedAt = Date.now();
    
    this.contexts.set(sessionId, updatedContext);
    return updatedContext;
  }
  
  /**
   * State reducer for conversation flow
   */
  private reducer(
    context: ConversationContext, 
    action: ConversationAction
  ): ConversationContext {
    console.log(`🔄 ConversationFlow: ${context.flowState} + ${action.type}`);
    
    switch (action.type) {
      case 'START_FLOW':
        return {
          ...context,
          flowState: 'requesting_name',
          originalRequest: action.request,
          userIntent: action.intent
        };
        
      case 'REQUEST_NAME':
        this.startNameTimeout(context.sessionId);
        return {
          ...context,
          flowState: 'awaiting_name_response',
          namingState: {
            suggestedName: action.suggestedName,
            confirmationAsked: true,
            confirmationReceived: false,
            timeoutStarted: Date.now()
          }
        };
        
      case 'NAME_PROVIDED':
        this.clearNameTimeout(context.sessionId);
        return {
          ...context,
          flowState: 'generating',
          namingState: {
            userProvidedName: action.name,
            suggestedName: context.namingState?.suggestedName,
            confirmationAsked: true,
            confirmationReceived: true,
            timeoutStarted: context.namingState?.timeoutStarted,
            suggestionTimeout: context.namingState?.suggestionTimeout,
            finalizedName: action.name
          }
        };
        
      case 'NAME_TIMEOUT':
        // After 10 seconds of no response, suggest a name
        const suggestedName = this.generateSuggestedName(context);
        this.startSuggestionTimeout(context.sessionId);
        return {
          ...context,
          flowState: 'suggesting_name',
          namingState: {
            userProvidedName: context.namingState?.userProvidedName,
            suggestedName,
            confirmationAsked: true,
            confirmationReceived: false,
            timeoutStarted: context.namingState?.timeoutStarted,
            suggestionTimeout: Date.now(),
            finalizedName: context.namingState?.finalizedName
          }
        };
        
      case 'SUGGEST_NAME':
        return {
          ...context,
          flowState: 'confirming_suggested_name',
          namingState: {
            userProvidedName: context.namingState?.userProvidedName,
            suggestedName: action.name,
            confirmationAsked: true,
            confirmationReceived: false,
            timeoutStarted: context.namingState?.timeoutStarted,
            suggestionTimeout: context.namingState?.suggestionTimeout,
            finalizedName: context.namingState?.finalizedName
          }
        };
        
      case 'CONFIRM_SUGGESTED_NAME':
        this.clearNameTimeout(context.sessionId);
        if (action.confirmed) {
          return {
            ...context,
            flowState: 'generating',
            namingState: {
              userProvidedName: context.namingState?.userProvidedName,
              suggestedName: context.namingState?.suggestedName,
              confirmationAsked: true,
              confirmationReceived: true,
              timeoutStarted: context.namingState?.timeoutStarted,
              suggestionTimeout: context.namingState?.suggestionTimeout,
              finalizedName: context.namingState?.suggestedName
            }
          };
        } else {
          // User said no, ask again
          return {
            ...context,
            flowState: 'requesting_name',
            namingState: {
              userProvidedName: context.namingState?.userProvidedName,
              suggestedName: context.namingState?.suggestedName,
              confirmationAsked: false,
              confirmationReceived: false,
              timeoutStarted: context.namingState?.timeoutStarted,
              suggestionTimeout: context.namingState?.suggestionTimeout,
              finalizedName: context.namingState?.finalizedName
            }
          };
        }
        
      case 'START_GENERATION':
        return {
          ...context,
          flowState: 'generating',
          generationState: {
            callId: action.request.title || 'unknown',
            startTime: Date.now(),
            progress: 0,
            phase: 'Starting generation...',
            isComplete: false
          }
        };
        
      case 'GENERATION_PROGRESS':
        return {
          ...context,
          generationState: context.generationState ? {
            ...context.generationState,
            progress: action.progress,
            phase: action.phase
          } : undefined
        };
        
      case 'GENERATION_COMPLETE':
        return {
          ...context,
          flowState: 'generation_complete',
          generationState: context.generationState ? {
            ...context.generationState,
            progress: 100,
            phase: 'Complete!',
            isComplete: true,
            result: action.result
          } : undefined
        };
        
      case 'DETECT_MODIFICATION':
        return {
          ...context,
          flowState: 'modification_detected',
          userIntent: 'modify',
          originalRequest: action.request,
          currentApplet: {
            id: action.currentAppletId,
            title: '',
            contentType: 'app'
          },
          modificationState: {
            modificationRequest: action.request,
            isModification: true,
            isMajorChange: false,
            versioningDecisionRequired: false
          }
        };
        
      case 'CONFIRM_MODIFICATION':
        if (action.confirmed) {
          return {
            ...context,
            flowState: 'generating'
          };
        } else {
          // User said it's not a modification, treat as new creation
          return {
            ...context,
            flowState: 'requesting_name',
            userIntent: 'create',
            modificationState: undefined
          };
        }
        
      case 'REQUEST_VERSION_DECISION':
        return {
          ...context,
          flowState: 'awaiting_version_decision',
          modificationState: context.modificationState ? {
            ...context.modificationState,
            versioningDecisionRequired: true,
            versioningOptions: action.options
          } : undefined
        };
        
      case 'VERSION_DECISION':
        return {
          ...context,
          flowState: 'generating',
          modificationState: context.modificationState ? {
            ...context.modificationState,
            versioningDecisionRequired: false
          } : undefined
        };
        
      case 'START_SEARCH':
        return {
          ...context,
          flowState: 'searching',
          userIntent: 'search',
          searchState: {
            query: action.query,
            multipleVersionsFound: false,
            versionSelectionRequired: false
          }
        };
        
      case 'SEARCH_COMPLETE':
        const hasMultipleVersions = this.checkMultipleVersions(action.results);
        return {
          ...context,
          flowState: hasMultipleVersions ? 'awaiting_version_selection' : 'generation_complete',
          searchState: context.searchState ? {
            ...context.searchState,
            results: action.results,
            multipleVersionsFound: hasMultipleVersions,
            versionSelectionRequired: hasMultipleVersions
          } : undefined
        };
        
      case 'VERSION_SELECTION_REQUIRED':
        return {
          ...context,
          flowState: 'awaiting_version_selection'
        };
        
      case 'SELECT_VERSION':
        return {
          ...context,
          flowState: 'generation_complete'
        };
        
      case 'ERROR':
        return {
          ...context,
          flowState: 'error'
        };
        
      case 'RESET':
        this.clearNameTimeout(context.sessionId);
        return {
          ...context,
          flowState: 'idle',
          userIntent: 'unknown',
          namingState: undefined,
          generationState: undefined,
          modificationState: undefined,
          searchState: undefined
        };
        
      default:
        return context;
    }
  }
  
  /**
   * Start name response timeout (10 seconds)
   */
  private startNameTimeout(sessionId: string) {
    this.clearNameTimeout(sessionId);
    
    const timeout = setTimeout(() => {
      const context = this.contexts.get(sessionId);
      if (context && context.flowState === 'awaiting_name_response') {
        this.dispatch(sessionId, { type: 'NAME_TIMEOUT' });
      }
    }, DEFAULT_NAMING_TIMEOUT.nameResponseTimeout);
    
    this.timeouts.set(`${sessionId}_name`, timeout);
  }
  
  /**
   * Start suggestion timeout (5 seconds after showing suggestion)
   */
  private startSuggestionTimeout(sessionId: string) {
    const timeout = setTimeout(() => {
      const context = this.contexts.get(sessionId);
      if (context && 
          (context.flowState === 'suggesting_name' || 
           context.flowState === 'confirming_suggested_name')) {
        // Auto-proceed with suggested name
        if (DEFAULT_NAMING_TIMEOUT.autoProceedWithSuggestion) {
          this.dispatch(sessionId, { 
            type: 'CONFIRM_SUGGESTED_NAME', 
            confirmed: true 
          });
        }
      }
    }, DEFAULT_NAMING_TIMEOUT.suggestionTimeout);
    
    this.timeouts.set(`${sessionId}_suggestion`, timeout);
  }
  
  /**
   * Clear name-related timeouts
   */
  private clearNameTimeout(sessionId: string) {
    const nameTimeout = this.timeouts.get(`${sessionId}_name`);
    const suggestionTimeout = this.timeouts.get(`${sessionId}_suggestion`);
    
    if (nameTimeout) {
      clearTimeout(nameTimeout);
      this.timeouts.delete(`${sessionId}_name`);
    }
    
    if (suggestionTimeout) {
      clearTimeout(suggestionTimeout);
      this.timeouts.delete(`${sessionId}_suggestion`);
    }
  }
  
  /**
   * Generate suggested name based on context
   */
  private generateSuggestedName(context: ConversationContext): string {
    const request = context.originalRequest || '';
    const contentType: HtmlContentType = 'app'; // Default, could be extracted from request
    
    return generateGenericName(request, contentType);
  }
  
  /**
   * Check if search results contain multiple versions of same app
   */
  private checkMultipleVersions(results: any[]): boolean {
    const baseNames = new Set<string>();
    let duplicateFound = false;
    
    for (const result of results) {
      const title = result.applet?.title || '';
      // Extract base name (remove version)
      const baseName = title.replace(/\s+v\d+(\.\d+)?$/i, '').toLowerCase();
      
      if (baseNames.has(baseName)) {
        duplicateFound = true;
        break;
      }
      baseNames.add(baseName);
    }
    
    return duplicateFound;
  }
  
  /**
   * Get current flow state
   */
  getFlowState(sessionId: string): ConversationFlowState | null {
    const context = this.contexts.get(sessionId);
    return context?.flowState || null;
  }
  
  /**
   * Check if name is finalized
   */
  isNameFinalized(sessionId: string): boolean {
    const context = this.contexts.get(sessionId);
    return !!context?.namingState?.finalizedName;
  }
  
  /**
   * Get finalized name
   */
  getFinalizedName(sessionId: string): string | null {
    const context = this.contexts.get(sessionId);
    return context?.namingState?.finalizedName || null;
  }
  
  /**
   * Cleanup expired contexts
   */
  cleanup(sessionId: string) {
    this.clearNameTimeout(sessionId);
    this.contexts.delete(sessionId);
    console.log(`🧹 Cleaned up conversation context: ${sessionId}`);
  }
  
  /**
   * Get context for inspection
   */
  getContext(sessionId: string): ConversationContext | null {
    return this.contexts.get(sessionId) || null;
  }
}

/**
 * Global singleton instance
 */
let globalFlowManager: ConversationFlowManager | null = null;

/**
 * Get or create global flow manager instance
 */
export function getConversationFlowManager(): ConversationFlowManager {
  if (!globalFlowManager) {
    globalFlowManager = new ConversationFlowManager();
  }
  return globalFlowManager;
}

/**
 * Detect if user request is a modification intent
 */
export function detectModificationIntent(
  userRequest: string,
  currentAppletId?: string
): ModificationDetectionResult {
  const request = userRequest.toLowerCase();
  
  // NLP-based modification keywords
  const modificationKeywords = [
    'change', 'modify', 'update', 'edit', 'fix', 'adjust',
    'make it', 'can you', 'please', 'add', 'remove', 'delete',
    'improve', 'enhance', 'refactor', 'rewrite', 'redo',
    'alter', 'revise', 'tweak', 'polish'
  ];
  
  // Theme/style modification keywords
  const themeKeywords = [
    'theme', 'color', 'style', 'design', 'look', 'appearance',
    'dark mode', 'light mode', 'accent', 'background', 'foreground'
  ];
  
  const matchReasons: string[] = [];
  let isModification = false;
  let confidence = 0;
  let detectionMethod: 'applet_loaded' | 'nlp' | 'both' = 'nlp';
  
  // Check if applet is currently loaded
  if (currentAppletId) {
    isModification = true;
    confidence += 0.5;
    matchReasons.push('Applet is currently loaded');
    detectionMethod = 'applet_loaded';
  }
  
  // Check for modification keywords
  for (const keyword of modificationKeywords) {
    if (request.includes(keyword)) {
      isModification = true;
      confidence += 0.2;
      matchReasons.push(`Keyword match: "${keyword}"`);
      
      if (currentAppletId) {
        detectionMethod = 'both';
      }
      break;
    }
  }
  
  // Check for theme keywords (common in modifications)
  for (const keyword of themeKeywords) {
    if (request.includes(keyword)) {
      isModification = true;
      confidence += 0.15;
      matchReasons.push(`Theme keyword match: "${keyword}"`);
      
      if (currentAppletId) {
        detectionMethod = 'both';
      }
      break;
    }
  }
  
  // Cap confidence at 1.0
  confidence = Math.min(confidence, 1.0);
  
  return {
    isModification,
    confidence,
    currentApplet: currentAppletId ? {
      id: currentAppletId,
      title: '',
      isLoaded: true
    } : undefined,
    detectionMethod,
    matchReasons
  };
}

/**
 * Analyze user intent from request
 */
export function analyzeUserIntent(userRequest: string): ConversationContext['userIntent'] {
  const request = userRequest.toLowerCase();
  
  // Search/open intent
  if (request.includes('open') || request.includes('load') || 
      request.includes('show me') || request.includes('find')) {
    return 'search';
  }
  
  // Modification intent
  if (request.includes('change') || request.includes('modify') || 
      request.includes('update') || request.includes('fix')) {
    return 'modify';
  }
  
  // Creation intent (default)
  if (request.includes('create') || request.includes('make') || 
      request.includes('build') || request.includes('generate')) {
    return 'create';
  }
  
  return 'unknown';
}

