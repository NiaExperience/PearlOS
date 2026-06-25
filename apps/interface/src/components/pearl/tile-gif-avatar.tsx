"use client";

import React from "react";

/**
 * TileGifAvatar — GIF-based Pearl avatar for video call tiles.
 *
 * Displays idle or talking GIF based on `isSpeaking` prop.
 *
 * IMPORTANT: No internal state or timers. The GIF swaps IMMEDIATELY when
 * the prop changes. All debouncing/smoothing is handled upstream by the
 * audio detection hook. Adding delays here caused the previous bug where
 * rapid speaking state toggles would get "stuck" in the transition timer
 * and show the wrong GIF.
 *
 * Visual smoothness comes from CSS opacity transition on the crossfade,
 * not from JavaScript setTimeout delays.
 */

const PEARL_ANIMATION_BASE = "/images/avatar/pearl-animation-gifs/optimized";
const PEARL_IDLE_GIFS = [
  `${PEARL_ANIMATION_BASE}/PearlIdle1.gif`,
  `${PEARL_ANIMATION_BASE}/PearlIdle2.gif`,
] as const;
const PEARL_TALKING_GIFS = [
  `${PEARL_ANIMATION_BASE}/PearlTalk1.gif`,
  `${PEARL_ANIMATION_BASE}/PearlTalk2.gif`,
] as const;

interface TileGifAvatarProps {
  isSpeaking: boolean;
  size?: number;
  className?: string;
}

const TileGifAvatar: React.FC<TileGifAvatarProps> = ({
  isSpeaking,
  size = 120,
  className = "",
}) => {
  const idleGifRef = React.useRef(PEARL_IDLE_GIFS[Math.floor(Math.random() * PEARL_IDLE_GIFS.length)]);
  const talkingGifRef = React.useRef(PEARL_TALKING_GIFS[Math.floor(Math.random() * PEARL_TALKING_GIFS.length)]);

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      {/* Both GIFs are always mounted (preloaded). Toggle visibility via opacity.
          This avoids the flash/delay of loading a new <img> src on transition. */}
      <img
        src={idleGifRef.current}
        alt="Pearl idle"
        className="absolute rounded-full object-cover"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          opacity: isSpeaking ? 0 : 1,
          transition: "opacity 120ms ease-in-out",
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).src = "/images/pearl-avatar.png";
        }}
      />
      <img
        src={talkingGifRef.current}
        alt="Pearl talking"
        className="absolute rounded-full object-cover"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          opacity: isSpeaking ? 1 : 0,
          transition: "opacity 120ms ease-in-out",
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).src = "/images/pearl-avatar.png";
        }}
      />
    </div>
  );
};

export default TileGifAvatar;
