'use server';

import { getLogger } from '@interface/lib/logger';

import { ContentScrapingResult, VoiceNavigationCommand, ProxyRequest, ProxyResponse } from '../types/mini-browser-types';

const logger = getLogger('[mini_browser_actions]');

/**
 * Server action to scrape content from a URL
 */
export async function scrapeContentAction(url: string): Promise<ContentScrapingResult> {
  try {
    const response = await fetch('/api/mini-browser/scrape-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    if (!response.ok) {
      throw new Error(`Failed to scrape content: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    logger.error('Error scraping content', {
      error: error instanceof Error ? error.message : String(error),
      url,
    });
    throw new Error('Failed to scrape content from the provided URL');
  }
}

/**
 * Server action to execute voice navigation commands
 */
export async function executeVoiceCommandAction(command: VoiceNavigationCommand): Promise<boolean> {
  try {
    const response = await fetch('/api/mini-browser/voice-navigation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command })
    });

    if (!response.ok) {
      throw new Error(`Failed to execute voice command: ${response.statusText}`);
    }

    const result = await response.json();
    return result.success;
  } catch (error) {
    logger.error('Error executing voice command', {
      error: error instanceof Error ? error.message : String(error),
      command,
    });
    return false;
  }
}

/**
 * Server action to proxy a request through the enhanced proxy
 */
export async function proxyRequestAction(request: ProxyRequest): Promise<ProxyResponse> {
  try {
    const response = await fetch('/api/mini-browser/enhanced-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error(`Proxy request failed: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    logger.error('Error proxying request', {
      error: error instanceof Error ? error.message : String(error),
      request,
    });
    throw new Error('Failed to proxy the request');
  }
}

/**
 * Server action to normalize a URL or domain name
 */
export async function normalizeUrlAction(input: string): Promise<string> {
  try {
    const response = await fetch('/api/mini-browser/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: input })
    });

    if (!response.ok) {
      throw new Error(`Failed to normalize URL: ${response.statusText}`);
    }

    const result = await response.json();
    return result.url || input;
  } catch (error) {
    logger.error('Error normalizing URL', {
      error: error instanceof Error ? error.message : String(error),
      input,
    });
    return input; // Return original input as fallback
  }
}

/**
 * Server action to get browser history
 */
export async function getBrowserHistoryAction(): Promise<string[]> {
  try {
    // This would typically interact with a database or session storage
    // For now, return an empty array as placeholder
    return [];
  } catch (error) {
    logger.error('Error getting browser history', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Server action to clear browser history
 */
export async function clearBrowserHistoryAction(): Promise<boolean> {
  try {
    // This would typically clear from database or session storage
    // For now, return true as placeholder
    return true;
  } catch (error) {
    logger.error('Error clearing browser history', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
