"use client";

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage } from '../components/ChatBubble';

// Use local Next.js API proxy to avoid cross-origin issues on mobile Safari
const BOT_GATEWAY_URL = '';

/** Number of messages to load on initial mount / per page when scrolling up. */
const INITIAL_LIMIT = 10;
const PAGE_SIZE = 10;

/**
 * Strip large HTML blocks that leak from tool call arguments into the text stream.
 * Wonder Canvas scenes generate HTML that sometimes appears in the chat content
 * when the LLM echoes tool arguments as text. This strips those blocks while
 * preserving normal conversational text that may contain minor inline tags.
 */
function stripLeakedHtml(text: string): string {
  // Detect if the text is predominantly HTML (has multiple tags, style blocks, etc.)
  const tagCount = (text.match(/<[a-z][^>]*>/gi) || []).length;
  const hasStyleBlock = /<style[\s>]/i.test(text);
  const hasDivStructure = /<div[\s>]/i.test(text) && /<\/div>/i.test(text);
  const hasDataAction = /data-action=/i.test(text);
  const hasWonderClass = /wonder-/i.test(text) && tagCount > 3;

  // If it looks like a Wonder Canvas HTML block, strip it
  if ((tagCount > 5 && (hasStyleBlock || hasDivStructure)) || hasDataAction || hasWonderClass) {
    const htmlStartMatch = text.match(/^([\s\S]*?)(?:<(?:div|style|section|main|html|body|head)\b)/i);
    const preText = htmlStartMatch?.[1]?.trim() || '';
    const htmlEndMatch = text.match(/<\/(?:div|style|section|main|html|body|head)>[^<]*$/i);
    const postIdx = htmlEndMatch ? (htmlEndMatch.index ?? 0) + htmlEndMatch[0].length : -1;
    const postText = postIdx > 0 ? text.slice(postIdx).replace(/<[^>]+>/g, '').trim() : '';

    const result = [preText, postText].filter(Boolean).join(' ').trim();
    return result || text;
  }

  return text;
}

export function useChatSession() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  /** True while we're fetching an older page (infinite scroll up). */
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  /** Becomes true when the server returns fewer messages than PAGE_SIZE (nothing left). */
  const [hasMore, setHasMore] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  // ─── Initial history load (last N messages) ───
  useEffect(() => {
    if (historyLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BOT_GATEWAY_URL}/api/chat/history?limit=${INITIAL_LIMIT}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data.messages?.length) {
          // If we got nothing, there's no more history to load either
          if (!cancelled) setHasMore(false);
          return;
        }
        const loaded: ChatMessage[] = data.messages.map((m: any) => ({
          id: crypto.randomUUID(),
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
          isStreaming: false,
        }));
        setMessages(loaded);
        // If we got fewer than requested, there's no more history
        if (loaded.length < INITIAL_LIMIT) {
          setHasMore(false);
        }
      } catch {
        // silently fail — start with empty chat
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [historyLoaded]);

  // ─── Load older messages (infinite scroll up) ───
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || messages.length === 0) return;
    setIsLoadingMore(true);
    try {
      // Use the oldest message's timestamp as the "before" cursor
      const oldestTimestamp = messages[0]?.timestamp;
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        ...(oldestTimestamp ? { before: String(oldestTimestamp) } : {}),
      });
      const res = await fetch(`${BOT_GATEWAY_URL}/api/chat/history?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.messages?.length) {
        setHasMore(false);
        return;
      }
      const loaded: ChatMessage[] = data.messages.map((m: any) => ({
        id: crypto.randomUUID(),
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
        isStreaming: false,
      }));
      if (loaded.length < PAGE_SIZE) {
        setHasMore(false);
      }
      // Prepend older messages
      setMessages((prev) => [...loaded, ...prev]);
    } catch {
      // silently fail
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, messages]);

  const sendMessage = useCallback(async (text: string, imageDataUrl?: string) => {
    const trimmed = text.trim();
    if (!trimmed && !imageDataUrl) return;

    // Format content as multimodal if image is present
    let userContent: string | any[];
    if (imageDataUrl) {
      userContent = [
        ...(trimmed ? [{ type: 'text', text: trimmed }] : []),
        { type: 'image_url', image_url: { url: imageDataUrl } }
      ];
    } else {
      userContent = trimmed;
    }

    // Add user message (display text only in UI, full content sent to API)
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed || '[Image]',
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    // Build conversation history for the API
    const history = [...messages, userMsg].map((m, idx) => {
      // Only the last message (current one) gets the image
      if (idx === messages.length && imageDataUrl) {
        return { role: m.role, content: userContent };
      }
      return { role: m.role, content: m.content };
    });

    // Create assistant placeholder
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    };
    setMessages((prev) => [...prev, assistantMsg]);

    // Abort any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${BOT_GATEWAY_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Chat API error: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              // Bridge returns { type: 'text', content: '...' } format
              // Also support raw OpenAI { choices: [{ delta: { content } }] }
              const choice = parsed.choices?.[0];
              if (choice?.delta?.tool_calls || choice?.finish_reason === 'tool_calls') {
                continue;
              }
              const delta = parsed.type === 'text' ? parsed.content : choice?.delta?.content;
              if (delta) {
                accumulated += delta;
                const cleaned = stripLeakedHtml(accumulated);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: cleaned, isStreaming: true }
                      : m
                  )
                );
              }
            } catch {
              // non-JSON line, skip
            }
          }
        }
      }

      // Finalize
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: stripLeakedHtml(m.content), isStreaming: false }
            : m
        )
      );
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "Hmm, I couldn't connect right now. Try again? 🤍", isStreaming: false }
            : m
        )
      );
    } finally {
      setIsTyping(false);
    }
  }, [messages]);

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setIsTyping(false);
    setHasMore(true);
    // Note: we intentionally do NOT reset historyLoaded here.
    // Resetting it would trigger the history load effect, re-fetching messages
    // and causing the chat to re-open after the user explicitly closed it.
    // History will be re-fetched on next component remount (e.g. navigation).
  }, []);

  return { messages, isTyping, historyLoaded, isLoadingMore, hasMore, loadMore, sendMessage, clearMessages };
}
