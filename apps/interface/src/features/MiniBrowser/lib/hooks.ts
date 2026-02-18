import { useState, useCallback, useEffect } from 'react';

import { getClientLogger } from '@interface/lib/client-logger';

import { BrowserState, ContentScrapingResult, VoiceNavigationCommand } from '../types/mini-browser-types';
import { resolveQuickSite } from '../lib/quick-sites';

const logger = getClientLogger('[mini_browser_hooks]');

export function useMiniBrowser(initialUrl: string = 'https://www.google.com') {
  const [state, setState] = useState<BrowserState & { historyIndex: number }>({
    currentUrl: initialUrl,
    history: [initialUrl],
    historyIndex: 0,
    isLoading: false,
    error: null,
    lastActivity: Date.now()
  });

  const navigateToUrl = useCallback((url: string) => {
    let finalUrl: string;
    let errorState: string | null = null;
    
    try {
      const resolvedUrl = resolveQuickSite(url) || url;
      finalUrl = resolvedUrl.startsWith('http') ? resolvedUrl : `https://${resolvedUrl}`;
    } catch (error) {
      // If resolveQuickSite fails, set error state but still try to navigate
      errorState = `Failed to navigate to ${url}: ${error}`;
      finalUrl = url.startsWith('http') ? url : `https://${url}`;
    }
    
    // Update state with potential error
    setState(prev => {
      const newHistory = [...prev.history, finalUrl];
      const newState = {
        ...prev,
        currentUrl: finalUrl,
        history: newHistory,
        historyIndex: newHistory.length - 1,
        isLoading: false,
        error: errorState,
        lastActivity: Date.now()
      };
      return newState;
    });
  }, []);

  const goBack = useCallback(() => {
    setState(prev => {
      if (prev.historyIndex <= 0) return prev;
      
      const newIndex = prev.historyIndex - 1;
      const previousUrl = prev.history[newIndex];
      
      return {
        ...prev,
        currentUrl: previousUrl,
        historyIndex: newIndex,
        lastActivity: Date.now()
      };
    });
  }, []);

  const goForward = useCallback(() => {
    setState(prev => {
      if (prev.historyIndex >= prev.history.length - 1) return prev;
      
      const newIndex = prev.historyIndex + 1;
      const nextUrl = prev.history[newIndex];
      
      return {
        ...prev,
        currentUrl: nextUrl,
        historyIndex: newIndex,
        lastActivity: Date.now()
      };
    });
  }, []);

  const refresh = useCallback(() => {
    setState(prev => ({
      ...prev,
      isLoading: true,
      lastActivity: Date.now()
    }));

    // Simulate refresh by setting loading state briefly
    setTimeout(() => {
      setState(prev => ({
        ...prev,
        isLoading: false,
        lastActivity: Date.now()
      }));
    }, 500);
  }, []);

  const clearError = useCallback(() => {
    setState(prev => ({
      ...prev,
      error: null,
      lastActivity: Date.now()
    }));
  }, []);

  const clearHistory = useCallback(() => {
    setState(prev => ({
      ...prev,
      history: [prev.currentUrl],
      historyIndex: 0,
      lastActivity: Date.now()
    }));
  }, []);

  // Note: Auto-navigation removed to avoid test issues and infinite loops

  return {
    currentUrl: state.currentUrl,
    history: state.history,
    isLoading: state.isLoading,
    error: state.error,
    lastActivity: state.lastActivity,
    navigateToUrl,
    goBack,
    goForward,
    refresh,
    clearError,
    clearHistory
  };
}

export function useContentScraping() {
  const [scrapedContent, setScrapedContent] = useState<ContentScrapingResult | null>(null);
  const [isScraping, setIsScraping] = useState(false);

  const scrapeContent = useCallback(async (url: string) => {
    setIsScraping(true);
    try {
      const response = await fetch('/api/mini-browser/scrape-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      if (!response.ok) {
        throw new Error('Failed to scrape content');
      }

      const content = await response.json();
      setScrapedContent(content);
      return content;
    } catch (error) {
      logger.error('Error scraping content', {
        error: error instanceof Error ? error.message : String(error),
        url,
      });
      throw error;
    } finally {
      setIsScraping(false);
    }
  }, [logger]);

  const clearScrapedContent = useCallback(() => {
    setScrapedContent(null);
  }, []);

  return {
    scrapedContent,
    isScraping,
    scrapeContent,
    clearScrapedContent
  };
}

export function useVoiceNavigation() {
  const [isListening, setIsListening] = useState(false);
  const [lastCommand, setLastCommand] = useState<VoiceNavigationCommand | null>(null);

  const executeCommand = useCallback(async (command: VoiceNavigationCommand) => {
    setLastCommand(command);
    try {
      const response = await fetch('/api/mini-browser/voice-navigation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });

      if (!response.ok) {
        throw new Error('Failed to execute voice command');
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
  }, [logger]);

  const startListening = useCallback(() => {
    setIsListening(true);
    // Voice recognition logic would go here
  }, []);

  const stopListening = useCallback(() => {
    setIsListening(false);
  }, []);

  return {
    isListening,
    lastCommand,
    executeCommand,
    startListening,
    stopListening
  };
}
