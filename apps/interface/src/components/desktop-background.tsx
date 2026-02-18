'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
 
 import { requestWindowOpen } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';
 import { trackSessionHistory } from '@interface/lib/session-history';
import { getClientLogger } from '@interface/lib/client-logger';
 
 import { DesktopMode, type DesktopModeSwitchResponse } from '../types/desktop-modes';
 import ModeCard from './mode-card';

type ModeKey = 'create' | 'work' | 'quiet' | 'social';

interface ModeCardConfig {
  key: ModeKey;
  label: string;
  image: string;
  targetMode: DesktopMode;
}

const MODE_TEXT_COLORS: Record<ModeKey, string> = {
  create: '#DAC560',
  work: '#4CCEDE',
  quiet: '#AEB6C5',
  social: '#F2F97B',
};

interface BuildingPosition {
  top: string; // Percentage of container height
  left: string; // Percentage of container width
  width: string; // Percentage of container width
  height?: string; // Optional height, defaults to 'auto' to maintain aspect ratio
}

interface BuildingCutout {
  id: string;
  image: string;
  hoverImage?: string; // Optional image to show on hover/click
  alt: string;
  position: BuildingPosition; // Single position that scales proportionally
  onClick?: () => void;
  clickable: boolean;
}

interface DesktopBackgroundProps {
  showModeSelector?: boolean;
}

const DesktopBackground = ({ showModeSelector = true }: DesktopBackgroundProps) => {
  const logger = getClientLogger('[desktop_background_home]');
  // Generate random positions/timings once on client mount to avoid hydration mismatch
  const [raindrops, setRaindrops] = useState<Array<{ id: number; left: string; delay: string; duration: string }>>([]);
  const [hoveredBuilding, setHoveredBuilding] = useState<string | null>(null);
  const [clickedBuilding, setClickedBuilding] = useState<string | null>(null);
  const [isWelcomeDialogVisible, setIsWelcomeDialogVisible] = useState(false);
  
  // Background image dimensions: 4096 x 1704
  // Aspect ratio: 4096/1704 = 2.404 (width:height)
  const BACKGROUND_ASPECT_RATIO = 4096 / 1704;

  useEffect(() => {
    logger.info('Home background is active');

    // Initialize raindrop positions on client side only
    setRaindrops(
      Array.from({ length: 20 }, (_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        delay: `${Math.random() * 5}s`,
        duration: `${4 + Math.random() * 4}s`,
      }))
    );
  }, []);

  // Check for welcome dialog visibility via data attribute on body
  useEffect(() => {
    const checkWelcomeDialog = () => {
      setIsWelcomeDialogVisible(document.body.hasAttribute('data-pearl-welcome-visible'));
    };

    // Check initially
    checkWelcomeDialog();

    // Watch for changes using MutationObserver
    const observer = new MutationObserver(checkWelcomeDialog);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-pearl-welcome-visible'],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  const modeCards = useMemo<ModeCardConfig[]>(
    () => [
      {
        key: 'create',
        label: 'Create',
        image: '/create.png',
        targetMode: DesktopMode.CREATIVE,
      },
      {
        key: 'work',
        label: 'Work',
        image: '/work.png',
        targetMode: DesktopMode.WORK,
      },
      {
        key: 'quiet',
        label: 'Quiet',
        image: '/quiet.png',
        targetMode: DesktopMode.QUIET,
      },
      {
        key: 'social',
        label: 'Social',
        image: '/social.png',
        targetMode: DesktopMode.WORK,
      },
    ],
    []
  );

  const dispatchDesktopModeSwitch = useCallback((targetMode: DesktopMode, reason: string) => {
    const switchResponse: DesktopModeSwitchResponse = {
      success: true,
      mode: targetMode,
      message: `Switching to ${targetMode} desktop mode`,
      userRequest: null,
      timestamp: new Date().toISOString(),
      action: 'SWITCH_DESKTOP_MODE',
      payload: {
        targetMode,
        previousMode: DesktopMode.HOME,
        switchReason: reason,
      },
    };

    window.dispatchEvent(
      new CustomEvent<DesktopModeSwitchResponse>('desktopModeSwitch', {
        detail: switchResponse,
      })
    );
  }, []);

  const handleModeSelection = useCallback(
    (key: ModeKey, targetMode: DesktopMode) => {
      dispatchDesktopModeSwitch(targetMode, `user_click_${key}`);

      if (key === 'create') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('creativeMode:loading-start', {
              detail: { source: 'mode-selector' },
            })
          );
        }
        trackSessionHistory('Switched to Creative mode from mode chooser').catch(() => {});
        return;
      }

      switch (key) {
        case 'social': {
          trackSessionHistory('Joined Social from mode chooser').catch(() => {});
          requestWindowOpen({ viewType: 'dailyCall', source: 'desktop:social-mode' });
          break;
        }
        case 'work': {
          trackSessionHistory('Switched to Work mode from mode chooser').catch(() => {});
          break;
        }
        case 'quiet': {
          trackSessionHistory('Relaxed in Quiet mode from mode chooser').catch(() => {});
          break;
        }
        default:
          break;
      }
    },
    [dispatchDesktopModeSwitch]
  );

  const handleStudioClick = useCallback(() => {
    setClickedBuilding('studio');
    setTimeout(() => setClickedBuilding(null), 300);
    dispatchDesktopModeSwitch(DesktopMode.CREATIVE, 'user_click_studio_cutout');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('creativeMode:loading-start', {
          detail: { source: 'desktop:studio-cutout' },
        })
      );
    }
    requestWindowOpen({ viewType: 'htmlContent', source: 'desktop:creation-engine' });
    trackSessionHistory('Opened Creation from Studio building').catch(() => {});
  }, [dispatchDesktopModeSwitch]);

  const handleNotesClick = useCallback(() => {
    setClickedBuilding('notes');
    setTimeout(() => setClickedBuilding(null), 300);
    requestWindowOpen({ viewType: 'notes', source: 'desktop:notes-cutout' });
    trackSessionHistory('Opened Notes from Notes building').catch(() => {});
  }, []);

  const handleForumClick = useCallback(() => {
    setClickedBuilding('forum');
    setTimeout(() => setClickedBuilding(null), 300);
    requestWindowOpen({ viewType: 'dailyCall', source: 'desktop:forum-cutout' });
    trackSessionHistory('Opened Forum from Forum building').catch(() => {});
  }, []);

  const handlePearlNewsClick = useCallback(() => {
    setClickedBuilding('pearlnews');
    // Keep the click state a bit longer so the "Under Construction"
    // label is visible on both desktop and mobile/touch
    setTimeout(() => setClickedBuilding(null), 2000);
    // No navigation, just click effect + message
  }, []);

  // Building cutouts configuration - single position that scales proportionally
  // All values are percentages relative to the background container (4096 x 1704)
  // Background: 4096 x 1704, so positions are: (pixels / dimension) * 100%
  const buildingCutouts = useMemo<BuildingCutout[]>(
    () => [
      // Studio - visible for positioning
      {
        id: 'studio',
        image: '/images/StudioCutout.png',
        hoverImage: '/images/StudioCutoutHover.png', // Swap to this on hover/click
        alt: 'Studio',
        position: {
          top: '35.6%',    // ← ADJUST vertical position
          left: '49.15%',   // ← ADJUST horizontal position
          width: '9.2%',   // ← ADJUST size (cutout width / 4096 * 100)
        },
        onClick: handleStudioClick,
        clickable: true,
      },
      // Notes - visible for positioning
      {
        id: 'notes',
        image: '/images/NoteCutout.png',
        hoverImage: '/images/NoteCutoutHover.png', // Swap to this on hover/click
        alt: 'Notes',
        position: {
          top: '54.2%',    // ← ADJUST vertical position
          left: '50.4%',   // ← ADJUST horizontal position
          width: '9.1%',   // ← ADJUST size (cutout width / 4096 * 100)
        },
        onClick: handleNotesClick,
        clickable: true,
      },
      // Pearl News - rendered before Forum so Forum smoke appears on top
      {
        id: 'pearlnews',
        image: '/images/PearlNewsCutout.png',
        alt: 'Pearl News',
        position: {
          // Background: 4096 x 1704, Cutout: 287 x 285
          // Top: (pixel position / 1704) * 100% - adjust based on actual position
          // Left: (pixel position / 4096) * 100% - adjust based on actual position
          // Width: 287/4096 * 100 = 7.0068% of container width
          top: '38.8%', // Adjust based on actual pixel position in image
          left: '42.25%', // Adjust based on actual pixel position in image
          width: '8.2%', // 287px / 4096px = 7.0068% of background width
          height: 'auto', // Maintains 287x285 aspect ratio
        },
        onClick: handlePearlNewsClick,
        clickable: true,
      },
      // Forum - rendered last so smoke appears on top
      {
        id: 'forum',
        image: '/images/ForumCutout.png',
        hoverImage: '/images/ForumCutoutHover.png', // Swap to this on hover/click
        alt: 'Forum',
        position: {
          top: '54.8%',    // ← ADJUST vertical position
          left: '40.5%',   // ← ADJUST horizontal position
          width: '9%',   // ← ADJUST size (cutout width / 4096 * 100)
        },
        onClick: handleForumClick,
        clickable: true,
      },
    ],
    [handleStudioClick, handleNotesClick, handleForumClick, handlePearlNewsClick]
  );

  useEffect(() => {
    const handleTaskbarSelection = (event: Event) => {
      const custom = event as CustomEvent<{ key?: ModeKey; targetMode?: DesktopMode }>;
      const detail = custom.detail;
      if (!detail?.key) {
        return;
      }
      handleModeSelection(detail.key, detail.targetMode ?? DesktopMode.HOME);
    };

    window.addEventListener('taskbarModeSelect', handleTaskbarSelection as EventListener);

    return () => {
      window.removeEventListener('taskbarModeSelect', handleTaskbarSelection as EventListener);
    };
  }, [handleModeSelection]);

  return (
    <>
      {/* Outer container - clips overflow and fills viewport */}
      <div 
        className="absolute inset-0 overflow-hidden"
        style={{ 
          zIndex: 0,
        }}
      >
        {/* Proportional Container - scales to COVER viewport (like background-size: cover) */}
        {/* Uses min-width/min-height to ensure it always fills the viewport */}
        {/* ZOOM: Adjust scale() value to zoom in/out (1.0 = normal, 1.2 = 20% zoomed in) */}
        <div
          style={{
            // Position centered
            position: 'absolute',
            top: '50%',
            left: '50%',
            // ZOOM LEVEL - adjust scale() to zoom in (e.g., 1.2 = 20% zoom, 1.5 = 50% zoom)
            transform: 'translate(-50%, -50%) scale(1)',
            // Scale to cover: use min-width/min-height to ensure it fills viewport
            // If viewport is wider than aspect ratio, width controls (100vw)
            // If viewport is taller than aspect ratio, height controls (100vh)
            width: '100vw',
            height: `${100 / BACKGROUND_ASPECT_RATIO}vw`, // Height based on width
            minWidth: `${100 * BACKGROUND_ASPECT_RATIO}vh`, // Min width based on height
            minHeight: '100vh',
          }}
        >
        {/* Background Image */}
        <div 
          className="absolute inset-0"
          style={{
            backgroundImage: 'url("/images/HomeScreenBG.png")',
            backgroundSize: '100% 100%', // Stretch to fill container exactly
            backgroundPosition: 'center',
            width: '100%',
            height: '100%',
          }}
        />

        {/* Building Cutouts - Clickable - positioned relative to proportional container */}
        <div className={`absolute inset-0 ${isWelcomeDialogVisible ? 'pointer-events-none' : 'pointer-events-auto'}`} style={{ zIndex: 1 }}>
          {buildingCutouts.map((building) => {
            const isHovered = hoveredBuilding === building.id;
            const isClicked = clickedBuilding === building.id;
            // Pearl News: keep completely still on hover/click (no scale)
            // Other buildings: scale on hover/click as before.
            const shouldScale =
              building.id === 'pearlnews' ? false : isHovered || isClicked;
            const scale = shouldScale ? 1.15 : 1;
            const transition = 'transform 0.2s ease-out, filter 0.2s ease-out';
            const isDisabled = isWelcomeDialogVisible;

            return (
              <div
                key={building.id}
                className={`absolute ${isDisabled ? 'cursor-default' : 'cursor-pointer'}`}
                style={{
                  top: building.position.top,
                  left: building.position.left,
                  width: building.position.width,
                  height: building.position.height || 'auto',
                  transform: `scale(${scale})`,
                  transformOrigin: 'center',
                  transition,
                  zIndex: isHovered || isClicked ? 10 : 1,
                }}
                onMouseEnter={() => !isDisabled && building.clickable && setHoveredBuilding(building.id)}
                onMouseLeave={() => setHoveredBuilding(null)}
                onClick={() => !isDisabled && building.onClick?.()}
                role={building.clickable && !isDisabled ? 'button' : undefined}
                tabIndex={building.clickable && !isDisabled ? 0 : undefined}
                onKeyDown={(e) => {
                  if (!isDisabled && building.clickable && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    building.onClick?.();
                  }
                }}
              >
                <div
                  className="relative w-full"
                  style={{
                    filter:
                      building.id !== 'pearlnews' && (isHovered || isClicked) && !building.hoverImage
                        ? 'brightness(1.1) drop-shadow(0 8px 16px rgba(255, 255, 255, 0.3))'
                        : 'none',
                  }}
                >
                  {/* Smoke effect for Notes building chimney — DISABLED for performance testing */}
                  {/* {building.id === 'notes' && (
                    <div className="absolute pointer-events-none" style={{ top: '0%', left: '46%', width: '20%', height: '30%', zIndex: 100 }}>
                      <div className="smoke-particle smoke-drift-left" style={{ animationDelay: '0s' }} />
                      <div className="smoke-particle smoke-drift-right" style={{ animationDelay: '0.6s' }} />
                      <div className="smoke-particle smoke-drift-left" style={{ animationDelay: '1.2s', left: '10%' }} />
                      <div className="smoke-particle smoke-drift-right" style={{ animationDelay: '1.8s' }} />
                    </div>
                  )} */}
                  {/* Smoke effect for Forum building chimney + Idle Cat — DISABLED for performance testing */}
                  {/* {building.id === 'forum' && (
                    <>
                      <div className="absolute pointer-events-none" style={{ top: '-6%', left: '39%', width: '20%', height: '30%', zIndex: 100 }}>
                        <div className="smoke-particle smoke-drift-right" style={{ animationDelay: '0s' }} />
                        <div className="smoke-particle smoke-drift-left" style={{ animationDelay: '0.7s' }} />
                        <div className="smoke-particle smoke-drift-right" style={{ animationDelay: '1.4s', left: '15%' }} />
                        <div className="smoke-particle smoke-drift-left" style={{ animationDelay: '2.1s' }} />
                      </div>
                      <img 
                        src="/images/catidelGif.gif" 
                        alt="Idle cat" 
                        className="absolute pointer-events-none"
                        style={{ 
                          top: '-4%',
                          left: '59%',
                          width: '20%',
                          height: 'auto',
                          imageRendering: 'pixelated',
                          zIndex: 101,
                          transform: 'rotate(6deg)'
                        }}
                      />
                    </>
                  )} */}
                  {/* Smoke effect for Studio building chimney — DISABLED for performance testing */}
                  {/* {building.id === 'studio' && (
                    <div className="absolute pointer-events-none" style={{ top: '10%', left: '56%', width: '18%', height: '13S%', zIndex: 100 }}>
                      <div className="smoke-particle smoke-drift-left" style={{ animationDelay: '0s' }} />
                      <div className="smoke-particle smoke-drift-right" style={{ animationDelay: '0.5s' }} />
                      <div className="smoke-particle smoke-drift-left" style={{ animationDelay: '1s', left: '5%' }} />
                      <div className="smoke-particle smoke-drift-right" style={{ animationDelay: '1.5s' }} />
                    </div>
                  )} */}
                  <Image
                    src={(isHovered || isClicked) && building.hoverImage ? building.hoverImage : building.image}
                    alt={building.alt}
                    width={200}
                    height={200}
                    className="w-full h-auto object-contain"
                    style={{
                      transition: 'opacity 0.2s ease-out',
                    }}
                    sizes="(max-width: 768px) 120px, (max-width: 1024px) 160px, 200px"
                    priority={building.id === 'studio'}
                  />
                  {/* Pearl News construction gif on rooftop — DISABLED for performance testing */}
                  {/* {building.id === 'pearlnews' && (
                    <img
                      src="/images/pearl-news-top.gif"
                      alt="Construction"
                      className="absolute pointer-events-none"
                      style={{
                        top: '-12%',
                        left: '45%',
                        transform: 'translateX(-50%)',
                        width: '47%',
                        height: 'auto',
                        imageRendering: 'pixelated',
                      }}
                    />
                  )} */}
                  {/* Pearl News under-construction banner (front) */}
                  {building.id === 'pearlnews' && (
                    <img
                      src="/images/under-construction.png"
                      alt="Under construction"
                      className="absolute pointer-events-none"
                      style={{
                        top: '18%',
                        left: '50%',
                        transform: 'translateX(-50%) rotate(-12deg)',
                        width: '60%',
                        height: 'auto',
                        imageRendering: 'pixelated',
                      }}
                    />
                  )}
                  {/* Pearl News "Under Construction" label (hover + click) */}
                  {building.id === 'pearlnews' && (isHovered || isClicked) && !isDisabled && (
                    <div
                      className="absolute left-1/2 -translate-x-1/2 -top-6 px-2 py-1 rounded bg-black/80 text-[10px] leading-none text-yellow-200 border border-yellow-300 shadow-md"
                      style={{
                        imageRendering: 'pixelated',
                        fontFamily: '"Press Start 2P", system-ui, sans-serif',
                        letterSpacing: '0.04em',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Under Construction
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Water Ripple Effect — DISABLED for performance testing */}
        {/* <div className="absolute pointer-events-none" style={{ top: '80%', left: '15%', width: '20%', height: '15%', zIndex: 50 }}>
          <div className="water-ripple" style={{ top: '30%', left: '25%' }} />
          <div className="water-ripple" style={{ top: '55%', left: '65%', animationDelay: '2s' }} />
        </div> */}

        {/* Water Shimmer/Wave Effect — DISABLED for performance testing */}
        {/* <div className="absolute pointer-events-none" style={{ top: '82%', left: '12%', width: '25%', height: '10%', zIndex: 49 }}>
          <div className="water-shimmer" style={{ left: '10%' }} />
          <div className="water-shimmer" style={{ left: '30%', animationDelay: '0.5s' }} />
          <div className="water-shimmer" style={{ left: '50%', animationDelay: '1s' }} />
          <div className="water-shimmer" style={{ left: '70%', animationDelay: '1.5s' }} />
          <div className="water-shimmer" style={{ left: '90%', animationDelay: '2s' }} />
        </div> */}

        {/* Flying Birds — DISABLED for performance testing */}
        {/* <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 60 }}>
          <img src="/images/birdBlying.gif" alt="" className="flying-bird" style={{ top: '8%', animationDuration: '60s', animationDelay: '0s' }} />
          <img src="/images/birdBlying.gif" alt="" className="flying-bird" style={{ top: '12%', animationDuration: '60s', animationDelay: '8s' }} />
          <img src="/images/birdBlying.gif" alt="" className="flying-bird" style={{ top: '15%', animationDuration: '55s', animationDelay: '20s' }} />
          <img src="/images/birdBlying.gif" alt="" className="flying-bird" style={{ top: '10%', animationDuration: '60s', animationDelay: '15s' }} />
          <img src="/images/BigBirdFlyinggif.gif" alt="" className="flying-bird flying-bird-large" style={{ top: '18%', animationDuration: '45s', animationDelay: '5s' }} />
        </div> */}

        {/* Sitting Cat — DISABLED for performance testing */}
        {/* <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 65 }}>
          <img src="/images/catsit.gif" alt="Sitting cat" style={{ position: 'absolute', top: '71%', left: '49.6%', width: '16px', height: 'auto', imageRendering: 'pixelated' }} />
        </div> */}
      </div>
      </div>

      {/* Pixel Rain Effect - Disabled for HOME background */}
      {/* <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
        {raindrops.map((drop) => (
          <div
            key={drop.id}
            className="absolute h-2 w-1 bg-white/40 animate-pixel-rain"
            style={{
              left: drop.left,
              animationDelay: drop.delay,
              animationDuration: drop.duration,
            }}
          />
        ))}
      </div> */}

      {/* Mode Selector Overlay - Commented out for future use */}
      {/* {showModeSelector && (
        <div className="pointer-events-auto absolute inset-0 z-10 flex flex-col items-center justify-center gap-10 px-4 py-10">
          <div className="grid w-full max-w-4xl grid-cols-2 gap-4 sm:gap-6">
            {modeCards.map((card) => (
              <div key={card.key} className="relative w-full">
                <ModeCard
                  image={card.image}
                  label={card.label}
                  textColor={MODE_TEXT_COLORS[card.key]}
                  onClick={() => handleModeSelection(card.key, card.targetMode)}
                  whileHover={{ scale: 1.04, y: -6 }}
                  whileTap={{ scale: 0.97 }}
                />
              </div>
            ))}
          </div>
        </div>
      )} */}

      <style jsx global>{`
        @keyframes pixel-rain {
          0% {
            transform: translateY(-10px);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          90% {
            opacity: 1;
          }
          100% {
            transform: translateY(100vh);
            opacity: 0;
          }
        }
        .animate-pixel-rain {
          animation: pixel-rain linear infinite;
        }

        /* 8-bit retro smoke effect - chunky pixelated style */
        @keyframes pixel-smoke-left {
          0% {
            transform: translateY(0) translateX(0);
            opacity: 0;
          }
          16% {
            opacity: 1;
          }
          33% {
            transform: translateY(-50%) translateX(-10%);
            opacity: 1;
          }
          50% {
            transform: translateY(-100%) translateX(-20%);
            opacity: 0.9;
          }
          66% {
            transform: translateY(-150%) translateX(-15%);
            opacity: 0.7;
          }
          83% {
            transform: translateY(-200%) translateX(-25%);
            opacity: 0.4;
          }
          100% {
            transform: translateY(-250%) translateX(-20%);
            opacity: 0;
          }
        }
        @keyframes pixel-smoke-right {
          0% {
            transform: translateY(0) translateX(0);
            opacity: 0;
          }
          16% {
            opacity: 1;
          }
          33% {
            transform: translateY(-60%) translateX(15%);
            opacity: 1;
          }
          50% {
            transform: translateY(-110%) translateX(25%);
            opacity: 0.9;
          }
          66% {
            transform: translateY(-160%) translateX(20%);
            opacity: 0.7;
          }
          83% {
            transform: translateY(-210%) translateX(30%);
            opacity: 0.4;
          }
          100% {
            transform: translateY(-260%) translateX(25%);
            opacity: 0;
          }
        }
        .smoke-particle {
          position: absolute;
          width: 8px;
          height: 8px;
          /* Solid 8-bit pixel block - no box-shadow for lighter performance */
          background: #d8d8d8;
          border-radius: 0;
          image-rendering: pixelated;
          will-change: transform, opacity;
        }
        .smoke-drift-left {
          animation: pixel-smoke-left 2.5s steps(6) infinite;
        }
        .smoke-drift-right {
          animation: pixel-smoke-right 2.8s steps(6) infinite;
          left: 30%;
        }

        /* 8-bit Water Ripple Effect - Bigger & More Visible */
        @keyframes water-ripple-expand {
          0% {
            width: 10px;
            height: 5px;
            opacity: 0;
          }
          15% {
            width: 30px;
            height: 12px;
            opacity: 1;
          }
          35% {
            width: 60px;
            height: 24px;
            opacity: 0.9;
          }
          55% {
            width: 90px;
            height: 36px;
            opacity: 0.7;
          }
          75% {
            width: 120px;
            height: 48px;
            opacity: 0.4;
          }
          100% {
            width: 150px;
            height: 60px;
            opacity: 0;
          }
        }
        .water-ripple {
          position: absolute;
          width: 10px;
          height: 5px;
          background: transparent;
          border: 3px solid rgba(255, 255, 255, 0.9);
          border-radius: 50%;
          animation: water-ripple-expand 4s steps(6) infinite;
          will-change: width, height, opacity;
        }

        /* 8-bit Water Shimmer/Wave Effect - Bigger & More Pixelated */
        @keyframes water-shimmer {
          0%, 100% {
            opacity: 0.4;
            transform: translateY(0);
          }
          25% {
            opacity: 1;
            transform: translateY(-3px);
          }
          50% {
            opacity: 0.6;
            transform: translateY(0);
          }
          75% {
            opacity: 1;
            transform: translateY(-2px);
          }
        }
        .water-shimmer {
          position: absolute;
          width: 12px;
          height: 6px;
          background: rgba(200, 230, 255, 0.9);
          border-radius: 0;
          animation: water-shimmer 2.5s steps(4) infinite;
          image-rendering: pixelated;
          will-change: transform, opacity;
        }

        /* Flying Birds Animation - left to right across sky */
        @keyframes fly-across {
          0% {
            left: -50px;
          }
          100% {
            left: 110%;
          }
        }
        .flying-bird {
          position: absolute;
          width: 36px;
          height: 36px;
          animation: fly-across linear infinite;
          image-rendering: pixelated;
          will-change: left;
        }
        
        .flying-bird-large {
          width: 48px;
          height: 48px;
        }
      `}</style>
    </>
  );
};

export default DesktopBackground;
