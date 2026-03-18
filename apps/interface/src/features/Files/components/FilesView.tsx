'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { requestWindowOpen } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';

/**
 * FilesView — wraps the filebrowser iframe but intercepts .md file clicks
 * to open them in the Notes app instead.
 */
export default function FilesView() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen for postMessage from filebrowser iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Check if the message indicates a file was opened
      if (event.data?.type === 'fileOpen' && typeof event.data.path === 'string') {
        const filePath: string = event.data.path;
        if (filePath.endsWith('.md')) {
          // Extract filename without extension as note ID
          const parts = filePath.split('/');
          const filename = parts[parts.length - 1];
          const noteId = filename.replace(/\.md$/, '');
          
          // Open in Notes app — dispatch event then open window
          window.dispatchEvent(new CustomEvent('openNoteFromFile', { detail: { noteId } }));
          requestWindowOpen({
            viewType: 'notes',
            source: 'filebrowser:md-click',
          });
          return;
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', background: '#1a1a2e' }}>
      <iframe
        ref={iframeRef}
        src="/filebrowser/"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          colorScheme: 'dark',
        }}
        title="Files"
        allow="fullscreen"
      />
    </div>
  );
}
