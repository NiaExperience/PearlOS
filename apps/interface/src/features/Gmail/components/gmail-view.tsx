'use client';

import { ExternalLink, AlertTriangle, Mail, Inbox } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { usePostHog } from 'posthog-js/react';

const GmailView = () => {
  const posthog = usePostHog();
  const [iframeError, setIframeError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set a timeout to handle CORS issues
    const timer = setTimeout(() => {
      if (loading) {
        setIframeError(true);
        setLoading(false);
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [loading]);

  const handleIframeLoad = () => {
    setLoading(false);
    setIframeError(false);
  };

  const handleIframeError = () => {
    setLoading(false);
    setIframeError(true);
  };

  const openInNewTab = () => {
    posthog?.capture('gmail_open_in_new_tab');
    window.open('https://mail.google.com', '_blank', 'noopener,noreferrer');
  };

  if (iframeError) {
    return (
      <div className="w-full h-full bg-gray-50 flex items-center justify-center">
        <div className="text-center p-8 max-w-md">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-800 mb-3">
            Gmail Cannot Be Embedded
          </h3>
          <p className="text-gray-600 mb-6 leading-relaxed">
            Gmail blocks iframe embedding for security reasons. However, you can still access your email by opening it in a new tab.
          </p>
          
          <div className="space-y-4">
            <button
              onClick={openInNewTab}
              className="flex items-center justify-center w-full px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium"
            >
              <ExternalLink className="w-5 h-5 mr-2" />
              Open Gmail in New Tab
            </button>
            
            <div className="text-sm text-gray-500">
              <p className="mb-2">Alternative options:</p>
              <ul className="space-y-1 text-left">
                <li>• Use the Gmail mobile app</li>
                <li>• Try Gmail Lite (basic HTML version)</li>
                <li>• Use a dedicated email client</li>
                <li>• Access through Google Workspace</li>
              </ul>
            </div>
            
            <button
              onClick={() => {
                posthog?.capture('gmail_open_basic_html');
                window.open('https://mail.google.com/mail/u/0/h/', '_blank');
              }}
              className="flex items-center justify-center w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm"
            >
              <Mail className="w-4 h-4 mr-2" />
              Try Gmail Basic HTML
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-white flex flex-col">
      {/* Header */}
      <div className="bg-red-600 text-white p-4 flex items-center justify-between">
        <div className="flex items-center">
          <Mail className="w-6 h-6 mr-3" />
          <div>
            <h2 className="text-lg font-semibold">Gmail</h2>
            <p className="text-red-100 text-sm">Your email inbox</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              posthog?.capture('gmail_open_basic_html');
              window.open('https://mail.google.com/mail/u/0/h/', '_blank');
            }}
            className="flex items-center px-3 py-2 bg-red-700 rounded-lg hover:bg-red-800 transition-colors text-sm"
          >
            <Inbox className="w-4 h-4 mr-1" />
            Basic HTML
          </button>
          <button
            onClick={openInNewTab}
            className="flex items-center px-3 py-2 bg-red-700 rounded-lg hover:bg-red-800 transition-colors text-sm"
          >
            <ExternalLink className="w-4 h-4 mr-1" />
            Full Gmail
          </button>
        </div>
      </div>


      {/* Loading State */}
      {loading && (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600">Loading Gmail...</p>
            <p className="text-sm text-gray-500 mt-2">This may take a moment</p>
          </div>
        </div>
      )}

      {/* Iframe Content */}
      <div className="flex-1 relative">
        <iframe
          src="https://mail.google.com"
          className="w-full h-full border-none"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          referrerPolicy="strict-origin-when-cross-origin"
          title="Gmail"
          style={{ display: loading ? 'none' : 'block' }}
        />
      </div>
    </div>
  );
};

export default GmailView; 