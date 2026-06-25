import React, { useState, useCallback } from 'react';

interface MagicWandButtonProps {
  noteId: string;
  onSendToLaunchpad?: (noteId: string) => Promise<void>;
  disabled?: boolean;
}

function Sparkle({ delay, x, y }: { delay: number; x: number; y: number }) {
  return (
    <span
      className="absolute w-1 h-1 rounded-full bg-purple-300"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        animation: `mw-sparkle 1.2s ease-in-out ${delay}s infinite`,
        opacity: 0,
      }}
    />
  );
}

export function MagicWandButton({ noteId, onSendToLaunchpad, disabled }: MagicWandButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = useCallback(async () => {
    if (!onSendToLaunchpad || isLoading) return;
    setIsLoading(true);
    try {
      await onSendToLaunchpad(noteId);
    } finally {
      setIsLoading(false);
    }
  }, [onSendToLaunchpad, noteId, isLoading]);

  const sparkles = [
    { delay: 0, x: 15, y: 10 },
    { delay: 0.3, x: 80, y: 15 },
    { delay: 0.6, x: 70, y: 75 },
    { delay: 0.9, x: 20, y: 70 },
    { delay: 0.45, x: 50, y: 5 },
    { delay: 0.75, x: 85, y: 50 },
  ];

  return (
    <div className="relative inline-block">
      {/* Tooltip */}
      {showTooltip && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap
            bg-purple-900/90 text-purple-100 border border-purple-400/30 shadow-lg shadow-purple-500/20
            animate-in fade-in slide-in-from-bottom-1 duration-200"
        >
          Send to Launchpad
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
            <div className="w-2 h-2 rotate-45 bg-purple-900/90 border-r border-b border-purple-400/30" />
          </div>
        </div>
      )}

      <button
        onClick={handleClick}
        disabled={disabled || isLoading}
        aria-label="Send to Launchpad"
        aria-busy={isLoading}
        onMouseEnter={() => { setShowTooltip(true); setIsHovered(true); }}
        onMouseLeave={() => { setShowTooltip(false); setIsHovered(false); }}
        className={`
          relative flex items-center justify-center w-10 h-10 rounded-full
          bg-gradient-to-br from-purple-500/25 via-purple-600/20 to-fuchsia-700/25
          backdrop-blur-sm border border-purple-300/25
          transition-all duration-300 ease-out
          hover:from-purple-500/40 hover:via-purple-600/35 hover:to-fuchsia-700/40
          hover:border-purple-300/50 hover:shadow-lg hover:shadow-purple-500/25
          active:scale-90
          disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none
          ${isLoading ? 'animate-pulse' : ''}
          ${isHovered && !isLoading ? 'ring-2 ring-purple-400/20 ring-offset-1 ring-offset-transparent' : ''}
        `}
      >
        {/* Sparkles */}
        {isHovered && !isLoading && sparkles.map((s, i) => (
          <Sparkle key={i} delay={s.delay} x={s.x} y={s.y} />
        ))}

        {/* Wand icon */}
        <img
          src="/icons/magic-wand.png"
          alt=""
          aria-hidden="true"
          className={`w-6 h-6 object-contain transition-transform duration-300 ${isHovered ? 'scale-110' : ''}`}
        />

        {/* Subtle inner glow on hover */}
        {isHovered && !isLoading && (
          <span className="absolute inset-0 rounded-full bg-purple-400/10 blur-md" />
        )}
      </button>

      <style>{`
        @keyframes mw-sparkle {
          0%, 100% { opacity: 0; transform: scale(0.5); }
          50% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
}
