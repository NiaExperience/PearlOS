'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';

import { FileSpaceIcon } from './FileSpaceIcons';
import type { FileSpaceSearchResponse } from './filespace-types';

interface FileSpaceSearchPanelProps {
  response: FileSpaceSearchResponse | null;
  onOpenPath: (path: string) => void;
}

export function FileSpaceSearchPanel({ response, onOpenPath }: FileSpaceSearchPanelProps) {
  if (!response) return null;

  return (
    <section className="filespace-pearl-results" aria-live="polite">
      <div className="filespace-pearl-message">
        <Sparkles size={16} />
        <span>{response.message}</span>
      </div>
      {response.results.length > 0 && (
        <div className="filespace-result-row">
          {response.results.slice(0, 4).map((result) => (
            <button type="button" key={result.path} onClick={() => onOpenPath(result.kind === 'folder' ? result.path : result.parentPath)}>
              <FileSpaceIcon kind={result.kind} ext={result.ext} size="small" />
              <span>
                <strong>{result.name}</strong>
                <small>{result.matchReason}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
