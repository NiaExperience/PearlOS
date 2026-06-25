'use client';

import { isFeatureEnabled } from '@nia/features';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { useSession } from 'next-auth/react';
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { usePostHog } from 'posthog-js/react';
import { ArrowLeft, ChevronDown, ChevronRight, Download, FilePlus2, Pencil, Sparkles, Trash2, X } from 'lucide-react';
import { getClientLogger } from '@interface/lib/client-logger';
import DOMPurify from 'dompurify';

// Import styles for content animations and syntax highlighting
import '@interface/features/Notes/styles/notes-next.css';
import 'highlight.js/styles/github-dark.css';

import {
  NIA_EVENT_NOTE_CLOSE,
  NIA_EVENT_NOTE_DOWNLOAD,
  NIA_EVENT_NOTE_MODE_SWITCH,
  NIA_EVENT_NOTE_OPEN,
  NIA_EVENT_NOTE_SAVED,
  NIA_EVENT_NOTE_UPDATED,
  NIA_EVENT_NOTE_DELETED,
  NIA_EVENT_NOTES_REFRESH,
  NIA_EVENT_NOTES_LIST,
  NIA_EVENT_NOTE_SCROLL,
  NIA_EVENT_NOTE_HIGHLIGHT,
  NIA_EVENT_NOTE_HIGHLIGHT_CLEAR,
  NIA_EVENT_NOTE_NAVIGATE_HEADING,
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
  type Note as ApiNote,
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
import PearlCommandInput from '@interface/components/PearlCommandInput';

import NoteShareControls from './NoteShareControls';
import { requestWindowOpen } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';

const ReactMarkdown = React.lazy(() => import('react-markdown'));
// GFM (tables, strikethrough, task lists) and syntax highlighting
let remarkGfm: any = null;
let rehypeHighlight: any = null;
try { remarkGfm = require('remark-gfm').default || require('remark-gfm'); } catch {}
try { rehypeHighlight = require('rehype-highlight').default || require('rehype-highlight'); } catch {}

const log = getClientLogger('NotesNext');

/**
 * Detect whether content is primarily HTML rather than plain markdown.
 * Returns true if the content contains block-level HTML tags that indicate
 * it was generated as an HTML document/fragment (cards, charts, etc.).
 */
function isHtmlContent(content: string): boolean {
  if (!content) return false;
  // Strip fenced code blocks, indented code blocks, and inline code before checking
  // so HTML examples in code don't trigger HTML mode
  const stripped = content
    .replace(/```[\s\S]*?```/g, '')       // fenced code blocks
    .replace(/`[^`]+`/g, '')              // inline code
    .replace(/^(?: {4}|\t).*$/gm, '');    // indented code blocks
  const trimmed = stripped.trim();
  // Starts with a doctype or html/head/body tag
  if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return true;
  // Contains block-level HTML tags (div, section, table with attributes, style tags, etc.)
  // that wouldn't normally appear in markdown
  const blockHtmlPattern = /<(?:div|section|article|header|footer|nav|main|style|script|table|form|iframe|canvas|svg|figure|details|dialog)\b[^>]*>/i;
  if (blockHtmlPattern.test(trimmed)) return true;
  // If it starts with an HTML tag and has significant HTML structure
  if (/^<[a-z][a-z0-9]*[\s>]/i.test(trimmed)) {
    const tagCount = (trimmed.match(/<[a-z][a-z0-9]*[\s>]/gi) || []).length;
    const closingCount = (trimmed.match(/<\/[a-z][a-z0-9]*>/gi) || []).length;
    if (tagCount >= 3 && closingCount >= 2) return true;
  }
  return false;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface NotesViewProps {
  assistantName: string;
  onClose?: () => void;
  supportedFeatures?: string[];
  tenantId?: string;
  initialNoteId?: string;
}

type ViewState = 'library' | 'document';
type NotesFolderId = 'recent' | 'your-notes' | 'pearl' | 'tasks' | 'chat-archive';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function inferType(content: string): 'game' | 'app' | 'feature' {
  const lower = content.toLowerCase();
  if (lower.includes('godot') || lower.includes('game') || lower.includes('play') || lower.includes('player')) return 'game';
  if (lower.includes('app') || lower.includes('web') || lower.includes('site') || lower.includes('dashboard')) return 'app';
  return 'feature';
}

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
  const clean = content
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#+ /gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + '…' : clean;
}

function normalizeNoteLookupToken(value: string | undefined | null): string {
  return String(value || '')
    .trim()
    .replace(/\.md$/i, '')
    .toLowerCase();
}

function slugifyNoteTitle(value: string | undefined | null): string {
  return String(value || '')
    .trim()
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function noteDateMs(note: Note): number {
  const raw = note.createdAt || note.timestamp || note.updatedAt;
  const parsed = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function isArchivedChatNote(note: Note): boolean {
  const content = note.content || '';
  const title = note.title || '';
  return /^Chat(?::|\s+archive\b)/i.test(title) || content.includes('<!-- pearl:pre-existing-chat');
}

function isLocalChatArchiveNote(note: Note | null | undefined): boolean {
  return Boolean(note?.isLocalArchive || note?._id?.startsWith('local-chat-archive:'));
}

function isPearlDiaryNote(note: Note): boolean {
  const id = note._id || '';
  const title = note.title || '';
  const filePath = note.filePath || note.fileName || '';
  return Boolean(
    note.isDiary ||
    id.startsWith('diary--') ||
    /(^|\/)pearl-diary\//i.test(filePath) ||
    /^pearl'?s diary$/i.test(title.trim())
  );
}

function isTaskLogNote(note: Note): boolean {
  const id = note._id || '';
  const title = note.title || '';
  const filePath = note.filePath || note.fileName || '';
  const haystack = `${id} ${title} ${filePath}`.toLowerCase();
  if (isPearlDiaryNote(note) || isArchivedChatNote(note) || isLocalChatArchiveNote(note)) return false;
  return Boolean(
    /^discord-follow-up-from-/i.test(id) ||
    /^voice-follow-up/i.test(id) ||
    /^pearl-autonomous-continuation/i.test(id) ||
    /^search-(?:the-web|for|community)/i.test(id) ||
    /^runtime-qa/i.test(id) ||
    /^verify-(?:agency|auto|scoped)/i.test(id) ||
    /\b(task log|agency|codex|runtime|qa|audit|handoff|preflight|smoke|dispatch|follow-up)\b/i.test(haystack)
  );
}

function inferFolderId(note: Note): NotesFolderId {
  if (isPearlDiaryNote(note)) return 'pearl';
  if (isArchivedChatNote(note)) return 'chat-archive';
  const title = (note.title || '').toLowerCase();
  const haystack = `${title} ${note.content || ''}`.toLowerCase();
  if (title.match(/^(chat|conversation|transcript|session)\b/i) || haystack.includes('chat transcript') || haystack.includes('conversation log')) return 'chat-archive';
  if (isTaskLogNote(note)) return 'tasks';
  return 'your-notes';
}

function isProtectedNotesSection(note: Note | null | undefined): boolean {
  if (!note) return false;
  const section = inferFolderId(note);
  return section === 'pearl' || section === 'tasks' || section === 'chat-archive';
}

function findNoteByDeepLinkToken(notes: Note[], token: string | undefined | null): Note | null {
  const normalized = normalizeNoteLookupToken(token);
  if (!normalized) return null;
  return notes.find(note => {
    const id = normalizeNoteLookupToken(note._id);
    const fileName = normalizeNoteLookupToken(note.fileName);
    const filePath = normalizeNoteLookupToken(note.filePath?.split('/').pop());
    const titleSlug = slugifyNoteTitle(note.title);
    return id === normalized || fileName === normalized || filePath === normalized || titleSlug === normalized;
  }) || null;
}

function inferChatTopicName(note: Note): string {
  const title = note.title || '';
  if (title.startsWith('Chat: ')) {
    const rest = title.slice(6).trim();
    if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(rest) || /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(rest)) {
      const preview = getPreview(note.content || '', 60);
      if (preview && preview.length > 10) {
        const topicWords = preview.split(/\s+/).slice(0, 6).join(' ');
        return `Chat: ${topicWords}`;
      }
    }
  }
  return title;
}

const RECENT_NOTE_LIMIT = 8;
const PEARL_DIARY_NOTE_ID = 'pearl-diary-default';

const NOTE_FOLDERS: Array<{ id: NotesFolderId; title: string; color: string }> = [
  { id: 'recent', title: 'RECENT', color: '#6aa6ff' },
  { id: 'your-notes', title: 'YOUR NOTES', color: '#74c69d' },
  { id: 'pearl', title: 'PEARL', color: '#f5b8e8' },
  { id: 'tasks', title: 'TASKS', color: '#e1a44f' },
  { id: 'chat-archive', title: 'CHAT ARCHIVE', color: '#9f8df1' },
];

const LOCAL_CHAT_ARCHIVES_KEY = 'pearl-chat-archives-v1';

type LocalChatArchiveRecord = {
  id?: unknown;
  title?: unknown;
  transcript?: unknown;
  content?: unknown;
  archivedAt?: unknown;
  messageCount?: unknown;
};

// ─── Streaming Renderer ─────────────────────────────────────────────────────

interface StreamingRendererProps {
  content: string;
  isStreaming: boolean;
  noteId?: string;
  noteTitle?: string;
}

const normalizeHeadingText = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ');

const removeDuplicateTopHeading = (markdown: string, noteTitle?: string): string => {
  if (!markdown || !noteTitle?.trim()) return markdown;
  const match = markdown.match(/^\s*#\s+(.+?)\s*(?:\r?\n)+/);
  if (!match) return markdown;
  const headingText = normalizeHeadingText(match[1] || '');
  const titleText = normalizeHeadingText(noteTitle);
  if (!headingText || headingText !== titleText) return markdown;
  return markdown.slice(match[0].length).replace(/^\s+/, '');
};

const StreamingRenderer: React.FC<StreamingRendererProps> = ({ content, isStreaming, noteId, noteTitle }) => {
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

    // First load or complete replacement — show all content immediately with glow
    if ((!prevContent && content.length > 0) ||
        (prevContent && prevContent.length > 0 && content !== prevContent && !content.startsWith(prevContent))) {
      hasRevealedRef.current = true;
      setDisplayedContent(content);
      setShowGlow(true);
      setChangeType('append');
      scheduleGlowCleanup(600);
      return;
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

  const normalizedContent = useMemo(
    () => removeDuplicateTopHeading(displayedContent, noteTitle),
    [displayedContent, noteTitle]
  );
  const contentIsHtml = useMemo(() => isHtmlContent(normalizedContent), [normalizedContent]);

  return (
    <div ref={containerRef} className={containerClass}>
      {contentIsHtml ? (
        <div
          className="nn-html-content"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(normalizedContent) }}
        />
      ) : (
      <React.Suspense fallback={<div className="nn-loading">Loading…</div>}>
        <ReactMarkdown
          remarkPlugins={remarkGfm ? [remarkGfm] : []}
          rehypePlugins={rehypeHighlight ? [rehypeHighlight] : []}
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
            img: ({ src, alt, ...props }) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={alt || 'Image'}
                className="nn-img"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                style={{ maxWidth: '100%', height: 'auto', borderRadius: '8px', margin: '8px 0' }}
                onError={(e) => {
                  const el = e.target as HTMLImageElement;
                  el.style.display = 'inline-block';
                  el.style.minWidth = '60px';
                  el.style.minHeight = '40px';
                  el.style.background = 'rgba(255,255,255,0.05)';
                  el.style.border = '1px dashed rgba(255,255,255,0.2)';
                  if (!el.alt) el.alt = 'Image unavailable';
                }}
                {...props}
              />
            ),
            strong: ({ children }) => <strong className="nn-strong">{children}</strong>,
            em: ({ children }) => <em className="nn-em">{children}</em>,
          }}
        >
          {normalizedContent}
        </ReactMarkdown>
      </React.Suspense>
      )}
      {isStreaming && <span className="nn-cursor" />}
      {/* Invisible scroll anchor — always at the bottom */}
      <div ref={scrollAnchorRef} className="nn-scroll-anchor" />
    </div>
  );
};

// ─── Main Component ─────────────────────────────────────────────────────────

const NotesViewNext = ({ assistantName, onClose, supportedFeatures, tenantId: propTenantId, initialNoteId }: NotesViewProps) => {
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
  const [isEditMode, setIsEditMode] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [studioPickMode, setStudioPickMode] = useState(false);

  // Folder collapse state — all requested sections open by default.
  const [collapsedFolders, setCollapsedFolders] = useState<Set<NotesFolderId>>(
    () => new Set<NotesFolderId>()
  );

  // Manual folder overrides from drag-and-drop (noteId -> folderId)
  const [noteFolderOverrides, setNoteFolderOverrides] = useState<Map<string, NotesFolderId>>(new Map());

  // Drag-and-drop for note reordering between folders
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<NotesFolderId | null>(null);

  // Loading / saving
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Dialogs
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [noteToDeleteId, setNoteToDeleteId] = useState<string | null>(null);

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
  const originalNoteRef = useRef<Note | null>(null);
  const isReadyRef = useRef(false);
  const commandQueueRef = useRef<Array<{ action: string; payload: Record<string, unknown> }>>([]);
  const incrementalAbortRef = useRef<(() => void) | null>(null);
  const refreshTargetRef = useRef<{ noteId: string; mode?: NoteMode | null } | null>(null);
  const lastInitialNoteIdRef = useRef<string>('');
  const recentCommandsRef = useRef<Map<string, number>>(new Map());
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const saveInFlightRef = useRef(false);
  const saveAgainAfterCurrentRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag-drop
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessingDocument, setIsProcessingDocument] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [dragCounter, setDragCounter] = useState(0);

  // Track when NOTE_UPDATED last fired per noteId to avoid NOTES_REFRESH overwriting streaming updates
  const lastNoteUpdatedRef = useRef<Map<string, number>>(new Map());
  // Track recently deleted note IDs to filter out stale returns from server during NOTES_REFRESH
  const recentlyDeletedRef = useRef<Map<string, number>>(new Map());

  // ─── Note state broadcasting to bot gateway ────────────────────────────

  const sendNoteState = useCallback(async (action: 'opened' | 'updated' | 'closed', note?: Note | null) => {
    try {
      if (typeof window !== 'undefined') {
        if (action === 'closed' || !note?._id) {
          window.sessionStorage.removeItem('pearl-active-note-context-v1');
        } else {
          const content = typeof note.content === 'string'
            ? note.content
            : (note.content as any)?.content ?? '';
          window.sessionStorage.setItem('pearl-active-note-context-v1', JSON.stringify({
            noteId: note._id,
            title: note.title || null,
            content,
            tenantId: note.tenantId || propTenantId || null,
            updatedAt: Date.now(),
          }));
        }
      }
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
          tenantId: note?.tenantId || propTenantId || null,
          userId: session?.user?.id || null,
          sessionId: (session as any)?.sessionId || (session as any)?.user?.sessionId || null,
        }),
      });
    } catch (e) {
      // Non-fatal, don't block UI
    }
  }, [propTenantId, session]);

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
  useEffect(() => { originalNoteRef.current = originalNote; }, [originalNote]);

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
    if (isLocalChatArchiveNote(note) || isProtectedNotesSection(note)) return false;
    const isTestAnon = process.env.NEXT_PUBLIC_TEST_ANONYMOUS_USER === 'true' || process.env.NODE_ENV === 'test';
    const effectiveUserId = session?.user?.id || (isTestAnon ? '00000000-0000-0000-0000-000000000099' : null);
    // If no auth session and note is not shared, allow write (single-user / PearlOS mode)
    if (!effectiveUserId) return !note.sharedVia;
    if (!note.sharedVia) return true;
    const userRole = note.sharedVia.role?.role;
    return userRole === OrganizationRole.ADMIN || userRole === OrganizationRole.OWNER;
  }, [session]);

  const toViewNote = useCallback((note: ApiNote): Note => {
    const maybeViewNote = note as Partial<Note>;
    return {
      ...note,
      content: note.content || '',
      mode: note.mode === 'work' ? 'work' : 'personal',
      userId: maybeViewNote.userId || session?.user?.id || '',
      tenantId: maybeViewNote.tenantId || propTenantId || '',
    };
  }, [propTenantId, session?.user?.id]);

  const readLocalChatArchiveNotes = useCallback((): Note[] => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(LOCAL_CHAT_ARCHIVES_KEY);
      const records = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(records)) return [];
      return records.flatMap((record: LocalChatArchiveRecord, index): Note[] => {
        const archivedAtValue =
          typeof record.archivedAt === 'number' || typeof record.archivedAt === 'string'
            ? record.archivedAt
            : Date.now();
        const archivedAtDate = new Date(archivedAtValue);
        if (Number.isNaN(archivedAtDate.getTime())) return [];
        const archivedAt = archivedAtDate.toISOString();
        const transcript = typeof record.transcript === 'string'
          ? record.transcript
          : typeof record.content === 'string'
            ? record.content
            : '';
        if (!transcript.trim()) return [];
        const id = typeof record.id === 'string' && record.id.trim()
          ? record.id.trim()
          : `legacy-${archivedAtValue}-${index}`;
        const title = typeof record.title === 'string' && record.title.trim()
          ? record.title.trim()
          : `Chat archive - ${new Date(archivedAt).toLocaleString()}`;
        return [{
          _id: `local-chat-archive:${id}`,
          title,
          content: `<!-- pearl:pre-existing-chat -->\n\n${transcript}`,
          mode: 'personal',
          userId: session?.user?.id || '',
          tenantId: propTenantId || '',
          createdAt: archivedAt,
          timestamp: archivedAt,
          isLocalArchive: true,
        }];
      });
    } catch {
      return [];
    }
  }, [propTenantId, session?.user?.id]);

  const mergeRecoverableChatArchives = useCallback((serverNotes: Note[]): Note[] => {
    const localArchives = readLocalChatArchiveNotes();
    if (localArchives.length === 0) return serverNotes;
    const seenIds = new Set(serverNotes.map(note => note._id).filter(Boolean));
    const serverChatTitles = new Set(
      serverNotes
        .filter(isArchivedChatNote)
        .map(note => (note.title || '').trim().toLowerCase())
        .filter(Boolean)
    );
    const recoverable = localArchives.filter(note => {
      if (note._id && seenIds.has(note._id)) return false;
      const normalizedTitle = (note.title || '').trim().toLowerCase();
      if (normalizedTitle && serverChatTitles.has(normalizedTitle)) return false;
      return true;
    });
    return [...serverNotes, ...recoverable];
  }, [readLocalChatArchiveNotes]);

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

  const recentNotes = useMemo(() => {
    return [...filteredNotes]
      .sort((a, b) => noteDateMs(b) - noteDateMs(a))
      .slice(0, RECENT_NOTE_LIMIT);
  }, [filteredNotes]);

  const pearlDiaryNote = useMemo<Note>(() => {
    const diaryNotes = filteredNotes
      .filter(isPearlDiaryNote)
      .sort((a, b) => noteDateMs(b) - noteDateMs(a));
    if (diaryNotes.length === 0) {
      const now = new Date().toISOString();
      return {
        _id: PEARL_DIARY_NOTE_ID,
        title: "Pearl's diary",
        content: "# Pearl's diary\n\nPearl hasn't written here yet.",
        mode: 'personal',
        userId: session?.user?.id || '',
        tenantId: propTenantId || '',
        createdAt: now,
        updatedAt: now,
        isDiary: true,
      };
    }

    const latest = diaryNotes[0];
    return {
      ...latest,
      _id: PEARL_DIARY_NOTE_ID,
      title: "Pearl's diary",
      content: diaryNotes.map(note => note.content || `# ${note.title || "Pearl's diary"}`).join('\n\n---\n\n'),
      isDiary: true,
    };
  }, [filteredNotes, propTenantId, session?.user?.id]);

  const notesByFolder = useMemo(() => {
    const map = new Map<NotesFolderId, Note[]>();
    NOTE_FOLDERS.forEach(folder => map.set(folder.id, []));
    map.set('pearl', [pearlDiaryNote]);
    filteredNotes.forEach(note => {
      const inferredId = inferFolderId(note);
      if (inferredId === 'pearl') return;
      const overrideId = note._id && !isProtectedNotesSection(note)
        ? noteFolderOverrides.get(note._id)
        : undefined;
      const id = overrideId && overrideId !== 'recent' ? overrideId : inferredId;
      map.set(id, [...(map.get(id) || []), note]);
    });
    return map;
  }, [filteredNotes, noteFolderOverrides, pearlDiaryNote]);

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

      // Clean up stale deletion tracking (older than 30 seconds)
      const now = Date.now();
      for (const [id, ts] of recentlyDeletedRef.current.entries()) {
        if (now - ts > 30000) recentlyDeletedRef.current.delete(id);
      }

      const handleBatch = (batch: NoteBatch) => {
        for (const item of batch.items) {
          const id = item._id;
          if (id && !seenIds.has(id) && !recentlyDeletedRef.current.has(id)) {
            seenIds.add(id);
            allNotes.push(item as Note);
          }
        }
        if (batch.batch === 'shared-to-user' || batch.batch === 'shared-to-all') {
          for (const item of batch.items) { if (item._id) sharedIds.add(item._id); }
        }
        setNotes(mergeRecoverableChatArchives([...allNotes]));
        setSharedNoteIds(new Set(sharedIds));
      };

      const modeParam = 'all';
      const { promise, abort } = fetchNotesIncremental(assistantName, modeParam, handleBatch);
      incrementalAbortRef.current = abort;

      await promise;
      incrementalAbortRef.current = null;

      const refreshTarget = refreshTargetRef.current;
      if (refreshTarget?.noteId) {
        const target = findNoteByDeepLinkToken(mergeRecoverableChatArchives([...allNotes]), refreshTarget.noteId);
        if (target) {
          setCurrentNote(target);
          setOriginalNote(target);
          setIsEditMode(false);
          setViewState('document');
        }
        refreshTargetRef.current = null;
      }
    } catch (e) {
      log.error('Error loading notes, falling back to legacy', { error: e instanceof Error ? e.message : String(e) });
      try {
        const data = await fetchNotes(mode, assistantName);
        setNotes(mergeRecoverableChatArchives(data.map(toViewNote)));
      } catch { setNotes(mergeRecoverableChatArchives([])); }
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
  }, [assistantName, mode, toViewNote, mergeRecoverableChatArchives]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  // ─── Offline queue flush ──────────────────────────────────────────────────

  const flushOfflineQueue = useCallback(async () => {
    if (!isOnline) return;
    let next = consumeNextQueuedNote();
    while (next) {
      try {
        const updated = await updateNote(next.noteId, next.data, next.assistantName);
        const latest = currentNoteRef.current;
        const latestHasNewerChanges =
          !!latest &&
          latest._id === updated._id &&
          (latest.title !== next.data.title || latest.content !== next.data.content);
        const currentReplacement = latestHasNewerChanges
          ? { ...updated, title: latest.title || '', content: latest.content || '' }
          : updated;

        setNotes(prev => prev.map(n => n._id === updated._id ? currentReplacement : n));
        if (latest?._id === updated._id) {
          setCurrentNote(currentReplacement);
          setOriginalNote(updated);
        }
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

  const persistCurrentNote = useCallback(async (options: { showErrors?: boolean } = {}) => {
    const note = currentNoteRef.current;
    const original = originalNoteRef.current;
    if (!note?._id || !original) return;
    if (note.title === original.title && note.content === original.content) return;
    if (!hasWriteAccess(note)) {
      if (options.showErrors) {
        toast({ title: 'Read-only access', description: 'You do not have write access to this note.' });
      }
      return;
    }

    if (saveInFlightRef.current) {
      saveAgainAfterCurrentRef.current = true;
      return;
    }

    const snapshot: Note & { _id: string; title: string; content: string } = {
      ...note,
      _id: note._id,
      title: note.title || '',
      content: note.content || '',
    };

    if (!isOnline) {
      queueOfflineNoteUpdate({
        noteId: snapshot._id,
        assistantName,
        data: { title: snapshot.title, content: snapshot.content || '', isPinned: snapshot.isPinned },
      });
      setOriginalNote(snapshot);
      setNotes(prev => prev.map(n => n._id === snapshot._id ? snapshot : n));
      return;
    }

    saveInFlightRef.current = true;
    setIsSaving(true);
    try {
      const updated = await updateNote(
        snapshot._id,
        { title: snapshot.title, content: snapshot.content || '', isPinned: snapshot.isPinned },
        assistantName
      );
      posthog?.capture('note_saved', { noteId: snapshot._id, mode: snapshot.mode });
      await trackSessionHistory('Updated Note', [{ type: 'Notes', id: snapshot._id, description: `Title: ${snapshot.title}` }]);

      const latest = currentNoteRef.current;
      const latestHasNewerChanges =
        !!latest &&
        latest._id === snapshot._id &&
        (latest.title !== snapshot.title || latest.content !== snapshot.content);
      const currentReplacement = latestHasNewerChanges
        ? { ...updated, title: latest.title || '', content: latest.content || '' }
        : updated;

      setNotes(prev => prev.map(n => n._id === snapshot._id ? currentReplacement : n));
      if (latest?._id === snapshot._id) {
        setCurrentNote(currentReplacement);
        setOriginalNote(updated);
      }
      sendNoteState('updated', currentReplacement);
    } catch (e: unknown) {
      queueOfflineNoteUpdate({
        noteId: snapshot._id,
        assistantName,
        data: { title: snapshot.title, content: snapshot.content || '', isPinned: snapshot.isPinned },
      });
      if (options.showErrors) {
        const message = e instanceof Error ? e.message : '';
        toast({ title: 'Autosave queued', description: message === 'Failed to update note' ? 'Access denied.' : 'Will retry when the connection is healthy.' });
      }
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
      if (saveAgainAfterCurrentRef.current) {
        saveAgainAfterCurrentRef.current = false;
        void persistCurrentNote();
      }
    }
  }, [assistantName, isOnline, hasWriteAccess, posthog, toast, sendNoteState]);

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
    const note = notesRef.current.find(n => n._id === noteId) || null;
    if (!hasWriteAccess(note)) {
      toast({ title: 'Read-only note', description: 'This note cannot be edited from Notes.' });
      return;
    }
    setNoteToDeleteId(noteId);
    setShowDeleteDialog(true);
  }, [hasWriteAccess, toast]);

  const confirmDelete = useCallback(async () => {
    if (!noteToDeleteId) return;
    const target = notes.find(n => n._id === noteToDeleteId) || null;
    if (!hasWriteAccess(target)) {
      setNoteToDeleteId(null);
      setShowDeleteDialog(false);
      toast({ title: 'Read-only note', description: 'This note cannot be edited from Notes.' });
      return;
    }
    setIsLoading(true);
    setShowDeleteDialog(false);
    try {
      await deleteNoteApi(noteToDeleteId, assistantName);
      posthog?.capture('note_deleted', { noteId: noteToDeleteId });
      await trackSessionHistory('Deleted Note', [{ type: 'Notes', id: noteToDeleteId }]);
      // Track deletion so loadNotes() won't re-add from stale server data
      recentlyDeletedRef.current.set(noteToDeleteId, Date.now());
      const updated = notes.filter(n => n._id !== noteToDeleteId);
      setNotes(updated);
      if (currentNote?._id === noteToDeleteId) {
        setCurrentNote(null); setOriginalNote(null); setViewState('library');
      }
      setNoteToDeleteId(null);
    } catch {
      toast({ title: 'Failed to delete note', description: 'Please try again.' });
    } finally { setIsLoading(false); }
  }, [noteToDeleteId, assistantName, notes, currentNote, hasWriteAccess, posthog, toast]);

  const handleNotesCommandInput = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

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

  const handleSendNoteToLaunchpad = useCallback(async (noteId: string) => {
    const selectedNote = notesRef.current.find(n => n._id === noteId) || currentNote;
    if (!selectedNote) return;
    try {
      const noteContent =
        typeof selectedNote.content === 'string'
          ? selectedNote.content
          : (selectedNote.content as any)?.content ?? '';
      const noteTitle = selectedNote.title || 'Untitled note';

      // Open the Studio window first so the listener is mounted, then attach the note.
      requestWindowOpen({ viewType: 'creationLaunchpad', source: 'notes:magic-wand' });

      const dispatchAttach = () => {
        window.dispatchEvent(
          new CustomEvent('nia.studio.note.attach', {
            detail: {
              note: {
                id: noteId,
                title: noteTitle,
                content: noteContent,
              },
            },
          })
        );
      };
      // Fire immediately, and once again on the next frame so a freshly-mounted
      // CreationLaunchpad has a chance to wire up its listener.
      dispatchAttach();
      requestAnimationFrame(() => {
        requestAnimationFrame(dispatchAttach);
      });

      window.dispatchEvent(
        new CustomEvent('nia.toast', {
          detail: { message: `Attached "${noteTitle}" to Studio`, type: 'success' },
        })
      );
      setStudioPickMode(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send to Launchpad';
      window.dispatchEvent(
        new CustomEvent('nia.toast', {
          detail: { message, type: 'error' },
        })
      );
    }
  }, [currentNote]);

  const toggleFolderCollapse = useCallback((folderId: NotesFolderId) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const handleNoteDragStart = useCallback((e: React.DragEvent, noteId: string) => {
    const note = notesRef.current.find(n => n._id === noteId);
    if (!note || isProtectedNotesSection(note)) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', noteId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingNoteId(noteId);
  }, []);

  const handleNoteDragEnd = useCallback(() => {
    setDraggingNoteId(null);
    setDragOverFolderId(null);
  }, []);

  const handleFolderDragOver = useCallback((e: React.DragEvent, folderId: NotesFolderId) => {
    if (!draggingNoteId) return;
    if (folderId !== 'your-notes') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverFolderId(folderId);
  }, [draggingNoteId]);

  const handleFolderDragLeave = useCallback(() => {
    setDragOverFolderId(null);
  }, []);

  const handleFolderDrop = useCallback((e: React.DragEvent, targetFolderId: NotesFolderId) => {
    e.preventDefault();
    if (targetFolderId !== 'your-notes') return;
    const noteId = e.dataTransfer.getData('text/plain');
    if (!noteId) return;
    const targetNote = notesRef.current.find(n => n._id === noteId);
    if (!targetNote || isProtectedNotesSection(targetNote)) return;
    setNoteFolderOverrides(prev => {
      const next = new Map(prev);
      const currentFolder = next.get(noteId) || inferFolderId(targetNote);
      if (currentFolder === targetFolderId) return prev;
      next.set(noteId, targetFolderId);
      return next;
    });
    if (collapsedFolders.has(targetFolderId)) {
      setCollapsedFolders(prev => {
        const next = new Set(prev);
        next.delete(targetFolderId);
        return next;
      });
    }
    setDraggingNoteId(null);
    setDragOverFolderId(null);
    toast({ title: 'Note moved', description: `Moved to ${NOTE_FOLDERS.find(f => f.id === targetFolderId)?.title || targetFolderId}` });
  }, [collapsedFolders, toast]);

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

  const handleNoteSwitch = useCallback(async (note: Note) => {
    await persistCurrentNote();
    openNote(note);
  }, [openNote, persistCurrentNote]);

  const handleModeSwitch = useCallback((newMode: NoteMode) => {
    if (newMode === mode) return;
    posthog?.capture('note_mode_switched', { mode: newMode });
    void persistCurrentNote();
    setMode(newMode);
  }, [mode, persistCurrentNote, posthog]);

  const handleBackToLibrary = useCallback(async () => {
    await persistCurrentNote();
    setViewState('library');
    setCurrentNote(null);
    setIsEditMode(false);
    sendNoteState('closed');
    try { forwardAppEvent(EventEnum.NOTE_CLOSE, { source: 'user' }); } catch { /* non-fatal */ }
  }, [persistCurrentNote, sendNoteState]);

  // ─── Auto-save ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasUnsavedChanges() || !isEditMode) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      void persistCurrentNote();
    }, 800);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [currentNote?.title, currentNote?.content, currentNote?._id, isEditMode, hasUnsavedChanges, persistCurrentNote]);

  // ─── beforeunload ─────────────────────────────────────────────────────────

  useEffect(() => {
    const h = () => {
      const note = currentNoteRef.current;
      const orig = originalNoteRef.current;
      if (!note?._id || !orig) return;
      if (note.title === orig.title && note.content === orig.content) return;
      queueOfflineNoteUpdate({
        noteId: note._id,
        assistantName,
        data: { title: note.title || '', content: note.content || '', isPinned: note.isPinned },
      });
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [assistantName]);

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

      // Record that this note was just updated via NOTE_UPDATED event
      if (targetId) {
        lastNoteUpdatedRef.current.set(targetId, Date.now());
      }

      // Always update the notes list so library view stays in sync
      if (targetId) {
        const patch = {
          ...(content !== undefined ? { content } : {}),
          ...(title !== undefined ? { title } : {}),
        };
        setNotes(prev => prev.map(n => n._id === targetId ? { ...n, ...patch } : n));
      }

      if (targetId && currentNoteRef.current?._id === targetId) {
        setCurrentNote(prev => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            ...(content !== undefined ? { content } : {}),
            ...(title !== undefined ? { title } : {}),
          };
          return updated;
        });
        // Also update originalNote so bot-driven changes don't trigger
        // false "unsaved changes" warnings
        setOriginalNote(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            ...(content !== undefined ? { content } : {}),
            ...(title !== undefined ? { title } : {}),
          };
        });
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
        setIsEditMode(hasWriteAccess(note));
      } else if (noteId) {
        // Existing note saved — refresh from server (don't re-save, the bot already saved)
        const existing = findNoteByDeepLinkToken(notesRef.current, noteId);
        if (existing) {
          // If it's the current note, just mark original = current (no unsaved changes)
          if (currentNoteRef.current?._id === existing._id) {
            setOriginalNote(currentNoteRef.current);
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
  }, [assistantName, hasWriteAccess]);

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

  // NOTES_REFRESH — debounced to avoid redundant reloads when multiple events fire together
  const refreshDebounceRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    const handler = async (event: Event) => {
      const customEvent = event as CustomEvent<NiaEventDetail>;
      const payload = (customEvent.detail?.payload ?? {}) as Record<string, unknown>;
      const noteId = typeof payload.noteId === 'string' ? payload.noteId : undefined;
      const noteMode = typeof payload.mode === 'string' ? (payload.mode as NoteMode) : undefined;

      // Skip setting refreshTarget if NOTE_UPDATED recently handled this note
      // (avoids NOTES_REFRESH overwriting the streaming content update)
      const recentUpdate = noteId ? lastNoteUpdatedRef.current.get(noteId) : undefined;
      const isRecentlyStreamed = recentUpdate && (Date.now() - recentUpdate < 5000);
      if (noteId && !isRecentlyStreamed) {
        refreshTargetRef.current = { noteId, mode: noteMode ?? null };
      }
      if (noteMode) setMode(noteMode);

      // If a note was just updated/created via a specific event (NOTE_UPDATED, NOTE_OPEN, NOTE_SAVED),
      // debounce the full reload to avoid sluggishness from redundant fetches
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = setTimeout(async () => {
        refreshDebounceRef.current = null;
        await loadNotes();
      }, isRecentlyStreamed ? 3000 : 300);
    };
    window.addEventListener(NIA_EVENT_NOTES_REFRESH, handler as EventListener);
    return () => {
      window.removeEventListener(NIA_EVENT_NOTES_REFRESH, handler as EventListener);
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    };
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

  // ─── Open note from FileBrowser (.md file click) ──────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const noteId = detail?.noteId;
      if (!noteId) return;
      log.info('[NotesView] Opening note from file click', { noteId });
      const local = findNoteByDeepLinkToken(notesRef.current, noteId);
      if (local) {
        openNote(local);
      } else {
        fetch(`/api/notes/files?id=${encodeURIComponent(noteId)}`)
          .then(r => r.ok ? r.json() : null)
          .then(note => {
            if (note) {
              setNotes(prev => [note, ...prev]);
              openNote(note);
            }
          })
          .catch(() => {});
      }
    };
    window.addEventListener('openNoteFromFile', handler);
    return () => window.removeEventListener('openNoteFromFile', handler);
  }, [openNote]);

  // NIA_EVENT_NOTE_OPEN — bot opened/created a note; navigate to it directly.
  // This complements the browser-window.tsx handler (which may be guarded by
  // isDailyCallActive). Handling it here ensures the Notes component itself
  // always reacts to note.open events from voice sessions.
  useEffect(() => {
    const handler = async (e: Event) => {
      const evt = e as CustomEvent<NiaEventDetail>;
      const rawPayload = evt.detail?.payload;
      if (!rawPayload || typeof rawPayload !== 'object') return;

      const payload = rawPayload as Record<string, unknown>;
      const noteId = typeof payload.noteId === 'string' ? payload.noteId : undefined;
      const embeddedNote = payload.note as Note | undefined;

      log.info('[NotesView] Received note.open event', { noteId });

      // Fast path: full note object is embedded in the event payload
      if (embeddedNote && embeddedNote._id && typeof (embeddedNote as any).content === 'string') {
        // Merge into notes list (add if new, update if existing)
        setNotes(prev => {
          const idx = prev.findIndex(n => n._id === embeddedNote._id);
          if (idx >= 0) {
            const cp = [...prev];
            cp[idx] = { ...cp[idx], ...embeddedNote };
            return cp;
          }
          return [embeddedNote, ...prev];
        });
        openNote(embeddedNote);
        return;
      }

      // Slow path: only noteId provided — look up from loaded state or fetch
      const targetId = noteId || undefined;
      if (!targetId) return;

      const local = findNoteByDeepLinkToken(notesRef.current, targetId);
      if (local) {
        openNote(local);
        return;
      }

      // Note not in local state yet (just created) — reload and open
      try {
        const result = await findNoteWithFuzzySearch({ id: targetId }, assistantName);
        if (result.found && result.note) {
          const fresh = result.note as Note;
          setNotes(prev => {
            const idx = prev.findIndex(n => n._id === fresh._id);
            if (idx >= 0) { const cp = [...prev]; cp[idx] = { ...cp[idx], ...fresh }; return cp; }
            return [fresh, ...prev];
          });
          openNote(fresh);
        } else {
          // Fallback: full reload then open
          await loadNotes();
          const target = findNoteByDeepLinkToken(notesRef.current, targetId);
          if (target) openNote(target);
        }
      } catch (err) {
        log.error('[NotesView] Failed to fetch note for note.open', err as Record<string, unknown>);
      }
    };
    window.addEventListener(NIA_EVENT_NOTE_OPEN, handler as EventListener);
    return () => window.removeEventListener(NIA_EVENT_NOTE_OPEN, handler as EventListener);
  }, [assistantName, openNote, loadNotes]);

  // NIA_EVENT_NOTE_DELETED — bot deleted a note; remove from list and close if open.
  useEffect(() => {
    const handler = (e: Event) => {
      const evt = e as CustomEvent<NiaEventDetail>;
      const rawPayload = evt.detail?.payload;
      if (!rawPayload || typeof rawPayload !== 'object') return;
      const payload = rawPayload as Record<string, unknown>;
      const noteId = typeof payload.noteId === 'string' ? payload.noteId : undefined;
      if (!noteId) return;

      log.info('[NotesView] Received note.deleted event', { noteId });
      // Track deletion so loadNotes() won't re-add it from stale server data
      recentlyDeletedRef.current.set(noteId, Date.now());
      setNotes(prev => prev.filter(n => n._id !== noteId));
      if (currentNoteRef.current?._id === noteId) {
        setCurrentNote(null);
        setOriginalNote(null);
        setViewState('library');
        setIsEditMode(true);
      }
    };
    window.addEventListener(NIA_EVENT_NOTE_DELETED, handler as EventListener);
    return () => window.removeEventListener(NIA_EVENT_NOTE_DELETED, handler as EventListener);
  }, []);

  // ─── Note scroll control (bot-initiated) ───────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const evt = e as CustomEvent<NiaEventDetail>;
      const payload = (evt.detail?.payload ?? {}) as Record<string, unknown>;
      const position = payload.position as string | undefined;
      const section = (payload.section ?? payload.heading) as string | undefined;
      const searchText = payload.searchText as string | undefined;

      const scrollContainer = document.querySelector('.nn-doc-content');
      if (!scrollContainer) return;

      log.info('[NotesView] note.scroll', { position, section, searchText });

      // Scroll to section heading
      if (section) {
        const headings = scrollContainer.querySelectorAll('h1, h2, h3, h4, h5, h6');
        for (const h of headings) {
          if (h.textContent?.toLowerCase().includes(section.toLowerCase())) {
            h.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
          }
        }
      }

      // Scroll to text match
      if (searchText) {
        const walker = document.createTreeWalker(scrollContainer, NodeFilter.SHOW_TEXT);
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          if (node.textContent?.toLowerCase().includes(searchText.toLowerCase())) {
            const parent = node.parentElement;
            if (parent) {
              parent.scrollIntoView({ behavior: 'smooth', block: 'center' });
              return;
            }
          }
        }
      }

      // Positional scroll
      if (position) {
        const p = position.toLowerCase();
        if (p === 'top') {
          scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (p === 'bottom') {
          scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
        } else if (p === 'up') {
          scrollContainer.scrollBy({ top: -scrollContainer.clientHeight * 0.8, behavior: 'smooth' });
        } else if (p === 'down') {
          scrollContainer.scrollBy({ top: scrollContainer.clientHeight * 0.8, behavior: 'smooth' });
        } else {
          // Try percentage
          const pct = parseFloat(p);
          if (!isNaN(pct)) {
            const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
            scrollContainer.scrollTo({ top: maxScroll * (pct / 100), behavior: 'smooth' });
          }
        }
      }
    };
    window.addEventListener(NIA_EVENT_NOTE_SCROLL, handler as EventListener);
    return () => window.removeEventListener(NIA_EVENT_NOTE_SCROLL, handler as EventListener);
  }, []);

  // ─── Note highlight control (bot-initiated) ──────────────────────────────
  useEffect(() => {
    const HIGHLIGHT_COLORS: Record<string, string> = {
      yellow: 'rgba(255, 235, 59, 0.35)',
      blue: 'rgba(66, 165, 245, 0.30)',
      green: 'rgba(102, 187, 106, 0.30)',
      pink: 'rgba(236, 64, 122, 0.25)',
      orange: 'rgba(255, 167, 38, 0.30)',
    };

    const clearHighlights = () => {
      document.querySelectorAll('.pearl-highlight').forEach(el => {
        const parent = el.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(el.textContent || ''), el);
          parent.normalize();
        }
      });
    };

    const applyHighlight = (payload: Record<string, unknown>) => {
      const text = payload.text as string | undefined;
      const section = payload.section as string | undefined;
      const color = (payload.color as string) || 'yellow';
      const durationSeconds = (payload.durationSeconds as number) ?? 8;
      const bgColor = HIGHLIGHT_COLORS[color] || HIGHLIGHT_COLORS.yellow;

      const scrollContainer = document.querySelector('.nn-doc-content');
      if (!scrollContainer) return;

      // Clear previous highlights first
      clearHighlights();

      if (section) {
        // Highlight entire section (heading + content until next heading of same/higher level)
        const headings = scrollContainer.querySelectorAll('h1, h2, h3, h4, h5, h6');
        for (const h of headings) {
          if (h.textContent?.toLowerCase().includes(section.toLowerCase())) {
            const level = parseInt(h.tagName[1]);
            const elementsToHighlight = [h as HTMLElement];
            let sibling = h.nextElementSibling;
            while (sibling) {
              if (/^H[1-6]$/.test(sibling.tagName) && parseInt(sibling.tagName[1]) <= level) break;
              elementsToHighlight.push(sibling as HTMLElement);
              sibling = sibling.nextElementSibling;
            }
            for (const el of elementsToHighlight) {
              el.style.backgroundColor = bgColor;
              el.style.borderRadius = '4px';
              el.style.transition = 'background-color 0.5s ease';
              el.classList.add('pearl-highlight');
            }
            h.scrollIntoView({ behavior: 'smooth', block: 'start' });
            break;
          }
        }
      } else if (text) {
        // Highlight text matches using mark-like wrapping
        const searchLower = text.toLowerCase();
        const walker = document.createTreeWalker(scrollContainer, NodeFilter.SHOW_TEXT);
        const matches: { node: Text; start: number; end: number }[] = [];
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          const content = node.textContent || '';
          const idx = content.toLowerCase().indexOf(searchLower);
          if (idx !== -1) {
            matches.push({ node, start: idx, end: idx + text.length });
          }
        }
        let scrolled = false;
        // Process in reverse to maintain valid node references
        for (let i = matches.length - 1; i >= 0; i--) {
          const m = matches[i];
          const range = document.createRange();
          range.setStart(m.node, m.start);
          range.setEnd(m.node, m.end);
          const mark = document.createElement('mark');
          mark.className = 'pearl-highlight';
          mark.style.backgroundColor = bgColor;
          mark.style.borderRadius = '3px';
          mark.style.padding = '1px 2px';
          mark.style.transition = 'background-color 0.5s ease';
          mark.style.animation = 'pearl-highlight-pulse 2s ease-in-out 2';
          range.surroundContents(mark);
          if (!scrolled) {
            mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
            scrolled = true;
          }
        }
      }

      // Auto-clear after duration
      if (durationSeconds > 0) {
        setTimeout(clearHighlights, durationSeconds * 1000);
      }
    };

    const highlightHandler = (e: Event) => {
      const evt = e as CustomEvent<NiaEventDetail>;
      const payload = (evt.detail?.payload ?? {}) as Record<string, unknown>;
      log.info('[NotesView] note.highlight', payload);
      applyHighlight(payload);
    };

    const clearHandler = () => {
      log.info('[NotesView] note.highlight.clear');
      clearHighlights();
    };

    window.addEventListener(NIA_EVENT_NOTE_HIGHLIGHT, highlightHandler as EventListener);
    window.addEventListener(NIA_EVENT_NOTE_HIGHLIGHT_CLEAR, clearHandler as EventListener);
    return () => {
      window.removeEventListener(NIA_EVENT_NOTE_HIGHLIGHT, highlightHandler as EventListener);
      window.removeEventListener(NIA_EVENT_NOTE_HIGHLIGHT_CLEAR, clearHandler as EventListener);
    };
  }, []);

  // ─── Note navigate heading control (bot-initiated) ────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const evt = e as CustomEvent<NiaEventDetail>;
      const payload = (evt.detail?.payload ?? {}) as Record<string, unknown>;
      log.info('[NotesView] note.navigate.heading', payload);

      const heading = payload.heading as string | undefined;
      const direction = payload.direction as string | undefined;

      const scrollContainer = document.querySelector('.nn-doc-content');
      if (!scrollContainer) return;

      const headings = Array.from(scrollContainer.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      if (headings.length === 0) return;

      if (heading) {
        // Navigate to a specific heading by text match
        const searchLower = heading.toLowerCase();
        const target = headings.find(h => h.textContent?.toLowerCase().includes(searchLower));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Brief flash to indicate the heading
          const el = target as HTMLElement;
          const origBg = el.style.backgroundColor;
          el.style.backgroundColor = 'rgba(255, 235, 59, 0.35)';
          el.style.transition = 'background-color 0.5s ease';
          setTimeout(() => { el.style.backgroundColor = origBg; }, 2000);
        }
      } else if (direction) {
        // Navigate to next/previous heading relative to current scroll position
        const containerRect = scrollContainer.getBoundingClientRect();
        const viewportMiddle = containerRect.top + containerRect.height * 0.3;

        if (direction === 'next') {
          const next = headings.find(h => h.getBoundingClientRect().top > viewportMiddle + 10);
          if (next) next.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (direction === 'previous') {
          const above = headings.filter(h => h.getBoundingClientRect().top < viewportMiddle - 10);
          if (above.length > 0) above[above.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    };

    window.addEventListener(NIA_EVENT_NOTE_NAVIGATE_HEADING, handler as EventListener);
    return () => window.removeEventListener(NIA_EVENT_NOTE_NAVIGATE_HEADING, handler as EventListener);
  }, []);

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
          if (initialContent && hasWriteAccess(existing)) {
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
      if (action === 'saveNote') { if (!shouldIgnoreDuplicate(action, {})) void persistCurrentNote({ showErrors: true }); }
      if (action === 'downloadNote') { if (!shouldIgnoreDuplicate(action, {})) downloadNote(); }
      if (action === 'writeContent') {
        const content = (payload.content as string) || '';
        if (!hasWriteAccess(currentNoteRef.current)) return;
        if (!shouldIgnoreDuplicate(action, { content })) {
          setCurrentNote(prev => prev ? { ...prev, content } : prev);
          setIsEditMode(true);
        }
      }
      if (action === 'addContent') {
        const content = (payload.content as string) || '';
        if (!hasWriteAccess(currentNoteRef.current)) return;
        if (!shouldIgnoreDuplicate(action, { content })) {
          const merged = mergeBulletList(currentNoteRef.current?.content || '', parseListItems(content));
          setCurrentNote(prev => prev ? { ...prev, content: merged } : prev);
          setIsEditMode(true);
        }
      }
      if (action === 'updateContent') {
        const fromText = (payload.fromText as string) || '';
        const toText = (payload.toText as string) || '';
        if (!hasWriteAccess(currentNoteRef.current)) return;
        if (!shouldIgnoreDuplicate(action, { fromText, toText })) {
          setCurrentNote(prev => prev ? { ...prev, content: (prev.content || '').replace(fromText, toText) } : prev);
          setIsEditMode(true);
        }
      }
      if (action === 'removeContent') {
        const targetText = (payload.targetText as string) || '';
        if (!hasWriteAccess(currentNoteRef.current)) return;
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
        if (!hasWriteAccess(currentNoteRef.current)) return;
        if (newTitle) { setCurrentNote(prev => prev ? { ...prev, title: newTitle } : prev); setIsEditMode(true); }
      }
      if (action === 'attemptClose') {
        void persistCurrentNote();
        onClose?.();
      }
      if (action === 'openNote') {
        if (!isReadyRef.current) { commandQueueRef.current.push({ action, payload }); return; }
        let noteId = (payload.noteId as string) || '';
        const targetTitle = (payload.title as string) || '';
        const targetMode = (payload.mode as NoteMode) || mode;
        const eventNote = payload.note as Note | undefined;

        if (!noteId && eventNote?._id) noteId = eventNote._id;

        // If we got a full note object from the event, use it directly
        if (eventNote && eventNote._id && typeof (eventNote as any).content === 'string') {
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
          const localBeforeFetch = findNoteByDeepLinkToken(notesRef.current, noteId);
          if (localBeforeFetch) {
            openNote(localBeforeFetch);
            return;
          }
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
          const local = findNoteByDeepLinkToken(notesRef.current, noteId);
          if (local) { openNote(local); return; }
          sendMessage({ content: 'Could not find the requested note.', role: 'assistant', mode: 'queued' });
          return;
        }

        if (!targetTitle) return;
        if (shouldIgnoreDuplicate(action, { targetTitle, targetMode })) return;

        // Title-based fuzzy search
        let freshNotes: Note[] = notes;
        try { freshNotes = (await fetchNotes(targetMode, assistantName) || []).map(toViewNote); } catch { /* use current */ }
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
        setIsEditMode(true);
        sendMessage({ content: 'Returned to notes list.', role: 'assistant', mode: 'queued' });
      }
    };

    window.addEventListener('notepadCommand', handler as EventListener);
    return () => window.removeEventListener('notepadCommand', handler as EventListener);
  }, [notes, mode, assistantName, shouldIgnoreDuplicate, openNote, handleCreateNote, handleDeleteNote, persistCurrentNote, downloadNote, handleModeSwitch, onClose, sendMessage, loadNotes, toViewNote, hasWriteAccess]);

  useEffect(() => {
    const noteId = (initialNoteId || '').trim();
    if (!noteId || lastInitialNoteIdRef.current === noteId) return;
    lastInitialNoteIdRef.current = noteId;
    window.dispatchEvent(new CustomEvent('notepadCommand', {
      detail: { action: 'openNote', payload: { noteId } },
    }));
  }, [initialNoteId]);

  // ─── Cleanup (save unsaved changes on unmount) ─────────────────────────

  useEffect(() => {
    return () => {
      if (incrementalAbortRef.current) incrementalAbortRef.current();
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

      // Preserve the latest draft when the Notes window is closed before
      // the debounce fires. The queue is flushed through updateNote.
      const note = currentNoteRef.current;
      const orig = originalNoteRef.current;
      if (note?._id && orig && (note.title !== orig.title || note.content !== orig.content)) {
        queueOfflineNoteUpdate({
          noteId: note._id,
          assistantName,
          data: { title: note.title || '', content: note.content || '', isPinned: note.isPinned },
        });
      }
    };
  }, [assistantName]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <style>{NN_STYLES}</style>
      {/* Delete Dialog */}
      {showDeleteDialog && (
        <div className="nn-overlay">
          <div className="nn-dialog">
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
                <div className="nn-drag-icon"><FilePlus2 size={46} aria-hidden="true" /></div>
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
              <div className="nn-library-title-row">
                <h1 className="nn-library-title">Notes</h1>
                <PearlCommandInput
                  ariaLabel="Notes command"
                  className="nn-library-command-input"
                  disabled={isLoading}
                  onCommandInput={handleNotesCommandInput}
                  placeholder="Create a new note, re-organize, search, or use a Note as a blueprint and send it to the Studio."
                />
              </div>
            </div>

            {/* Content */}
            <div className="nn-library-body">
              {studioPickMode && (
                <div className="nn-studio-pick-banner">
                  <span>Choose a note for Studio</span>
                  <button onClick={() => setStudioPickMode(false)} aria-label="Cancel Studio note selection">
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              )}
              {isLoading && notes.length === 0 ? (
                <div className="nn-empty">
                  <div className="nn-spinner" />
                  <p>Loading notes…</p>
                </div>
              ) : searchQuery && filteredNotes.length === 0 ? (
                <div className="nn-empty">
                  <div className="nn-empty-icon"><Sparkles size={44} aria-hidden="true" /></div>
                  <p className="nn-empty-title">No matches</p>
                  <p className="nn-empty-subtitle">Try a different search</p>
                </div>
              ) : (
                <div className="nn-folder-board">
                  {NOTE_FOLDERS.map(folder => {
                    const folderNotes = folder.id === 'recent' ? recentNotes : (notesByFolder.get(folder.id) || []);
                    if (folderNotes.length === 0) return null;
                    const isCollapsed = collapsedFolders.has(folder.id);
                    const isDragTarget = dragOverFolderId === folder.id;
                    const isPearlDiary = folder.id === 'pearl';
                    return (
                      <section
                        className={`nn-folder-section ${isDragTarget ? 'nn-folder-drop-target' : ''} ${isPearlDiary ? 'nn-folder-pearl-diary' : ''}`}
                        key={folder.id}
                        onDragOver={e => handleFolderDragOver(e, folder.id)}
                        onDragLeave={handleFolderDragLeave}
                        onDrop={e => handleFolderDrop(e, folder.id)}
                      >
                        <div
                          className="nn-folder-header nn-folder-header-clickable"
                          onClick={() => toggleFolderCollapse(folder.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFolderCollapse(folder.id); } }}
                        >
                          <span className="nn-folder-chevron" aria-hidden="true">
                            {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                          </span>
                          <span className="nn-book-stack-sprite" style={{ '--folder-color': folder.color } as React.CSSProperties} aria-hidden="true">
                            <span /><span /><span />
                          </span>
                          <div>
                            <h2>{folder.title}</h2>
                            <p>{folderNotes.length} {folderNotes.length === 1 ? 'note' : 'notes'}</p>
                          </div>
                        </div>
                        {!isCollapsed && (
                          <div className="nn-card-grid">
                            {folderNotes.map((note, index) => {
                              const displayTitle = (folder.id === 'chat-archive' && isArchivedChatNote(note))
                                ? inferChatTopicName(note)
                                : (note.title || 'Untitled');
                              const isProtected = !hasWriteAccess(note);
                              return (
                                <div
                                  key={note._id || `${folder.id}-${index}`}
                                  className={`nn-card ${studioPickMode ? 'nn-card-pick-mode' : ''} ${currentNote?._id === note._id ? 'nn-card-active' : ''} ${note.isPinned ? 'nn-card-pinned' : ''} ${draggingNoteId === note._id ? 'nn-card-dragging' : ''} ${isProtected ? 'nn-card-read-only' : ''}`}
                                  style={{ animationDelay: `${index * 35}ms` }}
                                  draggable={folder.id === 'your-notes' && !!note._id && hasWriteAccess(note)}
                                  onDragStart={e => note._id && handleNoteDragStart(e, note._id)}
                                  onDragEnd={handleNoteDragEnd}
                                  onClick={() => studioPickMode && note._id ? handleSendNoteToLaunchpad(note._id) : handleNoteSwitch(note)}
                                >
                                  {note.isPinned && <span className="nn-pin-diamond">◆</span>}
                                  {isFeatureEnabled('resourceSharing', supportedFeatures) && sharedNoteIds.has(note._id!) && (
                                    <div className="nn-shared-badge"><SharedIndicator /></div>
                                  )}
                                  <h3 className="nn-card-title">{displayTitle}</h3>
                                  <p className="nn-card-preview">{getPreview(note.content || '')}</p>
                                  <div className="nn-card-footer">
                                    <span className="nn-card-date">{folder.id === 'tasks' ? 'Task log' : isArchivedChatNote(note) ? 'Chat archive' : formatDate(note)}</span>
                                    {hasWriteAccess(note) && (
                                      <button className="nn-card-delete" onClick={e => { e.stopPropagation(); handleDeleteNote(note._id!); }} title="Delete" aria-label="Delete note">
                                        <Trash2 size={14} aria-hidden="true" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          // ═══ DOCUMENT VIEW ═══
          <div className="nn-document">
            {/* Back button - stays at top */}
            <div className="nn-toolbar-top">
              <button className="nn-btn nn-btn-icon nn-btn-back" onClick={handleBackToLibrary} title="Back to library" aria-label="Back to library">
                <ArrowLeft size={22} aria-hidden="true" />
              </button>
              <h2 className="nn-toolbar-top-title">{currentNote?.title || 'Untitled'}</h2>
              <div className="nn-toolbar-top-actions">
                <div className="nn-toolbar-right nn-toolbar-top-icons">
                  {hasUnsavedChanges() && <span className="nn-unsaved-dot" title="Unsaved changes" />}
                  {hasWriteAccess(currentNote) && (
                    <button
                      className={`nn-btn nn-btn-icon ${isEditMode ? 'nn-btn-active' : ''}`}
                      onClick={() => setIsEditMode(v => !v)}
                      title={isEditMode ? 'Preview' : 'Edit'}
                      aria-label={isEditMode ? 'Preview note' : 'Edit note'}
                    >
                      <Pencil size={17} aria-hidden="true" />
                    </button>
                  )}
                  {hasWriteAccess(currentNote) && currentNote?._id && (
                    <button className="nn-btn nn-btn-icon nn-btn-delete-toolbar" onClick={() => handleDeleteNote(currentNote._id!)} title="Delete" aria-label="Delete note">
                      <Trash2 size={17} aria-hidden="true" />
                    </button>
                  )}
                  {currentNote && (
                    <NoteShareControls
                      currentNote={currentNote}
                      supportedFeatures={supportedFeatures}
                      tenantId={currentNote?.tenantId || propTenantId}
                      onSharingUpdated={() => toast({ title: 'Sharing Updated' })}
                    />
                  )}
                  <button className="nn-btn nn-btn-icon" onClick={downloadNote} title="Download" aria-label="Download note">
                    <Download size={17} aria-hidden="true" />
                  </button>
                </div>
                <div className="nn-toolbar-top-save">
                  {!hasWriteAccess(currentNote) ? (
                    <span className="nn-readonly-badge">Read-only</span>
                  ) : isSaving ? (
                    <span className="nn-autosave-status">Saving…</span>
                  ) : hasUnsavedChanges() ? (
                    <span className="nn-autosave-status">Autosaving…</span>
                  ) : (
                    <span className="nn-autosave-status">Saved</span>
                  )}
                </div>
              </div>
            </div>

            {/* Document content */}
            {currentNote ? (
              <div className="nn-doc-content">
                {hasWriteAccess(currentNote) ? (
                  <input
                    className="nn-title-input"
                    type="text"
                    value={currentNote.title || ''}
                    onChange={e => setCurrentNote(prev => prev ? { ...prev, title: e.target.value } : prev)}
                    placeholder="Untitled"
                  />
                ) : (
                  <h1 className="nn-doc-title-always">{currentNote.title || 'Untitled'}</h1>
                )}

                {/* Meta */}
                <div className="nn-doc-meta">
                  <span>{formatDate(currentNote)}</span>
                  {isArchivedChatNote(currentNote) && <span className="nn-work-badge">CHAT HISTORY</span>}
                  {currentNote.mode === 'work' && <span className="nn-work-badge">WORK</span>}
                  {currentNote.sourceFile && (
                    <span className="nn-source-badge">
                      {currentNote.sourceFile.type.toUpperCase()}: {currentNote.sourceFile.name} ({formatFileSize(currentNote.sourceFile.size)})
                    </span>
                  )}
                </div>

                {/* Body */}
                {hasWriteAccess(currentNote) && isEditMode ? (
                  <textarea
                    className="nn-editor"
                    value={currentNote.content || ''}
                    onChange={e => setCurrentNote(prev => prev ? { ...prev, content: e.target.value } : prev)}
                    placeholder="Start writing…"
                  />
                ) : (
                  <div className="nn-rendered-content">
                    <StreamingRenderer
                      content={currentNote.content || ''}
                      isStreaming={isStreaming}
                      noteId={currentNote._id}
                      noteTitle={currentNote.title || ''}
                    />
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
  position: relative;
}

.nn-library-header {
  padding: 10px 28px 18px;
  border-bottom: 1px solid rgba(30, 30, 46, 0.6);
  flex-shrink: 0;
  background: linear-gradient(180deg, rgba(18, 18, 26, 0.5) 0%, transparent 100%);
}

.nn-library-title-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  position: relative;
}

.nn-library-title {
  font-family: 'Crimson Pro', serif;
  font-size: 32px;
  font-weight: 600;
  letter-spacing: 0;
  background: linear-gradient(135deg, #e8e6e3, #c4b5fd);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0;
}

.nn-library-command-input {
  width: min(820px, 100%);
}

.pearl-command-input {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 48px;
  border: 1px solid rgba(169, 187, 204, 0.22);
  border-radius: 999px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.095), rgba(111, 169, 193, 0.055)),
    rgba(12, 13, 18, 0.82);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    0 18px 44px rgba(0, 0, 0, 0.28);
  overflow: hidden;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.pearl-command-input:focus-within {
  border-color: rgba(135, 210, 205, 0.55);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    0 18px 48px rgba(0, 0, 0, 0.34),
    0 0 0 3px rgba(135, 210, 205, 0.09);
}

.pearl-command-input-icon {
  position: absolute;
  left: 18px;
  top: 50%;
  transform: translateY(-50%);
  color: #9ed9d4;
  pointer-events: none;
}

.pearl-command-input-field {
  width: 100%;
  min-width: 0;
  height: 48px;
  border: 0;
  outline: none;
  background: transparent;
  color: #f2f0ec;
  padding: 0 22px 0 50px;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  letter-spacing: 0;
  text-overflow: ellipsis;
}

.pearl-command-input-field::placeholder {
  color: rgba(232, 230, 227, 0.62);
}

.pearl-command-input-field:disabled {
  cursor: wait;
  opacity: 0.62;
}

.nn-library-primary-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}

.nn-action-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.045);
  color: #e8e6e3;
  padding: 7px 12px;
  font-family: 'Gohufont', 'Inter', monospace;
  font-size: 12px;
  cursor: pointer;
}

.nn-action-pill:hover {
  background: rgba(124, 111, 159, 0.18);
  border-color: rgba(196, 181, 253, 0.35);
}

.nn-action-pill-magic {
  color: #ffd4f0;
  border-color: rgba(217, 95, 159, 0.28);
}

.nn-magic-menu {
  position: absolute;
  top: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  display: grid;
  gap: 8px;
  width: min(360px, calc(100vw - 48px));
  padding: 10px;
  background: rgba(18, 18, 26, 0.98);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
}

.nn-magic-choice {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 10px 12px;
  color: #f6f1eb;
  background: rgba(255, 255, 255, 0.045);
  text-align: left;
  cursor: pointer;
  font-size: 13px;
}

.nn-magic-choice:hover {
  border-color: rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
}

.nn-magic-choice-organize { color: #cce5ff; }
.nn-magic-choice-studio { color: #ffd4f0; }

.nn-book-stack-icon,
.nn-book-stack-sprite {
  display: inline-grid;
  grid-template-columns: 1fr;
  gap: 2px;
  width: 28px;
  flex-shrink: 0;
}

.nn-book-stack-icon span,
.nn-book-stack-sprite span {
  display: block;
  height: 6px;
  border: 1px solid rgba(0, 0, 0, 0.35);
  box-shadow: inset 2px 0 rgba(255, 255, 255, 0.16), 2px 2px 0 rgba(0, 0, 0, 0.25);
  image-rendering: pixelated;
}

.nn-book-stack-icon span:nth-child(1) { width: 24px; background: #6aa6ff; }
.nn-book-stack-icon span:nth-child(2) { width: 19px; background: #e1a44f; margin-left: 5px; }
.nn-book-stack-icon span:nth-child(3) { width: 27px; background: #d95f9f; margin-left: 1px; }

.nn-book-stack-sprite span:nth-child(1) { width: 28px; background: var(--folder-color); }
.nn-book-stack-sprite span:nth-child(2) { width: 22px; background: color-mix(in srgb, var(--folder-color), #ffffff 16%); margin-left: 5px; }
.nn-book-stack-sprite span:nth-child(3) { width: 31px; background: color-mix(in srgb, var(--folder-color), #000000 18%); margin-left: 1px; }

/* Search */
.nn-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.nn-search-icon {
  position: absolute;
  left: 12px;
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

.nn-studio-pick-banner {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid rgba(217, 95, 159, 0.25);
  border-radius: 8px;
  background: rgba(47, 24, 46, 0.95);
  color: #ffd4f0;
  font-size: 13px;
}

.nn-studio-pick-banner button {
  display: inline-flex;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

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

/* Folders and cards */
.nn-folder-board {
  display: grid;
  gap: 24px;
}

.nn-folder-section {
  display: grid;
  gap: 12px;
}

.nn-folder-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 2px;
  user-select: none;
}

.nn-folder-header-clickable {
  cursor: pointer;
  border-radius: 8px;
  padding: 6px 8px;
  margin: -6px -8px;
  transition: background 0.15s;
}
.nn-folder-header-clickable:hover {
  background: rgba(124, 111, 159, 0.1);
}

.nn-folder-chevron {
  display: inline-flex;
  align-items: center;
  color: #747486;
  flex-shrink: 0;
  transition: color 0.15s;
}
.nn-folder-header-clickable:hover .nn-folder-chevron {
  color: #b8a1ff;
}

.nn-folder-drop-target {
  outline: 2px dashed rgba(124, 111, 159, 0.5);
  outline-offset: 4px;
  border-radius: 12px;
  background: rgba(124, 111, 159, 0.05);
}

.nn-card-dragging {
  opacity: 0.4;
  transform: scale(0.97);
}

.nn-card-grip {
  position: absolute;
  top: 8px;
  right: 8px;
  color: #555;
  cursor: grab;
  opacity: 0;
  transition: opacity 0.15s;
}
.nn-card:hover .nn-card-grip {
  opacity: 0.6;
}
.nn-card-grip:hover {
  opacity: 1 !important;
  color: #b8a1ff;
}

.nn-folder-header h2 {
  margin: 0;
  color: #f0ede8;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: 0;
}

.nn-folder-header p {
  margin: 2px 0 0;
  color: #747486;
  font-size: 11px;
}

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
.nn-card-read-only {
  border-color: rgba(169, 187, 204, 0.16);
}
.nn-card-read-only:hover {
  border-color: rgba(169, 187, 204, 0.28);
}
.nn-card:hover::before { opacity: 1; }
.nn-card-active { border-color: rgba(124, 111, 159, 0.5); }
.nn-card-pinned { border-color: rgba(196, 181, 253, 0.2); }
.nn-card-pick-mode { border-color: rgba(217, 95, 159, 0.35); }
.nn-card-pick-mode:hover { border-color: rgba(217, 95, 159, 0.75); }

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
  opacity: 0;
  transition: opacity 0.2s;
  padding: 2px 4px;
  color: #ef9a9a;
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
  min-height: 0;
  overflow: hidden;
}

/* Top mini-bar: back button + title + actions */
.nn-toolbar-top {
  display: flex;
  align-items: center;
  padding: 56px 16px 8px;
  /* Reserve space so title never collides with right action cluster */
  padding-right: 260px;
  gap: 8px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(30, 30, 46, 0.4);
  z-index: 35;
  position: relative;
}

.nn-toolbar-top-title {
  font-family: 'Crimson Pro', serif;
  font-size: 16px;
  font-weight: 500;
  color: #8a8a9a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
  flex: 1;
  min-width: 0;
}

/* Bottom toolbar */
.nn-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px;
  flex-shrink: 0;
  gap: 8px;
  position: relative;
  z-index: 35;
}

.nn-toolbar-bottom {
  border-top: 1px solid rgba(30, 30, 46, 0.6);
  background: rgba(10, 10, 15, 0.85);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
}

.nn-toolbar-left { display: flex; align-items: center; gap: 4px; }
.nn-toolbar-right { 
  display: flex; 
  align-items: center; 
  gap: 4px;
}
.nn-toolbar-right-bottom {
  padding-right: 0;
}

.nn-toolbar-top-actions {
  margin-left: 0;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  justify-content: flex-end;
  gap: 6px;
  /* Pin actions on the same top chrome line without overlap */
  position: absolute;
  top: 10px;
  right: 16px;
}

.nn-toolbar-top-icons,
.nn-toolbar-top-save {
  display: flex;
  align-items: center;
}

.nn-toolbar-top-icons {
  gap: 4px;
}

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

.nn-autosave-status {
  font-family: 'Gohufont', monospace;
  font-size: 11px;
  color: #8a8a9a;
  white-space: nowrap;
}

/* Document content area */
.nn-doc-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 48px 24px;
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
  }

  .nn-library-header { 
    padding: 10px 16px 12px;
  }

  /* Ensure title is always visible and not overlapped */
  .nn-library-title {
    font-size: 24px;
    position: relative;
    z-index: 1;
  }

  .pearl-command-input {
    min-height: 44px;
  }

  .pearl-command-input-field {
    height: 44px;
    font-size: 12px;
    padding-left: 46px;
    padding-right: 16px;
  }

  .nn-library-body { padding: 12px 16px 16px; }
  .nn-card-grid { grid-template-columns: 1fr; }

  /* Make toolbar wrap on mobile so buttons don't overflow */
  .nn-toolbar { 
    padding: 10px 12px; 
    flex-wrap: wrap;
    gap: 6px;
  }

  .nn-toolbar-left {
    flex-wrap: wrap;
    gap: 2px;
  }

  .nn-toolbar-right {
    flex-wrap: wrap;
    padding-right: 0;
  }

  /* One row: back + icons (title hidden) — back is not on its own line */
  .nn-toolbar-top {
    padding: calc(env(safe-area-inset-top, 0px) + 52px) 10px 6px;
    padding-right: 10px;
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .nn-toolbar-top .nn-btn-back {
    flex-shrink: 0;
  }

  .nn-toolbar-top-actions {
    position: static;
    margin-left: 0;
    top: auto;
    right: auto;
    gap: 8px;
    flex-wrap: nowrap;
    flex: 1;
    min-width: 0;
    width: auto;
    max-width: none;
    justify-content: space-between;
  }

  .nn-toolbar-top-icons,
  .nn-toolbar-top-save {
    flex-wrap: nowrap;
    white-space: nowrap;
    display: flex;
    align-items: center;
  }

  .nn-toolbar-top-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Mobile: hide mini title next to back button */
  .nn-toolbar-top-title {
    display: none;
  }

  .nn-toolbar-top-icons .nn-btn-icon {
    min-width: 28px;
    padding: 4px 6px;
    font-size: 14px;
  }

  .nn-toolbar-top-icons {
    flex: 1;
    justify-content: space-evenly;
  }

  .nn-toolbar-top-save .nn-autosave-status {
    font-size: 10px;
  }

  .nn-magic-wand-fab {
    /* Keep position: fixed on mobile so it pins to viewport, not the
       transformed .nn-document containing block. */
    position: fixed;
    right: 16px;
    bottom: calc(88px + env(safe-area-inset-bottom, 0px));
    z-index: 1000;
    pointer-events: auto;
  }

  /* Reduce editor min-height on mobile */
  .nn-editor {
    min-height: 250px;
  }

  /* Smaller doc title on mobile */
  .nn-doc-title-always {
    font-size: 28px !important;
  }

  .nn-title-input {
    font-size: 28px;
  }

  /* Ensure cards don't have excessive padding */
  .nn-card {
    padding: 14px;
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

.nn-rendered-content {
  min-height: calc(100dvh - 190px);
  padding-bottom: 80px;
}

/* HTML content rendered via dangerouslySetInnerHTML */
.nn-html-content {
  padding: 0;
  color: #e8e6e3;
  line-height: 1.6;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
.nn-html-content * { max-width: 100%; box-sizing: border-box; }
.nn-html-content img { max-width: 100%; height: auto; border-radius: 8px; }
.nn-html-content table { border-collapse: collapse; width: 100%; margin: 8px 0; }
.nn-html-content th, .nn-html-content td { border: 1px solid rgba(255,255,255,0.1); padding: 8px 12px; text-align: left; }
.nn-html-content th { background: rgba(255,255,255,0.05); font-weight: 600; }
.nn-html-content a { color: #9b8ec4; text-decoration: underline; }
.nn-html-content h1, .nn-html-content h2, .nn-html-content h3 { margin: 16px 0 8px; }
.nn-html-content pre { background: rgba(0,0,0,0.3); padding: 12px; border-radius: 6px; overflow-x: auto; }
.nn-html-content code { font-family: 'Source Code Pro', monospace; font-size: 0.9em; }

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
.nn-drag-icon { display: flex; justify-content: center; color: #c4b5fd; margin-bottom: 12px; }
.nn-drag-title { font-size: 20px; font-weight: 600; color: #c4b5fd; margin-bottom: 4px; }
.nn-drag-subtitle { font-size: 13px; color: #8a8a9a; }

/* ── Loading text ─────────────────────────────────────────────────────── */

.nn-loading { color: #8a8a9a; padding: 24px; text-align: center; }

/* Launchpad magic wand — document view only; fixed above Pearl chat bar */
.nn-magic-wand-fab {
  position: fixed;
  right: 24px;
  bottom: calc(84px + env(safe-area-inset-bottom, 0px));
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  touch-action: manipulation;
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

/* ── PearlOS theme bridge ─────────────────────────────────────────────── */

.nn-root {
  background: var(--pearl-stage-bg, #0a0a0f);
  color: var(--pearl-text, #e8e6e3);
  font-family: var(--pearl-ui-font, 'Inter', -apple-system, BlinkMacSystemFont, sans-serif);
}

.nn-root *,
.nn-btn,
.nn-action-pill,
.nn-search-input,
.nn-editor {
  font-family: var(--pearl-ui-font, 'Inter', -apple-system, BlinkMacSystemFont, sans-serif);
}

.nn-library-header,
.nn-toolbar-top,
.nn-toolbar-bottom,
.nn-dialog,
.nn-magic-menu {
  background: var(--pearl-window-bg, #12121a);
  border-color: var(--pearl-window-border, #1e1e2e);
  color: var(--pearl-text, #e8e6e3);
  -webkit-backdrop-filter: var(--pearl-window-backdrop, none);
  backdrop-filter: var(--pearl-window-backdrop, none);
}

.nn-card,
.nn-search-input,
.nn-action-pill,
.nn-magic-choice,
.nn-doc-meta,
.nn-pre,
.nn-table-wrap,
.nn-source-badge,
.nn-readonly-badge {
  background: var(--pearl-window-content-bg, #12121a);
  border-color: var(--pearl-window-border, #1e1e2e);
  color: var(--pearl-text, #e8e6e3);
}

.nn-card:hover,
.nn-action-pill:hover,
.nn-btn:hover:not(:disabled),
.nn-btn-icon:hover:not(:disabled),
.nn-magic-choice:hover {
  background: color-mix(in srgb, var(--pearl-accent, #7c6f9f), transparent 86%);
  border-color: color-mix(in srgb, var(--pearl-accent, #7c6f9f), transparent 56%);
}

.nn-library-title {
  background: linear-gradient(135deg, var(--pearl-text, #e8e6e3), var(--pearl-accent, #c4b5fd));
  -webkit-background-clip: text;
  background-clip: text;
}

.nn-loading-bar,
.nn-accent-line,
.nn-btn-primary {
  background: linear-gradient(135deg, var(--pearl-accent, #7c6f9f), color-mix(in srgb, var(--pearl-accent, #7c6f9f), #ffffff 24%));
}

.nn-h1,
.nn-h2,
.nn-h3,
.nn-h4,
.nn-doc-title,
.nn-doc-title-always,
.nn-title-input,
.nn-card-title,
.nn-dialog-title,
.nn-folder-header h2,
.nn-strong {
  color: var(--pearl-text, #e8e6e3) !important;
  -webkit-text-fill-color: var(--pearl-text, #e8e6e3) !important;
}

.nn-p,
.nn-li,
.nn-code-block,
.nn-td,
.nn-html-content,
.nn-editor {
  color: var(--pearl-soft, #d4d2cf);
}

.nn-card-preview,
.nn-card-date,
.nn-toolbar-top-title,
.nn-dialog-text,
.nn-empty-title,
.nn-empty-subtitle,
.nn-folder-header p,
.nn-autosave-status,
.nn-doc-meta,
.nn-loading,
.nn-drag-subtitle,
.nn-em {
  color: var(--pearl-muted, #8a8a9a);
}

.nn-a,
.nn-code-inline,
.nn-th,
.nn-cursor,
.nn-work-badge,
.nn-empty-magic-title,
.nn-drag-icon,
.nn-drag-title,
.nn-pin-diamond {
  color: var(--pearl-accent, #c4b5fd);
}

.nn-cursor {
  background: var(--pearl-accent, #c4b5fd);
}

.nn-doc-content {
  background:
    linear-gradient(var(--pearl-stage-bg, #0a0a0f) 30%, transparent) center top,
    linear-gradient(transparent, var(--pearl-stage-bg, #0a0a0f) 70%) center bottom,
    radial-gradient(farthest-side at 50% 0, color-mix(in srgb, var(--pearl-accent, #7c6f9f), transparent 88%), transparent) center top,
    radial-gradient(farthest-side at 50% 100%, color-mix(in srgb, var(--pearl-accent, #7c6f9f), transparent 88%), transparent) center bottom;
  background-repeat: no-repeat;
  background-size: 100% 40px, 100% 40px, 100% 14px, 100% 14px;
  background-attachment: local, local, scroll, scroll;
}

.nn-title-input {
  background-image:
    linear-gradient(var(--pearl-stage-bg, #0a0a0f), var(--pearl-stage-bg, #0a0a0f)),
    linear-gradient(90deg, transparent, var(--pearl-accent, #7c6f9f), transparent);
}
`;

export default NotesViewNext;
