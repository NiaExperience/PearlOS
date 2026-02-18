/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { isFeatureEnabled } from '@nia/features';
import { ArrowLeft, ArrowRight, Camera, Home, RotateCcw, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { Skeleton } from '@interface/components/ui/skeleton';
import { getClientLogger } from '@interface/lib/client-logger';

import { dispatchBrowserEvent } from '../lib/events';

interface RealBrowserViewProps {
  sessionId: string;
  initialUrl?: string;
  onClose?: () => void;
  onNavigationReady?: (navigateFunction: (url: string) => Promise<void>) => void;
  supportedFeatures: string[]; // List of supported feature keys
}

interface PageInfo {
  title: string;
  url: string;
  content: string;
  elements: Array<{ tag: string; text: string; selector: string }>;
  links: Array<{ text: string; url: string; selector: string; title?: string }>;
  images: Array<{ alt: string; src: string; selector: string }>;
  videos: Array<{ src: string; title?: string; selector: string }>;
}

// Normalizer to ensure missing arrays are defaulted to empty to prevent flaky undefined length errors
function normalizePageInfo(pi: any): PageInfo {
  return {
    title: pi?.title || '',
    url: pi?.url || '',
    content: pi?.content || '',
    elements: Array.isArray(pi?.elements) ? pi.elements : [],
    links: Array.isArray(pi?.links) ? pi.links : [],
    images: Array.isArray(pi?.images) ? pi.images : [],
    videos: Array.isArray(pi?.videos) ? pi.videos : []
  };
}

interface QueuedAction {
  id: string;
  kind: 'navigate' | 'perform';
  payload: any;
  createdAt: number;
  retries: number;
}

const ACTION_COOLDOWN_MS = 350;
const MAX_RETRIES = 2;

const log = getClientLogger('BrowserAutomation');

const RealBrowserView = ({ sessionId, initialUrl = 'https://www.google.com', onClose, onNavigationReady, supportedFeatures }: RealBrowserViewProps) => {
  // Perform feature flag check BEFORE any hook calls to allow shallow render in tests without React hook initialization
  if (!isFeatureEnabled('browserAutomation', supportedFeatures)) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground" role="alert" aria-live="polite">
        Browser Automation disabled
      </div>
    );
  }
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [history, setHistory] = useState<string[]>([initialUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Enhancement state (flag previously checked early)
  const [placeholder, setPlaceholder] = useState('Enter URL or: "open cnn"');
  const [inputFocused, setInputFocused] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [actionFlash, setActionFlash] = useState<{ id: string; kind: string; at: number } | null>(null);
  const placeholderExamples = useRef<string[]>([
    'open cnn',
    'navigate to wikipedia',
    'weather in paris',
    'search latest ai news',
    'visit hacker news'
  ]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Queue infra
  const lastActionTimeRef = useRef(0);
  const queueRef = useRef<QueuedAction[]>([]);
  const cancelledRef = useRef(false);

  // Rotate placeholder examples
  useEffect(() => {
    if (inputFocused) return;
    const interval = setInterval(() => {
      setPlaceholder(prev => {
        const token = prev.replace('Enter URL or: "', '').replace('"', '');
        const idx = placeholderExamples.current.indexOf(token);
        const next = placeholderExamples.current[(idx + 1) % placeholderExamples.current.length];
        return `Enter URL or: "${next}"`;
      });
    }, 6000);
    return () => clearInterval(interval);
  }, [inputFocused]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!errorToast) return;
    const t = setTimeout(() => setErrorToast(null), 5000);
    return () => clearTimeout(t);
  }, [errorToast]);

  // Action flash lifecycle
  useEffect(() => { if (actionFlash) { const t = setTimeout(() => setActionFlash(null), 1200); return () => clearTimeout(t); } }, [actionFlash]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'l') { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); }
      if (e.metaKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
      if (e.metaKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Debug initialUrl changes
  useEffect(() => { log.debug('RealBrowserView initialUrl prop changed', { initialUrl }); }, [initialUrl]);

  // Handle initialUrl prop change
  useEffect(() => {
    if (sessionActive && initialUrl && currentUrl !== initialUrl) {
      enqueueNavigate(initialUrl);
    }
  }, [initialUrl, sessionActive, currentUrl]);

  // Session init / cleanup
  useEffect(() => {
    if (!sessionActive) {
      initializeBrowserSession();
    }
    return () => { cancelledRef.current = true; closeBrowserSession(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Queue processor loop
  useEffect(() => {
    let active = true;
    const loop = async () => {
      if (!active) return;
      const now = Date.now();
      const elapsed = now - lastActionTimeRef.current;
      const next = queueRef.current[0];
      if (next && elapsed >= ACTION_COOLDOWN_MS && sessionActive) {
        queueRef.current.shift();
        dispatchBrowserEvent('browser.queue.dequeue', { id: next.id, kind: next.kind });
        try {
          lastActionTimeRef.current = Date.now();
            if (next.kind === 'navigate') await internalNavigate(next.payload.url, true);
            else await internalPerformAction(next.payload.actionData, true);
            dispatchBrowserEvent('browser.action.success', { id: next.id, kind: next.kind });
        } catch (e) {
          if (next.retries < MAX_RETRIES) {
            queueRef.current.push({ ...next, retries: next.retries + 1 });
            dispatchBrowserEvent('browser.action.retry', { id: next.id, attempt: next.retries + 1 });
          } else {
            dispatchBrowserEvent('browser.action.failed', { id: next.id, error: String(e) });
          }
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => { active = false; };
  }, [sessionActive]);

  const enqueueNavigate = (url: string) => {
    const id = crypto.randomUUID();
    queueRef.current.push({ id, kind: 'navigate', payload: { url }, createdAt: Date.now(), retries: 0 });
    dispatchBrowserEvent('browser.queue.enqueue', { id, kind: 'navigate', size: queueRef.current.length });
  };
  const enqueueAction = (actionData: any) => {
    const id = crypto.randomUUID();
    queueRef.current.push({ id, kind: 'perform', payload: { actionData }, createdAt: Date.now(), retries: 0 });
    dispatchBrowserEvent('browser.queue.enqueue', { id, kind: 'perform', size: queueRef.current.length });
    setActionFlash({ id, kind: 'perform', at: Date.now() });
  };

  // Expose queue for debugging
  useEffect(() => { (window as any).activeBrowserQueue = queueRef; return () => { delete (window as any).activeBrowserQueue; }; }, []);

  // Global navigation exposure
  useEffect(() => {
    if (sessionActive && onNavigationReady) onNavigationReady(navigateToUrl);
    if (sessionActive) {
      (window as any)[`browserNavigate_${sessionId}`] = navigateToUrl;
      (window as any)[`browserParseUrl_${sessionId}`] = parseNavigationRequest;
      (window as any).activeBrowserNavigate = navigateToUrl;
      (window as any).activeBrowserParseUrl = parseNavigationRequest;
      (window as any).activeBrowserSessionId = sessionId;
      (window as any).activeBrowserSessionActive = true;
      return () => {
        delete (window as any)[`browserNavigate_${sessionId}`];
        delete (window as any)[`browserParseUrl_${sessionId}`];
        delete (window as any).activeBrowserNavigate;
        delete (window as any).activeBrowserParseUrl;
        delete (window as any).activeBrowserSessionId;
        delete (window as any).activeBrowserSessionActive;
      };
    }
    return () => {};
  }, [sessionActive, onNavigationReady, sessionId]);

  // Screenshot update listener
  useEffect(() => {
    const handleScreenshotUpdate = (event: CustomEvent) => {
      if (event.detail?.screenshot) {
        setScreenshot(event.detail.screenshot);
        if (event.detail.url) {
          setCurrentUrl(event.detail.url);
          setInputUrl(event.detail.url);
        }
      }
    };
    window.addEventListener('browserScreenshotUpdate', handleScreenshotUpdate as EventListener);
    return () => window.removeEventListener('browserScreenshotUpdate', handleScreenshotUpdate as EventListener);
  }, []);

  const initializeBrowserSession = async () => {
    try {
      setIsLoading(true);
      setError(null);
      if (typeof window !== 'undefined' && navigator.userAgent.includes('Win')) {
        const systemCheckResponse = await fetch('/api/browser-control-simple', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'system_check', sessionId: sessionId + '-check' })
        });
        const systemCheck = await systemCheckResponse.json();
        if (!systemCheck.success || (systemCheck.system?.launchTest && systemCheck.system.launchTest.includes('Failed'))) {
          throw new Error('WSL2_DEPENDENCIES_MISSING');
        }
      }
      const response = await fetch('/api/browser-control-simple', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_session', sessionId, initialUrl })
      });
      if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
      const result = await response.json();
      if (result.success) {
        setSessionActive(true);
        if (result.screenshot) {
          setScreenshot(result.screenshot);
          const actualUrl = result.pageInfo?.url || initialUrl;
          setCurrentUrl(actualUrl);
          setInputUrl(actualUrl);
          if (result.pageInfo) setPageInfo(normalizePageInfo(result.pageInfo)); // normalized
        } else {
          await navigateToUrl(initialUrl);
        }
        (window as any).activeBrowserNavigate = navigateToUrl;
        (window as any).activeBrowserParseUrl = parseNavigationRequest;
        (window as any).activeBrowserSessionId = sessionId;
        (window as any).activeBrowserSessionActive = true;
      } else {
        throw new Error(result.error || 'Failed to create browser session');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Browser automation failed: ${msg}.`);
      setSessionActive(false);
      delete (window as any).activeBrowserNavigate;
      delete (window as any).activeBrowserParseUrl;
      delete (window as any).activeBrowserSessionId;
      delete (window as any).activeBrowserSessionActive;
      setErrorToast(`Browser automation failed: ${msg}`); // include prefix for consistency with full error panel
    } finally { setIsLoading(false); }
  };

  const parseNavigationRequest = (input: string): string => {
    const trimmedInput = input.trim().toLowerCase();
    const siteMap: Record<string, string> = {
      cnn: 'cnn.com', bbc: 'bbc.com', 'fox news': 'foxnews.com', reuters: 'reuters.com', 'ap news': 'apnews.com', npr: 'npr.org', cbs: 'cbsnews.com', nbc: 'nbcnews.com', abc: 'abcnews.go.com', google: 'google.com', bing: 'bing.com', yahoo: 'yahoo.com', duckduckgo: 'duckduckgo.com', facebook: 'facebook.com', twitter: 'twitter.com', instagram: 'instagram.com', linkedin: 'linkedin.com', youtube: 'youtube.com', tiktok: 'tiktok.com', reddit: 'reddit.com', github: 'github.com', 'stack overflow': 'stackoverflow.com', 'hacker news': 'news.ycombinator.com', techcrunch: 'techcrunch.com', verge: 'theverge.com', wired: 'wired.com', amazon: 'amazon.com', ebay: 'ebay.com', walmart: 'walmart.com', target: 'target.com', etsy: 'etsy.com', wikipedia: 'wikipedia.org', dictionary: 'dictionary.com', imdb: 'imdb.com', netflix: 'netflix.com', hulu: 'hulu.com', spotify: 'spotify.com', twitch: 'twitch.tv', bloomberg: 'bloomberg.com', cnbc: 'cnbc.com', marketwatch: 'marketwatch.com', 'yahoo finance': 'finance.yahoo.com', craigslist: 'craigslist.org', zillow: 'zillow.com', weather: 'weather.com', gmail: 'gmail.com', outlook: 'outlook.com'
    };
    for (const [siteName, siteUrl] of Object.entries(siteMap)) {
      if (trimmedInput === siteName ||
        trimmedInput.includes(`go to ${siteName}`) ||
        trimmedInput.includes(`load ${siteName}`) ||
        trimmedInput.includes(`open ${siteName}`) ||
        trimmedInput.includes(`show me ${siteName}`) ||
        trimmedInput.includes(`navigate to ${siteName}`) ||
        trimmedInput.includes(`visit ${siteName}`)) return `https://${siteUrl}`;
    }
    for (const [siteName, siteUrl] of Object.entries(siteMap)) { if (trimmedInput.includes(siteName)) return `https://${siteUrl}`; }
    if (trimmedInput.includes('.') && !trimmedInput.includes(' ')) return `https://${trimmedInput}`;
    if (trimmedInput.match(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)) return `https://${trimmedInput}`;
    return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
  };

  const internalNavigate = async (url: string, fromQueue = false) => {
    if (!sessionActive) return;
    try {
      setIsLoading(true); setError(null);
      let targetUrl = url;
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) targetUrl = parseNavigationRequest(targetUrl);
      const response = await fetch('/api/browser-control-simple', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'navigate', sessionId, url: targetUrl }) });
      const result = await response.json();
      if (result.success) {
        setCurrentUrl(targetUrl); setInputUrl(targetUrl); setScreenshot(result.screenshot);
        const newHistory = history.slice(0, historyIndex + 1); newHistory.push(targetUrl); setHistory(newHistory); setHistoryIndex(newHistory.length - 1);
        await getPageInfo();
        if (!fromQueue) window.dispatchEvent(new CustomEvent('browserNavigateImmediate', { detail: { url: targetUrl } }));
      } else { setError(result.error || 'Navigation failed'); throw new Error(result.error || 'Navigation failed'); }
    } catch (e) { setError('Failed to navigate to URL'); throw e; } finally { setIsLoading(false); }
  };

  const navigateToUrl = async (url: string) => { enqueueNavigate(url); window.dispatchEvent(new CustomEvent('browser.navigate.request', { detail: { url } })); };

  const getPageInfo = async () => {
    if (!sessionActive) return;
    try {
      const response = await fetch('/api/browser-control-simple', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_page_info', sessionId }) });
      const result = await response.json();
      if (result.success && result.data) {
        setPageInfo(normalizePageInfo(result.data));
      }
    } catch (e) { /* ignore */ }
  };

  const internalPerformAction = async (actionData: { type: 'click' | 'type' | 'scroll' | 'hover' | 'wait'; selector?: string; text?: string; coordinates?: { x: number; y: number }; waitTime?: number; }, fromQueue = false) => {
    if (!sessionActive) return;
    try {
      setIsLoading(true);
      const response = await fetch('/api/browser-control-simple', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'perform_action', sessionId, actionData }) });
      const result = await response.json();
      if (result.success) { setScreenshot(result.screenshot); await getPageInfo(); }
      else { setError(result.error || 'Action failed'); throw new Error(result.error || 'Action failed'); }
      if (!fromQueue) window.dispatchEvent(new CustomEvent('browserActionImmediate', { detail: { action: actionData } }));
    } catch (e) { setError('Failed to perform action'); throw e; } finally { setIsLoading(false); }
  };
  const performAction = async (actionData: { type: 'click' | 'type' | 'scroll' | 'hover' | 'wait'; selector?: string; text?: string; coordinates?: { x: number; y: number }; waitTime?: number; }) => { enqueueAction(actionData); dispatchBrowserEvent('browser.action.request', { action: actionData }); };

  const closeBrowserSession = async () => {
    if (!sessionActive) return;
    try {
      await fetch('/api/browser-control-simple', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'close_session', sessionId }) });
      setSessionActive(false); dispatchBrowserEvent('browser.session.closed', { sessionId });
    } catch (e) { dispatchBrowserEvent('browser.session.close_error', { sessionId, error: String(e) }); }
  };

  const handleUrlSubmit = (e: React.FormEvent) => { e.preventDefault(); navigateToUrl(inputUrl || placeholder.replace('Enter URL or: "','').replace('"','')); };
  const goBack = () => { if (historyIndex > 0) { const newIndex = historyIndex - 1; setHistoryIndex(newIndex); navigateToUrl(history[newIndex]); } };
  const goForward = () => { if (historyIndex < history.length - 1) { const newIndex = historyIndex + 1; setHistoryIndex(newIndex); navigateToUrl(history[newIndex]); } };
  const refresh = () => { navigateToUrl(currentUrl); };
  const takeScreenshot = async () => { performAction({ type: 'wait', waitTime: 100 }); };

  // Quick links overlay
  const topLinks = (pageInfo?.links || []).slice(0, 5);
  const handleQuickLink = useCallback((url: string) => { navigateToUrl(url); }, [navigateToUrl]);

  return (
    <div className="flex flex-col h-full bg-background rounded-lg overflow-hidden relative text-foreground">
      {/* Error Toast */}
      {errorToast && (
        <div role="alert" aria-live="assertive" className="absolute top-2 right-2 bg-destructive/90 text-destructive-foreground px-4 py-2 rounded shadow z-50 flex items-center gap-2">
          <span className="text-sm">{errorToast}</span>
          <button aria-label="Dismiss error" className="text-xs font-bold" onClick={() => setErrorToast(null)}>×</button>
        </div>
      )}
      {/* Action Flash */}
      {actionFlash && (
        <div data-testid="action-flash" className="pointer-events-none absolute top-14 right-4 bg-primary/80 text-primary-foreground text-xs px-3 py-1 rounded-full animate-pulse z-40" aria-hidden="true">Action queued</div>
      )}
      {/* Quick Links Overlay */}
      {topLinks.length > 0 && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-popover/80 backdrop-blur text-popover-foreground rounded-lg px-3 py-2 flex gap-3 text-xs z-30 overflow-x-auto max-w-full">
          {topLinks.map(l => (
            <button key={l.url} aria-label={`Navigate to ${l.text || l.url}`} onClick={() => handleQuickLink(l.url)} className="hover:bg-accent px-2 py-1 rounded whitespace-nowrap transition-colors" >{(l.text || l.url).slice(0,28)}</button>
          ))}
        </div>
      )}
      {/* Browser Header */}
      <div className="bg-muted border-b border-border p-3" role="toolbar" aria-label="Browser controls">
        <div className="flex items-center space-x-2 mb-2">
          <button onClick={goBack} aria-label="Go Back" disabled={historyIndex <= 0} className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" title="Go Back"><ArrowLeft className="w-4 h-4 text-gray-300" /></button>
          <button onClick={goForward} aria-label="Go Forward" disabled={historyIndex >= history.length - 1} className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" title="Go Forward"><ArrowRight className="w-4 h-4 text-gray-300" /></button>
          <button onClick={refresh} aria-label="Refresh" disabled={isLoading} className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 transition-colors" title="Refresh"><RotateCcw className="w-4 h-4 text-gray-300" /></button>
          <button onClick={() => navigateToUrl('https://www.google.com')} aria-label="Home" className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors" title="Home"><Home className="w-4 h-4 text-gray-300" /></button>
          <button onClick={takeScreenshot} aria-label="Take Screenshot" disabled={isLoading} className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 transition-colors" title="Take Screenshot"><Camera className="w-4 h-4 text-gray-300" /></button>
          {onClose && (<button onClick={onClose} aria-label="Close Browser" className="p-2 rounded-lg bg-red-600 hover:bg-red-500 transition-colors ml-auto" title="Close Browser"><X className="w-4 h-4 text-white" /></button>)}
        </div>
        <form onSubmit={handleUrlSubmit} className="flex space-x-2" aria-label="Address bar">
          <div className="flex-1 relative">
            <input ref={inputRef} type="text" value={inputUrl} onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)} onChange={(e) => setInputUrl(e.target.value)} className="w-full px-4 py-2 bg-gray-700 text-gray-200 rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none" placeholder={placeholder} aria-label="URL or natural language query" disabled={isLoading} />
            {sessionActive && (<div className="absolute right-3 top-1/2 transform -translate-y-1/2" aria-label="Session active indicator"><div className="w-2 h-2 bg-green-400 rounded-full"></div></div>)}
          </div>
          <button type="submit" disabled={isLoading} aria-label="Navigate" className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors">Go</button>
        </form>
        <div className="flex items-center justify-between mt-2 text-sm text-gray-400">
          <div className="flex items-center space-x-4"><span>Session: {sessionActive ? 'Active' : 'Inactive'}</span>{pageInfo && (<span>Elements: {pageInfo.elements?.length || 0}</span>)}</div>
          {currentUrl && (<div className="flex items-center space-x-2"><span className="text-green-400">●</span><span className="truncate max-w-md">{currentUrl}</span></div>)}
        </div>
      </div>
      <div className="flex-1 relative bg-card" style={{ pointerEvents: 'auto' }}>
        {/* Initial skeleton */}
        {isLoading && !screenshot && !error && (
          <div className="absolute inset-0 grid place-items-center bg-card">
            <div className="space-y-4 w-2/3 max-w-md">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-6 w-5/6" />
              <Skeleton className="h-40 w-full" />
            </div>
          </div>
        )}
        {error ? (
          <div className="flex items-center justify-center h-full bg-destructive/10">
            <div className="text-center p-8">
              <div className="text-destructive text-6xl mb-4">⚠️</div>
              <h3 className="text-lg font-semibold mb-2">Browser Error</h3>
              <p className="text-muted-foreground mb-4 max-w-md">{error}</p>
              <div className="space-x-2">
                <button onClick={() => { setError(null); initializeBrowserSession(); }} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">Retry</button>
                <button onClick={async () => { try { const response = await fetch('/api/browser-control-simple', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'system_check', sessionId: 'diagnostic' }) }); const result = await response.json(); log.info('System check result', { success: result?.success, details: result }); alert('System check complete. Check logs for details.'); } catch (e) { log.error('System check failed', { error: e instanceof Error ? e.message : e }); alert('System check failed.'); } }} className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90 transition-colors">System Check</button>
              </div>
            </div>
          </div>
        ) : screenshot ? (
          <div className="relative w-full h-full" style={{ pointerEvents: 'auto' }}>
            <img src={screenshot} alt="Browser Screenshot" className="w-full h-full object-contain bg-card" style={{ pointerEvents: 'auto' }} />
            {isLoading && (
              <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                  <p className="text-sm">Loading...</p>
                  <p className="text-xs text-muted-foreground mt-1">Queue: {queueRef.current.length}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full bg-card">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-sm text-muted-foreground">Initializing browser session...</p>
            </div>
          </div>
        )}
      </div>
      {process.env.NODE_ENV === 'development' && pageInfo && (
        <div className="bg-muted border-t border-border p-2 max-h-32 overflow-y-auto">
          <div className="text-xs text-muted-foreground">
            <div><strong>Title:</strong> {pageInfo.title}</div>
            <div><strong>URL:</strong> {pageInfo.url}</div>
            <div><strong>Interactive Elements:</strong> {pageInfo.elements.length}</div>
            <div><strong>Links:</strong> {pageInfo.links?.length || 0}</div>
            <div><strong>Images:</strong> {pageInfo.images?.length || 0}</div>
            <div><strong>Videos:</strong> {pageInfo.videos?.length || 0}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RealBrowserView;