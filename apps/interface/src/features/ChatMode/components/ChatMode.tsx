"use client";

import { X } from 'lucide-react';
import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';

import PearlAvatar from '@interface/components/PearlAvatar';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { useUI } from '@interface/contexts/ui-context';
import { useUserProfileOptional } from '@interface/contexts/user-profile-context';
import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { useIsInSplitLayout } from '@interface/features/ManeuverableWindow/lib/SplitLayoutContext';
import { useWindowManager } from '@interface/features/ManeuverableWindow/lib/WindowManagerContext';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { getClientLogger } from '@interface/lib/client-logger';
import {
  PEARL_ONBOARDING_CHAT_MESSAGE_EVENT,
  PEARL_ONBOARDING_FIRST_REPLY_EVENT,
  PEARL_ONBOARDING_STATUS_EVENT,
  WEBCHAT_ONBOARDING_PLACEHOLDER,
  readOnboardingStatus,
  type WebchatOnboardingChatMessageDetail,
  type WebchatOnboardingFirstReplyDetail,
  type WebchatOnboardingStatus,
  type WebchatOnboardingStatusDetail,
} from '@interface/lib/webchat-onboarding';
import { DesktopMode } from '@interface/types/desktop-modes';

import { useChatInbox } from '../hooks/useChatInbox';
import { useChatSession } from '../hooks/useChatSession';

import ChatBubble from './ChatBubble';
import TypingIndicator from './TypingIndicator';

const IMAGE_FILE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|avif|heic|heif|bmp|tiff?)$/i;
const NON_IMAGE_FILE_EXTENSIONS = /\.(?:pdf|docx?|pptx?|xlsx?|xls|ods|odt|txt|md|markdown|json|jsonl|csv|tsv|zip)$/i;
const UPLOAD_URL = '/api/chat/upload';
const MAX_CHAT_ATTACHMENTS = 10;
const VISION_IMAGE_MAX_EDGE = 1280;
const VISION_IMAGE_QUALITY = 0.78;
const CHAT_BAR_LEFT_OFFSET = 'calc(env(safe-area-inset-left, 0px) + clamp(12px, 3vw, 20px))';
const CHAT_BAR_RIGHT_OFFSET = 'calc(env(safe-area-inset-right, 0px) + clamp(12px, 3vw, 20px))';
const CHATMODE_TRACE_VERSION = 'chatmode-trace-2026-03-02-01';
const TASK_TOAST_DEDUPE_MS = 2 * 60 * 1000;
const TASK_TOAST_DEFAULT_DURATION_MS = 5000;
const TASK_TOAST_MIN_DURATION_MS = 2500;
const TASK_TOAST_MAX_DURATION_MS = 10000;
const COMPACT_PREVIEW_AUTO_DISMISS_MS = 10000;
const COMPACT_PREVIEW_DISMISS_STORAGE_KEY = 'pearl.chat.compactPreview.dismissed.v1';
const COMPACT_PREVIEW_DISMISS_MAX = 200;
const dismissedTaskToastKeys = new Set<string>();
const recentTaskToastKeys = new Map<string, number>();

function isImageLikeFile(file: Pick<File, 'name' | 'type'>): boolean {
  if (NON_IMAGE_FILE_EXTENSIONS.test(file.name || '')) return false;
  const mime = (file.type || '').toLowerCase();
  return mime.startsWith('image/') || IMAGE_FILE_EXTENSIONS.test(file.name || '');
}

function kindFromAttachmentContext(context?: string): string | undefined {
  return context?.match(/^Kind:\s*([^\s]+)/im)?.[1]?.trim().toLowerCase();
}

function isClipboardImageItem(item: DataTransferItem): boolean {
  return (item.type || '').toLowerCase().startsWith('image/');
}

function imageExtensionForFile(file: Pick<File, 'name' | 'type'>): string {
  const mimeExt = (file.type || '').split('/')[1]?.toLowerCase();
  if (mimeExt) return mimeExt.replace(/[^a-z0-9]+/g, '') || 'png';
  const nameExt = (file.name || '').match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return nameExt || 'png';
}

// Module-scoped logger so its reference stays stable across re-renders.
// Previously `getClientLogger` ran inside the component body and produced a
// fresh object on every keystroke, which caused every effect with `log` in
// its deps to tear down and re-bind window listeners on every input event —
// a measurable per-keystroke stall once the transcript grew large.
const log = getClientLogger('[chat_mode]');

type StoredAttachment = {
  id?: string;
  filename: string;
  originalName: string;
  mime: string;
  bytes: number;
  kind: string;
  path: string;
  fileSpacePath?: string;
  sha256?: string;
  attachmentContext: string;
};

function storedAttachmentKey(attachment: StoredAttachment): string {
  return attachment.path || attachment.fileSpacePath || attachment.sha256 || `${attachment.originalName}:${attachment.bytes}`;
}

function appendStoredAttachments(current: StoredAttachment[], next: StoredAttachment[]): StoredAttachment[] {
  const seen = new Set(current.map(storedAttachmentKey));
  const merged = [...current];
  for (const attachment of next) {
    const key = storedAttachmentKey(attachment);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(attachment);
  }
  return merged.slice(0, MAX_CHAT_ATTACHMENTS);
}

type PearlFileUploadedEvent = CustomEvent<{
  path?: string;
  filename?: string;
  originalName?: string;
  contentType?: string;
  mime?: string;
  size?: number;
  bytes?: number;
  kind?: string;
  fileSpacePath?: string;
  sha256?: string;
  pearlFileContext?: string;
  attachmentContext?: string;
}>;

type CompactAssistantPreview = {
  id: string;
  content: string;
};

// Hoisted out of the component body so the same reference flows to every
// child on every keystroke; previously this object was reallocated each
// render and forced React to treat it as a changed prop. Visual chrome
// (glass tint, rounded corners) lives in CHAT_BAR_GLASS_CLASS so it stays
// in lockstep with AgencyChatBox.
const CHAT_BAR_CONTAINER_STYLE = {
  minHeight: 0,
  padding: '4px 6px 4px 4px',
  overflow: 'visible' as const,
} as const;

// Glass-morphism class set mirrored from AgencyChatBox so the chat bar
// visually matches the agency-chat tile in the ActiveJobs widget.
const CHAT_BAR_GLASS_CLASS =
  'rounded-xl backdrop-blur-md shadow-lg shadow-black/30 bg-sky-500/15 border border-sky-400/30';

function taskToastKeyFor(message: string, explicitKey?: string): string {
  const base = (explicitKey || message)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 220);
  return base || 'task-toast';
}

function shouldSuppressTaskToast(key: string): boolean {
  if (dismissedTaskToastKeys.has(key)) return true;
  const lastShown = recentTaskToastKeys.get(key);
  return typeof lastShown === 'number' && Date.now() - lastShown < TASK_TOAST_DEDUPE_MS;
}

function taskToastDuration(durationMs?: number): number {
  const requested = typeof durationMs === 'number' && Number.isFinite(durationMs)
    ? durationMs
    : TASK_TOAST_DEFAULT_DURATION_MS;
  return Math.min(Math.max(requested, TASK_TOAST_MIN_DURATION_MS), TASK_TOAST_MAX_DURATION_MS);
}

function readDismissedCompactPreviewIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMPACT_PREVIEW_DISMISS_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((item) => String(item || '').trim()).filter(Boolean).slice(-COMPACT_PREVIEW_DISMISS_MAX));
  } catch {
    return new Set();
  }
}

function writeDismissedCompactPreviewIds(ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      COMPACT_PREVIEW_DISMISS_STORAGE_KEY,
      JSON.stringify(Array.from(ids).slice(-COMPACT_PREVIEW_DISMISS_MAX)),
    );
  } catch {
    // localStorage can be unavailable in private or constrained webviews.
  }
}

// Mirrors `aj-scroll` from ActiveJobsWidget so the textarea's hidden-scrollbar
// styling is available even when ChatMode renders without that widget mounted.
const CHATMODE_SCROLLBAR_CSS = `
.aj-scroll{scrollbar-width:none;-ms-overflow-style:none;scrollbar-gutter:stable;}
.aj-scroll::-webkit-scrollbar{width:0;height:0;background:transparent;}
.aj-scroll::-webkit-scrollbar-thumb{background:transparent;}
`;

const ensureChatModeScrollbarCss = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('chatmode-scrollbar-css')) return;
  if (document.getElementById('active-jobs-scrollbar-css')) return;
  const style = document.createElement('style');
  style.id = 'chatmode-scrollbar-css';
  style.textContent = CHATMODE_SCROLLBAR_CSS;
  document.head.appendChild(style);
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('image read failed'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

async function createVisionImageDataUrl(file: File): Promise<string> {
  const original = await readFileAsDataUrl(file);

  try {
    const img = await loadImage(original);
    const sourceWidth = img.naturalWidth || img.width;
    const sourceHeight = img.naturalHeight || img.height;
    if (!sourceWidth || !sourceHeight) return original;

    const scale = Math.min(1, VISION_IMAGE_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', VISION_IMAGE_QUALITY);
  } catch {
    if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(original)) {
      return original;
    }
    throw new Error('unsupported image format');
  }
}

const ChatMode: React.FC = () => {
  const inSplit = useIsInSplitLayout();
  const pos = inSplit ? 'absolute' : 'fixed';
  const { isChatMode, setIsChatMode, isBrowserWindowVisible, wonderChromeMode } = useUI();
  const { state: windowManagerState } = useWindowManager();
  const { currentMode } = useDesktopMode();
  const isHomeOrDesktopMode = currentMode === DesktopMode.HOME || currentMode === DesktopMode.DESKTOP;
  const hasManagedContentWindow = windowManagerState.windows.length > 0 && windowManagerState.layout !== 'chat-only';
  const { callStatus, isAssistantSpeaking, toggleCall } = useVoiceSessionContext();
  const { data: session } = useResilientSession();
  const userProfile = useUserProfileOptional();
  const isVoiceActive = callStatus === 'active' || callStatus === 'loading';
  const {
    messages,
    isTyping,
    historyLoaded,
    isLoadingMore,
    hasMore,
    loadMore,
    sendMessage,
    clearMessages,
    appendExternalMessages,
    toggleReaction,
  } = useChatSession();
  const { unread: inboxUnread, consume: consumeInbox, markRead: markInboxRead } = useChatInbox();
  // Uncontrolled textarea: the value lives in the DOM, not React state.
  // We only track a boolean (`hasInputText`) to drive the send-button
  // disabled state, which flips at most twice per typed message (empty
  // → non-empty on first keystroke, non-empty → empty on send/clear).
  // Previously this was `[input, setInput] = useState('')`, which made
  // every keystroke rerun ChatMode's full ~1200-line render path and
  // forced React to re-create the entire message list as the transcript
  // grew — typing latency that scaled linearly with conversation length.
  // See SPECTRUM bug #2/#3.
  const [hasInputText, setHasInputText] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isChatAvatarTalking, setIsChatAvatarTalking] = useState(false);
  /** Set when the user asks Pearl about a task from the ActiveJobs widget.
   *  Drives the light-blue placeholder hint on the chat input until Pearl's
   *  reply arrives, so a user who closed the widget still sees an answer is
   *  on the way. */
  const [pendingTaskQuestion, setPendingTaskQuestion] = useState<{ taskId: string; taskTitle: string } | null>(null);
  /** Ephemeral light-blue overlay covering the input bar — fires for task
   *  add / ask events. Lives outside the chat transcript so the message is
   *  not persisted to history. */
  const [taskToast, setTaskToast] = useState<{ id: number; key: string; message: string } | null>(null);
  const [compactAssistantPreview, setCompactAssistantPreview] = useState<CompactAssistantPreview | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [onboardingStatus, setOnboardingStatus] = useState<WebchatOnboardingStatus>('idle');
  const taskToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compactAssistantPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedCompactPreviewIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    dismissedCompactPreviewIdsRef.current = readDismissedCompactPreviewIds();
  }, []);
  const rememberDismissedCompactPreviewId = useCallback((id?: string) => {
    const cleanId = String(id || '').trim();
    if (!cleanId) return;
    dismissedCompactPreviewIdsRef.current.add(cleanId);
    writeDismissedCompactPreviewIds(dismissedCompactPreviewIdsRef.current);
  }, []);
  const showTaskToast = useCallback((message: string, durationMs = TASK_TOAST_DEFAULT_DURATION_MS, explicitKey?: string) => {
    const key = taskToastKeyFor(message, explicitKey);
    if (shouldSuppressTaskToast(key)) return;
    if (taskToastTimerRef.current) clearTimeout(taskToastTimerRef.current);
    recentTaskToastKeys.set(key, Date.now());
    setTaskToast({ id: Date.now(), key, message });
    taskToastTimerRef.current = setTimeout(() => setTaskToast(null), taskToastDuration(durationMs));
  }, []);
  const dismissTaskToast = useCallback(() => {
    if (taskToastTimerRef.current) {
      clearTimeout(taskToastTimerRef.current);
      taskToastTimerRef.current = null;
    }
    setTaskToast((current) => {
      if (current?.key) dismissedTaskToastKeys.add(current.key);
      return null;
    });
  }, []);
  const clearCompactAssistantPreviewTimer = useCallback(() => {
    if (compactAssistantPreviewTimerRef.current) {
      clearTimeout(compactAssistantPreviewTimerRef.current);
      compactAssistantPreviewTimerRef.current = null;
    }
  }, []);
  const dismissCompactAssistantPreview = useCallback((id?: string) => {
    clearCompactAssistantPreviewTimer();
    setCompactAssistantPreview((current) => {
      const targetId = id || current?.id;
      rememberDismissedCompactPreviewId(targetId);
      return null;
    });
  }, [clearCompactAssistantPreviewTimer, rememberDismissedCompactPreviewId]);
  useEffect(() => () => {
    if (taskToastTimerRef.current) clearTimeout(taskToastTimerRef.current);
    if (compactAssistantPreviewTimerRef.current) clearTimeout(compactAssistantPreviewTimerRef.current);
  }, []);

  // Start collapsed; global typing on the empty page or tapping the bubble opens it.
  const [isChatBarOpen, setIsChatBarOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  /** Attached image for sending with the next message (base64 data URL) */
  const [attachedImage, setAttachedImage] = useState<{ dataUrl: string; filename: string } | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<StoredAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCountRef = useRef(0);
  const uploadGenerationRef = useRef(0);
  const pendingComposerTextRef = useRef('');
  /** Track whether the user is near the bottom so we only auto-scroll when appropriate */
  const isNearBottomRef = useRef(true);
  /** Used to preserve scroll position when prepending older messages */
  const prevScrollHeightRef = useRef(0);
  /** Tracks whether the user explicitly dismissed the chat. Reset only by explicit user action. */
  const userDismissedRef = useRef(false);
  /** Previous message count — used to detect genuinely new messages vs existing ones */
  const prevMessageCountRef = useRef(messages.length);
  /** Tracks whether the initial history load has been consumed by the auto-expand effect.
   *  Prevents the first history load from being treated as "new messages". */
  const initialLoadCompleteRef = useRef(false);
  const latestMessage = messages[messages.length - 1];
  const isPearlResponding = isTyping || (latestMessage?.role === 'assistant' && latestMessage?.isStreaming === true) || isAssistantSpeaking;
  const hasEmptyStreamingAssistantBubble = Boolean(
    latestMessage?.role === 'assistant' &&
    latestMessage?.isStreaming &&
    !latestMessage?.content?.trim()
  );
  const userKey = session?.user?.id || session?.user?.email || null;
  const isOnboardingPromptActive =
    !!userKey &&
    !userProfile?.loading &&
    !userProfile?.onboardingComplete &&
    onboardingStatus !== 'done';

  const resizeInput = useCallback((el?: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = '0px';
    const nextHeight = Math.min(Math.max(el.scrollHeight, 32), 128);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > nextHeight ? 'auto' : 'hidden';
  }, []);

  const appendComposerText = useCallback((text: string) => {
    if (!text) return false;
    const el = inputRef.current;
    if (!el) {
      pendingComposerTextRef.current += text;
      return false;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.setRangeText(text, start, end, 'end');
    resizeInput(el);
    setHasInputText(el.value.length > 0);
    return true;
  }, [resizeInput]);

  const flushPendingComposerText = useCallback(() => {
    const pending = pendingComposerTextRef.current;
    if (!pending) return;
    pendingComposerTextRef.current = '';
    if (!appendComposerText(pending)) {
      pendingComposerTextRef.current = pending + pendingComposerTextRef.current;
    }
  }, [appendComposerText]);

  const focusAndFlushComposerSoon = useCallback((delayMs = 0) => {
    window.setTimeout(() => {
      inputRef.current?.focus();
      flushPendingComposerText();
    }, delayMs);
  }, [flushPendingComposerText]);

  const drainInboxIntoChat = useCallback(() => {
    const drained = consumeInbox();
    if (drained.length === 0) return;
    appendExternalMessages(drained.map((m) => ({
      id: m.id,
      content: m.content,
      timestamp: m.ts,
    })));
    void markInboxRead(drained.map((m) => m.id));
  }, [appendExternalMessages, consumeInbox, markInboxRead]);

  // Stable message-list JSX. Re-allocating .map() on every parent render
  // is wasted work because ChatBubble is memoized — but the iteration and
  // ReactElement allocation still scale with conversation length. Keying
  // this on `messages` keeps the list identity stable across re-renders
  // that don't change the transcript (e.g. send-button enable/disable).
  const messageBubbles = useMemo(
    () => messages.map((msg) => <ChatBubble key={msg.id} message={msg} onReaction={toggleReaction} />),
    [messages, toggleReaction],
  );

  // Keep chat-bar avatar speech animation stable.
  // During loading we force non-talking state, and when active we debounce stop.
  useEffect(() => {
    if (callStatus !== 'active') {
      setIsChatAvatarTalking(false);
      return;
    }
    if (isAssistantSpeaking) {
      setIsChatAvatarTalking(true);
      return;
    }
    const t = window.setTimeout(() => {
      setIsChatAvatarTalking(false);
    }, 450);
    return () => window.clearTimeout(t);
  }, [callStatus, isAssistantSpeaking]);

  useEffect(() => {
    ensureChatModeScrollbarCss();
    log.info('ChatMode mounted', {
      source: 'chat_mode',
      chatModeTraceVersion: CHATMODE_TRACE_VERSION,
    });
    if (typeof window !== 'undefined') {
      console.info('[CHATMODE_TRACE_VERSION]', CHATMODE_TRACE_VERSION);
    }
  }, []);

  useEffect(() => {
    setOnboardingStatus(readOnboardingStatus(userKey));
  }, [userKey]);

  useEffect(() => {
    const handleForceStart = () => {
      log.warn('assistant:force-start observed in ChatMode context', {
        source: 'chat_mode',
        isVoiceActive,
        callStatus,
      });
      console.warn('[CHATMODE_EVENT_TRACE] assistant:force-start', {
        isVoiceActive,
        callStatus,
      });
    };
    window.addEventListener('assistant:force-start', handleForceStart);
    return () => {
      window.removeEventListener('assistant:force-start', handleForceStart);
    };
  }, [isVoiceActive, callStatus]);

  const markUserReopenedChat = useCallback(() => {
    userDismissedRef.current = false;
    clearCompactAssistantPreviewTimer();
    setCompactAssistantPreview(null);
  }, [clearCompactAssistantPreviewTimer]);

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const detail = (event as CustomEvent<WebchatOnboardingStatusDetail>).detail;
      if (detail?.status) setOnboardingStatus(detail.status);
    };
    const handleOnboardingMessage = (event: Event) => {
      const detail = (event as CustomEvent<WebchatOnboardingChatMessageDetail>).detail;
      const message = detail?.message?.trim();
      if (!message) return;
      markUserReopenedChat();
      setIsChatMode(true);
      setIsChatBarOpen(true);
      appendExternalMessages([{ content: message, timestamp: Date.now() }]);
    };

    window.addEventListener(PEARL_ONBOARDING_STATUS_EVENT, handleStatus);
    window.addEventListener(PEARL_ONBOARDING_CHAT_MESSAGE_EVENT, handleOnboardingMessage);
    return () => {
      window.removeEventListener(PEARL_ONBOARDING_STATUS_EVENT, handleStatus);
      window.removeEventListener(PEARL_ONBOARDING_CHAT_MESSAGE_EVENT, handleOnboardingMessage);
    };
  }, [appendExternalMessages, markUserReopenedChat, setIsChatMode]);

  // ─── Auto-scroll on new messages (only if user is near the bottom) ───
  useEffect(() => {
    if (scrollRef.current && isNearBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // ─── Drain the inbox (Pearl-pushed messages, e.g. task-question replies)
  // into the chat view. We only drain once the user opens the full chat so a
  // compact Pearl preview can stay unread and keep its notification badge.
  useEffect(() => {
    if (!historyLoaded) return;
    if (inboxUnread.length === 0) return;
    if (!isExpanded) return;
    drainInboxIntoChat();
  }, [inboxUnread, historyLoaded, isExpanded, drainInboxIntoChat]);

  useEffect(() => {
    if (!historyLoaded) return;
    if (isExpanded) {
      clearCompactAssistantPreviewTimer();
      setCompactAssistantPreview(null);
      return;
    }
    const previewMessage = inboxUnread.find((message) => {
      const preview = message.content?.trim();
      return Boolean(preview) && !dismissedCompactPreviewIdsRef.current.has(message.id);
    });
    const preview = previewMessage?.content?.trim();
    if (!previewMessage || !preview) {
      clearCompactAssistantPreviewTimer();
      setCompactAssistantPreview(null);
      return;
    }
    if (compactAssistantPreview?.id === previewMessage.id && compactAssistantPreview.content === preview) return;
    clearCompactAssistantPreviewTimer();
    setCompactAssistantPreview({ id: previewMessage.id, content: preview });
    setIsChatBarOpen(true);
    compactAssistantPreviewTimerRef.current = setTimeout(() => {
      rememberDismissedCompactPreviewId(previewMessage.id);
      setCompactAssistantPreview((current) => (
        current?.id === previewMessage.id ? null : current
      ));
      compactAssistantPreviewTimerRef.current = null;
    }, COMPACT_PREVIEW_AUTO_DISMISS_MS);
  }, [clearCompactAssistantPreviewTimer, compactAssistantPreview, historyLoaded, inboxUnread, isExpanded, rememberDismissedCompactPreviewId]);

  useEffect(() => {
    const handleGlobalFileUpload = (event: Event) => {
      const detail = (event as PearlFileUploadedEvent).detail || {};
      const filename = detail.originalName || detail.filename || 'uploaded file';
      const attachmentContext = detail.attachmentContext || detail.pearlFileContext;
      if (!attachmentContext) return;
      const attachment: StoredAttachment = {
        id: detail.filename || detail.path,
        filename,
        originalName: filename,
        mime: detail.mime || detail.contentType || 'application/octet-stream',
        bytes: Number(detail.bytes || detail.size || 0),
        kind: detail.kind || kindFromAttachmentContext(attachmentContext) || 'file',
        path: detail.path || '',
        fileSpacePath: detail.fileSpacePath,
        sha256: detail.sha256,
        attachmentContext,
      };
      setAttachedFiles((current) => appendStoredAttachments(current, [attachment]));
      markUserReopenedChat();
      setIsChatMode(true);
      setIsChatBarOpen(true);
      setUploadStatus(`Attached ${filename}`);
      focusAndFlushComposerSoon(80);
      setTimeout(() => setUploadStatus(null), 3000);
    };

    window.addEventListener('pearl:file-uploaded', handleGlobalFileUpload);
    return () => window.removeEventListener('pearl:file-uploaded', handleGlobalFileUpload);
  }, [focusAndFlushComposerSoon, markUserReopenedChat, setIsChatMode]);

  useEffect(() => {
    if (!isChatBarOpen) return;
    if (!pendingComposerTextRef.current) return;
    focusAndFlushComposerSoon(0);
  }, [isChatBarOpen, isExpanded, focusAndFlushComposerSoon]);

  // Auto-open chat bar AND focus input when user starts typing anywhere on the page
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const shouldAutoPopulateChat =
        isHomeOrDesktopMode &&
        !isBrowserWindowVisible &&
        !hasManagedContentWindow;
      if (!shouldAutoPopulateChat) return;
      if (
        e.ctrlKey || e.metaKey || e.altKey ||
        e.key.startsWith('Arrow') ||
        (e.key.startsWith('F') && e.key.length > 1) ||
        ['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape', 'CapsLock',
         'Enter', 'Delete', 'Backspace', 'Home', 'End', 'PageUp', 'PageDown',
         'Insert', 'PrintScreen', 'ScrollLock', 'Pause', 'NumLock'].includes(e.key)
      ) return;
      // Skip if already focused on another input/textarea
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (document.activeElement as HTMLElement)?.isContentEditable) return;

      const typedText = e.key.length === 1 ? e.key : '';
      if (typedText) {
        e.preventDefault();
        pendingComposerTextRef.current += typedText;
      }

      // If chat mode/bar isn't active, open it — the input will mount, receive
      // the triggering character, and auto-focus.
      // HOME still uses the same text composer, so global typing there should wake
      // the chat path instead of dropping the first keystroke on the stage.
      if (!isChatMode) {
        markUserReopenedChat();
        setIsChatMode(true);
        setIsChatBarOpen(true);
        setIsExpanded(true);
        focusAndFlushComposerSoon(0);
        return;
      }
      if (!isChatBarOpen) {
        markUserReopenedChat();
        setIsChatBarOpen(true);
        setIsExpanded(true);
        focusAndFlushComposerSoon(0);
        return;
      }
      // Chat bar is already open — just focus the input
      const el = inputRef.current;
      if (el && document.activeElement !== el) el.focus();
      if (typedText) {
        if (!isExpanded) setIsExpanded(true);
        flushPendingComposerText();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    isChatMode,
    isHomeOrDesktopMode,
    isBrowserWindowVisible,
    hasManagedContentWindow,
    isChatBarOpen,
    setIsChatMode,
    markUserReopenedChat,
    focusAndFlushComposerSoon,
    flushPendingComposerText,
    isExpanded,
  ]);

  // ─── Preserve scroll position after prepending older messages ───
  useEffect(() => {
    if (scrollRef.current && prevScrollHeightRef.current > 0) {
      const added = scrollRef.current.scrollHeight - prevScrollHeightRef.current;
      if (added > 0) {
        scrollRef.current.scrollTop += added;
      }
      prevScrollHeightRef.current = 0;
    }
  }, [messages.length]);

  // ─── Scroll to bottom when entering expanded mode ───
  useEffect(() => {
    if (isExpanded && scrollRef.current) {
      // Small delay to let the DOM paint the expanded panel
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [isExpanded]);

  // ─── Infinite scroll-up to load older messages ───
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Track whether user is near the bottom for auto-scroll logic
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 60;

    // If scrolled near the top, load more
    if (el.scrollTop < 80 && hasMore && !isLoadingMore) {
      prevScrollHeightRef.current = el.scrollHeight;
      loadMore();
    }
  }, [hasMore, isLoadingMore, loadMore]);

  // Reset expanded state when leaving chat mode. We keep `isChatBarOpen`
  // sticky on `true` regardless of desktop mode so the input bar stays
  // functional on DESKTOP (previously it collapsed to a Pearl-only
  // bar with no textarea outside HOME/DESKTOP).
  useEffect(() => {
    if (!isChatMode) {
      setIsExpanded(false);
    }
  }, [isChatMode]);

  // Listen for Pearl tap to minimize
  useEffect(() => {
    const handleMinimize = () => {
      setIsExpanded(false);
      setIsChatBarOpen(false);
    };
    window.addEventListener('pearl:chat-minimize', handleMinimize);
    return () => window.removeEventListener('pearl:chat-minimize', handleMinimize);
  }, []);

  // Pearl questions submitted from the ActiveJobs widget arrive here as a
  // window event. We open the chat, post the user's question with the task
  // as a quoted-context block, and remember the task so the input
  // placeholder can hint that a reply is on the way.
  useEffect(() => {
    const handleAskFromTask = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        taskId?: string;
        taskTitle?: string;
        taskDescription?: string;
        question?: string;
      } | undefined;
      const question = detail?.question?.trim();
      if (!question) return;
      const taskTitle = (detail?.taskTitle || 'this task').trim();
      const desc = (detail?.taskDescription || '').trim();
      const shortDesc = desc.length > 200 ? desc.slice(0, 197) + '…' : desc;
      const contextLines = [
        `> **Re: ${taskTitle}**`,
        shortDesc ? `> ${shortDesc.replace(/\n/g, '\n> ')}` : null,
      ].filter(Boolean).join('\n');
      const message = `${contextLines}\n\n${question}`;

      userDismissedRef.current = false;
      setIsChatMode(true);
      setIsChatBarOpen(true);
      setIsExpanded(true);
      setPendingTaskQuestion({ taskId: detail?.taskId || '', taskTitle });
      showTaskToast(`Pearl is looking into "${taskTitle}"…`);
      void sendMessage(message);
    };
    window.addEventListener('pearl:ask-from-task', handleAskFromTask);
    return () => window.removeEventListener('pearl:ask-from-task', handleAskFromTask);
  }, [sendMessage, setIsChatMode, showTaskToast]);

  // "+ New" in the ActiveJobs widget dispatches this event. Open the chat
  // composer in expanded mode so the user can dictate a new task; we don't
  // pre-fill any text — the chat is the canonical task entry point.
  // Focus the textarea on the next frame so the click feels responsive even
  // when chat mode was already open (without the focus, repeat clicks looked
  // like a dead button).
  useEffect(() => {
    const handleNewTask = () => {
      userDismissedRef.current = false;
      setIsChatMode(true);
      setIsChatBarOpen(true);
      setIsExpanded(true);
      showTaskToast('Tell Pearl what to do — your new task starts here.');
      setTimeout(() => inputRef.current?.focus(), 80);
    };
    window.addEventListener('pearl:new-task', handleNewTask);
    return () => window.removeEventListener('pearl:new-task', handleNewTask);
  }, [setIsChatMode, showTaskToast]);

  // Generic task-toast event — fired by the task pipeline whenever a new task
  // record is created or Pearl wants to surface a non-chat status flash.
  // Detail: { message: string, durationMs?: number, key?: string }
  useEffect(() => {
    const handleToast = (e: Event) => {
      const detail = (e as CustomEvent).detail as { message?: string; durationMs?: number; key?: string } | undefined;
      const msg = detail?.message?.trim();
      if (!msg) return;
      showTaskToast(msg, detail?.durationMs, detail?.key);
    };
    window.addEventListener('pearl:task-toast', handleToast);
    return () => window.removeEventListener('pearl:task-toast', handleToast);
  }, [showTaskToast]);

  // Clear the task-question placeholder once Pearl's reply has finished
  // streaming. We only clear when the most recent message is a non-empty,
  // non-streaming assistant message — that way the hint stays visible
  // while the answer is still being typed out.
  useEffect(() => {
    if (!pendingTaskQuestion) return;
    const latest = messages[messages.length - 1];
    if (
      latest?.role === 'assistant' &&
      !latest.isStreaming &&
      typeof latest.content === 'string' &&
      latest.content.trim().length > 0
    ) {
      setPendingTaskQuestion(null);
    }
  }, [messages, pendingTaskQuestion]);

  // Outside the split layout, collapse expanded chat when a full-screen canvas
  // scene fires. In PearlOS split chat, keep the chat pane open so Pearl's text
  // can complement the visual instead of disappearing.
  useEffect(() => {
    const handleWonderScene = () => {
      if (!inSplit && isExpanded) {
        setIsExpanded(false);
      }
    };
    window.addEventListener('nia:wonder.scene', handleWonderScene);
    return () => window.removeEventListener('nia:wonder.scene', handleWonderScene);
  }, [inSplit, isExpanded]);

  // Auto-expand only when genuinely NEW messages arrive (not initial history load).
  // On page load / hard refresh, history loads and the message count jumps from 0 → N.
  // We must NOT treat that as "new messages" — only expand when messages arrive AFTER
  // the initial history has settled.
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    // Wait for the initial history load to complete before considering any auto-expand.
    // Once historyLoaded is true and we've seen the first batch, mark initial load as done.
    if (!initialLoadCompleteRef.current) {
      if (historyLoaded) {
        // First time historyLoaded flips true — absorb the current count as "baseline"
        initialLoadCompleteRef.current = true;
      }
      // Either way, don't auto-expand during initial load
      return;
    }

    // Only surface the compact composer when Pearl sends a new message while
    // the webchat is closed. User messages or local history/cache changes
    // should not promote the collapsed launcher into the extended bar.
    if (messages.length > prevCount && messages.length > 0 && (isChatMode || isHomeOrDesktopMode)) {
      const latest = messages[messages.length - 1];
      if (latest?.role === 'assistant' && !isChatBarOpen && !isExpanded) {
        const preview = typeof latest.content === 'string' ? latest.content.trim() : '';
        if (!preview) return;
        const previewId = latest.id || `message:${latest.timestamp}`;
        if (dismissedCompactPreviewIdsRef.current.has(previewId)) return;
        clearCompactAssistantPreviewTimer();
        setCompactAssistantPreview({ id: previewId, content: preview });
        setIsChatBarOpen(true);
        compactAssistantPreviewTimerRef.current = setTimeout(() => {
          rememberDismissedCompactPreviewId(previewId);
          setCompactAssistantPreview((current) => (
            current?.id === previewId ? null : current
          ));
          compactAssistantPreviewTimerRef.current = null;
        }, COMPACT_PREVIEW_AUTO_DISMISS_MS);
      }
    }
  }, [clearCompactAssistantPreviewTimer, messages, messages.length, historyLoaded, isChatMode, isHomeOrDesktopMode, isChatBarOpen, isExpanded, rememberDismissedCompactPreviewId]);

  // ─── File upload handler ───
  const handleFileUpload = useCallback(async (file: File, uploadGeneration?: number) => {
    const generation = uploadGeneration ?? (uploadGenerationRef.current += 1);
    setUploadStatus(`Uploading ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(UPLOAD_URL, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const data = await res.json();
      if (generation !== uploadGenerationRef.current) return null;
      setAttachedFiles((current) => appendStoredAttachments(current, [data as StoredAttachment]));
      setUploadStatus(`Attached ${file.name}`);
      setTimeout(() => setUploadStatus(null), 2500);
      return data as StoredAttachment;
    } catch (err: any) {
      if (generation === uploadGenerationRef.current) {
        setUploadStatus(`Failed to upload ${file.name}`);
        setTimeout(() => setUploadStatus(null), 3000);
      }
      return null;
    }
  }, []);

  const prepareImageAttachment = useCallback(async (file: File, filename: string) => {
    setIsPreparingImage(true);
    setUploadStatus(`Preparing ${filename}...`);
    try {
      const dataUrl = await createVisionImageDataUrl(file);
      setAttachedImage({ dataUrl, filename });
      setUploadStatus(`Attached ${filename}`);
    } catch {
      setUploadStatus(`Failed to prepare ${filename}`);
    } finally {
      setIsPreparingImage(false);
      setTimeout(() => setUploadStatus(null), 2500);
    }
  }, []);

  const handleFilesUpload = useCallback((files: File[]) => {
    const pending = files.filter(Boolean);
    if (!pending.length) return;
    const remaining = MAX_CHAT_ATTACHMENTS - attachedFiles.length;
    if (remaining <= 0) {
      setUploadStatus(`You can attach up to ${MAX_CHAT_ATTACHMENTS} files at once`);
      setTimeout(() => setUploadStatus(null), 3000);
      return;
    }
    const selected = pending.slice(0, remaining);
    if (pending.length > selected.length) {
      setUploadStatus(`Attaching first ${selected.length} files; limit is ${MAX_CHAT_ATTACHMENTS}`);
    }
    const uploadGeneration = uploadGenerationRef.current + 1;
    uploadGenerationRef.current = uploadGeneration;
    const firstImage = selected.find(isImageLikeFile);
    if (firstImage) void prepareImageAttachment(firstImage, firstImage.name);
    void Promise.all(selected.map((file) => handleFileUpload(file, uploadGeneration))).then((results) => {
      if (uploadGeneration !== uploadGenerationRef.current) return;
      const attachedCount = results.filter(Boolean).length;
      if (attachedCount > 1) {
        setUploadStatus(`Attached ${attachedCount} files`);
        setTimeout(() => setUploadStatus(null), 2500);
      }
    });
  }, [attachedFiles.length, handleFileUpload, prepareImageAttachment]);

  // ─── Paste handler ───
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(isClipboardImageItem);
    if (imageItem) {
      e.preventDefault();
      const blob = imageItem.getAsFile();
      if (blob) {
        const ext = imageExtensionForFile(blob);
        const filename = `paste-${Date.now()}.${ext}`;
        const file = new File([blob], filename, { type: imageItem.type });
        const uploadGeneration = uploadGenerationRef.current + 1;
        uploadGenerationRef.current = uploadGeneration;
        void prepareImageAttachment(file, filename);
        void handleFileUpload(file, uploadGeneration);
      }
      return;
    }
  }, [handleFileUpload, prepareImageAttachment]);

  // ─── Drag-and-drop handlers ───
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current++;
    if (dragCountRef.current === 1) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = 0;
    setIsDragOver(false);
    handleFilesUpload(Array.from(e.dataTransfer.files || []));
  }, [handleFilesUpload]);

  // ─── File input (paperclip) handler ───
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFilesUpload(Array.from(e.target.files || []));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleFilesUpload]);

  const handleSend = () => {
    const currentText = inputRef.current?.value ?? '';
    if (isPreparingImage || (!currentText.trim() && !attachedImage && attachedFiles.length === 0)) return;
    userDismissedRef.current = false;
    if (isOnboardingPromptActive && onboardingStatus === 'idle') {
      window.dispatchEvent(
        new CustomEvent<WebchatOnboardingFirstReplyDetail>(PEARL_ONBOARDING_FIRST_REPLY_EVENT, {
          detail: { source: 'text' },
        }),
      );
    }
    sendMessage(
      currentText,
      attachedImage?.dataUrl,
      attachedFiles.map((file, index) => (
        attachedFiles.length > 1
          ? `[Attachment ${index + 1} of ${attachedFiles.length}]\n${file.attachmentContext}`
          : file.attachmentContext
      )).join('\n\n'),
      attachedFiles.map((file) => ({
        filename: file.filename,
        originalName: file.originalName,
        mime: file.mime,
        bytes: file.bytes,
        kind: file.kind,
        path: file.path,
      })),
    );
    // Clear the uncontrolled textarea directly — React state isn't the
    // source of truth for the input value anymore.
    if (inputRef.current) {
      inputRef.current.value = '';
      resizeInput(inputRef.current);
    }
    setHasInputText(false);
    setAttachedImage(null);
    setAttachedFiles([]);
    uploadGenerationRef.current += 1;
    setUploadStatus(null);
    setCompactAssistantPreview(null);
    setIsChatBarOpen(true);
    // Keep the conversation view expanded so the streaming reply stays visible.
    // Previously we collapsed back to the minimized bar here, which looked
    // like a full-page flash/reload on send.
    isNearBottomRef.current = true;
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleRemoveImage = () => {
    uploadGenerationRef.current += 1;
    setAttachedImage(null);
    setUploadStatus(null);
  };

  const handleRemoveFile = useCallback((target: StoredAttachment) => {
    const targetKey = storedAttachmentKey(target);
    setAttachedFiles((current) => current.filter((attachment) => storedAttachmentKey(attachment) !== targetKey));
    setUploadStatus(null);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Non-destructive close: hide the overlay but keep the transcript,
  // localStorage cache, and historyLoaded state intact. The X button is a
  // "minimize-to-bar" affordance; only the Archive button (header-left) is
  // allowed to wipe history. Previously this called clearMessages(), which
  // erased the per-user localStorage cache and forced a re-fetch — a fresh
  // server file (or a missing one) then made it look like Pearl had thrown
  // away the conversation.
  const handleClose = () => {
    userDismissedRef.current = true;
    setCompactAssistantPreview(null);
    setIsChatMode(false);
    setIsExpanded(false);
    setIsChatBarOpen(false);
  };

  const handleMinimize = () => {
    setCompactAssistantPreview(null);
    setIsExpanded(false);
  };

  // Archive the current conversation and reset to a fresh empty session.
  // Saves the transcript twice — locally (always succeeds) and best-effort to
  // the notes backend — so a network/auth failure can never lose history.
  const handleArchive = useCallback(async () => {
    if (messages.length === 0 || isArchiving) return;
    const archivedAt = Date.now();
    const archiveId = `chat-${archivedAt}`;
    const dateStr = new Date(archivedAt).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
    const title = `Chat archive — ${dateStr}`;
    const archiveMarker = `<!-- pearl:pre-existing-chat archive-id:${archiveId} -->`;
    const transcript = messages
      .map((m) => {
        const speaker = m.role === 'user' ? 'You' : 'Pearl';
        const content = m.content as unknown;
        const body = typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).filter(Boolean).join(' ')
            : '';
        return `**${speaker}**\n${body}`;
      })
      .join('\n\n');
    const noteContent = `${archiveMarker}\n\n${transcript}`;

    setIsArchiving(true);
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem('pearl-chat-archives-v1');
        const list = raw ? JSON.parse(raw) : [];
        const tail = Array.isArray(list) ? list : [];
        tail.push({ id: archiveId, title, transcript, archivedAt, messageCount: messages.length });
        // Keep the last 50 archives so localStorage doesn't grow unbounded.
        const trimmed = tail.slice(-50);
        window.localStorage.setItem('pearl-chat-archives-v1', JSON.stringify(trimmed));
      } catch {
        // Quota or serialization failure — non-critical; the notes backend is the durable copy.
      }
    }

    let notesArchived = false;
    try {
      const notesRes = await fetch('/api/notes?agent=pearlos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content: noteContent, mode: 'personal' }),
      });
      if (!notesRes.ok) {
        throw new Error(`notes archive failed: ${notesRes.status}`);
      }
      notesArchived = true;

      // Rotate the server-side chat log before clearing local state. Clearing
      // first resets historyLoaded and can re-fetch stale messages before the
      // gateway has moved the current log out of the active path.
      const archiveRes = await fetch('/api/chat/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!archiveRes.ok) {
        throw new Error(`archive failed: ${archiveRes.status}`);
      }

      showTaskToast('Chat archived. Starting fresh.');
      clearMessages({ reloadHistory: false });
      userDismissedRef.current = false;
      isNearBottomRef.current = true;
      setTimeout(() => inputRef.current?.focus(), 60);
    } catch {
      showTaskToast(notesArchived
        ? 'Saved to Notes, but fresh chat reset failed. Try again.'
        : 'Saved locally, but Notes archive failed. Try again.');
    } finally {
      setIsArchiving(false);
    }
  }, [messages, isArchiving, clearMessages, showTaskToast]);

  const handleChatBarToggle = () => {
    if (isChatBarOpen) {
      userDismissedRef.current = true;
      setCompactAssistantPreview(null);
      setIsChatBarOpen(false);
      setIsExpanded(false);
    } else {
      markUserReopenedChat();
      setIsChatBarOpen(true);
      focusAndFlushComposerSoon(50);
    }
  };

  // Focus alone must not promote the compact composer into the full-screen
  // transcript — programmatic focus, tab/router-driven focus, and mobile
  // autofocus would otherwise hijack the viewport and the close tap could
  // be swallowed by browser focus handling.
  const handleInputFocus = () => {
    markUserReopenedChat();
  };

  // A deliberate click on the compact composer is the user asking to open
  // the full web chat surface. Restored after f6d5d891 over-corrected and
  // left clicking the bar inert.
  const handleInputClick = () => {
    markUserReopenedChat();
    if (!isExpanded) {
      setTimeout(() => setIsExpanded(true), 50);
    }
  };

  // Handle avatar click - toggle voice call on/off (chat bar Pearl shows both active and inactive state).
  // useCallback so the memo'd PearlAvatar doesn't see a fresh onClick on every keystroke.
  const handleAvatarClick = useCallback(() => {
    // Chat bar Pearl is the primary voice toggle control.
    // Avoid routing through assistant-button window events, which can re-introduce
    // duplicate avatar renderers depending on mode/layout.
    if (toggleCall) {
      log.info('Chat bar Pearl clicked', {
        source: 'chat_bar_avatar',
        isVoiceActive,
        callStatus,
        hasToggleCall: !!toggleCall,
      });
      toggleCall();
    }
  }, [toggleCall, isVoiceActive, callStatus]);

  // Always render the full chat bar — the input bar must be visible and
  // functional in every desktop mode (HOME, DESKTOP, and any future
  // mode). Previously this collapsed to a minimal Pearl-only bar outside
  // HOME, which left users on DESKTOP unable to type to Pearl.
  const showChatBar = true;
  const shouldHideChatChromeForWindow = !inSplit && (isBrowserWindowVisible || hasManagedContentWindow);

  // Open the chat bar (and enter chat mode if we're not showing the bar yet)
  const handleOpenChatBar = useCallback(() => {
    markUserReopenedChat();
    if (!showChatBar) setIsChatMode(true);
    setIsChatBarOpen(true);
    focusAndFlushComposerSoon(50);
  }, [showChatBar, setIsChatMode, markUserReopenedChat, focusAndFlushComposerSoon]);

  // ─── Shared sub-components ───

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept="image/*,audio/*,video/*,.pdf,.txt,.md,.json,.jsonl,.csv,.tsv,.xlsx,.xls,.ods,.doc,.docx,.ppt,.pptx,.zip"
      onChange={handleFileInputChange}
      style={{ display: 'none' }}
    />
  );

  // Paperclip button (used inside input row)
  const paperclipButton = (
    <button
      onClick={() => fileInputRef.current?.click()}
      className="flex items-center justify-center rounded-full hover:bg-white/8 transition-colors text-[#d4c0e8]/45 hover:text-[#d4c0e8]/75 shrink-0"
      style={{ width: 36, height: 36, minWidth: 36 }}
      aria-label="Attach file"
      title="Attach file or photo"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
    </button>
  );

  // Upload status toast
  const uploadToast = uploadStatus && (
    <div
      className={`${pos} left-1/2 -translate-x-1/2 z-[110] px-4 py-2 rounded-full text-[#faf8f5] shadow-lg`}
      style={{
        bottom: isExpanded ? 80 : 64,
        fontSize: 'clamp(12px, 3.2vw, 14px)',
        backgroundColor: 'rgba(20, 12, 40, 0.9)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(123, 63, 142, 0.3)',
      }}
    >
      {uploadStatus}
    </div>
  );

  // Drag overlay
  const dragOverlay = isDragOver && (
    <div
      className={`${pos} inset-0 z-[120] flex items-center justify-center pointer-events-none`}
      style={{
        backgroundColor: 'rgba(10, 6, 20, 0.7)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="w-20 h-20 rounded-2xl bg-[#D94F8E]/20 border-2 border-dashed border-[#D94F8E] flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#D94F8E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <span className="text-[#faf8f5] text-lg font-medium">Drop to attach</span>
        <span className="text-[#d4c0e8]/60 text-sm">Files will be saved and sent with your message</span>
      </div>
    </div>
  );

  // Attachment tray (shows above input when files/images are attached)
  const attachmentPreview = (attachedImage || attachedFiles.length > 0) && (
    <div
      className="absolute bottom-full mb-2 left-1.5 right-1.5 flex flex-col gap-2 px-3 py-2 rounded-xl"
      style={{
        backgroundColor: 'rgba(30, 18, 55, 0.95)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(123, 63, 142, 0.3)',
        maxHeight: 260,
        overflowY: 'auto',
      }}
    >
      {attachedImage && (
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="relative rounded-lg overflow-hidden shrink-0"
            style={{
              width: 44,
              height: 44,
              border: '1px solid rgba(123, 63, 142, 0.2)',
            }}
          >
            <img
              src={attachedImage.dataUrl}
              alt="Attachment preview"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[#faf8f5] truncate" style={{ fontSize: 'clamp(13px, 3.5vw, 14px)' }}>
              {attachedImage.filename}
            </p>
            <p className="text-[#d4c0e8]/50" style={{ fontSize: 'clamp(11px, 3vw, 12px)' }}>
              Ready to send
            </p>
          </div>
          <button
            onClick={handleRemoveImage}
            className="flex items-center justify-center rounded-full hover:bg-white/10 transition-colors shrink-0"
            style={{ width: 28, height: 28, minWidth: 28 }}
            aria-label="Remove image"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d4c0e8" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
      {attachedFiles.map((file) => (
        <div key={storedAttachmentKey(file)} className="flex items-center gap-2 min-w-0">
          <div className="flex items-center justify-center rounded-lg bg-white/10 shrink-0" style={{ width: 40, height: 40 }}>
            <span className="text-[#faf8f5] text-xs font-semibold">{file.kind.toUpperCase().slice(0, 4)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[#faf8f5] truncate" style={{ fontSize: 'clamp(13px, 3.5vw, 14px)' }}>
              {file.originalName}
            </p>
            <p className="text-[#d4c0e8]/50" style={{ fontSize: 'clamp(11px, 3vw, 12px)' }}>
              Saved for Pearl to inspect
            </p>
          </div>
          <button
            onClick={() => handleRemoveFile(file)}
            className="flex items-center justify-center rounded-full hover:bg-white/10 transition-colors shrink-0"
            style={{ width: 28, height: 28, minWidth: 28 }}
            aria-label={`Remove ${file.originalName}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d4c0e8" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );

  // Left side: Pearl avatar + indicator — always visible in all chat bar states (collapsed, minimized, expanded).
  // Memoized so the avatar subtree isn't re-created on every keystroke; combined
  // with React.memo on PearlAvatar this skips the avatar's render entirely when
  // none of its inputs have changed.
  const pearlLeftSide = useMemo(() => (
    <div
      className="shrink-0 rounded-full overflow-hidden bg-transparent transition-opacity"
      style={{
        width: 54,
        height: 54,
        minWidth: 54,
        filter: isVoiceActive
          ? 'drop-shadow(0 0 4px rgba(147, 51, 234, 0.5))'
          : 'drop-shadow(1px 1px 2px black)',
      }}
    >
      <PearlAvatar
        isAwake={isVoiceActive}
        isTalking={isVoiceActive ? isChatAvatarTalking : isPearlResponding}
        freezeIdle={callStatus === 'loading'}
        onClick={handleAvatarClick}
        size={54}
        className="w-full h-full object-cover rounded-full"
        style={{ cursor: 'pointer' }}
      />
    </div>
  ), [isVoiceActive, isChatAvatarTalking, isPearlResponding, callStatus, handleAvatarClick]);

  // Shared bar chrome: hoisted to module scope (CHAT_BAR_CONTAINER_STYLE) so its
  // identity is stable; the inline `as const` object used previously reallocated
  // every render and showed up as a changed prop on the bar container.
  const chatBarContainerStyle = CHAT_BAR_CONTAINER_STYLE;

  // Light-blue ephemeral toast that overlays the input row when set.
  // Uses an absolute layer inside the relative wrapper so it visually
  // covers the bar without unmounting the textarea (state stays intact).
  const taskToastOverlay = taskToast ? (
    <div
      key={taskToast.id}
      aria-live="polite"
      role="button"
      tabIndex={0}
      aria-label="Dismiss task notification"
      onClick={dismissTaskToast}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
          event.preventDefault();
          dismissTaskToast();
        }
      }}
      className="absolute inset-0 flex items-center justify-center px-4 pointer-events-auto cursor-pointer"
      style={{
        zIndex: 5,
        animation: 'pearlTaskToastIn 0.22s ease-out both',
      }}
    >
      <style>{`@keyframes pearlTaskToastIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}`}</style>
      <div
        className="flex items-center gap-2 px-4 py-2 w-full"
        style={{
          background: 'linear-gradient(135deg, rgba(125, 195, 255, 0.96) 0%, rgba(160, 215, 255, 0.96) 100%)',
          color: '#0a2540',
          borderRadius: '22px',
          boxShadow: '0 8px 28px rgba(0, 80, 160, 0.25), 0 0 0 1px rgba(255,255,255,0.4) inset',
          fontSize: '13px',
          lineHeight: '1.35',
          fontWeight: 500,
          minHeight: 36,
        }}
      >
        <img
          src="/images/avatar/Pearlinactivenew.png"
          alt=""
          aria-hidden="true"
          style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0 }}
        />
        <span className="flex-1 truncate">{taskToast.message}</span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            dismissTaskToast();
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/10"
          aria-label="Close task notification"
        >
          <X size={14} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    </div>
  ) : null;

  const compactAssistantPreviewBubble = compactAssistantPreview && !isExpanded ? (
    <div
      onClick={() => {
        markUserReopenedChat();
        drainInboxIntoChat();
        setIsExpanded(true);
        focusAndFlushComposerSoon(50);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          markUserReopenedChat();
          drainInboxIntoChat();
          setIsExpanded(true);
          focusAndFlushComposerSoon(50);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          dismissCompactAssistantPreview(compactAssistantPreview.id);
        }
      }}
      role="button"
      tabIndex={0}
      className="absolute bottom-full left-[68px] right-1.5 mb-2 text-left"
      style={{
        pointerEvents: 'auto',
        cursor: 'pointer',
        background: 'rgba(42, 24, 72, 0.96)',
        border: '1px solid rgba(217, 79, 142, 0.34)',
        borderRadius: 12,
        boxShadow: '0 14px 34px rgba(0,0,0,0.32)',
        color: '#faf8f5',
        padding: '9px 42px 9px 12px',
        minHeight: 38,
      }}
      aria-label="Open Pearl message"
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          dismissCompactAssistantPreview(compactAssistantPreview.id);
        }}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10"
        style={{ color: '#ffe4f1' }}
        aria-label="Close Pearl notification"
      >
        <X size={15} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <span
        style={{
          display: 'block',
          color: '#ffb3d5',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 3,
        }}
      >
        Pearl
      </span>
      <span
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          fontSize: 13,
          lineHeight: 1.35,
        }}
      >
        {compactAssistantPreview.content}
      </span>
    </div>
  ) : null;

  // The input row used in both minimized and expanded states
  const inputRow = (
    <div className="relative">
      {attachmentPreview}
      {compactAssistantPreviewBubble}
      {taskToastOverlay}
    <div className="flex items-end gap-2" style={chatBarContainerStyle}>
      {pearlLeftSide}
      <div
        className={`flex items-end px-2 py-1 focus-within:ring-1 focus-within:ring-sky-400/50 transition-all gap-1 flex-1 min-w-0 ${CHAT_BAR_GLASS_CLASS}`}
        style={{ overflow: 'visible' }}
      >
        <textarea
        ref={inputRef}
        rows={1}
        inputMode="text"
        autoComplete="off"
        autoCapitalize="sentences"
        enterKeyHint="send"
        defaultValue=""
        onChange={(e) => {
          resizeInput(e.currentTarget);
          const next = e.target.value.length > 0;
          if (next !== hasInputText) setHasInputText(next);
          if (next && (!isChatMode || !isChatBarOpen || !isExpanded)) {
            markUserReopenedChat();
            setIsChatMode(true);
            setIsChatBarOpen(true);
            setIsExpanded(true);
          }
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={handleInputFocus}
        onClick={handleInputClick}
        onTouchEnd={(e) => {
          e.stopPropagation();
          (e.target as HTMLTextAreaElement).focus();
        }}
        placeholder={pendingTaskQuestion
          ? `Reply from Pearl about ${pendingTaskQuestion.taskTitle}…`
          : isOnboardingPromptActive
            ? WEBCHAT_ONBOARDING_PLACEHOLDER
            : 'Text me'}
        className={`aj-scroll flex-1 bg-transparent text-[#faf8f5] outline-none px-2 py-1 text-base ${pendingTaskQuestion ? 'placeholder-[#7DC3FF]/85' : 'placeholder-sky-200/50'}`}
        style={{
          fontSize: '16px',
          lineHeight: '1.4',
          minHeight: 32,
          height: 32,
          maxHeight: 128,
          minWidth: 0,
          letterSpacing: '0.01em',
          WebkitAppearance: 'none',
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
          resize: 'none',
          overflowY: 'hidden',
          overflowX: 'hidden',
          border: 'none',
        }}
      />
      {/* Paperclip — left of send button */}
      {paperclipButton}
      <button
        onClick={handleSend}
        disabled={isPreparingImage || (!hasInputText && !attachedImage && attachedFiles.length === 0)}
        className="flex items-center justify-center rounded-full bg-[#D94F8E] hover:bg-[#c9407e] disabled:opacity-25 disabled:hover:bg-[#D94F8E] transition-all text-white shrink-0"
        style={{ width: 20, height: 20, minWidth: 20, transform: 'translateY(-8px)' }}
        aria-label="Send message"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="5 12 12 5 19 12" />
        </svg>
      </button>
      </div>
    </div>
    </div>
  );

  // Minimal bar: Pearl left side + open chat (always shown when chat bar is not "full", including when chat mode is off so the bar never disappears on refresh)
  const minimalBar = (
    <div
      className={`${pos} flex items-center`}
      style={{
        pointerEvents: 'auto',
        left: inSplit ? 0 : CHAT_BAR_LEFT_OFFSET,
        right: inSplit ? 0 : CHAT_BAR_RIGHT_OFFSET,
        bottom: inSplit ? 4 : `calc(env(safe-area-inset-bottom, 0px) + 4px)`,
      }}
    >
      <div className={`flex items-center gap-2 ${CHAT_BAR_GLASS_CLASS}`} style={chatBarContainerStyle}>
        {pearlLeftSide}
        <button
          onClick={handleOpenChatBar}
          className="relative flex items-center justify-center rounded-full hover:bg-white/10 transition-colors shrink-0"
          style={{ width: 44, height: 44, minWidth: 44 }}
          aria-label={inboxUnread.length > 0 ? `Open chat (${inboxUnread.length} new message${inboxUnread.length === 1 ? '' : 's'})` : 'Open chat'}
          title={inboxUnread.length > 0 ? `${inboxUnread.length} new message${inboxUnread.length === 1 ? '' : 's'} from Pearl` : 'Chat with Pearl'}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d4c0e8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {inboxUnread.length > 0 && (
            <span
              className="absolute top-0 right-0 flex items-center justify-center rounded-full"
              style={{
                minWidth: 16,
                height: 16,
                padding: '0 4px',
                background: '#3b82f6',
                color: 'white',
                fontSize: 10,
                fontWeight: 600,
                lineHeight: '16px',
                boxShadow: '0 0 0 2px rgba(20, 12, 40, 0.9)',
              }}
              aria-hidden
            >
              {inboxUnread.length > 9 ? '9+' : inboxUnread.length}
            </span>
          )}
        </button>
      </div>
    </div>
  );

  // Fullscreen apps such as Terminal own the entire touch/input surface.
  // BrowserWindow raises wonderChromeMode='full' for those apps; hide Pearl chat
  // controls so the app composer remains tappable on mobile.
  if (wonderChromeMode === 'full') {
    return null;
  }

  if (shouldHideChatChromeForWindow) {
    return null;
  }

  // ─── CHAT MODE OFF: Still show Pearl bar so it never disappears (e.g. after refresh) ───
  if (!showChatBar) {
    return (
      <div
        className={`${pos} inset-0 z-[100]`}
        style={{ pointerEvents: 'none' }}
      >
        <div style={{ pointerEvents: 'auto' }}>{minimalBar}</div>
      </div>
    );
  }

  // ─── COLLAPSED STATE: Same left side (Pearl avatar + indicator) always visible; open-chat button on the right ───
  if (!isChatBarOpen) {
    return (
      <div
        className={`${pos} inset-0 z-[100]`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{ pointerEvents: isDragOver ? 'auto' : 'none' }}
      >
        {dragOverlay}
        {uploadToast}
        {fileInput}
        {minimalBar}
      </div>
    );
  }

  // ─── MINIMIZED STATE: Input bar at bottom ───
  if (!isExpanded) {
    return (
      <div
        className={`${pos} inset-0 z-[100]`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{ pointerEvents: isDragOver ? 'auto' : 'none' }}
      >
        {dragOverlay}
        {uploadToast}
        {fileInput}
        {/* Chat bar — unified element flush to bottom */}
        <div
          className={pos}
          style={{
            pointerEvents: 'auto',
            left: inSplit ? 0 : CHAT_BAR_LEFT_OFFSET,
            right: inSplit ? 0 : CHAT_BAR_RIGHT_OFFSET,
            bottom: inSplit ? 4 : `calc(env(safe-area-inset-bottom, 0px) + 4px)`,
          }}
        >
          {inputRow}
        </div>
      </div>
    );
  }

  // ─── EXPANDED STATE: Full-screen chat overlay (mobile-first) ───
  return (
    <div
      className={`${pos} inset-0 z-[100] flex flex-col`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        pointerEvents: 'auto',
        backgroundColor: 'rgba(10, 6, 20, 0.98)',
        /* Full screen — no gaps, no rounded corners */
        animation: 'chatExpandIn 0.25s ease-out both',
        /* Prevent viewport zoom/bounce on mobile */
        touchAction: 'manipulation',
        overscrollBehavior: 'none',
      }}
    >
      {dragOverlay}
      {uploadToast}
      {fileInput}

      {/* ── Header bar ── */}
      <div
        className="shrink-0 grid grid-cols-3 items-center"
        style={{
          paddingTop: `calc(env(safe-area-inset-top, 0px) + 12px)`,
          paddingBottom: 12,
          paddingLeft: `calc(env(safe-area-inset-left, 0px) + 16px)`,
          paddingRight: `calc(env(safe-area-inset-right, 0px) + 16px)`,
          borderBottom: '1px solid rgba(123, 63, 142, 0.15)',
          backgroundColor: 'rgba(10, 6, 20, 0.98)',
        }}
      >
        <div /> {/* left spacer */}
        <span
          className="text-[#faf8f5] font-semibold text-center"
          style={{ fontSize: 'clamp(15px, 4vw, 17px)' }}
        >
          Pearl
        </span>

        <div className="flex items-center gap-1 justify-self-end">
          {/* Minimize (chevron down) */}
          <button
            onClick={handleMinimize}
            className="flex items-center justify-center rounded-full hover:bg-white/10 active:bg-white/15 transition-colors"
            style={{ width: 44, height: 44, minWidth: 44 }}
            aria-label="Minimize chat"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d4c0e8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {/* Close (X) */}
          <button
            onClick={handleClose}
            className="flex items-center justify-center rounded-full hover:bg-white/10 active:bg-white/15 transition-colors"
            style={{ width: 44, height: 44, minWidth: 44 }}
            aria-label="Close chat"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d4c0e8" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Archive button (below title) ── */}
      <div className="flex justify-center shrink-0" style={{ paddingTop: 4, paddingBottom: 8 }}>
        <button
          onClick={handleArchive}
          disabled={messages.length === 0 || isArchiving}
          className="flex items-center justify-center rounded-full transition-colors disabled:opacity-30"
          style={{
            height: 30,
            paddingLeft: 14,
            paddingRight: 14,
            backgroundColor: 'rgba(200, 200, 215, 0.12)',
            color: '#b0b0c0',
          }}
          aria-label="Archive this conversation and start fresh"
          title="Archive this conversation and start fresh"
        >
          <span style={{ fontSize: '10px', letterSpacing: '0.14em', fontWeight: 600, textTransform: 'uppercase' }}>
            {isArchiving ? 'archiving' : 'archive'}
          </span>
        </button>
      </div>

      {/* ── Messages area ── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain min-h-0 min-w-0"
        style={{
          paddingLeft: `calc(env(safe-area-inset-left, 0px) + 20px)`,
          paddingRight: `calc(env(safe-area-inset-right, 0px) + 20px)`,
          paddingTop: 16,
          paddingBottom: 12,
          scrollbarWidth: 'thin',
          scrollbarColor: '#7B3F8E40 transparent',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* Loading spinner for older messages */}
        {isLoadingMore && (
          <div className="flex justify-center py-3">
            <div
              className="w-5 h-5 rounded-full border-2 border-[#7B3F8E]/40 border-t-[#D94F8E]"
              style={{ animation: 'spin 0.8s linear infinite' }}
            />
          </div>
        )}

        {/* "Load more" hint when user is at the top and there are more messages */}
        {!isLoadingMore && hasMore && messages.length > 0 && (
          <div className="flex justify-center py-2">
            <span
              className="text-[#d4c0e8]/30"
              style={{ fontSize: 'clamp(11px, 2.8vw, 12px)' }}
            >
              ↑ scroll for older messages
            </span>
          </div>
        )}

        {/* Empty state */}
        {messages.length === 0 && !isTyping && (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
            <img
              src="/images/avatar/Pearlinactivenew.png"
              alt="Pearl"
              style={{
                width: 56,
                height: 56,
                objectFit: 'contain',
                opacity: 0.4,
                filter: 'drop-shadow(1px 1px 3px rgba(0,0,0,0.5))',
              }}
            />
            <span
              className="text-[#d4c0e8]/30 text-center"
              style={{ fontSize: 'clamp(13px, 3.5vw, 15px)' }}
            >
              Start a conversation with Pearl
            </span>
          </div>
        )}

        {messageBubbles}
        {isTyping && !hasEmptyStreamingAssistantBubble && <TypingIndicator />}
      </div>

      {/* ── Input area — flush to bottom with safe area ── */}
      <div
        className="shrink-0"
        style={{
          paddingLeft: 'calc(env(safe-area-inset-left, 0px) + clamp(10px, 2.5vw, 16px))',
          paddingRight: 'calc(env(safe-area-inset-right, 0px) + clamp(10px, 2.5vw, 16px))',
          paddingTop: 14,
          paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 14px)`,
          borderTop: '1px solid rgba(123, 63, 142, 0.12)',
          backgroundColor: 'rgba(10, 6, 20, 0.98)',
        }}
      >
        {inputRow}
      </div>

      {/* ── Animations ── */}
      <style>{`
        @keyframes chatExpandIn {
          from {
            opacity: 0;
            transform: translateY(40px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pearlTaskToastIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default ChatMode;
