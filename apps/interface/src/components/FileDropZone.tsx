"use client";

import React, { useCallback, useRef, useState, useEffect } from 'react';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const API_BASE = process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || '';

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
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const dragCountRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload handler
  const handleFileUpload = useCallback(async (file: File) => {
    const isImage = IMAGE_TYPES.includes(file.type);
    setUploadStatus(`Uploading ${file.name}…`);

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
        // Dispatch event so the bot pipeline can pick it up for analysis
        window.dispatchEvent(
          new CustomEvent('pearl:image-uploaded', {
            detail: {
              imageUrl: data.imageUrl ? `${API_BASE}${data.imageUrl}` : undefined,
              path: data.path,
              filename: data.originalName || data.filename,
              contentType: data.contentType,
            },
          })
        );
        setUploadStatus(`✓ ${file.name} — analyzing image…`);
        setTimeout(() => setUploadStatus(null), 3000);
      } else {
        // Non-image file saved
        window.dispatchEvent(
          new CustomEvent('pearl:file-uploaded', {
            detail: {
              path: data.path,
              filename: data.originalName || data.filename,
              contentType: data.contentType,
              size: data.size,
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
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFileUpload(file);
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
      const file = e.target.files?.[0];
      if (file) handleFileUpload(file);
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
        accept="image/*,.pdf,.txt,.md,.json,.csv,.zip,.doc,.docx,.xls,.xlsx"
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

      {/* Mobile attach button — subtle floating button, bottom-left */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className="fixed bottom-6 left-4 z-[60] w-11 h-11 rounded-full flex items-center justify-center shadow-lg md:hidden"
        style={{
          backgroundColor: 'rgba(20, 12, 40, 0.8)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(123, 63, 142, 0.25)',
          pointerEvents: 'auto',
        }}
        aria-label="Attach file"
        title="Upload a file or photo"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#d4c0e8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
    </>
  );
}
