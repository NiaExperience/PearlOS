'use client';

import React, { useCallback, useMemo, useRef } from 'react';
import type { HtmlContent } from '../types';

interface Props {
  content: HtmlContent;
}

/**
 * Sandboxed iframe renderer for raw HTML content.
 * Similar to the existing AppletCreationEngine / ExperienceRenderer.
 */
export default function HtmlRenderer({ content }: Props) {
  const { data } = content;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const srcdoc = useMemo(() => {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%; height: 100%;
      background: transparent;
      color: #e0e0e8;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      overflow: auto;
    }
    ${data.css || ''}
  </style>
</head>
<body>
  ${data.html}
  ${data.js ? `<script>${data.js}<\/script>` : ''}
</body>
</html>`;
  }, [data]);

  return (
    <div className="canvas-html flex flex-col h-full">
      {content.title && (
        <h2 className="text-xl font-bold text-slate-100 px-6 pt-4 pb-2">{content.title}</h2>
      )}
      <div className="flex-1 mx-4 mb-4 rounded-lg overflow-hidden border border-slate-700/40">
        <iframe
          ref={iframeRef}
          srcDoc={srcdoc}
          sandbox="allow-scripts"
          className="w-full h-full border-0 bg-transparent"
          title={content.title || 'HTML Content'}
        />
      </div>
    </div>
  );
}
