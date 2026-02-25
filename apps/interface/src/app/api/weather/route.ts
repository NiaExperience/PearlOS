import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/weather — Server-side weather proxy with in-memory cache.
 *
 * Fetches from wttr.in server-side (no CORS issues from the iframe).
 * Caches results for 10 minutes keyed by lat/lng or "ip" for IP-based.
 *
 * Usage:
 *   GET /api/weather                    — IP-based location (fallback)
 *   GET /api/weather?lat=28.5&lng=-81.4 — Coordinate-based weather
 */

interface CacheEntry {
  data: unknown;
  fetchedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes (longer TTL to survive wttr.in slowness)

// Simple in-memory cache — keyed by rounded coordinates or "ip"
const cache = new Map<string, CacheEntry>();

function makeCacheKey(lat?: string | null, lng?: string | null): string {
  if (lat && lng) {
    // Round to 2 decimal places so nearby coords share cache
    const rLat = parseFloat(lat).toFixed(2);
    const rLng = parseFloat(lng).toFixed(2);
    return `${rLat},${rLng}`;
  }
  return 'ip';
}

function getCached(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');

    const cacheKey = makeCacheKey(lat, lng);

    // Check cache first
    const cached = getCached(cacheKey);
    if (cached) {
      return NextResponse.json({
        ...cached.data as Record<string, unknown>,
        _cached: true,
        _fetchedAt: cached.fetchedAt,
      }, {
        headers: {
          'Cache-Control': 'public, max-age=300',
          'X-Weather-Cache': 'HIT',
        },
      });
    }

    // Build wttr.in URL
    let wttrUrl: string;
    if (lat && lng) {
      wttrUrl = `https://wttr.in/${encodeURIComponent(lat)},${encodeURIComponent(lng)}?format=j1`;
    } else {
      wttrUrl = 'https://wttr.in/?format=j1';
    }

    const response = await fetch(wttrUrl, {
      headers: {
        'User-Agent': 'PearlOS-Weather/1.0',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(5000), // 5s — fail fast, don't block the client
    });

    if (!response.ok) {
      throw new Error(`wttr.in responded with ${response.status}`);
    }

    const data = await response.json();

    // Store in cache
    const fetchedAt = Date.now();
    cache.set(cacheKey, { data, fetchedAt });

    // Prune old cache entries (keep max 50)
    if (cache.size > 50) {
      const keys = Array.from(cache.keys());
      for (let i = 0; i < keys.length - 50; i++) {
        cache.delete(keys[i]);
      }
    }

    return NextResponse.json({
      ...data,
      _cached: false,
      _fetchedAt: fetchedAt,
    }, {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'X-Weather-Cache': 'MISS',
      },
    });
  } catch (error) {
    console.error('[weather] Error fetching weather data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch weather data', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 502 }
    );
  }
}
