"use client";

import React from "react";
import { ImageIcon, Sparkles } from "lucide-react";
import { requestWindowOpen } from "@interface/features/ManeuverableWindow/lib/windowLifecycleController";

/** Quick launchers for the Studio's creative tools, preserved from the prior Studio. */
const StudioToolsRow: React.FC = () => {
  const open = (viewType: "sprites" | "photoMagic", source: string) =>
    requestWindowOpen({ viewType, source });

  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => open("sprites", "studio:sprites")}
        className="flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/[0.07] px-3 py-2.5 text-left text-cyan-100 transition hover:bg-cyan-300/[0.13]"
      >
        <Sparkles size={16} />
        <span className="text-xs uppercase tracking-[0.16em]">Sprites</span>
      </button>
      <button
        type="button"
        onClick={() => open("photoMagic", "studio:photo-magic")}
        className="flex items-center gap-2 rounded-md border border-fuchsia-300/25 bg-fuchsia-300/[0.07] px-3 py-2.5 text-left text-fuchsia-100 transition hover:bg-fuchsia-300/[0.13]"
      >
        <ImageIcon size={16} />
        <span className="text-xs uppercase tracking-[0.16em]">Photo Magic</span>
      </button>
    </div>
  );
};

export default StudioToolsRow;
