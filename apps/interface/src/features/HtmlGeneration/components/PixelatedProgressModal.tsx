'use client';

/**
 * Pixelated Progress Modal
 * 
 * A retro game console-style progress indicator for HTML applet generation.
 * Displays in top-right corner, runs in background, and shows generation progress.
 */

import React, { useEffect, useState } from 'react';
import { ProgressModalConfig } from '../types/html-generation-types';

interface PixelatedProgressModalProps {
  config: ProgressModalConfig;
  onClose?: () => void;
}

const GOHUFONT_FONT_FACE = `
@font-face {
  font-family: 'Gohufont';
  src: url('/fonts/Gohu/GohuFontuni14NerdFontMono-Regular.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
`;

const ensureGohufont = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gohufont-font-face')) return;
  const style = document.createElement('style');
  style.id = 'gohufont-font-face';
  style.textContent = GOHUFONT_FONT_FACE;
  document.head.appendChild(style);
};

export function PixelatedProgressModal({ config, onClose }: PixelatedProgressModalProps) {
  const [animationFrame, setAnimationFrame] = useState(0);
  
  useEffect(() => {
    ensureGohufont();
  }, []);
  
  // Animate the progress bar filling
  useEffect(() => {
    if (config.visible) {
      const interval = setInterval(() => {
        setAnimationFrame(prev => (prev + 1) % 4);
      }, 250);
      
      return () => clearInterval(interval);
    }
  }, [config.visible]);
  
  if (!config.visible) {
    return null;
  }
  
  const getPositionStyles = () => {
    switch (config.position) {
      case 'top-right':
        return 'top-4 right-4';
      case 'center':
        return 'top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2';
      case 'top-center':
        return 'top-4 left-1/2 transform -translate-x-1/2';
      default:
        return 'top-4 right-4';
    }
  };
  
  const progressBarFilled = Math.floor((config.progress / 100) * 20); // 20 blocks
  
  return (
    <div
      className={`fixed ${getPositionStyles()} z-[650] animate-in slide-in-from-top-2 duration-300`}
      style={{
        fontFamily: 'Gohufont, monospace',
        imageRendering: 'pixelated'
      }}
    >
      {/* Main Container - Game Console Style */}
      <div className="relative">
        {/* Outer Border - Thick pixelated border */}
        <div className="bg-gray-800 p-1 rounded-none shadow-2xl border-4 border-gray-900">
          {/* Inner Border - Lighter accent */}
          <div className="bg-gray-700 p-1 border-2 border-gray-600">
            {/* Content Area */}
            <div className="bg-gray-900 p-4 min-w-[320px]">
              {/* Title Bar */}
              <div className="flex items-center justify-between mb-3 pb-2 border-b-2 border-green-500">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 animate-pulse" />
                  <span className="text-green-400 text-xs uppercase tracking-wider">
                    {config.title}
                  </span>
                </div>
                
                {onClose && config.progress >= 100 && (
                  <button
                    onClick={onClose}
                    className="text-red-400 hover:text-red-300 text-xs px-2 py-1 border border-red-400 hover:bg-red-900/20 transition-colors"
                    aria-label="Close"
                  >
                    [X]
                  </button>
                )}
              </div>
              
              {/* Progress Bar */}
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-yellow-400 text-[10px]">PROGRESS:</span>
                  <span className="text-white text-[10px] font-mono">{config.progress}%</span>
                </div>
                
                {/* Pixelated Progress Bar */}
                <div className="border-2 border-green-500 p-1 bg-black">
                  <div className="flex gap-[2px] h-4">
                    {Array.from({ length: 20 }).map((_, index) => (
                      <div
                        key={index}
                        className={`flex-1 transition-colors duration-150 ${
                          index < progressBarFilled
                            ? 'bg-green-500'
                            : 'bg-gray-800 border border-gray-700'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Phase/Status Text */}
              <div className="mb-2">
                <div className="text-cyan-400 text-[10px] mb-1">STATUS:</div>
                <div className="text-white text-[9px] leading-relaxed min-h-[36px] flex items-center">
                  <span className="animate-pulse mr-1">▶</span>
                  <span>{config.phase}</span>
                  <span className="ml-1">
                    {animationFrame === 0 && '.'}
                    {animationFrame === 1 && '..'}
                    {animationFrame === 2 && '...'}
                    {animationFrame === 3 && ''}
                  </span>
                </div>
              </div>
              
              {/* Loading Animation - Retro spinning blocks */}
              {config.progress < 100 && (
                <div className="flex justify-center items-center gap-1 mt-3 pt-3 border-t border-gray-700">
                  <div className={`w-2 h-2 ${animationFrame === 0 ? 'bg-cyan-400' : 'bg-gray-700'}`} />
                  <div className={`w-2 h-2 ${animationFrame === 1 ? 'bg-cyan-400' : 'bg-gray-700'}`} />
                  <div className={`w-2 h-2 ${animationFrame === 2 ? 'bg-cyan-400' : 'bg-gray-700'}`} />
                  <div className={`w-2 h-2 ${animationFrame === 3 ? 'bg-cyan-400' : 'bg-gray-700'}`} />
                </div>
              )}
              
              {/* Completion Message */}
              {config.progress >= 100 && (
                <div className="mt-3 pt-3 border-t border-green-500">
                  <div className="text-center">
                    <div className="text-green-400 text-xs animate-pulse">
                      ✓ COMPLETE!
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Corner Decorations - Retro style */}
        <div className="absolute -top-1 -left-1 w-3 h-3 bg-yellow-400 border-2 border-gray-900" />
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 border-2 border-gray-900" />
        <div className="absolute -bottom-1 -left-1 w-3 h-3 bg-yellow-400 border-2 border-gray-900" />
        <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-yellow-400 border-2 border-gray-900" />
      </div>
    </div>
  );
}

/**
 * Global Progress Modal Hook
 * 
 * Manages global progress modal state
 */
export function usePixelatedProgress() {
  const [config, setConfig] = useState<ProgressModalConfig>({
    visible: false,
    title: 'GENERATING...',
    progress: 0,
    phase: 'Initializing...',
    style: 'pixelated',
    position: 'top-right'
  });
  
  const show = (title: string, phase?: string) => {
    setConfig(prev => ({
      ...prev,
      visible: true,
      title: title.toUpperCase(),
      progress: 0,
      phase: phase || 'Initializing...'
    }));
  };
  
  const updateProgress = (progress: number, phase: string) => {
    setConfig(prev => ({
      ...prev,
      progress: Math.min(Math.max(progress, 0), 100),
      phase
    }));
  };
  
  const complete = (message?: string) => {
    setConfig(prev => ({
      ...prev,
      progress: 100,
      phase: message || 'Generation complete!'
    }));
  };
  
  const hide = () => {
    setConfig(prev => ({
      ...prev,
      visible: false
    }));
  };
  
  const reset = () => {
    setConfig({
      visible: false,
      title: 'GENERATING...',
      progress: 0,
      phase: 'Initializing...',
      style: 'pixelated',
      position: 'top-right'
    });
  };
  
  return {
    config,
    show,
    updateProgress,
    complete,
    hide,
    reset,
    isVisible: config.visible,
    isComplete: config.progress >= 100
  };
}

/**
 * Global Progress Modal Context
 */
interface ProgressContextType {
  show: (title: string, phase?: string) => void;
  updateProgress: (progress: number, phase: string) => void;
  complete: (message?: string) => void;
  hide: () => void;
  reset: () => void;
  config: ProgressModalConfig;
}

const ProgressContext = React.createContext<ProgressContextType | null>(null);

/**
 * Global Progress Modal Provider
 */
export function GlobalProgressModalProvider({ children }: { children: React.ReactNode }) {
  const progressHook = usePixelatedProgress();
  
  return (
    <ProgressContext.Provider value={progressHook}>
      {children}
      <PixelatedProgressModal 
        config={progressHook.config} 
        onClose={progressHook.hide}
      />
    </ProgressContext.Provider>
  );
}

/**
 * Hook to use global progress modal
 */
export function useGlobalProgress() {
  const context = React.useContext(ProgressContext);
  if (!context) {
    throw new Error('useGlobalProgress must be used within GlobalProgressModalProvider');
  }
  return context;
}

