'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getClientLogger } from '@interface/lib/client-logger';
import { forwardAppEvent } from '@interface/features/DailyCall/events/appMessageBridge';
import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { useUI } from '@interface/contexts/ui-context';
import { EventEnum } from '@nia/events';
import { NIA_EVENT_CALL_START } from '@interface/features/DailyCall/events/niaEventRouter';
import './wonder-canvas.css';

const logger = getClientLogger('[wonder_canvas]');

// ── Wonder Canvas iframe runtime ──────────────────────────────────────
// A small vanilla-JS runtime that manages layers, transitions, and
// data-action interaction binding inside a sandboxed iframe.
const WONDER_RUNTIME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<meta name="referrer" content="no-referrer"/>
<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob: https: http:; media-src * data: blob:; connect-src * data: blob:; font-src * data:;"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;background:transparent;overflow:hidden;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#e0e0e8}
.wonder-layer{position:absolute;inset:0;transition:opacity 0.4s ease}
.wonder-layer--hidden{opacity:0;pointer-events:none}

/* ── Built-in animations ── */
.wonder-fadeIn{animation:wFadeIn .5s ease forwards}
.wonder-fadeOut{animation:wFadeOut .5s ease forwards}
.wonder-slideUp{animation:wSlideUp .4s ease-out forwards}
.wonder-slideDown{animation:wSlideDown .4s ease-out forwards}
.wonder-bounce{animation:wBounce .6s ease}
.wonder-shake{animation:wShake .5s ease}
.wonder-pulse{animation:wPulse 1s ease infinite}
.wonder-glow{animation:wGlow 2s ease infinite}
.wonder-spin{animation:wSpin 1s linear infinite}
.wonder-typewriter{overflow:hidden;white-space:nowrap;border-right:2px solid;
  animation:wTypewriter 3s steps(40) forwards,wBlink .75s step-end infinite}

@keyframes wFadeIn{from{opacity:0}to{opacity:1}}
@keyframes wFadeOut{from{opacity:1}to{opacity:0}}
@keyframes wSlideUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
@keyframes wSlideDown{from{opacity:0;transform:translateY(-24px)}to{opacity:1;transform:translateY(0)}}
@keyframes wBounce{0%,100%{transform:translateY(0)}40%{transform:translateY(-16px)}60%{transform:translateY(-8px)}}
@keyframes wShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}
@keyframes wPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
@keyframes wGlow{0%,100%{filter:brightness(1)}50%{filter:brightness(1.3)}}
@keyframes wSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes wTypewriter{from{width:0}to{width:100%}}
@keyframes wBlink{50%{border-color:transparent}}

/* ── Particle presets ── */
.wonder-particles-fireflies{position:absolute;inset:0;pointer-events:none;
  background-image:radial-gradient(2px 2px at 20% 30%,rgba(255,220,100,.6),transparent),
    radial-gradient(2px 2px at 60% 70%,rgba(255,220,100,.4),transparent),
    radial-gradient(2px 2px at 80% 20%,rgba(255,220,100,.5),transparent),
    radial-gradient(2px 2px at 40% 80%,rgba(255,220,100,.3),transparent);
  background-size:300px 300px;animation:wDrift 20s linear infinite}
.wonder-particles-snow{position:absolute;inset:0;pointer-events:none;
  background-image:radial-gradient(3px 3px at 25% 0%,rgba(255,255,255,.7),transparent),
    radial-gradient(2px 2px at 55% 0%,rgba(255,255,255,.5),transparent),
    radial-gradient(3px 3px at 75% 0%,rgba(255,255,255,.6),transparent);
  background-size:200px 400px;animation:wSnow 8s linear infinite}
.wonder-particles-sparkle{position:absolute;inset:0;pointer-events:none;
  background-image:radial-gradient(1px 1px at 10% 10%,rgba(255,255,255,.8),transparent),
    radial-gradient(1px 1px at 50% 50%,rgba(200,200,255,.6),transparent),
    radial-gradient(1px 1px at 90% 30%,rgba(255,255,255,.7),transparent);
  background-size:150px 150px;animation:wSparkle 4s ease infinite}
@keyframes wDrift{0%{transform:translate(0,0)}50%{transform:translate(-20px,15px)}100%{transform:translate(0,0)}}
@keyframes wSnow{from{background-position-y:0}to{background-position-y:400px}}
@keyframes wSparkle{0%,100%{opacity:.3}50%{opacity:1}}

/* ── iOS Safari compatibility fixes ── */
/* Prevent 100vh issues in iOS iframes */
html{height:-webkit-fill-available}
body{min-height:-webkit-fill-available;min-height:100%}
/* Fix flexbox split layouts on iOS Safari */
[style*="display:flex"],[style*="display: flex"]{-webkit-flex-shrink:0;flex-shrink:0}
/* Ensure .right panels in split layouts are visible */
.right,[class*="right"]{min-width:0;overflow:visible}
/* Portrait mode: stack split layouts vertically (top/bottom) instead of left/right */
@media (orientation:portrait),(max-width:600px){
  [style*="display:flex"][style*="flex-direction:row"],
  [style*="display: flex"][style*="flex-direction: row"],
  [style*="display:flex"][style*="flex-direction: row"],
  [style*="display: flex"][style*="flex-direction:row"],
  [style*="display:flex"]:not([style*="flex-direction:column"]):not([style*="flex-direction: column"]),
  [style*="display: flex"]:not([style*="flex-direction:column"]):not([style*="flex-direction: column"]){
    flex-direction:column !important;
  }
  [style*="display:flex"] > *,
  [style*="display: flex"] > *{
    width:100% !important;max-width:100% !important;
  }
  [style*="display:grid"][style*="grid-template-columns"],
  [style*="display: grid"][style*="grid-template-columns"]{
    grid-template-columns:1fr !important;grid-template-rows:auto auto !important;
  }
  .left,[class*="left"]{height:40vh;height:40dvh;min-height:200px}
  .right,[class*="right"]{flex:1;min-height:0;overflow-y:auto}
}
/* Force text visibility — override any background-clip:text that breaks in iOS sandboxed iframes */
.wonder-layer *{-webkit-text-fill-color:initial !important;-webkit-background-clip:initial !important;background-clip:initial !important}
/* Re-enable gradient text ONLY when explicitly requested with a safe fallback class */
.wonder-gradient-text{-webkit-text-fill-color:transparent !important;-webkit-background-clip:text !important;background-clip:text !important}

/* ── Interactive element styles ── */
[data-action]{cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent}
[data-action]:active{transform:scale(.97)}

.wonder-choice{display:inline-block;padding:12px 24px;margin:8px;border-radius:12px;
  background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;
  font-size:16px;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);transition:all .2s ease}
.wonder-choice:hover,.wonder-choice:active{background:rgba(255,255,255,.2);
  border-color:rgba(255,255,255,.4);transform:translateY(-2px)}

/* ── Avatar state reactions ── */
body[data-avatar-state="speaking"] .wonder-layer{transition:opacity .3s ease;opacity:.85}
body[data-avatar-state="speaking"] .wonder-layer--dim-on-speak{opacity:.5}

/* ── Avatar safe zone — bottom-left 100x100px on mobile ── */
.wonder-avatar-safe{position:fixed;bottom:0;left:0;width:100px;height:100px;pointer-events:none}

/* ── Orientation classes (set by JS + parent postMessage) ── */
:root{--layout:landscape}
body.portrait{--layout:portrait}

/* Portrait: stack class-named flex containers vertically */
body.portrait .wonder-layer [class*="card"],
body.portrait .wonder-layer [class*="container"],
body.portrait .wonder-layer [class*="wrapper"],
body.portrait .wonder-layer [class*="layout"],
body.portrait .wonder-layer [class*="panel"],
body.portrait .wonder-layer [class*="split"]{
  flex-direction:column !important;
}
/* Portrait: left/image panels become top ~40vh bands */
body.portrait .wonder-layer [class*="left"],
body.portrait .wonder-layer [class*="image"],
body.portrait .wonder-layer [class*="hero"],
body.portrait .wonder-layer [class*="media"],
body.portrait .wonder-layer [class*="img"]{
  width:100% !important;height:40vh !important;height:40dvh !important;
  min-height:180px;max-height:40vh;max-height:40dvh;object-fit:cover;flex-shrink:0 !important
}
/* Portrait: standalone img elements in flex containers */
body.portrait .wonder-layer img{
  width:100% !important;max-height:40vh;max-height:40dvh;object-fit:cover;flex-shrink:0
}
/* Portrait: right/text panels fill remaining space */
body.portrait .wonder-layer [class*="right"],
body.portrait .wonder-layer [class*="text"],
body.portrait .wonder-layer [class*="content"],
body.portrait .wonder-layer [class*="info"],
body.portrait .wonder-layer [class*="body"]{
  width:100% !important;flex:1 !important;min-height:0;overflow-y:auto
}
/* Landscape: restore natural widths for named panels */
body.landscape .wonder-layer [class*="left"],
body.landscape .wonder-layer [class*="right"]{width:auto}

/* ── Wonder Icons ── */
.w-icon{display:inline-block;width:1.25em;height:1.25em;vertical-align:-0.25em;stroke-linecap:round;stroke-linejoin:round}
.w-icon--sm{width:1em;height:1em}.w-icon--md{width:1.5em;height:1.5em}
.w-icon--lg{width:2em;height:2em}.w-icon--xl{width:3em;height:3em}
.w-icon--glow{filter:drop-shadow(0 0 8px currentColor)}
.w-icon--spin{animation:wIconSpin 2s linear infinite}
.w-icon--pulse{animation:wIconPulse 2s ease infinite}
@keyframes wIconSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes wIconPulse{0%,100%{opacity:1}50%{opacity:0.5}}
</style>
</head>
<body>
<script>
// ── Wonder Icons Library (inline SVG, no external deps) ──
var WonderIcons={
tree:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L8 8h8l-4-6zm0 6L7 14h10l-5-6zm0 6v6m-2 0h4"/></svg>',
cave:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20h18v-4c0-2-1-4-3-5 1-2 0-4-2-5-1-1-3-1-4 0-1-1-3-1-4 0-2 1-3 3-2 5-2 1-3 3-3 5v4z"/></svg>',
tower:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="2" width="12" height="20" rx="1"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><rect x="10" y="18" width="4" height="4"/></svg>',
mountain:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20l5-8 4 4 5-8 4 4v8H3z"/></svg>',
castle:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20h18V10l-2-2V4h-2v2h-2V4h-2v2h-2V4H9v2H7V4H5v4L3 10v10z"/><rect x="10" y="14" width="4" height="6"/></svg>',
sparkle:'<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z"/><path d="M19 15l.5 2.5L22 18l-2.5.5L19 21l-.5-2.5L16 18l2.5-.5z"/><path d="M5 3l.5 1.5L7 5l-1.5.5L5 7l-.5-1.5L3 5l1.5-.5z"/></svg>',
run:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="5" r="2"/><path d="M13 8l-4 4m0 0l-3 3m3-3l2 6m-6-4l2-2"/><path d="M20 12l-3-3"/></svg>',
sword:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 3L5 17m0 0l-2 2 2 2 2-2m-2-2l2-2"/><path d="M17.5 6.5L19 5"/></svg>',
shield:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L4 6v6c0 5 3 9 8 10 5-1 8-5 8-10V6l-8-4z"/></svg>',
crystal:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L6 8h12l-6-6zm0 0v6m-6 0L4 22h16l-2-14H6z"/><line x1="12" y1="8" x2="12" y2="22"/></svg>',
gem:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 5l-2 4 8 10 8-10-2-4H6z"/><line x1="6" y1="9" x2="18" y2="9"/><line x1="12" y1="5" x2="12" y2="19"/></svg>',
heart:'<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
star:'<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
zap:'<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z"/></svg>',
flame:'<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c-1 3-2 4-4 6-2 2-3 5-3 7 0 4.42 3.58 8 8 8s8-3.58 8-8c0-2-1-5-3-7-2-2-3-3-4-6h-2z"/></svg>',
trophy:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3h8v5a4 4 0 01-8 0V3z"/><path d="M6 4H4a2 2 0 00-2 2v2a2 2 0 002 2h2m8 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2"/><path d="M12 12v5m-3 0h6m-3 0v4"/></svg>',
coin:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M14.5 8.5c-1-1-2.5-1-3.5 0s-1 2.5 0 3.5 2.5 1 3.5 0"/><line x1="12" y1="7" x2="12" y2="17"/></svg>',
sun:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>',
moon:'<svg class="w-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>',
dragon:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5c-3 0-5 2-6 4l-2 4c0 2 1 3 2 3h12c1 0 2-1 2-3l-2-4c-1-2-3-4-6-4z"/><circle cx="9" cy="9" r="1"/><path d="M18 8l3-2m-3 6l3 1"/></svg>',
wand:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="18" x2="18" y2="6"/><path d="M17 4l1 1-1 1-1-1zm2 2l1 1-1 1-1-1zm-4 4l1 1-1 1-1-1z"/></svg>',
potion:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 2h6v4l2 2v10a4 4 0 01-8 0V8l2-2V2z"/><line x1="9" y1="14" x2="15" y2="14"/></svg>',
key:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7" cy="7" r="4"/><path d="M10 10l10 10m-4-4l2-2m-4-4l2-2"/></svg>',
chest:'<svg class="w-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="10" rx="1"/><path d="M4 10V6a8 8 0 0116 0v4"/><circle cx="12" cy="15" r="1"/></svg>',
get:function(n,c){var i=this[n];if(!i)return'';return c?i.replace('class="w-icon"','class="w-icon '+c+'"'):i}
};
window.WonderIcons=WonderIcons;
</script>
<script>
(function(){
  var layers={};

  function getOrCreateLayer(id){
    if(layers[id])return layers[id];
    var el=document.createElement('div');
    el.className='wonder-layer';
    el.dataset.layer=id;
    // z-order: background=0, main=1, overlay=2
    var z=id==='background'?0:id==='overlay'?2:1;
    el.style.zIndex=z;
    document.body.appendChild(el);
    layers[id]=el;
    return el;
  }

  // Fix images: ensure crossorigin is not set (avoids CORS issues for display-only imgs)
  // and add error logging for debugging
  function fixImages(container){
    container.querySelectorAll('img').forEach(function(img){
      img.removeAttribute('crossorigin');
      img.referrerPolicy='no-referrer';
      img.onerror=function(){
        console.warn('[wonder] Image failed to load:',img.src);
      };
    });
  }

  function bindInteractions(container){
    container.querySelectorAll('[data-action]').forEach(function(el){
      el.addEventListener('click',function(){
        window.parent.postMessage({
          type:'wonder.interaction',
          action:el.dataset.action,
          label:(el.textContent||'').trim(),
          elementId:el.id||null
        },'*');
      });
      el.addEventListener('touchend',function(e){e.preventDefault();el.click()});
    });
  }

  // Replace {{icon:name}} and {{icon:name:classes}} placeholders with inline SVGs
  function resolveIcons(html){
    if(!html||!window.WonderIcons)return html;
    return html.replace(/{{icon:([a-zA-Z]+)(?::([- a-zA-Z0-9]+))?}}/g,function(_,name,cls){
      return window.WonderIcons.get(name,cls||'')||'';
    });
  }

  function setScene(data){
    var layer=getOrCreateLayer(data.layer||'main');
    var transition=data.transition||'fade';
    var html=resolveIcons(data.html||'');
    if(transition==='instant'){
      layer.innerHTML=html;
      if(data.css)injectCSS(data.css,layer);
      bindInteractions(layer);
      fixImages(layer);
    } else {
      layer.style.opacity='0';
      layer.innerHTML=html;
      if(data.css)injectCSS(data.css,layer);
      bindInteractions(layer);
      fixImages(layer);
      requestAnimationFrame(function(){
        layer.style.transition='opacity 0.4s ease';
        layer.style.opacity='1';
      });
    }
  }

  function addToLayer(data){
    var layer=getOrCreateLayer(data.layer||'main');
    var pos=data.position||'append';
    var tmp=document.createElement('div');
    tmp.innerHTML=resolveIcons(data.html||'');
    while(tmp.firstChild){
      if(pos==='prepend')layer.insertBefore(tmp.firstChild,layer.firstChild);
      else layer.appendChild(tmp.firstChild);
    }
    bindInteractions(layer);
    fixImages(layer);
  }

  function removeFromLayer(data){
    var layer=layers[data.layer||'main'];
    if(!layer)return;
    if(data.elementId){
      var el=layer.querySelector('#'+CSS.escape(data.elementId));
      if(el)el.remove();
    }
  }

  function clearAll(data){
    if(data&&data.layer){
      var l=layers[data.layer];
      if(l){
        if(data.transition==='fade'){
          l.style.transition='opacity 0.4s ease';l.style.opacity='0';
          setTimeout(function(){l.innerHTML='';l.style.opacity='1'},400);
        } else {l.innerHTML=''}
      }
    } else {
      Object.keys(layers).forEach(function(k){layers[k].innerHTML=''});
    }
    window.parent.postMessage({type:'wonder.cleared'},'*');
  }

  function animateElement(data){
    var sel=data.selector||data.elementId;
    if(!sel)return;
    var el=sel.charAt(0)==='#'||sel.charAt(0)==='.'?document.querySelector(sel):document.getElementById(sel);
    if(!el)return;
    var cls='wonder-'+data.animation;
    el.classList.add(cls);
    setTimeout(function(){el.classList.remove(cls)},data.duration||500);
  }

  function injectCSS(css,container){
    var id='wonder-css-'+(container.dataset.layer||'main');
    var existing=document.getElementById(id);
    if(existing)existing.remove();
    var style=document.createElement('style');
    style.id=id;style.textContent=css;
    document.head.appendChild(style);
  }

  window.addEventListener('message',function(e){
    if(!e.data||!e.data.type)return;
    switch(e.data.type){
      case 'wonder.scene':setScene(e.data);break;
      case 'wonder.add':addToLayer(e.data);break;
      case 'wonder.remove':removeFromLayer(e.data);break;
      case 'wonder.clear':clearAll(e.data);break;
      case 'wonder.animate':animateElement(e.data);break;
      case 'wonder.avatarState':setAvatarState(e.data.state);break;
      case 'wonder.orientation':parentOrientationSet=true;applyOrientation(e.data.portrait);break;
    }
  });

  // ── Orientation / viewport detection ──────────────────────────────
  // parentOrientationSet: when true, parent has sent us the real device
  // orientation — prefer that over iframe-internal detection (iframe
  // dimensions can be wrong in iOS Safari sandboxed iframes).
  var parentOrientationSet=false;

  function applyOrientation(isPortrait){
    document.body.classList.toggle('portrait',isPortrait);
    document.body.classList.toggle('landscape',!isPortrait);
    document.documentElement.style.setProperty('--layout',isPortrait?'portrait':'landscape');
  }

  function detectOrientation(){
    // If parent already told us the orientation, skip self-detection
    if(parentOrientationSet)return;
    var p=window.innerHeight>window.innerWidth;
    applyOrientation(p);
    window.parent.postMessage({type:'wonder.orientation.detected',portrait:p},'*');
  }

  detectOrientation();
  window.addEventListener('resize',detectOrientation);
  window.addEventListener('orientationchange',function(){
    // Small delay for iOS to settle dimensions after orientation change
    setTimeout(detectOrientation,100);
  });
  // ─────────────────────────────────────────────────────────────────

  function setAvatarState(state){
    document.body.dataset.avatarState=state||'idle';
  }

  // Signal ready — retry until parent acknowledges (fixes race condition
  // where React useEffect hasn't registered the message listener yet)
  window.parent.postMessage({type:'wonder.ready'},'*');
  var readyInterval=setInterval(function(){
    window.parent.postMessage({type:'wonder.ready'},'*');
  },100);
  window.addEventListener('message',function(e){
    if(e.data&&e.data.type==='wonder.ready.ack'){
      clearInterval(readyInterval);
    }
  });
  // Stop retrying after 5s regardless
  setTimeout(function(){clearInterval(readyInterval)},5000);
})();
</script>
</body>
</html>`;

// ── Event name constants ──────────────────────────────────────────────
export const NIA_EVENT_WONDER_SCENE = 'nia:wonder.scene';
export const NIA_EVENT_WONDER_ADD = 'nia:wonder.add';
export const NIA_EVENT_WONDER_REMOVE = 'nia:wonder.remove';
export const NIA_EVENT_WONDER_CLEAR = 'nia:wonder.clear';
export const NIA_EVENT_WONDER_ANIMATE = 'nia:wonder.animate';

// ── Types ─────────────────────────────────────────────────────────────
export interface WonderInteraction {
  action: string;
  label: string;
  elementId: string | null;
}

interface WonderCanvasRendererProps {
  /** Called when the user interacts with a data-action element. */
  onInteraction?: (interaction: WonderInteraction) => void;
}

/**
 * WonderCanvasRenderer — persistent sandboxed iframe for Wonder Canvas.
 *
 * Sits as a layer in the Stage. Receives wonder.* events from the nia event
 * system and forwards them to the iframe runtime via postMessage. Interaction
 * events from the iframe are forwarded back to the bot via Daily app-message.
 */
export default function WonderCanvasRenderer({ onInteraction }: WonderCanvasRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);

  // ── Avatar state awareness ────────────────────────────────────────
  const { isAssistantSpeaking } = useVoiceSessionContext();
  const { isChatMode } = useUI();
  const avatarState = isAssistantSpeaking ? 'speaking' : 'idle';

  // Queue messages until iframe is ready
  const pendingRef = useRef<Array<Record<string, unknown>>>([]);

  // Use ref-based ready check to avoid stale closures
  const postToIframe = useCallback((msg: Record<string, unknown>) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    if (!readyRef.current) {
      pendingRef.current.push(msg);
      return;
    }
    win.postMessage(msg, '*');
  }, []);

  // Flush pending messages when iframe signals ready
  const flushPending = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    for (const msg of pendingRef.current) {
      win.postMessage(msg, '*');
    }
    pendingRef.current = [];
  }, []);

  useEffect(() => {
    if (!ready) return;
    flushPending();
  }, [ready, flushPending]);

  // ── Forward avatar state to iframe ───────────────────────────────────
  useEffect(() => {
    if (!active || !ready) return;
    postToIframe({ type: 'wonder.avatarState', state: avatarState });
  }, [avatarState, active, ready, postToIframe]);

  // ── Send parent-side orientation to iframe ───────────────────────────
  // The parent page has access to the real device orientation and window size;
  // posting it into the iframe lets the iframe apply body classes without
  // relying solely on its own inner dimensions (which can differ in iframes).
  const sendOrientation = useCallback(() => {
    const isPortrait = typeof window !== 'undefined'
      ? window.matchMedia('(orientation: portrait)').matches
      : false;
    postToIframe({ type: 'wonder.orientation', portrait: isPortrait });
  }, [postToIframe]);

  // Send once when the iframe first becomes ready
  useEffect(() => {
    if (!ready) return;
    sendOrientation();
  }, [ready, sendOrientation]);

  // Re-send on every viewport resize / orientation change
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(orientation: portrait)');
    const onMqChange = () => sendOrientation();
    const onResize = () => sendOrientation();
    mq.addEventListener('change', onMqChange);
    window.addEventListener('resize', onResize);
    return () => {
      mq.removeEventListener('change', onMqChange);
      window.removeEventListener('resize', onResize);
    };
  }, [sendOrientation]);

  // ── Listen for wonder.* nia events ──────────────────────────────────
  useEffect(() => {
    const handleScene = (e: Event) => {
      const { payload } = (e as CustomEvent).detail ?? {};
      if (!payload?.html) return;
      logger.info('Wonder scene received', { layer: payload.layer, chars: payload.html.length });
      setActive(true);
      postToIframe({ type: 'wonder.scene', ...payload });
    };

    const handleAdd = (e: Event) => {
      const { payload } = (e as CustomEvent).detail ?? {};
      if (!payload?.html) return;
      postToIframe({ type: 'wonder.add', ...payload });
    };

    const handleRemove = (e: Event) => {
      const { payload } = (e as CustomEvent).detail ?? {};
      postToIframe({ type: 'wonder.remove', ...payload });
    };

    const handleClear = (e: Event) => {
      const { payload } = (e as CustomEvent).detail ?? {};
      logger.info('Wonder canvas clear');
      postToIframe({ type: 'wonder.clear', ...payload });
      // Don't set active=false yet — wait for iframe to confirm clear
    };

    const handleAnimate = (e: Event) => {
      const { payload } = (e as CustomEvent).detail ?? {};
      if ((!payload?.elementId && !payload?.selector) || !payload?.animation) return;
      postToIframe({ type: 'wonder.animate', ...payload });
    };

    window.addEventListener(NIA_EVENT_WONDER_SCENE, handleScene);
    window.addEventListener(NIA_EVENT_WONDER_ADD, handleAdd);
    window.addEventListener(NIA_EVENT_WONDER_REMOVE, handleRemove);
    window.addEventListener(NIA_EVENT_WONDER_CLEAR, handleClear);
    window.addEventListener(NIA_EVENT_WONDER_ANIMATE, handleAnimate);

    return () => {
      window.removeEventListener(NIA_EVENT_WONDER_SCENE, handleScene);
      window.removeEventListener(NIA_EVENT_WONDER_ADD, handleAdd);
      window.removeEventListener(NIA_EVENT_WONDER_REMOVE, handleRemove);
      window.removeEventListener(NIA_EVENT_WONDER_CLEAR, handleClear);
      window.removeEventListener(NIA_EVENT_WONDER_ANIMATE, handleAnimate);
    };
  }, [postToIframe]);

  // ── Clear Wonder Canvas on new voice session ───────────────────────
  // Prevents stale canvas content from a previous session leaking into the
  // next one (Bug C: canvas-leak).
  useEffect(() => {
    const handleNewSession = () => {
      logger.info('New voice session started — clearing Wonder Canvas');
      postToIframe({ type: 'wonder.clear', layer: undefined });
      setActive(false);
    };

    window.addEventListener(NIA_EVENT_CALL_START, handleNewSession);
    return () => window.removeEventListener(NIA_EVENT_CALL_START, handleNewSession);
  }, [postToIframe]);

  // ── Clear Wonder Canvas when exiting chat mode (going home) ────────
  // When the user leaves the WORK desktop (chat mode), clear any active
  // Wonder Canvas content so it doesn't block clicks on the home screen.
  const prevChatModeRef = useRef(isChatMode);
  useEffect(() => {
    if (prevChatModeRef.current && !isChatMode && active) {
      logger.info('Chat mode exited — clearing Wonder Canvas');
      postToIframe({ type: 'wonder.clear', layer: undefined });
      setActive(false);
    }
    prevChatModeRef.current = isChatMode;
  }, [isChatMode, active, postToIframe]);

  // ── Listen for messages FROM the iframe ─────────────────────────────
  // Register this listener early (empty deps) so it can't miss wonder.ready
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      // Only accept messages from our iframe
      if (e.source !== iframeRef.current?.contentWindow) return;

      if (e.data?.type === 'wonder.ready') {
        // Ack the iframe so it stops retrying
        try { (e.source as Window)?.postMessage({ type: 'wonder.ready.ack' }, '*'); } catch (_) { /* noop */ }
        if (!readyRef.current) {
          logger.info('Wonder Canvas runtime ready');
          readyRef.current = true;
          setReady(true);
        }
        return;
      }

      if (e.data?.type === 'wonder.cleared') {
        setActive(false);
        return;
      }

      if (e.data?.type === 'wonder.interaction') {
        const interaction: WonderInteraction = {
          action: e.data.action ?? '',
          label: e.data.label ?? '',
          elementId: e.data.elementId ?? null,
        };
        logger.info('Wonder interaction', { action: interaction.action, label: interaction.label });

        // Handle close action — dismiss the Wonder Canvas scene
        if (interaction.action === 'close') {
          postToIframe({ type: 'wonder.clear', layer: undefined });
          setActive(false);
          return;
        }

        // Forward to bot via Daily app-message
        try {
          forwardAppEvent('wonder.canvas.interaction' as unknown as EventEnum, interaction);
        } catch (err) {
          logger.warn('Failed to forward wonder interaction via app-message', { error: String(err) });
        }

        // Also call the prop handler
        onInteraction?.(interaction);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onInteraction]);

  return (
    <div
      className={`wonder-canvas ${active ? 'wonder-canvas--active' : 'wonder-canvas--inactive'}`}
      data-testid="wonder-canvas"
    >
      <iframe
        ref={iframeRef}
        className="wonder-canvas__frame"
        srcDoc={WONDER_RUNTIME_HTML}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        title="Wonder Canvas"
      />
    </div>
  );
}
