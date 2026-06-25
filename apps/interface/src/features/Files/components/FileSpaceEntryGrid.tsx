'use client';

import React from 'react';

import { FileSpaceIcon } from './FileSpaceIcons';
import type { FileSpaceEntry, FileSpaceViewMode } from './filespace-types';

interface FileSpaceEntryGridProps {
  entries: FileSpaceEntry[];
  viewMode: FileSpaceViewMode;
  selectedPath: string | null;
  onOpen: (entry: FileSpaceEntry) => void;
  onSelect: (entry: FileSpaceEntry) => void;
}

export function FileSpaceEntryGrid({
  entries,
  viewMode,
  selectedPath,
  onOpen,
  onSelect,
}: FileSpaceEntryGridProps) {
  if (entries.length === 0) {
    return <div className="filespace-empty">This folder is empty.</div>;
  }

  return (
    <div className={viewMode === 'grid' ? 'filespace-grid' : 'filespace-list'}>
      {entries.map((entry) => (
        <button
          type="button"
          key={entry.path}
          className={selectedPath === entry.path ? 'filespace-entry is-selected' : 'filespace-entry'}
          onClick={() => {
            onSelect(entry);
            onOpen(entry);
          }}
        >
          <span className="filespace-entry-check" aria-hidden="true" />
          <FileSpaceIcon kind={entry.kind} ext={entry.ext} size={viewMode === 'grid' ? 'large' : 'small'} />
          <span className="filespace-entry-name" title={entry.name}>
            {entry.name}
          </span>
          {viewMode === 'list' && (
            <>
              <span className="filespace-entry-meta">{entry.kind === 'folder' ? 'Folder' : entry.ext?.toUpperCase() || 'File'}</span>
              <span className="filespace-entry-meta">{entry.size || ''}</span>
              <span className="filespace-entry-meta">{entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleDateString() : ''}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
