/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { useMiniBrowser, useContentScraping, useVoiceNavigation } from '../src/features/MiniBrowser/lib/hooks';
import { resolveQuickSite } from '../src/features/MiniBrowser/lib/quick-sites';

// Mock fetch
global.fetch = jest.fn();

describe('useMiniBrowser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useMiniBrowser());
    
    expect(result.current.currentUrl).toBe('https://www.google.com');
    expect(result.current.history).toEqual(['https://www.google.com']);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('initializes with custom URL', () => {
    const { result } = renderHook(() => useMiniBrowser('https://example.com'));
    
    expect(result.current.currentUrl).toBe('https://example.com');
    expect(result.current.history).toEqual(['https://example.com']);
  });

  it('navigates to a new URL', async () => {
    const { result } = renderHook(() => useMiniBrowser());
    
    act(() => {
      result.current.navigateToUrl('https://example.com');
    });
    
    expect(result.current.currentUrl).toBe('https://example.com');
    expect(result.current.history).toEqual(['https://www.google.com', 'https://example.com']);
  });

  it('resolves quick site aliases', async () => {
    const { result } = renderHook(() => useMiniBrowser());
    
    act(() => {
      result.current.navigateToUrl('cnn');
    });
    
    expect(result.current.currentUrl).toBe('https://www.cnn.com');
  });

  it('handles navigation errors', async () => {
    const { result } = renderHook(() => useMiniBrowser());
    
    // Mock resolveQuickSite to throw
    jest.spyOn(require('../src/features/MiniBrowser/lib/quick-sites'), 'resolveQuickSite')
      .mockImplementation(() => {
        throw new Error('Network error');
      });
    
    act(() => {
      result.current.navigateToUrl('invalid-url');
    });
    
    expect(result.current.error).toContain('Failed to navigate to invalid-url');
  });

  it('goes back in history', async () => {
    const { result } = renderHook(() => useMiniBrowser());
    
    // Initial state should be google.com at index 0
    expect(result.current.currentUrl).toBe('https://www.google.com');
    expect(result.current.history).toEqual(['https://www.google.com']);
    
    act(() => {
      result.current.navigateToUrl('https://example.com');
    });
    
    // After first navigation: should be example.com at index 1
    expect(result.current.currentUrl).toBe('https://example.com');
    expect(result.current.history).toEqual(['https://www.google.com', 'https://example.com']);
    
    act(() => {
      result.current.navigateToUrl('https://test.com');
    });
    
    // After second navigation: should be test.com at index 2
    expect(result.current.currentUrl).toBe('https://test.com');
    expect(result.current.history).toEqual(['https://www.google.com', 'https://example.com', 'https://test.com']);
    
    act(() => {
      result.current.goBack();
    });
    
    // After going back: should be example.com at index 1
    expect(result.current.currentUrl).toBe('https://example.com');
  });

  it('refreshes the current page', () => {
    const { result } = renderHook(() => useMiniBrowser());
    
    act(() => {
      result.current.refresh();
    });
    
    expect(result.current.isLoading).toBe(true);
  });

  it('clears errors', async () => {
    const { result } = renderHook(() => useMiniBrowser());
    
    // Create an error first
    jest.spyOn(require('../src/features/MiniBrowser/lib/quick-sites'), 'resolveQuickSite')
      .mockImplementation(() => {
        throw new Error('Network error');
      });
    
    act(() => {
      result.current.navigateToUrl('invalid-url');
    });
    
    expect(result.current.error).toBeTruthy();
    
    act(() => {
      result.current.clearError();
    });
    
    expect(result.current.error).toBe(null);
  });
});

describe('useContentScraping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useContentScraping());
    
    expect(result.current.scrapedContent).toBe(null);
    expect(result.current.isScraping).toBe(false);
  });

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
    
    const { result } = renderHook(() => useContentScraping());
    
    await act(async () => {
      await result.current.scrapeContent('https://example.com');
    });
    
    expect(result.current.scrapedContent).toEqual(mockContent);
    expect(result.current.isScraping).toBe(false);
  });

  it('handles scraping errors', async () => {
    (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    
    const { result } = renderHook(() => useContentScraping());
    
    await act(async () => {
      try {
        await result.current.scrapeContent('https://example.com');
      } catch (error) {
        // Expected error
      }
    });
    
    expect(result.current.isScraping).toBe(false);
  });

  it('clears scraped content', () => {
    const { result } = renderHook(() => useContentScraping());
    
    act(() => {
      result.current.clearScrapedContent();
    });
    
    expect(result.current.scrapedContent).toBe(null);
  });
});

describe('useVoiceNavigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useVoiceNavigation());
    
    expect(result.current.isListening).toBe(false);
    expect(result.current.lastCommand).toBe(null);
  });

  it('executes voice commands successfully', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true })
    });
    
    const { result } = renderHook(() => useVoiceNavigation());
    
    const command = { type: 'click' as const, selector: 'button' };
    
    await act(async () => {
      const success = await result.current.executeCommand(command);
      expect(success).toBe(true);
    });
    
    expect(result.current.lastCommand).toEqual(command);
  });

  it('handles voice command errors', async () => {
    (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    
    const { result } = renderHook(() => useVoiceNavigation());
    
    const command = { type: 'click' as const, selector: 'button' };
    
    await act(async () => {
      const success = await result.current.executeCommand(command);
      expect(success).toBe(false);
    });
  });

  it('starts and stops listening', () => {
    const { result } = renderHook(() => useVoiceNavigation());
    
    act(() => {
      result.current.startListening();
    });
    
    expect(result.current.isListening).toBe(true);
    
    act(() => {
      result.current.stopListening();
    });
    
    expect(result.current.isListening).toBe(false);
  });
});
