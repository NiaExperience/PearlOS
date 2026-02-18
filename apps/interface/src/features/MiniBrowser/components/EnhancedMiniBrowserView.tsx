/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { ArrowLeft, ArrowRight, RotateCcw, Home, Shield, AlertTriangle, Globe, BookOpen } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import ReadabilityView, { ReadabilityArticle } from './ReadabilityView';

import { getClientLogger } from '@interface/lib/client-logger';

// Import styles for content animations
import '@interface/features/MiniBrowser/styles/mini-browser.css';

export interface EnhancedMiniBrowserViewProps {
  initialUrl?: string;
  onContentScraped?: (data: unknown) => void;
  onVoiceAction?: (action: unknown) => void;
  isCallActive?: boolean;
}

type BrowserMessage = {
  type: string;
  data?: any;
  timestamp?: number;
  url?: string;
};

const EnhancedMiniBrowserView: React.FC<EnhancedMiniBrowserViewProps> = ({
  initialUrl = 'https://www.google.com',
  onContentScraped,
  onVoiceAction,
  isCallActive = false,
}) => {
  const logger = getClientLogger('[mini_browser_view]');
  const [url, setUrl] = useState<string>('about:blank');
  const [inputUrl, setInputUrl] = useState<string>(initialUrl);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [readerMode, setReaderMode] = useState(false);
  const [readerArticle, setReaderArticle] = useState<ReadabilityArticle | null>(null);
  const [readerLoading, setReaderLoading] = useState(false);
  const [readerError, setReaderError] = useState<string | null>(null);

  useEffect(() => {
    if (initialUrl) {
      setInputUrl(initialUrl);
      navigateToUrl(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  const getProxyUrl = useCallback((targetUrl: string) => {
    const fullUrl = targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`;
    return `/api/mini-browser/enhanced-proxy/${encodeURIComponent(fullUrl)}`;
  }, []);

  const beginSimulatedProgress = useCallback(() => {
    setLoadingProgress(5);
    let progress = 5;
    const timer = setInterval(() => {
      progress = Math.min(progress + Math.random() * 20, 95);
      setLoadingProgress(progress);
      if (progress >= 95) clearInterval(timer);
    }, 200);
    return () => clearInterval(timer);
  }, []);

  const navigateToUrl = useCallback(
    (targetUrl: string) => {
      let normalized = targetUrl.trim();
      if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
        if (normalized.includes('.') && !normalized.includes(' ')) normalized = `https://${normalized}`;
        else normalized = `https://www.google.com/search?q=${encodeURIComponent(normalized)}`;
      }
      setIsLoading(true);
      setError(null);
      setLoadingProgress(0);
      const stopProgress = beginSimulatedProgress();
      const proxyUrl = getProxyUrl(normalized);
      setUrl(proxyUrl);
      setInputUrl(normalized);
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(normalized);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      return () => stopProgress();
    },
    [getProxyUrl, beginSimulatedProgress, history, historyIndex]
  );

  const handleMessage = useCallback(
    (event: MessageEvent<BrowserMessage>) => {
      const message = event.data;
      if (!message || typeof message.type !== 'string') return;
      if (!message.type.startsWith('ENHANCED_BROWSER_')) return;
      const { type, data } = message;
      switch (type) {
        case 'ENHANCED_BROWSER_PAGE_READY':
          setIsLoading(false);
          setLoadingProgress(100);
          break;
        case 'ENHANCED_BROWSER_NAVIGATION':
          // could update inputUrl/history if we can read target, but keep simple
          break;
        case 'ENHANCED_BROWSER_ERROR':
          setIsLoading(false);
          setError(data?.message || 'Page error');
          break;
        case 'ENHANCED_BROWSER_AUTO_SCROLL_PROGRESS':
          // no-op in base UI
          break;
        case 'ENHANCED_BROWSER_AUTO_SCROLL_STOPPED':
          // no-op in base UI
          break;
        case 'ENHANCED_BROWSER_CONTENT_SCRAPED':
          onContentScraped?.(data);
          break;
        case 'ENHANCED_BROWSER_VOICE_ACTION':
          onVoiceAction?.(data);
          break;
      }
    },
    [onContentScraped, onVoiceAction]
  );

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // Speech integration migrated to Pipecat/Daily bot events
  // Browser can respond to NIA events dispatched by pipecat-daily-bot if needed
  // SpeechProvider context tracks speaking state automatically via useVoiceSessionContext() hook

  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      navigateToUrl(inputUrl);
    },
    [inputUrl, navigateToUrl]
  );

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      const i = historyIndex - 1;
      const target = history[i];
      setHistoryIndex(i);
      navigateToUrl(target);
    }
  }, [history, historyIndex, navigateToUrl]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const i = historyIndex + 1;
      const target = history[i];
      setHistoryIndex(i);
      navigateToUrl(target);
    }
  }, [history, historyIndex, navigateToUrl]);

  const refresh = useCallback(() => {
    setIsLoading(true);
    setError(null);
    if (iframeRef.current) iframeRef.current.src = url;
  }, [url]);

  const goHome = useCallback(() => navigateToUrl('https://www.google.com'), [navigateToUrl]);

  const fetchReadability = useCallback(async (targetUrl: string) => {
    setReaderLoading(true);
    setReaderError(null);
    try {
      const res = await fetch('/api/mini-browser/readability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setReaderError(data.error || 'Failed to parse article');
        setReaderArticle(null);
      } else {
        setReaderArticle(data as ReadabilityArticle);
      }
    } catch (err) {
      setReaderError(err instanceof Error ? err.message : 'Reader view failed');
      setReaderArticle(null);
    } finally {
      setReaderLoading(false);
    }
  }, []);

  const toggleReaderMode = useCallback(() => {
    if (readerMode) {
      setReaderMode(false);
      return;
    }
    // Get the actual URL (not the proxy URL)
    const actualUrl = inputUrl.startsWith('http') ? inputUrl : `https://${inputUrl}`;
    setReaderMode(true);
    fetchReadability(actualUrl);
  }, [readerMode, inputUrl, fetchReadability]);

  const isSecure = useMemo(() => inputUrl.startsWith('https://'), [inputUrl]);
  const domain = useMemo(() => inputUrl.replace(/^https?:\/\//, '').split('/')[0], [inputUrl]);

  const startAutoScroll = useCallback((speed: number = 1, direction: 'down' | 'up' = 'down') => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'AUTO_SCROLL_START', speed, direction }, '*');
  }, []);

  const stopAutoScroll = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'AUTO_SCROLL_STOP' }, '*');
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        startAutoScroll(1, 'down');
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        startAutoScroll(1, 'up');
      }
    },
    [startAutoScroll]
  );

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    setLoadingProgress(100);
    setError(null);
    
    // Ensure iframe doesn't steal focus from voice input
    // Keep focus on the main window to maintain speech functionality
    if (document.activeElement === iframeRef.current) {
      (document.body as HTMLElement)?.focus();
    }

    // Additional protection: Prevent iframe from interfering with parent audio context
    try {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow) {
        // Override audio-related APIs in the iframe to prevent interference
        iframe.contentWindow.postMessage({
          type: 'DISABLE_AUDIO_INTERFERENCE',
          timestamp: Date.now()
        }, '*');
      }
    } catch (error) {
      logger.warn('Could not send audio protection message to iframe', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [logger]);

  const handleIframeError = useCallback(() => {
    setIsLoading(false);
    setError('Failed to load page. This might be due to CORS restrictions or the site blocking iframe embedding.');
    // Ensure errors don't interrupt speech by logging silently
    logger.warn('Enhanced Mini Browser: Iframe load error occurred');
  }, [logger]);

  return (
    <div className="w-full h-full bg-black flex flex-col" onKeyDown={handleKeyDown}>
      <div className="bg-gray-900 border-b border-gray-700 p-2">
        <div className="flex items-center space-x-2 mb-2">
          <button onClick={goBack} disabled={historyIndex <= 0} className="p-2 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-gray-300" title="Go Back"><ArrowLeft className="w-4 h-4" /></button>
          <button onClick={goForward} disabled={historyIndex >= history.length - 1} className="p-2 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-gray-300" title="Go Forward"><ArrowRight className="w-4 h-4" /></button>
          <button onClick={refresh} className="p-2 rounded hover:bg-gray-700 transition-colors text-gray-300" title="Refresh"><RotateCcw className="w-4 h-4" /></button>
          <button onClick={goHome} className="p-2 rounded hover:bg-gray-700 transition-colors text-gray-300" title="Home"><Home className="w-4 h-4" /></button>
          <button onClick={toggleReaderMode} className={`p-2 rounded hover:bg-gray-700 transition-colors ${readerMode ? 'text-amber-400 bg-gray-700' : 'text-gray-300'}`} title={readerMode ? 'Exit Reader View' : 'Reader View'}><BookOpen className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleUrlSubmit} className="flex items-center space-x-2">
          <div className="flex items-center bg-gray-800 border border-gray-600 rounded-lg flex-1 px-3 py-2">
            <div className="flex items-center mr-2">{isSecure ? <Shield className="w-4 h-4 text-green-500" /> : <AlertTriangle className="w-4 h-4 text-orange-400" />}</div>
            <input type="text" value={inputUrl} onChange={e => setInputUrl(e.target.value)} className="flex-1 outline-none text-sm bg-transparent text-gray-200 placeholder-gray-400" placeholder="Enter URL or search term..." />
            {isLoading && (
              <div className="ml-2">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </div>
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors">Go</button>
        </form>
        <div className="flex items-center mt-2 text-xs text-gray-400">
          <Globe className="w-3 h-3 mr-1" /><span>{domain}</span>{isSecure && <span className="ml-2 text-green-500">• Secure</span>}
          {isLoading && (
            <span className="ml-2">{Math.round(loadingProgress)}%</span>
          )}
        </div>
      </div>
      <div className="flex-1 relative">
        {readerMode ? (
          readerLoading ? (
            <div className="flex items-center justify-center h-full bg-gray-950">
              <div className="text-center">
                <div className="w-8 h-8 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                <p className="text-gray-400">Extracting article...</p>
              </div>
            </div>
          ) : readerError ? (
            <div className="flex items-center justify-center h-full bg-gray-950">
              <div className="text-center p-8">
                <BookOpen className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-300 mb-2">Reader View Unavailable</h3>
                <p className="text-gray-500 mb-4 max-w-sm">{readerError}</p>
                <button onClick={() => setReaderMode(false)} className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 transition-colors">Back to Browser</button>
              </div>
            </div>
          ) : readerArticle ? (
            <ReadabilityView article={readerArticle} url={inputUrl} onClose={() => setReaderMode(false)} />
          ) : null
        ) : error ? (
          <div className="flex items-center justify-center h-full bg-gray-800">
            <div className="text-center p-8">
              <AlertTriangle className="w-16 h-16 text-orange-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-200 mb-2">Page Load Error</h3>
              <p className="text-gray-400 mb-4 max-w-md">{error}</p>
              <div className="space-y-2">
                <button onClick={refresh} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors mr-2">Try Again</button>
                <button onClick={toggleReaderMode} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-500 transition-colors">Try Reader View</button>
                <p className="text-sm text-gray-500 mt-2">Tip: Reader View extracts article content without iframes</p>
              </div>
            </div>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={url}
            className="w-full h-full border-none"
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-top-navigation allow-popups-to-escape-sandbox"
            referrerPolicy="strict-origin-when-cross-origin"
            title="Enhanced Mini Browser Content"
            allow="microphone 'none'; camera 'none'; geolocation 'none'"
          />
        )}
        {isLoading && !error && (
          <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center">
            <div className="text-center">
              <div className="w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
              <p className="text-gray-300">Loading...</p>
            </div>
          </div>
        )}
      </div>
      <div className="bg-gray-900 border-t border-gray-700 px-4 py-2">
        <div className="flex justify-between items-center text-xs text-gray-400">
          <span>Enhanced Mini Browser {isCallActive ? '• Voice Ready' : ''}</span>
          <span>{inputUrl}</span>
        </div>
        <div className="mt-2 flex gap-2 text-xs">
          <button onClick={() => startAutoScroll(1, 'down')} className="px-2 py-1 bg-gray-800 border border-gray-600 rounded">Auto-scroll ↓</button>
          <button onClick={() => startAutoScroll(1, 'up')} className="px-2 py-1 bg-gray-800 border border-gray-600 rounded">Auto-scroll ↑</button>
          <button onClick={stopAutoScroll} className="px-2 py-1 bg-gray-800 border border-gray-600 rounded">Stop</button>
        </div>
      </div>
    </div>
  );
};

export default EnhancedMiniBrowserView;


