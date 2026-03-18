"use client";

import React, { useEffect, useState, Suspense } from 'react';

const ReactMarkdown = React.lazy(() => import('react-markdown'));
let remarkGfm: any;
try { remarkGfm = require('remark-gfm').default || require('remark-gfm'); } catch {}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

interface ChatBubbleProps {
  message: ChatMessage;
}

const ChatBubble: React.FC<ChatBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const hasText = Boolean(message.content?.trim());
  const isEmptyAssistantStreaming = isAssistant && message.isStreaming && !hasText;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}
      style={{
        transition: 'opacity 0.25s ease, transform 0.25s ease',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
      }}
    >
      <div
        className="relative max-w-[85%] leading-relaxed"
        style={{
          fontSize: 'clamp(14px, 3.8vw, 16px)',
          lineHeight: '1.55',
          padding: 'clamp(8px, 2.5vw, 12px) clamp(12px, 3.5vw, 16px)',
          /* Min touch-target height */
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          /* Prevent text from overflowing the bubble */
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          overflow: 'hidden',
          ...(isUser ? {
            backgroundColor: 'rgba(123, 63, 142, 0.7)',
            color: '#faf8f5',
            borderRadius: '18px 18px 6px 18px',
            boxShadow: '0 2px 8px rgba(123, 63, 142, 0.3)',
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
              borderLeft: '9px solid rgba(123, 63, 142, 0.7)',
            }}
          />
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
                  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#D94F8E', textDecoration: 'underline' }}>{children}</a>,
                  code: ({ children, className }) => {
                    const isBlock = className?.includes('language-');
                    return isBlock
                      ? <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '6px', overflowX: 'auto', margin: '0.5em 0', fontSize: '0.9em' }}><code>{children}</code></pre>
                      : <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px', fontSize: '0.9em' }}>{children}</code>;
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
        <style jsx>{`
          @keyframes chatBubbleDots {
            0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
            30% { transform: translateY(-5px); opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
};

export default ChatBubble;
