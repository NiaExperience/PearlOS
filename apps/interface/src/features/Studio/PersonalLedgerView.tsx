"use client";

import React from "react";
import { AlertCircle, Compass, Loader2, RefreshCw } from "lucide-react";
import { useStudioLedger } from "./useStudioLedger";
import LedgerItemCard from "./components/LedgerItemCard";
import StudioToolsRow from "./components/StudioToolsRow";

/**
 * The Studio's personal change list: every PearlOS feature/change Pearl applied
 * for this account, itemized read-only. No play button — each item is an applied
 * change or a parked artifact, surfaced by status, summary, artifact, and Share.
 */
const PersonalLedgerView: React.FC = () => {
  const { items, loading, error, refresh } = useStudioLedger();

  return (
    <main className="pearl-themed-app flex h-full min-h-0 flex-col overflow-hidden">
      <header className="pearl-themed-app-surface flex flex-shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="pearl-themed-app-muted flex items-center gap-2 text-[11px] uppercase tracking-[0.1em]">
            <Compass size={14} />
            The Studio
          </div>
          <h2 className="mt-0.5 truncate text-base font-semibold leading-tight">Your PearlOS changes</h2>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="pearl-themed-app-panel inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border hover:opacity-90"
          aria-label="Refresh your changes"
          title="Refresh your changes"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
        <div className="mb-4">
          <StudioToolsRow />
        </div>

        {error ? (
          <div className="mb-3 flex items-center gap-2 rounded border border-red-400/25 bg-red-950/30 px-3 py-2 text-[11px] text-red-100">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        ) : null}

        {loading && items.length === 0 ? (
          <div className="pearl-themed-app-muted flex h-32 items-center justify-center gap-2 text-sm">
            <Loader2 size={16} className="animate-spin" />
            Loading your changes…
          </div>
        ) : items.length === 0 && !error ? (
          <p className="pearl-themed-app-panel rounded-md border px-3 py-6 text-center text-[12px] opacity-70">
            No personal PearlOS changes yet. Ask Pearl to change something and it will appear here.
          </p>
        ) : (
          <div className="grid gap-2">
            {items.map((item) => (
              <LedgerItemCard key={item.id} item={item} onShared={() => void refresh()} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
};

export default PersonalLedgerView;
