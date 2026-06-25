"use client";

import React from "react";
import { Check, ChevronDown, Loader2, Lock } from "lucide-react";

import { AGENCY_BOSS_ROSTER, agencyBossById, type AgencyBossId } from "@interface/lib/agency-roster";
import { useAgencyBoss } from "./useAgencyBoss";

export function AgencyBossControl() {
  const { boss, loading, saving, canManage, status, updateBoss } = useAgencyBoss();
  const [open, setOpen] = React.useState(false);
  const current = agencyBossById(boss);

  return (
    <div className="relative min-w-0" style={{ fontFamily: "Gohufont, monospace" }}>
      <button
        type="button"
        disabled={!canManage || loading}
        onClick={() => {
          if (canManage && !loading) setOpen((value) => !value);
        }}
        className="pearl-themed-app-panel flex h-11 min-w-[210px] items-center gap-2 rounded border px-2.5 text-left shadow-sm transition hover:opacity-90 disabled:cursor-default disabled:opacity-85"
        aria-expanded={open}
        aria-label={canManage ? "Choose Agency Boss" : "Agency Boss"}
      >
        <img src={current.sprite} alt="" className="h-8 w-8 flex-shrink-0 object-contain" draggable={false} style={{ imageRendering: "pixelated" }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[10px] uppercase tracking-[0.08em] text-white/45">Agency Boss</span>
          <span className="block truncate text-xs font-bold text-white">{loading ? "Loading..." : current.label}</span>
        </span>
        {!canManage ? <Lock size={14} className="text-white/45" /> : saving ? <Loader2 size={14} className="animate-spin text-sky-200" /> : <ChevronDown size={14} className="text-white/55" />}
      </button>

      {!canManage && status ? (
        <div className="mt-1 max-w-[210px] text-[10px] leading-snug text-white/42">{status}</div>
      ) : null}

      {canManage && open ? (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 grid w-[min(520px,calc(100vw-24px))] gap-2 rounded-[8px] border border-white/15 bg-[#080d12]/98 p-2 shadow-2xl md:grid-cols-2">
          {AGENCY_BOSS_ROSTER.map((option) => {
            const selected = option.id === current.id;
            const isSaving = saving === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={Boolean(saving)}
                onClick={() => {
                  void updateBoss(option.id as AgencyBossId);
                  setOpen(false);
                }}
                className={`flex min-w-0 items-center gap-2 rounded border p-2 text-left transition disabled:cursor-wait disabled:opacity-60 ${selected ? "border-sky-300/70 bg-sky-300/12" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}
              >
                <img src={option.sprite} alt="" className="h-11 w-11 flex-shrink-0 object-contain" draggable={false} style={{ imageRendering: "pixelated" }} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-xs font-bold text-white">
                    <span className="truncate">{option.label}</span>
                    {selected ? <Check size={12} className="text-sky-200" /> : null}
                    {isSaving ? <Loader2 size={12} className="animate-spin text-sky-200" /> : null}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-white/50">{option.specialty}</span>
                </span>
              </button>
            );
          })}
          {status ? <div className="md:col-span-2 px-1 text-[10px] text-white/42">{status}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
