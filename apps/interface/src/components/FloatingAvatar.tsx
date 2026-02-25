"use client";

import Image from 'next/image';
import React, { useEffect, useState } from 'react';

import { useUI } from '@interface/contexts/ui-context';
import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';

export type AvatarMood = 'default' | 'neutral' | 'happy' | 'wink' | 'surprised' | 'angry' | 'curious' | 'shocked' | 'smile';

type VowelShape = 'a' | 'e' | 'i' | 'o' | 'u' | 'wide_a' | 'thin_e' | 'narrow_i' | 'big_o' | 'tiny_u' | 'ellipse_h' | 'ellipse_v' | 'oval_wide' | 'slit' | 'round_big' | 'closed' | 'neutral' | 'open' | 'wide';

const vowelShapes: Record<VowelShape, { width: number, height: number }> = {
    a: { width: 35, height: 30 },
    e: { width: 25, height: 18 },
    i: { width: 55, height: 22 },
    o: { width: 60, height: 50 },
    u: { width: 40, height: 40 },
    wide_a: { width: 85, height: 60 },
    thin_e: { width: 70, height: 28 },
    narrow_i: { width: 50, height: 20 },
    big_o: { width: 70, height: 60 },
    tiny_u: { width: 35, height: 35 },
    ellipse_h: { width: 80, height: 38 },
    ellipse_v: { width: 50, height: 65 },
    oval_wide: { width: 90, height: 45 },
    slit: { width: 65, height: 18 },
    round_big: { width: 75, height: 65 },
    closed: { width: 0, height: 0 },
    neutral: { width: 40, height: 15 },  // Proper dimensions
    open: { width: 50, height: 30 },     // Visible size
    wide: { width: 60, height: 25 }      // Visible size
};

// Enhanced vowel variety for more realistic lip sync
const vowels: VowelShape[] = [
    'a', 'e', 'i', 'o', 'u', 'wide_a', 'thin_e', 'narrow_i', 'big_o', 'tiny_u', 'ellipse_h', 'slit'
];

interface FloatingAvatarProps {
  mood?: AvatarMood;
  size?: number; // New size prop
  forceVisible?: boolean; // New prop to force visibility
}

const moodImages: Record<AvatarMood, string> = {
  default: '/images/avatar/avatar_default.png',
  neutral: '/images/avatar/avatar_neutral.png',
  happy: '/images/avatar/avatar_happy.png',
  wink: '/images/avatar/avatar_wink.png',
  surprised: '/images/avatar/avatar_surprised.png',
  angry: '/images/avatar/avatar_angry.png',
  curious: '/images/avatar/avatar_curious.png',
  shocked: '/images/avatar/avatar_shocked.png',
  smile: '/images/avatar/avatar_smile.png'
};

const FloatingAvatar: React.FC<FloatingAvatarProps> = ({ mood = 'neutral', size = 40, forceVisible = false }) => { // Default size to 40, forceVisible to false
  // Use speech context instead of props
  const { isAssistantSpeaking, assistantVolumeLevel } = useVoiceSessionContext();
  const { 
    isBrowserWindowVisible, 
    browserWindowRect, 
    isAvatarVisible, 
    isAvatarAnimating, 
    isAvatarHiding,
    bellButtonRect 
  } = useUI();
  
  const imageUrl = isAssistantSpeaking ? moodImages[mood] : moodImages.default;
  const [currentVowel, setCurrentVowel] = useState<VowelShape>('closed');
  const [isAnimating, setIsAnimating] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // setAvatarQuadrant('bottom-left'); // This line is removed as per the new_code
      } else {
        // setAvatarQuadrant('bottom-right'); // This line is removed as per the new_code
      }
    };

    if (isMounted) {
      handleVisibilityChange();
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      if (isMounted) {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [isMounted]);

  useEffect(() => {
    let animationInterval: NodeJS.Timeout;

    if (isAssistantSpeaking) {
      setIsAnimating(true);  // Add this line back
      // Start lip sync animation
      animationInterval = setInterval(() => {
        setCurrentVowel(prev => {
          const vowels: VowelShape[] = ['neutral', 'open', 'wide', 'closed'];
          const currentIndex = vowels.indexOf(prev);
          return vowels[(currentIndex + 1) % vowels.length];
        });
      }, 200);
      setCurrentVowel('closed');
    } else {
      setIsAnimating(false);  // Add this line back
      setCurrentVowel('closed');
    }

    return () => {
      if (animationInterval) clearInterval(animationInterval);
    };
  }, [isAssistantSpeaking]); // Run effect when speaking state changes

  const getCurrentMouthShape = () => {
    if (!isAnimating) return { width: 0, height: 0 };
    
    const baseShape = vowelShapes[currentVowel];
    const volumeMultiplier = assistantVolumeLevel ? 0.7 + (assistantVolumeLevel / 100) * 0.8 : 1;
    
    return {
      width: Math.max(baseShape.width * volumeMultiplier, 30),
      height: Math.max(baseShape.height * volumeMultiplier, 20)
    };
  };

  const mouthShape = getCurrentMouthShape();

  const getAvatarStyles = (): React.CSSProperties => {
    // If avatar is not visible, don't render
    if (!isAvatarVisible) {
      return { display: 'none' };
    }

    let baseStyles: React.CSSProperties = {
      // position: 'fixed', // Handled by parent container now
      zIndex: 900,
    };

    if (isAvatarAnimating) {
      if (isAvatarHiding) {
        // Hide animation
        baseStyles = {
          ...baseStyles,
          transition: 'all 1s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        };
      } else {
        // Popup animation
        baseStyles = {
          ...baseStyles,
          transition: 'all 1s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        };
      }
    } else {
      // Normal positioning with smooth transitions
      baseStyles = {
        ...baseStyles,
        transition: 'none', // No animation on position when handled by parent
      };
    }

    return baseStyles;
  };

  // Don't render if avatar is not visible and not forced visible
  if (!isAvatarVisible && !forceVisible) {
    return null;
  }

  return (
    <div
      className="floating-avatar"
      style={{
        ...getAvatarStyles(),
        width: `${size}px`,
        height: `${size}px`
      }}
    >
      <div
        className={`relative w-full h-full ${
          isAvatarAnimating
            ? (isAvatarHiding ? 'animate-avatar-hide' : 'animate-avatar-popup')
            : (!isAnimating ? 'animate-bubble-float' : '')
        }`}
        style={{
          animationDelay: isAvatarAnimating ? '0s' : `${Math.random() * 2}s`,
        }}
      >
        {/* Bubble floating container with additional drift animation */}
        <div
          className={`w-full h-full ${(!isAvatarAnimating && !isAnimating) ? 'animate-bubble-drift' : ''}`}
          style={{
            animationDelay: `${Math.random() * 3}s`,
          }}
        >
          <Image
            src={imageUrl}
            alt="Floating Avatar"
            width={size}
            height={size}
            className="rounded-full border-2 border-purple-200 shadow-lg transition-all duration-300 hover:shadow-2xl hover:border-purple-300"
          />
          
          {/* Enhanced bubble glow effect */}
          {!isAvatarAnimating && (
            <div 
              className="absolute inset-0 rounded-full border-2 border-purple-400/30 animate-pulse-slow"
              style={{
                boxShadow: '0 0 20px rgba(147, 51, 234, 0.3)',
                animation: 'pulse-slow 4s ease-in-out infinite',
                animationDelay: `${Math.random() * 2}s`,
              }}
            />
          )}
        </div>

        <div style={{
          position: 'absolute',
          top: '70%',
          left: '50%',
          transform: 'translateX(-50%) scale(0.5)', // change the mouth size
        }}>
          {!isAnimating ? (
            // The default image has lips, so we render nothing here.
            null
          ) : (
            // Enhanced mouth animation when speaking
            <div style={{
              position: 'relative',
              width: `${mouthShape.width}px`,
              height: `${mouthShape.height}px`,
              transition: 'all 0.1s ease-out',
            }}>
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: `${mouthShape.width}px`,
                height: `${mouthShape.height}px`,
                background: 'radial-gradient(ellipse at center, #1a202c 0%, #2d3748 50%, #4a5568 100%)',
                borderRadius: currentVowel === 'i' || currentVowel === 'narrow_i' || currentVowel === 'slit' 
                  ? '50% 50%' 
                  : currentVowel === 'o' || currentVowel === 'big_o' || currentVowel === 'round_big'
                  ? '50%'
                  : `${Math.min(mouthShape.width * 0.6, 25)}px`,
                border: '2px solid #2d3748',
                boxShadow: 'inset 0 -2px 6px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.2)',
                overflow: 'hidden',
              }}>
                {/* Upper lip highlight */}
                <div style={{
                  position: 'absolute',
                  top: '2px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: `${mouthShape.width * 0.8}px`,
                  height: '2px',
                  background: 'linear-gradient(to bottom, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.1) 100%)',
                  borderRadius: '2px',
                  zIndex: 1,
                }} />
                
                {/* Lower lip highlight */}
                <div style={{
                  position: 'absolute',
                  bottom: '2px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: `${mouthShape.width * 0.7}px`,
                  height: '2px',
                  background: 'linear-gradient(to top, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.05) 100%)',
                  borderRadius: '2px',
                  zIndex: 1,
                }} />
                
                {/* Teeth hint for larger mouth shapes */}
                {(mouthShape.width > 50 && mouthShape.height > 30) && (
                  <div style={{
                    position: 'absolute',
                    top: '15%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: `${mouthShape.width * 0.6}px`,
                    height: '3px',
                    background: 'linear-gradient(to bottom, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.4) 100%)',
                    borderRadius: '2px',
                    zIndex: 2,
                  }} />
                )}
              </div>
            </div>
          )}
        </div>
        
        {/* Speaking indicator pulse */}
        {isAnimating && (
          <div 
            className="absolute inset-0 rounded-full border-2 border-purple-400 animate-pulse"
            style={{
              animation: 'pulse 1.5s infinite',
              opacity: 0.6
            }}
          />
        )}
      </div>
    </div>
  );
};

export default FloatingAvatar; 