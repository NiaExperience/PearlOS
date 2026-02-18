/**
 * Simple Browser Control API Route
 * 
 * Simplified browser automation API with intelligent URL parsing.
 * Migrated from Fix-RiveAvatar branch to new features-first architecture.
 */

import { NextRequest, NextResponse } from 'next/server';

import { browserAutomationService } from '@interface/features/BrowserAutomation/services';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('BrowserAutomation');

// Intelligent URL parsing for natural language navigation requests
function parseNavigationInput(input: string): string {
  const trimmedInput = input.trim().toLowerCase();
  
  // Common site mappings for natural language requests
  const siteMap: Record<string, string> = {
    // News sites
    'cnn': 'cnn.com',
    'bbc': 'bbc.com',
    'fox news': 'foxnews.com',
    'reuters': 'reuters.com',
    'ap news': 'apnews.com',
    'npr': 'npr.org',
    'cbs': 'cbsnews.com',
    'nbc': 'nbcnews.com',
    'abc': 'abcnews.go.com',
    
    // Search engines
    'google': 'google.com',
    'bing': 'bing.com',
    'yahoo': 'yahoo.com',
    'duckduckgo': 'duckduckgo.com',
    
    // Social media
    'facebook': 'facebook.com',
    'twitter': 'twitter.com',
    'instagram': 'instagram.com',
    'linkedin': 'linkedin.com',
    'youtube': 'youtube.com',
    'tiktok': 'tiktok.com',
    'reddit': 'reddit.com',
    
    // Tech sites
    'github': 'github.com',
    'stack overflow': 'stackoverflow.com',
    'hacker news': 'news.ycombinator.com',
    'techcrunch': 'techcrunch.com',
    'verge': 'theverge.com',
    'wired': 'wired.com',
    
    // Shopping
    'amazon': 'amazon.com',
    'ebay': 'ebay.com',
    'walmart': 'walmart.com',
    'target': 'target.com',
    'etsy': 'etsy.com',
    
    // Reference
    'wikipedia': 'wikipedia.org',
    'dictionary': 'dictionary.com',
    'imdb': 'imdb.com',
    
    // Entertainment
    'netflix': 'netflix.com',
    'hulu': 'hulu.com',
    'spotify': 'spotify.com',
    'twitch': 'twitch.tv',
    
    // Finance
    'bloomberg': 'bloomberg.com',
    'cnbc': 'cnbc.com',
    'marketwatch': 'marketwatch.com',
    'yahoo finance': 'finance.yahoo.com',
    
    // Other popular sites
    'craigslist': 'craigslist.org',
    'zillow': 'zillow.com',
    'weather': 'weather.com',
    'gmail': 'gmail.com',
    'outlook': 'outlook.com'
  };
  
  // Check for direct site name matches
  for (const [siteName, siteUrl] of Object.entries(siteMap)) {
    if (trimmedInput === siteName || 
        trimmedInput.includes(`go to ${siteName}`) ||
        trimmedInput.includes(`load ${siteName}`) ||
        trimmedInput.includes(`open ${siteName}`) ||
        trimmedInput.includes(`show me ${siteName}`) ||
        trimmedInput.includes(`navigate to ${siteName}`) ||
        trimmedInput.includes(`visit ${siteName}`)) {
      return `https://${siteUrl}`;
    }
  }
  
  // Check for partial matches in phrases like "load up cnn" or "show me the news on bbc"
  for (const [siteName, siteUrl] of Object.entries(siteMap)) {
    if (trimmedInput.includes(siteName)) {
      return `https://${siteUrl}`;
    }
  }
  
  // Handle direct domain inputs (e.g., "cnn.com", "example.org")
  if (trimmedInput.includes('.') && !trimmedInput.includes(' ')) {
    return `https://${trimmedInput}`;
  }
  
  // Handle URL-like inputs without protocol
  if (trimmedInput.match(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)) {
    return `https://${trimmedInput}`;
  }
  
  // If none of the above, treat as a Google search
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

export async function POST_impl(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, sessionId, ...params } = body;

    log.info('Simple browser control API called', { action, sessionId });

    // Validate required parameters
    if (!action || !sessionId) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Action and sessionId are required'
        },
        { status: 400 }
      );
    }

    let result;

    switch (action) {
      case 'create_session':
        log.info('Creating browser session', { sessionId });
        log.debug('Initial URL from params', { sessionId, initialUrl: params.initialUrl });
        
        try {
          // Use the improved browser automation service
          const session = await browserAutomationService.initializeBrowserSession(sessionId);
          
          // Use the provided initial URL or default to Google
          const initialUrl = params.initialUrl || 'https://www.google.com';
          log.info('Using initial URL', { sessionId, initialUrl });
          
          // Test navigation to get initial screenshot
          const navigationResult = await browserAutomationService.navigateToUrl(sessionId, initialUrl);
          log.debug('Navigation result', { sessionId, success: navigationResult?.success });
          
          result = { 
            success: true, 
            sessionId: session.sessionId,
            message: 'Browser session created successfully',
            screenshot: navigationResult.screenshot,
            pageInfo: {
              title: 'Browser',
              url: initialUrl
            }
          };
          
        } catch (automationError) {
          log.error('Browser automation error', { sessionId, error: automationError instanceof Error ? automationError.message : automationError });
          
          const errorMessage = automationError instanceof Error ? automationError.message : 'Unknown automation error';
          
          result = {
            success: false,
            error: 'Failed to create browser session',
            details: errorMessage,
            troubleshooting: 'Check system dependencies and browser installation'
          };
        }
        break;

      case 'navigate':
        if (!params.url) {
          return NextResponse.json(
            { success: false, error: 'URL is required for navigation' },
            { status: 400 }
          );
        }
        result = await browserAutomationService.navigateToUrl(sessionId, params.url);
        break;

      case 'perform_action':
        if (!params.actionData) {
          return NextResponse.json(
            { success: false, error: 'Action data is required' },
            { status: 400 }
          );
        }
        result = await browserAutomationService.performAction(sessionId, params.actionData);
        break;

      case 'get_page_info': {
          const pageInfo = await browserAutomationService.getPageInfo(sessionId);
          result = { 
            success: !!pageInfo, 
            data: pageInfo,
            error: pageInfo ? undefined : 'Could not retrieve page information'
          };
        }
        break;

      case 'close_session': {
          const closed = await browserAutomationService.closeBrowserSession(sessionId);
          result = { 
            success: closed,
            message: closed ? 'Browser session closed' : 'Failed to close session'
          };
        }
        break;

      case 'parse_url':
        if (!params.input) {
          return NextResponse.json(
            { success: false, error: 'Input is required for URL parsing' },
            { status: 400 }
          );
        }
        
        try {
          // Use the same parsing logic as the frontend
          const parsedUrl = parseNavigationInput(params.input);
          result = {
            success: true,
            originalInput: params.input,
            parsedUrl: parsedUrl,
            message: `Parsed "${params.input}" to ${parsedUrl}`
          };
        } catch (error) {
          result = {
            success: false,
            error: 'Failed to parse navigation input',
            details: error instanceof Error ? error.message : 'Unknown error'
          };
        }
        break;

      case 'find_and_click_link':
        if (!params.description) {
          return NextResponse.json(
            { success: false, error: 'Description is required for link finding' },
            { status: 400 }
          );
        }
        
        try {
          log.info('Finding and clicking link', { sessionId, description: params.description });
          result = await browserAutomationService.findAndClickLink(sessionId, params.description);
        } catch (error) {
          result = {
            success: false,
            error: 'Failed to find and click link',
            details: error instanceof Error ? error.message : 'Unknown error'
          };
        }
        break;

      case 'system_check':
        try {
          const puppeteer = await import('puppeteer');
          const fs = await import('fs');
          
          let executablePath;
          let browserExists = false;
          
          try {
            executablePath = puppeteer.default.executablePath();
            browserExists = fs.existsSync(executablePath);
          } catch (execError) {
            executablePath = 'Not found - ' + (execError instanceof Error ? execError.message : execError);
          }
          
          // Test actual browser launch
          let launchTest = 'Not tested';
          try {
            const testSession = await browserAutomationService.initializeBrowserSession(`test-${Date.now()}`);
            await browserAutomationService.closeBrowserSession(testSession.sessionId);
            launchTest = 'Success';
          } catch (launchError) {
            launchTest = 'Failed - ' + (launchError instanceof Error ? launchError.message : launchError);
          }
          
          result = {
            success: true,
            system: {
              platform: process.platform,
              arch: process.arch,
              nodeVersion: process.version,
              executablePath,
              browserExists,
              launchTest,
              env: {
                PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
                PUPPETEER_CACHE_DIR: process.env.PUPPETEER_CACHE_DIR,
                PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD,
                DISPLAY: process.env.DISPLAY
              }
            }
          };
        } catch (error) {
          result = {
            success: false,
            error: 'System check failed',
            details: error instanceof Error ? error.message : 'Unknown error'
          };
        }
        break;

      default:
        return NextResponse.json(
          { 
            success: false, 
            error: `Unknown action: ${action}. Available actions: create_session, navigate, perform_action, get_page_info, close_session, parse_url, find_and_click_link, system_check`
          },
          { status: 400 }
        );
    }

    return NextResponse.json(result);

  } catch (error) {
    log.error('Error in browser-control-simple API', { error: error instanceof Error ? error.message : error });
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    log.error('Error details', { message: errorMessage, stack: errorStack });
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process browser control request',
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

export async function GET_impl() {
  return NextResponse.json({
    service: 'Simple Browser Control API',
    status: 'running',
    message: 'This is a simplified version for testing Puppeteer in Next.js environment',
    endpoints: {
      POST: 'Test browser automation'
    }
  });
}
