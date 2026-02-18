"use client";

import { useRef, useState, useCallback, useEffect, type PointerEvent } from 'react';

interface InpaintCanvasProps {
  imageUrl: string;
  onMaskReady: (maskBlob: Blob) => void;
  onClose: () => void;
}

type BrushSize = 'small' | 'medium' | 'large';
const BRUSH_SIZES: Record<BrushSize, number> = { small: 12, medium: 28, large: 52 };

interface Stroke {
  points: Array<{ x: number; y: number }>;
  size: number;
}

export function InpaintCanvas({ imageUrl, onMaskReady, onClose }: InpaintCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [brushSize, setBrushSize] = useState<BrushSize>('medium');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const isDrawingRef = useRef(false);
  const imgDimRef = useRef({ w: 0, h: 0, scale: 1 });
  const rafRef = useRef<number>(0);

  // Load image dimensions
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgDimRef.current.w = img.naturalWidth;
      imgDimRef.current.h = img.naturalHeight;
      fitCanvas();
    };
    img.src = imageUrl;
  }, [imageUrl]);

  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const { w, h } = imgDimRef.current;
    if (!w || !h) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const scale = Math.min(cw / w, ch / h, 1);
    imgDimRef.current.scale = scale;

    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    redraw();
  }, []);

  useEffect(() => {
    window.addEventListener('resize', fitCanvas);
    return () => window.removeEventListener('resize', fitCanvas);
  }, [fitCanvas]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const allStrokes = activeStrokeRef.current
      ? [...strokes, activeStrokeRef.current]
      : strokes;

    ctx.fillStyle = 'rgba(217, 79, 142, 0.4)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const scale = imgDimRef.current.scale;

    for (const stroke of allStrokes) {
      if (stroke.points.length === 0) continue;
      ctx.beginPath();
      const r = (stroke.size * scale) / 2;

      if (stroke.points.length === 1) {
        const p = stroke.points[0];
        ctx.arc(p.x * scale, p.y * scale, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(217, 79, 142, 0.4)';
        ctx.lineWidth = stroke.size * scale;
        ctx.moveTo(stroke.points[0].x * scale, stroke.points[0].y * scale);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x * scale, stroke.points[i].y * scale);
        }
        ctx.stroke();
      }
    }
  }, [strokes]);

  // Redraw whenever strokes change
  useEffect(() => { redraw(); }, [strokes, redraw]);

  const getCanvasPoint = useCallback((e: PointerEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = imgDimRef.current.scale;
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  }, []);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const pt = getCanvasPoint(e);
    if (!pt) return;
    activeStrokeRef.current = { points: [pt], size: BRUSH_SIZES[brushSize] };
    redraw();
  }, [brushSize, getCanvasPoint, redraw]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!isDrawingRef.current || !activeStrokeRef.current) return;
    const pt = getCanvasPoint(e);
    if (!pt) return;
    activeStrokeRef.current.points.push(pt);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(redraw);
  }, [getCanvasPoint, redraw]);

  const handlePointerUp = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (activeStrokeRef.current && activeStrokeRef.current.points.length > 0) {
      setStrokes(prev => [...prev, activeStrokeRef.current!]);
    }
    activeStrokeRef.current = null;
  }, []);

  const handleUndo = useCallback(() => {
    setStrokes(prev => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setStrokes([]);
  }, []);

  const handleDone = useCallback(() => {
    // Export mask: white = paint area (edit), black = keep
    const { w, h } = imgDimRef.current;
    if (!w || !h) return;

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d')!;

    // Fill black (keep)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    // Draw white (edit areas)
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;
      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.lineWidth = stroke.size;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
      }
    }

    offscreen.toBlob((blob) => {
      if (blob) onMaskReady(blob);
    }, 'image/png');
  }, [strokes, onMaskReady]);

  const hasMask = strokes.length > 0;
  const cursorSize = BRUSH_SIZES[brushSize] * imgDimRef.current.scale;

  return (
    <div className="pm-inpaint-overlay">
      <div className="pm-inpaint-toolbar">
        <div className="pm-inpaint-toolbar__group">
          {(['small', 'medium', 'large'] as BrushSize[]).map(size => (
            <button
              key={size}
              className={`pm-inpaint-brush-btn ${brushSize === size ? 'active' : ''}`}
              onClick={() => setBrushSize(size)}
              title={`${size} brush`}
            >
              <span
                className="pm-inpaint-brush-dot"
                style={{ width: BRUSH_SIZES[size] * 0.4, height: BRUSH_SIZES[size] * 0.4 }}
              />
            </button>
          ))}
        </div>
        <div className="pm-inpaint-toolbar__group">
          <button
            className="pm-inpaint-tool-btn"
            onClick={handleUndo}
            disabled={!hasMask}
            title="Undo last stroke"
          >
            ↩
          </button>
          <button
            className="pm-inpaint-tool-btn"
            onClick={handleClear}
            disabled={!hasMask}
            title="Clear mask"
          >
            ✕
          </button>
        </div>
        <div className="pm-inpaint-toolbar__group pm-inpaint-toolbar__actions">
          <button className="pm-inpaint-tool-btn" onClick={onClose} title="Cancel">
            Cancel
          </button>
          <button
            className="pm-action-btn pm-action-btn--primary pm-inpaint-done-btn"
            onClick={handleDone}
            disabled={!hasMask}
          >
            Apply mask
          </button>
        </div>
      </div>

      <div className="pm-inpaint-canvas-wrap" ref={containerRef}>
        <img src={imageUrl} alt="Source" className="pm-inpaint-source" draggable={false} />
        <canvas
          ref={canvasRef}
          className="pm-inpaint-canvas"
          style={{ cursor: `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='${Math.max(4, cursorSize)}' height='${Math.max(4, cursorSize)}'><circle cx='${Math.max(2, cursorSize / 2)}' cy='${Math.max(2, cursorSize / 2)}' r='${Math.max(1, cursorSize / 2 - 1)}' fill='none' stroke='white' stroke-width='1.5'/></svg>") ${Math.max(2, cursorSize / 2)} ${Math.max(2, cursorSize / 2)}, crosshair` }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
    </div>
  );
}
