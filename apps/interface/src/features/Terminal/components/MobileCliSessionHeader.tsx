'use client';

import { ArrowLeft, Square } from 'lucide-react';
import { sessionTitle, type MobileCliSessionKind } from './MobileCliTypes';

type Props = {
  busy: boolean;
  kind: MobileCliSessionKind;
  pathLabel: string;
  onBack: () => void;
  onStop: () => void;
};

export function MobileCliSessionHeader({
  busy,
  kind,
  pathLabel,
  onBack,
  onStop,
}: Props) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--pearl-window-border)] bg-[var(--pearl-window-title-bg)] px-2">
      <button
        aria-label="New session"
        className="grid h-9 w-9 place-items-center rounded-md border border-[var(--pearl-window-control-border)] bg-[var(--pearl-window-control-bg)] text-[var(--pearl-text)]"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>

      <button
        aria-label="Stop session"
        className="flex h-9 items-center gap-2 rounded-md border border-[var(--pearl-window-control-border)] bg-[var(--pearl-window-control-bg)] px-3 text-xs font-medium text-[var(--pearl-text)]"
        onClick={onStop}
        type="button"
      >
        <Square className="h-3.5 w-3.5" />
        Stop
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${busy ? 'animate-pulse bg-[var(--pearl-muted)]' : 'bg-[var(--pearl-accent)]'}`} />
          <span className="text-sm font-semibold">{sessionTitle(kind)}</span>
        </div>
        <div className="truncate font-mono text-[11px] text-[var(--pearl-muted)]">{pathLabel}</div>
      </div>
    </div>
  );
}
