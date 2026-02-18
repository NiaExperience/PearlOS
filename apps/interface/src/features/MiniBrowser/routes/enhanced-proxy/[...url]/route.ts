import { NextRequest, NextResponse } from 'next/server';

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'');
}

function buildInjectedScript(originalUrl: string) {
  const proxyPrefix = `/api/mini-browser/enhanced-proxy/`;
  return `
<script>(function(){
  var PROXY_PREFIX = ${JSON.stringify(proxyPrefix)};
  var ORIGINAL_URL = ${JSON.stringify(originalUrl)};
  function decodeHtmlEntities(value){
    if(!value || typeof value !== 'string') return value;
    return value
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }
  function toAbsolute(u){ try{ if(!u || u==='undefined' || u==='about:blank' || u==='#') return ''; if(u.startsWith('//')) u = new URL(ORIGINAL_URL).protocol + u; var abs = new URL(decodeHtmlEntities(u), ORIGINAL_URL).toString(); return abs; }catch(e){ return ''; } }
  function proxify(u){ try{ var abs = toAbsolute(u); if(!abs) return ''; if(!/^https?:\/\//i.test(abs)) return abs; return PROXY_PREFIX + encodeURIComponent(abs); }catch(e){ return u; } }
  function rewriteStyleUrls(styleValue){
    try{
      if(!styleValue) return styleValue;
      return String(styleValue).replace(/url\(([^)]+)\)/gi, function(_m, p1){
        try{
          var raw = decodeHtmlEntities(String(p1).trim().replace(/^['"]|['"]$/g, ''));
          if(!raw || /^data:/.test(raw) || /^javascript:/i.test(raw)) return _m;
          return 'url(' + proxify(raw) + ')';
        }catch(e){ return _m; }
      });
    }catch(e){ return styleValue; }
  }
  // fetch override: handle string, URL, Request
  var _fetch = window.fetch;
  try{
    window.fetch = function(input, init){
      try{
        var newInit = { ...(init||{}) };
        try{ if(!('credentials' in newInit)) newInit.credentials = 'include'; }catch(e){}
        if (typeof input === 'string') {
          var u = input; var p = proxify(u); if(p && p !== u) u = p;
          return _fetch.call(this, u, newInit);
        }
        if (input && input.url) {
          var ru = input.url; var pr = proxify(ru); if(pr && pr !== ru) ru = pr;
          var req = new Request(ru, input);
          return _fetch.call(this, req, newInit);
        }
        if (input instanceof Request) {
          var reqUrl = input.url; var proxiedUrl = proxify(reqUrl); 
          if(proxiedUrl && proxiedUrl !== reqUrl) {
            var newReq = new Request(proxiedUrl, { ...input, ...newInit });
            return _fetch.call(this, newReq);
          }
        }
      }catch(e){}
      return _fetch.call(this, input, init);
    };
  }catch(e){}
  // XMLHttpRequest override
  try{ var _open = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(method, url){ try{ var p = proxify(url); var args = Array.prototype.slice.call(arguments); if(p && p !== url) args[1] = p; this.withCredentials = true; return _open.apply(this, args); }catch(e){ return _open.apply(this, arguments); } }; }catch(e){}
  // sendBeacon override
  try{ var _sb = navigator.sendBeacon; if (_sb) { navigator.sendBeacon = function(url, data){ try{ var p = proxify(url); if(p && p !== url) url = p; }catch(e){} return _sb.call(this, url, data); }; } }catch(e){}
  // EventSource override
  try{ var _ES = window.EventSource; if (_ES) { window.EventSource = function(url, conf){ try{ var p = proxify(url); if(p && p !== url) url = p; }catch(e){} return new _ES(url, conf); }; window.EventSource.prototype = _ES.prototype; } }catch(e){}
  // WebSocket override
  try{ var _WS = window.WebSocket; if (_WS) { window.WebSocket = function(url, prot){ try{ if(url && typeof url==='string' && /^(ws|wss):\/\//.test(url)){ var httpUrl = url.replace(/^ws(s?):\/\//,'http$1://'); url = proxify(httpUrl).replace(/^http(s?):\/\//,'ws$1://'); } }catch(e){} return new _WS(url, prot); }; window.WebSocket.prototype = _WS.prototype; } }catch(e){}
  // Disable Service Workers
  try{ if (navigator.serviceWorker && navigator.serviceWorker.register) { navigator.serviceWorker.register = function(){ return Promise.reject(new Error('ServiceWorker disabled in Enhanced Mini Browser')); }; } }catch(e){}
  
  // Protect parent audio context from interference
  try{
    // Disable getUserMedia to prevent microphone conflicts
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia = function(){ return Promise.reject(new Error('Media access disabled in Enhanced Mini Browser')); };
    }
    if (navigator.getUserMedia) {
      navigator.getUserMedia = function(){ throw new Error('Media access disabled in Enhanced Mini Browser'); };
    }
    
    // Limit AudioContext creation to prevent audio interference
    var _AudioContext = window.AudioContext || window.webkitAudioContext;
    if (_AudioContext) {
      window.AudioContext = function(){ 
        // AudioContext creation intentionally limited in Enhanced Mini Browser
        var ctx = new _AudioContext();
        // Limit volume and prevent suspend/resume interference
        if (ctx.createGain) {
          var originalCreateGain = ctx.createGain;
          ctx.createGain = function() {
            var gain = originalCreateGain.call(this);
            if (gain.gain && gain.gain.setValueAtTime) {
              gain.gain.setValueAtTime(Math.min(0.1, gain.gain.value || 0.1), ctx.currentTime);
            }
            return gain;
          };
        }
        return ctx;
      };
      if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
    }
    
    // Listen for parent messages about audio protection
    window.addEventListener('message', function(ev) {
      // Audio interference protection enabled
    });
  }catch(e){}
  // Proxify dynamic resources
  function rewriteAttribute(el, attr){ try{ var val = el.getAttribute(attr); if(!val) return; if(/^javascript:/i.test(val) || String(val).startsWith('data:')) return; if(String(val).indexOf(PROXY_PREFIX)===0) return; if(attr==='style'){ var rewritten = rewriteStyleUrls(val); if(rewritten!==val) el.setAttribute('style', rewritten); return; } var p = proxify(val); if(p) el.setAttribute(attr, p); }catch(e){} }
  function proxifyElement(el){
    var tag = (el.tagName||'').toLowerCase();
    if(tag==='a' || tag==='link' || tag==='img' || tag==='script' || tag==='iframe' || tag==='source' || tag==='video' || tag==='audio' || tag==='form'){
      ['href','src','action','poster','data'].forEach(function(attr){ if(el.hasAttribute && el.hasAttribute(attr)) rewriteAttribute(el, attr); });
      if (el.hasAttribute && el.hasAttribute('srcset')) {
        try{ var val = el.getAttribute('srcset'); var parts = (val||'').split(',').map(function(p){return p.trim();}).filter(Boolean); var rewritten = parts.map(function(p){ var m = p.split(/\s+/,2); var u=m[0]; var d=m[1]||''; return proxify(decodeHtmlEntities(u))+(d?(' '+d):''); }).join(', '); el.setAttribute('srcset', rewritten); }catch(e){}
      }
      if (el.hasAttribute && el.hasAttribute('style')) {
        rewriteAttribute(el, 'style');
      }
    }
  }
  try{
    var mo = new MutationObserver(function(muts){
      muts.forEach(function(m){
        if(m.type==='attributes') {
          if(m.attributeName==='style') rewriteAttribute(m.target, 'style');
          else proxifyElement(m.target);
        }
        if(m.type==='childList') m.addedNodes && m.addedNodes.forEach(function(n){ if(n && n.nodeType===1) proxifyElement(n); });
      });
    });
    mo.observe(document.documentElement, { attributes:true, attributeFilter:['href','src','srcset','action','poster','data','style'], childList:true, subtree:true });
    document.querySelectorAll('a,link,img,script,iframe,source,video,audio,form').forEach(proxifyElement);
  }catch(e){}
  function notify(type, data){
    try{ if(window.parent && window.parent!==window){ window.parent.postMessage({ type: 'ENHANCED_BROWSER_'+type, data: data||{}, timestamp: Date.now(), url: window.location.href }, '*'); } }catch(e){}
  }
  notify('PAGE_READY', { title: document.title, url: ${JSON.stringify(originalUrl)} });
  var lastHref = location.href;
  setInterval(function(){ if(location.href!==lastHref){ lastHref = location.href; notify('NAVIGATION', { newUrl: lastHref, title: document.title }); } }, 1500);
  window.addEventListener('error', function(e){ try{ notify('ERROR', { message: e.message }); }catch(err){ } });
  window.addEventListener('unhandledrejection', function(e){ try{ notify('ERROR', { message: String(e.reason) }); }catch(err){ } });
  var scrolling = null; var speed=1; var dir='down';
  function step(){ if(!scrolling) return; var by = (dir==='down'?1:-1)*Math.max(1, speed)*4; window.scrollBy({ top: by, behavior: 'auto' }); requestAnimationFrame(step); }
  function start(s,d){ speed = s||1; dir = d||'down'; if(!scrolling){ scrolling=true; requestAnimationFrame(step);} }
  function stop(){ scrolling=false; notify('AUTO_SCROLL_STOPPED'); }
  window.addEventListener('message', function(ev){ var m = ev.data||{}; if(!m || !m.type) return; if(m.type==='AUTO_SCROLL_START'){ start(m.speed, m.direction); } else if(m.type==='AUTO_SCROLL_STOP'){ stop(); } else if(m.type==='AUTO_SCROLL_SPEED_CHANGE'){ speed = m.speed||1; } else if(m.type==='AUTO_SCROLL_DIRECTION_CHANGE'){ dir = m.direction||'down'; } });
})();</script>`;
}

async function fetchThrough(request: NextRequest, target: string): Promise<Response> {
  const init: RequestInit = {
    method: 'GET',
    headers: {
      'user-agent': request.headers.get('user-agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'accept': request.headers.get('accept') || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'accept-language': request.headers.get('accept-language') || 'en-US,en;q=0.9',
      'accept-encoding': 'gzip, deflate, br',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'origin': (()=>{ try{ return new URL(target).origin; }catch{ return undefined as any; } })(),
      'referer': target,
    },
    credentials: 'include'
    
  };
  return fetch(target, init);
}

function rewriteUrlAttribute(value: string, baseUrl: URL): string {
  if (!value) return value;
  const decodedValue = decodeHtmlEntities(value);
  // Handle srcset like: "url1 1x, url2 2x"
  if (/(\s|,)/.test(decodedValue) && decodedValue.includes(' ')) {
    const parts = decodedValue.split(',').map(p => p.trim()).filter(Boolean);
    const rewritten = parts.map(p => {
      const [u, descriptor] = p.split(/\s+/, 2);
      const abs = new URL(u, baseUrl).toString();
      return `/api/mini-browser/enhanced-proxy/${encodeURIComponent(abs)}${descriptor ? ' ' + descriptor : ''}`;
    }).join(', ');
    return rewritten;
  }
  try {
    const abs = new URL(decodedValue, baseUrl).toString();
    return `/api/mini-browser/enhanced-proxy/${encodeURIComponent(abs)}`;
  } catch {
    return value;
  }
}

function rewriteHtmlResources(html: string, originalUrl: string): string {
  const base = new URL(originalUrl);

  function rewriteStyleInline(val: string): string {
    try {
      let css = val;
      css = css.replace(/url\(([^)]+)\)/gi, (m, p1) => {
        const raw = decodeHtmlEntities(String(p1).trim().replace(/^["']|["']$/g, ''));
        if (!raw || /^data:/.test(raw) || /^javascript:/i.test(raw)) return m;
        try {
          const abs = new URL(raw, base).toString();
          return `url(/api/mini-browser/enhanced-proxy/${encodeURIComponent(abs)})`;
        } catch {
          return m;
        }
      });
      return css;
    } catch {
      return val;
    }
  }

  function rewriteTag(tagName: string, attrs: string): string {
    const targetAttrs = ['href', 'src', 'action', 'poster', 'srcset', 'style', 'data'];
    const rewritten = attrs.replace(/(\b[\w:-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/g, (m, name, eq, value) => {
      const lower = String(name).toLowerCase();
      if (!targetAttrs.includes(lower)) return m;

      const quote = value.startsWith('"') || value.startsWith('\'') ? value[0] : '';
      const unquoted = quote ? value.slice(1, -1) : value;

      if (lower === 'href' && (unquoted.startsWith('#') || unquoted.startsWith('mailto:') || unquoted.startsWith('tel:'))) {
        return m;
      }
      if (/^javascript:/i.test(unquoted) || unquoted.startsWith('data:')) return m;

      if (lower === 'srcset') {
        const proxied = rewriteUrlAttribute(unquoted, base);
        const quoted = quote ? `${quote}${proxied}${quote}` : `"${proxied}"`;
        return `${name}${eq}${quoted}`;
      }

      if (lower === 'style') {
        const proxied = rewriteStyleInline(unquoted);
        const quoted = quote ? `${quote}${proxied}${quote}` : `"${proxied}"`;
        return `${name}${eq}${quoted}`;
      }

      try {
        const proxied = rewriteUrlAttribute(unquoted, base);
        const quoted = quote ? `${quote}${proxied}${quote}` : `"${proxied}"`;
        return `${name}${eq}${quoted}`;
      } catch {
        return m;
      }
    });
    return `<${tagName}${rewritten}>`;
  }

  // Only rewrite tag attributes; skip <script> and <style> contents entirely
  html = html.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<[^>]+>/gi, (m) => {
    if (m.startsWith('<script') || m.startsWith('<style') || m.startsWith('</')) return m;
    const openTagMatch = /^<([a-zA-Z][^\s>\/]*)((?:\s+[^>]*)?)>$/.exec(m);
    if (!openTagMatch) return m;
    const [, tagName, attrs] = openTagMatch as unknown as [string, string, string];
    return rewriteTag(tagName, attrs || '');
  });

  // Remove simple frame-busting meta tags and loosen CSP meta
  html = html.replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/gi, '');
  html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
  return html;
}

function injectHtml(html: string, originalUrl: string): string {
  const rewritten = rewriteHtmlResources(html, originalUrl);
  const script = buildInjectedScript(originalUrl);
  // Prefer injecting right after opening <head>
  const headOpenRe = /(<head[^>]*>)/i;
  if (headOpenRe.test(rewritten)) return rewritten.replace(headOpenRe, `$1\n${script}`);
  if (rewritten.includes('</head>')) return rewritten.replace('</head>', `${script}\n</head>`);
  if (rewritten.includes('</body>')) return rewritten.replace('</body>', `${script}\n</body>`);
  return rewritten + script;
}

function rewriteCssResources(css: string, originalUrl: string): string {
  const base = new URL(originalUrl);
  const proxify = (u: string) => {
    try {
      const normalized = decodeHtmlEntities(u);
      const abs = new URL(normalized, base).toString();
      return `/api/mini-browser/enhanced-proxy/${encodeURIComponent(abs)}`;
    } catch { return u; }
  };
  // url(...) references
  css = css.replace(/url\(([^)]+)\)/gi, (m, p1) => {
    let raw = String(p1).trim().replace(/^['"]|['"]$/g, '');
    if (!raw || /^data:/.test(raw) || /^javascript:/i.test(raw)) return m;
    return `url(${proxify(raw)})`;
  });
  // @import '...'
  css = css.replace(/@import\s+(?:url\()?['"]([^'"\)]+)['"][^;]*;?/gi, (_m, p1) => {
    if (!p1) return _m;
    const proxied = proxify(p1);
    return `@import url(${proxied});`;
  });
  return css;
}

export async function GET_impl(request: NextRequest, { params }: { params: Promise<{ url: string[] }> }): Promise<NextResponse> {
  try {
    const resolved = await params;
    const joined = (resolved?.url || []).join('/');
    if (!joined) return NextResponse.json({ error: 'Missing URL' }, { status: 400 });
    const target = decodeHtmlEntities(decodeURIComponent(joined));
    if (!/^https?:\/\//i.test(target)) return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });

    const upstream = await fetchThrough(request, target);
    let contentType = upstream.headers.get('content-type') || '';
    const buf = await upstream.arrayBuffer();

    // Fix MIME type detection for dynamic endpoints (e.g., Wikipedia load.php)
    // Check URL parameters to determine expected content type
    try {
      const urlObj = new URL(target);
      const onlyParam = urlObj.searchParams.get('only');
      if (onlyParam === 'styles' && !contentType.includes('text/css')) {
        contentType = 'text/css; charset=utf-8';
      } else if (onlyParam === 'scripts' && !contentType.includes('application/javascript') && !contentType.includes('text/javascript')) {
        contentType = 'application/javascript; charset=utf-8';
      }
      // Also check for common CSS/JS file extensions
      if (!contentType || contentType === 'application/octet-stream') {
        const pathname = urlObj.pathname.toLowerCase();
        if (pathname.endsWith('.css')) {
          contentType = 'text/css; charset=utf-8';
        } else if (pathname.endsWith('.js')) {
          contentType = 'application/javascript; charset=utf-8';
        }
      }
    } catch {
      // URL parsing failed, use original contentType
    }

    const baseCorsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept,Origin,Referer,User-Agent,X-Requested-With,Cache-Control,Pragma,Accept-Encoding,Accept-Language',
      'Access-Control-Expose-Headers': 'Content-Length,Content-Type,Date,Server,X-Powered-By',
      'Vary': 'Origin,Accept-Encoding',
    };

    function sanitizeHeaders(extra: Record<string,string> = {}){
      const headers: Record<string,string> = { ...extra };
      headers['x-content-type-options'] = 'nosniff';
      // Intentionally do not forward upstream CSP or Set-Cookie
      return headers;
    }

    if (contentType.includes('text/html')) {
      const html = new TextDecoder().decode(buf);
      const processed = injectHtml(html, target);
      return new NextResponse(processed, {
        status: upstream.status,
        headers: sanitizeHeaders({ 'content-type': 'text/html; charset=utf-8', ...baseCorsHeaders }),
      });
    }
    if (contentType.includes('text/css')) {
      const css = new TextDecoder().decode(buf);
      const processedCss = rewriteCssResources(css, target);
      return new NextResponse(processedCss, {
        status: upstream.status,
        headers: sanitizeHeaders({ 'content-type': 'text/css; charset=utf-8', ...baseCorsHeaders }),
      });
    }
    return new NextResponse(buf, {
      status: upstream.status,
      headers: sanitizeHeaders({ 'content-type': contentType || 'application/octet-stream', ...baseCorsHeaders }),
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Proxy error', message: String(e?.message || e) }, { status: 502 });
  }
}

export async function OPTIONS_impl(request: NextRequest): Promise<NextResponse> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept,Origin,Referer,User-Agent,X-Requested-With,Cache-Control,Pragma,Accept-Encoding,Accept-Language',
    'Access-Control-Expose-Headers': 'Content-Length,Content-Type,Date,Server,X-Powered-By',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin,Accept-Encoding',
  };
  return new NextResponse(null, { status: 204, headers });
}

async function handleNonGet_impl(request: NextRequest, { params }: { params: Promise<{ url: string[] }> }): Promise<NextResponse> {
  try {
    const resolved = await params;
    const joined = (resolved?.url || []).join('/');
    if (!joined) return NextResponse.json({ error: 'Missing URL' }, { status: 400 });
    const target = decodeHtmlEntities(decodeURIComponent(joined));
    if (!/^https?:\/\//i.test(target)) return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });

    const method = request.method;
    const upstreamInit: RequestInit = {
      method,
      headers: {
        'user-agent': request.headers.get('user-agent') || 'Mozilla/5.0',
        'accept': request.headers.get('accept') || '*/*',
        'accept-language': request.headers.get('accept-language') || 'en-US,en;q=0.9',
        'content-type': request.headers.get('content-type') || undefined as any,
        'referer': target,
      },
      body: ['GET', 'HEAD'].includes(method) ? undefined : await request.arrayBuffer(),
    };

    const upstream = await fetch(target, upstreamInit);
    let contentType = upstream.headers.get('content-type') || '';
    const buf = ['HEAD'].includes(method) ? new ArrayBuffer(0) : await upstream.arrayBuffer();

    // Fix MIME type detection for dynamic endpoints (e.g., Wikipedia load.php)
    // Check URL parameters to determine expected content type
    try {
      const urlObj = new URL(target);
      const onlyParam = urlObj.searchParams.get('only');
      if (onlyParam === 'styles' && !contentType.includes('text/css')) {
        contentType = 'text/css; charset=utf-8';
      } else if (onlyParam === 'scripts' && !contentType.includes('application/javascript') && !contentType.includes('text/javascript')) {
        contentType = 'application/javascript; charset=utf-8';
      }
      // Also check for common CSS/JS file extensions
      if (!contentType || contentType === 'application/octet-stream') {
        const pathname = urlObj.pathname.toLowerCase();
        if (pathname.endsWith('.css')) {
          contentType = 'text/css; charset=utf-8';
        } else if (pathname.endsWith('.js')) {
          contentType = 'application/javascript; charset=utf-8';
        }
      }
    } catch {
      // URL parsing failed, use original contentType
    }

    const baseCorsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept,Origin,Referer,User-Agent,X-Requested-With,Cache-Control,Pragma,Accept-Encoding,Accept-Language',
      'Access-Control-Expose-Headers': 'Content-Length,Content-Type,Date,Server,X-Powered-By',
      'Vary': 'Origin,Accept-Encoding',
    };

    function sanitizeHeaders(extra: Record<string,string> = {}){
      const headers: Record<string,string> = { ...extra };
      headers['x-content-type-options'] = 'nosniff';
      return headers;
    }

    if (contentType.includes('text/html')) {
      const html = new TextDecoder().decode(buf);
      const processed = injectHtml(html, target);
      return new NextResponse(processed, {
        status: upstream.status,
        headers: sanitizeHeaders({ 'content-type': 'text/html; charset=utf-8', ...baseCorsHeaders }),
      });
    }
    if (contentType.includes('text/css')) {
      const css = new TextDecoder().decode(buf);
      const processedCss = rewriteCssResources(css, target);
      return new NextResponse(processedCss, {
        status: upstream.status,
        headers: sanitizeHeaders({ 'content-type': 'text/css; charset=utf-8', ...baseCorsHeaders }),
      });
    }
    return new NextResponse(buf, {
      status: upstream.status,
      headers: sanitizeHeaders({ 'content-type': contentType || 'application/octet-stream', ...baseCorsHeaders }),
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Proxy error', message: String(e?.message || e) }, { status: 502 });
  }
}

export const POST_impl = handleNonGet_impl;
export const PUT_impl = handleNonGet_impl;
export const PATCH_impl = handleNonGet_impl;
export const DELETE_impl = handleNonGet_impl;


