'use client';

import React, { useEffect, useRef, ReactNode } from 'react';
import { useKeyboardHeight } from '@interface/hooks/useKeyboardHeight';
import styles from './ChatModeLayout.module.css';

interface ChatModeLayoutProps {
  /** Chat messages content */
  children: ReactNode;
  /** Input bar content — rendered at bottom, above keyboard */
  inputBar?: ReactNode;
  /** Class name for the outer container */
  className?: string;
}

/**
 * Mobile-aware layout wrapper for chat mode.
 *
 * Handles:
 * - iOS Safari keyboard accommodation via visualViewport
 * - Body scroll lock when chat is open
 * - Safe area insets (notch, home indicator)
 * - Smooth keyboard transitions
 * - Auto-scroll to bottom on new messages
 */
export function ChatModeLayout({ children, inputBar, className }: ChatModeLayoutProps) {
  const { keyboardHeight, isKeyboardOpen, isIOS, viewportHeight } = useKeyboardHeight();
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  // Lock body scroll when mounted
  useEffect(() => {
    const body = document.body;
    const originalOverflow = body.style.overflow;
    const originalPosition = body.style.position;
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.width = '100%';

    return () => {
      body.style.overflow = originalOverflow;
      body.style.position = originalPosition;
      body.style.width = '';
    };
  }, []);

  // On iOS, set container height to visualViewport height
  // This avoids the 100vh-includes-keyboard-area problem
  useEffect(() => {
    if (!isIOS || !containerRef.current) return;
    containerRef.current.style.height = `${viewportHeight}px`;
  }, [isIOS, viewportHeight]);

  // Auto-scroll messages to bottom when keyboard opens
  useEffect(() => {
    if (isKeyboardOpen && messagesRef.current) {
      // Small delay lets layout settle
      requestAnimationFrame(() => {
        messagesRef.current?.scrollTo({
          top: messagesRef.current.scrollHeight,
          behavior: 'smooth',
        });
      });
    }
  }, [isKeyboardOpen]);

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${className ?? ''}`}
    >
      <div ref={messagesRef} className={styles.messages}>
        {children}
      </div>

      {inputBar && (
        <div
          className={`${styles.inputBar} ${isKeyboardOpen ? styles.inputBarKeyboardOpen : ''}`}
          // Prevent tapping input bar area from triggering blur
          onMouseDown={(e) => {
            // Don't prevent default on the actual input/textarea
            const target = e.target as HTMLElement;
            if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
              e.preventDefault();
            }
          }}
        >
          {inputBar}
        </div>
      )}
    </div>
  );
}

/**
 * Pre-styled chat input with iOS-friendly attributes.
 * Use inside ChatModeLayout's inputBar prop.
 */
interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ChatInput({ value, onChange, onSend, placeholder = 'Message Pearl...', disabled }: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  return (
    <>
      <textarea
        ref={inputRef}
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        inputMode="text"
        enterKeyHint="send"
        autoComplete="off"
        autoCorrect="on"
      />
      <button
        className={styles.sendButton}
        onClick={onSend}
        disabled={disabled || !value.trim()}
        aria-label="Send message"
        type="button"
      >
        ↑
      </button>
    </>
  );
}
