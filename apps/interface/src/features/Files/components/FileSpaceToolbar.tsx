'use client';

import React from 'react';
import { Grid2X2, List, Plus, Search, Upload, X } from 'lucide-react';

import type { FileSpaceViewMode } from './filespace-types';

interface FileSpaceToolbarProps {
  query: string;
  viewMode: FileSpaceViewMode;
  searching: boolean;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onViewModeChange: (mode: FileSpaceViewMode) => void;
  onNewFolder: () => void;
  onUploadClick: () => void;
}

export function FileSpaceToolbar({
  query,
  viewMode,
  searching,
  onQueryChange,
  onSearch,
  onClearSearch,
  onViewModeChange,
  onNewFolder,
  onUploadClick,
}: FileSpaceToolbarProps) {
  return (
    <div className="filespace-toolbar">
      <div className="filespace-actions">
        <button type="button" onClick={onUploadClick}>
          <Upload size={15} />
          Upload
        </button>
        <button type="button" onClick={onNewFolder}>
          <Plus size={15} />
          New folder
        </button>
      </div>

      <form
        className="filespace-search"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <Search size={16} />
        <input
          value={query}
          placeholder="Ask Pearl to find files"
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={onClearSearch}>
            <X size={15} />
          </button>
        )}
        <button type="submit" disabled={searching}>
          {searching ? 'Searching' : 'Search'}
        </button>
      </form>

      <div className="filespace-view-toggle" aria-label="File view mode">
        <button
          type="button"
          className={viewMode === 'grid' ? 'is-active' : ''}
          aria-label="Grid view"
          onClick={() => onViewModeChange('grid')}
        >
          <Grid2X2 size={17} />
        </button>
        <button
          type="button"
          className={viewMode === 'list' ? 'is-active' : ''}
          aria-label="List view"
          onClick={() => onViewModeChange('list')}
        >
          <List size={18} />
        </button>
      </div>
    </div>
  );
}
