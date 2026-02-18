'use client';

import React from 'react';
import { Trash2 } from 'lucide-react';
import '../styles/notes.css';

interface BookSpineProps {
  title: string;
  contentLength: number;
  isSelected?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
}

const BookSpine: React.FC<BookSpineProps> = ({ 
  title, 
  contentLength, 
  isSelected = false, 
  onClick,
  onDelete
}) => {
  const displayTitle = title || 'Untitled';
  
  // Array of book spine images - using your custom book images with color coding
  const bookImages = [
    '/Book2_w.png', '/Book3_B.png', '/Book4_B.png', '/Book5_w.png', '/Book6_B.png',
    '/Book7_B.png', '/Book8_W.png', '/Book9_B.png', '/Book9_W.png', '/Book10_B.png',
    '/Book11_B.png', '/Book12_B.png', '/Book13_B.png', '/Book14_B.png', '/Book15_B.png',
    '/Book16_W.png', '/Book17_B.png', '/Book18_W.png', '/Book19_W.png', '/Book20_B.png',
    '/Book21_B.png', '/Book22_B.png', '/Book23_W.png', '/Book25_W.png', '/Book26_B.png',
    '/Book27_W.png', '/Book28_W.png', '/Book29_W.png'
  ];
  
  // Use Gohufont (NerdFont patched version) for all books
  const selectedFont = 'Gohufont, monospace';
  
  // 🎲 SESSION-BASED RANDOM - Same during session, different next session
  // Create a session seed that persists during the session but changes on new sessions
  // Use a fixed seed of 0 to avoid hydration mismatch (Date.now() differs server vs client).
  // The titleHash already provides per-book variation; the session seed is not critical.
  const sessionSeed = 0;
  const titleHash = displayTitle.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  const imageIndex = Math.abs(titleHash + sessionSeed) % bookImages.length;
  const selectedImage = bookImages[imageIndex];
  
  // Determine text color based on filename - W = white text, B = black text
  const isWhiteText = selectedImage.toLowerCase().includes('_w') || selectedImage.toLowerCase().includes('_w.');
  const textColor = isWhiteText ? 'white' : 'black';
  
  // Try different path formats if the first one doesn't work
  const alternativePaths = [
    selectedImage,
    selectedImage.replace(/ /g, '%20'),
    selectedImage.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29'),
    `./${selectedImage.substring(1)}`,
    `public${selectedImage}`
  ];
  
  // 🔧 SIZE CONTROLS - Adjust these values to change book size:
  const baseHeight = 40; // Base height for scaling
  
  // 📐 DYNAMIC ASPECT RATIO - Calculate actual dimensions based on image filename
  // Mapping of your book images with their approximate dimensions
  const imageDimensions: { [key: string]: { width: number; height: number } } = {
    '/Book2_w.png': { width: 310, height: 60 },
    '/Book3_B.png': { width: 310, height: 60 },
    '/Book4_B.png': { width: 310, height: 60 },
    '/Book5_w.png': { width: 310, height: 60 },
    '/Book6_B.png': { width: 310, height: 60 },
    '/Book7_B.png': { width: 310, height: 60 },
    '/Book8_W.png': { width: 310, height: 60 },
    '/Book9_B.png': { width: 310, height: 60 },
    '/Book9_W.png': { width: 310, height: 60 },
    '/Book10_B.png': { width: 310, height: 60 },
    '/Book11_B.png': { width: 310, height: 60 },
    '/Book12_B.png': { width: 310, height: 60 },
    '/Book13_B.png': { width: 310, height: 60 },
    '/Book14_B.png': { width: 310, height: 60 },
    '/Book15_B.png': { width: 310, height: 60 },
    '/Book16_W.png': { width: 310, height: 60 },
    '/Book17_B.png': { width: 310, height: 60 },
    '/Book18_W.png': { width: 310, height: 60 },
    '/Book19_W.png': { width: 310, height: 60 },
    '/Book20_B.png': { width: 310, height: 60 },
    '/Book21_B.png': { width: 310, height: 60 },
    '/Book22_B.png': { width: 310, height: 60 },
    '/Book23_W.png': { width: 310, height: 60 },
    '/Book25_W.png': { width: 310, height: 60 },
    '/Book26_B.png': { width: 310, height: 60 },
    '/Book27_W.png': { width: 310, height: 60 },
    '/Book28_W.png': { width: 310, height: 60 },
    '/Book29_W.png': { width: 310, height: 60 }
  };
  
  const getImageDimensions = (imagePath: string) => {
    const dimensions = imageDimensions[imagePath];
    if (dimensions) {
      // Scale the dimensions proportionally based on the base height
      const scale = baseHeight / dimensions.height;
      return {
        width: dimensions.width * scale,
        height: dimensions.height * scale
      };
    }
    // Fallback for unknown images
    const defaultRatio = 5.17; // 310/60
    return {
      width: baseHeight * defaultRatio,
      height: baseHeight
    };
  };
  
  const { width: scaledWidth, height: scaledHeight } = getImageDimensions(selectedImage);
  
  // 📏 DYNAMIC LETTER SPACING - Keep consistent font size, adjust letter spacing
  const baseFontSize = 12; // Increased from 11 to make Gohufont more visible
  const maxTextWidth = scaledWidth - 16; // Account for padding
  const titleLength = displayTitle.length;
  
  // Calculate letter spacing based on title length
  // Shorter titles get more letter spacing to fill the spine
  // Longer titles get tighter letter spacing to fit better
  const baseLetterSpacing = 0.5; // Base letter spacing in pixels
  const spacingAdjustment = Math.max(-1, Math.min(3, (15 - titleLength) * 0.2));
  const finalLetterSpacing = baseLetterSpacing + spacingAdjustment;
  
  // Alternative: You can also set a fixed width and calculate height
  // const scaledWidth = 250; // Fixed width
  // const scaledHeight = scaledWidth / aspectRatio; // Height calculated from width
  
  // Use the first alternative path (URL encoded)
  const imagePath = alternativePaths[1]; // Use URL encoded version
  
  return (
    <>
      <style jsx>{`
        @keyframes beamTop {
          0% {
            transform: translateX(-100%);
            opacity: 0;
          }
          5% {
            opacity: 1;
          }
          25% {
            transform: translateX(100%);
            opacity: 1;
          }
          26% {
            opacity: 0;
          }
        }
        @keyframes beamRight {
          0%, 25% {
            transform: translateY(-100%);
            opacity: 0;
          }
          26% {
            opacity: 1;
          }
          50% {
            transform: translateY(100%);
            opacity: 1;
          }
          51% {
            opacity: 0;
          }
        }
        @keyframes beamBottom {
          0%, 50% {
            transform: translateX(100%);
            opacity: 0;
          }
          51% {
            opacity: 1;
          }
          75% {
            transform: translateX(-100%);
            opacity: 1;
          }
          76% {
            opacity: 0;
          }
        }
        @keyframes beamLeft {
          0%, 75% {
            transform: translateY(100%);
            opacity: 0;
          }
          76% {
            opacity: 1;
          }
          100% {
            transform: translateY(-100%);
            opacity: 1;
          }
        }
        @keyframes pulseGlow {
          0%, 100% {
            opacity: 0.7;
          }
          50% {
            opacity: 1;
          }
        }
      `}</style>
      <div
        onClick={onClick}
        className={`group cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-lg ${
          isSelected 
            ? 'scale-110 shadow-2xl ring-4 ring-purple-500/70 ring-offset-2 ring-offset-transparent' 
            : ''
        }`}
        style={{
          width: `${scaledWidth}px`,
          height: `${scaledHeight}px`,
          margin: '0px 0px',
          position: 'relative',
          backgroundColor: '#f0f0f0', // Fallback color if image doesn't load
          backgroundImage: `url("${imagePath}")`,
          backgroundSize: '100% 100%', // Fill the entire container exactly
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          borderRadius: '4px', // Subtle rounded corners
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          filter: isSelected ? 'brightness(1.15) drop-shadow(0 0 18px rgba(168, 85, 247, 0.85)) drop-shadow(0 0 10px rgba(251, 191, 36, 0.6))' : 'none',
          border: isSelected ? '3px solid rgba(168, 85, 247, 0.9)' : 'none',
          boxShadow: isSelected 
            ? '0 0 24px rgba(168, 85, 247, 0.7), 0 0 16px rgba(251, 191, 36, 0.5), 0 4px 12px rgba(0, 0, 0, 0.4)' 
            : 'none',
          overflow: 'hidden', // Keep overflow hidden to contain beams within bounds
        }}
      >
      {/* Animated border light beam - Pixelated Purple/Violet with Gold theme */}
      {isSelected && (
        <>
          {/* Top border beam */}
          <div
            className="absolute pointer-events-none"
            style={{
              top: '-3px',
              left: '0px',
              right: '0px',
              height: '4px',
              zIndex: 0,
              background: 'linear-gradient(90deg, transparent 0%, rgba(168, 85, 247, 0.75) 10%, rgba(251, 191, 36, 1) 25%, rgba(139, 92, 246, 1) 50%, rgba(251, 191, 36, 1) 75%, rgba(168, 85, 247, 0.75) 90%, transparent 100%)',
              borderRadius: '4px 4px 0 0',
              animation: 'beamTop 10s ease-in-out infinite',
              boxShadow: '0 0 12px rgba(168, 85, 247, 0.95), 0 0 8px rgba(251, 191, 36, 0.9), 0 0 5px rgba(139, 92, 246, 0.8)',
              imageRendering: 'pixelated',
              filter: 'contrast(1.25) saturate(1.35)',
            }}
          />
          {/* Right border beam */}
          <div
            className="absolute pointer-events-none"
            style={{
              top: '0px',
              right: '-3px',
              bottom: '0px',
              width: '4px',
              zIndex: 0,
              background: 'linear-gradient(180deg, transparent 0%, rgba(168, 85, 247, 0.75) 10%, rgba(251, 191, 36, 1) 25%, rgba(139, 92, 246, 1) 50%, rgba(251, 191, 36, 1) 75%, rgba(168, 85, 247, 0.75) 90%, transparent 100%)',
              borderRadius: '0 4px 4px 0',
              animation: 'beamRight 10s ease-in-out infinite',
              boxShadow: '0 0 12px rgba(168, 85, 247, 0.95), 0 0 8px rgba(251, 191, 36, 0.9), 0 0 5px rgba(139, 92, 246, 0.8)',
              imageRendering: 'pixelated',
              filter: 'contrast(1.25) saturate(1.35)',
            }}
          />
          {/* Bottom border beam */}
          <div
            className="absolute pointer-events-none"
            style={{
              bottom: '-3px',
              left: '0px',
              right: '0px',
              height: '4px',
              zIndex: 0,
              background: 'linear-gradient(270deg, transparent 0%, rgba(168, 85, 247, 0.75) 10%, rgba(251, 191, 36, 1) 25%, rgba(139, 92, 246, 1) 50%, rgba(251, 191, 36, 1) 75%, rgba(168, 85, 247, 0.75) 90%, transparent 100%)',
              borderRadius: '0 0 4px 4px',
              animation: 'beamBottom 10s ease-in-out infinite',
              boxShadow: '0 0 12px rgba(168, 85, 247, 0.95), 0 0 8px rgba(251, 191, 36, 0.9), 0 0 5px rgba(139, 92, 246, 0.8)',
              imageRendering: 'pixelated',
              filter: 'contrast(1.25) saturate(1.35)',
            }}
          />
          {/* Left border beam */}
          <div
            className="absolute pointer-events-none"
            style={{
              top: '0px',
              left: '-3px',
              bottom: '0px',
              width: '4px',
              zIndex: 0,
              background: 'linear-gradient(0deg, transparent 0%, rgba(168, 85, 247, 0.75) 10%, rgba(251, 191, 36, 1) 25%, rgba(139, 92, 246, 1) 50%, rgba(251, 191, 36, 1) 75%, rgba(168, 85, 247, 0.75) 90%, transparent 100%)',
              borderRadius: '4px 0 0 4px',
              animation: 'beamLeft 10s ease-in-out infinite',
              boxShadow: '0 0 12px rgba(168, 85, 247, 0.95), 0 0 8px rgba(251, 191, 36, 0.9), 0 0 5px rgba(139, 92, 246, 0.8)',
              imageRendering: 'pixelated',
              filter: 'contrast(1.25) saturate(1.35)',
            }}
          />
        </>
      )}
      
      {/* Secondary pulsing glow effect - Pixelated Purple/Gold theme */}
      {isSelected && (
        <div
          className="absolute pointer-events-none"
          style={{
            top: '-1px',
            left: '-1px',
            right: '-1px',
            bottom: '-1px',
            borderRadius: '5px',
            zIndex: 0,
            border: '2px solid rgba(168, 85, 247, 0.55)',
            animation: 'pulseGlow 4s ease-in-out infinite',
            boxShadow: '0 0 16px rgba(168, 85, 247, 0.65), 0 0 7px rgba(251, 191, 36, 0.45), inset 0 0 10px rgba(168, 85, 247, 0.2)',
            imageRendering: 'pixelated',
            filter: 'contrast(1.2) saturate(1.25)',
          }}
        />
      )}
      {/* Main clickable area */}
      <div
        onClick={onClick}
        className="absolute inset-0 z-10"
        style={{
          width: '100%',
          height: '100%',
        }}
      />
      
      {/* Delete button - appears on hover, large touch target */}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onDelete();
          }}
          onTouchEnd={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onDelete();
          }}
          className="absolute z-30 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-red-500/90 hover:bg-red-600 active:bg-red-700 text-white rounded-full shadow-lg"
          style={{
            top: '-8px',
            right: '-8px',
            width: '28px',
            height: '28px',
            minWidth: '28px',
            minHeight: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            touchAction: 'manipulation',
          }}
          title="Delete note"
        >
          <Trash2 size={14} />
        </button>
      )}
      
      <span 
        className="book-spine-title"
        style={{ 
          color: textColor, // 🎨 DYNAMIC: White for dark purple books, black for others
          fontSize: `${baseFontSize}px`, // 📏 CONSISTENT: Same font size for all titles
          fontWeight: 'normal', // 📝 Normal weight for Gohufont
          fontFamily: selectedFont, // 🔤 GOHUFONT: Also set inline for fallback
          textAlign: 'center',
          textShadow: 'none', // 🚫 REMOVED: No more white outline
          letterSpacing: `${finalLetterSpacing}px`, // 📏 DYNAMIC: Letter spacing adjusts to fill spine
          width: '100%', // 📏 STRETCH: Text fills the full book width
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          padding: '0 8px',
          zIndex: 1,
          position: 'relative',
          lineHeight: '1.2',
        }}
      >
        {displayTitle}
      </span>
    </div>
    </>
  );
};

export default BookSpine;
