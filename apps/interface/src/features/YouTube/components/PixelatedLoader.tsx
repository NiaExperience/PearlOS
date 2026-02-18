"use client";

interface PixelatedLoaderProps {
  size?: number;
  text?: string;
  className?: string;
}

/**
 * Clean 2D YouTube logo loader with layered 3D effect and rotating spinner
 * Features red rectangle with white play triangle and offset white shadow/border
 */
export function PixelatedLoader({ 
  size = 200,
  text,
  className = '' 
}: PixelatedLoaderProps) {
  const logoSize = size * 0.5;
  const containerSize = size;

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div 
        className="relative flex items-center justify-center"
        style={{ 
          width: containerSize, 
          height: containerSize 
        }}
      >
        {/* Rotating Spinner Ring */}
        <div
          className="absolute"
          style={{
            width: containerSize * 0.9,
            height: containerSize * 0.9,
            borderRadius: '50%',
            border: '4px solid rgba(255, 255, 255, 0.1)',
            borderTopColor: '#ffffff',
            borderRightColor: 'rgba(255, 255, 255, 0.5)',
            boxShadow: '0 0 15px rgba(255, 255, 255, 0.2)',
            animation: 'spin-loader 1s linear infinite',
            zIndex: 1,
          }}
        />

        {/* YouTube Logo with 3D Layered Effect */}
        <div
          className="absolute"
          style={{
            width: logoSize,
            height: logoSize,
            zIndex: 2,
          }}
        >
          {/* White background layer (offset for 3D effect) */}
          <div
            style={{
              position: 'absolute',
              top: '-3px',
              left: '-3px',
              width: logoSize,
              height: logoSize,
              backgroundColor: '#FFFFFF',
              borderRadius: '8px',
            }}
          />
          
          {/* Red foreground with play button */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: logoSize,
              height: logoSize,
              backgroundColor: '#FF0000',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            }}
          >
            {/* White play triangle */}
            <div
              style={{
                width: 0,
                height: 0,
                borderLeft: `${logoSize * 0.35}px solid #FFFFFF`,
                borderTop: `${logoSize * 0.2}px solid transparent`,
                borderBottom: `${logoSize * 0.2}px solid transparent`,
                marginLeft: `${logoSize * 0.08}px`,
              }}
            />
          </div>
        </div>

        {/* CSS Animations */}
        <style jsx>{`
          @keyframes spin-loader {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
}

/**
 * Compact inline loader - same clean 2D YouTube logo style, smaller size
 */
export function PixelatedLoaderInline({ 
  text 
}: { text?: string }) {
  const containerSize = 120;
  const logoSize = containerSize * 0.5;

  return (
    <div className="flex items-center justify-center">
      <div 
        className="relative flex items-center justify-center"
        style={{ 
          width: containerSize, 
          height: containerSize 
        }}
      >
        {/* Rotating Spinner Ring */}
        <div
          className="absolute"
          style={{
            width: containerSize * 0.9,
            height: containerSize * 0.9,
            borderRadius: '50%',
            border: '3px solid rgba(255, 255, 255, 0.1)',
            borderTopColor: '#ffffff',
            borderRightColor: 'rgba(255, 255, 255, 0.5)',
            boxShadow: '0 0 12px rgba(255, 255, 255, 0.2)',
            animation: 'spin-loader-inline 1s linear infinite',
            zIndex: 1,
          }}
        />

        {/* YouTube Logo with 3D Layered Effect */}
        <div
          className="absolute"
          style={{
            width: logoSize,
            height: logoSize,
            zIndex: 2,
          }}
        >
          {/* White background layer (offset for 3D effect) */}
          <div
            style={{
              position: 'absolute',
              top: '-2px',
              left: '-2px',
              width: logoSize,
              height: logoSize,
              backgroundColor: '#FFFFFF',
              borderRadius: '6px',
            }}
          />
          
          {/* Red foreground with play button */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: logoSize,
              height: logoSize,
              backgroundColor: '#FF0000',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
            }}
          >
            {/* White play triangle */}
            <div
              style={{
                width: 0,
                height: 0,
                borderLeft: `${logoSize * 0.35}px solid #FFFFFF`,
                borderTop: `${logoSize * 0.2}px solid transparent`,
                borderBottom: `${logoSize * 0.2}px solid transparent`,
                marginLeft: `${logoSize * 0.08}px`,
              }}
            />
          </div>
        </div>

        {/* CSS Animations */}
        <style jsx>{`
          @keyframes spin-loader-inline {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
}
