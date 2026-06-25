"use client";

import React, { useMemo, useState } from "react";
import { Archive, Globe2, ImageIcon, Sparkles, WandSparkles } from "lucide-react";
import { requestWindowOpen } from "@interface/features/ManeuverableWindow/lib/windowLifecycleController";
import { PhotoGallery } from "@interface/features/PhotoMagic/components/PhotoGallery";
import "@interface/features/PhotoMagic/styles/photo-magic.css";
import GlobalHistoryChronicle from "./GlobalHistoryChronicle";
import GlobalHistoryLens, { type HistoryLens } from "./GlobalHistoryLens";
import GlobalHistoryMap from "./GlobalHistoryMap";
import GlobalHistoryQuest from "./GlobalHistoryQuest";
import { historyEras } from "./global-history-data";

export default function GlobalHistoryStudio() {
  const [activeId, setActiveId] = useState(historyEras[0].id);
  const [lens, setLens] = useState<HistoryLens>("trade");
  const [solved, setSolved] = useState<string[]>([]);
  const activeEra = useMemo(
    () => historyEras.find((era) => era.id === activeId) ?? historyEras[0],
    [activeId],
  );

  function logDiscovery(id: string) {
    setSolved((current) => current.includes(id) ? current : [...current, id]);
  }

  function openStudioTool(viewType: "sprites" | "photoMagic") {
    requestWindowOpen({
      viewType,
      source: viewType === "sprites" ? "studio:sprites" : "studio:photo-magic",
    });
  }

  return (
    <div className="pearl-themed-app h-full w-full overflow-hidden">
      <div className="flex h-full flex-col">
        <header className="pearl-themed-app-surface border-b px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="pearl-themed-app-muted flex items-center gap-2 text-[11px] uppercase">
                <Globe2 size={14} color={activeEra.color} />
                Studio Field Atlas
              </div>
              <h2 className="mt-1 text-base font-semibold leading-tight" style={{ color: activeEra.color }}>
                Global History Time Machine
              </h2>
            </div>
            <div className="pearl-themed-app-panel rounded-md border px-3 py-2 text-xs">
              {solved.length}/6 discoveries logged
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-4">
          <section className="mb-4 grid gap-3 lg:grid-cols-[280px_1fr]">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              <button
                type="button"
                onClick={() => openStudioTool("sprites")}
                className="flex items-center gap-3 rounded-md border border-cyan-300/25 bg-cyan-300/[0.07] px-3 py-3 text-left text-cyan-100 transition hover:bg-cyan-300/[0.13]"
              >
                <Sparkles size={18} />
                <span className="text-xs uppercase tracking-[0.18em]">Sprites</span>
              </button>
              <button
                type="button"
                onClick={() => openStudioTool("photoMagic")}
                className="flex items-center gap-3 rounded-md border border-fuchsia-300/25 bg-fuchsia-300/[0.07] px-3 py-3 text-left text-fuchsia-100 transition hover:bg-fuchsia-300/[0.13]"
              >
                <ImageIcon size={18} />
                <span className="text-xs uppercase tracking-[0.18em]">Photo Magic</span>
              </button>
            </div>
            <div className="pearl-themed-app-panel min-w-0 rounded-md border">
              <PhotoGallery />
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.4fr_.9fr]">
            <GlobalHistoryMap eras={historyEras} activeEra={activeEra} onSelect={setActiveId} />
            <article className="pearl-themed-app-panel rounded-md border p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-md border" style={{ borderColor: activeEra.color, background: activeEra.glow }}>
                  <activeEra.Icon size={22} color={activeEra.color} />
                </div>
                <div className="min-w-0">
                  <p className="pearl-themed-app-muted text-[11px] uppercase">{activeEra.years}</p>
                  <h3 className="text-xl font-semibold leading-tight">{activeEra.title}</h3>
                  <p className="pearl-themed-app-muted mt-1 text-xs">{activeEra.mood}</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6">{activeEra.summary}</p>
              <div className="pearl-themed-app-panel mt-4 rounded-md border p-3">
                <div className="flex items-center gap-2 text-xs">
                  <Archive size={15} color={activeEra.color} />
                  Artifact
                </div>
                <p className="pearl-themed-app-muted mt-2 text-[12px] leading-5">{activeEra.artifact}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {activeEra.connections.map((connection) => (
                  <span key={connection} className="pearl-themed-app-panel rounded-md border px-2.5 py-1.5 text-[11px]">
                    {connection}
                  </span>
                ))}
              </div>
            </article>
          </section>

          <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_.8fr]">
            <GlobalHistoryChronicle eras={historyEras} activeEra={activeEra} onSelect={setActiveId} />
            <div className="grid gap-4">
              <GlobalHistoryLens activeEra={activeEra} lens={lens} onLensChange={setLens} />
              <GlobalHistoryQuest activeEra={activeEra} solved={solved} onSolve={logDiscovery} onReset={() => setSolved([])} />
              <div className="pearl-themed-app-panel rounded-md border p-4">
                <div className="flex items-center gap-2 text-sm">
                  <WandSparkles size={16} color={activeEra.color} />
                  Imagination Switch
                </div>
                <p className="pearl-themed-app-muted mt-2 text-[12px] leading-5">
                  Each beacon reframes the map, artifact, field challenge, and idea links so Studio feels like a playable museum desk.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
