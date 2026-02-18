/**
 * HtmlGeneration Feature
 * Export server side bits only here, do not include client components
 * Client components like ModelSelectorModal and HtmlContentViewer are imported directly when needed
 */

export { HtmlGenerationDefinition, AppletStorageDefinition } from './definition';
export * from './types/html-generation-types';

// Export actions
export * from './actions/html-generation-actions';
export * from './actions/applet-storage-actions';

// Export lib functions for server-side use
export { generateWithOpenAI, generateWithAnthropic, generateWithGemini, stripCodeFences } from './lib/providers';

// Export enhanced applet management utilities (client-safe)
export { 
  analyzeNamingIntent, 
  validateAppletName,
  extractSearchKeywords,
  generateSemanticTags
} from './lib/naming-system';

export {
  parseSearchQuery,
  generateSearchSuggestions
} from './lib/applet-search';

export {
  estimateAppletComplexity
} from './lib/context-management';

// Enhanced actions (server-side only)
// Import directly: import { createEnhancedApplet } from '@interface/features/HtmlGeneration/actions/enhanced-applet-actions'

// Client-side components
export { HtmlContentViewer } from './components/HtmlContentViewer';
export { default as HtmlGenerationToggle } from './components/HtmlGenerationToggle';
export { AppletNameConfirmationModal } from './components/AppletNameConfirmationModal';
export { 
  PixelatedProgressModal, 
  usePixelatedProgress,
  GlobalProgressModalProvider,
  useGlobalProgress
} from './components/PixelatedProgressModal';

// Conversation flow management - ARCHIVED
// The complex frontend-driven conversation flow has been replaced with
// a simpler bot-native pattern. See SIMPLIFIED_BOT_NATIVE_PATTERN.md
// Old files archived in: archive/conversation-flow-system/
