import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/weather — Server-side weather proxy with in-memory cache.
 *
 * Fetches from wttr.in server-side (no CORS issues from the iframe).
 * Caches results for 15 minutes keyed by lat/lng or named location.
 *
 * Usage:
 *   GET /api/weather?q=Boston           — Named location
 *   GET /api/weather?lat=28.5&lng=-81.4 — Coordinate-based weather
 */

interface CacheEntry {
  data: unknown;
  fetchedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes (longer TTL to survive wttr.in slowness)

// Simple in-memory cache — keyed by rounded coordinates or named location.
const cache = new Map<string, CacheEntry>();

function makeCacheKey(lat?: string | null, lng?: string | null, q?: string): string {
  if (q) return `q:${q.toLowerCase()}`;
  if (lat && lng) {
    // Round to 2 decimal places so nearby coords share cache
    const rLat = parseFloat(lat).toFixed(2);
    const rLng = parseFloat(lng).toFixed(2);
    return `${rLat},${rLng}`;
  }
  return '';
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
    const q = (searchParams.get('q') || searchParams.get('location') || '').trim();
    const hasLatLng = lat !== null && lng !== null;
    const latNumber = lat !== null ? Number(lat) : NaN;
    const lngNumber = lng !== null ? Number(lng) : NaN;

    if (!q && !hasLatLng) {
      return NextResponse.json(
        { error: 'location_required', message: 'Choose a city, ZIP code, or allow location access to view weather.' },
        { status: 400 }
      );
    }

    if (hasLatLng && (!Number.isFinite(latNumber) || !Number.isFinite(lngNumber))) {
      return NextResponse.json(
        { error: 'invalid_coordinates', message: 'Latitude and longitude must be valid numbers.' },
        { status: 400 }
      );
    }

    const cacheKey = makeCacheKey(lat, lng, q);

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
    if (q) {
      wttrUrl = `https://wttr.in/${encodeURIComponent(q)}?format=j1`;
    } else if (lat && lng) {
      wttrUrl = `https://wttr.in/${encodeURIComponent(lat)},${encodeURIComponent(lng)}?format=j1`;
    } else {
      return NextResponse.json(
        { error: 'location_required', message: 'Choose a city, ZIP code, or allow location access to view weather.' },
        { status: 400 }
      );
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
