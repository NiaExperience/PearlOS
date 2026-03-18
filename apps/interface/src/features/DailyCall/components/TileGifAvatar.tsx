'use client';

import React from 'react';
import PearlAvatar from '@interface/components/PearlAvatar';

interface TileGifAvatarProps {
  className?: string;
  isSpeaking: boolean;
  isCallActive?: boolean;
  audioLevelRef: React.MutableRefObject<number>;
  userName?: string;
}

/**
 * GIF-based avatar for Pearl bot in Daily Call tiles.
 * Delegates all animation state to PearlAvatar (single source of truth).
 */
export const TileGifAvatar: React.FC<TileGifAvatarProps> = ({ 
  className = '',
  isSpeaking,
  isCallActive = true,
}) => {
  return (
    <div className={`tile-rive-avatar ${className}`} style={{ pointerEvents: 'none' }}>
      <PearlAvatar
        isAwake={isCallActive}
        isTalking={isSpeaking}
        size={250}
        className="object-cover"
        style={{
          width: '250px',
          height: '250px',
          maxWidth: '250px',
          maxHeight: '250px',
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          transformOrigin: 'center center',
          background: 'transparent',
          backgroundColor: 'transparent',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};
