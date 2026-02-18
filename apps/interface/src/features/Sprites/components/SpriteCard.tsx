'use client';

import React from 'react';
import type { SpriteData } from '../types';

interface SpriteCardProps {
  sprite: SpriteData;
  onClick: (sprite: SpriteData) => void;
}

export const SpriteCard: React.FC<SpriteCardProps> = ({ sprite, onClick }) => {
  const typeColors: Record<string, string> = {
    character: '#06b6d4',
    icon: '#f59e0b',
    object: '#8b5cf6',
    background: '#10b981',
  };

  const borderColor = typeColors[sprite.type] || '#06b6d4';

  return (
    <button
      type="button"
      onClick={() => onClick(sprite)}
      className="group relative flex flex-col items-center rounded-xl p-2 transition-all duration-200 hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-cyan-400/50"
      style={{ width: 100 }}
    >
      <div
        className="relative mb-1.5 overflow-hidden rounded-lg"
        style={{
          width: 72, height: 72,
          border: `1.5px solid ${borderColor}33`,
          boxShadow: `0 0 8px ${borderColor}22`,
        }}
      >
        <img
          src={sprite.imageUrl}
          alt={sprite.name}
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-110"
        />
      </div>
      <span
        className="w-full truncate text-center text-[10px] text-white/70 group-hover:text-white/90"
        style={{ fontFamily: 'Gohufont, monospace' }}
      >
        {sprite.name}
      </span>
      <span
        className="text-[8px] uppercase tracking-wider"
        style={{ color: borderColor, fontFamily: 'Gohufont, monospace' }}
      >
        {sprite.type}
      </span>
    </button>
  );
};
