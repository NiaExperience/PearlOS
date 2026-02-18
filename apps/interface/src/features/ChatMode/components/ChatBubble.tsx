"use client";

import React, { useEffect, useState } from 'react';

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
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3 transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
    >
      <div
        className="relative max-w-[80%] px-4 py-2.5 text-[15px] leading-relaxed"
        style={isUser ? {
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
        <span className={message.isStreaming ? 'after:content-["▊"] after:animate-pulse after:ml-0.5 after:text-[#D94F8E]' : ''}>
          {message.content}
        </span>
      </div>
    </div>
  );
};

export default ChatBubble;
