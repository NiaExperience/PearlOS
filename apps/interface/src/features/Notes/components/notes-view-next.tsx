'use client';

import { isFeatureEnabled } from '@nia/features';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { useSession } from 'next-auth/react';
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { usePostHog } from 'posthog-js/react';
import { getClientLogger } from '@interface/lib/client-logger';

// Import styles for content animations
import '@interface/features/Notes/styles/notes-next.css';

import {
  NIA_EVENT_NOTE_CLOSE,
  NIA_EVENT_NOTE_DOWNLOAD,
  NIA_EVENT_NOTE_MODE_SWITCH,
  NIA_EVENT_NOTE_SAVED,
  NIA_EVENT_NOTE_UPDATED,
  NIA_EVENT_NOTE_DELETED,
  NIA_EVENT_NOTES_REFRESH,
  NIA_EVENT_NOTES_LIST,
  type NiaEventDetail,
} from '@interface/features/DailyCall/events/niaEventRouter';
import { forwardAppEvent } from '@interface/features/DailyCall/events/appMessageBridge';
import { EventEnum } from '@nia/events';
import {
  fuzzySearch,
} from '@interface/features/Notes/lib/fuzzy-search';
import {
  createNote,
  deleteNote as deleteNoteApi,
  fetchNotes,
  fetchNotesIncremental,
  findNoteWithFuzzySearch,
  updateNote,
  type NoteBatch,
  type NoteBatchType,
} from '@interface/features/Notes/lib/notes-api';
import {
  consumeNextQueuedNote,
  queueOfflineNoteUpdate,
  requeueNoteUpdate,
  shouldDropQueuedItem,
} from '@interface/features/Notes/lib/offline-note-queue';
import {
  formatFileSize,
  processDocumentFile,
  validatePDFFile,
} from '@interface/features/Notes/services/pdf-processor';
import { Note, NoteMode } from '@interface/features/Notes/types/notes-types';
import { SharedIndicator } from '@interface/features/ResourceSharing/components';
import { getUserSharedResources } from '@interface/features/ResourceSharing/lib';
import { useToast } from '@interface/hooks/use-toast';
import { useLLMMessaging } from '@interface/lib/daily';
import { trackSessionHistory } from '@interface/lib/session-history';

import BookSpine from './BookSpine';
import NoteShareControls from './NoteShareControls';

const ReactMarkdown = React.lazy(() => import('react-markdown'));
const log = getClientLogger('NotesNext');

// ─── Types ───────────────────────────────────────────────────────────────────

interface NotesViewProps {
  assistantName: string;
  onClose?: () => void;
  supportedFeatures?: string[];
  tenantId?: string;
}

type ViewState = 'library' | 'document';
type LibraryLayout = 'cards' | 'spines';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseListItems(text: string): string[] {
  if (!text) return [];
  const raw = text.replace(/\n+/g, ',').replace(/\s+and\s+/gi, ',').replace(/\s*&\s*/g, ',');
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  const normalized = parts.map(p => p.replace(/^[-•]\s*/g, '').trim());
  const seen = new Set<string>();
  const items: string[] = [];
  for (const p of normalized) {
    const key = p.toLowerCase();
    if (!seen.has(key)) { seen.add(key); items.push(p); }
  }
  return items;
}

function mergeBulletList(prevContent: string, newItems: string[]): string {
  const existingItems = (prevContent || '').split('\n').map(l => l.replace(/^[-•]\s*/g, '').trim()).filter(Boolean);
  const existingSet = new Set(existingItems.map(s => s.toLowerCase()));
  const add = newItems.filter(i => !existingSet.has(i.toLowerCase()));
  return [...existingItems, ...add].map(s => `• ${s}`).join('\n');
}

function removeTargetFromContent(prevContent: string, target: string): string {
  if (!target) return prevContent;
  const lines = (prevContent || '').split('\n');
  const cleaned = lines.filter(l => l.replace(/^[-•]\s*/g, '').trim().toLowerCase() !== target.toLowerCase());
  if (cleaned.length !== lines.length) return cleaned.join('\n');
  const pattern = new RegExp(`\\b${escapeRegExp(target)}\\b[,;:]?\\s*`, 'gi');
  return (prevContent || '').replace(pattern, '').replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
}

function formatDate(note: Note) {
  const raw = note.createdAt || note.timestamp;
  if (!raw) return '';
  const date = new Date(raw);
  if (isNaN(date.getTime()) || date.getTime() < 86400000) return '';
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== today.getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString('en-US', options);
}

function getPreview(content: string, maxLen = 120): string {
  if (!content) return '';
  const clean = content.replace(/^#+ /gm, '').replace(/[*_~`]/g, '').replace(/\n+/g, ' ').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + '…' : clean;
}

// ─── Streaming Renderer ─────────────────────────────────────────────────────

interface StreamingRendererProps {
  content: string;
  isStreaming: boolean;
  noteId?: string;
}

const StreamingRenderer: React.FC<StreamingRendererProps> = ({ content, isStreaming, noteId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevContentRef = useRef('');
  const prevLinesRef = useRef<string[]>([]);
  const [displayedContent, setDisplayedContent] = useState('');
  const [showGlow, setShowGlow] = useState(false);
  const [changeType, setChangeType] = useState<'append' | 'modify' | 'remove' | null>(null);
  const [newLineIndices, setNewLineIndices] = useState<Set<number>>(new Set());
  const [modifiedLineIndices, setModifiedLineIndices] = useState<Set<number>>(new Set());
  const animationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const contentVersionRef = useRef(0);
  const hasRevealedRef = useRef(false);
  const glowTimersRef = useRef<NodeJS.Timeout[]>([]);
  const userScrolledAwayRef = useRef(false);
  const prevNoteIdRef = useRef<string | null>(null);

  // Reset hasRevealedRef when note changes
  useEffect(() => {
    if (noteId && noteId !== prevNoteIdRef.current) {
      hasRevealedRef.current = false;
      prevContentRef.current = '';
      prevLinesRef.current = [];
    }
    prevNoteIdRef.current = noteId || null;
  }, [noteId]);

  // Track user scroll position to avoid hijacking viewport
  useEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (!anchor) return;
    const scrollParent = anchor.closest('.nn-doc-content');
    if (!scrollParent) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollParent;
      const distFromBottom = scrollHeight - scrollTop - clientHeight;
      userScrolledAwayRef.current = distFromBottom > 100;
    };
    scrollParent.addEventListener('scroll', handleScroll);
    return () => scrollParent.removeEventListener('scroll', handleScroll);
  }, []);

  // Cleanup glow timers on unmount
  useEffect(() => {
    return () => {
      glowTimersRef.current.forEach(t => clearTimeout(t));
      glowTimersRef.current = [];
    };
  }, []);

  useEffect(() => {
    const prevContent = prevContentRef.current;
    const prevLines = prevLinesRef.current;
    prevContentRef.current = content;
    const currentLines = content.split('\n');
    prevLinesRef.current = currentLines;
    contentVersionRef.current++;

    // No change
    if (content === prevContent) return;

    // Clear any running animation
    if (animationTimerRef.current) {
      clearInterval(animationTimerRef.current);
      animationTimerRef.current = null;
    }

    // Helper to schedule glow cleanup with tracking
    const scheduleGlowCleanup = (delayMs: number) => {
      const t = setTimeout(() => {
        setShowGlow(false);
        setChangeType(null);
        glowTimersRef.current = glowTimersRef.current.filter(x => x !== t);
      }, delayMs);
      glowTimersRef.current.push(t);
    };

    // First load or big content blob — progressive paragraph reveal
    if (!prevContent && content.length > 0 && !hasRevealedRef.current) {
      hasRevealedRef.current = true;
      const paragraphs = content.split(/(\n\n+)/);
      // Show first paragraph immediately to avoid empty flash
      let revealedIdx = 1;
      setDisplayedContent(paragraphs.slice(0, 1).join(''));
      setShowGlow(true);
      setChangeType('append');

      if (paragraphs.length <= 1) {
        scheduleGlowCleanup(600);
        return;
      }

      animationTimerRef.current = setInterval(() => {
        revealedIdx++;
        if (revealedIdx >= paragraphs.length) {
          if (animationTimerRef.current) clearInterval(animationTimerRef.current);
          setDisplayedContent(content);
          scheduleGlowCleanup(600);
        } else {
          setDisplayedContent(paragraphs.slice(0, revealedIdx).join(''));
        }
      }, 120);

      return () => { if (animationTimerRef.current) clearInterval(animationTimerRef.current); };
    }

    // Complete replacement — content actually changed (not just length-based)
    if (prevContent && prevContent.length > 0 && content !== prevContent && !content.startsWith(prevContent)) {
      const paragraphs = content.split(/(\n\n+)/);
      // Show first paragraph immediately
      let revealedIdx = 1;
      setDisplayedContent(paragraphs.slice(0, 1).join(''));
      setShowGlow(true);
      setChangeType('append');

      if (paragraphs.length <= 1) {
        scheduleGlowCleanup(600);
        return;
      }

      animationTimerRef.current = setInterval(() => {
        revealedIdx++;
        if (revealedIdx >= paragraphs.length) {
          if (animationTimerRef.current) clearInterval(animationTimerRef.current);
          setDisplayedContent(content);
          scheduleGlowCleanup(600);
        } else {
          setDisplayedContent(paragraphs.slice(0, revealedIdx).join(''));
        }
      }, 120);

      return () => { if (animationTimerRef.current) clearInterval(animationTimerRef.current); };
    }

    // Diff lines to detect new vs modified
    const newLines = new Set<number>();
    const modLines = new Set<number>();
    const maxLen = Math.max(currentLines.length, prevLines.length);

    for (let i = 0; i < maxLen; i++) {
      if (i >= prevLines.length) {
        newLines.add(i);
      } else if (i >= currentLines.length) {
        // line removed
      } else if (currentLines[i] !== prevLines[i]) {
        modLines.add(i);
      }
    }

    if (currentLines.length > prevLines.length) {
      setChangeType('append');
    } else if (currentLines.length < prevLines.length) {
      setChangeType('remove');
    } else if (modLines.size > 0) {
      setChangeType('modify');
    }

    setNewLineIndices(newLines);
    setModifiedLineIndices(modLines);
    setShowGlow(true);

    // Incremental append — typewriter reveal
    if (content.startsWith(prevContent) && content.length > prevContent.length) {
      const delta = content.slice(prevContent.length);
      const words = delta.split(/(\s+)/).filter(Boolean);

      if (words.length > 0 && words.length <= 80) {
        let revealed = 0;

        animationTimerRef.current = setInterval(() => {
          revealed++;
          if (revealed >= words.length) {
            if (animationTimerRef.current) clearInterval(animationTimerRef.current);
            setDisplayedContent(content);
            const t = setTimeout(() => {
              setShowGlow(false);
              setChangeType(null);
              setNewLineIndices(new Set());
              setModifiedLineIndices(new Set());
              glowTimersRef.current = glowTimersRef.current.filter(x => x !== t);
            }, 600);
            glowTimersRef.current.push(t);
          } else {
            setDisplayedContent(prevContent + words.slice(0, revealed).join(''));
          }
        }, 35);

        return () => { if (animationTimerRef.current) clearInterval(animationTimerRef.current); };
      }
    }

    // Non-append changes — show immediately with animation classes
    setDisplayedContent(content);
    const t2 = setTimeout(() => {
      setShowGlow(false);
      setChangeType(null);
      setNewLineIndices(new Set());
      setModifiedLineIndices(new Set());
      glowTimersRef.current = glowTimersRef.current.filter(x => x !== t2);
    }, 800);
    glowTimersRef.current.push(t2);

    return () => { if (animationTimerRef.current) clearInterval(animationTimerRef.current); };
  }, [content]);

  // Auto-scroll whenever displayedContent changes — only if user is near bottom
  useEffect(() => {
    if (userScrolledAwayRef.current) return;
    requestAnimationFrame(() => {
      const anchor = scrollAnchorRef.current;
      if (!anchor) return;
      const scrollParent = anchor.closest('.nn-doc-content');
      if (scrollParent) {
        scrollParent.scrollTo({ top: scrollParent.scrollHeight, behavior: 'smooth' });
      } else {
        anchor.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    });
  }, [displayedContent]);

  // Build CSS class for container based on change type
  const containerClass = [
    'nn-streaming-container',
    showGlow ? 'nn-content-glow' : '',
    changeType === 'append' ? 'nn-content-appended' : '',
    changeType === 'modify' ? 'nn-content-modified' : '',
    changeType === 'remove' ? 'nn-content-removed' : '',
  ].filter(Boolean).join(' ');

  // Line-aware markdown components — add animation classes to new/modified elements
  const lineCounter = useRef(0);
  lineCounter.current = 0;

  const wrapWithAnimation = (el: React.ReactElement, tagClass: string) => {
    const lineIdx = lineCounter.current++;
    const isNew = newLineIndices.has(lineIdx);
    const isMod = modifiedLineIndices.has(lineIdx);
    const extraClass = isNew ? ' nn-line-new' : isMod ? ' nn-line-modified' : '';
    return React.cloneElement(el, {
      className: `${tagClass}${extraClass}`,
    });
  };

  return (
    <div ref={containerRef} className={containerClass}>
      <React.Suspense fallback={<div className="nn-loading">Loading…</div>}>
        <ReactMarkdown
          components={{
            h1: ({ children }) => wrapWithAnimation(<h1 className="nn-h1">{children}</h1>, 'nn-h1'),
            h2: ({ children }) => wrapWithAnimation(<h2 className="nn-h2">{children}</h2>, 'nn-h2'),
            h3: ({ children }) => wrapWithAnimation(<h3 className="nn-h3">{children}</h3>, 'nn-h3'),
            h4: ({ children }) => wrapWithAnimation(<h4 className="nn-h4">{children}</h4>, 'nn-h4'),
            h5: ({ children }) => wrapWithAnimation(<h5 className="nn-h5">{children}</h5>, 'nn-h5'),
            h6: ({ children }) => wrapWithAnimation(<h6 className="nn-h6">{children}</h6>, 'nn-h6'),
            p: ({ children }) => wrapWithAnimation(<p className="nn-p">{children}</p>, 'nn-p'),
            ul: ({ children }) => <ul className="nn-ul">{children}</ul>,
            ol: ({ children }) => <ol className="nn-ol">{children}</ol>,
            li: ({ children }) => wrapWithAnimation(<li className="nn-li">{children}</li>, 'nn-li'),
            blockquote: ({ children }) => wrapWithAnimation(<blockquote className="nn-blockquote">{children}</blockquote>, 'nn-blockquote'),
            code: ({ className, children, ...props }) => {
              const isInline = !className;
              return isInline
                ? <code className="nn-code-inline" {...props}>{children}</code>
                : <code className={`nn-code-block ${className || ''}`} {...props}>{children}</code>;
            },
            pre: ({ children }) => <pre className="nn-pre">{children}</pre>,
            table: ({ children }) => <div className="nn-table-wrap"><table className="nn-table">{children}</table></div>,
            th: ({ children }) => <th className="nn-th">{children}</th>,
            td: ({ children }) => <td className="nn-td">{children}</td>,
            hr: () => <hr className="nn-hr" />,
            a: ({ children, href }) => <a className="nn-a" href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
            strong: ({ children }) => <strong className="nn-strong">{children}</strong>,
            em: ({ children }) => <em className="nn-em">{children}</em>,
          }}
        >
          {displayedContent}
        </ReactMarkdown>
      </React.Suspense>
      {isStreaming && <span className="nn-cursor" />}
      {/* Invisible scroll anchor — always at the bottom */}
      <div ref={scrollAnchorRef} className="nn-scroll-anchor" />
    </div>
  );
};

// ─── Main Component ─────────────────────────────────────────────────────────

const NotesViewNext = ({ assistantName, onClose, supportedFeatures, tenantId: propTenantId }: NotesViewProps) => {
  const { data: session } = useSession();
  const posthog = usePostHog();
  const { toast } = useToast();
  const { sendMessage } = useLLMMessaging();

  // Core state
  const [mode, setMode] = useState<NoteMode>('personal');
  const [notes, setNotes] = useState<Note[]>([]);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [originalNote, setOriginalNote] = useState<Note | null>(null);
  const [viewState, setViewState] = useState<ViewState>('library');
  const [libraryLayout, setLibraryLayout] = useState<LibraryLayout>('cards');
  const [isEditMode, setIsEditMode] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Loading / saving
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Search expansion
  const [searchExpanded, setSearchExpanded] = useState(false);

  // Dialogs
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [noteToDeleteId, setNoteToDeleteId] = useState<string | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Mobile
  const [isMobile, setIsMobile] = useState(false);

  // Shared resources
  const [sharedNoteIds, setSharedNoteIds] = useState<Set<string>>(new Set());

  // Online state
  // Always initialize as true to match server render; sync in useEffect to avoid hydration mismatch.
  const [isOnline, setIsOnline] = useState<boolean>(true);

  // Refs
  const notesRef = useRef<Note[]>([]);
  const currentNoteRef = useRef<Note | null>(null);
  const isReadyRef = useRef(false);
  const commandQueueRef = useRef<Array<{ action: string; payload: Record<string, unknown> }>>([]);
  const incrementalAbortRef = useRef<(() => void) | null>(null);
  const refreshTargetRef = useRef<{ noteId: string; mode?: NoteMode | null } | null>(null);
  const recentCommandsRef = useRef<Map<string, number>>(new Map());
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag-drop
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessingDocument, setIsProcessingDocument] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [dragCounter, setDragCounter] = useState(0);

  // ─── Note state broadcasting to bot gateway ────────────────────────────

  const sendNoteState = useCallback(async (action: 'opened' | 'updated' | 'closed', note?: Note | null) => {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || 'http://localhost:4444';
      await fetch(`${baseUrl}/api/note-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          noteId: note?._id || null,
          title: note?.title || null,
          content: note?.content || null,
          viewState: note ? 'document' : 'library',
        }),
      });
    } catch (e) {
      // Non-fatal, don't block UI
    }
  }, []);

  // Debounced content update broadcaster
  const noteStateDebounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (viewState !== 'document' || !currentNote) return;
    if (noteStateDebounceRef.current) clearTimeout(noteStateDebounceRef.current);
    noteStateDebounceRef.current = setTimeout(() => {
      sendNoteState('updated', currentNote);
    }, 2000);
    return () => { if (noteStateDebounceRef.current) clearTimeout(noteStateDebounceRef.current); };
  }, [currentNote?.content, currentNote?.title]);

  // ─── Sync refs ────────────────────────────────────────────────────────────

  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { currentNoteRef.current = currentNote; }, [currentNote]);

  // ─── Responsive ───────────────────────────────────────────────────────────

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ─── Online status ────────────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsOnline(navigator.onLine); // Sync initial value after hydration
    const h = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', h);
    window.addEventListener('offline', h);
    return () => { window.removeEventListener('online', h); window.removeEventListener('offline', h); };
  }, []);

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const shouldIgnoreDuplicate = useCallback((action: string, payload: unknown) => {
    try {
      const key = `${action}:${JSON.stringify(payload || {})}`;
      const now = Date.now();
      const last = recentCommandsRef.current.get(key) || 0;
      if (now - last < 1500) return true;
      recentCommandsRef.current.set(key, now);
      for (const [k, t] of Array.from(recentCommandsRef.current.entries())) {
        if (now - t > 5000) recentCommandsRef.current.delete(k);
      }
      return false;
    } catch { return false; }
  }, []);

  const hasUnsavedChanges = useCallback(() => {
    if (!currentNote || !originalNote) return false;
    return currentNote.title !== originalNote.title || currentNote.content !== originalNote.content;
  }, [currentNote, originalNote]);

  const hasWriteAccess = useCallback((note: Note | null): boolean => {
    if (!note) return false;
    const isTestAnon = process.env.NEXT_PUBLIC_TEST_ANONYMOUS_USER === 'true' || process.env.NODE_ENV === 'test';
    const effectiveUserId = session?.user?.id || (isTestAnon ? '00000000-0000-0000-0000-000000000099' : null);
    // If no auth session and note is not shared, allow write (single-user / PearlOS mode)
    if (!effectiveUserId) return !note.sharedVia;
    if (!note.sharedVia) return true;
    const userRole = note.sharedVia.role?.role;
    return userRole === OrganizationRole.ADMIN || userRole === OrganizationRole.OWNER;
  }, [session]);

  // ─── Filtered notes ───────────────────────────────────────────────────────

  const filteredNotes = useMemo(() => {
    let results: Note[];
    if (!searchQuery.trim()) {
      results = [...notes].sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
    } else {
      const fuzzyResults = fuzzySearch(notes, searchQuery, note => note.title || '', {
        minScore: 0.2, maxResults: 50, sortByScore: true,
      });
      results = fuzzyResults.map(r => r.item);
    }
    // Deduplicate
    const seen = new Set<string>();
    return results.filter(n => {
      if (!n._id) return true;
      if (seen.has(n._id)) return false;
      seen.add(n._id);
      return true;
    });
  }, [notes, searchQuery]);

  // ─── Load notes ───────────────────────────────────────────────────────────

  const loadNotes = useCallback(async () => {
    log.info('Loading notes', { mode, assistantName });
    setIsLoading(true);

    if (incrementalAbortRef.current) {
      incrementalAbortRef.current();
      incrementalAbortRef.current = null;
    }

    try {
      const allNotes: Note[] = [];
      const seenIds = new Set<string>();
      const sharedIds = new Set<string>();

      const handleBatch = (batch: NoteBatch) => {
        for (const item of batch.items) {
          const id = item._id;
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            allNotes.push(item as Note);
          }
        }
        if (batch.batch === 'shared-to-user' || batch.batch === 'shared-to-all') {
          for (const item of batch.items) { if (item._id) sharedIds.add(item._id); }
        }
        setNotes([...allNotes]);
        setSharedNoteIds(new Set(sharedIds));
      };

      const modeParam = 'all';
      const { promise, abort } = fetchNotesIncremental(assistantName, modeParam, handleBatch);
      incrementalAbortRef.current = abort;

      await promise;
      incrementalAbortRef.current = null;

      const refreshTarget = refreshTargetRef.current;
      if (refreshTarget?.noteId) {
        const target = allNotes.find(n => n._id === refreshTarget.noteId);
        if (target) { setCurrentNote(target); setOriginalNote(target); }
        refreshTargetRef.current = null;
      }
    } catch (e) {
      log.error('Error loading notes, falling back to legacy', { error: e instanceof Error ? e.message : String(e) });
      try {
        const data = await fetchNotes(mode, assistantName);
        setNotes(data);
      } catch { setNotes([]); }
    } finally {
      setIsLoading(false);
      isReadyRef.current = true;
      if (commandQueueRef.current.length > 0) {
        commandQueueRef.current.forEach(cmd => {
          window.dispatchEvent(new CustomEvent('notepadCommand', { detail: cmd }));
        });
        commandQueueRef.current = [];
      }
    }
  }, [assistantName]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  // ─── Offline queue flush ──────────────────────────────────────────────────

  const flushOfflineQueue = useCallback(async () => {
    if (!isOnline) return;
    let next = consumeNextQueuedNote();
    while (next) {
      try {
        const updated = await updateNote(next.noteId, next.data, next.assistantName);
        setNotes(prev => prev.map(n => n._id === updated._id ? updated : n));
        if (currentNoteRef.current?._id === updated._id) { setCurrentNote(updated); setOriginalNote(updated); }
      } catch (error) {
        const retried = { ...next, attempts: next.attempts + 1 };
        if (!shouldDropQueuedItem(retried)) requeueNoteUpdate(retried);
        break;
      }
      next = consumeNextQueuedNote();
    }
  }, [isOnline]);

  useEffect(() => { if (isOnline) flushOfflineQueue(); }, [flushOfflineQueue, isOnline]);

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  const handleSaveNote = useCallback(async () => {
    if (!currentNote || !(currentNote.content || '').trim()) return;
    if (!hasWriteAccess(currentNote)) {
      toast({ title: 'Read-only access', description: 'You do not have write access to this note.' });
      return;
    }

    if (!isOnline) {
      queueOfflineNoteUpdate({
        noteId: currentNote._id!,
        assistantName,
        data: { title: currentNote.title || '', content: currentNote.content || '', isPinned: currentNote.isPinned },
      });
      setOriginalNote(currentNote);
      toast({ title: 'Saved offline', description: 'Will sync when back online.', duration: 3000 });
      return;
    }

    setIsSaving(true);
    try {
      const updated = await updateNote(
        currentNote._id!,
        { title: currentNote.title || '', content: currentNote.content || '', isPinned: currentNote.isPinned },
        assistantName
      );
      posthog?.capture('note_saved', { noteId: currentNote._id, mode: currentNote.mode });
      await trackSessionHistory('Updated Note', [{ type: 'Notes', id: currentNote._id!, description: `Title: ${currentNote.title}` }]);
      setNotes(prev => prev.map(n => n._id === currentNote._id ? updated : n));
      setCurrentNote(updated);
      setOriginalNote(updated);
      setIsEditMode(false);
      sendNoteState('updated', updated);
    } catch (e: any) {
      toast({ title: 'Failed to save', description: e.message === 'Failed to update note' ? 'Access denied.' : 'Please try again.' });
    } finally {
      setIsSaving(false);
    }
  }, [currentNote, assistantName, isOnline, hasWriteAccess, posthog, toast]);

  const handleCreateNote = useCallback(async (title = 'New Note', initialContent?: string, forcedMode?: NoteMode) => {
    setIsLoading(true);
    try {
      const nextMode = forcedMode || mode;
      const newNote = await createNote({ title, content: initialContent ?? '', mode: nextMode }, assistantName);
      posthog?.capture('note_created', { noteId: newNote._id, mode: nextMode });
      await trackSessionHistory('Created Note', [{ type: 'Notes', id: newNote._id, description: `Title: ${newNote.title}` }]);
      setNotes(prev => [newNote, ...prev]);
      setCurrentNote(newNote);
      setOriginalNote(newNote);
      setIsEditMode(true);
      setViewState('document');
    } catch {
      toast({ title: 'Failed to create note', description: 'Please try again.' });
    } finally { setIsLoading(false); }
  }, [mode, assistantName, posthog, toast]);

  const handleDeleteNote = useCallback(async (noteId: string) => {
    setNoteToDeleteId(noteId);
    setShowDeleteDialog(true);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!noteToDeleteId) return;
    setIsLoading(true);
    setShowDeleteDialog(false);
    try {
      await deleteNoteApi(noteToDeleteId, assistantName);
      posthog?.capture('note_deleted', { noteId: noteToDeleteId });
      await trackSessionHistory('Deleted Note', [{ type: 'Notes', id: noteToDeleteId }]);
      const updated = notes.filter(n => n._id !== noteToDeleteId);
      setNotes(updated);
      if (currentNote?._id === noteToDeleteId) {
        setCurrentNote(null); setOriginalNote(null); setViewState('library');
      }
      setNoteToDeleteId(null);
    } catch {
      toast({ title: 'Failed to delete note', description: 'Please try again.' });
    } finally { setIsLoading(false); }
  }, [noteToDeleteId, assistantName, notes, currentNote, posthog, toast]);

  const downloadNote = useCallback(() => {
    if (!currentNote) return;
    posthog?.capture('note_downloaded', { noteId: currentNote._id });
    const blob = new Blob([JSON.stringify(currentNote, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${currentNote.title || 'Untitled'}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [currentNote, posthog]);

  // ─── Note switching with unsaved check ────────────────────────────────────

  const openNote = useCallback((note: Note) => {
    setCurrentNote(note);
    setOriginalNote(note);
    setIsEditMode(false);
    setIsStreaming(false);
    setViewState('document');
    sendNoteState('opened', note);
    // Also emit via Daily app-message so the bot's LLM context is updated
    try {
      const contentStr = typeof note.content === 'string' ? note.content : (note.content as any)?.content || '';
      forwardAppEvent(EventEnum.NOTE_OPEN, {
        noteId: note._id,
        title: note.title || 'Untitled',
        content: contentStr.slice(0, 4000), // Limit content size for transport
        source: 'user',
      });
    } catch { /* non-fatal */ }
  }, [sendNoteState]);

  const handleNoteSwitch = useCallback((note: Note) => {
    if (hasUnsavedChanges()) {
      setPendingAction(() => () => openNote(note));
      setShowUnsavedDialog(true);
    } else {
      openNote(note);
    }
  }, [hasUnsavedChanges, openNote]);

  const handleModeSwitch = useCallback((newMode: NoteMode) => {
    if (newMode === mode) return;
    posthog?.capture('note_mode_switched', { mode: newMode });
    if (hasUnsavedChanges()) {
      setPendingAction(() => () => setMode(newMode));
      setShowUnsavedDialog(true);
    } else {
      setMode(newMode);
    }
  }, [mode, hasUnsavedChanges, posthog]);

  const handleBackToLibrary = useCallback(() => {
    const doClose = () => {
      setViewState('library');
      setCurrentNote(null);
      setIsEditMode(false);
      sendNoteState('closed');
      try { forwardAppEvent(EventEnum.NOTE_CLOSE, { source: 'user' }); } catch { /* non-fatal */ }
    };
    if (hasUnsavedChanges()) {
      setPendingAction(() => doClose);
      setShowUnsavedDialog(true);
    } else {
      doClose();
    }
  }, [hasUnsavedChanges, sendNoteState]);

  // ─── Auto-save ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasUnsavedChanges() || !isEditMode) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      // Don't auto-save, just mark as needing save
    }, 3000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [currentNote, isEditMode, hasUnsavedChanges]);

  // ─── beforeunload ─────────────────────────────────────────────────────────

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [hasUnsavedChanges]);

  // ─── Document drop ────────────────────────────────────────────────────────

  const handleDocumentDrop = useCallback(async (files: FileList) => {
    const file = files[0];
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop();
    const supported = ['pdf', 'docx', 'csv', 'md', 'markdown', 'txt'];
    if (!ext || !supported.includes(ext)) {
      toast({ title: 'Unsupported file type', description: 'Supported: PDF, DOCX, CSV, MD, TXT', variant: 'destructive' });
      return;
    }
    if (ext === 'pdf') { const v = validatePDFFile(file); if (!v.valid) { toast({ title: 'Invalid PDF', description: v.error, variant: 'destructive' }); return; } }
    setIsProcessingDocument(true);
    try {
      setProcessingStatus(`Extracting text from ${ext.toUpperCase()}...`);
      const result = await processDocumentFile(file, { useOCR: ext === 'pdf', forceOCR: false, ocrLanguage: 'eng', onProgress: s => setProcessingStatus(s) });
      if (!result.success) { toast({ title: 'Processing failed', description: result.error, variant: 'destructive' }); return; }
      const title = `${file.name.replace(/\.\w+$/i, '')} - Extracted Text`;
      const content = `# Extracted from: ${file.name}\n\n${result.text}`;
      const response = await fetch(`/api/notes/pdf?agent=${assistantName}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, mode, sourceFile: { name: file.name, size: file.size, type: ext, extractedAt: new Date().toISOString(), pageCount: result.metadata?.pageCount } }),
      });
      if (!response.ok) throw new Error('Failed to create note from document');
      const newNote = await response.json();
      setNotes(prev => [newNote, ...prev]);
      openNote(newNote);
      toast({ title: `${ext.toUpperCase()} processed`, description: `Created "${title}"` });
    } catch {
      toast({ title: 'Failed to process document', description: 'Please try again.', variant: 'destructive' });
    } finally { setIsProcessingDocument(false); setProcessingStatus(''); }
  }, [assistantName, mode, toast, openNote]);

  // ─── Drag events ──────────────────────────────────────────────────────────

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragCounter(p => { if (p === 0) setIsDragOver(true); return p + 1; });
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragCounter(p => { const n = p - 1; if (n <= 0) { setIsDragOver(false); return 0; } return n; });
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false); setDragCounter(0);
    if (e.dataTransfer.files?.length) handleDocumentDrop(e.dataTransfer.files);
  }, [handleDocumentDrop]);

  // ─── Event listeners ──────────────────────────────────────────────────────

  // NIA_EVENT_NOTE_UPDATED — streaming content from Pearl
  useEffect(() => {
    const handler = (e: Event) => {
      const evt = e as CustomEvent;
      const detail = evt.detail || {};
      const payload = detail.payload || detail;
      const content = payload.content as string;
      const title = payload.title as string;
      const noteId = payload.noteId as string;

      log.info('Note updated event', { noteId, hasContent: !!content, hasTitle: !!title });

      if (!noteId && !currentNoteRef.current) return;

      const targetId = noteId || currentNoteRef.current?._id;

      setIsStreaming(true);
      // Clear streaming after a delay
      setTimeout(() => setIsStreaming(false), 2000);

      if (targetId && currentNoteRef.current?._id === targetId) {
        setCurrentNote(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            ...(content !== undefined ? { content } : {}),
            ...(title !== undefined ? { title } : {}),
          };
        });
      } else if (targetId) {
        // Update in notes list
        setNotes(prev => prev.map(n => n._id === targetId ? { ...n, ...(content !== undefined ? { content } : {}), ...(title !== undefined ? { title } : {}) } : n));
      }
    };
    window.addEventListener(NIA_EVENT_NOTE_UPDATED, handler as EventListener);
    return () => window.removeEventListener(NIA_EVENT_NOTE_UPDATED, handler as EventListener);
  }, []);

  // Bridge NOTE_MODE_SWITCH
  useEffect(() => {
    const handler = (e: Event) => {
      const evt = e as CustomEvent;
      const detail = evt.detail || {};
      const payload = detail.payload || {};
      const m = payload.mode as NoteMode;
      if (m) {
        window.dispatchEvent(new CustomEvent('notepadCommand', { detail: { action: 'switchOrganisationMode', payload: { mode: m } } }));
      }
    };
    window.addEventListener(NIA_EVENT_NOTE_MODE_SWITCH, handler as EventListener);
    return () => window.removeEventListener(NIA_EVENT_NOTE_MODE_SWITCH, handler as EventListener);
  }, []);

  // Bridge NOTE_CLOSE
  useEffect(() => {
    const handler = () => {
      window.dispatchEvent(new CustomEvent('notepadCommand', { detail: { action: 'backToNotes', payload: {} } }));
    };
    window.addEventListener(NIA_EVENT_NOTE_CLOSE, handler as EventListener);
    return () => window.removeEventListener(NIA_EVENT_NOTE_CLOSE, handler as EventListener);
  }, []);

  // Bridge NOTE_SAVED — add new note to state and auto-open
  useEffect(() => {
    const handler = (e: Event) => {
      const evt = e as CustomEvent;
      const detail = evt.detail || {};
      const payload = detail.payload || {};
      const noteId = payload.noteId as string;
      const note = payload.note as Note | undefined;

      if (note && note._id) {
        // New note created via bot — add to state and open it
        setNotes(prev => {
          const exists = prev.find(n => n._id === note._id);
          if (exists) return prev.map(n => n._id === note._id ? { ...n, ...note } : n);
          return [note, ...prev];
        });
        setCurrentNote(note);
        setOriginalNote(note);
        setViewState('document');
        setIsEditMode(false);
      } else if (noteId) {
        // Existing note saved — try to refresh it
        const existing = notesRef.current.find(n => n._id === noteId);
        if (existing) {
          // Trigger a save of the current note if it matches
          if (currentNoteRef.current?._id === noteId) {
            handleSaveNote();
          }
        } else {
          // Note not in state — fetch and add
          findNoteWithFuzzySearch({ id: noteId }, assistantName).then(lookup => {
            if (lookup.found && lookup.note) {
              const fresh = lookup.note as Note;
              setNotes(prev => [fresh, ...prev]);
              setCurrentNote(fresh);
              setOriginalNote(fresh);
              setViewState('document');
            }
          }).catch(() => {});
        }
      }
    };
    window.addEventListener(NIA_EVENT_NOTE_SAVED, handler as EventListener);
    return () => window.removeEventListener(NIA_EVENT_NOTE_SAVED, handler as EventListener);
  }, [assistantName, handleSaveNote]);

  // Bridge NOTE_DOWNLOAD
  useEffect(() => {
    const handler = (e: Event) => {
      const evt = e as CustomEvent;
      const detail = evt.detail || {};
      const payload = detail.payload || {};
      if (payload.noteId) {
        window.dispatchEvent(new CustomEvent('notepadCommand', { detail: { action: 'downloadNote', payload: { noteId: payload.noteId } } }));
      }
    };
    window.addEventListener(NIA_EVENT_NOTE_DOWNLOAD, handler as EventListener);
    return () => window.removeEventListener(NIA_EVENT_NOTE_DOWNLOAD, handler as EventListener);
  }, []);

  // NOTES_REFRESH
  useEffect(() => {
    const handler = async (event: Event) => {
      const customEvent = event as CustomEvent<NiaEventDetail<Record<string, unknown>>>;
      const payload = (customEvent.detail?.payload ?? {}) as Record<string, unknown>;
      const noteId = typeof payload.noteId === 'string' ? payload.noteId : undefined;
      const noteMode = typeof payload.mode === 'string' ? (payload.mode as NoteMode) : undefined;

      if (noteId) refreshTargetRef.current = { noteId, mode: noteMode ?? null };
      if (noteMode) setMode(noteMode);
      await loadNotes();
    };
    window.addEventListener(NIA_EVENT_NOTES_REFRESH, handler as EventListener);
    return () => window.removeEventListener(NIA_EVENT_NOTES_REFRESH, handler as EventListener);
  }, [mode, loadNotes]);

  // NOTES_LIST
  useEffect(() => {
    const handler = async () => {
      try {
        log.info('[NotesView] Received notes.list event, refreshing notes');
        await loadNotes();
      } catch (err) {
        log.error('[NotesView] Error handling notes.list event', err as Record<string, unknown>);
      }
    };
    window.addEventListener(NIA_EVENT_NOTES_LIST, handler as EventListener);
    return () => window.removeEventListener(NIA_EVENT_NOTES_LIST, handler as EventListener);
  }, [loadNotes]);

  // ─── Voice command bridge ─────────────────────────────────────────────────

  useEffect(() => {
    const handler = async (e: Event) => {
      const evt = e as CustomEvent;
      const detail = evt.detail || {};
      const action = detail.action as string;
      const payload = detail.payload || {};

      log.debug('notepadCommand', { action, payload });

      if (action === 'createNote') {
        const title = (payload.title as string) || 'New Note';
        const initialContent = (payload.initialContent as string) || undefined;
        const newMode = (payload.mode as NoteMode) || undefined;
        if (newMode) setMode(newMode);
        if (shouldIgnoreDuplicate(action, { title, newMode })) return;
        const targetMode = newMode || mode;
        const existing = notes.find(n => (n.title || '').trim().toLowerCase() === title.trim().toLowerCase() && (n.mode || 'personal') === targetMode);
        if (existing) {
          openNote(existing);
          if (initialContent) {
            const merged = mergeBulletList(existing.content || '', parseListItems(initialContent));
            setCurrentNote(prev => prev ? { ...prev, content: merged } : prev);
            setIsEditMode(true);
          }
        } else {
          handleCreateNote(title, initialContent ? mergeBulletList('', parseListItems(initialContent)) : undefined, newMode);
        }
      }
      if (action === 'deleteNote') {
        const title = (payload.title as string) || '';
        const target = notes.find(n => (n.title || '').toLowerCase() === title.toLowerCase());
        if (target?._id) { if (!shouldIgnoreDuplicate(action, { title })) handleDeleteNote(target._id); }
      }
      if (action === 'saveNote') { if (!shouldIgnoreDuplicate(action, {})) handleSaveNote(); }
      if (action === 'downloadNote') { if (!shouldIgnoreDuplicate(action, {})) downloadNote(); }
      if (action === 'writeContent') {
        const content = (payload.content as string) || '';
        if (!shouldIgnoreDuplicate(action, { content })) {
          setCurrentNote(prev => prev ? { ...prev, content } : prev);
          setIsEditMode(true);
        }
      }
      if (action === 'addContent') {
        const content = (payload.content as string) || '';
        if (!shouldIgnoreDuplicate(action, { content })) {
          const merged = mergeBulletList(currentNoteRef.current?.content || '', parseListItems(content));
          setCurrentNote(prev => prev ? { ...prev, content: merged } : prev);
          setIsEditMode(true);
        }
      }
      if (action === 'updateContent') {
        const fromText = (payload.fromText as string) || '';
        const toText = (payload.toText as string) || '';
        if (!shouldIgnoreDuplicate(action, { fromText, toText })) {
          setCurrentNote(prev => prev ? { ...prev, content: (prev.content || '').replace(fromText, toText) } : prev);
          setIsEditMode(true);
        }
      }
      if (action === 'removeContent') {
        const targetText = (payload.targetText as string) || '';
        if (!shouldIgnoreDuplicate(action, { targetText })) {
          setCurrentNote(prev => prev ? { ...prev, content: removeTargetFromContent(prev.content || '', targetText) } : prev);
          setIsEditMode(true);
        }
      }
      if (action === 'switchOrganisationMode') {
        const newMode = (payload.mode as NoteMode) || 'personal';
        if (newMode !== mode) handleModeSwitch(newMode);
      }
      if (action === 'updateNoteTitle') {
        const newTitle = (payload.title as string) || '';
        if (newTitle) { setCurrentNote(prev => prev ? { ...prev, title: newTitle } : prev); setIsEditMode(true); }
      }
      if (action === 'attemptClose') {
        if (hasUnsavedChanges()) {
          setPendingAction(() => () => onClose?.());
          setShowUnsavedDialog(true);
        } else { onClose?.(); }
      }
      if (action === 'openNote') {
        if (!isReadyRef.current) { commandQueueRef.current.push({ action, payload }); return; }
        await new Promise(r => setTimeout(r, 300));
        let noteId = (payload.noteId as string) || '';
        const targetTitle = (payload.title as string) || '';
        const targetMode = (payload.mode as NoteMode) || mode;
        const eventNote = payload.note as Note | undefined;

        if (!noteId && eventNote?._id) noteId = eventNote._id;

        // If we got a full note object from the event, use it directly
        if (eventNote && eventNote._id) {
          const fresh = eventNote as Note;
          setNotes(prev => {
            const idx = prev.findIndex(n => n._id === fresh._id);
            if (idx >= 0) { const cp = [...prev]; cp[idx] = { ...cp[idx], ...fresh }; return cp; }
            return [fresh, ...prev];
          });
          openNote(fresh);
          setTimeout(() => sendMessage({ content: `Opened: "${fresh.title || 'Untitled'}"`, role: 'assistant', mode: 'queued' }), 500);
          return;
        }

        if (noteId) {
          try {
            const lookup = await findNoteWithFuzzySearch({ id: noteId }, assistantName);
            if (lookup.found && lookup.note) {
              const fresh = lookup.note as Note;
              // Merge into state
              setNotes(prev => {
                const idx = prev.findIndex(n => n._id === fresh._id);
                if (idx >= 0) { const cp = [...prev]; cp[idx] = { ...cp[idx], ...fresh }; return cp; }
                return [fresh as Note, ...prev];
              });
              openNote(fresh as Note);
              setTimeout(() => sendMessage({ content: `Opened: "${fresh.title || 'Untitled'}"`, role: 'assistant', mode: 'queued' }), 500);
              return;
            }
          } catch (err) { log.error('Failed to fetch note by ID', { noteId, error: err }); }
          // Try from local state
          const local = notesRef.current.find(n => n._id === noteId);
          if (local) { openNote(local); return; }
          sendMessage({ content: 'Could not find the requested note.', role: 'assistant', mode: 'queued' });
          return;
        }

        if (!targetTitle) return;
        if (shouldIgnoreDuplicate(action, { targetTitle, targetMode })) return;

        // Title-based fuzzy search
        let freshNotes: Note[] = notes;
        try { freshNotes = await fetchNotes(targetMode, assistantName) || []; } catch { /* use current */ }
        const allToSearch = [...freshNotes];
        for (const n of notes) { if (!allToSearch.find(x => x._id === n._id)) allToSearch.push(n); }
        const inMode = allToSearch.filter(n => (n.mode || 'personal') === targetMode);
        const fuzzyResults = fuzzySearch(inMode, targetTitle, n => n.title || '', { minScore: 0.3, maxResults: 20, sortByScore: true });
        const matches = fuzzyResults.map(r => r.item);

        if (matches.length > 0) {
          openNote(matches[0]);
          setTimeout(() => sendMessage({ content: matches.length === 1 ? `Opened: "${matches[0].title}"` : `Found ${matches.length} matching notes. Opened: "${matches[0].title}"`, role: 'assistant', mode: 'queued' }), 800);
        } else {
          sendMessage({ content: `No notes found matching "${targetTitle}" in ${targetMode} mode.`, role: 'assistant', mode: 'queued' });
        }
      }
      if (action === 'backToNotes') {
        if (shouldIgnoreDuplicate(action, {})) return;
        setViewState('library');
        setCurrentNote(null);
        setIsEditMode(false);
        sendMessage({ content: 'Returned to notes list.', role: 'assistant', mode: 'queued' });
      }
    };

    window.addEventListener('notepadCommand', handler as EventListener);
    return () => window.removeEventListener('notepadCommand', handler as EventListener);
  }, [notes, mode, assistantName, hasUnsavedChanges, shouldIgnoreDuplicate, openNote, handleCreateNote, handleDeleteNote, handleSaveNote, downloadNote, handleModeSwitch, onClose, sendMessage, loadNotes]);

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (incrementalAbortRef.current) incrementalAbortRef.current();
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <style>{NN_STYLES}</style>
      {/* Delete Dialog */}
      {showDeleteDialog && (
        <div className="nn-overlay">
          <div className="nn-dialog">
            <div className="nn-dialog-icon">⚠️</div>
            <h3 className="nn-dialog-title">Delete Note</h3>
            <p className="nn-dialog-text">This action cannot be undone.</p>
            <div className="nn-dialog-actions">
              <button className="nn-btn nn-btn-ghost" onClick={() => { setShowDeleteDialog(false); setNoteToDeleteId(null); }}>Cancel</button>
              <button className="nn-btn nn-btn-danger" onClick={confirmDelete} disabled={isLoading}>
                {isLoading ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved Dialog */}
      {showUnsavedDialog && (
        <div className="nn-overlay">
          <div className="nn-dialog">
            <div className="nn-dialog-icon">💾</div>
            <h3 className="nn-dialog-title">Unsaved Changes</h3>
            <p className="nn-dialog-text">Save your changes before continuing?</p>
            <div className="nn-dialog-actions">
              <button className="nn-btn nn-btn-ghost" onClick={() => { setShowUnsavedDialog(false); setPendingAction(null); }}>Cancel</button>
              <button className="nn-btn nn-btn-danger" onClick={() => {
                setShowUnsavedDialog(false);
                setOriginalNote(currentNote);
                pendingAction?.();
                setPendingAction(null);
              }}>Discard</button>
              <button className="nn-btn nn-btn-primary" onClick={async () => {
                await handleSaveNote();
                setShowUnsavedDialog(false);
                pendingAction?.();
                setPendingAction(null);
              }} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="nn-root" onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>
        <div className="nn-accent-line" />
        <input ref={fileInputRef} type="file" className="nn-hidden" accept=".pdf,.docx,.csv,.md,.markdown,.txt" onChange={e => { if (e.target.files?.length) handleDocumentDrop(e.target.files); e.target.value = ''; }} />

        {/* Drag overlay */}
        {(isDragOver || isProcessingDocument) && (
          <div className="nn-drag-overlay">
            {isProcessingDocument ? (
              <div className="nn-drag-content">
                <div className="nn-spinner" />
                <p className="nn-drag-title">Processing…</p>
                <p className="nn-drag-subtitle">{processingStatus}</p>
              </div>
            ) : (
              <div className="nn-drag-content">
                <div className="nn-drag-icon">📄</div>
                <p className="nn-drag-title">Drop Document</p>
                <p className="nn-drag-subtitle">PDF, DOCX, CSV, MD, TXT</p>
              </div>
            )}
          </div>
        )}

        {/* Loading bar */}
        {(isLoading || isSaving) && <div className="nn-loading-bar" />}

        {viewState === 'library' ? (
          // ═══ LIBRARY VIEW ═══
          <div className="nn-library">
            {/* Ambient particles */}
            <div className="nn-particles">
              <span /><span /><span /><span /><span /><span /><span /><span /><span /><span />
            </div>
            {/* Header */}
            <div className="nn-library-header">
              <div className="nn-library-header-top">
                <h1 className="nn-library-title">Notes</h1>
                <div className="nn-library-header-actions">
                  <button className="nn-btn nn-btn-icon" onClick={() => { setSearchExpanded(e => !e); setTimeout(() => searchInputRef.current?.focus(), 100); }} title="Search">
                    🔍
                  </button>
                </div>
              </div>

              {/* Search — collapsed to magnifying glass icon */}
              {searchExpanded ? (
                <div className="nn-search-wrap nn-search-expanded">
                  <span className="nn-search-icon">🔍</span>
                  <input
                    ref={searchInputRef}
                    className="nn-search-input"
                    type="text"
                    placeholder="Search notes…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    autoFocus
                    onBlur={() => { if (!searchQuery) setSearchExpanded(false); }}
                  />
                  {searchQuery && (
                    <button className="nn-search-clear" onClick={() => { setSearchQuery(''); setSearchExpanded(false); }}>✕</button>
                  )}
                </div>
              ) : null}
            </div>

            {/* Content */}
            <div className="nn-library-body">
              {isLoading && notes.length === 0 ? (
                <div className="nn-empty">
                  <div className="nn-spinner" />
                  <p>Loading notes…</p>
                </div>
              ) : filteredNotes.length === 0 ? (
                searchQuery ? (
                  <div className="nn-empty">
                    <div className="nn-empty-icon">🔍</div>
                    <p className="nn-empty-title">No matches</p>
                    <p className="nn-empty-subtitle">Try a different search</p>
                  </div>
                ) : (
                  <div className="nn-empty-magic">
                    <div className="nn-empty-ring">✦</div>
                    <p className="nn-empty-magic-title">Your canvas awaits</p>
                    <p className="nn-empty-magic-sub">Tap + to begin creating</p>
                  </div>
                )
              ) : libraryLayout === 'cards' ? (
                <div className="nn-card-grid">
                  {filteredNotes.map((note, index) => (
                    <div
                      key={note._id || `note-${index}`}
                      className={`nn-card ${currentNote?._id === note._id ? 'nn-card-active' : ''} ${note.isPinned ? 'nn-card-pinned' : ''}`}
                      style={{ animationDelay: `${index * 60}ms` }}
                      onClick={() => handleNoteSwitch(note)}
                    >
                      {note.isPinned && <span className="nn-pin-diamond">◆</span>}
                      {isFeatureEnabled('resourceSharing', supportedFeatures) && sharedNoteIds.has(note._id!) && (
                        <div className="nn-shared-badge"><SharedIndicator /></div>
                      )}
                      <h3 className="nn-card-title">{note.title || 'Untitled'}</h3>
                      <p className="nn-card-preview">{getPreview(note.content || '')}</p>
                      <div className="nn-card-footer">
                        <span className="nn-card-date">{formatDate(note)}</span>
                        {hasWriteAccess(note) && (
                          <button className="nn-card-delete" onClick={e => { e.stopPropagation(); handleDeleteNote(note._id!); }} title="Delete">🗑️</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="nn-spine-list">
                  {filteredNotes.map((note, index) => (
                    <div key={note._id || `spine-${index}`} className="nn-spine-item">
                      {isFeatureEnabled('resourceSharing', supportedFeatures) && sharedNoteIds.has(note._id!) && (
                        <div className="nn-shared-badge-spine"><SharedIndicator /></div>
                      )}
                      <BookSpine
                        title={note.title}
                        contentLength={note.content?.length || 0}
                        isSelected={currentNote?._id === note._id}
                        onClick={() => handleNoteSwitch(note)}
                        onDelete={hasWriteAccess(note) ? () => handleDeleteNote(note._id!) : undefined}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* FAB — Create New Note */}
            <button
              className={`nn-fab ${filteredNotes.length === 0 && !searchQuery ? 'nn-fab-glow-strong' : ''}`}
              onClick={() => handleCreateNote()}
              disabled={isLoading}
              title="Create new note"
            >
              +
            </button>
          </div>
        ) : (
          // ═══ DOCUMENT VIEW ═══
          <div className="nn-document">
            {/* Toolbar */}
            <div className="nn-toolbar">
              <div className="nn-toolbar-left">
                <button className="nn-btn nn-btn-icon nn-btn-back" onClick={handleBackToLibrary} title="Back to library">
                  ←
                </button>
                <button className="nn-btn nn-btn-icon" onClick={downloadNote} title="Download">⬇️</button>
                <button className="nn-btn nn-btn-icon" onClick={() => fileInputRef.current?.click()} title="Import">📎</button>
                {currentNote && (
                  <NoteShareControls
                    currentNote={currentNote}
                    supportedFeatures={supportedFeatures}
                    tenantId={currentNote?.tenantId || propTenantId}
                    onSharingUpdated={() => toast({ title: 'Sharing Updated' })}
                  />
                )}
                <button
                  className={`nn-btn nn-btn-icon ${isEditMode ? 'nn-btn-active' : ''}`}
                  onClick={() => { if (isEditMode && hasWriteAccess(currentNote)) setIsEditMode(false); else if (hasWriteAccess(currentNote)) setIsEditMode(true); }}
                  title={isEditMode ? 'Preview' : 'Edit'}
                >
                  {isEditMode ? '👁️' : '✏️'}
                </button>
                {hasWriteAccess(currentNote) && currentNote?._id && (
                  <button className="nn-btn nn-btn-icon nn-btn-delete-toolbar" onClick={() => handleDeleteNote(currentNote._id!)} title="Delete">🗑️</button>
                )}
              </div>
              <div className="nn-toolbar-right">
                {hasUnsavedChanges() && <span className="nn-unsaved-dot" title="Unsaved changes" />}
                {!hasWriteAccess(currentNote) ? (
                  <span className="nn-readonly-badge">🔒 Read-only</span>
                ) : (
                  <button
                    className="nn-btn nn-btn-save"
                    onClick={handleSaveNote}
                    disabled={!hasUnsavedChanges() || isSaving || !currentNote?.content?.trim()}
                  >
                    {isSaving ? '⏳' : '💾'} {isSaving ? 'Saving…' : 'Save'}
                  </button>
                )}
              </div>
            </div>

            {/* Document content */}
            {currentNote ? (
              <div className="nn-doc-content">
                {/* Title — always visible h1, with edit input when in edit mode */}
                {!isEditMode && <h1 className="nn-doc-title-always">{currentNote.title || 'Untitled'}</h1>}
                {isEditMode && hasWriteAccess(currentNote) && (
                  <input
                    className="nn-title-input"
                    type="text"
                    value={currentNote.title || ''}
                    onChange={e => setCurrentNote(prev => prev ? { ...prev, title: e.target.value } : prev)}
                    placeholder="Untitled"
                    disabled={isSaving}
                  />
                )}

                {/* Meta */}
                <div className="nn-doc-meta">
                  <span>{formatDate(currentNote)}</span>
                  {currentNote.mode === 'work' && <span className="nn-work-badge">WORK</span>}
                  {currentNote.sourceFile && (
                    <span className="nn-source-badge">
                      {currentNote.sourceFile.type.toUpperCase()}: {currentNote.sourceFile.name} ({formatFileSize(currentNote.sourceFile.size)})
                    </span>
                  )}
                </div>

                {/* Body */}
                {isEditMode && hasWriteAccess(currentNote) ? (
                  <textarea
                    className="nn-editor"
                    value={currentNote.content || ''}
                    onChange={e => setCurrentNote(prev => prev ? { ...prev, content: e.target.value } : prev)}
                    placeholder="Start writing…"
                    disabled={isSaving}
                  />
                ) : (
                  <div className="nn-rendered-content">
                    <StreamingRenderer content={currentNote.content || ''} isStreaming={isStreaming} noteId={currentNote._id} />
                  </div>
                )}
              </div>
            ) : (
              <div className="nn-empty">
                <p>No note selected</p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const NN_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400&family=Inter:wght@300;400;500;600&family=Source+Code+Pro:wght@400;500&display=swap');

/* ── Reset & Root ─────────────────────────────────────────────────────── */

.nn-root {
  position: relative;
  width: 100%;
  height: 100%;
  background: #0a0a0f;
  color: #e8e6e3;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.nn-hidden { display: none !important; }

/* ── Loading Bar ──────────────────────────────────────────────────────── */

.nn-loading-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 100;
  background: linear-gradient(90deg, transparent, #7c6f9f, transparent);
  background-size: 200% 100%;
  animation: nn-shimmer 1.5s ease-in-out infinite;
}

@keyframes nn-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

/* ── Buttons ──────────────────────────────────────────────────────────── */

.nn-btn {
  border: none;
  cursor: pointer;
  font-family: 'Gohufont', 'Inter', monospace;
  font-size: 13px;
  border-radius: 8px;
  padding: 6px 14px;
  transition: all 0.2s ease-out;
  background: transparent;
  color: #e8e6e3;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.nn-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.nn-btn:hover:not(:disabled) { background: rgba(124, 111, 159, 0.15); }

.nn-btn-icon {
  padding: 6px 8px;
  font-size: 16px;
  border-radius: 8px;
  min-width: 32px;
  justify-content: center;
}
.nn-btn-icon:hover:not(:disabled) { background: rgba(124, 111, 159, 0.2); }

.nn-btn-active { background: rgba(124, 111, 159, 0.25) !important; }

.nn-btn-accent {
  background: rgba(124, 111, 159, 0.2);
  color: #c4b5fd;
  border: 1px solid rgba(124, 111, 159, 0.3);
}
.nn-btn-accent:hover:not(:disabled) {
  background: rgba(124, 111, 159, 0.35);
  border-color: rgba(124, 111, 159, 0.5);
}

.nn-btn-new-note {
  background: linear-gradient(135deg, #7c6f9f, #9b8ec4);
  color: #fff;
  border: none;
  padding: 8px 20px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(124, 111, 159, 0.4), 0 0 24px rgba(124, 111, 159, 0.15);
  letter-spacing: 0.02em;
  transition: all 0.25s ease-out;
}
.nn-btn-new-note:hover:not(:disabled) {
  background: linear-gradient(135deg, #8d7fb3, #ac9fd4);
  box-shadow: 0 6px 24px rgba(124, 111, 159, 0.55), 0 0 32px rgba(124, 111, 159, 0.25);
  transform: translateY(-1px);
}

.nn-btn-primary {
  background: #7c6f9f;
  color: #fff;
}
.nn-btn-primary:hover:not(:disabled) { background: #8d7fb3; }

.nn-btn-danger {
  background: rgba(197, 107, 107, 0.2);
  color: #ef9a9a;
  border: 1px solid rgba(197, 107, 107, 0.3);
}
.nn-btn-danger:hover:not(:disabled) {
  background: rgba(197, 107, 107, 0.35);
}

.nn-btn-ghost { color: #8a8a9a; }
.nn-btn-ghost:hover:not(:disabled) { color: #e8e6e3; }

.nn-btn-save {
  background: rgba(124, 111, 159, 0.2);
  color: #c4b5fd;
  border: 1px solid rgba(124, 111, 159, 0.3);
  font-size: 13px;
  padding: 6px 16px;
}
.nn-btn-save:hover:not(:disabled) { background: rgba(124, 111, 159, 0.4); }

.nn-btn-back { font-size: 20px; }

.nn-btn-delete-toolbar:hover:not(:disabled) { background: rgba(197, 107, 107, 0.2); }

.nn-mt-4 { margin-top: 16px; }

/* ── Overlay / Dialog ─────────────────────────────────────────────────── */

.nn-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.6);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: nn-fade-in 0.2s ease-out;
}

.nn-dialog {
  background: #12121a;
  border: 1px solid #1e1e2e;
  border-radius: 16px;
  padding: 32px;
  max-width: 400px;
  width: 90%;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  animation: nn-scale-in 0.25s ease-out;
}

.nn-dialog-icon { font-size: 32px; margin-bottom: 12px; }
.nn-dialog-title {
  font-family: 'Crimson Pro', serif;
  font-size: 22px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #e8e6e3;
}
.nn-dialog-text { color: #8a8a9a; font-size: 14px; margin-bottom: 24px; }
.nn-dialog-actions { display: flex; gap: 10px; justify-content: center; }

/* ── Library View ─────────────────────────────────────────────────────── */

.nn-library {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.nn-library-header {
  padding: 28px 28px 20px;
  border-bottom: 1px solid rgba(30, 30, 46, 0.6);
  flex-shrink: 0;
  background: linear-gradient(180deg, rgba(18, 18, 26, 0.5) 0%, transparent 100%);
}

.nn-library-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.nn-library-title {
  font-family: 'Crimson Pro', serif;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, #e8e6e3, #c4b5fd);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.nn-library-header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* Search */
.nn-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.nn-search-icon {
  position: absolute;
  left: 12px;
  font-size: 14px;
  pointer-events: none;
  opacity: 0.5;
}

.nn-search-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid #1e1e2e;
  border-radius: 10px;
  padding: 10px 36px 10px 38px;
  font-size: 14px;
  color: #e8e6e3;
  font-family: 'Inter', sans-serif;
  outline: none;
  transition: border-color 0.2s;
}
.nn-search-input::placeholder { color: #555; }
.nn-search-input:focus { border-color: rgba(124, 111, 159, 0.5); }

.nn-search-clear {
  position: absolute;
  right: 10px;
  background: none;
  border: none;
  color: #8a8a9a;
  cursor: pointer;
  font-size: 14px;
  padding: 4px;
}
.nn-search-clear:hover { color: #e8e6e3; }

.nn-search-expanded {
  animation: nn-search-expand 0.25s ease-out;
}

@keyframes nn-search-expand {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Library body */
.nn-library-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px 24px;
}

.nn-library-body::-webkit-scrollbar { width: 6px; }
.nn-library-body::-webkit-scrollbar-track { background: transparent; }
.nn-library-body::-webkit-scrollbar-thumb { background: #1e1e2e; border-radius: 3px; }
.nn-library-body::-webkit-scrollbar-thumb:hover { background: #2e2e3e; }

/* Empty state */
.nn-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  min-height: 200px;
}

.nn-empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.4; }
.nn-empty-title { font-size: 18px; font-weight: 500; color: #8a8a9a; margin-bottom: 4px; }
.nn-empty-subtitle { font-size: 13px; color: #555; }

/* Card grid */
.nn-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.nn-card {
  background: #12121a;
  border: 1px solid #1e1e2e;
  border-radius: 14px;
  padding: 18px;
  cursor: pointer;
  transition: all 0.25s ease-out;
  position: relative;
  overflow: hidden;
}
.nn-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 14px;
  opacity: 0;
  transition: opacity 0.25s;
  background: linear-gradient(135deg, rgba(124, 111, 159, 0.08), transparent);
}
.nn-card:hover {
  border-color: rgba(124, 111, 159, 0.4);
  transform: translateY(-4px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35), 0 0 20px rgba(124, 111, 159, 0.1);
}
.nn-card:hover::before { opacity: 1; }
.nn-card-active { border-color: rgba(124, 111, 159, 0.5); }
.nn-card-pinned { border-color: rgba(196, 181, 253, 0.2); }

.nn-pin {
  position: absolute;
  top: 10px;
  right: 10px;
  font-size: 14px;
}

.nn-shared-badge { position: absolute; top: 10px; left: 10px; }
.nn-shared-badge-spine { position: absolute; left: -8px; top: 50%; transform: translateY(-50%); z-index: 2; }

.nn-card-title {
  font-family: 'Crimson Pro', serif;
  font-size: 17px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #e8e6e3;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nn-card-preview {
  font-size: 13px;
  color: #8a8a9a;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 12px;
}

.nn-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.nn-card-date {
  font-family: 'Gohufont', monospace;
  font-size: 11px;
  color: #555;
}

.nn-card-delete {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  opacity: 0;
  transition: opacity 0.2s;
  padding: 2px 4px;
}
.nn-card:hover .nn-card-delete { opacity: 0.6; }
.nn-card-delete:hover { opacity: 1 !important; }

/* Spine list */
.nn-spine-list {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.nn-spine-item { position: relative; width: 100%; display: flex; justify-content: center; }

/* ── Document View ────────────────────────────────────────────────────── */

.nn-document {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.nn-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-bottom: 1px solid #1e1e2e;
  flex-shrink: 0;
  gap: 8px;
}

.nn-toolbar-left { display: flex; align-items: center; gap: 4px; }
.nn-toolbar-right { display: flex; align-items: center; gap: 10px; }

.nn-unsaved-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c4b5fd;
  box-shadow: 0 0 8px rgba(196, 181, 253, 0.5);
  animation: nn-pulse 2s ease-in-out infinite;
}

.nn-readonly-badge {
  font-family: 'Gohufont', monospace;
  font-size: 11px;
  color: #8a8a9a;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 6px;
}

/* Document content area */
.nn-doc-content {
  flex: 1;
  overflow-y: auto;
  padding: 32px 48px 64px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
}

.nn-doc-content::-webkit-scrollbar { width: 6px; }
.nn-doc-content::-webkit-scrollbar-track { background: transparent; }
.nn-doc-content::-webkit-scrollbar-thumb { background: #1e1e2e; border-radius: 3px; }

@media (max-width: 768px) {
  /* Apply safe area insets at root level to avoid black bar */
  .nn-root {
    padding-top: env(safe-area-inset-top, 0px);
  }
  
  .nn-doc-content { 
    padding: 20px 16px 48px; 
    /* Remove redundant safe-area-inset since it's handled at root */
  }
  .nn-library-header { 
    padding: 16px 16px 12px; 
    /* Remove redundant safe-area-inset since it's handled at root */
  }
  .nn-library-body { padding: 12px 16px 16px; }
  .nn-card-grid { grid-template-columns: 1fr; }
  .nn-toolbar { 
    padding: 10px 12px; 
    /* Remove redundant safe-area-inset since it's handled at root */
  }
}

/* Title */
.nn-title-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  font-family: 'Crimson Pro', serif;
  font-size: 36px;
  font-weight: 600;
  color: #e8e6e3;
  margin-bottom: 8px;
  padding: 4px 0;
  border-bottom: 2px solid transparent;
  transition: border-color 0.2s;
}
.nn-title-input:focus { border-bottom-color: rgba(124, 111, 159, 0.4); }
.nn-title-input::placeholder { color: #333; }

.nn-doc-title {
  font-family: 'Crimson Pro', serif;
  font-size: 36px;
  font-weight: 600;
  color: #e8e6e3;
  margin-bottom: 8px;
  line-height: 1.2;
}

.nn-doc-title-always {
  font-family: 'Crimson Pro', serif;
  font-size: 36px !important;
  font-weight: 600 !important;
  color: #e8e6e3 !important;
  -webkit-text-fill-color: #e8e6e3 !important;
  margin: 0 0 8px 0 !important;
  padding: 0 !important;
  line-height: 1.2;
  background: none !important;
  -webkit-background-clip: unset !important;
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
}

/* Meta */
.nn-doc-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: 'Gohufont', monospace;
  font-size: 12px;
  color: #555;
  margin-bottom: 28px;
  padding-bottom: 20px;
  border-bottom: 1px solid #1e1e2e;
}

.nn-work-badge {
  background: rgba(124, 111, 159, 0.15);
  color: #c4b5fd;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  letter-spacing: 0.1em;
}

.nn-source-badge {
  background: rgba(255, 255, 255, 0.04);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
}

/* Editor */
.nn-editor {
  width: 100%;
  flex: 1;
  min-height: 400px;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  line-height: 1.75;
  color: #e8e6e3;
  padding: 0;
}
.nn-editor::placeholder { color: #333; }

/* ── Streaming / Rendered Content ─────────────────────────────────────── */

.nn-rendered-content { min-height: 200px; }

.nn-streaming-container {
  position: relative;
  /* No overflow — parent .nn-doc-content handles scrolling */
}

.nn-streaming-container::-webkit-scrollbar { width: 5px; }
.nn-streaming-container::-webkit-scrollbar-thumb { background: #1e1e2e; border-radius: 3px; }

/* Cursor */
.nn-cursor {
  display: inline-block;
  width: 2px;
  height: 1.2em;
  background: #c4b5fd;
  margin-left: 2px;
  vertical-align: text-bottom;
  border-radius: 1px;
  box-shadow: 0 0 8px rgba(196, 181, 253, 0.6), 0 0 16px rgba(196, 181, 253, 0.3);
  animation: nn-cursor-pulse 1.2s ease-in-out infinite;
}

@keyframes nn-cursor-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 8px rgba(196, 181, 253, 0.6); }
  50% { opacity: 0.3; box-shadow: 0 0 4px rgba(196, 181, 253, 0.2); }
}

/* ── Markdown Typography ──────────────────────────────────────────────── */

.nn-h1 {
  font-family: 'Crimson Pro', serif;
  font-size: 32px;
  font-weight: 700;
  color: #e8e6e3;
  margin: 32px 0 16px;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.nn-h2 {
  font-family: 'Crimson Pro', serif;
  font-size: 26px;
  font-weight: 600;
  color: #e8e6e3;
  margin: 28px 0 12px;
  line-height: 1.25;
}

.nn-h3 {
  font-family: 'Crimson Pro', serif;
  font-size: 22px;
  font-weight: 600;
  color: #e8e6e3;
  margin: 24px 0 10px;
}

.nn-h4 {
  font-family: 'Inter', sans-serif;
  font-size: 18px;
  font-weight: 600;
  color: #e8e6e3;
  margin: 20px 0 8px;
}

.nn-h5, .nn-h6 {
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 600;
  color: #8a8a9a;
  margin: 16px 0 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.nn-p {
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  line-height: 1.75;
  color: #d4d2cf;
  margin: 0 0 14px;
}

.nn-ul, .nn-ol {
  margin: 0 0 14px;
  padding-left: 24px;
}

.nn-ul { list-style: disc; }
.nn-ol { list-style: decimal; }

.nn-li {
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  line-height: 1.75;
  color: #d4d2cf;
  margin-bottom: 4px;
}

.nn-li::marker { color: #7c6f9f; }

.nn-blockquote {
  border-left: 3px solid rgba(124, 111, 159, 0.5);
  margin: 16px 0;
  padding: 12px 20px;
  background: rgba(124, 111, 159, 0.05);
  border-radius: 0 8px 8px 0;
}

.nn-blockquote .nn-p {
  color: #b0aeb8;
  font-style: italic;
  margin: 0;
}

.nn-code-inline {
  font-family: 'Source Code Pro', monospace;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 6px;
  border-radius: 4px;
  color: #c4b5fd;
}

.nn-pre {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid #1e1e2e;
  border-radius: 10px;
  padding: 16px;
  margin: 16px 0;
  overflow-x: auto;
}

.nn-code-block {
  font-family: 'Source Code Pro', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: #d4d2cf;
}

.nn-table-wrap {
  overflow-x: auto;
  margin: 16px 0;
  border-radius: 8px;
  border: 1px solid #1e1e2e;
}

.nn-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.nn-th {
  background: rgba(124, 111, 159, 0.1);
  padding: 10px 14px;
  text-align: left;
  font-weight: 600;
  font-size: 13px;
  color: #c4b5fd;
  border-bottom: 1px solid #1e1e2e;
}

.nn-td {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(30, 30, 46, 0.5);
  color: #d4d2cf;
}

.nn-hr {
  border: none;
  height: 1px;
  background: linear-gradient(90deg, transparent, #1e1e2e, transparent);
  margin: 28px 0;
}

.nn-a {
  color: #c4b5fd;
  text-decoration: none;
  border-bottom: 1px solid rgba(196, 181, 253, 0.3);
  transition: all 0.2s;
}
.nn-a:hover {
  color: #ddd0ff;
  border-bottom-color: #c4b5fd;
}

.nn-strong { font-weight: 600; color: #e8e6e3; }
.nn-em { font-style: italic; color: #c4c2bf; }

/* ── Spinner ──────────────────────────────────────────────────────────── */

.nn-spinner {
  width: 28px;
  height: 28px;
  border: 2px solid #1e1e2e;
  border-top-color: #7c6f9f;
  border-radius: 50%;
  animation: nn-spin 0.8s linear infinite;
  margin: 0 auto 12px;
}

@keyframes nn-spin { to { transform: rotate(360deg); } }

/* ── Animations ───────────────────────────────────────────────────────── */

@keyframes nn-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes nn-scale-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes nn-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@keyframes nn-word-reveal {
  from { opacity: 0; filter: blur(4px); transform: translateY(4px); }
  to { opacity: 1; filter: blur(0); transform: translateY(0); }
}

/* Word animation class */
.nn-word-animate {
  display: inline;
  animation: nn-word-reveal 0.3s ease-out forwards;
}

/* ── Drag Overlay ─────────────────────────────────────────────────────── */

.nn-drag-overlay {
  position: absolute;
  inset: 0;
  z-index: 150;
  background: rgba(10, 10, 15, 0.85);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed rgba(124, 111, 159, 0.5);
  border-radius: 12px;
}

.nn-drag-content { text-align: center; }
.nn-drag-icon { font-size: 48px; margin-bottom: 12px; }
.nn-drag-title { font-size: 20px; font-weight: 600; color: #c4b5fd; margin-bottom: 4px; }
.nn-drag-subtitle { font-size: 13px; color: #8a8a9a; }

/* ── Loading text ─────────────────────────────────────────────────────── */

.nn-loading { color: #8a8a9a; padding: 24px; text-align: center; }

/* ── FAB ──────────────────────────────────────────────────────────────── */

.nn-fab {
  position: absolute;
  bottom: 24px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #7c6f9f, #9b8ec4);
  color: #fff;
  font-size: 28px;
  font-weight: 300;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 24px rgba(124, 111, 159, 0.5), 0 0 40px rgba(124, 111, 159, 0.2);
  transition: all 0.25s ease-out;
  z-index: 50;
  animation: nn-fab-glow 3s ease-in-out infinite;
}
.nn-fab:hover:not(:disabled) {
  transform: scale(1.1);
  box-shadow: 0 8px 32px rgba(124, 111, 159, 0.65), 0 0 60px rgba(124, 111, 159, 0.3);
}
.nn-fab:active:not(:disabled) { transform: scale(0.95); }
.nn-fab:disabled { opacity: 0.4; cursor: not-allowed; }

@keyframes nn-fab-glow {
  0%, 100% { box-shadow: 0 6px 24px rgba(124, 111, 159, 0.5), 0 0 40px rgba(124, 111, 159, 0.15); }
  50% { box-shadow: 0 6px 28px rgba(124, 111, 159, 0.6), 0 0 56px rgba(124, 111, 159, 0.25); }
}

/* ── View transitions ─────────────────────────────────────────────────── */

.nn-library {
  animation: nn-view-enter 0.3s ease-out;
}

.nn-document {
  animation: nn-view-enter 0.3s ease-out;
}

@keyframes nn-view-enter {
  from { opacity: 0; transform: translateX(-8px); }
  to { opacity: 1; transform: translateX(0); }
}

/* ── 1. Ambient Particle Background ──────────────────────────────────── */

@keyframes nn-float-1 {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.3; }
  25% { transform: translate(10px, -20px) scale(1.1); opacity: 0.6; }
  50% { transform: translate(-5px, -40px) scale(0.9); opacity: 0.4; }
  75% { transform: translate(15px, -10px) scale(1.05); opacity: 0.5; }
}
@keyframes nn-float-2 {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.2; }
  25% { transform: translate(-12px, -15px) scale(1.15); opacity: 0.5; }
  50% { transform: translate(8px, -35px) scale(0.85); opacity: 0.35; }
  75% { transform: translate(-10px, -5px) scale(1.1); opacity: 0.45; }
}

.nn-particles {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}
.nn-particles span {
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(196, 181, 253, 0.4);
  box-shadow: 0 0 6px rgba(196, 181, 253, 0.3);
}
.nn-particles span:nth-child(odd) { animation: nn-float-1 12s ease-in-out infinite; }
.nn-particles span:nth-child(even) { animation: nn-float-2 15s ease-in-out infinite; }
.nn-particles span:nth-child(1) { top: 10%; left: 15%; animation-delay: 0s; }
.nn-particles span:nth-child(2) { top: 25%; left: 70%; animation-delay: -2s; width: 2px; height: 2px; }
.nn-particles span:nth-child(3) { top: 50%; left: 30%; animation-delay: -4s; }
.nn-particles span:nth-child(4) { top: 65%; left: 80%; animation-delay: -6s; width: 2px; height: 2px; }
.nn-particles span:nth-child(5) { top: 35%; left: 50%; animation-delay: -1s; }
.nn-particles span:nth-child(6) { top: 80%; left: 20%; animation-delay: -3s; width: 2px; height: 2px; }
.nn-particles span:nth-child(7) { top: 15%; left: 90%; animation-delay: -5s; }
.nn-particles span:nth-child(8) { top: 70%; left: 55%; animation-delay: -7s; width: 2px; height: 2px; }
.nn-particles span:nth-child(9) { top: 45%; left: 10%; animation-delay: -8s; }
.nn-particles span:nth-child(10) { top: 90%; left: 45%; animation-delay: -9s; width: 2px; height: 2px; }

/* ── 2. Card Entrance Stagger ─────────────────────────────────────────── */

@keyframes nn-card-enter {
  from { opacity: 0; transform: translateY(24px) scale(0.95); filter: blur(4px); }
  to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
}
.nn-card {
  animation: nn-card-enter 500ms ease-out both;
}

/* ── 3. Enhanced Streaming Cursor ─────────────────────────────────────── */

.nn-cursor {
  display: inline-block;
  width: 3px;
  height: 1.2em;
  background: linear-gradient(180deg, #c4b5fd, #7c6f9f);
  margin-left: 2px;
  vertical-align: text-bottom;
  border-radius: 2px;
  box-shadow:
    0 0 8px rgba(196, 181, 253, 0.7),
    0 0 16px rgba(196, 181, 253, 0.4),
    -2px 0 12px rgba(124, 111, 159, 0.3),
    -4px 0 20px rgba(124, 111, 159, 0.15);
  animation: nn-cursor-magic 1.5s ease-in-out infinite;
}

@keyframes nn-cursor-magic {
  0%, 100% { opacity: 1; transform: scaleY(1); box-shadow: 0 0 8px rgba(196,181,253,0.7), 0 0 16px rgba(196,181,253,0.4), -2px 0 12px rgba(124,111,159,0.3); }
  50% { opacity: 0.6; transform: scaleY(0.85); box-shadow: 0 0 4px rgba(196,181,253,0.3), 0 0 8px rgba(196,181,253,0.15), -2px 0 6px rgba(124,111,159,0.1); }
}

/* ── Blue Shimmer Glow on New Content ─────────────────────────────────── */

.nn-content-glow .nn-p:last-child,
.nn-content-glow .nn-li:last-child,
.nn-content-glow .nn-h1:last-child,
.nn-content-glow .nn-h2:last-child,
.nn-content-glow .nn-h3:last-child {
  animation: nn-blue-shimmer 0.8s ease-out;
}

@keyframes nn-blue-shimmer {
  0% {
    text-shadow: 0 0 12px rgba(100, 160, 255, 0.6), 0 0 24px rgba(80, 140, 255, 0.3);
    opacity: 0.7;
  }
  100% {
    text-shadow: none;
    opacity: 1;
  }
}

/* ── Content transition animations ────────────────────────────────────── */

/* New lines slide up and fade in */
.nn-line-new {
  animation: nn-line-fade-in 0.4s ease-out both;
}

@keyframes nn-line-fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
    filter: blur(2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0);
  }
}

/* Modified lines get a brief highlight glow */
.nn-line-modified {
  animation: nn-line-highlight 0.8s ease-out both;
}

@keyframes nn-line-highlight {
  0% {
    background: rgba(124, 111, 159, 0.15);
    box-shadow: inset 0 0 20px rgba(124, 111, 159, 0.1);
  }
  100% {
    background: transparent;
    box-shadow: none;
  }
}

/* Content appended — last elements get the shimmer */
.nn-content-appended > :last-child {
  animation: nn-line-fade-in 0.35s ease-out both;
}

/* Content removed — brief fade effect on container */
.nn-content-removed {
  animation: nn-content-settle 0.3s ease-out;
}

@keyframes nn-content-settle {
  0% { opacity: 0.85; }
  100% { opacity: 1; }
}

/* Scroll anchor — invisible element at bottom for scrollIntoView */
.nn-scroll-anchor {
  height: 1px;
  width: 100%;
  pointer-events: none;
}

/* ── 4. Paper Texture ─────────────────────────────────────────────────── */

.nn-doc-content {
  position: relative;
}
.nn-doc-content::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0.015;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 0;
}

/* ── 5. Header Accent Line ────────────────────────────────────────────── */

@keyframes nn-accent-shift {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}
.nn-accent-line {
  height: 2px;
  background: linear-gradient(90deg, #7c6f9f, #6f7c9f, #9f6f8c, #7c6f9f);
  background-size: 300% 100%;
  animation: nn-accent-shift 8s ease infinite;
  flex-shrink: 0;
}

/* ── 6. Empty State Magic ─────────────────────────────────────────────── */

@keyframes nn-ring-pulse {
  0%, 100% { transform: scale(1); opacity: 0.3; }
  50% { transform: scale(1.15); opacity: 0.1; }
}

.nn-empty-magic {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
  min-height: 300px;
  position: relative;
}
.nn-empty-ring {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  border: 1px solid rgba(196, 181, 253, 0.2);
  box-shadow: 0 0 40px rgba(124, 111, 159, 0.1), inset 0 0 40px rgba(124, 111, 159, 0.05);
  animation: nn-ring-pulse 4s ease-in-out infinite;
  margin-bottom: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  opacity: 0.5;
}
.nn-empty-magic-title {
  font-family: 'Crimson Pro', serif;
  font-style: italic;
  font-size: 22px;
  font-weight: 300;
  color: #c4b5fd;
  margin-bottom: 8px;
  letter-spacing: 0.02em;
}
.nn-empty-magic-sub {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  color: #555;
}

.nn-fab-glow-strong {
  box-shadow: 0 8px 32px rgba(124, 111, 159, 0.7), 0 0 60px rgba(124, 111, 159, 0.35) !important;
  animation: nn-fab-glow-intense 2s ease-in-out infinite !important;
}
@keyframes nn-fab-glow-intense {
  0%, 100% { box-shadow: 0 8px 32px rgba(124, 111, 159, 0.7), 0 0 60px rgba(124, 111, 159, 0.35); }
  50% { box-shadow: 0 8px 40px rgba(124, 111, 159, 0.85), 0 0 80px rgba(124, 111, 159, 0.5); }
}

/* ── 7. Card Preview Enhancement ──────────────────────────────────────── */

.nn-card {
  border-left: 3px solid rgba(124, 111, 159, 0.3);
}
.nn-card:hover {
  border-left-color: rgba(196, 181, 253, 0.8);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35), 0 0 20px rgba(124, 111, 159, 0.1), -4px 0 12px rgba(124, 111, 159, 0.1);
}
.nn-pin-diamond {
  position: absolute;
  top: 12px;
  right: 12px;
  color: #c4b5fd;
  font-size: 10px;
  opacity: 0.7;
}

.nn-card-date {
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  color: #4a4a5a;
  margin-left: auto;
  letter-spacing: 0.02em;
}

/* ── 8. View Transitions ──────────────────────────────────────────────── */

@keyframes nn-library-exit {
  to { opacity: 0; transform: scale(0.97); }
}
@keyframes nn-doc-enter {
  from { opacity: 0; transform: scale(1.02); }
  to { opacity: 1; transform: scale(1); }
}

.nn-document {
  animation: nn-doc-enter 0.3s ease-out;
}

.nn-btn-back {
  transition: all 0.2s ease-out;
}
.nn-btn-back:hover {
  transform: translateX(-3px);
}

/* ── 9. Typography Refinements ────────────────────────────────────────── */

.nn-h1 {
  font-size: 2.5rem;
  font-weight: 300;
  letter-spacing: -0.02em;
}
.nn-h2 {
  font-size: 1.75rem;
  font-weight: 400;
}
.nn-p, .nn-li {
  font-size: 1.05rem;
  line-height: 1.8;
}

.nn-pre {
  border-radius: 8px;
  border-left: 3px solid rgba(124, 111, 159, 0.4);
  box-shadow: inset 3px 0 12px rgba(124, 111, 159, 0.08);
}

.nn-blockquote {
  border-left: 3px solid transparent;
  border-image: linear-gradient(180deg, #7c6f9f, rgba(124, 111, 159, 0.1)) 1;
}

/* ── 10. Scroll Shadows ───────────────────────────────────────────────── */

.nn-doc-content {
  background:
    linear-gradient(#0a0a0f 30%, transparent) center top,
    linear-gradient(transparent, #0a0a0f 70%) center bottom,
    radial-gradient(farthest-side at 50% 0, rgba(124, 111, 159, 0.08), transparent) center top,
    radial-gradient(farthest-side at 50% 100%, rgba(124, 111, 159, 0.08), transparent) center bottom;
  background-repeat: no-repeat;
  background-size: 100% 40px, 100% 40px, 100% 14px, 100% 14px;
  background-attachment: local, local, scroll, scroll;
}

/* ── 11. Micro-interactions ───────────────────────────────────────────── */

.nn-btn-save:active:not(:disabled) {
  transform: scale(1.05);
  transition: transform 0.1s ease-out;
}

.nn-overlay {
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

.nn-search-icon-btn:hover .nn-search-icon-inner {
  transform: rotate(15deg);
  transition: transform 0.3s ease-out;
}
.nn-search-icon-inner {
  transition: transform 0.3s ease-out;
}

.nn-title-input {
  position: relative;
  border-bottom: 2px solid transparent;
  background-image: linear-gradient(#0a0a0f, #0a0a0f), linear-gradient(90deg, transparent, rgba(124, 111, 159, 0.5), transparent);
  background-size: 100% 2px, 0% 2px;
  background-position: bottom center;
  background-repeat: no-repeat;
  transition: background-size 0.3s ease-out;
}
.nn-title-input:focus {
  border-bottom-color: transparent;
  background-size: 100% 2px, 100% 2px;
}
`;

export default NotesViewNext;
