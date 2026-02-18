'use client';

import React, { useCallback, useState } from 'react';
import type { CodeContent } from '../types';

interface Props {
  content: CodeContent;
}

export default function CodeRenderer({ content }: Props) {
  const { data } = content;
  const [copied, setCopied] = useState(false);

  const lines = data.code.split('\n');

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(data.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [data.code]);

  return (
    <div className="canvas-code px-6 py-4">
      {content.title && (
        <h2 className="text-xl font-bold text-slate-100 mb-4">{content.title}</h2>
      )}
      <div className="relative bg-slate-900/80 border border-slate-700/40 rounded-xl overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-800/60 border-b border-slate-700/40">
          <div className="flex items-center gap-2">
            {data.filename && (
              <span className="text-sm text-slate-300 font-mono">{data.filename}</span>
            )}
            {data.language && !data.filename && (
              <span className="text-xs text-slate-500 font-mono uppercase">{data.language}</span>
            )}
          </div>
          <button
            onClick={handleCopy}
            className="text-xs px-2.5 py-1 rounded bg-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>

        {/* Code */}
        <div className="overflow-x-auto">
          <pre className="p-4 text-sm font-mono leading-relaxed">
            {lines.map((line, i) => {
              const lineNum = i + 1;
              const highlighted = data.highlightLines?.includes(lineNum);
              return (
                <div
                  key={i}
                  className={`flex ${highlighted ? 'bg-indigo-500/10 -mx-4 px-4' : ''}`}
                >
                  <span className="inline-block w-10 text-right pr-4 text-slate-600 select-none flex-shrink-0">
                    {lineNum}
                  </span>
                  <span className="text-slate-300 whitespace-pre">{line}</span>
                </div>
              );
            })}
          </pre>
        </div>
      </div>
    </div>
  );
}
