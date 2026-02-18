/**
 * MiniBrowser Feature
 * Export server side bits only here, do not include client components
 */

// Types
export type {
  MiniBrowserConfig,
  EnhancedBrowserConfig,
  ContentScrapingResult,
  VoiceNavigationCommand,
  BrowserNavigationEvent,
  ProxyRequest,
  ProxyResponse,
  QuickSite,
  BrowserState,
  MiniBrowserProps,
  EnhancedMiniBrowserProps
} from './types/mini-browser-types';

// Actions
export {
  scrapeContentAction,
  executeVoiceCommandAction,
  proxyRequestAction,
  normalizeUrlAction,
  getBrowserHistoryAction,
  clearBrowserHistoryAction
} from './actions/mini-browser-actions';

// Lib utilities
export { resolveQuickSite, QUICK_SITES } from './lib/quick-sites';

// NOTE: Client-side components (MiniBrowserView, EnhancedMiniBrowserView) and hooks
// (useMiniBrowser, useContentScraping, useVoiceNavigation) should be imported directly
// from their paths to avoid server/client bundling issues.
