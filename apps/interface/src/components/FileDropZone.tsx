"use client";

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { useUI } from '@interface/contexts/ui-context';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { DesktopMode } from '@interface/types/desktop-modes';
import { useChatInbox } from '@interface/features/ChatMode/hooks/useChatInbox';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const NON_IMAGE_FILE_EXTENSIONS = /\.(?:pdf|docx?|pptx?|xlsx?|xls|ods|odt|txt|md|markdown|json|jsonl|csv|tsv|zip)$/i;
const MAX_UPLOAD_FILES = 10;
const UPLOAD_URL = '/api/chat/upload';

function isImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  if (NON_IMAGE_FILE_EXTENSIONS.test(file.name || '')) return false;
  return IMAGE_TYPES.includes(file.type);
}

/**
 * Global file drop zone overlay. Renders invisibly over the entire viewport,
 * activating a visual overlay only when a file is dragged over the page.
 * Works in both voice and chat modes.
 *
 * For images: dispatches pearl:image-uploaded so the bot can analyze them.
 * For other files: saves to workspace and shows confirmation.
 * Also provides a floating attach button on mobile (bottom-left).
 */
export default function FileDropZone() {
  const { isChatMode } = useUI();
  const { currentMode } = useDesktopMode();
  const isWorkMode = currentMode === DesktopMode.DESKTOP;
  const isHomeMode = currentMode === DesktopMode.HOME;
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const dragCountRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { unreadCount, markRead: markInboxRead, fetchInbox } = useChatInbox();

  // Upload handler
  const handleFileUpload = useCallback(async (file: File) => {
    setUploadStatus(`Uploading ${file.name}…`);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(UPLOAD_URL, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const data = await res.json();
      const isImage = data.kind === 'image' && isImageFile(file);
      const fileContext = data.pearlFileContext || data.attachmentContext || '';

      if (isImage) {
        // Dispatch both image-uploaded (for bot pipeline) and file-uploaded (for chat attachment)
        window.dispatchEvent(
          new CustomEvent('pearl:image-uploaded', {
            detail: {
              imageUrl: data.imageUrl,
              path: data.path,
              filename: data.originalName || data.filename,
              contentType: data.mime,
              pearlFileContext: fileContext,
              attachmentContext: fileContext,
            },
          })
        );
        window.dispatchEvent(
          new CustomEvent('pearl:file-uploaded', {
            detail: {
              path: data.path,
              filename: data.originalName || data.filename,
              contentType: data.mime,
              size: data.bytes,
              bytes: data.bytes,
              kind: data.kind,
              fileSpacePath: data.fileSpacePath,
              sha256: data.sha256,
              pearlFileContext: fileContext,
              attachmentContext: fileContext,
              mime: data.mime,
            },
          })
        );
        setUploadStatus(`✓ ${file.name} — analyzing image…`);
        setTimeout(() => setUploadStatus(null), 3000);
      } else {
        // Non-image file saved
        const fileContext = data.pearlFileContext || data.attachmentContext || '';
        window.dispatchEvent(
          new CustomEvent('pearl:file-uploaded', {
            detail: {
              path: data.path,
              filename: data.originalName || data.filename,
              contentType: data.mime,
              size: data.bytes,
              bytes: data.bytes,
              kind: data.kind,
              fileSpacePath: data.fileSpacePath,
              sha256: data.sha256,
              pearlFileContext: fileContext,
              attachmentContext: fileContext,
              mime: data.mime,
            },
          })
        );
        setUploadStatus(`✓ ${file.name} uploaded`);
        setTimeout(() => setUploadStatus(null), 3000);
      }
    } catch (err: any) {
      console.error('[FileDropZone] Upload error:', err);
      setUploadStatus(`✗ Failed to upload ${file.name}`);
      setTimeout(() => setUploadStatus(null), 4000);
    }
  }, []);

  // Drag handlers
  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current++;
    if (dragCountRef.current === 1) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCountRef.current = 0;
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer?.files || []).slice(0, MAX_UPLOAD_FILES);
      if (files.length) void Promise.all(files.map(handleFileUpload));
      if ((e.dataTransfer?.files?.length || 0) > MAX_UPLOAD_FILES) {
        setUploadStatus(`Only the first ${MAX_UPLOAD_FILES} files were attached`);
        setTimeout(() => setUploadStatus(null), 3000);
      }
    },
    [handleFileUpload]
  );

  // Register global drag listeners on document
  useEffect(() => {
    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  // File input change (for mobile button)
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []).slice(0, MAX_UPLOAD_FILES);
      if (files.length) void Promise.all(files.map(handleFileUpload));
      if ((e.target.files?.length || 0) > MAX_UPLOAD_FILES) {
        setUploadStatus(`Only the first ${MAX_UPLOAD_FILES} files were attached`);
        setTimeout(() => setUploadStatus(null), 3000);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [handleFileUpload]
  );

  return (
    <>
      {/* Hidden file input for mobile picker */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,audio/*,video/*,.pdf,.txt,.md,.json,.jsonl,.csv,.tsv,.zip,.doc,.docx,.xls,.xlsx,.ods,.ppt,.pptx"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* Drag overlay — only visible when dragging */}
      {isDragOver && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{
            backgroundColor: 'rgba(10, 6, 20, 0.75)',
            backdropFilter: 'blur(6px)',
            pointerEvents: 'auto',
          }}
        >
          <div className="flex flex-col items-center gap-3 animate-pulse">
            <div
              className="w-24 h-24 rounded-2xl flex items-center justify-center"
              style={{
                backgroundColor: 'rgba(217, 79, 142, 0.15)',
                border: '2px dashed rgba(217, 79, 142, 0.7)',
              }}
            >
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#D94F8E"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <span className="text-[#faf8f5] text-lg font-medium">Drop file to upload</span>
            <span className="text-[#d4c0e8]/60 text-sm">Images will be analyzed by Pearl</span>
          </div>
        </div>
      )}

      {/* Upload status toast */}
      {uploadStatus && (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[201] px-4 py-2 rounded-full text-sm text-[#faf8f5] shadow-lg"
          style={{
            backgroundColor: 'rgba(20, 12, 40, 0.9)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(123, 63, 142, 0.3)',
          }}
        >
          {uploadStatus}
        </div>
      )}

      {/* Chat bubble button — floating button, bottom-left.
           Tapping opens/expands the chat bar (which has its own paperclip for attachments).
           Hidden when ChatMode, HomeMode, or WorkMode is active (chat bar is already visible). */}
      {!isChatMode && !isWorkMode && !isHomeMode && <button
        onClick={() => {
          window.dispatchEvent(new Event('pearl:open-chat'));
          if (unreadCount > 0) {
            void markInboxRead();
            void fetchInbox();
          }
        }}
        className="fixed bottom-10 left-4 z-[100] w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
        style={{
          backgroundColor: 'rgba(20, 12, 40, 0.8)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(123, 63, 142, 0.25)',
          pointerEvents: 'auto',
          position: 'fixed',
        }}
        aria-label={unreadCount > 0 ? `Open chat (${unreadCount} new message${unreadCount === 1 ? '' : 's'})` : 'Open chat'}
        title={unreadCount > 0 ? `${unreadCount} new message${unreadCount === 1 ? '' : 's'} from Pearl` : 'Chat with Pearl'}
      >
        {/* Chat bubble with "..." (typing indicator) — communicates text/type here */}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M21 11.5C21 16.19 16.97 20 12 20C10.82 20 9.69 19.78 8.65 19.39L3 21L4.64 16.35C3.6 14.94 3 13.28 3 11.5C3 6.81 7.03 3 12 3C16.97 3 21 6.81 21 11.5Z" stroke="#d4c0e8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          <circle cx="8.5" cy="11.5" r="1.2" fill="#d4c0e8"/>
          <circle cx="12" cy="11.5" r="1.2" fill="#d4c0e8"/>
          <circle cx="15.5" cy="11.5" r="1.2" fill="#d4c0e8"/>
        </svg>
        {unreadCount > 0 && (
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
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>}
    </>
  );
}
