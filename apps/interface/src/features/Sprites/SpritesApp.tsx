'use client';

import React from 'react';
import { TransporterPad } from './components/TransporterPad';
import { SpriteGallery } from './components/SpriteGallery';
import { SummonInput } from './components/SummonInput';
import { useSprites } from './hooks/useSprites';

const SpritesApp: React.FC = () => {
  const { sprites, summonState, activeSprite, selectedSprite, setSelectedSprite, summon, progressLog } = useSprites();

  return (
    <div
      className="flex h-full w-full flex-col items-center overflow-y-auto"
      style={{
        background: 'linear-gradient(180deg, #020617 0%, #0a0f1e 40%, #0c1222 100%)',
        minHeight: '100%',
      }}
    >
      {/* Header */}
      <div className="w-full px-4 pt-4 pb-2 text-center">
        <h1
          className="text-sm uppercase tracking-[0.3em] text-cyan-400/60"
          style={{ fontFamily: 'Gohufont, monospace' }}
        >
          Sprite Summoner
        </h1>
      </div>

      {/* Transporter Pad */}
      <div className="flex flex-1 items-center justify-center py-4">
        <TransporterPad summonState={summonState} activeSprite={activeSprite} progressLog={progressLog} />
      </div>

      {/* Summon Input */}
      <div className="w-full px-4 pb-4">
        <SummonInput onSummon={summon} summonState={summonState} />
      </div>

      {/* Selected sprite detail overlay */}
      {selectedSprite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setSelectedSprite(null)}
        >
          <div
            className="relative max-w-sm rounded-2xl border border-cyan-400/20 p-6"
            style={{ background: 'rgba(2, 6, 23, 0.95)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelectedSprite(null)}
              className="absolute right-3 top-3 text-white/40 hover:text-white/80 transition-colors"
            >
              ✕
            </button>
            <img
              src={selectedSprite.imageUrl}
              alt={selectedSprite.name}
              className="mx-auto mb-4 h-48 w-48 rounded-xl object-contain"
              style={{ filter: 'drop-shadow(0 0 16px rgba(6, 182, 212, 0.4))' }}
            />
            <h2 className="text-center text-lg text-white/90 mb-1" style={{ fontFamily: 'Gohufont, monospace' }}>
              {selectedSprite.name}
            </h2>
            <p className="text-center text-xs text-white/40 mb-3" style={{ fontFamily: 'Gohufont, monospace' }}>
              &quot;{selectedSprite.prompt}&quot;
            </p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                className="rounded-lg border border-cyan-400/30 px-4 py-1.5 text-xs text-cyan-400/80 hover:bg-cyan-400/10 transition-colors"
                style={{ fontFamily: 'Gohufont, monospace' }}
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = selectedSprite.imageUrl;
                  a.download = `${selectedSprite.name}.png`;
                  a.click();
                }}
              >
                Download
              </button>
              <button
                type="button"
                className="rounded-lg border border-violet-400/30 px-4 py-1.5 text-xs text-violet-400/80 hover:bg-violet-400/10 transition-colors"
                style={{ fontFamily: 'Gohufont, monospace' }}
              >
                Deploy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gallery */}
      <div className="w-full border-t border-white/5 px-4 py-4">
        <SpriteGallery sprites={sprites} onSelect={setSelectedSprite} />
      </div>
    </div>
  );
};

export default SpritesApp;
