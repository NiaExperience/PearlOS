'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

type NewTaskModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
};

export function NewTaskModal({ open, onClose, onCreated }: NewTaskModalProps) {
  const [task, setTask] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setTask('');
    setError(null);
    const t = window.setTimeout(() => textareaRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    onClose();
  }, [isSubmitting, onClose]);

  const handleSubmit = useCallback(async () => {
    const trimmed = task.trim();
    if (!trimmed || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          task: trimmed,
          execute: true,
          source: 'web_chat',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { message?: string; error?: string } | null;
        throw new Error(data?.message || data?.error || `Task creation failed (${res.status})`);
      }
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Task creation failed.');
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, onClose, onCreated, task]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[140] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-task-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-white/15 bg-[#0d0815]/95 shadow-2xl shadow-black/50"
        style={{ fontFamily: 'Gohufont, monospace' }}
      >
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <h2 id="new-task-modal-title" className="text-sm font-semibold text-white/85">
            Describe the task
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-white/50 transition-colors hover:border-white/25 hover:text-white/85 disabled:opacity-40"
            aria-label="Close new task modal"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <textarea
            ref={textareaRef}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void handleSubmit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                handleClose();
              }
            }}
            placeholder="Describe the task"
            className="min-h-[112px] w-full resize-y rounded-lg border border-white/12 bg-[#07030d]/80 px-3 py-2 text-sm leading-relaxed text-white outline-none transition-colors placeholder:text-white/30 focus:border-white/30 focus:ring-2 focus:ring-white/10 sm:min-h-[150px]"
            disabled={isSubmitting}
          />

          {error && (
            <p className="mt-2 text-xs text-rose-200" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-white/65 transition-colors hover:border-white/25 hover:text-white disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || !task.trim()}
            className="rounded-md border border-green-400/35 bg-green-500/15 px-3 py-2 text-xs font-semibold text-green-100 transition-colors hover:bg-green-500/25 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isSubmitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
