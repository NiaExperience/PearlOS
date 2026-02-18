'use client';

import React, { useState, useEffect } from 'react';

interface TileRiveAvatarProps {
  className?: string;
  isSpeaking: boolean;
  audioLevelRef: React.MutableRefObject<number>;
  userName?: string;
}

// GIF paths - Pearl avatar GIFs (same as main RiveAvatar component)
const AVATAR_IDLE_GIFS = [
  '/images/avatar/pearlIdle1.gif',
  '/images/avatar/Pearlidle2.gif'
];
const AVATAR_TALKING_GIF = '/images/avatar/avatar-talking.gif';

/**
 * GIF-based avatar component for Pearl bot in Daily Call tiles
 * Uses bot speaking detection to switch between idle and talking GIFs
 * Randomly cycles through idle GIFs when not speaking
 */
export const TileRiveAvatar: React.FC<TileRiveAvatarProps> = ({ 
  className = '',
  isSpeaking,
  audioLevelRef, // Kept for API compatibility but not used with GIFs
  userName // Kept for API compatibility but not used
}) => {
  const [currentIdleGifIndex, setCurrentIdleGifIndex] = useState(0);

  // Determine which GIF to show based on speaking state
  const currentGifSrc = isSpeaking 
    ? AVATAR_TALKING_GIF 
    : AVATAR_IDLE_GIFS[currentIdleGifIndex];

  // Cycle through idle GIFs when not speaking (change every 3-5 seconds)
  useEffect(() => {
    if (!isSpeaking) {
      const cycleInterval = setInterval(() => {
        setCurrentIdleGifIndex(prev => {
          // Randomly pick next idle GIF (could be same or different)
          return Math.floor(Math.random() * AVATAR_IDLE_GIFS.length);
        });
      }, 3000 + Math.random() * 2000); // Random interval between 3-5 seconds

      return () => clearInterval(cycleInterval);
    } else if (isSpeaking) {
      // When starting to speak, randomly select a new idle GIF for next idle cycle
      setCurrentIdleGifIndex(Math.floor(Math.random() * AVATAR_IDLE_GIFS.length));
    }
  }, [isSpeaking]);

  return (
    <div className={`tile-rive-avatar ${className}`}>
      <img
        src={currentGifSrc}
        alt="Avatar"
        style={{ 
          width: '130%',
          height: '130%',
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          transformOrigin: 'center center',
          objectFit: 'cover',
          background: 'transparent',
          backgroundColor: 'transparent'
        }} 
      />
    </div>
  );
};