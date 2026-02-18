'use client';

import { isFeatureEnabled } from '@nia/features';
import { motion } from 'framer-motion';
import { Users, X } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { NIA_EVENT_APPLET_OPEN, NIA_EVENT_APPLET_UPDATED, NIA_EVENT_HTML_CREATED } from '@interface/features/DailyCall/events/niaEventRouter';
import { NIA_EVENT_WONDER_SCENE } from '@interface/features/Stage/WonderCanvas/WonderCanvasRenderer';
import { useHtmlApplets } from '@interface/features/HtmlGeneration/hooks/use-html-applets';
import type { HtmlAppletListItem } from '@interface/features/HtmlGeneration/hooks/use-html-applets';
import { requestWindowOpen } from '@interface/features/ManeuverableWindow/lib/windowLifecycleController';
import { useUI } from '@interface/contexts/ui-context';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { useIsMobile } from '@interface/hooks/use-is-mobile';
import { trackSessionHistory } from '@interface/lib/session-history';

// ── Wonder Canvas helpers ────────────────────────────────────────────

function closeButtonHTML(): string {
  return `<button onclick="window.parent.postMessage({type:'wonder.interaction',action:'close',label:'Close scene'},'*')"
  style="position:fixed;top:16px;right:16px;z-index:9999;display:flex;align-items:center;gap:6px;
  background:rgba(15,8,32,0.7);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  border:1px solid rgba(255,255,255,0.15);border-radius:100px;padding:8px 16px;
  color:#d4c0e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s ease;letter-spacing:0.03em;"
  onmouseover="this.style.background='rgba(15,8,32,0.9)';this.style.borderColor='rgba(255,211,51,0.4)';this.style.color='#FFD233'"
  onmouseout="this.style.background='rgba(15,8,32,0.7)';this.style.borderColor='rgba(255,255,255,0.15)';this.style.color='#d4c0e8'"
  >✕ Close</button>`;
}

function dispatchWonderScene(html: string): void {
  window.dispatchEvent(
    new CustomEvent(NIA_EVENT_WONDER_SCENE, {
      detail: { payload: { html, layer: 'main', transition: 'fade' } },
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
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;background:linear-gradient(160deg,#0f0820 0%,#1a0e2e 60%,#0f0820 100%);color:#faf8f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}</style>
</head><body>
${closeButtonHTML()}
<div style="text-align:center;display:flex;flex-direction:column;align-items:center;gap:20px;padding:40px;">
  <div style="font-size:clamp(48px,14vw,72px);animation:pulse 2s ease infinite;">🌤️</div>
  <div style="font-size:clamp(16px,4.5vw,22px);color:#FFD233;font-weight:600;">Fetching weather...</div>
  <div style="width:36px;height:36px;border:3px solid rgba(255,211,51,.2);border-top-color:#FFD233;border-radius:50%;animation:spin 1s linear infinite;"></div>
  <div style="font-size:clamp(12px,2.8vw,14px);color:#9a80b0;">Connecting to weather service</div>
</div>
</body></html>`;
}

function buildWeatherErrorHTML(): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;background:linear-gradient(160deg,#0f0820 0%,#1a0e2e 60%,#0f0820 100%);color:#faf8f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;}</style>
</head><body>
${closeButtonHTML()}
<div style="text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px;max-width:380px;margin:0 auto;">
  <div style="font-size:clamp(48px,12vw,64px);">⛅</div>
  <div style="font-size:clamp(16px,4.5vw,20px);color:#E85D26;font-weight:600;">Weather unavailable</div>
  <div style="font-size:clamp(13px,3vw,15px);color:#9a80b0;line-height:1.6;">Couldn't load weather data right now. Try asking Pearl — she can check for you!</div>
  <div style="background:rgba(232,93,38,.12);border:1px solid rgba(232,93,38,.25);border-radius:16px;padding:14px 20px;font-size:clamp(13px,3.2vw,15px);color:#d4c0e8;margin-top:8px;">💬 "Pearl, what's the weather?"</div>
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
    const feelsLikeC = String(current.FeelsLikeC ?? '--');
    const humidity = String(current.humidity ?? '--');
    const windKmph = String(current.windspeedKmph ?? '--');
    const desc = String(current.weatherDesc?.[0]?.value ?? 'Unknown');
    const emoji = weatherEmoji(desc);

    const nearestArea = d.nearest_area?.[0] ?? {};
    const city = String(nearestArea.areaName?.[0]?.value ?? '');
    const country = String(nearestArea.country?.[0]?.value ?? '');
    const location = [city, country].filter(Boolean).join(', ') || 'Your Location';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forecastRows = (d.weather ?? []).slice(0, 3).map((day: any) => {
      const maxC = String(day.maxtempC ?? '--');
      const minC = String(day.mintempC ?? '--');
      const dateStr = String(day.date ?? '');
      const hourly = day.hourly ?? [];
      const midDesc = String((hourly[4]?.weatherDesc ?? hourly[0]?.weatherDesc)?.[0]?.value ?? desc);
      const fe = weatherEmoji(midDesc);
      const dateObj = dateStr ? new Date(`${dateStr}T12:00:00`) : null;
      const dayName = dateObj ? dateObj.toLocaleDateString('en-US', { weekday: 'short' }) : '—';
      return `<div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:clamp(10px,3vw,16px);text-align:center;flex:1;min-width:0;">
  <div style="font-size:clamp(11px,2.5vw,13px);color:#9a80b0;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">${dayName}</div>
  <div style="font-size:clamp(22px,6vw,28px);margin-bottom:4px;">${fe}</div>
  <div style="font-size:clamp(12px,3vw,14px);font-weight:600;color:#faf8f5;">${maxC}°<span style="color:#9a80b0;font-weight:400;">/${minC}°</span></div>
</div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow-y:auto;background:linear-gradient(160deg,#0f0820 0%,#1a0e2e 60%,#0f0820 100%);color:#faf8f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
@keyframes fadeSlide{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.c{animation:fadeSlide .5s ease forwards}
</style></head><body>
${closeButtonHTML()}
<div style="min-height:100vh;display:flex;flex-direction:column;align-items:stretch;padding:clamp(16px,5vw,32px);gap:clamp(12px,3vw,20px);">
  <div class="c" style="animation-delay:.0s;opacity:0;text-align:center;padding-top:clamp(8px,2vw,16px);">
    <div style="font-size:clamp(11px,2.5vw,13px);letter-spacing:.15em;text-transform:uppercase;color:#9a80b0;">📍 ${location}</div>
  </div>
  <div class="c" style="animation-delay:.1s;opacity:0;background:rgba(255,255,255,0.06);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,211,51,0.2);border-radius:24px;padding:clamp(20px,5vw,32px);text-align:center;">
    <div style="font-size:clamp(60px,16vw,88px);line-height:1;margin-bottom:clamp(8px,2vw,14px);">${emoji}</div>
    <div style="font-size:clamp(44px,13vw,72px);font-weight:700;line-height:1;color:#FFD233;text-shadow:0 0 40px rgba(255,210,51,.4);">${tempC}°<span style="font-size:clamp(18px,4vw,24px);color:#9a80b0;font-weight:400;">C</span></div>
    <div style="font-size:clamp(14px,3.5vw,18px);color:#d4c0e8;margin-top:8px;">${desc}</div>
    <div style="font-size:clamp(12px,2.8vw,14px);color:#9a80b0;margin-top:4px;">Feels like ${feelsLikeC}°C</div>
  </div>
  <div class="c" style="animation-delay:.2s;opacity:0;display:flex;flex-direction:row;gap:clamp(8px,2vw,12px);">
    <div style="flex:1;background:rgba(232,93,38,.12);border:1px solid rgba(232,93,38,.25);border-radius:16px;padding:clamp(12px,3vw,16px);text-align:center;">
      <div style="font-size:clamp(18px,5vw,24px);margin-bottom:4px;">💧</div>
      <div style="font-size:clamp(16px,4.5vw,20px);font-weight:600;">${humidity}%</div>
      <div style="font-size:clamp(10px,2.2vw,12px);color:#9a80b0;text-transform:uppercase;letter-spacing:.08em;margin-top:2px;">Humidity</div>
    </div>
    <div style="flex:1;background:rgba(123,63,142,.12);border:1px solid rgba(123,63,142,.25);border-radius:16px;padding:clamp(12px,3vw,16px);text-align:center;">
      <div style="font-size:clamp(18px,5vw,24px);margin-bottom:4px;">💨</div>
      <div style="font-size:clamp(16px,4.5vw,20px);font-weight:600;">${windKmph}</div>
      <div style="font-size:clamp(10px,2.2vw,12px);color:#9a80b0;text-transform:uppercase;letter-spacing:.08em;margin-top:2px;">km/h Wind</div>
    </div>
    <div style="flex:1;background:rgba(217,79,142,.12);border:1px solid rgba(217,79,142,.25);border-radius:16px;padding:clamp(12px,3vw,16px);text-align:center;">
      <div style="font-size:clamp(18px,5vw,24px);margin-bottom:4px;">🌡️</div>
      <div style="font-size:clamp(16px,4.5vw,20px);font-weight:600;">${tempF}°F</div>
      <div style="font-size:clamp(10px,2.2vw,12px);color:#9a80b0;text-transform:uppercase;letter-spacing:.08em;margin-top:2px;">Fahrenheit</div>
    </div>
  </div>
  <div class="c" style="animation-delay:.3s;opacity:0;">
    <div style="font-size:clamp(11px,2.5vw,13px);letter-spacing:.15em;text-transform:uppercase;color:#9a80b0;margin-bottom:clamp(8px,2vw,12px);">3-Day Forecast</div>
    <div style="display:flex;flex-direction:row;gap:clamp(8px,2vw,12px);">${forecastRows}</div>
  </div>
  <div class="c" style="animation-delay:.4s;opacity:0;text-align:center;padding-bottom:clamp(8px,2vw,16px);">
    <div style="font-size:clamp(10px,2vw,12px);color:rgba(154,128,176,.5);">Data from wttr.in · Ask Pearl for details</div>
  </div>
</div>
</body></html>`;
  } catch {
    return buildWeatherErrorHTML();
  }
}

function buildNewsHTML(): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow-y:auto;background:linear-gradient(160deg,#0f0820 0%,#2a1845 50%,#0f0820 100%);color:#faf8f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;}
@keyframes fadeSlide{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:1;transform:scale(1.05)}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
.c{animation:fadeSlide .5s ease forwards;opacity:0}
.sk{background:linear-gradient(90deg,rgba(255,255,255,.06) 25%,rgba(255,255,255,.12) 50%,rgba(255,255,255,.06) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:8px;}
.wrap{min-height:100vh;display:flex;flex-direction:column;padding:clamp(16px,5vw,32px);gap:clamp(12px,3vw,20px);}
.card{background:rgba(255,255,255,.05);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.1);border-radius:20px;overflow:hidden;cursor:pointer;transition:transform .2s ease,border-color .2s ease;}
.card:hover{transform:translateY(-2px);border-color:rgba(255,211,51,.3);}
.card-img{width:100%;aspect-ratio:16/9;object-fit:cover;background:rgba(255,255,255,.04);}
.card-body{padding:clamp(14px,3.5vw,20px);}
.card-source{display:inline-flex;align-items:center;gap:5px;font-size:clamp(10px,2.2vw,11px);letter-spacing:.1em;text-transform:uppercase;color:#D94F8E;font-weight:600;margin-bottom:8px;}
.card-source::before{content:'';width:5px;height:5px;border-radius:50%;background:#D94F8E;}
.card-title{font-size:clamp(15px,4vw,18px);font-weight:700;line-height:1.35;margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
.card-excerpt{font-size:clamp(12px,2.8vw,14px);color:#9a80b0;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:8px;}
.card-time{font-size:clamp(10px,2vw,11px);color:rgba(154,128,176,.6);}
.featured .card-title{font-size:clamp(18px,5vw,24px);}
.skel-card{display:flex;flex-direction:column;gap:10px;padding:16px;}
a{color:inherit;text-decoration:none;}
</style>
</head><body>
${closeButtonHTML()}
<div class="wrap" id="root">
  <div class="c" style="text-align:center;padding-top:clamp(4px,1vw,12px);">
    <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(217,79,142,.15);border:1px solid rgba(217,79,142,.3);border-radius:100px;padding:6px 16px;font-size:clamp(10px,2.2vw,12px);letter-spacing:.12em;text-transform:uppercase;color:#D94F8E;">
      <span style="width:6px;height:6px;border-radius:50%;background:#D94F8E;animation:pulse 1.5s ease infinite;display:inline-block;"></span>
      Live News
    </div>
  </div>
  <div id="cards">
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div class="card" style="opacity:.5"><div class="skel-card"><div class="sk" style="height:10px;width:20%;"></div><div class="sk" style="height:18px;width:85%;"></div><div class="sk" style="height:12px;width:55%;"></div></div></div>
      <div class="card" style="opacity:.5"><div class="skel-card"><div class="sk" style="height:10px;width:25%;"></div><div class="sk" style="height:18px;width:75%;"></div><div class="sk" style="height:12px;width:60%;"></div></div></div>
      <div class="card" style="opacity:.5"><div class="skel-card"><div class="sk" style="height:10px;width:18%;"></div><div class="sk" style="height:18px;width:90%;"></div><div class="sk" style="height:12px;width:48%;"></div></div></div>
    </div>
  </div>
  <div style="text-align:center;padding-bottom:clamp(8px,2vw,16px);">
    <div style="font-size:clamp(10px,2vw,12px);color:rgba(154,128,176,.5);" id="footer">Loading headlines…</div>
  </div>
</div>
<script>
(function(){
  var FEEDS = [
    {url:'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',name:'NY Times'},
    {url:'https://feeds.bbci.co.uk/news/rss.xml',name:'BBC News'},
    {url:'https://feeds.reuters.com/reuters/topNews',name:'Reuters'},
    {url:'https://rss.cnn.com/rss/edition.rss',name:'CNN'},
    {url:'https://feeds.arstechnica.com/arstechnica/index',name:'Ars Technica'}
  ];
  var PROXIES = ['https://corsproxy.io/?','https://api.allorigins.win/raw?url='];

  function fetchWithTimeout(url, ms){
    var c = new AbortController();
    var t = setTimeout(function(){c.abort()}, ms);
    return fetch(url,{signal:c.signal}).finally(function(){clearTimeout(t)});
  }

  function fetchViaProxy(feedUrl){
    function tryProxy(i){
      if(i>=PROXIES.length) return Promise.reject(new Error('all proxies failed'));
      return fetchWithTimeout(PROXIES[i]+encodeURIComponent(feedUrl),5000)
        .then(function(r){if(!r.ok)throw new Error();return r.text();})
        .catch(function(){return tryProxy(i+1);});
    }
    return tryProxy(0);
  }

  function timeAgo(d){
    var s=Math.floor((Date.now()-d.getTime())/1000);
    if(s<60)return 'just now';
    if(s<3600)return Math.floor(s/60)+'m ago';
    if(s<86400)return Math.floor(s/3600)+'h ago';
    return Math.floor(s/86400)+'d ago';
  }

  function extractImg(item){
    // Try media:content, enclosure, or img in description
    var mc=item.getElementsByTagName('media:content')[0]||item.getElementsByTagName('media:thumbnail')[0];
    if(mc&&mc.getAttribute('url'))return mc.getAttribute('url');
    var enc=item.getElementsByTagName('enclosure')[0];
    if(enc&&enc.getAttribute('url')&&(enc.getAttribute('type')||'').indexOf('image')>=0)return enc.getAttribute('url');
    var desc=(item.getElementsByTagName('description')[0]||{}).textContent||'';
    var m=desc.match(/<img[^>]+src=["']([^"']+)/);
    if(m)return m[1];
    return '';
  }

  function textOf(item,tag){return (item.getElementsByTagName(tag)[0]||{}).textContent||'';}

  function stripHtml(s){var d=document.createElement('div');d.innerHTML=s;return d.textContent||'';}

  function parseFeed(xml,srcName){
    var items=xml.querySelectorAll('item');
    var out=[];
    for(var i=0;i<items.length&&i<6;i++){
      var it=items[i];
      var title=textOf(it,'title');
      var link=textOf(it,'link');
      var desc=stripHtml(textOf(it,'description')).substring(0,200);
      var pub=textOf(it,'pubDate');
      var img=extractImg(it);
      if(title) out.push({title:title,link:link,desc:desc,date:pub?new Date(pub):new Date(),img:img,source:srcName});
    }
    return out;
  }

  var allItems=[];
  var done=0;

  function render(){
    allItems.sort(function(a,b){return b.date-a.date;});
    var top=allItems.slice(0,12);
    if(!top.length){
      document.getElementById('cards').innerHTML='<div style="text-align:center;padding:40px 20px;"><div style="font-size:48px;margin-bottom:16px;">📰</div><div style="color:#d4c0e8;font-size:16px;font-weight:600;margin-bottom:8px;">News feeds unavailable</div><div style="color:#9a80b0;font-size:14px;margin-bottom:20px;">Ask Pearl for the latest headlines!</div><button onclick="location.reload()" style="background:rgba(217,79,142,.2);border:1px solid rgba(217,79,142,.4);border-radius:100px;padding:10px 24px;color:#D94F8E;font-size:13px;font-weight:600;cursor:pointer;">↻ Retry</button></div>';
      document.getElementById('footer').textContent='Tap Retry or ask Pearl for news';
      return;
    }
    var html='<div style="display:flex;flex-direction:column;gap:clamp(12px,3vw,16px);">';
    top.forEach(function(item,idx){
      var delay=(idx*0.08).toFixed(2);
      var featured=idx===0;
      html+='<a href="'+item.link+'" target="_blank" rel="noopener" class="c card'+(featured?' featured':'')+'" style="animation-delay:'+delay+'s;">';
      if(item.img){
        html+='<img class="card-img" src="'+item.img+'" alt="" loading="lazy" onerror="this.style.display=\\'none\\'"/>';
      }
      html+='<div class="card-body">';
      html+='<div class="card-source">'+item.source+'</div>';
      html+='<div class="card-title">'+item.title+'</div>';
      if(item.desc&&featured) html+='<div class="card-excerpt">'+item.desc+'</div>';
      html+='<div class="card-time">'+timeAgo(item.date)+'</div>';
      html+='</div></a>';
    });
    html+='</div>';
    document.getElementById('cards').innerHTML=html;
    document.getElementById('footer').textContent='Pearl News · '+top.length+' stories from '+new Set(top.map(function(i){return i.source})).size+' sources';
  }

  FEEDS.forEach(function(feed){
    fetchViaProxy(feed.url)
      .then(function(txt){
        var parser=new DOMParser();
        var xml=parser.parseFromString(txt,'text/xml');
        allItems=allItems.concat(parseFeed(xml,feed.name));
      })
      .catch(function(){})
      .finally(function(){
        done++;
        if(done>=FEEDS.length)render();
      });
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
  const { isChatMode } = useUI();
  const isMobile = useIsMobile();
  const htmlFeatureEnabled = isFeatureEnabled('htmlContent', supportedFeatures);
  const canUseAppletFolder = htmlFeatureEnabled && Boolean(assistantName);
  const [isAppletFolderOpen, setIsAppletFolderOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
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

  const openDesktopApp = (appName: string, url?: string, useEnhanced?: boolean) => {
    // eslint-disable-next-line no-console
    console.log(`Opening desktop app: ${appName}`);

    trackSessionHistory(`Opened ${appName} app`).catch(() => {
      // ignore
    });

    if (!appName) return;

    const normalized = appName.toLowerCase();
    const source = `desktop:${normalized}`;

    switch (normalized) {
      case 'creation-engine':
      case 'creationengine':
      case 'creation':
        requestWindowOpen({ viewType: 'htmlContent', source: 'desktop:creation-engine' });
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
        const query = url && url.trim().length > 0 ? url : 'lofi hip hop radio - beats to relax/study to';
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
      case 'news': {
        // Show styled Wonder Canvas news display instead of browser window
        dispatchWonderScene(buildNewsHTML());
        // Fire nia:request.news so the bot/backend can populate with real headlines later
        window.dispatchEvent(new CustomEvent('nia:request.news', { detail: {} }));
        return;
      }
      case 'weather': {
        // Show loading state immediately in Wonder Canvas, then fetch real data
        dispatchWonderScene(buildWeatherLoadingHTML());
        fetch('https://wttr.in/?format=j1')
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<Record<string, unknown>>;
          })
          .then(data => {
            dispatchWonderScene(buildWeatherSceneHTML(data));
          })
          .catch(() => {
            dispatchWonderScene(buildWeatherErrorHTML());
          });
        return;
      }
      case 'files':
        requestWindowOpen({ viewType: 'files', source });
        return;
      case 'sprites':
      case 'sprite':
        requestWindowOpen({ viewType: 'sprites', source: 'desktop:sprites' });
        return;
      case 'discord':
        // Discord blocks iframe embedding (X-Frame-Options: DENY) — open in a new tab instead
        window.open('https://discord.com/app', '_blank');
        return;
      default:
        console.warn(`⚠️ Unknown desktop app requested: ${appName}`);
    }
  };

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: -1 }}>
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(/WorkBg5.gif)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      </div>

      {/* Desktop icons — column-first grid: icons fill top-to-bottom per column, columns left-to-right */}
      <motion.div
        className={`pointer-events-auto fixed z-[30] ${
          isMobile
            ? 'left-4 right-4 top-20'
            : 'left-8 right-8 top-24'
        }`}
        style={{
          display: 'grid',
          gridAutoFlow: 'column',
          gridTemplateRows: 'repeat(3, auto)',
          gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(3, 1fr)',
          justifyItems: 'center',
          rowGap: isMobile ? '20px' : '28px',
          columnGap: isMobile ? '8px' : '24px',
        }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        {/* Notes — always visible */}
        {isFeatureEnabled('notes', supportedFeatures) && (
          <motion.div
            className="flex cursor-pointer flex-col items-center"
            onClick={() => openDesktopApp('notes')}
            whileHover={{ y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <motion.div
              className="flex items-center justify-center"
              whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <Image src="/desktopicons/notepad.png" alt="Notepad" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" />
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

        {/* Photo Magic — always visible */}
        <motion.div
          className="flex cursor-pointer flex-col items-center"
          onClick={() => openDesktopApp('photo-magic')}
          whileHover={{ y: -8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <motion.div
            className="flex items-center justify-center"
            whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500/80 to-violet-600/80 shadow-lg">
              <span className="text-[32px] leading-none">✨📷</span>
            </div>
          </motion.div>
          <motion.span
            className="mt-2 text-center text-xs uppercase text-white"
            style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
            whileHover={{ color: 'rgb(232, 121, 249)', textShadow: '0 0 10px rgba(232, 121, 249, 0.5)' }}
            transition={{ duration: 0.2 }}
          >
            Photo Magic
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
              className="flex items-center justify-center"
              whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <Image src="/desktopicons/youtube.png" alt="YouTube" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" />
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

        {/* Video Meet */}
        {isFeatureEnabled('dailyCall', supportedFeatures) && (
          <motion.div
            className="flex cursor-pointer flex-col items-center"
            onClick={() => openDesktopApp('dailyCall')}
            whileHover={{ y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <motion.div
              className="flex items-center justify-center"
              whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <Image src="/desktopicons/social.png" alt="Video Meet" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" />
            </motion.div>
            <motion.span
              className="mt-2 text-center text-xs uppercase text-white"
              style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
              whileHover={{ color: 'rgb(165,180,252)', textShadow: '0 0 10px rgba(165,180,252,0.5)' }}
              transition={{ duration: 0.2 }}
            >
              Video Meet
            </motion.span>
          </motion.div>
        )}

        {/* News */}
        <motion.div
          className="flex cursor-pointer flex-col items-center"
          onClick={() => openDesktopApp('news')}
          whileHover={{ y: -8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <motion.div
            className="flex items-center justify-center"
            whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Image src="/desktopicons/news.svg" alt="News" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" />
          </motion.div>
          <motion.span
            className="mt-2 text-center text-xs uppercase text-white"
            style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
            whileHover={{ color: 'rgb(56, 189, 248)', textShadow: '0 0 10px rgba(56, 189, 248, 0.5)' }}
            transition={{ duration: 0.2 }}
          >
            News
          </motion.span>
        </motion.div>

        {/* Weather */}
        <motion.div
          className="flex cursor-pointer flex-col items-center"
          onClick={() => openDesktopApp('weather')}
          whileHover={{ y: -8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <motion.div
            className="flex items-center justify-center"
            whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Image src="/desktopicons/weather.svg" alt="Weather" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" />
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

        {/* Files */}
        <motion.div
          className="flex cursor-pointer flex-col items-center"
          onClick={() => openDesktopApp('files')}
          whileHover={{ y: -8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <motion.div
            className="flex items-center justify-center"
            whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Image src="/desktopicons/files.svg" alt="Files" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" />
          </motion.div>
          <motion.span
            className="mt-2 text-center text-xs uppercase text-white"
            style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
            whileHover={{ color: 'rgb(96, 165, 250)', textShadow: '0 0 10px rgba(96, 165, 250, 0.5)' }}
            transition={{ duration: 0.2 }}
          >
            Files
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
            className="flex items-center justify-center"
            whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Image src="/desktopicons/Terminal.png" alt="Terminal" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" />
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

        {/* Discord */}
        {(
          <motion.div
            className="flex cursor-pointer flex-col items-center"
            onClick={() => openDesktopApp('discord')}
            whileHover={{ y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <motion.div
              className="flex items-center justify-center"
              whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <Image src="/desktopicons/discord.svg" alt="Discord" width={ICON_SIZE} height={ICON_SIZE} className="object-contain" />
            </motion.div>
            <motion.span
              className="mt-2 text-center text-xs uppercase text-white"
              style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
              whileHover={{ color: 'rgb(88, 101, 242)', textShadow: '0 0 10px rgba(88, 101, 242, 0.7)' }}
              transition={{ duration: 0.2 }}
            >
              Discord
            </motion.span>
          </motion.div>
        )}

        {/* Sprites */}
        <motion.div
          className="flex cursor-pointer flex-col items-center"
          onClick={() => openDesktopApp('sprites')}
          whileHover={{ y: -8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <motion.div
            className="flex items-center justify-center"
            whileHover={{ scale: 1.2, rotate: [0, -3, 3, -3, 0] }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/80 to-violet-600/80 shadow-lg">
              <span className="text-[32px] leading-none">✨</span>
            </div>
          </motion.div>
          <motion.span
            className="mt-2 text-center text-xs uppercase text-white"
            style={{ fontFamily: 'Gohufont, monospace', letterSpacing: '0.5px' }}
            whileHover={{ color: 'rgb(6, 182, 212)', textShadow: '0 0 10px rgba(6, 182, 212, 0.7)' }}
            transition={{ duration: 0.2 }}
          >
            Sprites
          </motion.span>
        </motion.div>

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
              className="relative w-full max-w-[min(900px,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] rounded-3xl border border-white/20 bg-gradient-to-b from-slate-900/98 via-slate-900/95 to-slate-950/98 p-4 text-white shadow-[0_40px_140px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:p-6"
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
            <div className="max-h-[calc(100vh-12rem)] overflow-y-auto pr-1 sm:max-h-[calc(88vh-140px)] sm:pr-2 applet-shelf-scroll">
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
