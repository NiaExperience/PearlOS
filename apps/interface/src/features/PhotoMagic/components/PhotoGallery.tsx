'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';

interface GalleryItem {
  filename: string;
  url: string;
  created: number;
  size: number;
}

export const PhotoGallery: React.FC<{
  onSelectImage?: (url: string, filename: string) => void;
  /** Which card shows focus ring (usually set by parent when that image is loaded as the active file) */
  selectedFilename?: string | null;
}> = ({ onSelectImage, selectedFilename = null }) => {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/photo-magic/gallery');
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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
    const onResize = () => updateScrollButtons();
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize);
    return () => {
      el.removeEventListener('scroll', updateScrollButtons);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [items.length, updateScrollButtons]);

  const scrollStrip = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 220, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontFamily: 'Gohufont, monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2 }}>
        Loading gallery...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(255,255,255,0.15)', fontFamily: 'Gohufont, monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: 2 }}>
        No creations yet
      </div>
    );
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
           d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <>
      {expanded && (
        <div
          onClick={() => setExpanded(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          <img
            src={`/api/photo-magic/image/${expanded}`}
            alt=""
            style={{ maxWidth: '85vw', maxHeight: '85vh', borderRadius: 12, boxShadow: '0 0 60px rgba(168,85,247,0.3)' }}
          />
        </div>
      )}

      <div className="w-full min-w-0 max-w-full" style={{ padding: '12px 0' }}>
        <div style={{
          fontFamily: 'Gohufont, monospace', fontSize: 10, textTransform: 'uppercase',
          letterSpacing: 3, color: 'rgba(168,85,247,0.5)', padding: '0 16px 8px',
        }}>
          ✦ Gallery · {items.length} {items.length === 1 ? 'image' : 'images'}
        </div>

        <div className="relative w-full min-w-0 max-w-full group" style={{ fontFamily: 'Gohufont, monospace' }}>
          {canScrollLeft && (
            <button
              type="button"
              onClick={() => scrollStrip(-1)}
              className="absolute left-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center
                bg-gradient-to-r from-[#0f0820]/90 to-transparent
                opacity-60 transition-opacity md:opacity-0 md:group-hover:opacity-100"
              aria-label="Scroll gallery left"
            >
              <span className="text-white/60 text-lg">‹</span>
            </button>
          )}
          {canScrollRight && (
            <button
              type="button"
              onClick={() => scrollStrip(1)}
              className="absolute right-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center
                bg-gradient-to-l from-[#0f0820]/90 to-transparent
                opacity-60 transition-opacity md:opacity-0 md:group-hover:opacity-100"
              aria-label="Scroll gallery right"
            >
              <span className="text-white/60 text-lg">›</span>
            </button>
          )}

          <div ref={scrollRef} className="pm-gallery-scroll">
            {items.map((item) => (
              <div
                key={item.filename}
                className={`pm-gallery-card${selectedFilename === item.filename ? ' pm-gallery-card--selected' : ''}`}
                onClick={() => {
                  const url = item.url || `/api/photo-magic/image/${item.filename}`;
                  onSelectImage?.(url, item.filename);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setExpanded(item.filename);
                }}
              >
                <div className="pm-gallery-card__inner">
                  <img
                    src={item.url || `/api/photo-magic/image/${item.filename}`}
                    alt={item.filename}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    loading="lazy"
                    draggable={false}
                  />
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    padding: '16px 8px 6px',
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
                    fontFamily: 'Gohufont, monospace', fontSize: 9,
                    color: 'rgba(255,255,255,0.5)', letterSpacing: 1,
                  }}>
                    {formatDate(item.created)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};
