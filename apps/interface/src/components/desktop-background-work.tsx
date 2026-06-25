'use client';

import { isFeatureEnabled } from '@nia/features';
import { motion } from 'framer-motion';
import { Users, X } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';

import { NIA_EVENT_APPLET_OPEN, NIA_EVENT_APPLET_UPDATED, NIA_EVENT_HTML_CREATED } from '@interface/features/DailyCall/events/niaEventRouter';
import { NIA_EVENT_WONDER_SCENE } from '@interface/features/Stage/WonderCanvas/WonderCanvasRenderer';
import { useHtmlApplets } from '@interface/features/HtmlGeneration/hooks/use-html-applets';
import type { HtmlAppletListItem } from '@interface/features/HtmlGeneration/hooks/use-html-applets';
import { requestWindowOpen } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';
import { useUI } from '@interface/contexts/ui-context';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { useIsMobile } from '@interface/hooks/use-is-mobile';
import { useInterfaceCustomization } from '@interface/hooks/use-interface-customization';
import { getIconOverride, shouldBypassNextImageOptimization } from '@interface/lib/interface-customization';
import { trackSessionHistory } from '@interface/lib/session-history';
import { buildNewsHTML } from '@interface/lib/news-app-html';
import { dispatchPearlSettingsOpen } from '@interface/lib/webchat-onboarding';
import {
  DESKTOP_OPEN_APP_EVENT,
  getComingSoonAppKey,
  setDesktopAppOpenReady,
} from '@interface/lib/desktop-app-open';
import {
  DESKTOP_SHORTCUTS_CHANGED_EVENT,
  readDesktopShortcuts,
  type PersonalDesktopShortcut,
} from '@interface/lib/personal-desktop-shortcuts';

function dispatchWonderScene(html: string, hideChrome = false, sceneId?: string): void {
  window.dispatchEvent(
    new CustomEvent(NIA_EVENT_WONDER_SCENE, {
      detail: { payload: { html, layer: 'main', transition: 'fade', hideChrome, sceneId } },
    })
  );
}

function weatherEmoji(desc: string): string {
  const d = desc.toLowerCase();
  if (d.includes('thunder') || d.includes('storm')) return '⛈️';
  if (d.includes('blizzard') || d.includes('snow')) return '🌨️';
  if (d.includes('rain') || d.includes('drizzle') || d.includes('shower')) return '🌧️';
  if (d.includes('fog') || d.includes('mist') || d.includes('haze')) return '🌫️';
  if (d.includes('overcast')) return '☁️';
  if (d.includes('cloudy') || d.includes('cloud')) return '⛅';
  if (d.includes('partly')) return '🌤️';
  if (d.includes('sunny') || d.includes('clear') || d.includes('bright')) return '☀️';
  if (d.includes('wind') || d.includes('breezy')) return '💨';
  return '🌤️';
}

function buildWeatherLoadingHTML(): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"/>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500&display=swap" rel="stylesheet"/>
<style>*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;font-family:var(--pearl-ui-font,'Inter',sans-serif);background:var(--pearl-stage-bg,linear-gradient(160deg,#0f0820 0%,#1a0e2e 40%,#1e0f3a 70%,#0f0820 100%));color:var(--pearl-text,#f0ece4);-webkit-font-smoothing:antialiased}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes fu{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes orb-drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-15px) scale(1.05)}}
.wrap{position:relative;width:100%;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;overflow:hidden;background:var(--pearl-stage-bg,linear-gradient(160deg,#0f0820 0%,#1a0e2e 40%,#1e0f3a 70%,#0f0820 100%))}
.wrap::before,.wrap::after{content:'';position:absolute;border-radius:50%;pointer-events:none;animation:orb-drift 12s ease-in-out infinite}
.wrap::before{width:340px;height:340px;top:-80px;right:-60px;background:radial-gradient(circle,rgba(139,92,246,0.15),transparent 70%)}
.wrap::after{width:280px;height:280px;bottom:-40px;left:-60px;background:radial-gradient(circle,rgba(56,189,248,0.12),transparent 70%);animation-delay:-6s}
.sk{background:linear-gradient(90deg,color-mix(in srgb,var(--pearl-text,#fff),transparent 96%) 25%,color-mix(in srgb,var(--pearl-accent,#fff),transparent 88%) 50%,color-mix(in srgb,var(--pearl-text,#fff),transparent 96%) 75%);background-size:200% 100%;animation:shimmer 1.8s ease infinite;border-radius:var(--pearl-radius,12px)}
.c{animation:fu .5s both;position:relative;z-index:2}
.pill{background:var(--pearl-window-content-bg,rgba(255,255,255,.06));border-radius:var(--pearl-radius,12px);padding:clamp(10px,3vw,14px) clamp(14px,4vw,20px);border:1px solid var(--pearl-window-border,rgba(255,255,255,.08));backdrop-filter:var(--pearl-window-backdrop,blur(12px));display:flex;flex-direction:column;align-items:center;gap:6px}
</style></head><body>
<div class="wrap">
  <div class="c" style="animation-delay:.05s;margin-bottom:8px;">
    <div class="sk" style="width:clamp(50px,14vw,70px);height:clamp(50px,14vw,70px);border-radius:50%;margin:0 auto;"></div>
  </div>
  <div class="c" style="animation-delay:.15s;margin-bottom:4px;">
    <div class="sk" style="height:clamp(60px,18vw,90px);width:clamp(140px,35vw,200px);margin:0 auto;border-radius:16px;"></div>
  </div>
  <div class="c" style="animation-delay:.25s;margin-bottom:4px;">
    <div class="sk" style="height:clamp(18px,4vw,24px);width:clamp(100px,25vw,160px);margin:0 auto;"></div>
  </div>
  <div class="c" style="animation-delay:.3s;margin-bottom:24px;">
    <div class="sk" style="height:clamp(12px,3vw,14px);width:clamp(80px,20vw,120px);margin:0 auto;"></div>
  </div>
  <div class="c" style="animation-delay:.4s;display:flex;gap:clamp(8px,3vw,16px);justify-content:center;flex-wrap:wrap;margin-bottom:24px;">
    <div class="pill"><div class="sk" style="height:18px;width:48px;"></div><div class="sk" style="height:10px;width:44px;"></div></div>
    <div class="pill"><div class="sk" style="height:18px;width:48px;"></div><div class="sk" style="height:10px;width:44px;"></div></div>
    <div class="pill"><div class="sk" style="height:18px;width:48px;"></div><div class="sk" style="height:10px;width:44px;"></div></div>
  </div>
  <div class="c" style="animation-delay:.5s;display:flex;gap:clamp(4px,2vw,12px);justify-content:center;flex-wrap:wrap;">
    <div class="pill" style="min-width:56px;"><div class="sk" style="height:10px;width:24px;"></div><div class="sk" style="height:20px;width:20px;border-radius:50%;"></div><div class="sk" style="height:14px;width:36px;"></div></div>
    <div class="pill" style="min-width:56px;"><div class="sk" style="height:10px;width:24px;"></div><div class="sk" style="height:20px;width:20px;border-radius:50%;"></div><div class="sk" style="height:14px;width:36px;"></div></div>
    <div class="pill" style="min-width:56px;"><div class="sk" style="height:10px;width:24px;"></div><div class="sk" style="height:20px;width:20px;border-radius:50%;"></div><div class="sk" style="height:14px;width:36px;"></div></div>
  </div>
  <div class="c" style="animation-delay:.6s;margin-top:20px;">
    <div style="font-family:var(--pearl-ui-font,'Space Grotesk',sans-serif);font-size:clamp(11px,2.5vw,13px);color:var(--pearl-muted,rgba(240,236,228,.35));letter-spacing:.14em;text-transform:uppercase;">Locating you & fetching weather…</div>
  </div>
</div>
</body></html>`;
}

function buildWeatherErrorHTML(): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"/>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500&display=swap" rel="stylesheet"/>
<style>*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;font-family:var(--pearl-ui-font,'Inter',sans-serif);background:var(--pearl-stage-bg,linear-gradient(160deg,#0f0820 0%,#1a0e2e 40%,#1e0f3a 70%,#0f0820 100%));color:var(--pearl-text,#f0ece4);display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;overflow:hidden}
@keyframes fu{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes orb-drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-15px) scale(1.05)}}
.wrap{position:relative;width:100%;min-height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--pearl-stage-bg,linear-gradient(160deg,#0f0820 0%,#1a0e2e 40%,#1e0f3a 70%,#0f0820 100%))}
.wrap::before,.wrap::after{content:'';position:absolute;border-radius:50%;pointer-events:none;animation:orb-drift 12s ease-in-out infinite}
.wrap::before{width:340px;height:340px;top:-80px;right:-60px;background:radial-gradient(circle,rgba(139,92,246,0.15),transparent 70%)}
.wrap::after{width:280px;height:280px;bottom:-40px;left:-60px;background:radial-gradient(circle,rgba(56,189,248,0.12),transparent 70%);animation-delay:-6s}
.c{animation:fu .5s both;position:relative;z-index:2}
</style></head><body>
<div class="wrap">
  <div class="c" style="text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px;max-width:380px;">
    <div style="font-size:clamp(48px,12vw,64px);filter:drop-shadow(0 4px 16px rgba(0,0,0,.4));">⛅</div>
    <div style="font-family:var(--pearl-ui-font,'Playfair Display',serif);font-size:clamp(18px,5vw,24px);color:var(--pearl-accent,#e8c547);font-style:italic;">Weather unavailable</div>
    <div style="font-size:clamp(13px,3vw,15px);color:var(--pearl-muted,rgba(240,236,228,.5));line-height:1.6;">Couldn't load weather data right now. Try asking Pearl — she can check for you!</div>
    <div style="background:var(--pearl-window-content-bg,rgba(255,255,255,.06));border:1px solid var(--pearl-window-border,rgba(255,255,255,.08));border-radius:var(--pearl-radius,12px);padding:14px 20px;font-family:var(--pearl-ui-font,'Space Grotesk',sans-serif);font-size:clamp(13px,3.2vw,15px);color:var(--pearl-muted,rgba(240,236,228,.5));margin-top:8px;backdrop-filter:var(--pearl-window-backdrop,blur(12px));">💬 "Pearl, what's the weather?"</div>
  </div>
</div>
</body></html>`;
}

function buildWeatherSceneHTML(data: Record<string, unknown>): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;
    const current = d.current_condition?.[0] ?? {};
    const tempC = String(current.temp_C ?? '--');
    const tempF = String(current.temp_F ?? '--');
    const feelsLikeF = String(current.FeelsLikeF ?? '--');
    const feelsLikeC = String(current.FeelsLikeC ?? '--');
    const humidity = String(current.humidity ?? '--');
    const windMph = String(current.windspeedMiles ?? '--');
    const uvIndex = String(current.uvIndex ?? '--');
    const desc = String(current.weatherDesc?.[0]?.value ?? 'Unknown');
    const emoji = weatherEmoji(desc);

    const nearestArea = d.nearest_area?.[0] ?? {};
    const city = String(nearestArea.areaName?.[0]?.value ?? '');
    const region = String(nearestArea.region?.[0]?.value ?? '');
    const country = String(nearestArea.country?.[0]?.value ?? '');
    const locationParts = [city, region || country].filter(Boolean);
    const location = locationParts.join(', ') || 'Your Location';

    // Sunrise & sunset from today's astronomy
    const todayWeather = d.weather?.[0] ?? {};
    const astronomy = todayWeather.astronomy?.[0] ?? {};
    const sunrise = String(astronomy.sunrise ?? '--');
    const sunset = String(astronomy.sunset ?? '--');

    // UV level label
    const uvNum = parseInt(uvIndex, 10);
    let uvLabel = '';
    if (!isNaN(uvNum)) {
      if (uvNum <= 2) uvLabel = 'Low';
      else if (uvNum <= 5) uvLabel = 'Moderate';
      else if (uvNum <= 7) uvLabel = 'High';
      else if (uvNum <= 10) uvLabel = 'Very High';
      else uvLabel = 'Extreme';
    }

    const pressureMb = current.pressure != null && String(current.pressure).trim() !== ''
      ? String(current.pressure)
      : '--';
    const visibilityVal = current.visibility != null && String(current.visibility).trim() !== ''
      ? String(current.visibility)
      : '--';

    // Last updated timestamp
    const fetchedAt = d._fetchedAt ? new Date(d._fetchedAt) : new Date();
    const timeStr = fetchedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forecastStrip = (d.weather ?? []).slice(0, 5).map((day: any, idx: number) => {
      const maxF = String(day.maxtempF ?? '--');
      const minF = String(day.mintempF ?? '--');
      const dateStr = String(day.date ?? '');
      const hourly = day.hourly ?? [];
      const midDesc = String((hourly[4]?.weatherDesc ?? hourly[0]?.weatherDesc)?.[0]?.value ?? desc);
      const fe = weatherEmoji(midDesc);
      const dateObj = dateStr ? new Date(`${dateStr}T12:00:00`) : null;
      const dayName = idx === 0 ? 'Today' : (dateObj ? dateObj.toLocaleDateString('en-US', { weekday: 'short' }) : '—');
      const delay = 0.5 + idx * 0.08;
      return `<div class="fc-day" style="animation-delay:${delay}s">
  <div class="fc-name">${dayName}</div>
  <div class="fc-icon">${fe}</div>
  <div class="fc-hi">${maxF}°</div>
  <div class="fc-lo">${minF}°</div>
</div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"/>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500&display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow-y:auto;font-family:var(--pearl-ui-font,'Inter',sans-serif);background:var(--pearl-stage-bg,linear-gradient(160deg,#0f0820 0%,#1a0e2e 40%,#1e0f3a 70%,#0f0820 100%));color:var(--pearl-text,#f0ece4);
-webkit-font-smoothing:antialiased;overflow-x:hidden}
@keyframes fu{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes fl{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes orb-drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-15px) scale(1.05)}}

.weather-wrap{position:relative;width:100%;min-height:100vh;display:flex;flex-direction:column;
align-items:center;justify-content:center;overflow:hidden;
background:var(--pearl-stage-bg,linear-gradient(160deg,#0f0820 0%,#1a0e2e 40%,#1e0f3a 70%,#0f0820 100%));padding:clamp(18px,4vw,34px) clamp(14px,3vw,28px)}
.weather-layout{position:relative;z-index:2;width:min(1200px,100%);display:grid;grid-template-columns:1fr;gap:clamp(12px,2vw,24px);align-items:start}
.weather-left{display:flex;flex-direction:column;align-items:center}
.weather-right{display:flex;flex-direction:column;align-items:center}

.weather-wrap::before,.weather-wrap::after{content:'';position:absolute;border-radius:50%;
pointer-events:none;animation:orb-drift 12s ease-in-out infinite}
.weather-wrap::before{width:340px;height:340px;top:-80px;right:-60px;
background:radial-gradient(circle,rgba(139,92,246,0.15),transparent 70%)}
.weather-wrap::after{width:280px;height:280px;bottom:-40px;left:-60px;
background:radial-gradient(circle,rgba(56,189,248,0.12),transparent 70%);animation-delay:-6s}

.w-icon{font-size:clamp(44px,12vw,64px);margin-bottom:4px;animation:fl 5s ease-in-out infinite;
filter:drop-shadow(0 4px 16px rgba(0,0,0,.4));position:relative;z-index:2}
.w-temp{font-family:var(--pearl-ui-font,'Space Grotesk',sans-serif);font-size:clamp(72px,22vw,110px);
font-weight:700;line-height:1;letter-spacing:-.04em;color:var(--pearl-text,#fff);position:relative;z-index:2;
text-shadow:0 4px 32px rgba(0,0,0,.5);animation:fu .6s .15s both}
.w-temp-alt{font-family:var(--pearl-ui-font,'Space Grotesk',sans-serif);font-size:clamp(14px,3.5vw,18px);
color:var(--pearl-soft,rgba(240,236,228,.8));position:relative;z-index:2;animation:fu .6s .2s both;margin-top:2px}
.w-cond{font-family:var(--pearl-ui-font,'Playfair Display',serif);font-size:clamp(18px,5vw,26px);
color:var(--pearl-accent,#e8c547);font-style:italic;font-weight:400;margin:2px 0 6px;position:relative;z-index:2;
text-shadow:0 2px 12px rgba(0,0,0,.5);animation:fu .6s .3s both}
.w-loc{font-family:var(--pearl-ui-font,'Space Grotesk',sans-serif);font-size:clamp(11px,3vw,14px);
color:var(--pearl-soft,rgba(240,236,228,.9));letter-spacing:.14em;text-transform:uppercase;
position:relative;z-index:2;animation:fu .6s .35s both}

.w-hero-glass{position:relative;z-index:2;backdrop-filter:blur(24px) saturate(180%);
-webkit-backdrop-filter:var(--pearl-window-backdrop,blur(24px) saturate(180%));background:var(--pearl-window-bg,rgba(40,40,60,0.55));
border:1px solid var(--pearl-window-border,rgba(255,255,255,0.15));border-radius:calc(var(--pearl-radius,12px) + 14px);
box-shadow:0 8px 32px rgba(0,0,0,0.25);padding:clamp(28px,6vw,44px) clamp(24px,5vw,40px);
margin-bottom:8px;animation:fu .5s .05s both;width:min(520px,100%);text-align:center}

.w-details{display:flex;gap:clamp(8px,3vw,16px);margin-top:28px;position:relative;z-index:2;
animation:fu .6s .45s both;flex-wrap:wrap;justify-content:center}
.w-pill{text-align:center;background:var(--pearl-window-content-bg,rgba(40,40,60,.45));border-radius:var(--pearl-radius,12px);
padding:clamp(10px,3vw,14px) clamp(14px,4vw,20px);border:1px solid var(--pearl-window-border,rgba(255,255,255,.15));
backdrop-filter:blur(12px)}
.w-pill-val{font-family:var(--pearl-ui-font,'Space Grotesk',sans-serif);font-size:clamp(15px,3.8vw,18px);
font-weight:600;color:var(--pearl-text,#fff)}
.w-pill-lbl{font-size:clamp(10px,2.5vw,11px);color:var(--pearl-muted,rgba(240,236,228,.7));
text-transform:uppercase;letter-spacing:.06em;margin-top:3px}

.w-forecast{display:flex;justify-content:center;gap:clamp(4px,2vw,12px);
margin-top:28px;position:relative;z-index:2;flex-wrap:wrap}
.fc-day{text-align:center;background:var(--pearl-window-content-bg,rgba(40,40,60,.45));border-radius:var(--pearl-radius,10px);
padding:clamp(8px,2vw,12px) clamp(10px,2.5vw,16px);border:1px solid var(--pearl-window-border,rgba(255,255,255,.15));
backdrop-filter:blur(8px);animation:fu .5s both;min-width:56px}
.fc-name{font-family:var(--pearl-ui-font,'Space Grotesk',sans-serif);font-size:clamp(10px,2.5vw,11px);
font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--pearl-soft,rgba(240,236,228,.8));margin-bottom:4px}
.fc-icon{font-size:clamp(16px,4vw,22px);margin-bottom:2px}
.fc-hi{font-family:var(--pearl-ui-font,'Space Grotesk',sans-serif);font-size:clamp(13px,3vw,15px);font-weight:600;color:var(--pearl-text,#fff)}
.fc-lo{font-family:var(--pearl-ui-font,'Space Grotesk',sans-serif);font-size:clamp(11px,2.5vw,12px);color:var(--pearl-muted,rgba(240,236,228,.7))}

.w-footer{font-family:var(--pearl-ui-font,'Space Grotesk',sans-serif);font-size:clamp(9px,2vw,11px);color:var(--pearl-muted,rgba(240,236,228,.6));
position:relative;z-index:2;margin-top:8px;animation:fu .6s .6s both;letter-spacing:.06em;text-align:center;
grid-column:1/-1;width:100%}

@media(max-width:768px){
  html{scroll-padding-bottom:calc(clamp(72px,17vh,112px) + env(safe-area-inset-bottom,0px))}
  .weather-wrap{
    justify-content:flex-start;min-height:100vh;min-height:100dvh;align-items:stretch;
    padding:clamp(14px,4vw,22px) clamp(12px,4vw,18px);
    padding-bottom:calc(clamp(72px,17vh,112px) + env(safe-area-inset-bottom,0px));
    overflow-x:hidden;overflow-y:visible
  }
  .weather-layout{width:100%;gap:clamp(14px,4vw,20px)}
  .weather-left,.weather-right{width:100%;align-items:stretch}
  .weather-right{display:flex;flex-direction:column;gap:16px}
  .w-hero-glass{width:100%;max-width:none;margin-bottom:0;padding:clamp(18px,5vw,28px) clamp(14px,4vw,20px)}
  .w-icon{font-size:clamp(36px,10vw,52px)}
  .w-temp{font-size:clamp(48px,14vw,64px)}
  .w-temp-alt{font-size:clamp(12px,3vw,15px);margin-top:4px}
  .w-cond{font-size:clamp(16px,4.5vw,22px);margin:4px 0 8px}
  .w-loc{font-size:clamp(10px,2.8vw,13px);letter-spacing:.12em;padding:0 8px}
  .w-details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:16px;width:100%;
    justify-items:stretch;align-items:stretch}
  .w-details.w-row-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}
  .w-details.w-row-uv{grid-template-columns:repeat(3,minmax(0,1fr));max-width:100%}
  .w-details.w-row-sun{grid-template-columns:repeat(2,minmax(0,1fr));max-width:280px;margin:0 auto}
  .w-pill{min-width:0;width:100%;padding:clamp(8px,2.5vw,12px) clamp(6px,2vw,10px)}
  .w-pill-val{font-size:clamp(12px,3.2vw,15px)}
  .w-pill-lbl{font-size:clamp(8px,2.2vw,10px);margin-top:2px}
  .w-forecast{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:16px;width:100%;
    justify-content:stretch}
  .fc-day{min-width:0;padding:clamp(6px,2vw,10px) clamp(4px,1.5vw,8px)}
  .fc-name{font-size:clamp(8px,2.2vw,10px);margin-bottom:2px}
  .fc-icon{font-size:clamp(14px,3.5vw,20px);margin-bottom:4px}
  .fc-hi{font-size:clamp(12px,3vw,14px)}
  .fc-lo{font-size:clamp(10px,2.5vw,11px)}
  .w-footer{margin-top:12px;padding:0 4px;font-size:clamp(8px,2vw,10px)}
}

@media(max-width:380px){
  .w-hero-glass{padding:16px 12px}
  .w-icon{font-size:32px}
  .w-temp{font-size:44px}
  .w-temp-alt{font-size:12px}
  .w-cond{font-size:15px}
  .w-loc{font-size:9px;letter-spacing:.1em}
  .w-pill{padding:6px 8px}
  .w-pill-val{font-size:12px}
  .w-pill-lbl{font-size:8px}
  .fc-day{padding:6px 4px}
  .fc-icon{font-size:16px}
  .fc-hi{font-size:11px}
  .fc-lo{font-size:10px}
}

@media(min-width:769px){
  /* Left hero height = row height; right column stretches to match; space-between = equal gaps top→bottom */
  .weather-right{--weather-row-gap:0px}
  .weather-layout{
    grid-template-columns:1.1fr .9fr;gap:clamp(16px,2.5vw,32px);
    align-items:stretch
  }
  .weather-left{
    align-items:flex-end;display:flex;flex-direction:column;justify-content:flex-start;
    align-self:stretch;min-height:100%
  }
  .weather-right{
    align-items:stretch;align-self:stretch;display:flex;flex-direction:column;
    justify-content:space-between;gap:var(--weather-row-gap);height:100%;min-height:100%;
    box-sizing:border-box;
    /* Tune if alignment drifts: between -8px (more up) and -2px (less up) */
    --weather-right-lift:-3px;
    transform:translateY(var(--weather-right-lift))
  }
  .weather-right > .w-details,.weather-right > .w-forecast{
    flex-shrink:0;margin-top:0;
    /* Slight vertical padding: taller rows => less free space for space-between => tighter middle gaps vs left hero */
    padding-block:4px
  }
  .w-temp{font-size:clamp(100px,10vw,136px)}
  .w-cond{font-size:clamp(24px,3vw,32px)}
  .w-loc{font-size:clamp(14px,1.8vw,16px)}
  .w-icon{font-size:clamp(60px,8vw,80px)}
  .w-pill{padding:clamp(14px,2vw,20px) clamp(20px,3vw,32px)}
  .w-details{justify-content:flex-start;margin-top:0;flex-wrap:nowrap}
  .w-details.w-row-metrics{flex-wrap:nowrap;gap:clamp(8px,2vw,14px)}
  .w-details.w-row-uv{justify-content:flex-start;flex-wrap:nowrap;gap:clamp(8px,2vw,14px)}
  .w-forecast{justify-content:flex-start;margin-top:0;gap:clamp(4px,2vw,12px)}
}
</style></head><body>
<div class="weather-wrap">
  <div class="weather-layout">
    <div class="weather-left">
      <div class="w-hero-glass">
        <div class="w-icon">${emoji}</div>
        <div class="w-temp">${tempF}°F</div>
        <div class="w-temp-alt">${tempC}°C</div>
        <div class="w-cond">${desc}</div>
        <div class="w-loc">📍 ${location}</div>
      </div>
    </div>
    <div class="weather-right">
      <div class="w-details w-row-metrics">
        <div class="w-pill"><div class="w-pill-val">${feelsLikeF}°F</div><div class="w-pill-lbl">Feels Like</div></div>
        <div class="w-pill"><div class="w-pill-val">${humidity}%</div><div class="w-pill-lbl">Humidity</div></div>
        <div class="w-pill"><div class="w-pill-val">${windMph} mph</div><div class="w-pill-lbl">Wind</div></div>
      </div>
      <div class="w-details w-row-uv" style="animation-delay:.45s;">
        <div class="w-pill"><div class="w-pill-val">${uvIndex}${uvLabel ? ' · ' + uvLabel : ''}</div><div class="w-pill-lbl">UV Index</div></div>
        <div class="w-pill"><div class="w-pill-val">${pressureMb}${pressureMb !== '--' ? ' mb' : ''}</div><div class="w-pill-lbl">Pressure</div></div>
        <div class="w-pill"><div class="w-pill-val">${visibilityVal}${visibilityVal !== '--' ? ' km' : ''}</div><div class="w-pill-lbl">Visibility</div></div>
      </div>
      <div class="w-details w-row-sun" style="animation-delay:.52s;">
        <div class="w-pill"><div class="w-pill-val">${sunrise}</div><div class="w-pill-lbl">Sunrise</div></div>
        <div class="w-pill"><div class="w-pill-val">${sunset}</div><div class="w-pill-lbl">Sunset</div></div>
      </div>
      <div class="w-forecast">${forecastStrip}</div>
    </div>
    <div class="w-footer">Updated ${timeStr} · wttr.in · Ask Pearl for details</div>
  </div>
</div>
</body></html>`;
  } catch {
    return buildWeatherErrorHTML();
  }
}

/**
 * Background weather refresh — silently fetches fresh data and updates the scene
 * if new data arrives. Used when we showed cached data instantly.
 */
function backgroundWeatherRefresh(
  dispatchWonderScene: (html: string, hideChrome?: boolean, sceneId?: string) => void
): void {
  const WEATHER_CACHE_KEY = 'pearlos_weather_data_v2';
  const COORD_CACHE_KEY = 'pearlos_weather_coords';
  const LOCATION_CACHE_KEY = 'pearlos_weather_location';

  // Build a minimal iframe that just fetches and posts back
  let lat: string | null = null;
  let lng: string | null = null;
  let locationQuery: string | null = null;
  try {
    const cc = localStorage.getItem(COORD_CACHE_KEY);
    if (cc) {
      const c = JSON.parse(cc);
      if (c.lat && c.lng) { lat = c.lat; lng = c.lng; }
    }
    if (!lat || !lng) {
      const storedLocation = localStorage.getItem(LOCATION_CACHE_KEY);
      if (storedLocation) {
        const parsed = JSON.parse(storedLocation);
        if (typeof parsed?.q === 'string' && parsed.q.trim()) locationQuery = parsed.q.trim();
      }
    }
  } catch { /* ignore */ }

  const url = lat && lng
    ? `/api/weather?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`
    : locationQuery
      ? `/api/weather?q=${encodeURIComponent(locationQuery)}`
      : null;

  if (!url) return;

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 6000);

  fetch(url, { signal: ctrl.signal })
    .then(r => {
      clearTimeout(tid);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(data => {
      try {
        localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ _data: data, _ts: Date.now() }));
      } catch {
        /* ignore */
      }
      // Silently update the scene with fresh data
      dispatchWonderScene(buildWeatherSceneHTML(data as Record<string, unknown>), true, 'weather');
    })
    .catch(() => { clearTimeout(tid); /* silently fail — cached data is still showing */ });
}


function buildDiscordHTML(): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:transparent;color:#faf8f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overscroll-behavior:none;}
@keyframes fadeSlide{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes pulse{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:1;transform:scale(1.05)}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes msgIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.c{animation:fadeSlide .5s ease forwards;opacity:0}
.sk{background:linear-gradient(90deg,rgba(255,255,255,.06) 25%,rgba(255,255,255,.12) 50%,rgba(255,255,255,.06) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:8px;}

/* Layout */
.app{display:flex;flex-direction:column;width:100%;max-width:100vw;height:100vh;height:100dvh;overflow:hidden;background:#0f0820;}
.header{flex-shrink:0;display:flex;align-items:center;gap:clamp(8px,2vw,12px);padding:calc(env(safe-area-inset-top,0px) + clamp(10px,2.5vw,16px)) clamp(10px,3vw,18px) clamp(10px,2.5vw,16px);padding-right:calc(env(safe-area-inset-right,0px) + clamp(52px,12vw,76px));border-bottom:1px solid rgba(255,255,255,.06);min-width:0;}
.header-icon{font-size:clamp(20px,5vw,28px);}
.header-title{font-size:clamp(16px,4vw,22px);font-weight:800;color:#faf8f5;flex-shrink:0;}
.channel-select{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:clamp(6px,1.5vw,8px) clamp(10px,2.5vw,14px);color:#d4c0e8;font-size:clamp(12px,2.8vw,14px);font-weight:600;font-family:inherit;cursor:pointer;outline:none;appearance:none;-webkit-appearance:none;max-width:240px;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.channel-select:focus{border-color:rgba(217,79,142,.4);}
.channel-select option{background:#1a0e2e;color:#d4c0e8;}
/* pearl-badge removed */

/* Messages */
.messages{flex:1;overflow-y:auto;overflow-x:hidden;padding:clamp(8px,2vw,14px) clamp(10px,2.5vw,16px);display:flex;flex-direction:column;gap:2px;scroll-behavior:smooth;-webkit-overflow-scrolling:touch;}
.messages::-webkit-scrollbar{width:6px;}
.messages::-webkit-scrollbar-track{background:transparent;}
.messages::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:3px;}

.msg-group{display:flex;gap:clamp(8px,2vw,12px);padding:clamp(4px,1vw,8px) 0;animation:msgIn .3s ease forwards;}
.msg-group:first-child{padding-top:clamp(6px,1.5vw,10px);}
.msg-group+.msg-group-same{padding-top:0;}
.msg-avatar{width:clamp(32px,8vw,40px);height:clamp(32px,8vw,40px);border-radius:50%;flex-shrink:0;object-fit:cover;background:rgba(255,255,255,.06);}
.msg-avatar-spacer{width:clamp(32px,8vw,40px);flex-shrink:0;}
.msg-body{flex:1;min-width:0;}
.msg-header{display:flex;align-items:baseline;gap:clamp(6px,1.5vw,8px);margin-bottom:2px;flex-wrap:wrap;}
.msg-author{font-size:clamp(13px,3.2vw,15px);font-weight:700;color:#e8d5f5;}
.msg-author.bot{color:#D94F8E;}
.msg-time{font-size:clamp(10px,2.2vw,11px);color:rgba(154,128,176,.45);font-weight:500;}
.msg-content{font-size:clamp(14px,3.5vw,16px);color:#d4c0e8;line-height:1.55;word-break:break-word;}
.msg-content a{color:#7cacf8;text-decoration:underline;}
.msg-content code{background:rgba(255,255,255,.08);padding:1px 5px;border-radius:4px;font-size:.9em;font-family:'SF Mono',Monaco,Consolas,monospace;}
.msg-reply{display:flex;align-items:center;gap:6px;padding:3px 8px;margin-bottom:4px;border-left:2px solid rgba(154,128,176,.3);color:rgba(154,128,176,.6);font-size:clamp(11px,2.5vw,12px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.msg-reply-author{font-weight:600;color:rgba(154,128,176,.8);}
.msg-attachment{margin-top:6px;}
.msg-attachment img{max-width:min(320px,100%);border-radius:10px;border:1px solid rgba(255,255,255,.06);}
.msg-attachment a{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:6px 10px;color:#7cacf8;font-size:clamp(11px,2.5vw,13px);text-decoration:none;margin-top:4px;}
.msg-reactions{display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;}
.msg-reaction{display:inline-flex;align-items:center;gap:3px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:100px;padding:2px 8px;font-size:clamp(11px,2.4vw,13px);color:#9a80b0;cursor:default;}

/* Pearl bar */
.pearl-bar{flex-shrink:0;border-top:1px solid rgba(255,255,255,.06);background:rgba(15,8,32,.78);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);padding:clamp(8px,2vw,12px) clamp(10px,2.5vw,16px) calc(env(safe-area-inset-bottom,0px) + clamp(8px,2vw,12px));}
.icon-btn{width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;font-size:14px;flex-shrink:0;padding:0;color:#9a80b0;}
.icon-btn:hover{background:rgba(217,79,142,.15);border-color:rgba(217,79,142,.3);color:#D94F8E;}
.icon-btn:active{transform:scale(.92);}
.compose{display:flex;gap:clamp(6px,1.5vw,8px);align-items:flex-end;}
.compose-input{flex:1;min-width:0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:clamp(8px,2vw,12px) clamp(12px,3vw,16px);color:#faf8f5;font-size:16px;font-family:inherit;outline:none;resize:none;min-height:clamp(38px,8vw,48px);max-height:120px;line-height:1.4;}
.compose-input::placeholder{color:rgba(154,128,176,.4);}
.compose-input:focus{border-color:rgba(217,79,142,.4);}
.send-btn{background:linear-gradient(135deg,#D94F8E,#a855f7);border:none;border-radius:12px;width:clamp(38px,8vw,48px);height:clamp(38px,8vw,48px);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;flex-shrink:0;color:#fff;font-size:clamp(16px,4vw,20px);}
.send-btn:hover{transform:scale(1.05);box-shadow:0 4px 16px rgba(217,79,142,.3);}
.send-btn:active{transform:scale(.95);}
.send-btn:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none;}

/* Status toast */
.toast{position:fixed;bottom:clamp(100px,20vw,140px);left:50%;transform:translateX(-50%);background:rgba(15,8,32,.9);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(217,79,142,.3);border-radius:100px;padding:8px 20px;font-size:clamp(11px,2.5vw,13px);color:#D94F8E;font-weight:600;z-index:999;pointer-events:none;animation:fadeSlide .3s ease forwards;white-space:nowrap;}
.toast.error{border-color:rgba(232,93,38,.3);color:#E85D26;}

/* Pearl summary panel */
.summary-panel{position:fixed;inset:0;background:rgba(15,8,32,.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);z-index:9000;display:none;animation:fadeIn .2s ease;}
.summary-panel.open{display:flex;flex-direction:column;}
.summary-header{display:flex;align-items:center;justify-content:space-between;padding:clamp(14px,3.5vw,20px);border-bottom:1px solid rgba(255,255,255,.08);}
.summary-title{font-size:clamp(16px,4vw,20px);font-weight:700;color:#faf8f5;}
.summary-close{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#9a80b0;font-size:18px;transition:all .2s;font-family:inherit;}
.summary-close:hover{background:rgba(255,255,255,.12);color:#FFD233;}
.summary-body{flex:1;overflow-y:auto;padding:clamp(14px,3.5vw,20px);font-size:clamp(14px,3.5vw,16px);color:#d4c0e8;line-height:1.65;-webkit-overflow-scrolling:touch;}
.summary-body p{margin-bottom:12px;}
.summary-body .loading{text-align:center;padding:40px 20px;color:#9a80b0;}

/* Empty state */
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:clamp(20px,5vw,40px);text-align:center;}
.empty-emoji{font-size:clamp(40px,10vw,56px);margin-bottom:16px;}
.empty-title{font-size:clamp(16px,4vw,20px);font-weight:700;color:#e8d5f5;margin-bottom:8px;}
.empty-sub{font-size:clamp(12px,2.8vw,14px);color:#9a80b0;line-height:1.5;}

/* Date separator */
.date-sep{text-align:center;padding:clamp(8px,2vw,14px) 0;font-size:clamp(10px,2.3vw,12px);color:rgba(154,128,176,.4);font-weight:600;letter-spacing:.06em;text-transform:uppercase;}
@media (max-width:520px){
  .header{gap:8px;padding-right:calc(env(safe-area-inset-right,0px) + 48px);}
  .header-icon{display:none;}
  .header-title{font-size:16px;}
  .channel-select{max-width:none;font-size:13px;border-radius:10px;}
  .messages{padding:8px 10px;}
  .msg-group{gap:8px;}
  .msg-avatar,.msg-avatar-spacer{width:30px;height:30px;}
  .compose{gap:6px;}
  .icon-btn{width:34px;height:34px;}
  .send-btn{width:42px;height:42px;border-radius:12px;}
}
</style>
</head><body>

<div class="app">
  <!-- Header -->
  <div class="header c" style="animation-delay:0s;">
    <div class="header-icon">💬</div>
    <div class="header-title">Discord</div>
    <select class="channel-select" id="channel-select" onchange="switchChannel(this.value)">
      <option value="">Loading…</option>
    </select>
    <button class="icon-btn" onclick="disconnectDiscord()" title="Disconnect Discord" style="margin-left:auto">🔌</button>
  </div>

  <!-- Messages -->
  <div class="messages" id="messages">
    <div class="empty-state">
      <div class="empty-emoji">💜</div>
      <div class="empty-title">Loading messages…</div>
      <div class="empty-sub">Pearl is connecting to Discord</div>
    </div>
  </div>

  <!-- Pearl bar -->
  <div class="pearl-bar c" style="animation-delay:.1s;">
    <div class="compose">
      <button class="icon-btn" onclick="summarize()" id="btn-summarize" title="Summarize">✨</button>
      <button class="icon-btn" onclick="readAloud()" id="btn-read" title="Read aloud">🔊</button>
      <textarea class="compose-input" id="compose-input" placeholder="Message Pearl Village" rows="1" oninput="autoResize(this)" onkeydown="handleKey(event)"></textarea>
      <button class="send-btn" id="send-btn" onclick="sendMessage()" title="Send" disabled>↗</button>
    </div>
  </div>
</div>

<!-- Summary panel -->
<div class="summary-panel" id="summary-panel">
  <div class="summary-header">
    <div class="summary-title">✨ Pearl's Summary</div>
    <button class="summary-close" onclick="closeSummary()">✕</button>
  </div>
  <div class="summary-body" id="summary-body">
    <div class="loading">Pearl is reading the conversation…</div>
  </div>
</div>

<script>
(function(){
  var currentChannelId = '';
  var channels = [];
  var allMessages = [];
  var refreshTimer = null;
  var isSending = false;

  // ── Helpers ──

  function esc(s){
    if(!s)return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formatContent(raw){
    var s = esc(raw);
    // Bold
    s = s.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');
    // Italic
    s = s.replace(/\\*(.+?)\\*/g,'<em>$1</em>');
    // Inline code
    s = s.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
    // Links
    s = s.replace(/(https?:\\/\\/[^\\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>');
    // Newlines
    s = s.replace(/\\n/g,'<br/>');
    return s;
  }

  function timeStr(iso){
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '';
    var now = new Date();
    var h = d.getHours(); var m = d.getMinutes();
    var ampm = h>=12?'PM':'AM'; h=h%12; if(h===0)h=12;
    var time = h+':'+(m<10?'0':'')+m+' '+ampm;
    if(d.toDateString()===now.toDateString()) return 'Today '+time;
    var yesterday = new Date(now); yesterday.setDate(yesterday.getDate()-1);
    if(d.toDateString()===yesterday.toDateString()) return 'Yesterday '+time;
    return (d.getMonth()+1)+'/'+d.getDate()+' '+time;
  }

  function dateLabel(iso){
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '';
    var now = new Date();
    if(d.toDateString()===now.toDateString()) return 'Today';
    var yesterday = new Date(now); yesterday.setDate(yesterday.getDate()-1);
    if(d.toDateString()===yesterday.toDateString()) return 'Yesterday';
    var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear();
  }

  function toast(msg, isError){
    var existing = document.querySelector('.toast');
    if(existing) existing.remove();
    var el = document.createElement('div');
    el.className = 'toast'+(isError?' error':'');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function(){el.remove();},3000);
  }

  function scrollToBottom(){
    var el = document.getElementById('messages');
    setTimeout(function(){ el.scrollTop = el.scrollHeight; }, 50);
  }

  // ── Channels ──

  function loadChannels(){
    fetch('/api/discord/channels')
      .then(function(r){return r.json();})
      .then(function(data){
        if(!data.channels || !data.channels.length){
          toast(data.error || 'No Pearl Village channels found', true);
          return;
        }
        channels = data.channels;
        var sel = document.getElementById('channel-select');
        var html = '';
        channels.forEach(function(ch){
          html += '<option value="'+esc(ch.id)+'">#'+esc(ch.name)+'</option>';
        });
        sel.innerHTML = html;
        // Default to first channel (usually #general)
        currentChannelId = channels[0].id;
        sel.value = currentChannelId;
        loadMessages();
      })
      .catch(function(){
        toast('Failed to load channels', true);
      });
  }

  window.switchChannel = function(id){
    if(!id || id === currentChannelId) return;
    currentChannelId = id;
    allMessages = [];
    renderMessages();
    loadMessages();
  };

  // ── Messages ──

  function loadMessages(){
    if(!currentChannelId) return;
    fetch('/api/discord/messages?channelId='+encodeURIComponent(currentChannelId)+'&limit=50')
      .then(function(r){return r.json();})
      .then(function(data){
        if(!data.messages){
          toast(data.error || 'Failed to load messages', true);
          return;
        }
        allMessages = data.messages;
        renderMessages();
        scrollToBottom();
      })
      .catch(function(){
        toast('Connection error', true);
      });
  }

  window.refreshMessages = function(){
    toast('Refreshing…');
    loadMessages();
  };

  window.disconnectDiscord = function(){
    if(confirm('Disconnect Discord? You will need to reconnect to access your servers.')){
      try{
        localStorage.removeItem('pearlos_discord_status');
        localStorage.removeItem('pearlos_discord_channels');
        localStorage.removeItem('pearlos_discord_messages');
      }catch(e){}
      window.parent.postMessage({type:'disconnect.discord',action:'discord-disconnect'},'*');
      // Close the Discord view and show connect screen
      setTimeout(function(){
        window.parent.postMessage({type:'close.discord',action:'close-discord-view'},'*');
      },200);
    }
  };

  function renderMessages(){
    var el = document.getElementById('messages');
    if(!allMessages.length){
      el.innerHTML = '<div class="empty-state"><div class="empty-emoji">💬</div><div class="empty-title">No messages yet</div><div class="empty-sub">Be the first to say something!</div></div>';
      return;
    }

    var html = '';
    var lastAuthor = '';
    var lastDate = '';
    var groupTimeout = 7 * 60 * 1000; // 7 minutes for grouping

    allMessages.forEach(function(msg, idx){
      // Date separator
      var dl = dateLabel(msg.timestamp);
      if(dl !== lastDate){
        html += '<div class="date-sep">— '+esc(dl)+' —</div>';
        lastDate = dl;
        lastAuthor = '';
      }

      var prevMsg = idx > 0 ? allMessages[idx-1] : null;
      var sameAuthor = prevMsg && prevMsg.author.id === msg.author.id;
      var timeDiff = prevMsg ? new Date(msg.timestamp) - new Date(prevMsg.timestamp) : Infinity;
      var grouped = sameAuthor && timeDiff < groupTimeout && dateLabel(msg.timestamp) === dateLabel(prevMsg.timestamp);

      if(!grouped){
        // Full message with avatar
        html += '<div class="msg-group">';
        html += '<img class="msg-avatar" src="'+esc(msg.author.avatar)+'" alt="" loading="lazy" onerror="this.style.background=\\'rgba(154,128,176,.2)\\';this.src=\\'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect fill=%22%239a80b0%22 width=%221%22 height=%221%22/></svg>\\'">';
        html += '<div class="msg-body">';
        html += '<div class="msg-header">';
        html += '<span class="msg-author'+(msg.author.bot?' bot':'')+'">'+esc(msg.author.displayName)+'</span>';
        if(msg.author.bot) html += '<span style="background:rgba(217,79,142,.15);border-radius:4px;padding:1px 5px;font-size:9px;color:#D94F8E;font-weight:700;letter-spacing:.05em;">BOT</span>';
        html += '<span class="msg-time">'+esc(timeStr(msg.timestamp))+'</span>';
        html += '</div>';
        lastAuthor = msg.author.id;
      } else {
        // Grouped continuation
        html += '<div class="msg-group msg-group-same">';
        html += '<div class="msg-avatar-spacer"></div>';
        html += '<div class="msg-body">';
      }

      // Reply reference
      if(msg.referencedMessage){
        html += '<div class="msg-reply">↩ <span class="msg-reply-author">'+esc(msg.referencedMessage.author)+'</span> '+esc(msg.referencedMessage.content)+'</div>';
      }

      // Content
      if(msg.content){
        html += '<div class="msg-content">'+formatContent(msg.content)+'</div>';
      }

      // Attachments
      if(msg.attachments && msg.attachments.length){
        msg.attachments.forEach(function(att){
          html += '<div class="msg-attachment">';
          if(att.contentType && att.contentType.startsWith('image/')){
            html += '<img src="'+esc(att.url)+'" alt="'+esc(att.filename)+'" loading="lazy"/>';
          } else {
            html += '<a href="'+esc(att.url)+'" target="_blank" rel="noopener">📎 '+esc(att.filename)+'</a>';
          }
          html += '</div>';
        });
      }

      // Reactions
      if(msg.reactions && msg.reactions.length){
        html += '<div class="msg-reactions">';
        msg.reactions.forEach(function(r){
          html += '<span class="msg-reaction">'+r.emoji+' '+r.count+'</span>';
        });
        html += '</div>';
      }

      html += '</div></div>';
    });

    el.innerHTML = html;
  }

  // ── Send ──

  window.sendMessage = function(){
    if(isSending) return;
    var input = document.getElementById('compose-input');
    var btn = document.getElementById('send-btn');
    var content = input ? input.value.trim() : '';
    if(!currentChannelId || !content){
      toast('Choose a channel and write a message first', true);
      return;
    }
    isSending = true;
    if(btn) btn.disabled = true;
    fetch('/api/discord/send', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'include',
      body:JSON.stringify({channelId:currentChannelId,content:content})
    })
      .then(function(r){return r.json().then(function(data){return {ok:r.ok,status:r.status,data:data};});})
      .then(function(result){
        if(!result.ok){
          toast(result.data && (result.data.message || result.data.error) || 'Failed to send message', true);
          return;
        }
        input.value = '';
        input.style.height = '';
        toast('Sent');
        loadMessages();
      })
      .catch(function(){
        toast('Connection error', true);
      })
      .finally(function(){
        isSending = false;
        if(btn) btn.disabled = !(input && input.value.trim());
      });
  };

  window.handleKey = function(e){
    if(e.key==='Enter' && !e.shiftKey){
      e.preventDefault();
      window.sendMessage();
    }
  };

  window.autoResize = function(el){
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120)+'px';
    document.getElementById('send-btn').disabled = !el.value.trim();
  };

  // ── Pearl: Summarize ──

  window.summarize = function(){
    var panel = document.getElementById('summary-panel');
    var body = document.getElementById('summary-body');
    panel.classList.add('open');
    body.innerHTML = '<div class="loading">✨ Pearl is reading the conversation…</div>';

    // Build a text digest of recent messages for Pearl
    var digest = allMessages.slice(-30).map(function(m){
      return m.author.displayName+': '+m.content;
    }).join('\\n');

    if(!digest.trim()){
      body.innerHTML = '<p>No messages to summarize yet. Try switching to an active channel!</p>';
      return;
    }

    // Send to Pearl via parent postMessage
    window.parent.postMessage({
      type:'wonder.interaction',
      action:'pearl-request',
      label:'Summarize Discord',
      payload: 'Please summarize this Discord conversation concisely. Focus on key topics and who said what. Here are the recent messages:\\n\\n'+digest
    },'*');

    // Show the digest formatted as a readable summary while Pearl thinks
    var fallback = '<p style="color:#9a80b0;font-size:clamp(12px,2.8vw,13px);margin-bottom:16px;">Here\\'s what\\'s been said recently:</p>';
    var lastSpeaker = '';
    allMessages.slice(-20).forEach(function(m){
      if(!m.content.trim()) return;
      if(m.author.displayName !== lastSpeaker){
        fallback += '<p><strong style="color:#e8d5f5;">'+esc(m.author.displayName)+'</strong></p>';
        lastSpeaker = m.author.displayName;
      }
      fallback += '<p style="margin-left:12px;margin-bottom:4px;">'+esc(m.content)+'</p>';
    });
    body.innerHTML = fallback;
  };

  window.closeSummary = function(){
    document.getElementById('summary-panel').classList.remove('open');
  };

  // ── Pearl: Read Aloud ──

  window.readAloud = function(){
    var recent = allMessages.slice(-10);
    if(!recent.length){
      toast('No messages to read');
      return;
    }

    var text = recent.map(function(m){
      if(!m.content.trim()) return '';
      return m.author.displayName+' says: '+m.content;
    }).filter(Boolean).join('. ');

    if(!text){
      toast('No text messages to read');
      return;
    }

    // Send TTS request to parent
    window.parent.postMessage({
      type:'wonder.interaction',
      action:'pearl-speak',
      label:'Read Discord messages',
      payload: text
    },'*');

    toast('🔊 Reading messages aloud…');
  };

  // ── Input: enable/disable send button ──
  document.getElementById('compose-input').addEventListener('input', function(){
    document.getElementById('send-btn').disabled = !this.value.trim();
  });

  // ── Init ──
  loadChannels();

  // Auto-refresh every 10 seconds
  refreshTimer = setInterval(function(){
    if(!document.hidden && !isSending){
      loadMessages();
    }
  }, 10000);

  // Cleanup on page hide
  document.addEventListener('visibilitychange', function(){
    if(document.hidden && refreshTimer){
      clearInterval(refreshTimer);
      refreshTimer = null;
    } else if(!refreshTimer){
      refreshTimer = setInterval(function(){
        if(!document.hidden && !isSending) loadMessages();
      }, 10000);
    }
  });
})();
</script>
</body></html>`;
}

// ── End Wonder Canvas helpers ──────────────────────────────────────────

interface DesktopBackgroundWorkProps {
  supportedFeatures: string[] | undefined;
  assistantName?: string;
  tenantId?: string;
  isAdmin?: boolean;
  iconsOnly?: boolean;
}

const DesktopBackgroundWork = ({ supportedFeatures, assistantName, tenantId, isAdmin, iconsOnly }: DesktopBackgroundWorkProps) => {
  const ICON_SIZE = 64;
  const DESKTOP_ICON_FRAME_CLASS = 'flex h-16 w-16 items-center justify-center rounded-xl border border-black/45 bg-black/30 shadow-[0_8px_22px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-[1px]';
  const { isChatMode } = useUI();
  const isMobile = useIsMobile();
  const htmlFeatureEnabled = isFeatureEnabled('htmlContent', supportedFeatures);
  const canUseAppletFolder = htmlFeatureEnabled && Boolean(assistantName);
  const [isAppletFolderOpen, setIsAppletFolderOpen] = useState(false);
  const [comingSoonApp, setComingSoonApp] = useState<'pearlVision' | null>(null);
  const [desktopShortcuts, setDesktopShortcuts] = useState<PersonalDesktopShortcut[]>([]);

  const comingSoonPlaceholderByApp = {
    pearlVision: { src: '/images/PearlVision_placeholder.png', alt: 'Pearl Vision coming soon' },
  } as const;
  const [isMounted, setIsMounted] = useState(false);
  const customization = useInterfaceCustomization();
  const desktopIcon = useCallback(
    (key: string, fallback: string) => getIconOverride(customization.icons, key, fallback),
    [customization.icons],
  );
  const pixelIcon = useCallback(
    (key: string, fallback: string) => {
      const src = desktopIcon(key, fallback);
      return {
        src,
        unoptimized: shouldBypassNextImageOptimization(src),
        onError: (event: SyntheticEvent<HTMLImageElement>) => {
          const image = event.currentTarget;
          const current = image.getAttribute('src') || '';
          if (fallback && !current.includes(fallback)) {
            image.src = fallback;
          }
        },
      };
    },
    [desktopIcon],
  );

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const refreshShortcuts = () => setDesktopShortcuts(readDesktopShortcuts());
    refreshShortcuts();
    window.addEventListener(DESKTOP_SHORTCUTS_CHANGED_EVENT, refreshShortcuts);
    window.addEventListener('storage', refreshShortcuts);
    return () => {
      window.removeEventListener(DESKTOP_SHORTCUTS_CHANGED_EVENT, refreshShortcuts);
      window.removeEventListener('storage', refreshShortcuts);
    };
  }, []);
  const { data: session } = useResilientSession();
  const currentUserId = session?.user?.id;
  const sessionEmail = session?.user?.email;
  const defaultOwnerEmail = useMemo(() => sessionEmail || undefined, [sessionEmail]);
  const appletHookEnabled = Boolean(canUseAppletFolder && isAppletFolderOpen);
  const folderSampleIcons = ['🎮', '📱', '🛠️', '✨'];

  const getAppletVisuals = (applet: HtmlAppletListItem) => {
    const key = (applet.contentType || '').toLowerCase();
    switch (key) {
      case 'game':
        return { icon: '/gamingconsole.png', bg: 'from-indigo-500/60 via-indigo-400/20 to-slate-900/40', isImage: true };
      case 'app':
        return { icon: '/mobilegame.png', bg: 'from-emerald-400/60 via-emerald-300/20 to-slate-900/40', isImage: true };
      case 'tool':
        return { icon: '🛠️', bg: 'from-amber-400/60 via-amber-200/30 to-slate-900/40', isImage: false };
      case 'interactive':
        return { icon: '✨', bg: 'from-pink-400/60 via-purple-300/20 to-slate-900/40', isImage: false };
      default:
        return { icon: '📁', bg: 'from-slate-500/50 via-slate-400/20 to-slate-900/40', isImage: false };
    }
  };

  const {
    applets: folderApplets,
    loading: folderLoading,
    error: folderError,
    refresh: refreshFolderApplets,
  } = useHtmlApplets({
    enabled: canUseAppletFolder, // always fetch to drive inline rendering/shelf gate
    currentUserId,
    isAdmin,
    agent: assistantName,
    tenantId,
    includeSharingMetadata: false,
  });

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('💼 WORK background is currently active');
  }, []);

  // Listen for Discord OAuth response
  useEffect(() => {
    const syncDiscordStatus = async (): Promise<boolean> => {
      try {
        const res = await fetch('/api/discord/status', { credentials: 'include' });
        if (!res.ok) return false;
        const data = await res.json();
        if (data?.connected && data?.discordUserId) {
          localStorage.setItem('pearlos_discord_status', JSON.stringify({
            connected: true,
            userId: data.discordUserId,
            scope: data.scope,
            connectedAt: Date.now()
          }));
          dispatchWonderScene(buildDiscordHTML(), true, 'discord');
          return true;
        }
      } catch { /* ignore */ }
      return false;
    };

    const handleDiscordResponse = (event: MessageEvent) => {
      if (event.data?.type === 'discord.connect') {
        // Open the Discord OAuth flow in a separate popup window so the user
        // stays inside Pearl instead of being navigated away. The click that
        // triggered this happens inside the connect iframe, whose transient
        // user activation propagates to this top frame, so the popup is not
        // blocked. If the browser blocks it anyway, fall back to in-tab nav.
        const width = 520;
        const height = 760;
        const left = window.screenX + Math.max(0, Math.round((window.outerWidth - width) / 2));
        const top = window.screenY + Math.max(0, Math.round((window.outerHeight - height) / 2));
        const popup = window.open(
          '/api/discord/auth?popup=1',
          'pearl_discord_oauth',
          `popup=yes,width=${width},height=${height},left=${left},top=${top}`
        );
        if (!popup) {
          window.location.href = '/api/discord/auth';
        } else {
          let attempts = 0;
          const poll = window.setInterval(() => {
            attempts += 1;
            void syncDiscordStatus().then((connected) => {
              if (connected || popup.closed || attempts >= 45) window.clearInterval(poll);
            });
          }, 1000);
        }
      } else if (event.data?.type === 'discord.oauth-success') {
        // Store Discord connection status
        try {
          localStorage.setItem('pearlos_discord_status', JSON.stringify({
            connected: true,
            userId: event.data.userId,
            username: event.data.username,
            connectedAt: Date.now()
          }));
        } catch { /* ignore */ }
        // Re-render the Discord app in its connected state now that the popup
        // has reported success and closed itself.
        void syncDiscordStatus();
      } else if (event.data?.type === 'discord.oauth-error') {
        // Handle OAuth error
        // eslint-disable-next-line no-console
        console.error('Discord OAuth failed:', event.data.error);
      } else if (event.data?.type === 'close.discord') {
        // User disconnected, close current Discord view (it will show connect screen on next open)
        // The connect screen will be shown automatically next time since status was cleared
      } else if (event.data?.type === 'disconnect.discord') {
        void fetch('/api/discord/status', {
          method: 'DELETE',
          credentials: 'include',
        }).finally(() => {
          try {
            localStorage.removeItem('pearlos_discord_status');
            localStorage.removeItem('pearlos_discord_channels');
            localStorage.removeItem('pearlos_discord_messages');
          } catch { /* ignore */ }
        });
      }
    };

    const params = new URLSearchParams(window.location.search);
    const connectStatus = params.get('discord_connect');
    if (connectStatus) {
      if (connectStatus === 'success') {
        void syncDiscordStatus();
      } else {
        // eslint-disable-next-line no-console
        console.error('Discord OAuth failed:', params.get('discord_detail') || 'unknown');
      }
      params.delete('discord_connect');
      params.delete('discord_detail');
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', next);
    }

    window.addEventListener('message', handleDiscordResponse);
    return () => window.removeEventListener('message', handleDiscordResponse);
  }, []);

  // Auto-refresh when applets are created/updated elsewhere
  useEffect(() => {
    if (!canUseAppletFolder) return;
    const handleRefresh = () => refreshFolderApplets();
    window.addEventListener(NIA_EVENT_HTML_CREATED, handleRefresh as EventListener);
    window.addEventListener(NIA_EVENT_APPLET_UPDATED, handleRefresh as EventListener);
    return () => {
      window.removeEventListener(NIA_EVENT_HTML_CREATED, handleRefresh as EventListener);
      window.removeEventListener(NIA_EVENT_APPLET_UPDATED, handleRefresh as EventListener);
    };
  }, [canUseAppletFolder, refreshFolderApplets]);

  // Refresh when returning focus/visibility (covers creation in another tab/window)
  useEffect(() => {
    if (!canUseAppletFolder) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshFolderApplets();
      }
    };
    const handleFocus = () => refreshFolderApplets();
    window.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [canUseAppletFolder, refreshFolderApplets]);

  useEffect(() => {
    if (!canUseAppletFolder && isAppletFolderOpen) {
      setIsAppletFolderOpen(false);
    }
  }, [canUseAppletFolder, isAppletFolderOpen]);

  const handleOpenAppletFromFolder = useCallback(
    (appletId: string) => {
      if (!appletId) return;
      requestWindowOpen({
        viewType: 'htmlContent',
        source: 'desktop:applet-folder',
        options: { allowDuplicate: false },
      });
      window.dispatchEvent(
        new CustomEvent(NIA_EVENT_APPLET_OPEN, {
          detail: { payload: { appletId } },
        })
      );
      setIsAppletFolderOpen(false);
    },
    []
  );

  const appletCount = folderApplets.length;
  const recentApplets = folderApplets.slice(0, 3);

  const openDesktopApp = (appName: string, url?: string, useEnhanced?: boolean, category?: string) => {
    // eslint-disable-next-line no-console
    console.log(`Opening desktop app: ${appName}`);

    trackSessionHistory(`Opened ${appName} app`).catch(() => {
      // ignore
    });

    if (!appName) return;

    const normalized = appName.toLowerCase();
    const comingSoonKey = getComingSoonAppKey(normalized);
    if (comingSoonKey) {
      setComingSoonApp(comingSoonKey);
      return;
    }

    const source = `desktop:${normalized}`;

    switch (normalized) {
      case 'creation-engine':
      case 'creationengine':
      case 'creation':
        requestWindowOpen({ viewType: 'htmlContent', source: 'desktop:creation-engine' });
        return;
      case 'creation-launchpad':
      case 'creationlaunchpad':
      case 'launchpad': {
        // Native React component — no longer uses iframe to external :3002 app
        // Fallback reference: const launchpadUrl = `${window.location.protocol}//${window.location.hostname}:3002`;
        // requestWindowOpen({ viewType: 'enhancedBrowser', viewState: { enhancedBrowserUrl: launchpadUrl }, source: 'desktop:creation-launchpad' });
        requestWindowOpen({ viewType: 'creationLaunchpad', source: 'desktop:creation-launchpad' });
        return;
      }
      case 'agency':
      case 'the-agency':
      case 'theagency':
        requestWindowOpen({ viewType: 'agency', source: 'desktop:agency' });
        return;
      case 'council':
      case 'the-council':
      case 'summon':
      case 'summon-agent':
      case 'summonagent':
        requestWindowOpen({ viewType: 'council', source: 'desktop:council' });
        return;
      case 'our-pearlos':
      case 'ourpearlos':
      case 'our-pearl':
      case 'ourpearl':
      case 'public-features':
      case 'feature-catalog':
      case 'community-features':
        requestWindowOpen({ viewType: 'ourPearlos', source: 'desktop:our-pearlos' });
        return;
      case 'pulse':
      case 'global-pulse':
      case 'social-pulse':
        requestWindowOpen({ viewType: 'pulse', source: 'desktop:pulse' });
        return;
      case 'styles':
      case 'style':
      case 'appearance':
        requestWindowOpen({ viewType: 'styles', source: 'desktop:styles' });
        return;
      case 'settings':
      case 'preferences':
      case 'profile-settings':
        dispatchPearlSettingsOpen(normalized === 'profile-settings' ? 'profile' : 'connections');
        return;
      case 'googledrive':
      case 'google-drive':
      case 'drive':
        requestWindowOpen({ viewType: 'googleDrive', source });
        return;
      case 'gmail':
      case 'email':
        requestWindowOpen({ viewType: 'gmail', source });
        return;
      case 'notes':
      case 'notepad':
      case 'text':
        requestWindowOpen({ viewType: 'notes', source });
        return;
      case 'terminal':
      case 'cmd':
      case 'command':
        requestWindowOpen({ viewType: 'terminal', source });
        return;
      case 'browser':
      case 'chrome':
      case 'web': {
        const finalUrl = url || 'https://www.google.com';
        const enhanced = useEnhanced !== false;
        const viewType = enhanced ? 'enhancedBrowser' : 'miniBrowser';
        const viewState = enhanced ? { enhancedBrowserUrl: finalUrl } : { browserUrl: finalUrl };
        requestWindowOpen({ viewType, viewState, source });
        return;
      }
      case 'youtube':
      case 'video': {
        const query = url && url.trim().length > 0 ? url : '';
        requestWindowOpen({ viewType: 'youtube', viewState: { youtubeQuery: query }, source });
        return;
      }
      case 'photo-magic':
      case 'photomagic':
        requestWindowOpen({ viewType: 'photoMagic', source: 'desktop:photo-magic' });
        return;
      case 'dailycall':
      case 'daily-call':
      case 'call':
      case 'meeting':
        requestWindowOpen({ viewType: 'dailyCall', source });
        return;
      case 'pearlvision':
      case 'pearl-vision':
      case 'vision':
        requestWindowOpen({
          viewType: 'dailyCall',
          viewState: { dailyMode: 'vision' },
          source: 'desktop:pearl-vision',
        });
        return;
      case 'news': {
        // Show styled Wonder Canvas news display instead of browser window
        dispatchWonderScene(buildNewsHTML(category), true, 'news');
        // Fire nia:request.news so the bot/backend can populate with real headlines later
        window.dispatchEvent(new CustomEvent('nia:request.news', { detail: {} }));
        return;
      }
      case 'weather': {
        // --- Strategy ---
        // 1. If we have cached weather data (<15min old), show it INSTANTLY
        // 2. Try saved coordinates or a saved manual city/ZIP
        // 3. Try browser geolocation briefly
        // 4. If location is unavailable, show a manual city/ZIP input
        // 5. Total timeout only applies while actively fetching
        // 6. Cache successful results in localStorage for instant repeat opens

        const WEATHER_CACHE_KEY = 'pearlos_weather_data_v2';
        const WEATHER_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
        const COORD_CACHE_KEY = 'pearlos_weather_coords';

        // Check for cached weather data first — show instantly
        try {
          const cachedWeather = localStorage.getItem(WEATHER_CACHE_KEY);
          if (cachedWeather) {
            const parsed = JSON.parse(cachedWeather);
            if (parsed._data && parsed._ts && (Date.now() - parsed._ts) < WEATHER_CACHE_TTL) {
              dispatchWonderScene(buildWeatherSceneHTML(parsed._data), true, 'weather');
              // Still refresh in background via iframe, but user sees weather immediately
              // Fire background refresh after a tick
              setTimeout(() => {
                backgroundWeatherRefresh(dispatchWonderScene);
              }, 100);
              return;
            }
          }
        } catch { /* ignore corrupt cache */ }

        // No valid cache — go straight to the bootstrap HTML which has its own
        // loading skeleton. Do NOT dispatch a separate loading scene first — the
        // WonderCanvasRenderer dedup window (200ms) would swallow the second
        // dispatch and the bootstrap (which does the actual fetch) would never load.

        // Build self-contained HTML that handles geolocation + fetch inside the iframe
        // Key improvements:
        // - Use cached coords or manual location if available
        // - Try geolocation with 2s timeout
        // - Ask for a city/ZIP when browser location is unavailable
        // - Fetch has 6s AbortController timeout
        // - Cache weather data, coords, and manual location in localStorage
        const weatherBootstrapHTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"/>
<style>*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow-y:auto;background:var(--pearl-stage-bg,linear-gradient(160deg,#0f0820 0%,#1a0e2e 40%,#1e0f3a 70%,#0f0820 100%));color:var(--pearl-text,#faf8f5);font-family:var(--pearl-ui-font,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes fadeSlide{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.sk{background:linear-gradient(90deg,color-mix(in srgb,var(--pearl-text,#fff),transparent 96%) 25%,color-mix(in srgb,var(--pearl-accent,#fff),transparent 88%) 50%,color-mix(in srgb,var(--pearl-text,#fff),transparent 96%) 75%);background-size:200% 100%;animation:shimmer 1.8s ease infinite;border-radius:var(--pearl-radius,12px);}
.c{animation:fadeSlide .4s ease forwards;opacity:0}
.location-panel{display:none;animation:fadeSlide .25s ease forwards;background:var(--pearl-window-bg,rgba(255,255,255,.06));border:1px solid var(--pearl-window-border,rgba(255,255,255,.1));border-radius:calc(var(--pearl-radius,12px) + 10px);padding:clamp(18px,5vw,28px);box-shadow:var(--pearl-window-shadow,0 18px 50px rgba(0,0,0,.26));}
.location-title{font-size:clamp(18px,5vw,26px);font-weight:700;text-align:center;margin-bottom:14px;color:var(--pearl-text,#faf8f5);}
.location-form{display:flex;gap:10px;align-items:center;}
.location-input{min-width:0;flex:1;border:1px solid var(--pearl-window-border,rgba(255,255,255,.16));border-radius:var(--pearl-radius,12px);background:var(--pearl-window-content-bg,rgba(0,0,0,.2));color:var(--pearl-text,#faf8f5);font:inherit;padding:12px 14px;outline:none;}
.location-input:focus{border-color:var(--pearl-accent,#e8c547);box-shadow:0 0 0 3px color-mix(in srgb,var(--pearl-accent,#e8c547),transparent 78%);}
.location-button{border:0;border-radius:var(--pearl-radius,12px);background:var(--pearl-accent,#e8c547);color:#1b1430;font-weight:700;font:inherit;padding:12px 16px;cursor:pointer;white-space:nowrap;}
.location-error{min-height:18px;margin-top:10px;text-align:center;color:#ffb4b4;font-size:13px;}
@media(max-width:520px){.location-form{flex-direction:column;align-items:stretch}.location-button{width:100%;}}
</style></head><body>
<div id="weather-root" style="min-height:100vh;display:flex;flex-direction:column;align-items:stretch;padding:clamp(16px,5vw,32px);gap:clamp(12px,3vw,20px);">
  <div class="c" style="animation-delay:0s;text-align:center;padding-top:clamp(8px,2vw,16px);"><div class="sk" style="height:14px;width:120px;margin:0 auto;"></div></div>
  <div class="c" style="animation-delay:.08s;background:var(--pearl-window-bg,rgba(255,255,255,0.04));border:1px solid var(--pearl-window-border,rgba(255,255,255,0.08));border-radius:calc(var(--pearl-radius,12px) + 12px);padding:clamp(24px,6vw,40px);text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px;">
    <div class="sk" style="width:clamp(60px,16vw,88px);height:clamp(60px,16vw,88px);border-radius:20px;"></div>
    <div class="sk" style="height:clamp(44px,11vw,64px);width:140px;"></div>
    <div class="sk" style="height:16px;width:100px;"></div>
  </div>
  <div class="c" style="animation-delay:.15s;display:flex;gap:clamp(8px,2vw,12px);">
    <div style="flex:1;background:var(--pearl-window-content-bg,rgba(255,255,255,0.04));border:1px solid var(--pearl-window-border,rgba(255,255,255,0.06));border-radius:var(--pearl-radius,16px);padding:clamp(14px,3vw,20px);display:flex;flex-direction:column;align-items:center;gap:8px;"><div class="sk" style="width:28px;height:28px;border-radius:8px;"></div><div class="sk" style="height:18px;width:48px;"></div><div class="sk" style="height:10px;width:44px;"></div></div>
    <div style="flex:1;background:var(--pearl-window-content-bg,rgba(255,255,255,0.04));border:1px solid var(--pearl-window-border,rgba(255,255,255,0.06));border-radius:var(--pearl-radius,16px);padding:clamp(14px,3vw,20px);display:flex;flex-direction:column;align-items:center;gap:8px;"><div class="sk" style="width:28px;height:28px;border-radius:8px;"></div><div class="sk" style="height:18px;width:48px;"></div><div class="sk" style="height:10px;width:44px;"></div></div>
    <div style="flex:1;background:var(--pearl-window-content-bg,rgba(255,255,255,0.04));border:1px solid var(--pearl-window-border,rgba(255,255,255,0.06));border-radius:var(--pearl-radius,16px);padding:clamp(14px,3vw,20px);display:flex;flex-direction:column;align-items:center;gap:8px;"><div class="sk" style="width:28px;height:28px;border-radius:8px;"></div><div class="sk" style="height:18px;width:48px;"></div><div class="sk" style="height:10px;width:44px;"></div></div>
  </div>
  <div class="c" style="animation-delay:.22s;text-align:center;padding:clamp(4px,1vw,8px) 0;">
    <div style="font-size:clamp(11px,2.5vw,13px);color:var(--pearl-muted,#9a80b0);" id="status-msg">Fetching weather…</div>
  </div>
  <div id="location-panel" class="location-panel">
    <div class="location-title">Choose a weather location</div>
    <form id="weather-location-form" class="location-form">
      <input id="weather-location-input" class="location-input" type="search" autocomplete="postal-code" placeholder="City or ZIP code" />
      <button class="location-button" type="submit">Search</button>
    </form>
    <div id="location-error" class="location-error" aria-live="polite"></div>
  </div>
</div>
<script>
(function(){
  var COORD_KEY='pearlos_weather_coords';
  var LOCATION_KEY='pearlos_weather_location';
  var DATA_KEY='pearlos_weather_data_v2';
  var statusEl=document.getElementById('status-msg');
  var locationPanel=document.getElementById('location-panel');
  var locationForm=document.getElementById('weather-location-form');
  var locationInput=document.getElementById('weather-location-input');
  var locationError=document.getElementById('location-error');
  var done=false;
  var awaitingLocationSent=false;

  function setStatus(msg){if(statusEl)statusEl.textContent=msg;}
  function setLocationError(msg){if(locationError)locationError.textContent=msg||'';}
  function showLocationPrompt(msg){
    if(done)return;
    if(locationPanel)locationPanel.style.display='block';
    setStatus(msg||'Choose a weather location');
    if(!awaitingLocationSent){
      awaitingLocationSent=true;
      window.parent.postMessage({type:'weather.awaitingLocation'},'*');
    }
    setTimeout(function(){try{if(locationInput)locationInput.focus();}catch(e){}},50);
  }
  function hideLocationPrompt(){
    if(locationPanel)locationPanel.style.display='none';
    setLocationError('');
  }

  function sendResult(data){
    if(done)return;
    done=true;
    // Cache the weather data in localStorage (parent can also read this)
    try{localStorage.setItem(DATA_KEY,JSON.stringify({_data:data,_ts:Date.now()}));}catch(e){}
    window.parent.postMessage({type:'weather.data',payload:JSON.stringify(data)},'*');
  }

  function sendError(){
    if(done)return;
    done=true;
    window.parent.postMessage({type:'weather.error'},'*');
  }

  function fetchWeather(lat,lng,query){
    var url='';
    var label='';
    if(query){
      label=query;
      url='/api/weather?q='+encodeURIComponent(query);
    }else if(lat!=null&&lng!=null){
      url='/api/weather?lat='+encodeURIComponent(lat)+'&lng='+encodeURIComponent(lng);
    }else{
      showLocationPrompt('Choose a weather location');
      return Promise.resolve(false);
    }
    setStatus(label?'Fetching weather for '+label+'…':'Fetching local weather…');
    var ctrl=new AbortController();
    var tid=setTimeout(function(){ctrl.abort();},6000);
    return fetch(url,{signal:ctrl.signal})
      .then(function(r){
        clearTimeout(tid);
        if(!r.ok)throw new Error('HTTP '+r.status);
        return r.json();
      })
      .then(function(data){
        if(query){
          try{localStorage.setItem(LOCATION_KEY,JSON.stringify({q:query,ts:Date.now()}));}catch(e){}
        }
        sendResult(data);
        return true;
      })
      .catch(function(){
        clearTimeout(tid);
        if(query){
          setLocationError('Could not load that location. Try another city or ZIP code.');
          showLocationPrompt('Choose a weather location');
        }
        return false;
      });
  }

  if(locationForm){
    locationForm.addEventListener('submit',function(event){
      event.preventDefault();
      var q=(locationInput&&locationInput.value||'').trim();
      if(!q){
        setLocationError('Enter a city or ZIP code.');
        return;
      }
      hideLocationPrompt();
      fetchWeather(null,null,q);
    });
  }

  // --- Main flow: cached location, then geolocation, then manual input ---
  var cachedCoords=null;
  var cachedLocation=null;
  try{
    var cc=localStorage.getItem(COORD_KEY);
    if(cc){
      var c=JSON.parse(cc);
      if(c.lat&&c.lng&&(Date.now()-c.ts)<86400000) cachedCoords=c;
    }
    var cl=localStorage.getItem(LOCATION_KEY);
    if(cl){
      var loc=JSON.parse(cl);
      if(loc.q&&typeof loc.q==='string'&&(Date.now()-loc.ts)<2592000000) cachedLocation=loc.q;
    }
  }catch(e){}

  if(cachedCoords){
    // Have cached coords — use them immediately
    setStatus('Using your location…');
    fetchWeather(cachedCoords.lat,cachedCoords.lng).then(function(ok){
      if(!ok)showLocationPrompt('Choose a weather location');
    });
    // Also refresh coords in background (don't block)
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(function(pos){
        try{localStorage.setItem(COORD_KEY,JSON.stringify({lat:pos.coords.latitude.toFixed(4),lng:pos.coords.longitude.toFixed(4),ts:Date.now()}));}catch(e){}
      },function(){},{timeout:5000,maximumAge:300000});
    }
  } else if(cachedLocation){
    setStatus('Using saved location…');
    if(locationInput)locationInput.value=cachedLocation;
    fetchWeather(null,null,cachedLocation).then(function(ok){
      if(!ok)showLocationPrompt('Choose a weather location');
    });
  } else {
    // No cached location — try geolocation briefly, then ask for a city/ZIP.
    var geoResolved=false;

    function requireManualLocation(){
      if(done)return;
      showLocationPrompt('Choose a weather location');
    }

    // Start geolocation with aggressive 2s timeout
    if(navigator.geolocation){
      setStatus('Getting your location…');
      var geoTimer=setTimeout(function(){
        if(!geoResolved){geoResolved=true;requireManualLocation();}
      },2000);
      navigator.geolocation.getCurrentPosition(
        function(pos){
          if(geoResolved)return; // too late
          geoResolved=true;
          clearTimeout(geoTimer);
          var lat=pos.coords.latitude.toFixed(4);
          var lng=pos.coords.longitude.toFixed(4);
          try{localStorage.setItem(COORD_KEY,JSON.stringify({lat:lat,lng:lng,ts:Date.now()}));}catch(e){}
          fetchWeather(lat,lng).then(function(ok){
            if(!ok)requireManualLocation();
          });
        },
        function(){
          if(geoResolved)return;
          geoResolved=true;
          clearTimeout(geoTimer);
          requireManualLocation();
        },
        {timeout:2000,maximumAge:300000}
      );
    }else{
      requireManualLocation();
    }
  }
})();
</script>
</body></html>`;

        dispatchWonderScene(weatherBootstrapHTML, true, 'weather');

        // Listen for messages from the iframe
        let weatherHandled = false;
        let weatherAwaitingLocation = false;
        const weatherMessageHandler = (event: MessageEvent) => {
          if (weatherHandled) return;
          if (event.data?.type === 'weather.data') {
            weatherHandled = true;
            try {
              const data = JSON.parse(event.data.payload) as Record<string, unknown>;
              // Also cache in parent's localStorage
              try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ _data: data, _ts: Date.now() })); } catch { /* ignore */ }
              dispatchWonderScene(buildWeatherSceneHTML(data), true, 'weather');
            } catch {
              dispatchWonderScene(buildWeatherErrorHTML(), true, 'weather');
            }
            window.removeEventListener('message', weatherMessageHandler);
          } else if (event.data?.type === 'weather.error') {
            weatherHandled = true;
            dispatchWonderScene(buildWeatherErrorHTML(), true, 'weather');
            window.removeEventListener('message', weatherMessageHandler);
          } else if (event.data?.type === 'weather.awaitingLocation') {
            weatherAwaitingLocation = true;
          }
        };
        window.addEventListener('message', weatherMessageHandler);

        // Timeout fallback — if iframe is actively fetching and doesn't respond,
        // show error. Do not replace the manual location input while the user is
        // deciding what city/ZIP to enter.
        setTimeout(() => {
          if (!weatherHandled && !weatherAwaitingLocation) {
            weatherHandled = true;
            dispatchWonderScene(buildWeatherErrorHTML(), true, 'weather');
            window.removeEventListener('message', weatherMessageHandler);
          }
        }, 8000);

        return;
      }
      case 'files':
      case 'filespace':
      case 'docs':
        requestWindowOpen({ viewType: 'files', source });
        return;
      case 'sprites':
      case 'sprite':
        requestWindowOpen({ viewType: 'sprites', source: 'desktop:sprites' });
        return;
      case 'discord': {
        // Check if user has Discord connected
        let discordConnected = false;
        try {
          const status = localStorage.getItem('pearlos_discord_status');
          const parsed = status ? JSON.parse(status) : null;
          if (parsed && parsed.connected && parsed.userId) {
            discordConnected = true;
          }
        } catch { /* ignore */ }

        if (discordConnected) {
          // User is connected, show their Discord
          dispatchWonderScene(buildDiscordHTML(), true, 'discord');
        } else {
          // User not connected, show setup screen
          const connectDiscordHTML = `
<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"/>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;font-family:'Inter',sans-serif;
background:linear-gradient(160deg,#0f0820 0%,#1a0e2e 40%,#1e0f3a 70%,#0f0820 100%);
color:#f0ece4;-webkit-font-smoothing:antialiased}
@keyframes fadeIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeInSlow{from{opacity:0}to{opacity:1}}
@keyframes pulse{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:1;transform:scale(1.05)}}
.wrap{position:relative;width:100%;height:100vh;display:flex;flex-direction:column;
align-items:center;justify-content:center;text-align:center;overflow:hidden;
background:linear-gradient(160deg,#0f0820 0%,#1a0e2e 40%,#1e0f3a 70%,#0f0820 100%);padding:24px}
.wrap::before,.wrap::after{content:'';position:absolute;border-radius:50%;pointer-events:none;
animation:pulse 8s ease-in-out infinite}
.wrap::before{width:340px;height:340px;top:-80px;right:-60px;
background:radial-gradient(circle,rgba(139,92,246,0.15),transparent 70%)}
.wrap::after{width:280px;height:280px;bottom:-40px;left:-60px;
background:radial-gradient(circle,rgba(56,189,248,0.12),transparent 70%);animation-delay:-4s}
.discord-icon{font-size:64px;margin-bottom:24px;filter:drop-shadow(0 4px 16px rgba(0,0,0,.4));
animation:fadeIn .6s ease forwards}
.title{font-family:'Playfair Display',serif;font-size:clamp(24px,5vw,32px);
color:#5865F2;margin-bottom:12px;animation:fadeIn .6s .1s ease forwards}
.subtitle{font-size:clamp(14px,3.5vw,16px);color:rgba(240,236,228,.7);
margin-bottom:32px;max-width:420px;line-height:1.6;animation:fadeIn .6s .2s ease forwards}
.btn-connect{
  background:linear-gradient(135deg,#5865F2,#4752C4);
  border:none;border-radius:12px;padding:14px 32px;
  color:#fff;font-family:'Space Grotesk',sans-serif;font-size:15px;
  font-weight:600;letter-spacing:.02em;cursor:pointer;transition:all .3s;
  display:inline-flex;align-items:center;gap:10px;box-shadow:0 4px 16px rgba(88,101,242,.3);
  animation:fadeIn .6s .3s ease forwards
}
.btn-connect:hover{transform:scale(1.05);box-shadow:0 6px 24px rgba(88,101,242,.5)}
.btn-connect:active{transform:scale(.95)}
.features{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-top:32px}
.feature{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
border-radius:12px;padding:20px;max-width:180px;backdrop-filter:blur(12px);
animation:fadeInSlow 1s forwards;opacity:0}
.feature:nth-child(1){animation-delay:.5s}
.feature:nth-child(2){animation-delay:.6s}
.feature:nth-child(3){animation-delay:.7s}
.feature-icon{font-size:24px;margin-bottom:12px}
.feature-title{font-family:'Space Grotesk',sans-serif;font-size:13px;
font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;color:#fff}
.feature-desc{font-size:12px;color:rgba(240,236,228,.6);line-height:1.5}
.info-note{margin-top:32px;font-size:12px;color:rgba(240,236,228,.5);animation:fadeInSlow 1s .8s forwards;opacity:0}
@media (max-width:640px){
  .wrap{height:100dvh;justify-content:flex-start;padding:clamp(12px,2.8vh,24px)}
  .discord-icon{font-size:clamp(42px,8vw,64px);margin-bottom:clamp(10px,2vh,24px)}
  .title{margin-bottom:clamp(8px,1.6vh,12px)}
  .subtitle{margin-bottom:clamp(12px,2.2vh,28px);max-width:min(420px,92vw);line-height:1.45}
  .btn-connect{padding:clamp(11px,1.8vh,14px) clamp(24px,5vw,32px)}
  .features{flex-direction:column;flex-wrap:nowrap;align-items:center}
  .feature{width:min(180px,84vw)}
  .info-note{margin-top:auto;padding-top:clamp(10px,2.2vh,24px);font-size:clamp(10px,2.3vw,12px)}
}
@media (max-width:640px) and (max-height:740px){
  .wrap{padding:10px}
  .subtitle{margin-bottom:10px}
  .btn-connect{padding:10px 20px;font-size:14px}
  .features{margin-top:10px;gap:10px}
  .feature{padding:14px;max-width:170px}
  .feature-icon{font-size:20px;margin-bottom:8px}
  .feature-title{font-size:12px;margin-bottom:4px}
  .feature-desc{font-size:11px;line-height:1.35}
  .info-note{padding-top:8px}
}
</style></head><body>
<div class="wrap">
  <div class="discord-icon">💬</div>
  <div class="title">Join us in Pearl Village</div>
  <button class="btn-connect" onclick="connectDiscord()">
    <span>Connect Now</span>
    <span style="font-size:18px">→</span>
  </button>
  <div class="features">
    <div class="feature">
      <div class="feature-icon">📱</div>
      <div class="feature-title">Your Servers</div>
      <div class="feature-desc">Click here to access all your Discord servers</div>
    </div>
    <div class="feature">
      <div class="feature-icon">💬</div>
      <div class="feature-title">Messages</div>
      <div class="feature-desc">Say hi, find friends, share stories & more</div>
    </div>
    <div class="feature">
      <div class="feature-icon">✨</div>
      <div class="feature-title">Pearl Features</div>
      <div class="feature-desc">Explore, ask questions, request features</div>
    </div>
  </div>
  <div class="info-note">Your Discord data is processed locally and never stored without permission</div>
</div>
<script>
(function(){
  window.connectDiscord = function(){
    // Post message to parent to trigger Discord OAuth flow
    window.parent.postMessage({
      type: 'discord.connect',
      action: 'discord-oauth-request'
    }, '*');
  };
})();
</script>
</body></html>`;
          dispatchWonderScene(connectDiscordHTML, true, 'discord-connect');
          void fetch('/api/discord/status', { credentials: 'include' })
            .then(async (res) => {
              if (!res.ok) return null;
              return res.json();
            })
            .then((data) => {
              if (!data?.connected || !data?.discordUserId) return;
              try {
                localStorage.setItem('pearlos_discord_status', JSON.stringify({
                  connected: true,
                  userId: data.discordUserId,
                  scope: data.scope,
                  connectedAt: Date.now()
                }));
              } catch { /* ignore */ }
              dispatchWonderScene(buildDiscordHTML(), true, 'discord');
            })
            .catch(() => { /* leave the connect screen visible */ });
        }
        return;
      }
      default:
        console.warn(`⚠️ Unknown desktop app requested: ${appName}`);
    }
  };

  const openDesktopAppRef = useRef(openDesktopApp);
  openDesktopAppRef.current = openDesktopApp;

  const openPersonalShortcut = useCallback((shortcut: PersonalDesktopShortcut) => {
    if (shortcut.target.kind === 'native-app') {
      requestWindowOpen({
        viewType: shortcut.target.viewType,
        title: shortcut.title,
        source: `desktop:shortcut:${shortcut.id}`,
      });
      return;
    }

    requestWindowOpen({
      viewType: 'miniBrowser',
      title: shortcut.title,
      viewState: {
        browserUrl: shortcut.target.playUrl,
        miniBrowserPresentation: 'seamless',
      },
      meta: {
        creationId: shortcut.target.projectId,
        launchpadProjectId: shortcut.target.projectId,
        playUrl: shortcut.target.playUrl,
        fullscreen: true,
      },
      source: `desktop:shortcut:${shortcut.id}`,
      options: { allowDuplicate: false },
    });
  }, []);

  // Bot + deep links use the same path as desktop icon clicks.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ app?: string; url?: string; category?: string }>).detail;
      if (detail?.app) {
        openDesktopAppRef.current(detail.app, detail.url, undefined, detail.category);
      }
    };
    window.addEventListener(DESKTOP_OPEN_APP_EVENT, handler);
    setDesktopAppOpenReady(true);
    return () => {
      setDesktopAppOpenReady(false);
      window.removeEventListener(DESKTOP_OPEN_APP_EVENT, handler);
    };
  }, []);

  return (
    <div className="pearl-work-desktop absolute inset-0 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'var(--pearl-desktop-background-image, var(--pearl-desktop-default-background-image, url(/backgrounds/desktop-forest.png)))',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      </div>

      {/* Desktop icons — strict 3-column grid, fills left-to-right then down */}
      <motion.div
        className={`pointer-events-auto fixed z-[30] ${
          isMobile
            ? 'left-4 right-4 top-20'
            : 'left-8 right-8 top-24'
        }`}
        style={{
          display: 'grid',
          gridAutoFlow: 'row',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          justifyItems: 'center',
          rowGap: isMobile ? '20px' : '28px',
          columnGap: isMobile ? '8px' : '24px',
          touchAction: 'manipulation',
        }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        {/* The Agency */}
        <motion.div
          className="flex cursor-pointer flex-col items-center"
          onClick={() => openDesktopApp('agency')}
          whileHover={{ y: -8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <motion.div
            className={DESKTOP_ICON_FRAME_CLASS}
            whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Image {...pixelIcon('agency', '/icons/agency-building.svg')} alt="The Agency" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" style={{ imageRendering: 'pixelated' }} />
          </motion.div>
          <motion.span
            className="mt-2 text-center text-xs uppercase text-white"
            style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
            whileHover={{ color: 'rgb(139, 220, 154)', textShadow: '0 0 10px rgba(139, 220, 154, 0.6)' }}
            transition={{ duration: 0.2 }}
          >
            The Agency
          </motion.span>
        </motion.div>

        {/* Creation Launchpad — opens creation-launchpad web UI on :3002 */}
        <motion.div
          className="flex cursor-pointer flex-col items-center"
          onClick={() => openDesktopApp('creation-launchpad')}
          whileHover={{ y: -8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <motion.div
            className={DESKTOP_ICON_FRAME_CLASS}
            whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Image {...pixelIcon('studio', '/desktopicons/creation-launchpad.png')} alt="Studio" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" style={{ imageRendering: 'pixelated' }} />
          </motion.div>
          <motion.span
            className="mt-2 text-center text-xs uppercase text-white"
            style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
            whileHover={{ color: 'rgb(244, 114, 182)', textShadow: '0 0 10px rgba(244, 114, 182, 0.7)' }}
            transition={{ duration: 0.2 }}
          >
            Studio
          </motion.span>
        </motion.div>

        {/* Notes */}
        {isFeatureEnabled('notes', supportedFeatures) && (
          <motion.div
            className="flex cursor-pointer flex-col items-center"
            onClick={() => openDesktopApp('notepad')}
            whileHover={{ y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <motion.div
              className={DESKTOP_ICON_FRAME_CLASS}
              whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <Image {...pixelIcon('notes', '/desktopicons/notepad.png')} alt="Notepad" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" style={{ imageRendering: 'pixelated' }} />
            </motion.div>
            <motion.span
              className="mt-2 text-center text-xs uppercase text-white"
              style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
              whileHover={{ color: 'rgb(253, 230, 138)', textShadow: '0 0 10px rgba(253, 230, 138, 0.5)' }}
              transition={{ duration: 0.2 }}
            >
              Notes
            </motion.span>
          </motion.div>
        )}

        {/* Our PearlOS */}
        <motion.div
          className="flex cursor-pointer flex-col items-center"
          onClick={() => openDesktopApp('our-pearlos')}
          whileHover={{ y: -8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <motion.div
            className={DESKTOP_ICON_FRAME_CLASS}
            whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Image {...pixelIcon('our-pearlos', '/icons/pearl-clam.svg')} alt="Our PearlOS" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" style={{ imageRendering: 'pixelated' }} />
          </motion.div>
          <motion.span
            className="mt-2 text-center text-xs uppercase text-white"
            style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
            whileHover={{ color: 'rgb(125, 211, 252)', textShadow: '0 0 10px rgba(125, 211, 252, 0.6)' }}
            transition={{ duration: 0.2 }}
          >
            Our PearlOS
          </motion.span>
        </motion.div>

        {/* Pearl Vision */}
        {isFeatureEnabled('dailyCall', supportedFeatures) && isFeatureEnabled('vision', supportedFeatures) && (
          <motion.div
            className="flex cursor-pointer flex-col items-center"
            onClick={() => openDesktopApp('pearl-vision')}
            whileHover={{ y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <motion.div
              className={DESKTOP_ICON_FRAME_CLASS}
              whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <Image {...pixelIcon('pearl-vision', '/desktopicons/pearl-vision.png')} alt="Pearl Vision" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" style={{ imageRendering: 'pixelated' }} />
            </motion.div>
            <motion.span
              className="mt-2 text-center text-xs uppercase text-white"
              style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
              whileHover={{ color: 'rgb(165,180,252)', textShadow: '0 0 10px rgba(165,180,252,0.5)' }}
              transition={{ duration: 0.2 }}
            >
              Pearl Vision
            </motion.span>
          </motion.div>
        )}

        {/* Discord */}
        {(
          <motion.div
            className="flex cursor-pointer flex-col items-center"
            onClick={() => openDesktopApp('discord')}
            style={isMobile ? { transform: 'translateY(-8px)' } : undefined}
            whileHover={{ y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <motion.div
              className={DESKTOP_ICON_FRAME_CLASS}
              whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <Image {...pixelIcon('discord', '/desktopicons/discord.png')} alt="Pearl Village" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" style={{ imageRendering: 'pixelated' }} />
            </motion.div>
            <motion.span
              className="mt-2 text-center text-xs uppercase text-white"
              style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
              whileHover={{ color: 'rgb(88, 101, 242)', textShadow: '0 0 10px rgba(88, 101, 242, 0.7)' }}
              transition={{ duration: 0.2 }}
            >
              Pearl Village
            </motion.span>
          </motion.div>
        )}

        {/* Weather */}
        <motion.div
          className="flex cursor-pointer flex-col items-center"
          onClick={() => openDesktopApp('weather')}
          whileHover={{ y: -8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <motion.div
            className={DESKTOP_ICON_FRAME_CLASS}
            whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Image {...pixelIcon('weather', '/desktopicons/weather.png')} alt="Weather" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" style={{ imageRendering: 'pixelated' }} />
          </motion.div>
          <motion.span
            className="mt-2 text-center text-xs uppercase text-white"
            style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
            whileHover={{ color: 'rgb(251, 191, 36)', textShadow: '0 0 10px rgba(251, 191, 36, 0.5)' }}
            transition={{ duration: 0.2 }}
          >
            Weather
          </motion.span>
        </motion.div>

        {/* YouTube */}
        {isFeatureEnabled('youtube', supportedFeatures) && (
          <motion.div
            className="flex cursor-pointer flex-col items-center"
            onClick={() => openDesktopApp('youtube')}
            whileHover={{ y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <motion.div
              className={DESKTOP_ICON_FRAME_CLASS}
              whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <Image {...pixelIcon('youtube', '/desktopicons/youtube.png')} alt="YouTube" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" style={{ imageRendering: 'pixelated' }} />
            </motion.div>
            <motion.span
              className="mt-2 text-center text-xs uppercase text-white"
              style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
              whileHover={{ color: 'rgb(252, 165, 165)', textShadow: '0 0 10px rgba(252, 165, 165, 0.5)' }}
              transition={{ duration: 0.2 }}
            >
              YouTube
            </motion.span>
          </motion.div>
        )}

        {/* The News */}
        <motion.div
          className="flex cursor-pointer flex-col items-center"
          onClick={() => openDesktopApp('news')}
          whileHover={{ y: -8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <motion.div
            className={DESKTOP_ICON_FRAME_CLASS}
            whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Image {...pixelIcon('news', '/desktopicons/news.png')} alt="The News" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" style={{ imageRendering: 'pixelated' }} />
          </motion.div>
          <motion.span
            className="mt-2 text-center text-xs uppercase text-white"
            style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
            whileHover={{ color: 'rgb(56, 189, 248)', textShadow: '0 0 10px rgba(56, 189, 248, 0.5)' }}
            transition={{ duration: 0.2 }}
          >
            The News
          </motion.span>
        </motion.div>

        {/* FileSpace */}
        <motion.div
          className="flex cursor-pointer flex-col items-center"
          onClick={() => openDesktopApp('files')}
          whileHover={{ y: -8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <motion.div
            className={DESKTOP_ICON_FRAME_CLASS}
            whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Image {...pixelIcon('files', '/desktopicons/files.png')} alt="FileSpace" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" style={{ imageRendering: 'pixelated' }} />
          </motion.div>
          <motion.span
            className="mt-2 text-center text-xs uppercase text-white"
            style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
            whileHover={{ color: 'rgb(96, 165, 250)', textShadow: '0 0 10px rgba(96, 165, 250, 0.5)' }}
            transition={{ duration: 0.2 }}
          >
            FileSpace
          </motion.span>
        </motion.div>

        {/* Terminal */}
        <motion.div
          className="flex cursor-pointer flex-col items-center"
          onClick={() => openDesktopApp('terminal')}
          whileHover={{ y: -8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <motion.div
            className={DESKTOP_ICON_FRAME_CLASS}
            whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Image {...pixelIcon('terminal', '/desktopicons/Terminal.png')} alt="Terminal" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" style={{ imageRendering: 'pixelated' }} />
          </motion.div>
          <motion.span
            className="mt-2 text-center text-xs uppercase text-white"
            style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
            whileHover={{ color: 'rgb(74, 222, 128)', textShadow: '0 0 10px rgba(74, 222, 128, 0.5)' }}
            transition={{ duration: 0.2 }}
          >
            Terminal
          </motion.span>
        </motion.div>

        {/* Styles */}
        <motion.div
          className="flex cursor-pointer flex-col items-center"
          onClick={() => openDesktopApp('styles')}
          whileHover={{ y: -8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <motion.div
            className={DESKTOP_ICON_FRAME_CLASS}
            whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Image {...pixelIcon('styles', '/ThemeIco.png')} alt="Styles" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" style={{ imageRendering: 'pixelated' }} />
          </motion.div>
          <motion.span
            className="mt-2 text-center text-xs uppercase text-white"
            style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
            whileHover={{ color: 'rgb(52, 211, 153)', textShadow: '0 0 10px rgba(52, 211, 153, 0.55)' }}
            transition={{ duration: 0.2 }}
          >
            Styles
          </motion.span>
        </motion.div>

        {/* Settings */}
        <motion.div
          className="flex cursor-pointer flex-col items-center"
          onClick={() => openDesktopApp('settings')}
          whileHover={{ y: -8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <motion.div
            className={DESKTOP_ICON_FRAME_CLASS}
            whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Image {...pixelIcon('settings', '/pixel-ui/icons/settings.png')} alt="Settings" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" style={{ imageRendering: 'pixelated' }} />
          </motion.div>
          <motion.span
            className="mt-2 text-center text-xs uppercase text-white"
            style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
            whileHover={{ color: 'rgb(203, 213, 225)', textShadow: '0 0 10px rgba(203, 213, 225, 0.5)' }}
            transition={{ duration: 0.2 }}
          >
            Settings
          </motion.span>
        </motion.div>

        {/* User-added Studio / Our PearlOS shortcuts */}
        {desktopShortcuts.map((shortcut) => (
          <motion.div
            key={shortcut.id}
            className="flex cursor-pointer flex-col items-center"
            onClick={() => openPersonalShortcut(shortcut)}
            whileHover={{ y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <motion.div
              className="flex h-16 w-16 items-center justify-center"
              whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              {shortcut.iconSrc ? (
                <Image
                  src={shortcut.iconSrc}
                  alt={shortcut.title}
                  width={ICON_SIZE}
                  height={ICON_SIZE}
                  className="object-contain"
                  style={{ imageRendering: shortcut.iconSrc.includes('/pixel-ui/') ? 'pixelated' : 'auto' }}
                  unoptimized={shouldBypassNextImageOptimization(shortcut.iconSrc)}
                />
              ) : (
                <span className="text-[42px] leading-none drop-shadow-[0_5px_10px_rgba(0,0,0,0.5)]">
                  {shortcut.emoji || '✨'}
                </span>
              )}
            </motion.div>
            <motion.span
              className="mt-1 w-20 truncate text-center text-xs uppercase text-white"
              style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
              whileHover={{ color: 'rgb(145, 230, 172)', textShadow: '0 0 10px rgba(145, 230, 172, 0.5)' }}
              transition={{ duration: 0.2 }}
              title={shortcut.title}
            >
              {shortcut.title}
            </motion.span>
          </motion.div>
        ))}

        {/* Applet Shelf — always visible when available */}
        {canUseAppletFolder && appletCount > 3 && (
          <motion.button
            type="button"
            className="flex flex-col items-center focus:outline-none"
            onClick={() => setIsAppletFolderOpen(true)}
            whileHover={{ y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            aria-label="Open Applet Shelf"
          >
            <motion.div
              className="relative flex h-16 w-16 items-center justify-center"
              whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <Image src="/appletshelf.png" alt="Applet Shelf" width={64} height={64} className="object-contain drop-shadow-[0_5px_10px_rgba(0,0,0,0.5)]" />
            </motion.div>
            <motion.span
              className="mt-2 text-center text-xs uppercase text-white"
              style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
              whileHover={{ color: 'rgb(253, 224, 71)', textShadow: '0 0 10px rgba(253, 224, 71, 0.5)' }}
              transition={{ duration: 0.2 }}
            >
              Applet Shelf
            </motion.span>
          </motion.button>
        )}

        {/* Recent applets inline — below other icons in the same column */}
        {canUseAppletFolder && appletCount > 0 && recentApplets.map(applet => {
          const visuals = getAppletVisuals(applet);
          const displayTitle =
            applet.title && applet.title.trim().length > 0 ? applet.title : 'Untitled Applet';
          return (
            <motion.div key={applet.page_id} className="flex flex-col items-center" whileHover={{ y: -8 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
              <motion.button
                type="button"
                className="inline-flex h-16 w-16 items-center justify-center p-0 m-0 focus:outline-none drop-shadow-[0_5px_10px_rgba(0,0,0,0.5)]"
                onClick={() => handleOpenAppletFromFolder(applet.page_id)}
                whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                aria-label={displayTitle}
              >
                {visuals.isImage ? (
                  <Image src={visuals.icon} alt={displayTitle} width={64} height={64} className="object-contain" />
                ) : (
                  <span className="text-[42px] leading-none">{visuals.icon}</span>
                )}
              </motion.button>
              <motion.span
                className="mt-1 w-20 truncate text-center text-xs uppercase text-white"
                style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
                whileHover={{ color: 'rgb(226,232,240)', textShadow: '0 0 10px rgba(226,232,240,0.5)' }}
                transition={{ duration: 0.2 }}
                title={displayTitle}
              >
                {displayTitle}
              </motion.span>
            </motion.div>
          );
        })}
      </motion.div>

      {comingSoonApp && isMounted && createPortal(
        <div
          className="pointer-events-auto fixed inset-0 flex items-center justify-center p-4"
          style={{ zIndex: 640, fontFamily: 'Gohufont, monospace' }}
        >
          <div
            className="absolute inset-0 bg-slate-950/70"
            onClick={() => setComingSoonApp(null)}
            style={{ backdropFilter: 'blur(3px)' }}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="relative z-[1] w-full max-w-[680px] rounded-[28px] border border-sky-200/20 bg-gradient-to-b from-[#0B1837]/95 via-[#0A1733]/95 to-[#08122A]/95 p-6 text-white shadow-[0_40px_120px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:p-7"
          >
            <div className="pointer-events-none absolute inset-0 rounded-[28px] border border-white/10" />
            <div
              className="pointer-events-none absolute left-1/2 top-16 h-36 w-36 -translate-x-1/2 rounded-full bg-sky-400/20 blur-3xl"
              aria-hidden="true"
            />
            <button
              type="button"
              className="absolute right-3 top-3 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/80 transition hover:border-white/40 hover:bg-white/15 hover:text-white active:scale-95"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setComingSoonApp(null);
              }}
              aria-label="Close coming soon popup"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="relative flex flex-col items-center gap-3 pt-6">
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Image
                  src={comingSoonPlaceholderByApp[comingSoonApp].src}
                  alt={comingSoonPlaceholderByApp[comingSoonApp].alt}
                  width={620}
                  height={620}
                  className="h-auto w-auto max-h-[400px] max-w-full object-contain drop-shadow-[0_18px_36px_rgba(7,16,40,0.65)] sm:max-h-[430px]"
                  priority
                />
              </motion.div>
              <p
                className="text-center text-2xl uppercase text-white tracking-[1.8px] sm:text-[28px]"
                style={{ fontFamily: 'Gohufont, monospace' }}
              >
                Coming Soon
              </p>
            </div>
          </motion.div>
        </div>,
        document.body
      )}

      {isAppletFolderOpen && isMounted && createPortal(
        (
          <div 
            className="pointer-events-auto fixed inset-0 flex items-center justify-center overflow-hidden p-4" 
            style={{ 
              fontFamily: 'Gohufont, monospace', 
              zIndex: 650,
              isolation: 'isolate'
            }}
          >
            <div 
              className="absolute inset-0 bg-slate-950/60" 
              onClick={() => setIsAppletFolderOpen(false)}
              style={{ zIndex: 650 }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="relative w-full max-w-[min(900px,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] rounded-3xl border border-white/20 bg-gradient-to-b from-slate-900/98 via-slate-900/95 to-slate-950/98 p-4 text-white shadow-[0_40px_140px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:p-6"
              style={{ zIndex: 700, isolation: 'isolate' }}
            >
            {/* Top right buttons - Refresh and Close */}
            <div className="absolute right-3 top-4 z-10 flex items-center gap-1.5 sm:right-5 sm:top-6 sm:gap-2">
              <motion.button
                type="button"
                className="flex h-8 items-center justify-center whitespace-nowrap rounded-lg border border-white/20 bg-white/5 px-2 text-[10px] font-medium uppercase tracking-tight text-white/80 backdrop-blur-sm transition-all duration-200 hover:border-white/40 hover:bg-white/10 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed sm:h-9 sm:px-2.5 sm:text-xs"
                onClick={() => refreshFolderApplets()}
                disabled={folderLoading}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {folderLoading ? 'Refreshing...' : 'Refresh'}
              </motion.button>
              <motion.button
                type="button"
                className="flex h-8 items-center justify-center rounded-lg border border-white/20 bg-white/5 p-2 transition-all duration-200 hover:border-white/40 hover:bg-white/10 sm:h-9 sm:p-2.5"
                onClick={() => setIsAppletFolderOpen(false)}
                aria-label="Close applet folder"
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
              >
                <X className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </motion.button>
            </div>

            {/* Header */}
            <div className="mb-4 flex flex-col gap-3 pr-20 sm:mb-6 sm:pr-24">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="relative flex h-9 w-9 shrink-0 items-center justify-center sm:h-10 sm:w-10">
                  <Image src="/appletshelf.png" alt="Applet Shelf" width={36} height={36} className="object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.3)] sm:w-10 sm:h-10" />
                </div>
                <div>
                  <p className="mb-0.5 text-[10px] font-medium uppercase tracking-[0.15em] text-white/50 sm:mb-1 sm:text-xs sm:tracking-[0.2em]">Applet Shelf</p>
                  <p className="text-base font-bold tracking-normal text-white sm:text-lg">Pick an applet</p>
                </div>
              </div>
            </div>

            {/* Content area */}
            <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto pr-1 sm:max-h-[calc(88dvh-140px)] sm:pr-2 applet-shelf-scroll">
              {folderLoading && (
                <div className="flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-6 py-8 backdrop-blur-sm">
                  <span className="h-3 w-3 animate-ping rounded-full bg-white/70" />
                  <span className="text-sm font-medium uppercase tracking-wider text-white/70">Loading applets…</span>
                </div>
              )}
              {folderError && !folderLoading && (
                <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-6 py-6 text-sm text-red-200 backdrop-blur-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-red-400">⚠️</span>
                    <span>{folderError}</span>
                  </div>
                </div>
              )}
              {!folderLoading && !folderError && folderApplets.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-8 py-16 text-center backdrop-blur-sm">
                  <p className="mb-2 text-base font-semibold text-white/80">No applets yet</p>
                  <p className="mb-6 text-sm text-white/50">Generate something in Creation Studio!</p>
                  <div className="flex justify-center gap-3 text-2xl">
                    {folderSampleIcons.map(icon => (
                      <motion.span
                        key={icon}
                        animate={{ y: [0, -8, 0] }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          delay: folderSampleIcons.indexOf(icon) * 0.2,
                        }}
                      >
                        {icon}
                      </motion.span>
                    ))}
                  </div>
                </div>
              )}
              {!folderLoading && !folderError && folderApplets.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
                  {folderApplets.map(applet => {
                    // Priority: 1) If shared, show who shared it, 2) Show actual owner, 3) Fallback to current user
                    let ownerLabelRaw: string | undefined;
                    
                    if (applet.sharedVia) {
                      // Applet is shared - show the person who shared it
                      ownerLabelRaw =
                        applet.sharedVia.ownerName ||
                        applet.sharedVia.owner?.name ||
                        applet.sharedVia.ownerEmail ||
                        applet.sharedVia.owner?.email;
                    }
                    
                    // If not shared or no sharer info, show the actual owner
                    if (!ownerLabelRaw) {
                      ownerLabelRaw =
                        applet.ownerName ||
                        applet.ownerEmail;
                    }
                    
                    // Final fallback to current user
                    if (!ownerLabelRaw) {
                      ownerLabelRaw =
                        (session?.user?.name as string | undefined) ||
                        defaultOwnerEmail;
                    }
                    
                    const ownerLabel =
                      ownerLabelRaw && ownerLabelRaw.includes('@')
                        ? ownerLabelRaw.split('@')[0]
                        : ownerLabelRaw;
                    const visuals = getAppletVisuals(applet);
                    const displayTitle =
                      applet.title && applet.title.trim().length > 0 ? applet.title : 'Untitled Applet';
                    return (
                      <motion.button
                        key={applet.page_id}
                        type="button"
                        onClick={() => handleOpenAppletFromFolder(applet.page_id)}
                        className="group relative flex h-full min-h-[80px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.08] via-white/[0.05] to-white/[0.02] p-2 text-left backdrop-blur-sm transition-all duration-300 hover:border-white/30 hover:from-white/[0.12] hover:via-white/[0.08] hover:to-white/[0.04] hover:shadow-[0_10px_24px_rgba(0,0,0,0.45)] focus:outline-none focus:ring-2 focus:ring-white/20 sm:min-h-[100px] sm:p-2.5"
                        whileHover={{ y: -4, scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18 }}
                      >
                        {/* Subtle glow effect on hover */}
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/0 via-white/0 to-white/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-hover:from-white/[0.05] group-hover:via-white/[0.03] group-hover:to-white/[0.01]" />

                        {/* Content */}
                        <div className="relative z-10 flex flex-1 flex-col gap-1">
                          {/* Top section - Icon and Title inline, top-left aligned */}
                          <div className="flex items-start gap-1.5 sm:gap-2">
                            {visuals.isImage ? (
                              <div className="flex-shrink-0 self-start transition-transform duration-300 group-hover:scale-110 group-hover:rotate-2">
                                <Image src={visuals.icon} alt={displayTitle} width={20} height={20} className="object-contain sm:w-5 sm:h-5" />
                              </div>
                            ) : (
                              <span className="flex-shrink-0 self-start text-sm sm:text-base transition-transform duration-300 group-hover:scale-110 group-hover:rotate-2">{visuals.icon}</span>
                            )}
                            <h3
                              className="flex-1 text-[12px] font-semibold leading-tight tracking-tight text-white transition-colors duration-200 group-hover:text-white/95 sm:text-[13px]"
                              style={{
                                wordBreak: 'break-word',
                                hyphens: 'auto',
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {displayTitle}
                            </h3>
                          </div>

                          {/* Bottom section - Owner label */}
                          {ownerLabel && (
                            <div className="mt-auto flex items-center gap-1 justify-start pt-1 border-t border-white/10">
                              {applet.sharedVia && (
                                <Users className="h-2.5 w-2.5 text-green-400/70 transition-colors duration-200 group-hover:text-green-400/90 sm:h-3 sm:w-3" />
                              )}
                              <p className="text-[9px] font-medium text-white/40 transition-colors duration-200 group-hover:text-white/50 sm:text-[10px]">
                                {ownerLabel}
                              </p>
                            </div>
                          )}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </div>
        ),
        document.body
      )}
      <style jsx>{`
        .applet-shelf-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(100, 116, 139, 0.7) transparent;
        }
        .applet-shelf-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .applet-shelf-scroll::-webkit-scrollbar-track {
          background: transparent;
          border-radius: 999px;
        }
        .applet-shelf-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, rgba(148, 163, 184, 0.8), rgba(71, 85, 105, 0.8));
          border-radius: 999px;
        }
        .applet-shelf-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, rgba(226, 232, 240, 0.9), rgba(148, 163, 184, 0.9));
        }
      `}</style>
    </div>
  );
};

export default DesktopBackgroundWork;
