'use client';
// Feature: Files — shows real filesystem contents via /api/files
import React, { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  FileText,
  Image as ImageIcon,
  File,
  Music,
  Film,
  Archive,
  Code,
  ChevronRight,
  ArrowLeft,
  Home,
  Grid,
  List,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface FSEntry {
  name: string;
  kind: 'folder' | 'file';
  size?: string;
  ext?: string;
}

interface DirResponse {
  path: string;
  home: string;
  entries: FSEntry[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const iconForExt = (ext?: string) => {
  if (!ext) return <File className="w-5 h-5 text-gray-400" />;
  const e = ext.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(e))
    return <ImageIcon className="w-5 h-5 text-pink-400" />;
  if (['mp3', 'wav', 'flac', 'ogg', 'aac'].includes(e))
    return <Music className="w-5 h-5 text-purple-400" />;
  if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(e))
    return <Film className="w-5 h-5 text-red-400" />;
  if (['zip', 'tar', 'gz', 'rar', '7z', 'dmg'].includes(e))
    return <Archive className="w-5 h-5 text-yellow-400" />;
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'css', 'html', 'json', 'env', 'sh'].includes(e))
    return <Code className="w-5 h-5 text-emerald-400" />;
  if (['txt', 'md', 'csv', 'docx', 'pdf', 'pptx'].includes(e))
    return <FileText className="w-5 h-5 text-blue-400" />;
  return <File className="w-5 h-5 text-gray-400" />;
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

const FilesView: React.FC = () => {
  const [currentPath, setCurrentPath] = useState<string | null>(null); // null = uninitialized
  const [homePath, setHomePath] = useState<string>('~');
  const [entries, setEntries] = useState<FSEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [selected, setSelected] = useState<string | null>(null);

  const fetchDir = useCallback(async (dirPath: string | null) => {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const url = dirPath
        ? `/api/files?path=${encodeURIComponent(dirPath)}`
        : '/api/files';
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data: DirResponse = await res.json();
      setCurrentPath(data.path);
      setHomePath(data.home);
      setEntries(data.entries);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchDir(null);
  }, [fetchDir]);

  const navigateTo = (entry: FSEntry) => {
    if (entry.kind !== 'folder' || currentPath === null) return;
    const newPath = `${currentPath}/${entry.name}`.replace(/\/+/g, '/');
    fetchDir(newPath);
  };

  const goUp = () => {
    if (!currentPath) return;
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
    fetchDir(parent);
  };

  const goHome = () => {
    fetchDir(null);
  };

  const isAtHome = currentPath === homePath;

  // Build breadcrumbs from path
  const breadcrumbs: { label: string; path: string }[] = [];
  if (currentPath) {
    const parts = currentPath.split('/').filter(Boolean);
    let built = '';
    for (const part of parts) {
      built += '/' + part;
      const label = built === homePath ? '~' : part;
      breadcrumbs.push({ label, path: built });
    }
  }

  const sorted = [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="w-full h-full bg-zinc-950 text-white flex flex-col select-none">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 bg-zinc-900 border-b border-zinc-800">
        <button
          onClick={goUp}
          disabled={!currentPath || isAtHome}
          className="p-1.5 rounded-md hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Go up"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          onClick={goHome}
          className="p-1.5 rounded-md hover:bg-zinc-800 transition-colors"
          title="Home directory"
        >
          <Home className="w-4 h-4" />
        </button>
        <button
          onClick={() => fetchDir(currentPath)}
          className="p-1.5 rounded-md hover:bg-zinc-800 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 ml-2 text-sm text-zinc-400 overflow-x-auto flex-1 min-w-0">
          <button
            onClick={goHome}
            className={`whitespace-nowrap hover:text-white transition-colors ${
              breadcrumbs.length === 0 ? 'text-white font-medium' : ''
            }`}
          >
            ~
          </button>
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={crumb.path}>
              <ChevronRight className="w-3 h-3 flex-shrink-0 text-zinc-600" />
              <button
                onClick={() => fetchDir(crumb.path)}
                className={`whitespace-nowrap hover:text-white transition-colors ${
                  i === breadcrumbs.length - 1 ? 'text-white font-medium' : ''
                }`}
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-0.5 ml-2">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-md transition-colors ${
              viewMode === 'grid' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:bg-zinc-800'
            }`}
            title="Grid view"
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-md transition-colors ${
              viewMode === 'list' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:bg-zinc-800'
            }`}
            title="List view"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Path bar */}
      {currentPath && (
        <div className="px-3 py-1 bg-zinc-900/60 border-b border-zinc-800/60 text-xs text-zinc-500 font-mono truncate">
          {currentPath}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-2">
            <AlertCircle className="w-10 h-10 text-red-400 opacity-70" />
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => fetchDir(currentPath)}
              className="text-xs text-zinc-400 hover:text-white transition-colors mt-1"
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <RefreshCw className="w-8 h-8 animate-spin opacity-40 mb-2" />
            <p className="text-sm">Loading…</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <Folder className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm">This folder is empty</p>
          </div>
        ) : viewMode === 'list' ? (
          /* ---- LIST VIEW ---- */
          <div className="space-y-0.5">
            {sorted.map((entry) => (
              <div
                key={entry.name}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  selected === entry.name
                    ? 'bg-blue-600/30 border border-blue-500/40'
                    : 'hover:bg-zinc-800/60 border border-transparent'
                }`}
                onClick={() => setSelected(entry.name)}
                onDoubleClick={() => navigateTo(entry)}
              >
                {entry.kind === 'folder' ? (
                  <Folder className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                ) : (
                  iconForExt(entry.ext)
                )}
                <span className="flex-1 text-sm truncate">{entry.name}</span>
                {entry.size && (
                  <span className="text-xs text-zinc-500 flex-shrink-0">{entry.size}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          /* ---- GRID VIEW ---- */
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {sorted.map((entry) => (
              <div
                key={entry.name}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl cursor-pointer transition-colors ${
                  selected === entry.name
                    ? 'bg-blue-600/30 border border-blue-500/40'
                    : 'hover:bg-zinc-800/60 border border-transparent'
                }`}
                onClick={() => setSelected(entry.name)}
                onDoubleClick={() => navigateTo(entry)}
              >
                {entry.kind === 'folder' ? (
                  <Folder className="w-10 h-10 text-yellow-400" />
                ) : (
                  <div className="w-10 h-10 flex items-center justify-center">
                    {iconForExt(entry.ext)}
                  </div>
                )}
                <span className="text-xs text-center truncate w-full">{entry.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="px-3 py-1.5 bg-zinc-900 border-t border-zinc-800 text-xs text-zinc-500 flex items-center justify-between">
        <span>{sorted.length} item{sorted.length !== 1 ? 's' : ''}</span>
        {selected && <span>{selected}</span>}
      </div>
    </div>
  );
};

export default FilesView;
