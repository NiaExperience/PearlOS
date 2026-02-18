'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import type { SpriteAnimationState } from './useSpriteState';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
  alpha: number;
}

const COLORS = [
  '#818cf8', // indigo-400
  '#a78bfa', // violet-400
  '#c4b5fd', // violet-300
  '#e0e7ff', // indigo-100
  '#6366f1', // indigo-500
];

const MAX_PARTICLES = 80;

interface SpriteParticlesProps {
  state: SpriteAnimationState;
  width?: number;
  height?: number;
}

export default function SpriteParticles({
  state,
  width = 300,
  height = 300,
}: SpriteParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);
  const poolRef = useRef<Particle[]>([]);

  // Object pool: reuse particles instead of creating new ones
  const getParticle = useCallback((): Particle => {
    return poolRef.current.pop() || {
      x: 0, y: 0, vx: 0, vy: 0,
      size: 2, life: 0, maxLife: 1, color: COLORS[0], alpha: 1,
    };
  }, []);

  const returnParticle = useCallback((p: Particle) => {
    if (poolRef.current.length < MAX_PARTICLES * 2) {
      poolRef.current.push(p);
    }
  }, []);

  // Spawn ambient particles
  const spawnAmbient = useCallback((cx: number, cy: number) => {
    if (particlesRef.current.length >= MAX_PARTICLES) return;
    const p = getParticle();
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 50;
    p.x = cx + Math.cos(angle) * dist;
    p.y = cy + Math.sin(angle) * dist;
    p.vx = (Math.random() - 0.5) * 0.3;
    p.vy = -0.2 - Math.random() * 0.4;
    p.size = 1 + Math.random() * 2;
    p.maxLife = 120 + Math.random() * 80;
    p.life = 0;
    p.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    p.alpha = 0;
    particlesRef.current.push(p);
  }, [getParticle]);

  // Burst particles for interactions
  const spawnBurst = useCallback((cx: number, cy: number, count: number) => {
    for (let i = 0; i < count && particlesRef.current.length < MAX_PARTICLES; i++) {
      const p = getParticle();
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      p.x = cx;
      p.y = cy;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.size = 1 + Math.random() * 3;
      p.maxLife = 40 + Math.random() * 40;
      p.life = 0;
      p.color = COLORS[Math.floor(Math.random() * COLORS.length)];
      p.alpha = 1;
      particlesRef.current.push(p);
    }
  }, [getParticle]);

  // Summoning burst
  useEffect(() => {
    if (state === 'summoning') {
      spawnBurst(width / 2, height / 2, 30);
    }
  }, [state, width, height, spawnBurst]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cx = width / 2;
    const cy = height / 2;
    let frameCount = 0;

    const animate = () => {
      ctx.clearRect(0, 0, width, height);
      frameCount++;

      // Spawn ambient particles periodically
      if (state === 'idle' && frameCount % 12 === 0) {
        spawnAmbient(cx, cy);
      } else if (state === 'listening' && frameCount % 6 === 0) {
        spawnAmbient(cx, cy);
      } else if (state === 'speaking' && frameCount % 4 === 0) {
        spawnAmbient(cx, cy);
      } else if (state === 'thinking' && frameCount % 3 === 0) {
        spawnAmbient(cx, cy);
      }

      // Update & draw
      const alive: Particle[] = [];
      for (const p of particlesRef.current) {
        p.life++;
        if (p.life >= p.maxLife) {
          returnParticle(p);
          continue;
        }

        p.x += p.vx;
        p.y += p.vy;
        p.vy -= 0.005; // slight upward drift

        // Fade in/out
        const lifeRatio = p.life / p.maxLife;
        if (lifeRatio < 0.1) {
          p.alpha = lifeRatio / 0.1;
        } else if (lifeRatio > 0.7) {
          p.alpha = 1 - (lifeRatio - 0.7) / 0.3;
        } else {
          p.alpha = 1;
        }

        // Draw pixel (pixelated look)
        ctx.globalAlpha = p.alpha * 0.7;
        ctx.fillStyle = p.color;
        ctx.fillRect(
          Math.round(p.x) - Math.floor(p.size / 2),
          Math.round(p.y) - Math.floor(p.size / 2),
          Math.ceil(p.size),
          Math.ceil(p.size)
        );

        alive.push(p);
      }

      ctx.globalAlpha = 1;
      particlesRef.current = alive;
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [state, width, height, spawnAmbient, returnParticle]);

  // Check reduced motion preference
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) return null;

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="pointer-events-none absolute inset-0"
      style={{
        imageRendering: 'pixelated',
        width,
        height,
      }}
    />
  );
}
