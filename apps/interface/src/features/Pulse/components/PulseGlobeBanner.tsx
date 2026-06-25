"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { Search } from "lucide-react";
import type { PulseTopic } from "../lib/pulse-types";

interface PulseGlobeBannerProps {
  topics: PulseTopic[];
  selectedId: string | null;
  query: string;
  loading: boolean;
  coverageNote: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onSelect: (topic: PulseTopic) => void;
}

function projectPin(lat: number, lon: number) {
  const x = 50 + Math.sin((lon * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * 33;
  const y = 50 - Math.sin((lat * Math.PI) / 180) * 34;
  return { left: `${Math.max(8, Math.min(92, x))}%`, top: `${Math.max(12, Math.min(88, y))}%` };
}

function drawGlobe(canvas: HTMLCanvasElement, rotation: number) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const cx = rect.width * 0.52;
  const cy = rect.height * 0.54;
  const radius = Math.min(rect.width * 0.32, rect.height * 0.62);
  const glow = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.4, 0, cx, cy, radius * 1.45);
  glow.addColorStop(0, "rgba(162, 255, 214, 0.95)");
  glow.addColorStop(0.25, "rgba(69, 211, 255, 0.55)");
  glow.addColorStop(0.62, "rgba(21, 80, 96, 0.75)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0.1)");

  ctx.save();
  ctx.shadowColor = "rgba(80, 220, 190, 0.4)";
  ctx.shadowBlur = 40;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(229, 255, 244, 0.18)";

  for (let lat = -60; lat <= 60; lat += 30) {
    const y = cy - Math.sin((lat * Math.PI) / 180) * radius;
    const rx = Math.cos((lat * Math.PI) / 180) * radius;
    ctx.beginPath();
    ctx.ellipse(cx, y, rx, radius * 0.12, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (let lon = 0; lon < 180; lon += 20) {
    const offset = Math.sin(rotation + (lon * Math.PI) / 90);
    ctx.beginPath();
    ctx.ellipse(cx + offset * radius * 0.08, cy, radius * Math.abs(Math.cos(rotation + lon)), radius, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const land = [
    { lat: 38, lon: -95, sx: 0.42, sy: 0.22 },
    { lat: -13, lon: -60, sx: 0.26, sy: 0.34 },
    { lat: 50, lon: 15, sx: 0.24, sy: 0.18 },
    { lat: 6, lon: 22, sx: 0.28, sy: 0.34 },
    { lat: 35, lon: 100, sx: 0.44, sy: 0.25 },
    { lat: -25, lon: 134, sx: 0.2, sy: 0.13 },
  ];
  ctx.fillStyle = "rgba(22, 61, 50, 0.6)";
  for (const patch of land) {
    const lambda = ((patch.lon + rotation * 22) * Math.PI) / 180;
    const phi = (patch.lat * Math.PI) / 180;
    const visible = Math.cos(phi) * Math.cos(lambda) > -0.2;
    if (!visible) continue;
    const x = cx + Math.cos(phi) * Math.sin(lambda) * radius;
    const y = cy - Math.sin(phi) * radius;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * patch.sx, radius * patch.sy, lambda * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(240, 255, 248, 0.45)";
  ctx.stroke();
}

export const PulseGlobeBanner: React.FC<PulseGlobeBannerProps> = ({
  topics,
  selectedId,
  query,
  loading,
  coverageNote,
  onQueryChange,
  onSearch,
  onSelect,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pins = useMemo(() => topics.slice(0, 10), [topics]);

  useEffect(() => {
    let raf = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      if (canvasRef.current) drawGlobe(canvasRef.current, (now - startedAt) / 8000);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <section className="pulse-globe-banner" aria-label="Global topic map">
      <canvas ref={canvasRef} className="pulse-globe-canvas" aria-hidden="true" />
      <div className="pulse-banner-copy">
        <div className="pulse-app-kicker">Pulse</div>
        <h1>Public conversation signals</h1>
        <p>{coverageNote}</p>
      </div>
      <form
        className="pulse-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <Search size={17} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="What are people saying about..."
          spellCheck={false}
        />
        <button type="submit" disabled={loading}>
          {loading ? "Scanning" : "Ask"}
        </button>
      </form>
      <div className="pulse-globe-pins" aria-label="Globe topic markers">
        {pins.map((topic) => (
          <button
            key={topic.id}
            type="button"
            className={`pulse-globe-pin${topic.id === selectedId ? " is-selected" : ""}`}
            style={projectPin(topic.lat, topic.lon)}
            onClick={() => onSelect(topic)}
            title={topic.title}
          >
            <span>{topic.rank}</span>
            <strong>{topic.title}</strong>
          </button>
        ))}
      </div>
    </section>
  );
};
