"use client";

import React, { useRef, useEffect, useState, useCallback } from 'react';
import ChatBubble from './ChatBubble';
import TypingIndicator from './TypingIndicator';
import { useChatSession } from '../hooks/useChatSession';
import { useUI } from '@interface/contexts/ui-context';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { DesktopMode } from '@interface/types/desktop-modes';
import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { requestWindowOpen } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';
import PearlAvatar from '@interface/components/PearlAvatar';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const API_BASE = process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || '';
// Pearl avatar GIF constants kept for reference (PearlAvatar component handles state machine now)
const LIVE_AVATAR_IDLE_GIF = '/images/avatar/pearlIdle1.gif';
const LIVE_AVATAR_TALKING_GIF = '/images/avatar/avatar-talking.gif';
const CHAT_BAR_LEFT_OFFSET = 'calc(env(safe-area-inset-left, 0px) + clamp(12px, 3vw, 20px))';
const CHAT_BAR_RIGHT_OFFSET = 'calc(env(safe-area-inset-right, 0px) + clamp(12px, 3vw, 20px))';

const ChatMode: React.FC = () => {
  const { isChatMode, setIsChatMode } = useUI();
  const { currentMode } = useDesktopMode();
  const isHomeOrWorkMode = currentMode === DesktopMode.HOME || currentMode === DesktopMode.WORK;
  const { callStatus, isAssistantSpeaking, toggleCall } = useVoiceSessionContext();
  const isVoiceActive = callStatus === 'active' || callStatus === 'loading';
  const { messages, isTyping, historyLoaded, isLoadingMore, hasMore, loadMore, sendMessage, clearMessages } = useChatSession();
  const [input, setInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  // Start with the chat bar open so the user can immediately type
  const [isChatBarOpen, setIsChatBarOpen] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  /** Attached image for sending with the next message (base64 data URL) */
  const [attachedImage, setAttachedImage] = useState<{ dataUrl: string; filename: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCountRef = useRef(0);
  /** Track whether the user is near the bottom so we only auto-scroll when appropriate */
  const isNearBottomRef = useRef(true);
  /** Used to preserve scroll position when prepending older messages */
  const prevScrollHeightRef = useRef(0);
  /** Tracks whether the user explicitly dismissed the chat. Reset when a NEW message arrives. */
  const userDismissedRef = useRef(false);
  /** Previous message count — used to detect genuinely new messages vs existing ones */
  const prevMessageCountRef = useRef(messages.length);
  /** Tracks whether the initial history load has been consumed by the auto-expand effect.
   *  Prevents the first history load from being treated as "new messages". */
  const initialLoadCompleteRef = useRef(false);
  const latestMessage = messages[messages.length - 1];
  // Pearl is "responding" when: text streaming, typing indicator, OR voice is actively speaking
  const isPearlResponding = isTyping || (latestMessage?.role === 'assistant' && latestMessage?.isStreaming === true) || isAssistantSpeaking;
  const liveAvatarSrc = isPearlResponding ? LIVE_AVATAR_TALKING_GIF : LIVE_AVATAR_IDLE_GIF;
  const hasEmptyStreamingAssistantBubble = Boolean(
    latestMessage?.role === 'assistant' &&
    latestMessage?.isStreaming &&
    !latestMessage?.content?.trim()
  );

  // ─── Auto-scroll on new messages (only if user is near the bottom) ───
  useEffect(() => {
    if (scrollRef.current && isNearBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Auto-focus input when user starts typing anywhere on the page
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (
        e.ctrlKey || e.metaKey || e.altKey ||
        e.key.startsWith('Arrow') ||
        (e.key.startsWith('F') && e.key.length > 1) ||
        ['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape', 'CapsLock',
         'Enter', 'Delete', 'Backspace', 'Home', 'End', 'PageUp', 'PageDown',
         'Insert', 'PrintScreen', 'ScrollLock', 'Pause', 'NumLock'].includes(e.key)
      ) return;
      const el = inputRef.current;
      if (!el || document.activeElement === el) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable) return;
      el.focus();
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // ─── Auto-focus input on any printable keypress ───
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Skip if already focused on an input/textarea, or if modifier keys are held
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Skip non-printable keys (function keys, arrows, etc.)
      if (e.key.length !== 1) return;
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

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

  // Reset expanded state when leaving chat mode
  useEffect(() => {
    if (!isChatMode) {
      setIsExpanded(false);
      if (!isHomeOrWorkMode) {
        setIsChatBarOpen(false);
      }
    }
  }, [isChatMode, isHomeOrWorkMode]);

  // Listen for Pearl tap to minimize
  useEffect(() => {
    const handleMinimize = () => {
      setIsExpanded(false);
      setIsChatBarOpen(false);
    };
    window.addEventListener('pearl:chat-minimize', handleMinimize);
    return () => window.removeEventListener('pearl:chat-minimize', handleMinimize);
  }, []);

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

    // Only auto-expand when messages count increased (new message arrived)
    if (messages.length > prevCount && messages.length > 0 && (isChatMode || isHomeOrWorkMode)) {
      // If the user dismissed the chat, only re-open for genuinely new messages
      if (userDismissedRef.current) {
        // Check if the latest message is from the assistant (Pearl responding)
        const latestMsg = messages[messages.length - 1];
        if (latestMsg?.role === 'assistant') {
          userDismissedRef.current = false;
          setIsChatBarOpen(true);
          setIsExpanded(true);
        }
        // If it's a user message, they sent it themselves so the UI is already open
      } else {
        setIsChatBarOpen(true);
        setIsExpanded(true);
      }
    }
  }, [messages.length, historyLoaded, isChatMode, isHomeOrWorkMode]);

  // ─── File upload handler ───
  const handleFileUpload = useCallback(async (file: File) => {
    const isImage = IMAGE_TYPES.includes(file.type);
    setUploadStatus(`Uploading ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const data = await res.json();

      if (isImage) {
        setUploadStatus(null);
        requestWindowOpen({ viewType: 'photoMagic', source: 'chat:drag-drop' });
        window.dispatchEvent(new CustomEvent('pearl:photo-magic-open', {
          detail: {
            imageUrl: `${API_BASE}${data.imageUrl}`,
            filename: data.originalName || data.filename,
          }
        }));
      } else {
        setUploadStatus(`✓ ${file.name} uploaded to workspace`);
        setTimeout(() => setUploadStatus(null), 3000);
      }
    } catch (err: any) {
      setUploadStatus(`✗ Failed to upload ${file.name}`);
      setTimeout(() => setUploadStatus(null), 3000);
    }
  }, []);

  // ─── Paste handler ───
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => IMAGE_TYPES.includes(item.type));
    if (imageItem) {
      e.preventDefault();
      const blob = imageItem.getAsFile();
      if (blob) {
        const ext = imageItem.type.split('/')[1] ?? 'png';
        const filename = `paste-${Date.now()}.${ext}`;
        // Convert to base64 data URL for preview and sending
        const reader = new FileReader();
        reader.onload = () => {
          setAttachedImage({ dataUrl: reader.result as string, filename });
        };
        reader.readAsDataURL(blob);
      }
      return;
    }
  }, []);

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
    const file = e.dataTransfer.files?.[0];
    if (file && IMAGE_TYPES.includes(file.type)) {
      // Convert to base64 data URL for preview and sending
      const reader = new FileReader();
      reader.onload = () => {
        setAttachedImage({ dataUrl: reader.result as string, filename: file.name });
      };
      reader.readAsDataURL(file);
    } else if (file) {
      // Non-image files: keep old behavior (upload to workspace)
      handleFileUpload(file);
    }
  }, [handleFileUpload]);

  // ─── File input (paperclip) handler ───
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && IMAGE_TYPES.includes(file.type)) {
      // Convert to base64 data URL for preview and sending
      const reader = new FileReader();
      reader.onload = () => {
        setAttachedImage({ dataUrl: reader.result as string, filename: file.name });
      };
      reader.readAsDataURL(file);
    } else if (file) {
      // Non-image files: keep old behavior (upload to workspace)
      handleFileUpload(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleFileUpload]);

  const handleSend = () => {
    if (!input.trim() && !attachedImage) return;
    userDismissedRef.current = false;
    sendMessage(input, attachedImage?.dataUrl);
    setInput('');
    setAttachedImage(null);
    setIsChatBarOpen(true);
    setIsExpanded(true);
    isNearBottomRef.current = true;
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleRemoveImage = () => {
    setAttachedImage(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClose = () => {
    userDismissedRef.current = true;
    clearMessages();
    setIsChatMode(false);
    setIsExpanded(false);
    if (!isHomeOrWorkMode) {
      setIsChatBarOpen(false);
    }
  };

  const handleMinimize = () => {
    setIsExpanded(false);
  };

  const handleChatBarToggle = () => {
    if (isChatBarOpen) {
      setIsChatBarOpen(false);
      setIsExpanded(false);
    } else {
      setIsChatBarOpen(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleInputFocus = () => {
    // On mobile, tapping the input when there are messages should expand full-screen
    if (messages.length > 0) {
      setIsExpanded(true);
    }
  };

  const handleInputClick = () => {
    if (messages.length > 0) {
      setIsExpanded(true);
    }
  };

  // Handle avatar click - toggle voice call on/off
  const handleAvatarClick = () => {
    if (isVoiceActive) {
      // Voice call is active - end it
      if (toggleCall) {
        toggleCall();
      }
    } else {
      // No active call - start one
      window.dispatchEvent(new CustomEvent('assistant:force-start'));
    }
  };

  // Show chat bar in HOME or WORK desktop mode even when isChatMode is false
  const showChatBar = isChatMode || isHomeOrWorkMode;
  if (!showChatBar) return null;

  // ─── Shared sub-components ───

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*,.pdf,.txt,.md,.json,.csv,.zip"
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
      className="fixed left-1/2 -translate-x-1/2 z-[860] px-4 py-2 rounded-full text-[#faf8f5] shadow-lg"
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
      className="fixed inset-0 z-[870] flex items-center justify-center pointer-events-none"
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
        <span className="text-[#d4c0e8]/60 text-sm">Images will be sent with your message</span>
      </div>
    </div>
  );

  // Image preview component (shows above input when an image is attached)
  const imagePreview = attachedImage && (
    <div
      className="absolute bottom-full mb-2 left-1.5 right-1.5 flex items-center gap-2 px-3 py-2 rounded-xl"
      style={{
        backgroundColor: 'rgba(30, 18, 55, 0.95)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(123, 63, 142, 0.3)',
      }}
    >
      <div
        className="relative rounded-lg overflow-hidden shrink-0"
        style={{
          width: 48,
          height: 48,
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
        <p
          className="text-[#faf8f5] truncate"
          style={{ fontSize: 'clamp(13px, 3.5vw, 14px)' }}
        >
          {attachedImage.filename}
        </p>
        <p
          className="text-[#d4c0e8]/50"
          style={{ fontSize: 'clamp(11px, 3vw, 12px)' }}
        >
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
  );

  // The input row used in both minimized and expanded states
  const inputRow = (
    <div className="relative flex items-center gap-2" style={{ minHeight: 69, backgroundColor: 'rgba(16, 10, 32, 0.92)', borderRadius: '30px', padding: '6px 8px 6px 6px', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', outline: '2px solid rgba(123, 63, 142, 0.35)', outlineOffset: '2px' }}>
      {/* Pearl avatar — GIF state machine: sleep → wake → idle ↔ talking → sleep */}
      <button
        onClick={handleAvatarClick}
        className="shrink-0 rounded-full overflow-hidden bg-transparent hover:opacity-90 transition-opacity"
        style={{ 
          width: 57, 
          height: 57, 
          minWidth: 57
        }}
        aria-label={isVoiceActive ? "End call with Pearl" : "Talk to Pearl"}
        title={isVoiceActive ? "Click to end call" : "Click to start voice call"}
      >
        <PearlAvatar
          isAwake={isVoiceActive}
          isTalking={isPearlResponding}
          size={57}
          className="w-full h-full object-cover rounded-full"
        />
      </button>
      {imagePreview}
      <div
        className="flex items-center px-1.5 py-1.5 focus-within:ring-1 focus-within:ring-[#D94F8E]/40 transition-all gap-1 flex-1 min-w-0"
        style={{
          backgroundColor: isExpanded ? 'rgba(30, 18, 55, 0.85)' : 'rgba(16, 10, 32, 0.88)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRadius: '22px',
          border: 'none',
          boxShadow: isExpanded
            ? '0 -1px 12px rgba(0,0,0,0.2)'
            : '0 8px 40px rgba(0,0,0,0.45), 0 2px 12px rgba(123, 63, 142, 0.08)',
          overflow: 'hidden',
        }}
      >
        <input
        ref={inputRef}
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="sentences"
        enterKeyHint="send"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={handleInputFocus}
        onClick={handleInputClick}
        onTouchEnd={(e) => {
          // Prevent double-focus issues on mobile
          e.stopPropagation();
          (e.target as HTMLInputElement).focus();
        }}
        placeholder="Message Pearl..."
        className="flex-1 bg-transparent text-[#faf8f5] placeholder-[#d4c0e8]/40 outline-none px-3 py-2"
        style={{
          fontSize: 'clamp(16px, 4vw, 17px)', // min 16px prevents iOS Safari auto-zoom on focus
          lineHeight: '1.5',
          minHeight: 46,
          minWidth: 0,
          letterSpacing: '0.01em',
          WebkitAppearance: 'none',
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
          borderRadius: '18px',
        }}
      />
      {/* Paperclip — left of send button */}
      {paperclipButton}
      <button
        onClick={handleSend}
        disabled={!input.trim() && !attachedImage}
        className="flex items-center justify-center rounded-full bg-[#D94F8E] hover:bg-[#c9407e] disabled:opacity-25 disabled:hover:bg-[#D94F8E] transition-all text-white shrink-0"
        style={{ width: 40, height: 40, minWidth: 40 }}
        aria-label="Send message"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="5 12 12 5 19 12" />
        </svg>
      </button>
      </div>
    </div>
  );

  // ─── COLLAPSED STATE: Just a chat icon button ───
  if (!isChatBarOpen) {
    return (
      <div
        className="fixed inset-0 z-[850]"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{ pointerEvents: isDragOver ? 'auto' : 'none' }}
      >
        {dragOverlay}
        {uploadToast}
        {fileInput}
        <div
          className="fixed"
          style={{
            pointerEvents: 'auto',
            left: CHAT_BAR_LEFT_OFFSET,
            right: CHAT_BAR_RIGHT_OFFSET,
            bottom: `calc(env(safe-area-inset-bottom, 0px) + 12px)`,
          }}
        >
          <button
            onClick={handleChatBarToggle}
            className="w-12 h-12 flex items-center justify-center rounded-full shadow-2xl border border-[#7B3F8E]/25 transition-all hover:scale-105 active:scale-95"
            style={{
              backgroundColor: 'rgba(16, 10, 32, 0.88)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              boxShadow: '0 6px 28px rgba(0,0,0,0.4)',
            }}
            aria-label="Open chat"
            title="Chat with Pearl"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d4c0e8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ─── MINIMIZED STATE: Input bar at bottom ───
  if (!isExpanded) {
    return (
      <div
        className="fixed inset-0 z-[850]"
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
          className="fixed"
          style={{
            pointerEvents: 'auto',
            left: CHAT_BAR_LEFT_OFFSET,
            right: CHAT_BAR_RIGHT_OFFSET,
            bottom: `calc(env(safe-area-inset-bottom, 0px) + 4px)`,
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
      className="fixed inset-0 z-[850] flex flex-col"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
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
        className="shrink-0 flex items-center justify-between"
        style={{
          paddingTop: `calc(env(safe-area-inset-top, 0px) + 12px)`,
          paddingBottom: 12,
          paddingLeft: `calc(env(safe-area-inset-left, 0px) + 16px)`,
          paddingRight: `calc(env(safe-area-inset-right, 0px) + 16px)`,
          borderBottom: '1px solid rgba(123, 63, 142, 0.15)',
          backgroundColor: 'rgba(10, 6, 20, 0.98)',
        }}
      >
        <div className="flex items-center gap-3">
          {/* HIDDEN - using clickable AssistantButton Pearl instead of decorative GIF */}
          <div className="flex flex-col">
            <span
              className="text-[#faf8f5] font-semibold"
              style={{ fontSize: 'clamp(15px, 4vw, 17px)' }}
            >
              Pearl
            </span>
            <span
              className="text-[#d4c0e8]/50"
              style={{ fontSize: 'clamp(11px, 2.8vw, 12px)' }}
            >
              online
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
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

        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} />
        ))}
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
      `}</style>
    </div>
  );
};

export default ChatMode;
