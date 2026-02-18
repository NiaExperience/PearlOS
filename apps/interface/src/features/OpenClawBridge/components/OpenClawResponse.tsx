'use client';

import { useEffect, useRef, useState } from 'react';
import { OPENCLAW_BRIDGE_EVENTS } from '../events';
import type { OpenClawStreamChunk } from '../types';

interface ResponseEntry {
  id: string;
  status: 'streaming' | 'completed' | 'error';
  text: string;
  error?: string;
  timestamp: number;
}

/**
 * Renders streamed OpenClaw task responses in the chat UI.
 * Listens for bridge events and displays accumulated text with a streaming indicator.
 */
export function OpenClawResponse() {
  const [entries, setEntries] = useState<ResponseEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let currentId: string | null = null;

    function onSubmitted(e: Event) {
      const detail = (e as CustomEvent).detail;
      const id = detail?.taskId ?? `task-${Date.now()}`;
      currentId = id;
      setEntries((prev) => [
        ...prev,
        { id, status: 'streaming', text: '', timestamp: Date.now() },
      ]);
    }

    function onChunk(e: Event) {
      const chunk = (e as CustomEvent).detail as OpenClawStreamChunk;
      if (!currentId) return;
      const cid = currentId;
      if (chunk.type === 'text') {
        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === cid
              ? { ...entry, text: entry.text + chunk.content }
              : entry
          )
        );
      }
    }

    function onCompleted() {
      if (!currentId) return;
      const cid = currentId;
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === cid ? { ...entry, status: 'completed' } : entry
        )
      );
      currentId = null;
    }

    function onFailed(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!currentId) return;
      const cid = currentId;
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === cid
            ? { ...entry, status: 'error', error: detail?.error ?? 'Unknown error' }
            : entry
        )
      );
      currentId = null;
    }

    window.addEventListener(OPENCLAW_BRIDGE_EVENTS.TASK_SUBMITTED, onSubmitted);
    window.addEventListener(OPENCLAW_BRIDGE_EVENTS.STREAM_CHUNK, onChunk);
    window.addEventListener(OPENCLAW_BRIDGE_EVENTS.TASK_COMPLETED, onCompleted);
    window.addEventListener(OPENCLAW_BRIDGE_EVENTS.TASK_FAILED, onFailed);

    return () => {
      window.removeEventListener(OPENCLAW_BRIDGE_EVENTS.TASK_SUBMITTED, onSubmitted);
      window.removeEventListener(OPENCLAW_BRIDGE_EVENTS.STREAM_CHUNK, onChunk);
      window.removeEventListener(OPENCLAW_BRIDGE_EVENTS.TASK_COMPLETED, onCompleted);
      window.removeEventListener(OPENCLAW_BRIDGE_EVENTS.TASK_FAILED, onFailed);
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map((entry) => (
        <div
          key={entry.id}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            backgroundColor: entry.status === 'error' ? '#2a1215' : '#1a1a2e',
            border: `1px solid ${entry.status === 'error' ? '#d9534f' : '#333'}`,
            fontFamily: 'monospace',
            fontSize: 13,
            color: '#e0e0e0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 4,
              fontSize: 10,
              color: '#888',
            }}
          >
            <span>🦀 OpenClaw</span>
            {entry.status === 'streaming' && (
              <span style={{ color: '#f0ad4e' }}>● streaming…</span>
            )}
            {entry.status === 'completed' && (
              <span style={{ color: '#5cb85c' }}>✓ done</span>
            )}
            {entry.status === 'error' && (
              <span style={{ color: '#d9534f' }}>✗ error</span>
            )}
          </div>
          {entry.text && <div>{entry.text}</div>}
          {entry.error && (
            <div style={{ color: '#d9534f', marginTop: 4 }}>{entry.error}</div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
