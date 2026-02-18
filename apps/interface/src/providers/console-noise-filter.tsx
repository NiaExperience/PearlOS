"use client";

import { useEffect } from 'react';

import { getClientLogger } from '../lib/client-logger';

/**
 * ConsoleNoiseFilter suppresses specific, known-benign console errors that clutter the browser console.
 * Current filters:
 *  - Daily.co SDK benign errors when a meeting ends normally (ejection or ended messages)
 *  - Daily.co audio processor warnings for unsupported browser features (noise cancellation)
 *  - Daily.co Krisp processor cleanup errors during rapid call teardown (WASM_OR_WORKER_NOT_READY)
 *  - Daily.co SFU switch timeout errors for cloud recording (infrastructure connectivity issues)
 *
 * The filter is intentionally narrow to avoid hiding real issues. If any arg matches a pattern,
 * the console.error call is dropped; otherwise it's forwarded to the original implementation.
 */
export function ConsoleNoiseFilter() {
  useEffect(() => {
    const logger = getClientLogger('[console-noise-filter]');
    const consoleObj = globalThis.console;
    const originalError = consoleObj?.error?.bind(consoleObj);

    // Toggle via env if needed; default to enabled
    const enabled = (process.env.NEXT_PUBLIC_SQUELCH_BENIGN_ERRORS ?? 'true').toLowerCase() !== 'false';

    if (!enabled) return;

    const patterns: RegExp[] = [
      /Meeting ended due to ejection/i,
      /Meeting has ended/i,
      /Ignoring settings for browser- or platform-unsupported input processor\(s\): audio/i,
      /Error unloading krisp processor.*WASM_OR_WORKER_NOT_READY/i,
      /timed out waiting for forced switch to sfu/i,
    ];

    function shouldSuppress(args: unknown[]): boolean {
      try {
        for (const arg of args) {
          const text = typeof arg === 'string'
            ? arg
            : arg instanceof Error
              ? `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`
              : typeof arg === 'object'
                ? JSON.stringify(arg)
                : String(arg);
          if (patterns.some((re) => re.test(text))) return true;
        }
      } catch {
        // Never block logging due to filter failure
      }
      return false;
    }

    // Wrap console.error
    if (!consoleObj?.error) return;

    consoleObj.error = (...args: unknown[]) => {
      if (shouldSuppress(args)) {
        logger.debug('Suppressed benign console.error');
        return; // swallow known-benign noise
      }

      // Log structured summary without dumping raw args to avoid PII leaks
      logger.error('Console error passthrough', {
        argTypes: args.map((arg) => typeof arg),
        hasErrorObject: args.some((arg) => arg instanceof Error),
      });

      if (originalError) {
        return originalError(...args);
      }
    };

    return () => {
      if (originalError && consoleObj) {
        consoleObj.error = originalError;
      }
    };
  }, []);

  return null;
}
