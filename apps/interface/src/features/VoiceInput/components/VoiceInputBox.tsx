'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useKeyboardHeight } from '@interface/hooks/useKeyboardHeight';
import { getClientLogger } from '@interface/lib/client-logger';

import './VoiceInputBox.css';

const log = getClientLogger('[voice_input_box]');

/* ------------------------------------------------------------------ */
/*  Custom event that Pearl (or any code) can dispatch to open the box */
/* ------------------------------------------------------------------ */
export interface VoiceInputRequestDetail {
  placeholder?: string;
  type?: 'text' | 'file' | 'both';
}

export const VOICE_INPUT_REQUEST_EVENT = 'nia:voice-input-request';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
export interface VoiceInputBoxProps {
  /** External open state (OR listen to custom event) */
  open?: boolean;
  onClose?: () => void;
  /** Called with the submitted text (and optional file) */
  onSubmit?: (payload: { text: string; file?: File }) => void;
  placeholder?: string;
  mode?: 'text' | 'file' | 'both';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
const VoiceInputBox: React.FC<VoiceInputBoxProps> = ({
  open: externalOpen,
  onClose,
  onSubmit,
  placeholder: externalPlaceholder,
  mode: externalMode,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [placeholder, setPlaceholder] = useState(externalPlaceholder ?? 'Paste API key, URL, or text…');
  const [mode, setMode] = useState<'text' | 'file' | 'both'>(externalMode ?? 'both');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const { isKeyboardOpen } = useKeyboardHeight();

  const isOpen = externalOpen ?? internalOpen;

  // Listen for programmatic open events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<VoiceInputRequestDetail>).detail ?? {};
      if (detail.placeholder) setPlaceholder(detail.placeholder);
      if (detail.type) setMode(detail.type);
      setInternalOpen(true);
      log.info('Voice input box opened via custom event', { event: 'voice_input_opened' });
    };
    window.addEventListener(VOICE_INPUT_REQUEST_EVENT, handler);
    return () => window.removeEventListener(VOICE_INPUT_REQUEST_EVENT, handler);
  }, []);

  // Auto-focus textarea on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setText('');
      setFile(null);
      setClosing(false);
    }
  }, [isOpen]);

  const doClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      setInternalOpen(false);
      onClose?.();
    }, 550);
  }, [onClose]);

  // Click outside to dismiss
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) doClose();
    },
    [doClose],
  );

  // Escape to dismiss
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') doClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, doClose]);

  const handleSubmit = useCallback(() => {
    if (!text.trim() && !file) return;
    log.info('Voice input submitted', {
      event: 'voice_input_submitted',
      hasText: !!text.trim(),
      hasFile: !!file,
    });
    onSubmit?.({ text: text.trim(), file: file ?? undefined });
    doClose();
  }, [text, file, onSubmit, doClose]);

  // Ctrl/Cmd+Enter to submit
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, handleSubmit]);

  // File handling
  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  }, []);

  if (!isOpen) return null;

  const showTextarea = mode === 'text' || mode === 'both';
  const showDropzone = mode === 'file' || mode === 'both';

  return (
    <div
      ref={overlayRef}
      className={`voice-input-overlay${closing ? ' closing' : ''}${isKeyboardOpen ? ' keyboard-open' : ''}`}
      onClick={handleOverlayClick}
    >
      <div className={`vacuum-tube${closing ? ' cooling' : ''}`}>
        {/* Glass Bulb */}
        <div className="vt-bulb">
          <div className="vt-header">
            <span className="vt-title">⚡ Input Tube</span>
            <button
              className="vt-close-btn"
              onClick={doClose}
              aria-label="Close input"
              type="button"
            >
              ✕
            </button>
          </div>

          {showTextarea && (
            <textarea
              ref={textareaRef}
              className="vt-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              data-gramm="false"
            />
          )}

          {showDropzone && (
            <>
              <div
                className={`vt-dropzone${dragOver ? ' drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
              >
                <div className="vt-dropzone-icon">📎</div>
                <div>Drop file or tap to select</div>
                {file && <div className="vt-file-name">{file.name}</div>}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </>
          )}
        </div>

        {/* Metal Base */}
        <div className="vt-base">
          <button
            className="vt-send-btn"
            onClick={handleSubmit}
            disabled={!text.trim() && !file}
            type="button"
          >
            Send to Pearl ⚡
          </button>

          {/* Pins */}
          <div className="vt-pins">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="vt-pin" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VoiceInputBox;

/* ------------------------------------------------------------------ */
/*  Trigger Button — embed near voice controls                        */
/* ------------------------------------------------------------------ */
export const VoiceInputTrigger: React.FC<{
  onClick?: () => void;
  className?: string;
}> = ({ onClick, className }) => {
  const handleClick = useCallback(() => {
    if (onClick) {
      onClick();
    } else {
      // Dispatch custom event to open the box
      window.dispatchEvent(
        new CustomEvent(VOICE_INPUT_REQUEST_EVENT, {
          detail: { type: 'both' },
        }),
      );
    }
  }, [onClick]);

  return (
    <button
      className={`vt-trigger-btn ${className ?? ''}`}
      onClick={handleClick}
      title="Paste text or file to Pearl"
      type="button"
      aria-label="Open input tube"
    >
      📋
    </button>
  );
};
