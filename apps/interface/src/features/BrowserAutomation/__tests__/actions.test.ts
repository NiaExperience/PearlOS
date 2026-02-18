/**
 * Browser Automation Actions Tests
 * 
 * Test suite for browser automation action creators.
 * Following the Notes feature test pattern.
 */

import {
  createBrowserSession,
  navigateToUrl,
  performBrowserAction,
  getPageInfo,
  findAndClickLink,
  parseNavigationInput,
  closeBrowserSession,
  performSystemCheck,
  navigateWithParsing,
  createSessionAndNavigate
} from '../actions/.';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('BrowserAutomation Actions', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('createBrowserSession', () => {
    it('should create a browser session successfully', async () => {
      const mockResponse = {
        success: true,
        sessionId: 'test-session',
        screenshot: 'data:image/png;base64,test',
        pageInfo: { title: 'Test', url: 'https://test.com' }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await createBrowserSession({
        sessionId: 'test-session',
        initialUrl: 'https://test.com',
        headless: true
      });

      expect(result.success).toBe(true);
      expect(result.screenshot).toBe('data:image/png;base64,test');
      expect(mockFetch).toHaveBeenCalledWith('/api/browser-control-simple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_session',
          sessionId: 'test-session',
          initialUrl: 'https://test.com',
          headless: true
        })
      });
    });

    it('should handle session creation failure', async () => {
      const mockResponse = {
        success: false,
        error: 'Browser launch failed'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await createBrowserSession({
        sessionId: 'test-session',
        headless: true
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Browser launch failed');
    });

    it('should handle HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      const result = await createBrowserSession({
        sessionId: 'test-session',
        headless: true
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 500');
    });
  });

  describe('navigateToUrl', () => {
    it('should navigate to URL successfully', async () => {
      const mockResponse = {
        success: true,
        screenshot: 'data:image/png;base64,navigation'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await navigateToUrl({
        sessionId: 'test-session',
        url: 'https://example.com'
      });

      expect(result.success).toBe(true);
      expect(result.screenshot).toBe('data:image/png;base64,navigation');
      expect(mockFetch).toHaveBeenCalledWith('/api/browser-control-simple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'navigate',
          sessionId: 'test-session',
          url: 'https://example.com'
        })
      });
    });
  });

  describe('performBrowserAction', () => {
    it('should perform click action successfully', async () => {
      const mockResponse = {
        success: true,
        screenshot: 'data:image/png;base64,clicked'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await performBrowserAction({
        sessionId: 'test-session',
        actionData: {
          type: 'click',
          selector: 'button#submit'
        }
      });

      expect(result.success).toBe(true);
      expect(result.screenshot).toBe('data:image/png;base64,clicked');
    });
  });

  describe('getPageInfo', () => {
    it('should get page information successfully', async () => {
      const mockPageInfo = {
        title: 'Test Page',
        url: 'https://test.com',
        content: 'Test content',
        elements: [],
        links: [],
        images: [],
        videos: []
      };

      const mockResponse = {
        success: true,
        data: mockPageInfo
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await getPageInfo('test-session');

      expect(result).toEqual(mockPageInfo);
    });

    it('should return null when page info fails', async () => {
      const mockResponse = {
        success: false,
        error: 'Failed to get page info'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await getPageInfo('test-session');

      expect(result).toBeNull();
    });
  });

  describe('findAndClickLink', () => {
    it('should find and click link successfully', async () => {
      const mockResponse = {
        success: true,
        clickedUrl: 'https://clicked.com',
        clickedText: 'Clicked Link',
        screenshot: 'data:image/png;base64,link-clicked'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await findAndClickLink({
        sessionId: 'test-session',
        description: 'Click the submit button'
      });

      expect(result.success).toBe(true);
      expect(result.clickedUrl).toBe('https://clicked.com');
      expect(result.clickedText).toBe('Clicked Link');
    });
  });

  describe('parseNavigationInput', () => {
    it('should parse URL successfully', async () => {
      const mockResponse = {
        success: true,
        parsedUrl: 'https://google.com'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await parseNavigationInput({
        input: 'google'
      });

      expect(result.success).toBe(true);
      expect(result.parsedUrl).toBe('https://google.com');
    });
  });

  describe('closeBrowserSession', () => {
    it('should close session successfully', async () => {
      const mockResponse = {
        success: true,
        message: 'Session closed'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await closeBrowserSession('test-session');

      expect(result.success).toBe(true);
    });
  });

  describe('performSystemCheck', () => {
    it('should perform system check successfully', async () => {
      const mockResponse = {
        success: true,
        system: {
          platform: 'darwin',
          arch: 'x64',
          nodeVersion: 'v18.0.0',
          executablePath: '/path/to/chrome',
          browserExists: true,
          launchTest: 'Success',
          env: {}
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await performSystemCheck();

      expect(result.success).toBe(true);
      expect(result.system?.platform).toBe('darwin');
    });
  });

  describe('Utility workflows', () => {
    describe('navigateWithParsing', () => {
      it('should parse input and navigate', async () => {
        // Mock parse URL response
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            parsedUrl: 'https://google.com'
          })
        });

        // Mock navigate response
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            screenshot: 'data:image/png;base64,navigated'
          })
        });

        const result = await navigateWithParsing('test-session', 'google');

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });

    describe('createSessionAndNavigate', () => {
      it('should create session and navigate in one call', async () => {
        const mockResponse = {
          success: true,
          sessionId: 'test-session',
          screenshot: 'data:image/png;base64,created',
          pageInfo: { title: 'Test', url: 'https://test.com' }
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse
        });

        const result = await createSessionAndNavigate(
          'test-session',
          'https://test.com'
        );

        expect(result.success).toBe(true);
        expect(result.screenshot).toBe('data:image/png;base64,created');
      });
    });
  });
});
