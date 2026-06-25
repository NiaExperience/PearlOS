"use client";

import { Terminal } from "lucide-react";
import React from "react";

export default function Error() {
  return (
    <main
      className="min-h-svh w-full"
      style={{
        alignItems: "center",
        background: "#05070a",
        color: "#f4efe7",
        display: "flex",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <section
        aria-labelledby="terminal-fallback-title"
        style={{
          background: "rgba(11, 16, 18, 0.94)",
          border: "1px solid rgba(166, 199, 173, 0.32)",
          borderRadius: "8px",
          boxShadow: "0 24px 70px rgba(0, 0, 0, 0.36)",
          padding: "clamp(24px, 5vw, 40px)",
          width: "min(100%, 520px)",
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: "12px", marginBottom: "20px" }}>
          <div
            aria-hidden="true"
            style={{
              alignItems: "center",
              background: "rgba(166, 199, 173, 0.12)",
              border: "1px solid rgba(166, 199, 173, 0.38)",
              borderRadius: "8px",
              display: "flex",
              height: "42px",
              justifyContent: "center",
              width: "42px",
            }}
          >
            <Terminal size={20} color="#a6c7ad" />
          </div>
          <div>
            <p style={{ color: "#a6c7ad", fontSize: "13px", fontWeight: 650, margin: 0 }}>
              Staging recovery
            </p>
            <h1
              id="terminal-fallback-title"
              style={{
                color: "#f4efe7",
                fontSize: "clamp(28px, 7vw, 42px)",
                fontWeight: 650,
                letterSpacing: 0,
                lineHeight: 1.05,
                margin: "4px 0 0",
              }}
            >
              Open Terminal
            </h1>
          </div>
        </div>

        <p style={{ color: "rgba(244, 239, 231, 0.68)", fontSize: "16px", lineHeight: 1.6, margin: "0 0 28px" }}>
          The main interface is not loading cleanly, so this page only offers the isolated authenticated Terminal.
        </p>

        <a
          href="/terminal"
          style={{
            alignItems: "center",
            background: "#a6c7ad",
            borderRadius: "8px",
            color: "#05070a",
            display: "inline-flex",
            fontSize: "16px",
            fontWeight: 700,
            gap: "10px",
            justifyContent: "center",
            minHeight: "48px",
            padding: "12px 16px",
            textDecoration: "none",
            width: "100%",
          }}
        >
          <Terminal size={18} />
          Terminal
        </a>
      </section>
    </main>
  );
}
