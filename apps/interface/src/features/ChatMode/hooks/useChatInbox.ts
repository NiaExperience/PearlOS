'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface InboxMessage {
  id: string;
  ts: string;
  role: 'assistant';
  content: string;
  kind: string;
  task_id?: string | null;
  task_title?: string | null;
}

const POLL_INTERVAL_MS = 8000;

/**
 * Polls `/api/chat/inbox` for unread messages that Pearl has pushed into the
 * user's text chat (e.g. replies to task questions from the ActiveJobs widget).
 *
 * Callers use:
 *   - `unreadCount` to render the blue badge on the chat button.
 *   - `consume()` to atomically drain the unread list when the chat panel
 *     opens — the returned messages should be inserted into chat state, and
 *     `markRead()` should be fired so the backend stops returning them.
 */
export function useChatInbox() {
  const [unread, setUnread] = useState<InboxMessage[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchInbox = useCallback(async () => {
    try {
      const r = await fetch('/api/chat/inbox', { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      const messages: InboxMessage[] = Array.isArray(data?.messages) ? data.messages : [];
      setUnread(messages);
    } catch {
      // Non-fatal: inbox is best-effort.
    }
  }, []);

  const markRead = useCallback(async (ids?: string[]) => {
    try {
      await fetch('/api/chat/inbox/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { ids } : {}),
      });
    } catch {
      // Non-fatal; next poll will still return the messages.
    }
  }, []);

  /** Atomically drain the unread list and clear local state. */
  const consume = useCallback((): InboxMessage[] => {
    let drained: InboxMessage[] = [];
    setUnread((prev) => {
      drained = prev;
      return [];
    });
    return drained;
  }, []);

  useEffect(() => {
    void fetchInbox();
    pollRef.current = setInterval(() => { void fetchInbox(); }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchInbox]);

  return {
    unread,
    unreadCount: unread.length,
    fetchInbox,
    consume,
    markRead,
  };
}
