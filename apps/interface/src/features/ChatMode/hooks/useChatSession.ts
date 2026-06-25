"use client";

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import type { ChatMessage } from '../components/ChatBubble';
import type { ChatReaction, ChatReactionEmoji } from '../components/ChatBubble';
import {
  executeChatTool,
  getLastChatCanvasOpenTs,
  handleAssistantCanvasMarkup,
  handleLocalCanvasFollowupPrompt,
  preserveVisualSearchIntent,
  rescueMissingVisualCanvas,
  shouldUseVisualCanvasFastPath,
  stripAssistantCanvasMarkup,
} from '../lib/chat-tool-handlers';
import {
  buildChatToolIdempotencyKey,
  buildChatToolTurnKey,
  runIdempotentChatTool,
} from '../lib/chat-tool-idempotency';
import {
  buildUserTurnContent,
  chatMessageContentText,
  type ChatApiContent,
  type ChatApiMessage,
} from '../lib/multimodal-content';
import { sanitizeAssistantText, detectTextBodyToolCalls } from '../lib/sanitize-assistant-text';

// Use local Next.js API proxy to avoid cross-origin issues on mobile Safari
const BOT_GATEWAY_URL = '';

/** Number of messages to load on initial mount / per page when scrolling up. */
const INITIAL_LIMIT = 50;
const PAGE_SIZE = 10;

// All registered tool names in chat-tool-handlers.ts TOOL_HANDLERS + aliases
const ALL_TOOL_NAMES = [
  'bot_web_search', 'bot_web_fetch', 'bot_get_public_profile',
  'bot_wonder_canvas_template', 'bot_wonder_canvas_scene', 'bot_wonder_canvas_clear',
  'pearl_canvas',
  'bot_get_weather', 'bot_onboarding_complete',
  'bot_create_note', 'bot_update_note', 'bot_open_note', 'bot_open_notes',
  'bot_open_files', 'bot_open_terminal', 'bot_open_news', 'bot_open_youtube', 'bot_open_creation_engine',
  'bot_close_terminal', 'bot_close_notes', 'bot_close_youtube',
  'bot_close_applet_creation_engine', 'bot_close_browser_window',
  'bot_switch_desktop_mode', 'bot_switch_layout_mode',
  'bot_customize_interface',
  'bot_list_tasks',
  'bot_openclaw_task',
];
const DIRECT_TOOL_RE = new RegExp(`^call\\s+(${ALL_TOOL_NAMES.join('|')})(\\s|$|\\.)`, 'i');
const NOTE_TOOL_NAMES = new Set(['bot_create_note', 'bot_update_note', 'bot_open_note', 'bot_open_notes']);

const TOOL_RESULT_FINALIZER_PROMPT = [
  'You are Pearl replying in web chat after tools ran.',
  'Use the tool results as private context and answer the user directly.',
  'Do not mention tool calls, searches, browser checks, sampled sources, raw citations, or implementation details.',
  'Do not answer with only "Done." unless the user asked for a simple UI action and no explanation is needed.',
  'When a Wonder Canvas result is present, write one to three useful companion sentences for the visual. The canvas carries the visual; your chat reply should explain the takeaway or what changed.',
  'Never use a bare completion like "Done.", "Opened.", or "Ready." for a visual timeline, chart, infographic, or canvas scene.',
  'If the user asked what something is, explain what it is first, then give practical benefits, uses, risks, and quality caveats when relevant.',
].join(' ');

function isWeakToolOnlyReply(text: string): boolean {
  const normalized = sanitizeAssistantText(stripLeakedHtml(text)).trim().toLowerCase();
  if (!normalized) return true;
  return /^(?:done|done\.|ok|okay|okay\.|ready|ready\.|opened|opened\.|displayed|displayed\.|cleared|cleared\.)$/.test(normalized);
}

function isCompanionReadyToolResult(text: string): boolean {
  return /\[\[pearl:companion-ready\]\]/i.test(text);
}

function stripCompanionReadyMarker(text: string): string {
  return text.replace(/\s*\[\[pearl:companion-ready\]\]\s*/gi, '').trim();
}

function stripProcessNarration(text: string): string {
  let next = text;
  for (let i = 0; i < 4; i += 1) {
    const stripped = next.replace(
      /^\s*(?:(?:let me|i(?:'ll| will| am going to)|i need to|checking|looking|grabbing|pulling)\b[^.!?\n]*(?:[.!?]+|\n+)?\s*)/i,
      '',
    );
    if (stripped === next) break;
    next = stripped;
  }
  return next.trim();
}

function toolResultsNeedFinalAnswer(results: string[]): boolean {
  return results.some((result) => {
    const text = stripCompanionReadyMarker(result.trim());
    if (isCompanionReadyToolResult(result)) return false;
    if (!text) return false;
    if (/^(?:Done\.|Cleared Wonder Canvas\.)$/i.test(text)) return false;
    if (/^I checked PearlOS tasks\b/i.test(text) || /^I checked the PearlOS task queue\b/i.test(text)) return true;
    if (/^(?:Opening|Opened|Closed|Switched|Updated|Created|Onboarding marked|Got it\.)/i.test(text)) {
      return false;
    }
    return true;
  });
}

function looksLikeRawInformationalToolOutput(text: string): boolean {
  const cleaned = sanitizeAssistantText(stripLeakedHtml(text)).trim();
  if (!cleaned) return false;
  if (/\b(?:Page excerpt|Canvas summary|Visible canvas text)\s*:/i.test(cleaned)) return true;
  if (/\b(?:search results?|sources?\s+sampled|top sources|source\s*:|summary\s*:|snippet\s*:|url\s*:|result\s+\d+\s*:)\b/i.test(cleaned)) return true;
  if (/https?:\/\//i.test(cleaned)) return true;
  const colonSegments = cleaned.match(/\b[A-Z][^.!?\n]{8,90}:\s[^.!?\n]{18,}/g) || [];
  return colonSegments.length >= 2;
}

function safeInformationalToolFallback(results: string[]): string {
  const safeText = results
    .map((result) => stripCompanionReadyMarker(sanitizeAssistantText(stripLeakedHtml(result))).trim())
    .filter((result) => result && !looksLikeRawInformationalToolOutput(result))
    .join('\n\n');
  if (safeText) return safeText;
  return "I found relevant context, but I couldn't synthesize it cleanly enough to answer without risking a messy source dump.";
}

function hasExplicitNoteIntent(text: string): boolean {
  return /\b(note|notes|notepad|write this down|save this|save that|keep this in notes|make a note|create a note|open notes?|show notes?|update notes?|add to notes?)\b/i
    .test(text);
}

function hasExplicitCanvasClearIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return /^(?:please\s+|can you\s+|could you\s+|would you\s+)?(?:clear|close|dismiss|remove|hide)\s+(?:the\s+)?(?:wonder\s+)?canvas\b/.test(normalized)
    || /\b(?:please|can you|could you|would you|go ahead|actually|now)\b[^.!?]{0,80}\b(?:clear|close|dismiss|remove|hide)\s+(?:the\s+)?(?:wonder\s+)?canvas\b/.test(normalized);
}

function hasExplicitTaskIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (/^\s*call\s+bot_openclaw_task\b/i.test(text)) return true;
  return /\b(?:start|create|open|queue|dispatch|send|assign|run)\s+(?:an?\s+)?(?:agency|openclaw|codex|fable|task|job)\b/i.test(normalized)
    || /\b(?:have|ask|tell)\s+(?:codex|fable|claude|the agency|an agent|agents?)\b/i.test(normalized)
    || /\b(?:fix|repair|debug|implement|deploy|push|ship)\b[^.!?]{0,80}\b(?:bug|issue|feature|build|prod|production|staging|code)\b/i.test(normalized);
}

function redirectUnexpectedNoteToolToChat(toolName: string, args: Record<string, unknown>): string {
  const content = String(args.content || args.text || args.summary || args.body || '').trim();
  if (content) return content;
  const title = String(args.title || args.name || '').trim();
  if (title && toolName !== 'bot_open_notes') {
    return `I kept this in chat instead of opening Notes: ${title}`;
  }
  return 'I kept this in chat instead of opening Notes.';
}

function parseDirectToolCall(text: string): { name: string; args: Record<string, unknown> } | null {
  const trimmed = text.trim();

  // ── Pattern A: "call bot_xyz arg=val ..." ──
  const callMatch = trimmed.match(DIRECT_TOOL_RE);
  if (callMatch) {
    const name = callMatch[1].toLowerCase();
    const args: Record<string, unknown> = {};
    const rest = trimmed.slice(callMatch[0].length);

    // key=value pairs
    const kvRe = /(\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/g;
    let m: RegExpExecArray | null;
    while ((m = kvRe.exec(rest)) !== null) {
      let val: string = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      args[m[1]] = val;
    }

    // Heuristic argument extraction for common patterns
    if (name === 'bot_get_weather' && !args.location) {
      const locMatch = trimmed.match(/\bfor\s+(.+?)(?:\s+and\b|\.?$)/i);
      if (locMatch?.[1]) args.location = locMatch[1].replace(/[.?!]$/, '').trim();
    }
    if ((name === 'bot_open_note' || name === 'bot_create_note' || name === 'bot_update_note') && !args.title) {
      const titleMatch = trimmed.match(/\btitled\s+["']?(.+?)["']?(?:\.|$)/i);
      if (titleMatch?.[1]) args.title = titleMatch[1].trim();
    }
    if ((name === 'bot_create_note' || name === 'bot_update_note') && args.content === undefined) {
      const contentMatch = trimmed.match(/\bcontent\s+["']([^"']*)["']/i);
      if (contentMatch?.[1] != null) args.content = contentMatch[1];
    }
    if (name === 'bot_web_search' && !args.query) {
      const queryMatch = trimmed.match(/\b(?:for|query|search)\s+["']?(.+?)["']?(?:\.|$)/i);
      if (queryMatch?.[1]) args.query = queryMatch[1].trim();
    }
    if (name === 'bot_open_files' && !args.query && !args.fileSearchQuery) {
      const queryMatch = trimmed.match(/\b(?:for|query|search|find|locate)\s+["']?(.+?)["']?(?:\.|$)/i);
      const restText = rest.trim();
      if (queryMatch?.[1]) args.query = queryMatch[1].trim();
      else if (restText && !restText.includes('=')) args.query = restText.replace(/[.?!]$/, '').trim();
    }
    if (name === 'bot_openclaw_task' && !args.task) {
      const taskMatch = trimmed.match(/\btask\s+["']?(.+?)["']?(?:\.|$)/i);
      if (taskMatch?.[1]) args.task = taskMatch[1].trim();
    }
    if (name === 'bot_customize_interface') {
      const restText = rest.trim();
      const lower = restText.toLowerCase();
      const hasThemeIntent = /\b(theme|ui|interface|appearance|look|style|skin)\b/.test(lower);
      const hasIconIntent = /\b(icon|icons)\b/.test(lower);
      const hasBackgroundIntent = /\b(background|wallpaper|home screen|desktop screen)\b/.test(lower);
      const themeMatch = (hasThemeIntent || (!hasIconIntent && !hasBackgroundIntent))
        ? lower.match(/\b(pixel|glass|professional|calm)\b/)
        : null;
      if (themeMatch?.[1] && !args.theme) args.theme = themeMatch[1];
      if (!args.action) {
        if (hasBackgroundIntent) args.action = 'background';
        else if (hasIconIntent) args.action = 'icons';
        else if (args.theme || hasThemeIntent) args.action = 'theme';
        else args.action = 'all';
      }
      if (!args.target) {
        if (/\bhome\b/.test(lower)) args.target = 'home';
        else if (/\bdesktop|work screen\b/.test(lower)) args.target = 'desktop';
        else args.target = 'both';
      }
      if (!args.description && !args.backgroundDescription && !args.iconDescription) {
        const descriptionMatch = restText.match(/\b(?:to|with|as)\s+["']?(.+?)["']?(?:\.|$)/i);
        if (descriptionMatch?.[1]) args.description = descriptionMatch[1].trim();
      }
    }
    if ((name.startsWith('bot_open_') || name.startsWith('bot_close_')) && !args.app) {
      const appHint = name.replace(/^bot_(?:open|close)_/, '');
      if (appHint) args.app = appHint;
    }

    return { name, args };
  }

  // ── Pattern B: JSON tool_call embedded in text body ──
  const jsonToolCallMatch = trimmed.match(/\{[^{}]*"tool_call"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^}]+\}[^{}]*\}/i)
    || trimmed.match(/\{[^{}]*"name"\s*:\s*"(bot_[a-z0-9_]+)"[^{}]*"arguments"\s*:\s*\{[^}]+\}[^{}]*\}/i)
    || trimmed.match(/\{[^{}]*"tool"\s*:\s*"(bot_[a-z0-9_]+)"[^{}]*\}/i);
  if (jsonToolCallMatch) {
    try {
      const parsed = JSON.parse(jsonToolCallMatch[0]);
      const toolName = parsed.tool_call || parsed.name || parsed.tool || '';
      if (toolName && ALL_TOOL_NAMES.includes(toolName.toLowerCase())) {
        const args = parsed.arguments || parsed.args || parsed.params || {};
        console.log('[parseDirectToolCall] Detected JSON tool_call in text body:', toolName);
        return { name: toolName.toLowerCase(), args };
      }
    } catch {
      // Malformed JSON — fall through
    }
  }

  return null;
}

/** Schema-versioned localStorage cache so stale shapes don't poison reloads.
 *  Scoped per-user — see `historyCacheKey()`. The legacy unscoped key
 *  ('pearl-chat-history-v1') is intentionally cleared on first run so a
 *  shared browser never replays one user's transcript into another's session. */
const HISTORY_CACHE_PREFIX = 'pearl-chat-history-v1';
const LEGACY_HISTORY_CACHE_KEY = 'pearl-chat-history-v1';
const HISTORY_CACHE_MAX = 50;
const REACTION_ACTORS = new Set<ChatReaction['by']>(['user', 'assistant']);

function normalizeReactions(value: unknown): ChatReaction[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const reactions = value.filter((reaction): reaction is ChatReaction => (
    reaction != null &&
    typeof reaction === 'object' &&
    typeof (reaction as ChatReaction).emoji === 'string' &&
    (reaction as ChatReaction).emoji.trim().length > 0 &&
    (reaction as ChatReaction).emoji.length <= 32 &&
    REACTION_ACTORS.has((reaction as ChatReaction).by)
  )).map((reaction) => ({
    ...reaction,
    emoji: reaction.emoji.trim(),
  }));
  return reactions.length ? reactions : undefined;
}

function normalizeFileAttachments(
  fileAttachments?: ChatMessage['fileAttachments'] | ChatMessage['fileAttachment'],
): NonNullable<ChatMessage['fileAttachment']>[] {
  if (!fileAttachments) return [];
  return Array.isArray(fileAttachments) ? fileAttachments.filter(Boolean) : [fileAttachments];
}

function pearlReactionForUserTurn(
  text: string,
  imageDataUrl?: string,
  fileAttachments?: ChatMessage['fileAttachments'] | ChatMessage['fileAttachment'],
): ChatReaction[] | undefined {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  let emoji: string | null = null;
  if (imageDataUrl || normalizeFileAttachments(fileAttachments).length) emoji = '👀';
  else if (/\b(thanks|thank you|appreciate)\b/.test(lower)) emoji = '❤️';
  else if (/(haha|lol|😂|😆|funny)/i.test(text)) emoji = '😂';
  else if (/\b(done|fixed|works|great|perfect|nice|awesome|amazing)\b/.test(lower)) emoji = '🎉';
  else if (/\b(yes|yeah|yep|ok|okay|sure|got it|sounds good)\b/.test(lower)) emoji = '👍';
  else if (trimmed.length > 0 && (/[?!]$/.test(trimmed) || /\b(can you|could you|would you|please|help|show me|find|what|why|how|where|when)\b/.test(lower))) emoji = '👀';
  else if (trimmed.length > 0 && trimmed.length <= 120) emoji = '👍';
  else if (trimmed.length > 0) emoji = '👀';
  if (!emoji) return undefined;
  return [{ by: 'assistant', emoji }];
}

function historyCacheKey(userId: string | null): string | null {
  if (!userId) return null;
  return `${HISTORY_CACHE_PREFIX}:${userId}`;
}

function loadCachedHistory(userId: string | null): ChatMessage[] | null {
  if (typeof window === 'undefined') return null;
  const key = historyCacheKey(userId);
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.messages)) return null;
    return parsed.messages.map((m: ChatMessage) => ({
      ...m,
      content: m.role === 'assistant' ? sanitizeAssistantText(stripLeakedHtml(m.content)) : m.content,
      isStreaming: false,
      reactions: normalizeReactions(m.reactions),
    })) as ChatMessage[];
  } catch {
    return null;
  }
}

function saveCachedHistory(userId: string | null, messages: ChatMessage[]): void {
  if (typeof window === 'undefined') return;
  const key = historyCacheKey(userId);
  if (!key) return;
  try {
    const tail = messages.slice(-HISTORY_CACHE_MAX).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.role === 'assistant' && typeof m.content === 'string'
        ? sanitizeAssistantText(stripLeakedHtml(m.content))
        : typeof m.content === 'string' ? m.content : '',
      timestamp: m.timestamp,
      isStreaming: false,
      imageUrl: m.imageUrl,
      fileAttachment: m.fileAttachment,
      fileAttachments: m.fileAttachments,
      reactions: m.reactions?.length ? m.reactions : undefined,
    }));
    window.localStorage.setItem(
      key,
      JSON.stringify({ messages: tail, cachedAt: Date.now() })
    );
  } catch {
    // Quota or serialization failure — swallow, non-critical.
  }
}

/** Drop the legacy unscoped cache once on app boot. Older builds wrote
 *  history to `pearl-chat-history-v1` regardless of user, which is how a
 *  test/QA account's chat could leak into Blair's session on the same
 *  browser. */
function purgeLegacyCache(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_HISTORY_CACHE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Merge two message lists, ordered by timestamp and deduped by
 * (role + content + timestamp-second) since IDs are regenerated on every load
 * and can't be used as identity across cache↔API boundaries.
 */
function mergeMessages(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const fingerprint = (m: ChatMessage) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return `${m.role}|${content}|${Math.floor((m.timestamp || 0) / 1000)}`;
  };
  const seen = new Set<string>();
  const merged: ChatMessage[] = [];
  for (const m of [...a, ...b]) {
    const key = fingerprint(m);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(m);
  }
  merged.sort((x, y) => (x.timestamp || 0) - (y.timestamp || 0));
  return merged;
}

/**
 * Strip large HTML blocks that leak from tool call arguments into the text stream.
 * Wonder Canvas scenes generate HTML that sometimes appears in the chat content
 * when the LLM echoes tool arguments as text. This strips those blocks while
 * preserving normal conversational text that may contain minor inline tags.
 *
 * Perf: callers pass the FULL accumulated stream on every token delta, which
 * makes naive regex evaluation O(n) per delta and O(n²) per response. The
 * cheap `< not present` gate below short-circuits the common case (plain
 * conversational text) so the expensive alternation regex only runs when
 * there's something tag-like to strip. See SPECTRUM bug #2/#3.
 */
function stripLeakedHtml(text: string): string {
  // Cheap O(1) gate: most chat responses contain no HTML at all. Scanning
  // for a single '<' character is orders of magnitude faster than running
  // the seven-pattern alternation below across an ever-growing buffer.
  if (text.indexOf('<') === -1) return text;
  // Detect if the text is predominantly HTML (has multiple tags, style blocks, etc.)
  const tagCount = (text.match(/<[a-z][^>]*>/gi) || []).length;
  const hasStyleBlock = /<style[\s>]/i.test(text);
  const hasDivStructure = /<div[\s>]/i.test(text) && /<\/div>/i.test(text);
  const hasDataAction = /data-action=/i.test(text);
  const hasWonderClass = /wonder-/i.test(text) && tagCount > 3;
  // Catch inline-styled HTML blocks (common in wonder canvas scenes)
  const hasInlineStyles = /style\s*=\s*["'][^"']*(?:background|gradient|display\s*:\s*flex|min-height|font-size)/i.test(text);
  const hasHtmlBoilerplate = /<!DOCTYPE|<html|<head|<body/i.test(text);

  // If it looks like a Wonder Canvas HTML block or any substantial HTML, strip it
  if (
    (tagCount > 5 && (hasStyleBlock || hasDivStructure)) ||
    (tagCount > 2 && hasInlineStyles) ||
    hasDataAction ||
    hasWonderClass ||
    hasHtmlBoilerplate
  ) {
    const htmlStartMatch = text.match(/^([\s\S]*?)(?:<(?:!DOCTYPE|div|style|section|main|html|body|head)\b)/i);
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
  const { data: session } = useSession();
  const userId = session?.user?.email ? session.user.email.toLowerCase() : null;
  const sessionUserId = (session?.user as Record<string, unknown> | null | undefined)?.id;
  const sessionId =
    (session as Record<string, unknown> | null | undefined)?.sessionId ||
    (session?.user as Record<string, unknown> | null | undefined)?.sessionId;
  const userIdRef = useRef<string | null>(userId);
  const toolScopeRef = useRef({
    userId: typeof sessionUserId === 'string' ? sessionUserId : userId,
    sessionId: typeof sessionId === 'string' ? sessionId : null,
  });
  // Seed from localStorage synchronously so a reload doesn't flash empty while
  // /api/chat/history is in flight. The cache is per-user — anonymous sessions
  // never get a seed, so test/QA messages cannot leak into a real user's chat.
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window !== 'undefined') purgeLegacyCache();
    return loadCachedHistory(userIdRef.current) ?? [];
  });
  const [isTyping, setIsTyping] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  /** True while we're fetching an older page (infinite scroll up). */
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  /** Becomes true when the server returns fewer messages than PAGE_SIZE (nothing left). */
  const [hasMore, setHasMore] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  // Mirror `messages` so sendMessage can read the latest transcript without
  // listing it in its useCallback deps. Without this, sendMessage rebuilt on
  // every message delta during streaming, which churned downstream memo
  // dependencies and added per-token re-render work.
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    toolScopeRef.current = {
      userId: typeof sessionUserId === 'string' ? sessionUserId : userId,
      sessionId: typeof sessionId === 'string' ? sessionId : null,
    };
  }, [sessionUserId, sessionId, userId]);

  // ─── User changed (login / logout / account switch) ───
  // Drop the in-memory transcript and re-hydrate from the new user's cache so
  // we never display the previous session's messages.
  useEffect(() => {
    if (userIdRef.current === userId) return;
    userIdRef.current = userId;
    abortRef.current?.abort();
    setMessages(loadCachedHistory(userId) ?? []);
    setHistoryLoaded(false);
    setHasMore(true);
  }, [userId]);

  // ─── Persist messages to localStorage so history survives reloads even if
  // the server-side transcript session rotates or becomes unreachable.
  useEffect(() => {
    if (messages.length === 0) return;
    // Skip while a message is still streaming; wait for final content.
    if (messages.some((m) => m.isStreaming)) return;
    saveCachedHistory(userIdRef.current, messages);
  }, [messages]);

  // ─── Initial history load (last N messages) ───
  useEffect(() => {
    if (historyLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BOT_GATEWAY_URL}/api/chat/history?limit=${INITIAL_LIMIT}`, {
          credentials: 'same-origin',
        });
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
          content: m.role === 'assistant' ? sanitizeAssistantText(stripLeakedHtml(m.content)) : m.content,
          timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
          isStreaming: false,
          reactions: normalizeReactions(m.reactions),
        }));
        // Merge with what's already in state (seeded from localStorage on
        // mount) so a tab close/reopen on mobile can never lose messages just
        // because the upstream session window only returns the most recent N.
        // Server messages newer than the cache get added; cached messages the
        // server doesn't return are kept.
        setMessages((prev) => mergeMessages(prev, loaded));
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

  // ─── Mobile-tab-restore safety net ───
  // iOS Safari (and Android Chrome) aggressively suspend or kill background
  // tabs to free memory. When the user taps a Pearl notification and returns:
  //   • Sometimes React state is preserved (bfcache: pageshow.persisted=true)
  //   • Sometimes the page cold-starts and loadCachedHistory() seeds state
  //   • Sometimes a partial restore leaves us with empty state even though the
  //     localStorage cache is intact
  // To guarantee the user always sees their conversation on return, we
  // re-hydrate from localStorage whenever the page becomes visible again,
  // merging the cache into whatever state we currently hold.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const rehydrate = () => {
      const cached = loadCachedHistory(userIdRef.current);
      if (!cached || cached.length === 0) return;
      setMessages((prev) => {
        if (prev.length === 0) return cached;
        const lastPrev = prev[prev.length - 1];
        const lastCached = cached[cached.length - 1];
        if (
          prev.length >= cached.length &&
          lastPrev?.timestamp === lastCached?.timestamp &&
          lastPrev?.role === lastCached?.role
        ) {
          return prev;
        }
        return mergeMessages(prev, cached);
      });
    };
    const onPageShow = () => rehydrate();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') rehydrate();
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // ─── Flush cache before the OS suspends or kills the tab ───
  // Mobile Safari does not reliably fire 'unload', but 'pagehide' and the
  // visibilitychange→hidden transition do — write the latest transcript while
  // we still can so the next mount has up-to-date messages to rehydrate from.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const flush = () => {
      if (messages.length === 0) return;
      if (messages.some((m) => m.isStreaming)) return;
      saveCachedHistory(userIdRef.current, messages);
    };
    const onPageHide = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [messages]);

  // ─── Load older messages (infinite scroll up) ───
  const loadMore = useCallback(async () => {
    const current = messagesRef.current;
    if (isLoadingMore || !hasMore || current.length === 0) return;
    setIsLoadingMore(true);
    try {
      // Use the oldest message's timestamp as the "before" cursor
      const oldestTimestamp = current[0]?.timestamp;
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        ...(oldestTimestamp ? { before: String(oldestTimestamp) } : {}),
      });
      const res = await fetch(`${BOT_GATEWAY_URL}/api/chat/history?${params}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.messages?.length) {
        setHasMore(false);
        return;
      }
      const loaded: ChatMessage[] = data.messages.map((m: any) => ({
        id: crypto.randomUUID(),
        role: m.role as 'user' | 'assistant',
        content: m.role === 'assistant' ? sanitizeAssistantText(stripLeakedHtml(m.content)) : m.content,
        timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
        isStreaming: false,
        reactions: normalizeReactions(m.reactions),
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
  }, [isLoadingMore, hasMore]);

  const sendMessage = useCallback(async (
    text: string,
    imageDataUrl?: string,
    attachmentContext?: string,
    fileAttachments?: ChatMessage['fileAttachments'] | ChatMessage['fileAttachment'],
  ) => {
    const trimmed = text.trim();
    if (!trimmed && !imageDataUrl && !attachmentContext) return;
    const textWithAttachment = [trimmed, attachmentContext].filter(Boolean).join('\n\n');
    const normalizedFileAttachments = normalizeFileAttachments(fileAttachments);
    const primaryFileAttachment = normalizedFileAttachments[0];
    const canvasBaselineTs = getLastChatCanvasOpenTs();

    const userContent: ChatApiContent = buildUserTurnContent(textWithAttachment, imageDataUrl);

    // Add user message (display text + image in UI, full content sent to API)
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed || (attachmentContext ? 'Attached file' : ''),
      timestamp: Date.now(),
      imageUrl: imageDataUrl,
      fileAttachment: primaryFileAttachment,
      fileAttachments: normalizedFileAttachments.length ? normalizedFileAttachments : undefined,
      reactions: pearlReactionForUserTurn(trimmed, imageDataUrl, normalizedFileAttachments),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    // Build conversation history for the API. Read from the ref so we
    // pick up the latest transcript without sendMessage having `messages`
    // in its dep array.
    const currentMessages = messagesRef.current;
    const history: ChatApiMessage[] = [...currentMessages, userMsg].map((m, idx) => {
      // Include userContent (with file context) for the current message
      // when any attachment exists: image, file, or both.
      if (idx === currentMessages.length && (imageDataUrl || attachmentContext)) {
        return { role: m.role, content: userContent };
      }
      if (m.role === 'user' && m.imageUrl) {
        return { role: m.role, content: buildUserTurnContent(chatMessageContentText(m.content), m.imageUrl) };
      }
      return { role: m.role, content: chatMessageContentText(m.content) };
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

    const toolTurnKey = buildChatToolTurnKey({
      text: textWithAttachment,
      hasImage: !!imageDataUrl,
      files: normalizedFileAttachments.map((attachment) => ({
        filename: attachment.filename,
        originalName: attachment.originalName,
        mime: attachment.mime,
        bytes: attachment.bytes,
      })),
    });
    const executeToolOnce = (toolName: string, args: Record<string, unknown>) => {
      const normalizedToolName = toolName.toLowerCase();
      if (!ALL_TOOL_NAMES.includes(normalizedToolName)) {
        console.warn('[useChatSession] ignored unknown streamed tool', { toolName: normalizedToolName });
        return Promise.resolve('');
      }
      const guardedArgs = normalizedToolName === 'bot_web_search'
        ? preserveVisualSearchIntent(args, textWithAttachment)
        : args;
      if (NOTE_TOOL_NAMES.has(normalizedToolName) && !hasExplicitNoteIntent(textWithAttachment)) {
        console.warn('[useChatSession] blocked note tool without explicit note intent', { toolName: normalizedToolName });
        return Promise.resolve(redirectUnexpectedNoteToolToChat(normalizedToolName, guardedArgs));
      }
      if (normalizedToolName === 'bot_wonder_canvas_clear' && !hasExplicitCanvasClearIntent(textWithAttachment)) {
        console.warn('[useChatSession] blocked canvas clear without explicit clear intent');
        return Promise.resolve('I left the canvas open because you were reporting a display problem, not asking me to clear the visual.');
      }
      if (normalizedToolName === 'bot_openclaw_task' && !hasExplicitTaskIntent(textWithAttachment)) {
        console.warn('[useChatSession] blocked Agency task tool without explicit task intent');
        return Promise.resolve('I did not start an Agency task because this request is a chat or visual answer, not engineering work.');
      }
      const scope = toolScopeRef.current;
      const key = buildChatToolIdempotencyKey({
        userId: scope.userId,
        sessionId: scope.sessionId,
        turnKey: toolTurnKey,
        toolName: normalizedToolName,
        args: guardedArgs,
      });
      return runIdempotentChatTool(key, () => executeChatTool(normalizedToolName, guardedArgs));
    };
    const fetchFinalAnswerFromToolResults = async (toolResults: string[]): Promise<string> => {
      const packedResults = toolResults
        .map((result) => sanitizeAssistantText(stripLeakedHtml(result)).trim())
        .filter(Boolean);
      if (!packedResults.length) return '';

      const finalizerMessages: ChatApiMessage[] = [
        { role: 'system', content: TOOL_RESULT_FINALIZER_PROMPT },
        ...history.slice(-10),
        {
          role: 'user',
          content: [
            'Answer my last request using these tool results as private context.',
            'Do not repeat the raw tool output.',
            '',
            packedResults.map((result, index) => `Tool result ${index + 1}:\n${result}`).join('\n\n'),
          ].join('\n'),
        },
      ];

      try {
        const res = await fetch(`${BOT_GATEWAY_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: finalizerMessages,
            disable_tools: true,
            finalize_tool_results: true,
          }),
          signal: abortRef.current?.signal,
          credentials: 'same-origin',
        });
        if (!res.ok || !res.body) return '';

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let answer = '';
        const consumeLine = (line: string) => {
          if (!line.startsWith('data: ')) return;
          const data = line.slice(6);
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            const delta = parsed.type === 'text' ? parsed.content : choice?.delta?.content;
            if (delta) answer += delta;
          } catch {
            // Ignore malformed SSE fragments; the primary tool result remains available as fallback.
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) consumeLine(line);
        }
        buffer += decoder.decode();
        if (buffer) consumeLine(buffer);
        return sanitizeAssistantText(stripLeakedHtml(stripAssistantCanvasMarkup(answer))).trim();
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        console.warn('[useChatSession] tool-result finalizer failed:', err);
        return '';
      }
    };

    const directToolCall = parseDirectToolCall(trimmed);
    if (directToolCall) {
      const result = await executeToolOnce(directToolCall.name, directToolCall.args);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: stripCompanionReadyMarker(sanitizeAssistantText(stripLeakedHtml(result))), isStreaming: false }
            : m
        )
      );
      setIsTyping(false);
      return;
    }

    const previousAssistantText = [...currentMessages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.content.trim())
      ?.content || '';
    const localCanvasFollowupReply = !imageDataUrl && !attachmentContext
      ? await handleLocalCanvasFollowupPrompt(trimmed, previousAssistantText)
      : null;
    if (localCanvasFollowupReply) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: sanitizeAssistantText(stripLeakedHtml(localCanvasFollowupReply)), isStreaming: false }
            : m
        )
      );
      setIsTyping(false);
      return;
    }

    if (!imageDataUrl && !attachmentContext && shouldUseVisualCanvasFastPath(trimmed)) {
      const fastPathBaselineTs = getLastChatCanvasOpenTs();
      const result = await executeToolOnce('bot_web_search', { query: trimmed, count: 5 });
      const openedCanvas = getLastChatCanvasOpenTs() > fastPathBaselineTs;
      const cleanedResult = stripCompanionReadyMarker(stripProcessNarration(sanitizeAssistantText(stripLeakedHtml(result))));
      if (openedCanvas && cleanedResult && !/^Error:/i.test(cleanedResult)) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: cleanedResult, isStreaming: false }
              : m
          )
        );
        setIsTyping(false);
        return;
      }
    }

    // Abort any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const requestBody: {
        messages: ChatApiMessage[];
        attachments?: NonNullable<ChatMessage['fileAttachment']>[];
        fileContexts?: string[];
      } = { messages: history };
      if (normalizedFileAttachments.length) requestBody.attachments = normalizedFileAttachments;
      if (attachmentContext) requestBody.fileContexts = [attachmentContext];

      const res = await fetch(`${BOT_GATEWAY_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
        credentials: 'same-origin',
      });

      if (res.status === 401) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: "Your browser session wasn't accepted by web chat. I kept you on this screen; refresh once or sign in again if this keeps happening.",
                  isStreaming: false,
                }
              : m
          )
        );
        return;
      }

      if (!res.ok) {
        throw new Error(`Chat API error: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let accumulated = '';
      let sseBuffer = '';

      // ─── Tool-call accumulation state ───
      // OpenAI-style streaming sends tool_calls in deltas across multiple chunks.
      // We accumulate the function name and JSON argument fragments per tool index,
      // then execute when the stream finishes (finish_reason === 'tool_calls' or done).
      const pendingToolCalls: Map<number, { name: string; arguments: string }> = new Map();
      let hasToolCalls = false;
      // Track text-body tool calls we've already executed to avoid re-executing on every SSE delta
      const executedTextToolCalls = new Set<string>();
      const textToolResultPromises: Promise<string>[] = [];
      const processSseLine = (line: string) => {
        if (!line.startsWith('data: ')) return;
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          // Bridge returns { type: 'text', content: '...' } format
          // Also support raw OpenAI { choices: [{ delta: { content } }] }
          const choice = parsed.choices?.[0];

          // ── Accumulate tool_call deltas ──
          if (choice?.delta?.tool_calls) {
            hasToolCalls = true;
            for (const tc of choice.delta.tool_calls) {
              const idx: number = tc.index ?? 0;
              const existing = pendingToolCalls.get(idx) || { name: '', arguments: '' };
              if (tc.function?.name) {
                existing.name += tc.function.name;
              }
              if (tc.function?.arguments) {
                existing.arguments += tc.function.arguments;
              }
              pendingToolCalls.set(idx, existing);
            }
            return;
          }

          if (choice?.finish_reason === 'tool_calls') {
            // Stream is done with tool calls; execution happens after the loop.
            return;
          }

          const delta = parsed.type === 'text' ? parsed.content : choice?.delta?.content;
          if (delta) {
            accumulated += delta;
            // ── Detect and execute tool_calls embedded in text body BEFORE sanitization strips them ──
            const textToolCalls = detectTextBodyToolCalls(accumulated);
            for (const tc of textToolCalls) {
              const dedupKey = `${tc.toolName}:${tc.rawJson}`;
              if (executedTextToolCalls.has(dedupKey)) continue;
              executedTextToolCalls.add(dedupKey);
              console.log(`Executed tool_call from text body: ${tc.toolName}`);
              const resultPromise = executeToolOnce(tc.toolName, tc.args).catch((err: unknown) => {
                console.error(`[text-body-tool] ${tc.toolName} failed:`, err);
                return `Tool ${tc.toolName} failed: ${err instanceof Error ? err.message : String(err)}`;
              });
              textToolResultPromises.push(resultPromise);
            }
            const cleaned = stripProcessNarration(sanitizeAssistantText(stripLeakedHtml(stripAssistantCanvasMarkup(accumulated))));
            if (cleaned) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: cleaned, isStreaming: true }
                    : m
                )
              );
            }
          }
        } catch {
          // non-JSON line, skip
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() ?? '';
        for (const line of lines) processSseLine(line);
      }
      sseBuffer += decoder.decode();
      if (sseBuffer) processSseLine(sseBuffer);

      const informationalToolResults: string[] = [];
      const actionToolResults: string[] = [];

      if (textToolResultPromises.length > 0) {
        const textToolResults = (await Promise.all(textToolResultPromises))
          .map((result) => String(result || '').trim())
          .filter(Boolean);
        if (toolResultsNeedFinalAnswer(textToolResults)) {
          informationalToolResults.push(...textToolResults);
        } else {
          actionToolResults.push(...textToolResults);
        }
      }

      // ─── Execute accumulated tool calls ───
      if (hasToolCalls && pendingToolCalls.size > 0) {
        const toolResults: string[] = [];
        for (const [, tc] of pendingToolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = tc.arguments ? JSON.parse(tc.arguments) : {};
          } catch {
            // Malformed JSON from the model — pass empty args
          }
          const result = await executeToolOnce(tc.name, args);
          toolResults.push(result);
        }
        if (toolResultsNeedFinalAnswer(toolResults)) {
          informationalToolResults.push(...toolResults);
        } else {
          actionToolResults.push(...toolResults);
        }
      }

      if (informationalToolResults.length > 0) {
        const finalAnswer = await fetchFinalAnswerFromToolResults(informationalToolResults);
        const fallback = safeInformationalToolFallback(informationalToolResults);
        const finalAnswerIsUseful = finalAnswer &&
          !isWeakToolOnlyReply(finalAnswer) &&
          finalAnswer.trim().length >= 60 &&
          !looksLikeRawInformationalToolOutput(finalAnswer);
        accumulated = finalAnswerIsUseful ? finalAnswer : fallback;
      } else if (actionToolResults.length > 0) {
        const toolSuffix = actionToolResults
          .map((result) => stripCompanionReadyMarker(sanitizeAssistantText(stripLeakedHtml(result))).trim())
          .filter(Boolean)
          .join('\n');
        if (toolSuffix) {
          const cleanedAccumulated = stripProcessNarration(sanitizeAssistantText(stripLeakedHtml(accumulated)));
          accumulated = isWeakToolOnlyReply(cleanedAccumulated)
            ? toolSuffix
            : cleanedAccumulated
            ? `${cleanedAccumulated}\n\n${toolSuffix}`
            : toolSuffix;
        }
      }

      const canvasMarkupResult = handleAssistantCanvasMarkup(accumulated);
      accumulated = canvasMarkupResult.text;
      if (!canvasMarkupResult.opened) {
        rescueMissingVisualCanvas(trimmed, accumulated, canvasBaselineTs);
      }

      // Finalize
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: stripCompanionReadyMarker(stripProcessNarration(sanitizeAssistantText(stripLeakedHtml(accumulated || m.content)))), isStreaming: false }
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
  }, []);

  /**
   * Append server-authored assistant messages into the local chat view.
   * Used for inbox messages (Pearl-initiated replies pushed from the backend,
   * e.g. task-question replies) so they appear inline with the normal
   * transcript without going through the /api/chat streaming path.
   */
  const appendExternalMessages = useCallback(
    (incoming: Array<{ id?: string; content: string; timestamp?: number | string }>) => {
      if (!incoming.length) return;
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const additions: ChatMessage[] = incoming
          .filter((m) => !m.id || !existingIds.has(m.id))
          .map((m) => ({
            id: m.id || crypto.randomUUID(),
            role: 'assistant' as const,
            content: sanitizeAssistantText(stripLeakedHtml(m.content)),
            timestamp:
              typeof m.timestamp === 'number'
                ? m.timestamp
                : typeof m.timestamp === 'string' && m.timestamp
                  ? new Date(m.timestamp).getTime()
                  : Date.now(),
            isStreaming: false,
          }));
        if (additions.length === 0) return prev;
        return [...prev, ...additions].sort((a, b) => a.timestamp - b.timestamp);
      });
    },
    [],
  );

  const toggleReaction = useCallback((messageId: string, emoji: ChatReactionEmoji) => {
    const normalizedEmoji = emoji.trim().slice(0, 8);
    if (!normalizedEmoji) return;
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId || message.isStreaming) return message;
        const actor: ChatReaction['by'] = message.role === 'user' ? 'assistant' : 'user';
        const existing = message.reactions ?? [];
        const alreadySelected = existing.some((reaction) => reaction.by === actor && reaction.emoji === normalizedEmoji);
        const withoutActor = existing.filter((reaction) => reaction.by !== actor);
        const reactions = alreadySelected
          ? withoutActor
          : [...withoutActor, { by: actor, emoji: normalizedEmoji }];
        return {
          ...message,
          reactions: reactions.length ? reactions : undefined,
        };
      })
    );
  }, []);

  const clearMessages = useCallback((options?: { reloadHistory?: boolean }) => {
    const reloadHistory = options?.reloadHistory ?? true;
    abortRef.current?.abort();
    setMessages([]);
    setIsTyping(false);
    setHasMore(true);
    // Drop the local cache too, otherwise the next reload seeds from stale
    // messages the user just dismissed. Per-user key only — never the legacy
    // shared one (which is purged on boot anyway).
    if (typeof window !== 'undefined') {
      const key = historyCacheKey(userIdRef.current);
      if (key) {
        try { window.localStorage.removeItem(key); } catch {}
      }
    }
    // Normal clears should re-sync with server history. Archive clears already
    // wait for POST /api/chat/archive to rotate the server log, so re-fetching
    // immediately is unnecessary and can race stale history back into the UI.
    if (reloadHistory) {
      setHistoryLoaded(false);
    }
  }, []);

  return {
    messages,
    isTyping,
    historyLoaded,
    isLoadingMore,
    hasMore,
    loadMore,
    sendMessage,
    clearMessages,
    appendExternalMessages,
    toggleReaction,
  };
}
