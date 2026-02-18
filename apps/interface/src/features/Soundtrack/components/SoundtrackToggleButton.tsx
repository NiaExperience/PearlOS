'use client';

import React, { useContext, useState, useRef, useEffect, useCallback } from 'react';

import { SoundtrackContext } from './SoundtrackProvider';

/**
 * Floating music bar for the PearlOS background soundtrack.
 *
 * Features:
 * - Play/pause toggle
 * - Current track info (title & artist) with marquee for long text
 * - Volume slider on click of volume icon
 * - Skip track button
 * - Glassmorphic PearlOS aesthetic
 */
export function SoundtrackToggleButton() {
  const context = useContext(SoundtrackContext);
  const [showVolume, setShowVolume] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const volumeRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Silently return null if no provider
  if (!context) return null;

  const { isPlaying, autoplayBlocked, play, stop, next, getCurrentTrack, baseVolume, setBaseVolume } = context;

  const track = getCurrentTrack();
  const isBlocked = autoplayBlocked && !isPlaying;
  const isActive = isPlaying && !autoplayBlocked;
  const volumePercent = Math.round(baseVolume * 100);

  const handlePlayPause = () => {
    if (isPlaying) stop();
    else play();
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBaseVolume(parseFloat(e.target.value));
  };

  const toggleVolume = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowVolume((v) => !v);
  };

  // Close volume popup on outside click
  useEffect(() => {
    if (!showVolume) return;
    const handleClick = (e: MouseEvent) => {
      if (volumeRef.current && !volumeRef.current.contains(e.target as Node)) {
        setShowVolume(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showVolume]);

  // Volume icon based on level
  const getVolumeIcon = () => {
    if (baseVolume === 0) return '🔇';
    if (baseVolume < 0.33) return '🔈';
    if (baseVolume < 0.66) return '🔉';
    return '🔊';
  };

  return (
    <>
      <style>{`
        @keyframes soundtrackPulse {
          0%, 100% { box-shadow: 0 0 8px 2px rgba(96,165,250,0.25); }
          50% { box-shadow: 0 0 14px 4px rgba(96,165,250,0.45); }
        }
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .soundtrack-bar-playing {
          animation: soundtrackPulse 3s ease-in-out infinite;
        }
        .soundtrack-volume-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 2px;
          background: linear-gradient(to right, rgba(96,165,250,0.8) 0%, rgba(96,165,250,0.8) var(--vol-pct), rgba(255,255,255,0.15) var(--vol-pct), rgba(255,255,255,0.15) 100%);
          outline: none;
          cursor: pointer;
        }
        .soundtrack-volume-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: rgba(219,234,254,0.95);
          border: 1.5px solid rgba(96,165,250,0.7);
          box-shadow: 0 0 4px rgba(96,165,250,0.5);
          cursor: pointer;
        }
        .soundtrack-volume-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: rgba(219,234,254,0.95);
          border: 1.5px solid rgba(96,165,250,0.7);
          box-shadow: 0 0 4px rgba(96,165,250,0.5);
          cursor: pointer;
        }
        .soundtrack-btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          outline: none;
          font-size: 16px;
          line-height: 1;
          user-select: none;
          transition: opacity 0.15s;
          opacity: 0.8;
        }
        .soundtrack-btn:hover {
          opacity: 1;
        }
        .soundtrack-track-info {
          overflow: hidden;
          white-space: nowrap;
          max-width: 160px;
          position: relative;
        }
        .soundtrack-track-text {
          display: inline-block;
          font-size: 11px;
          color: rgba(219,234,254,0.85);
          letter-spacing: 0.2px;
        }
        .soundtrack-track-artist {
          font-size: 10px;
          color: rgba(147,197,253,0.7);
          display: block;
          margin-top: 1px;
        }
      `}</style>

      <div
        ref={barRef}
        style={{
          position: 'fixed',
          bottom: '1rem',
          right: '1rem',
          zIndex: 250,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: isActive
            ? 'rgba(15,23,42,0.75)'
            : 'rgba(15,23,42,0.6)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: isBlocked
            ? '1px solid rgba(251,191,36,0.5)'
            : isActive
            ? '1px solid rgba(96,165,250,0.4)'
            : '1px solid rgba(96,165,250,0.2)',
          borderRadius: '22px',
          padding: '5px 10px',
          transition: 'all 0.3s ease',
        }}
        className={isActive ? 'soundtrack-bar-playing' : ''}
      >
        {/* Play/Pause */}
        <button
          className="soundtrack-btn"
          onClick={handlePlayPause}
          aria-label={isPlaying ? 'Pause soundtrack' : 'Play soundtrack'}
          style={{ fontSize: '18px' }}
        >
          {isPlaying ? '⏸' : '▶️'}
        </button>

        {/* Track Info */}
        {track && isActive && (
          <div className="soundtrack-track-info">
            <span className="soundtrack-track-text">
              {track.title}
              <span className="soundtrack-track-artist">{track.artist}</span>
            </span>
          </div>
        )}

        {/* Blocked hint */}
        {isBlocked && (
          <span style={{ fontSize: '11px', color: 'rgba(253,230,138,0.9)' }}>
            Tap to play
          </span>
        )}

        {/* Skip */}
        {isActive && (
          <button
            className="soundtrack-btn"
            onClick={() => next()}
            aria-label="Next track"
            style={{ fontSize: '14px' }}
          >
            ⏭
          </button>
        )}

        {/* Volume */}
        <div ref={volumeRef} style={{ position: 'relative' }}>
          <button
            className="soundtrack-btn"
            onClick={toggleVolume}
            aria-label="Volume"
            style={{ fontSize: '15px' }}
          >
            {getVolumeIcon()}
          </button>

          {/* Volume popup */}
          {showVolume && (
            <div
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 10px)',
                right: '-8px',
                background: 'rgba(15,23,42,0.9)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(96,165,250,0.3)',
                borderRadius: '12px',
                padding: '12px 14px',
                width: '160px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '11px',
                color: 'rgba(219,234,254,0.7)',
              }}>
                <span>Volume</span>
                <span>{volumePercent}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={baseVolume}
                onChange={handleVolumeChange}
                className="soundtrack-volume-slider"
                style={{ '--vol-pct': `${volumePercent}%` } as React.CSSProperties}
                aria-label="Soundtrack volume"
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
