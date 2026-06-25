'use client';

import { MessageSquare, X, Send } from 'lucide-react';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface EarlyAccessFeedbackCellProps {
  isMobile?: boolean;
}

/**
 * EarlyAccessFeedbackCell
 *
 * A soft blue cell at the top of the task bar that lets early access users
 * send feedback directly to Pearl. Text-only — no code execution, no task
 * dispatch, no agent interaction. Pure message relay.
 */
export function EarlyAccessFeedbackCell({ isMobile }: EarlyAccessFeedbackCellProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  const submit = useCallback(async () => {
    const text = message.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);

    try {
      const res = await fetch('/api/early-access-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          pageUrl: typeof window !== 'undefined' ? window.location.href : '',
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send feedback');
      }

      setSent(true);
      setMessage('');
      setTimeout(() => {
        setSent(false);
        setOpen(false);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSending(false);
    }
  }, [message, sending]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
    if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="
          flex w-full items-center gap-2 rounded-lg border border-sky-300/45
          bg-[#102d4f] px-3 py-2 text-left shadow-[0_0_16px_rgba(96,165,250,0.14)]
          transition-colors duration-150 hover:border-sky-200/70 hover:bg-[#143a63]
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/45
        "
        style={{ fontFamily: 'Gohufont, monospace' }}
      >
        <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-sky-200" />
        <span className="text-[11px] text-sky-100">Early Access Feedback</span>
      </button>

      {mounted && open
        ? createPortal(
            <div
              className="fixed inset-0 z-[10000] flex items-start justify-center bg-black/55 px-4 pt-[calc(env(safe-area-inset-top,0px)+72px)] backdrop-blur-sm sm:items-center sm:pt-4"
              onMouseDown={() => setOpen(false)}
            >
              <div
                className="w-full max-w-[420px] overflow-hidden rounded-xl border border-sky-300/40 bg-[#0b1f36] shadow-2xl shadow-black/60"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-sky-300/20 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-sky-200" />
                    <span
                      className="text-[10px] uppercase tracking-wider text-sky-100"
                      style={{ fontFamily: 'Gohufont, monospace' }}
                    >
                      Send Feedback to Pearl
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-md p-1 text-sky-200/60 transition-colors hover:bg-white/5 hover:text-sky-100"
                    aria-label="Close feedback"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="space-y-2 px-3 py-3">
                  {sent ? (
                    <div
                      className="py-3 text-center text-[10px] text-green-300/90"
                      style={{ fontFamily: 'Gohufont, monospace' }}
                    >
                      Feedback sent. Thank you.
                    </div>
                  ) : (
                    <>
                      <textarea
                        ref={textareaRef}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Tell Pearl what's working, what's broken, or what you'd like to see..."
                        maxLength={2000}
                        rows={isMobile ? 4 : 5}
                        className="
                          w-full resize-none rounded-lg border border-sky-200/20 bg-[#07111f]/90
                          px-2.5 py-2 text-[11px] text-white/85 outline-none
                          placeholder-white/30 transition-colors duration-150
                          focus:border-sky-300/55 focus:ring-1 focus:ring-sky-300/20
                        "
                        style={{ fontFamily: 'Gohufont, monospace', lineHeight: '1.4' }}
                      />

                      {error && (
                        <div className="px-1 text-[10px] text-red-300/80" style={{ fontFamily: 'Gohufont, monospace' }}>
                          {error}
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-white/35" style={{ fontFamily: 'Gohufont, monospace' }}>
                          {message.length}/2000
                        </span>
                        <button
                          type="button"
                          onClick={() => void submit()}
                          disabled={sending || !message.trim()}
                          className="
                            inline-flex items-center gap-1.5 rounded-lg border border-sky-300/45
                            bg-sky-500/25 px-3 py-1.5 text-[10px] font-medium text-sky-100
                            transition-colors hover:border-sky-200/70 hover:bg-sky-500/35
                            disabled:cursor-not-allowed disabled:opacity-30
                          "
                          style={{ fontFamily: 'Gohufont, monospace' }}
                        >
                          {sending ? (
                            <>
                              <div className="h-3 w-3 animate-spin rounded-full border-2 border-sky-200/20 border-t-sky-200" />
                              Sending
                            </>
                          ) : (
                            <>
                              <Send className="h-3 w-3" />
                              Send
                            </>
                          )}
                        </button>
                      </div>

                      <p
                        className="text-[9px] leading-tight text-white/30"
                        style={{ fontFamily: 'Gohufont, monospace' }}
                      >
                        Your feedback goes directly to Pearl. No code runs, it&apos;s just a message.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
