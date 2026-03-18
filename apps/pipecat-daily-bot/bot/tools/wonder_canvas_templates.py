"""
Wonder Canvas Template Library
==============================
Pre-built HTML templates for fast visual content delivery.
Use render_template(name, **kwargs) to populate templates with data.
"""

TEMPLATE_DEFAULTS = {}
TEMPLATE_DESCRIPTIONS = {}

# ---------------------------------------------------------------------------
# Helper: register a template with defaults and description
# ---------------------------------------------------------------------------
TEMPLATES = {}


def _reg(name, desc, html, defaults=None):
    TEMPLATES[name] = html
    TEMPLATE_DESCRIPTIONS[name] = desc
    TEMPLATE_DEFAULTS[name] = defaults or {}


# ---------------------------------------------------------------------------
# COMMON STYLES — Premium Design System
# ---------------------------------------------------------------------------
_FONTS = """<meta name="viewport" content="width=device-width,initial-scale=1"><div data-wonder-app-managed style="display:none"></div><style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');</style>"""

_BASE_CSS = _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg-deep:#0d0d1a;--bg-card:rgba(18,18,35,0.92);--bg-glass:rgba(255,255,255,0.04);
  --c-gold:#e8c547;--c-rose:#d94f8e;--c-violet:#8b5cf6;--c-sky:#38bdf8;
  --c-emerald:#34d399;--c-amber:#fbbf24;--c-text:#f0ece4;--c-muted:rgba(240,236,228,0.4);
  --font-display:'Plus Jakarta Sans','Inter',sans-serif;
  --font-body:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;
  --font-title:'Space Grotesk','Inter',sans-serif;
  --font-mono:'JetBrains Mono',monospace;
  --radius:16px;--radius-sm:10px;
}
body{font-family:var(--font-body);background:var(--bg-deep);color:var(--c-text);
min-height:100vh;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
-webkit-font-smoothing:antialiased;overflow-x:hidden}

/* Animations */
@keyframes wonder-fadeIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes wonder-fadeUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
@keyframes wonder-scaleIn{from{opacity:0;transform:scale(0.92)}to{opacity:1;transform:scale(1)}}
@keyframes wonder-slideLeft{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
@keyframes wonder-pulse{0%,100%{opacity:1}50%{opacity:0.6}}
@keyframes wonder-glow{0%,100%{filter:brightness(1)}50%{filter:brightness(1.3)}}
@keyframes wonder-bounce{0%{transform:scale(0.3);opacity:0}50%{transform:scale(1.08)}70%{transform:scale(0.95)}100%{transform:scale(1);opacity:1}}
@keyframes wonder-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes wonder-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes wonder-breathe{0%,100%{opacity:0.4}50%{opacity:0.8}}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}

.anim-fade{animation:wonder-fadeIn 0.7s cubic-bezier(0.22,1,0.36,1) both}
.anim-fade-1{animation:wonder-fadeUp 0.6s 0.1s cubic-bezier(0.22,1,0.36,1) both}
.anim-fade-2{animation:wonder-fadeUp 0.6s 0.25s cubic-bezier(0.22,1,0.36,1) both}
.anim-fade-3{animation:wonder-fadeUp 0.6s 0.4s cubic-bezier(0.22,1,0.36,1) both}
.anim-fade-4{animation:wonder-fadeUp 0.6s 0.55s cubic-bezier(0.22,1,0.36,1) both}
.anim-scale{animation:wonder-scaleIn 0.5s cubic-bezier(0.22,1,0.36,1) both}
.anim-float{animation:wonder-float 4s ease-in-out infinite}

/* Card System */
.card{width:100%;max-width:560px;background:var(--bg-card);
border-radius:var(--radius);padding:clamp(28px,4vw,40px);
backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.06);
box-shadow:0 8px 32px rgba(0,0,0,0.3),0 1px 0 rgba(255,255,255,0.05) inset;
animation:wonder-fadeIn 0.7s cubic-bezier(0.22,1,0.36,1)}

/* Typography */
.t-display{font-family:var(--font-display);font-weight:800;line-height:1.15;color:#fff;
font-size:clamp(26px,6.5vw,38px);letter-spacing:-0.02em}
.t-title{font-family:var(--font-title);font-weight:600;font-size:clamp(18px,4.5vw,24px);color:#fff;letter-spacing:-0.01em}
.t-label{font-family:var(--font-title);font-weight:600;font-size:clamp(11px,2.8vw,13px);
text-transform:uppercase;letter-spacing:0.12em;color:var(--c-rose)}
.t-body{font-family:var(--font-body);font-size:clamp(15px,3.5vw,17px);line-height:1.75;color:rgba(240,236,228,0.78)}
.t-sm{font-size:clamp(13px,3vw,15px)}.t-lg{font-size:clamp(18px,4.5vw,24px)}
.t-mono{font-family:var(--font-mono);font-size:clamp(11px,2.8vw,13px)}
.t-muted{color:var(--c-muted)}

/* Accent colors */
.c-gold{color:var(--c-gold)}.c-rose{color:var(--c-rose)}.c-violet{color:var(--c-violet)}
.c-sky{color:var(--c-sky)}.c-emerald{color:var(--c-emerald)}

/* Components */
.glass{background:var(--bg-glass);border-radius:var(--radius-sm);padding:clamp(12px,3vw,16px);
border:1px solid rgba(255,255,255,0.05)}
.divider{height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent);margin:16px 0}
.tag{display:inline-block;padding:4px 12px;border-radius:20px;font-family:var(--font-title);
font-size:clamp(10px,2.5vw,11px);font-weight:500;letter-spacing:0.06em;text-transform:uppercase}
.tag-violet{background:rgba(139,92,246,0.15);color:#a78bfa;border:1px solid rgba(139,92,246,0.2)}
.tag-rose{background:rgba(217,79,142,0.12);color:#e879a8;border:1px solid rgba(217,79,142,0.2)}
.tag-gold{background:rgba(232,197,71,0.12);color:var(--c-gold);border:1px solid rgba(232,197,71,0.2)}
.bar-track{height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;width:100%}
.bar-fill{height:100%;border-radius:2px;background:linear-gradient(90deg,var(--c-violet),var(--c-sky))}
img.cover{width:100%;border-radius:var(--radius-sm);object-fit:cover}
.list-item{padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:clamp(13px,3.2vw,15px)}
.list-item:last-child{border-bottom:none}
.choice-btn{display:block;width:100%;padding:14px 18px;margin-top:8px;border-radius:var(--radius-sm);
background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);color:var(--c-text);
font-family:var(--font-body);font-size:clamp(13px,3.2vw,15px);text-align:left;cursor:pointer;
transition:all 0.25s cubic-bezier(0.22,1,0.36,1)}
.choice-btn:hover{background:rgba(139,92,246,0.18);border-color:rgba(139,92,246,0.4);transform:translateX(4px)}
.star{color:var(--c-amber)}

/* Utility */
.mt{margin-top:12px}.mb{margin-bottom:12px}
.mt-lg{margin-top:20px}.mb-lg{margin-bottom:20px}
.gap-sm{gap:8px}.gap-md{gap:12px}

/* Desktop-first: typography defaults are desktop-sized */
/* Mobile override */
body.portrait .card{max-width:420px;padding:clamp(20px,5vw,32px)}
body.portrait .t-display{font-size:clamp(26px,6.5vw,38px)}
body.portrait .t-title{font-size:clamp(18px,4.5vw,24px)}
body.portrait .t-body{font-size:clamp(15px,3.5vw,17px)}
body.portrait .t-sm{font-size:clamp(13px,3vw,15px)}
body.portrait .t-lg{font-size:clamp(18px,4.5vw,24px)}
body.portrait .glass{padding:clamp(12px,3vw,16px)}
</style>
"""

# ===========================
# IMAGE SHOWCASE — Cinematic Full-Bleed
# ===========================

_reg("image_showcase", "Cinematic full-bleed image showcase with glass overlay text", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;min-height:100vh;overflow:hidden;
-webkit-font-smoothing:antialiased}
@keyframes ken-burns{0%{transform:scale(1)}100%{transform:scale(1.06)}}
@keyframes fade-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
.showcase{position:relative;width:100%;min-height:100vh;display:flex;align-items:flex-end}
.showcase-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
animation:ken-burns 20s ease-in-out alternate infinite}
.showcase-scrim{position:absolute;inset:0;
background:linear-gradient(0deg,rgba(10,10,26,0.92) 0%,rgba(10,10,26,0.5) 35%,rgba(10,10,26,0.1) 60%,transparent 100%)}
/* Desktop-first defaults */
.showcase-content{position:relative;z-index:2;padding:clamp(40px,5vw,64px);width:100%;max-width:600px}
.showcase-label{font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:500;
text-transform:uppercase;letter-spacing:0.14em;color:#d94f8e;margin-bottom:10px;
animation:fade-up 0.6s 0.2s both}
.showcase-title{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-size:clamp(36px,5vw,52px);
font-weight:700;color:#fff;line-height:1.15;margin-bottom:10px;animation:fade-up 0.6s 0.35s both}
.showcase-caption{font-size:16px;color:rgba(240,236,228,0.6);line-height:1.6;
animation:fade-up 0.6s 0.5s both}
.showcase-desc{font-size:17px;color:rgba(240,236,228,0.75);line-height:1.7;
margin-top:12px;animation:fade-up 0.6s 0.65s both}
.showcase-bar{width:56px;height:3px;background:linear-gradient(90deg,#d94f8e,#8b5cf6);
margin:18px 0;border-radius:1px;animation:fade-up 0.6s 0.45s both}
body.landscape .showcase{align-items:center;justify-content:flex-start}
body.landscape .showcase-content{max-width:50%;padding:clamp(48px,6vw,80px)}
body.landscape .showcase-title{font-size:clamp(40px,5vw,60px)}
body.landscape .showcase-desc{font-size:clamp(17px,2vw,20px)}
body.portrait .showcase{align-items:flex-end}
body.portrait .showcase-content{max-width:100%;padding:clamp(20px,6vw,40px)}
body.portrait .showcase-title{font-size:clamp(24px,7vw,36px)}
body.portrait .showcase-label{font-size:clamp(10px,2.5vw,11px)}
body.portrait .showcase-caption{font-size:clamp(12px,3vw,14px)}
body.portrait .showcase-desc{font-size:clamp(13px,3.2vw,15px)}
body.portrait .showcase-bar{width:40px;height:2px;margin:14px 0}
</style>
<div class="showcase">
  <img class="showcase-img" src="{image_url}" alt="" onerror="this.style.display='none'">
  <div class="showcase-scrim"></div>
  <div class="showcase-content">
    <div class="showcase-label">{caption}</div>
    <div class="showcase-title">{title}</div>
    <div class="showcase-bar"></div>
    <div class="showcase-caption">{description}</div>
  </div>
</div>
""", {"title": "", "image_url": "", "caption": "", "description": ""})

# ===========================
# PERSON BIO — Editorial Portrait
# ===========================

_reg("person_bio", "Full-screen cinematic profile with portrait, stats, and key facts", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0a0a0f;color:#f0ece4;min-height:100vh;
overflow:hidden;-webkit-font-smoothing:antialiased}
@keyframes fade-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
/* ring-pulse removed — no pink decorative elements */
@keyframes drift{0%,100%{transform:translate(0,0)}50%{transform:translate(30px,-20px)}}
.wrap{width:100%;max-width:100vw;height:100vh;display:grid;grid-template-columns:1fr;grid-template-rows:auto 1fr;position:relative;overflow-x:hidden;box-sizing:border-box}
.wrap::before{content:'';position:absolute;top:-20%;right:-10%;width:600px;height:600px;
border-radius:50%;background:radial-gradient(circle,rgba(139,92,246,.08),transparent 70%);
animation:drift 20s ease-in-out infinite;pointer-events:none}
.wrap::after{content:'';position:absolute;bottom:-15%;left:20%;width:400px;height:400px;
border-radius:50%;background:radial-gradient(circle,rgba(217,79,142,.06),transparent 70%);
animation:drift 15s ease-in-out infinite reverse;pointer-events:none}
.left{display:flex;align-items:center;justify-content:center;position:relative;
padding:60px 0 16px;
background:transparent}
.left::after{content:'';position:absolute;right:0;top:10%;bottom:10%;width:1px;
background:linear-gradient(to bottom,transparent,rgba(255,255,255,.06),transparent);display:none}
.portrait{width:clamp(120px,32vw,180px);height:clamp(120px,32vw,180px);border-radius:50%;
overflow:hidden;border:3px solid rgba(255,255,255,.15);animation:fade-up .6s .1s both;
box-shadow:0 12px 40px rgba(0,0,0,.4)}
.portrait img{width:100%;height:100%;object-fit:cover}
.right{display:flex;flex-direction:column;justify-content:center;padding:20px clamp(20px,5vw,32px) 80px;
text-align:center;position:relative;z-index:1}
.name{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(36px,4.5vw,64px);
font-weight:800;color:#fff;line-height:1.05;letter-spacing:-.03em;animation:fade-up .6s .2s both}
.title-text{font-family:'Space Grotesk',sans-serif;font-size:clamp(12px,1.4vw,16px);font-weight:600;
text-transform:uppercase;letter-spacing:.16em;color:#e8c547;margin:12px 0 24px;animation:fade-up .6s .3s both}
.line{width:60px;height:3px;background:linear-gradient(90deg,#8b5cf6,#38bdf8);
border-radius:2px;margin:0 auto 24px;animation:fade-up .6s .35s both}
.bio-text{font-size:clamp(15px,1.6vw,18px);line-height:1.8;color:rgba(240,236,228,.65);
max-width:520px;margin-bottom:32px;animation:fade-up .6s .4s both}
.stats{display:flex;gap:clamp(16px,2.5vw,32px);margin-bottom:32px;animation:fade-up .6s .5s both;justify-content:center;flex-wrap:wrap}
.facts{background:rgba(255,255,255,.03);border-radius:16px;padding:clamp(16px,2vw,24px);
border:1px solid rgba(255,255,255,.06);max-width:520px;animation:fade-up .6s .6s both;
backdrop-filter:blur(16px)}
.facts-inner{font-size:clamp(13px,1.4vw,15px);line-height:1.75;color:rgba(240,236,228,.55)}
body.landscape .wrap{grid-template-columns:1fr 1fr;grid-template-rows:1fr}
body.landscape .left{padding:60px 0 0}
body.landscape .left::after{display:block}
body.landscape .portrait{width:clamp(200px,22vw,320px);height:clamp(200px,22vw,320px)}
body.landscape .right{padding:clamp(32px,5vw,64px);text-align:left}
body.landscape .stats{justify-content:flex-start;flex-wrap:nowrap}
body.landscape .line{margin:0 0 24px}
body.portrait .wrap{grid-template-columns:1fr;grid-template-rows:auto 1fr}
body.portrait .left{padding:clamp(24px,6vw,40px) 0 16px}
body.portrait .left::after{display:none}
body.portrait .portrait{width:clamp(120px,32vw,180px);height:clamp(120px,32vw,180px)}
body.portrait .right{padding:clamp(20px,5vw,32px) clamp(20px,5vw,32px) 80px;text-align:center}
body.portrait .stats{justify-content:center;flex-wrap:wrap}
body.portrait .line{margin:0 auto 24px}
body.portrait .name{font-size:clamp(28px,8vw,42px)}
body.portrait .bio-text{font-size:clamp(14px,3.5vw,16px)}
body.portrait .facts{max-width:100%}
</style>
<div class="wrap">
  <div class="left">
    <div class="portrait"><img src="{photo_url}" alt="" onerror="this.style.display='none';var i=this.parentElement.querySelector('.initials');if(i)i.style.display='flex'"><div class="initials" style="display:none;width:100%;height:100%;align-items:center;justify-content:center;background:linear-gradient(135deg,#8b5cf6,#38bdf8);font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(48px,8vw,80px);font-weight:800;color:#fff">{initials}</div></div>
  </div>
  <div class="right">
    <div class="name">{name}</div>
    <div class="title-text">{title}</div>
    <div class="line"></div>
    <div class="bio-text">{bio}</div>
    <div class="stats">{stats}</div>
    <div class="facts"><div class="facts-inner">{key_facts}</div></div>
  </div>
</div>
""", {"name": "Unknown", "photo_url": "", "title": "", "bio": "", "key_facts": "", "stats": ""})

# ===========================
# FACT CARD — Premium Magazine Callout
# ===========================

_reg("fact_card", "Premium fact card with hero image, category badge, and source attribution", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;overflow-x:hidden}
@keyframes fade-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes line-grow{from{width:0}to{width:48px}}
.fact-wrap{width:100%;min-height:100vh;display:flex;flex-direction:column}
.fact-hero{position:relative;width:100%;height:clamp(180px,48vw,280px);overflow:hidden;flex-shrink:0}
.fact-hero img{width:100%;height:100%;object-fit:cover;animation:fade-up .7s both}
.fact-hero::after{content:'';position:absolute;inset:0;
background:linear-gradient(0deg,#0d0d1a 0%,rgba(13,13,26,.6) 15%,rgba(13,13,26,.15) 35%,transparent 60%)}
.fact-hero-icon{position:absolute;bottom:clamp(16px,4vw,24px);left:clamp(20px,5vw,32px);z-index:2;
font-size:clamp(28px,7vw,38px);filter:drop-shadow(0 4px 12px rgba(0,0,0,.5))}
.fact-content{padding:clamp(24px,5vw,40px) clamp(20px,5vw,32px) clamp(20px,5vw,32px);flex:1;display:flex;flex-direction:column;
justify-content:center;max-width:600px;width:100%;margin:0 auto;text-align:center}
.fact-cat{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);font-weight:600;
text-transform:uppercase;letter-spacing:.18em;padding:5px 16px;border-radius:20px;display:inline-block;
background:rgba(217,79,142,.1);border:1px solid rgba(217,79,142,.2);color:#e879a8;
margin-bottom:clamp(14px,3.5vw,18px);animation:fade-up .6s .15s both;align-self:center}
.fact-line{width:48px;height:2px;background:linear-gradient(90deg,#e8c547,#d94f8e);
margin:0 auto clamp(16px,4vw,22px);border-radius:1px;animation:line-grow .8s .25s both}
.fact-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(24px,6.5vw,34px);
font-weight:800;color:#fff;line-height:1.15;letter-spacing:-.02em;margin-bottom:clamp(14px,3.5vw,18px);animation:fade-up .6s .3s both}
.fact-body{font-size:clamp(14px,3.5vw,16px);line-height:1.85;color:rgba(240,236,228,.72);
max-width:370px;margin:0 auto;animation:fade-up .6s .4s both}
.fact-src{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);
color:rgba(240,236,228,.25);margin-top:clamp(20px,5vw,28px);letter-spacing:.06em;animation:fade-up .6s .5s both}
body.landscape .fact-wrap{flex-direction:row;min-height:100vh}
body.landscape .fact-hero{width:50%;height:auto;min-height:100vh}
body.landscape .fact-content{width:50%;padding:clamp(32px,4vw,48px);text-align:left;max-width:none;justify-content:center}
body.landscape .fact-cat{align-self:flex-start}
body.landscape .fact-line{margin:0 0 clamp(16px,4vw,22px)}
body.landscape .fact-title{font-size:clamp(32px,4vw,44px)}
body.landscape .fact-body{font-size:clamp(16px,2vw,18px);max-width:520px}
body.portrait .fact-wrap{flex-direction:column}
body.portrait .fact-hero{width:100%;height:clamp(180px,42vw,280px)}
body.portrait .fact-content{max-width:420px;text-align:center}
body.portrait .fact-cat{align-self:center}
body.portrait .fact-line{margin:0 auto clamp(16px,4vw,22px)}
body.portrait .fact-title{font-size:clamp(24px,6.5vw,34px)}
body.portrait .fact-body{font-size:clamp(14px,3.5vw,16px);max-width:370px}
</style>
<div class="fact-wrap">
  <div class="fact-hero">
    <img src="{image_url}" alt="" onerror="this.parentElement.style.background='linear-gradient(135deg,#1a1a2e,#16213e)';this.remove()">
    <div class="fact-hero-icon">{icon}</div>
  </div>
  <div class="fact-content">
    <div class="fact-cat">{category}</div>
    <div class="fact-line"></div>
    <div class="fact-title">{title}</div>
    <div class="fact-body">{fact_text}</div>
    <div class="fact-src">{source}</div>
  </div>
</div>
<script>document.querySelectorAll('.fact-hero img').forEach(function(img){if(!img.src||img.src===location.href)img.parentElement.style.background='linear-gradient(135deg,#1a1a2e,#16213e)'})</script>
""", {"title": "Did You Know?", "fact_text": "", "category": "Insight", "source": "", "icon": "", "image_url": ""})

# ===========================
# NEWS HEADLINE — Editorial Broadsheet
# ===========================

_reg("news_headline", "Premium editorial newspaper layout with hero photo and source badge", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;overflow-x:hidden}
@keyframes fade-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes pulse-dot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}
.news-wrap{width:100%;min-height:100vh;display:flex;flex-direction:column}
.news-hero{position:relative;width:100%;height:clamp(200px,52vw,320px);overflow:hidden;flex-shrink:0}
.news-hero img{width:100%;height:100%;object-fit:cover;animation:fade-up .8s both}
.news-hero::after{content:'';position:absolute;inset:0;
background:linear-gradient(0deg,#0d0d1a 0%,rgba(13,13,26,.7) 40%,rgba(13,13,26,.2) 70%,transparent 100%)}
.news-accent{height:3px;
background:linear-gradient(90deg,#d94f8e,#8b5cf6,#38bdf8,#8b5cf6,#d94f8e);
background-size:200% 100%;animation:shimmer 4s linear infinite;flex-shrink:0}
/* Desktop-first defaults */
.news-content{padding:clamp(20px,5vw,32px);flex:1;display:flex;flex-direction:column;max-width:600px;width:100%;margin:0 auto}
.news-meta{display:flex;align-items:center;gap:10px;margin-bottom:clamp(14px,3.5vw,20px);animation:fade-up .6s .15s both}
.news-badge{display:inline-flex;align-items:center;gap:7px;padding:5px 14px;border-radius:20px;
background:rgba(220,38,38,.12);border:1px solid rgba(220,38,38,.25)}
.news-badge-dot{width:6px;height:6px;border-radius:50%;background:#ef4444;animation:pulse-dot 1.8s ease-in-out infinite}
.news-source{font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;
text-transform:uppercase;letter-spacing:.16em;color:#fca5a5}
.news-time{font-family:'JetBrains Mono',monospace;font-size:11px;
color:rgba(240,236,228,.3);letter-spacing:.03em;margin-left:auto}
.news-headline{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(26px,7.5vw,40px);
font-weight:800;color:#fff;line-height:1.12;letter-spacing:-.02em;margin-bottom:clamp(14px,3.5vw,20px);animation:fade-up .6s .25s both}
.news-divider{height:1px;background:linear-gradient(90deg,rgba(255,255,255,.12),rgba(255,255,255,.04),transparent);
margin-bottom:clamp(14px,3.5vw,20px);animation:fade-up .6s .3s both}
.news-body{font-family:'Inter',sans-serif;font-size:clamp(14px,3.5vw,16px);
line-height:1.85;color:rgba(240,236,228,.65);animation:fade-up .6s .35s both}
body.landscape .news-wrap{flex-direction:row;min-height:100vh}
body.landscape .news-hero{width:50%;height:auto;min-height:100vh}
body.landscape .news-content{width:50%;padding:clamp(32px,4vw,48px);max-width:none;display:flex;flex-direction:column;justify-content:center}
body.landscape .news-headline{font-size:clamp(36px,5vw,48px)}
body.landscape .news-body{font-size:clamp(16px,2vw,18px)}
body.portrait .news-wrap{flex-direction:column}
body.portrait .news-hero{width:100%;height:clamp(200px,42vw,320px)}
body.portrait .news-content{max-width:420px}
body.portrait .news-headline{font-size:clamp(26px,7.5vw,40px)}
body.portrait .news-body{font-size:clamp(14px,3.5vw,16px)}
body.portrait .news-source{font-size:clamp(10px,2.5vw,11px)}
body.portrait .news-time{font-size:clamp(10px,2.4vw,11px)}
</style>
<div class="news-wrap">
  <div class="news-hero">
    <img src="{image_url}" alt="" onerror="this.parentElement.style.background='linear-gradient(135deg,#1a1a2e,#16213e)';this.remove()">
  </div>
  <div class="news-accent"></div>
  <div class="news-content">
    <div class="news-meta">
      <div class="news-badge"><span class="news-badge-dot"></span><span class="news-source">{source}</span></div>
      <span class="news-time">{timestamp}</span>
    </div>
    <div class="news-headline">{headline}</div>
    <div class="news-divider"></div>
    <div class="news-body">{summary}</div>
  </div>
</div>
""", {"headline": "Breaking News", "source": "News", "summary": "", "timestamp": "", "image_url": ""})

# ===========================
# WEATHER CARD — Atmospheric & Dynamic
# ===========================

_reg("weather_card", "Transparent glass weather display — no background images", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0a0a1a;color:#f0ece4;min-height:100vh;
-webkit-font-smoothing:antialiased;overflow:hidden}
@keyframes fu{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes fl{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes orb-drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-15px) scale(1.05)}}
.weather{width:100%;min-height:100vh;display:flex;flex-direction:column;align-items:center;
justify-content:center;text-align:center;position:relative;overflow:hidden;background:#0a0a1a}
.weather::before,.weather::after{content:'';position:absolute;border-radius:50%;
pointer-events:none;animation:orb-drift 12s ease-in-out infinite}
.weather::before{width:340px;height:340px;top:-80px;right:-60px;
background:radial-gradient(circle,rgba(139,92,246,0.15),transparent 70%)}
.weather::after{width:280px;height:280px;bottom:-40px;left:-60px;
background:radial-gradient(circle,rgba(56,189,248,0.12),transparent 70%);animation-delay:-6s}
.weather-glass{position:relative;z-index:2;backdrop-filter:blur(24px) saturate(180%);
-webkit-backdrop-filter:blur(24px) saturate(180%);background:rgba(15,8,32,0.85);
border:1px solid rgba(255,255,255,0.15);border-radius:28px;
box-shadow:0 8px 32px rgba(0,0,0,0.25);padding:clamp(28px,6vw,44px) clamp(24px,5vw,40px);
margin-bottom:8px;animation:fu .5s .05s both}
.weather-icon{font-size:clamp(44px,12vw,64px);margin-bottom:4px;animation:fl 5s ease-in-out infinite;
filter:drop-shadow(0 4px 16px rgba(0,0,0,.4));position:relative;z-index:2}
.weather-temp{font-family:'Space Grotesk',sans-serif;font-size:clamp(72px,22vw,110px);
font-weight:700;line-height:1;letter-spacing:-.04em;color:#fff;position:relative;z-index:2;
text-shadow:0 4px 32px rgba(0,0,0,.5);animation:fu .6s .15s both}
.weather-cond{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(18px,5vw,26px);
color:#e8c547;font-style:italic;font-weight:400;margin:2px 0 12px;position:relative;z-index:2;
text-shadow:0 2px 12px rgba(0,0,0,.5);animation:fu .6s .3s both}
.weather-loc{font-family:'Space Grotesk',sans-serif;font-size:clamp(11px,3vw,14px);
color:rgba(240,236,228,.7);letter-spacing:.14em;text-transform:uppercase;
position:relative;z-index:2;animation:fu .6s .4s both;text-shadow:0 1px 8px rgba(0,0,0,.4)}
.weather-details{display:flex;gap:clamp(8px,3vw,16px);margin-top:28px;position:relative;z-index:2;
animation:fu .6s .5s both;flex-wrap:wrap;justify-content:center}
.weather-detail{text-align:center;background:rgba(40,40,60,.45);border-radius:12px;
padding:clamp(10px,3vw,14px) clamp(14px,4vw,20px);border:1px solid rgba(255,255,255,.15);
backdrop-filter:blur(12px)}
.weather-detail-val{font-family:'Space Grotesk',sans-serif;font-size:clamp(15px,3.8vw,18px);
font-weight:600;color:#fff}
.weather-detail-label{font-size:clamp(10px,2.5vw,11px);color:rgba(240,236,228,.7);
text-transform:uppercase;letter-spacing:.06em;margin-top:3px}
.weather-forecast{display:flex;justify-content:center;gap:clamp(4px,2vw,12px);
margin-top:28px;position:relative;z-index:2;flex-wrap:wrap;animation:fu .6s .6s both}
.fc-day{text-align:center;background:rgba(40,40,60,.45);border-radius:10px;
padding:clamp(8px,2vw,12px) clamp(10px,2.5vw,16px);border:1px solid rgba(255,255,255,.15);
backdrop-filter:blur(8px);min-width:56px}
.fc-name{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);
font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:rgba(240,236,228,.8);margin-bottom:4px}
.fc-icon{font-size:clamp(16px,4vw,22px);margin-bottom:2px}
.fc-hi{font-family:'Space Grotesk',sans-serif;font-size:clamp(13px,3vw,15px);font-weight:600;color:#fff}
.fc-lo{font-family:'Space Grotesk',sans-serif;font-size:clamp(11px,2.5vw,12px);color:rgba(240,236,228,.7)}
body.landscape .weather{flex-direction:row;flex-wrap:wrap;justify-content:center;gap:clamp(16px,3vw,32px);
  padding:clamp(24px,3vw,40px)}
body.landscape .weather-glass{margin-bottom:0}
body.landscape .weather-temp{font-size:clamp(90px,12vw,130px)}
body.landscape .weather-cond{font-size:clamp(22px,3vw,30px)}
body.landscape .weather-loc{font-size:clamp(13px,1.6vw,16px)}
body.landscape .weather-icon{font-size:clamp(56px,7vw,76px)}
body.landscape .weather-detail{padding:clamp(14px,2vw,20px) clamp(20px,3vw,32px)}
body.landscape .weather-detail-val{font-size:clamp(18px,2.5vw,22px)}
body.portrait .weather-temp{font-size:clamp(64px,18vw,100px)}
body.portrait .weather-cond{font-size:clamp(16px,4.5vw,24px)}
</style>
<div class="weather">
  <div class="weather-glass">
    <div class="weather-icon">{icon}</div>
    <div class="weather-temp">{temperature}</div>
    <div class="weather-cond">{condition}</div>
    <div class="weather-loc">{location}</div>
  </div>
  <div class="weather-details">{detail_pills}</div>
  <div class="weather-forecast">{forecast_bars}</div>
</div>
""", {"location": "Current Location", "temperature": "--", "condition": "Unknown", "icon": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='#FFB300' style='display:inline-block;width:32px;height:32px;vertical-align:middle'><path d='M14 22H4v-2h10v2ZM4 20H2v-4h2v4Zm12 0h-2v-4h2v4Zm-6-2H8v-2h2v2Zm-2-2H4v-2h4v2Zm6 0h-2v-2h2v2Zm-2-2H8v-2h4v2Zm12-1h-4v-2h4v2Zm-6-1h-2v-2h2v2ZM8 10H6V8h2v2Zm8 0h-2V8h2v2Zm-2-2H8V6h6v2ZM6 6H4V4h2v2Zm14 0h-2V4h2v2ZM4 4H2V2h2v2Zm9 0h-2V0h2v4Zm9 0h-2V2h2v2Z'/></svg>",
      "detail_pills": '<div class="weather-detail"><div class="weather-detail-val">--</div><div class="weather-detail-label">Humidity</div></div><div class="weather-detail"><div class="weather-detail-val">--</div><div class="weather-detail-label">Wind</div></div>',
      "forecast_bars": "",
      "image_url": ""})

# ===========================
# MOVIE CARD — Cinematic Poster
# ===========================

_reg("movie_card", "Deep-dive cinematic movie display with poster, critics, cast, and cultural context", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0a0a0f;color:#f0ece4;min-height:100vh;
overflow-x:hidden;-webkit-font-smoothing:antialiased}
@keyframes fu{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes ken-burns{0%{transform:scale(1.05)}100%{transform:scale(1.12)}}
.wrap{width:100vw;min-height:100vh;position:relative;display:grid;grid-template-columns:1fr;grid-template-rows:auto 1fr}
.poster-bg{position:fixed;inset:0;overflow:hidden;z-index:0}
.poster-bg img{width:100%;height:100%;object-fit:cover;animation:ken-burns 25s ease-in-out alternate infinite}
.poster-bg::after{content:'';position:absolute;inset:0;
background:linear-gradient(90deg,rgba(10,10,15,.2) 0%,rgba(10,10,15,.92) 45%,rgba(10,10,15,.98) 100%)}
.content{grid-column:2;display:flex;flex-direction:column;justify-content:center;
padding:clamp(24px,4vw,60px);position:relative;z-index:2;gap:0;overflow-y:auto;max-height:100vh}
.badges{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;animation:fu .5s .1s both}
.badge{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:10px;
font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:600;
backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.08)}
.badge.score{background:rgba(251,191,36,.1);border-color:rgba(251,191,36,.15);color:#fbbf24}
.badge.genre{background:rgba(139,92,246,.1);border-color:rgba(139,92,246,.15);color:#a78bfa;
font-size:11px;text-transform:uppercase;letter-spacing:.08em}
.badge.runtime{background:rgba(255,255,255,.04);color:rgba(255,255,255,.5)}
.title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(32px,4.5vw,64px);
font-weight:800;color:#fff;line-height:1.05;letter-spacing:-.03em;margin-bottom:4px;animation:fu .5s .15s both}
.subtitle{font-family:'Space Grotesk',sans-serif;font-size:clamp(13px,1.3vw,15px);
color:rgba(240,236,228,.35);margin-bottom:20px;animation:fu .5s .2s both}
.bar{width:50px;height:3px;background:linear-gradient(90deg,#fbbf24,#d94f8e);
border-radius:2px;margin-bottom:20px;animation:fu .5s .25s both}
.synopsis{font-size:clamp(14px,1.4vw,17px);line-height:1.8;color:rgba(240,236,228,.6);
max-width:500px;margin-bottom:24px;animation:fu .5s .3s both}
.section-label{font-family:'Space Grotesk',sans-serif;font-size:10px;font-weight:600;
text-transform:uppercase;letter-spacing:.16em;color:rgba(240,236,228,.25);margin-bottom:10px}
.credits{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:24px;animation:fu .5s .35s both}
.credit{display:flex;flex-direction:column;gap:2px}
.credit-role{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:rgba(240,236,228,.25);
font-family:'Space Grotesk',sans-serif}
.credit-name{font-size:clamp(13px,1.3vw,15px);color:rgba(240,236,228,.75);font-weight:500}
.quote-section{margin-bottom:24px;animation:fu .5s .4s both}
.quote{background:rgba(255,255,255,.03);border-left:2px solid #fbbf24;padding:12px 16px;
border-radius:0 10px 10px 0;margin-bottom:10px}
.quote-text{font-size:clamp(13px,1.3vw,15px);line-height:1.7;color:rgba(240,236,228,.55);font-style:italic}
.quote-source{font-size:11px;color:rgba(240,236,228,.3);margin-top:6px;font-family:'Space Grotesk',sans-serif}
.stats{display:flex;gap:clamp(12px,2vw,24px);animation:fu .5s .45s both}
.stat{text-align:center;background:rgba(255,255,255,.03);border-radius:12px;
padding:12px 18px;border:1px solid rgba(255,255,255,.05)}
.stat-val{font-family:'Space Grotesk',sans-serif;font-size:clamp(16px,2vw,22px);font-weight:700;color:#e8c547}
.stat-lbl{font-size:10px;color:rgba(240,236,228,.3);text-transform:uppercase;letter-spacing:.1em;margin-top:3px}
body.landscape .wrap{grid-template-columns:1fr 1fr;grid-template-rows:1fr}
body.landscape .content{grid-column:2;padding:clamp(24px,4vw,60px);max-height:100vh;overflow-y:auto}
body.landscape .poster-bg{position:fixed;inset:0}
body.landscape .poster-bg::after{background:linear-gradient(90deg,rgba(10,10,15,.2) 0%,rgba(10,10,15,.92) 45%,rgba(10,10,15,.98) 100%)}
body.portrait .wrap{grid-template-columns:1fr;grid-template-rows:1fr;position:relative}
body.portrait .poster-bg{position:absolute;top:0;left:0;right:0;height:45vh;z-index:0}
body.portrait .poster-bg::after{background:linear-gradient(180deg,transparent 10%,rgba(10,10,15,.95) 55%,rgba(10,10,15,1) 100%)}
body.portrait .content{grid-column:1;grid-row:1;padding:20px;padding-top:clamp(180px,38vh,320px);padding-bottom:80px;max-height:100vh;overflow-y:auto;z-index:1}
body.portrait .title{font-size:clamp(28px,7vw,42px)}
body.portrait .synopsis{font-size:clamp(13px,3.2vw,15px)}
.quotes:empty,.quote-section:has(.quotes:empty){display:none}
.quote-section .quotes:empty{display:none}

</style>
<div class="wrap">
  <div class="poster-bg"><img src="{poster_url}" onerror="this.style.display='none'"></div>
  <div class="content">
    <div class="badges">
      <span class="badge score">{rating}</span>
      <span class="badge genre">{genre}</span>
      <span class="badge runtime">{runtime}</span>
    </div>
    <div class="title">{title}</div>
    <div class="subtitle">{year} · {director}</div>
    <div class="bar"></div>
    <div class="synopsis">{synopsis}</div>
    <div class="credits">
      <div class="credit"><span class="credit-role">Director</span><span class="credit-name">{director}</span></div>
      <div class="credit"><span class="credit-role">Cast</span><span class="credit-name">{cast}</span></div>
    </div>
    <div class="quote-section">
      <div class="section-label">Critics</div>
      <div class="quotes">{critics}</div>
    </div>
    <div class="stats">{stats}</div>
  </div>
</div>
""", {"title": "Movie", "poster_url": "", "rating": "N/A", "year": "", "genre": "", "synopsis": "",
      "director": "", "cast": "", "runtime": "", "critics": "", "stats": ""})

# ===========================
# BOOK CARD — Literary Elegance
# ===========================

_reg("book_card", "Elegant book card with cover, author, and synopsis", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(16px,4vw,24px)}
@keyframes fade-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
.book{width:100%;max-width:420px;display:flex;gap:clamp(14px,4vw,20px);animation:fade-up 0.6s both}
.book-cover{flex-shrink:0;width:clamp(100px,28vw,130px);border-radius:8px;overflow:hidden;
box-shadow:0 8px 32px rgba(0,0,0,0.5),4px 0 12px rgba(0,0,0,0.3);animation:fade-up 0.6s 0.1s both}
.book-cover img{width:100%;height:auto;display:block}
.book-info{flex:1;display:flex;flex-direction:column;justify-content:center;animation:fade-up 0.6s 0.2s both}
.book-title{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-size:clamp(18px,5vw,24px);
font-weight:700;color:#fff;line-height:1.2;margin-bottom:4px}
.book-author{font-family:'Space Grotesk',sans-serif;font-size:clamp(11px,2.8vw,13px);
color:#d94f8e;font-weight:500;margin-bottom:12px}
.book-rating{display:flex;align-items:center;gap:5px;margin-bottom:12px}
.book-rating .star-icon{color:#fbbf24;font-size:12px}
.book-rating .score{font-family:'Space Grotesk',sans-serif;font-weight:600;color:rgba(240,236,228,0.7);font-size:13px}
.book-body{font-size:clamp(12px,3vw,14px);line-height:1.7;color:rgba(240,236,228,0.55)}
body.landscape .book{max-width:600px;gap:clamp(20px,3vw,32px);flex-direction:row;align-items:center}
body.landscape .book-title{font-size:clamp(22px,3vw,28px)}
body.landscape .book-cover{width:clamp(140px,20vw,200px)}
body.landscape .book-body{font-size:clamp(14px,1.6vw,16px)}
body.portrait .book{max-width:360px;flex-direction:column;align-items:center;text-align:center}
body.portrait .book-cover{width:clamp(140px,40vw,200px)}
</style>
<div class="book">
  <div class="book-cover"><img src="{cover_url}" onerror="this.parentElement.style.display='none'"></div>
  <div class="book-info">
    <div class="book-title">{title}</div>
    <div class="book-author">by {author}</div>
    <div class="book-rating"><span class="star-icon">⭐</span><span class="score">{rating}</span></div>
    <div class="book-body">{synopsis}</div>
  </div>
</div>
""", {"title": "Book", "author": "Unknown", "cover_url": "", "rating": "N/A", "synopsis": ""})

# ===========================
# MUSIC NOW PLAYING — Vinyl Vibes
# ===========================

_reg("music_now_playing", "Refined dark now-playing card with album art shadow and sleek progress bar", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#080808;color:#e8e8e8;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(16px,4vw,24px)}
@keyframes mu-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.mu{width:100%;max-width:400px;display:flex;flex-direction:column;align-items:center}
.mu-art{width:clamp(200px,52vw,260px);height:clamp(200px,52vw,260px);border-radius:6px;
margin-bottom:clamp(28px,6vw,36px);overflow:hidden;position:relative;
box-shadow:0 24px 64px rgba(0,0,0,.7),0 8px 24px rgba(0,0,0,.5);
animation:mu-up .6s .1s both}
.mu-art img{width:100%;height:100%;object-fit:cover;display:block}
.mu-track{font-family:'Inter',sans-serif;font-size:clamp(20px,5.5vw,26px);
font-weight:700;color:#fff;letter-spacing:-.02em;text-align:center;margin-bottom:4px;
animation:mu-up .6s .2s both}
.mu-artist{font-family:'Inter',sans-serif;font-size:clamp(13px,3.2vw,15px);
color:rgba(255,255,255,.4);font-weight:400;text-align:center;margin-bottom:clamp(24px,5vw,32px);
animation:mu-up .6s .3s both}
.mu-progress{width:100%;animation:mu-up .6s .4s both}
.mu-bar{height:3px;background:rgba(255,255,255,.1);border-radius:1.5px;overflow:hidden;position:relative}
.mu-bar-fill{height:100%;border-radius:1.5px;background:#fff;transition:width .3s ease}
.mu-bar-dot{position:absolute;top:50%;right:0;transform:translate(50%,-50%);
width:10px;height:10px;border-radius:50%;background:#fff;
box-shadow:0 0 8px rgba(255,255,255,.4)}
.mu-times{display:flex;justify-content:space-between;margin-top:8px;
font-family:'JetBrains Mono',monospace;font-size:clamp(10px,2.5vw,11px);color:rgba(255,255,255,.25)}
body.landscape .mu{max-width:480px}
body.landscape .mu-art{width:clamp(260px,28vw,320px);height:clamp(260px,28vw,320px)}
body.landscape .mu-track{font-size:clamp(24px,3vw,30px)}
body.landscape .mu-artist{font-size:clamp(14px,1.6vw,16px)}
</style>
<div class="mu">
  <div class="mu-art"><img src="{album_art_url}" alt="" onerror="this.parentElement.style.background='#1a1a1a';this.remove()"></div>
  <div class="mu-track">{track}</div>
  <div class="mu-artist">{artist}</div>
  <svg class="mu-wave" width="100%" height="28" viewBox="0 0 200 28" preserveAspectRatio="none" style="margin-bottom:16px;animation:mu-up .6s .35s both">
    <rect x="0" y="10" width="3.5" height="8" rx="1" fill="rgba(255,255,255,.12)"/>
    <rect x="5" y="5" width="3.5" height="18" rx="1" fill="rgba(255,255,255,.15)"/>
    <rect x="10" y="8" width="3.5" height="12" rx="1" fill="rgba(255,255,255,.1)"/>
    <rect x="15" y="3" width="3.5" height="22" rx="1" fill="rgba(255,255,255,.18)"/>
    <rect x="20" y="6" width="3.5" height="16" rx="1" fill="rgba(255,255,255,.13)"/>
    <rect x="25" y="9" width="3.5" height="10" rx="1" fill="rgba(255,255,255,.1)"/>
    <rect x="30" y="2" width="3.5" height="24" rx="1" fill="rgba(255,255,255,.16)"/>
    <rect x="35" y="7" width="3.5" height="14" rx="1" fill="rgba(255,255,255,.12)"/>
    <rect x="40" y="4" width="3.5" height="20" rx="1" fill="rgba(255,255,255,.15)"/>
    <rect x="45" y="10" width="3.5" height="8" rx="1" fill="rgba(255,255,255,.09)"/>
    <rect x="50" y="1" width="3.5" height="26" rx="1" fill="rgba(255,255,255,.18)"/>
    <rect x="55" y="6" width="3.5" height="16" rx="1" fill="rgba(255,255,255,.14)"/>
    <rect x="60" y="9" width="3.5" height="10" rx="1" fill="rgba(255,255,255,.1)"/>
    <rect x="65" y="3" width="3.5" height="22" rx="1" fill="rgba(255,255,255,.16)"/>
    <rect x="70" y="7" width="3.5" height="14" rx="1" fill="rgba(255,255,255,.12)"/>
    <rect x="75" y="5" width="3.5" height="18" rx="1" fill="rgba(255,255,255,.15)"/>
    <rect x="80" y="11" width="3.5" height="6" rx="1" fill="rgba(255,255,255,.08)"/>
    <rect x="85" y="2" width="3.5" height="24" rx="1" fill="rgba(255,255,255,.17)"/>
    <rect x="90" y="8" width="3.5" height="12" rx="1" fill="rgba(255,255,255,.11)"/>
    <rect x="95" y="4" width="3.5" height="20" rx="1" fill="rgba(255,255,255,.14)"/>
    <rect x="100" y="6" width="3.5" height="16" rx="1" fill="rgba(255,255,255,.13)"/>
    <rect x="105" y="10" width="3.5" height="8" rx="1" fill="rgba(255,255,255,.09)"/>
    <rect x="110" y="1" width="3.5" height="26" rx="1" fill="rgba(255,255,255,.16)"/>
    <rect x="115" y="7" width="3.5" height="14" rx="1" fill="rgba(255,255,255,.12)"/>
    <rect x="120" y="3" width="3.5" height="22" rx="1" fill="rgba(255,255,255,.15)"/>
    <rect x="125" y="9" width="3.5" height="10" rx="1" fill="rgba(255,255,255,.1)"/>
    <rect x="130" y="5" width="3.5" height="18" rx="1" fill="rgba(255,255,255,.14)"/>
    <rect x="135" y="11" width="3.5" height="6" rx="1" fill="rgba(255,255,255,.08)"/>
    <rect x="140" y="2" width="3.5" height="24" rx="1" fill="rgba(255,255,255,.17)"/>
    <rect x="145" y="6" width="3.5" height="16" rx="1" fill="rgba(255,255,255,.13)"/>
    <rect x="150" y="8" width="3.5" height="12" rx="1" fill="rgba(255,255,255,.11)"/>
    <rect x="155" y="4" width="3.5" height="20" rx="1" fill="rgba(255,255,255,.15)"/>
    <rect x="160" y="10" width="3.5" height="8" rx="1" fill="rgba(255,255,255,.09)"/>
    <rect x="165" y="3" width="3.5" height="22" rx="1" fill="rgba(255,255,255,.16)"/>
    <rect x="170" y="7" width="3.5" height="14" rx="1" fill="rgba(255,255,255,.12)"/>
    <rect x="175" y="5" width="3.5" height="18" rx="1" fill="rgba(255,255,255,.14)"/>
    <rect x="180" y="9" width="3.5" height="10" rx="1" fill="rgba(255,255,255,.1)"/>
    <rect x="185" y="1" width="3.5" height="26" rx="1" fill="rgba(255,255,255,.17)"/>
    <rect x="190" y="6" width="3.5" height="16" rx="1" fill="rgba(255,255,255,.13)"/>
    <rect x="195" y="10" width="3.5" height="8" rx="1" fill="rgba(255,255,255,.1)"/>
  </svg>
  <div class="mu-progress">
    <div class="mu-bar"><div class="mu-bar-fill" style="width:{progress}%"><div class="mu-bar-dot"></div></div></div>
    <div class="mu-times"><span>{elapsed}</span><span>{duration}</span></div>
  </div>
</div>
""", {"track": "Unknown Track", "artist": "Unknown Artist", "album_art_url": "", "progress": "0", "elapsed": "0:00", "duration": "0:00"})

# ===========================
# DEFINITION CARD
# ===========================

_reg("definition_card", "Dictionary-style definition with hero image, pronunciation, and example sentence", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;overflow-x:hidden}
@keyframes fade-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes breathe{0%,100%{opacity:.04}50%{opacity:.1}}
.def-wrap{width:100%;max-width:100%;min-height:100vh;display:flex;flex-direction:column;overflow-x:hidden;box-sizing:border-box}
.def-hero{position:relative;width:100%;height:clamp(160px,44vw,260px);overflow:hidden;flex-shrink:0}
.def-hero img{width:100%;height:100%;object-fit:cover;filter:brightness(.7) saturate(.8);animation:fade-up .7s both}
.def-hero::after{content:'';position:absolute;inset:0;
background:linear-gradient(0deg,#0d0d1a 0%,rgba(13,13,26,.65) 45%,rgba(13,13,26,.2) 75%,transparent 100%)}
.def-content{padding:clamp(20px,5vw,32px);flex:1;display:flex;flex-direction:column;
max-width:420px;width:100%;margin:0 auto;position:relative}
.def-content::before{content:'';position:absolute;top:40px;right:-20px;width:180px;height:180px;border-radius:50%;
background:radial-gradient(circle,rgba(139,92,246,.07),transparent 70%);animation:breathe 7s ease-in-out infinite;pointer-events:none}
.def-word{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(38px,11vw,56px);
font-weight:800;line-height:1.05;letter-spacing:-.03em;margin-bottom:8px;animation:fade-up .6s .1s both;
background:linear-gradient(135deg,#fff 55%,#8b5cf6);-webkit-background-clip:text;
background-clip:text;color:transparent}
.def-phon{font-family:'JetBrains Mono',monospace;font-size:clamp(13px,3.2vw,15px);
color:#a78bfa;margin-bottom:8px;animation:fade-up .6s .2s both}
.def-pos{display:inline-block;font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);font-weight:600;
text-transform:uppercase;letter-spacing:.14em;color:#e879a8;
padding:5px 14px;border-radius:18px;background:rgba(217,79,142,.1);border:1px solid rgba(217,79,142,.18);
margin-bottom:clamp(18px,4.5vw,24px);animation:fade-up .6s .25s both;align-self:flex-start}
.def-line{width:48px;height:2px;background:linear-gradient(90deg,#8b5cf6,#38bdf8);
border-radius:1px;margin-bottom:clamp(18px,4.5vw,24px);animation:fade-up .6s .3s both}
.def-meaning{font-size:clamp(16px,4vw,19px);line-height:1.8;color:rgba(240,236,228,.78);
margin-bottom:clamp(22px,5.5vw,30px);animation:fade-up .6s .35s both}
.def-example{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(14px,3.4vw,16px);
font-style:italic;color:rgba(240,236,228,.45);line-height:1.75;padding-left:18px;
border-left:2px solid rgba(139,92,246,.4);animation:fade-up .6s .45s both}
body.landscape .def-wrap{flex-direction:row;min-height:100vh}
body.landscape .def-hero{width:50%;height:auto;min-height:100vh}
body.landscape .def-content{width:50%;max-width:none;padding:clamp(32px,4vw,48px);justify-content:center}
body.landscape .def-word{font-size:clamp(48px,6vw,72px)}
body.landscape .def-meaning{font-size:clamp(18px,2.2vw,22px)}
body.landscape .def-example{font-size:clamp(16px,2vw,18px)}
body.portrait .def-wrap{flex-direction:column}
body.portrait .def-hero{width:100%;height:clamp(160px,38vw,240px)}
body.portrait .def-content{max-width:420px}
body.portrait .def-word{font-size:clamp(36px,10vw,52px)}
</style>
<div class="def-wrap">
  <div class="def-hero">
    <img src="{image_url}" alt="" onerror="this.parentElement.style.background='linear-gradient(135deg,#1a1a2e,#16213e)';this.remove()">
  </div>
  <div class="def-content">
    <div class="def-word">{word}</div>
    <div class="def-phon">{pronunciation}</div>
    <div class="def-pos">{part_of_speech}</div>
    <div class="def-line"></div>
    <div class="def-meaning">{definition}</div>
    <div class="def-example">"{example_sentence}"</div>
  </div>
</div>
""", {"word": "word", "pronunciation": "", "part_of_speech": "noun", "definition": "", "example_sentence": "", "image_url": ""})

# ===========================
# RECIPE CARD
# ===========================

_reg("recipe_card", "Cinematic recipe card with hero food photo, elegant sections, and atmospheric design", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0a0a1a;color:#f0ece4;min-height:100vh;
display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;overflow-x:hidden}
@keyframes rc-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
.rc-wrap{width:100%;min-height:100vh;display:flex;flex-direction:column}
.rc-hero{position:relative;width:100%;height:clamp(200px,52vw,300px);overflow:hidden;flex-shrink:0}
.rc-hero img{width:100%;height:100%;object-fit:cover;animation:rc-up .7s both}
.rc-hero::after{content:'';position:absolute;inset:0;
background:linear-gradient(0deg,#0a0a1a 0%,rgba(10,10,26,.6) 40%,transparent 100%)}
.rc-content{padding:clamp(24px,5vw,36px);flex:1;display:flex;flex-direction:column;
max-width:560px;width:100%;margin:0 auto}
.rc-name{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(28px,7.5vw,40px);
font-weight:700;color:#fff;line-height:1.15;letter-spacing:-.02em;margin-bottom:8px;animation:rc-up .5s .1s both}
.rc-meta{display:flex;align-items:center;gap:8px;margin-bottom:clamp(22px,5.5vw,30px);animation:rc-up .5s .2s both}
.rc-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;
background:rgba(217,79,142,.1);border:1px solid rgba(217,79,142,.2)}
.rc-badge-text{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);font-weight:600;
text-transform:uppercase;letter-spacing:.12em;color:#e879a8}
.rc-section{background:rgba(255,255,255,.03);border-radius:14px;padding:clamp(18px,4.5vw,24px);
border:1px solid rgba(255,255,255,.06);backdrop-filter:blur(10px);margin-bottom:12px}
.rc-section:first-of-type{animation:rc-up .5s .3s both}
.rc-section:last-of-type{animation:rc-up .5s .4s both}
.rc-sec-label{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);font-weight:600;
text-transform:uppercase;letter-spacing:.14em;margin-bottom:12px}
.rc-sec-label.ing{color:#8b5cf6}
.rc-sec-label.stp{color:#38bdf8}
.rc-sec-body{font-size:clamp(14px,3.5vw,16px);line-height:1.8;color:rgba(240,236,228,.7)}
body.landscape .rc-wrap{flex-direction:row;min-height:100vh}
body.landscape .rc-hero{width:45%;height:auto;min-height:100vh}
body.landscape .rc-content{width:55%;max-width:none;padding:clamp(32px,4vw,48px);overflow-y:auto;max-height:100vh}
body.landscape .rc-name{font-size:clamp(34px,4.5vw,48px)}
body.landscape .rc-sec-body{font-size:clamp(15px,1.8vw,17px)}
body.portrait .rc-wrap{flex-direction:column}
body.portrait .rc-hero{width:100%;height:clamp(180px,42vw,280px)}
body.portrait .rc-content{max-width:420px}
</style>
<div class="rc-wrap">
  <div class="rc-hero">
    <img src="{image_url}" alt="" onerror="this.parentElement.style.background='linear-gradient(135deg,#1a1020,#0a1628)';this.remove()">
  </div>
  <div class="rc-content">
    <div class="rc-name">{dish_name}</div>
    <div class="rc-meta"><div class="rc-badge"><span class="rc-badge-text"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FF6B35" style="display:inline-block;width:18px;height:18px;vertical-align:middle"><path d="M9 2h2v4H9zM7 6h2v2H7zM5 8h2v2H5zm8 2h2v2h-2zm2-2h2v2h-2zm2 2h2v2h-2zm2 2h2v6h-2zM3 10h2v8H3zm8-4h2v4h-2zm6 12h2v2h-2zM7 20h10v2H7zm-2-2h2v2H5zm4-2h6v4H9z"/> <path d="M11 14h2v3h-2z"/></svg> {cook_time}</span></div></div>
    <div class="rc-section"><div class="rc-sec-label ing">Ingredients</div><div class="rc-sec-body">{ingredients}</div></div>
    <div class="rc-section"><div class="rc-sec-label stp">Steps</div><div class="rc-sec-body">{steps}</div></div>
  </div>
</div>
""", {"dish_name": "Recipe", "image_url": "", "cook_time": "-- min", "ingredients": "", "steps": ""})

# ===========================
# GAME SCOREBOARD
# ===========================

_reg("game_scoreboard", "Premium scoreboard with hero photo, glass leaderboard, and atmospheric design", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0a0a1a;color:#f0ece4;min-height:100vh;
display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;overflow-x:hidden}
@keyframes gs-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes gs-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
.gs-wrap{width:100%;min-height:100vh;display:flex;flex-direction:column}
.gs-hero{position:relative;width:100%;height:clamp(160px,44vw,240px);overflow:hidden;flex-shrink:0}
.gs-hero img{width:100%;height:100%;object-fit:cover;animation:gs-up .7s both}
.gs-hero::after{content:'';position:absolute;inset:0;
background:linear-gradient(0deg,#0a0a1a 0%,rgba(10,10,26,.7) 40%,transparent 100%)}
.gs-accent{height:3px;background:linear-gradient(90deg,#e8c547,#d94f8e,#8b5cf6,#d94f8e,#e8c547);
background-size:200% 100%;animation:gs-shimmer 4s linear infinite;flex-shrink:0}
.gs-content{padding:clamp(24px,5vw,36px);flex:1;display:flex;flex-direction:column;
max-width:520px;width:100%;margin:0 auto;text-align:center}
.gs-label{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);font-weight:600;
text-transform:uppercase;letter-spacing:.18em;color:#e8c547;margin-bottom:8px;animation:gs-up .5s .1s both}
.gs-name{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(24px,6.5vw,34px);
font-weight:700;color:#fff;line-height:1.2;margin-bottom:clamp(18px,4.5vw,24px);animation:gs-up .5s .2s both}
.gs-board{background:rgba(255,255,255,.03);border-radius:14px;padding:clamp(16px,4vw,22px);
border:1px solid rgba(255,255,255,.06);backdrop-filter:blur(10px);animation:gs-up .5s .3s both;
text-align:left}
body.landscape .gs-content{max-width:560px}
body.landscape .gs-name{font-size:clamp(30px,4vw,42px)}
body.landscape .gs-hero{height:clamp(220px,28vw,300px)}
</style>
<div class="gs-wrap">
  <div class="gs-hero">
    <img src="{image_url}" alt="" onerror="this.parentElement.style.background='linear-gradient(135deg,#0f0a2e,#1a0a28)';this.remove()">
  </div>
  <div class="gs-accent"></div>
  <div class="gs-content">
    <div class="gs-label"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FFD700" style="display:inline-block;width:20px;height:20px;vertical-align:middle"><path d="M6 3h12v2H6z"/> <path d="M6 3h2v12H6zm10 0h2v12h-2z"/> <path d="M16 5h6v2h-6zM2 5h6v2H2zm0 2h2v4H2zm2 4h2v2H4zm14 0h2v2h-2zm2-4h2v4h-2zM8 15h8v2H8zm3 2h2v4h-2z"/> <path d="M9 19h6v2H9z"/></svg> Scoreboard</div>
    <div class="gs-name">{game_name}</div>
    <div class="gs-board">{scores}</div>
  </div>
</div>
""", {"game_name": "Game", "scores": '<div class="list-item">No scores yet</div>', "image_url": ""})

# ===========================
# INTERACTIVE & FUN
# ===========================

_reg("quiz_question", "Game-show style quiz with dramatic lighting, numbered options, and hero photo", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0a0a1a;color:#f0ece4;min-height:100vh;
display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;overflow-x:hidden}
@keyframes qq-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes qq-glow{0%,100%{box-shadow:0 0 20px rgba(139,92,246,.15),inset 0 1px 0 rgba(255,255,255,.06)}
50%{box-shadow:0 0 30px rgba(139,92,246,.25),inset 0 1px 0 rgba(255,255,255,.1)}}
@keyframes qq-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
.qq-wrap{width:100%;min-height:100vh;display:flex;flex-direction:column;position:relative}
.qq-hero{position:relative;width:100%;height:clamp(160px,44vw,260px);overflow:hidden;flex-shrink:0}
.qq-hero img{width:100%;height:100%;object-fit:cover;animation:qq-up .7s both}
.qq-hero::after{content:'';position:absolute;inset:0;
background:linear-gradient(0deg,#0a0a1a 0%,rgba(10,10,26,.7) 40%,rgba(10,10,26,.2) 70%,transparent 100%)}
.qq-accent{height:3px;background:linear-gradient(90deg,#8b5cf6,#d94f8e,#e8c547,#d94f8e,#8b5cf6);
background-size:200% 100%;animation:qq-shimmer 3s linear infinite;flex-shrink:0}
.qq-content{padding:clamp(24px,5vw,36px);flex:1;display:flex;flex-direction:column;
max-width:560px;width:100%;margin:0 auto}
.qq-cat{display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:20px;
background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.25);align-self:flex-start;
margin-bottom:clamp(16px,4vw,22px);animation:qq-up .5s .1s both}
.qq-cat-text{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);font-weight:600;
text-transform:uppercase;letter-spacing:.14em;color:#a78bfa}
.qq-question{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(22px,6vw,32px);
font-weight:700;color:#fff;line-height:1.25;letter-spacing:-.02em;
margin-bottom:clamp(20px,5vw,28px);animation:qq-up .5s .2s both}
.qq-opts{display:flex;flex-direction:column;gap:10px;animation:qq-up .5s .3s both}
.qq-opts .choice-btn{display:flex;align-items:center;gap:14px;width:100%;
padding:clamp(14px,3.5vw,18px) clamp(16px,4vw,22px);border-radius:14px;
background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);
color:var(--c-text,#f0ece4);font-family:'Inter',sans-serif;font-size:clamp(14px,3.5vw,16px);
text-align:left;cursor:pointer;transition:all .3s cubic-bezier(.22,1,.36,1);
backdrop-filter:blur(8px);animation:qq-glow 4s ease-in-out infinite;animation-delay:calc(var(--i,0) * .15s)}
.qq-opts .choice-btn:hover{background:rgba(139,92,246,.12);border-color:rgba(139,92,246,.4);
transform:translateX(6px)}
body.landscape .qq-content{max-width:600px;padding:clamp(32px,4vw,48px)}
body.landscape .qq-question{font-size:clamp(28px,4vw,40px)}
body.landscape .qq-hero{height:clamp(240px,30vw,340px)}
</style>
<div class="qq-wrap">
  <div class="qq-hero">
    <img src="{image_url}" alt="" onerror="this.parentElement.style.background='linear-gradient(135deg,#0f0a2e,#1a0a28,#0a1628)';this.remove()">
  </div>
  <div class="qq-accent"></div>
  <div class="qq-content">
    <div class="qq-cat"><span class="qq-cat-text"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#E8C547" style="display:inline-block;width:18px;height:18px;vertical-align:middle"><path d="M6 2h12v2H6zm0 18h12v2H6zM18 4h2v2h-2zM4 18h2v2H4zM4 4h2v2H4zm14 14h2v2h-2zM2 6h2v12H2zm18 0h2v12h-2zM8 4h2v4H8zm2 4h4v2h-4zm4 2h4v2h-4zm4-2h2v2h-2zM4 12h2v2H4zm6 4h2v4h-2zm-4-2h4v2H6zm8 2h2v4h-2zm2-2h4v2h-4z"/></svg> {category}</span></div>
    <div class="qq-question">{question}</div>
    <div class="qq-opts">{options}</div>
  </div>
</div>
""", {"question": "Question?", "category": "Trivia", "options": "", "image_url": ""})

_reg("poll", "Premium poll with glass vote bars, animated fills, and atmospheric background", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0a0a1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(20px,5vw,32px);overflow:hidden}
@keyframes poll-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes poll-fill{from{width:0}to{width:var(--w,0%)}}
@keyframes poll-orb{0%,100%{opacity:.05;transform:scale(1)}50%{opacity:.12;transform:scale(1.2)}}
.poll{width:100%;max-width:500px;position:relative;overflow-x:hidden;box-sizing:border-box}
.poll::before{content:'';position:absolute;top:-60px;right:-40px;width:240px;height:240px;border-radius:50%;
background:radial-gradient(circle,rgba(139,92,246,.08),transparent 70%);animation:poll-orb 8s ease-in-out infinite;pointer-events:none}
.poll::after{content:'';position:absolute;bottom:-60px;left:-40px;width:200px;height:200px;border-radius:50%;
background:radial-gradient(circle,rgba(217,79,142,.06),transparent 70%);animation:poll-orb 10s 2s ease-in-out infinite;pointer-events:none}
.poll-icon{font-size:clamp(28px,7vw,36px);margin-bottom:10px;animation:poll-up .5s both}
.poll-q{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(24px,6.5vw,34px);
font-weight:700;color:#fff;line-height:1.2;letter-spacing:-.02em;margin-bottom:clamp(22px,5.5vw,32px);
animation:poll-up .5s .1s both;position:relative}
.poll-opts{display:flex;flex-direction:column;gap:14px;position:relative}
.poll-opt{background:rgba(255,255,255,.03);border-radius:14px;padding:clamp(14px,3.5vw,18px);
border:1px solid rgba(255,255,255,.07);backdrop-filter:blur(12px);position:relative;overflow:hidden;
animation:poll-up .5s calc(.2s + var(--i,0) * .1s) both;transition:border-color .3s}
.poll-opt:hover{border-color:rgba(139,92,246,.3)}
.poll-opt-bar{position:absolute;top:0;left:0;height:100%;border-radius:14px;
background:linear-gradient(90deg,rgba(139,92,246,.12),rgba(56,189,248,.08));
animation:poll-fill 1.2s calc(.6s + var(--i,0) * .15s) cubic-bezier(.22,1,.36,1) both}
.poll-opt-inner{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center}
.poll-opt-label{font-family:'Inter',sans-serif;font-size:clamp(14px,3.5vw,16px);color:rgba(240,236,228,.85)}
.poll-opt-pct{font-family:'Space Grotesk',sans-serif;font-size:clamp(16px,4vw,20px);font-weight:700;color:#fff}
body.landscape .poll{max-width:560px}
body.landscape .poll-q{font-size:clamp(30px,4vw,42px)}
body.landscape .poll-opt{padding:clamp(16px,2.5vw,22px)}
</style>
<div class="poll">
  <div class="poll-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#7C8CFF" style="display:inline-block;width:28px;height:28px;vertical-align:middle"><path d="M4 20h18v2H4zM2 2h2v18H2zm16 11v3h-2v-3zM8 13v3H6v-3zm8-2v2H8v-2zm0 5v2H8v-2zm4-12v3h-2V4zM8 4v3H6V4zm10-2v2H8V2zm0 5v2H8V7z"/></svg></div>
  <div class="poll-q">{question}</div>
  <div class="poll-opts">{options}</div>
</div>
""", {"question": "What do you think?", "options": ""})

_reg("story_choice", "Immersive interactive story with cinematic atmosphere and glowing choice buttons", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#080816;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(24px,6vw,40px);overflow:hidden}
@keyframes sc-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes sc-breathe{0%,100%{opacity:.04}50%{opacity:.1}}
@keyframes sc-flicker{0%,100%{opacity:.7}50%{opacity:1}}
@keyframes sc-drift{0%{transform:translateX(0) translateY(0)}50%{transform:translateX(8px) translateY(-4px)}100%{transform:translateX(0) translateY(0)}}
.sc{width:100%;max-width:520px;position:relative}
.sc::before{content:'';position:absolute;top:-80px;left:50%;transform:translateX(-50%);
width:350px;height:350px;border-radius:50%;pointer-events:none;
background:radial-gradient(circle,rgba(232,197,71,.05),transparent 70%);animation:sc-breathe 8s ease-in-out infinite}
.sc::after{content:'';position:absolute;bottom:-60px;right:-30px;width:200px;height:200px;border-radius:50%;
background:radial-gradient(circle,rgba(217,79,142,.04),transparent 70%);animation:sc-drift 12s ease-in-out infinite;pointer-events:none}
.sc-divider{width:40px;height:2px;background:linear-gradient(90deg,#e8c547,#d94f8e);border-radius:1px;
margin-bottom:clamp(20px,5vw,28px);animation:sc-up .6s .05s both}
.sc-text{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(17px,4.5vw,22px);
line-height:1.8;color:rgba(240,236,228,.82);margin-bottom:clamp(28px,7vw,40px);
animation:sc-up .6s .15s both;position:relative}
.sc-text::first-letter{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(36px,9vw,48px);
font-weight:700;float:left;line-height:1;margin-right:8px;margin-top:4px;
background:linear-gradient(135deg,#e8c547,#d94f8e);-webkit-background-clip:text;background-clip:text;color:transparent}
.sc-choices{display:flex;flex-direction:column;gap:10px;position:relative}
.sc-choices .choice-btn{display:block;width:100%;padding:clamp(14px,3.5vw,18px) clamp(18px,4.5vw,24px);
border-radius:14px;background:rgba(232,197,71,.04);border:1px solid rgba(232,197,71,.15);
color:#f0ece4;font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(14px,3.5vw,16px);
text-align:left;cursor:pointer;transition:all .3s cubic-bezier(.22,1,.36,1);
backdrop-filter:blur(8px);animation:sc-up .5s calc(.3s + var(--i,0) * .1s) both}
.sc-choices .choice-btn:hover{background:rgba(232,197,71,.1);border-color:rgba(232,197,71,.35);
transform:translateX(6px);box-shadow:0 0 20px rgba(232,197,71,.08)}
.sc-choices .choice-btn::before{content:'✦';margin-right:12px;color:#e8c547;font-size:12px;
animation:sc-flicker 3s ease-in-out infinite}
body.landscape .sc{max-width:600px}
body.landscape .sc-text{font-size:clamp(19px,2.5vw,24px)}
</style>
<div class="sc">
  <div class="sc-divider"></div>
  <div class="sc-text">{narrative_text}</div>
  <div class="sc-choices">{choices}</div>
</div>
""", {"narrative_text": "The story unfolds...", "choices": ""})

_reg("countdown_timer", "Dramatic countdown with full-bleed photo background and huge monospace digits", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0a0a1a;color:#f0ece4;min-height:100vh;
overflow:hidden;-webkit-font-smoothing:antialiased}
@keyframes fu{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.7}}
.cd-wrap{width:100%;min-height:100vh;display:flex;align-items:center;justify-content:center;
position:relative;overflow:hidden;background:#0a0a1a}
.cd-bg{position:absolute;inset:0;z-index:0}
.cd-bg img{width:100%;height:100%;object-fit:cover;display:block}
.cd-scrim{position:absolute;inset:0;z-index:1;pointer-events:none;
background:linear-gradient(0deg,rgba(8,8,20,.8) 0%,rgba(8,8,20,.35) 40%,rgba(8,8,20,.2) 100%)}
.countdown{text-align:center;position:relative;z-index:2}
.countdown-label{font-family:'Space Grotesk',sans-serif;font-size:clamp(11px,3vw,14px);
font-weight:600;text-transform:uppercase;letter-spacing:.2em;color:#d94f8e;margin-bottom:16px;
animation:fu .6s .15s both;text-shadow:0 1px 8px rgba(0,0,0,.4)}
.countdown-display{font-family:'JetBrains Mono',monospace;font-size:clamp(48px,14vw,84px);
font-weight:700;color:#fff;letter-spacing:.02em;line-height:1;
text-shadow:0 4px 32px rgba(0,0,0,.6);animation:fu .6s .3s both,pulse 3s 1s ease-in-out infinite}
.countdown-target{font-family:'Space Grotesk',sans-serif;font-size:clamp(11px,2.8vw,13px);
color:rgba(240,236,228,.35);margin-top:16px;letter-spacing:.06em;
animation:fu .6s .5s both;text-shadow:0 1px 6px rgba(0,0,0,.3)}
body.landscape .countdown-display{font-size:clamp(80px,10vw,110px)}
body.landscape .countdown-label{font-size:clamp(14px,1.8vw,17px)}
body.landscape .countdown-target{font-size:clamp(14px,1.5vw,16px)}
</style>
<div class="cd-wrap">
  <div class="cd-bg"><img src="{image_url}" alt="" onerror="this.parentElement.style.background='linear-gradient(135deg,#0a0a1a,#12082e)';this.remove()"></div>
  <div class="cd-scrim"></div>
  <div class="countdown">
    <div class="countdown-label">{event_name}</div>
    <div class="countdown-display">{countdown_display}</div>
    <div class="countdown-target">{target_date}</div>
  </div>
</div>
""", {"event_name": "Countdown", "countdown_display": "00:00:00", "target_date": "", "image_url": ""})

_reg("achievement_unlocked", "Achievement/badge unlocked notification", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased}
@keyframes bounce-in{0%{transform:scale(0.3);opacity:0}50%{transform:scale(1.08)}70%{transform:scale(0.95)}100%{transform:scale(1);opacity:1}}
@keyframes glow{0%,100%{filter:brightness(1) drop-shadow(0 0 8px rgba(232,197,71,0.3))}50%{filter:brightness(1.3) drop-shadow(0 0 16px rgba(232,197,71,0.5))}}
@keyframes fade-up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.ach{text-align:center;max-width:320px}
.ach-hero{width:100%;height:clamp(120px,34vw,180px);border-radius:14px;background-size:cover;
background-position:center;margin-bottom:18px;animation:fade-up .6s .05s both;position:relative;
box-shadow:0 12px 40px rgba(0,0,0,.4),0 0 0 1px rgba(255,255,255,.06) inset}
.ach-hero::after{content:'';position:absolute;inset:0;border-radius:14px;
background:linear-gradient(0deg,rgba(10,10,26,.6) 0%,transparent 50%)}
.ach-hero:empty{display:none}
.ach-icon{font-size:clamp(40px,12vw,56px);margin-bottom:12px;animation:bounce-in 0.8s both,glow 3s 0.8s ease-in-out infinite}
.ach-badge{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);font-weight:600;
text-transform:uppercase;letter-spacing:0.2em;color:#e8c547;margin-bottom:10px;animation:fade-up 0.6s 0.4s both}
.ach-title{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-size:clamp(22px,6vw,30px);
font-weight:700;color:#fff;margin-bottom:8px;animation:fade-up 0.6s 0.5s both}
.ach-desc{font-size:clamp(12px,3vw,14px);color:rgba(240,236,228,0.5);line-height:1.6;
margin-bottom:14px;animation:fade-up 0.6s 0.6s both}
.ach-rarity{display:inline-block;padding:4px 14px;border-radius:20px;font-family:'Space Grotesk',sans-serif;
font-size:clamp(10px,2.5vw,11px);font-weight:500;letter-spacing:0.08em;text-transform:uppercase;
background:rgba(232,197,71,0.1);color:#e8c547;border:1px solid rgba(232,197,71,0.2);animation:fade-up 0.6s 0.7s both}
body.landscape .ach{max-width:420px}
body.landscape .ach-title{font-size:clamp(28px,3.5vw,36px)}
body.landscape .ach-desc{font-size:clamp(14px,1.6vw,16px)}
body.landscape .ach-icon{font-size:clamp(52px,7vw,68px)}
</style>
<div class="ach">
  <div class="ach-hero" style="background-image:url('{image_url}')"></div>
  <div class="ach-icon">{icon}</div>
  <div class="ach-badge">Achievement Unlocked</div>
  <div class="ach-title">{title}</div>
  <div class="ach-desc">{description}</div>
  <div class="ach-rarity">{rarity}</div>
</div>
<script>document.querySelectorAll('.ach-hero').forEach(function(el){if(!el.style.backgroundImage||el.style.backgroundImage==="url('')"||el.style.backgroundImage==='url(\\'\\')'){el.style.display='none'}else{var img=new Image();img.onerror=function(){el.style.display='none'};img.src=el.style.backgroundImage.slice(5,-2)}})</script>
""", {"title": "Achievement", "description": "", "icon": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='#FFD700' style='display:inline-block;width:32px;height:32px;vertical-align:middle'><path d='M6 3h12v2H6z'/> <path d='M6 3h2v12H6zm10 0h2v12h-2z'/> <path d='M16 5h6v2h-6zM2 5h6v2H2zm0 2h2v4H2zm2 4h2v2H4zm14 0h2v2h-2zm2-4h2v4h-2zM8 15h8v2H8zm3 2h2v4h-2z'/> <path d='M9 19h6v2H9z'/></svg>", "rarity": "Common", "image_url": ""})

# ===========================
# CALCULATOR
# ===========================

_reg("calculator", "Elegant math display with dramatic result and step-by-step breakdown", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0a0a1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(20px,5vw,32px);overflow:hidden}
@keyframes calc-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes calc-glow{0%,100%{text-shadow:0 0 20px rgba(56,189,248,.2)}50%{text-shadow:0 0 40px rgba(56,189,248,.35)}}
@keyframes calc-orb{0%,100%{opacity:.04;transform:scale(1)}50%{opacity:.1;transform:scale(1.15)}}
.calc{width:100%;max-width:480px;position:relative}
.calc::before{content:'';position:absolute;top:-60px;right:-30px;width:200px;height:200px;border-radius:50%;
background:radial-gradient(circle,rgba(56,189,248,.06),transparent 70%);animation:calc-orb 8s ease-in-out infinite;pointer-events:none}
.calc-label{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,12px);font-weight:600;
text-transform:uppercase;letter-spacing:.2em;color:#38bdf8;margin-bottom:clamp(18px,4.5vw,24px);
animation:calc-up .5s both}
.calc-display{background:rgba(255,255,255,.03);border-radius:16px;
padding:clamp(24px,6vw,36px);border:1px solid rgba(255,255,255,.06);
backdrop-filter:blur(12px);text-align:right;margin-bottom:clamp(18px,4.5vw,24px);
animation:calc-up .5s .1s both}
.calc-expr{font-family:'JetBrains Mono',monospace;font-size:clamp(13px,3.2vw,16px);
color:rgba(240,236,228,.35);margin-bottom:10px;word-break:break-all}
.calc-result{font-family:'Space Grotesk',sans-serif;font-size:clamp(44px,12vw,64px);
font-weight:700;color:#fff;letter-spacing:-.03em;line-height:1;animation:calc-glow 4s ease-in-out infinite}
.calc-work{background:rgba(255,255,255,.02);border-radius:14px;padding:clamp(18px,4.5vw,24px);
border:1px solid rgba(255,255,255,.05);animation:calc-up .5s .25s both}
.calc-work-label{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);font-weight:600;
text-transform:uppercase;letter-spacing:.14em;color:#8b5cf6;margin-bottom:12px}
.calc-work-body{font-family:'JetBrains Mono',monospace;font-size:clamp(13px,3.2vw,15px);
line-height:1.9;color:rgba(240,236,228,.6)}
body.landscape .calc{max-width:540px}
body.landscape .calc-result{font-size:clamp(56px,8vw,76px)}
body.landscape .calc-work-body{font-size:clamp(14px,1.6vw,16px)}
</style>
<div class="calc">
  <div class="calc-label"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#e8c547" style="display:inline-block;width:18px;height:18px;vertical-align:middle"><path d="M11 1h2v4h-2zm0 22h2v-4h-2zM9 5h2v4H9zm0 14h2v-4H9zm4-14h2v4h-2zm0 14h2v-4h-2zM5 9h4v2H5zm14 0h-4v2h4zM1 11h4v2H1zm22 0h-4v2h4zM5 13h4v2H5zm14 0h-4v2h4z"/></svg> Calculation</div>
  <div class="calc-display">
    <div class="calc-expr">{expression}</div>
    <div class="calc-result">{result}</div>
  </div>
  <div class="calc-work">
    <div class="calc-work-label">Work</div>
    <div class="calc-work-body">{steps}</div>
  </div>
</div>
""", {"expression": "", "result": "0", "steps": ""})

# ===========================
# DATA & VISUAL
# ===========================

# ---------------------------------------------------------------------------
# COMPARISON TABLE — Glassmorphism spec-sheet with neon accents
# ---------------------------------------------------------------------------
_reg("comparison_table", "Premium glassmorphism comparison with neon accent bars and hover effects", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#06060e;color:#e0e0e0;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:48px clamp(24px,5vw,48px) 80px}
@keyframes ct-up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes ct-orb{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-12px) scale(1.05)}}
.ct{width:100%;max-width:700px;margin:0 auto;position:relative}
.ct::before{content:'';position:absolute;top:-80px;right:-60px;width:300px;height:300px;border-radius:50%;
background:radial-gradient(circle,rgba(139,92,246,.08),transparent 70%);animation:ct-orb 14s ease-in-out infinite;pointer-events:none}
.ct-label{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;
text-transform:uppercase;letter-spacing:.2em;color:#a78bfa;margin-bottom:10px;
animation:ct-up .5s both;position:relative;z-index:2}
.ct-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(24px,6.5vw,34px);
font-weight:700;line-height:1.15;letter-spacing:-.03em;margin-bottom:4px;animation:ct-up .5s .05s both;
position:relative;z-index:2;
background:linear-gradient(135deg,#fff 50%,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}
.ct-rule{width:100%;height:2px;
background:linear-gradient(90deg,#a78bfa,#38bdf8,transparent);
margin:clamp(16px,4vw,24px) 0;animation:ct-up .5s .1s both;position:relative;z-index:2}
.ct-items{display:flex;flex-direction:column;animation:ct-up .5s .15s both;position:relative;z-index:2}
.ct-items>div{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;
padding:clamp(12px,3vw,16px) clamp(10px,2vw,16px);
border-bottom:1px solid rgba(139,92,246,.08);border-radius:8px;
animation:ct-up .4s calc(.2s + var(--i,0) * .06s) both;
transition:background .3s,border-color .3s}
.ct-items>div:hover{background:rgba(139,92,246,.05);border-color:rgba(139,92,246,.15)}
.ct-items>div:nth-child(even){background:rgba(255,255,255,.015)}
.ct-items>div:last-child{border-bottom:none}
.ct-dots{display:inline-block;letter-spacing:2px;font-size:10px;margin-top:3px}
.ct-bar{height:3px;border-radius:1.5px;margin-top:5px;background:rgba(255,255,255,.06)}
.ct-bar-fill{height:100%;border-radius:1.5px;background:linear-gradient(90deg,#a78bfa,#38bdf8);transition:width .6s}
.ct-bar-fill.strong{background:linear-gradient(90deg,#e8c547,#d94f8e)}
body.landscape .ct{max-width:900px}
body.landscape .ct-title{font-size:clamp(30px,4vw,40px)}
</style>
<div class="ct">
  <div class="ct-label">Comparison</div>
  <div class="ct-title">{title}</div>
  <div class="ct-rule"></div>
  <div class="ct-items">{items}</div>
</div>
""", {"title": "Comparison", "items": ""})

_reg("timeline", "Museum-style B&W vertical timeline with variable nodes, impact bars, and gradient connector", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#060606;color:#e0e0e0;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:60px clamp(24px,5vw,40px) 100px}
@keyframes tl-up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes tl-bar{from{width:0}to{width:var(--impact-w,60%)}}
.tl{width:100%;max-width:500px}
.tl-title{font-family:'Inter',sans-serif;font-size:clamp(24px,6.5vw,34px);
font-weight:700;color:#fff;line-height:1.15;letter-spacing:-.03em;margin-bottom:4px;animation:tl-up .5s both}
.tl-rule{width:100%;height:1px;background:rgba(255,255,255,.12);margin:clamp(16px,4vw,24px) 0;
animation:tl-up .5s .08s both}
.tl-track{position:relative;padding-left:36px;margin-left:8px}
.tl-track::before{content:'';position:absolute;left:4px;top:0;bottom:0;width:1px;
background:linear-gradient(180deg,rgba(255,255,255,.3),rgba(255,255,255,.08))}
.tl-track>div{position:relative;padding-bottom:clamp(24px,5vw,32px);
animation:tl-up .5s calc(.12s + var(--i,0) * .08s) both}
.tl-track>div:last-child{padding-bottom:0}
.tl-track>div::before{content:'';position:absolute;top:5px;
border-radius:50%;background:#fff;box-shadow:0 0 0 3px #060606,0 0 0 4px rgba(255,255,255,.2);
width:var(--node-size,7px);height:var(--node-size,7px);
left:calc(-36px + 4px - var(--node-size,7px)/2)}
.tl-track>div::after{content:'';position:absolute;left:-18px;top:8px;width:14px;height:1px;
background:rgba(255,255,255,.1)}
.tl-impact{height:2px;border-radius:1px;margin-top:6px;background:rgba(255,255,255,.06);max-width:80%}
.tl-impact-fill{height:100%;border-radius:1px;background:rgba(255,255,255,.2);
animation:tl-bar 1s .8s cubic-bezier(.22,1,.36,1) both}
body.landscape .tl{max-width:580px}
body.landscape .tl-title{font-size:clamp(30px,4vw,40px)}
</style>
<div class="tl">
  <div class="tl-title">{title}</div>
  <div class="tl-rule"></div>
  <div class="tl-track">{events}</div>
</div>
""", {"title": "Timeline", "events": ""})

_reg("stat_dashboard", "Bloomberg-style B&W dashboard with monospace numbers, sparklines, and bar fills", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#060606;color:#e0e0e0;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:60px clamp(20px,5vw,32px) 100px}
@keyframes sd-up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes sd-bar{from{width:0}to{width:var(--bar-w,0%)}}
.sd{width:100%;max-width:540px}
.sd-label{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;
text-transform:uppercase;letter-spacing:.2em;color:rgba(255,255,255,.3);margin-bottom:10px;
animation:sd-up .5s both}
.sd-title{font-family:'Inter',sans-serif;font-size:clamp(24px,6.5vw,34px);
font-weight:700;color:#fff;line-height:1.15;letter-spacing:-.03em;margin-bottom:4px;animation:sd-up .5s .05s both}
.sd-rule{width:100%;height:1px;background:rgba(255,255,255,.12);margin:clamp(16px,4vw,24px) 0;
animation:sd-up .5s .1s both}
.sd-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:rgba(255,255,255,.06);
border:1px solid rgba(255,255,255,.08);animation:sd-up .5s .15s both}
.sd-grid .glass{background:#0a0a0a;border:none;border-radius:0;
padding:clamp(18px,4vw,26px);display:flex;flex-direction:column;gap:6px;
animation:sd-up .5s calc(.2s + var(--i,0) * .06s) both;position:relative;overflow:hidden}
.sd-grid .glass::after{content:'';position:absolute;bottom:0;left:clamp(18px,4vw,26px);
right:clamp(18px,4vw,26px);height:1px;background:rgba(255,255,255,.06)}
.sd-grid .glass .sd-bar-bg{position:absolute;top:0;left:0;height:100%;
background:rgba(255,255,255,.04);animation:sd-bar 1.2s .6s cubic-bezier(.22,1,.36,1) both}
body.landscape .sd{max-width:620px}
body.landscape .sd-title{font-size:clamp(30px,4vw,40px)}
</style>
<div class="sd">
  <div class="sd-label">Dashboard</div>
  <div class="sd-title">{title}</div>
  <div class="sd-rule"></div>
  <div class="sd-grid">{stats}</div>
</div>
""", {"title": "Dashboard", "stats": ""})

_reg("progress_tracker", "Clean B&W project tracker with SVG arc gauge and step indicators", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#060606;color:#e0e0e0;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(24px,5vw,40px)}
@keyframes pt-up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes pt-arc{from{stroke-dashoffset:264}to{stroke-dashoffset:var(--arc-offset,264)}}
.pt{width:100%;max-width:480px}
.pt-title{font-family:'Inter',sans-serif;font-size:clamp(24px,6.5vw,34px);
font-weight:700;color:#fff;line-height:1.15;letter-spacing:-.03em;margin-bottom:4px;animation:pt-up .5s both}
.pt-rule{width:100%;height:1px;background:rgba(255,255,255,.12);margin:clamp(16px,4vw,24px) 0;
animation:pt-up .5s .08s both}
.pt-arc-wrap{display:flex;justify-content:center;margin-bottom:clamp(20px,5vw,28px);animation:pt-up .5s .12s both}
.pt-arc-wrap svg .pt-arc-track{fill:none;stroke:rgba(255,255,255,.08);stroke-width:5}
.pt-arc-wrap svg .pt-arc-fill{fill:none;stroke:#fff;stroke-width:5;stroke-linecap:round;
transform:rotate(-90deg);transform-origin:50% 50%;
animation:pt-arc 1.2s .5s cubic-bezier(.22,1,.36,1) both}
.pt-steps{position:relative;padding-left:36px;margin-left:8px}
.pt-steps::before{content:'';position:absolute;left:5px;top:0;bottom:0;width:1px;
background:rgba(255,255,255,.1)}
.pt-step{position:relative;padding-bottom:clamp(20px,4vw,28px);
animation:pt-up .4s calc(.15s + var(--i,0) * .06s) both}
.pt-step:last-child{padding-bottom:0}
.pt-step .pt-dot{position:absolute;left:-36px;top:2px;width:11px;height:11px;
border-radius:50%;border:2px solid rgba(255,255,255,.2);background:#060606}
.pt-step.done .pt-dot{background:#fff;border-color:#fff}
.pt-step.active .pt-dot{background:transparent;border-color:#fff;
box-shadow:0 0 0 3px #060606,0 0 0 4px rgba(255,255,255,.3)}
.pt-step .pt-label{font-size:clamp(14px,3.5vw,16px);color:rgba(255,255,255,.4)}
.pt-step.done .pt-label{color:rgba(255,255,255,.7)}
.pt-step.active .pt-label{color:#fff;font-weight:600}
body.landscape .pt{max-width:560px}
body.landscape .pt-title{font-size:clamp(30px,4vw,40px)}
</style>
<div class="pt">
  <div class="pt-title">{title}</div>
  <div class="pt-rule"></div>
  {progress_arc}
  <div class="pt-steps">{steps}</div>
</div>
""", {"title": "Progress", "steps": "", "progress_arc": ""})

_reg("location_card", "Location card with description and coordinates", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(16px,4vw,24px)}
@keyframes fade-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
.loc{width:100%;max-width:100vw;min-height:100vh;display:flex;flex-direction:column;animation:fade-up 0.6s both}
.loc-img{width:100%;height:clamp(200px,44vw,300px);overflow:hidden;flex-shrink:0;
box-shadow:0 8px 32px rgba(0,0,0,0.4);animation:fade-up 0.6s 0.1s both}
.loc-img img{width:100%;height:100%;object-fit:cover}
.loc-content{flex:1;display:flex;flex-direction:column;justify-content:flex-start;
padding:clamp(24px,5vw,40px);max-width:560px;margin:0 auto;width:100%}
.loc-name{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-size:clamp(22px,6vw,30px);
font-weight:700;color:#fff;margin-bottom:4px;animation:fade-up 0.6s 0.2s both}
.loc-coords{font-family:'JetBrains Mono',monospace;font-size:clamp(10px,2.5vw,11px);
color:rgba(240,236,228,0.3);margin-bottom:14px;animation:fade-up 0.6s 0.25s both}
.loc-desc{font-size:clamp(13px,3.2vw,15px);line-height:1.75;color:rgba(240,236,228,0.65);
margin-bottom:18px;animation:fade-up 0.6s 0.3s both}
.loc-highlights{background:rgba(255,255,255,.03);border-radius:14px;padding:clamp(14px,3.5vw,20px);
border:1px solid rgba(255,255,255,.06);backdrop-filter:blur(10px);animation:fade-up 0.6s 0.4s both;
font-size:clamp(13px,3.2vw,15px);line-height:1.75;color:rgba(240,236,228,0.55)}
.loc-highlights:empty{display:none}
.loc-facts{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;animation:fade-up 0.6s 0.5s both}
.loc-fact{background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.15);border-radius:10px;
padding:8px 14px;font-family:'Space Grotesk',sans-serif;font-size:clamp(11px,2.8vw,12px);color:rgba(240,236,228,.6)}
.loc-fact-label{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:rgba(240,236,228,.3);margin-bottom:2px}
.loc-fact-val{font-weight:600;color:rgba(240,236,228,.8)}
.loc-facts:empty{display:none}
body.landscape .loc{flex-direction:row;align-items:stretch}
body.landscape .loc-img{width:50%;height:auto;min-height:100vh}
body.landscape .loc-content{width:50%;max-width:none;padding:clamp(32px,4vw,56px)}
body.landscape .loc-name{font-size:clamp(28px,3.5vw,36px)}
body.landscape .loc-desc{font-size:clamp(15px,1.8vw,17px)}
body.portrait .loc{flex-direction:column}
body.portrait .loc-img{width:100%;height:clamp(180px,42vw,280px)}
body.portrait .loc-content{max-width:420px}
</style>
<div class="loc">
  <div class="loc-img"><img src="{image_url}" onerror="this.parentElement.style.background='linear-gradient(135deg,#1a1a2e,#16213e)';this.remove()"></div>
  <div class="loc-content">
    <div class="loc-name">{place_name}</div>
    <div class="loc-coords">{coordinates}</div>
    <div class="loc-desc">{description}</div>
    <div class="loc-highlights">{highlights}</div>
    <div class="loc-facts">{quick_facts}</div>
  </div>
</div>
""", {"place_name": "Location", "image_url": "", "description": "", "coordinates": "", "highlights": "", "quick_facts": ""})

# ===========================
# UTILITY
# ===========================

_reg("greeting_card", "Personalized greeting with optional hero photo, quote, and weather hint", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0a0a1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(20px,5vw,32px)}
@keyframes fu{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes glow{0%,100%{opacity:.04}50%{opacity:.1}}
@keyframes fly{0%{transform:translate(0,0);opacity:0}10%{opacity:.6}90%{opacity:.6}100%{transform:translate(60px,-80px);opacity:0}}
.greet{text-align:center;max-width:420px;width:100%;position:relative;overflow:hidden}
.greet .p{position:absolute;width:3px;height:3px;border-radius:50%;background:#e8c547;pointer-events:none}
.greet .p:nth-child(1){top:20%;left:10%;animation:fly 6s 0s infinite}
.greet .p:nth-child(2){top:60%;left:80%;animation:fly 8s 2s infinite}
.greet .p:nth-child(3){top:40%;left:50%;animation:fly 7s 4s infinite}
.greet::before{content:'';position:absolute;top:-40%;left:50%;transform:translateX(-50%);
width:300px;height:300px;border-radius:50%;pointer-events:none;
background:radial-gradient(circle,rgba(232,197,71,.06),transparent 70%);animation:glow 6s ease-in-out infinite}
.greet-hero{width:100%;height:clamp(150px,42vw,230px);border-radius:14px;background-size:cover;
background-position:center;margin-bottom:20px;animation:fu .6s .05s both;position:relative;
box-shadow:0 12px 40px rgba(0,0,0,.4),0 0 0 1px rgba(255,255,255,.06) inset}
.greet-hero::after{content:'';position:absolute;inset:0;border-radius:14px;
background:linear-gradient(0deg,rgba(10,10,26,.5) 0%,transparent 40%)}
.greet-hero:empty{display:none}
.greet-time{font-family:'Space Grotesk',sans-serif;font-size:clamp(11px,2.8vw,13px);
color:rgba(240,236,228,.35);letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px;
animation:fu .6s .1s both;position:relative;z-index:1}
.greet-name{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-size:clamp(30px,9vw,44px);
font-weight:700;margin-bottom:24px;animation:fu .6s .2s both;position:relative;z-index:1;
background:linear-gradient(135deg,#fff 50%,#e8c547);-webkit-background-clip:text;
background-clip:text;color:transparent}
.greet-quote{background:rgba(255,255,255,.03);border-radius:14px;padding:clamp(18px,4.5vw,26px);
border:1px solid rgba(255,255,255,.06);margin-bottom:16px;animation:fu .6s .3s both;
backdrop-filter:blur(16px);position:relative;z-index:1}
.greet-quote-text{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-style:italic;
font-size:clamp(14px,3.5vw,17px);line-height:1.7;color:rgba(240,236,228,.65)}
.greet-weather{font-size:clamp(11px,2.8vw,13px);color:rgba(240,236,228,.3);animation:fu .6s .4s both}
body.landscape .greet{max-width:520px}
body.landscape .greet-name{font-size:clamp(40px,5vw,52px)}
body.landscape .greet-quote-text{font-size:clamp(16px,2vw,19px)}
body.landscape .greet-hero{height:clamp(200px,28vw,280px)}
</style>
<div class="greet">
  <div class="p"></div><div class="p"></div><div class="p"></div>
  <div class="greet-hero" style="background-image:url('{image_url}')"></div>
  <div class="greet-time">{time_of_day}</div>
  <div class="greet-name">{user_name}</div>
  <div class="greet-quote"><div class="greet-quote-text">"{motivational_quote}"</div></div>
  <div class="greet-weather">{weather_hint}</div>
</div>
<script>document.querySelectorAll('.greet-hero').forEach(function(el){if(!el.style.backgroundImage||el.style.backgroundImage==="url('')"||el.style.backgroundImage==='url(\\'\\')'){el.style.display='none'}else{var img=new Image();img.onerror=function(){el.style.display='none'};img.src=el.style.backgroundImage.slice(5,-2)}})</script>
""", {"time_of_day": "Hello", "user_name": "Friend", "motivational_quote": "Every day is a new beginning.", "weather_hint": "", "image_url": ""})

_reg("error_card", "Atmospheric error display with red glow and glass suggestion panel", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0a0a1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(20px,5vw,32px);overflow:hidden}
@keyframes err-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes err-pulse{0%,100%{opacity:.06}50%{opacity:.12}}
.err{width:100%;max-width:460px;text-align:center;position:relative}
.err::before{content:'';position:absolute;top:-80px;left:50%;transform:translateX(-50%);
width:250px;height:250px;border-radius:50%;pointer-events:none;
background:radial-gradient(circle,rgba(239,68,68,.08),transparent 70%);animation:err-pulse 5s ease-in-out infinite}
.err-icon{font-size:clamp(32px,9vw,44px);margin-bottom:14px;animation:err-up .5s both}
.err-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(22px,6vw,30px);
font-weight:700;color:#ff6b6b;line-height:1.2;margin-bottom:10px;animation:err-up .5s .1s both}
.err-msg{font-size:clamp(14px,3.5vw,16px);line-height:1.75;color:rgba(240,236,228,.6);
margin-bottom:clamp(20px,5vw,28px);animation:err-up .5s .2s both}
.err-sug{background:rgba(139,92,246,.06);border-radius:14px;padding:clamp(16px,4vw,22px);
border:1px solid rgba(139,92,246,.15);backdrop-filter:blur(10px);animation:err-up .5s .3s both}
.err-sug-text{font-size:clamp(14px,3.5vw,16px);color:#a78bfa;line-height:1.6}
body.landscape .err{max-width:520px}
body.landscape .err-title{font-size:clamp(28px,3.5vw,36px)}
</style>
<div class="err">
  <div class="err-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FF4757" style="display:inline-block;width:28px;height:28px;vertical-align:middle"><path d="M6 2h12v2H6zm0 18h12v2H6zM2 6h2v12H2zm18 0h2v12h-2zm-2-2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2H8zm-2 2h2v2H6zm12 2h2v2h-2zM4 4h2v2H4zm0 14h2v2H4z"/></svg></div>
  <div class="err-title">{error_title}</div>
  <div class="err-msg">{error_message}</div>
  <div class="err-sug"><div class="err-sug-text"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FFD700" style="display:inline-block;width:16px;height:16px;vertical-align:middle"><path d="M4 13h8v6h2v2h-2v2h-2v-8H2v-4h2v2Zm12 6h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2v-2h2v2Zm-6-6h8v4h-2v-2h-8V5h-2V3h2V1h2v8Zm-8 2H4V9h2v2Zm2-2H6V7h2v2Zm2-2H8V5h2v2Z"/></svg> {suggestion}</div></div>
</div>
""", {"error_title": "Something went wrong", "error_message": "", "suggestion": "Try again in a moment."})

_reg("loading_card", "Loading spinner with message", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:0.7}50%{opacity:1}}
.loading{text-align:center}
.loading-spinner{width:32px;height:32px;border:2px solid rgba(139,92,246,0.2);
border-top-color:#8b5cf6;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px}
.loading-msg{font-size:clamp(14px,3.5vw,16px);color:rgba(240,236,228,0.5);animation:pulse 2s ease-in-out infinite}
</style>
<div class="loading">
  <div class="loading-spinner"></div>
  <div class="loading-msg">{message}</div>
</div>
""", {"message": "Loading..."})

# ===========================
# PHOTO GALLERY — Masonry Grid
# ===========================

_reg("photo_gallery", "Stunning photo grid gallery with captions and title", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(16px,4vw,24px)}
@keyframes fade-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
.gallery{width:100%;max-width:420px;animation:fade-up 0.6s both}
.gallery-title{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-size:clamp(22px,6vw,30px);
font-weight:700;color:#fff;margin-bottom:6px;animation:fade-up 0.6s 0.1s both}
.gallery-desc{font-size:clamp(12px,3vw,14px);color:rgba(240,236,228,0.5);line-height:1.6;
margin-bottom:18px;animation:fade-up 0.6s 0.2s both}
.gallery-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;animation:fade-up 0.6s 0.3s both}
.gallery-grid .g-item{border-radius:10px;overflow:hidden;position:relative;
aspect-ratio:1;box-shadow:0 4px 16px rgba(0,0,0,0.3)}
.gallery-grid .g-item:first-child{grid-column:span 2;aspect-ratio:16/9}
.gallery-grid .g-item img{width:100%;height:100%;object-fit:cover;transition:transform 0.6s ease}
.gallery-grid .g-item:hover img{transform:scale(1.05)}
.gallery-grid .g-item .g-cap{position:absolute;bottom:0;left:0;right:0;padding:8px 10px;
background:linear-gradient(0deg,rgba(0,0,0,0.7),transparent);font-size:clamp(10px,2.5vw,11px);
color:rgba(240,236,228,0.8);font-family:'Space Grotesk',sans-serif}
body.landscape .gallery{max-width:560px}
body.landscape .gallery-title{font-size:clamp(28px,3.5vw,36px)}
body.landscape .gallery-grid{gap:12px}
</style>
<div class="gallery">
  <div class="gallery-title">{title}</div>
  <div class="gallery-desc">{description}</div>
  <div class="gallery-grid">{photos}</div>
</div>
""", {"title": "Gallery", "photos": "", "description": ""})

# ===========================
# QUOTE SPOTLIGHT — Editorial Typography
# ===========================

_reg("quote_spotlight", "Editorial magazine B&W quote with large serif italic and thin decorative rules", _FONTS + """
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#060606;color:#e0e0e0;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:0;overflow:hidden}
@keyframes qs-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.qs{width:100%;min-height:100vh;display:flex;flex-direction:row}
.qs-portrait{width:45%;min-height:100vh;overflow:hidden;flex-shrink:0;position:relative;
animation:qs-up .7s .05s both}
.qs-portrait::after{content:'';position:absolute;inset:0;
background:linear-gradient(90deg,transparent 60%,#060606 100%)}
.qs-portrait img{width:100%;height:100%;object-fit:cover;display:block;
filter:grayscale(100%) contrast(1.1)}
.qs-portrait:empty{display:none}
.qs-content{flex:1;padding:clamp(40px,6vw,80px);display:flex;flex-direction:column;
justify-content:center;align-items:flex-start}
.qs-mark{font-family:'Playfair Display',Georgia,serif;font-size:clamp(80px,12vw,120px);
font-weight:400;color:rgba(255,255,255,.08);line-height:.8;margin-bottom:-20px;
animation:qs-up .6s .15s both;user-select:none}
.qs-text{font-family:'Playfair Display',Georgia,serif;font-size:clamp(22px,3vw,36px);
font-weight:400;font-style:italic;color:#fff;line-height:1.6;max-width:560px;
animation:qs-up .6s .25s both}
.qs-rule{width:48px;height:1px;background:#fff;margin:clamp(20px,4vw,32px) 0 clamp(14px,3vw,20px);
animation:qs-up .6s .35s both}
.qs-author{font-family:'Inter',sans-serif;font-size:clamp(13px,1.6vw,16px);
font-weight:600;color:#fff;letter-spacing:.06em;text-transform:uppercase;
animation:qs-up .6s .45s both}
.qs-ctx{font-family:'Inter',sans-serif;font-size:clamp(12px,1.4vw,14px);
color:rgba(255,255,255,.3);margin-top:4px;font-style:italic;
animation:qs-up .6s .52s both}
body.portrait .qs{flex-direction:column;min-height:auto}
body.portrait .qs-portrait{width:100%;min-height:auto;height:clamp(240px,50vw,340px)}
body.portrait .qs-portrait::after{background:linear-gradient(180deg,transparent 50%,#060606 100%)}
body.portrait .qs-content{padding:clamp(24px,6vw,40px)}
body.portrait .qs-text{font-size:clamp(20px,5.5vw,28px)}
body.portrait .qs-mark{font-size:clamp(60px,16vw,90px);margin-bottom:-14px}
</style>
<div class="qs">
  <div class="qs-portrait"><img src="{image_url}" alt="" onerror="this.parentElement.style.display='none'"></div>
  <div class="qs-content">
    <div class="qs-mark">&ldquo;</div>
    <div class="qs-text">{quote}</div>
    <div class="qs-rule"></div>
    <div class="qs-author">{author}</div>
    <div class="qs-ctx">{context}</div>
    <svg width="120" height="24" viewBox="0 0 120 24" style="margin-top:clamp(20px,4vw,32px);opacity:.12;animation:qs-up .6s .6s both">
      <line x1="0" y1="4" x2="120" y2="4" stroke="#fff" stroke-width=".5"/>
      <line x1="0" y1="10" x2="80" y2="10" stroke="#fff" stroke-width=".5"/>
      <line x1="0" y1="16" x2="100" y2="16" stroke="#fff" stroke-width=".5"/>
      <circle cx="90" cy="4" r="2" fill="none" stroke="#fff" stroke-width=".5"/>
      <circle cx="110" cy="16" r="3" fill="none" stroke="#fff" stroke-width=".5"/>
    </svg>
  </div>
</div>
""", {"quote": "", "author": "", "context": "", "image_url": ""})

# ===========================
# PROFILE CARD — Social Media Premium
# ===========================

_reg("profile_card", "Modern social-media style profile card with avatar, bio, and stats", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(16px,4vw,24px)}
@keyframes fade-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes ring{0%,100%{box-shadow:0 0 0 0 rgba(217,79,142,0.3)}50%{box-shadow:0 0 0 6px rgba(217,79,142,0)}}
.pc{width:100%;max-width:420px;background:rgba(18,18,35,0.92);border-radius:16px;
padding:clamp(24px,6vw,32px);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.06);
box-shadow:0 8px 32px rgba(0,0,0,0.3);text-align:center;animation:fade-up 0.6s both}
.pc-avatar{width:88px;height:88px;border-radius:50%;margin:0 auto 16px;overflow:hidden;
border:3px solid rgba(217,79,142,0.4);animation:ring 3s ease-in-out infinite}
.pc-avatar img{width:100%;height:100%;object-fit:cover}
.pc-name{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-size:clamp(22px,6vw,28px);
font-weight:700;color:#fff;animation:fade-up 0.6s 0.1s both}
.pc-title{font-family:'Space Grotesk',sans-serif;font-size:clamp(11px,2.8vw,12px);font-weight:500;
text-transform:uppercase;letter-spacing:0.1em;color:#d94f8e;margin:4px 0 14px;animation:fade-up 0.6s 0.2s both}
.pc-bio{font-size:clamp(13px,3.2vw,15px);line-height:1.7;color:rgba(240,236,228,0.6);
margin-bottom:20px;animation:fade-up 0.6s 0.3s both}
.pc-stats{display:flex;justify-content:center;gap:clamp(16px,5vw,32px);
padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);animation:fade-up 0.6s 0.4s both}
.pc-stat{text-align:center}
.pc-stat-val{font-family:'Space Grotesk',sans-serif;font-size:clamp(18px,5vw,24px);font-weight:700;color:#fff}
.pc-stat-lbl{font-size:clamp(10px,2.5vw,11px);color:rgba(240,236,228,0.35);text-transform:uppercase;
letter-spacing:0.06em;margin-top:2px}
body.landscape .pc{max-width:520px;padding:clamp(32px,4vw,44px)}
body.landscape .pc-name{font-size:clamp(26px,3.5vw,34px)}
body.landscape .pc-avatar{width:100px;height:100px}
body.landscape .pc-bio{font-size:clamp(15px,1.8vw,17px)}
body.landscape .pc-stat-val{font-size:clamp(22px,3vw,28px)}
</style>
<div class="pc">
  <div class="pc-avatar"><img src="{avatar_url}" onerror="this.parentElement.style.display='none'"></div>
  <div class="pc-name">{name}</div>
  <div class="pc-title">{title}</div>
  <div class="pc-bio">{bio}</div>
  <div class="pc-stats">{stats}</div>
</div>
""", {"name": "", "avatar_url": "", "title": "", "bio": "", "stats": ""})

# ===========================
# MUSIC PLAYLIST — Track List
# ===========================

_reg("music_playlist", "Playlist display with tracks and currently playing indicator", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(16px,4vw,24px)}
@keyframes fade-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes eq{0%,100%{height:4px}50%{height:14px}}
.pl{width:100%;max-width:420px;animation:fade-up 0.6s both}
.pl-head{display:flex;align-items:center;gap:14px;margin-bottom:20px;animation:fade-up 0.6s 0.1s both}
.pl-icon{width:56px;height:56px;border-radius:12px;background:linear-gradient(135deg,#8b5cf6,#38bdf8);
display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;
box-shadow:0 8px 24px rgba(139,92,246,0.25)}
.pl-meta{flex:1}
.pl-name{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-size:clamp(18px,5vw,24px);
font-weight:700;color:#fff;line-height:1.2}
.pl-desc{font-size:clamp(11px,2.8vw,13px);color:rgba(240,236,228,0.4);margin-top:2px}
.pl-tracks{animation:fade-up 0.6s 0.25s both}
.pl-track{display:flex;align-items:center;gap:12px;padding:10px 0;
border-bottom:1px solid rgba(255,255,255,0.04)}
.pl-track:last-child{border-bottom:none}
.pl-track-num{font-family:'JetBrains Mono',monospace;font-size:clamp(10px,2.5vw,12px);
color:rgba(240,236,228,0.25);width:20px;text-align:right;flex-shrink:0}
.pl-track-info{flex:1;min-width:0}
.pl-track-title{font-size:clamp(13px,3.2vw,15px);color:#fff;white-space:nowrap;
overflow:hidden;text-overflow:ellipsis}
.pl-track-artist{font-size:clamp(11px,2.8vw,12px);color:rgba(240,236,228,0.35)}
.pl-track-dur{font-family:'JetBrains Mono',monospace;font-size:clamp(10px,2.5vw,12px);
color:rgba(240,236,228,0.25);flex-shrink:0}
.pl-track.playing .pl-track-title{color:#d94f8e}
.pl-track.playing .pl-track-num{color:#d94f8e}
body.landscape .pl{max-width:520px}
body.landscape .pl-name{font-size:clamp(22px,3vw,28px)}
body.landscape .pl-track-title{font-size:clamp(15px,1.8vw,17px)}
</style>
<div class="pl">
  <div class="pl-head">
    <div class="pl-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#1DB954" style="display:inline-block;width:28px;height:28px;vertical-align:middle"><path d="M4 12h4v2H4zm-2 2h2v4H2zm2 4h4v2H4zM8 6h2v12H8zm10 0h2v12h-2zm-6 8h2v4h-2zm2-2h4v2h-4zm0 6h4v2h-4zM10 4h8v2h-8z"/></svg></div>
    <div class="pl-meta">
      <div class="pl-name">{playlist_name}</div>
      <div class="pl-desc">{description}</div>
    </div>
  </div>
  <div class="pl-tracks">{tracks}</div>
</div>
""", {"playlist_name": "Playlist", "tracks": "", "description": ""})

# ===========================
# PHOTO STORY — Instagram Story
# ===========================

_reg("photo_story", "Full-screen photo with overlaid narrative text, Instagram story aesthetic", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;min-height:100vh;overflow:hidden;
-webkit-font-smoothing:antialiased}
@keyframes ken{0%{transform:scale(1)}100%{transform:scale(1.08)}}
@keyframes fade-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
.ps{position:relative;width:100%;min-height:100vh;display:flex;align-items:center;justify-content:center}
.ps-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;animation:ken 25s ease-in-out alternate infinite}
.ps-scrim{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(10,10,26,0.5) 0%,rgba(10,10,26,0.85) 100%)}
.ps-content{position:relative;z-index:2;text-align:center;padding:clamp(24px,6vw,40px);max-width:420px}
.ps-text{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-size:clamp(20px,5.5vw,28px);
font-weight:400;font-style:italic;color:#fff;line-height:1.55;text-shadow:0 2px 12px rgba(0,0,0,0.5);
animation:fade-up 0.6s 0.3s both}
.ps-attr{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,12px);
color:rgba(240,236,228,0.45);letter-spacing:0.1em;text-transform:uppercase;margin-top:20px;
animation:fade-up 0.6s 0.5s both}
body.landscape .ps-content{max-width:600px;padding:clamp(40px,5vw,64px)}
body.landscape .ps-text{font-size:clamp(28px,3.5vw,38px)}
body.landscape .ps-attr{font-size:clamp(13px,1.5vw,15px)}
</style>
<div class="ps">
  <img class="ps-img" src="{image_url}" alt="" onerror="this.style.display='none'">
  <div class="ps-scrim"></div>
  <div class="ps-content">
    <div class="ps-text">{text}</div>
    <div class="ps-attr">{attribution}</div>
  </div>
</div>
""", {"image_url": "", "text": "", "attribution": ""})

# ===========================
# EVENT CARD — Calendar Invite
# ===========================

_reg("event_card", "Upcoming event card with date, time, location, and description", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(16px,4vw,24px)}
@keyframes fade-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
.ev{width:100%;max-width:420px;background:rgba(18,18,35,0.92);border-radius:16px;
overflow:hidden;backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.06);
box-shadow:0 8px 32px rgba(0,0,0,0.3);animation:fade-up 0.6s both}
.ev-hero{width:100%;height:clamp(140px,38vw,200px);background-size:cover;
background-position:center;position:relative}
.ev-hero::after{content:'';position:absolute;inset:0;
background:linear-gradient(0deg,rgba(18,18,35,0.95) 0%,rgba(18,18,35,0.3) 50%,transparent 100%)}
.ev-hero:empty{display:none}
.ev-inner{padding:clamp(20px,5vw,32px)}
.ev-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;
background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.2);margin-bottom:16px;
animation:fade-up 0.6s 0.1s both}
.ev-badge span{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);font-weight:600;
text-transform:uppercase;letter-spacing:0.1em;color:#a78bfa}
.ev-name{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-size:clamp(22px,6vw,30px);
font-weight:700;color:#fff;line-height:1.2;margin-bottom:16px;animation:fade-up 0.6s 0.2s both}
.ev-details{display:flex;flex-direction:column;gap:10px;margin-bottom:18px;animation:fade-up 0.6s 0.3s both}
.ev-row{display:flex;align-items:center;gap:10px}
.ev-row-icon{color:#8b5cf6;font-size:16px;flex-shrink:0;width:20px;text-align:center}
.ev-row-text{font-size:clamp(13px,3.2vw,15px);color:rgba(240,236,228,0.7)}
.ev-desc{font-size:clamp(13px,3.2vw,15px);line-height:1.75;color:rgba(240,236,228,0.5);
padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);animation:fade-up 0.6s 0.4s both}
body.landscape .ev{max-width:520px}
body.landscape .ev-name{font-size:clamp(28px,3.5vw,36px)}
body.landscape .ev-desc{font-size:clamp(15px,1.8vw,17px)}
body.landscape .ev-hero{height:clamp(200px,25vw,260px)}
</style>
<div class="ev">
  <div class="ev-hero" style="background-image:url('{image_url}')"></div>
  <div class="ev-inner">
  <div class="ev-badge"><span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#7C8CFF" style="display:inline-block;width:16px;height:16px;vertical-align:middle"><path d="M5 4h14v2H5zm0 16h14v2H5zM3 10h2v10H3zm0-4h2v2H3zm16 0h2v2h-2zm0 4h2v10h-2zM3 8h18v2H3zm12-6h2v2h-2zM7 2h2v2H7z"/></svg> Event</span></div>
  <div class="ev-name">{event_name}</div>
  <div class="ev-details">
    <div class="ev-row"><span class="ev-row-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#7C8CFF" style="display:inline-block;width:16px;height:16px;vertical-align:middle"><path d="M5 4h14v2H5zm0 16h14v2H5zM3 10h2v10H3zm0-4h2v2H3zm16 0h2v2h-2zm0 4h2v10h-2zM3 8h18v2H3zm12-6h2v2h-2zM7 2h2v2H7z"/></svg></span><span class="ev-row-text">{date}</span></div>
    <div class="ev-row"><span class="ev-row-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#7C8CFF" style="display:inline-block;width:16px;height:16px;vertical-align:middle"><path d="M6 2h12v2H6zM2 6h2v12H2zm18 0h2v12h-2zm-2-2h2v2h-2zM4 4h2v2H4zm2 18h12v-2H6zm12-2h2v-2h-2zM4 20h2v-2H4zm7-14h2v7h-2zm2 7h2v2h-2zm2 2h2v2h-2z"/></svg></span><span class="ev-row-text">{time}</span></div>
    <div class="ev-row"><span class="ev-row-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#7C8CFF" style="display:inline-block;width:16px;height:16px;vertical-align:middle"><path d="M7 2h10v2H7zM5 4h2v2H5zm14 0h-2v2h2zM7 17h2v2H7zm2 2h2v2H9zm6-2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-6-7h2v3H5zm12 0h2v3h-2zM3 6h2v8H3zm18 0h-2v8h2zM10 6h4v2h-4zM8 8h2v4H8zm2 4h4v2h-4zm4-4h2v4h-2z"/></svg></span><span class="ev-row-text">{location}</span></div>
  </div>
  <div class="ev-desc">{description}</div>
  </div>
</div>
<script>document.querySelectorAll('.ev-hero').forEach(function(el){if(!el.style.backgroundImage||el.style.backgroundImage==="url('')"||el.style.backgroundImage==='url(\\'\\')'){el.style.display='none'}else{var img=new Image();img.onerror=function(){el.style.display='none'};img.src=el.style.backgroundImage.slice(5,-2)}})</script>
""", {"event_name": "Event", "date": "", "time": "", "location": "", "description": "", "image_url": ""})

# ===========================
# MAP CARD — Stylized Location
# ===========================

_reg("map_card", "Stylized location/travel card with distance and travel info", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(16px,4vw,24px)}
@keyframes fade-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes ping{0%{transform:scale(1);opacity:0.6}100%{transform:scale(2.5);opacity:0}}
.mc{width:100%;max-width:420px;background:rgba(18,18,35,0.92);border-radius:16px;
padding:clamp(20px,5vw,32px);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.06);
box-shadow:0 8px 32px rgba(0,0,0,0.3);animation:fade-up 0.6s both}
.mc-pin{display:flex;align-items:center;justify-content:center;width:48px;height:48px;
margin-bottom:16px;position:relative}
.mc-pin-dot{width:14px;height:14px;border-radius:50%;background:linear-gradient(135deg,#8b5cf6,#38bdf8);
box-shadow:0 0 12px rgba(217,79,142,0.4);position:relative;z-index:1}
.mc-pin-ring{position:absolute;width:14px;height:14px;border-radius:50%;
border:2px solid rgba(217,79,142,0.4);animation:ping 2s ease-out infinite}
.mc-dest{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-size:clamp(22px,6vw,28px);
font-weight:700;color:#fff;margin-bottom:14px;animation:fade-up 0.6s 0.15s both}
.mc-stats{display:flex;gap:clamp(14px,4vw,24px);margin-bottom:18px;animation:fade-up 0.6s 0.25s both}
.mc-stat{background:rgba(255,255,255,0.03);border-radius:10px;padding:clamp(10px,3vw,14px);
border:1px solid rgba(255,255,255,0.05);flex:1;text-align:center}
.mc-stat-val{font-family:'Space Grotesk',sans-serif;font-size:clamp(16px,4.5vw,20px);
font-weight:700;color:#fff}
.mc-stat-lbl{font-size:clamp(9px,2.3vw,10px);color:rgba(240,236,228,0.35);
text-transform:uppercase;letter-spacing:0.08em;margin-top:2px}
.mc-desc{font-size:clamp(13px,3.2vw,15px);line-height:1.75;color:rgba(240,236,228,0.55);
animation:fade-up 0.6s 0.35s both}
body.landscape .mc{max-width:520px;padding:clamp(28px,4vw,40px)}
body.landscape .mc-dest{font-size:clamp(26px,3.5vw,34px)}
body.landscape .mc-desc{font-size:clamp(15px,1.8vw,17px)}
body.landscape .mc-stat-val{font-size:clamp(20px,2.5vw,24px)}
</style>
<div class="mc">
  <div class="mc-pin"><div class="mc-pin-dot"></div><div class="mc-pin-ring"></div></div>
  <div class="mc-dest">{destination}</div>
  <div class="mc-stats">
    <div class="mc-stat"><div class="mc-stat-val">{distance}</div><div class="mc-stat-lbl">Distance</div></div>
    <div class="mc-stat"><div class="mc-stat-val">{travel_time}</div><div class="mc-stat-lbl">Travel</div></div>
  </div>
  <div class="mc-desc">{description}</div>
</div>
""", {"destination": "", "distance": "", "travel_time": "", "description": ""})

# ===========================
# DAILY BRIEFING — Morning Card
# ===========================

_reg("daily_briefing", "Morning briefing with scenic hero photo, weather glass panel, and agenda", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(16px,4vw,24px)}
@keyframes fu{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
.db{width:100%;max-width:420px;animation:fu 0.6s both}
.db-hero{width:100%;height:clamp(160px,42vw,220px);border-radius:14px;overflow:hidden;
margin-bottom:20px;box-shadow:0 12px 40px rgba(0,0,0,.4);animation:fu .6s .05s both}
.db-hero img{width:100%;height:100%;object-fit:cover;display:block}
.db-hero:empty{display:none}
.db-date{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,12px);font-weight:600;
text-transform:uppercase;letter-spacing:.16em;color:#d94f8e;margin-bottom:6px;animation:fu .6s .1s both}
.db-greet{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(28px,8vw,40px);
font-weight:700;color:#fff;margin-bottom:20px;animation:fu .6s .15s both}
.db-weather{background:rgba(255,255,255,.04);border-radius:12px;padding:clamp(14px,3.5vw,18px);
border:1px solid rgba(255,255,255,.07);backdrop-filter:blur(12px);margin-bottom:16px;
display:flex;align-items:center;gap:12px;animation:fu .6s .25s both}
.db-weather-icon{font-size:28px;flex-shrink:0}
.db-weather-text{font-size:clamp(13px,3.2vw,15px);color:rgba(240,236,228,.72)}
.db-section{margin-bottom:14px;animation:fu .6s .35s both}
.db-section-title{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);
font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:#d94f8e;margin-bottom:10px;
display:flex;align-items:center;gap:6px}
.db-agenda{background:rgba(255,255,255,.03);border-radius:12px;padding:clamp(12px,3vw,16px);
border:1px solid rgba(255,255,255,.05)}
.db-agenda .t-body{font-size:clamp(13px,3.2vw,15px);line-height:1.8;color:rgba(240,236,228,.65)}
.db-highlight{background:linear-gradient(135deg,rgba(217,79,142,.06),rgba(139,92,246,.06));
border-radius:12px;padding:clamp(14px,3.5vw,18px);border:1px solid rgba(139,92,246,.1);
animation:fu .6s .45s both}
.db-highlight-text{font-family:'Plus Jakarta Sans',sans-serif;font-style:italic;
font-size:clamp(14px,3.5vw,16px);line-height:1.6;color:rgba(240,236,228,.65)}
body.landscape .db{max-width:540px}
body.landscape .db-greet{font-size:clamp(36px,5vw,48px)}
body.landscape .db-hero{height:clamp(200px,28vw,280px)}
body.landscape .db-weather-text{font-size:clamp(15px,1.8vw,17px)}
body.landscape .db-highlight-text{font-size:clamp(16px,2vw,18px)}
</style>
<div class="db">
  <div class="db-hero"><img src="{image_url}" alt="" onerror="this.parentElement.style.display='none'"></div>
  <div class="db-date">{date_display}</div>
  <div class="db-greet">Good Morning</div>
  <div class="db-weather">
    <span class="db-weather-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FFB300" style="display:inline-block;width:24px;height:24px;vertical-align:middle"><path d="M14 22H4v-2h10v2ZM4 20H2v-4h2v4Zm12 0h-2v-4h2v4Zm-6-2H8v-2h2v2Zm-2-2H4v-2h4v2Zm6 0h-2v-2h2v2Zm-2-2H8v-2h4v2Zm12-1h-4v-2h4v2Zm-6-1h-2v-2h2v2ZM8 10H6V8h2v2Zm8 0h-2V8h2v2Zm-2-2H8V6h6v2ZM6 6H4V4h2v2Zm14 0h-2V4h2v2ZM4 4H2V2h2v2Zm9 0h-2V0h2v4Zm9 0h-2V2h2v2Z"/></svg></span>
    <span class="db-weather-text">{weather_summary}</span>
  </div>
  <div class="db-section">
    <div class="db-section-title"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#A78BFA" style="display:inline-block;width:20px;height:20px;vertical-align:middle"><path d="M5 4h14v2H5zm0 16h14v2H5zM3 10h2v10H3zm0-4h2v2H3zm16 0h2v2h-2zm0 4h2v10h-2zM3 8h18v2H3zm12-6h2v2h-2zM7 2h2v2H7z"/></svg> Today</div>
    <div class="db-agenda"><div class="t-body">{agenda_items}</div></div>
  </div>
  <div class="db-highlight"><div class="db-highlight-text">{highlight}</div></div>
</div>
""", {"date_display": "", "weather_summary": "", "agenda_items": "", "highlight": "", "image_url": ""})

# ===========================
# SPORTS SCORE — Live Score Display
# ===========================

_reg("sports_score", "Live-score display with two teams, scores, and game status", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(16px,4vw,24px)}
@keyframes fade-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse-live{0%,100%{opacity:1}50%{opacity:0.4}}
.ss{width:100%;max-width:420px;background:rgba(18,18,35,0.92);border-radius:16px;
padding:clamp(20px,5vw,32px);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.06);
box-shadow:0 8px 32px rgba(0,0,0,0.3);text-align:center;animation:fade-up 0.6s both}
.ss-sport{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);font-weight:600;
text-transform:uppercase;letter-spacing:0.16em;color:rgba(240,236,228,0.35);margin-bottom:6px;
animation:fade-up 0.6s 0.1s both}
.ss-status{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;
background:rgba(217,79,142,0.1);border:1px solid rgba(217,79,142,0.2);margin-bottom:20px;
animation:fade-up 0.6s 0.15s both}
.ss-status-dot{width:6px;height:6px;border-radius:50%;background:#d94f8e;animation:pulse-live 1.5s ease-in-out infinite}
.ss-status-text{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);
font-weight:600;color:#d94f8e;text-transform:uppercase;letter-spacing:0.08em}
.ss-board{display:flex;align-items:center;justify-content:center;gap:clamp(16px,5vw,28px);
animation:fade-up 0.6s 0.25s both}
.ss-team{flex:1;text-align:center}
.ss-team-name{font-family:'Space Grotesk',sans-serif;font-size:clamp(12px,3vw,14px);
font-weight:600;color:rgba(240,236,228,0.8);margin-bottom:8px}
.ss-score{font-family:'Space Grotesk',sans-serif;font-size:clamp(40px,11vw,56px);
font-weight:700;color:#fff;line-height:1}
.ss-vs{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-size:clamp(14px,3.5vw,18px);
color:rgba(240,236,228,0.2);font-style:italic}
body.landscape .ss{max-width:520px;padding:clamp(28px,4vw,44px)}
body.landscape .ss-score{font-size:clamp(52px,7vw,68px)}
body.landscape .ss-team-name{font-size:clamp(14px,1.8vw,17px)}
</style>
<div class="ss">
  <div class="ss-sport">{sport}</div>
  <div class="ss-status"><span class="ss-status-dot"></span><span class="ss-status-text">{status}</span></div>
  <div class="ss-board">
    <div class="ss-team">
      <div class="ss-team-name">{team1}</div>
      <div class="ss-score">{score1}</div>
    </div>
    <div class="ss-vs">&mdash;</div>
    <div class="ss-team">
      <div class="ss-team-name">{team2}</div>
      <div class="ss-score">{score2}</div>
    </div>
  </div>
</div>
""", {"team1": "Home", "team2": "Away", "score1": "0", "score2": "0", "status": "Live", "sport": ""})

# ===========================
# CODE SNIPPET — Syntax Display
# ===========================

_reg("code_snippet", "Beautiful code display with language badge and line numbers", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(16px,4vw,24px)}
@keyframes fade-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
.cs{width:100%;max-width:420px;animation:fade-up 0.6s both}
.cs-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;
animation:fade-up 0.6s 0.1s both}
.cs-file{font-family:'JetBrains Mono',monospace;font-size:clamp(11px,2.8vw,13px);
color:rgba(240,236,228,0.5)}
.cs-lang{padding:3px 10px;border-radius:6px;font-family:'Space Grotesk',sans-serif;
font-size:clamp(9px,2.3vw,10px);font-weight:600;text-transform:uppercase;letter-spacing:0.08em;
background:rgba(139,92,246,0.15);color:#a78bfa;border:1px solid rgba(139,92,246,0.2)}
.cs-block{background:rgba(10,10,20,0.8);border-radius:12px;padding:clamp(14px,3.5vw,20px);
border:1px solid rgba(255,255,255,0.06);overflow-x:auto;animation:fade-up 0.6s 0.2s both}
.cs-code{font-family:'JetBrains Mono',monospace;font-size:clamp(11px,2.8vw,13px);
line-height:1.8;color:rgba(240,236,228,0.85);white-space:pre;display:block;tab-size:2}
.cs-desc{font-size:clamp(12px,3vw,14px);color:rgba(240,236,228,0.4);line-height:1.6;
margin-top:12px;animation:fade-up 0.6s 0.35s both}
body.landscape .cs{max-width:560px}
body.landscape .cs-code{font-size:clamp(13px,1.5vw,15px)}
body.landscape .cs-desc{font-size:clamp(14px,1.6vw,16px)}
</style>
<div class="cs">
  <div class="cs-head">
    <span class="cs-file">{filename}</span>
    <span class="cs-lang">{language}</span>
  </div>
  <div class="cs-block"><code class="cs-code">{code}</code></div>
  <div class="cs-desc">{description}</div>
</div>
""", {"language": "", "code": "", "filename": "", "description": ""})

# ===========================
# BEFORE/AFTER — Split Comparison
# ===========================

_reg("before_after", "Split comparison view for before/after or versus displays", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(16px,4vw,24px)}
@keyframes fade-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
.ba{width:100%;max-width:420px;animation:fade-up 0.6s both}
.ba-title{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-size:clamp(20px,5.5vw,26px);
font-weight:700;color:#fff;text-align:center;margin-bottom:18px;animation:fade-up 0.6s 0.1s both}
.ba-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;animation:fade-up 0.6s 0.2s both}
.ba-side{background:rgba(18,18,35,0.92);border-radius:14px;padding:clamp(14px,3.5vw,20px);
backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.06);
box-shadow:0 4px 16px rgba(0,0,0,0.2)}
.ba-label{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,2.5vw,11px);font-weight:600;
text-transform:uppercase;letter-spacing:0.12em;margin-bottom:10px;padding-bottom:8px;
border-bottom:1px solid rgba(255,255,255,0.06)}
.ba-left .ba-label{color:#d94f8e}
.ba-right .ba-label{color:#8b5cf6}
.ba-content{font-size:clamp(12px,3vw,14px);line-height:1.7;color:rgba(240,236,228,0.7)}
body.landscape .ba{max-width:560px}
body.landscape .ba-title{font-size:clamp(24px,3vw,32px)}
body.landscape .ba-content{font-size:clamp(14px,1.6vw,16px)}
body.landscape .ba-side{padding:clamp(18px,2.5vw,28px)}
</style>
<div class="ba">
  <div class="ba-title">{title}</div>
  <div class="ba-grid">
    <div class="ba-side ba-left">
      <div class="ba-label">{label_left}</div>
      <div class="ba-content">{content_left}</div>
    </div>
    <div class="ba-side ba-right">
      <div class="ba-label">{label_right}</div>
      <div class="ba-content">{content_right}</div>
    </div>
  </div>
</div>
""", {"label_left": "Before", "label_right": "After", "content_left": "", "content_right": "", "title": ""})

# ===========================
# CELEBRATION — Party Card
# ===========================

_reg("celebration", "Party/celebration card with confetti animation and big message", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0d0d1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(20px,5vw,32px);overflow:hidden}
@keyframes fade-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes bounce-in{0%{transform:scale(0.3);opacity:0}50%{transform:scale(1.08)}70%{transform:scale(0.95)}100%{transform:scale(1);opacity:1}}
@keyframes confetti-fall{0%{transform:translateY(-100vh) rotate(0deg);opacity:1}100%{transform:translateY(100vh) rotate(720deg);opacity:0}}
.cel{text-align:center;max-width:420px;width:100%;position:relative;z-index:1}
.cel-emoji{font-size:clamp(48px,14vw,72px);margin-bottom:16px;animation:bounce-in 0.8s both;
filter:drop-shadow(0 8px 24px rgba(232,197,71,0.3))}
.cel-head{font-family:'Plus Jakarta Sans','Inter',sans-serif;font-size:clamp(26px,7vw,36px);
font-weight:700;color:#fff;margin-bottom:12px;animation:fade-up 0.6s 0.3s both}
.cel-msg{font-size:clamp(14px,3.5vw,17px);line-height:1.7;color:rgba(240,236,228,0.7);
margin-bottom:14px;animation:fade-up 0.6s 0.45s both}
.cel-detail{font-size:clamp(12px,3vw,14px);color:rgba(240,236,228,0.4);animation:fade-up 0.6s 0.55s both}
.confetti{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;overflow:hidden}
.confetti i{position:absolute;width:8px;height:8px;border-radius:2px;animation:confetti-fall linear infinite;opacity:0.8}
body.landscape .cel{max-width:520px}
body.landscape .cel-emoji{font-size:clamp(64px,8vw,84px)}
body.landscape .cel-head{font-size:clamp(32px,4vw,44px)}
body.landscape .cel-msg{font-size:clamp(16px,2vw,19px)}
</style>
<div class="confetti">
  <i style="left:10%;background:#d94f8e;animation-duration:3.2s;animation-delay:0s"></i>
  <i style="left:25%;background:#8b5cf6;animation-duration:2.8s;animation-delay:0.4s;width:6px;height:12px"></i>
  <i style="left:40%;background:#e8c547;animation-duration:3.5s;animation-delay:0.2s"></i>
  <i style="left:55%;background:#38bdf8;animation-duration:2.6s;animation-delay:0.6s;width:10px;height:6px"></i>
  <i style="left:70%;background:#34d399;animation-duration:3s;animation-delay:0.1s"></i>
  <i style="left:85%;background:#fbbf24;animation-duration:3.3s;animation-delay:0.5s;width:6px;height:10px"></i>
  <i style="left:5%;background:#a78bfa;animation-duration:2.9s;animation-delay:0.8s"></i>
  <i style="left:60%;background:#d94f8e;animation-duration:3.1s;animation-delay:0.3s;width:10px;height:10px;border-radius:50%"></i>
  <i style="left:35%;background:#38bdf8;animation-duration:2.7s;animation-delay:0.7s"></i>
  <i style="left:80%;background:#e8c547;animation-duration:3.4s;animation-delay:0.15s;width:6px;height:6px;border-radius:50%"></i>
</div>
<div class="cel">
  <div class="cel-emoji">{emoji}</div>
  <div class="cel-head">{headline}</div>
  <div class="cel-msg">{message}</div>
  <div class="cel-detail">{detail}</div>
</div>
""", {"emoji": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='#FFD700' style='display:inline-block;width:48px;height:48px;vertical-align:middle'><path d='M2 20h2v2H2zm0-2h2v2H2zm2-4h2v4H4zm2-4h2v4H6zM4 20h2v2H4zm2-2h4v2H6zm4-2h4v2h-4zM8 8h2v2H8zm2 0h2v2h-2zm2 2h2v2h-2zm2 2h2v4h-2zm-6 2h2v2H8zM3 6h2v2H3zm7-2h2v2h-2zM8 2h2v2H8zm7 0h2v2h-2zm3 10h2v2h-2zm2 2h2v2h-2zm-4-7h4v2h-4zm2 12h2v2h-2zm2-14h2v2h-2z'/></svg>", "headline": "Congratulations!", "message": "", "detail": ""})

# ===========================
# LIST CARD
# ===========================

_reg("editorial_split", "Cinematic split-screen: photo on one half, stark black with animated text on the other. Perfect for impactful facts, quotes, or reveals.", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#000;color:#fff;min-height:100vh;overflow:hidden;-webkit-font-smoothing:antialiased}
@keyframes es-rise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
@keyframes es-line{from{transform:scaleX(0)}to{transform:scaleX(1)}}

/* === DESKTOP / LANDSCAPE === */
.es{display:flex;width:100%;height:100vh;position:relative;background:#000}
.es-img{flex:0 0 50%;height:100%;position:relative;overflow:hidden}
.es-img img{width:100%;height:100%;object-fit:cover;display:block}
.es-img::after{content:"";position:absolute;inset:0;
  background:linear-gradient(90deg,transparent 50%,#000 100%)}
.es-text{flex:0 0 50%;display:flex;flex-direction:column;justify-content:center;
  padding:clamp(32px,5vw,72px);position:relative}
.es-label{font-family:'Space Grotesk',sans-serif;font-size:clamp(10px,1.2vw,12px);font-weight:600;
  text-transform:uppercase;letter-spacing:.22em;color:#d94f8e;margin-bottom:20px;
  animation:es-rise .7s .2s cubic-bezier(.22,1,.36,1) both}
.es-line{width:36px;height:2.5px;margin-bottom:28px;
  background:linear-gradient(90deg,#d94f8e,#e8c547);border-radius:2px;
  transform-origin:left;animation:es-line .8s .4s cubic-bezier(.22,1,.36,1) both}
.es-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(28px,4.2vw,52px);
  font-weight:700;line-height:1.1;letter-spacing:-.025em;margin-bottom:22px;color:#fff;
  animation:es-rise .7s .5s cubic-bezier(.22,1,.36,1) both}
.es-body{font-family:'Inter',sans-serif;font-size:clamp(14px,1.8vw,17px);line-height:1.8;
  color:rgba(255,255,255,.7);max-width:440px;animation:es-rise .7s .7s cubic-bezier(.22,1,.36,1) both}
.es-attr{font-family:'Space Grotesk',sans-serif;font-size:clamp(11px,1vw,13px);
  color:rgba(255,255,255,.22);margin-top:32px;letter-spacing:.04em;
  animation:es-rise .7s .9s cubic-bezier(.22,1,.36,1) both}

/* === MOBILE / PORTRAIT === */
@media(max-width:768px){
  .es{flex-direction:column;height:100vh}
  .es-img{flex:none;width:100%;height:48vh;margin-top:7vh}
  .es-img::after{background:linear-gradient(180deg,transparent 30%,rgba(0,0,0,.4) 60%,#000 100%)}
  .es-text{flex:none;min-height:45vh;padding:clamp(20px,5vw,36px);padding-top:clamp(16px,3vh,24px);
    justify-content:flex-start}
  .es-title{font-size:clamp(24px,7vw,38px)}
  .es-body{font-size:clamp(14px,3.6vw,16px)}
}
</style>
<div class="es">
  <div class="es-img"><img src="{image_url}" alt="" onerror="this.parentElement.style.background='linear-gradient(135deg,#111,#1a1a2e)';this.remove()"/></div>
  <div class="es-text">
    <div class="es-label">{category}</div>
    <div class="es-line"></div>
    <div class="es-title">{title}</div>
    <div class="es-body">{body_text}</div>
    <div class="es-attr">{attribution}</div>
  </div>
</div>
""", {"image_url": "", "category": "", "title": "", "body_text": "", "attribution": ""})

_reg("list_card", "Premium list with atmospheric background, numbered items, and glass panels", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0a0a1a;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;
padding:clamp(20px,5vw,32px);overflow:hidden}
@keyframes lc-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes lc-orb{0%,100%{opacity:.04;transform:scale(1)}50%{opacity:.09;transform:scale(1.12)}}
.lc{width:100%;max-width:500px;position:relative}
.lc::before{content:'';position:absolute;top:-50px;left:-30px;width:200px;height:200px;border-radius:50%;
background:radial-gradient(circle,rgba(139,92,246,.06),transparent 70%);animation:lc-orb 9s ease-in-out infinite;pointer-events:none}
.lc-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(26px,7vw,36px);
font-weight:700;color:#fff;line-height:1.15;letter-spacing:-.02em;margin-bottom:6px;
animation:lc-up .5s both}
.lc-line{width:40px;height:2px;background:linear-gradient(90deg,#8b5cf6,#38bdf8);
border-radius:1px;margin-bottom:clamp(20px,5vw,28px);animation:lc-up .5s .1s both}
.lc-items{display:flex;flex-direction:column;gap:8px}
.lc-items .list-item{background:rgba(255,255,255,.025);border-radius:12px;
padding:clamp(12px,3vw,16px) clamp(14px,3.5vw,18px);border:1px solid rgba(255,255,255,.05);
backdrop-filter:blur(8px);font-size:clamp(14px,3.5vw,16px);line-height:1.65;
color:rgba(240,236,228,.78);animation:lc-up .4s calc(.15s + var(--i,0) * .06s) both;
transition:border-color .3s,transform .3s;border-bottom:none}
.lc-items .list-item:hover{border-color:rgba(139,92,246,.2);transform:translateX(4px)}
body.landscape .lc{max-width:560px}
body.landscape .lc-title{font-size:clamp(30px,4vw,42px)}
</style>
<div class="lc">
  <div class="lc-title">{title}</div>
  <div class="lc-line"></div>
  <div class="lc-items">{items}</div>
</div>
""", {"title": "List", "items": ""})

# ===========================
# DATA VISUALIZATION TEMPLATES
# ===========================

# ---------------------------------------------------------------------------
# BAR CHART — Neon gradient bars with glassmorphism & ambient glow
# ---------------------------------------------------------------------------
_reg("bar_chart", "Animated bar chart with neon gradient bars, glassmorphism, glow effects", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#06060e;color:#f0ece4;min-height:100vh;
display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;overflow:hidden}
@keyframes bc-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes bc-orb{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(30px,-20px) scale(1.1)}}
.bc-wrap{width:100vw;height:100vh;display:flex;flex-direction:column;padding:48px clamp(24px,3vw,48px) 80px;
position:relative;overflow:hidden}
.bc-wrap::before{content:'';position:absolute;top:-15%;right:-10%;width:500px;height:500px;border-radius:50%;
background:radial-gradient(circle,rgba(139,92,246,.12),transparent 70%);animation:bc-orb 15s ease-in-out infinite;pointer-events:none}
.bc-wrap::after{content:'';position:absolute;bottom:-10%;left:-5%;width:400px;height:400px;border-radius:50%;
background:radial-gradient(circle,rgba(56,189,248,.08),transparent 70%);animation:bc-orb 12s ease-in-out infinite reverse;pointer-events:none}
.bc-header{flex-shrink:0;margin-bottom:clamp(12px,2vw,24px);animation:bc-up .6s both;position:relative;z-index:2}
.bc-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(28px,3.5vw,44px);
font-weight:800;letter-spacing:-.02em;line-height:1.15;
background:linear-gradient(135deg,#fff 40%,#a78bfa 70%,#38bdf8);-webkit-background-clip:text;background-clip:text;color:transparent}
.bc-subtitle{font-family:'Space Grotesk',sans-serif;font-size:clamp(12px,1.4vw,16px);
color:rgba(240,236,228,.45);margin-top:6px;letter-spacing:.04em}
.bc-chart{flex:1;min-height:0;animation:bc-up .6s .15s both;position:relative;z-index:2;
background:rgba(255,255,255,.03);border-radius:20px;padding:16px;
backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);
box-shadow:0 8px 32px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.05)}
.bc-footer{flex-shrink:0;text-align:center;padding-top:12px;font-family:'JetBrains Mono',monospace;
font-size:11px;color:rgba(240,236,228,.25);animation:bc-up .6s .3s both;position:relative;z-index:2}
</style>
<div class="bc-wrap">
  <div class="bc-header">
    <div class="bc-title">{title}</div>
    <div class="bc-subtitle">{subtitle}</div>
  </div>
  <div class="bc-chart"><canvas id="chart"></canvas></div>
  <div class="bc-footer">{source}</div>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
(function _poll(){if(typeof Chart==="undefined"){setTimeout(_poll,60);return}(function(){
  const labels = {labels_json};
  const values = {values_json};
  const colors = {colors_json};
  const ctx = document.getElementById('chart').getContext('2d');
  const neonStops = [[56,189,248],[99,102,241],[167,139,250],[217,79,142],[232,197,71]];
  const defaultColors = labels.map((_, i) => {
    const t = labels.length > 1 ? i/(labels.length-1) : 0;
    const seg = t * (neonStops.length-1);
    const idx = Math.min(Math.floor(seg), neonStops.length-2);
    const f = seg - idx;
    const a = neonStops[idx], b = neonStops[idx+1];
    return 'rgb('+Math.round(a[0]+(b[0]-a[0])*f)+','+Math.round(a[1]+(b[1]-a[1])*f)+','+Math.round(a[2]+(b[2]-a[2])*f)+')';
  });
  const bgColors = (colors && colors.length) ? colors : defaultColors;
  const gradientBgs = bgColors.map(c => {
    const g = ctx.createLinearGradient(0, 0, 0, ctx.canvas.parentElement.clientHeight || 400);
    const rgb = c.match(/[0-9]+/g) || [167,139,250];
    g.addColorStop(0, 'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0.95)');
    g.addColorStop(1, 'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0.35)');
    return g;
  });
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: gradientBgs,
        borderColor: bgColors.map(c => c.replace('rgb','rgba').replace(')',',0.7)')),
        borderWidth: 1,
        borderRadius: 8,
        borderSkipped: false,
        hoverBorderWidth: 2,
        hoverBorderColor: '#fff',
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 1400, easing: 'easeOutQuart', delay: function(ctx){return ctx.dataIndex * 80;} },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,10,30,0.95)',
          titleColor: '#a78bfa',
          bodyColor: '#f0ece4',
          borderColor: 'rgba(139,92,246,0.3)',
          borderWidth: 1,
          cornerRadius: 12,
          padding: 14,
          titleFont: { family: "'Space Grotesk',sans-serif", weight: '600' },
          bodyFont: { family: "'JetBrains Mono',monospace" },
          displayColors: true,
          boxPadding: 4,
        }
      },
      scales: {
        x: {
          ticks: { color: 'rgba(240,236,228,0.55)', font: { family: "'Space Grotesk',sans-serif", size: 13, weight: '500' } },
          grid: { display: false },
          border: { color: 'rgba(255,255,255,0.06)' }
        },
        y: {
          ticks: { color: 'rgba(240,236,228,0.35)', font: { family: "'JetBrains Mono',monospace", size: 11 } },
          grid: { color: 'rgba(139,92,246,0.06)' },
          border: { display: false }
        }
      }
    }
  });
})();})();
</script>
""", {"title": "Chart", "subtitle": "", "source": "", "labels_json": "[]", "values_json": "[]", "colors_json": "[]"})

# ---------------------------------------------------------------------------
# LINE CHART — Luminous curves with gradient glow fills
# ---------------------------------------------------------------------------
_reg("line_chart", "Animated line chart with luminous gradient fills, glow effects, glassmorphism", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#06060e;color:#f0ece4;min-height:100vh;
display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;overflow:hidden}
@keyframes lc-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes lc-orb{0%,100%{transform:translate(0,0)}50%{transform:translate(-25px,20px)}}
.lc-wrap{width:100vw;height:100vh;display:flex;flex-direction:column;padding:48px clamp(24px,3vw,48px) 80px;
position:relative;overflow:hidden}
.lc-wrap::before{content:'';position:absolute;top:10%;left:-8%;width:450px;height:450px;border-radius:50%;
background:radial-gradient(circle,rgba(232,197,71,.08),transparent 70%);animation:lc-orb 18s ease-in-out infinite;pointer-events:none}
.lc-wrap::after{content:'';position:absolute;bottom:5%;right:-5%;width:380px;height:380px;border-radius:50%;
background:radial-gradient(circle,rgba(217,79,142,.07),transparent 70%);animation:lc-orb 14s ease-in-out infinite reverse;pointer-events:none}
.lc-header{flex-shrink:0;margin-bottom:clamp(12px,2vw,24px);animation:lc-up .6s both;position:relative;z-index:2}
.lc-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(28px,3.5vw,44px);
font-weight:800;letter-spacing:-.02em;
background:linear-gradient(135deg,#fff 30%,#e8c547 65%,#d94f8e);-webkit-background-clip:text;background-clip:text;color:transparent}
.lc-subtitle{font-family:'Space Grotesk',sans-serif;font-size:clamp(12px,1.4vw,16px);
color:rgba(240,236,228,.45);margin-top:6px}
.lc-chart{flex:1;min-height:0;animation:lc-up .6s .15s both;position:relative;z-index:2;
background:rgba(255,255,255,.03);border-radius:20px;padding:16px;
backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);
box-shadow:0 8px 32px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.05)}
.lc-footer{flex-shrink:0;text-align:center;padding-top:12px;font-family:'JetBrains Mono',monospace;
font-size:11px;color:rgba(240,236,228,.25);animation:lc-up .6s .3s both;position:relative;z-index:2}
</style>
<div class="lc-wrap">
  <div class="lc-header">
    <div class="lc-title">{title}</div>
    <div class="lc-subtitle">{subtitle}</div>
  </div>
  <div class="lc-chart"><canvas id="chart"></canvas></div>
  <div class="lc-footer">{source}</div>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
(function _poll(){if(typeof Chart==="undefined"){setTimeout(_poll,60);return}(function(){
  const labels = {labels_json};
  const datasets = {datasets_json};
  const palette = ['#38bdf8','#a78bfa','#e8c547','#34d399','#d94f8e','#f97316','#06b6d4','#ec4899'];
  const ctx = document.getElementById('chart').getContext('2d');
  const chartDatasets = datasets.map((ds, idx) => {
    const color = ds.color || palette[idx % palette.length];
    const r = parseInt(color.length===7?color.slice(1,3):'a7',16);
    const g = parseInt(color.length===7?color.slice(3,5):'8b',16);
    const b = parseInt(color.length===7?color.slice(5,7):'fa',16);
    const gFill = ctx.createLinearGradient(0, 0, 0, ctx.canvas.parentElement.clientHeight || 600);
    gFill.addColorStop(0, 'rgba('+r+','+g+','+b+',0.3)');
    gFill.addColorStop(0.5, 'rgba('+r+','+g+','+b+',0.08)');
    gFill.addColorStop(1, 'rgba(6,6,14,0)');
    return {
      label: ds.label || '',
      data: ds.values || ds.data || [],
      borderColor: color,
      backgroundColor: gFill,
      fill: true,
      tension: 0.4,
      pointRadius: 4,
      pointHoverRadius: 7,
      pointBackgroundColor: color,
      pointBorderColor: '#06060e',
      pointBorderWidth: 2,
      pointHoverBorderColor: '#fff',
      pointHoverBorderWidth: 2,
      borderWidth: 2.5,
    };
  });
  new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: chartDatasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 1600, easing: 'easeOutQuart' },
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: { color: 'rgba(240,236,228,0.65)', font: { family: "'Space Grotesk',sans-serif", size: 12, weight: '500' },
          boxWidth: 14, padding: 16, usePointStyle: true, pointStyle: 'circle' }
        },
        tooltip: {
          backgroundColor: 'rgba(15,10,30,0.95)',
          titleColor: '#e8c547',
          bodyColor: '#f0ece4',
          borderColor: 'rgba(232,197,71,0.2)',
          borderWidth: 1,
          cornerRadius: 12,
          padding: 14,
          titleFont: { family: "'Space Grotesk',sans-serif", weight: '600' },
          bodyFont: { family: "'JetBrains Mono',monospace" },
          usePointStyle: true,
        }
      },
      scales: {
        x: {
          ticks: { color: 'rgba(240,236,228,0.5)', font: { family: "'Space Grotesk',sans-serif", size: 12, weight: '500' } },
          grid: { color: 'rgba(139,92,246,0.04)' },
          border: { color: 'rgba(255,255,255,0.06)' }
        },
        y: {
          ticks: { color: 'rgba(240,236,228,0.35)', font: { family: "'JetBrains Mono',monospace", size: 11 } },
          grid: { color: 'rgba(139,92,246,0.05)' },
          border: { display: false }
        }
      }
    }
  });
})();})();
</script>
""", {"title": "Chart", "subtitle": "", "source": "", "labels_json": "[]", "datasets_json": "[{\"label\":\"Data\",\"values\":[]}]"})

# ---------------------------------------------------------------------------
# PIE CHART — Luminous donut with neon segments & glassmorphism
# ---------------------------------------------------------------------------
_reg("pie_chart", "Animated donut chart with neon segments, glassmorphism center, glow effects", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#06060e;color:#f0ece4;min-height:100vh;
display:flex;flex-direction:column;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;overflow:hidden}
@keyframes pc-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes pc-glow{0%,100%{filter:drop-shadow(0 0 20px rgba(139,92,246,.15))}50%{filter:drop-shadow(0 0 40px rgba(139,92,246,.25))}}
@keyframes pc-orb{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-15px) scale(1.08)}}
.pc-wrap{width:100vw;height:100vh;display:flex;flex-direction:column;align-items:center;padding:48px clamp(24px,3vw,48px) 70px;
position:relative;overflow:hidden}
.pc-wrap::before{content:'';position:absolute;top:20%;right:10%;width:350px;height:350px;border-radius:50%;
background:radial-gradient(circle,rgba(139,92,246,.1),transparent 70%);animation:pc-orb 16s ease-in-out infinite;pointer-events:none}
.pc-wrap::after{content:'';position:absolute;bottom:15%;left:5%;width:300px;height:300px;border-radius:50%;
background:radial-gradient(circle,rgba(232,197,71,.07),transparent 70%);animation:pc-orb 13s ease-in-out infinite reverse;pointer-events:none}
.pc-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(28px,3.5vw,44px);
font-weight:800;text-align:center;animation:pc-up .6s both;flex-shrink:0;position:relative;z-index:2;
background:linear-gradient(135deg,#fff 40%,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}
.pc-subtitle{font-family:'Space Grotesk',sans-serif;font-size:clamp(12px,1.4vw,16px);
color:rgba(240,236,228,.45);margin-top:6px;text-align:center;animation:pc-up .6s .1s both;flex-shrink:0;position:relative;z-index:2}
.pc-chart{flex:1;min-height:0;width:100%;max-width:600px;position:relative;animation:pc-up .6s .15s both;
display:flex;align-items:center;justify-content:center;margin:clamp(12px,2vw,24px) 0;
animation:pc-glow 6s ease-in-out infinite}
.pc-center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;z-index:2;
background:rgba(15,10,30,.7);backdrop-filter:blur(12px);border-radius:50%;
width:120px;height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;
border:1px solid rgba(255,255,255,.08);box-shadow:0 4px 24px rgba(0,0,0,.3)}
.pc-center-val{font-family:'JetBrains Mono',monospace;font-size:clamp(28px,3.5vw,42px);font-weight:700;color:#fff}
.pc-center-lbl{font-family:'Space Grotesk',sans-serif;font-size:clamp(9px,1vw,11px);
color:rgba(240,236,228,.45);text-transform:uppercase;letter-spacing:.12em;margin-top:2px}
.pc-footer{flex-shrink:0;text-align:center;font-family:'JetBrains Mono',monospace;
font-size:11px;color:rgba(240,236,228,.25);animation:pc-up .6s .3s both;position:relative;z-index:2}
</style>
<div class="pc-wrap">
  <div class="pc-title">{title}</div>
  <div class="pc-subtitle">{subtitle}</div>
  <div class="pc-chart">
    <canvas id="chart" style="max-height:100%;max-width:100%"></canvas>
    <div class="pc-center">
      <div class="pc-center-val">{center_value}</div>
      <div class="pc-center-lbl">{center_label}</div>
    </div>
  </div>
  <div class="pc-footer">{source}</div>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
(function _poll(){if(typeof Chart==="undefined"){setTimeout(_poll,60);return}(function(){
  const labels = {labels_json};
  const values = {values_json};
  const colors = {colors_json};
  const palette = ['#38bdf8','#a78bfa','#e8c547','#34d399','#d94f8e','#f97316','#06b6d4','#ec4899','#8b5cf6','#fbbf24'];
  const bgColors = (colors && colors.length) ? colors : labels.map((_,i) => palette[i % palette.length]);
  new Chart(document.getElementById('chart'), {
    type: 'doughnut',
    data: {
      labels, datasets: [{
        data: values,
        backgroundColor: bgColors.map(c => {
          try { if(c.startsWith('#')){ const r=parseInt(c.slice(1,3),16),g=parseInt(c.slice(3,5),16),b=parseInt(c.slice(5,7),16); return 'rgba('+r+','+g+','+b+',0.85)'; } return c; } catch(e){ return c; }
        }),
        borderColor: bgColors,
        borderWidth: 2,
        hoverBorderColor: '#fff',
        hoverBorderWidth: 3,
        hoverOffset: 8,
        spacing: 3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      cutout: '65%',
      animation: { animateRotate: true, duration: 1600, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: 'rgba(240,236,228,0.65)', font: { family: "'Space Grotesk',sans-serif", size: 13, weight: '500' },
          padding: 18, boxWidth: 14, usePointStyle: true, pointStyle: 'circle' }
        },
        tooltip: {
          backgroundColor: 'rgba(15,10,30,0.95)',
          titleColor: '#a78bfa',
          bodyColor: '#f0ece4',
          borderColor: 'rgba(139,92,246,0.25)',
          borderWidth: 1,
          cornerRadius: 12,
          padding: 14,
          titleFont: { family: "'Space Grotesk',sans-serif", weight: '600' },
          bodyFont: { family: "'JetBrains Mono',monospace" },
        }
      }
    }
  });
})();})();
</script>
""", {"title": "Chart", "subtitle": "", "source": "", "center_value": "", "center_label": "Total", "labels_json": "[]", "values_json": "[]", "colors_json": "[]"})

# ---------------------------------------------------------------------------
# SCATTER PLOT — Neon bubbles with glow & glassmorphism
# ---------------------------------------------------------------------------
_reg("scatter_plot", "Scatter/bubble chart with neon glow points, glassmorphism, dark cinematic theme", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#06060e;color:#f0ece4;min-height:100vh;
display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;overflow:hidden}
@keyframes sp-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes sp-orb{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-20px,15px) scale(1.08)}}
.sp-wrap{width:100vw;height:100vh;display:flex;flex-direction:column;padding:48px clamp(24px,3vw,48px) 80px;
position:relative;overflow:hidden}
.sp-wrap::before{content:'';position:absolute;top:15%;left:-5%;width:400px;height:400px;border-radius:50%;
background:radial-gradient(circle,rgba(56,189,248,.08),transparent 70%);animation:sp-orb 15s ease-in-out infinite;pointer-events:none}
.sp-header{flex-shrink:0;margin-bottom:clamp(12px,2vw,24px);animation:sp-up .6s both;position:relative;z-index:2}
.sp-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(28px,3.5vw,44px);
font-weight:800;letter-spacing:-.02em;
background:linear-gradient(135deg,#fff 40%,#38bdf8 70%,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}
.sp-chart{flex:1;min-height:0;animation:sp-up .6s .15s both;position:relative;z-index:2;
background:rgba(255,255,255,.03);border-radius:20px;padding:16px;
backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);
box-shadow:0 8px 32px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.05)}
.sp-footer{flex-shrink:0;text-align:center;padding-top:12px;font-family:'JetBrains Mono',monospace;
font-size:11px;color:rgba(240,236,228,.25);animation:sp-up .6s .3s both;position:relative;z-index:2}
</style>
<div class="sp-wrap">
  <div class="sp-header"><div class="sp-title">{title}</div></div>
  <div class="sp-chart"><canvas id="chart"></canvas></div>
  <div class="sp-footer">{source}</div>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
(function _poll(){if(typeof Chart==="undefined"){setTimeout(_poll,60);return}(function(){
  const points = {points_json};
  const data = points.map(p => ({x: p.x, y: p.y, r: Math.max(5, Math.min(30, p.size || 8))}));
  const labels = points.map(p => p.label || '');
  const palette = ['#38bdf8','#a78bfa','#e8c547','#34d399','#d94f8e','#f97316'];
  const bgColors = data.map((_,i) => {
    const c = palette[i % palette.length];
    const r=parseInt(c.slice(1,3),16), g=parseInt(c.slice(3,5),16), b=parseInt(c.slice(5,7),16);
    return 'rgba('+r+','+g+','+b+',0.5)';
  });
  const borderColors = data.map((_,i) => palette[i % palette.length]);
  new Chart(document.getElementById('chart'), {
    type: 'bubble',
    data: {
      datasets: [{
        data: data,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 2,
        hoverBackgroundColor: data.map((_,i) => {
          const c = palette[i % palette.length];
          const r=parseInt(c.slice(1,3),16), g=parseInt(c.slice(3,5),16), b=parseInt(c.slice(5,7),16);
          return 'rgba('+r+','+g+','+b+',0.8)';
        }),
        hoverBorderColor: '#fff',
        hoverBorderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 1400, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,10,30,0.95)',
          titleColor: '#38bdf8',
          bodyColor: '#f0ece4',
          borderColor: 'rgba(56,189,248,0.25)',
          borderWidth: 1,
          cornerRadius: 12,
          padding: 14,
          titleFont: { family: "'Space Grotesk',sans-serif", weight: '600' },
          bodyFont: { family: "'JetBrains Mono',monospace" },
          callbacks: {
            title: function(ctx) { return labels[ctx[0].dataIndex] || ''; },
            label: function(ctx) { return '('+ctx.raw.x+', '+ctx.raw.y+')'; }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: '{x_label}', color: 'rgba(240,236,228,0.5)', font: { family: "'Space Grotesk',sans-serif", size: 13, weight: '500' } },
          ticks: { color: 'rgba(240,236,228,0.4)', font: { family: "'JetBrains Mono',monospace", size: 11 } },
          grid: { color: 'rgba(139,92,246,0.05)' },
          border: { color: 'rgba(255,255,255,0.06)' }
        },
        y: {
          title: { display: true, text: '{y_label}', color: 'rgba(240,236,228,0.5)', font: { family: "'Space Grotesk',sans-serif", size: 13, weight: '500' } },
          ticks: { color: 'rgba(240,236,228,0.35)', font: { family: "'JetBrains Mono',monospace", size: 11 } },
          grid: { color: 'rgba(139,92,246,0.05)' },
          border: { display: false }
        }
      }
    }
  });
})();})();
</script>
""", {"title": "Scatter Plot", "x_label": "X", "y_label": "Y", "source": "", "points_json": "[]"})

# ---------------------------------------------------------------------------
# COMPARISON BARS — Horizontal bars for rankings/comparisons
# ---------------------------------------------------------------------------
_reg("comparison_bars", "Horizontal comparison bars for rankings, dark cinematic theme with gold/purple", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0a0a0f;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;overflow:hidden}
@keyframes cb-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes cb-fill{from{width:0}to{width:var(--w)}}
.cb-wrap{width:100%;max-width:800px;padding:60px clamp(24px,3vw,48px) 100px}
.cb-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(28px,3.5vw,44px);
font-weight:800;color:#fff;letter-spacing:-.02em;margin-bottom:clamp(8px,1.5vw,16px);animation:cb-up .6s both}
.cb-subtitle{font-family:'Space Grotesk',sans-serif;font-size:clamp(12px,1.4vw,16px);
color:rgba(240,236,228,.4);margin-bottom:clamp(20px,3vw,36px);animation:cb-up .6s .1s both}
.cb-item{margin-bottom:clamp(14px,2vw,20px);animation:cb-up .5s calc(.15s + var(--i,0) * .08s) both}
.cb-label-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.cb-label{font-family:'Space Grotesk',sans-serif;font-size:clamp(14px,1.6vw,18px);font-weight:600;color:#fff}
.cb-value{font-family:'JetBrains Mono',monospace;font-size:clamp(13px,1.4vw,16px);color:var(--bar-color,#e8c547);font-weight:600}
.cb-track{height:clamp(20px,2.5vw,32px);background:rgba(255,255,255,.04);border-radius:6px;overflow:hidden;position:relative}
.cb-fill{height:100%;border-radius:6px;animation:cb-fill 1.2s .4s cubic-bezier(.22,1,.36,1) both;
background:var(--bar-color,linear-gradient(90deg,#e8c547,#a78bfa))}
.cb-footer{text-align:center;margin-top:clamp(16px,2vw,28px);font-family:'JetBrains Mono',monospace;
font-size:11px;color:rgba(240,236,228,.2);animation:cb-up .6s .5s both}
</style>
<div class="cb-wrap">
  <div class="cb-title">{title}</div>
  <div class="cb-subtitle">{subtitle}</div>
  <div class="cb-items">{items_html}</div>
  <div class="cb-footer">{source}</div>
</div>
""", {"title": "Comparison", "subtitle": "", "source": "", "items_html": ""})

# ---------------------------------------------------------------------------
# TIMELINE CHART — Neon-pulse connected nodes with glassmorphism cards
# ---------------------------------------------------------------------------
_reg("timeline_chart", "Visual timeline with neon-pulse nodes, glassmorphism event cards, animated entry", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#06060e;color:#f0ece4;min-height:100vh;
display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;overflow:hidden}
@keyframes tc-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes tc-line{from{height:0}to{height:100%}}
@keyframes tc-pulse{0%,100%{box-shadow:0 0 8px var(--dot-color,rgba(167,139,250,0.4)),0 0 20px var(--dot-color,rgba(167,139,250,0.15))}
50%{box-shadow:0 0 12px var(--dot-color,rgba(167,139,250,0.6)),0 0 30px var(--dot-color,rgba(167,139,250,0.25))}}
@keyframes tc-orb{0%,100%{transform:translate(0,0)}50%{transform:translate(-20px,15px)}}
.tc-wrap{width:100vw;height:100vh;display:flex;flex-direction:column;padding:48px clamp(24px,3vw,48px) 80px;
position:relative;overflow:hidden}
.tc-wrap::before{content:'';position:absolute;top:20%;right:-5%;width:400px;height:400px;border-radius:50%;
background:radial-gradient(circle,rgba(139,92,246,.08),transparent 70%);animation:tc-orb 16s ease-in-out infinite;pointer-events:none}
.tc-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(28px,3.5vw,44px);
font-weight:800;letter-spacing:-.02em;margin-bottom:clamp(16px,2.5vw,32px);animation:tc-up .6s both;
flex-shrink:0;position:relative;z-index:2;
background:linear-gradient(135deg,#fff 30%,#a78bfa 80%);-webkit-background-clip:text;background-clip:text;color:transparent}
.tc-body{flex:1;overflow-y:auto;padding-left:44px;position:relative;z-index:2}
.tc-body::before{content:'';position:absolute;left:16px;top:0;width:2px;
background:linear-gradient(to bottom,#a78bfa,#38bdf8,rgba(56,189,248,0.1));
animation:tc-line 1.5s .3s cubic-bezier(.22,1,.36,1) both;height:100%}
.tc-event{position:relative;margin-bottom:clamp(24px,3vw,36px);animation:tc-up .5s calc(.2s + var(--i,0) * .1s) both;
background:rgba(255,255,255,.03);border-radius:14px;padding:16px 18px;
backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.06);
transition:border-color .3s,box-shadow .3s}
.tc-event:hover{border-color:rgba(139,92,246,.2);box-shadow:0 4px 24px rgba(139,92,246,.1)}
.tc-dot{position:absolute;left:-36px;top:18px;width:12px;height:12px;border-radius:50%;
background:var(--dot-color,#a78bfa);animation:tc-pulse 3s ease-in-out infinite}
.tc-date{font-family:'JetBrains Mono',monospace;font-size:clamp(10px,1.2vw,12px);font-weight:500;
text-transform:uppercase;letter-spacing:.14em;color:var(--dot-color,#a78bfa);margin-bottom:4px}
.tc-label{font-family:'Space Grotesk',sans-serif;font-size:clamp(16px,2vw,22px);font-weight:600;color:#fff;margin-bottom:4px}
.tc-desc{font-size:clamp(13px,1.5vw,16px);color:rgba(240,236,228,.55);line-height:1.6}
.tc-footer{flex-shrink:0;text-align:center;padding-top:12px;font-family:'JetBrains Mono',monospace;
font-size:11px;color:rgba(240,236,228,.25);animation:tc-up .6s .5s both;position:relative;z-index:2}
</style>
<div class="tc-wrap">
  <div class="tc-title">{title}</div>
  <div class="tc-body">{events_html}</div>
  <div class="tc-footer">{source}</div>
</div>
""", {"title": "Timeline", "source": "", "events_html": ""})

# ---------------------------------------------------------------------------
# TREEMAP — Neon-glow rectangles with glassmorphism container
# ---------------------------------------------------------------------------
_reg("treemap", "Treemap with neon-glow rectangles, glassmorphism container, hover effects", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#06060e;color:#f0ece4;min-height:100vh;
display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;overflow:hidden}
@keyframes tm-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes tm-orb{0%,100%{transform:translate(0,0)}50%{transform:translate(25px,-18px)}}
.tm-wrap{width:100vw;height:100vh;display:flex;flex-direction:column;padding:48px clamp(24px,3vw,48px) 80px;
position:relative;overflow:hidden}
.tm-wrap::before{content:'';position:absolute;top:-10%;left:20%;width:450px;height:450px;border-radius:50%;
background:radial-gradient(circle,rgba(139,92,246,.08),transparent 70%);animation:tm-orb 16s ease-in-out infinite;pointer-events:none}
.tm-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(28px,3.5vw,44px);
font-weight:800;letter-spacing:-.02em;margin-bottom:clamp(12px,2vw,24px);animation:tm-up .6s both;
flex-shrink:0;position:relative;z-index:2;
background:linear-gradient(135deg,#fff 40%,#e8c547 70%,#d94f8e);-webkit-background-clip:text;background-clip:text;color:transparent}
.tm-chart{flex:1;min-height:0;animation:tm-up .6s .15s both;position:relative;z-index:2;
background:rgba(255,255,255,.03);border-radius:20px;padding:12px;
backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);
box-shadow:0 8px 32px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.05)}
.tm-footer{flex-shrink:0;text-align:center;padding-top:12px;font-family:'JetBrains Mono',monospace;
font-size:11px;color:rgba(240,236,228,.25);animation:tm-up .6s .3s both;position:relative;z-index:2}
</style>
<div class="tm-wrap">
  <div class="tm-title">{title}</div>
  <div class="tm-chart"><canvas id="treemap"></canvas></div>
  <div class="tm-footer">{source}</div>
</div>
<script>
(function(){
  const items = {items_json};
  const palette = ['#38bdf8','#a78bfa','#e8c547','#34d399','#d94f8e','#f97316','#06b6d4','#ec4899','#8b5cf6','#fbbf24'];
  const canvas = document.getElementById('treemap');
  const container = canvas.parentElement;
  function resize() {
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    draw();
  }
  function squarify(items, x, y, w, h) {
    if (!items.length || w <= 0 || h <= 0) return [];
    const total = items.reduce((s, it) => s + it.value, 0);
    if (total <= 0) return [];
    const rects = [];
    let cx = x, cy = y, cw = w, ch = h;
    let remaining = [...items].sort((a, b) => b.value - a.value);
    while (remaining.length > 0) {
      const isWide = cw >= ch;
      const side = isWide ? ch : cw;
      const remTotal = remaining.reduce((s, it) => s + it.value, 0);
      let row = [remaining[0]];
      let rowTotal = remaining[0].value;
      remaining = remaining.slice(1);
      while (remaining.length > 0) {
        const candidate = remaining[0];
        const newTotal = rowTotal + candidate.value;
        const rowLen = (newTotal / remTotal) * (isWide ? cw : ch);
        const sizes = [...row, candidate].map(it => (it.value / newTotal) * side);
        const worst = Math.max(...sizes.map(s => Math.max(rowLen / s, s / rowLen)));
        const oldSizes = row.map(it => (it.value / rowTotal) * side);
        const oldLen = (rowTotal / remTotal) * (isWide ? cw : ch);
        const oldWorst = Math.max(...oldSizes.map(s => Math.max(oldLen / s, s / oldLen)));
        if (worst > oldWorst && row.length > 0) break;
        row.push(candidate);
        rowTotal = newTotal;
        remaining = remaining.slice(1);
      }
      const remTotalNow = remaining.reduce((s, it) => s + it.value, 0) + rowTotal;
      const rowLen = (rowTotal / remTotalNow) * (isWide ? cw : ch);
      let offset = 0;
      for (const it of row) {
        const frac = it.value / rowTotal;
        const size = frac * side;
        if (isWide) {
          rects.push({ ...it, rx: cx, ry: cy + offset, rw: rowLen, rh: size });
          offset += size;
        } else {
          rects.push({ ...it, rx: cx + offset, ry: cy, rw: size, rh: rowLen });
          offset += size;
        }
      }
      if (isWide) { cx += rowLen; cw -= rowLen; } else { cy += rowLen; ch -= rowLen; }
    }
    return rects;
  }
  function draw() {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const rects = squarify(items, 2, 2, W - 4, H - 4);
    rects.forEach((r, i) => {
      const color = r.color || palette[i % palette.length];
      const rgb = color.startsWith('#') ? [parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5,7),16)] : [167,139,250];
      /* Gradient fill per rectangle */
      const grd = ctx.createLinearGradient(r.rx, r.ry, r.rx, r.ry + r.rh);
      grd.addColorStop(0, 'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0.8)');
      grd.addColorStop(1, 'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0.45)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.roundRect(r.rx + 2, r.ry + 2, r.rw - 4, r.rh - 4, 6);
      ctx.fill();
      /* Subtle glow border */
      ctx.strokeStyle = 'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0.4)';
      ctx.lineWidth = 1;
      ctx.shadowColor = 'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0.2)';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      /* Separator */
      ctx.strokeStyle = '#06060e';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (r.rw > 40 && r.rh > 30) {
        ctx.fillStyle = '#fff';
        const fontSize = Math.max(11, Math.min(18, r.rw / 8));
        ctx.font = '600 '+fontSize+'px "Space Grotesk",sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(r.label || '', r.rx + r.rw / 2, r.ry + r.rh / 2 - 8, r.rw - 12);
        ctx.font = '500 '+Math.max(9, fontSize - 3)+'px "JetBrains Mono",monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(String(r.value), r.rx + r.rw / 2, r.ry + r.rh / 2 + 10, r.rw - 12);
      }
    });
  }
  resize();
  window.addEventListener('resize', resize);
})();
</script>
""", {"title": "Treemap", "source": "", "items_json": "[]"})

# ---------------------------------------------------------------------------
# GAUGE — Neon arc gauge with glassmorphism center & ambient glow
# ---------------------------------------------------------------------------
_reg("gauge", "Circular gauge with neon arc, glassmorphism center, ambient glow", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#06060e;color:#f0ece4;min-height:100vh;
display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased;overflow:hidden}
@keyframes g-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes g-arc{from{stroke-dashoffset:var(--circumference)}to{stroke-dashoffset:var(--offset)}}
@keyframes g-glow{0%,100%{filter:drop-shadow(0 0 16px var(--gauge-color,rgba(232,197,71,.3)))}
50%{filter:drop-shadow(0 0 32px var(--gauge-color,rgba(232,197,71,.5)))}}
@keyframes g-orb{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(15px,-10px) scale(1.05)}}
.g-wrap{text-align:center;animation:g-up .6s both;position:relative}
.g-wrap::before{content:'';position:absolute;top:-60px;left:-60px;width:300px;height:300px;border-radius:50%;
background:radial-gradient(circle,var(--gauge-color,rgba(232,197,71,.08)),transparent 70%);
animation:g-orb 12s ease-in-out infinite;pointer-events:none;z-index:0}
.g-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(28px,3.5vw,44px);
font-weight:800;letter-spacing:-.02em;margin-bottom:clamp(16px,3vw,32px);position:relative;z-index:1;
background:linear-gradient(135deg,#fff 50%,var(--gauge-color,#e8c547));-webkit-background-clip:text;background-clip:text;color:transparent}
.g-svg-wrap{position:relative;display:inline-block;margin-bottom:clamp(12px,2vw,24px);z-index:1;
animation:g-glow 4s ease-in-out infinite}
.g-center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;
background:rgba(15,10,30,.6);backdrop-filter:blur(16px);border-radius:50%;
width:160px;height:160px;display:flex;flex-direction:column;align-items:center;justify-content:center;
border:1px solid rgba(255,255,255,.08);box-shadow:0 4px 24px rgba(0,0,0,.3)}
.g-val{font-family:'JetBrains Mono',monospace;font-size:clamp(42px,6vw,68px);font-weight:700;color:#fff}
.g-label{font-family:'Space Grotesk',sans-serif;font-size:clamp(12px,1.5vw,16px);
color:rgba(240,236,228,.45);text-transform:uppercase;letter-spacing:.12em;margin-top:2px}
.g-arc-track{fill:none;stroke:rgba(255,255,255,0.06);stroke-width:14;stroke-linecap:round}
.g-arc-fill{fill:none;stroke:url(#gaugeGradient);stroke-width:14;stroke-linecap:round;
stroke-dasharray:var(--circumference);stroke-dashoffset:var(--circumference);
animation:g-arc 1.8s .3s cubic-bezier(.22,1,.36,1) forwards}
.g-footer{font-family:'JetBrains Mono',monospace;font-size:11px;color:rgba(240,236,228,.25);position:relative;z-index:1}
</style>
<div class="g-wrap" style="--gauge-color:{color}">
  <div class="g-title">{title}</div>
  <div class="g-svg-wrap">
    <svg width="320" height="320" viewBox="0 0 320 320">
      <defs>
        <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#38bdf8"/>
          <stop offset="50%" style="stop-color:{color}"/>
          <stop offset="100%" style="stop-color:#d94f8e"/>
        </linearGradient>
      </defs>
      <circle class="g-arc-track" cx="160" cy="160" r="140" transform="rotate(-90 160 160)"
        stroke-dasharray="659.7" stroke-dashoffset="-164.9"/>
      <circle class="g-arc-fill" cx="160" cy="160" r="140" transform="rotate(-90 160 160)"
        stroke-dasharray="659.7" stroke-dashoffset="-164.9"
        style="--circumference:{arc_dasharray};--offset:{arc_offset}"/>
    </svg>
    <div class="g-center">
      <div class="g-val">{value}</div>
      <div class="g-label">{label}</div>
    </div>
  </div>
  <div class="g-footer">{source}</div>
</div>
""", {"title": "Gauge", "value": "0", "max_value": "100", "label": "", "color": "#e8c547", "source": "",
      "arc_dasharray": "494.8", "arc_offset": "494.8"})

# ---------------------------------------------------------------------------
# HEATMAP — Vibrant neon grid with hover glow & glassmorphism
# ---------------------------------------------------------------------------
_reg("heatmap", "Grid heatmap with vibrant neon colors, glassmorphism container, hover effects", _FONTS + """
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#06060e;color:#f0ece4;min-height:100vh;
display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;overflow:hidden}
@keyframes hm-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes hm-orb{0%,100%{transform:translate(0,0)}50%{transform:translate(20px,-15px)}}
.hm-wrap{width:100vw;height:100vh;display:flex;flex-direction:column;padding:48px clamp(24px,3vw,48px) 80px;
position:relative;overflow:hidden}
.hm-wrap::before{content:'';position:absolute;bottom:-10%;right:-5%;width:400px;height:400px;border-radius:50%;
background:radial-gradient(circle,rgba(232,197,71,.07),transparent 70%);animation:hm-orb 14s ease-in-out infinite;pointer-events:none}
.hm-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:clamp(28px,3.5vw,44px);
font-weight:800;letter-spacing:-.02em;margin-bottom:clamp(12px,2vw,24px);animation:hm-up .6s both;
flex-shrink:0;position:relative;z-index:2;
background:linear-gradient(135deg,#fff 40%,#34d399 70%,#e8c547);-webkit-background-clip:text;background-clip:text;color:transparent}
.hm-chart{flex:1;min-height:0;animation:hm-up .6s .15s both;position:relative;z-index:2;
background:rgba(255,255,255,.03);border-radius:20px;padding:16px;
backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);
box-shadow:0 8px 32px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.05)}
.hm-footer{flex-shrink:0;text-align:center;padding-top:12px;font-family:'JetBrains Mono',monospace;
font-size:11px;color:rgba(240,236,228,.25);animation:hm-up .6s .3s both;position:relative;z-index:2}
</style>
<div class="hm-wrap">
  <div class="hm-title">{title}</div>
  <div class="hm-chart"><canvas id="heatmap"></canvas></div>
  <div class="hm-footer">{source}</div>
</div>
<script>
(function(){
  const xLabels = {x_labels_json};
  const yLabels = {y_labels_json};
  const data = {data_json};
  const canvas = document.getElementById('heatmap');
  const container = canvas.parentElement;
  function resize() {
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    draw();
  }
  function draw() {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!data.length || !data[0]) return;
    const rows = data.length, cols = data[0].length;
    const labelW = 80, labelH = 40;
    const cellW = (W - labelW) / cols;
    const cellH = (H - labelH) / rows;
    let min = Infinity, max = -Infinity;
    for (const row of data) for (const v of row) { if (v < min) min = v; if (v > max) max = v; }
    if (min === max) max = min + 1;
    /* Neon color stops: deep blue -> cyan -> green -> gold -> rose */
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = (data[r][c] - min) / (max - min);
        let red, green, blue;
        if (t < 0.25) { const f = t/0.25; red=Math.round(20+f*16); green=Math.round(20+f*80); blue=Math.round(80+f*120); }
        else if (t < 0.5) { const f=(t-0.25)/0.25; red=Math.round(36+f*16); green=Math.round(100+f*100); blue=Math.round(200-f*60); }
        else if (t < 0.75) { const f=(t-0.5)/0.25; red=Math.round(52+f*180); green=Math.round(200-f*10); blue=Math.round(140-f*80); }
        else { const f=(t-0.75)/0.25; red=Math.round(232-f*15); green=Math.round(190-f*110); blue=Math.round(60+f*80); }
        ctx.fillStyle = 'rgb('+red+','+green+','+blue+')';
        ctx.globalAlpha = 0.35 + t * 0.6;
        const x = labelW + c * cellW, y = r * cellH;
        ctx.beginPath();
        ctx.roundRect(x + 2, y + 2, cellW - 4, cellH - 4, 5);
        ctx.fill();
        /* Subtle inner glow for high values */
        if (t > 0.6) {
          ctx.globalAlpha = (t - 0.6) * 0.3;
          ctx.shadowColor = 'rgb('+red+','+green+','+blue+')';
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        if (cellW > 30 && cellH > 20) {
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = t > 0.45 ? '#fff' : 'rgba(255,255,255,0.7)';
          ctx.font = '500 '+Math.max(9, Math.min(14, cellW / 4))+'px "JetBrains Mono",monospace';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(data[r][c]), x + cellW / 2, y + cellH / 2);
        }
      }
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(240,236,228,0.5)';
    ctx.font = "500 12px 'Space Grotesk',sans-serif";
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let r = 0; r < rows; r++) {
      ctx.fillText((yLabels && yLabels[r]) || '', labelW - 8, r * cellH + cellH / 2, labelW - 12);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let c = 0; c < cols; c++) {
      ctx.fillText((xLabels && xLabels[c]) || '', labelW + c * cellW + cellW / 2, rows * cellH + 6);
    }
  }
  resize();
  window.addEventListener('resize', resize);
})();
</script>
""", {"title": "Heatmap", "source": "", "x_labels_json": "[]", "y_labels_json": "[]", "data_json": "[[]]"})

# ===========================
# GALAXY - Interactive 3D Galaxy Simulator
# ===========================

_reg("galaxy", "Deep-space starfield visualization of 100,000 stars with elegant typography overlay", """
<style>
*{margin:0;padding:0;box-sizing:border-box}
.galaxy-container{position:absolute;inset:0;background:#000;overflow:hidden}
.galaxy-container canvas{position:absolute;top:0;left:0;width:100%;height:100%}
#overlay{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;
  justify-content:center;z-index:10;pointer-events:none}
#text-box{text-align:center;max-width:680px;padding:0 24px;opacity:0;animation:textFade 3s 1.5s forwards}
#text-box h1{font-family:Georgia,'Times New Roman',serif;color:rgba(255,255,255,0.92);
  font-size:clamp(18px,4vw,32px);font-weight:400;line-height:1.6;letter-spacing:0.02em;
  text-shadow:0 0 40px rgba(0,0,0,0.9)}
#text-box .sub{font-family:Georgia,serif;color:rgba(255,255,255,0.45);font-size:clamp(11px,2vw,15px);
  margin-top:20px;letter-spacing:0.08em;text-transform:uppercase}
@keyframes textFade{to{opacity:1}}
</style>
<div class="galaxy-container">
<canvas id="c"></canvas>
<div id="overlay">
  <div id="text-box">
    <h1>This is a visualization of over 100,000 stars in our local stellar neighborhood</h1>
    <div class="sub">Each point of light — a sun</div>
  </div>
</div>
<script>
const c=document.getElementById('c'),ctx=c.getContext('2d');
let w,h,stars=[],mouseX=0,mouseY=0,t=0;

function resize(){w=c.width=innerWidth;h=c.height=innerHeight}
resize();addEventListener('resize',resize);

// Star colors: blue-white, white, warm yellow, amber, red
const palette=['#aaccff','#cce0ff','#ffffff','#fff5e0','#ffd4a3','#ffb87a','#ff8866','#aabbff','#eeeeff'];

// Generate stars with depth layers for parallax
for(let i=0;i<100000;i++){
  const layer=Math.random(),size=layer<0.85?Math.random()*1.2+0.2:layer<0.97?Math.random()*1.8+0.8:Math.random()*2.5+1.5;
  stars.push({
    x:Math.random()*2-1,y:Math.random()*2-1,
    size,layer,
    color:palette[Math.floor(Math.random()*palette.length)],
    twinkleSpeed:Math.random()*2+1,twinkleOffset:Math.random()*Math.PI*2,
    drift:Math.random()*0.00002+0.000005
  });
}

addEventListener('mousemove',e=>{mouseX=(e.clientX/w-0.5)*2;mouseY=(e.clientY/h-0.5)*2});

function draw(){
  t+=0.016;
  ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);

  // Subtle nebula glow
  const g1=ctx.createRadialGradient(w*0.3,h*0.4,0,w*0.3,h*0.4,w*0.5);
  g1.addColorStop(0,'rgba(20,10,40,0.15)');g1.addColorStop(1,'transparent');
  ctx.fillStyle=g1;ctx.fillRect(0,0,w,h);
  const g2=ctx.createRadialGradient(w*0.7,h*0.6,0,w*0.7,h*0.6,w*0.4);
  g2.addColorStop(0,'rgba(10,15,40,0.12)');g2.addColorStop(1,'transparent');
  ctx.fillStyle=g2;ctx.fillRect(0,0,w,h);

  for(let i=0;i<stars.length;i++){
    const s=stars[i];
    // Parallax: deeper stars move less
    const parallax=(1-s.layer*0.7)*0.015;
    const px=(s.x+mouseX*parallax+t*s.drift)%2;
    const py=(s.y+mouseY*parallax*0.6)%2;
    const sx=((px+2)%2)*w;
    const sy=((py+2)%2)*h;

    // Twinkle
    const twinkle=0.5+0.5*Math.sin(t*s.twinkleSpeed+s.twinkleOffset);
    const alpha=s.layer<0.85?twinkle*0.6+0.1:twinkle*0.4+0.55;

    ctx.globalAlpha=alpha;
    ctx.fillStyle=s.color;

    if(s.size>1.8){
      // Bright stars get a soft glow
      const glow=ctx.createRadialGradient(sx,sy,0,sx,sy,s.size*3);
      glow.addColorStop(0,s.color);glow.addColorStop(0.3,s.color);
      glow.addColorStop(1,'transparent');
      ctx.fillStyle=glow;
      ctx.fillRect(sx-s.size*3,sy-s.size*3,s.size*6,s.size*6);
      ctx.fillStyle=s.color;
    }
    ctx.beginPath();ctx.arc(sx,sy,s.size*0.5,0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha=1;
  requestAnimationFrame(draw);
}
draw();
</script>
</div>
""", {})


# ---------------------------------------------------------------------------
# Key aliases — LLMs often use natural names instead of exact placeholder keys.
# Maps {template_name: {alias: canonical_key}}
# ---------------------------------------------------------------------------
_TEMPLATE_KEY_ALIASES = {
    "greeting_card": {
        "greeting": "user_name",
        "name": "user_name",
        "user": "user_name",
        "message": "motivational_quote",
        "quote": "motivational_quote",
        "time": "time_of_day",
        "weather": "weather_hint",
        "photo_url": "image_url",
    },
    "weather_card": {
        "temp": "temperature",
        "city": "location",
        "forecast": "forecast_bars",
        "details": "detail_pills",
        "humidity": "detail_pills",
    },
    "fact_card": {
        "fact": "fact_text",
        "text": "fact_text",
        "photo_url": "image_url",
    },
    "news_headline": {
        "title": "headline",
        "photo_url": "image_url",
        "photo": "image_url",
    },
    "person_bio": {
        "description": "bio",
        "image_url": "photo_url",
        "photo": "photo_url",
        "facts": "key_facts",
    },
    "movie_card": {
        "image_url": "poster_url",
        "description": "synopsis",
        "summary": "synopsis",
        "directed_by": "director",
        "starring": "cast",
        "actors": "cast",
        "length": "runtime",
        "duration": "runtime",
        "reviews": "critics",
        "quotes": "critics",
        "box_office": "stats",
        "awards": "stats",
    },
    "definition_card": {
        "example": "example_sentence",
        "pos": "part_of_speech",
        "photo_url": "image_url",
    },
    "photo_gallery": {
        "images": "photos",
        "gallery": "photos",
        "caption": "description",
    },
    "quote_spotlight": {
        "text": "quote",
        "quote_text": "quote",
        "attribution": "author",
        "source": "context",
        "photo_url": "image_url",
        "photo": "image_url",
    },
    "profile_card": {
        "photo_url": "avatar_url",
        "image_url": "avatar_url",
        "description": "bio",
    },
    "music_playlist": {
        "name": "playlist_name",
        "title": "playlist_name",
        "items": "tracks",
    },
    "photo_story": {
        "photo_url": "image_url",
        "caption": "text",
        "author": "attribution",
    },
    "event_card": {
        "title": "event_name",
        "name": "event_name",
        "venue": "location",
        "place": "location",
        "photo_url": "image_url",
        "photo": "image_url",
    },
    "map_card": {
        "location": "destination",
        "place": "destination",
        "name": "destination",
        "duration": "travel_time",
        "eta": "travel_time",
    },
    "daily_briefing": {
        "date": "date_display",
        "weather": "weather_summary",
        "agenda": "agenda_items",
        "calendar": "agenda_items",
        "quote": "highlight",
        "motivation": "highlight",
        "photo_url": "image_url",
        "photo": "image_url",
    },
    "sports_score": {
        "home": "team1",
        "away": "team2",
        "home_score": "score1",
        "away_score": "score2",
        "game_status": "status",
    },
    "code_snippet": {
        "lang": "language",
        "source": "code",
        "title": "filename",
        "file": "filename",
    },
    "before_after": {
        "left": "content_left",
        "right": "content_right",
        "left_label": "label_left",
        "right_label": "label_right",
    },
    "editorial_split": {
        "photo_url": "image_url",
        "photo": "image_url",
        "text": "body_text",
        "description": "body_text",
        "subtitle": "body_text",
        "source": "attribution",
        "label": "category",
    },
    "countdown_timer": {
        "photo_url": "image_url",
        "photo": "image_url",
    },
    "achievement_unlocked": {
        "photo_url": "image_url",
        "photo": "image_url",
    },
    "game_scoreboard": {
        "photo_url": "image_url",
        "photo": "image_url",
    },
    "quiz_question": {
        "photo_url": "image_url",
        "photo": "image_url",
    },
    "celebration": {
        "icon": "emoji",
        "title": "headline",
        "text": "message",
        "subtitle": "detail",
    },
    "recipe_card": {
        "name": "dish_name",
        "recipe_name": "dish_name",
        "title": "dish_name",
        "time": "cook_time",
        "prep_time": "cook_time",
        "prep": "cook_time",
        "duration": "cook_time",
        "photo_url": "image_url",
        "photo": "image_url",
    },
    "book_card": {
        "name": "title",
        "book_title": "title",
        "description": "synopsis",
        "summary": "synopsis",
        "image_url": "cover_url",
        "photo_url": "cover_url",
        "photo": "cover_url",
        "stars": "rating",
        "score": "rating",
        "writer": "author",
    },
    "music_now_playing": {
        "song": "track",
        "name": "track",
        "title": "track",
        "song_name": "track",
        "track_title": "track",
        "track_name": "track",
        "album_art": "album_art_url",
        "art_url": "album_art_url",
        "image_url": "album_art_url",
        "cover": "album_art_url",
        "photo_url": "album_art_url",
        "time": "duration",
        "length": "duration",
    },
    "location_card": {
        "name": "place_name",
        "location": "place_name",
        "title": "place_name",
        "coords": "coordinates",
        "photo_url": "image_url",
        "photo": "image_url",
        "facts": "quick_facts",
        "key_facts": "highlights",
    },
    "image_showcase": {
        "photo_url": "image_url",
        "photo": "image_url",
        "subtitle": "caption",
        "label": "caption",
        "text": "description",
        "body": "description",
    },
    "calculator": {
        "equation": "expression",
        "formula": "expression",
        "input": "expression",
        "answer": "result",
        "output": "result",
        "solution": "steps",
        "work": "steps",
    },
    "comparison_table": {
        "name": "title",
        "heading": "title",
        "data": "items",
        "rows": "items",
        "options": "items",
    },
    "timeline": {
        "name": "title",
        "heading": "title",
        "items": "events",
        "entries": "events",
        "milestones": "events",
    },
    "stat_dashboard": {
        "name": "title",
        "heading": "title",
        "data": "stats",
        "metrics": "stats",
        "numbers": "stats",
    },
    "progress_tracker": {
        "name": "title",
        "heading": "title",
        "milestones": "steps",
        "tasks": "steps",
        "items": "steps",
        "phases": "steps",
    },
    "loading_card": {
        "text": "message",
        "status": "message",
        "loading_message": "message",
    },
    "error_card": {
        "title": "error_title",
        "heading": "error_title",
        "message": "error_message",
        "text": "error_message",
        "error": "error_message",
        "fix": "suggestion",
        "hint": "suggestion",
        "help": "suggestion",
    },
    "list_card": {
        "name": "title",
        "heading": "title",
        "data": "items",
        "entries": "items",
        "list": "items",
    },
    "bar_chart": {
        "name": "title",
        "heading": "title",
        "data": "values",
        "categories": "labels",
    },
    "line_chart": {
        "name": "title",
        "heading": "title",
        "series": "datasets",
        "data": "datasets",
    },
    "pie_chart": {
        "name": "title",
        "heading": "title",
        "segments": "values",
        "data": "values",
    },
    "scatter_plot": {
        "name": "title",
        "heading": "title",
        "data": "points",
    },
    "comparison_bars": {
        "name": "title",
        "heading": "title",
        "data": "items",
        "entries": "items",
    },
    "timeline_chart": {
        "name": "title",
        "heading": "title",
        "data": "events",
        "entries": "events",
        "milestones": "events",
    },
    "treemap": {
        "name": "title",
        "heading": "title",
        "data": "items",
        "segments": "items",
        "blocks": "items",
    },
    "gauge": {
        "name": "title",
        "heading": "title",
    },
    "heatmap": {
        "name": "title",
        "heading": "title",
        "rows": "data",
        "grid": "data",
        "values": "data",
    },
    "story_choice": {
        "text": "narrative_text",
        "story": "narrative_text",
        "narrative": "narrative_text",
        "options": "choices",
        "buttons": "choices",
    },
    "poll": {
        "title": "question",
        "prompt": "question",
        "choices": "options",
        "answers": "options",
        "items": "options",
    },
}

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_template_names():
    """Return list of available template names."""
    return list(TEMPLATES.keys())


def get_template_description(name):
    """Return one-line description for a template."""
    return TEMPLATE_DESCRIPTIONS.get(name, "Unknown template")


def _auto_image_search_term(template_name: str, data: dict) -> str | None:
    """Extract a sensible image search term from template data for auto-image fallback."""
    _strategies = {
        "fact_card": lambda d: (
            # Prefer the actual subject: fact_text or fact (via alias), then title if non-default
            d.get("fact_text") or d.get("fact") or
            (d.get("title") if d.get("title") not in ("Did You Know?", "Fun Fact", "") else None) or
            d.get("category")
        ),
        "person_bio": lambda d: d.get("name"),
        "weather_card": lambda d: d.get("location") or d.get("condition"),
        "movie_card": lambda d: f"{d.get('title', '')} {d.get('year', '')} movie".strip(),
        "book_card": lambda d: f"{d.get('title', '')} {d.get('author', '')} book".strip(),
        "news_headline": lambda d: d.get("topic") or d.get("headline"),
        "location_card": lambda d: d.get("place_name"),
        "definition_card": lambda d: d.get("word"),
        "image_showcase": lambda d: d.get("title"),
        "recipe_card": lambda d: d.get("dish_name"),
        "quiz_question": lambda d: d.get("category") or d.get("question"),
        "countdown_timer": lambda d: d.get("event_name"),
        "achievement_unlocked": lambda d: d.get("title"),
        "greeting_card": lambda d: d.get("time_of_day"),
        "quote_spotlight": lambda d: d.get("author") or d.get("attribution") or d.get("quote_text"),
        "game_scoreboard": lambda d: d.get("game_name"),
        "music_now_playing": lambda d: f"{d.get('track', '')} {d.get('artist', '')}".strip(),
        "editorial_split": lambda d: d.get("title") or d.get("topic"),
    }
    fn = _strategies.get(template_name)
    if fn:
        term = fn(data)
        if term and term.strip():
            return term.strip()
    # Fallback: try common keys
    for key in ("title", "name", "topic", "headline", "place_name", "word", "dish_name"):
        val = data.get(key)
        if val and str(val).strip() and str(val).strip() not in ("Unknown", "Movie", "Book", "Recipe", "Game", "Location"):
            return str(val).strip()
    return None


def _auto_fill_image(template_name: str, merged: dict) -> dict:
    """If image URL fields are empty, auto-generate a fallback using /api/image?q=TERM."""
    image_keys = ("image_url", "photo_url", "poster_url", "cover_url", "album_art_url")
    for key in image_keys:
        if key in merged and (not merged[key] or merged[key].strip() == ""):
            search_term = _auto_image_search_term(template_name, merged)
            if search_term:
                # Truncate long text to first ~5 words for a focused image search
                words = search_term.split()
                if len(words) > 5:
                    search_term = " ".join(words[:5])
                from urllib.parse import quote
                merged[key] = f"/api/image?q={quote(search_term)}"
    return merged


def render_template(template_name, **kwargs):
    """Render a template by name, filling placeholders with kwargs or defaults."""
    # Reject empty/None template names before lookup
    if not template_name or not str(template_name).strip() or template_name == ".":
        raise ValueError(f"Empty or invalid template name: {template_name!r}")
    template_name = str(template_name).strip().lower()
    # Accept positional-only to avoid clash with data keys like 'name'
    if template_name not in TEMPLATES:
        raise ValueError(f"Unknown template: {template_name}. Available: {', '.join(TEMPLATES.keys())}")
    template = TEMPLATES[template_name]
    defaults = TEMPLATE_DEFAULTS.get(template_name, {})

    # Apply key aliases so LLMs can use natural names that map to template placeholders
    aliases = _TEMPLATE_KEY_ALIASES.get(template_name, {})
    resolved = {}
    for k, v in kwargs.items():
        canonical = aliases.get(k, k)
        resolved[canonical] = v

    merged = {**defaults, **resolved}

    # Rewrite defunct source.unsplash.com URLs to use the local image proxy
    _unsplash_image_keys = ("image_url", "photo_url", "poster_url", "cover_url", "album_art_url")
    for key in _unsplash_image_keys:
        val = merged.get(key, "")
        if val and "source.unsplash.com" in str(val):
            import re as _re
            from urllib.parse import quote as _url_quote
            # Extract search term from URL like .../600x400/?octopus+marine
            match = _re.search(r'/\?\s*(.+)$', str(val))
            if match:
                term = match.group(1).replace('+', ' ').strip()
                merged[key] = f"/api/image?q={_url_quote(term)}"

    # Auto-fill missing image URLs with fallback proxy
    merged = _auto_fill_image(template_name, merged)

    # Sanitize structured data that LLMs may pass as raw lists/dicts
    # ── Auto-convert structured data (lists/dicts) into HTML for templates ──
    # Templates expect pre-rendered HTML strings for list/grid placeholders.
    # When the caller passes Python lists or dicts, we convert them here.

    # comparison_table: items list-of-dicts OR list-of-lists → clean 3-column rows
    if template_name == "comparison_table":
        import html as _html_ct
        _esc_ct = _html_ct.escape
        items = merged.get("items")
        # LLM sometimes passes items as a JSON string instead of a list
        if isinstance(items, str):
            try:
                import json as _json_ct
                items = _json_ct.loads(items)
                merged["items"] = items
            except Exception:
                pass
        if isinstance(items, (list, tuple)):
            html_parts = []
            for i, item in enumerate(items):
                col1 = col2 = col3 = ""
                score2 = score3 = None
                if isinstance(item, dict):
                    col1 = _esc_ct(str(item.get("col1", item.get("feature", item.get("name", item.get("metric", ""))))))
                    col2 = _esc_ct(str(item.get("col2", item.get("option_a", item.get("value1", "")))))
                    col3 = _esc_ct(str(item.get("col3", item.get("option_b", item.get("value2", "")))))
                    score2 = item.get("score1", item.get("score_a"))
                    score3 = item.get("score2", item.get("score_b"))
                elif isinstance(item, (list, tuple)):
                    # LLM sends rows as [["col1","col2","col3"], ...]
                    col1 = _esc_ct(str(item[0])) if len(item) > 0 else ""
                    col2 = _esc_ct(str(item[1])) if len(item) > 1 else ""
                    col3 = _esc_ct(str(item[2])) if len(item) > 2 else ""
                else:
                    continue
                bar2 = ""
                bar3 = ""
                if score2 is not None and score3 is not None:
                    try:
                        s2, s3 = int(score2), int(score3)
                        bar2 = f'<div class="ct-bar" style="width:100%"><div class="ct-bar-fill strong" style="width:{min(s2,100)}%"></div></div>'
                        bar3 = f'<div class="ct-bar" style="width:100%"><div class="ct-bar-fill" style="width:{min(s3,100)}%"></div></div>'
                    except (ValueError, TypeError):
                        pass
                html_parts.append(
                    f'<div style="--i:{i}">'
                    f'<div style="font-family:var(--font-body);font-weight:600;color:#fff;font-size:clamp(13px,3.2vw,15px)">{col1}</div>'
                    f'<div style="font-size:clamp(13px,3vw,14px);color:rgba(255,255,255,.7);">{col2}{bar2}</div>'
                    f'<div style="font-size:clamp(13px,3vw,14px);color:rgba(255,255,255,.55);">{col3}{bar3}</div>'
                    f'</div>'
                )
            if html_parts:
                merged["items"] = "".join(html_parts)
            else:
                merged["items"] = '<div style="color:rgba(255,255,255,.4);padding:20px;text-align:center">No comparison data available</div>'

    # timeline: events list-of-dicts → timeline nodes with variable sizes and impact bars
    if template_name == "timeline":
        events = merged.get("events")
        if isinstance(events, (list, tuple)):
            num_events = len(events)
            html_parts = []
            for i, ev in enumerate(events):
                if isinstance(ev, dict):
                    date = ev.get("date", ev.get("time", ev.get("year", "")))
                    text = ev.get("text", ev.get("description", ev.get("event", "")))
                    weight = ev.get("weight", 1)
                    # Variable node sizes: 7px default, scale with weight
                    node_size = max(5, min(13, int(7 * weight)))
                    # Impact bar width: grows toward recent events
                    impact_w = 30 + int(50 * (i + 1) / max(num_events, 1))
                    impact_bar = f'<div class="tl-impact"><div class="tl-impact-fill" style="--impact-w:{impact_w}%"></div></div>'
                    html_parts.append(
                        f'<div style="--i:{i};--node-size:{node_size}px">'
                        f'<div style="font-family:var(--font-mono);font-size:clamp(10px,2.5vw,11px);font-weight:400;text-transform:uppercase;letter-spacing:.14em;color:rgba(255,255,255,.4);margin-bottom:4px">{date}</div>'
                        f'<div style="font-size:clamp(14px,3.4vw,16px);color:rgba(255,255,255,.75);line-height:1.6">{text}</div>'
                        f'{impact_bar}'
                        f'</div>'
                    )
            merged["events"] = "".join(html_parts)

    # stat_dashboard: individual stat fields OR stats list → glass metric cards with bar fills & sparklines
    if template_name == "stat_dashboard":
        stats = merged.get("stats")
        if isinstance(stats, (list, tuple)):
            import re as _re_sd
            import hashlib as _hl
            html_parts = []
            for i, st in enumerate(stats):
                if isinstance(st, dict):
                    label = st.get("label", st.get("name", ""))
                    value = st.get("value", st.get("stat", ""))
                    trend = st.get("trend", st.get("icon", ""))
                    # Parse percentage for bar width
                    bar_w = 50  # default
                    pct_match = _re_sd.search(r'(\d+(?:\.\d+)?)\s*%', str(value))
                    if pct_match:
                        bar_w = min(100, max(5, float(pct_match.group(1))))
                    else:
                        # Use a hash-derived value for non-percentage values
                        bar_w = 30 + (int(_hl.md5(str(value).encode()).hexdigest()[:4], 16) % 50)
                    # Generate a deterministic sparkline from the label
                    seed = int(_hl.md5((str(label) + str(value)).encode()).hexdigest()[:8], 16)
                    spark_pts = []
                    v = seed
                    for j in range(7):
                        v = (v * 1103515245 + 12345) & 0x7fffffff
                        y = 3 + (v % 15)
                        spark_pts.append(f"{j * 10},{y}")
                    sparkline = f'<svg width="60" height="20" viewBox="0 0 60 20" style="margin-top:6px"><polyline points="{" ".join(spark_pts)}" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.5" stroke-linecap="round"/></svg>'
                    html_parts.append(
                        f'<div class="glass" style="--i:{i}">'
                        f'<div class="sd-bar-bg" style="--bar-w:{bar_w}%"></div>'
                        f'<div style="position:relative;z-index:1">'
                        f'<div style="font-family:var(--font-mono);font-size:10px;font-weight:400;text-transform:uppercase;letter-spacing:.14em;color:rgba(255,255,255,.35)">{label}</div>'
                        f'<div style="font-family:var(--font-mono);font-size:clamp(28px,7vw,38px);font-weight:700;color:#fff;margin:8px 0 4px;letter-spacing:-.02em">{value}</div>'
                        f'<div style="font-size:11px;color:rgba(255,255,255,.4)">{trend}</div>'
                        f'{sparkline}'
                        f'</div></div>'
                    )
            merged["stats"] = "".join(html_parts)
        elif not stats or stats == "":
            # Build from individual stat1_value/stat1_label etc.
            html_parts = []
            colors = ["#38bdf8", "#d94f8e", "#34d399", "#e8c547"]
            for i in range(1, 9):
                val = merged.get(f"stat{i}_value", "")
                lab = merged.get(f"stat{i}_label", "")
                if val:
                    color = colors[(i - 1) % len(colors)]
                    html_parts.append(
                        f'<div class="glass" style="--i:{i - 1};max-width:180px;flex-shrink:0">'
                        f'<div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:rgba(240,236,228,.35)">{lab}</div>'
                        f'<div style="font-family:var(--font-title);font-size:clamp(18px,4vw,26px);font-weight:700;color:{color};margin:6px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{val}</div>'
                        f'</div>'
                    )
            if html_parts:
                merged["stats"] = "".join(html_parts)

    # progress_tracker: steps list-of-dicts → step nodes + arc gauge
    if template_name == "progress_tracker":
        steps = merged.get("steps")
        if isinstance(steps, (list, tuple)):
            total = len(steps)
            done_count = 0
            html_parts = []
            for i, step in enumerate(steps):
                if isinstance(step, dict):
                    label = step.get("label", step.get("name", step.get("text", "")))
                    status = step.get("status", step.get("state", "upcoming"))
                    done = status in ("complete", "completed", "done", True)
                    active = status in ("active", "current", "in_progress")
                    if done:
                        css_class = "done"
                        done_count += 1
                    elif active:
                        css_class = "active"
                    else:
                        css_class = ""
                    html_parts.append(
                        f'<div class="pt-step {css_class}" style="--i:{i}">'
                        f'<div class="pt-dot"></div>'
                        f'<div class="pt-label">{label}</div>'
                        f'</div>'
                    )
            merged["steps"] = "".join(html_parts)
            # Generate arc gauge SVG
            circumference = 264  # 2 * pi * 42
            pct = done_count / max(total, 1)
            arc_offset = circumference * (1 - pct)
            pct_display = f"{done_count}/{total}"
            merged["progress_arc"] = (
                f'<div class="pt-arc-wrap">'
                f'<svg viewBox="0 0 100 100" width="100" height="100">'
                f'<circle class="pt-arc-track" cx="50" cy="50" r="42"/>'
                f'<circle class="pt-arc-fill" cx="50" cy="50" r="42" '
                f'stroke-dasharray="{circumference}" stroke-dashoffset="{circumference}" '
                f'style="--arc-offset:{arc_offset}"/>'
                f'<text x="50" y="48" text-anchor="middle" fill="#fff" '
                f'font-family="JetBrains Mono,monospace" font-size="16" font-weight="700">{pct_display}</text>'
                f'<text x="50" y="62" text-anchor="middle" fill="rgba(255,255,255,.3)" '
                f'font-family="JetBrains Mono,monospace" font-size="9">{int(pct * 100)}%</text>'
                f'</svg></div>'
            )

    # daily_briefing: auto-fill agenda_items from tasks_summary / calendar_next
    if template_name == "daily_briefing":
        agenda = merged.get("agenda_items", "")
        if not agenda:
            parts = []
            cal = merged.get("calendar_next", "")
            tasks = merged.get("tasks_summary", "")
            if cal:
                parts.append(f'<div style="padding:8px 0;font-size:clamp(13px,3.2vw,15px)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#A78BFA" style="display:inline-block;width:16px;height:16px;vertical-align:middle"><path d="M5 4h14v2H5zm0 16h14v2H5zM3 10h2v10H3zm0-4h2v2H3zm16 0h2v2h-2zm0 4h2v10h-2zM3 8h18v2H3zm12-6h2v2h-2zM7 2h2v2H7z"/></svg> {cal}</div>')
            if tasks:
                parts.append(f'<div style="padding:8px 0;font-size:clamp(13px,3.2vw,15px)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#A78BFA" style="display:inline-block;width:16px;height:16px;vertical-align:middle"><path d="M4 6h2v14H4zm2 14h12v2H6zM18 6h2v14h-2zM6 4h2v2H6zm10 0h2v2h-2zm-6-2h4v2h-4zm0 4h4v2h-4zM8 2h2v6H8zm6 0h2v6h-2z"/></svg> {tasks}</div>')
            if parts:
                merged["agenda_items"] = "".join(parts)

    # music_now_playing: alias track_title → track
    if template_name == "music_now_playing":
        if "track_title" in merged and "track" not in merged:
            merged["track"] = merged.pop("track_title")

    # For weather_card, convert forecast list-of-dicts into rendered HTML
    if template_name == "weather_card":
        fb = merged.get("forecast_bars")
        if isinstance(fb, (list, tuple)):
            html_parts = []
            for item in fb:
                if isinstance(item, dict):
                    day = item.get("day", item.get("date", ""))
                    hi = item.get("high", item.get("high_f", ""))
                    lo = item.get("low", item.get("low_f", ""))
                    cond = item.get("condition", "")
                    # Simple emoji lookup
                    _e = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FFB300" style="display:inline-block;width:16px;height:16px;vertical-align:middle"><path d="M14 22H4v-2h10v2ZM4 20H2v-4h2v4Zm12 0h-2v-4h2v4Zm-6-2H8v-2h2v2Zm-2-2H4v-2h4v2Zm6 0h-2v-2h2v2Zm-2-2H8v-2h4v2Zm12-1h-4v-2h4v2Zm-6-1h-2v-2h2v2ZM8 10H6V8h2v2Zm8 0h-2V8h2v2Zm-2-2H8V6h6v2ZM6 6H4V4h2v2Zm14 0h-2V4h2v2ZM4 4H2V2h2v2Zm9 0h-2V0h2v4Zm9 0h-2V2h2v2Z"/></svg>' if "sun" in str(cond).lower() or "clear" in str(cond).lower() else '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#94A3B8" style="display:inline-block;width:16px;height:16px;vertical-align:middle"><path d="M14 22H4v-2h10v2ZM4 20H2v-4h2v4Zm12 0h-2v-4h2v4Zm-6-2H8v-2h2v2Zm-2-2H4v-2h4v2Zm6 0h-2v-2h2v2Zm-2-2H8v-2h4v2Zm12-1h-4v-2h4v2Zm-6-1h-2v-2h2v2ZM8 10H6V8h2v2Zm8 0h-2V8h2v2Zm-2-2H8V6h6v2ZM6 6H4V4h2v2Zm14 0h-2V4h2v2ZM4 4H2V2h2v2Zm9 0h-2V0h2v4Zm9 0h-2V2h2v2Z"/></svg>' if "cloud" in str(cond).lower() or "partly" in str(cond).lower() else '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#5B9BD5" style="display:inline-block;width:16px;height:16px;vertical-align:middle"><path d="M14 22H4v-2h10v2ZM4 20H2v-4h2v4Zm12 0h-2v-4h2v4Zm-6-2H8v-2h2v2Zm-2-2H4v-2h4v2Zm6 0h-2v-2h2v2Zm-2-2H8v-2h4v2Zm12-1h-4v-2h4v2Zm-6-1h-2v-2h2v2ZM8 10H6V8h2v2Zm8 0h-2V8h2v2Zm-2-2H8V6h6v2ZM6 6H4V4h2v2Zm14 0h-2V4h2v2ZM4 4H2V2h2v2Zm9 0h-2V0h2v4Zm9 0h-2V2h2v2Z"/></svg>' if "rain" in str(cond).lower() else '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#E0E7FF" style="display:inline-block;width:16px;height:16px;vertical-align:middle"><path d="M11 1h2v4h-2zm0 22h2v-4h-2zM9 5h2v4H9zm0 14h2v-4H9zm4-14h2v4h-2zm0 14h2v-4h-2zM5 9h4v2H5zm14 0h-4v2h4zM1 11h4v2H1zm22 0h-4v2h4zM5 13h4v2H5zm14 0h-4v2h4z"/></svg>' if "snow" in str(cond).lower() else '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FFD580" style="display:inline-block;width:16px;height:16px;vertical-align:middle"><path d="M14 22H4v-2h10v2ZM4 20H2v-4h2v4Zm12 0h-2v-4h2v4Zm-6-2H8v-2h2v2Zm-2-2H4v-2h4v2Zm6 0h-2v-2h2v2Zm-2-2H8v-2h4v2Zm12-1h-4v-2h4v2Zm-6-1h-2v-2h2v2ZM8 10H6V8h2v2Zm8 0h-2V8h2v2Zm-2-2H8V6h6v2ZM6 6H4V4h2v2Zm14 0h-2V4h2v2ZM4 4H2V2h2v2Zm9 0h-2V0h2v4Zm9 0h-2V2h2v2Z"/></svg>'
                    html_parts.append(
                        f'<div class="fc-day"><div class="fc-name">{day}</div>'
                        f'<div class="fc-icon">{_e}</div>'
                        f'<div class="fc-hi">{hi}°</div>'
                        f'<div class="fc-lo">{lo}°</div></div>'
                    )
            merged["forecast_bars"] = "".join(html_parts)
        elif isinstance(fb, dict):
            merged["forecast_bars"] = ""  # Single dict isn't valid forecast data
        dp = merged.get("detail_pills")
        if isinstance(dp, (list, dict)):
            merged["detail_pills"] = ""  # Clear invalid structured data

    # ── Greeting card quote sanitizer ────────────────────────────────
    # The LLM sometimes passes internal status/log text as the motivational
    # quote (e.g. "Gateway connected to OpenClaw"). Reject these and use a
    # sensible fallback.
    if template_name == "greeting_card":
        quote = merged.get("motivational_quote", "")
        _BAD_QUOTE_PATTERNS = [
            "gateway", "connected", "openclaw", "heartbeat", "session",
            "api", "endpoint", "websocket", "restarting", "compiling",
            "error", "status", "http", "localhost", "port ",
        ]
        if quote and any(p in quote.lower() for p in _BAD_QUOTE_PATTERNS):
            import logging as _log
            _log.getLogger(__name__).warning(
                f"[wonder] Rejected bad greeting quote: {quote!r}"
            )
            merged["motivational_quote"] = "Every day is a fresh beginning."

    # Use safe formatting - replace known placeholders, leave {{icon:...}} alone
    # movie_card: critics list-of-dicts → styled quote blocks
    if template_name == "movie_card":
        # Cast: join list into comma-separated string
        cast_val = merged.get("cast")
        if isinstance(cast_val, (list, tuple)):
            merged["cast"] = ", ".join(str(c) for c in cast_val)

        critics = merged.get("critics")
        if isinstance(critics, (list, tuple)):
            html_parts = []
            for crit in critics:
                if isinstance(crit, dict):
                    text = crit.get("quote", crit.get("text", ""))
                    source = crit.get("source", crit.get("critic", crit.get("publication", "")))
                    html_parts.append(
                        f'<div class="quote"><div class="quote-text">"{text}"</div>'
                        f'<div class="quote-source">{source}</div></div>'
                    )
                elif isinstance(crit, str):
                    html_parts.append(f'<div class="quote"><div class="quote-text">"{crit}"</div></div>')
            merged["critics"] = "".join(html_parts)
        # stats (box office, awards, etc.)
        stats = merged.get("stats")
        if isinstance(stats, (list, tuple)):
            html_parts = []
            for st in stats:
                if isinstance(st, dict):
                    label = st.get("label", st.get("name", ""))
                    value = st.get("value", st.get("stat", ""))
                    html_parts.append(
                        f'<div class="stat"><div class="stat-val">{value}</div>'
                        f'<div class="stat-lbl">{label}</div></div>'
                    )
            merged["stats"] = "".join(html_parts)

    # person_bio: generate initials fallback from name
    if template_name == "person_bio":
        if "initials" not in merged and "name" in merged:
            parts = merged["name"].split()
            merged["initials"] = "".join(p[0].upper() for p in parts[:2]) if parts else "?"

    # person_bio / profile_card: stats list-of-dicts → gold stat pills
    if template_name in ("person_bio", "profile_card"):
        stats = merged.get("stats")
        if isinstance(stats, (list, tuple)):
            html_parts = []
            for st in stats:
                if isinstance(st, dict):
                    label = st.get("label", st.get("name", ""))
                    value = st.get("value", st.get("stat", ""))
                    html_parts.append(
                        f'<div style="text-align:center">'
                        f'<div style="font-family:var(--font-title);font-size:clamp(20px,5vw,28px);font-weight:700;color:var(--c-gold,#e8c547)">{value}</div>'
                        f'<div style="font-family:var(--font-mono);font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:rgba(255,255,255,.4);margin-top:4px">{label}</div>'
                        f'</div>'
                    )
                elif isinstance(st, str):
                    html_parts.append(f'<div style="text-align:center;color:var(--c-gold,#e8c547);font-weight:600">{st}</div>')
            merged["stats"] = "".join(html_parts)
        # key_facts: list → bullet items
        kf = merged.get("key_facts")
        if isinstance(kf, (list, tuple)):
            merged["key_facts"] = "".join(
                f'<div style="padding:6px 0;font-size:clamp(12px,3vw,14px);color:rgba(255,255,255,.65)">• {f}</div>'
                for f in kf if isinstance(f, str)
            )

    # ── Auto-convert Python lists/dicts to JSON for chart templates ──
    import json as _json

    # bar_chart: accept "bars" list-of-dicts [{label,value},...] and split into labels/values
    if template_name == "bar_chart":
        bars = merged.get("bars")
        if isinstance(bars, (list, tuple)) and bars and isinstance(bars[0], dict):
            merged["labels"] = [b.get("label", "") for b in bars]
            merged["values"] = [b.get("value", 0) for b in bars]
            del merged["bars"]
        for k in ("labels", "values", "colors"):
            v = merged.get(k)
            if isinstance(v, (list, tuple)):
                merged[f"{k}_json"] = _json.dumps(list(v))
                del merged[k]

    # line_chart: accept "points" list-of-dicts [{label,value},...] and split
    if template_name == "line_chart":
        pts = merged.get("points")
        if isinstance(pts, (list, tuple)) and pts and isinstance(pts[0], dict):
            merged["labels"] = [p.get("label", "") for p in pts]
            merged.setdefault("datasets", [{"label": merged.get("subtitle", "Data"), "values": [p.get("value", 0) for p in pts]}])
            del merged["points"]

    # pie_chart: accept "slices" list-of-dicts [{label,value},...] and split
    if template_name == "pie_chart":
        slices = merged.get("slices")
        if isinstance(slices, (list, tuple)) and slices and isinstance(slices[0], dict):
            merged["labels"] = [s.get("label", "") for s in slices]
            merged["values"] = [s.get("value", 0) for s in slices]
            merged["colors"] = [s.get("color", "") for s in slices if s.get("color")]
            del merged["slices"]

    # scatter_plot: normalize point format
    if template_name == "scatter_plot":
        pts = merged.get("points")
        if isinstance(pts, (list, tuple)):
            merged["points"] = [{"x": p.get("x", 0), "y": p.get("y", 0), "label": p.get("label", "")} for p in pts if isinstance(p, dict)]

    # gauge: accept "zones" for color bands
    if template_name == "gauge":
        zones = merged.get("zones")
        if isinstance(zones, (list, tuple)):
            merged["zones_json"] = _json.dumps(list(zones))

    # bar_chart: labels, values, colors → JSON
    if template_name == "bar_chart":
        for k in ("labels", "values", "colors"):
            v = merged.get(k)
            if isinstance(v, (list, tuple)):
                merged[f"{k}_json"] = _json.dumps(list(v))
                del merged[k]
    # line_chart: labels, datasets → JSON
    if template_name == "line_chart":
        for k in ("labels", "datasets"):
            v = merged.get(k)
            if isinstance(v, (list, tuple)):
                merged[f"{k}_json"] = _json.dumps(list(v))
                if k in merged and f"{k}_json" in merged:
                    del merged[k]
            elif isinstance(v, str):
                try:
                    _json.loads(v)
                    merged[f"{k}_json"] = v
                except Exception:
                    pass
    # pie_chart: labels, values, colors → JSON; auto-compute center_value as total
    if template_name == "pie_chart":
        vals = merged.get("values")
        if isinstance(vals, (list, tuple)):
            merged["values_json"] = _json.dumps(list(vals))
            if not merged.get("center_value"):
                try:
                    merged["center_value"] = str(sum(float(x) for x in vals))
                except Exception:
                    pass
            del merged["values"]
        for k in ("labels", "colors"):
            v = merged.get(k)
            if isinstance(v, (list, tuple)):
                merged[f"{k}_json"] = _json.dumps(list(v))
                del merged[k]
    # scatter_plot: points → JSON
    if template_name == "scatter_plot":
        pts = merged.get("points")
        if isinstance(pts, (list, tuple)):
            merged["points_json"] = _json.dumps(list(pts))
            del merged["points"]
    # comparison_bars: items list → rendered HTML
    if template_name == "comparison_bars":
        items = merged.get("items")
        if isinstance(items, (list, tuple)):
            palette = ['#e8c547','#a78bfa','#38bdf8','#34d399','#d94f8e','#fbbf24']
            max_val = max((float(it.get("value", 0)) for it in items if isinstance(it, dict)), default=100)
            overall_max = max((float(it.get("max_value", max_val)) for it in items if isinstance(it, dict)), default=max_val)
            parts = []
            for i, it in enumerate(items):
                if isinstance(it, dict):
                    label = it.get("label", it.get("name", ""))
                    val = float(it.get("value", 0))
                    mx = float(it.get("max_value", overall_max))
                    color = it.get("color", palette[i % len(palette)])
                    pct = min(100, (val / mx * 100)) if mx > 0 else 0
                    parts.append(
                        f'<div class="cb-item" style="--i:{i};--bar-color:{color}">'
                        f'<div class="cb-label-row"><span class="cb-label">{label}</span>'
                        f'<span class="cb-value">{it.get("value", val)}</span></div>'
                        f'<div class="cb-track"><div class="cb-fill" style="--w:{pct:.1f}%"></div></div></div>'
                    )
            merged["items_html"] = "".join(parts)
            if "items" in merged:
                del merged["items"]
    # timeline_chart: events list → rendered HTML
    if template_name == "timeline_chart":
        evts = merged.get("events")
        if isinstance(evts, (list, tuple)):
            palette = ['#a78bfa','#e8c547','#38bdf8','#34d399','#d94f8e','#fbbf24']
            parts = []
            for i, ev in enumerate(evts):
                if isinstance(ev, dict):
                    date = ev.get("date", ev.get("time", ev.get("year", "")))
                    label = ev.get("label", ev.get("title", ev.get("event", "")))
                    desc = ev.get("description", ev.get("text", ""))
                    color = ev.get("color", palette[i % len(palette)])
                    parts.append(
                        f'<div class="tc-event" style="--i:{i};--dot-color:{color}">'
                        f'<div class="tc-dot"></div>'
                        f'<div class="tc-date">{date}</div>'
                        f'<div class="tc-label">{label}</div>'
                        f'<div class="tc-desc">{desc}</div></div>'
                    )
            merged["events_html"] = "".join(parts)
            if "events" in merged:
                del merged["events"]
    # treemap: items → JSON
    if template_name == "treemap":
        items = merged.get("items")
        if isinstance(items, (list, tuple)):
            merged["items_json"] = _json.dumps(list(items))
            del merged["items"]
    # gauge: compute arc geometry from value/max_value
    if template_name == "gauge":
        try:
            val = float(merged.get("value", 0))
            mx = float(merged.get("max_value", 100))
            pct = min(1, max(0, val / mx)) if mx > 0 else 0
            # 270-degree arc: circumference = 2*pi*140 * (270/360) ≈ 659.7, usable = 494.8
            arc_total = 659.7 * 0.75  # 494.8
            merged["arc_dasharray"] = f"{arc_total:.1f}"
            merged["arc_offset"] = f"{arc_total * (1 - pct):.1f}"
        except Exception:
            pass
    # heatmap: x_labels, y_labels, data → JSON
    if template_name == "heatmap":
        for k in ("x_labels", "y_labels"):
            v = merged.get(k)
            if isinstance(v, (list, tuple)):
                merged[f"{k}_json"] = _json.dumps(list(v))
                del merged[k]
        d = merged.get("data")
        if isinstance(d, (list, tuple)):
            merged["data_json"] = _json.dumps(list(d))
            del merged["data"]
    # stat_dashboard enhancement: metrics with sparkline_data
    if template_name == "stat_dashboard":
        metrics = merged.get("metrics")
        if isinstance(metrics, (list, tuple)) and not merged.get("stats"):
            merged["stats"] = metrics  # Let existing stat_dashboard converter handle it

    # We do manual replacement to avoid issues with CSS braces.
    # HTML-escape values to prevent XSS from LLM-generated content,
    # but skip values that are already rendered HTML (from auto-converters).
    import html as _html_mod
    _PRERENDERED_KEYS = {
        "critics", "stats", "key_facts", "ingredients", "steps",
        "metrics", "items", "events", "options", "choices", "players",
        "tracks", "labels", "values", "datasets", "points",
        "x_labels", "y_labels", "data", "sparkline_data",
        # JSON keys must not be escaped (they contain valid JS literals)
        "labels_json", "values_json", "colors_json", "datasets_json",
        "points_json", "items_json", "x_labels_json", "y_labels_json",
        "data_json", "zones_json",
    }
    result = template
    for key, value in merged.items():
        s = str(value)
        if key not in _PRERENDERED_KEYS and not s.startswith("<"):
            s = _html_mod.escape(s, quote=True)
        result = result.replace("{" + key + "}", s)

    # ── Opt out of runtime portrait/mobile overrides ──────────────────
    # The Wonder Canvas runtime applies aggressive body.portrait CSS with
    # !important on wildcard class selectors (e.g. [class*="content"],
    # [class*="body"]) that conflict with template-defined layouts.
    # Templates have their own responsive CSS via body.landscape/body.portrait classes,
    # so we mark them as "app-managed" to skip runtime portrait overrides.
    # The runtime's setScene() checks for "wonder-app-managed" in the HTML
    # and adds the class to .wonder-layer, which the portrait CSS skips
    # via :not(.wonder-app-managed).
    if "wonder-app-managed" not in result:
        result = f'<div data-wonder-app-managed style="display:contents">{result}</div>'

    return result


# ---------------------------------------------------------------------------
# List builder helpers (for templates that accept list HTML)
# ---------------------------------------------------------------------------

def build_list_items(items, numbered=False):
    """Build HTML list items from a Python list."""
    html = ""
    for i, item in enumerate(items, 1):
        prefix = f'<span class="c-violet" style="margin-right:8px;font-weight:600">{i}.</span>' if numbered else '<span class="c-violet" style="margin-right:8px">➡️</span>'
        html += f'<div class="list-item">{prefix}{item}</div>'
    return html


def build_choice_buttons(choices):
    """Build choice button HTML from a list of (label, action) tuples."""
    html = ""
    for label, action in choices:
        html += f'<button class="choice-btn" data-action="{action}">{label}</button>'
    return html


def build_poll_options(options):
    """Build poll options with vote bars from list of (label, percent) tuples."""
    html = ""
    for label, pct in options:
        html += f'''<div style="margin-bottom:12px">
<div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:clamp(12px,3vw,14px)"><span>{label}</span><span class="t-muted">{pct}%</span></div>
<div class="bar-track"><div class="bar-fill" style="width:{pct}%"></div></div></div>'''
    return html


def build_quiz_options(options):
    """Build quiz option buttons from list of (label, action) tuples."""
    letters = "ABCDEFGH"
    html = ""
    for i, (label, action) in enumerate(options):
        letter = letters[i] if i < len(letters) else str(i+1)
        html += f'<button class="choice-btn" data-action="{action}"><span class="c-violet" style="margin-right:10px;font-weight:700;font-family:var(--font-title)">{letter}</span>{label}</button>'
    return html


def build_stat_items(stats):
    """Build stat items from list of (label, value, trend_icon) tuples."""
    html = ""
    for label, value, trend in stats:
        html += f'<div class="glass" style="display:flex;flex-direction:column;padding:12px"><div class="t-label" style="color:var(--c-muted);font-size:10px">{label}</div><div style="font-family:var(--font-title);font-size:clamp(22px,6vw,30px);font-weight:700;color:#fff;margin:4px 0">{value}</div><div style="font-size:12px;color:var(--c-violet)">{trend}</div></div>'
    return html


def build_timeline_events(events):
    """Build timeline events from list of (date, description) tuples."""
    html = ""
    for date, desc in events:
        html += f'<div style="margin-bottom:18px;position:relative"><div style="position:absolute;left:-26px;top:4px;width:8px;height:8px;border-radius:50%;background:#8b5cf6;box-shadow:0 0 8px rgba(139,92,246,0.4)"></div><div class="t-label" style="color:var(--c-violet);margin-bottom:3px">{date}</div><div style="font-size:clamp(13px,3.2vw,15px);color:rgba(240,236,228,0.7);line-height:1.6">{desc}</div></div>'
    return html


def build_progress_steps(steps):
    """Build progress steps from list of (label, completed_bool) tuples."""
    html = ""
    for label, done in steps:
        icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#4ADE80" style="display:inline-block;width:16px;height:16px;vertical-align:middle"><path d="M10 18H8v-2h2v2Zm-2-2H6v-2h2v2Zm4-2v2h-2v-2h2Zm-6 0H4v-2h2v2Zm8 0h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2V8h2v2Zm2-2h-2V6h2v2Z"/></svg>' if done else '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#6B7280" style="display:inline-block;width:16px;height:16px;vertical-align:middle"><path d="M4 11h16v2H4z"/></svg>'
        color = "color:#8b5cf6" if done else "color:rgba(255,255,255,0.3)"
        html += f'<div class="list-item" style="{color}">{icon} <span style="margin-left:8px">{label}</span></div>'
    return html


def build_forecast_bars(forecasts):
    """Build forecast bars from list of (day, high, low) tuples."""
    html = ""
    for day, high, low in forecasts:
        html += f'<div class="list-item" style="display:flex;justify-content:space-between;align-items:center;font-size:clamp(13px,3.2vw,15px)"><span>{day}</span><span class="t-muted">{low}</span><div class="bar-track" style="width:40%;margin:0 8px"><div class="bar-fill" style="width:{min(100,max(0,(int(high)-int(low))*5))}%"></div></div><span>{high}</span></div>'
    return html


def build_comparison_items(items):
    """Build comparison items from list of dicts with 'name' and 'attributes' keys."""
    html = ""
    for item in items:
        attrs = "".join(f'<div style="font-size:clamp(12px,3vw,14px);color:rgba(240,236,228,0.5);margin-top:3px">{k}: <span style="color:#fff">{v}</span></div>' for k, v in item.get("attributes", {}).items())
        html += f'<div class="glass mb"><div style="font-family:var(--font-title);font-weight:600;color:#a78bfa">{item.get("name","")}</div>{attrs}</div>'
    return html


def build_scoreboard(entries):
    """Build scoreboard from list of (name, score) tuples."""
    html = ""
    for i, (name, score) in enumerate(entries, 1):
        medal = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FFD700" style="display:inline-block;width:16px;height:16px;vertical-align:middle"><path d="M6 3h12v2H6z"/> <path d="M6 3h2v12H6zm10 0h2v12h-2z"/> <path d="M16 5h6v2h-6zM2 5h6v2H2zm0 2h2v4H2zm2 4h2v2H4zm14 0h2v2h-2zm2-4h2v4h-2zM8 15h8v2H8zm3 2h2v4h-2z"/> <path d="M9 19h6v2H9z"/></svg>' if i == 1 else ""
        html += f'<div class="list-item" style="display:flex;justify-content:space-between"><span>{medal} {name}</span><span style="font-family:var(--font-title);font-weight:700;color:#fff">{score}</span></div>'
    return html
