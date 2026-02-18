'use client';

// Feature: MiniBrowser
import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, ArrowRight, RotateCcw, Home, Shield, AlertTriangle, Globe } from 'lucide-react';
import { usePostHog } from 'posthog-js/react';

interface MiniBrowserViewProps { initialUrl?: string; }

const MiniBrowserView: React.FC<MiniBrowserViewProps> = ({ initialUrl = 'https://www.google.com' }) => {
  const posthog = usePostHog();
  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([initialUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (initialUrl && initialUrl !== url) {
      setIsLoading(true); setError(null); setUrl(initialUrl); setInputUrl(initialUrl);
      setHistory(prev => [...prev, initialUrl]); setHistoryIndex(prev => prev + 1);
    }
  }, [initialUrl, url]);

  const navigateToUrl = (targetUrl: string) => {
    let finalUrl = targetUrl;
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      if (finalUrl.includes('.') && !finalUrl.includes(' ')) finalUrl = `https://${finalUrl}`;
      else finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}`;
    }
    
    posthog?.capture('browser_navigated', { url: finalUrl });
    
    setIsLoading(true); setError(null); setUrl(finalUrl); setInputUrl(finalUrl);
    const newHistory = history.slice(0, historyIndex + 1); newHistory.push(finalUrl);
    setHistory(newHistory); setHistoryIndex(newHistory.length - 1);
  };

  const handleUrlSubmit = (e: React.FormEvent) => { e.preventDefault(); navigateToUrl(inputUrl); };
  const goBack = () => { if (historyIndex > 0) { const i = historyIndex - 1; setHistoryIndex(i); const t = history[i]; setUrl(t); setInputUrl(t); setIsLoading(true); setError(null);} };
  const goForward = () => { if (historyIndex < history.length - 1) { const i = historyIndex + 1; setHistoryIndex(i); const t = history[i]; setUrl(t); setInputUrl(t); setIsLoading(true); setError(null);} };
  const refresh = () => { setIsLoading(true); setError(null); if (iframeRef.current) iframeRef.current.src = url; };
  const goHome = () => navigateToUrl('https://www.google.com');
  const handleIframeLoad = () => { setIsLoading(false); setError(null); };
  const handleIframeError = () => { setIsLoading(false); setError('Failed to load page. This might be due to CORS restrictions or the site blocking iframe embedding.'); };
  const isSecure = url.startsWith('https://'); const domain = url.replace(/^https?:\/\//, '').split('/')[0];

  return (
    <div className="w-full h-full bg-black flex flex-col">
      <div className="bg-gray-900 border-b border-gray-700 p-2">
        <div className="flex items-center space-x-2 mb-2">
          <button onClick={goBack} disabled={historyIndex <= 0} className="p-2 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-gray-300" title="Go Back"><ArrowLeft className="w-4 h-4" /></button>
          <button onClick={goForward} disabled={historyIndex >= history.length - 1} className="p-2 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-gray-300" title="Go Forward"><ArrowRight className="w-4 h-4" /></button>
          <button onClick={refresh} className="p-2 rounded hover:bg-gray-700 transition-colors text-gray-300" title="Refresh"><RotateCcw className="w-4 h-4" /></button>
          <button onClick={goHome} className="p-2 rounded hover:bg-gray-700 transition-colors text-gray-300" title="Home"><Home className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleUrlSubmit} className="flex items-center space-x-2">
          <div className="flex items-center bg-gray-800 border border-gray-600 rounded-lg flex-1 px-3 py-2">
            <div className="flex items-center mr-2">{isSecure ? <Shield className="w-4 h-4 text-green-500" /> : <AlertTriangle className="w-4 h-4 text-orange-400" />}</div>
            <input type="text" value={inputUrl} onChange={e => setInputUrl(e.target.value)} className="flex-1 outline-none text-sm bg-transparent text-gray-200 placeholder-gray-400" placeholder="Enter URL or search term..." />
            {isLoading && <div className="ml-2"><div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div></div>}
          </div>
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors">Go</button>
        </form>
        <div className="flex items-center mt-2 text-xs text-gray-400">
          <Globe className="w-3 h-3 mr-1" /><span>{domain}</span>{isSecure && <span className="ml-2 text-green-500">• Secure</span>}
        </div>
      </div>
      <div className="flex-1 relative">
        {error ? (
          <div className="flex items-center justify-center h-full bg-gray-800">
            <div className="text-center p-8">
              <AlertTriangle className="w-16 h-16 text-orange-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-200 mb-2">Page Load Error</h3>
              <p className="text-gray-400 mb-4 max-w-md">{error}</p>
              <div className="space-y-2">
                <button onClick={refresh} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors">Try Again</button>
                <p className="text-sm text-gray-500">Tip: Try searching instead, or visit sites that allow iframe embedding</p>
              </div>
            </div>
          </div>
        ) : (
          <iframe ref={iframeRef} src={url} className="w-full h-full border-none" onLoad={handleIframeLoad} onError={handleIframeError} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-top-navigation" referrerPolicy="strict-origin-when-cross-origin" title="Mini Browser Content" />
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
          <span>Mini Browser - Some sites may not work due to security restrictions</span>
          <span>{url}</span>
        </div>
      </div>
    </div>
  );
};

export default MiniBrowserView;
