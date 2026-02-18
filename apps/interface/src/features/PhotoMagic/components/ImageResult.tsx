"use client";

import { useState, useRef, useCallback, type MouseEvent, type TouchEvent } from 'react';
import type { PhotoMagicResult } from '../hooks/usePhotoMagic';

interface ImageResultProps {
  result: PhotoMagicResult;
  onEditAgain: () => void;
  onReset: () => void;
}

export function ImageResult({ result, onEditAgain, onReset }: ImageResultProps) {
  const [sliderPos, setSliderPos] = useState(50);
  const compareRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const isCompare = !!result.originalImageUrl;

  const updateSlider = useCallback((clientX: number) => {
    if (!compareRef.current) return;
    const rect = compareRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setSliderPos(pct);
  }, []);

  const onMouseDown = useCallback((e: MouseEvent) => {
    draggingRef.current = true;
    updateSlider(e.clientX);
  }, [updateSlider]);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (draggingRef.current) updateSlider(e.clientX);
  }, [updateSlider]);

  const onMouseUp = useCallback(() => { draggingRef.current = false; }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches[0]) updateSlider(e.touches[0].clientX);
  }, [updateSlider]);

  const handleDownload = useCallback(() => {
    const a = document.createElement('a');
    a.href = result.imageUrl;
    a.download = `photo-magic-${Date.now()}.png`;
    a.click();
  }, [result.imageUrl]);

  return (
    <div className="pm-result">
      <div className="pm-result__image-area">
        {isCompare ? (
          <div
            ref={compareRef}
            className="pm-compare"
            style={{
              '--clip-right': `${100 - sliderPos}%`,
              '--divider-x': `${sliderPos}%`,
            } as React.CSSProperties}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onTouchStart={(e) => { if (e.touches[0]) updateSlider(e.touches[0].clientX); }}
            onTouchMove={onTouchMove}
          >
            <img src={result.imageUrl} alt="Result" className="pm-compare__after" />
            <img src={result.originalImageUrl} alt="Original" className="pm-compare__before" />
            <div className="pm-compare__divider" />
            <div className="pm-compare__handle">⟷</div>
            <span className="pm-compare__label pm-compare__label--before">before</span>
            <span className="pm-compare__label pm-compare__label--after">after</span>
          </div>
        ) : (
          <img src={result.imageUrl} alt={result.prompt} className="pm-result__img" />
        )}
      </div>

      <div className="pm-result__actions">
        <button className="pm-action-btn pm-action-btn--primary" onClick={handleDownload}>
          ↓ Download
        </button>
        <button className="pm-action-btn" onClick={onEditAgain}>
          Edit again
        </button>
        <button className="pm-action-btn" onClick={onReset}>
          Start fresh
        </button>
      </div>
    </div>
  );
}
