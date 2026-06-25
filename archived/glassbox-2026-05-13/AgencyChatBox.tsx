"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface AgencyMessage {
  id: string;
  speaker: "Pearl" | "Claude" | "Codex" | "Codecs";
  body: string;
  timestamp: string;
  type?: string;
}

const AGENCY_MESSAGES_ENDPOINT = "/bot-api/agency-chat/messages";
const AGENCY_SEND_ENDPOINT = "/api/agency-chat/send";
const POLL_INTERVAL_MS = 10_000;

const SPEAKER_EMOJI: Record<string, string> = {
  Pearl: "🟣",
  Claude: "🐙",
  Codex: "🔷",
  Codecs: "🔷",
};

// Matches @Blair or @BlairErickson (case-insensitive). Word boundary keeps
// @blairs / @blairerickson-something from triggering by accident.
const MENTION_RE = /@Blair(?:Erickson)?\b/i;

/**
 * Live transparent chat between Blair, Pearl, and the builder mind:
 *   🟣 Pearl (Discord-side / experience layer, DeepSeek brain)
 *   🔷 Codecs (agent/implementation layer, OpenRouter Codex brain)
 *
 * Comic-dialogue style: emoji avatar + speech bubble. No header, no names,
 * no chrome - just the conversation. A small reply input at the bottom lets
 * Blair drop a directive into the same feed (rendered as a 👤 user bubble).
 */
export function AgencyChatBox() {
  const [messages, setMessages] = useState<AgencyMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [inputExpanded, setInputExpanded] = useState(false);
  const [dismissedMentionId, setDismissedMentionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastIdRef = useRef<string | null>(null);

  const latestMentionId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.type === "user") continue;
      if (MENTION_RE.test(m.body)) return m.id;
    }
    return null;
  }, [messages]);

  const hasUnseenMention =
    latestMentionId !== null && latestMentionId !== dismissedMentionId;

  const dismissMention = () => {
    if (latestMentionId) setDismissedMentionId(latestMentionId);
  };

  useEffect(() => {
    if (inputExpanded) {
      inputRef.current?.focus();
    }
  }, [inputExpanded]);

  const fetchMessages = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(`${AGENCY_MESSAGES_ENDPOINT}?limit=20`, {
          credentials: "include",
        });
        if (!res.ok) {
          if (!cancelled) setError(`HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as { messages?: AgencyMessage[] };
        if (cancelled) return;
        const next = data.messages ?? [];
        setMessages(next);
        setError(null);
        const last = next[next.length - 1];
        if (last && last.id !== lastIdRef.current) {
          lastIdRef.current = last.id;
          requestAnimationFrame(() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "fetch failed");
      }
    };
    fetchMessages.current = run;
    run();
    const id = setInterval(run, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(AGENCY_SEND_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        setSendError(`send failed: ${res.status}${detail ? ` ${detail.slice(0, 80)}` : ""}`);
        return;
      }
      setDraft("");
      // Re-poll immediately so the new bubble appears without waiting 10s.
      void fetchMessages.current();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={`aj-tile rounded-xl backdrop-blur-md shadow-lg bg-sky-500/15 border ${
        hasUnseenMention
          ? "border-purple-400/70 shadow-purple-500/40 ring-2 ring-purple-400/40"
          : "border-sky-400/30 shadow-black/30"
      }`}
      onClick={() => {
        if (hasUnseenMention) dismissMention();
      }}
      style={{
        minWidth: 280,
        maxWidth: "min(360px, calc(100vw - 40px))",
        fontFamily: "Gohufont, monospace",
        padding: "8px 10px",
        position: "relative",
      }}
    >
      {hasUnseenMention && (
        <div
          aria-label="mentioned"
          title="Pearl or Codecs mentioned you"
          className="absolute rounded-full bg-purple-400 shadow-md shadow-purple-500/60 animate-pulse"
          style={{ top: -4, right: -4, width: 10, height: 10, zIndex: 2 }}
        />
      )}
      <div
        ref={scrollRef}
        className="aj-scroll"
        style={{
          maxHeight: 100,
          minHeight: 40,
          overflowY: "auto",
          overflowX: "hidden",
          paddingRight: 4,
          paddingBottom: 28,
        }}
      >
        {messages.length === 0 && !error && (
          <div className="text-sky-300/50 italic text-[10px] py-2 text-center">
            🟣 and 🔷 settling in...
          </div>
        )}
        {error && (
          <div className="text-amber-300/80 text-[10px] py-1">offline: {error}</div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
      </div>
      {!inputExpanded ? (
        <button
          type="button"
          onClick={() => {
            setInputExpanded(true);
            dismissMention();
          }}
          aria-label="reply to Pearl & Codecs"
          title="reply"
          className="absolute flex items-center justify-center text-purple-100 bg-purple-500/40 border border-purple-400/50 hover:bg-purple-500/60 hover:border-purple-400/80 shadow-md shadow-black/40 transition-colors"
          style={{
            bottom: 6,
            right: 6,
            width: 24,
            height: 24,
            borderRadius: "50%",
            fontSize: 12,
            lineHeight: 1,
            fontFamily: "Gohufont, monospace",
          }}
        >
          ✎
        </button>
      ) : (
        <div
          className="absolute flex items-center gap-1 bg-sky-950/70 backdrop-blur-md rounded-md p-1 border border-sky-400/30 shadow-md shadow-black/40"
          style={{ bottom: 4, left: 4, right: 4 }}
        >
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setInputExpanded(false);
                setSendError(null);
              }
            }}
            placeholder="reply to Pearl & Codecs..."
            disabled={sending}
            className="flex-1 min-w-0 px-2 py-1 rounded text-[11px] text-sky-100/95 placeholder:text-sky-300/40 bg-purple-950/30 border border-purple-400/20 focus:outline-none focus:border-purple-400/50 disabled:opacity-50"
            style={{ fontFamily: "Gohufont, monospace" }}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || !draft.trim()}
            aria-label="send"
            title="send"
            className="flex items-center justify-center text-purple-100 bg-purple-500/40 border border-purple-400/50 hover:bg-purple-500/60 hover:border-purple-400/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              fontSize: 11,
              lineHeight: 1,
              fontFamily: "Gohufont, monospace",
            }}
          >
            {sending ? "…" : "↑"}
          </button>
          <button
            type="button"
            onClick={() => {
              setInputExpanded(false);
              setSendError(null);
            }}
            aria-label="close reply"
            title="close"
            className="flex items-center justify-center text-sky-200/70 hover:text-sky-100 transition-colors flex-shrink-0"
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              fontSize: 12,
              lineHeight: 1,
              fontFamily: "Gohufont, monospace",
            }}
          >
            ×
          </button>
        </div>
      )}
      {sendError && inputExpanded && (
        <div
          className="absolute text-amber-300/90 text-[10px] bg-black/60 rounded px-1.5 py-0.5"
          style={{ bottom: 36, left: 6, right: 6 }}
        >
          {sendError}
        </div>
      )}
    </div>
  );
}

function Bubble({ message }: { message: AgencyMessage }) {
  // Blair's replies are posted upstream as speaker="Pearl" with type="user"
  // so we key off type to render them in a distinct purple right-aligned bubble.
  if (message.type === "user") {
    return (
      <div className="flex items-start justify-end gap-2 py-1.5">
        <div
          className="bg-purple-950/40 border border-purple-400/25 rounded-lg rounded-tr-sm px-2 py-1.5 text-[11px] text-purple-100/95 whitespace-pre-wrap break-words"
          style={{ maxWidth: "calc(100% - 26px)", lineHeight: "1.4" }}
        >
          {message.body}
        </div>
        <div
          className="flex-shrink-0 select-none"
          style={{ fontSize: 16, lineHeight: "20px" }}
        >
          👤
        </div>
      </div>
    );
  }
  const emoji = SPEAKER_EMOJI[message.speaker] ?? "💬";
  const isCodecs = message.speaker === "Codex" || message.speaker === "Codecs";
  return (
    <div className="flex items-start gap-2 py-1.5">
      <div
        className="flex-shrink-0 select-none"
        style={{ fontSize: 16, lineHeight: "20px" }}
      >
        {emoji}
      </div>
      <div
        className={`rounded-lg rounded-tl-sm px-2 py-1.5 text-[11px] whitespace-pre-wrap break-words ${
          isCodecs
            ? "bg-blue-950/35 border border-blue-400/20 text-blue-100/95"
            : "bg-sky-950/30 border border-sky-400/15 text-sky-100/95"
        }`}
        style={{ maxWidth: "calc(100% - 26px)", lineHeight: "1.4" }}
      >
        {message.body}
      </div>
    </div>
  );
}
