'use client';

import React from 'react';

type Props = {
  output: string;
  outputRef: React.Ref<HTMLDivElement>;
};

export function MobileCliOutputPane({ output, outputRef }: Props) {
  return (
    <div className="min-h-0 flex-1 bg-[var(--pearl-window-content-bg)] p-2">
      <div
        className="h-full overflow-auto rounded-md border border-[var(--pearl-window-border)] bg-[var(--pearl-window-bg)] p-3 shadow-inner"
        ref={outputRef}
      >
        {output ? (
          <pre className="m-0 min-w-0 w-full whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-[var(--pearl-text)] [overflow-wrap:anywhere]">
            {output}
          </pre>
        ) : (
          <div className="font-mono text-xs text-[var(--pearl-muted)]">Starting session...</div>
        )}
      </div>
    </div>
  );
}
