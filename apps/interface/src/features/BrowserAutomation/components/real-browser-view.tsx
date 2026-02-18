/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { ArrowLeft, ArrowRight, Camera, ExternalLink, Home, Loader2, RotateCcw, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface RealBrowserViewProps {
  sessionId: string;
  initialUrl?: string;
  onClose?: () => void;
  onNavigationReady?: (navigateFunction: (url: string) => Promise<void>) => void;
}

// Simplified page info (extend as parity work continues)
interface PageInfo {
  title?: string;
  url?: string;
}

export const RealBrowserView: React.FC<RealBrowserViewProps> = ({
  sessionId,
  initialUrl = 'https://www.google.com',
  onClose,
  onNavigationReady,
}) => {
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([initialUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const mountedRef = useRef(false);

  // Basic navigation logic
  const navigateToUrl = useCallback(async (target: string) => {
    let finalUrl = target.trim();
    if (!finalUrl) return;
    if (!/^https?:\/\//i.test(finalUrl)) {
      if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
        finalUrl = 'https://' + finalUrl;
      } else {
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}`;
      }
    }
    setIsLoading(true);
    setError(null);
    try {
      setCurrentUrl(finalUrl);
      setInputUrl(finalUrl);
      setHistory(prev => {
        const next = prev.slice(0, historyIndex + 1).concat(finalUrl);
        setHistoryIndex(next.length - 1);
        return next;
      });
    } catch (e: any) {
      setError(e.message || 'Navigation failed');
    } finally {
      setIsLoading(false);
    }
  }, [historyIndex]);

  // Expose navigate function
  useEffect(() => {
    if (onNavigationReady) onNavigationReady(navigateToUrl);
    (window as any)[`browserNavigate_${sessionId}`] = navigateToUrl;
    return () => { delete (window as any)[`browserNavigate_${sessionId}`]; };
  }, [navigateToUrl, onNavigationReady, sessionId]);

  // Apply navigation to iframe
  useEffect(() => {
    if (!iframeRef.current) return;
    iframeRef.current.src = currentUrl;
  }, [currentUrl]);

  // Listen for synthetic screenshot events (parity placeholder)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.screenshot) setScreenshot(detail.screenshot);
    };
    window.addEventListener('browserScreenshotUpdate', handler as EventListener);
    return () => window.removeEventListener('browserScreenshotUpdate', handler as EventListener);
  }, []);

  // Back / Forward / Reload
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;
  const goBack = () => { if (canGoBack) { const idx = historyIndex - 1; setHistoryIndex(idx); setCurrentUrl(history[idx]); setInputUrl(history[idx]); } };
  const goForward = () => { if (canGoForward) { const idx = historyIndex + 1; setHistoryIndex(idx); setCurrentUrl(history[idx]); setInputUrl(history[idx]); } };
  const reload = () => { setCurrentUrl(prev => prev); };
  const goHome = () => navigateToUrl(initialUrl);

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); navigateToUrl(inputUrl); };

  return (
    <div className="flex flex-col w-full h-full border rounded-md overflow-hidden bg-background">
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/40">
        <button onClick={goBack} disabled={!canGoBack} className="p-1 disabled:opacity-30" aria-label="Back"><ArrowLeft size={16} /></button>
        <button onClick={goForward} disabled={!canGoForward} className="p-1 disabled:opacity-30" aria-label="Forward"><ArrowRight size={16} /></button>
        <button onClick={reload} className="p-1" aria-label="Reload"><RotateCcw size={16} /></button>
        <button onClick={goHome} className="p-1" aria-label="Home"><Home size={16} /></button>
        <form onSubmit={handleSubmit} className="flex-1 flex items-center ml-2 mr-2">
          <input
            value={inputUrl}
            onChange={e => setInputUrl(e.target.value)}
            className="w-full text-xs px-2 py-1 border rounded bg-background focus:outline-none"
            placeholder="Enter URL or search"
          />
        </form>
        {isLoading && <Loader2 size={16} className="animate-spin" />}
        {onClose && <button onClick={onClose} className="p-1" aria-label="Close"><X size={16} /></button>}
      </div>
      {error && <div className="text-xs text-red-500 px-2 py-1 border-b">{error}</div>}
      <div className="flex-1 relative bg-black/5">
        <iframe ref={iframeRef} title="Real Browser" className="w-full h-full" sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups" />
        {screenshot && (
          <div className="absolute bottom-2 right-2 border bg-background shadow p-1">
            <img src={screenshot} alt="Screenshot" className="max-w-[200px] max-h-[140px]" />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-2 py-1 border-t bg-muted/40 text-xs">
        <span className="truncate" title={currentUrl}>{currentUrl}</span>
        <div className="ml-auto flex gap-1">
          <button className="p-1" aria-label="Open in new tab" onClick={() => window.open(currentUrl, '_blank') }><ExternalLink size={14} /></button>
          <button className="p-1" aria-label="Capture (placeholder)"><Camera size={14} /></button>
        </div>
      </div>
    </div>
  );
};
