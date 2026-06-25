import { NextResponse } from 'next/server';

/**
 * Explicit favicon.ico route to prevent the [assistantId] catch-all from
 * intercepting browser favicon requests and attempting to auto-create an
 * assistant named "favicon.ico".
 * 
 * Returns a 204 No Content. To serve an actual favicon, place a .ico file
 * in /public/favicon.ico and remove this route.
 */
// Edge Runtime: return a minimal 1x1 transparent PNG (125 bytes) so the
// browser gets a valid binary favicon instead of hitting a 204 No Content
// which Next.js route handlers refuse to serialize ("Invalid response status code 204").
const TRANSPARENT_1PX_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const buffer = Buffer.from(TRANSPARENT_1PX_PNG_BASE64, "base64");

export function GET() {
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
