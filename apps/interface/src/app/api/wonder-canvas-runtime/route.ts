import { NextResponse } from 'next/server';

/**
 * Serves the Wonder Canvas runtime HTML as a real page.
 * 
 * iOS Safari restricts network requests (images, fonts, etc.) from srcdoc
 * iframes — even with permissive sandbox and CSP. Serving the runtime from
 * a real route gives the iframe a proper origin, fixing external image loading.
 * 
 * The HTML is injected via a query parameter (base64-encoded) or, if absent,
 * returns the static runtime shell that listens for postMessage scenes.
 * 
 * Uses Edge Runtime for fast cold starts (no heavy Node.js module loading).
 */

// Import the runtime HTML from the renderer to keep it DRY
// We re-export it here as a served page
import { WONDER_RUNTIME_HTML } from '@interface/features/Stage/WonderCanvas/wonder-canvas-runtime';

export const runtime = 'edge';

export async function GET() {
  return new NextResponse(WONDER_RUNTIME_HTML, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      // No CSP header — the HTML has its own permissive meta CSP
    },
  });
}
