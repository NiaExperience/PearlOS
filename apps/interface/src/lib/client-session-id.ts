"use client";

// Temporarily disabled client-side session id handling to avoid propagating
// custom headers to third-party services (e.g., Daily CORS preflight issues).
// Keep no-op helpers so existing imports remain safe during the rollback.

export function getClientSessionId(): string {
  return '';
}

export function withClientSessionIdHeader(init?: RequestInit): RequestInit {
  return init ?? {};
}

export function ensureFetchPatched(): void {
  // intentionally no-op
}
