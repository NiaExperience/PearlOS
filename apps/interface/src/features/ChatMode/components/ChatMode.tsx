"use client";

import React, { useRef, useEffect, useState, useCallback } from 'react';
import ChatBubble from './ChatBubble';
import TypingIndicator from './TypingIndicator';
import { useChatSession } from '../hooks/useChatSession';
import { useUI } from '@interface/contexts/ui-context';
import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { requestWindowOpen } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const API_BASE = process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || '';

const ChatMode: React.FC = () => {
  const { isChatMode, setIsChatMode, triggerAvatarPopup } = useUI();
  const { toggleCall } = useVoiceSessionContext();
  const { messages, isTyping, sendMessage, clearMessages } = useChatSession();
  const [input, setInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCountRef = useRef(0);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Reset expanded state when entering/leaving chat mode
  useEffect(() => {
    if (!isChatMode) {
      setIsExpanded(false);
    }
  }, [isChatMode]);

  // Listen for Pearl tap to minimize
  useEffect(() => {
    const handleMinimize = () => setIsExpanded(false);
    window.addEventListener('pearl:chat-minimize', handleMinimize);
    return () => window.removeEventListener('pearl:chat-minimize', handleMinimize);
  }, []);

  // Auto-expand when there are messages
  useEffect(() => {
    if (messages.length > 0 && isChatMode) {
      setIsExpanded(true);
    }
  }, [messages.length, isChatMode]);

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
        // Open PhotoMagic with the uploaded image
        setUploadStatus(null);
        requestWindowOpen({ viewType: 'photoMagic', source: 'chat:drag-drop' });
        // Dispatch event with uploaded image info for PhotoMagic to pick up
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

  // ─── Global drag-and-drop handlers ───
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
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  // ─── File input (paperclip) handler ───
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleFileUpload]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(input);
    setInput('');
    setIsExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClose = () => {
    clearMessages();
    setIsChatMode(false);
    setIsExpanded(false);
  };

  const handleMinimize = () => {
    setIsExpanded(false);
  };

  const handleInputFocus = () => {
    // Don't auto-expand on focus if no messages yet
  };

  const handleInputClick = () => {
    if (messages.length > 0) {
      setIsExpanded(true);
    }
  };

  if (!isChatMode) return null;

  // Hidden file input for paperclip button
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*,.pdf,.txt,.md,.json,.csv,.zip"
      onChange={handleFileInputChange}
      style={{ display: 'none' }}
    />
  );

  // Paperclip attachment button
  const attachButton = (
    <button
      onClick={() => fileInputRef.current?.click()}
      className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-[#d4c0e8]/60 hover:text-[#d4c0e8] shrink-0"
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
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-full text-sm text-[#faf8f5] shadow-lg"
      style={{
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
      className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none"
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
        <span className="text-[#faf8f5] text-lg font-medium">Drop to upload</span>
        <span className="text-[#d4c0e8]/60 text-sm">Images open in PhotoMagic</span>
      </div>
    </div>
  );

  // ─── MINIMIZED STATE: Just input bar at bottom ───
  if (!isExpanded) {
    return (
      <div
        className="fixed inset-0 z-[70]"
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
          className="fixed bottom-6 left-4 right-4 md:left-8 md:right-[280px]"
          style={{ pointerEvents: 'auto' }}
        >
          <div
            className="flex items-center gap-2 rounded-full px-3 py-2 shadow-2xl border border-[#7B3F8E]/30"
            style={{
              backgroundColor: 'rgba(20, 12, 40, 0.85)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {/* Tiny Pearl avatar inside the bar — tap to start voice */}
            <img
              src="/images/pearl-animated.gif"
              alt="Pearl – tap to talk"
              onError={(e) => { (e.target as HTMLImageElement).src = '/images/pearl-avatar.png'; }}
              className="shrink-0 rounded-full cursor-pointer"
              style={{
                width: '30px',
                height: '30px',
                objectFit: 'cover',
              }}
              onClick={() => {
                // Directly invoke voice-start via context so it works even when
                // AssistantButton isn't mounted (e.g. avatar feature disabled in
                // the DailyCall experience).
                triggerAvatarPopup();
                if (toggleCall) {
                  toggleCall();
                } else {
                  // Fallback: fire the legacy event so AssistantButton can handle
                  // it if it happens to be mounted (legacy / non-DailyCall paths).
                  window.dispatchEvent(new Event('assistant:force-start'));
                }
              }}
            />
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
              onFocus={handleInputFocus}
              onClick={handleInputClick}
              onTouchEnd={(e) => {
                e.preventDefault();
                (e.target as HTMLInputElement).focus();
              }}
              placeholder="Message Pearl..."
              className="flex-1 bg-transparent text-[#faf8f5] placeholder-[#d4c0e8]/50 text-base outline-none"
              style={{
                fontSize: '16px',
                WebkitAppearance: 'none',
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
              }}
            />
            {attachButton}
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-[#D94F8E] hover:bg-[#E85D26] disabled:opacity-30 disabled:hover:bg-[#D94F8E] transition-all text-white shrink-0"
              aria-label="Send message"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── EXPANDED STATE: Full chat panel sliding up from bottom ───
  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {dragOverlay}
      {uploadToast}
      {fileInput}

      {/* Semi-transparent backdrop — tap to minimize */}
      <div
        className="flex-1"
        onClick={handleMinimize}
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
      />

      {/* Chat panel — slides up from bottom */}
      <div
        className="flex flex-col mx-2 md:mx-4 rounded-t-3xl overflow-hidden"
        style={{
          backgroundColor: 'rgba(10, 6, 20, 0.95)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          maxHeight: '75vh',
          transition: 'transform 0.3s ease-out',
        }}
      >
        {/* Top bar with Pearl name/status and minimize/close */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b border-[#7B3F8E]/20">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-[#faf8f5] font-semibold text-base">Pearl</span>
              <span className="text-[#d4c0e8]/50 text-xs">online</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Minimize button */}
            <button
              onClick={handleMinimize}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
              aria-label="Minimize chat"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d4c0e8" strokeWidth="2" strokeLinecap="round">
                <line x1="5" y1="18" x2="19" y2="18" />
              </svg>
            </button>
            {/* Close button */}
            <button
              onClick={handleClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
              aria-label="Close chat"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d4c0e8" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-3"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#7B3F8E40 transparent',
            minHeight: '200px',
          }}
        >
          {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} />
          ))}
          {isTyping && <TypingIndicator />}
        </div>

        {/* Input area */}
        <div
          className="shrink-0 px-3 py-3 border-t border-[#7B3F8E]/20"
          style={{ backgroundColor: 'rgba(10, 6, 20, 0.98)' }}
        >
          <div className="flex items-center gap-2">
            {attachButton}
            <input
              ref={inputRef}
              type="text"
              inputMode="text"
              autoFocus
              autoComplete="off"
              autoCapitalize="sentences"
              enterKeyHint="send"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onClick={(e) => {
                (e.target as HTMLInputElement).focus();
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                (e.target as HTMLInputElement).focus();
              }}
              placeholder="Message Pearl..."
              className="flex-1 bg-[#2a1848]/80 text-[#faf8f5] placeholder-[#d4c0e8]/40 rounded-full px-4 py-3 text-base outline-none focus:ring-1 focus:ring-[#D94F8E]/50 transition-all"
              style={{
                fontSize: '16px',
                WebkitAppearance: 'none',
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-[#D94F8E] hover:bg-[#E85D26] disabled:opacity-30 disabled:hover:bg-[#D94F8E] transition-all text-white shrink-0"
              aria-label="Send message"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatMode;
