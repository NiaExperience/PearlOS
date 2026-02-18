'use client';

import { BookOpen, X, ExternalLink } from 'lucide-react';
import React from 'react';

export interface ReadabilityArticle {
  title: string;
  byline: string | null;
  content: string;
  textContent: string;
  excerpt: string | null;
  siteName: string | null;
  length: number;
}

interface ReadabilityViewProps {
  article: ReadabilityArticle;
  url: string;
  onClose: () => void;
}

const ReadabilityView: React.FC<ReadabilityViewProps> = ({ article, url, onClose }) => {
  const domain = (() => {
    try { return new URL(url).hostname; } catch { return url; }
  })();

  return (
    <div className="w-full h-full bg-gray-950 text-gray-200 overflow-y-auto">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-amber-400 font-medium">
          <BookOpen className="w-4 h-4" />
          <span>Reader View</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded hover:bg-gray-700 transition-colors text-gray-400 hover:text-gray-200"
            title="Open original"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-700 transition-colors text-gray-400 hover:text-gray-200"
            title="Exit Reader View"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Article content */}
      <article className="max-w-2xl mx-auto px-5 py-8">
        {/* Meta */}
        <header className="mb-8">
          {article.siteName && (
            <p className="text-amber-400/80 text-sm font-medium mb-2 uppercase tracking-wide">
              {article.siteName}
            </p>
          )}
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-100 leading-tight mb-3">
            {article.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
            {article.byline && <span>{article.byline}</span>}
            <span>{domain}</span>
            <span>{Math.ceil(article.length / 1500)} min read</span>
          </div>
          {article.excerpt && (
            <p className="mt-4 text-gray-400 text-base italic leading-relaxed border-l-2 border-amber-500/40 pl-4">
              {article.excerpt}
            </p>
          )}
        </header>

        {/* Body — rendered HTML from Readability */}
        <div
          className="readability-content prose prose-invert prose-amber max-w-none
            prose-headings:text-gray-100 prose-headings:font-semibold
            prose-p:text-gray-300 prose-p:leading-relaxed prose-p:mb-4
            prose-a:text-amber-400 prose-a:no-underline hover:prose-a:underline
            prose-strong:text-gray-200
            prose-blockquote:border-amber-500/40 prose-blockquote:text-gray-400
            prose-img:rounded-lg prose-img:mx-auto
            prose-code:text-amber-300 prose-code:bg-gray-800/50 prose-code:px-1 prose-code:rounded
            prose-pre:bg-gray-900 prose-pre:border prose-pre:border-gray-800
            prose-li:text-gray-300
            prose-hr:border-gray-800
            text-base leading-relaxed"
          dangerouslySetInnerHTML={{ __html: article.content }}
        />
      </article>
    </div>
  );
};

export default ReadabilityView;
