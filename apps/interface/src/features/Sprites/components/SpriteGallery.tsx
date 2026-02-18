'use client';

import React from 'react';
import type { SpriteData } from '../types';
import { SpriteCard } from './SpriteCard';

interface SpriteGalleryProps {
  sprites: SpriteData[];
  onSelect: (sprite: SpriteData) => void;
}

export const SpriteGallery: React.FC<SpriteGalleryProps> = ({ sprites, onSelect }) => {
  if (sprites.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-white/20 text-xs uppercase tracking-widest"
        style={{ fontFamily: 'Gohufont, monospace' }}
      >
        No sprites summoned yet
      </div>
    );
  }

  return (
    <div className="w-full">
      <div
        className="mb-2 text-[10px] uppercase tracking-widest text-cyan-400/50 px-2"
        style={{ fontFamily: 'Gohufont, monospace' }}
      >
        Recent Summons
      </div>
      <div className="flex flex-wrap gap-1 justify-center">
        {sprites.map((sprite) => (
          <SpriteCard key={sprite.id} sprite={sprite} onClick={onSelect} />
        ))}
      </div>
    </div>
  );
};
