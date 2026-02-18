'use client';

import { useCallback, useEffect, useState } from 'react';

type ConnectionStatus = 'unknown' | 'checking' | 'connected' | 'disconnected';

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  unknown: '#888',
  checking: '#f0ad4e',
  connected: '#5cb85c',
  disconnected: '#d9534f',
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  unknown: 'OpenClaw: Unknown',
  checking: 'OpenClaw: Checking…',
  connected: 'OpenClaw: Connected',
  disconnected: 'OpenClaw: Offline',
};

interface OpenClawStatusProps {
  /** Override the bridge API URL (defaults to env) */
  apiUrl?: string;
  /** Poll interval in ms (0 = no polling, default 60000) */
  pollInterval?: number;
  /** Compact dot-only mode */
  compact?: boolean;
}

export function OpenClawStatus({
  apiUrl,
  pollInterval = 60_000,
  compact = false,
}: OpenClawStatusProps) {
  const [status, setStatus] = useState<ConnectionStatus>('unknown');

  // NEXT_PUBLIC_ env vars are available on both server and client,
  // so no need for typeof window check (which causes hydration mismatch)
  const baseUrl =
    apiUrl ?? process.env.NEXT_PUBLIC_OPENCLAW_API_URL ?? 'http://localhost:3100';

  const check = useCallback(async () => {
    if (!baseUrl) return;
    setStatus('checking');
    try {
      const res = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      setStatus(res.ok ? 'connected' : 'disconnected');
    } catch {
      setStatus('disconnected');
    }
  }, [baseUrl]);

  useEffect(() => {
    check();
    if (pollInterval > 0) {
      const id = setInterval(check, pollInterval);
      return () => clearInterval(id);
    }
  }, [check, pollInterval]);

  const color = STATUS_COLORS[status];

  if (compact) {
    return (
      <span
        title={STATUS_LABELS[status]}
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: color,
        }}
      />
    );
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color,
        fontFamily: 'monospace',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: color,
        }}
      />
      {STATUS_LABELS[status]}
    </div>
  );
}
