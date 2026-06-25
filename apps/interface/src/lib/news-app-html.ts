/**
 * PearlOS News App — Hero + Grid Layout
 *
 * Layout: horizontal swipe between category pages. Each page has a hero card
 * (full-width photo with overlay text) and a two-column grid of story cards
 * (thumbnail left, text right). Dark background, glassmorphism cards.
 */

// closeButtonHTML import removed — WonderCanvasRenderer provides the React-level close button for all scenes.

export function buildNewsHTML(initialCategory?: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
html,body{width:100%;height:100%;overflow:hidden;background:var(--pearl-stage-bg,#0d0d0d);color:var(--pearl-text,#fff);
  font-family:var(--pearl-ui-font,'Inter',-apple-system,BlinkMacSystemFont,sans-serif);
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}

@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}

.app-shell{position:fixed;inset:0;display:flex;flex-direction:column;overflow:hidden;background:var(--pearl-stage-bg,#0d0d0d);padding-top:env(safe-area-inset-top,0);}

/* ── Top Bar ── */
.top-bar{
  flex-shrink:0;display:flex;align-items:center;justify-content:space-between;
  padding:56px 24px 0;position:relative;z-index:10;
}
.top-bar-left{font-size:15px;font-weight:700;color:var(--pearl-text,#fff);letter-spacing:-.01em;}
.top-bar-center{display:flex;gap:6px;align-items:center;}
.top-bar-right{font-size:12px;color:var(--pearl-muted,rgba(255,255,255,.4));font-weight:400;padding-right:48px;}

.cat-dot{
  width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.2);
  cursor:pointer;transition:all .3s;
}
.cat-dot.active{width:22px;border-radius:4px;background:var(--pearl-accent,#fff);}

/* ── Category Header ── */
.cat-header{
  flex-shrink:0;padding:14px 24px 0;display:flex;align-items:center;justify-content:center;gap:8px;position:relative;
}
.cat-icon{width:24px;height:24px;display:inline-flex;align-items:center;image-rendering:pixelated;}
.cat-name{font-size:22px;font-weight:700;color:var(--pearl-text,#fff);}
.story-count{font-size:12px;color:var(--pearl-muted,rgba(255,255,255,.35));}

/* ── Carousel ── */
.carousel{
  flex:1;overflow-x:auto;overflow-y:hidden;
  scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;
  display:flex;scrollbar-width:none;
}
.carousel::-webkit-scrollbar{display:none}

/* ── Category Page ── */
.cat-page{
  flex:0 0 100%;width:100%;scroll-snap-align:start;
  overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;
  padding:16px 20px 120px;scrollbar-width:none;
}
.cat-page::-webkit-scrollbar{display:none}

/* ── Hero Card ── */
.hero{
  position:relative;width:100%;border-radius:16px;overflow:hidden;
  min-height:280px;display:flex;flex-direction:column;justify-content:flex-end;
  cursor:pointer;margin-bottom:16px;
}
.hero-img{
  position:absolute;inset:0;background-size:cover;background-position:center;
  background-color:#1a1a2e;
}
.hero-img::after{
  content:'';position:absolute;inset:0;
  background:linear-gradient(to top,rgba(0,0,0,.8) 0%,rgba(0,0,0,.2) 50%,transparent 100%);
}
.hero-content{position:relative;z-index:1;padding:24px;}
.hero .source{
  font-size:9px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
  color:var(--pearl-muted,rgba(255,255,255,.3));margin-bottom:6px;
}
.hero .headline{
  font-size:22px;font-weight:700;line-height:1.25;color:var(--pearl-text,#fff);margin-bottom:8px;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;
}
.hero .summary{
  font-size:13px;line-height:1.5;color:var(--pearl-soft,rgba(255,255,255,.55));margin-bottom:10px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}
.hero .time{font-size:11px;color:var(--pearl-muted,rgba(255,255,255,.4));}

/* ── Stories Grid ── */
.stories-grid{
  display:grid;grid-template-columns:1fr 1fr;gap:10px;
}
@media(max-width:600px){
  .stories-grid{grid-template-columns:1fr;}
}

/* ── Story Card ── */
.story{
  display:flex;gap:12px;align-items:flex-start;
  background:var(--pearl-window-content-bg,rgba(255,255,255,.04));border:1px solid var(--pearl-window-border,rgba(255,255,255,.06));
  border-radius:var(--pearl-radius,12px);padding:12px;cursor:pointer;
  transition:background .2s;
}
.story:hover{background:color-mix(in srgb,var(--pearl-accent,#fff),transparent 88%);}
.story-thumb{
  width:80px;height:80px;flex-shrink:0;border-radius:8px;
  object-fit:cover;background:linear-gradient(135deg,#1a1a2e,#16213e);
}
.story-thumb-placeholder{
  width:80px;height:80px;flex-shrink:0;border-radius:8px;
  background:linear-gradient(135deg,#1a1a2e,#16213e);
}
.story-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;}
.story .headline{
  font-size:13px;font-weight:600;line-height:1.35;color:var(--pearl-text,#fff);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}
.story .summary{
  font-size:11px;line-height:1.4;color:var(--pearl-muted,rgba(255,255,255,.4));
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}
.story .meta{
  font-size:10px;color:var(--pearl-muted,rgba(255,255,255,.25));margin-top:auto;
}
.story .meta .src{
  font-size:9px;opacity:.3;text-transform:uppercase;letter-spacing:.05em;
}

/* ── Expanded overlay ── */
.expand-backdrop{
  position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);z-index:8000;opacity:0;
  transition:opacity .3s;pointer-events:none;
}
.expand-backdrop.open{opacity:1;pointer-events:auto;}
.expand-panel{
  position:fixed;bottom:0;left:0;right:0;z-index:8001;max-height:88vh;
  overflow-y:auto;background:var(--pearl-window-bg,#111);border:1px solid var(--pearl-window-border,rgba(255,255,255,.12));border-radius:20px 20px 0 0;
  transform:translateY(100%);transition:transform .35s cubic-bezier(.4,0,.2,1);
  padding-bottom:env(safe-area-inset-bottom,20px);
}
.expand-panel.open{transform:translateY(0);}
.expand-handle{width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,.2);margin:10px auto 0;}
.expand-body{padding:20px 22px 24px;}
.expand-body .source{font-size:9px;opacity:.3;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px;}
.expand-body .title{font-size:22px;font-weight:700;line-height:1.3;color:var(--pearl-text,#fff);margin-bottom:8px;}
.expand-body .time{font-size:11px;color:var(--pearl-muted,rgba(255,255,255,.35));margin-bottom:18px;}
.expand-lede{display:grid;grid-template-columns:minmax(0,1fr) 168px;gap:18px;align-items:start;margin-bottom:18px;}
.expand-img{
  width:168px;aspect-ratio:4/3;object-fit:cover;border-radius:12px;
  background:linear-gradient(135deg,#1a1a2e,#16213e);
}
.expand-body .desc{font-size:14px;line-height:1.65;color:var(--pearl-soft,rgba(255,255,255,.75));margin:0;}
.research-status{
  display:flex;align-items:center;gap:10px;margin:14px 0 16px;
  font-size:12px;color:var(--pearl-muted,rgba(255,255,255,.45));
}
.research-status::before{
  content:'';width:8px;height:8px;border-radius:50%;background:var(--pearl-accent,#fff);
  animation:pulse 1.1s ease-in-out infinite;
}
@keyframes pulse{0%,100%{opacity:.25;transform:scale(.85)}50%{opacity:.8;transform:scale(1)}}
.article-text{
  font-size:14px;line-height:1.72;color:var(--pearl-soft,rgba(255,255,255,.78));
  border-top:1px solid var(--pearl-window-border,rgba(255,255,255,.08));padding-top:16px;
}
.article-text p{margin:0 0 14px;}
.article-text p:last-child{margin-bottom:0;}
.article-meta{
  font-size:12px;line-height:1.5;color:var(--pearl-muted,rgba(255,255,255,.42));margin:0 0 14px;
}
.expand-link{
  display:inline-block;margin-top:18px;padding:10px 20px;border-radius:100px;
  background:color-mix(in srgb,var(--pearl-accent,#fff),transparent 86%);border:1px solid color-mix(in srgb,var(--pearl-accent,#fff),transparent 60%);
  color:var(--pearl-text,#fff);font-size:13px;font-weight:600;text-decoration:none;transition:background .2s;
}
.expand-link:hover{background:color-mix(in srgb,var(--pearl-accent,#fff),transparent 78%);}
@media(max-width:620px){
  .expand-lede{grid-template-columns:1fr;}
  .expand-img{width:100%;max-height:180px;}
}

/* Skeleton */
.sk{background:linear-gradient(90deg,rgba(255,255,255,.03) 25%,rgba(255,255,255,.07) 50%,rgba(255,255,255,.03) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:8px;}

a{color:inherit;text-decoration:none;}
</style>
</head><body>
<div class="wonder-app-managed" style="width:100%;height:100%;">

<div class="app-shell">
  <div class="top-bar">
    <div class="top-bar-left">PearlOS News</div>
    <div class="top-bar-center" id="cat-dots"></div>
    <div class="top-bar-right" id="story-count"></div>
  </div>
  <div class="cat-header" id="cat-header">
    <span class="cat-icon" id="cat-icon"></span>
    <span class="cat-name" id="cat-name"></span>
  </div>
  <div class="carousel" id="carousel"></div>
</div>

<div class="expand-backdrop" id="expand-backdrop"></div>
<div class="expand-panel" id="expand-panel">
  <div class="expand-handle"></div>
  <div id="expand-content"></div>
</div>

<script>
(function(){
  var INITIAL_CATEGORY=${JSON.stringify(initialCategory || '')};
  var CATEGORIES=['all','general','world','business','entertainment','sports','science','health','technology'];
  var CAT_LABELS={all:'All',general:'General',world:'World',business:'Business',entertainment:'Entertainment',sports:'Sports',science:'Science',health:'Health',technology:'Technology'};
  var CAT_ALIASES={tech:'technology',top:'general','top stories':'general',politics:'general'};
  // Pixel art icons (8x8 grid, rendered as SVG for crispness)
  function px(paths,color){return '<svg viewBox="0 0 8 8" width="24" height="24" style="image-rendering:pixelated;"><style>rect{fill:'+color+';}</style>'+paths+'</svg>';}
  var CAT_ICONS={
    all:px('<rect x="1" y="1" width="3" height="3"/><rect x="5" y="1" width="2" height="2"/><rect x="1" y="5" width="2" height="2"/><rect x="4" y="4" width="3" height="3"/>','#ffffff'),
    general:px('<rect x="1" y="1" width="6" height="1"/><rect x="1" y="3" width="6" height="1"/><rect x="1" y="5" width="4" height="1"/><rect x="1" y="7" width="5" height="1"/>','#f97316'),
    technology:px('<rect x="1" y="1" width="6" height="4"/><rect x="0" y="5" width="8" height="1"/><rect x="3" y="6" width="2" height="1"/>','#FFD233'),
    science:px('<rect x="3" y="0" width="2" height="2"/><rect x="2" y="2" width="4" height="1"/><rect x="3" y="3" width="2" height="2"/><rect x="1" y="5" width="6" height="1"/><rect x="2" y="6" width="4" height="1"/><rect x="1" y="7" width="1" height="1"/><rect x="6" y="7" width="1" height="1"/>','#38bdf8'),
    world:px('<rect x="2" y="0" width="4" height="1"/><rect x="1" y="1" width="6" height="1"/><rect x="0" y="2" width="8" height="4"/><rect x="1" y="6" width="6" height="1"/><rect x="2" y="7" width="4" height="1"/>','#D94F8E'),
    business:px('<rect x="2" y="1" width="4" height="1"/><rect x="1" y="2" width="6" height="5"/><rect x="3" y="0" width="2" height="1"/><rect x="0" y="3" width="8" height="1"/>','#22c55e'),
    entertainment:px('<rect x="1" y="0" width="2" height="2"/><rect x="5" y="0" width="2" height="2"/><rect x="0" y="2" width="8" height="4"/><rect x="1" y="6" width="6" height="1"/><rect x="2" y="7" width="4" height="1"/>','#a78bfa'),
    sports:px('<rect x="2" y="0" width="4" height="1"/><rect x="1" y="1" width="6" height="1"/><rect x="0" y="2" width="8" height="4"/><rect x="1" y="6" width="6" height="1"/><rect x="2" y="7" width="4" height="1"/>','#facc15'),
    health:px('<rect x="3" y="1" width="2" height="1"/><rect x="2" y="2" width="4" height="1"/><rect x="1" y="3" width="6" height="2"/><rect x="2" y="5" width="4" height="1"/><rect x="3" y="6" width="2" height="1"/>','#34d399')
  };
  var allItems=[];
  var grouped={};
  var currentIndex=0;
  var loadError='';

  function timeAgo(d){
    if(!d||isNaN(d.getTime()))return '';
    var s=Math.floor((Date.now()-d.getTime())/1000);
    if(s<0)s=0;if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+'m ago';
    if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';
  }
  function esc(s){
    if(!s)return '';
    var d=document.createElement('div');d.innerHTML=s;
    var t=d.textContent||d.innerText||'';
    return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function proxyImg(url){
    if(!url)return '';
    // Decode HTML entities (&amp; → &) before encoding for the proxy
    var d=document.createElement('div');d.innerHTML=url;
    var clean=d.textContent||d.innerText||url;
    return '/api/image-proxy?url='+encodeURIComponent(clean);
  }

  function updateHeader(){
    var cat=CATEGORIES[currentIndex];
    document.getElementById('cat-icon').innerHTML=CAT_ICONS[cat]||'';
    document.getElementById('cat-name').textContent=CAT_LABELS[cat]||'';
    var count=(grouped[cat]||[]).length;
    document.getElementById('story-count').textContent=count+' stor'+(count===1?'y':'ies');
    // dots
    document.querySelectorAll('.cat-dot').forEach(function(dot,i){
      dot.classList.toggle('active',i===currentIndex);
    });
  }

  function buildDots(){
    var el=document.getElementById('cat-dots');
    el.innerHTML=CATEGORIES.map(function(cat,i){
      return '<div class="cat-dot'+(i===currentIndex?' active':'')+'" data-idx="'+i+'"></div>';
    }).join('');
    el.querySelectorAll('.cat-dot').forEach(function(dot){
      dot.addEventListener('click',function(){
        scrollToIndex(parseInt(this.getAttribute('data-idx'),10));
      });
    });
  }

  function scrollToIndex(idx){
    if(idx<0||idx>=CATEGORIES.length)return;
    var carousel=document.getElementById('carousel');
    carousel.children[idx].scrollIntoView({behavior:'smooth',inline:'start'});
  }

  function scrollToCategory(name){
    var cat=normalizeCategory(name,'all');
    var idx=CATEGORIES.indexOf(cat);
    if(idx>=0)scrollToIndex(idx);
  }
  function normalizeCategory(cat,fallback){
    cat=(cat||'').toString().toLowerCase().trim();
    return CAT_ALIASES[cat]||cat||fallback||'all';
  }
  function mixedItems(items){
    var buckets={};
    CATEGORIES.forEach(function(c){if(c!=='all')buckets[c]=[];});
    items.forEach(function(item){
      var cat=normalizeCategory(item.category,'general');
      if(!buckets[cat])buckets[cat]=[];
      buckets[cat].push(item);
    });
    var mixed=[],added=true;
    while(added){
      added=false;
      CATEGORIES.forEach(function(cat){
        if(cat==='all')return;
        var next=buckets[cat]&&buckets[cat].shift();
        if(next){mixed.push(next);added=true;}
      });
    }
    return mixed;
  }

  function render(){
    grouped={};
    CATEGORIES.forEach(function(c){grouped[c]=[];});
    allItems.forEach(function(item){
      var cat=normalizeCategory(item.category,'general');
      if(grouped[cat])grouped[cat].push(item);
    });
    grouped.all=mixedItems(allItems);

    var carousel=document.getElementById('carousel');
    var html='';
    CATEGORIES.forEach(function(cat){
      var items=grouped[cat];
      html+='<div class="cat-page" id="page-'+cat+'">';
      if(!items.length){
        html+='<div style="text-align:center;padding:60px 20px;color:rgba(255,255,255,.25);font-size:13px;">'+esc(loadError||'No stories yet')+'</div>';
      } else {
        // Hero
        var hero=items[0];
        var heroData=encodeURIComponent(JSON.stringify({title:hero.title,link:hero.link,desc:hero.desc,date:hero.date.toISOString(),img:hero.img,source:hero.source}));
        if(hero.img){
          html+='<div class="hero" data-item="'+heroData+'">';
          html+='<div class="hero-img" style="background-image:url('+proxyImg(hero.img)+')"></div>';
        } else {
          html+='<div class="hero" data-item="'+heroData+'" style="background:linear-gradient(135deg,#1a1a2e,#16213e);min-height:220px;">';
        }
        html+='<div class="hero-content">';
        html+='<div class="source">'+esc(hero.source)+'</div>';
        html+='<div class="headline">'+esc(hero.title)+'</div>';
        if(hero.desc)html+='<div class="summary">'+esc(hero.desc)+'</div>';
        html+='<div class="time">'+timeAgo(hero.date)+'</div>';
        html+='</div></div>';

        // Grid
        if(items.length>1){
          html+='<div class="stories-grid">';
          for(var i=1;i<items.length;i++){
            var it=items[i];
            var itemData=encodeURIComponent(JSON.stringify({title:it.title,link:it.link,desc:it.desc,date:it.date.toISOString(),img:it.img,source:it.source}));
            html+='<div class="story" data-item="'+itemData+'">';
            if(it.img){
              html+='<img class="story-thumb" src="'+proxyImg(it.img)+'" alt="" loading="lazy" onerror="this.style.display=\\'none\\';this.nextElementSibling&&(this.nextElementSibling.style.display=\\'block\\')"/><div class="story-thumb-placeholder" style="display:none"></div>';
            } else {
              html+='<div class="story-thumb-placeholder"></div>';
            }
            html+='<div class="story-body">';
            html+='<div class="headline">'+esc(it.title)+'</div>';
            if(it.desc)html+='<div class="summary">'+esc(it.desc)+'</div>';
            html+='<div class="meta"><span class="src">'+esc(it.source)+'</span> · '+timeAgo(it.date)+'</div>';
            html+='</div></div>';
          }
          html+='</div>';
        }
      }
      html+='</div>';
    });
    carousel.innerHTML=html;

    // Click handlers
    carousel.querySelectorAll('.hero, .story').forEach(function(card){
      card.addEventListener('click',function(e){
        e.preventDefault();
        try{
          var item=JSON.parse(decodeURIComponent(this.getAttribute('data-item')));
          item.date=new Date(item.date);
          expandCard(item);
        }catch(err){}
      });
    });

    buildDots();
    updateHeader();
  }

  // Scroll observer
  function initScrollObserver(){
    var carousel=document.getElementById('carousel');
    var ticking=false;
    carousel.addEventListener('scroll',function(){
      if(!ticking){requestAnimationFrame(function(){
        var w=carousel.offsetWidth;
        var idx=Math.round(carousel.scrollLeft/w);
        if(idx!==currentIndex&&idx>=0&&idx<CATEGORIES.length){currentIndex=idx;updateHeader();}
        ticking=false;
      });ticking=true;}
    },{passive:true});
  }

  // Expand/collapse
  function expandCard(item){
    var html='';
    html+='<div class="expand-body">';
    html+='<div class="source">'+esc(item.source)+'</div>';
    html+='<div class="title">'+esc(item.title)+'</div>';
    html+='<div class="time">'+timeAgo(item.date)+'</div>';
    html+='<div class="expand-lede">';
    html+='<div>';
    if(item.desc)html+='<p class="desc">'+esc(item.desc)+'</p>';
    html+='</div>';
    if(item.img)html+='<img class="expand-img" src="'+proxyImg(item.img)+'" alt="" onerror="this.style.display=\\'none\\'"/>';
    html+='</div>';
    html+='<div id="expand-research">';
    if(item.link){
      html+='<div class="research-status">Pearl is reading the story online</div>';
    } else {
      html+='<div class="article-text"><p>No article link was provided by this feed.</p></div>';
    }
    html+='</div>';
    if(item.link)html+='<a class="expand-link" href="'+esc(item.link)+'" target="_blank" rel="noopener">Read full story ↗</a>';
    html+='</div>';
    document.getElementById('expand-content').innerHTML=html;
    document.getElementById('expand-backdrop').classList.add('open');
    document.getElementById('expand-panel').classList.add('open');
    if(item.link)loadStoryDetails(item);
  }
  function collapseCard(){
    document.getElementById('expand-backdrop').classList.remove('open');
    document.getElementById('expand-panel').classList.remove('open');
  }
  document.getElementById('expand-backdrop').addEventListener('click',collapseCard);

  function paragraphsFromText(text){
    if(!text)return [];
    return text
      .replace(/\\s+/g,' ')
      .split(/(?<=[.!?])\\s+(?=[A-Z0-9"'])/)
      .reduce(function(acc,sentence){
        var last=acc[acc.length-1]||'';
        if(!last||last.length>420)acc.push(sentence);
        else acc[acc.length-1]=last+' '+sentence;
        return acc;
      },[])
      .filter(function(p){return p.trim().length>40;})
      .slice(0,8);
  }

  function renderStoryDetails(data,item){
    var target=document.getElementById('expand-research');
    if(!target)return;
    var text=(data&&data.textContent)||'';
    var paragraphs=(data&&Array.isArray(data.paragraphs)&&data.paragraphs.length)?data.paragraphs:paragraphsFromText(text);
    var meta=[];
    if(data&&data.siteName)meta.push(data.siteName);
    if(data&&data.byline)meta.push(data.byline);
    var html='';
    if(meta.length)html+='<div class="article-meta">'+esc(meta.join(' · '))+'</div>';
    if(paragraphs.length){
      html+='<div class="article-text">';
      paragraphs.forEach(function(p){html+='<p>'+esc(p)+'</p>';});
      html+='</div>';
    } else if(data&&data.excerpt){
      html+='<div class="article-text"><p>'+esc(data.excerpt)+'</p></div>';
    } else if(item.desc){
      html+='<div class="article-text"><p>'+esc(item.desc)+'</p></div>';
    } else {
      html+='<div class="article-text"><p>Pearl could not extract more readable text from this source.</p></div>';
    }
    target.innerHTML=html;
  }

  function loadStoryDetails(item){
    fetch('/api/mini-browser/readability',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({url:item.link})
    })
      .then(function(r){
        if(!r.ok)throw new Error('Readability returned HTTP '+r.status);
        return r.json();
      })
      .then(function(data){renderStoryDetails(data,item);})
      .catch(function(){
        var target=document.getElementById('expand-research');
        if(!target)return;
        var fallback=item.desc?'<p>'+esc(item.desc)+'</p>':'<p>Pearl could not extract more readable text from this source.</p>';
        target.innerHTML='<div class="article-text">'+fallback+'</div>';
      });
  }

  function fetchJson(url,timeoutMs){
    var controller=null;
    var timer=null;
    var options={};
    if(typeof AbortController!=='undefined'){
      controller=new AbortController();
      options.signal=controller.signal;
      timer=setTimeout(function(){controller.abort();},timeoutMs);
    }
    return fetch(url,options).then(function(r){
      if(timer)clearTimeout(timer);
      if(!r.ok)throw new Error('News feed returned HTTP '+r.status);
      return r.json();
    },function(err){
      if(timer)clearTimeout(timer);
      throw err;
    });
  }

  // Swipe-to-dismiss expand panel
  (function(){
    var panel=document.getElementById('expand-panel');
    var sy=0,dragging=false;
    panel.addEventListener('touchstart',function(e){if(panel.scrollTop<=0){sy=e.touches[0].clientY;dragging=true;}},{passive:true});
    panel.addEventListener('touchmove',function(e){if(!dragging)return;var dy=e.touches[0].clientY-sy;if(dy>0){panel.style.transform='translateY('+dy+'px)';panel.style.transition='none';}},{passive:true});
    panel.addEventListener('touchend',function(){if(!dragging)return;dragging=false;panel.style.transition='transform .35s cubic-bezier(.4,0,.2,1)';var dy=parseInt(panel.style.transform.replace(/[^0-9-]/g,'')||'0',10);if(dy>80)collapseCard();else panel.style.transform=panel.classList.contains('open')?'translateY(0)':'translateY(100%)';},{passive:true});
  })();

  // PostMessage control
  window.addEventListener('message',function(e){
    if(!e.data||e.data.type!=='news-navigate')return;
    if(e.data.category){scrollToCategory(e.data.category);return;}
    if(e.data.direction==='left')scrollToIndex(currentIndex-1);
    else if(e.data.direction==='right')scrollToIndex(currentIndex+1);
  });

  // Fetch
  function loadNews(){
    fetchJson('/api/news/feed',12000)
      .then(function(data){
        loadError='';
        allItems=[];
        if(data.items&&data.items.length){
          data.items.forEach(function(it){
            allItems.push({
              title:it.title||'',link:it.link||'',desc:it.description||'',
              date:it.pubDate?new Date(it.pubDate):new Date(),
              img:it.image||'',source:it.source||'Unknown',
              category:normalizeCategory(it.category,'general')
            });
          });
        }
        render();
        initScrollObserver();
        if(INITIAL_CATEGORY){scrollToCategory(INITIAL_CATEGORY);INITIAL_CATEGORY='';}
      })
      .catch(function(err){
        console.error('[PearlOS News]',err);
        loadError='News is having trouble loading.';
        render();
      });
  }

  loadNews();
  setInterval(loadNews,300000);
})();
</script>
</div>
</body></html>`;
}
