'use client';

import React, { Suspense } from 'react';
import type { MarkdownContent } from '../types';

const ReactMarkdown = React.lazy(() => import('react-markdown'));

interface Props {
  content: MarkdownContent;
}

export default function MarkdownRenderer({ content }: Props) {
  return (
    <div className="canvas-markdown prose prose-invert prose-slate max-w-none px-6 py-4">
      {content.title && (
        <h1 className="text-2xl font-bold text-slate-100 mb-4 border-b border-slate-700/50 pb-3">
          {content.title}
        </h1>
      )}
      <Suspense fallback={<div className="text-slate-400 animate-pulse">Loading...</div>}>
        <ReactMarkdown
          components={{
            h1: ({ children }) => <h1 className="text-2xl font-bold text-slate-100 mt-6 mb-3">{children}</h1>,
            h2: ({ children }) => <h2 className="text-xl font-semibold text-slate-200 mt-5 mb-2">{children}</h2>,
            h3: ({ children }) => <h3 className="text-lg font-medium text-slate-300 mt-4 mb-2">{children}</h3>,
            p: ({ children }) => <p className="text-slate-300 leading-relaxed mb-3">{children}</p>,
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 underline">
                {children}
              </a>
            ),
            ul: ({ children }) => <ul className="list-disc list-inside text-slate-300 mb-3 space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal list-inside text-slate-300 mb-3 space-y-1">{children}</ol>,
            blockquote: ({ children }) => (
              <blockquote className="border-l-4 border-indigo-500/50 pl-4 italic text-slate-400 my-3">
                {children}
              </blockquote>
            ),
            code: ({ className, children, ...props }) => {
              const isInline = !className;
              if (isInline) {
                return (
                  <code className="bg-slate-800 text-indigo-300 px-1.5 py-0.5 rounded text-sm font-mono">
                    {children}
                  </code>
                );
              }
              const lang = className?.replace('language-', '') || '';
              return (
                <div className="relative group my-3">
                  {lang && (
                    <span className="absolute top-2 right-2 text-xs text-slate-500 font-mono">{lang}</span>
                  )}
                  <pre className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-4 overflow-x-auto">
                    <code className={`text-sm font-mono text-slate-300 ${className || ''}`} {...props}>
                      {children}
                    </code>
                  </pre>
                </div>
              );
            },
            hr: () => <hr className="border-slate-700/50 my-6" />,
            table: ({ children }) => (
              <div className="overflow-x-auto my-4">
                <table className="w-full text-sm text-slate-300">{children}</table>
              </div>
            ),
            th: ({ children }) => <th className="text-left font-semibold text-slate-200 px-3 py-2 border-b border-slate-700">{children}</th>,
            td: ({ children }) => <td className="px-3 py-2 border-b border-slate-800">{children}</td>,
          }}
        >
          {content.data}
        </ReactMarkdown>
      </Suspense>
    </div>
  );
}
