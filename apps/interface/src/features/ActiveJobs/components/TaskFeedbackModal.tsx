'use client';

import React, { useState, useRef, useCallback } from 'react';
import type { TaskFeedback } from '../hooks/useTaskFeedback';

interface TaskFeedbackModalProps {
  taskId: string;
  taskName: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (feedback: TaskFeedback) => void;
  submitting: boolean;
  voiceMode?: boolean;
}

export function TaskFeedbackModal({
  taskId,
  taskName,
  isOpen,
  onClose,
  onSubmit,
  submitting,
  voiceMode = false,
}: TaskFeedbackModalProps) {
  const [notes, setNotes] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImages = useCallback((files: FileList | File[]) => {
    const newFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (newFiles.length === 0) return;

    setImages((prev) => [...prev, ...newFiles]);
    for (const file of newFiles) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviews((prev) => [...prev, e.target?.result as string]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addImages(e.dataTransfer.files);
      }
    },
    [addImages]
  );

  const handleSubmit = useCallback(() => {
    onSubmit({
      taskId,
      taskName,
      type: 'down',
      notes,
      images,
      timestamp: Date.now(),
      mode: voiceMode ? 'voice' : 'text',
    });
    // Reset
    setNotes('');
    setImages([]);
    setPreviews([]);
  }, [taskId, taskName, notes, images, voiceMode, onSubmit]);

  const handleClose = useCallback(() => {
    setNotes('');
    setImages([]);
    setPreviews([]);
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[900] flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="
          relative z-10 w-[90vw] max-w-[440px]
          bg-[#1a1025]/95 backdrop-blur-xl
          border border-white/15 rounded-2xl
          shadow-2xl shadow-black/50
          p-5
          animate-in fade-in zoom-in-95 duration-200
        "
        style={{ fontFamily: 'Gohufont, monospace' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm text-white/90 font-medium">Task Feedback</h3>
            <p className="text-[11px] text-white/40 truncate mt-0.5">{taskName}</p>
          </div>
          <button
            onClick={handleClose}
            className="
              flex items-center justify-center w-7 h-7 rounded-lg
              text-white/40 hover:text-white/70 hover:bg-white/10
              transition-colors duration-150 flex-shrink-0 ml-2
            "
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* What went wrong label */}
        <label className="block text-[11px] text-white/50 mb-1.5">
          What went wrong?
        </label>

        {/* Text input */}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Describe what wasn't right about this task…"
          className="
            w-full h-24 px-3 py-2 rounded-xl
            bg-[#0d0815]/80 border border-white/10
            text-xs text-white/80 placeholder-white/25
            resize-none outline-none
            focus:border-white/25 focus:ring-1 focus:ring-white/10
            transition-colors duration-150
          "
          style={{ fontFamily: 'Gohufont, monospace' }}
          autoFocus
        />

        {/* Voice mode indicator */}
        {voiceMode && (
          <div className="flex items-center gap-2 mt-2 px-1">
            <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
            <span className="text-[10px] text-white/40">Voice mode — speak your feedback</span>
          </div>
        )}

        {/* Image upload area */}
        <div
          className={`
            mt-3 border border-dashed rounded-xl p-3
            transition-colors duration-150 cursor-pointer
            ${dragOver
              ? 'border-blue-400/50 bg-blue-400/5'
              : 'border-white/10 hover:border-white/20'
            }
          `}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addImages(e.target.files);
              e.target.value = '';
            }}
          />

          {previews.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-1">
              <svg className="w-5 h-5 text-white/25" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-[10px] text-white/30">
                Drop screenshots here or click to upload
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {previews.map((src, i) => (
                <div key={i} className="relative group">
                  <img
                    src={src}
                    alt={`Screenshot ${i + 1}`}
                    className="w-16 h-16 object-cover rounded-lg border border-white/10"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImage(i);
                    }}
                    className="
                      absolute -top-1.5 -right-1.5
                      w-5 h-5 rounded-full
                      bg-red-500/80 text-white text-[10px]
                      flex items-center justify-center
                      opacity-0 group-hover:opacity-100
                      transition-opacity duration-150
                    "
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-center w-16 h-16 rounded-lg border border-dashed border-white/15 text-white/25 text-lg">
                +
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            onClick={handleClose}
            className="
              px-4 py-2 rounded-xl text-xs
              text-white/50 hover:text-white/70
              border border-white/10 hover:border-white/20
              transition-colors duration-150
            "
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || (!notes.trim() && images.length === 0)}
            className="
              px-4 py-2 rounded-xl text-xs font-medium
              bg-red-500/20 text-red-300 border border-red-400/30
              hover:bg-red-500/30 hover:border-red-400/50
              disabled:opacity-30 disabled:cursor-not-allowed
              transition-colors duration-150
            "
          >
            {submitting ? 'Submitting…' : 'Submit Feedback'}
          </button>
        </div>
      </div>
    </div>
  );
}
