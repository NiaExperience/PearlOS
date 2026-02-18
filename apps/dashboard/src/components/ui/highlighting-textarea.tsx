import { useMemo, useRef } from 'react';

interface HighlightingTextareaProps {
  value: string;
  searchTerm: string;
  onChange: (value: string) => void;
  className?: string;
  /**
   * Fixed height (in pixels) for the textarea/backdrop. If omitted, defaults to 140.
   * Using a fixed height makes the box scrollable for long prompts.
   */
  heightPx?: number;
}

export function HighlightingTextarea({ value, searchTerm, onChange, className, heightPx = 140 }: HighlightingTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Build React nodes for highlighted text; preserve newlines via CSS (whitespace-pre-wrap)
  const highlightedNodes = useMemo(() => {
    if (typeof value !== 'string') return value as unknown as string;
    if (!searchTerm.trim()) return value;
    // Escape regex special characters in the search term; place hyphen at end to avoid lint warning
    const escaped = searchTerm.replace(/[\\^$*+?.()|[\]{}-]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = value.split(regex);
    return parts.map((part, idx) =>
      part.toLowerCase() === searchTerm.toLowerCase() ? (
        <span key={idx} className="bg-yellow-200 text-black" data-match="true">{part}</span>
      ) : (
        <span key={idx}>{part}</span>
      )
    );
  }, [value, searchTerm]);
  const handleScroll = () => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  return (
    <div className="relative w-full">
      <div
        ref={backdropRef}
        className={(className ? className + ' ' : '') + "whitespace-pre-wrap pointer-events-none overflow-auto"}
        style={{ height: `${heightPx}px` }}
      >
        {highlightedNodes}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        className={(className ? className + ' ' : '') + "absolute top-0 left-0 h-full bg-transparent text-transparent resize-none overflow-auto caret-foreground"}
        style={{ height: `${heightPx}px` }}
      />
    </div>
  );
} 