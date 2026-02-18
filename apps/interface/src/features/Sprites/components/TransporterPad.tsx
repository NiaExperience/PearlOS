'use client';

import React from 'react';
import type { SummonState, SpriteData } from '../types';

interface TransporterPadProps {
  summonState: SummonState;
  activeSprite: SpriteData | null;
  progressLog?: string;
}

export const TransporterPad: React.FC<TransporterPadProps> = ({ summonState, activeSprite, progressLog }) => {
  const isSummoning = summonState === 'summoning';
  const isMaterializing = summonState === 'materializing';
  const isComplete = summonState === 'complete';
  const isActive = isSummoning || isMaterializing;

  return (
    <div className="relative flex items-center justify-center" style={{ height: 320, width: 320 }}>
      {/* CSS animations */}
      <style>{`
        @keyframes pad-pulse {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.05); }
        }
        @keyframes pad-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes particle-rise {
          0% { transform: translateY(0) scale(1); opacity: 0.9; }
          100% { transform: translateY(-180px) scale(0.2); opacity: 0; }
        }
        @keyframes beam-glow {
          0%, 100% { opacity: 0.2; }
          50% { opacity: 0.7; }
        }
        @keyframes materialize {
          0% { opacity: 0; transform: scale(0.5); filter: brightness(3) blur(8px); }
          60% { opacity: 0.8; transform: scale(1.1); filter: brightness(1.5) blur(2px); }
          100% { opacity: 1; transform: scale(1); filter: brightness(1) blur(0); }
        }
        @keyframes ring-expand {
          0% { transform: scale(0.8); opacity: 0.6; }
          50% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(0.8); opacity: 0.6; }
        }
      `}</style>

      {/* Outer glow ring */}
      <div
        className="absolute rounded-full"
        style={{
          width: 300, height: 300,
          border: '2px solid rgba(6, 182, 212, 0.3)',
          boxShadow: isActive
            ? '0 0 40px rgba(6, 182, 212, 0.5), inset 0 0 40px rgba(6, 182, 212, 0.15)'
            : '0 0 20px rgba(6, 182, 212, 0.15), inset 0 0 20px rgba(6, 182, 212, 0.05)',
          animation: isActive ? 'ring-expand 2s ease-in-out infinite' : undefined,
          transition: 'box-shadow 0.6s ease',
        }}
      />

      {/* Middle ring */}
      <div
        className="absolute rounded-full"
        style={{
          width: 220, height: 220,
          border: '1.5px solid rgba(6, 182, 212, 0.25)',
          boxShadow: isActive
            ? '0 0 30px rgba(6, 182, 212, 0.4), inset 0 0 30px rgba(6, 182, 212, 0.1)'
            : '0 0 10px rgba(6, 182, 212, 0.1)',
          animation: isActive ? 'ring-expand 2s ease-in-out infinite 0.3s' : undefined,
          transition: 'box-shadow 0.6s ease',
        }}
      />

      {/* Inner pad */}
      <div
        className="absolute rounded-full"
        style={{
          width: 160, height: 160,
          background: 'radial-gradient(circle, rgba(6, 182, 212, 0.12) 0%, rgba(6, 182, 212, 0.03) 70%, transparent 100%)',
          border: '1px solid rgba(6, 182, 212, 0.2)',
          boxShadow: isActive
            ? '0 0 60px rgba(6, 182, 212, 0.6), inset 0 0 40px rgba(6, 182, 212, 0.2)'
            : '0 0 15px rgba(6, 182, 212, 0.1)',
          animation: isActive ? 'pad-pulse 1.5s ease-in-out infinite' : undefined,
          transition: 'box-shadow 0.6s ease',
        }}
      />

      {/* Spinning orbital ring during summoning */}
      {isActive && (
        <div
          className="absolute rounded-full"
          style={{
            width: 260, height: 260,
            border: '1px dashed rgba(6, 182, 212, 0.4)',
            animation: 'pad-spin 3s linear infinite',
          }}
        />
      )}

      {/* Energy beam column during summoning */}
      {isSummoning && (
        <div
          className="absolute"
          style={{
            width: 80,
            height: 200,
            bottom: '50%',
            background: 'linear-gradient(to top, rgba(6, 182, 212, 0.3), rgba(6, 182, 212, 0.05), transparent)',
            animation: 'beam-glow 1s ease-in-out infinite',
            borderRadius: '40px 40px 0 0',
          }}
        />
      )}

      {/* Particle effects during summoning */}
      {isSummoning && Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: 4 + Math.random() * 4,
            height: 4 + Math.random() * 4,
            background: i % 3 === 0 ? '#06b6d4' : i % 3 === 1 ? '#8b5cf6' : '#22d3ee',
            left: `${35 + Math.random() * 30}%`,
            bottom: '40%',
            animation: `particle-rise ${1.5 + Math.random() * 2}s ease-out infinite`,
            animationDelay: `${Math.random() * 2}s`,
            opacity: 0.8,
            boxShadow: `0 0 6px ${i % 2 === 0 ? '#06b6d4' : '#8b5cf6'}`,
          }}
        />
      ))}

      {/* Materialized sprite */}
      {(isMaterializing || isComplete) && activeSprite && (
        <div
          className="absolute flex items-center justify-center"
          style={{
            width: 140, height: 140,
            animation: isMaterializing ? 'materialize 1.2s ease-out forwards' : undefined,
          }}
        >
          <img
            src={activeSprite.imageUrl}
            alt={activeSprite.name}
            className="w-full h-full object-contain rounded-lg"
            style={{
              filter: isComplete ? 'drop-shadow(0 0 12px rgba(6, 182, 212, 0.5))' : undefined,
            }}
          />
        </div>
      )}

      {/* Progress log during generation */}
      {isSummoning && progressLog && (
        <div
          className="absolute text-cyan-300/70 text-xs text-center px-4 truncate"
          style={{ bottom: 20, maxWidth: 280, fontFamily: 'Gohufont, monospace' }}
        >
          {progressLog}
        </div>
      )}

      {/* Idle state — subtle pulse */}
      {summonState === 'idle' && !activeSprite && (
        <div className="absolute flex items-center justify-center text-cyan-400/30 text-sm uppercase tracking-widest"
          style={{ fontFamily: 'Gohufont, monospace' }}
        >
          Ready
        </div>
      )}
    </div>
  );
};
