// Client-side error reporter used by ErrorBoundary and global handlers.
// Posts to /api/report-error which logs + fans out to the team Discord.

type Severity = "info" | "warn" | "error" | "fatal";

export interface ReportErrorOptions {
  error: unknown;
  source: string;
  severity?: Severity;
  componentStack?: string;
  context?: Record<string, unknown>;
}

let installed = false;

function maybeRecoverFromStaleChunk(error: unknown): boolean {
  if (typeof window === "undefined") return false;
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
  const name = error instanceof Error ? error.name : "";
  const isChunkFailure =
    /ChunkLoadError/i.test(name) ||
    /Loading chunk \d+ failed/i.test(message) ||
    /_next\/static\/chunks\//i.test(message);
  if (!isChunkFailure) return false;

  const marker = "pearl_chunk_reloaded";
  const url = new URL(window.location.href);
  if (url.searchParams.get(marker) === "1") return false;
  url.searchParams.set(marker, "1");
  window.location.replace(url.toString());
  return true;
}

export function reportError(opts: ReportErrorOptions): void {
  try {
    const err = opts.error;
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
    const stack = err instanceof Error ? err.stack : undefined;

    const payload = {
      message,
      stack,
      componentStack: opts.componentStack,
      url: typeof window !== "undefined" ? window.location.href : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      severity: opts.severity ?? "error",
      source: opts.source,
      context: opts.context,
    };

    if (typeof fetch === "undefined") return;
    void fetch("/api/report-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Never let the reporter itself throw.
  }
}

/**
 * Install global window.onerror + unhandledrejection handlers.
 * Safe to call multiple times; only installs once.
 */
export function installGlobalErrorReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    if (maybeRecoverFromStaleChunk(event.error ?? event.message)) return;
    reportError({
      error: event.error ?? event.message,
      source: "window.onerror",
      severity: "error",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (maybeRecoverFromStaleChunk(event.reason)) return;
    reportError({
      error: event.reason,
      source: "unhandledrejection",
      severity: "error",
    });
  });
}
