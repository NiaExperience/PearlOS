'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { SpriteData } from '../types';

interface SpriteGalleryProps {
  sprites: SpriteData[];
  onSelect: (sprite: SpriteData) => void;
}

export const SpriteGallery: React.FC<SpriteGalleryProps> = ({ sprites, onSelect }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [enlarged, setEnlarged] = useState<SpriteData | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    updateScrollButtons();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    return () => el.removeEventListener('scroll', updateScrollButtons);
  }, [sprites.length, updateScrollButtons]);

  const scroll = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 220, behavior: 'smooth' });
  };

  if (sprites.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-white/15 text-xs uppercase tracking-[0.3em]"
        style={{ fontFamily: 'Gohufont, monospace' }}
      >
        Your collection awaits…
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ fontFamily: 'Gohufont, monospace' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 mb-3">
        <div className="text-[10px] uppercase tracking-[0.3em] text-cyan-400/40">
          ✦ Collection · {sprites.length} sprite{sprites.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Carousel container */}
      <div className="relative group">
        {/* Left arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scroll(-1)}
            className="absolute left-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center
              bg-gradient-to-r from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Scroll left"
          >
            <span className="text-white/60 text-lg">‹</span>
          </button>
        )}

        {/* Right arrow */}
        {canScrollRight && (
          <button
            onClick={() => scroll(1)}
            className="absolute right-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center
              bg-gradient-to-l from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Scroll right"
          >
            <span className="text-white/60 text-lg">›</span>
          </button>
        )}

        {/* Scrollable row */}
        <div
          ref={scrollRef}
          className="flex gap-2 overflow-x-auto px-3 pb-3 snap-x snap-mandatory"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <style>{`div::-webkit-scrollbar { display: none; }`}</style>
          {sprites.map((sprite) => (
            <PedestalCard
              key={sprite.id}
              sprite={sprite}
              onSelect={onSelect}
              onEnlarge={setEnlarged}
            />
          ))}
        </div>
      </div>

      {/* Enlarged overlay */}
      {enlarged && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setEnlarged(null)}
        >
          <div
            className="relative flex flex-col items-center animate-in fade-in zoom-in duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Glow behind image */}
            <div
              className="absolute inset-0 rounded-2xl opacity-30 blur-3xl"
              style={{ background: 'radial-gradient(circle, #06b6d4 0%, transparent 70%)' }}
            />
            <div className="relative rounded-xl overflow-hidden border border-cyan-500/20"
              style={{ boxShadow: '0 0 40px rgba(6,182,212,0.15), 0 0 80px rgba(6,182,212,0.05)' }}
            >
              <img
                src={enlarged.imageUrl}
                alt={enlarged.name}
                className="max-w-[300px] max-h-[300px] object-contain"
              />
            </div>
            <div className="mt-4 text-center">
              <div className="text-white/90 text-sm tracking-wide">{enlarged.name}</div>
              <div className="text-cyan-400/40 text-[9px] mt-1 uppercase tracking-[0.2em]">
                {enlarged.prompt}
              </div>
            </div>
            <button
              onClick={() => setEnlarged(null)}
              className="mt-4 text-[10px] uppercase tracking-widest text-white/30 hover:text-white/60 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Pedestal Card ───────────────────────────────────── */

const PedestalCard: React.FC<{
  sprite: SpriteData;
  onSelect: (s: SpriteData) => void;
  onEnlarge: (s: SpriteData) => void;
}> = ({ sprite, onSelect, onEnlarge }) => {
  return (
    <button
      type="button"
      onClick={() => onSelect(sprite)}
      onDoubleClick={() => onEnlarge(sprite)}
      className="group relative flex-shrink-0 snap-center flex flex-col items-center pt-2 pb-1 px-1 rounded-xl
        transition-all duration-300 hover:scale-105 focus:outline-none"
      style={{ width: 120 }}
    >
      {/* Ambient glow on hover */}
      <div
        className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background: 'radial-gradient(ellipse at 50% 80%, rgba(6,182,212,0.08) 0%, transparent 70%)',
        }}
      />

      {/* Sprite image */}
      <div className="relative z-10 mb-1">
        <div
          className="overflow-hidden rounded-lg transition-all duration-300
            group-hover:shadow-[0_0_20px_rgba(6,182,212,0.2)]"
          style={{
            width: 88,
            height: 88,
            border: '1px solid rgba(6,182,212,0.12)',
            background: 'rgba(0,0,0,0.3)',
          }}
        >
          <img
            src={sprite.imageUrl}
            alt={sprite.name}
            className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-110"
            draggable={false}
          />
        </div>
      </div>

      {/* Pedestal / platform */}
      <div className="relative z-10 w-[96px] flex flex-col items-center">
        {/* Pedestal surface */}
        <div
          className="w-full h-[3px] rounded-full transition-all duration-300"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(6,182,212,0.25) 30%, rgba(6,182,212,0.4) 50%, rgba(6,182,212,0.25) 70%, transparent 100%)',
            boxShadow: '0 0 8px rgba(6,182,212,0.15)',
          }}
        />
        {/* Pedestal reflection */}
        <div
          className="w-[70%] h-[2px] mt-[1px] rounded-full opacity-40"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(6,182,212,0.15), transparent)',
          }}
        />
      </div>

      {/* Name */}
      <div className="relative z-10 mt-2 w-full">
        <div
          className="truncate text-center text-[9px] text-white/50 group-hover:text-white/80 transition-colors tracking-wide"
          style={{ fontFamily: 'Gohufont, monospace' }}
        >
          {sprite.name}
        </div>
      </div>
    </button>
  );
};
