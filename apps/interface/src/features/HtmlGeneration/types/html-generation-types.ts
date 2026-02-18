/* eslint-disable @typescript-eslint/no-explicit-any */
export type HtmlContentType = 'game' | 'app' | 'tool' | 'interactive';

export interface HtmlContent {
  _id?: string;
  title: string;
  contentType: HtmlContentType;
  htmlContent: string;
  userRequest: string;
  isAiGenerated: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string; // User ID who created this
  tenantId: string;
  tags?: string[]; // For searchability
  // First-class cross-reference to Note record if HTML was created from a note
  sourceNoteId?: string;
  // Sharing metadata - populated when this HTML generation is shared via organization
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sharedVia?: any;
  metadata?: Record<string, unknown> & {
    // Cross-reference to Note record (also in top-level sourceNoteId for easier queries)
    sourceNoteId?: string;
    sourceNoteTitle?: string;
    // Additional metadata
    aiProvider?: string;
    aiModel?: string;
    usedFallback?: boolean;
    generatedAt?: string;
    hasApiIntegration?: boolean;
    assistantName?: string;
    opId?: string;
    diagnostics?: unknown[];
    generationError?: string;
  }; // Additional metadata
}

// Enhanced types for the new applet management system
export interface EnhancedHtmlContent extends HtmlContent {
  // User-controlled naming
  userProvidedName?: string;
  aiSuggestedName?: string;
  nameConfirmed: boolean;
  
  // Search optimization
  searchKeywords: string[];
  semanticTags: string[];
  
  // Modification tracking
  modificationHistory: ModificationRecord[];
  contextSize: number;
  requiresAppendix: boolean;
  
  // Usage analytics
  lastAccessed: Date;
  accessCount: number;
  modificationCount: number;
}

export interface ModificationRecord {
  id: string;
  timestamp: Date;
  userRequest: string;
  changesDescription: string;
  aiProvider: string;
  aiModel: string;
  contextMethod: 'direct' | 'appendix' | 'summary';
  priorHtmlContent: string;
  priorTitle: string;
}

export interface AppletSearchCapabilities {
  semanticSearch: boolean;        // "open my tic tac toe game"
  fuzzyMatching: boolean;         // "tictactoe", "tic-tac-toe", "TicTacToe"
  contentTypeFiltering: boolean;  // "last game I made"
  temporalSearch: boolean;        // "recent", "last", "yesterday"
  featureBasedSearch: boolean;    // "multiplayer game", "todo app"
}

export interface AppletSearchIndex {
  appletId: string;
  tenantId: string;
  userId: string;
  assistantName?: string;
  
  // Searchable fields
  exactName: string;
  normalizedName: string;
  contentType: string;
  features: string[];
  description: string;
  searchKeywords: string[];
  
  // Ranking factors
  createdDate: Date;
  lastModified: Date;
  accessFrequency: number;
  
  // Context metadata
  codeSize: number;
  complexity: 'simple' | 'medium' | 'complex';
  hasApiIntegration: boolean;
}

export interface HtmlGenerationRequest {
  title?: string;
  description: string;
  contentType: HtmlContentType;
  useOpenAI?: boolean; // Deprecated: prefer aiProvider/aiModel
  aiProvider?: 'openai' | 'anthropic' | 'gemini';
  aiModel?: string;
  additionalInstructions?: string;
}

export interface HtmlGenerationResponse {
  success: boolean;
  content?: HtmlContent;
  error?: string;
}

// Provider configuration for HTML generation
export interface GenerationProvider {
  name: 'openai' | 'anthropic' | 'gemini';
  displayName: string;
  description: string;
  speed: 'fast' | 'advanced';
  icon: string;
}

export const GENERATION_PROVIDERS: GenerationProvider[] = [
  {
    name: 'openai',
    displayName: 'OpenAI GPT',
    description: 'Fast and reliable HTML generation',
    speed: 'fast',
    icon: 'zap'
  },
  {
    name: 'anthropic',
    displayName: 'Claude',
    description: 'Advanced reasoning and complex applications',
    speed: 'advanced',
    icon: 'brain'
  },
  {
    name: 'gemini',
    displayName: 'Google Gemini',
    description: 'Multimodal AI with advanced capabilities',
    speed: 'advanced',
    icon: 'gem'
  }
];

// Additional request/response types for API routes
export interface CreateHtmlGenerationRequest extends HtmlGenerationRequest {
  features?: string[];
  userRequest: string;
  /** Optional assistant name to scope tenant/AI schema (added for route + tests alignment) */
  assistantName?: string;
  /** Include the storage library appendix (defaults to true) */
  includeStorageLibrary?: boolean;
  /** Optional library type for seeding from curated templates */
  library_type?: string;
  /** Optional explicit template selection when multiple templates exist */
  library_template_id?: string;
  // Enhanced naming fields
  userProvidedName?: string;
  requestNameSuggestion?: boolean;
  /** Optional note ID that this applet was created from */
  sourceNoteId?: string;
  /** Optional metadata for the applet */
  metadata?: Record<string, any>;
  /** Optional room URL for admin notifications */
  roomUrl?: string;
}

// New API request/response types for enhanced functionality
export interface SearchAppletsRequest {
  query: string;                    // Natural language search
  userId: string;
  assistantName?: string;
  contentType?: string;
  limit?: number;
  includeArchived?: boolean;
}

export interface SearchAppletsResponse {
  success: boolean;
  results: AppletSearchResult[];
  totalCount: number;
  searchMetadata: {
    queryProcessed: string;
    searchMethod: 'semantic' | 'fuzzy' | 'exact';
    filters: Record<string, any>;
    searchId?: string;
    query?: string;
    parsedQuery?: any;
    searchDurationMs?: number;
    versionRankingApplied?: boolean;
    smartSearchUsed?: boolean;
  };
  versionPrompt?: string;
  versionOptions?: Array<{
    title: string;
    version: string;
    id: string;
    createdAt: string;
    isLatest: boolean;
  }>;
}

export interface AppletSearchResult {
  applet: EnhancedHtmlContent;
  relevanceScore: number;
  matchReasons: string[];
  contextSize: number;
  requiresAppendix: boolean;
  isVersionMatch?: boolean;
  versionInfo?: {
    baseName: string;
    version: string;
    isLatest: boolean;
  };
}

export interface ModifyAppletRequest {
  appletId: string;
  modificationRequest: string;
  aiProvider?: string;
  aiModel?: string;
  assistantName?: string;
  roomUrl?: string;
  saveChoice?: 'new_version' | 'original';
  versioningPreference?: 'new_version' | 'modify_existing' | 'ask_user';
  sourceNoteId?: string;
  sourceNoteTitle?: string;
  metadata?: any;
}

export interface ModifyAppletResponse {
  success: boolean;
  data: EnhancedHtmlContent;
  contextMethod: 'direct' | 'appendix' | 'summary';
  changesDescription: string;
  modificationId: string;
  versioningResult?: {
    action: 'create_new_version' | 'modify_existing' | 'create_new_app' | 'awaiting_save_choice';
    suggestedName: string;
    baseAppName: string;
    versionNumber: string;
    similarApps: Array<{
      id: string;
      title: string;
      version: string;
      isLatest: boolean;
    }>;
  };
  userPrompt?: string;
  metadata?: any; // Additional metadata from versioning system
  jobId?: string;
}

export interface CreateAppletResponse {
  success: boolean;
  data: EnhancedHtmlContent;
  namingSuggestion?: string;
  requiresNameConfirmation?: boolean;
  namePrompt?: string;
  versionConflictPrompt?: string;
  versionConflictData?: {
    baseName: string;
    existingVersions: Array<{
      title: string;
      version: string;
      id: string;
      createdAt: string;
    }>;
    suggestedVersionName: string;
  };
  callId: string;
  /** Optional source note ID for cross-referencing */
  sourceNoteId?: string;
  /** Optional metadata including source note details */
  metadata?: Record<string, unknown>;
  jobId?: string;
  /** Library template selection prompt (if multiple templates exist) */
  libraryChoicePrompt?: string;
  /** Whether the user must choose a library template before generation */
  requiresLibraryChoice?: boolean;
  /** Available library template options when a choice is required */
  libraryOptions?: Array<{
    id: string;
    name: string;
    filename: string;
    description: string;
    libraryType: string;
    tags: string[];
  }>;
}

export interface GetHtmlGenerationRequest {
  id?: string;
  title?: string;
  contentType?: HtmlContentType;
  limit?: number;
}

export interface UpdateHtmlGenerationRequest {
  title?: string;
  description?: string;
  contentType?: HtmlContentType;
  features?: string[];
  userRequest?: string;
  htmlContent?: string;
}

export interface ListHtmlGenerationsFilter {
  title?: string;
  contentType?: HtmlContentType;
  limit?: number;
  offset?: number;
  userId: string;
  tenantId: string;
}

// ============================================================================
// Conversational Flow State Management Types
// ============================================================================

/**
 * Conversation flow state for managing multi-step name confirmation
 * and generation process
 */
export type ConversationFlowState = 
  | 'idle'
  | 'awaiting_initial_request'
  | 'requesting_name'
  | 'awaiting_name_response'
  | 'suggesting_name'
  | 'confirming_suggested_name'
  | 'generating'
  | 'generation_complete'
  | 'modification_detected'
  | 'awaiting_modification_confirmation'
  | 'awaiting_version_decision'
  | 'searching'
  | 'awaiting_version_selection'
  | 'error';

/**
 * Conversation context for tracking the entire flow
 */
export interface ConversationContext {
  flowState: ConversationFlowState;
  sessionId: string;
  userId: string;
  tenantId: string;
  assistantName?: string;
  
  // Request tracking
  originalRequest?: string;
  userIntent: 'create' | 'modify' | 'search' | 'open' | 'unknown';
  
  // Name confirmation tracking
  namingState?: {
    userProvidedName?: string;
    suggestedName?: string;
    confirmationAsked: boolean;
    confirmationReceived: boolean;
    timeoutStarted?: number;
    suggestionTimeout?: number;
    finalizedName?: string;
  };
  
  // Current applet context (for modifications)
  currentApplet?: {
    id: string;
    title: string;
    contentType: HtmlContentType;
    version?: string;
  };
  
  // Generation tracking
  generationState?: {
    callId: string;
    startTime: number;
    progress: number;
    phase: string;
    isComplete: boolean;
    result?: EnhancedHtmlContent;
  };
  
  // Modification tracking
  modificationState?: {
    modificationRequest: string;
    isModification: boolean;
    isMajorChange: boolean;
    versioningDecisionRequired: boolean;
    versioningOptions?: {
      nextMinorVersion: string;
      nextMajorVersion: string;
      recommendedChoice: 'original' | 'new_version';
    };
  };
  
  // Search tracking
  searchState?: {
    query: string;
    results?: AppletSearchResult[];
    multipleVersionsFound: boolean;
    latestVersion?: string;
    versionSelectionRequired: boolean;
  };
  
  // Timestamps
  createdAt: number;
  lastUpdatedAt: number;
  expiresAt: number;
}

/**
 * Conversation flow actions that can be taken
 */
export type ConversationAction = 
  | { type: 'START_FLOW'; request: string; intent: ConversationContext['userIntent'] }
  | { type: 'REQUEST_NAME'; suggestedName?: string }
  | { type: 'NAME_PROVIDED'; name: string }
  | { type: 'NAME_TIMEOUT' }
  | { type: 'SUGGEST_NAME'; name: string }
  | { type: 'CONFIRM_SUGGESTED_NAME'; confirmed: boolean }
  | { type: 'START_GENERATION'; request: CreateHtmlGenerationRequest }
  | { type: 'GENERATION_PROGRESS'; progress: number; phase: string }
  | { type: 'GENERATION_COMPLETE'; result: EnhancedHtmlContent }
  | { type: 'DETECT_MODIFICATION'; request: string; currentAppletId: string }
  | { type: 'CONFIRM_MODIFICATION'; confirmed: boolean }
  | { type: 'REQUEST_VERSION_DECISION'; options: { nextMinorVersion: string; nextMajorVersion: string; recommendedChoice: 'original' | 'new_version' } | undefined }
  | { type: 'VERSION_DECISION'; choice: 'original' | 'new_version' }
  | { type: 'START_SEARCH'; query: string }
  | { type: 'SEARCH_COMPLETE'; results: AppletSearchResult[] }
  | { type: 'VERSION_SELECTION_REQUIRED'; versions: any[] }
  | { type: 'SELECT_VERSION'; versionId: string }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' };

/**
 * Naming timeout configuration
 */
export interface NamingTimeoutConfig {
  // Time to wait for user to provide name (10 seconds)
  nameResponseTimeout: number;
  // Time to wait after showing suggestion (5 seconds before proceeding)
  suggestionTimeout: number;
  // Whether to auto-proceed with suggestion after timeout
  autoProceedWithSuggestion: boolean;
}

/**
 * Default timeout configuration
 */
export const DEFAULT_NAMING_TIMEOUT: NamingTimeoutConfig = {
  nameResponseTimeout: 10000, // 10 seconds
  suggestionTimeout: 5000, // 5 seconds
  autoProceedWithSuggestion: true
};

/**
 * Progress modal configuration
 */
export interface ProgressModalConfig {
  visible: boolean;
  title: string;
  progress: number; // 0-100
  phase: string;
  style: 'pixelated' | 'modern';
  position: 'top-right' | 'center' | 'top-center';
}

/**
 * Modification detection result
 */
export interface ModificationDetectionResult {
  isModification: boolean;
  confidence: number; // 0-1
  currentApplet?: {
    id: string;
    title: string;
    isLoaded: boolean;
  };
  detectionMethod: 'applet_loaded' | 'nlp' | 'both';
  matchReasons: string[];
}

/**
 * Version selection options
 */
export interface VersionSelectionOptions {
  baseName: string;
  versions: Array<{
    id: string;
    title: string;
    version: string;
    createdAt: string;
    isLatest: boolean;
  }>;
  recommendedAction: 'open_latest' | 'show_selection';
  userPrompt?: string;
}

export interface RollbackAppletResponse {
  success: boolean;
  data: EnhancedHtmlContent;
  restoredVersionId: string;
  stepsRolledBack: number;
  message: string;
}
