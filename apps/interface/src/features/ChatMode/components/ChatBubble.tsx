"use client";

import React, { useEffect, useRef, useState, Suspense } from 'react';
import { SmilePlus } from 'lucide-react';

const ReactMarkdown = React.lazy(() => import('react-markdown'));
let remarkGfm: any;
try { remarkGfm = require('remark-gfm').default || require('remark-gfm'); } catch {}

const PRIMARY_REACTIONS = ['👍', '❤️', '😂', '🔥', '👀'];
const MORE_REACTIONS = ['🎉', '🙏', '🤔', '😮', '😅', '💯', '✨', '👏', '🚀', '✅', '😢', '🫶'];

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  imageUrl?: string;
  fileAttachment?: ChatFileAttachment;
  fileAttachments?: ChatFileAttachment[];
  reactions?: ChatReaction[];
}

export interface ChatFileAttachment {
  filename: string;
  originalName?: string;
  mime?: string;
  bytes?: number;
  kind?: string;
  path?: string;
}

export type ChatReactionEmoji = string;

export interface ChatReaction {
  emoji: ChatReactionEmoji;
  by: 'user' | 'assistant';
}

interface ChatBubbleProps {
  message: ChatMessage;
  onReaction?: (messageId: string, emoji: ChatReactionEmoji) => void;
}

const ChatBubble: React.FC<ChatBubbleProps> = ({ message, onReaction }) => {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const hasText = Boolean(message.content?.trim());
  const isEmptyAssistantStreaming = isAssistant && message.isStreaming && !hasText;
  const hasImage = Boolean(message.imageUrl);
  const fileAttachments = message.fileAttachments?.length
    ? message.fileAttachments
    : message.fileAttachment
      ? [message.fileAttachment]
      : [];
  const hasFile = fileAttachments.length > 0;
  const [visible, setVisible] = useState(false);
  const [reactionTrayOpen, setReactionTrayOpen] = useState(false);
  const [moreReactionsOpen, setMoreReactionsOpen] = useState(false);
  const messageRootRef = useRef<HTMLDivElement>(null);
  const reactionAreaRef = useRef<HTMLDivElement>(null);
  const canReact = Boolean(onReaction);
  const reactionActor: ChatReaction['by'] = isUser ? 'assistant' : 'user';
  const activeReaction = message.reactions?.find((reaction) => reaction.by === reactionActor);
  const assistantReaction = message.reactions?.find((reaction) => reaction.by === 'assistant');
  const showReactionControls = canReact && (reactionTrayOpen || moreReactionsOpen);
  const showReactionTray = canReact && (showReactionControls || Boolean(activeReaction));
  const reactionOwner = isUser ? 'Pearl' : 'You';
  const reactionOptionsLabel = `${reactionOwner} reaction options`;
  const showPassiveAssistantReaction = Boolean(assistantReaction && (!isUser || !canReact));

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!reactionTrayOpen && !moreReactionsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && messageRootRef.current?.contains(target)) return;
      setMoreReactionsOpen(false);
      setReactionTrayOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [reactionTrayOpen, moreReactionsOpen]);

  const toggleMoreReactions = () => {
    if (!canReact || message.isStreaming) return;
    setReactionTrayOpen(true);
    setMoreReactionsOpen((open) => !open);
  };

  const handleEmojiClick = (emoji: string) => {
    onReaction?.(message.id, emoji);
    setMoreReactionsOpen(false);
    setReactionTrayOpen(false);
  };

  const handleRemoveReaction = () => {
    if (!canReact || !activeReaction || message.isStreaming) return;
    onReaction?.(message.id, activeReaction.emoji);
    setReactionTrayOpen(false);
  };

  const setReactionTrayFromBubbleTap = (bubble: HTMLDivElement, clientY: number) => {
    if (!canReact || message.isStreaming) return;
    const rect = bubble.getBoundingClientRect();
    const tapY = clientY - rect.top;
    const tappedLowerQuarter = tapY >= rect.height * 0.75;
    setMoreReactionsOpen(false);
    setReactionTrayOpen(tappedLowerQuarter);
  };

  const handleBubblePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    setReactionTrayFromBubbleTap(event.currentTarget, event.clientY);
  };

  const handleBubbleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    setReactionTrayFromBubbleTap(event.currentTarget, touch.clientY);
  };

  return (
    <div
      ref={messageRootRef}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}
      onMouseEnter={() => {
        if (canReact) setReactionTrayOpen(true);
      }}
      onMouseLeave={() => {
        if (!moreReactionsOpen) setReactionTrayOpen(false);
      }}
      onFocusCapture={() => {
        if (canReact) setReactionTrayOpen(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !moreReactionsOpen) {
          setReactionTrayOpen(false);
        }
      }}
      style={{
        transition: 'opacity 0.25s ease, transform 0.25s ease',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
      }}
    >
      <div
        className={`flex flex-col max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}
      >
        <div
          onPointerDown={handleBubblePointerDown}
          onTouchStart={handleBubbleTouchStart}
          className="relative leading-relaxed"
          style={{
            fontSize: 'clamp(14px, 3.8vw, 16px)',
            lineHeight: '1.55',
            padding: (hasImage && !hasText && !hasFile) ? 'clamp(4px, 1.5vw, 8px)' : 'clamp(8px, 2.5vw, 12px) clamp(12px, 3.5vw, 16px)',
            /* Min touch-target height */
            minHeight: 44,
            display: 'flex',
            flexDirection: hasImage || hasFile ? 'column' : undefined,
            alignItems: hasImage || hasFile ? 'flex-start' : 'center',
            /* Prevent text from overflowing the bubble */
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            overflow: 'hidden',
            ...(isUser ? {
              backgroundColor: '#d8efff',
              color: '#123047',
              border: '1.5px solid rgba(125, 187, 232, 0.85)',
              borderRadius: '18px 18px 6px 18px',
              boxShadow: '0 2px 8px rgba(89, 153, 198, 0.22)',
            } : {
              backgroundColor: '#2a1848',
              color: '#faf8f5',
              border: '1.5px solid rgba(123, 63, 142, 0.4)',
              borderRadius: '6px 18px 18px 18px',
              boxShadow: '0 2px 8px rgba(26, 14, 46, 0.5)',
            }),
          }}
        >
          {/* Comic tail for Pearl's messages */}
          {!isUser && (
            <div
              className="absolute -left-2 top-3"
              style={{
                width: 0,
                height: 0,
                borderTop: '5px solid transparent',
                borderBottom: '7px solid transparent',
                borderRight: '9px solid #2a1848',
                filter: 'drop-shadow(-1px 0 0 rgba(123, 63, 142, 0.4))',
              }}
            />
          )}
          {/* Comic tail for user messages */}
          {isUser && (
            <div
              className="absolute -right-2 bottom-2"
              style={{
                width: 0,
                height: 0,
                borderTop: '5px solid transparent',
                borderBottom: '7px solid transparent',
                borderLeft: '9px solid #d8efff',
                filter: 'drop-shadow(1px 0 0 rgba(125, 187, 232, 0.85))',
              }}
            />
          )}
          {hasImage && (
            <img
              src={message.imageUrl}
              alt="Attached image"
              style={{
                maxWidth: '100%',
                maxHeight: 240,
                borderRadius: 10,
                marginBottom: hasText ? 8 : 0,
                objectFit: 'contain',
                display: 'block',
              }}
            />
          )}
          {hasFile && (
            <div
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: '8px 10px',
                marginBottom: hasText ? 8 : 0,
                borderRadius: 10,
                background: isUser ? 'rgba(255,255,255,0.58)' : 'rgba(255,255,255,0.08)',
                border: isUser ? '1px solid rgba(11, 101, 163, 0.16)' : '1px solid rgba(255,255,255,0.12)',
              }}
            >
              {fileAttachments.map((attachment, index) => (
                <span
                  key={`${attachment.path || attachment.filename || attachment.originalName || 'attachment'}:${index}`}
                  style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}
                >
                  <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>📎</span>
                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {attachment.originalName || attachment.filename || 'Attached file'}
                    </span>
                    <span style={{ opacity: 0.72, fontSize: 11 }}>
                      {[attachment.kind || 'file', attachment.bytes ? `${Math.round(attachment.bytes / 1024)} KB` : 'shared'].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </span>
              ))}
            </div>
          )}
          {isEmptyAssistantStreaming ? (
            <div className="flex items-center gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-[#d4c0e8]"
                  style={{
                    animation: 'chatBubbleDots 1.4s ease-in-out infinite',
                    animationDelay: `${i * 0.2}s`,
                  }}
                />
              ))}
            </div>
          ) : (
            <span className={`chat-bubble-content ${message.isStreaming ? 'after:content-["▊"] after:animate-pulse after:ml-0.5 after:text-[#D94F8E]' : ''}`}>
              <Suspense fallback={<>{message.content}</>}>
                <ReactMarkdown
                  remarkPlugins={remarkGfm ? [remarkGfm] : []}
                  components={{
                    p: ({ children }) => <span style={{ display: 'block', margin: '0.25em 0' }}>{children}</span>,
                    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: isUser ? '#0b65a3' : '#D94F8E', textDecoration: 'underline' }}>{children}</a>,
                    code: ({ children, className }) => {
                      const isBlock = className?.includes('language-');
                      return isBlock
                        ? <pre style={{ background: isUser ? 'rgba(255,255,255,0.58)' : 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '6px', overflowX: 'auto', margin: '0.5em 0', fontSize: '0.9em' }}><code>{children}</code></pre>
                        : <code style={{ background: isUser ? 'rgba(255,255,255,0.58)' : 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px', fontSize: '0.9em' }}>{children}</code>;
                    },
                    ul: ({ children }) => <ul style={{ margin: '0.25em 0', paddingLeft: '1.2em', listStyleType: 'disc' }}>{children}</ul>,
                    ol: ({ children }) => <ol style={{ margin: '0.25em 0', paddingLeft: '1.2em' }}>{children}</ol>,
                    strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
                    em: ({ children }) => <em>{children}</em>,
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </Suspense>
            </span>
          )}
          <style>{`
            @keyframes chatBubbleDots {
              0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
              30% { transform: translateY(-5px); opacity: 1; }
            }
          `}</style>
        </div>
        {showPassiveAssistantReaction && assistantReaction && (
          <div
            className={`mt-1 text-sm ${isUser ? 'self-start ml-2' : 'self-end mr-2'}`}
            title="Pearl reacted"
            aria-label={`Pearl reacted ${assistantReaction.emoji}`}
          >
            <span
              className="inline-flex items-center justify-center rounded-full"
              style={{
                minWidth: 28,
                height: 24,
                padding: '0 7px',
                background: 'rgba(217, 79, 142, 0.2)',
                border: '1px solid rgba(217, 79, 142, 0.34)',
              }}
            >
              {assistantReaction.emoji}
            </span>
          </div>
        )}
        {canReact && (
          <div
            ref={reactionAreaRef}
            className="relative mt-1.5 flex items-center gap-1 justify-start"
            aria-label={reactionOptionsLabel}
            style={{
              minHeight: 30,
              opacity: showReactionTray ? 1 : 0,
              visibility: showReactionTray ? 'visible' : 'hidden',
              pointerEvents: showReactionTray ? 'auto' : 'none',
              transform: showReactionTray ? 'translateY(0)' : 'translateY(-2px)',
              transition: 'opacity 140ms ease, transform 140ms ease, visibility 140ms ease',
            }}
          >
          {activeReaction && (
            <button
              type="button"
              onClick={handleRemoveReaction}
              className="flex items-center justify-center rounded-full transition-all"
              style={{
                minWidth: 30,
                height: 28,
                padding: '0 8px',
                fontSize: 15,
                background: isUser ? 'rgba(11, 101, 163, 0.16)' : 'rgba(217, 79, 142, 0.28)',
                border: isUser ? '1px solid rgba(11, 101, 163, 0.26)' : '1px solid rgba(255, 179, 213, 0.7)',
                boxShadow: isUser ? '0 2px 8px rgba(89, 153, 198, 0.18)' : '0 2px 8px rgba(217, 79, 142, 0.22)',
                opacity: message.isStreaming ? 0.45 : 1,
              }}
              disabled={message.isStreaming}
              aria-pressed="true"
              aria-label={`Remove ${activeReaction.emoji} reaction from ${reactionOwner}`}
              title={`Remove ${activeReaction.emoji} reaction from ${reactionOwner}`}
            >
              {activeReaction.emoji}
            </button>
          )}
          {showReactionControls && (
            <>
            {PRIMARY_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleEmojiClick(emoji)}
                className="flex items-center justify-center rounded-full transition-all"
                style={{
                  width: 30,
                  height: 28,
                  fontSize: 15,
                  background: activeReaction?.emoji === emoji ? 'rgba(217, 79, 142, 0.28)' : 'rgba(255, 255, 255, 0.1)',
                  border: activeReaction?.emoji === emoji ? '1px solid rgba(255, 179, 213, 0.7)' : '1px solid rgba(255, 255, 255, 0.14)',
                }}
                disabled={message.isStreaming}
                aria-label={`React ${emoji}`}
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              onClick={toggleMoreReactions}
              className="flex items-center justify-center rounded-full transition-all"
              style={{
                width: 30,
                height: 28,
                color: isUser ? '#0b65a3' : '#ffe7f2',
                background: isUser ? 'rgba(216, 239, 255, 0.86)' : 'rgba(255, 255, 255, 0.1)',
                border: isUser ? '1px solid rgba(11, 101, 163, 0.18)' : '1px solid rgba(255, 255, 255, 0.14)',
                boxShadow: moreReactionsOpen ? '0 2px 10px rgba(217, 79, 142, 0.28)' : 'none',
                opacity: message.isStreaming ? 0.45 : 0.96,
              }}
              disabled={message.isStreaming}
              aria-expanded={moreReactionsOpen}
              aria-label={activeReaction ? `Change ${reactionOwner} reaction` : `Add ${reactionOwner} reaction`}
              title="More reactions"
            >
              <SmilePlus size={16} strokeWidth={2.2} aria-hidden="true" />
            </button>
            </>
          )}
          {moreReactionsOpen && (
            <div
              className="absolute left-0 bottom-9"
              style={{
                zIndex: 60,
                width: 'min(320px, calc(100vw - 32px))',
                borderRadius: 999,
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                boxShadow: '0 10px 28px rgba(12, 8, 24, 0.32)',
                background: 'rgba(27, 18, 45, 0.96)',
                border: '1px solid rgba(255,255,255,0.12)',
                padding: 4,
              }}
            >
              <div className="flex items-center gap-1">
                {MORE_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleEmojiClick(emoji)}
                    className="flex items-center justify-center rounded-full shrink-0"
                    style={{
                      width: 32,
                      height: 30,
                      fontSize: 16,
                      background: activeReaction?.emoji === emoji ? 'rgba(217, 79, 142, 0.32)' : 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}
                    aria-label={`React ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Memoize so that typing into the chat input (which lives in ChatMode and
 * re-renders ChatMode on every keystroke) does NOT re-run ReactMarkdown for
 * every existing message. Without this, a transcript of even ~30 bubbles
 * makes typing visibly stutter — markdown parsing dominates the input frame.
 * We compare by message identity + the fields that actually drive the bubble
 * appearance; nothing else changes per keystroke.
 */
export default React.memo(ChatBubble, (prev, next) => {
  const a = prev.message;
  const b = next.message;
  return (
    a.id === b.id &&
    a.role === b.role &&
    a.content === b.content &&
    a.imageUrl === b.imageUrl &&
    a.fileAttachment === b.fileAttachment &&
    a.fileAttachments === b.fileAttachments &&
    a.isStreaming === b.isStreaming &&
    a.reactions === b.reactions &&
    prev.onReaction === next.onReaction
  );
});
