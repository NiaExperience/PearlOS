'use client';

import React, { useCallback, useRef, useState } from 'react';
import type { ImageContent } from '../types';

interface Props {
  content: ImageContent;
}

export default function ImageRenderer({ content }: Props) {
  const { data } = content;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(0.25, Math.min(5, z - e.deltaY * 0.002)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setDragging(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, [zoom]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPan(p => ({
      x: p.x + e.clientX - lastPos.current.x,
      y: p.y + e.clientY - lastPos.current.y,
    }));
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, [dragging]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  return (
    <div className="canvas-image flex flex-col h-full">
      {content.title && (
        <h2 className="text-xl font-bold text-slate-100 px-6 pt-4 pb-2">{content.title}</h2>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-2 text-sm">
        <button onClick={() => setZoom(z => Math.min(5, z * 1.25))} className="px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">+</button>
        <button onClick={() => setZoom(z => Math.max(0.25, z / 1.25))} className="px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">−</button>
        <button onClick={resetView} className="px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Reset</button>
        <span className="text-slate-500 ml-2">{Math.round(zoom * 100)}%</span>
      </div>

      {/* Image viewport */}
      <div
        className="flex-1 overflow-hidden flex items-center justify-center bg-slate-950/50 mx-4 mb-4 rounded-lg"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: dragging ? 'grabbing' : zoom > 1 ? 'grab' : 'default' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={data.src}
          alt={data.alt || content.title || 'Image'}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            imageRendering: data.pixelArt ? 'pixelated' : 'auto',
            maxWidth: '100%',
            maxHeight: '100%',
            transition: dragging ? 'none' : 'transform 0.15s ease-out',
          }}
          draggable={false}
        />
      </div>

      {data.caption && (
        <p className="text-sm text-slate-400 text-center px-6 pb-4">{data.caption}</p>
      )}
    </div>
  );
}
