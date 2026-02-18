'use client';

import React, { Suspense } from 'react';
import type { ArticleContent } from '../types';

const ReactMarkdown = React.lazy(() => import('react-markdown'));

interface Props {
  content: ArticleContent;
}

export default function ArticleRenderer({ content }: Props) {
  const { data } = content;

  return (
    <article className="canvas-article px-6 py-4 max-w-3xl mx-auto">
      {/* Hero image */}
      {data.heroImage && (
        <div className="relative -mx-6 -mt-4 mb-6 overflow-hidden rounded-b-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.heroImage}
            alt={data.headline}
            className="w-full h-64 object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent" />
        </div>
      )}

      {/* Meta */}
      <div className="flex items-center gap-3 text-sm text-slate-400 mb-3 flex-wrap">
        {data.source && (
          <span className="text-indigo-400 font-medium">{data.source}</span>
        )}
        {data.author && <span>by {data.author}</span>}
        {data.date && <span>• {data.date}</span>}
      </div>

      {/* Headline */}
      <h1 className="text-2xl md:text-3xl font-bold text-slate-100 mb-4 leading-tight">
        {data.headline}
      </h1>

      {/* Body */}
      <div className="prose prose-invert prose-slate max-w-none">
        <Suspense fallback={<div className="text-slate-400 animate-pulse">Loading...</div>}>
          <ReactMarkdown
            components={{
              p: ({ children }) => <p className="text-slate-300 leading-relaxed mb-4">{children}</p>,
              h2: ({ children }) => <h2 className="text-xl font-semibold text-slate-200 mt-6 mb-3">{children}</h2>,
              h3: ({ children }) => <h3 className="text-lg font-medium text-slate-300 mt-4 mb-2">{children}</h3>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-indigo-500/50 pl-4 italic text-slate-400 my-4">{children}</blockquote>
              ),
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 underline">
                  {children}
                </a>
              ),
            }}
          >
            {data.body}
          </ReactMarkdown>
        </Suspense>
      </div>

      {/* Inline images */}
      {data.images && data.images.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3">
          {data.images.map((img, i) => (
            <figure key={i} className="overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.caption || ''} className="w-full h-40 object-cover" />
              {img.caption && (
                <figcaption className="text-xs text-slate-500 mt-1 px-1">{img.caption}</figcaption>
              )}
            </figure>
          ))}
        </div>
      )}

      {/* Source link */}
      {data.url && (
        <div className="mt-6 pt-4 border-t border-slate-700/50">
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-indigo-400 hover:text-indigo-300"
          >
            View original article →
          </a>
        </div>
      )}
    </article>
  );
}
