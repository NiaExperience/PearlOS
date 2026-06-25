'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ExternalLink, Inbox, Loader2 } from 'lucide-react';

import { useInterfaceCustomization } from '@interface/hooks/use-interface-customization';
import { requestWindowOpen } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';

import { FileSpaceBreadcrumbs } from './FileSpaceBreadcrumbs';
import { FileSpaceEntryGrid } from './FileSpaceEntryGrid';
import { FileSpaceSearchPanel } from './FileSpaceSearchPanel';
import { FileSpaceSidebar } from './FileSpaceSidebar';
import { FileSpaceToolbar } from './FileSpaceToolbar';
import { FileSpaceUploadButton } from './FileSpaceUploadButton';
import type {
  FileSpaceEntry,
  FileSpaceSearchResponse,
  FileSpaceViewMode,
} from './filespace-types';
import './filespace.css';

interface FilesViewProps {
  initialPath?: string;
  initialSearchQuery?: string;
  initialSearchNonce?: number;
}

interface FileSpaceListResponse {
  relativePath: string;
  entries: FileSpaceEntry[];
  error?: string;
}

interface SharedFileSpaceItem {
  resourceId: string;
  resourceType: 'Notes' | 'Apps' | 'HtmlGeneration' | string;
  title: string;
  role: string;
  ownerName?: string;
  href?: string;
  sharedToAllReadOnly?: boolean;
}

function itemTypeLabel(type: string): string {
  if (type === 'Apps' || type === 'HtmlGeneration') return 'App';
  if (type === 'Notes') return 'Note';
  return 'Resource';
}

function sortEntries(entries: FileSpaceEntry[]): FileSpaceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function cleanFolderName(value: string | null): string {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const VIDEO_EXTENSIONS = new Set(['mov', 'mp4', 'webm']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'ogg', 'wav']);
const TEXT_EXTENSIONS = new Set(['css', 'csv', 'html', 'js', 'json', 'log', 'md', 'txt', 'yaml', 'yml']);

function isPdfEntry(entry: FileSpaceEntry): boolean {
  return (entry.ext || '').toLowerCase() === 'pdf' || entry.name.toLowerCase().endsWith('.pdf');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fileContentUrl(entry: FileSpaceEntry): string {
  return `/api/files/content?path=${encodeURIComponent(entry.path)}`;
}

function previewHtml(entry: FileSpaceEntry): string {
  const title = escapeHtml(entry.name);
  const url = fileContentUrl(entry);
  const ext = (entry.ext || '').toLowerCase();
  let body = `<a class="download" href="${url}" download="${title}">Download</a>`;

  if (IMAGE_EXTENSIONS.has(ext)) {
    body = `<img src="${url}" alt="${title}" />`;
  } else if (VIDEO_EXTENSIONS.has(ext)) {
    body = `<video controls playsinline src="${url}"></video>`;
  } else if (AUDIO_EXTENSIONS.has(ext)) {
    body = `<audio controls src="${url}"></audio>`;
  } else if (ext === 'pdf') {
    body = `<iframe title="${title}" src="${url}"></iframe>`;
  } else if (TEXT_EXTENSIONS.has(ext)) {
    body = `<iframe title="${title}" src="${url}"></iframe>`;
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; min-height: 100%; background: #0f1115; color: #f3f5f8; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { display: flex; flex-direction: column; gap: 12px; padding: 16px; box-sizing: border-box; }
      header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 32px; }
      h1 { margin: 0; overflow-wrap: anywhere; font-size: 16px; line-height: 1.35; font-weight: 650; }
      .download { color: #b7d4ff; text-decoration: none; font-size: 13px; white-space: nowrap; }
      main { flex: 1; min-height: 0; display: grid; place-items: center; overflow: auto; border: 1px solid rgba(255,255,255,.12); border-radius: 8px; background: #151922; }
      img, video { display: block; max-width: 100%; max-height: calc(100vh - 110px); object-fit: contain; }
      audio { width: min(680px, 100%); }
      iframe { width: 100%; height: calc(100vh - 110px); border: 0; background: white; }
      pre { width: 100%; min-height: calc(100vh - 110px); margin: 0; padding: 16px; box-sizing: border-box; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: #e8edf5; font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    </style>
  </head>
  <body>
    <header><h1>${title}</h1><a class="download" href="${url}" download="${title}">Download</a></header>
    <main>${body}</main>
  </body>
</html>`;
}

export default function FilesView({ initialPath, initialSearchQuery, initialSearchNonce }: FilesViewProps) {
  const { data: session, status } = useSession();
  const customization = useInterfaceCustomization();
  const uploadRef = useRef<HTMLInputElement>(null);
  const appliedInitialSearchRef = useRef<string>('');
  const [currentPath, setCurrentPath] = useState('');
  const [activeSection, setActiveSection] = useState<'files' | 'shared'>('files');
  const [entries, setEntries] = useState<FileSpaceEntry[]>([]);
  const [sharedItems, setSharedItems] = useState<SharedFileSpaceItem[]>([]);
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<FileSpaceViewMode>('grid');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [searchResponse, setSearchResponse] = useState<FileSpaceSearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharedError, setSharedError] = useState<string | null>(null);

  const folders = useMemo(() => entries.filter((entry) => entry.kind === 'folder'), [entries]);

  const loadFolder = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
      const data = await response.json().catch(() => ({})) as FileSpaceListResponse;
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load folder');
      }
      setCurrentPath(data.relativePath || '');
      setEntries(sortEntries(data.entries || []));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSharedWithMe = useCallback(async () => {
    setSharedLoading(true);
    setSharedError(null);
    try {
      const response = await fetch('/api/shared-with-me');
      const data = await response.json().catch(() => ({})) as { items?: SharedFileSpaceItem[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Failed to load shared resources');
      setSharedItems(Array.isArray(data.items) ? data.items : []);
    } catch (loadError) {
      setSharedError(loadError instanceof Error ? loadError.message : 'Failed to load shared resources');
      setSharedItems([]);
    } finally {
      setSharedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user?.id) {
      setError('Sign in required to view files.');
      setLoading(false);
      return;
    }
    if (activeSection !== 'files') return;
    void loadFolder(currentPath);
  }, [activeSection, currentPath, loadFolder, session?.user?.id, status]);

  useEffect(() => {
    if (status === 'loading' || activeSection !== 'shared') return;
    if (!session?.user?.id) {
      setSharedError('Sign in required to view shared resources.');
      setSharedLoading(false);
      return;
    }
    void loadSharedWithMe();
  }, [activeSection, loadSharedWithMe, session?.user?.id, status]);

  const runSearch = useCallback(async (rawQuery = query) => {
    const nextQuery = rawQuery.trim();
    if (!nextQuery) return;
    setSearching(true);
    setError(null);
    try {
      const response = await fetch(`/api/files/search?q=${encodeURIComponent(nextQuery)}`);
      const data = await response.json().catch(() => ({})) as FileSpaceSearchResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || 'File search failed');
      setQuery(data.query || nextQuery);
      setSearchResponse(data);
      setSelectedPath(data.best?.path || null);
      if (typeof data.openedPath === 'string' && data.openedPath !== currentPath) {
        setCurrentPath(data.openedPath);
      }
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : String(searchError));
    } finally {
      setSearching(false);
    }
  }, [currentPath, query]);

  useEffect(() => {
    const incoming = initialSearchQuery?.trim();
    const key = `${incoming || ''}:${initialSearchNonce || 0}`;
    if (!incoming || appliedInitialSearchRef.current === key || status === 'loading') return;
    appliedInitialSearchRef.current = key;
    void runSearch(incoming);
  }, [initialSearchNonce, initialSearchQuery, runSearch, status]);

  useEffect(() => {
    const incoming = initialPath?.trim().replace(/^\/+/, '');
    if (!incoming || status === 'loading') return;
    setCurrentPath(incoming);
  }, [initialPath, status]);

  const openEntry = useCallback((entry: FileSpaceEntry) => {
    if (entry.kind === 'folder') {
      setCurrentPath(entry.path);
      setSelectedPath(null);
      return;
    }
    if (entry.name.toLowerCase().endsWith('.md')) {
      const noteId = entry.path.replace(/\.md$/i, '');
      window.dispatchEvent(new CustomEvent('openNoteFromFile', { detail: { noteId, path: entry.path, filename: entry.name } }));
      requestWindowOpen({ viewType: 'notes', source: 'filespace:md-click' });
      return;
    }
    if (isPdfEntry(entry)) {
      const url = fileContentUrl(entry);
      const viewer = window.open('about:blank', '_blank');
      if (!viewer) {
        setError('Chrome blocked the PDF viewer. Allow pop-ups for PearlOS or use Download from the file menu.');
        return;
      }
      try {
        viewer.opener = null;
      } catch {
        // Some browsers prevent clearing opener; the target is same-origin.
      }
      viewer.location.href = url;
      setError(null);
      return;
    }
    requestWindowOpen({
      viewType: 'htmlContent',
      viewState: {
        htmlContentData: {
          id: `filespace:${entry.path}`,
          title: entry.name,
          contentType: 'tool',
          htmlContent: previewHtml(entry),
        },
      },
      options: { allowDuplicate: true },
      source: 'filespace:file-preview',
    });
  }, []);

  const createFolder = useCallback(async () => {
    const name = cleanFolderName(window.prompt('New folder name'));
    if (!name) return;
    const response = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mkdir', path: currentPath, name }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || 'Could not create folder');
      return;
    }
    await loadFolder(currentPath);
  }, [currentPath, loadFolder]);

  const uploadFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const formData = new FormData();
    formData.set('path', currentPath);
    Array.from(files).forEach((file) => formData.append('files', file));
    const response = await fetch('/api/files', { method: 'POST', body: formData });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || 'Upload failed');
      return;
    }
    await loadFolder(currentPath);
  }, [currentPath, loadFolder]);

  return (
    <div className="filespace-root" data-filespace-theme={customization.theme}>
      <FileSpaceSidebar
        folders={folders}
        currentPath={currentPath}
        activeSection={activeSection}
        onNavigate={setCurrentPath}
        onShowFiles={() => setActiveSection('files')}
        onShowShared={() => {
          setActiveSection('shared');
          setSelectedPath(null);
          setSearchResponse(null);
        }}
      />
      <main className={activeSection === 'shared' ? 'filespace-main filespace-main--shared' : 'filespace-main'}>
        {activeSection === 'files' ? (
          <>
            <FileSpaceBreadcrumbs currentPath={currentPath} onNavigate={setCurrentPath} />
            <FileSpaceToolbar
              query={query}
              viewMode={viewMode}
              searching={searching}
              onQueryChange={setQuery}
              onSearch={() => runSearch()}
              onClearSearch={() => {
                setQuery('');
                setSearchResponse(null);
              }}
              onViewModeChange={setViewMode}
              onNewFolder={createFolder}
              onUploadClick={() => uploadRef.current?.click()}
            />
            <FileSpaceSearchPanel response={searchResponse} onOpenPath={setCurrentPath} />
            <section className="filespace-content">
              {error && <div className="filespace-error">{error}</div>}
              {!error && loading && <div className="filespace-loading">Loading files...</div>}
              {!error && !loading && (
                <FileSpaceEntryGrid
                  entries={entries}
                  viewMode={viewMode}
                  selectedPath={selectedPath}
                  onOpen={openEntry}
                  onSelect={(entry) => setSelectedPath(entry.path)}
                />
              )}
              <input
                ref={uploadRef}
                className="filespace-hidden-input"
                type="file"
                multiple
                onChange={(event) => {
                  void uploadFiles(event.target.files);
                  event.currentTarget.value = '';
                }}
              />
              <FileSpaceUploadButton onClick={() => uploadRef.current?.click()} />
            </section>
          </>
        ) : (
          <>
            <div className="filespace-shared-header">
              <div>
                <h2>Shared with Me</h2>
                <p>Notes and creations other PearlOS users have shared with you.</p>
              </div>
              <button type="button" onClick={() => void loadSharedWithMe()} disabled={sharedLoading}>
                {sharedLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                Refresh
              </button>
            </div>
            <section className="filespace-content">
              {sharedError && <div className="filespace-error">{sharedError}</div>}
              {!sharedError && sharedLoading && (
                <div className="filespace-loading">Loading shared resources...</div>
              )}
              {!sharedError && !sharedLoading && sharedItems.length === 0 && (
                <div className="filespace-shared-empty">
                  <Inbox size={28} />
                  <span>Nothing shared here yet.</span>
                </div>
              )}
              {!sharedError && !sharedLoading && sharedItems.length > 0 && (
                <div className="filespace-shared-list">
                  {sharedItems.map((item) => (
                    <a
                      key={`${item.resourceType}:${item.resourceId}`}
                      href={item.href || '#'}
                      className="filespace-shared-card"
                    >
                      <div className="min-w-0">
                        <strong>{item.title}</strong>
                        <span className="filespace-shared-meta">
                          {itemTypeLabel(item.resourceType)} · {item.role}
                          {item.ownerName ? ` · ${item.ownerName}` : ''}
                        </span>
                      </div>
                      <ExternalLink size={15} />
                    </a>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
