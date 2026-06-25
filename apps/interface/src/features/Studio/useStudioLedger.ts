"use client";

import { useCallback, useEffect, useState } from "react";
import type { StudioLedgerItem } from "@interface/lib/studio-ledger";

interface StudioLedgerState {
  items: StudioLedgerItem[];
  loading: boolean;
  error: string | null;
}

/**
 * Loads the signed-in user's personal PearlOS change ledger. This is read-only
 * in the UI — items are written by the worker as it applies changes, never by
 * the client. There is no "run" action; each item is an already-applied change
 * or a parked artifact awaiting review.
 */
export function useStudioLedger() {
  const [state, setState] = useState<StudioLedgerState>({ items: [], loading: true, error: null });

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch("/api/interface-customization/ledger", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(typeof json?.error === "string" ? json.error : `Request failed (${res.status})`);
      }
      const items = Array.isArray(json.ledger) ? (json.ledger as StudioLedgerItem[]) : [];
      setState({ items, loading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Could not load your changes.",
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
