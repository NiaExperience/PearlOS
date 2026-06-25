'use client';

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Send, Square } from 'lucide-react';
import type React from 'react';

export type MobileCliControlKey = 'Up' | 'Down' | 'Left' | 'Right' | 'Tab' | 'Escape' | 'C-c';

type Props = {
  busy: boolean;
  input: string;
  inputRef: React.Ref<HTMLTextAreaElement>;
  showControls: boolean;
  onChange: (value: string) => void;
  onControlKey: (key: MobileCliControlKey) => void;
  onFocusChange: (focused: boolean) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (event?: React.FormEvent) => void;
};

const mobileControls: Array<{
  label: string;
  title: string;
  key: MobileCliControlKey;
  icon: React.ReactNode;
}> = [
  { label: 'Up', title: 'Send Arrow Up', key: 'Up', icon: <ArrowUp className="h-3.5 w-3.5" /> },
  { label: 'Down', title: 'Send Arrow Down', key: 'Down', icon: <ArrowDown className="h-3.5 w-3.5" /> },
  { label: 'Left', title: 'Send Arrow Left', key: 'Left', icon: <ArrowLeft className="h-3.5 w-3.5" /> },
  { label: 'Right', title: 'Send Arrow Right', key: 'Right', icon: <ArrowRight className="h-3.5 w-3.5" /> },
  { label: 'Tab', title: 'Send Tab', key: 'Tab', icon: 'Tab' },
  { label: 'Esc', title: 'Send Escape', key: 'Escape', icon: 'Esc' },
  { label: 'Ctrl+C', title: 'Send Ctrl+C', key: 'C-c', icon: <Square className="h-3 w-3" /> },
];

export function MobileCliComposer({
  busy,
  input,
  inputRef,
  showControls,
  onChange,
  onControlKey,
  onFocusChange,
  onKeyDown,
  onSubmit,
}: Props) {
  return (
    <form
      className="shrink-0 border-t border-[var(--pearl-window-border)] bg-[var(--pearl-window-title-bg)] px-2 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
      onSubmit={(event) => onSubmit(event)}
    >
      <div className="flex items-end gap-2 rounded-md border border-[var(--pearl-window-border)] bg-[var(--pearl-window-content-bg)] px-2 py-2">
        <span className="pb-2 font-mono text-sm text-[var(--pearl-accent)]">&gt;</span>
        <textarea
          aria-label="Mobile CLI input"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className="max-h-28 min-h-10 flex-1 resize-none bg-transparent py-2 font-mono text-[13px] leading-5 text-[var(--pearl-text)] outline-none placeholder:text-[var(--pearl-muted)]"
          data-1p-ignore="true"
          data-lpignore="true"
          data-ms-editor="false"
          data-pearl-terminal-input="true"
          data-gramm="false"
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => onFocusChange(false)}
          onFocus={() => onFocusChange(true)}
          onKeyDown={onKeyDown}
          placeholder={busy ? 'Working...' : 'Command'}
          ref={inputRef}
          rows={1}
          spellCheck={false}
          value={input}
        />
        <button
          aria-label="Send input"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-[var(--pearl-window-control-border)] bg-[var(--pearl-window-control-bg)] text-[var(--pearl-text)] disabled:opacity-45"
          disabled={busy}
          type="submit"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      {showControls && (
        <div
          className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 sm:hidden"
          onPointerDown={(event) => event.preventDefault()}
        >
          {mobileControls.map((control) => (
            <button
              aria-label={control.title}
              className="grid h-9 min-w-9 shrink-0 place-items-center rounded-md border border-[var(--pearl-window-control-border)] bg-[var(--pearl-window-control-bg)] px-2 font-mono text-[11px] text-[var(--pearl-text)] shadow-sm disabled:opacity-45"
              disabled={busy}
              key={control.key}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onControlKey(control.key);
              }}
              title={control.label}
              type="button"
            >
              {control.icon}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
