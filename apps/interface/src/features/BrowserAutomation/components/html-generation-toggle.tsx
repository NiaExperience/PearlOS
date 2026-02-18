'use client';

import React from 'react';

interface HtmlGenerationInlineToggleProps {
  enabled: boolean;
  onToggle: () => void;
  busy?: boolean;
  labelOn?: string;
  labelOff?: string;
}

export const HtmlGenerationInlineToggle: React.FC<HtmlGenerationInlineToggleProps> = ({
  enabled,
  onToggle,
  busy = false,
  labelOn = 'Disable HTML Generation',
  labelOff = 'Enable HTML Generation'
}) => {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={enabled}
      className={`px-2 py-1 rounded border text-xs font-medium transition-colors inline-flex items-center gap-1
        ${enabled ? 'bg-green-600 text-white border-green-700 hover:bg-green-500' : 'bg-muted text-foreground hover:bg-muted/70'}
        ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      {busy ? 'Working…' : (enabled ? labelOn : labelOff)}
    </button>
  );
};

export default HtmlGenerationInlineToggle;
