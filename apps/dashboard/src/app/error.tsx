"use client";

import React from "react";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ padding: 32, textAlign: "center" }}>
      <h1>Something went wrong</h1>
      <p>{error?.message || "An unexpected error occurred."}</p>
      <button onClick={() => reset()} style={{ marginTop: 16 }}>
        Try again
      </button>
    </div>
  );
} 