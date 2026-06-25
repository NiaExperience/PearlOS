'use client';

import { CloudSun, Droplets, MapPin, RefreshCw, Search, ThermometerSun, Wind } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

type ForecastDay = {
  label: string;
  condition: string;
  highF?: number;
  lowF?: number;
};

type WeatherSnapshot = {
  location: string;
  condition: string;
  temperatureF?: number;
  feelsLikeF?: number;
  humidityPct?: number;
  windMph?: number;
  forecast: ForecastDay[];
};

type WeatherViewProps = {
  initialLocation?: string;
  initialWeather?: unknown;
};

const DATA_KEY = 'pearlos_weather_data_v2';
const LOCATION_KEY = 'pearlos_weather_location';
const COORD_KEY = 'pearlos_weather_coords';
const CACHE_TTL_MS = 15 * 60 * 1000;

function asNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function weatherIcon(condition: string): string {
  const text = condition.toLowerCase();
  if (text.includes('thunder') || text.includes('storm')) return 'TH';
  if (text.includes('snow') || text.includes('sleet')) return 'SN';
  if (text.includes('rain') || text.includes('drizzle') || text.includes('shower')) return 'RN';
  if (text.includes('fog') || text.includes('mist') || text.includes('haze')) return 'FG';
  if (text.includes('cloud') || text.includes('overcast')) return 'CL';
  if (text.includes('clear') || text.includes('sun')) return 'SUN';
  return 'WX';
}

function dayLabel(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return raw.slice(5) || raw;
  return parsed.toLocaleDateString(undefined, { weekday: 'short' });
}

function nestedText(value: unknown): string {
  if (Array.isArray(value)) return nestedText(value[0]);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return String(record.value || record.text || '').trim();
  }
  return String(value || '').trim();
}

function snapshotFromBot(value: unknown): WeatherSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const current = record.current as Record<string, unknown> | undefined;
  if (!current || typeof current !== 'object') return null;
  const forecast = Array.isArray(record.forecast)
    ? record.forecast.map((item) => {
        const day = item as Record<string, unknown>;
        return {
          label: dayLabel(day.date),
          condition: String(day.condition || 'Forecast'),
          highF: asNumber(day.high_f),
          lowF: asNumber(day.low_f),
        };
      })
    : [];
  return {
    location: String(record.location || 'Weather'),
    condition: String(current.condition || 'Current conditions'),
    temperatureF: asNumber(current.temperature_f),
    feelsLikeF: asNumber(current.feels_like_f),
    humidityPct: asNumber(current.humidity_pct),
    windMph: asNumber(current.wind_mph),
    forecast,
  };
}

function snapshotFromWttr(data: unknown, fallbackLocation = 'Weather'): WeatherSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const current = Array.isArray(record.current_condition) ? record.current_condition[0] as Record<string, unknown> : undefined;
  if (!current) return null;
  const nearestArea = Array.isArray(record.nearest_area) ? record.nearest_area[0] as Record<string, unknown> : undefined;
  const area = nearestArea ? nestedText(nearestArea.areaName) : '';
  const region = nearestArea ? nestedText(nearestArea.region) : '';
  const country = nearestArea ? nestedText(nearestArea.country) : '';
  const location = [area, region, country].filter(Boolean).join(', ') || fallbackLocation;
  const forecast = Array.isArray(record.weather)
    ? record.weather.slice(0, 5).map((item) => {
        const day = item as Record<string, unknown>;
        const hourly = Array.isArray(day.hourly) ? day.hourly[4] as Record<string, unknown> || day.hourly[0] as Record<string, unknown> : undefined;
        return {
          label: dayLabel(day.date),
          condition: nestedText(hourly?.weatherDesc) || 'Forecast',
          highF: asNumber(day.maxtempF),
          lowF: asNumber(day.mintempF),
        };
      })
    : [];
  return {
    location,
    condition: nestedText(current.weatherDesc) || 'Current conditions',
    temperatureF: asNumber(current.temp_F),
    feelsLikeF: asNumber(current.FeelsLikeF),
    humidityPct: asNumber(current.humidity),
    windMph: asNumber(current.windspeedMiles),
    forecast,
  };
}

function readSavedLocation(): string {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { q?: string };
    return typeof parsed.q === 'string' ? parsed.q : '';
  } catch {
    return '';
  }
}

function readCachedSnapshot(): WeatherSnapshot | null {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { _data?: unknown; _ts?: number };
    if (!parsed._data || !parsed._ts || Date.now() - parsed._ts > CACHE_TTL_MS) return null;
    return snapshotFromWttr(parsed._data);
  } catch {
    return null;
  }
}

function saveWeatherData(data: unknown): void {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify({ _data: data, _ts: Date.now() }));
  } catch {
    // Ignore private browsing/storage failures.
  }
}

function saveLocation(query: string): void {
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify({ q: query, ts: Date.now() }));
  } catch {
    // Ignore storage failures.
  }
}

export default function WeatherView({ initialLocation, initialWeather }: WeatherViewProps) {
  const initialSnapshot = useMemo(() => snapshotFromBot(initialWeather), [initialWeather]);
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(() => initialSnapshot || readCachedSnapshot());
  const [query, setQuery] = useState(initialLocation || initialSnapshot?.location || readSavedLocation());
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(snapshot ? 'Current conditions loaded.' : 'Choose a location or allow browser location.');
  const [error, setError] = useState('');

  const fetchWeather = useCallback(async (options: { q?: string; lat?: number; lng?: number }) => {
    const params = new URLSearchParams();
    if (options.q) params.set('q', options.q);
    if (options.lat != null && options.lng != null) {
      params.set('lat', options.lat.toFixed(4));
      params.set('lng', options.lng.toFixed(4));
    }
    if (!params.toString()) return false;
    setLoading(true);
    setError('');
    setStatus(options.q ? `Fetching weather for ${options.q}...` : 'Fetching local weather...');
    try {
      const response = await fetch(`/api/weather?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || data?.error || `Weather request failed (${response.status})`);
      const next = snapshotFromWttr(data, options.q || 'Weather');
      if (!next) throw new Error('Weather data was not readable.');
      setSnapshot(next);
      setQuery(options.q || next.location);
      if (options.q) saveLocation(options.q);
      saveWeatherData(data);
      setStatus(data?._cached ? 'Loaded from weather cache.' : 'Live weather updated.');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Weather unavailable.');
      setStatus('Weather unavailable.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialSnapshot) return;
    const saved = initialLocation || readSavedLocation();
    if (saved) {
      void fetchWeather({ q: saved });
      return;
    }
    if (!navigator.geolocation) return;
    const timer = window.setTimeout(() => {
      setStatus('Choose a city or ZIP code.');
    }, 2400);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timer);
        try {
          localStorage.setItem(COORD_KEY, JSON.stringify({
            lat: position.coords.latitude.toFixed(4),
            lng: position.coords.longitude.toFixed(4),
            ts: Date.now(),
          }));
        } catch {
          // Ignore storage failures.
        }
        void fetchWeather({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      () => {
        window.clearTimeout(timer);
        setStatus('Choose a city or ZIP code.');
      },
      { timeout: 2200, maximumAge: 300000 },
    );
    return () => window.clearTimeout(timer);
  }, [fetchWeather, initialLocation, initialSnapshot]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const next = query.trim();
    if (!next) {
      setError('Enter a city or ZIP code.');
      return;
    }
    void fetchWeather({ q: next });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#071013] text-[var(--pearl-text,#faf8f5)]" data-testid="weather-app">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#0b171a] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#f1c95a] text-[#0b171a]">
            <CloudSun size={20} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Weather</div>
            <div className="truncate text-xs text-white/55">{status}</div>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/12 bg-white/5 text-white/75 hover:bg-white/10"
          aria-label="Refresh weather"
          onClick={() => {
            const next = query.trim();
            if (next) void fetchWeather({ q: next });
          }}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <form onSubmit={submitSearch} className="flex shrink-0 gap-2 border-b border-white/10 bg-[#0f2024] p-3">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="City or ZIP code"
            className="h-10 w-full rounded-md border border-white/12 bg-black/20 pl-9 pr-3 text-sm outline-none placeholder:text-white/35 focus:border-[#f1c95a]"
          />
        </div>
        <button
          type="submit"
          className="h-10 rounded-md bg-[#f1c95a] px-4 text-sm font-semibold text-[#071013] hover:bg-[#ffd86f] disabled:opacity-60"
          disabled={loading}
        >
          Search
        </button>
      </form>

      {error && (
        <div className="shrink-0 border-b border-[#ff7a90]/25 bg-[#40151d] px-4 py-2 text-xs text-[#ffd8de]">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {snapshot ? (
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-md border border-white/10 bg-[#102227] p-5">
                <div className="mb-6 flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-white/50">
                  <MapPin size={14} />
                  <span className="truncate">{snapshot.location}</span>
                </div>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-[72px] font-semibold leading-none tracking-normal text-white">
                      {snapshot.temperatureF != null ? Math.round(snapshot.temperatureF) : '--'}<span className="text-3xl text-white/45">F</span>
                    </div>
                    <div className="mt-3 text-xl font-medium text-[#f1c95a]">{snapshot.condition}</div>
                  </div>
                  <div className="hidden h-24 w-24 items-center justify-center rounded-md bg-[#183941] text-2xl font-semibold text-[#8ee7f0] sm:flex">
                    {weatherIcon(snapshot.condition)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Metric icon={<ThermometerSun size={18} />} label="Feels" value={snapshot.feelsLikeF != null ? `${Math.round(snapshot.feelsLikeF)}F` : '--'} />
                <Metric icon={<Droplets size={18} />} label="Humidity" value={snapshot.humidityPct != null ? `${Math.round(snapshot.humidityPct)}%` : '--'} />
                <Metric icon={<Wind size={18} />} label="Wind" value={snapshot.windMph != null ? `${Math.round(snapshot.windMph)} mph` : '--'} />
              </div>
            </section>

            <section className="rounded-md border border-white/10 bg-[#0e1c20] p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">Five Day Forecast</div>
              <div className="grid gap-2 sm:grid-cols-5">
                {snapshot.forecast.slice(0, 5).map((day) => (
                  <div key={`${day.label}-${day.condition}`} className="rounded-md border border-white/8 bg-white/[0.04] p-3">
                    <div className="text-sm font-semibold text-white">{day.label || 'Day'}</div>
                    <div className="mt-2 text-xs leading-snug text-white/55">{day.condition}</div>
                    <div className="mt-4 flex items-center justify-between text-sm">
                      <span className="text-white">{day.highF != null ? `${Math.round(day.highF)}F` : '--'}</span>
                      <span className="text-white/45">{day.lowF != null ? `${Math.round(day.lowF)}F` : '--'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="flex h-full min-h-[280px] items-center justify-center rounded-md border border-white/10 bg-[#0e1c20] p-8 text-center text-sm text-white/55">
            Search for a city or ZIP code to load weather.
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-[#102227] p-4">
      <div className="mb-4 text-[#8ee7f0]">{icon}</div>
      <div className="text-lg font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.12em] text-white/45">{label}</div>
    </div>
  );
}
