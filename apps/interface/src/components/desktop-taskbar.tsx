'use client';

import { FeatureKey, isFeatureEnabled } from '@nia/features';
import { motion, useAnimation, useMotionValue, useTransform, useSpring } from 'framer-motion';
import Image from 'next/image';
import React, { useEffect, useRef, useState, useCallback } from 'react';

import { WINDOW_OPEN_EVENT, type WindowOpenRequest } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';
// import TaskbarModelSelector from './taskbar-model-selector';
import { DesktopMode, type DesktopModeSwitchResponse } from '../types/desktop-modes';

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

type Provider = 'openai' | 'anthropic' | 'gemini';
type QuickModeKey = 'create' | 'quiet' | 'social';
const TASKBAR_TOP_BASELINE_PX = 16; // matches profile dropdown top spacing

interface DesktopTaskbarProps {
  isWorkMode: boolean;
  onModeChange: (isWork: boolean) => void;
  providers?: Record<Provider, string[]>;
  selectedModelInfo?: { provider: Provider; model: string } | null;
  onModelChange: (provider: Provider, model: string) => void;
  supportedFeatures: string[];
}

const DesktopTaskbar = ({ 
  isWorkMode, 
  onModeChange,
  providers,
  selectedModelInfo,
  onModelChange,
  supportedFeatures
}: DesktopTaskbarProps) => {
  // Feature gating (evaluate once per render)
  const desktopApps: FeatureKey[] = ['gmail', 'notes', 'googleDrive', 'miniBrowser', 'terminal', 'dailyCall', 'browserAutomation', 'htmlContent'];
  const desktopAppsEnabled = desktopApps.some((feature) => isFeatureEnabled(feature, supportedFeatures));
  // Taskbar model selector disabled (no UI buttons needed)
  // const showHtmlModelSelector = isFeatureEnabled('htmlContent', supportedFeatures);
  const showAnyToolbarFeature = desktopAppsEnabled;

  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [currentMode, setCurrentMode] = useState<DesktopMode>(isWorkMode ? DesktopMode.WORK : DesktopMode.HOME);
  const [isSocialActive, setIsSocialActive] = useState(false);
  const [isSocialAppOpen, setIsSocialAppOpen] = useState(false);
  const controls = useAnimation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const forumButtonRef = useRef<HTMLButtonElement | null>(null);
  const didDragRef = useRef(false);
  
  // Gamified physics state
  const [particles, setParticles] = useState<Particle[]>([]);
  const particleIdRef = useRef(0);
  const velocityRef = useRef({ x: 0, y: 0 });
  const lastPositionRef = useRef({ x: 0, y: 0 });
  const animationFrameRef = useRef<number | null>(null);
  
  // Mobile detection for performance optimization
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const checkMobile = () => {
        setIsMobile(window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
      };
      checkMobile();
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
    }
  }, []);
  
  // Derived states for button visibility
  const isHomeActive = currentMode === DesktopMode.HOME || currentMode === DesktopMode.DEFAULT;
  const isWorkActive = currentMode === DesktopMode.WORK && !isSocialActive;
  const isSocialMode = currentMode === DesktopMode.WORK && isSocialActive;

  const isHomeHighlighted = isHomeActive && !isSocialAppOpen;
  const isWorkHighlighted = isWorkActive && !isSocialAppOpen;

  const shouldHideHome = isSocialAppOpen ? false : isHomeActive;
  const shouldHideWork = isSocialAppOpen ? false : isWorkActive;
  const shouldHideCreate = isSocialAppOpen ? false : currentMode === DesktopMode.CREATIVE;
  const shouldHideQuiet = isSocialAppOpen ? false : currentMode === DesktopMode.QUIET;
  const shouldHideSocial = isSocialAppOpen || isSocialMode;
  
  // Listen for desktop mode changes
  useEffect(() => {
    const handleModeSwitch = (event: CustomEvent<DesktopModeSwitchResponse>) => {
      if (event.detail?.action === 'SWITCH_DESKTOP_MODE' && event.detail?.payload?.targetMode) {
        const targetMode = event.detail.payload.targetMode;
        setCurrentMode(targetMode);
        // Reset social flag when switching to non-work modes
        if (targetMode !== DesktopMode.WORK) {
          setIsSocialActive(false);
        }
      }
    };

    const handleMessageEvent = (event: MessageEvent) => {
      if (event.data?.action === 'SWITCH_DESKTOP_MODE' && event.data?.payload?.targetMode) {
        const targetMode = event.data.payload.targetMode;
        setCurrentMode(targetMode);
        // Reset social flag when switching to non-work modes
        if (targetMode !== DesktopMode.WORK) {
          setIsSocialActive(false);
        }
      }
    };

    window.addEventListener('desktopModeSwitch', handleModeSwitch as EventListener);
    window.addEventListener('message', handleMessageEvent);

    return () => {
      window.removeEventListener('desktopModeSwitch', handleModeSwitch as EventListener);
      window.removeEventListener('message', handleMessageEvent);
    };
  }, []);

  // Update current mode when isWorkMode changes (only for HOME/WORK transitions, not for other modes)
  useEffect(() => {
    // Only update if we're currently in HOME or WORK mode AND not in social mode
    if ((currentMode === DesktopMode.HOME || currentMode === DesktopMode.WORK) && !isSocialActive) {
      setCurrentMode(isWorkMode ? DesktopMode.WORK : DesktopMode.HOME);
    }
  }, [isWorkMode, currentMode, isSocialActive]);

  useEffect(() => {
    const socialOpenEvents = ['dailyCall.session.start', 'dailyCall.joined'];
    const socialCloseEvents = ['dailyCall.session.end', 'dailyCall.left', 'dailyCallEnded', 'dailyCall.forceClose'];

    const handleSocialOpen = () => {
      setIsSocialAppOpen(true);
    };

    const handleSocialClose = () => {
      setIsSocialAppOpen(false);
      setIsSocialActive(false);
    };

    socialOpenEvents.forEach((event) => window.addEventListener(event, handleSocialOpen));
    socialCloseEvents.forEach((event) => window.addEventListener(event, handleSocialClose));

    return () => {
      socialOpenEvents.forEach((event) => window.removeEventListener(event, handleSocialOpen));
      socialCloseEvents.forEach((event) => window.removeEventListener(event, handleSocialClose));
    };
  }, []);

  useEffect(() => {
    const handleWindowOpen = (event: Event) => {
      const customEvent = event as CustomEvent<WindowOpenRequest | undefined>;
      const detail = customEvent.detail;

      if (!detail || detail.viewType !== 'dailyCall') {
        return;
      }

      setCurrentMode(DesktopMode.WORK);
      setIsSocialActive(true);
      setIsSocialAppOpen(true);
    };

    window.addEventListener(WINDOW_OPEN_EVENT, handleWindowOpen as EventListener);

    return () => {
      window.removeEventListener(WINDOW_OPEN_EVENT, handleWindowOpen as EventListener);
    };
  }, []);

  // Click outside to collapse
  useEffect(() => {
    if (!isExpanded) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    // Add a small delay to prevent immediate collapse when opening
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExpanded]);

  // Particle creation function - emits retro pixel blocks during drag
  // Creates square pixel particles with 8-bit colors that trail behind the taskbar
  // Particles are emitted during fast drags and on release for visual feedback
  const createParticle = useCallback((x: number, y: number, vx: number, vy: number) => {
    const speed = Math.sqrt(vx * vx + vy * vy);
    const minSpeed = isMobile ? 30 : 20; // Lower threshold to show more particles
    if (speed < minSpeed) return;
    
    // Limit max particles for performance
    setParticles((prev) => {
      const maxParticles = isMobile ? 8 : 15;
      if (prev.length >= maxParticles) return prev;
      
      // Retro 8-bit pixel colors (solid, vibrant)
      const colors = [
        '#60A5FA', // bright blue
        '#3B82F6', // electric blue
        '#8B5CF6', // purple
        '#EC4899', // hot pink
        '#10B981', // neon green
        '#F59E0B', // amber
        '#EF4444', // red
        '#06B6D4', // cyan
      ];
      
      // Pixel sizes (integer multiples for blocky look) - larger for visibility
      const pixelSizes = [8, 10, 12, 14, 16];
      
      const particle: Particle = {
        id: particleIdRef.current++,
        x: Math.floor(x), // Snap to pixel grid
        y: Math.floor(y),
        vx: vx * 0.3 + (Math.random() - 0.5) * 20,
        vy: vy * 0.3 + (Math.random() - 0.5) * 20,
        life: 1,
        size: pixelSizes[Math.floor(Math.random() * pixelSizes.length)], // Pixel block sizes
        color: colors[Math.floor(Math.random() * colors.length)],
      };
      
      return [...prev, particle];
    });
  }, [isMobile]);

  // Particle animation loop (optimized for mobile)
  useEffect(() => {
    if (!isDragging && particles.length === 0) return;
    
    const animate = () => {
      setParticles((prev) => 
        prev
          .map((p) => ({
            ...p,
            x: p.x + p.vx * 0.1,
            y: p.y + p.vy * 0.1,
            vy: p.vy + 0.3, // lighter gravity
            life: p.life - (isMobile ? 0.02 : 0.015), // Slower fade for better visibility
            // Keep size as integer for pixel blocks, but shrink slightly
            size: Math.max(4, Math.floor(p.size * 0.98)),
          }))
          .filter((p) => p.life > 0 && p.size >= 4) // Keep minimum 4px for visibility
      );
      
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    
    animationFrameRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isDragging, particles.length, isMobile]);

  const emitQuickModeSelection = (key: QuickModeKey, targetMode: DesktopMode) => {
    if (typeof window === 'undefined') {
      return;
    }
    // Update current mode immediately for UI responsiveness
    setCurrentMode(targetMode);
    if (targetMode === DesktopMode.CREATIVE) {
      window.dispatchEvent(
        new CustomEvent('creativeMode:loading-start', {
          detail: { source: 'taskbar' },
        })
      );
    }
    window.dispatchEvent(
      new CustomEvent('taskbarModeSelect', {
        detail: { key, targetMode }
      })
    );
  };

  const handleHomeClick = () => {
    setCurrentMode(DesktopMode.HOME);
    setIsSocialActive(false);
    onModeChange(false);
  };

  const handleWorkClick = () => {
    setCurrentMode(DesktopMode.WORK);
    setIsSocialActive(false);
    // Work may open its own apps but does not force social open/close
    onModeChange(true);
  };

  const handleSocialClick = () => {
    setCurrentMode(DesktopMode.WORK);
    setIsSocialActive(true);
    setIsSocialAppOpen(true);
    emitQuickModeSelection('social', DesktopMode.WORK);
  };

  // Motion values for drag effects only
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const velocityX = useMotionValue(0);
  const velocityY = useMotionValue(0);
  
  // Enhanced physics transforms
  const velocityMagnitude = useTransform(
    [velocityX, velocityY],
    ([vx, vy]: number[]) => Math.sqrt(vx * vx + vy * vy)
  );
  
  // Dynamic scale based on velocity (more velocity = bigger scale)
  const scale = useTransform(velocityMagnitude, [0, 500, 1000], [1, 1.15, 1.3]);
  
  // Glow intensity based on velocity
  const glowIntensity = useTransform(velocityMagnitude, [0, 500, 1000], [0, 0.6, 1]);
  const glowBlur = useTransform(glowIntensity, (intensity: number) => intensity * 20);
  const glowOpacity = useTransform(glowIntensity, (intensity: number) => intensity * 0.8);
  
  // Spring-based position for smooth, controlled physics
  const posX = useSpring(useMotionValue(0), { stiffness: 300, damping: 40, mass: 0.5 });
  const posY = useSpring(useMotionValue(0), { stiffness: 300, damping: 40, mass: 0.5 });

  // Initialize position to bottom-left (matching default layout)
  useEffect(() => {
    if (!showAnyToolbarFeature) return;
    if (typeof window !== 'undefined') {
      const initialX = window.innerWidth * 0.01;
      const initialY = TASKBAR_TOP_BASELINE_PX;
      posX.set(initialX);
      posY.set(initialY);
      lastPositionRef.current = { x: initialX, y: initialY };
    }
  }, [showAnyToolbarFeature, posX, posY]);

  const handleDragStart = () => {
    setIsDragging(true);
    didDragRef.current = false;
    velocityRef.current = { x: 0, y: 0 };
    
    // Get current position
    const currentX = posX.get();
    const currentY = posY.get();
    lastPositionRef.current = { x: currentX, y: currentY };
    
    controls.start({
      scale: 1.15,
      boxShadow: "0 25px 50px -12px rgba(59, 130, 246, 0.5)",
      width: isExpanded ? 'auto' : '48px',
      transition: { duration: 0.15, type: "spring", stiffness: 400 }
    });
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    
    // Create small burst of particles on release (optimized for mobile)
    const finalVelocity = velocityRef.current;
    const speed = Math.sqrt(finalVelocity.x * finalVelocity.x + finalVelocity.y * finalVelocity.y);
    const rect = containerRef.current?.getBoundingClientRect();
    
    // Always create burst on release (more particles if moving fast)
    if (rect) {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      // More particles if moving fast, fewer if slow
      const baseCount = isMobile ? 2 : 3;
      const speedMultiplier = speed > 100 ? 2 : 1;
      const burstCount = baseCount * speedMultiplier;
      
      for (let i = 0; i < burstCount; i++) {
        const angle = (Math.PI * 2 * i) / burstCount;
        const velocity = speed > 50 ? 40 : 25; // Higher velocity if moving fast
        createParticle(
          centerX,
          centerY,
          Math.cos(angle) * velocity,
          Math.sin(angle) * velocity
        );
      }
    }
    
    // Apply subtle momentum to position (controlled physics)
    const momentumX = finalVelocity.x * 0.08;
    const momentumY = finalVelocity.y * 0.08;
    
    // Clamp final position within viewport bounds
    if (typeof window !== 'undefined') {
      const rect = containerRef.current?.getBoundingClientRect();
      const width = rect?.width ?? (isExpanded ? 400 : 48);
      const height = rect?.height ?? 48;
      const currentX = posX.get();
      const currentY = posY.get();
      
      const newX = Math.max(0, Math.min(currentX + momentumX, window.innerWidth - width));
      const newY = Math.max(0, Math.min(currentY + momentumY, window.innerHeight - height));
      
      posX.set(newX);
      posY.set(newY);
    }
    
    // Reset motion values for effects with spring animation
    velocityX.set(0);
    velocityY.set(0);
    dragX.set(0);
    dragY.set(0);
    
    // Reset drag flag after drag ends to allow clicks to register
    // Use requestAnimationFrame to ensure this happens after any click event
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        didDragRef.current = false;
      });
    });
    
    controls.start({
      scale: 1,
      boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
      width: isExpanded ? 'auto' : '48px',
      transition: { 
        duration: 0.3, 
        type: "spring",
        stiffness: 300,
        damping: 35
      }
    });
  };

  // Update animation when isExpanded changes
  useEffect(() => {
    if (!showAnyToolbarFeature) return;
    controls.start({
      width: isExpanded ? 'auto' : '48px',
      transition: { duration: 0.3, ease: "easeInOut" }
    });
  }, [isExpanded, controls, showAnyToolbarFeature]);

  // Spawn particles at Forum icon when menu is fully open (sparkle reveal effect)
  useEffect(() => {
    if (!isExpanded || !forumButtonRef.current) return;
    
    // Wait for the menu to fully expand (spring animation completes ~500ms)
    const timeoutId = setTimeout(() => {
      const forumRect = forumButtonRef.current?.getBoundingClientRect();
      if (!forumRect) return;
      
      // Spawn particles from the Forum icon (rightmost tile) - right edge for reveal effect
      const forumRightEdgeX = forumRect.right; // Right edge of Forum icon
      const forumCenterY = forumRect.top + forumRect.height / 2;
      
      // Create multiple bursts to simulate opening through sparkles
      const numBursts = 3; // Multiple bursts for reveal effect
      const particlesPerBurst = isMobile ? 5 : 8;
      
      for (let burstIndex = 0; burstIndex < numBursts; burstIndex++) {
        setTimeout(() => {
          for (let i = 0; i < particlesPerBurst; i++) {
            // Spawn from right edge of Forum icon with vertical spread
            const yOffset = (Math.random() - 0.5) * forumRect.height * 0.8;
            const rightVelocity = 70 + Math.random() * 70; // Strong rightward movement
            const verticalVelocity = (Math.random() - 0.5) * 50; // Vertical spread for sparkle
            
            createParticle(
              forumRightEdgeX,
              forumCenterY + yOffset,
              rightVelocity,
              verticalVelocity
            );
          }
        }, burstIndex * 120); // Stagger bursts for reveal effect
      }
    }, 500); // Wait for menu to fully open (spring animation duration)
    
    return () => clearTimeout(timeoutId);
  }, [isExpanded, createParticle, isMobile]);

  // If none of the toolbar features are enabled, hide the activator/taskbar entirely
  if (!showAnyToolbarFeature) {
    return null;
  }

  return (
    <>
      {/* Pixel Retro Particle Trail Layer */}
      <div 
        className="fixed inset-0 pointer-events-none z-[300]" 
        style={{ 
          overflow: 'hidden',
          imageRendering: 'pixelated', // Pixelated rendering
        }}
      >
        {particles.map((particle) => (
          <div
            key={particle.id}
            style={{
              position: 'absolute',
              left: `${Math.floor(particle.x)}px`,
              top: `${Math.floor(particle.y)}px`,
              width: `${particle.size}px`,
              height: `${particle.size}px`,
              backgroundColor: particle.color,
              borderRadius: 0,
              border: `1px solid ${particle.color}`,
              opacity: particle.life,
              imageRendering: 'pixelated',
              transform: 'translateZ(0)',
            }}
          />
        ))}
      </div>
      
      <motion.div 
      ref={containerRef}
      drag
      dragMomentum={false}
      dragElastic={0.1}
      dragTransition={{ bounceStiffness: 300, bounceDamping: 30 }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      style={{ 
        left: 0,
        top: 0,
        x: posX,
        y: posY,
        scale,
        zIndex: 300, // Z-scale: menus/taskbar layer
        background: 'transparent',
        outline: 'none',
        border: 'none',
        borderRadius: '12px', // Match the hamburger icon's rounded-xl (12px)
        boxShadow: useTransform(
          [glowBlur, glowOpacity],
          ([blur, opacity]: number[]) => 
            `0 0 ${blur}px rgba(59, 130, 246, ${opacity}), 0 0 ${blur * 2}px rgba(147, 197, 253, ${opacity * 0.7})`
        ),
      }}
      onDrag={(event, info) => {
        // Mark that a drag actually occurred if movement exceeded a small threshold
        if (!didDragRef.current) {
          const moved = Math.abs(info.offset.x) + Math.abs(info.offset.y) > 4;
          if (moved) didDragRef.current = true;
        }
        
        // Track velocity for physics effects
        const vx = info.velocity.x;
        const vy = info.velocity.y;
        velocityRef.current = { x: vx, y: vy };
        velocityX.set(vx);
        velocityY.set(vy);
        
        // Update drag motion values for visual effects
        dragX.set(vx * 0.15);
        dragY.set(vy * 0.15);
        
        // Create particles during movement (optimized for mobile)
        const speed = Math.sqrt(vx * vx + vy * vy);
        const minSpeed = isMobile ? 50 : 30; // Lower threshold to show particles
        const spawnChance = isMobile ? 0.7 : 0.6; // Higher spawn rate
        if (speed > minSpeed && Math.random() > spawnChance) {
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) {
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            createParticle(centerX, centerY, -vx * 0.2, -vy * 0.2);
          }
        }
        
        // Update last position for velocity calculation
        const currentX = posX.get();
        const currentY = posY.get();
        lastPositionRef.current = { x: currentX, y: currentY };
      }}
      className={`pointer-events-auto absolute ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      initial={{
        width: isExpanded ? 'auto' : '48px'
      }}
      animate={controls}
      transition={{
        width: { duration: 0.3, ease: "easeInOut" },
        type: "spring",
        damping: 25,
        stiffness: 120
      }}
    >
      {/* Collapsed State - Small Icon */}
      {!isExpanded && (
        <motion.div 
          className="rounded-xl w-10 h-10 md:w-12 md:h-12 flex items-center justify-center shadow-2xl cursor-pointer"
          style={{ backgroundColor: '#1e3a8a' }}
          animate={{ backgroundColor: '#1e3a8a' }}
          onClick={(e) => {
            // Ignore click if currently dragging
            if (isDragging) {
              e.stopPropagation();
              return;
            }
            // If this was a drag (not a click), ignore the first click event
            // The flag will be reset by handleDragEnd after drag ends
            if (didDragRef.current) {
              e.stopPropagation();
              return;
            }
            
            // Particles will spawn from Forum icon after menu opens (handled in useEffect)
            setIsExpanded(true);
          }}
          whileHover={{ 
            scale: 1.2,
            y: -5,
            backgroundColor: "#1d4ed8",
            boxShadow: "0 25px 50px -12px rgba(236, 72, 153, 0.6)",
            borderColor: "#ec4899"
          }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          <motion.svg 
            xmlns="http://www.w3.org/2000/svg" 
            width="34" 
            height="34" 
            className="md:w-10 md:h-10"
            viewBox="0 0 40 40" 
            fill="none"
            whileHover={{ scale: 1.1 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
          >
            <defs>
              <linearGradient id="taskbar-menu-gradient" x1="0" y1="0" x2="40" y2="40">
                <stop offset="0%" stopColor="#93c5fd" />
                <stop offset="50%" stopColor="#7dd3fc" />
                <stop offset="100%" stopColor="#bae6fd" />
              </linearGradient>
            </defs>
            <rect
              x="1.5"
              y="1.5"
              width="37"
              height="37"
              rx="10"
              stroke="url(#taskbar-menu-gradient)"
              strokeWidth="3"
              fill="none"
            />
            <rect x="7" y="11" width="26" height="5" rx="2.5" fill="url(#taskbar-menu-gradient)" />
            <rect x="7" y="18" width="26" height="5" rx="2.5" fill="url(#taskbar-menu-gradient)" />
            <rect x="7" y="25" width="26" height="5" rx="2.5" fill="url(#taskbar-menu-gradient)" />
          </motion.svg>
        </motion.div>
      )}

      {/* Expanded State - Full Taskbar */}
      {isExpanded && (
        <motion.div 
          className="bg-blue-800/20 backdrop-blur-lg border border-blue-400/40 rounded-2xl px-3 py-2.5 md:px-4 md:py-3 flex items-center justify-center gap-1 md:gap-2.5 shadow-2xl relative"
          style={{
            background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.25) 0%, rgba(30, 64, 175, 0.15) 100%)',
            backdropFilter: 'blur(12px) saturate(180%)',
            WebkitBackdropFilter: 'blur(12px) saturate(180%)',
          }}
          initial={{ x: -100, opacity: 0, scale: 0.9 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          exit={{ x: -100, opacity: 0, scale: 0.9 }}
          whileHover={{ 
            backgroundColor: "rgba(30, 64, 175, 0.3)",
            borderColor: "rgba(59, 130, 246, 0.5)",
            boxShadow: "0 25px 50px -12px rgba(30, 64, 175, 0.6)"
          }}
          transition={{ 
            type: "spring", 
            stiffness: 400, 
            damping: 25,
            opacity: { duration: 0.2 }
          }}
        >
          {/* Collapse Button */}
          {/*
          <motion.button
            className="absolute -top-2 -right-2 w-6 h-6 bg-red-500/80 rounded-full flex items-center justify-center text-white text-xs"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(false);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            whileHover={{ 
              scale: 1.1,
              backgroundColor: "rgba(239, 68, 68, 0.9)",
              boxShadow: "0 4px 15px rgba(239, 68, 68, 0.4)"
            }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
          >
            ×
          </motion.button>
          */}

          {/* Collapse Button - Ultra Minimal */}
          <motion.button
            className="-ml-3 -mr-3 w-6 h-8 flex items-center justify-center text-white/40 hover:text-white/80 transition-colors duration-200 rounded-lg hover:bg-white/5"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(false);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            whileHover={{ 
              scale: 1.15,
              x: -1
            }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            title="Collapse"
          >
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="14" 
              height="14" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="3" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <polyline points="11 17 6 12 11 7"></polyline>
              <polyline points="18 17 13 12 18 7"></polyline>
            </svg>
          </motion.button>

        {/* Home Button - Hide only when in HOME mode (unless social app is open) */}
        {!shouldHideHome && (
        <div className="flex flex-col items-center gap-0.5">
          <motion.button
            onClick={handleHomeClick}
            title="Home"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className={`flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-xl transition-all duration-200 backdrop-blur-sm ${
              isHomeHighlighted
                ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-600/50 border-2 border-blue-400/60' 
                : 'bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20'
            }`}
            animate={{
              boxShadow: isHomeHighlighted ? [
                "0 10px 25px rgba(37, 99, 235, 0.5)",
                "0 15px 35px rgba(37, 99, 235, 0.7)",
                "0 10px 25px rgba(37, 99, 235, 0.5)"
              ] : "0 2px 8px rgba(59, 130, 246, 0.2)",
              scale: isHomeHighlighted ? 1.05 : 1
            }}
            whileHover={{ 
              scale: 1.12,
              y: -4,
              backgroundColor: isHomeHighlighted ? "rgba(29, 78, 216, 0.95)" : "transparent",
              boxShadow: "0 20px 40px rgba(37, 99, 235, 0.6)",
              borderRadius: "12px"
            }}
            whileTap={{ scale: 0.95 }}
            transition={{
              boxShadow: isHomeHighlighted ? { duration: 2, repeat: Infinity, ease: "easeInOut" } : {},
              type: "spring", 
              stiffness: 550, 
              damping: 18
            }}
          >
            <motion.div
              className="relative flex h-10 w-10 md:h-12 md:w-12 items-center justify-center overflow-hidden"
              animate={{
                scale: isHomeHighlighted ? 1.1 : 1,
                filter: isHomeHighlighted ? "drop-shadow(0 2px 8px rgba(255, 255, 255, 0.3))" : "none"
              }}
              whileHover={{ scale: 1.05 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            >
              <Image
                src="/HomeTB.png"
                alt="Home icon"
                width={48}
                height={48}
                className="h-full w-full object-contain p-1.5 md:p-2 filter drop-shadow-sm"
                priority
              />
            </motion.div>
          </motion.button>
          <span className="text-white/90 text-[10px] md:text-xs font-medium uppercase tracking-wider drop-shadow-sm" style={{ fontFamily: 'Gohufont, monospace' }}>HOME</span>
        </div>
        )}

        {/* Separator (only when model selector is shown) */}
        {/*
        {showHtmlModelSelector && (
          <motion.div 
            className="w-px h-8 bg-blue-400/30"
            whileHover={{ 
              backgroundColor: "rgba(59, 130, 246, 0.6)",
              width: "2px",
              boxShadow: "0 0 10px rgba(59, 130, 246, 0.4)"
            }}
            transition={{ duration: 0.2 }}
          />
        )}
        */}

        {/* Work Button - Hide only when in WORK mode (not social) */}
        {!shouldHideWork && (
        <div className="flex flex-col items-center gap-0.5">
          <motion.button
            onClick={handleWorkClick}
            title="Work"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className={`flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-xl transition-all duration-200 backdrop-blur-sm ${
              isWorkHighlighted
                ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/50 border-2 border-blue-300/60' 
                : 'bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20'
            }`}
            animate={{
              boxShadow: isWorkHighlighted ? [
                "0 10px 25px rgba(59, 130, 246, 0.5)",
                "0 15px 35px rgba(59, 130, 246, 0.7)",
                "0 10px 25px rgba(59, 130, 246, 0.5)"
              ] : "0 2px 8px rgba(0, 0, 0, 0.1)",
              scale: isWorkHighlighted ? 1.05 : 1
            }}
            whileHover={{ 
              scale: 1.12,
              y: -4,
              backgroundColor: isWorkHighlighted ? "rgba(37, 99, 235, 0.95)" : "transparent",
              boxShadow: "0 20px 40px rgba(59, 130, 246, 0.6)",
              borderRadius: "12px"
            }}
            whileTap={{ scale: 0.95 }}
            transition={{
              boxShadow: isWorkHighlighted ? { duration: 2, repeat: Infinity, ease: "easeInOut" } : {},
              type: "spring", 
              stiffness: 550, 
              damping: 18
            }}
          >
            <motion.div
              className="relative flex h-10 w-10 md:h-12 md:w-12 items-center justify-center overflow-hidden"
              animate={{
                scale: isWorkHighlighted ? 1.1 : 1,
                filter: isWorkHighlighted ? "drop-shadow(0 2px 8px rgba(255, 255, 255, 0.3))" : "none"
              }}
              whileHover={{ scale: 1.05 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            >
              <Image
                src="/WorkTB.png"
                alt="Work icon"
                width={48}
                height={48}
                className="h-full w-full object-contain p-1.5 md:p-2 filter drop-shadow-sm"
                priority
              />
            </motion.div>
          </motion.button>
          <span className="text-white/90 text-[10px] md:text-xs font-medium uppercase tracking-wider drop-shadow-sm" style={{ fontFamily: 'Gohufont, monospace' }}>WORK</span>
        </div>
        )}

        {/* Create Button */}
        {!shouldHideCreate && (
        <div className="flex flex-col items-center gap-0.5">
          <motion.button
            title="Create"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => emitQuickModeSelection('create', DesktopMode.CREATIVE)}
            className="flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-xl transition-all duration-200 backdrop-blur-sm bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20"
            animate={{
              boxShadow: "0 2px 8px rgba(59, 130, 246, 0.2)",
              scale: 1
            }}
            whileHover={{ 
              scale: 1.12,
              y: -4,
              backgroundColor: "transparent",
              boxShadow: "0 20px 40px rgba(59, 130, 246, 0.6)",
              borderRadius: "12px"
            }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", stiffness: 550, damping: 18 }}
          >
            <motion.div
              className="relative flex h-10 w-10 md:h-12 md:w-12 items-center justify-center overflow-hidden"
              animate={{
                scale: 1,
                filter: "none"
              }}
              whileHover={{ scale: 1.05 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            >
              <Image
                src="/CreateTB.png"
                alt="Create icon"
                width={48}
                height={48}
                className="h-full w-full object-contain p-1.5 md:p-2 filter drop-shadow-sm"
                priority
              />
            </motion.div>
          </motion.button>
          <span className="text-white/90 text-[10px] md:text-xs font-medium uppercase tracking-wider drop-shadow-sm" style={{ fontFamily: 'Gohufont, monospace' }}>CREATE</span>
        </div>
        )}

        {/* Quiet Button */}
        {!shouldHideQuiet && (
        <div className="flex flex-col items-center gap-0.5">
          <motion.button
            title="Quiet"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => emitQuickModeSelection('quiet', DesktopMode.QUIET)}
            className="flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-xl transition-all duration-200 backdrop-blur-sm bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20"
            animate={{
              boxShadow: "0 2px 8px rgba(59, 130, 246, 0.2)",
              scale: 1
            }}
            whileHover={{ 
              scale: 1.12,
              y: -4,
              backgroundColor: "transparent",
              boxShadow: "0 20px 40px rgba(59, 130, 246, 0.6)",
              borderRadius: "12px"
            }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", stiffness: 550, damping: 18 }}
          >
            <motion.div
              className="relative flex h-10 w-10 md:h-12 md:w-12 items-center justify-center overflow-hidden"
              animate={{
                scale: 1,
                filter: "none"
              }}
              whileHover={{ scale: 1.05 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            >
              <Image
                src="/QuietTB.png"
                alt="Quiet icon"
                width={48}
                height={48}
                className="h-full w-full object-contain p-1.5 md:p-2 filter drop-shadow-sm"
                priority
              />
            </motion.div>
          </motion.button>
          <span className="text-white/90 text-[10px] md:text-xs font-medium uppercase tracking-wider drop-shadow-sm" style={{ fontFamily: 'Gohufont, monospace' }}>SPRINGS</span>
        </div>
        )}

        {/* Social Button - Hide only when in Social mode or social app is open */}
        {!shouldHideSocial && (
        <div className="flex flex-col items-center gap-0.5">
          <motion.button
            ref={forumButtonRef}
            title="Social"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleSocialClick}
            className="flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-xl transition-all duration-200 backdrop-blur-sm bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20"
            animate={{
              boxShadow: "0 2px 8px rgba(59, 130, 246, 0.2)",
              scale: 1
            }}
            whileHover={{ 
              scale: 1.12,
              y: -4,
              backgroundColor: "transparent",
              boxShadow: "0 20px 40px rgba(59, 130, 246, 0.6)",
              borderRadius: "12px"
            }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", stiffness: 550, damping: 18 }}
          >
            <motion.div
              className="relative flex h-10 w-10 md:h-12 md:w-12 items-center justify-center overflow-hidden"
              animate={{
                scale: 1,
                filter: "none"
              }}
              whileHover={{ scale: 1.05 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            >
              <Image
                src="/SocialTB.png"
                alt="Social icon"
                width={48}
                height={48}
                className="h-full w-full object-contain p-1.5 md:p-2 filter drop-shadow-sm"
                priority
              />
            </motion.div>
          </motion.button>
          <span className="text-white/90 text-[10px] md:text-xs font-medium uppercase tracking-wider drop-shadow-sm" style={{ fontFamily: 'Gohufont, monospace' }}>FORUM</span>
        </div>
        )}

        {/* Model selector temporarily disabled */}
        {/*
        {showHtmlModelSelector && (
          <>
            <TaskbarModelSelector
              providers={providers}
              onModelSelect={onModelChange}
              selectedModelInfo={selectedModelInfo}
            />
            <motion.div 
              className="w-px h-8 bg-blue-400/30"
              whileHover={{ 
                backgroundColor: "rgba(59, 130, 246, 0.6)",
                width: "2px",
                boxShadow: "0 0 10px rgba(59, 130, 246, 0.4)"
              }}
              transition={{ duration: 0.2 }}
            />
          </>
        )}
         */}

          {/* Time Display */}
          {/*
          <motion.div 
            className="ml-auto text-white/90 text-sm cursor-pointer uppercase"
            whileHover={{ 
              scale: 1.05,
              color: "rgb(255, 255, 255)",
              textShadow: "0 0 10px rgba(255, 255, 255, 0.5)"
            }}
            transition={{ duration: 0.2 }}
            style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
          >
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </motion.div>
          */}
        </motion.div>
      )}
    </motion.div>
    </>
  );
};

export default DesktopTaskbar; 