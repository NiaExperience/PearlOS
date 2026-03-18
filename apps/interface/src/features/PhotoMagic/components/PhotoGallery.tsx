'use client';

import React, { useEffect, useState, useCallback } from 'react';

interface GalleryItem {
  filename: string;
  url: string;
  created: number;
  size: number;
}

export const PhotoGallery: React.FC<{ onSelectImage?: (url: string) => void }> = ({ onSelectImage }) => {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/bot-api/photo-magic/gallery');
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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
      {/* Expanded overlay */}
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
            src={`/bot-api/photo-magic/result/${expanded}`}
            alt=""
            style={{ maxWidth: '85vw', maxHeight: '85vh', borderRadius: 12, boxShadow: '0 0 60px rgba(168,85,247,0.3)' }}
          />
        </div>
      )}

      <div style={{ padding: '12px 0' }}>
        <div style={{
          fontFamily: 'Gohufont, monospace', fontSize: 10, textTransform: 'uppercase',
          letterSpacing: 3, color: 'rgba(168,85,247,0.5)', padding: '0 16px 8px',
        }}>
          ✦ Gallery
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 8,
          padding: '0 16px',
          maxHeight: 320,
          overflowY: 'auto',
        }}>
          {items.map((item) => (
            <div
              key={item.filename}
              onClick={() => setExpanded(item.filename)}
              style={{
                position: 'relative',
                aspectRatio: '1',
                borderRadius: 10,
                overflow: 'hidden',
                cursor: 'pointer',
                background: '#111',
                border: '1px solid rgba(168,85,247,0.15)',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.04)';
                e.currentTarget.style.boxShadow = '0 0 20px rgba(168,85,247,0.25)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <img
                src={`/bot-api/photo-magic/result/${item.filename}`}
                alt={item.filename}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                loading="lazy"
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
          ))}
        </div>
      </div>
    </>
  );
};
