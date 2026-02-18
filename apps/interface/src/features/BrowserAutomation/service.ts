/**
 * Browser Automation Service
 * 
 * Core service for managing browser automation sessions and operations.
 * Migrated from apps/interface/src/services/browser-automation-service.ts
 * to follow the new features-first architecture.
 */

// Note: These imports will work once puppeteer and ws are properly installed
// For now, using any types to avoid compilation errors
type Browser = any;
type Page = any;
type WebSocketServer = any;

import {
  BrowserSession,
  BrowserAction,
  NavigationResult,
  ActionResult,
  PageInfo,
  LinkClickResult,
  BROWSER_AUTOMATION_CONSTANTS,
  BROWSER_AUTOMATION_ERRORS
} from './definition';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('BrowserAutomation');

export class BrowserAutomationService {
  private sessions: Map<string, BrowserSession> = new Map();
  private wsServer?: WebSocketServer;

  private getBrowserLaunchOptions(sessionId: string, headless: boolean = true) {
    const isLinux = process.platform === 'linux';
    const isWindows = process.platform === 'win32';
    
    const baseArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-extensions',
      '--no-first-run',
      '--disable-default-apps',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection'
    ];

    if (isLinux) {
      // Additional Linux-specific flags for Chrome dependencies
      baseArgs.push(
        '--disable-software-rasterizer',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=VizDisplayCompositor',
        '--run-all-compositor-stages-before-draw',
        '--disable-threaded-animation',
        '--disable-threaded-scrolling',
        '--disable-checker-imaging',
        '--disable-new-content-rendering-timeout',
        '--disable-background-media-suspend',
        '--disable-media-suspend',
        '--autoplay-policy=user-gesture-required',
        '--disable-domain-reliability',
        '--disable-component-update'
      );
    }

    if (isWindows) {
      baseArgs.push('--disable-features=VizDisplayCompositor');
    }

    if (!headless) {
      baseArgs.push(
        '--remote-debugging-port=9222',
        `--user-data-dir=${isWindows ? process.env.TEMP || 'C:\\temp' : '/tmp'}/browser-session-${sessionId}`
      );
    }

    return {
      headless,
      defaultViewport: BROWSER_AUTOMATION_CONSTANTS.DEFAULT_VIEWPORT,
      args: baseArgs,
      timeout: BROWSER_AUTOMATION_CONSTANTS.DEFAULT_TIMEOUT,
      ignoreDefaultArgs: ['--disable-extensions']
    };
  }

  async initializeBrowserSession(sessionId: string): Promise<BrowserSession> {
    try {
      // Import puppeteer dynamically for Next.js compatibility
      const puppeteer = await import('puppeteer');
      
      log.info('Initializing browser session', { sessionId, platform: process.platform });
      
      let browser;
      let lastError;
      
      // Try different browser launch strategies
      const strategies = [
        { name: 'headless-basic', options: this.getBrowserLaunchOptions(sessionId, true) },
        { 
          name: 'headless-single-process', 
          options: { 
            ...this.getBrowserLaunchOptions(sessionId, true), 
            args: [...this.getBrowserLaunchOptions(sessionId, true).args, '--single-process'] 
          } 
        },
        { 
          name: 'headless-no-zygote', 
          options: { 
            ...this.getBrowserLaunchOptions(sessionId, true), 
            args: [...this.getBrowserLaunchOptions(sessionId, true).args, '--no-zygote'] 
          } 
        }
      ];

      for (const strategy of strategies) {
        try {
          log.info('Trying browser launch strategy', { sessionId, strategy: strategy.name });
          browser = await puppeteer.default.launch(strategy.options);
          log.info('Browser launched successfully', { sessionId, strategy: strategy.name });
          break;
        } catch (error) {
          log.warn('Browser launch strategy failed', { sessionId, strategy: strategy.name, error: error instanceof Error ? error.message : error });
          lastError = error;
        }
      }

      if (!browser) {
        throw new Error(`All browser launch strategies failed. Last error: ${lastError instanceof Error ? lastError.message : lastError}`);
      }

      const page = await browser.newPage();
      
      // Set user agent to avoid bot detection
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Configure page settings
      await page.setViewport(BROWSER_AUTOMATION_CONSTANTS.DEFAULT_VIEWPORT);
      
      // Enable request interception for monitoring (optional)
      try {
        await page.setRequestInterception(true);
        page.on('request', (request: any) => {
          // Allow all requests to continue
          request.continue();
        });
      } catch (error) {
        log.warn('Could not enable request interception', { sessionId, error: error instanceof Error ? error.message : error });
      }

      const session: BrowserSession = {
        browser,
        page,
        sessionId,
        isActive: true,
        createdAt: new Date(),
        lastActivity: new Date()
      };

      this.sessions.set(sessionId, session);
      log.info('Browser session created successfully', { sessionId });
      return session;
    } catch (error) {
      log.error('Failed to initialize browser session', {
        sessionId,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Provide helpful error message based on platform
      let troubleshootingMessage = '';
      if (process.platform === 'linux') {
        troubleshootingMessage = ' For Linux systems, ensure Chrome dependencies are installed: sudo apt-get update && sudo apt-get install -y gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget';
      }
      
      throw new Error(`${BROWSER_AUTOMATION_ERRORS.BROWSER_LAUNCH_FAILED}: ${error instanceof Error ? error.message : 'Unknown error'}${troubleshootingMessage}`);
    }
  }

  async navigateToUrl(sessionId: string, url: string): Promise<NavigationResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      log.error('Session not found for navigation', { sessionId });
      return { success: false, error: BROWSER_AUTOMATION_ERRORS.SESSION_NOT_FOUND };
    }

    try {
      log.info('Navigating to URL', { sessionId, url });
      log.debug('Current page URL before navigation', { sessionId, url: await session.page.url() });
      
      await session.page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout: BROWSER_AUTOMATION_CONSTANTS.DEFAULT_TIMEOUT 
      });
      
      // Update last activity
      session.lastActivity = new Date();
      
      log.info('Navigation successful', { sessionId });
      log.debug('Current page URL after navigation', { sessionId, url: await session.page.url() });
      log.debug('Page title after navigation', { sessionId, title: await session.page.title() });
      
      // Take screenshot for AI feedback
      const screenshot = await session.page.screenshot({ 
        encoding: BROWSER_AUTOMATION_CONSTANTS.SCREENSHOT_ENCODING,
        fullPage: false 
      });

      log.debug('Screenshot taken after navigation', { sessionId });

      return { 
        success: true, 
        screenshot: `data:image/png;base64,${screenshot}` 
      };
    } catch (error) {
      log.error('Navigation failed', { sessionId, url, error: error instanceof Error ? error.message : error });
      return { 
        success: false, 
        error: error instanceof Error ? error.message : BROWSER_AUTOMATION_ERRORS.NAVIGATION_FAILED
      };
    }
  }

  async performAction(sessionId: string, action: BrowserAction): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: BROWSER_AUTOMATION_ERRORS.SESSION_NOT_FOUND };
    }

    try {
      switch (action.type) {
        case 'click':
          if (action.selector) {
            await session.page.click(action.selector);
          } else if (action.coordinates) {
            await session.page.mouse.click(action.coordinates.x, action.coordinates.y);
          }
          break;
        
        case 'type':
          if (action.selector && action.text) {
            await session.page.type(action.selector, action.text);
          }
          break;
        
        case 'scroll':
          if (action.coordinates) {
            await session.page.mouse.wheel({ deltaY: action.coordinates.y });
          }
          break;
        
        case 'hover':
          if (action.selector) {
            await session.page.hover(action.selector);
          }
          break;
        
        case 'wait':
          if (typeof (session.page as any).waitForTimeout === 'function') {
            await session.page.waitForTimeout(action.waitTime || 1000);
          } else {
            await new Promise(resolve => setTimeout(resolve, action.waitTime || 1000));
          }
          break;
      }

      // Update last activity
      session.lastActivity = new Date();

      // Take screenshot after action
      const screenshot = await session.page.screenshot({ 
        encoding: BROWSER_AUTOMATION_CONSTANTS.SCREENSHOT_ENCODING,
        fullPage: false 
      });

      return { 
        success: true, 
        screenshot: `data:image/png;base64,${screenshot}` 
      };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : BROWSER_AUTOMATION_ERRORS.ACTION_FAILED
      };
    }
  }

  async getPageInfo(sessionId: string): Promise<PageInfo | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    try {
      const title = await session.page.title();
      const url = session.page.url();
      
      // Update last activity
      session.lastActivity = new Date();
      
      // Get visible text content
      const content = await session.page.evaluate(() => {
        return document.body.innerText.substring(0, BROWSER_AUTOMATION_CONSTANTS.MAX_CONTENT_LENGTH);
      });

      // Get interactive elements
      const elements = await session.page.evaluate((maxElements: number) => {
        const elements = Array.from(document.querySelectorAll('button, a, input, select, textarea'));
        return elements.slice(0, maxElements).map((el, index) => ({
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim().substring(0, 100) || '',
          selector: `${el.tagName.toLowerCase()}:nth-of-type(${index + 1})`
        }));
      }, BROWSER_AUTOMATION_CONSTANTS.MAX_ELEMENTS);

      // Get all links with detailed information
      const links = await session.page.evaluate((maxLinks: number) => {
        const linkElements = Array.from(document.querySelectorAll('a[href]'));
        return linkElements.slice(0, maxLinks).map((link, index) => {
          // Create a more reliable selector
          let selector = '';
          if (link.id) {
            selector = `#${link.id}`;
          } else if (link.className) {
            const classes = Array.from(link.classList).join('.');
            selector = `a.${classes}`;
          } else {
            // Fallback to a more specific selector
            const parent = link.parentElement;
            if (parent && parent.tagName) {
              selector = `${parent.tagName.toLowerCase()} a:nth-of-type(${index + 1})`;
            } else {
              selector = `a:nth-of-type(${index + 1})`;
            }
          }
          
          return {
            text: (link as HTMLAnchorElement).textContent?.trim().substring(0, 200) || '',
            url: (link as HTMLAnchorElement).href,
            selector: selector,
            title: (link as HTMLAnchorElement).title || undefined
          };
        });
      }, BROWSER_AUTOMATION_CONSTANTS.MAX_LINKS);

      // Get all images with alt text
      const images = await session.page.evaluate((maxImages: number) => {
        const imgElements = Array.from(document.querySelectorAll('img[src]'));
        return imgElements.slice(0, maxImages).map((img, index) => ({
          alt: (img as HTMLImageElement).alt || '',
          src: (img as HTMLImageElement).src,
          selector: `img:nth-of-type(${index + 1})`
        }));
      }, BROWSER_AUTOMATION_CONSTANTS.MAX_IMAGES);

      // Get video elements
      const videos = await session.page.evaluate((maxVideos: number) => {
        const videoElements = Array.from(document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="tiktok"]'));
        return videoElements.slice(0, maxVideos).map((video, index) => ({
          src: (video as HTMLVideoElement).src || (video as HTMLIFrameElement).src || '',
          title: (video as HTMLVideoElement).title || '',
          selector: `${video.tagName.toLowerCase()}:nth-of-type(${index + 1})`
        }));
      }, BROWSER_AUTOMATION_CONSTANTS.MAX_VIDEOS);

      return { title, url, content, elements, links, images, videos };
    } catch (error) {
      log.error('Error getting page info', { sessionId, error: error instanceof Error ? error.message : error });
      return null;
    }
  }

  async findAndClickLink(sessionId: string, description: string): Promise<LinkClickResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      log.error('Session not found for link clicking', { sessionId });
      return { success: false, error: BROWSER_AUTOMATION_ERRORS.SESSION_NOT_FOUND };
    }

    if (!session.isActive) {
      log.error('Session is not active', { sessionId });
      return { success: false, error: BROWSER_AUTOMATION_ERRORS.SESSION_INACTIVE };
    }

    try {
      log.info('Searching for link matching description', { sessionId, description });
      
      // Get all links from the page
      const pageInfo = await this.getPageInfo(sessionId);
      if (!pageInfo) {
        return { success: false, error: 'Could not retrieve page information' };
      }

      const { links } = pageInfo;
      log.debug('Found links on page', { sessionId, totalLinks: links.length });

      if (links.length === 0) {
        return { success: false, error: 'No links found on the page' };
      }

      // Score each link based on relevance to the description
      const scoredLinks = links.map(link => {
        const linkText = link.text.toLowerCase();
        const linkUrl = link.url.toLowerCase();
        const descriptionLower = description.toLowerCase();
        
        let score = 0;
        
        // Exact text matches get high scores
        if (linkText.includes(descriptionLower)) score += 100;
        if (descriptionLower.includes(linkText) && linkText.length > 3) score += 80;
        
        // Partial text matches with better word matching
        const words = descriptionLower.split(' ').filter(word => word.length > 2);
        const linkWords = linkText.split(' ').filter(word => word.length > 2);
        
        // Check for word overlap
        words.forEach(word => {
          if (linkText.includes(word)) score += 25;
          if (linkUrl.includes(word)) score += 20;
          
          // Check for partial word matches (e.g., "Frank" matches "Frank Smith")
          linkWords.forEach(linkWord => {
            if (linkWord.includes(word) || word.includes(linkWord)) {
              score += 15;
            }
          });
        });
        
        // Title attribute matches
        if (link.title && link.title.toLowerCase().includes(descriptionLower)) score += 50;
        
        // URL path relevance
        try {
          const urlPath = new URL(link.url).pathname.toLowerCase();
          words.forEach(word => {
            if (urlPath.includes(word)) score += 15;
          });
        } catch (e) {
          // Invalid URL, skip
        }
        
        // Special handling for common patterns and content types
        if (descriptionLower.includes('story') && linkText.includes('story')) score += 35;
        if (descriptionLower.includes('video') && (linkText.includes('video') || linkUrl.includes('video'))) score += 30;
        if (descriptionLower.includes('article') && linkText.includes('article')) score += 30;
        if (descriptionLower.includes('news') && linkText.includes('news')) score += 25;
        if (descriptionLower.includes('baby') && linkText.includes('baby')) score += 45;
        if (descriptionLower.includes('baby') && linkUrl.includes('baby')) score += 35;
        
        // Handle specific content types
        if (descriptionLower.includes('frank') && linkText.includes('frank')) score += 40;
        if (descriptionLower.includes('smith') && linkText.includes('smith')) score += 40;
        if (descriptionLower.includes('technology') && linkText.includes('technology')) score += 30;
        if (descriptionLower.includes('politics') && linkText.includes('politics')) score += 30;
        if (descriptionLower.includes('sports') && linkText.includes('sports')) score += 30;
        
        // Boost scores for links that seem like main content
        if (linkText.length > 20 && linkText.length < 200) score += 10;
        if (linkUrl.includes('/article/') || linkUrl.includes('/story/') || linkUrl.includes('/news/')) score += 20;
        
        // Penalize very short or generic links
        if (linkText.length < 3) score -= 25;
        if (linkText === 'click here' || linkText === 'read more' || linkText === 'continue') score -= 15;
        if (linkText === 'home' || linkText === 'menu' || linkText === 'search') score -= 10;
        
        return { ...link, score };
      });

      // Sort by score and filter out very low scores
      const relevantLinks = scoredLinks
        .filter(link => link.score > 5)
        .sort((a, b) => b.score - a.score);

      log.debug('Top relevant links', { sessionId, links: relevantLinks.slice(0, 5).map(l => ({ text: l.text.substring(0, 50), url: l.url, score: l.score, selector: l.selector })) });

      if (relevantLinks.length === 0) {
        log.warn('No relevant links found', { sessionId, description, sampleLinks: links.slice(0, 10).map(l => ({ text: l.text.substring(0, 50), url: l.url })) });
        return { 
          success: false, 
          error: `${BROWSER_AUTOMATION_ERRORS.LINK_NOT_FOUND} for "${description}". Available links: ${links.slice(0, 10).map(l => l.text.substring(0, 30)).join(', ')}` 
        };
      }

      // Click the highest scoring link
      const bestLink = relevantLinks[0];
      log.info('Clicking best match', { sessionId, text: bestLink.text.substring(0, 100), url: bestLink.url, score: bestLink.score, selector: bestLink.selector });

      // Click the link with better error handling
      let clickSuccess = false;
      try {
        await session.page.click(bestLink.selector);
        log.info('Clicked link with selector', { sessionId, selector: bestLink.selector });
        clickSuccess = true;
      } catch (clickError) {
        log.warn('Failed to click with selector, trying fallback methods', { sessionId, selector: bestLink.selector, error: clickError instanceof Error ? clickError.message : clickError });
        
        // Try alternative clicking methods
        try {
          // Method 1: Click by text content
          await session.page.click(`text=${bestLink.text.substring(0, 50)}`);
          log.info('Clicked by text content', { sessionId, text: bestLink.text.substring(0, 50) });
          clickSuccess = true;
        } catch (textClickError) {
          try {
            // Method 2: Click by URL
            await session.page.click(`a[href="${bestLink.url}"]`);
            log.info('Clicked by href attribute', { sessionId, url: bestLink.url });
            clickSuccess = true;
          } catch (hrefClickError) {
            try {
              // Method 3: Use evaluate to click
              const clicked = await session.page.evaluate((url: string) => {
                const link = document.querySelector(`a[href="${url}"]`) as HTMLAnchorElement;
                if (link) {
                  link.click();
                  return true;
                }
                return false;
              }, bestLink.url);
              
              if (clicked) {
                log.info('Clicked via JavaScript', { sessionId, url: bestLink.url });
                clickSuccess = true;
              } else {
                throw new Error('JavaScript click failed');
              }
            } catch (jsClickError) {
              log.error('All clicking methods failed', { sessionId, selectorError: clickError, textError: textClickError, hrefError: hrefClickError, jsError: jsClickError });
            }
          }
        }
      }
      
      if (!clickSuccess) {
        return { 
          success: false, 
          error: 'Failed to click the selected link after trying multiple methods' 
        };
      }
      
      // Update last activity
      session.lastActivity = new Date();
      
      // Wait for navigation with better timeout handling
      try {
        await session.page.waitForNavigation({ timeout: 5000 });
      } catch (navError) {
        log.warn('Navigation timeout after click, continuing', { sessionId, error: navError instanceof Error ? navError.message : navError });
        if (typeof (session.page as any).waitForTimeout === 'function') {
          await session.page.waitForTimeout(2000);
        } else {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      // Take screenshot after navigation
      const screenshot = await session.page.screenshot({ 
        encoding: BROWSER_AUTOMATION_CONSTANTS.SCREENSHOT_ENCODING,
        fullPage: false 
      });

      return {
        success: true,
        clickedUrl: bestLink.url,
        clickedText: bestLink.text,
        screenshot: `data:image/png;base64,${screenshot}`
      };

    } catch (error) {
      log.error('Error finding and clicking link', { sessionId, description, error: error instanceof Error ? error.message : error });
      return { 
        success: false, 
        error: error instanceof Error ? error.message : BROWSER_AUTOMATION_ERRORS.LINK_NOT_FOUND
      };
    }
  }

  async closeBrowserSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    try {
      await session.browser.close();
      this.sessions.delete(sessionId);
      log.info('Browser session closed successfully', { sessionId });
      return true;
    } catch (error) {
      log.error('Error closing browser session', { sessionId, error: error instanceof Error ? error.message : error });
      return false;
    }
  }

  // WebSocket server for real-time communication with AI agent
  async initializeWebSocketServer(port: number = BROWSER_AUTOMATION_CONSTANTS.WEBSOCKET_PORT) {
    try {
      const { WebSocketServer } = await import('ws');
      
      this.wsServer = new WebSocketServer({ port });
    
      this.wsServer.on('connection', (ws: any) => {
        log.info('Browser automation WebSocket connected');
        
        ws.on('message', async (message: any) => {
          let data: any;
          try {
            data = JSON.parse(message.toString());
            let response;

            switch (data.action) {
              case 'navigate':
                response = await this.navigateToUrl(data.sessionId, data.url);
                break;
              case 'perform_action':
                response = await this.performAction(data.sessionId, data.actionData);
                break;
              case 'get_page_info':
                response = await this.getPageInfo(data.sessionId);
                break;
              case 'create_session':
                const session = await this.initializeBrowserSession(data.sessionId);
                response = { success: true, sessionId: session.sessionId };
                break;
              case 'close_session':
                response = { success: await this.closeBrowserSession(data.sessionId) };
                break;
            }

            ws.send(JSON.stringify({ id: data?.id, ...response }));
          } catch (error) {
            ws.send(JSON.stringify({ 
              id: data?.id || null, 
              success: false, 
              error: error instanceof Error ? error.message : 'Unknown error' 
            }));
          }
        });
      });
    } catch (error) {
      log.error('Failed to initialize WebSocket server', { error: error instanceof Error ? error.message : error });
      throw new Error(`Failed to initialize WebSocket server: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Session management utilities
  getActiveSessions(): BrowserSession[] {
    return Array.from(this.sessions.values()).filter(session => session.isActive);
  }

  getSessionById(sessionId: string): BrowserSession | undefined {
    return this.sessions.get(sessionId);
  }

  async cleanupInactiveSessions(): Promise<void> {
    const now = new Date();
    const sessionsToCleanup: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lastActivity) {
        const timeSinceLastActivity = now.getTime() - session.lastActivity.getTime();
        if (timeSinceLastActivity > BROWSER_AUTOMATION_CONSTANTS.SESSION_TIMEOUT) {
          sessionsToCleanup.push(sessionId);
        }
      }
    }

    for (const sessionId of sessionsToCleanup) {
      log.info('Cleaning up inactive session', { sessionId });
      await this.closeBrowserSession(sessionId);
    }
  }
}

// Export singleton instance
export const browserAutomationService = new BrowserAutomationService();
