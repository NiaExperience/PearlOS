/**
 * @jest-environment jsdom
 */
import {
  scrapeContentAction,
  executeVoiceCommandAction,
  proxyRequestAction,
  normalizeUrlAction,
  getBrowserHistoryAction,
  clearBrowserHistoryAction
} from '../src/features/MiniBrowser/actions/mini-browser-actions';

// Mock fetch
global.fetch = jest.fn();

describe('MiniBrowser Server Actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('scrapeContentAction', () => {
    it('scrapes content successfully', async () => {
      const mockContent = {
        title: 'Test Page',
        content: 'Test content',
        metadata: { description: 'Test description' },
        links: [],
        images: []
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockContent
      });

      const result = await scrapeContentAction('https://example.com');

      expect(result).toEqual(mockContent);
      expect(fetch).toHaveBeenCalledWith('/api/mini-browser/scrape-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' })
      });
    });

    it('handles scraping errors', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found'
      });

      await expect(scrapeContentAction('https://example.com')).rejects.toThrow(
        'Failed to scrape content from the provided URL'
      );
    });

    it('handles network errors', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(scrapeContentAction('https://example.com')).rejects.toThrow(
        'Failed to scrape content from the provided URL'
      );
    });
  });

  describe('executeVoiceCommandAction', () => {
    it('executes voice command successfully', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

      const command = { type: 'click' as const, selector: 'button' };
      const result = await executeVoiceCommandAction(command);

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith('/api/mini-browser/voice-navigation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
    });

    it('handles command execution errors', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request'
      });

      const command = { type: 'click' as const, selector: 'button' };
      const result = await executeVoiceCommandAction(command);

      expect(result).toBe(false);
    });

    it('handles network errors', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const command = { type: 'click' as const, selector: 'button' };
      const result = await executeVoiceCommandAction(command);

      expect(result).toBe(false);
    });
  });

  describe('proxyRequestAction', () => {
    it('proxies request successfully', async () => {
      const mockResponse = {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: '<html>Test</html>',
        contentType: 'text/html'
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const request = {
        url: 'https://example.com',
        method: 'GET' as const,
        headers: { 'user-agent': 'test' }
      };

      const result = await proxyRequestAction(request);

      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith('/api/mini-browser/enhanced-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });
    });

    it('handles proxy errors', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Gateway Timeout'
      });

      const request = {
        url: 'https://example.com',
        method: 'GET' as const
      };

      await expect(proxyRequestAction(request)).rejects.toThrow(
        'Failed to proxy the request'
      );
    });
  });

  describe('normalizeUrlAction', () => {
    it('normalizes URL successfully', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://www.example.com' })
      });

      const result = await normalizeUrlAction('example.com');

      expect(result).toBe('https://www.example.com');
      expect(fetch).toHaveBeenCalledWith('/api/mini-browser/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'example.com' })
      });
    });

    it('returns original input on error', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await normalizeUrlAction('example.com');

      expect(result).toBe('example.com');
    });

    it('handles server errors gracefully', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error'
      });

      const result = await normalizeUrlAction('example.com');

      expect(result).toBe('example.com');
    });
  });

  describe('getBrowserHistoryAction', () => {
    it('returns empty array as placeholder', async () => {
      const result = await getBrowserHistoryAction();

      expect(result).toEqual([]);
    });
  });

  describe('clearBrowserHistoryAction', () => {
    it('returns true as placeholder', async () => {
      const result = await clearBrowserHistoryAction();

      expect(result).toBe(true);
    });
  });
});
