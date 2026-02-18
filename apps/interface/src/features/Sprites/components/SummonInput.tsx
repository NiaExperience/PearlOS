'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { SummonState } from '../types';

interface SummonInputProps {
  onSummon: (prompt: string) => void;
  summonState: SummonState;
}

export const SummonInput: React.FC<SummonInputProps> = ({ onSummon, summonState }) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isDisabled = summonState === 'summoning' || summonState === 'materializing';

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 100) + 'px';
    }
  }, [value]);

  const handleSubmit = () => {
    if (value.trim() && !isDisabled) {
      onSummon(value.trim());
      setValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="relative w-full max-w-md mx-auto">
      <div
        className="flex items-end gap-2 rounded-2xl border px-3 py-2 transition-all duration-300"
        style={{
          borderColor: isDisabled ? 'rgba(6, 182, 212, 0.4)' : 'rgba(6, 182, 212, 0.2)',
          background: 'rgba(6, 182, 212, 0.05)',
          boxShadow: isDisabled
            ? '0 0 20px rgba(6, 182, 212, 0.2), inset 0 0 20px rgba(6, 182, 212, 0.05)'
            : '0 0 10px rgba(6, 182, 212, 0.05)',
        }}
      >
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
          placeholder={isDisabled ? 'Summoning...' : 'Summon a sprite...'}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-white/90 placeholder-white/25 outline-none disabled:opacity-50"
          style={{ fontFamily: 'Gohufont, monospace', maxHeight: 100 }}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isDisabled || !value.trim()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200 disabled:opacity-30"
          style={{
            background: value.trim() && !isDisabled
              ? 'linear-gradient(135deg, #06b6d4, #8b5cf6)'
              : 'rgba(6, 182, 212, 0.15)',
            boxShadow: value.trim() && !isDisabled ? '0 0 12px rgba(6, 182, 212, 0.4)' : 'none',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
};
