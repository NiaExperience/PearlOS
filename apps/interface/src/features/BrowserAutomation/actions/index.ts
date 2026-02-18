/**
 * Browser Automation Actions
 * 
 * This module provides action creators for browser automation operations,
 * following the Notes pattern with proper error handling and type safety.
 */

import {
  BrowserSession,
  BrowserAction,
  NavigationResult,
  ActionResult,
  PageInfo,
  LinkClickResult,
  CreateSessionRequest,
  NavigateRequest,
  PerformActionRequest,
  FindLinkRequest,
  URLParseRequest,
  SystemCheckResult,
  BROWSER_AUTOMATION_CONSTANTS,
  BROWSER_AUTOMATION_ERRORS
} from '../definition';
import { getClientLogger } from '@interface/lib/client-logger';

// Base API URL for browser automation endpoints
const BROWSER_AUTOMATION_API_BASE = '/api';

const log = getClientLogger('BrowserAutomation');

/**
 * Create a new browser automation session
 */
export async function createBrowserSession(
  request: CreateSessionRequest
): Promise<NavigationResult> {
  try {
    log.info('Creating browser session', { sessionId: request.sessionId });
    
    const response = await fetch(`${BROWSER_AUTOMATION_API_BASE}/browser-control-simple`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'create_session',
        sessionId: request.sessionId,
        initialUrl: request.initialUrl,
        headless: request.headless
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || BROWSER_AUTOMATION_ERRORS.BROWSER_LAUNCH_FAILED);
    }

    log.info('Browser session created', { sessionId: request.sessionId });
    
    return {
      success: true,
      screenshot: result.screenshot,
      pageInfo: result.pageInfo
    };
  } catch (error) {
    log.error('Failed to create browser session', { sessionId: request.sessionId, error: error instanceof Error ? error.message : error });
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Navigate to a URL in an existing browser session
 */
export async function navigateToUrl(
  request: NavigateRequest
): Promise<NavigationResult> {
  try {
    log.info('Navigating to URL', { sessionId: request.sessionId, url: request.url });
    
    const response = await fetch(`${BROWSER_AUTOMATION_API_BASE}/browser-control-simple`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'navigate',
        sessionId: request.sessionId,
        url: request.url
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || BROWSER_AUTOMATION_ERRORS.NAVIGATION_FAILED);
    }

    log.info('Navigation successful', { sessionId: request.sessionId, url: request.url });
    
    return {
      success: true,
      screenshot: result.screenshot
    };
  } catch (error) {
    log.error('Navigation failed', { sessionId: request.sessionId, url: request.url, error: error instanceof Error ? error.message : error });
    
    return {
      success: false,
      error: error instanceof Error ? error.message : BROWSER_AUTOMATION_ERRORS.NAVIGATION_FAILED
    };
  }
}

/**
 * Perform an action (click, type, etc.) in the browser
 */
export async function performBrowserAction(
  request: PerformActionRequest
): Promise<ActionResult> {
  try {
    log.info('Performing browser action', { sessionId: request.sessionId, action: request.actionData.type });
    
    const response = await fetch(`${BROWSER_AUTOMATION_API_BASE}/browser-control-simple`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'perform_action',
        sessionId: request.sessionId,
        actionData: request.actionData
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || BROWSER_AUTOMATION_ERRORS.ACTION_FAILED);
    }

    log.info('Browser action completed', { sessionId: request.sessionId, action: request.actionData.type });
    
    return {
      success: true,
      screenshot: result.screenshot
    };
  } catch (error) {
    log.error('Browser action failed', { sessionId: request.sessionId, action: request.actionData.type, error: error instanceof Error ? error.message : error });
    
    return {
      success: false,
      error: error instanceof Error ? error.message : BROWSER_AUTOMATION_ERRORS.ACTION_FAILED
    };
  }
}

/**
 * Get comprehensive page information from the current browser session
 */
export async function getPageInfo(sessionId: string): Promise<PageInfo | null> {
  try {
    log.info('Getting page information', { sessionId });
    
    const response = await fetch(`${BROWSER_AUTOMATION_API_BASE}/browser-control-simple`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'get_page_info',
        sessionId: sessionId
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.success || !result.data) {
      log.warn('Could not retrieve page information', { sessionId });
      return null;
    }

    log.info('Page information retrieved', { sessionId });
    
    return result.data;
  } catch (error) {
    log.error('Failed to get page information', { sessionId, error: error instanceof Error ? error.message : error });
    return null;
  }
}

/**
 * Find and click a link based on description
 */
export async function findAndClickLink(
  request: FindLinkRequest
): Promise<LinkClickResult> {
  try {
    log.info('Finding and clicking link', { sessionId: request.sessionId, description: request.description });
    
    const response = await fetch(`${BROWSER_AUTOMATION_API_BASE}/browser-control-simple`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'find_and_click_link',
        sessionId: request.sessionId,
        description: request.description
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || BROWSER_AUTOMATION_ERRORS.LINK_NOT_FOUND);
    }

    log.info('Link clicked successfully', { sessionId: request.sessionId, description: request.description });
    
    return {
      success: true,
      clickedUrl: result.clickedUrl,
      clickedText: result.clickedText,
      screenshot: result.screenshot
    };
  } catch (error) {
    log.error('Failed to find and click link', { sessionId: request.sessionId, description: request.description, error: error instanceof Error ? error.message : error });
    
    return {
      success: false,
      error: error instanceof Error ? error.message : BROWSER_AUTOMATION_ERRORS.LINK_NOT_FOUND
    };
  }
}

/**
 * Parse natural language navigation input into a proper URL
 */
export async function parseNavigationInput(
  request: URLParseRequest
): Promise<{ success: boolean; parsedUrl?: string; error?: string }> {
  try {
    log.info('Parsing navigation input', { input: request.input });
    
    const response = await fetch(`${BROWSER_AUTOMATION_API_BASE}/browser-control-simple`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'parse_url',
        input: request.input
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to parse URL');
    }

    log.info('URL parsed successfully', { parsedUrl: result.parsedUrl });
    
    return {
      success: true,
      parsedUrl: result.parsedUrl
    };
  } catch (error) {
    log.error('Failed to parse navigation input', { input: request.input, error: error instanceof Error ? error.message : error });
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to parse URL'
    };
  }
}

/**
 * Close a browser automation session
 */
export async function closeBrowserSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
  try {
    log.info('Closing browser session', { sessionId });
    
    const response = await fetch(`${BROWSER_AUTOMATION_API_BASE}/browser-control-simple`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'close_session',
        sessionId: sessionId
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      log.warn('Failed to close browser session', { sessionId, error: result.error });
    } else {
      log.info('Browser session closed successfully', { sessionId });
    }

    return {
      success: result.success,
      error: result.error
    };
  } catch (error) {
    log.error('Error closing browser session', { sessionId, error: error instanceof Error ? error.message : error });
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Perform system check to verify browser automation capabilities
 */
export async function performSystemCheck(): Promise<SystemCheckResult> {
  try {
    log.info('Performing browser automation system check');
    
    const response = await fetch(`${BROWSER_AUTOMATION_API_BASE}/browser-control-simple`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'system_check',
        sessionId: 'system-check'
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    log.info('System check completed');
    
    return result;
  } catch (error) {
    log.error('System check failed', { error: error instanceof Error ? error.message : error });
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'System check failed',
      details: 'Could not connect to browser automation service'
    };
  }
}

/**
 * Check browser session status
 */
export async function checkSessionStatus(sessionId: string): Promise<{
  sessionActive: boolean;
  currentPage?: { title: string; url: string } | null;
}> {
  try {
    const response = await fetch(`${BROWSER_AUTOMATION_API_BASE}/browser-control?sessionId=${sessionId}`, {
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    return {
      sessionActive: result.sessionActive || false,
      currentPage: result.currentPage || null
    };
  } catch (error) {
    log.error('Failed to check session status', { sessionId, error: error instanceof Error ? error.message : error });
    
    return {
      sessionActive: false,
      currentPage: null
    };
  }
}

// Utility functions for common browser automation workflows

/**
 * Complete navigation workflow: parse URL and navigate
 */
export async function navigateWithParsing(
  sessionId: string,
  input: string
): Promise<NavigationResult> {
  try {
    // First parse the input
    const parseResult = await parseNavigationInput({ input });
    
    if (!parseResult.success || !parseResult.parsedUrl) {
      return {
        success: false,
        error: parseResult.error || 'Failed to parse navigation input'
      };
    }

    // Then navigate to the parsed URL
    return await navigateToUrl({
      sessionId,
      url: parseResult.parsedUrl
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Navigation workflow failed'
    };
  }
}

/**
 * Initialize browser session with immediate navigation
 */
export async function createSessionAndNavigate(
  sessionId: string,
  url: string,
  headless: boolean = true
): Promise<NavigationResult> {
  try {
    // Create session with initial URL
    const createResult = await createBrowserSession({
      sessionId,
      initialUrl: url,
      headless
    });

    if (!createResult.success) {
      return createResult;
    }

    log.info('Browser session created and navigated successfully', { sessionId, url });
    return createResult;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Session creation and navigation failed'
    };
  }
}
