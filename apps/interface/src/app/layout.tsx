import { isFeatureEnabled } from '@nia/features';

import { GlobalHtmlGenerationStatus } from '@interface/features/HtmlGeneration/components/GlobalHtmlGenerationStatus';
import { ActiveJobsWidgetGate } from '@interface/features/ActiveJobs/components/ActiveJobsWidgetGate';
import 'reflect-metadata';
import './globals.css';

import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';

import { Toaster } from '@interface/components/ui/toaster';
import { DisableTabNavigation } from '@interface/components/disable-tab-navigation';
import { ErrorBoundary } from '@interface/components/ErrorBoundary';
// Rive avatar removed — GIF only per Blair directive 2026-02-24

import { LabModeBanner } from '@interface/components/LabModeBanner';
import { Providers } from './providers';

const appFont = localFont({
  src: '../../public/fonts/DMSans-VariableFont_opsz,wght.ttf',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PearlOS',
  description: 'PearlOS — Your Intelligent Desktop',
};

// PearlOS is a fixed-viewport PWA-style app. We export `viewport` here so Next.js
// emits a SINGLE viewport meta tag with our locked values. If you instead place
// `<meta name="viewport">` inside <head> JSX, Next.js *also* injects its own
// default `width=device-width, initial-scale=1` later in the DOM, and the second
// tag wins on iOS — the symptom is iOS Safari ignoring `maximum-scale=1` and
// auto-zooming on input focus, which then bleeds into the home screen after
// redirect. Owning viewport via the export is the only way to suppress the
// auto-injected default.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning on <html> and <body>: browser extensions (e.g. password
  // managers, translators) can inject attributes/elements, causing hydration mismatches
  // on mobile Safari and other browsers. This is a standard Next.js safety net.

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/backgrounds/home-sunset.png" as="image" />
        <link rel="preload" href="/backgrounds/desktop-forest.png" as="image" />
        {/* Viewport lock is now declared via `export const viewport` above.
            Do NOT re-add a <meta name="viewport"> here — Next.js will then emit
            two viewport tags and the second one (its auto-default) wins on iOS,
            which is exactly what was breaking the input-focus zoom behaviour. */}
        {/* PWA install path (Add to Home Screen) — drops Safari chrome when launched from
            home screen. Harmless inside a normal Safari tab. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {/* Prevents iOS from auto-linking phone numbers, which causes layout/style artifacts */}
        <meta name="format-detection" content="telephone=no" />
        {/* --vh fallback for browsers without dvh support (pre-iOS 15.4). Modern browsers
            ignore this and use the 100dvh declaration in globals.css. Runs early to avoid
            FOUC where the layout briefly resolves to an unintended height. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                function setVh() {
                  document.documentElement.style.setProperty(
                    '--vh',
                    (window.innerHeight * 0.01) + 'px'
                  );
                }
                setVh();
                window.addEventListener('resize', setVh, { passive: true });
                window.addEventListener('orientationchange', setVh, { passive: true });
              })();
            `,
          }}
        />
        {/* One-time per-build cache wipe. Runs BEFORE React hydration so the
            synchronous localStorage seed in useChatSession can't pull stale
            chat history forward from a previous build (e.g. HORIZON → JINX).
            Marker key 'pearl-build-migration' stores the BUILD_ID it ran for;
            bumping BUILD_ID on the next deploy re-arms the wipe automatically. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var BUILD_ID = 'PARIS SILVER';
                  var MARKER = 'pearl-build-migration';
                  if (typeof localStorage === 'undefined') return;
                  if (localStorage.getItem(MARKER) === BUILD_ID) return;
                  var prefixes = [
                    'pearl-chat-history-',
                    'daily-chat-messages',
                    'nia_pending_job_',
                    'nia_active_html_generations',
                    'pearlos_discord_messages',
                    'pearlos_discord_channels',
                    'pearlos_discord_status'
                  ];
                  var lsKeys = [];
                  for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (!k) continue;
                    for (var j = 0; j < prefixes.length; j++) {
                      if (k === prefixes[j] || k.indexOf(prefixes[j]) === 0) {
                        lsKeys.push(k);
                        break;
                      }
                    }
                  }
                  lsKeys.forEach(function(k) { try { localStorage.removeItem(k); } catch (e) {} });
                  var ssKeys = [
                    'dailySharedRoomUrl', 'dailySharedAssistant', 'dailySharedIntent',
                    'dailySharedMode', 'dailyRoomUrl', 'sessionUserId', 'callId'
                  ];
                  if (typeof sessionStorage !== 'undefined') {
                    ssKeys.forEach(function(k) { try { sessionStorage.removeItem(k); } catch (e) {} });
                  }
                  if (window.indexedDB && typeof indexedDB.databases === 'function') {
                    indexedDB.databases().then(function(dbs) {
                      (dbs || []).forEach(function(db) {
                        if (db && db.name && /chat|conversation|message|pearl|nia/i.test(db.name)) {
                          try { indexedDB.deleteDatabase(db.name); } catch (e) {}
                        }
                      });
                    }).catch(function() {});
                  }
                  localStorage.setItem(MARKER, BUILD_ID);
                  console.info('[pearl-build-migration]', BUILD_ID, 'cleared', lsKeys.length, 'localStorage keys');
                } catch (e) {
                  // Migration is best-effort: never block boot.
                }
              })();
            `,
          }}
        />
        {/* Dynamic page title with EST time + date + build ID */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                function updateTitle() {
                  var now = new Date();
                  var est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                  var month = (est.getMonth()+1).toString().padStart(2,'0');
                  var day = est.getDate().toString().padStart(2,'0');
                  var h = est.getHours().toString().padStart(2,'0');
                  var m = est.getMinutes().toString().padStart(2,'0');
                  document.title = 'PearlOS | ' + month + '/' + day + ' ' + h + ':' + m + ' EST';
                }
                updateTitle();
                // Re-assert after hydration overwrites title, then settle to 30s
                setTimeout(updateTitle, 1000);
                setTimeout(updateTitle, 3000);
                setTimeout(updateTitle, 5000);
                setTimeout(updateTitle, 10000);
                setInterval(updateTitle, 30000);
              })();
            `,
          }}
        />
        {/* Last-line zoom defense: block iOS Safari gesture events and any
            multi-touch on the document. The viewport meta + touch-action CSS
            should already prevent pinch-zoom, but iframe srcDocs that inject
            their own viewport tag have repeatedly regressed this. Capturing
            gesture/touch events at the document level catches the leak. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var stop = function(e) { if (e && e.preventDefault) e.preventDefault(); };
                document.addEventListener('gesturestart', stop, { passive: false });
                document.addEventListener('gesturechange', stop, { passive: false });
                document.addEventListener('gestureend', stop, { passive: false });
                document.addEventListener('touchstart', function(e) {
                  if (e.touches && e.touches.length > 1) e.preventDefault();
                }, { passive: false });
                document.addEventListener('touchmove', function(e) {
                  if (e.touches && e.touches.length > 1) e.preventDefault();
                }, { passive: false });
                document.addEventListener('wheel', function(e) {
                  if (e.ctrlKey) e.preventDefault();
                }, { passive: false });
                document.addEventListener('dblclick', stop, { passive: false });
              })();
            `,
          }}
        />
        {/* iOS persistent-zoom defeat. Even with every input pinned to 16px and
            user-scalable=no in the viewport meta, iOS Safari can still hold a
            zoomed scale state across SPA navigations — the symptom is "I tapped
            the login field, page zoomed, then after redirect the home screen
            renders with its chrome off-screen." The fix is to force iOS to
            re-parse the viewport meta on every input blur and every route
            change, which commits scale back to 1 before the next paint.
            We toggle the content string (adding minimum-scale=1) and restore
            it on the next frame; iOS treats the change as a reflow trigger.
            Uses pushState/replaceState wrapping because Next.js App Router
            client navigations don't fire popstate. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var CANONICAL = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
                function resetViewport() {
                  var meta = document.querySelector('meta[name="viewport"]');
                  if (!meta) return;
                  meta.setAttribute('content', CANONICAL + ', minimum-scale=1');
                  if (typeof requestAnimationFrame === 'function') {
                    requestAnimationFrame(function() {
                      meta.setAttribute('content', CANONICAL);
                    });
                  } else {
                    setTimeout(function() { meta.setAttribute('content', CANONICAL); }, 16);
                  }
                }
                document.addEventListener('focusout', function(e) {
                  var t = e.target;
                  if (!t || !t.tagName) return;
                  var tag = t.tagName.toLowerCase();
                  var ed = t.getAttribute && t.getAttribute('contenteditable');
                  if (tag === 'input' || tag === 'textarea' || tag === 'select' || ed === 'true' || ed === '') {
                    resetViewport();
                  }
                }, true);
                try {
                  var origPush = history.pushState;
                  history.pushState = function() {
                    var r = origPush.apply(this, arguments);
                    resetViewport();
                    return r;
                  };
                  var origReplace = history.replaceState;
                  history.replaceState = function() {
                    var r = origReplace.apply(this, arguments);
                    resetViewport();
                    return r;
                  };
                } catch (e) { /* history wrapping is best-effort */ }
                window.addEventListener('popstate', resetViewport);
                window.addEventListener('pageshow', function(e) {
                  if (e.persisted) resetViewport();
                });
                window.__pearlResetViewport = resetViewport;
              })();
            `,
          }}
        />
        {/* Service worker cleanup - unregister any legacy service workers */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(function(registrations) {
                  for (let registration of registrations) {
                    registration.unregister().then(function(success) {
                      if (success) console.log('Unregistered legacy service worker');
                    });
                  }
                });
              }
              if ('caches' in window) {
                caches.keys().then(function(keys) {
                  return Promise.all(keys.map(function(key) { return caches.delete(key); }));
                }).catch(function() {});
              }
            `,
          }}
        />
        {/* Earliest possible stale Next chunk recovery, before React mounts */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                function isChunkFailure(value) {
                  var message = '';
                  try {
                    if (typeof value === 'string') message = value;
                    else if (value && value.message) message = value.message;
                    else message = JSON.stringify(value);
                  } catch (e) {}
                  return /ChunkLoadError/i.test(message) ||
                    /Loading chunk [0-9]+ failed/i.test(message) ||
                    /failed to fetch dynamically imported module/i.test(message) ||
                    /_next\\/static\\/chunks\\//i.test(message);
                }
                function recover(value) {
                  if (!isChunkFailure(value)) return false;
                  try {
                    var url = new URL(window.location.href);
                    if (url.searchParams.get('pearl_chunk_reloaded') === '1') return false;
                    url.searchParams.set('pearl_chunk_reloaded', '1');
                    var cleanup = [];
                    if ('serviceWorker' in navigator) {
                      cleanup.push(navigator.serviceWorker.getRegistrations().then(function(registrations) {
                        return Promise.all(registrations.map(function(registration) { return registration.unregister(); }));
                      }));
                    }
                    if ('caches' in window) {
                      cleanup.push(caches.keys().then(function(keys) {
                        return Promise.all(keys.map(function(key) { return caches.delete(key); }));
                      }));
                    }
                    Promise.allSettled(cleanup).finally(function() {
                      window.location.replace(url.toString());
                    });
                    return true;
                  } catch (e) {
                    return false;
                  }
                }
                window.addEventListener('error', function(event) {
                  var target = event && event.target;
                  var src = target && (target.src || target.href);
                  if (recover(event.error || event.message || src)) {
                    event.preventDefault();
                  }
                }, true);
                window.addEventListener('unhandledrejection', function(event) {
                  if (recover(event.reason)) {
                    event.preventDefault();
                  }
                });
              })();
            `,
          }}
        />
      </head>
      <body className={appFont.className} suppressHydrationWarning>
        <Providers>
          <LabModeBanner />
          <DisableTabNavigation />
          <Toaster />
          <GlobalHtmlGenerationStatus />
          <ActiveJobsWidgetGate />
          {children}
          {/* GIF-based avatar is rendered inline in ChatMode.tsx */}
        </Providers>
      </body>
    </html>
  );
}
