"use client";

import { useEffect, useState, useCallback } from "react";

interface ServiceResult {
  name: string;
  status: "up" | "down";
  code?: number;
  error?: string;
}

interface HealthResponse {
  ts: number;
  services: ServiceResult[];
}

/**
 * Recovery page — displays real-time service health status.
 *
 * Health checks run server-side via /api/health to avoid CORS/mixed-content
 * issues that cause false negatives when fetching localhost services directly
 * from the browser.
 */
export default function RecoveryPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data: HealthResponse = await res.json();
      setHealth(data);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Failed to reach health API");
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    if (!polling) return;
    const id = setInterval(fetchHealth, 5000);
    return () => clearInterval(id);
  }, [fetchHealth, polling]);

  const allUp = health?.services.every((s) => s.status === "up");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        color: "#e0e0e0",
        fontFamily: "system-ui, -apple-system, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>
        🔧 System Recovery
      </h1>
      <p style={{ color: "#888", marginBottom: "2rem", fontSize: "0.9rem" }}>
        Real-time service health · refreshes every 5s
      </p>

      {error && (
        <div
          style={{
            background: "#2a1010",
            border: "1px solid #5a2020",
            borderRadius: 8,
            padding: "0.75rem 1.25rem",
            marginBottom: "1.5rem",
            color: "#ff6b6b",
            fontSize: "0.85rem",
          }}
        >
          ⚠️ Health API error: {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gap: "0.75rem",
          width: "100%",
          maxWidth: 420,
        }}
      >
        {health?.services.map((svc) => (
          <div
            key={svc.name}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#141414",
              border: `1px solid ${svc.status === "up" ? "#1a3a1a" : "#3a1a1a"}`,
              borderRadius: 8,
              padding: "0.75rem 1rem",
            }}
          >
            <span style={{ fontWeight: 500 }}>{svc.name}</span>
            <span
              style={{
                color: svc.status === "up" ? "#4ade80" : "#f87171",
                fontWeight: 600,
                fontSize: "0.9rem",
              }}
            >
              {svc.status === "up" ? "✅ Up" : "❌ Down"}
              {svc.code ? ` (${svc.code})` : ""}
            </span>
          </div>
        )) ??
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              style={{
                background: "#141414",
                border: "1px solid #222",
                borderRadius: 8,
                padding: "0.75rem 1rem",
                color: "#555",
              }}
            >
              Loading...
            </div>
          ))}
      </div>

      {health && (
        <p
          style={{
            marginTop: "1.5rem",
            fontSize: "0.8rem",
            color: allUp ? "#4ade80" : "#f59e0b",
          }}
        >
          {allUp
            ? "All services operational ✓"
            : `${health.services.filter((s) => s.status === "down").length} service(s) degraded`}
        </p>
      )}

      <div style={{ marginTop: "2rem", display: "flex", gap: "1rem" }}>
        <button
          onClick={fetchHealth}
          style={{
            background: "#222",
            color: "#e0e0e0",
            border: "1px solid #333",
            borderRadius: 6,
            padding: "0.5rem 1.25rem",
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
        >
          Refresh Now
        </button>
        <button
          onClick={() => setPolling((p) => !p)}
          style={{
            background: polling ? "#1a2a1a" : "#2a1a1a",
            color: polling ? "#4ade80" : "#f87171",
            border: `1px solid ${polling ? "#2a4a2a" : "#4a2a2a"}`,
            borderRadius: 6,
            padding: "0.5rem 1.25rem",
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
        >
          Auto-refresh: {polling ? "ON" : "OFF"}
        </button>
      </div>

      <p style={{ marginTop: "2rem", fontSize: "0.7rem", color: "#555" }}>
        Last check:{" "}
        {health ? new Date(health.ts).toLocaleTimeString() : "pending"}
      </p>
    </div>
  );
}
