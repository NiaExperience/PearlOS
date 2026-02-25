/**
 * PearlOS News App — self-contained HTML for Wonder Canvas.
 *
 * This is the built-in news reader. It fetches from /api/news/feed on load
 * and renders a full scrollable news experience with:
 * - Hero card for top story
 * - Story river for remaining articles
 * - Source category pills for filtering
 * - Pull-to-refresh
 * - Settings panel for feed management
 * - Auto-refresh every 5 minutes
 *
 * Shared between:
 * - desktop-background-work.tsx (desktop icon click)
 * - browser-window.tsx (bot app.open event handler)
 */

import { closeButtonHTML } from './wonder-canvas-close-button';

export function buildNewsHTML(): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
html,body{width:100%;height:100%;overflow:hidden;background:#08080d;color:#f0f0f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}

/* ── Animations ── */
@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes breathe{0%,100%{opacity:.35}50%{opacity:.7}}
@keyframes cardIn{from{opacity:0;transform:translateY(32px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes heroSlide{from{opacity:0;transform:scale(1.04)}to{opacity:1;transform:scale(1)}}

/* ── Scroll container ── */
#scroll-root{
  position:fixed;inset:0;overflow-y:auto;overflow-x:hidden;
  -webkit-overflow-scrolling:touch;overscroll-behavior-y:contain;
}

/* ── Pull to refresh ── */
#ptr-indicator{
  position:fixed;top:0;left:0;right:0;height:60px;z-index:100;
  display:flex;align-items:center;justify-content:center;
  pointer-events:none;opacity:0;transition:opacity .2s;
}
#ptr-spinner{
  width:20px;height:20px;border:2px solid rgba(255,255,255,.1);
  border-top-color:rgba(255,255,255,.5);border-radius:50%;
  animation:spin .6s linear infinite;
}

/* ── Header ── */
.news-header{
  display:flex;align-items:center;justify-content:space-between;
  padding:clamp(52px,10vw,68px) clamp(16px,4vw,24px) 0;
  max-width:680px;margin:0 auto;width:100%;
}
.news-title{
  font-size:clamp(24px,6.5vw,32px);font-weight:800;letter-spacing:-.03em;
  color:#f0f0f5;
}
.header-actions{display:flex;gap:8px;align-items:center;}
.refresh-indicator{
  font-size:clamp(9px,2vw,11px);color:rgba(255,255,255,.3);
  animation:breathe 3s ease infinite;transition:opacity .3s;
}
.btn-glass{
  width:36px;height:36px;border-radius:12px;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  cursor:pointer;transition:all .25s ease;font-size:15px;color:rgba(255,255,255,.45);
}
.btn-glass:active{transform:scale(.9);background:rgba(255,255,255,.08);}

/* ── Category pills ── */
.pills-row{
  display:flex;gap:8px;overflow-x:auto;padding:clamp(14px,3vw,20px) clamp(16px,4vw,24px) 0;
  max-width:680px;margin:0 auto;width:100%;
  -webkit-overflow-scrolling:touch;scrollbar-width:none;scroll-snap-type:x proximity;
}
.pills-row::-webkit-scrollbar{display:none}
.pill{
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border-radius:100px;padding:7px 16px;font-size:clamp(11px,2.4vw,13px);
  font-weight:600;color:rgba(255,255,255,.4);cursor:pointer;
  white-space:nowrap;transition:all .3s cubic-bezier(.4,0,.2,1);
  scroll-snap-align:start;user-select:none;-webkit-user-select:none;
}
.pill:active{transform:scale(.95);}
.pill.active{
  background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.15);
  color:#f0f0f5;box-shadow:0 0 20px rgba(255,255,255,.03);
}

/* ── Content area ── */
#content-area{
  max-width:680px;margin:0 auto;width:100%;
  padding:clamp(14px,3vw,20px) clamp(16px,4vw,24px) clamp(80px,15vw,120px);
  transition:opacity .3s ease,transform .3s ease;
}
#content-area.switching{opacity:0;transform:translateY(8px);}

/* ── Hero card ── */
.hero-card{
  position:relative;border-radius:clamp(18px,4vw,24px);overflow:hidden;
  background:rgba(255,255,255,.03);
  border:1px solid rgba(255,255,255,.06);
  box-shadow:0 4px 24px rgba(0,0,0,.3),0 1px 3px rgba(0,0,0,.2);
  cursor:pointer;transition:transform .4s cubic-bezier(.4,0,.2,1),box-shadow .4s ease;
  animation:heroSlide .7s cubic-bezier(.4,0,.2,1) forwards;
  margin-bottom:clamp(20px,4vw,28px);
}
.hero-card:active{transform:scale(.985);}
.hero-img-wrap{
  position:relative;width:100%;aspect-ratio:16/10;overflow:hidden;
}
.hero-img{
  width:100%;height:100%;object-fit:cover;
  transition:transform .6s cubic-bezier(.4,0,.2,1);
}
.hero-card:active .hero-img{transform:scale(1.02);}
.hero-gradient{
  position:absolute;bottom:0;left:0;right:0;height:60%;
  background:linear-gradient(to top,#08080d 0%,rgba(8,8,13,.85) 40%,transparent 100%);
  pointer-events:none;
}
.hero-body{
  position:relative;padding:0 clamp(16px,4vw,22px) clamp(16px,4vw,22px);
  margin-top:-40px;z-index:2;
}
.hero-source{
  display:inline-block;font-size:clamp(9px,2vw,11px);font-weight:700;
  letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px;
}
.hero-title{
  font-size:clamp(18px,5vw,24px);font-weight:800;line-height:1.3;
  color:#f0f0f5;margin-bottom:6px;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;
}
.hero-time{font-size:clamp(10px,2.2vw,12px);color:rgba(255,255,255,.3);}

/* ── Story cards (river) ── */
.section-label{
  font-size:clamp(10px,2.2vw,12px);font-weight:700;
  letter-spacing:.12em;text-transform:uppercase;
  color:rgba(255,255,255,.25);margin:clamp(8px,2vw,12px) 0;
}
.card-river{
  display:flex;flex-direction:column;gap:2px;
}
.story-card{
  position:relative;display:flex;gap:clamp(12px,3vw,16px);
  padding:clamp(12px,3vw,16px);
  background:rgba(255,255,255,.02);
  border-bottom:1px solid rgba(255,255,255,.04);
  cursor:pointer;
  transition:background .3s ease,transform .35s cubic-bezier(.4,0,.2,1);
  animation:cardIn .5s cubic-bezier(.4,0,.2,1) both;
}
.story-card:first-child{border-radius:clamp(14px,3vw,18px) clamp(14px,3vw,18px) 0 0;border-top:1px solid rgba(255,255,255,.04);}
.story-card:last-child{border-radius:0 0 clamp(14px,3vw,18px) clamp(14px,3vw,18px);border-bottom:1px solid rgba(255,255,255,.04);}
.story-card:only-child{border-radius:clamp(14px,3vw,18px);border:1px solid rgba(255,255,255,.04);}
.story-card:active{background:rgba(255,255,255,.05);transform:scale(.985);}
.story-thumb{
  width:clamp(72px,18vw,88px);height:clamp(72px,18vw,88px);
  border-radius:clamp(10px,2.5vw,14px);object-fit:cover;flex-shrink:0;
  background:rgba(255,255,255,.03);
}
.story-body{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;}
.story-source{
  font-size:clamp(9px,2vw,11px);font-weight:700;letter-spacing:.08em;
  text-transform:uppercase;margin-bottom:4px;
}
.story-title{
  font-size:clamp(14px,3.5vw,16px);font-weight:700;line-height:1.3;
  color:#f0f0f5;margin-bottom:4px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}
.story-time{font-size:clamp(9px,2vw,11px);color:rgba(255,255,255,.25);}

/* ── Expanded card overlay ── */
.expand-backdrop{
  position:fixed;inset:0;background:rgba(8,8,13,.85);
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  z-index:8000;opacity:0;transition:opacity .35s ease;pointer-events:none;
}
.expand-backdrop.open{opacity:1;pointer-events:auto;}
.expand-panel{
  position:fixed;bottom:0;left:0;right:0;z-index:8001;
  max-height:85vh;overflow-y:auto;-webkit-overflow-scrolling:touch;
  background:rgba(18,18,24,.98);
  border-top:1px solid rgba(255,255,255,.08);
  border-radius:clamp(20px,5vw,28px) clamp(20px,5vw,28px) 0 0;
  box-shadow:0 -8px 40px rgba(0,0,0,.5);
  transform:translateY(100%);transition:transform .4s cubic-bezier(.4,0,.2,1);
  padding-bottom:env(safe-area-inset-bottom,20px);
}
.expand-panel.open{transform:translateY(0);}
.expand-handle{
  width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,.15);
  margin:10px auto 0;
}
.expand-img{width:100%;aspect-ratio:16/9;object-fit:cover;margin-top:12px;}
.expand-body{padding:clamp(16px,4vw,24px);}
.expand-source{
  font-size:clamp(10px,2.2vw,12px);font-weight:700;letter-spacing:.1em;
  text-transform:uppercase;margin-bottom:8px;
}
.expand-title{
  font-size:clamp(20px,5.5vw,26px);font-weight:800;line-height:1.3;
  color:#f0f0f5;margin-bottom:10px;
}
.expand-time{font-size:clamp(11px,2.4vw,13px);color:rgba(255,255,255,.3);margin-bottom:16px;}
.expand-desc{
  font-size:clamp(14px,3.5vw,16px);line-height:1.65;
  color:rgba(255,255,255,.6);margin-bottom:20px;
}
.expand-link{
  display:inline-block;padding:10px 20px;border-radius:100px;
  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
  color:#f0f0f5;font-size:clamp(12px,2.8vw,14px);font-weight:600;
  text-decoration:none;transition:all .25s;
}
.expand-link:active{background:rgba(255,255,255,.12);transform:scale(.96);}

/* ── Skeleton ── */
.sk{background:linear-gradient(90deg,rgba(255,255,255,.03) 25%,rgba(255,255,255,.06) 50%,rgba(255,255,255,.03) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:8px;}

/* ── Settings panel ── */
.settings-overlay{
  position:fixed;inset:0;background:rgba(8,8,13,.9);
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  z-index:9000;display:none;animation:fadeIn .25s ease;
}
.settings-overlay.open{display:flex;align-items:center;justify-content:center;}
.settings-panel{
  background:rgba(18,18,24,.98);border:1px solid rgba(255,255,255,.08);
  border-radius:clamp(20px,5vw,28px);width:calc(100% - 32px);max-width:440px;
  max-height:80vh;overflow-y:auto;padding:clamp(20px,5vw,28px);
  box-shadow:0 24px 80px rgba(0,0,0,.6);
}
.settings-panel h2{font-size:clamp(18px,4.5vw,22px);font-weight:800;margin-bottom:4px;color:#f0f0f5;}
.settings-panel .sub{font-size:clamp(11px,2.5vw,13px);color:rgba(255,255,255,.35);margin-bottom:clamp(14px,3vw,20px);}
.feed-item{
  display:flex;align-items:center;gap:10px;padding:12px 14px;
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.04);
  border-radius:14px;margin-bottom:8px;transition:all .2s;
}
.feed-item:active{background:rgba(255,255,255,.06);}
.feed-toggle{
  width:40px;height:24px;border-radius:12px;
  background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);
  cursor:pointer;position:relative;transition:all .3s cubic-bezier(.4,0,.2,1);flex-shrink:0;
}
.feed-toggle.on{background:rgba(100,200,160,.25);border-color:rgba(100,200,160,.4);}
.feed-toggle .knob{
  position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:8px;
  background:rgba(255,255,255,.4);transition:all .3s cubic-bezier(.4,0,.2,1);
}
.feed-toggle.on .knob{left:19px;background:rgba(100,200,160,.9);}
.feed-name{flex:1;font-size:clamp(13px,3vw,15px);font-weight:600;color:#f0f0f5;}
.feed-url{font-size:clamp(9px,2vw,10px);color:rgba(255,255,255,.2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;}
.feed-remove{
  background:none;border:none;color:rgba(255,80,80,.5);cursor:pointer;
  font-size:16px;padding:4px;transition:color .2s;flex-shrink:0;
}
.feed-remove:active{color:rgba(255,80,80,.9);}
.add-feed{display:flex;gap:8px;margin-top:12px;}
.add-feed input{
  flex:1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);
  border-radius:12px;padding:10px 14px;font-size:clamp(12px,2.8vw,14px);
  color:#f0f0f5;outline:none;font-family:inherit;transition:border-color .2s;
}
.add-feed input::placeholder{color:rgba(255,255,255,.2);}
.add-feed input:focus{border-color:rgba(255,255,255,.15);}
.add-feed button{
  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
  border-radius:12px;padding:10px 18px;color:#f0f0f5;
  font-size:clamp(12px,2.8vw,14px);font-weight:600;cursor:pointer;transition:all .2s;
}
.add-feed button:active{background:rgba(255,255,255,.12);transform:scale(.96);}
.settings-actions{display:flex;gap:8px;margin-top:16px;justify-content:space-between;}
.settings-actions button{
  border-radius:12px;padding:10px 18px;font-size:clamp(12px,2.8vw,14px);
  font-weight:600;cursor:pointer;transition:all .25s;border:1px solid;
}
.btn-reset{background:rgba(255,80,80,.08);border-color:rgba(255,80,80,.2);color:rgba(255,80,80,.7);}
.btn-reset:active{background:rgba(255,80,80,.15);}
.btn-done{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.1);color:#f0f0f5;}
.btn-done:active{background:rgba(255,255,255,.12);}

/* ── Footer ── */
.footer{text-align:center;padding:clamp(12px,3vw,20px) 0;}
.footer-text{font-size:clamp(9px,2vw,11px);color:rgba(255,255,255,.15);letter-spacing:.05em;}

/* ── Error state ── */
.error-state{text-align:center;padding:clamp(40px,10vw,60px) 20px;}

/* ── Utility ── */
a{color:inherit;text-decoration:none;}
</style>
</head><body>
<div class="wonder-app-managed" style="width:100%;height:100%;">
${closeButtonHTML()}

<!-- Pull to refresh indicator -->
<div id="ptr-indicator"><div id="ptr-spinner"></div></div>

<!-- Scroll root -->
<div id="scroll-root">
  <!-- Header -->
  <div class="news-header">
    <div class="news-title">The News</div>
    <div class="header-actions">
      <span class="refresh-indicator" id="refresh-ind">●</span>
      <div class="btn-glass" id="btn-refresh" title="Refresh">↻</div>
      <div class="btn-glass" id="btn-settings" title="Settings">⚙</div>
    </div>
  </div>

  <!-- Category pills -->
  <div class="pills-row" id="pills"></div>

  <!-- Content -->
  <div id="content-area">
    <!-- Skeleton loading -->
    <div id="skeleton">
      <div style="border-radius:20px;overflow:hidden;margin-bottom:20px;">
        <div class="sk" style="width:100%;aspect-ratio:16/10;"></div>
        <div style="padding:16px;display:flex;flex-direction:column;gap:8px;">
          <div class="sk" style="width:25%;height:10px;"></div>
          <div class="sk" style="width:90%;height:20px;"></div>
          <div class="sk" style="width:60%;height:20px;"></div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:2px;">
        <div style="display:flex;gap:14px;padding:14px;"><div class="sk" style="width:80px;height:80px;border-radius:12px;flex-shrink:0;"></div><div style="flex:1;display:flex;flex-direction:column;gap:6px;justify-content:center;"><div class="sk" style="width:30%;height:9px;"></div><div class="sk" style="width:85%;height:14px;"></div><div class="sk" style="width:55%;height:14px;"></div></div></div>
        <div style="display:flex;gap:14px;padding:14px;"><div class="sk" style="width:80px;height:80px;border-radius:12px;flex-shrink:0;"></div><div style="flex:1;display:flex;flex-direction:column;gap:6px;justify-content:center;"><div class="sk" style="width:22%;height:9px;"></div><div class="sk" style="width:75%;height:14px;"></div><div class="sk" style="width:45%;height:14px;"></div></div></div>
        <div style="display:flex;gap:14px;padding:14px;"><div class="sk" style="width:80px;height:80px;border-radius:12px;flex-shrink:0;"></div><div style="flex:1;display:flex;flex-direction:column;gap:6px;justify-content:center;"><div class="sk" style="width:28%;height:9px;"></div><div class="sk" style="width:80%;height:14px;"></div><div class="sk" style="width:50%;height:14px;"></div></div></div>
      </div>
    </div>
    <!-- Rendered content inserted here -->
    <div id="cards"></div>
    <div class="footer" id="footer"></div>
  </div>
</div>

<!-- Expanded card overlay -->
<div class="expand-backdrop" id="expand-backdrop"></div>
<div class="expand-panel" id="expand-panel">
  <div class="expand-handle"></div>
  <div id="expand-content"></div>
</div>

<!-- Settings overlay -->
<div class="settings-overlay" id="settings-overlay">
  <div class="settings-panel">
    <h2>Feed Settings</h2>
    <div class="sub">Customize your news sources</div>
    <div id="feed-list"></div>
    <div class="add-feed">
      <input type="text" id="add-url" placeholder="Paste RSS feed URL…"/>
      <button onclick="addFeed()">+ Add</button>
    </div>
    <div class="settings-actions">
      <button class="btn-reset" onclick="resetFeeds()">Reset Defaults</button>
      <button class="btn-done" onclick="closeSettings()">Done</button>
    </div>
  </div>
</div>

<script>
(function(){
  /* ── State ── */
  var allItems = [];
  var allSources = [];
  var currentFilter = 'all';
  var lastFetchedAt = null;
  var expandedItem = null;

  /* ── Source colors ── */
  var sourceColors = {
    'NY Times':'#a0a0a0','NYT':'#a0a0a0','New York Times':'#a0a0a0',
    'BBC News':'#bb1919','BBC':'#bb1919',
    'The Verge':'#e040a0','Verge':'#e040a0',
    'Ars Technica':'#ff6600','Ars':'#ff6600',
    'Reuters':'#ff8000',
    'TechCrunch':'#0a9e01',
    'Wired':'#bababa',
    'The Guardian':'#1a73e8',
    'AP News':'#e03030',
    'NPR':'#3d85c6',
    'CNN':'#cc0000',
    'Al Jazeera':'#ff6600',
    'Hacker News':'#ff6600'
  };
  function srcColor(s){
    if(!s)return 'rgba(255,255,255,.35)';
    for(var k in sourceColors){if(s.indexOf(k)!==-1)return sourceColors[k];}
    var h=0;for(var i=0;i<s.length;i++){h=s.charCodeAt(i)+((h<<5)-h);}
    return 'hsl('+(Math.abs(h)%360)+',45%,60%)';
  }

  /* ── Utils ── */
  function timeAgo(d){
    if(!d||isNaN(d.getTime()))return '';
    var s=Math.floor((Date.now()-d.getTime())/1000);
    if(s<0)s=0;
    if(s<60)return 'just now';
    if(s<3600)return Math.floor(s/60)+'m ago';
    if(s<86400)return Math.floor(s/3600)+'h ago';
    return Math.floor(s/86400)+'d ago';
  }
  function esc(s){
    if(!s)return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function proxyImg(url){
    if(!url)return '';
    return '/api/image-proxy?url='+encodeURIComponent(url);
  }

  /* ── Pull to refresh ── */
  (function initPTR(){
    var scrollEl=document.getElementById('scroll-root');
    var ptrEl=document.getElementById('ptr-indicator');
    var startY=0,pulling=false,triggered=false;
    scrollEl.addEventListener('touchstart',function(e){
      if(scrollEl.scrollTop<=0){startY=e.touches[0].clientY;pulling=true;triggered=false;}
    },{passive:true});
    scrollEl.addEventListener('touchmove',function(e){
      if(!pulling)return;
      var dy=e.touches[0].clientY-startY;
      if(dy>0&&dy<120){
        var progress=Math.min(dy/80,1);
        ptrEl.style.opacity=String(progress);
        ptrEl.style.transform='translateY('+(dy*0.4-20)+'px)';
      }
      if(dy>80&&!triggered){triggered=true;}
    },{passive:true});
    scrollEl.addEventListener('touchend',function(){
      pulling=false;
      ptrEl.style.opacity='0';
      ptrEl.style.transform='translateY(-20px)';
      if(triggered){loadNews();}
    },{passive:true});
  })();

  /* ── Fetch & render ── */
  function loadNews(){
    var indEl=document.getElementById('refresh-ind');
    if(indEl){indEl.style.opacity='1';indEl.style.animation='spin .6s linear infinite';}
    fetch('/api/news/feed',{signal:AbortSignal.timeout(10000)})
      .then(function(r){return r.json();})
      .then(function(data){
        allItems=[];
        if(data.items&&data.items.length){
          data.items.forEach(function(it){
            allItems.push({
              title:it.title||'',link:it.link||'',desc:it.description||'',
              date:it.pubDate?new Date(it.pubDate):new Date(),
              img:it.image||'',source:it.source||'Unknown'
            });
          });
        }
        allSources=Array.from(new Set(allItems.map(function(i){return i.source;})));
        lastFetchedAt=data.fetchedAt?new Date(data.fetchedAt):new Date();
        buildPills();
        render();
        var sk=document.getElementById('skeleton');
        if(sk)sk.style.display='none';
        if(indEl){indEl.style.animation='breathe 3s ease infinite';}
      })
      .catch(function(err){
        console.error('[PearlOS News] Failed to fetch news feed:', err);
        renderError();
        var sk=document.getElementById('skeleton');
        if(sk)sk.style.display='none';
        if(indEl){indEl.style.animation='breathe 3s ease infinite';}
      });
  }

  /* ── Category pills ── */
  function buildPills(){
    var el=document.getElementById('pills');
    var html='<div class="pill'+(currentFilter==='all'?' active':'')+'" data-filter="all">All</div>';
    allSources.forEach(function(src){
      html+='<div class="pill'+(currentFilter===src?' active':'')+'" data-filter="'+esc(src)+'">'+esc(src)+'</div>';
    });
    el.innerHTML=html;
    el.querySelectorAll('.pill').forEach(function(p){
      p.addEventListener('click',function(){
        var f=this.getAttribute('data-filter');
        if(f===currentFilter)return;
        currentFilter=f;
        buildPills();
        var ca=document.getElementById('content-area');
        ca.classList.add('switching');
        setTimeout(function(){render();ca.classList.remove('switching');},150);
      });
    });
  }

  /* ── Render ── */
  function render(){
    var filtered=currentFilter==='all'?allItems:allItems.filter(function(i){return i.source===currentFilter;});
    filtered.sort(function(a,b){return b.date-a.date;});
    var items=filtered.slice(0,20);
    if(!items.length){renderError();return;}

    var html='';
    var hero=items[0];
    var rest=items.slice(1);

    html+='<div class="hero-card" data-idx="0">';
    if(hero.img){
      html+='<div class="hero-img-wrap"><img class="hero-img" src="'+proxyImg(hero.img)+'" alt="" loading="eager" onerror="this.parentElement.style.display=\\'none\\'"/><div class="hero-gradient"></div></div>';
    }
    html+='<div class="hero-body">';
    html+='<div class="hero-source" style="color:'+srcColor(hero.source)+'">'+esc(hero.source)+'</div>';
    html+='<div class="hero-title">'+esc(hero.title)+'</div>';
    html+='<div class="hero-time">'+timeAgo(hero.date)+'</div>';
    html+='</div></div>';

    if(rest.length){
      html+='<div class="section-label">More Stories</div>';
      html+='<div class="card-river">';
      rest.forEach(function(item,idx){
        var delay=((idx+1)*0.04).toFixed(2);
        html+='<div class="story-card" data-idx="'+(idx+1)+'" style="animation-delay:'+delay+'s">';
        if(item.img){
          html+='<img class="story-thumb" src="'+proxyImg(item.img)+'" alt="" loading="'+(idx<4?'eager':'lazy')+'" onerror="this.style.display=\\'none\\'"/>';
        }
        html+='<div class="story-body">';
        html+='<div class="story-source" style="color:'+srcColor(item.source)+'">'+esc(item.source)+'</div>';
        html+='<div class="story-title">'+esc(item.title)+'</div>';
        html+='<div class="story-time">'+timeAgo(item.date)+'</div>';
        html+='</div></div>';
      });
      html+='</div>';
    }

    document.getElementById('cards').innerHTML=html;

    document.querySelectorAll('.hero-card,.story-card').forEach(function(card){
      card.addEventListener('click',function(e){
        e.preventDefault();
        var idx=parseInt(this.getAttribute('data-idx'),10);
        var filtered2=currentFilter==='all'?allItems:allItems.filter(function(i){return i.source===currentFilter;});
        filtered2.sort(function(a,b){return b.date-a.date;});
        var item=filtered2[idx];
        if(item)expandCard(item);
      });
    });

    var srcCount=new Set(items.map(function(i){return i.source;})).size;
    document.getElementById('footer').innerHTML='<div class="footer-text">'+items.length+' stories · '+srcCount+' source'+(srcCount!==1?'s':'')+(lastFetchedAt?' · Updated '+formatTime(lastFetchedAt):'')+'</div>';
  }

  function formatTime(d){
    var h=d.getHours(),m=d.getMinutes(),ap=h>=12?'PM':'AM';
    h=h%12;if(h===0)h=12;
    return h+':'+(m<10?'0':'')+m+' '+ap;
  }

  function renderError(){
    document.getElementById('cards').innerHTML='<div class="error-state"><div style="font-size:clamp(44px,12vw,60px);margin-bottom:16px;opacity:.6;">📰</div><div style="color:#f0f0f5;font-size:clamp(16px,4vw,20px);font-weight:700;margin-bottom:8px;">No stories available</div><div style="color:rgba(255,255,255,.35);font-size:clamp(13px,3vw,15px);margin-bottom:24px;line-height:1.5;">Check your feed settings or try again</div><button onclick="loadNews()" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:100px;padding:12px 28px;color:#f0f0f5;font-size:clamp(13px,3vw,15px);font-weight:600;cursor:pointer;transition:all .2s;">↻ Retry</button></div>';
    document.getElementById('footer').innerHTML='';
  }

  /* ── Expand / collapse ── */
  function expandCard(item){
    expandedItem=item;
    var html='';
    if(item.img){
      html+='<img class="expand-img" src="'+proxyImg(item.img)+'" alt="" onerror="this.style.display=\\'none\\'"/>';
    }
    html+='<div class="expand-body">';
    html+='<div class="expand-source" style="color:'+srcColor(item.source)+'">'+esc(item.source)+'</div>';
    html+='<div class="expand-title">'+esc(item.title)+'</div>';
    html+='<div class="expand-time">'+timeAgo(item.date)+'</div>';
    if(item.desc)html+='<div class="expand-desc">'+esc(item.desc)+'</div>';
    if(item.link)html+='<a class="expand-link" href="'+esc(item.link)+'" target="_blank" rel="noopener">Read full story ↗</a>';
    html+='</div>';
    document.getElementById('expand-content').innerHTML=html;
    document.getElementById('expand-backdrop').classList.add('open');
    document.getElementById('expand-panel').classList.add('open');
    document.body.style.overflow='hidden';
  }
  function collapseCard(){
    document.getElementById('expand-backdrop').classList.remove('open');
    document.getElementById('expand-panel').classList.remove('open');
    document.body.style.overflow='';
    expandedItem=null;
  }
  document.getElementById('expand-backdrop').addEventListener('click',collapseCard);
  (function(){
    var panel=document.getElementById('expand-panel');
    var sy=0,dragging=false;
    panel.addEventListener('touchstart',function(e){
      if(panel.scrollTop<=0){sy=e.touches[0].clientY;dragging=true;}
    },{passive:true});
    panel.addEventListener('touchmove',function(e){
      if(!dragging)return;
      var dy=e.touches[0].clientY-sy;
      if(dy>0){panel.style.transform='translateY('+dy+'px)';panel.style.transition='none';}
    },{passive:true});
    panel.addEventListener('touchend',function(e){
      if(!dragging)return;dragging=false;
      panel.style.transition='transform .4s cubic-bezier(.4,0,.2,1)';
      var dy=parseInt(panel.style.transform.replace(/[^0-9-]/g,'')||'0',10);
      if(dy>80){collapseCard();}else{panel.style.transform=panel.classList.contains('open')?'translateY(0)':'translateY(100%)';}
    },{passive:true});
  })();

  /* ── Settings panel ── */
  document.getElementById('btn-settings').addEventListener('click',function(){
    document.getElementById('settings-overlay').classList.add('open');
    loadSettingsUI();
  });
  window.closeSettings=function(){
    document.getElementById('settings-overlay').classList.remove('open');
    loadNews();
  };
  window.openSettings=function(){
    document.getElementById('settings-overlay').classList.add('open');
    loadSettingsUI();
  };
  function loadSettingsUI(){
    fetch('/api/news/config')
      .then(function(r){return r.json();})
      .then(function(cfg){renderFeedList(cfg.feeds||[]);})
      .catch(function(){renderFeedList([]);});
  }
  function renderFeedList(feeds){
    var el=document.getElementById('feed-list');
    if(!feeds.length){
      el.innerHTML='<div style="text-align:center;padding:16px;color:rgba(255,255,255,.35);font-size:13px;">No feeds configured</div>';
      return;
    }
    var html='';
    feeds.forEach(function(f){
      html+='<div class="feed-item">';
      html+='<div class="feed-toggle'+(f.enabled?' on':'')+'" onclick="toggleFeed(\\''+esc(f.url)+'\\')" title="Toggle feed"><div class="knob"></div></div>';
      html+='<div style="flex:1;min-width:0;"><div class="feed-name">'+esc(f.name)+'</div><div class="feed-url">'+esc(f.url)+'</div></div>';
      html+='<button class="feed-remove" onclick="removeFeed(\\''+esc(f.url)+'\\')">✕</button>';
      html+='</div>';
    });
    el.innerHTML=html;
  }
  window.toggleFeed=function(url){
    fetch('/api/news/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'toggle',feed:{url:url}})})
      .then(function(r){return r.json();}).then(function(cfg){renderFeedList(cfg.feeds||[]);});
  };
  window.removeFeed=function(url){
    fetch('/api/news/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'remove',feed:{url:url}})})
      .then(function(r){return r.json();}).then(function(cfg){renderFeedList(cfg.feeds||[]);});
  };
  window.addFeed=function(){
    var inp=document.getElementById('add-url');var url=inp.value.trim();if(!url)return;
    var name='Custom Feed';
    try{var h=new URL(url).hostname.replace('www.','').replace('feeds.','').replace('rss.','');name=h.split('.')[0];name=name.charAt(0).toUpperCase()+name.slice(1);}catch(e){}
    fetch('/api/news/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'add',feed:{url:url,name:name,enabled:true}})})
      .then(function(r){return r.json();}).then(function(cfg){renderFeedList(cfg.feeds||[]);inp.value='';});
  };
  window.resetFeeds=function(){
    fetch('/api/news/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reset'})})
      .then(function(r){return r.json();}).then(function(cfg){renderFeedList(cfg.feeds||[]);});
  };
  document.getElementById('settings-overlay').addEventListener('click',function(e){
    if(e.target===this)closeSettings();
  });

  /* ── Button handlers ── */
  document.getElementById('btn-refresh').addEventListener('click',function(){loadNews();});

  /* ── Init ── */
  loadNews();
  setInterval(function(){loadNews();},300000);
})();
</script>
</div><!-- /.wonder-app-managed -->
</body></html>`;
}
