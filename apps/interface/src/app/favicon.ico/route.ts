import { NextResponse } from 'next/server';

/**
 * Explicit favicon.ico route to prevent the [assistantId] catch-all from
 * intercepting browser favicon requests and attempting to auto-create an
 * assistant named "favicon.ico".
 * 
 * Returns a 204 No Content. To serve an actual favicon, place a .ico file
 * in /public/favicon.ico and remove this route.
 */
export function GET() {
  return new NextResponse(null, { status: 204 });
}
