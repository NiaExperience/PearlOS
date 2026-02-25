'use client';

import React, { useContext, useState, useRef, useEffect } from 'react';
import { Music2 } from 'lucide-react';
import { SoundtrackContext } from '@interface/features/Soundtrack';

/**
 * Compact music note button for the top-left nav bar with dropdown player panel.
 * Replaces the old floating SoundtrackToggleButton bar.
 */
export function SoundtrackNavButton() {
  const context = useContext(SoundtrackContext);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  if (!context) return null;

  const { isPlaying, autoplayBlocked, play, stop, next, getCurrentTrack, baseVolume, setBaseVolume } = context;

  const track = getCurrentTrack();
  const isActive = isPlaying && !autoplayBlocked;
  const volumePercent = Math.round(baseVolume * 100);

  const handlePlayPause = () => {
    if (isPlaying) stop();
    else play();
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBaseVolume(parseFloat(e.target.value));
  };

  const PlayIcon = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', shapeRendering: 'crispEdges' }}>
      <polygon points="3,2 3,12 11,7" />
    </svg>
  );

  const PauseIcon = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', shapeRendering: 'crispEdges' }}>
      <rect x="3" y="2" width="3" height="10" />
      <rect x="8" y="2" width="3" height="10" />
    </svg>
  );

  const NextIcon = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', shapeRendering: 'crispEdges' }}>
      <polygon points="2,2 2,12 8,7" />
      <polygon points="7,2 7,12 13,7" />
    </svg>
  );

  const VolumeMutedIcon = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', shapeRendering: 'crispEdges' }}>
      <polygon points="1,5 1,9 4,9 7,12 7,2 4,5" fill="currentColor" />
      <line x1="9" y1="4" x2="13" y2="10" stroke="currentColor" strokeWidth="1.5" />
      <line x1="13" y1="4" x2="9" y2="10" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );

  const VolumeLowIcon = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', shapeRendering: 'crispEdges' }}>
      <polygon points="1,5 1,9 4,9 7,12 7,2 4,5" fill="currentColor" />
      <rect x="9" y="5" width="2" height="4" fill="currentColor" opacity="0.8" />
    </svg>
  );

  const VolumeMedIcon = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', shapeRendering: 'crispEdges' }}>
      <polygon points="1,5 1,9 4,9 7,12 7,2 4,5" fill="currentColor" />
      <rect x="9" y="5" width="2" height="4" fill="currentColor" opacity="0.8" />
      <rect x="12" y="4" width="1.5" height="6" fill="currentColor" opacity="0.55" />
    </svg>
  );

  const VolumeHighIcon = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', shapeRendering: 'crispEdges' }}>
      <polygon points="1,5 1,9 4,9 7,12 7,2 4,5" fill="currentColor" />
      <rect x="9" y="5" width="2" height="4" fill="currentColor" opacity="0.85" />
      <rect x="12" y="4" width="1.5" height="6" fill="currentColor" opacity="0.7" />
      <rect x="14" y="3" width="1" height="8" fill="currentColor" opacity="0.45" />
    </svg>
  );

  const getVolumeIcon = () => {
    if (baseVolume === 0) return <VolumeMutedIcon />;
    if (baseVolume < 0.33) return <VolumeLowIcon />;
    if (baseVolume < 0.66) return <VolumeMedIcon />;
    return <VolumeHighIcon />;
  };

  return (
    <div className="relative">
      {/* Nav button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        title="Soundtrack"
        className={`flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/70 backdrop-blur-md transition-all hover:border-white/25 hover:bg-black/60 hover:text-white ${
          isActive ? 'border-blue-400/40 text-blue-300/90' : ''
        }`}
      >
        <Music2
          size={16}
          className={isActive ? 'animate-pulse' : ''}
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={panelRef}
          className="absolute left-0 top-full mt-2 w-64 rounded-xl border border-white/10 bg-black/70 p-4 backdrop-blur-xl"
          style={{ zIndex: 900 }}
        >
          {/* Track info */}
          <div className="mb-3">
            {track && isActive ? (
              <div>
                <div className="truncate text-sm font-medium text-blue-100/90">{track.title}</div>
                <div className="truncate text-xs text-blue-200/50">{track.artist}</div>
              </div>
            ) : (
              <div className="text-xs text-white/40">
                {autoplayBlocked ? 'Tap play to start' : 'No track playing'}
              </div>
            )}
          </div>

          {/* Controls row */}
          <div className="mb-3 flex items-center gap-3">
            <button
              onClick={handlePlayPause}
              className="flex h-10 w-10 items-center justify-center border border-[#3f4c6b] bg-[#1a2236] text-[#f8c34a] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_2px_0_rgba(0,0,0,0.35)] transition-all hover:bg-[#222d45] active:translate-y-[1px]"
              style={{ borderRadius: 12 }}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              onClick={() => next()}
              className="flex h-10 w-10 items-center justify-center border border-[#3f4c6b] bg-[#1a2236] text-[#e6eefb] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_2px_0_rgba(0,0,0,0.35)] transition-all hover:bg-[#222d45] active:translate-y-[1px]"
              style={{ borderRadius: 12 }}
              aria-label="Next track"
            >
              <NextIcon />
            </button>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center border border-[#3f4c6b] bg-[#1a2236] text-[#9ec7ff] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" style={{ borderRadius: 10 }}>
              {getVolumeIcon()}
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={baseVolume}
              onChange={handleVolumeChange}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-blue-400"
              aria-label="Volume"
            />
            <span className="w-8 text-right text-[10px] text-white/40">{volumePercent}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
