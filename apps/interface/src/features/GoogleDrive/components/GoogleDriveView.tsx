'use client';

// Feature: GoogleDrive
// A lightweight view component for Google Drive access. Currently attempts to load
// drive.google.com in an iframe (will be blocked) and provides a fallback UI and
// a button to open Drive in a new tab.

import { ExternalLink, AlertTriangle, Cloud } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { usePostHog } from 'posthog-js/react';

const GoogleDriveView: React.FC = () => {
  const posthog = usePostHog();
  const [iframeError, setIframeError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
    posthog?.capture('drive_open_in_new_tab');
    window.open('https://drive.google.com', '_blank', 'noopener,noreferrer');
  };

  if (iframeError) {
    return (
      <div className="w-full h-full bg-gray-50 flex items-center justify-center">
        <div className="text-center p-8 max-w-md">
          <AlertTriangle className="w-16 h-16 text-orange-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-800 mb-3">
            Google Drive Cannot Be Embedded
          </h3>
          <p className="text-gray-600 mb-6 leading-relaxed">
            Google Drive blocks iframe embedding for security reasons. However, you can still access it by opening it in a new tab.
          </p>
          <div className="space-y-4">
            <button
              onClick={openInNewTab}
              className="flex items-center justify-center w-full px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
            >
              <ExternalLink className="w-5 h-5 mr-2" />
              Open Google Drive in New Tab
            </button>
            <div className="text-sm text-gray-500">
              <p className="mb-2">Alternative options:</p>
              <ul className="space-y-1 text-left">
                <li>• Use the Google Drive mobile app</li>
                <li>• Access through Gmail (Drive integration)</li>
                <li>• Try the Google Drive API for developers</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-white flex flex-col">
      <div className="bg-blue-600 text-white p-4 flex items-center justify-between">
        <div className="flex items-center">
          <Cloud className="w-6 h-6 mr-3" />
          <div>
            <h2 className="text-lg font-semibold">Google Drive</h2>
            <p className="text-blue-100 text-sm">Your files in the cloud</p>
          </div>
        </div>
        <button
          onClick={openInNewTab}
          className="flex items-center px-3 py-2 bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors text-sm"
        >
          <ExternalLink className="w-4 h-4 mr-1" />
          Open in New Tab
        </button>
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600">Loading Google Drive...</p>
            <p className="text-sm text-gray-500 mt-2">This may take a moment</p>
          </div>
        </div>
      )}

      <div className="flex-1 relative">
        <iframe
          src="https://drive.google.com"
          className="w-full h-full border-none"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          referrerPolicy="strict-origin-when-cross-origin"
          title="Google Drive"
          style={{ display: loading ? 'none' : 'block' }}
        />
      </div>
    </div>
  );
};

export default GoogleDriveView;
