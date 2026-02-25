"use client";

import React from 'react';

const TypingIndicator: React.FC = () => {
  return (
    <div className="flex justify-start mb-3">
      <div
        className="relative leading-relaxed"
        style={{
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: 'clamp(8px, 2.5vw, 12px) clamp(12px, 3.5vw, 16px)',
          backgroundColor: '#2a1848',
          color: '#faf8f5',
          border: '1.5px solid rgba(123, 63, 142, 0.4)',
          borderRadius: '6px 18px 18px 18px',
          boxShadow: '0 2px 8px rgba(26, 14, 46, 0.5)',
        }}
      >
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
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-[#d4c0e8]"
            style={{
              animation: 'chatBounce 1.4s ease-in-out infinite',
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
      <style jsx>{`
        @keyframes chatBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default TypingIndicator;
